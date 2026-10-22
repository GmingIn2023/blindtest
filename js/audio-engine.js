// js/audio-engine.js
// Moteur audio partagé : IDENTIQUE dans selection.html (aperçu + dictaphone) et game.html (jeu).
// API publique : playAudioClip(song, onEnd), stopAudio(), preloadSong(song), unlockAudio(),
//                loadBuffer(urlOuSong), renderClipPreview(song, n), getPeaks(buffer, n),
//                getPlayState(), analyzeLoudness(), playBeep(), lastError
//
// PRINCIPE (fiable sur iPhone) :
//   1. On télécharge l'extrait et on le décode (WebAudio *hors-ligne*, donc indépendant de la
//      session audio du téléphone, du bouton silencieux et des autorisations de lecture).
//   2. On applique TOUS les réglages (vitesse, pitch, inversé, sans voix, filtres, radio, volume)
//      dans un rendu hors-ligne. Ce rendu sert à la fois pour le dictaphone ET pour l'écoute.
//   3. Le résultat est encodé en WAV et joué dans un lecteur <audio> classique : c'est le seul
//      chemin que iOS ne coupe jamais (même avec le bouton silencieux).
//   4. Si le rendu est impossible (réseau, décodage), repli sur la lecture directe du fichier.
//   5. Les liens de preview Deezer expirent au bout de ~15 min : s'ils échouent, on récupère
//      automatiquement un lien frais (Deezer / iTunes) à partir du titre et de l'artiste.

