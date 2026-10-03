// Голоса персонажей на вымышленном языке Ракиса.
// Режимы (game.settings.voiceMode): 'auto' (арабский TTS браузера для nativeScript, если есть голос 'ar*', иначе синтезатор;
// жрица, толпа и лай — всегда синтезатор), 'tts' (арабский TTS, при отсутствии голоса — синтезатор), 'synth', 'off'.
// Синтезатор: глоттальный источник (периодическая волна) → 3 параллельные форманты + фиксированная 4-я (+ носовая) ← дорожки из speechplan.js;
// фрикативы/взрывные — отдельный шумовой тракт. Позиционирование — PannerNode в точке говорящего. Русский/английский текст не озвучивается никогда.
import { planUtterance, FR, voiceOf, VOICES } from './speechplan.js';

const waveCache = new WeakMap();
function glottal(ctx, tilt) {
  let m = waveCache.get(ctx); if (!m) { m = new Map(); waveCache.set(ctx, m); }
  const key = Math.round(tilt * 10);
  if (m.has(key)) return m.get(key);
  const n = 48, real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
  const ex = 0.85 + tilt * 1.1;                       // наклон спектра: резкий голос → мягкий
  for (let k = 1; k <= n; k++) { imag[k] = 1 / Math.pow(k, ex); real[k] = (k % 2 ? 1 : -0.4) * 0.15 / Math.pow(k, ex + 0.2); }
  const w = ctx.createPeriodicWave(real, imag);
  m.set(key, w);
  return w;
}
const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0); let s = 12345;
    for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
    noiseCache.set(ctx, b);
  }
  return b;
}

// Калибровка уровней (замер renderOffline: гласные ≈ −20 дБFS RMS).
const K_VOICE = 1.1, K_ASP = 2.5, K_FRIC = 0.016;

/** Строит граф речи и расписывает дорожки. out — узел назначения. Возвращает {stop(), end, nodes}. */
export function playPlan(ctx, out, plan, { when, offset = 0, gain = 1 } = {}) {
  const V = plan.voice;
  const t0 = (when ?? ctx.currentTime) + 0.03;
  const skip = Math.max(0, Math.floor(offset * FR));
  const part = (a) => (skip ? a.subarray(Math.min(skip, a.length - 2)) : a);
  const tr = {}; for (const k of Object.keys(plan.tracks)) tr[k] = part(plan.tracks[k]);
  const len = tr.f0.length, dur = (len - 1) / FR;
  const curve = (param, arr, mul = 1) => {
    const c = mul === 1 ? arr : arr.map((v) => v * mul);
    param.setValueCurveAtTime(c, t0, dur);
  };

  const mix = ctx.createGain(); mix.gain.value = 0; mix.gain.setValueAtTime(0, t0); mix.gain.linearRampToValueAtTime((V.amp ?? 1) * gain, t0 + 0.02);
  // источник
  const osc = ctx.createOscillator(); osc.setPeriodicWave(glottal(ctx, V.tilt ?? 0.5));
  curve(osc.frequency, tr.f0);
  const voicedG = ctx.createGain(); voicedG.gain.value = 0; curve(voicedG.gain, tr.av, K_VOICE);
  const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer(ctx); noise.loop = true;
  const ahG = ctx.createGain(); ahG.gain.value = 0; curve(ahG.gain, tr.ah, K_ASP);
  const excite = ctx.createGain();
  osc.connect(voicedG); voicedG.connect(excite); noise.connect(ahG); ahG.connect(excite);
  // форманты
  const sum = ctx.createGain(), upper = ctx.createGain(); upper.gain.value = 1; curve(upper.gain, tr.fg);
  const mk = (q, arr, dest, g = 1) => {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q;
    if (arr) curve(f.frequency, arr); else f.frequency.value = g;
    excite.connect(f); f.connect(dest); return f;
  };
  const f1 = mk(7, tr.f1, sum);
  const f2 = mk(9, tr.f2, upper), f3 = mk(11, tr.f3, upper);
  const f4 = ctx.createBiquadFilter(); f4.type = 'bandpass'; f4.Q.value = 14; f4.frequency.value = 3600 * (V.fs || 1); excite.connect(f4);
  const g4 = ctx.createGain(); g4.gain.value = 0.5; f4.connect(g4); g4.connect(upper);
  upper.connect(sum);
  if (V.nasal > 0.05) { // носовая резонанс-полоса ~1 кГц
    const nz = ctx.createBiquadFilter(); nz.type = 'bandpass'; nz.frequency.value = 1050; nz.Q.value = 4;
    const ng = ctx.createGain(); ng.gain.value = V.nasal * 0.9; excite.connect(nz); nz.connect(ng); ng.connect(sum);
  }
  // фрикативы / взрывы
  const fric = ctx.createBiquadFilter(); fric.type = 'bandpass'; fric.Q.value = 1.2; curve(fric.frequency, tr.ff);
  const afG = ctx.createGain(); afG.gain.value = 0; curve(afG.gain, tr.af, K_FRIC);
  noise.connect(fric); fric.connect(afG);
  // тембр и выход
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = V.murmur ? 2600 : 6500; tone.Q.value = 0.5;
  sum.connect(tone); afG.connect(tone); tone.connect(mix); mix.connect(out);
  osc.start(t0); noise.start(t0, Math.random());
  const endT = t0 + dur + 0.05;
  osc.stop(endT); noise.stop(endT);
  let stopped = false;
  return {
    end: endT,
    stop(fade = 0.06) {
      if (stopped) return; stopped = true;
      const t = ctx.currentTime;
      try { mix.gain.cancelScheduledValues(t); mix.gain.setValueAtTime(mix.gain.value, t); mix.gain.linearRampToValueAtTime(0, t + fade); osc.stop(t + fade + 0.02); noise.stop(t + fade + 0.02); } catch { /* уже остановлен */ }
    },
  };
}

