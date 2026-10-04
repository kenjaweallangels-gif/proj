// Адаптивная музыка (ERakisMusicState). Оригинальный материал; ориентир — эпическая «пустынная» эстетика кинопартитуры, без цитат.
//
// Архитектура (Ред. 3, S3-music). Музыка приходит ВОЛНАМИ: тишина → блок (подложка + голос + акцент) → тишина; постоянного фона нет.
//  - Стемы (Web/src/assets/music.js, собирает Tools/tts/music_build.py): женский вокализ с мелизмами (формантный синтез),
//    горловое пение, низкий мужской хор, «медь» с перегрузом, дудук, волынкоподобный дрон, рамочные барабаны, металлический скрежет,
//    удары, саб-бум (только сцены червя). Паки декодируются один раз при первом включении музыки.
//  - Реалтайм: планировщик «волн» и ритма, реверберация музыки (своя свёртка, ~4.6 с), фильтры/уровни по угрозе червя (worm.threat),
//    щипковые (уд/канун — Карплус–Стронг) для сиетча и сада, дакинг под речь по уровню на шине vo.
// Лад (хиджаз-подобный на D): D Eb F# G A Bb C. Вне сцен червя нет ничего ниже ~60 Гц; саб ограничен бюджетом секунд на вхождение в состояние.
// Состояния: Silence, DesertCalm, DesertDrone, Night, Garden, WormThreat, WormReveal, Devour, Encounter, SietchLife, SietchNarrow, HallChorale.
import { clamp } from '../core/util.js';
import { MUSIC } from '../assets/music.js';
import { makeIR } from './engine.js';

const HIJ = [0, 1, 4, 5, 7, 8, 10];     // ступени лада от тоники (полутоны)
const D4 = 62;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** Ступень лада (может быть <0 / >6 → другая октава) → частота. */
function degFreq(deg, base = D4) {
  const oct = Math.floor(deg / 7), idx = ((deg % 7) + 7) % 7;
  return mtof(base + oct * 12 + HIJ[idx]);
}

// Длительность вхождения / выхода, с.
const FADES = {
  Silence: [1.5, 2.5], DesertCalm: [3, 5], DesertDrone: [4, 6], Night: [4, 8], Garden: [3, 5], WormThreat: [1.5, 3.5], WormReveal: [2.5, 4.5],
  Devour: [0.15, 5], Encounter: [3, 4], SietchLife: [3, 4], SietchNarrow: [3, 3], HallChorale: [2, 6],
};
// Состояния со своим сабом (бюджет ограничен): HP-фильтр не ставится.
const SUB_STATES = new Set(['WormThreat', 'WormReveal', 'Devour']);
const LOOK = 0.45;      // окно упреждения планировщика, с

