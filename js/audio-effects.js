// js/audio-effects.js

let audioCtx = null;
let cachedBuffer = null;
let cachedBufferUrl = null;
let activeWebAudioSource = null;
let activeAudioElement = null;
let stopTimer = null;
let lastRevealedWordCount = 0;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

async function ensureAudioContextRunning(ctx) {
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch (e) { console.log("Impossible de relancer l'audio", e); }
  }
}

// Débloque l'audio sur les navigateurs mobiles
function unlockAudioOnce() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const buffer = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(0);
  } catch (e) { console.log('Déblocage audio impossible', e); }
}
document.addEventListener('touchstart', unlockAudioOnce, { once: true });
document.addEventListener('click', unlockAudioOnce, { once: true });

function bypassCorsUrl(url) {
  if (!url) return '';
  if (url.includes('itunes.apple.com') || url.includes('deezer.com') || url.includes('audio-ssl')) {
    return 'https://corsproxy.io/?url=' + encodeURIComponent(url);
  }
  return url;
}

async function loadBufferForSong(url) {
  const proxiedUrl = bypassCorsUrl(url);
  if (cachedBufferUrl === proxiedUrl && cachedBuffer) return cachedBuffer;
  const ctx = getAudioContext();
  await ensureAudioContextRunning(ctx);
  const res = await fetch(proxiedUrl);
  const arrayBuffer = await res.arrayBuffer();
  const buffer = await ctx.decodeAudioData(arrayBuffer);
  cachedBuffer = buffer;
  cachedBufferUrl = proxiedUrl;
  return buffer;
}

function reverseBuffer(ctx, buffer) {
  const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[src.length - 1 - i];
    }
  }
  return out;
}

function phaseCancelInstrumental(ctx, buffer) {
  if (buffer.numberOfChannels < 2) return buffer;
  const out = ctx.createBuffer(2, buffer.length, buffer.sampleRate);
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const outL = out.getChannelData(0);
  const outR = out.getChannelData(1);
  for (let i = 0; i < left.length; i++) {
    const diff = (left[i] - right[i]) / 2;
    outL[i] = diff;
    outR[i] = diff;
  }
  return out;
}

function applyVocalNotch(ctx, node, intensity) {
  const pct = (intensity !== undefined ? intensity : 40) / 100; // Intensité de base plus basse pour précision
  const gain = -12 - pct * 20; // Plus doux pour éviter les saturations
  const bands = [
    { freq: 320,  q: 0.7 },
    { freq: 1000, q: 0.7 },
    { freq: 2400, q: 0.7 },
    { freq: 3800, q: 0.7 }
  ];
  let current = node;
  bands.forEach((b) => {
    const f = ctx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = b.freq;
    f.Q.value = b.q;
    f.gain.value = gain;
    current.connect(f);
    current = f;
  });
  return current;
}

function buildAudioGraph(ctx, source, settings, customVolume) {
  let node = source;
  let gainBoost = customVolume !== undefined ? customVolume : 1.0;

  source.playbackRate.value = settings.speed || 1;
  source.detune.value = (settings.pitch || 0) * 100;

  const variant = settings.instrumentalVariant || 1;
  if (settings.instrumental && (variant === 2 || variant === 3)) {
    node = applyVocalNotch(ctx, node, settings.instrumentalIntensity);
    gainBoost *= 1.2;
  }

  const fv = settings.filterValue || 0;
  if (fv > 15) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 100 + (fv / 100) * 4000;
    node.connect(hp);
    node = hp;
    gainBoost *= 1.3;
  } else if (fv < -15) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 8000 + (fv / 100) * 7800;
    node.connect(lp);
    node = lp;
    gainBoost *= 1.3;
  }

  if (settings.radioMode) {
    const hp2 = ctx.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = 400;
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 3200;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.5);
    }
    shaper.curve = curve;
    node.connect(hp2);
    hp2.connect(lp2);
    lp2.connect(shaper);
    node = shaper;
    gainBoost *= 1.6;
  }

  const gainNode = ctx.createGain();
  gainNode.gain.value = gainBoost;
  node.connect(gainNode);
  node = gainNode;

  return node;
}

function stopAudio() {
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  if (activeWebAudioSource) {
    try { activeWebAudioSource.stop(); } catch(e){}
    activeWebAudioSource = null;
  }
  if (activeAudioElement) {
    try { activeAudioElement.pause(); } catch(e){}
    activeAudioElement = null;
  }
}

async function playAudioClip(song, onStop) {
  stopAudio();
  if (!song || !song.previewUrl) return;

  const clipStart = song.clipStart || 0;
  const clipDuration = song.clipDuration || 10;
  const customVolume = song.customVolume !== undefined ? (song.customVolume / 100) : 1.0;

  const wantsReverse = !!song.reverse;
  const isRealInst = song.instrumental && song.instrumentalVariant === 4;
  const wantsInst = !!song.instrumental && !isRealInst;
  const wantsPitch = song.pitch !== undefined && song.pitch !== 0;
  const wantsFilter = song.filterValue !== undefined && Math.abs(song.filterValue) > 15;
  const wantsRadio = !!song.radioMode;
  const wantsSpeed = song.speed !== undefined && song.speed !== 1;

  const hasAnyEffect = wantsReverse || wantsInst || wantsPitch || wantsFilter || wantsRadio || wantsSpeed || isRealInst;

  if (!hasAnyEffect) {
    try {
      const audio = new Audio(song.previewUrl);
      activeAudioElement = audio;
      audio.currentTime = clipStart;
      await audio.play();
      stopTimer = setTimeout(() => {
        if (activeAudioElement === audio) {
          audio.pause();
          if (onStop) onStop();
        }
      }, clipDuration * 1000);
    } catch (e) {
      console.log("Lecture audio native impossible", e);
    }
    return;
  }

  try {
    const ctx = getAudioContext();
    await ensureAudioContextRunning(ctx);

    let buffer = await loadBufferForSong(song.previewUrl);
    if (wantsInst && (song.instrumentalVariant === 1 || song.instrumentalVariant === 3)) {
      buffer = phaseCancelInstrumental(ctx, buffer);
    }
    if (wantsReverse) {
      buffer = reverseBuffer(ctx, buffer);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const outNode = buildAudioGraph(ctx, source, song, customVolume);
    outNode.connect(ctx.destination);

    const playFrom = wantsReverse ? Math.max(0, buffer.duration - clipStart - clipDuration) : clipStart;
    source.start(0, playFrom, clipDuration);
    activeWebAudioSource = source;

    stopTimer = setTimeout(() => {
      if (activeWebAudioSource === source) {
        try { source.stop(); } catch(e){}
        activeWebAudioSource = null;
        if (onStop) onStop();
      }
    }, clipDuration * 1000);

  } catch (e) {
    console.warn("Échec WebAudio avancé, repli sur l'audio simple", e);
    try {
      const audio = new Audio(song.previewUrl);
      activeAudioElement = audio;
      audio.currentTime = clipStart;
      await audio.play();
      stopTimer = setTimeout(() => {
        if (activeAudioElement === audio) {
          audio.pause();
          if (onStop) onStop();
        }
      }, clipDuration * 1000);
    } catch (err) {
      console.log("Le repli a également échoué", err);
    }
  }
}

// Son synthé de dactylo / décompte pour l'apparition des paroles
function playLyricsRevealBeep() {
  try {
    const ctx = getAudioContext();
    ensureAudioContextRunning(ctx);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(450, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.08);
    
    gain.gain.setValueAtTime(0.03, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch (e) {}
}