/** Офлайн-рендер реплики (проверка графа): → {rms, peak, speechRms, seconds, buffer}. */
export async function renderOffline(o = {}) {
  const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!OAC) return null;
  const sr = o.sampleRate || 22050;
  const plan = planUtterance(o);
  const secs = plan.dur + 0.3;
  const ctx = new OAC(1, Math.ceil(sr * secs), sr);
  playPlan(ctx, ctx.destination, plan, { when: 0 });
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let sum = 0, peak = 0, n = 0, sp = 0, sn = 0;
  const lim = Math.floor(plan.speakEnd * sr);
  for (let i = 0; i < d.length; i++) {
    const v = d[i]; sum += v * v; n++; if (Math.abs(v) > peak) peak = Math.abs(v);
    if (i < lim) { sp += v * v; sn++; }
  }
  const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
  return { rms: db(Math.sqrt(sum / n)), peak: db(peak), speechRms: db(Math.sqrt(sp / Math.max(1, sn))), seconds: secs, buffer: buf, plan };
}

// ------------------------------------------------------------------ Интеграция с игрой
const SYNTH_ONLY = new Set(['Priestess', 'Crowd', 'Child']);

export function createVoice(game, eng) {
  const { ctx } = eng;
  const S = game.settings;
  let cur = null;                // {id, speaker, handles[], plan, plans[], startedAt, duration, pos, mode}
  let ttsVoices = [];
  const tts = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  if (tts) {
    const load = () => { try { ttsVoices = speechSynthesis.getVoices() || []; } catch { ttsVoices = []; } };
    load();
    try { speechSynthesis.addEventListener?.('voiceschanged', load); } catch { /* нет */ }
  }
  const arVoice = () => ttsVoices.find((v) => /^ar([-_]|$)/i.test(v.lang || '')) || null;

  function mode() {
    if (S.autotest && !S.voiceForce) return 'off';
    if (S.voiceMode) return S.voiceMode;
    return S.voice === false ? 'off' : 'auto';
  }

  function posOf(speaker, hint) {
    if (hint) return hint;
    const g = game;
    const sp = (m) => { try { return m?.speakerPos?.(speaker) || null; } catch { return null; } };
    if (speaker === 'Rider' || speaker === 'Rider1' || speaker === 'Rider2') return sp(g.worm) || g.worm?.riderPos || null;
    return g.space === 'sietch' ? (sp(g.sietch) || sp(g.companions)) : (sp(g.companions) || sp(g.sietch));
  }

  function stop(fade = 0.08) {
    if (!cur) return;
    for (const h of cur.handles) h.stop(fade);
    if (cur.tts && tts) { try { speechSynthesis.cancel(); } catch { /* нет */ } }
    cur = null;
  }

  function startSynth(o, offset = 0, pos = null) {
    const speaker = o.speaker || 'Kair';
    const base = VOICES[speaker] ? speaker : 'Kair';
    const layers = base === 'Crowd' ? [{ seed: 1, voice: { f0: 120 } }, { seed: 7, voice: { f0: 170, rate: 1.15 } }] : [{ seed: 0, voice: o.voice }];
    const dest = ctx.createGain(); dest.gain.value = 1;
    let node = dest;
    if (pos) {
      const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
      p.refDistance = 2.5; p.rolloffFactor = 1.4; p.maxDistance = 120;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = (pos.y ?? 0) + 1.6; p.positionZ.value = pos.z; } else p.setPosition(pos.x, (pos.y ?? 0) + 1.6, pos.z);
      dest.connect(p); p.connect(eng.bus.vo); node = p;
    } else dest.connect(eng.bus.vo);
    eng.send(dest, base === 'Priestess' ? 0.9 : 0.22);
    const handles = [], plans = [];
    for (const L of layers) {
      const plan = planUtterance({ native: o.native, text: o.text, speaker: base, duration: o.duration, seed: L.seed, voice: L.voice });
      plans.push(plan);
      handles.push(playPlan(ctx, dest, plan, { offset, gain: o.gain ?? 1 }));
    }
    handles.push({ stop(f = 0.08) { setTimeout(() => { try { dest.disconnect(); node.disconnect(); } catch { /* нет */ } }, (f + 0.2) * 1000); } });
    return { handles, plan: plans[0], plans };
  }

  function startTTS(o, offset = 0) {
    const v = arVoice();
    if (!tts || !v || !o.nativeScript) return null;
    try {
      const u = new SpeechSynthesisUtterance(o.nativeScript);
      u.voice = v; u.lang = v.lang;
      const vo = voiceOf(o.speaker);
      u.pitch = Math.max(0.2, Math.min(2, Math.pow(vo.f0 / 140, 0.75)));
      const est = o.nativeScript.length / 12;
      u.rate = Math.max(0.6, Math.min(1.7, est / Math.max(0.8, (o.duration || est) * 0.92)));
      u.volume = Math.max(0, Math.min(1, (S.volume?.vo ?? 1) * (S.volume?.master ?? 1)));
      u.onerror = () => {};
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      return { handles: [], tts: true };
    } catch { return null; }
  }

  function speak(o) {
    if (!o || !eng.running) return null;
    const m = mode();
    if (m === 'off') return null;
    if (o.exclusive !== false) stop(0.05);
    const pos = posOf(o.speaker, o.pos);
    const wantTTS = (m === 'tts' || (m === 'auto' && !SYNTH_ONLY.has(o.speaker))) && !!o.nativeScript;
    let r = wantTTS ? startTTS(o) : null;
    if (!r) r = startSynth(o, 0, pos);
    cur = { id: o.id, speaker: o.speaker, o, pos, startedAt: game.time, duration: o.duration || 3, ...r };
    return cur;
  }

  // ---- События ----
  game.bus.on('subtitle', (e) => {
    if (!e || e.kind === 'lore') return;
    if (e.kind === 'bark') {
      if (cur && game.dialogue?.isStoryLinePlaying) return;
      speak({ id: e.id, speaker: e.archetype === 'Child' ? 'Child' : 'Crowd', native: e.native, text: e.text, duration: e.duration, pos: e.pos, gain: 0.6, exclusive: false });
      return;
    }
    speak({ id: e.id, speaker: e.speaker, native: e.native, nativeScript: e.nativeScript, text: e.text, duration: e.duration });
  });
  game.bus.on('dialogue:stop', () => stop());
  game.bus.on('chain:end', () => { /* реплика доигрывает до конца сама */ });
  let resume = null;
  const hold = (on) => {
    if (on) {
      if (cur && !cur.tts) { resume = { o: cur.o, at: game.time - cur.startedAt, pos: cur.pos }; stop(0.05); }
      else if (cur?.tts && tts) { try { speechSynthesis.pause(); } catch { /* нет */ } }
    } else {
      if (resume && resume.at < (resume.o.duration || 3) - 0.2) { const r = resume; resume = null; const s = startSynth(r.o, r.at, r.pos); cur = { id: r.o.id, speaker: r.o.speaker, o: r.o, pos: r.pos, startedAt: game.time - r.at, duration: r.o.duration || 3, ...s }; }
      resume = null;
      if (tts) { try { speechSynthesis.resume(); } catch { /* нет */ } }
    }
  };
  game.bus.on('pause', ({ paused } = {}) => hold(!!paused));
  game.bus.on('photo', ({ active } = {}) => hold(!!active));

  return {
    speak, stop, mode, renderOffline,
    update() { if (cur && game.time - cur.startedAt > cur.duration + 1.2) { if (cur.tts && tts && !speechSynthesis.speaking) cur = null; else if (!cur.tts) cur = null; } },
    get hasArabic() { return !!arVoice(); },
    get active() { return !!cur; },
    get speaker() { return cur?.speaker ?? null; },
    get current() { return cur; },
  };
}