export function createMusic(game, eng, opts = {}) {
  const { ctx } = eng;
  const R = opts.rand || Math.random;
  const rnd = (a, b) => a + R() * (b - a);
  const pick = (a) => a[(R() * a.length) | 0];
  const chance = (p) => R() < p;
  let lastPick = new Map();
  /** Выбор без повтора подряд (по ключу). */
  const pickNew = (key, arr) => { let v = pick(arr); if (arr.length > 1 && v === lastPick.get(key)) v = arr[(arr.indexOf(v) + 1) % arr.length]; lastPick.set(key, v); return v; };

  // Калибровка уровней состояний (замер tools/music_render.mjs) × громкость из AudioEvents.csv.
  const CAL = { DesertCalm: 2.5, DesertDrone: 3.0, Night: 4.5, Garden: 3.4, WormThreat: 3.2, WormReveal: 1.6, Devour: 1.8, Encounter: 2.9, SietchLife: 2.2, SietchNarrow: 1.6, HallChorale: 3.4 };
  const volOf = (state) => (game.data?.AudioEvents?.find((e) => e.id === `Music.${state}`)?.volume ?? 0.8) * (CAL[state] ?? 1);

  // Отложенное отключение узлов; в manual-режиме (офлайн-рендер) узлы не трогаем: граф исполняется позже реального времени.
  const later = (fn, ms) => { if (!opts.manual) setTimeout(fn, ms); };
  const T = () => (opts.clock ? opts.clock() : ctx.currentTime);      // opts.clock — для офлайн-рендера (контекст не «идёт»)

  // ======================= Общий тракт музыки =======================
  // состояние.dry → [HP] → vduck → eng.duck;  состояние.wet → свёртка → vduck.  vduck — дакинг под речь (шина vo).
  const vduck = eng.gain(1); vduck.connect(eng.duck);
  const revIn = eng.gain(1), revConv = ctx.createConvolver(), revOut = eng.gain(0.8);
  revConv.buffer = makeIR(ctx, 4.6, 1.25, { pre: 0.03, dark: 0.75 });
  revIn.connect(revConv); revConv.connect(revOut); revOut.connect(vduck);

  // ======================= Загрузка стемов =======================
  const packs = {};
  let loadState = 0;     // 0 — не начата, 1 — идёт, 2 — готово
  const ready = () => loadState === 2;
  function b64bytes(uri) {
    const bin = atob(uri.slice(uri.indexOf(',') + 1));
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function decode(uri) {
    return new Promise((resolve) => {
      try {
        const r = ctx.decodeAudioData(b64bytes(uri), resolve, () => resolve(null));
        if (r && typeof r.then === 'function') r.then(resolve, () => resolve(null));
      } catch { resolve(null); }
    });
  }
  function load() {
    if (loadState) return opts.loadPromise;
    loadState = 1;
    opts.loadPromise = Promise.all(Object.entries(MUSIC).map(async ([k, p]) => { const buf = await decode(p.uri); if (buf) packs[k] = { buf, items: p.items }; }))
      .then(() => { loadState = 2; });
    return opts.loadPromise;
  }

  // ======================= Проигрывание стемов =======================
  /**
   * stem(out, пак, имя, t, {gain, rate, pan, wet, lp, hp, width, fadeIn, fadeOut, dest}) → длительность, с.
   * width>0 — «расширение»: две копии со сдвигом 15 мс и панорамой ±width. dest — альтернативный вход сухого тракта (фильтр состояния).
   */
  function stem(out, pack, name, t, o = {}) {
    const P = packs[pack], it = P?.items[name];
    if (!it) return 0;
    const rate = o.rate ?? 1, dur = it[1] / rate, gain = o.gain ?? 0.3;
    const one = (g, pan, tt) => {
      const s = ctx.createBufferSource(); s.buffer = P.buf; s.playbackRate.value = rate;
      let node = s;
      if (o.lp) { const f = eng.filter('lowpass', o.lp, 0.6); node.connect(f); node = f; }
      if (o.hp) { const f = eng.filter('highpass', o.hp, 0.6); node.connect(f); node = f; }
      const e = eng.gain(0), fi = Math.max(0.006, o.fadeIn ?? 0.006), fo = Math.min(dur * 0.5, Math.max(0.02, o.fadeOut ?? 0.02));
      e.gain.setValueAtTime(0, tt); e.gain.linearRampToValueAtTime(g, tt + fi);
      e.gain.setValueAtTime(g, Math.max(tt + fi, tt + dur - fo)); e.gain.linearRampToValueAtTime(0, tt + dur);
      node.connect(e);
      e.connect(pan ? eng.stereoPan(o.dest || out.dry, pan) : (o.dest || out.dry));
      if (o.wet) { const w = eng.gain(o.wet); e.connect(w); w.connect(out.wet); }
      s.start(tt, it[0], it[1]);
    };
    const pan = o.pan ?? 0;
    if (o.width) { one(gain * 0.72, clamp(pan - o.width, -1, 1), t); one(gain * 0.72, clamp(pan + o.width, -1, 1), t + 0.015); }
    else one(gain, pan, t);
    return dur;
  }

  // ======================= Щипковые (Карплус–Стронг): уд, канун =======================
  const ksCache = new Map();
  function ksBuf(freq, bright, dur) {
    const key = `${Math.round(freq * 4)}:${bright}:${dur}`;
    if (ksCache.has(key)) return ksCache.get(key);
    const sr = ctx.sampleRate, L = Math.max(2, Math.round(sr / freq)), n = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    const ring = new Float32Array(L);
    let seed = (freq * 977) | 0, prev = 0;
    for (let i = 0; i < L; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; const w = (seed / 4294967296) * 2 - 1; prev += (w - prev) * bright; ring[i] = prev * (1 + (1 - bright) * 1.8); }
    let mean = 0;
    for (let i = 0; i < L; i++) mean += ring[i];
    mean /= L;
    for (let i = 0; i < L; i++) ring[i] -= mean;      // без постоянной составляющей (иначе НЧ-гул через реверберацию)
    const decay = 0.9965 - (1 - bright) * 0.0008;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const nx = (idx + 1) % L;
      d[i] = ring[idx];
      ring[idx] = decay * 0.5 * (ring[idx] + ring[nx]);
      idx = nx;
    }
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
    const rec = { buf, rate: (sr / L) / freq };
    if (ksCache.size > 90) ksCache.delete(ksCache.keys().next().value);
    ksCache.set(key, rec);
    return rec;
  }
  function pluck(out, t, freq, vel = 1, { bright = 0.5, dur = 1.6, pan = 0, wet = 0.5, body = null } = {}) {
    const { buf, rate } = ksBuf(freq, bright, dur);
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = eng.gain(0);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.004);     // мягкая атака: без щелчка на старте шумового импульса
    s.connect(g);
    const dst = body || out.dry;
    g.connect(pan ? eng.stereoPan(dst, pan) : dst);
    if (wet) { const w = eng.gain(wet), h = eng.filter('highpass', 150, 0.7); g.connect(h); h.connect(w); w.connect(out.wet); }
    s.start(t);
  }
  /** Тёплый корпус уда (peak 240 Гц + срез верха) и яркий канун. */
  function oudBody(out) { const pk = eng.filter('peaking', 240, 1.1, 5), lp = eng.filter('lowpass', 3000, 0.7); pk.connect(lp); lp.connect(out.dry); return pk; }
  function qanunBody(out) { const hp = eng.filter('highpass', 300, 0.7), pk = eng.filter('peaking', 2100, 1.2, 3); hp.connect(pk); pk.connect(out.dry); return hp; }

  // ======================= Планировщик «волн» =======================
  /** Волна: пауза rest=[a,b] → блок block(t) (возвращает длину блока, с) → пауза… Первый блок через first с после запуска. */
  function waves(rest, first, block) {
    let next = null;
    return (now) => {
      if (next === null) next = now + first;
      if (now + LOOK < next) return;
      const t = Math.max(now, next), len = block(t) || 8;
      next = t + len + rnd(rest[0], rest[1]);
    };
  }

  // ======================= Состояния =======================
  // factory(out, st) → { tick(now, st), dispose?, [extra] }; out = {dry, wet}; st = {t0} (момент начала, после загрузки стемов).
  const SUBCAP = 26;      // с саба на вхождение в состояние (бум/удары), «землетрясения» нет
  const factories = {
    Silence() { return { tick() {} }; },

    // Рассвет/спокойная пустыня: редкие волны — дрон волынки + дудук или далёкий голос; почти всё время — воздух.
    DesertCalm(out) {
      const A = (t) => {
        stem(out, 'brass', 'p_drone', t, { gain: 0.17, wet: 0.55, width: 0.35 });
        stem(out, 'brass', pickNew('dc_d', ['d_1', 'd_2', 'd_3']), t + 2.6, { gain: 0.34, wet: 0.7, pan: rnd(-0.3, 0.3) });
        if (chance(0.35)) stem(out, 'perc', 'doum_big0', t + 6.5, { gain: 0.22, wet: 0.5, lp: 900 });
        return 14;
      };
      const B = (t) => {
        stem(out, 'voc', pickNew('dc_v', ['v_sigh', 'v_low', 'v_answer', 'v_call']), t, { gain: 0.34, wet: 0.85, pan: rnd(-0.4, 0.4) });
        stem(out, 'choir', 'c_low', t, { gain: 0.11, wet: 0.6, width: 0.3 });
        return 12;
      };
      let flip = chance(0.5);
      return { tick: waves([12, 22], 1.2, (t) => ((flip = !flip) ? A(t) : B(t))) };
    },

    // Эрг: горловое пение, хор, вокал с мелизмами, редкая медь и удар. Волнами, с большими паузами.
    DesertDrone(out) {
      const kinds = ['throat', 'choirvoc', 'brass'];
      const blk = (t) => {
        const k = pickNew('dd_k', kinds);
        if (k === 'throat') {
          stem(out, 'choir', pickNew('dd_t', ['t_a', 't_b']), t, { gain: 0.26, wet: 0.55, width: 0.3 });
          stem(out, 'choir', 'c_low', t + 1, { gain: 0.12, wet: 0.5, width: 0.4 });
          if (chance(0.4)) stem(out, 'perc', pickNew('dd_d', ['doum_big1', 'doum_big2']), t + rnd(5, 9), { gain: 0.34, wet: 0.6 });
          return 16;
        }
        if (k === 'choirvoc') {
          stem(out, 'choir', pickNew('dd_c', ['c_open', 'c_min']), t, { gain: 0.24, wet: 0.7, width: 0.4 });
          stem(out, 'voc', pickNew('dd_v', ['v_low', 'v_call', 'v_long', 'v_orn']), t + 3.5, { gain: 0.34, wet: 0.9, pan: rnd(-0.35, 0.35) });
          if (chance(0.35)) stem(out, 'brass', 'b_open', t + 1, { gain: 0.10, wet: 0.6, width: 0.3 });
          return 15;
        }
        stem(out, 'brass', pickNew('dd_b', ['b_phryg', 'b_min7']), t, { gain: 0.24, wet: 0.7, width: 0.3 });
        if (chance(0.35)) stem(out, 'perc', pickNew('dd_s', ['scr0', 'scr1', 'scr2']), t + 3.2, { gain: 0.16, wet: 0.8, pan: rnd(-0.5, 0.5), lp: 4500 });
        if (chance(0.5)) stem(out, 'perc', 'doum_big0', t + 5.5, { gain: 0.34, wet: 0.7 });
        return 11;
      };
      return { tick: waves([8, 17], 0.8, blk) };
    },

    // Ночь: почти тишина — далёкий голос или едва слышный дрон раз в минуту.
    Night(out) {
      const blk = (t) => {
        const r = R();
        if (r < 0.55) { stem(out, 'voc', pickNew('n_v', ['v_sigh', 'v_air', 'v_low']), t, { gain: 0.16, wet: 1.0, lp: 1800, pan: rnd(-0.5, 0.5) }); return 11; }
        if (r < 0.9) { stem(out, 'brass', 'p_drone', t, { gain: 0.09, wet: 0.8, lp: 1300, width: 0.3 }); return 14; }
        stem(out, 'perc', 'doum_mid0', t, { gain: 0.14, wet: 1.0, lp: 700 }); return 3;
      };
      return { tick: waves([28, 55], 3, blk) };
    },

    // Сад — высокий замкнутый скальный карман без воды и пальм, малые растения: тихое, загадочное, разреженное место.
    // Редкие одиночные высокие звуки с длинным хвостом, далёкий воздушный вокализ, едва слышный дрон; без ритма и мелодий-«пасторали».
    Garden(out) {
      const qan = qanunBody(out);
      const blk = (t) => {
        const k = pickNew('g_k', ['bells', 'voc', 'drone', 'bells']);
        if (k === 'bells') {   // 2–3 одиночные ноты высоко, с большими паузами и сильной реверберацией
          const n = 2 + ((R() * 2) | 0); let tt = t;
          for (let i = 0; i < n; i++) { pluck(out, tt, degFreq(pick([4, 5, 7, 8]), D4 + 12), 0.42, { bright: 0.62, dur: 2.4, pan: rnd(-0.5, 0.5), wet: 1.1, body: qan }); tt += rnd(2.2, 4.2); }
          return tt - t + 2;
        }
        if (k === 'voc') { stem(out, 'voc', pickNew('g_v', ['v_air', 'v_sigh']), t + 0.5, { gain: 0.2, wet: 1.1, lp: 2600, hp: 300, pan: rnd(-0.4, 0.4) }); return 12; }
        stem(out, 'brass', 'p_drone', t, { gain: 0.07, wet: 1.0, lp: 1500, width: 0.4 });
        if (chance(0.5)) stem(out, 'brass', 'd_3', t + 4, { gain: 0.14, wet: 1.1, lp: 2400, pan: rnd(-0.4, 0.4) });
        return 14;
      };
      return { tick: waves([9, 18], 2.0, blk) };
    },

    // Угроза червя: нарастание зависит от worm.threat — хор, медь, барабан «сердца» (ломаный ритм), скрежет, подъём, редкие удары саба.
    WormThreat(out, st) {
      const bedLP = eng.filter('lowpass', 500, 0.5), bedG = eng.gain(0); bedLP.connect(bedG); bedG.connect(out.dry);
      const sub = { used: 0 };
      const canSub = (s) => sub.used + s <= SUBCAP && (sub.used += s, true);
      let nBed = null, nBeat = null, nBrass = null, nScr = null, nVoc = null, nBoom = null, nLone = null, riserAt = null, step = 0;
      const pattern = [1, 0, 0.55, 0, 0, 0.8, 0.45, 0, 0.6, 0, 0, 0.5];      // 12 шагов: 3+2+3+4, ломаный
      return {
        tick(now) {
          const th = clamp(game.worm?.threat ?? 0.35, 0, 1);
          if (nBed === null) { nBed = now; nBeat = now + 0.6; nBrass = now + 8; nScr = now + 6; nVoc = now + 12; nBoom = now + 10; nLone = now + 3; }
          bedLP.frequency.setTargetAtTime(280 + 4800 * Math.pow(th, 1.3), now, 0.5);
          bedG.gain.setTargetAtTime(th < 0.1 ? 0 : 0.35 + 0.65 * th, now, 1.2);
          if (th > 0.1 && now + LOOK > nBed) { stem(out, 'choir', pickNew('wt_c', ['c_min', 'c_phryg', 'c_open']), Math.max(now, nBed), { gain: 0.18 + 0.24 * th, wet: 0.5, width: 0.3, dest: bedLP }); nBed = Math.max(now, nBed) + 11.5; }
          // барабан сердца: темп и плотность растут с угрозой
          if (th > 0.2) {
            const unit = 0.62 - 0.3 * th;
            while (now + LOOK > nBeat) {
              const a = pattern[step % pattern.length];
              if (a > 0 && chance(0.55 + 0.4 * th)) {
                const g = (0.14 + 0.5 * th) * (0.35 + 0.65 * a);
                stem(out, 'perc', a > 0.9 ? pickNew('wt_dd', ['doum_big0', 'doum_big1']) : pick(['doum_mid0', 'doum_mid1']), nBeat, { gain: g, wet: 0.45, pan: rnd(-0.15, 0.15) });
                // короткий саб-«толчок» к сильной доле — только при высокой угрозе и в пределах бюджета
                if (a > 0.9 && th > 0.6 && canSub(0.6)) { eng.blip({ freq: 56, freq1: 44, dur: 0.55, gain: 0.16 * th, out: out.dry, when: nBeat, attack: 0.012 }); }
              }
              step++; nBeat += unit * (chance(0.07) ? 1.5 : 1);
            }
          } else if (now + LOOK > nLone) { stem(out, 'perc', 'doum_big0', Math.max(now, nLone), { gain: 0.16, wet: 0.7, lp: 700 }); nLone = now + rnd(9, 16); }
          if (th > 0.35 && now + LOOK > nBrass) { stem(out, 'brass', pickNew('wt_b', ['b_phryg', 'b_min7', 'b_open']), Math.max(now, nBrass), { gain: 0.1 + 0.28 * th, wet: 0.6, width: 0.3 }); nBrass = now + rnd(14, 24); }
          if (th > 0.4 && now + LOOK > nScr) { stem(out, 'perc', pickNew('wt_s', ['scr0', 'scr1', 'scr2']), Math.max(now, nScr), { gain: 0.08 + 0.18 * th, wet: 0.8, pan: rnd(-0.6, 0.6), lp: 5000 }); nScr = now + rnd(9, 16); }
          if (th > 0.15 && th < 0.65 && now + LOOK > nVoc) { stem(out, 'voc', pickNew('wt_v', ['v_low', 'v_answer', 'v_call']), Math.max(now, nVoc), { gain: 0.2 + 0.2 * th, wet: 0.9, pan: rnd(-0.4, 0.4) }); nVoc = now + rnd(24, 36); }
          if (th > 0.5 && (riserAt === null || now - riserAt > 50)) { riserAt = now; stem(out, 'perc', 'riser', now + 0.1, { gain: 0.34 + 0.2 * th, wet: 0.5 }); }
          if (th > 0.62 && now + LOOK > nBoom && canSub(5)) { stem(out, 'perc', pick(['boom0', 'boom1']), Math.max(now, nBoom), { gain: 0.34 * th, dest: out.dry }); nBoom = now + rnd(16, 26); }
        },
      };
    },

    // Явление приручённого червя: нарастание (подъём, хор, барабан) → пик на ~13 с → величественное затухание. Саб — один бум.
    WormReveal(out) {
      const PEAK = 13.3;
      let step = 0, nBeat = null, nChoir = null, nVoc = null, nDrum2 = null, fired = {};
      return {
        tick(now, st) {
          const t0 = st.t0, e = now - t0;
          const once = (k, at, fn) => { if (!fired[k] && e + LOOK >= at) { fired[k] = true; fn(t0 + at > now ? t0 + at : now); } };
          once('riser', 0, (t) => stem(out, 'perc', 'riser', t, { gain: 0.5, wet: 0.5 }));
          once('c0', 0.2, (t) => stem(out, 'choir', 'c_low', t, { gain: 0.2, wet: 0.6, width: 0.4 }));
          once('b0', 3, (t) => stem(out, 'brass', 'b_phryg', t, { gain: 0.26, wet: 0.7, width: 0.3 }));
          once('v0', 7.5, (t) => stem(out, 'voc', 'v_low', t, { gain: 0.3, wet: 0.9 }));
          once('c1', 9.5, (t) => stem(out, 'choir', 'c_open', t, { gain: 0.3, wet: 0.7, width: 0.4 }));
          once('peak', PEAK, (t) => {
            stem(out, 'perc', 'imp0', t, { gain: 0.6, wet: 0.5 });
            stem(out, 'perc', 'boom0', t, { gain: 0.5 });
            stem(out, 'brass', 'b_major', t, { gain: 0.42, wet: 0.6, width: 0.4 });
            stem(out, 'perc', 'gong', t + 0.05, { gain: 0.3, wet: 0.7 });
            stem(out, 'voc', 'v_wail', t + 0.5, { gain: 0.42, wet: 0.9 });
            stem(out, 'choir', 'c_phryg', t + 0.2, { gain: 0.36, wet: 0.8, width: 0.4 });
            stem(out, 'perc', 'scr0', t + 1.6, { gain: 0.14, wet: 0.8, pan: -0.4, lp: 4500 });
          });
          // медленный пульс до пика, потом процессия
          if (nBeat === null) nBeat = now + 1;
          while (now + LOOK > nBeat) {
            const rel = nBeat - t0;
            if (rel < PEAK - 0.5) stem(out, 'perc', step % 4 === 3 ? 'doum_mid0' : 'doum_big0', nBeat, { gain: 0.14 + 0.34 * clamp(rel / PEAK, 0, 1), wet: 0.5 });
            else if (rel > PEAK + 3 && rel < PEAK + 26 && step % 2 === 0) stem(out, 'perc', 'doum_big1', nBeat, { gain: 0.34 * (1 - (rel - PEAK) / 30), wet: 0.7 });
            step++; nBeat += 1.75;
          }
          if (e > PEAK + 14) {   // послесвечение: волны хора и голос
            if (nChoir === null) nChoir = now + 4;
            if (now + LOOK > nChoir) { stem(out, 'choir', pickNew('wr_c', ['c_open', 'c_min', 'c_phryg']), Math.max(now, nChoir), { gain: 0.24, wet: 0.8, width: 0.4 }); nChoir = now + rnd(15, 22); }
            if (nVoc === null) nVoc = now + 6;
            if (now + LOOK > nVoc) { stem(out, 'voc', pickNew('wr_v', ['v_long', 'v_sigh', 'v_orn']), Math.max(now, nVoc), { gain: 0.3, wet: 0.95 }); nVoc = now + rnd(22, 34); }
          }
        },
      };
    },

    // Поедание харвестера: немедленный массивный пик (стем «peak»: удар + бум + медь + гонг + вопль + хор), затем эхо ударов и скрежет.
    Devour(out) {
      const fired = {};
      return {
        tick(now, st) {
          const t0 = st.t0, e = now - t0;
          const once = (k, at, fn) => { if (!fired[k] && e + LOOK >= at) { fired[k] = true; fn(Math.max(now, t0 + at)); } };
          once('peak', 0.02, (t) => stem(out, 'perc', 'peak', t, { gain: 0.8, wet: 0.35 }));
          once('d0', 0.5, (t) => stem(out, 'perc', 'doum_big0', t, { gain: 0.42, wet: 0.5 }));
          once('c0', 1.8, (t) => stem(out, 'choir', 'c_phryg', t, { gain: 0.3, wet: 0.8, width: 0.4 }));
          once('i1', 3.6, (t) => stem(out, 'perc', 'imp1', t, { gain: 0.42, wet: 0.5 }));
          once('s1', 4.6, (t) => stem(out, 'perc', 'scr1', t, { gain: 0.18, wet: 0.8, pan: 0.4, lp: 4500 }));
          once('d1', 6.5, (t) => stem(out, 'perc', 'doum_big2', t, { gain: 0.3, wet: 0.7 }));
          once('v1', 8.5, (t) => stem(out, 'voc', 'v_long', t, { gain: 0.3, wet: 1.0 }));
        },
      };
    },

    // Разговор с наездниками: тихий низкий хор, редкие удары, далёкий дудук. Под речью ещё и дакинг.
    Encounter(out) {
      const blk = (t) => {
        stem(out, 'choir', pickNew('en_c', ['c_low', 'c_min']), t, { gain: 0.16, wet: 0.75, width: 0.35 });
        if (chance(0.8)) { const n = 2 + ((R() * 2) | 0); for (let i = 0; i < n; i++) stem(out, 'perc', pick(['doum_mid0', 'doum_mid1']), t + 2 + i * 2.4, { gain: 0.2, wet: 0.7 }); }
        if (chance(0.4)) stem(out, 'brass', pickNew('en_d', ['d_1', 'd_2']), t + 5, { gain: 0.16, wet: 0.9, lp: 2600, pan: rnd(-0.4, 0.4) });
        if (chance(0.2)) stem(out, 'voc', 'v_low', t + 8, { gain: 0.14, wet: 1.0, lp: 2200 });
        return 15;
      };
      return { tick: waves([4, 9], 0.3, blk) };
    },

    // Сиетч, галерея: тёплое и камерное — уд, тихие ручные барабаны (ритм волнами), далёкий вокализ, низкий хор «оо» шёпотом.
    SietchLife(out) {
      const oud = oudBody(out), qan = qanunBody(out);
      const beat = 60 / 76, eighth = beat / 2;
      const pats = ['D.t.D.tk', 'D.k.Dt.t', 'D..tD.t.', 'D.t.D.t.'];
      const oudPhrase = (t, len = 6) => {
        const motif = pick([[4, 2, 1, 0, 1, 0], [0, 1, 2, 4, 2, 1, 0], [4, 5, 4, 2, 1, 0, -1, 0], [2, 4, 2, 1, 0]]);
        let tt = t;
        motif.forEach((d, i) => { pluck(out, tt, degFreq(d, D4), i === 0 ? 0.8 : 0.6, { bright: 0.42, dur: 1.8, pan: rnd(-0.15, 0.15), wet: 0.5, body: oud }); tt += rnd(0.55, 1.15) * (i > motif.length - 3 ? 1.5 : 1); });
        return tt - t;
      };
      const groove = (t) => {
        const bars = 4 + ((R() * 3) | 0), p = pick(pats);
        let tt = t;
        for (let b = 0; b < bars; b++) {
          const pat = b === bars - 1 ? pick(pats) : p;
          for (let k = 0; k < 8; k++) {
            const c = pat[k], at = tt + k * eighth + (k % 2 ? rnd(0, 0.012) : 0);
            if (c === 'D') stem(out, 'perc', pick(['dum_hand0', 'dum_hand1', 'dum_hand2']), at, { gain: 0.46, wet: 0.45, pan: -0.15 });
            else if (c === 't') stem(out, 'perc', pick(['tek0', 'tek1', 'tek2']), at, { gain: 0.26, wet: 0.4, pan: 0.2 });
            else if (c === 'k' && chance(0.7)) stem(out, 'perc', pick(['ka0', 'ka1']), at, { gain: 0.2, wet: 0.3 });
          }
          if (b % 2 === 0 && chance(0.85)) pluck(out, tt, degFreq(pick([-7, -7, -5, -3]), D4), 0.7, { bright: 0.35, dur: 2.0, wet: 0.5, body: oud });
          if (chance(0.5)) pluck(out, tt + eighth * pick([3, 5, 6]), degFreq(pick([0, 2, 4, 5]), D4), 0.45, { bright: 0.5, dur: 1.3, pan: rnd(-0.2, 0.3), wet: 0.5, body: oud });
          tt += 8 * eighth;
        }
        return tt - t;
      };
      const blk = (t) => {
        const k = pickNew('sl_k', ['groove', 'oud', 'voc']);
        if (k === 'groove') return groove(t) + 1;
        if (k === 'oud') {
          const len = oudPhrase(t);
          stem(out, 'choir', 'c_low', t, { gain: 0.08, wet: 0.7, width: 0.4 });
          if (chance(0.45)) { const f = degFreq(pick([4, 5, 7, 9]), D4 + 12), n = 10 + ((R() * 8) | 0); for (let j = 0; j < n; j++) pluck(out, t + len + 0.4 + j * 0.08, f, 0.2 * Math.sin(Math.PI * (j + 1) / (n + 1)) + 0.04, { bright: 0.78, dur: 0.6, pan: 0.35, wet: 0.5, body: qan }); }
          return len + 3;
        }
        stem(out, 'voc', pickNew('sl_v', ['v_sigh', 'v_answer', 'v_low']), t, { gain: 0.24, wet: 1.0, lp: 2400, pan: rnd(-0.5, 0.5) });
        pluck(out, t + 3, degFreq(-7, D4), 0.6, { bright: 0.33, dur: 2.2, wet: 0.5, body: oud });
        if (chance(0.5)) stem(out, 'perc', 'dum_hand1', t + 4.5, { gain: 0.34, wet: 0.5 });
        return 10;
      };
      return { tick: waves([2.5, 6], 0.8, blk) };
    },

    // Узкие проходы: ещё тише — одиночные ноты уда, редкий канун, очень далёкий голос.
    SietchNarrow(out) {
      const oud = oudBody(out), qan = qanunBody(out);
      const blk = (t) => {
        pluck(out, t, degFreq(pick([-7, -7, -5, -4]), D4), 0.7, { bright: 0.3, dur: 2.4, wet: 0.7, body: oud });
        if (chance(0.6)) pluck(out, t + rnd(1.2, 2.2), degFreq(pick([0, 2, 3, 4]), D4), 0.45, { bright: 0.45, dur: 1.6, wet: 0.7, body: oud });
        if (chance(0.45)) { const f = degFreq(pick([0, 2, 4, 5]), D4 + 12), n = 9 + ((R() * 8) | 0); for (let j = 0; j < n; j++) pluck(out, t + 3 + j * 0.085, f, 0.15 * Math.sin(Math.PI * (j + 1) / (n + 1)) + 0.03, { bright: 0.75, dur: 0.6, pan: rnd(-0.2, 0.3), wet: 0.6, body: qan }); }
        if (chance(0.3)) stem(out, 'voc', 'v_sigh', t + 2, { gain: 0.15, wet: 1.0, lp: 1500 });
        if (chance(0.25)) stem(out, 'perc', 'dum_hand0', t + 5, { gain: 0.26, wet: 0.7, lp: 900 });
        return 7;
      };
      return { tick: waves([5, 11], 1.0, blk) };
    },

    // Зал: хорал нарастает за 2.5 мин — хор, вокализы, медь, процессия барабана. Без саба; волны остаются (хор «дышит» паузами).
    HallChorale(out, st) {
      const born = null;
      let nChoir = null, nVoc = null, nBrass = null, nDrum = null, chordN = 0, step = 0;
      const api = {
        finalChord(t) {
          ending = true;
          const fin = eng.gain(1), fw = eng.gain(1);
          fin.connect(vduck); fw.connect(revIn);
          const o = { dry: fin, wet: fw };
          stem(o, 'brass', 'b_major', t, { gain: 0.5, wet: 0.7, width: 0.4 });
          stem(o, 'choir', 'c_open', t + 0.05, { gain: 0.42, wet: 0.8, width: 0.4 });
          stem(o, 'voc', 'v_wail', t + 0.4, { gain: 0.4, wet: 1.0 });
          stem(o, 'perc', 'imp0', t, { gain: 0.5, wet: 0.5, hp: 70 });
          stem(o, 'perc', 'gong', t + 0.05, { gain: 0.26, wet: 0.8 });
          fin.gain.setValueAtTime(1, t + 9); fin.gain.linearRampToValueAtTime(0, t + 13);
          later(() => { try { fin.disconnect(); fw.disconnect(); } catch { /* уже отключены */ } }, 15000);
        },
        tick(now, stt) {
          if (ending) return;
          const inten = clamp((now - stt.t0) / 150, 0, 1);
          if (nChoir === null) { nChoir = now + 0.4; nVoc = now + 9; nBrass = now + 22; nDrum = now + 14; }
          if (now + LOOK > nChoir) {
            const names = ['c_open', 'c_min', 'c_phryg', 'c_open'];
            stem(out, 'choir', names[chordN++ % 4], Math.max(now, nChoir), { gain: 0.2 + 0.2 * inten, wet: 0.9, width: 0.45 });
            nChoir = Math.max(now, nChoir) + (chordN % 3 === 0 ? rnd(15, 19) : rnd(10.5, 12.5));
          }
          if (now + LOOK > nVoc) { stem(out, 'voc', pickNew('hc_v', inten > 0.6 ? ['v_high', 'v_long', 'v_orn', 'v_wail'] : ['v_high', 'v_long', 'v_orn', 'v_call']), Math.max(now, nVoc), { gain: 0.28 + 0.14 * inten, wet: 1.0, pan: rnd(-0.25, 0.25) }); nVoc = now + rnd(17, 28); }
          if (inten > 0.25 && now + LOOK > nBrass) { stem(out, 'brass', pickNew('hc_b', ['b_open', 'b_phryg']), Math.max(now, nBrass), { gain: 0.12 + 0.14 * inten, wet: 0.8, width: 0.3 }); nBrass = now + rnd(22, 34); }
          if (inten > 0.3) while (now + LOOK > nDrum) { if (step++ % 4 < 2) stem(out, 'perc', 'doum_big' + (step % 3), nDrum, { gain: 0.14 + 0.3 * inten, wet: 0.9 }); nDrum += 3.6; }
          else nDrum = Math.max(nDrum, now);
        },
      };
      let ending = false;
      return api;
    },
  };

  // ======================= Управление состояниями =======================
  let cur = null;                // {name, node:{dry,wet}, impl, born, st}
  const fading = new Set();
  let timer = null;

  function setState(name) {
    if (!factories[name]) { console.warn(`[audio] неизвестное музыкальное состояние '${name}'`); return; }
    if (cur?.name === name) return;
    const t = T();
    const [inT] = FADES[name] || [3, 3];
    if (cur) {
      const [, outT] = FADES[cur.name];
      const old = cur;
      for (const g of [old.node.dry, old.node.wet]) g.gain.setTargetAtTime(0, t, Math.max(outT, 0.8) / 5);      // экспоненциальный выход: не зависит от текущего значения (работает и офлайн)
      fading.add(old);
      later(() => { try { old.impl.dispose?.(); } catch { /* уже остановлен */ } try { old.node.dry.disconnect(); old.node.wet.disconnect(); old.hp?.disconnect(); } catch { /* нет */ } fading.delete(old); }, (outT + 1) * 1000 + 300);
    }
    const dry = eng.gain(0), wet = eng.gain(0);
    let hp = null;
    if (SUB_STATES.has(name)) dry.connect(vduck);
    else { hp = eng.filter('highpass', 48, 0.7); dry.connect(hp); hp.connect(vduck); }
    wet.connect(revIn);
    const lvl = name === 'Silence' ? 0 : volOf(name);
    for (const g of [dry, wet]) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + Math.max(inT, 0.05)); }
    const node = { dry, wet };
    const st = { t0: null };
    const impl = factories[name](node, st);
    cur = { name, node, impl, born: t, st, hp };
    game.bus.emit('music', { state: name });
  }

  // Дакинг под речь: по факту звучания на шине vo (+ запас 0.7 с); возврат медленный.
  let lastSpeech = -9, duckNow = 1;
  function voDuck(now) {
    let lv = 0;
    try { lv = eng.voLevel?.() ?? 0; } catch { lv = 0; }
    if (lv > 0.004) lastSpeech = now;
    const target = now - lastSpeech < 0.7 ? 0.36 : 1;
    if (target !== duckNow) { duckNow = target; vduck.gain.setTargetAtTime(target, now, target < 1 ? 0.07 : 0.9); }
  }

  /** Один шаг планировщика (для таймера и для офлайн-рендера tools/music_render.mjs). */
  function step(now) {
    voDuck(now);
    if (!cur || !ready()) return;
    cur.st.t0 ??= now;
    cur.impl.tick(now, cur.st);
  }

  function start() {
    load();
    if (timer || opts.manual) return;
    timer = setInterval(() => {
      if (!eng.running) return;
      try { step(T()); } catch (e) { console.error('[audio] музыка:', e); }
    }, 70);
  }

  return {
    start, step, load,
    get ready() { return ready(); },
    set(name) { setState(name); start(); },
    get state() { return cur?.name ?? 'Silence'; },
    /** Финал в зале: тяжёлый аккорд меди + хор + вокал + удар (без саба). */
    finalChord() {
      const t = T() + 0.05;
      if (cur?.name === 'HallChorale' && cur.impl.finalChord) cur.impl.finalChord(t);
      else { // стингер вне зала (отладка)
        const fin = eng.gain(1), fw = eng.gain(1); fin.connect(vduck); fw.connect(revIn);
        const o = { dry: fin, wet: fw };
        stem(o, 'brass', 'b_major', t, { gain: 0.4, wet: 0.7 }); stem(o, 'choir', 'c_open', t, { gain: 0.34, wet: 0.8 });
        later(() => { try { fin.disconnect(); fw.disconnect(); } catch { /* нет */ } }, 14000);
      }
    },
    /** Отход червя: прощальное нарастание хора и голоса (стингер поверх текущего состояния; короткий бум — сцена червя). */
    swell() {
      const t = T() + 0.05;
      const tmp = eng.gain(1), tw = eng.gain(1); tmp.connect(vduck); tw.connect(revIn);
      const o = { dry: tmp, wet: tw };
      stem(o, 'choir', 'c_open', t, { gain: 0.3, wet: 0.9, width: 0.4 });
      stem(o, 'voc', 'v_long', t + 1.5, { gain: 0.3, wet: 1.0 });
      stem(o, 'brass', 'b_open', t + 0.5, { gain: 0.16, wet: 0.8, width: 0.3 });
      stem(o, 'perc', 'boom1', t + 3, { gain: 0.22 });
      later(() => { try { tmp.disconnect(); tw.disconnect(); } catch { /* нет */ } }, 17000);
    },
    /** Короткие стингеры для отладки. */
    stinger(kind) {
      const t = T() + 0.02;
      if (kind === 'breath') stem({ dry: vduck, wet: revIn }, 'perc', 'tek0', t, { gain: 0.3 });
    },
    dispose() { clearInterval(timer); timer = null; },
    /** Для тестов: доступ к выходу тракта. */
    _out: vduck,
  };
}
