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
  // Финальный лимитер (защита от клиппинга суммы всех шин): быстрая атака, жёсткое отношение.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.12;
  pre.connect(masterLP); masterLP.connect(comp); comp.connect(limiter); limiter.connect(out); out.connect(ctx.destination);
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
  // SFX: шина → мягкий лимитер шины → дакинг под голоса (sfxDuck) → pre. Остальные шины не затронуты.
  const sfxLim = ctx.createDynamicsCompressor();
  sfxLim.threshold.value = -12; sfxLim.knee.value = 10; sfxLim.ratio.value = 8; sfxLim.attack.value = 0.003; sfxLim.release.value = 0.2;
  const sfxDuck = ctx.createGain(); sfxDuck.gain.value = 1;
  bus.sfx.disconnect(); bus.sfx.connect(sfxLim); sfxLim.connect(sfxDuck); sfxDuck.connect(pre);
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
  /** Текущее время контекста; в приостановленном контексте — 0, но всегда конечное число. */
  const T = () => { const t = ctx.currentTime; return Number.isFinite(t) ? t : 0; };
  /** Конечное число или запасное значение (защита AudioParam от NaN/Infinity). */
  const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
  /** Безопасная установка значения параметра (setTargetAtTime), NaN игнорируется. */
  function setT(param, v, tc = 0.1, when) {
    if (!param || !Number.isFinite(v)) return;
    param.setTargetAtTime(v, Number.isFinite(when) ? when : T(), Math.max(0.001, fin(tc, 0.1)));
  }
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
      const py = Number.isFinite(pos.y) ? pos.y : 0;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = py; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, py, pos.z);
      p.connect(dest);
      return p;
    }
    return dest;
  }
  function stereoPan(dest, pan) {
    if (!ctx.createStereoPanner) return dest;
    const p = ctx.createStereoPanner(); p.pan.value = clamp(fin(pan, 0), -1, 1); p.connect(dest);
    return p;
  }

  /** Всплеск шума через фильтр: {type,f0,f1,q,dur,attack,gain,kind,out,when,send} */
  function burst(o) {
    const t = Math.max(fin(o.when, T()), T());
    const dur = o.dur ?? 0.15, atk = Math.min(o.attack ?? 0.005, dur * 0.5);
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(o.kind || 'white'); src.loop = true;
    const f = filter(o.type || 'bandpass', o.f0 ?? 1000, o.q ?? 1);
    if (Number.isFinite(o.f1)) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(fin(o.gain, 0.3), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.out || bus.sfx);
    if (o.send) send(g, o.send);
    src.start(t, Math.random() * 3, dur + 0.05);
    return g;
  }
  /** Тональный «писк»/удар: {freq,freq1,dur,type,gain,attack,out,when,send} */
  function blip(o) {
    const t = Math.max(fin(o.when, T()), T());
    const dur = o.dur ?? 0.2, atk = Math.min(o.attack ?? 0.004, dur * 0.5);
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(fin(o.freq, 440), t);
    if (Number.isFinite(o.freq1)) osc.frequency.exponentialRampToValueAtTime(Math.max(5, o.freq1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(fin(o.gain, 0.3), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.out || bus.sfx);
    if (o.send) send(g, o.send);
    osc.start(t); osc.stop(t + dur + 0.05);
    return g;
  }
  /** Плавное изменение параметра. */
  function ramp(param, v, tc = 0.3) { setT(param, v, tc); }

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


  // ================= Банк сэмплов и гранулярные/текстурные петли (Ред. 3) =================
  const buffers = {}, groups = {}, lastPick = {};
  let samplesState = 'idle';
  const b64bytes = (uri) => {
    const bin = atob(uri.slice(uri.indexOf(',') + 1)), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  };
  /** Декодирует словарь {имя: data-URI}. Имена base_N образуют группу base. Не бросает: ошибки — в консоль-предупреждение. */
  async function loadSamples(dict) {
    samplesState = 'loading';
    await Promise.all(Object.keys(dict).map(async (n) => {
      try { buffers[n] = await ctx.decodeAudioData(b64bytes(dict[n])); } catch (e) { console.warn('[audio] сэмпл не декодирован:', n, e?.message || e); }
    }));
    for (const n of Object.keys(buffers)) { const g = n.replace(/_\d+$/, ''); (groups[g] || (groups[g] = [])).push(n); }
    for (const g of Object.keys(groups)) groups[g].sort();
    samplesState = 'ready';
  }
  /** Имя или группа → имя буфера (из группы — случайный, не равный предыдущему). */
  function pick(name) {
    if (buffers[name]) return name;
    const g = groups[name];
    if (!g || !g.length) return null;
    if (g.length === 1) return g[0];
    let i = (Math.random() * g.length) | 0;
    if (i === lastPick[name]) i = (i + 1 + ((Math.random() * (g.length - 1)) | 0)) % g.length;
    lastPick[name] = i;
    return g[i];
  }
  const _cp = new game.THREE.Vector3(), _cr = new game.THREE.Vector3();
  /** Расстояние от камеры до точки (м) и боковое смещение −1..1 (для далёких событий без PannerNode). */
  function relPos(pos) {
    if (!pos || !Number.isFinite(pos.x + pos.z)) return { d: 0, pan: 0 };
    game.camera.getWorldPosition(_cp);
    const dx = pos.x - _cp.x, dz = pos.z - _cp.z, d = Math.hypot(dx, dz);
    _cr.set(1, 0, 0).applyQuaternion(game.camera.quaternion);
    const pan = d > 1e-3 ? clamp((dx * _cr.x + dz * _cr.z) / d, -1, 1) : 0;
    return { d: Number.isFinite(d) ? d : 0, pan: Number.isFinite(pan) ? pan : 0 };
  }
  /** Частота среза «поглощения воздухом» по расстоянию. */
  const airCut = (d) => clamp(15000 / (1 + d / 90), 500, 15000);
  function setPos(p, pos, tc = 0.1) {
    if (!p || !pos || !Number.isFinite(pos.x + pos.z)) return;
    const y = Number.isFinite(pos.y) ? pos.y : 0;
    if (p.positionX) { setT(p.positionX, pos.x, tc); setT(p.positionY, y, tc); setT(p.positionZ, pos.z, tc); } else p.setPosition(pos.x, y, pos.z);
  }
  /** Одиночный сэмпл: {out,gain,rate,rateVar,when,offset,pan,pos,pannerOpts,lp,hp,send,dur,fadeIn,fadeOut,air}. Возвращает {src,g,end} или null. */
  function playSample(name, o = {}) {
    const key = pick(name); const buf = key && buffers[key];
    if (!buf) return null;
    const t = Math.max(fin(o.when, T()), T());
    const rate = clamp(fin(o.rate, 1) * (1 + (Math.random() * 2 - 1) * fin(o.rateVar, 0)), 0.25, 4);
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    let node = src;
    const chain = (n) => { node.connect(n); node = n; };
    if (o.hp) chain(filter('highpass', o.hp, 0.7));
    let lpf = fin(o.lp, 0);
    if (o.pos && o.air !== false) { const { d } = relPos(o.pos); lpf = lpf ? Math.min(lpf, airCut(d)) : airCut(d); }
    if (lpf) chain(filter('lowpass', clamp(lpf, 200, 20000), 0.6));
    const g = ctx.createGain(); g.gain.value = Math.max(0, fin(o.gain, 1));
    chain(g);
    const len = buf.duration / rate;
    let end = t + len;
    if (Number.isFinite(o.dur) && o.dur > 0) {
      const fi = fin(o.fadeIn, 0.05), fo = fin(o.fadeOut, 0.3), v = g.gain.value;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + fi);
      g.gain.setValueAtTime(v, Math.max(t + fi, t + o.dur - fo)); g.gain.linearRampToValueAtTime(0, t + o.dur);
      end = Math.min(end, t + o.dur + 0.02);
    }
    const dest = o.out || bus.sfx;
    let tail = dest;
    if (o.pos) tail = panner(dest, o.pos, o.pannerOpts || {}); else if (Number.isFinite(o.pan) && o.pan !== 0) tail = stereoPan(dest, o.pan);
    node.connect(tail);
    if (o.send) send(g, o.send);
    try { src.start(t, clamp(fin(o.offset, 0), 0, Math.max(0, buf.duration - 0.01))); src.stop(end + 0.02); } catch (e) { return null; }
    src.onended = () => { try { node.disconnect(); } catch (_) { /* уже отключён */ } };
    return { src, g, end };
  }
  const loops = [];
  const EQ = (() => { const n = 24, a = new Float32Array(n), b = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1); a[i] = Math.sin(x * Math.PI / 2); b[i] = Math.cos(x * Math.PI / 2); } return { a, b }; })();
  /** Бесшовная петля-текстура из сэмпла с перекрёстным затуханием (Opus нельзя зацикливать «в лоб»). Возвращает контроллер или null. */
  function textureLoop(name, o = {}) {
    const key = pick(name); const buf = key && buffers[key];
    if (!buf) return null;
    const dest = o.out || bus.sfx;
    const master = ctx.createGain(); master.gain.value = Math.max(0, fin(o.gain, 0));
    const lpf = filter('lowpass', clamp(fin(o.lp, 20000), 100, 20000), 0.5);
    const hpf = o.hp ? filter('highpass', o.hp, 0.6) : null;
    lpf.connect(master);
    const entry = hpf ? hpf : lpf; if (hpf) hpf.connect(lpf);
    master.connect(dest);
    const xf = Math.min(fin(o.xf, 0.3), buf.duration * 0.4);
    const st = { rate: clamp(fin(o.rate, 1), 0.2, 4), segs: [], cur: null, dead: false, last: T() };
    const ctl = {
      master, lp: lpf, buf, get alive() { return !st.dead; },
      setGain(v, tc = 0.3) { setT(master.gain, v, tc); },
      setLP(f, tc = 0.3) { setT(lpf.frequency, clamp(fin(f, 20000), 100, 20000), tc); },
      setRate(v, tc = 0.3) { v = clamp(fin(v, st.rate), 0.2, 4); st.rate = v; for (const s of st.segs) setT(s.src.playbackRate, v, tc); },
      /** Плавно погасить и удалить петлю. */
      stop(rel = 0.4) {
        if (st.dead) return; st.dead = true;
        setT(master.gain, 0, rel / 3);
        const tEnd = T() + rel * 1.5;
        for (const s of st.segs) { try { s.src.stop(tEnd); } catch (_) { /* уже остановлен */ } }
        setTimeout(() => { try { master.disconnect(); } catch (_) { /* ok */ } }, rel * 1600 + 100);
        const i = loops.indexOf(ctl); if (i >= 0) loops.splice(i, 1);
      },
      tick(now) {
        if (st.dead) return;
        const dt = Math.max(0, now - st.last); st.last = now;
        const cur = st.cur;
        if (cur) cur.pos += dt * st.rate;
        const remain = cur ? (buf.duration - cur.pos) / st.rate : 0;
        if (!cur || remain - xf < 0.22) start(cur ? now + Math.max(0, remain - xf) : now + 0.01, cur);
        st.segs = st.segs.filter((s) => now < s.endAt);
      },
    };
    function start(at, prev) {
      at = Math.max(at, T());
      const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = st.rate;
      const g = ctx.createGain(); g.gain.value = 0;
      const off = prev ? 0 : Math.random() * Math.max(0, buf.duration - xf * 2 - 0.5);
      if (prev) { g.gain.setValueCurveAtTime(o.coherent ? EQ.a.map((v, i) => i / 23) : EQ.a, at, Math.max(0.02, xf)); }
      else { g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(1, at + 0.05); }
      src.connect(g); g.connect(entry);
      src.start(at, off);
      const seg = { src, g, pos: off, endAt: at + (buf.duration - off) / st.rate + 0.5 };
      if (prev) {
        const pg = prev.g.gain; const when = at;
        try { pg.cancelScheduledValues(when); pg.setValueCurveAtTime(o.coherent ? EQ.b.map((v, i) => 1 - i / 23) : EQ.b, when, Math.max(0.02, xf)); } catch (_) { /* перекрытие кривых */ }
        try { prev.src.stop(when + xf + 0.03); } catch (_) { /* ok */ }
        prev.endAt = when + xf + 0.1;
      }
      st.segs.push(seg); st.cur = seg;
      // позиция нового сегмента отсчитывается от его старта (если at в будущем — компенсируем в tick)
      seg.pos = off - Math.max(0, at - T()) * st.rate;
    }
    loops.push(ctl);
    return Object.assign(ctl, { input: entry });
  }
  /** Вызывать ~15 Гц: обслуживает петли-текстуры. */
  function pump() { const now = T(); for (const l of loops.slice()) l.tick(now); }

  function setVolume(name, v) {
    v = clamp(v, 0, 1);
    game.settings.volume[name] = v;
    if (name === 'master') ramp(out.gain, v, 0.05);
    else if (bus[name]) ramp(bus[name].gain, v, 0.05);
  }

  return {
    ctx, out, comp, limiter, masterLP, level, sfxDuck, sfxLim, bus, duck, ambDuck, rev, revIn, setReverb, setReverbMix, revState,
    noiseBuf, loopNoise, filter, gain, send, panner, stereoPan, burst, blip, ramp, T, updateListener, setVolume,
    fin, setT, setPos, relPos, airCut, loadSamples, playSample, pick, textureLoop, pump,
    get samplesReady() { return samplesState === 'ready'; }, hasSample: (n) => !!pick(n),
    resume() { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); },
    get running() { return ctx.state === 'running'; },
  };
}
