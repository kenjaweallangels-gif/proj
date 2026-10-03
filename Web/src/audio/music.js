// Адаптивная музыка (ERakisMusicState), полностью синтезируемая. Оригинальный материал.
// Лад «Ракиса» (собственный): D E F G# A Bb C — полутоны от тоники 0,2,3,6,7,8,10. Тема — 5 нот вниз, последняя «не разрешена».
// Состояния: Silence, DesertCalm (дудук+дрон), DesertDrone (горловой дрон), WormThreat (инфразвук+ломаный барабан),
// WormReveal (величественное прибытие: хор на открытых квинтах, низкая тема, барабан), Encounter (низкий хор + рамочный барабан на время разговора), SietchLife (уд, канун, барабан; 84 bpm), SietchNarrow, HallChorale.
import { clamp } from '../core/util.js';

const MODE = [0, 2, 3, 6, 7, 8, 10];
const D4 = 62;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
/** Ступень лада (может быть отрицательной / >6 → другая октава) → частота. */
function degFreq(deg, base = D4) {
  const oct = Math.floor(deg / 7), idx = ((deg % 7) + 7) % 7;
  return mtof(base + oct * 12 + MODE[idx]);
}
// Тема Ракиса: C5 A4 G#4 F4 E4 (ступени относительно D4: 10→7→6→3→2). Последняя нота (E) — «зависает».
const THEME = [10, 7, 6, 3, 2].map((s) => mtof(D4 + s));
const rnd = (a, b) => a + Math.random() * (b - a);
const pickOne = (a) => a[(Math.random() * a.length) | 0];

// Гласные (F1, F2, F3, уровни) для формантного хора.
const VOW = { ah: [800, 1150, 2900], oh: [450, 800, 2830], oo: [325, 700, 2530], eh: [530, 1840, 2480] };

// Длительность вхождения / выхода по таблице soundmap §2.1.
const FADES = {
  Silence: [1.5, 1.5], DesertCalm: [4, 6], DesertDrone: [6, 6], WormThreat: [1, 3], WormReveal: [2.5, 3.5], Encounter: [3, 4],
  SietchLife: [4, 4], SietchNarrow: [3, 3], HallChorale: [2, 6],
};