(function () {
  'use strict';

  const SR = 44100;                 // fréquence de rendu (fixe : mêmes résultats partout)
  const MAX_OUT_SEC = 45;           // durée maximale d'un extrait rendu
  const RENDER_TIMEOUT = 15000;     // au-delà, on bascule sur la lecture directe
  const BUFFER_CACHE_MAX = 8;
  const CLIP_CACHE_MAX = 6;

  const api = { lastError: '' };

  const bufferCache = new Map();    // url -> AudioBuffer (LRU)
  const pendingLoads = new Map();   // url -> Promise<AudioBuffer>
  const clipCache = new Map();      // clé de réglages -> clip rendu (LRU)
  const pendingClips = new Map();   // clé -> Promise<clip>
  let playToken = 0;                // annule les lectures obsolètes
  let stopTimer = null;
  let sharedEl = null;              // l'unique <audio> (débloqué par un geste, indispensable sur iOS)
  let primed = false;
  let rtCtx = null;                 // contexte temps réel : uniquement pour les petits bips
  const play = { playing: false, mode: null, startedAt: 0, total: 0, clip: null, onEnd: null, degraded: false };

  const SILENT_WAV = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAAAA';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const OAC = () => window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || 'timeout')), ms))]);

  function lruGet(map, key) {
    if (!map.has(key)) return undefined;
    const v = map.get(key); map.delete(key); map.set(key, v);
    return v;
  }

  /* ------------------------------------------------------------------ */
  /*  Déblocage du lecteur <audio> (iOS / Chrome mobile)                  */
  /* ------------------------------------------------------------------ */
  function ensureEl() {
    if (!sharedEl) {
      sharedEl = new Audio();
      sharedEl.setAttribute('playsinline', '');
      sharedEl.setAttribute('webkit-playsinline', '');
      sharedEl.preload = 'auto';
    }
    return sharedEl;
  }

  // À appeler dans un geste utilisateur (touchend / click). Tant que ça n'a pas réussi,
  // chaque geste retente. On ne touche jamais au lecteur pendant une lecture.
  function unlockAudio(ev) {
    if (ev && ev.type === 'touchstart') return;      // touchstart n'est PAS un geste valide pour iOS
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    try {
      if (!rtCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) rtCtx = new AC(); }
      if (rtCtx && rtCtx.state !== 'running') rtCtx.resume().catch(() => {});
    } catch (e) {}
    if (primed || play.playing) return;
    try {
      const a = ensureEl();
      a.src = SILENT_WAV;
      const p = a.play();
      if (p && p.then) p.then(() => { primed = true; }, () => {}); else primed = true;
    } catch (e) {}
  }
  ['touchend', 'mousedown', 'click', 'keydown'].forEach(ev => {
    document.addEventListener(ev, unlockAudio, { capture: true, passive: true });
  });

  /* ------------------------------------------------------------------ */
  /*  Réseau : téléchargement, liens frais, décodage                      */
  /* ------------------------------------------------------------------ */
  function fetchDirect(url, ms) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), ms || 15000);
    return fetch(url, { signal: ac.signal })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(b => { if (b.byteLength < 2000) throw new Error('fichier trop court'); return b; })
      .finally(() => clearTimeout(to));
  }

  // Dernier recours : proxys CORS publics (lancés ensemble, le premier qui répond gagne)
  function fetchViaProxies(url) {
    const enc = encodeURIComponent(url);
    const candidates = [
      'https://api.allorigins.win/raw?url=' + enc,
      'https://api.codetabs.com/v1/proxy?quest=' + enc,
      'https://corsproxy.io/?url=' + enc
    ];
    return new Promise((resolve, reject) => {
      let left = candidates.length, done = false;
      const fail = () => { if (--left === 0 && !done) reject(new Error('Chargement audio impossible')); };
      candidates.forEach(u => {
        fetchDirect(u, 12000).then(b => { if (!done) { done = true; resolve(b); } }, fail);
      });
    });
  }

  function decode(raw) {
    const O = OAC();
    const ctx = new O(1, 1, SR);
    // forme "callback" : seule supportée par les anciens Safari iOS
    return new Promise((resolve, reject) => {
      const ret = ctx.decodeAudioData(raw, resolve, reject);
      if (ret && ret.catch) ret.catch(() => {});   // évite une rejection non gérée
    });
  }

  function jsonp(url, ms) {
    return new Promise((res, rej) => {
      const cb = 'ae' + Math.random().toString(36).slice(2);
      const sc = document.createElement('script');
      let to;
      const clean = () => { clearTimeout(to); delete window[cb]; sc.remove(); };
      to = setTimeout(() => { clean(); rej(new Error('timeout')); }, ms || 7000);
      window[cb] = d => { clean(); res(d); };
      sc.onerror = () => { clean(); rej(new Error('jsonp')); };
      sc.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + cb;
      document.head.appendChild(sc);
    });
  }

  const norm = s => (window.normalize ? window.normalize(s) : String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
  const cleanTitle = t => norm(String(t || '').replace(/\(.*?\)|\[.*?\]|(-|–)\s*(remaster|live|radio|single|version|feat).*$/gi, ''));

  // Cherche d'autres liens de preview (frais) pour la même chanson. Prudent : le titre ET l'artiste doivent correspondre.
  async function findAlternatives(song) {
    const title = song.previewTitle || song.title, artist = song.previewArtist || song.artist;
    if (!title) return [];
    const nt = cleanTitle(title), na = norm(artist || '');
    if (!nt) return [];
    const q = String(((artist || '') + ' ' + title)).trim();
    const dz = 'https://api.deezer.com/search?output=jsonp&q=' +
      encodeURIComponent(`artist:"${String(artist || '').replace(/"/g, '')}" track:"${String(title).replace(/"/g, '')}"`);
    const dz2 = 'https://api.deezer.com/search?output=jsonp&q=' + encodeURIComponent(q);
    const it = 'https://itunes.apple.com/search?media=music&entity=song&limit=10&term=' + encodeURIComponent(q);
    const lists = await Promise.all([
      jsonp(dz).then(d => (d.data || []).map(s => ({ t: s.title, a: s.artist && s.artist.name, u: s.preview })), () => []),
      jsonp(dz2).then(d => (d.data || []).map(s => ({ t: s.title, a: s.artist && s.artist.name, u: s.preview })), () => []),
      jsonp(it).then(d => (d.results || []).map(s => ({ t: s.trackName, a: s.artistName, u: s.previewUrl })), () => [])
    ]);
    const out = [];
    lists.forEach(list => list.forEach(c => {
      if (!c.u || c.u === song.previewUrl || out.indexOf(c.u) >= 0) return;
      const ct = cleanTitle(c.t), ca = norm(c.a || '');
      if (ct !== nt) return;
      if (na && ca && !(ca.includes(na) || na.includes(ca))) return;
      out.push(c.u);
    }));
    return out;
  }

  async function fetchDecode(url, viaProxy) {
    const raw = viaProxy ? await fetchViaProxies(url) : await fetchDirect(url, 15000);
    return decode(raw);
  }

  async function loadFresh(song) {
    const url = song.previewUrl;
    let lastErr;
    try { return await fetchDecode(url, false); } catch (e) { lastErr = e; }
    // lien expiré / refusé / format illisible : on cherche un lien frais pour la même chanson
    let alts = [];
    try { alts = await findAlternatives(song); } catch (e) {}
    for (const alt of alts) {
      try { return await fetchDecode(alt, false); } catch (e) { lastErr = e; }
    }
    // Proxys publics : seulement si l'échec ressemble à un blocage réseau/CORS (pas à un fichier absent ou refusé)
    const refused = /^HTTP 4\d\d/.test(String(lastErr && lastErr.message));
    if (!refused) { try { return await fetchDecode(url, true); } catch (e) { lastErr = e; } }
    throw lastErr || new Error('Chargement audio impossible');
  }

  // Accepte une URL (string) ou un objet chanson (avec titre/artiste pour retrouver un lien frais)
  function loadBuffer(x) {
    const song = typeof x === 'string' ? { previewUrl: x } : x;
    const url = song && song.previewUrl;
    if (!url) return Promise.reject(new Error('Pas d\'URL audio'));
    const hit = lruGet(bufferCache, url);
    if (hit) return Promise.resolve(hit);
    if (pendingLoads.has(url)) return pendingLoads.get(url);
    const p = loadFresh(song).then(buffer => {
      bufferCache.set(url, buffer);
      while (bufferCache.size > BUFFER_CACHE_MAX) bufferCache.delete(bufferCache.keys().next().value);
      return buffer;
    });
    pendingLoads.set(url, p);
    const clear = () => pendingLoads.delete(url);
    p.then(clear, clear);
    return p;
  }

  /* ------------------------------------------------------------------ */
  /*  Transformations de buffer                                           */
  /* ------------------------------------------------------------------ */
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
    // On compare l'énergie du "diff" (L-R) à celle du canal L : trop faible → on garde l'original.
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

  /* ------------------------------------------------------------------ */
  /*  Chaîne d'effets (identique en jeu, en aperçu et dans le dictaphone) */
  /* ------------------------------------------------------------------ */
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

  // Vitesse effective : la vitesse ET le pitch modifient la lecture (comme un disque), donc la durée.
  function effectiveRate(s) {
    return clamp((s.speed || 1) * Math.pow(2, (s.pitch || 0) / 12), 0.05, 16);
  }

  function buildChain(ctx, source, s, volume, rate) {
    let node = source;
    let boost = volume;

    source.playbackRate.value = rate;

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

    // Marge de sécurité : le limiteur laisse passer de petites crêtes > 1.0, qui craquent en sortie
    const trim = ctx.createGain();
    trim.gain.value = 0.8;
    limiter.connect(trim);

    return trim;
  }

  // Prépare le buffer transformé + la fenêtre de lecture
  function prepareClip(ctx, buffer, song) {
    const clipStart = Math.max(0, song.clipStart || 0);
    const clipDuration = Math.max(0.2, song.clipDuration || 10);
    const variant = song.instrumentalVariant || 1;
    let buf = buffer;
    if (song.instrumental && variant !== 4 && (variant === 1 || variant === 3)) buf = phaseCancel(ctx, buf);
    if (song.reverse) buf = reverseBuffer(ctx, buf);
    const maxStart = Math.max(0, buf.duration - 0.5);
    const offset = song.reverse
      ? Math.max(0, Math.min(maxStart, buf.duration - clipStart - clipDuration))
      : Math.min(clipStart, maxStart);
    const rate = effectiveRate(song);
    let srcDur = Math.max(0.2, Math.min(clipDuration, buf.duration - offset));
    let outDur = srcDur / rate;
    if (outDur > MAX_OUT_SEC) { outDur = MAX_OUT_SEC; srcDur = outDur * rate; }
    return { buf, offset, srcDur, outDur, rate };
  }

  /* ------------------------------------------------------------------ */
  /*  Rendu hors-ligne → WAV                                              */
  /* ------------------------------------------------------------------ */
  function startRendering(off) {
    return new Promise((resolve, reject) => {
      let r;
      try { r = off.startRendering(); } catch (e) { reject(e); return; }
      if (r && r.then) r.then(resolve, reject); else off.oncomplete = e => resolve(e.renderedBuffer);
    });
  }

  function encodeWav(buffer, length) {
    const ch = Math.min(2, buffer.numberOfChannels), n = length;
    const data = new ArrayBuffer(44 + n * ch * 2), v = new DataView(data);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * ch * 2, true);
    v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, n * ch * 2, true);
    const chans = []; for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
      }
    }
    return new Blob([data], { type: 'audio/wav' });
  }

  // Enveloppe (max absolu par tranche de 20 ms) : sert au dictaphone et au niveau en direct
  function computeEnv(buffer, length) {
    const bin = Math.max(1, Math.floor(buffer.sampleRate * 0.02));
    const env = new Float32Array(Math.max(1, Math.ceil(length / bin)));
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        const a = d[i] < 0 ? -d[i] : d[i];
        const b = (i / bin) | 0;
        if (a > env[b]) env[b] = a;
        if (a > peak) peak = a;
      }
    }
    return { env, peak };
  }

  function peaksFromEnv(env, n) {
    const out = new Float32Array(n), per = env.length / n;
    for (let i = 0; i < n; i++) {
      let m = 0;
      const from = Math.floor(i * per), to = Math.max(from + 1, Math.floor((i + 1) * per));
      for (let j = from; j < to && j < env.length; j++) if (env[j] > m) m = env[j];
      out[i] = m;
    }
    return out;
  }

  function clipKey(s) {
    return [s.previewUrl, s.clipStart || 0, s.clipDuration || 10, s.speed || 1, s.pitch || 0, s.reverse ? 1 : 0,
      s.instrumental ? 1 : 0, s.instrumentalVariant || 1, s.instrumentalIntensity == null ? 40 : s.instrumentalIntensity,
      s.filterValue || 0, s.radioMode ? 1 : 0, s.customVolume == null ? 100 : s.customVolume].join('|');
  }

  async function renderOnce(song, buffer) {
    const O = OAC();
    const tmp = new O(2, 1, SR);                       // sert seulement à fabriquer des buffers
    const { buf, offset, srcDur, outDur, rate } = prepareClip(tmp, buffer, song);
    const len = Math.max(256, Math.ceil(outDur * SR) + 256);
    const off = new O(2, len, SR);
    const source = off.createBufferSource();
    source.buffer = buf;
    buildChain(off, source, song, (song.customVolume != null ? song.customVolume : 100) / 100, rate).connect(off.destination);
    source.start(0, offset, srcDur);
    const rendered = await startRendering(off);
    const useful = Math.max(1, Math.min(rendered.length, Math.ceil(outDur * rendered.sampleRate)));
    // Gain de rattrapage : "sans voix", filtres extrêmes… peuvent laisser un extrait très faible.
    // On le remonte (jamais l'inverse) vers un niveau audible, proportionnel au volume choisi.
    const vol = (song.customVolume != null ? song.customVolume : 100) / 100;
    let { env, peak } = computeEnv(rendered, useful);
    let sq = 0, cnt = 0;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const d = rendered.getChannelData(c);
      for (let i = 0; i < useful; i += 4) { sq += d[i] * d[i]; cnt++; }
    }
    const rms = Math.sqrt(sq / (cnt || 1));
    const target = 0.14 * vol;
    let boosted = false;
    if (peak > 0.0005 && rms < target * 0.75) {
      const gain = Math.min(6, target / rms, 0.9 / peak);
      if (gain > 1.05) {
        for (let c = 0; c < rendered.numberOfChannels; c++) {
          const d = rendered.getChannelData(c);
          for (let i = 0; i < useful; i++) d[i] *= gain;
        }
        ({ env, peak } = computeEnv(rendered, useful));
        boosted = true;
      }
    }
    return { rendered, useful, env, peak, boosted, duration: useful / rendered.sampleRate };
  }

  function storeClip(key, clip) {
    clipCache.set(key, clip);
    while (clipCache.size > CLIP_CACHE_MAX) {
      const oldKey = clipCache.keys().next().value;
      const old = clipCache.get(oldKey);
      if (old === play.clip) { clipCache.delete(oldKey); clipCache.set(oldKey, old); break; }   // jamais celui qu'on écoute
      clipCache.delete(oldKey);
      try { URL.revokeObjectURL(old.url); } catch (e) {}
    }
  }

  // Rend l'extrait avec les réglages. Mis en cache : le dictaphone et l'écoute partagent le même rendu.
  function renderClip(song) {
    const key = clipKey(song);
    const hit = lruGet(clipCache, key);
    if (hit) return Promise.resolve(hit);
    if (pendingClips.has(key)) return pendingClips.get(key);
    const p = (async () => {
      if (!OAC()) throw new Error('OfflineAudioContext indisponible');
      const buffer = await loadBuffer(song);
      let r = await renderOnce(song, buffer);
      let degraded = false;
      if (r.peak < 0.001) {
        // Rendu muet (réglages extrêmes sur un signal particulier) : on réessaie sans les effets "destructifs"
        const plain = Object.assign({}, song, { instrumental: false, filterValue: 0, radioMode: false });
        const r2 = await renderOnce(plain, buffer);
        if (r2.peak > r.peak) { r = r2; degraded = true; }
      }
      const url = URL.createObjectURL(encodeWav(r.rendered, r.useful));
      const clip = { key, url, duration: r.duration, env: r.env, peak: r.peak, degraded };
      storeClip(key, clip);
      return clip;
    })();
    pendingClips.set(key, p);
    const clear = () => pendingClips.delete(key);
    p.then(clear, clear);
    return p;
  }

  /* ------------------------------------------------------------------ */
  /*  Lecture                                                             */
  /* ------------------------------------------------------------------ */
  function finish(token, natural) {
    if (token !== playToken) return;
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    play.playing = false;
    const a = sharedEl;
    if (a) { a.onended = a.onerror = null; try { a.pause(); } catch (e) {} }
    const cb = play.onEnd; play.onEnd = null;
    if (cb && natural) { try { cb(); } catch (e) { console.warn(e); } }
  }

  function stopAudio() {
    playToken++;
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    const a = sharedEl;
    if (a) { a.onended = a.onerror = null; try { a.pause(); } catch (e) {} }
    play.playing = false; play.onEnd = null;
  }

  async function playClipElement(clip, token, onEnd) {
    const a = ensureEl();
    a.onended = a.onerror = null;
    try { a.pause(); } catch (e) {}
    a.muted = false; a.volume = 1; a.loop = false;
    a.src = clip.url;
    try { a.playbackRate = 1; } catch (e) {}
    try {
      await withTimeout(a.play() || Promise.resolve(), 9000, 'lecture trop lente');
    } catch (e) {
      if (token !== playToken) return false;
      api.lastError = (e && e.name === 'NotAllowedError') ? 'blocked' : 'error';
      if (api.lastError === 'blocked') primed = false;
      try { a.pause(); } catch (e2) {}
      return false;
    }
    if (token !== playToken) { try { a.pause(); } catch (e) {} return false; }
    play.playing = true; play.mode = 'clip'; play.clip = clip; play.total = clip.duration;
    play.startedAt = performance.now(); play.onEnd = onEnd || null; play.degraded = !!clip.degraded;
    primed = true;
    a.onended = () => finish(token, true);
    a.onerror = () => finish(token, false);
    stopTimer = setTimeout(() => finish(token, true), clip.duration * 1000 + 1500);
    return true;
  }

  // Repli : lecture directe du fichier (sans effets, mais toujours du son).
  // IMPORTANT : pas de crossOrigin ici, sinon le lecteur refuse tout fichier sans en-tête CORS.
  function tryRaw(url, song, token, onEnd) {
    return new Promise(resolve => {
      const a = ensureEl();
      const start = song.clipStart || 0, dur = song.clipDuration || 10;
      const rate = clamp(effectiveRate(song), 0.5, 2);
      let settled = false, begun = false;
      const done = v => { if (!settled) { settled = true; resolve(v); } };
      a.onended = a.onerror = null;
      try { a.pause(); } catch (e) {}
      a.muted = false; a.volume = 1; a.loop = false;
      ['preservesPitch', 'mozPreservesPitch', 'webkitPreservesPitch'].forEach(k => { if (k in a) a[k] = !song.pitch; });
      a.src = url;
      const begin = () => {
        if (begun || settled) return;
        begun = true;
        if (token !== playToken) return done(false);
        try { a.currentTime = Math.min(start, Math.max(0, (isFinite(a.duration) ? a.duration : 30) - 0.5)); } catch (e) {}
        try { a.playbackRate = rate; } catch (e) {}
        const p = a.play();
        const ok = () => {
          if (token !== playToken) { try { a.pause(); } catch (e) {} return done(false); }
          play.playing = true; play.mode = 'raw'; play.clip = null; play.degraded = false;
          play.startedAt = performance.now(); play.total = dur / rate; play.onEnd = onEnd || null;
          primed = true;
          a.onended = () => finish(token, true);
          stopTimer = setTimeout(() => finish(token, true), (dur / rate) * 1000 + 150);
          done(true);
        };
        const ko = e => {
          if (token === playToken) api.lastError = (e && e.name === 'NotAllowedError') ? 'blocked' : 'error';
          done(false);
        };
        if (p && p.then) p.then(ok, ko); else ok();
      };
      a.addEventListener('loadedmetadata', begin, { once: true });
      a.onerror = () => done(false);
      setTimeout(() => { if (!settled && !begun) begin(); }, 4000);
      try { a.load(); } catch (e) {}
      setTimeout(() => done(false), 12000);
    });
  }

  async function playWithElement(song, token, onEnd) {
    const urls = [song.previewUrl];
    let altsLoaded = false;
    for (let i = 0; i < urls.length; i++) {
      if (token !== playToken) return false;
      if (await tryRaw(urls[i], song, token, onEnd)) return true;
      if (token !== playToken || api.lastError === 'blocked') return false;
      if (!altsLoaded) {
        altsLoaded = true;
        try { (await findAlternatives(song)).forEach(u => urls.push(u)); } catch (e) {}
      }
    }
    return false;
  }

  /**
   * Joue l'extrait d'une chanson avec TOUS ses réglages.
   * @param {object} song  { previewUrl, title, artist, clipStart, clipDuration, speed, pitch, reverse,
   *                         instrumental, instrumentalVariant, instrumentalIntensity,
   *                         filterValue, radioMode, customVolume }
   * @param {function} onEnd  appelé à la fin naturelle de l'extrait
   * @returns {Promise<boolean>} true si du son a été lancé
   */
  async function playAudioClip(song, onEnd) {
    stopAudio();
    api.lastError = '';
    if (!song || !song.previewUrl) { api.lastError = 'nourl'; return false; }
    unlockAudio();                              // dans le geste utilisateur si on y est encore
    const token = ++playToken;

    let clip = null;
    try { clip = await withTimeout(renderClip(song), RENDER_TIMEOUT, 'rendu trop long'); }
    catch (e) { console.warn('Rendu audio impossible, repli sur la lecture directe :', e && e.message); }
    if (token !== playToken) return false;

    if (clip) {
      if (await playClipElement(clip, token, onEnd)) return true;
      if (token !== playToken || api.lastError === 'blocked') return false;
    }
    const ok = await playWithElement(song, token, onEnd);
    if (!ok && token === playToken && !api.lastError) api.lastError = 'error';
    return ok;
  }

  // Précharge sans jouer (appelé entre les manches) : télécharge, décode et rend l'extrait
  function preloadSong(song) {
    return song && song.previewUrl ? renderClip(song).then(() => true, () => false) : Promise.resolve(false);
  }

  // État de lecture pour le dictaphone : position, durée, niveau instantané
  function getPlayState() {
    if (!play.playing) return { playing: false, elapsed: 0, total: play.total, level: 0, mode: play.mode, degraded: play.degraded };
    let elapsed;
    if (play.mode === 'clip' && sharedEl && isFinite(sharedEl.currentTime)) elapsed = sharedEl.currentTime;
    else elapsed = (performance.now() - play.startedAt) / 1000;
    let level = 0;
    if (play.mode === 'clip' && play.clip) {
      const env = play.clip.env, i = Math.min(env.length - 1, Math.max(0, Math.floor(elapsed / 0.02)));
      let m = 0; for (let k = Math.max(0, i - 2); k <= Math.min(env.length - 1, i + 2); k++) if (env[k] > m) m = env[k];
      level = Math.min(1, m * 1.1);
    }
    return { playing: true, elapsed: Math.max(0, Math.min(elapsed, play.total)), total: play.total, level, mode: play.mode, degraded: play.degraded };
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
   * Forme d'onde de l'extrait AVEC les réglages (même rendu que celui qui sera joué).
   * @returns {Promise<{peaks:Float32Array, duration:number}>}
   */
  async function renderClipPreview(song, bins) {
    const clip = await renderClip(song);
    return { peaks: peaksFromEnv(clip.env, bins || 160), duration: clip.duration };
  }

  /**
   * Mesure le volume perçu (RMS) d'un extrait, pour comparer des chansons entre elles.
   * @returns {Promise<number|null>} valeur ~0–0.4 (musique typique), null si échec
   */
  async function analyzeLoudness(urlOrSong, clipStart, clipDuration) {
    try {
      const buffer = await loadBuffer(urlOrSong);
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
      if (!rtCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; rtCtx = new AC(); }
      const ctx = rtCtx;
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
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

  Object.assign(api, {
    playAudioClip, stopAudio, preloadSong, playBeep, unlockAudio, analyzeLoudness,
    loadBuffer, renderClipPreview, getPeaks, getPlayState, findAlternatives, renderClip
  });
  window.AudioEngine = api;
  // Alias historiques
  window.playAudioClip = playAudioClip;
  window.stopAudio = stopAudio;
  window.playLyricsRevealBeep = () => playBeep(450);
})();
