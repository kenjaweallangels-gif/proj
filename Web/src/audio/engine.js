// Звуковой движок: AudioContext, шины (music/amb/sfx/vo/ui), компрессор, реверберации (сгенерированные импульсы),
// генераторы шума и базовые «кирпичики» синтеза. Никаких внешних файлов — всё синтезируется.
import { clamp } from '../core/util.js';

const BUS_NAMES = ['music', 'amb', 'sfx', 'vo', 'ui'];

/** Импульсная характеристика комнаты: затухающий шум, темнеющий со временем. */
function makeIR(ctx, seconds, decay, { pre = 0.01, dark = 0.5 } = {}) {
  const sr = ctx.sampleRate, n = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0, seed = 1337 + ch * 7919;
    const preN = Math.floor(pre * sr * (1 + ch * 0.15));
    for (let i = preN; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const w = (seed / 4294967296) * 2 - 1;
      const t = (i - preN) / sr;
      const a = clamp(0.15 + dark * Math.min(1, t / seconds) * 0.8, 0.05, 0.97); // чем позже, тем темнее
      lp += (w - lp) * (1 - a);
      d[i] = lp * Math.exp(-t * decay) * 2.2;
    }
  }
  return buf;
}

export function createEngine(game) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC({ latencyHint: 'interactive' });
  const vol = game.settings.volume || { master: 0.9, music: 0.8, sfx: 1, amb: 1, vo: 1 };

  // ---- Мастер-цепочка: шины → pre → LP(пауза) → компрессор → выход ----
  const out = ctx.createGain(); out.gain.value = vol.master;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 22; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.28;
  const masterLP = ctx.createBiquadFilter(); masterLP.type = 'lowpass'; masterLP.frequency.value = 20000; masterLP.Q.value = 0.4;
  const pre = ctx.createGain(); pre.gain.value = 0.9;
  pre.connect(masterLP); masterLP.connect(comp); comp.connect(out); out.connect(ctx.destination);
  // Анализатор уровня (для автотестов и отладки): audio.level() → {rms, peak} в dBFS
  const analyser = ctx.createAnalyser(); analyser.fftSize = 2048; out.connect(analyser);
  const tbuf = new Float32Array(analyser.fftSize);
  function level() {
    analyser.getFloatTimeDomainData(tbuf);
    let sum = 0, peak = 0;
    for (let i = 0; i < tbuf.length; i++) { const v = tbuf[i]; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
    const db = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -120);
    return { rms: db(Math.sqrt(sum / tbuf.length)), peak: db(peak) };
  }

  // Фон (amb) идёт через узел приглушения: под голосами он садится (дакинг), как и музыка (duck).
  const ambDuck = ctx.createGain(); ambDuck.gain.value = 1; ambDuck.connect(pre);
  const bus = {};
  for (const n of BUS_NAMES) {
    const g = ctx.createGain();
    g.gain.value = n === 'ui' ? 0.6 : (vol[n] ?? 1);
    g.connect(n === 'amb' ? ambDuck : pre);
    bus[n] = g;
  }
  // Музыка идёт через узел приглушения (дакинг под диалоги).
  const duck = ctx.createGain(); duck.gain.value = 1;
  duck.connect(bus.music);

  // ---- Реверберации: общий вход revIn → три свёртки с управляемым влажным уровнем ----
  const revIn = ctx.createGain(); revIn.gain.value = 1;
  const rev = {};
  for (const [name, [sec, decay, dark]] of Object.entries({ desert: [0.5, 9, 0.7], sietch: [1.6, 3.2, 0.6], cistern: [2.8, 2.0, 0.55], hall: [5.0, 1.15, 0.7] })) {
    const conv = ctx.createConvolver();
    conv.buffer = makeIR(ctx, sec, decay, { dark });
    const g = ctx.createGain(); g.gain.value = name === 'desert' ? 0.12 : 0;
    revIn.connect(conv); conv.connect(g); g.connect(pre);
    rev[name] = g;
  }
  const revState = { name: 'desert' };
  function setReverb(name) {
    if (revState.name === name && revState.set) return;
    revState.name = name; revState.set = true;
    const t = ctx.currentTime;
    const lv = { desert: 0.12, sietch: 0.5, cistern: 0.75, hall: 0.95 };
    for (const k of Object.keys(rev)) rev[k].gain.setTargetAtTime(k === name ? lv[k] : 0, t, 0.6);
  }

  // Плавное смешение реверберации интерьера и улицы: weights = {desert: 0..1, sietch: 0..1, ...} (веса масштабируют уровни lv).
  const REV_LV = { desert: 0.12, sietch: 0.5, cistern: 0.75, hall: 0.95 };
  let revKey = '';
  function setReverbMix(weights) {
    const key = Object.keys(REV_LV).map((k) => (weights[k] || 0).toFixed(2)).join('|');
    if (key === revKey) return;
    revKey = key; revState.set = true; revState.name = 'mix';
    const t = ctx.currentTime;
    for (const k of Object.keys(rev)) rev[k].gain.setTargetAtTime(REV_LV[k] * Math.min(1, weights[k] || 0), t, 0.5);
  }

  // ---- Буферы шума ----
  const noiseBufs = {};
  function noiseBuf(kind = 'white') {
    if (noiseBufs[kind]) return noiseBufs[kind];
    const sr = ctx.sampleRate, n = sr * 4;
    const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    let seed = kind === 'brown' ? 99 : kind === 'pink' ? 4242 : 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 4294967296) * 2 - 1; };
    if (kind === 'white') for (let i = 0; i < n; i++) d[i] = rnd();
    else if (kind === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < n; i++) {
        const w = rnd();
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      }
    } else { // brown
      let last = 0;
      for (let i = 0; i < n; i++) { last = (last + 0.02 * rnd()) / 1.02; d[i] = last * 3.5; }
    }
    // шов зацикливания: короткое перекрёстное затухание
    const f = 2048;
    for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
    return (noiseBufs[kind] = buf);
  }
  /** Зацикленный источник шума (стартует сразу, со случайного смещения). */
  function loopNoise(kind = 'white') {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf(kind); s.loop = true; s.loopEnd = s.buffer.duration - 2048 / ctx.sampleRate;
    s.start(0, Math.random() * 3);
    return s;
  }

  // ---- Утилиты ----
  const T = () => ctx.currentTime;
  function filter(type, f, q = 0.7, gain) {
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q;
    if (gain !== undefined) b.gain.value = gain;
    return b;
  }
  function gain(v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; }
  /** Отправка сигнала узла в реверберацию (доля amt). */
  function send(node, amt = 0.3) {
    if (amt <= 0) return;
    const g = gain(amt); node.connect(g); g.connect(revIn);
  }
  /** Стерео-панорама + (опц.) 3D-позиция. Возвращает входной узел. */
  function panner(dest, pos, { ref = 4, rolloff = 1.1, max = 400 } = {}) {
    if (pos && !(Number.isFinite(pos.x) && Number.isFinite(pos.z))) pos = null;   // NaN-позиция → без 3D (иначе AudioParam бросает)
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
      p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = max;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y ?? 0; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y ?? 0, pos.z);
      p.connect(dest);
      return p;
    }
    return dest;
  }
  function stereoPan(dest, pan) {
    if (!ctx.createStereoPanner) return dest;
    const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(dest);
    return p;
  }

  /** Всплеск шума через фильтр: {type,f0,f1,q,dur,attack,gain,kind,out,when,send} */
  function burst(o) {
    const t = Math.max(o.when ?? T(), T());
    const dur = o.dur ?? 0.15, atk = Math.min(o.attack ?? 0.005, dur * 0.5);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(o.kind || 'white'); src.loop = true;
    const f = filter(o.type || 'bandpass', o.f0 ?? 1000, o.q ?? 1);
    if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.3, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.out || bus.sfx);
    if (o.send) send(g, o.send);
    src.start(t, Math.random() * 3, dur + 0.05);
    return g;
  }
  /** Тональный «писк»/удар: {freq,freq1,dur,type,gain,attack,out,when,send} */
  function blip(o) {
    const t = Math.max(o.when ?? T(), T());
    const dur = o.dur ?? 0.2, atk = Math.min(o.attack ?? 0.004, dur * 0.5);
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq ?? 440, t);
    if (o.freq1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(5, o.freq1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.3, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.out || bus.sfx);
    if (o.send) send(g, o.send);
    osc.start(t); osc.stop(t + dur + 0.05);
    return g;
  }
  /** Плавное изменение параметра. */
  function ramp(param, v, tc = 0.3) { param.setTargetAtTime(v, T(), tc); }

  // ---- Слушатель (камера) ----
  const fwd = new game.THREE.Vector3(), up = new game.THREE.Vector3(), camPos = new game.THREE.Vector3();
  function updateListener() {
    const l = ctx.listener, cam = game.camera;
    cam.getWorldPosition(camPos);
    fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (!Number.isFinite(camPos.x + camPos.y + camPos.z + fwd.x + fwd.y + fwd.z + up.x + up.y + up.z)) return;
    if (l.positionX) {
      const t = T();
      l.positionX.setValueAtTime(camPos.x, t); l.positionY.setValueAtTime(camPos.y, t); l.positionZ.setValueAtTime(camPos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t); l.forwardY.setValueAtTime(fwd.y, t); l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(up.x, t); l.upY.setValueAtTime(up.y, t); l.upZ.setValueAtTime(up.z, t);
    } else {
      l.setPosition(camPos.x, camPos.y, camPos.z); l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  function setVolume(name, v) {
    v = clamp(v, 0, 1);
    game.settings.volume[name] = v;
    if (name === 'master') ramp(out.gain, v, 0.05);
    else if (bus[name]) ramp(bus[name].gain, v, 0.05);
  }

  return {
    ctx, out, comp, masterLP, level, bus, duck, ambDuck, rev, revIn, setReverb, setReverbMix, revState,
    noiseBuf, loopNoise, filter, gain, send, panner, stereoPan, burst, blip, ramp, T, updateListener, setVolume,
    resume() { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); },
    get running() { return ctx.state === 'running'; },
  };
}