export function createMusic(game, eng) {
  const { ctx } = eng;
  // Калибровка уровней состояний (замер tools/audio_levels.mjs) × громкость из AudioEvents.csv.
  const CAL = { DesertCalm: 2, DesertDrone: 2, WormThreat: 0.8, WormReveal: 2.2, Encounter: 2.4, SietchLife: 3.2, SietchNarrow: 2.6, HallChorale: 2.6 };
  const volOf = (state) => (game.data?.AudioEvents?.find((e) => e.id === `Music.${state}`)?.volume ?? 0.8) * (CAL[state] ?? 1);

  // Музыкальная реверберация (небольшая отправка) и фильтры инструментов.
  const musicBus = eng.duck;
  const T = () => ctx.currentTime;

  // ======================= Инструменты =======================
  /** Дудук: двойная пила + формантные пики, вибрато с задержкой, дыхание. */
  function reed(dest, t, f, dur, vel = 1, { vib = 5.1, depth = 0.005, scoop = true } = {}) {
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = 7;
    const lp = eng.filter('lowpass', 2700, 0.7), p1 = eng.filter('peaking', 1150, 1.6, 7), p2 = eng.filter('peaking', 2350, 2, 4);
    const mix = eng.gain(0.5), env = eng.gain(0);
    const g2 = eng.gain(0.35);
    o1.connect(mix); o2.connect(g2); g2.connect(mix); mix.connect(lp); lp.connect(p1); p1.connect(p2); p2.connect(env); env.connect(dest);
    const t1 = t + dur;
    for (const o of [o1, o2]) {
      o.frequency.setValueAtTime(scoop ? f * 0.985 : f, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    }
    // Вибрато: нарастает через 0.5 с.
    const lfo = ctx.createOscillator(), lg = eng.gain(0);
    lfo.frequency.value = vib + rnd(-0.4, 0.4); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * depth, t + Math.min(dur, 0.8) + 0.3);
    lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
    // Огибающая: мягкая атака, спад.
    const peak = 0.17 * vel;
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(peak, t + 0.14); env.gain.setValueAtTime(peak * 0.85, Math.max(t + 0.15, t1 - 0.1));
    env.gain.linearRampToValueAtTime(0, t1 + 0.35);
    // Дыхание
    const ns = ctx.createBufferSource(); ns.buffer = eng.noiseBuf('pink'); ns.loop = true;
    const nb = eng.filter('bandpass', f * 3, 1.4), ng = eng.gain(0);
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.03 * vel, t + 0.1); ng.gain.linearRampToValueAtTime(0.008 * vel, t + 0.6); ng.gain.linearRampToValueAtTime(0, t1 + 0.3);
    ns.connect(nb); nb.connect(ng); ng.connect(dest);
    for (const n of [o1, o2, lfo]) { n.start(t); n.stop(t1 + 0.4); }
    ns.start(t, Math.random() * 3); ns.stop(t1 + 0.4);
  }

  /** Рамочный барабан: питч-дроп + хлопок ладони. */
  function drum(dest, t, vel = 1, kind = 'doum') {
    if (kind === 'doum') {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(135, t); o.frequency.exponentialRampToValueAtTime(62, t + 0.14);
      const g = eng.gain(0); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.42 * vel, t + 0.006); g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.42);
      slap(dest, t, 0.08 * vel, 420);
    } else slap(dest, t, 0.16 * vel, 1800);
  }
  function slap(dest, t, g, f) {
    const s = ctx.createBufferSource(); s.buffer = eng.noiseBuf('white');
    const bp = eng.filter('bandpass', f, 1.1), e = eng.gain(0);
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + 0.002); e.gain.exponentialRampToValueAtTime(0.0008, t + 0.08);
    s.connect(bp); bp.connect(e); e.connect(dest); s.start(t, Math.random() * 3, 0.12);
  }

  // Карплус–Стронг: пред-рассчитанные щипки (уд/канун).
  const ksCache = new Map();
  function ksBuf(freq, bright, dur) {
    const key = `${Math.round(freq * 4)}:${bright}:${dur}`;
    if (ksCache.has(key)) return ksCache.get(key);
    const sr = ctx.sampleRate, L = Math.max(2, Math.round(sr / freq)), n = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, n, sr), d = buf.getChannelData(0);
    const ring = new Float32Array(L);
    let seed = (freq * 977) | 0, prev = 0;
    for (let i = 0; i < L; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; const w = (seed / 4294967296) * 2 - 1; prev += (w - prev) * bright; ring[i] = prev * (1 + (1 - bright) * 1.8); }
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
    if (ksCache.size > 80) ksCache.delete(ksCache.keys().next().value);
    ksCache.set(key, rec);
    return rec;
  }
  function pluck(dest, t, freq, vel = 1, { bright = 0.55, dur = 1.5, pan = 0 } = {}) {
    const { buf, rate } = ksBuf(freq, bright, dur);
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
    const g = eng.gain(vel * 0.5);
    s.connect(g); g.connect(eng.stereoPan(dest, pan)); s.start(t);
  }

  /** Голос хора/вокализа: пилы + форманты + вибрато. */
  function voice(dest, t, f, dur, vowel = 'ah', amp = 0.1, { attack = 1.2, release = 2, vib = 5.4, vibDepth = 0.006, pan = 0 } = {}) {
    const fm = VOW[vowel] || VOW.ah;
    const env = eng.gain(0), sum = eng.gain(1);
    const t1 = t + dur;
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(amp, t + attack); env.gain.setValueAtTime(amp, Math.max(t + attack, t1 - release * 0.3)); env.gain.linearRampToValueAtTime(0, t1 + release);
    const oscs = [];
    for (const det of [-9, 8]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det + rnd(-3, 3);
      o.connect(sum); oscs.push(o);
    }
    const lfo = ctx.createOscillator(), lg = eng.gain(f * vibDepth); lfo.frequency.value = vib + rnd(-0.5, 0.5); lfo.connect(lg);
    for (const o of oscs) lg.connect(o.frequency);
    [[fm[0], 6, 1], [fm[1], 8, 0.55], [fm[2], 10, 0.25]].forEach(([ff, q, a]) => {
      const bp = eng.filter('bandpass', ff, q), ga = eng.gain(a);
      sum.connect(bp); bp.connect(ga); ga.connect(env);
    });
    env.connect(eng.stereoPan(dest, pan));
    for (const n of [...oscs, lfo]) { n.start(t); n.stop(t1 + release + 0.1); }
  }

  function breathIn(dest, t, dur = 1.2, g = 0.18) {
    const s = ctx.createBufferSource(); s.buffer = eng.noiseBuf('pink');
    const bp = eng.filter('bandpass', 500, 0.9), e = eng.gain(0);
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(2600, t + dur);
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + dur * 0.85); e.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(bp); bp.connect(e); e.connect(dest); s.start(t, Math.random() * 2, dur + 0.1);
  }

  /** Струнный скрежет sul ponticello. */
  function scrape(dest, t, g = 0.05) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const f = rnd(300, 520);
    o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * rnd(0.94, 1.08), t + 3);
    const hp = eng.filter('highpass', 1800, 0.8), bp = eng.filter('bandpass', 3400, 4), e = eng.gain(0);
    e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(g, t + 1.4); e.gain.linearRampToValueAtTime(0, t + 3.2);
    o.connect(hp); hp.connect(bp); bp.connect(e); e.connect(dest); o.start(t); o.stop(t + 3.3);
  }

  // Общие фильтры инструментов (создаются на состояние).
  function oudBus(dest) {
    const pk = eng.filter('peaking', 240, 1.1, 5), lp = eng.filter('lowpass', 3600, 0.7), g = eng.gain(1);
    pk.connect(lp); lp.connect(g); g.connect(dest); eng.send(g, 0.28);
    return pk;
  }
  function qanunBus(dest) {
    const hp = eng.filter('highpass', 260, 0.7), pk = eng.filter('peaking', 2100, 1.2, 3), g = eng.gain(1);
    hp.connect(pk); pk.connect(g); g.connect(dest); eng.send(g, 0.4);
    return hp;
  }
  /** Постоянный осциллятор: возвращает {stop}. */
  function hold(dest, type, f, g, detune = 0) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune;
    const gn = eng.gain(g); o.connect(gn); gn.connect(dest); o.start();
    return { o, g: gn };
  }

  // ======================= Состояния =======================
  // Каждое: create(out) → { tick(now, st), dispose(), [extra] }; out — выходной узел состояния.
  const factories = {
    Silence() { return { tick() {}, dispose() {} }; },

    DesertCalm(out) {
      const pad = eng.gain(1); pad.connect(out); eng.send(pad, 0.35);
      const holds = [hold(pad, 'sine', mtof(38), 0.1), hold(pad, 'sine', mtof(45), 0.05, 4), hold(pad, 'triangle', mtof(26), 0.05)];
      // медленное «дыхание» дрона
      const lfo = ctx.createOscillator(), lg = eng.gain(0.03); lfo.frequency.value = 0.07; lfo.connect(lg); lg.connect(holds[0].g.gain); lfo.start();
      let nextPhrase = T() + 4, nextDrum = T() + rnd(8, 14);
      const phrases = [
        [[0, 2.2], [1, 1.4], [2, 1.2], [3, 1.6], [4, 3.2]],
        [[0, 1.6], [2, 1.8], [1, 1.4], [3, 3.0]],
        [[1, 1.4], [2, 1.6], [3, 1.4], [4, 1.4], [3, 1.4], [4, 3.6]],
      ];
      return {
        tick(now) {
          if (now + 0.5 > nextPhrase) {
            let t = Math.max(nextPhrase, now);
            const ph = pickOne(phrases);
            const shift = Math.random() < 0.35 ? 0.5 : 1; // иногда октавой ниже
            for (const [i, d] of ph) { reed(pad, t, THEME[i] * shift, d * 0.95, rnd(0.8, 1)); t += d * 0.9; }
            nextPhrase = t + rnd(8, 17);
          }
          if (now + 0.3 > nextDrum) { drum(pad, Math.max(now, nextDrum), rnd(0.25, 0.45)); nextDrum = now + rnd(11, 26); }
        },
        dispose() { holds.forEach((h) => h.o.stop()); lfo.stop(); },
      };
    },

    DesertDrone(out) {
      const pad = eng.gain(1); pad.connect(out); eng.send(pad, 0.4);
      // Горловой (обертоновый) дрон: пила 55 Гц через узкие форманты, F2 «поёт» мелодию по гармоникам.
      const f0 = 55;
      const saw = ctx.createOscillator(); saw.type = 'sawtooth'; saw.frequency.value = f0;
      const saw2 = ctx.createOscillator(); saw2.type = 'sawtooth'; saw2.frequency.value = f0; saw2.detune.value = 6;
      const src = eng.gain(0.5); saw.connect(src); saw2.connect(src);
      const lowF = eng.filter('lowpass', 500, 0.7), lg = eng.gain(0.5); src.connect(lowF); lowF.connect(lg); lg.connect(pad);
      const f1 = eng.filter('bandpass', 340, 8), g1 = eng.gain(0.9);
      const f2 = eng.filter('bandpass', 880, 28), g2 = eng.gain(1.6);
      const f3 = eng.filter('bandpass', 2900, 12), g3 = eng.gain(0.4);
      [[f1, g1], [f2, g2], [f3, g3]].forEach(([f, g]) => { src.connect(f); f.connect(g); g.connect(pad); });
      saw.start(); saw2.start();
      const harm = [8, 10, 12, 9, 11, 14, 12, 10]; let hi = 0, nextH = 0;
      // «ветры»: обертоновые синусы с блуждающей громкостью
      const winds = [11, 13, 17].map((k) => { const h = hold(pad, 'sine', f0 * k, 0.0, rnd(-8, 8)); return h; });
      let nextW = 0, nextDrum = T() + rnd(5, 9);
      return {
        tick(now) {
          if (now > nextH) { f2.frequency.setTargetAtTime(f0 * harm[hi++ % harm.length], now, 0.35); nextH = now + rnd(2.5, 6); }
          if (now > nextW) { winds.forEach((w) => w.g.gain.setTargetAtTime(rnd(0, 0.02), now, 1.5)); nextW = now + rnd(3, 6); }
          if (now + 0.3 > nextDrum) { drum(pad, Math.max(now, nextDrum), rnd(0.12, 0.22)); nextDrum = now + rnd(6, 12); }
        },
        dispose() { saw.stop(); saw2.stop(); winds.forEach((w) => w.o.stop()); },
      };
    },

    WormThreat(out) {
      const pad = eng.gain(1); pad.connect(out);
      const sub1 = hold(pad, 'sine', 22, 0.0), sub2 = hold(pad, 'sine', 44, 0.0, 5), mid = hold(pad, 'sine', 58, 0.0, -6);
      let nextStep = T() + 0.4, step = 0, nextScrape = T() + rnd(4, 8);
      const cycle = [5, 7]; let cyc = 0, pos = 0;
      return {
        tick(now) {
          const th = clamp(game.worm?.threat ?? 0.35, 0, 1);
          sub1.g.gain.setTargetAtTime(0.2 * Math.pow(0.4 + th, 0.7), now, 0.4);
          sub2.g.gain.setTargetAtTime(0.11 * (0.3 + th), now, 0.4);
          mid.g.gain.setTargetAtTime(0.05 * th, now, 0.4);
          const bpm = 70 + 25 * th, unit = 60 / bpm / 2;
          while (now + 0.4 > nextStep) {
            // ломаный ритм 5+7/8 с выпадениями; при слабой угрозе (Listening) барабана почти нет
            const accent = pos === 0;
            if (th > 0.22 && Math.random() > (0.28 - th * 0.15)) drum(pad, nextStep, (accent ? 0.7 : 0.35) * (0.5 + th * 0.6), accent || Math.random() < 0.4 ? 'doum' : 'tek');
            pos++;
            if (pos >= cycle[cyc % 2]) { pos = 0; cyc++; }
            nextStep += unit * (Math.random() < 0.06 ? 1.5 : 1);
            step++;
          }
          if (now > nextScrape && th > 0.4) { scrape(pad, now + 0.05, 0.05 * th); nextScrape = now + rnd(5, 11); }
        },
        dispose() { sub1.o.stop(); sub2.o.stop(); mid.o.stop(); },
      };
    },

    // Прибытие приручённого червя: величественная, благоговейная тема (медленное нарастание хора на открытых квинтах,
    // низкая медь-подобная тема, редкий рамочный барабан). Без удара и без атаки — это явление, а не нападение.
    WormReveal(out) {
      const pad = eng.gain(1); pad.connect(out); eng.send(pad, 0.7);
      const born = T();
      const sub = hold(pad, 'sine', mtof(26), 0.0), sub2 = hold(pad, 'sine', mtof(38), 0.0, 3);
      const chords = [[-24, -17, -12, -5, 0], [-26, -19, -14, -7, -2], [-24, -17, -12, -5, 3], [-24, -17, -12, -5, 0]];
      let ci = 0, nextChord = born + 0.1, nextBeat = born + 3, beat = 0, nextTheme = born + 11, nextRise = born + 5;
      breathIn(pad, born + 0.1, 3.5, 0.1);
      return {
        tick(now) {
          const inten = clamp((now - born) / 16, 0, 1);
          sub.g.gain.setTargetAtTime(0.03 + inten * 0.09, now, 1.2);
          sub2.g.gain.setTargetAtTime(0.02 + inten * 0.05, now, 1.2);
          if (now + 0.5 > nextChord) {
            const c = chords[ci++ % chords.length], t = Math.max(now, nextChord);
            c.forEach((s, i) => voice(pad, t + i * 0.35, mtof(D4 + s), 11, s >= -12 ? (i % 2 ? 'oh' : 'ah') : 'oo', (0.05 + inten * 0.05) * (s < -12 ? 1.2 : 1), { attack: 3.6, release: 4.5, vibDepth: 0.004, vib: 4.8, pan: (i - 2) * 0.22 }));
            nextChord = t + 8.5;
          }
          if (now + 0.3 > nextRise && inten < 1) { breathIn(pad, Math.max(now, nextRise), 3, 0.05 + inten * 0.06); nextRise = now + 6.5; }
          // рамочный барабан — медленный пульс, редкие «дум»
          if (now + 0.3 > nextBeat) {
            if (beat % 4 !== 3) drum(pad, Math.max(now, nextBeat), 0.2 + inten * 0.35, 'doum');
            beat++; nextBeat += 1.75;
          }
          // тема Ракиса низкими «оо», медленно — как церемониальное приветствие
          if (now + 0.3 > nextTheme && inten > 0.55) {
            let t = Math.max(now, nextTheme);
            const lp = eng.filter('lowpass', 900, 0.6); lp.connect(pad);
            THEME.forEach((f, i) => { const d = [3, 2.6, 2.6, 3, 6][i]; voice(lp, t, f * 0.5, d, i % 2 ? 'oh' : 'oo', 0.06 + inten * 0.03, { attack: 0.9, release: 1.8, vib: 4.6, vibDepth: 0.006 }); t += d * 0.9; });
            nextTheme = t + 14;
          }
        },
        dispose() { sub.o.stop(); sub2.o.stop(); },
      };
    },

    // Разговор с наездниками: низкий хор «оо» на дроне + редкий рамочный барабан, дудук вдалеке. Тихо, чтобы не перекрывать речь.
    Encounter(out) {
      const pad = eng.gain(1); pad.connect(out); eng.send(pad, 0.75);
      const born = T();
      const d1 = hold(pad, 'sine', mtof(38), 0.05), d2 = hold(pad, 'sine', mtof(45), 0.02, 4), d3 = hold(pad, 'triangle', mtof(26), 0.035);
      const lfo = ctx.createOscillator(), lg = eng.gain(0.015); lfo.frequency.value = 0.06; lfo.connect(lg); lg.connect(d1.g.gain); lfo.start();
      const notes = [[-24, -17, -12], [-24, -17, -10], [-26, -19, -12], [-24, -17, -12]];
      let ci = 0, nextChord = born + 0.2, nextBeat = born + 1.2, beat = 0, nextReed = born + rnd(14, 22);
      return {
        tick(now) {
          if (now + 0.5 > nextChord) {
            const c = notes[ci++ % notes.length], t = Math.max(now, nextChord);
            c.forEach((s, i) => voice(pad, t + i * 0.4, mtof(D4 + s), 12, 'oo', 0.05, { attack: 4, release: 5, vibDepth: 0.003, vib: 4.4, pan: (i - 1) * 0.3 }));
            nextChord = t + 9.5;
          }
          if (now + 0.3 > nextBeat) {
            const k = beat++ % 8;
            if (k === 0 || k === 3 || k === 5) drum(pad, Math.max(now, nextBeat), 0.3, 'doum');
            else if (k === 6 && Math.random() < 0.5) drum(pad, Math.max(now, nextBeat), 0.18, 'tek');
            nextBeat += 1.2;
          }
          if (now + 0.5 > nextReed) {
            let t = Math.max(now, nextReed);
            const g = eng.gain(0.6); g.connect(pad);
            pickOne([[4, 3, 4], [3, 2, 3, 4]]).forEach((i, k) => { const d = [1.8, 1.6, 2.2, 3][k] || 2; reed(g, t, THEME[i % THEME.length] * 0.5, d, 0.6); t += d * 0.9; });
            nextReed = t + rnd(18, 30);
          }
        },
        dispose() { d1.o.stop(); d2.o.stop(); d3.o.stop(); lfo.stop(); },
      };
    },

    SietchLife(out) {
      const pad = eng.gain(1); pad.connect(out);
      const oud = oudBus(pad), qan = qanunBus(pad);
      const beat = 60 / 84, eighth = beat / 2;
      let nextStep = T() + 0.5, i8 = 0, bar = 0, nextTrem = T() + rnd(5, 9), nextVoc = T() + rnd(12, 20), themeBar = 5 + ((Math.random() * 4) | 0);
      // арпеджио-шаблоны (ступени относительно текущего корня)
      const patterns = [[0, 2, 4, 2, 5, 4, 2, 0], [0, 4, 2, 4, 6, 4, 2, 4], [4, 2, 0, 2, 4, 7, 6, 4], [0, 2, 3, 2, 4, 2, 0, -1]];
      let pat = patterns[0];
      const roots = [0, 0, 1, 0]; // D D E D ступенчато
      return {
        tick(now) {
          while (now + 0.45 > nextStep) {
            const k = i8 % 8, t = nextStep;
            if (k === 0) { pat = pickOne(patterns); bar++; }
            const root = roots[bar % 4];
            if (k === 0 || k === 4) pluck(oud, t, degFreq(root - 7), 0.9, { bright: 0.35, dur: 1.8 });   // бас
            if (Math.random() > 0.2) pluck(oud, t + (k % 2 ? rnd(0, 0.012) : 0), degFreq(pat[k] + root), k % 4 === 0 ? 0.8 : 0.5, { bright: 0.5, dur: 1.2, pan: rnd(-0.2, 0.2) });
            // барабан: «дум» на 1 и 3.5, «тек» на 2 и 4
            if (k === 0 || k === 5) drum(pad, t, 0.5, 'doum'); else if (k === 2 || k === 6) drum(pad, t, 0.35, 'tek');
            // обрывок темы у уда
            if (k === 0 && bar === themeBar) THEME.forEach((f, n) => pluck(oud, t + 0.1 + n * eighth * 1.5, f * 0.5, 0.9, { bright: 0.45, dur: 1.6, pan: -0.1 }));
            i8++; nextStep += eighth;
          }
          if (now + 0.3 > nextTrem) { // тремоло кануна
            const f = degFreq(pickOne([4, 5, 7, 9, 2]), D4 + 12), t = Math.max(now, nextTrem), n = 12 + ((Math.random() * 10) | 0);
            for (let j = 0; j < n; j++) pluck(qan, t + j * 0.075, f, 0.22 * (1 - j / (n * 1.4)), { bright: 0.8, dur: 0.7, pan: 0.35 });
            nextTrem = now + rnd(6, 13);
          }
          if (now + 0.3 > nextVoc) { // женский вокализ издали
            const f = degFreq(pickOne([4, 5, 7]), D4 + 12), t = Math.max(now, nextVoc);
            const lp = eng.filter('lowpass', 1600, 0.6); lp.connect(pad); eng.send(lp, 0.9);
            voice(lp, t, f, 4.5, 'ah', 0.035, { attack: 1.5, release: 2.5, pan: 0.4 });
            nextVoc = now + rnd(22, 38);
          }
        },
        dispose() {},
      };
    },

    SietchNarrow(out) {
      const pad = eng.gain(1); pad.connect(out);
      const qan = qanunBus(pad), oud = oudBus(pad);
      const low = hold(pad, 'sawtooth', mtof(38), 0.0);
      const lp = eng.filter('lowpass', 280, 0.8); low.g.disconnect(); low.g.connect(lp); lp.connect(pad);
      const lfo = ctx.createOscillator(), lg = eng.gain(0.012); lfo.frequency.value = 0.09; lfo.connect(lg); lg.connect(low.g.gain); lfo.start();
      low.g.gain.value = 0.03;
      let nextTrem = T() + 1.5, nextLow = T() + 3, nextVoc = T() + rnd(15, 25);
      return {
        tick(now) {
          if (now + 0.3 > nextTrem) {
            const f = degFreq(pickOne([0, 2, 3, 4]), D4 + 12), t = Math.max(now, nextTrem), n = 10 + ((Math.random() * 8) | 0);
            for (let j = 0; j < n; j++) pluck(qan, t + j * 0.085, f, 0.17 * Math.sin(Math.PI * (j + 1) / (n + 1)) + 0.04, { bright: 0.75, dur: 0.6, pan: rnd(-0.2, 0.3) });
            nextTrem = now + rnd(3, 6);
          }
          if (now + 0.3 > nextLow) { pluck(oud, Math.max(now, nextLow), degFreq(pickOne([-7, -7, -5]), D4), 0.7, { bright: 0.3, dur: 2.2 }); nextLow = now + rnd(5, 9); }
          if (now + 0.3 > nextVoc) {
            const g = eng.filter('lowpass', 1200, 0.5); g.connect(pad); eng.send(g, 0.95);
            voice(g, Math.max(now, nextVoc), degFreq(pickOne([4, 5]), D4 + 12), 5, 'oo', 0.022, { attack: 2, release: 3 });
            nextVoc = now + rnd(25, 40);
          }
        },
        dispose() { low.o.stop(); lfo.stop(); },
      };
    },

    HallChorale(out) {
      const pad = eng.gain(1); pad.connect(out); eng.send(pad, 0.9);
      const born = T();
      const sub = hold(pad, 'sine', mtof(26), 0.0), sub2 = hold(pad, 'sine', mtof(38), 0.0, 3);
      const chords = [[0, 7, 12, 15], [0, 6, 12, 14], [-2, 5, 12, 15], [0, 7, 12, 15]];
      let nextChord = T() + 0.4, ci = 0, nextLead = T() + 14, ending = false;
      const tryChord = (t, c, amp, len, n) => {
        c.slice(0, n).forEach((s, i) => {
          const f = mtof(D4 - 12 + s);
          const high = s >= 12;
          voice(pad, t + i * 0.3, f, len, high ? 'ah' : 'oh', amp * (high ? 0.8 : 1), { attack: 3, release: 4, vibDepth: 0.004, pan: (i - 1.5) * 0.25 });
        });
      };
      const api = {
        finalChord(t) {
          ending = true;
          pad.gain.cancelScheduledValues(t); pad.gain.setTargetAtTime(0, t + 1.2, 2.5);
          const fin = eng.gain(1); fin.connect(out); eng.send(fin, 1);
          // Финальный аккорд: тяжёлый, широкий, 12 с, + саб-удар
          [-24, -12, -5, 0, 3, 7, 12, 15, 19].forEach((s, i) => {
            const f = mtof(D4 + s);
            voice(fin, t + i * 0.02, f, 8, s >= 0 ? 'ah' : 'oh', 0.12, { attack: 0.5, release: 4, vibDepth: 0.003, pan: (i - 4) * 0.12 });
          });
          eng.blip({ freq: 73, freq1: 36.7, dur: 4, gain: 0.55, out: fin, attack: 0.05 });
          fin.gain.setValueAtTime(1, t + 10); fin.gain.linearRampToValueAtTime(0, t + 14);
        },
        tick(now) {
          if (ending) return;
          const inten = clamp((now - born) / 150, 0, 1); // нарастание за 2:30
          sub.g.gain.setTargetAtTime(0.03 + inten * 0.07, now, 1);
          sub2.g.gain.setTargetAtTime(0.02 + inten * 0.04, now, 1);
          if (now + 0.5 > nextChord) {
            const c = chords[ci++ % chords.length], n = 3 + Math.round(inten * 2);
            tryChord(Math.max(now, nextChord), c, 0.045 + inten * 0.06, 15, Math.min(4, n));
            nextChord = now + rnd(9.5, 12);
          }
          if (now + 0.3 > nextLead) {
            // женский вокализ: тема в верхнем регистре, с вибрато
            let t = Math.max(now, nextLead);
            const lp = eng.filter('lowpass', 2600, 0.6); lp.connect(pad);
            THEME.forEach((f, i) => { const d = [2.4, 2, 2, 2.4, 5][i]; voice(lp, t, f * 2, d, i % 2 ? 'ah' : 'eh', 0.05 + inten * 0.03, { attack: 0.5, release: 1.2, vib: 5.6, vibDepth: 0.009 }); t += d * 0.92; });
            nextLead = t + rnd(8, 14);
          }
        },
        dispose() { sub.o.stop(); sub2.o.stop(); },
      };
      return api;
    },
  };

  // ======================= Управление состояниями =======================
  let cur = null;                // {name, node, impl, born}
  const fading = new Set();
  let timer = null, wanted = null;

  function setState(name) {
    if (!factories[name]) { console.warn(`[audio] неизвестное музыкальное состояние '${name}'`); return; }
    if (cur?.name === name) return;
    const t = T();
    const [inT] = FADES[name] || [3, 3];
    if (cur) {
      const [, outT] = FADES[cur.name];
      const old = cur;
      old.node.gain.cancelScheduledValues(t);
      old.node.gain.setValueAtTime(old.node.gain.value, t);
      old.node.gain.linearRampToValueAtTime(0, t + Math.max(outT, 0.8));
      fading.add(old);
      setTimeout(() => { try { old.impl.dispose(); } catch { /* уже остановлен */ } try { old.node.disconnect(); } catch { /* нет */ } fading.delete(old); }, (outT + 1) * 1000 + 300);
    }
    const node = eng.gain(0);
    node.connect(musicBus);
    node.gain.setValueAtTime(0, t);
    node.gain.linearRampToValueAtTime(name === 'Silence' ? 0 : volOf(name), t + Math.max(inT, 0.05));
    const impl = factories[name](node);
    cur = { name, node, impl, born: t };
    game.bus.emit('music', { state: name });
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      if (!eng.running) return;
      const now = T();
      try { cur?.impl.tick(now); } catch (e) { console.error('[audio] музыка:', e); }
    }, 90);
  }

  return {
    start,
    set(name) { wanted = name; setState(name); start(); },
    get state() { return cur?.name ?? 'Silence'; },
    finalChord() {
      const t = T() + 0.05;
      if (cur?.name === 'HallChorale' && cur.impl.finalChord) cur.impl.finalChord(t);
      else { // стингер вне зала (отладка)
        const tmp = eng.gain(1); tmp.connect(musicBus); eng.send(tmp, 1);
        [-12, 0, 7, 12, 15].forEach((s, i) => voice(tmp, t + i * 0.02, mtof(D4 + s), 6, 'ah', 0.12, { attack: 0.5, release: 4 }));
      }
    },
    /** Отход червя: прощальное нарастание хора (стингер поверх текущего состояния). */
    swell() {
      const t = T() + 0.05;
      const tmp = eng.gain(0); tmp.connect(musicBus); eng.send(tmp, 1);
      tmp.gain.setValueAtTime(0, t); tmp.gain.linearRampToValueAtTime(1, t + 4.5); tmp.gain.setValueAtTime(1, t + 5.5); tmp.gain.linearRampToValueAtTime(0, t + 11);
      [-24, -17, -12, -5, 0, 7, 12].forEach((s, i) => voice(tmp, t + i * 0.25, mtof(D4 + s), 7, s >= 0 ? 'ah' : 'oh', 0.07, { attack: 4, release: 4, vibDepth: 0.004, vib: 4.9, pan: (i - 3) * 0.2 }));
      eng.blip({ freq: 36.7, freq1: 30, dur: 7, gain: 0.3, out: tmp, attack: 3 });
      breathIn(tmp, t, 4, 0.1);
      setTimeout(() => { try { tmp.disconnect(); } catch { /* нет */ } }, 14000);
    },
    /** Тема Ракиса — для отладки/стингеров. */
    stinger(kind) {
      const t = T() + 0.02;
      if (kind === 'breath') breathIn(musicBus, t, 1.0, 0.14);
    },
    dispose() { clearInterval(timer); timer = null; },
  };
}
