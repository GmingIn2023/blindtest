// js/audio-engine.js
// Moteur audio partagé : IDENTIQUE dans selection.html (aperçu) et game.html (jeu).
// API publique : playAudioClip(song, onEnd), stopAudio(), preloadSong(song), unlockAudio(),
//                loadBuffer(url), renderClipPreview(song), getPeaks(buffer, n), getPlayState(), analyzeLoudness()
//
// Principe : on essaie d'abord WebAudio (tous les effets). Si le fichier ne peut pas être lu
// à cause du CORS, on bascule sur un lecteur <audio> natif SANS crossOrigin (toujours du son,
// mais sans effets de traitement) — c'était la cause du "aucun son" : crossOrigin="anonymous"
// faisait échouer le lecteur de secours dès que le serveur n'envoyait pas d'en-tête CORS.

(function () {
  let audioCtx = null;
  const bufferCache = new Map();   // url -> AudioBuffer
  const pendingLoads = new Map();  // url -> Promise<AudioBuffer> (évite les doubles téléchargements)
  let activeSource = null;         // AudioBufferSourceNode
  let activeElement = null;        // HTMLAudioElement (repli)
  let analyser = null;
  let stopTimer = null;
  let playToken = 0;               // annule les lectures obsolètes
  let sharedEl = null;             // élément <audio> débloqué au 1er geste (indispensable sur iOS)
  const play = { playing: false, mode: null, startedAt: 0, total: 0, elementStart: 0 };

  const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAAAA';

  function getCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    return audioCtx;
  }

  // ---- Déblocage iOS / mobile ----
  // Sur iPhone, WebAudio est coupé par le bouton "silencieux" et par défaut la session audio
  // de la page est de type "ambiante". On la passe en "lecture" (iOS 17+) et, pour les iOS plus
  // anciens, on fait tourner en boucle un son muet dans un <audio> (astuce "unmute") qui bascule
  // la session en mode lecture : le son sort alors même avec le bouton silencieux activé.
  function makeSilentLoopUrl() {
    const sr = 8000, n = sr / 2;                       // 0,5 s de silence
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  let keepAliveEl = null;
  function setPlaybackSession() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    try {
      if (!keepAliveEl) {
        keepAliveEl = document.createElement('audio');
        keepAliveEl.setAttribute('playsinline', '');
        keepAliveEl.setAttribute('x-webkit-airplay', 'deny');
        keepAliveEl.loop = true;
        keepAliveEl.src = makeSilentLoopUrl();
      }
      const p = keepAliveEl.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }

  let unlocked = false;
  function unlockAudio(ev) {
    try {
      setPlaybackSession();
      const ctx = getCtx();
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      if (unlocked) return;
      // touchstart n'est PAS un geste valide pour iOS : on attend touchend/click pour valider le déblocage
      if (ev && ev.type === 'touchstart') return;
      unlocked = true;
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
      // Un SEUL élément <audio>, débloqué ici puis réutilisé : sur iOS, un "new Audio()"
      // créé plus tard (hors geste utilisateur) serait refusé.
      sharedEl = new Audio();
      sharedEl.src = SILENT_WAV;
      const p = sharedEl.play();
      if (p && p.catch) p.catch(() => {});
      setTimeout(() => { try { sharedEl.pause(); } catch (e) {} }, 60);
    } catch (e) { /* ignore */ }
  }
  ['touchstart', 'touchend', 'mousedown', 'click', 'keydown'].forEach(ev => {
    document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
  });

  async function resumeCtx() {
    const ctx = getCtx();
    if (ctx.state !== 'running') {   // "suspended" ou "interrupted" (iOS)
      try { await Promise.race([ctx.resume(), new Promise(r => setTimeout(r, 800))]); } catch (e) { /* ignore */ }
    }
    return ctx;
  }

  // ---- Chargement du son : toutes les voies en parallèle, la première qui répond gagne ----
  function fetchBytes(url) {
    const enc = encodeURIComponent(url);
    const candidates = [
      [url, 9000],
      ['https://corsproxy.io/?url=' + enc, 12000],
      ['https://api.allorigins.win/raw?url=' + enc, 12000],
      ['https://api.codetabs.com/v1/proxy?quest=' + enc, 12000]
    ];
    return new Promise((resolve, reject) => {
      let left = candidates.length, done = false;
      const fail = () => { if (--left === 0 && !done) reject(new Error('Chargement audio impossible')); };
      candidates.forEach(([u, ms]) => {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), ms);
        fetch(u, { signal: ac.signal })
          .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
          .then(b => {
            clearTimeout(to);
            if (b.byteLength < 2000) throw new Error('fichier trop court');
            if (!done) { done = true; resolve(b); }
          })
          .catch(() => { clearTimeout(to); fail(); });
      });
    });
  }

  function decode(ctx, raw) {
    // forme "callback" : seule supportée par les anciens Safari iOS
    return new Promise((resolve, reject) => {
      const ret = ctx.decodeAudioData(raw, resolve, reject);
      if (ret && ret.catch) ret.catch(() => {});   // évite une rejection non gérée
    });
  }

  function loadBuffer(url) {
    if (bufferCache.has(url)) return Promise.resolve(bufferCache.get(url));
    if (pendingLoads.has(url)) return pendingLoads.get(url);
    const p = (async () => {
      const ctx = await resumeCtx();
      const raw = await fetchBytes(url);
      const buffer = await decode(ctx, raw);
      if (bufferCache.size > 14) bufferCache.delete(bufferCache.keys().next().value);
      bufferCache.set(url, buffer);
      return buffer;
    })();
    pendingLoads.set(url, p);
    const clear = () => pendingLoads.delete(url);
    p.then(clear, clear);
    return p;
  }

  // Précharge sans jouer (appelé par game.html entre les manches)
  function preloadSong(song) {
    return song && song.previewUrl ? loadBuffer(song.previewUrl).then(() => true, () => false) : Promise.resolve(false);
  }

  // ---- Transformations de buffer ----
  function reverseBuffer(ctx, buffer) {
    const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch), dst = out.getChannelData(ch);
      for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
    }
    return out;
  }

  function phaseCancel(ctx, buffer) {
    if (buffer.numberOfChannels < 2) return buffer;
    const l = buffer.getChannelData(0), r = buffer.getChannelData(1);
    // Beaucoup d'extraits (Deezer/iTunes) sont quasi mono ou très corrélés :
    // l'annulation de phase y détruit presque tout le signal → silence.
    // On compare l'énergie du "diff" (L-R) à l'énergie du canal L : si le
    // diff est trop faible en proportion, on garde l'original tel quel.
    let baseEnergy = 0, diffEnergy = 0, n = 0;
    for (let i = 0; i < l.length; i += 64) {
      baseEnergy += Math.abs(l[i]);
      diffEnergy += Math.abs(l[i] - r[i]) / 2;
      n++;
    }
    baseEnergy /= n || 1; diffEnergy /= n || 1;
    if (baseEnergy < 1e-6 || diffEnergy / baseEnergy < 0.14) return buffer;

    const out = ctx.createBuffer(2, buffer.length, buffer.sampleRate);
    const ol = out.getChannelData(0), or_ = out.getChannelData(1);
    for (let i = 0; i < l.length; i++) {
      const d = (l[i] - r[i]) / 2;
      ol[i] = d; or_[i] = d;
    }
    return out;
  }

  // ---- Chaîne d'effets (identique en jeu, en aperçu et dans le rendu du dictaphone) ----
  function vocalNotch(ctx, node, intensity) {
    // Bornée : même à fond, on atténue la voix sans réduire le reste au silence.
    const gain = -8 - ((intensity == null ? 40 : intensity) / 100) * 14; // -8 à -22 dB
    let cur = node;
    [320, 1000, 2400, 3800].forEach(freq => {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking'; f.frequency.value = freq; f.Q.value = 1.1; f.gain.value = gain;
      cur.connect(f); cur = f;
    });
    return cur;
  }

  function buildChain(ctx, source, s, volume) {
    let node = source;
    let boost = volume;

    source.playbackRate.value = s.speed || 1;
    if (source.detune) source.detune.value = (s.pitch || 0) * 100;

    const variant = s.instrumentalVariant || 1;
    if (s.instrumental && (variant === 2 || variant === 3)) {
      node = vocalNotch(ctx, node, s.instrumentalIntensity);
      boost *= 1.5;
    }

    // Filtres bornés pour rester clairement audibles même au maximum
    const fv = s.filterValue || 0;
    if (fv > 15) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 120 + (fv / 100) * 1600; // 120–1720 Hz
      node.connect(hp); node = hp; boost *= 1.15;
    } else if (fv < -15) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = Math.max(700, 8000 + (fv / 100) * 6800); // 1200–8000 Hz
      node.connect(lp); node = lp; boost *= 1.15;
    }

    if (s.radioMode) {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 2.2);
      shaper.curve = curve;
      node.connect(hp); hp.connect(lp); lp.connect(shaper);
      node = shaper; boost *= 1.3;
    }

    const g = ctx.createGain();
    g.gain.value = Math.min(boost, 2.2);
    node.connect(g);

    // Compresseur + gain de rattrapage : lisse les écarts de volume entre extraits
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.knee.value = 24;
    comp.ratio.value = 6;
    comp.attack.value = 0.015;
    comp.release.value = 0.22;
    g.connect(comp);

    const makeup = ctx.createGain();
    makeup.gain.value = 1.7;
    comp.connect(makeup);

    // Limiteur final : aucune combinaison d'effets ne peut saturer
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.06;
    makeup.connect(limiter);

    // Marge de sécurité : le limiteur laisse passer de petites crêtes > 1.0, qui saturent (craquent) en sortie
    const trim = ctx.createGain();
    trim.gain.value = 0.8;
    limiter.connect(trim);

    return trim;
  }

  // Prépare le buffer transformé + la fenêtre de lecture (partagé par lecture et rendu)
  function prepareClip(ctx, buffer, song) {
    const clipStart = song.clipStart || 0;
    const clipDuration = song.clipDuration || 10;
    const variant = song.instrumentalVariant || 1;
    let buf = buffer;
    if (song.instrumental && variant !== 4 && (variant === 1 || variant === 3)) buf = phaseCancel(ctx, buf);
    if (song.reverse) buf = reverseBuffer(ctx, buf);
    const maxStart = Math.max(0, buf.duration - 0.5);
    const offset = song.reverse
      ? Math.max(0, Math.min(maxStart, buf.duration - clipStart - clipDuration))
      : Math.min(clipStart, maxStart);
    const realDur = Math.max(0.2, Math.min(clipDuration, buf.duration - offset));
    return { buf, offset, realDur, rate: song.speed || 1 };
  }

  // ---- API publique ----
  function stopAudio() {
    playToken++;
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    if (activeSource) { try { activeSource.stop(); } catch (e) {} activeSource = null; }
    if (activeElement) { try { activeElement.pause(); } catch (e) {} activeElement = null; }
    play.playing = false;
  }

  // Repli : lecteur <audio> natif (sans effets de traitement, mais toujours du son).
  // IMPORTANT : pas de crossOrigin ici, sinon le lecteur refuse tout fichier sans en-tête CORS.
  function playWithElement(song, token, onEnd) {
    return new Promise((resolve) => {
      const start = song.clipStart || 0;
      const dur = song.clipDuration || 10;
      const speed = Math.min(2, Math.max(0.5, song.speed || 1));
      const rate = Math.min(2, Math.max(0.5, speed * Math.pow(2, (song.pitch || 0) / 12)));
      const audio = sharedEl || new Audio();
      try { audio.pause(); } catch (e) {}
      audio.onended = audio.onerror = audio.onloadedmetadata = null;
      audio.muted = false;
      audio.preload = 'auto';
      audio.src = song.previewUrl;
      audio.volume = Math.min(1, Math.max(0, (song.customVolume != null ? song.customVolume : 100) / 100));
      ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch'].forEach(k => {
        if (k in audio) audio[k] = !song.pitch;   // pitch demandé : on laisse la hauteur suivre la vitesse
      });
      activeElement = audio;
      let started = false;

      const begin = () => {
        if (started || token !== playToken) return;
        started = true;
        try { audio.currentTime = Math.min(start, Math.max(0, (audio.duration || 30) - 0.5)); } catch (e) {}
        audio.playbackRate = rate;
        const p = audio.play();
        const ok = () => {
          play.playing = true; play.mode = 'element'; play.startedAt = performance.now(); play.total = dur / rate;
          stopTimer = setTimeout(() => {
            if (token !== playToken) return;
            try { audio.pause(); } catch (e) {}
            activeElement = null; play.playing = false;
            if (onEnd) onEnd();
          }, (dur / rate) * 1000 + 100);
          resolve(true);
        };
        if (p && p.then) p.then(ok).catch(() => resolve(false)); else ok();
      };

      audio.addEventListener('loadedmetadata', begin, { once: true });
      audio.addEventListener('error', () => resolve(false), { once: true });
      if (audio.readyState >= 1) begin();
      setTimeout(() => { if (!started && token === playToken) begin(); }, 3000);
      try { audio.load(); } catch (e) {}
    });
  }

  /**
   * Joue l'extrait d'une chanson avec TOUS ses réglages.
   * @param {object} song  { previewUrl, clipStart, clipDuration, speed, pitch, reverse,
   *                         instrumental, instrumentalVariant, instrumentalIntensity,
   *                         filterValue, radioMode, customVolume }
   * @param {function} onEnd  appelé à la fin de l'extrait
   * @returns {Promise<boolean>} true si du son a été lancé
   */
  async function playAudioClip(song, onEnd) {
    stopAudio();
    if (!song || !song.previewUrl) return false;
    unlockAudio();
    const token = ++playToken;
    const volume = (song.customVolume != null ? song.customVolume : 100) / 100;

    try {
      const ctx = await resumeCtx();
      const buffer = await loadBuffer(song.previewUrl);
      if (token !== playToken) return false;
      if (ctx.state !== 'running') await resumeCtx();
      if (ctx.state !== 'running') throw new Error('AudioContext bloqué (' + ctx.state + ')');

      const { buf, offset, realDur, rate } = prepareClip(ctx, buffer, song);
      const source = ctx.createBufferSource();
      source.buffer = buf;
      const out = buildChain(ctx, source, song, volume);
      if (!analyser) { analyser = ctx.createAnalyser(); analyser.fftSize = 1024; analyser.connect(ctx.destination); }
      out.connect(analyser);

      source.start(0, offset, realDur);
      activeSource = source;
      play.playing = true; play.mode = 'webaudio'; play.startedAt = ctx.currentTime; play.total = realDur / rate;

      // Garde-fou : si l'horloge audio n'avance pas (iOS gelé), on bascule sur le lecteur natif
      const t0 = ctx.currentTime;
      setTimeout(() => {
        if (token !== playToken || play.mode !== 'webaudio') return;
        if (ctx.currentTime - t0 < 0.05) {
          console.warn('Horloge WebAudio figée, repli sur le lecteur natif');
          if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
          try { source.stop(); } catch (e) {}
          activeSource = null;
          playWithElement(song, token, onEnd);
        }
      }, 600);

      stopTimer = setTimeout(() => {
        if (token !== playToken) return;
        try { source.stop(); } catch (e) {}
        activeSource = null; play.playing = false;
        if (onEnd) onEnd();
      }, (realDur / rate) * 1000 + 120);

      return true;
    } catch (e) {
      console.warn('WebAudio indisponible (CORS ?), repli sur le lecteur natif :', e && e.message);
      if (token !== playToken) return false;
      return await playWithElement(song, token, onEnd);
    }
  }

  // État de lecture pour le dictaphone : position, durée, niveau instantané
  function getPlayState() {
    if (!play.playing) return { playing: false, elapsed: 0, total: play.total, level: 0, mode: play.mode };
    let elapsed;
    if (play.mode === 'webaudio' && audioCtx) elapsed = audioCtx.currentTime - play.startedAt;
    else elapsed = (performance.now() - play.startedAt) / 1000;
    let level = 0;
    if (play.mode === 'webaudio' && analyser) {
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      level = Math.min(1, Math.sqrt(sum / data.length) * 2.6);
    }
    return { playing: true, elapsed: Math.max(0, Math.min(elapsed, play.total)), total: play.total, level, mode: play.mode };
  }

  // Pics d'une forme d'onde (n barres), valeurs 0..1
  function getPeaks(buffer, n) {
    const peaks = new Float32Array(n);
    const chs = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) chs.push(buffer.getChannelData(c));
    const per = Math.max(1, Math.floor(buffer.length / n));
    const step = Math.max(1, Math.floor(per / 48));
    let max = 0;
    for (let i = 0; i < n; i++) {
      let m = 0;
      const from = i * per, to = Math.min(buffer.length, from + per);
      for (let j = from; j < to; j += step) for (let c = 0; c < chs.length; c++) { const v = Math.abs(chs[c][j]); if (v > m) m = v; }
      peaks[i] = m; if (m > max) max = m;
    }
    return { peaks, max };
  }

  /**
   * Rend l'extrait avec la MÊME chaîne d'effets que la lecture (volume, vitesse, pitch,
   * filtres, radio, sans voix, inversé) pour que le dictaphone montre ce qu'on entendra.
   * @returns {Promise<{peaks:Float32Array, duration:number}>}
   */
  async function renderClipPreview(song, bins) {
    const n = bins || 160;
    const buffer = await loadBuffer(song.previewUrl);
    const ctx = await resumeCtx();
    const { buf, offset, realDur, rate } = prepareClip(ctx, buffer, song);
    const outDur = realDur / rate;
    const sr = buf.sampleRate;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(2, Math.max(256, Math.ceil(outDur * sr) + 256), sr);
    const source = off.createBufferSource();
    source.buffer = buf;
    buildChain(off, source, song, (song.customVolume != null ? song.customVolume : 100) / 100).connect(off.destination);
    source.start(0, offset, realDur);
    const rendered = await new Promise((resolve, reject) => {
      const r = off.startRendering();
      if (r && r.then) r.then(resolve, reject); else off.oncomplete = e => resolve(e.renderedBuffer);
    });
    // On ne garde que la partie utile (le reste est du silence de marge)
    const useful = Math.min(rendered.length, Math.ceil(outDur * sr));
    const sub = { numberOfChannels: rendered.numberOfChannels, length: useful, getChannelData: c => rendered.getChannelData(c) };
    const { peaks } = getPeaks(sub, n);
    return { peaks, duration: outDur };
  }

  /**
   * Mesure le volume perçu (RMS) d'un extrait, pour comparer des chansons entre elles.
   * @returns {Promise<number|null>} valeur ~0–0.4 (musique typique), null si échec
   */
  async function analyzeLoudness(url, clipStart, clipDuration) {
    try {
      const buffer = await loadBuffer(url);
      const sr = buffer.sampleRate;
      const start = Math.max(0, Math.floor((clipStart || 0) * sr));
      const len = Math.min(buffer.length - start, Math.floor((clipDuration || 10) * sr));
      if (len <= 0) return null;
      const data = buffer.getChannelData(0);
      const step = Math.max(1, Math.floor(len / 20000)); // échantillonnage : reste rapide sur les longs extraits
      let sumSq = 0, n = 0;
      for (let i = start; i < start + len; i += step) { const v = data[i]; sumSq += v * v; n++; }
      return n ? Math.sqrt(sumSq / n) : null;
    } catch (e) { return null; }
  }

  // Petit bip (révélation des paroles)
  function playBeep(freq) {
    try {
      const ctx = getCtx();
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq || 450, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.08);
      g.gain.setValueAtTime(0.04, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.09);
    } catch (e) {}
  }

  window.AudioEngine = {
    playAudioClip, stopAudio, preloadSong, playBeep, unlockAudio, analyzeLoudness,
    loadBuffer, renderClipPreview, getPeaks, getPlayState
  };
  // Alias historiques
  window.playAudioClip = playAudioClip;
  window.stopAudio = stopAudio;
  window.playLyricsRevealBeep = () => playBeep(450);
})();
