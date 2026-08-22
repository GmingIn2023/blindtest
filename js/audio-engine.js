// js/audio-engine.js
// Moteur audio partagé : IDENTIQUE dans selection.html (aperçu) et game.html (jeu).
// Une seule fonction publique pour jouer : playAudioClip(song, onEnd)

(function () {
  let audioCtx = null;
  let bufferCache = new Map();   // url -> AudioBuffer
  let activeSource = null;       // AudioBufferSourceNode
  let activeElement = null;      // HTMLAudioElement (repli)
  let stopTimer = null;
  let playToken = 0;             // annule les lectures obsolètes

  function getCtx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    return audioCtx;
  }

  // ---- Déblocage iOS / mobile : au TOUT PREMIER geste utilisateur de la page ----
  let unlocked = false;
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    try {
      const ctx = getCtx();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
      // Débloque aussi l'élément <audio> (repli)
      const a = new Audio();
      a.muted = true;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      setTimeout(() => { try { a.pause(); } catch (e) {} }, 0);
    } catch (e) { /* ignore */ }
  }
  ['touchstart', 'touchend', 'mousedown', 'click', 'keydown'].forEach(ev => {
    document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
  });

  async function resumeCtx() {
    const ctx = getCtx();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch (e) { /* ignore */ }
    }
    return ctx;
  }

  // ---- Chargement du son (avec replis CORS) ----
  function proxies(url) {
    return [
      url,
      'https://corsproxy.io/?url=' + encodeURIComponent(url),
      'https://api.allorigins.win/raw?url=' + encodeURIComponent(url)
    ];
  }

  async function loadBuffer(url) {
    if (bufferCache.has(url)) return bufferCache.get(url);
    const ctx = await resumeCtx();
    let lastErr = null;
    for (const candidate of proxies(url)) {
      try {
        const res = await fetch(candidate);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const raw = await res.arrayBuffer();
        const buffer = await new Promise((resolve, reject) => {
          // forme "callback" : seule supportée par Safari iOS
          const ret = ctx.decodeAudioData(raw, resolve, reject);
          if (ret && ret.catch) ret.catch(() => {});   // évite une rejection non gérée
        });
        if (bufferCache.size > 12) bufferCache.clear();
        bufferCache.set(url, buffer);
        return buffer;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Chargement audio impossible');
  }

  // Précharge sans jouer (appelé par game.html entre les manches)
  function preloadSong(song) {
    if (song && song.previewUrl) loadBuffer(song.previewUrl).catch(() => {});
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
    const out = ctx.createBuffer(2, buffer.length, buffer.sampleRate);
    const l = buffer.getChannelData(0), r = buffer.getChannelData(1);
    const ol = out.getChannelData(0), or_ = out.getChannelData(1);
    let energy = 0;
    for (let i = 0; i < l.length; i++) {
      const d = (l[i] - r[i]) / 2;
      ol[i] = d; or_[i] = d;
      if ((i & 255) === 0) energy += Math.abs(d);
    }
    // Piste quasi mono : l'annulation de phase donnerait du silence → on garde l'original
    if (energy / (l.length / 256) < 0.0008) return buffer;
    return out;
  }

  // ---- Chaîne d'effets temps réel ----
  function vocalNotch(ctx, node, intensity) {
    const gain = -12 - ((intensity == null ? 40 : intensity) / 100) * 20;
    let cur = node;
    [320, 1000, 2400, 3800].forEach(freq => {
      const f = ctx.createBiquadFilter();
      f.type = 'peaking'; f.frequency.value = freq; f.Q.value = 0.7; f.gain.value = gain;
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
      boost *= 1.2;
    }

    const fv = s.filterValue || 0;
    if (fv > 15) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 100 + (fv / 100) * 4000;
      node.connect(hp); node = hp; boost *= 1.3;
    } else if (fv < -15) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = Math.max(300, 8000 + (fv / 100) * 7800);
      node.connect(lp); node = lp; boost *= 1.3;
    }

    if (s.radioMode) {
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 2.5);
      shaper.curve = curve;
      node.connect(hp); hp.connect(lp); lp.connect(shaper);
      node = shaper; boost *= 1.6;
    }

    const g = ctx.createGain();
    g.gain.value = Math.min(boost, 3);
    node.connect(g);
    return g;
  }

  // ---- API publique ----
  function stopAudio() {
    playToken++;
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    if (activeSource) { try { activeSource.stop(); } catch (e) {} activeSource = null; }
    if (activeElement) { try { activeElement.pause(); } catch (e) {} activeElement = null; }
  }

  // Repli : élément <audio> natif (aucun effet, mais toujours du son)
  function playWithElement(song, token, onEnd) {
    return new Promise((resolve) => {
      const start = song.clipStart || 0;
      const dur = song.clipDuration || 10;
      const audio = new Audio();
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.src = song.previewUrl;
      audio.volume = Math.min(1, (song.customVolume || 100) / 100);
      if (song.speed) audio.playbackRate = Math.min(2, Math.max(0.5, song.speed));
      activeElement = audio;

      const begin = () => {
        if (token !== playToken) return;
        try { audio.currentTime = Math.min(start, Math.max(0, (audio.duration || 30) - 0.5)); } catch (e) {}
        audio.play().then(() => {
          stopTimer = setTimeout(() => {
            if (token !== playToken) return;
            try { audio.pause(); } catch (e) {}
            activeElement = null;
            if (onEnd) onEnd();
          }, dur * 1000);
          resolve(true);
        }).catch(() => resolve(false));
      };

      if (audio.readyState >= 1) begin();
      else {
        audio.addEventListener('loadedmetadata', begin, { once: true });
        audio.addEventListener('error', () => resolve(false), { once: true });
        setTimeout(() => { if (audio.paused && token === playToken) begin(); }, 2500);
      }
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

    const clipStart = song.clipStart || 0;
    const clipDuration = song.clipDuration || 10;
    const volume = (song.customVolume != null ? song.customVolume : 100) / 100;

    try {
      const ctx = await resumeCtx();
      let buffer = await loadBuffer(song.previewUrl);
      if (token !== playToken) return false;

      const variant = song.instrumentalVariant || 1;
      if (song.instrumental && variant !== 4 && (variant === 1 || variant === 3)) {
        buffer = phaseCancel(ctx, buffer);
      }
      if (song.reverse) buffer = reverseBuffer(ctx, buffer);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      buildChain(ctx, source, song, volume).connect(ctx.destination);

      const maxStart = Math.max(0, buffer.duration - 0.5);
      const offset = song.reverse
        ? Math.max(0, Math.min(maxStart, buffer.duration - clipStart - clipDuration))
        : Math.min(clipStart, maxStart);
      const realDur = Math.min(clipDuration, buffer.duration - offset);

      source.start(0, offset, realDur);
      activeSource = source;

      stopTimer = setTimeout(() => {
        if (token !== playToken) return;
        try { source.stop(); } catch (e) {}
        activeSource = null;
        if (onEnd) onEnd();
      }, (realDur / (song.speed || 1)) * 1000 + 120);

      return true;
    } catch (e) {
      console.warn('WebAudio indisponible, repli sur le lecteur natif :', e);
      if (token !== playToken) return false;
      return await playWithElement(song, token, onEnd);
    }
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

  window.AudioEngine = { playAudioClip, stopAudio, preloadSong, playBeep, unlockAudio };
  // Alias historiques
  window.playAudioClip = playAudioClip;
  window.stopAudio = stopAudio;
  window.playLyricsRevealBeep = () => playBeep(450);
})();
