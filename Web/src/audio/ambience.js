// Эмбиент: ветер с порывами (по weather.windSpeed/storm), шорох песка, «пение» дюн, далёкая буря;
// в сиетче — гул толпы (формантный шум), капли, гул светошаров, хлопки ткани, шорох зала.
import { clamp, lerp } from '../core/util.js';

/** Профили зон: ветер, интерьерные слои, реверберация. */
const ENV = {
  A1_Ridge: { wind: 1, dune: 0, rev: 'desert', lp: 20000 },
  A2_Erg: { wind: 0.9, dune: 1, rev: 'desert', lp: 20000 },
  A3_Approach: { wind: 1, dune: 0, rev: 'desert', lp: 20000 },
  A4_Crevice: { wind: 0.3, drip: 0.5, hum: 0.15, rev: 'cistern', lp: 6000 },
  B1_Airlock: { wind: 0.05, hum: 0.5, murmur: 0.1, drip: 0.6, rev: 'sietch', lp: 9000 },
  B2_Gallery: { wind: 0, hum: 0.8, murmur: 0.55, drip: 0.2, cloth: 0.6, rev: 'sietch', lp: 11000 },
  B3_Passages: { wind: 0, hum: 0.5, murmur: 0.14, drip: 0.4, cloth: 0.7, rev: 'sietch', lp: 8000 },
  B4_Cistern: { wind: 0, hum: 0.25, murmur: 0.03, drip: 1, rev: 'cistern', lp: 8000 },
  B5_Hall: { wind: 0, hum: 0.4, murmur: 0.38, rustle: 0.6, rev: 'hall', lp: 12000 },
};
// Гласные для «толпы»: (F1, F2) Гц.
const VOWELS = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1720]];

export function createAmbience(game, eng) {
  const { ctx, bus } = eng;
  const out = bus.amb;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- Ветер ----------
  const windOut = eng.gain(1); windOut.connect(out);
  const mkBand = (kind, f, q, pan) => {
    const s = eng.loopNoise(kind), bp = eng.filter('bandpass', f, q), g = eng.gain(0);
    s.connect(bp); bp.connect(g); g.connect(eng.stereoPan(windOut, pan));
    return { bp, g };
  };
  const wA = mkBand('pink', 400, 0.6, -0.6);
  const wB = mkBand('pink', 650, 0.7, 0.6);
  const wW = mkBand('white', 1700, 7, 0);     // свист по кромке
  const wS = mkBand('white', 4200, 0.5, 0);   // шорох песка
  // Далёкая буря: низкий гул.
  const stormSrc = eng.loopNoise('brown'), stormLP = eng.filter('lowpass', 110, 0.7), stormG = eng.gain(0);
  stormSrc.connect(stormLP); stormLP.connect(stormG); stormG.connect(out);
  // «Пение» дюн в эрге: тональный гул 70–110 Гц (очень тихо).
  const duneG = eng.gain(0); duneG.connect(out);
  for (const [f, d] of [[78, -4], [92, 3], [110, 7]]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = d;
    const lfo = ctx.createOscillator(), lg = eng.gain(0.15); lfo.frequency.value = rnd(0.05, 0.12); lfo.connect(lg);
    const og = eng.gain(0.4); lg.connect(og.gain); o.connect(og); og.connect(duneG); o.start(); lfo.start();
  }

  let gust = 1, nextGust = 0;
  const env = { wind: 1, dune: 0, hum: 0, murmur: 0, drip: 0, cloth: 0, rustle: 0 };

  // ---------- Сиетч: комнатный тон, гул светошаров ----------
  const roomSrc = eng.loopNoise('brown'), roomLP = eng.filter('lowpass', 180, 0.6), roomG = eng.gain(0);
  roomSrc.connect(roomLP); roomLP.connect(roomG); roomG.connect(out);
  const humG = eng.gain(0); humG.connect(out); eng.send(humG, 0.2);
  for (const [f, d, a] of [[110, 0, 0.5], [110.8, 0, 0.5], [220.5, 4, 0.18], [331, -3, 0.06]]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = d;
    const g = eng.gain(a); o.connect(g); g.connect(humG); o.start();
  }
  // Шорох зала / песка в луче: тихий «сыпучий» хай-фай.
  const rustleSrc = eng.loopNoise('white'), rustleHP = eng.filter('highpass', 5200, 0.5), rustleG = eng.gain(0);
  rustleSrc.connect(rustleHP); rustleHP.connect(rustleG); rustleG.connect(out); eng.send(rustleG, 0.4);

  // ---------- Гул толпы (walla): 5 «голосов» с формантами и слоговой модуляцией ----------
  const murmurOut = eng.gain(0); murmurOut.connect(out); eng.send(murmurOut, 0.45);
  const murmurLP = eng.filter('lowpass', 3800, 0.5); murmurLP.connect(murmurOut);
  const voices = [];
  for (let i = 0; i < 5; i++) {
    const s = eng.loopNoise('pink');
    const f1 = eng.filter('bandpass', 700, 6), f2 = eng.filter('bandpass', 1200, 8);
    const g = eng.gain(0), g1 = eng.gain(1), g2 = eng.gain(0.6);
    s.connect(f1); s.connect(f2); f1.connect(g1); f2.connect(g2); g1.connect(g); g2.connect(g);
    g.connect(eng.stereoPan(murmurLP, rnd(-0.8, 0.8)));
    voices.push({ f1, f2, g, base: rnd(0.6, 1.2), next: 0, shift: rnd(0.85, 1.25) });
  }
  function stepVoices(t) {
    for (const v of voices) {
      if (t < v.next) continue;
      v.next = t + rnd(0.12, 0.45);
      const vow = VOWELS[(Math.random() * VOWELS.length) | 0];
      v.f1.frequency.setTargetAtTime(vow[0] * v.shift, t, 0.03);
      v.f2.frequency.setTargetAtTime(vow[1] * v.shift, t, 0.03);
      // паузы между «фразами»: часть слогов тихие
      v.g.gain.setTargetAtTime(Math.random() < 0.3 ? 0.002 : v.base * rnd(0.3, 1) * 0.05, t, 0.05);
    }
  }

  // ---------- Капли, ткань: случайные события ----------
  let nextDrip = 0, nextCloth = 0, dripPos = null;
  function drip(t) {
    const f = rnd(850, 2600);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * rnd(1.15, 1.5), t + 0.05);
    const g = eng.gain(0);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(rnd(0.05, 0.11), t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(eng.stereoPan(out, rnd(-0.9, 0.9))); eng.send(g, 0.9);
    o.start(t); o.stop(t + 0.25);
  }
  function clothFlap(t) {
    const pan = rnd(-0.9, 0.9);
    for (let i = 0; i < 2 + ((Math.random() * 3) | 0); i++) {
      eng.burst({ type: 'bandpass', f0: rnd(260, 420), f1: rnd(180, 300), q: 0.9, dur: rnd(0.12, 0.25), attack: 0.03, gain: rnd(0.025, 0.06), kind: 'pink', out: eng.stereoPan(out, pan), when: t + i * rnd(0.12, 0.2), send: 0.25 });
    }
  }

  // ---------- Хоровой напев «ру… ру…» (зал) ----------
  function chant(seconds = 4) {
    const t0 = eng.T() + 0.05;
    const dest = eng.gain(0); dest.connect(out); eng.send(dest, 0.9);
    dest.gain.setValueAtTime(0, t0); dest.gain.linearRampToValueAtTime(0.5, t0 + 0.4);
    dest.gain.setValueAtTime(0.5, t0 + seconds - 0.6); dest.gain.linearRampToValueAtTime(0, t0 + seconds);
    const f0 = [98, 110, 123, 131, 87, 104];
    for (const f of f0) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = rnd(-14, 14);
      const lp = eng.filter('lowpass', 520, 0.8), vow = eng.filter('bandpass', 330, 3);
      const am = eng.gain(0);
      // ритм «ру — ру — ру»: ~1.5 Гц, мягкие пульсации
      for (let k = 0; k < seconds * 1.6; k++) {
        const tt = t0 + k / 1.6;
        am.gain.setValueAtTime(0.02, tt); am.gain.linearRampToValueAtTime(0.18, tt + 0.12); am.gain.linearRampToValueAtTime(0.03, tt + 0.5);
      }
      o.connect(lp); lp.connect(vow); vow.connect(am); am.connect(dest);
      o.start(t0); o.stop(t0 + seconds + 0.1);
    }
  }

  // ---------- Ночная пустыня: насекомых в глубокой пустыне нет — ветер, далёкие осыпи, холодный треск песка ----------
  let nextSlide = 0, nextCrackle = 0;
  function sandSlide(t) {
    const pan = rnd(-0.9, 0.9), dur = rnd(2.5, 5.5);
    eng.burst({ type: 'lowpass', f0: rnd(260, 420), f1: rnd(90, 150), q: 0.7, dur, attack: dur * 0.35, gain: rnd(0.05, 0.1) * 3, kind: 'brown', out: eng.stereoPan(out, pan), when: t, send: 0.5 });
    eng.burst({ type: 'bandpass', f0: rnd(1400, 2400), f1: rnd(700, 1100), q: 0.8, dur: dur * 0.8, attack: dur * 0.3, gain: rnd(0.008, 0.02), kind: 'pink', out: eng.stereoPan(out, pan), when: t + 0.05, send: 0.4 });
  }
  function coldCrackle(t) {
    const n = 1 + ((Math.random() * 4) | 0), pan = rnd(-0.8, 0.8);
    for (let i = 0; i < n; i++) eng.burst({ type: 'bandpass', f0: rnd(2800, 6200), q: rnd(3, 7), dur: rnd(0.012, 0.03), attack: 0.001, gain: rnd(0.012, 0.035), kind: 'white', out: eng.stereoPan(out, pan + rnd(-0.1, 0.1)), when: t + i * rnd(0.03, 0.18), send: 0.3 });
  }
  /** 0..1: глубокая ночь по часам погоды (плавные края на рассвете и закате). */
  function nightAmount() {
    const w = game.weather;
    const h = typeof w?.getHours === 'function' ? w.getHours() : w?.hours;
    if (typeof h !== 'number') return 0;
    const x = ((h % 24) + 24) % 24;
    const sm = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    return x < 12 ? 1 - sm(4.6, 6.2, x) : sm(18.2, 19.8, x);
  }

  // ---------- Обновление ----------
  const api = {
    chant,
    /** Звуковой «порыв» по событию Wind.Gust. */
    gustNow() { gust = 1.8; },
    update(dt, t) {
      const w = game.weather;
      const zone = game.space === 'sietch' && !(game.zone || '').startsWith('B') ? 'B1_Airlock' : (game.zone || 'A1_Ridge');
      const prof = ENV[zone] || ENV.A1_Ridge;
      const e = { wind: prof.wind ?? 0, dune: prof.dune ?? 0, hum: prof.hum ?? 0, murmur: prof.murmur ?? 0, drip: prof.drip ?? 0, cloth: prof.cloth ?? 0, rustle: prof.rustle ?? 0 };
      const k = 1 - Math.exp(-dt / 0.8);
      for (const key of Object.keys(env)) env[key] = lerp(env[key], e[key], k);
      eng.setReverb(prof.rev);
      // буря глушит верха: песок в воздухе
      eng.ramp(eng.masterLP.frequency, game.paused ? 700 : prof.lp * (1 - 0.5 * clamp(game.weather?.storm ?? 0, 0, 1) * (prof.wind > 0.2 ? 1 : 0)), 0.4);

      const ws = clamp(w?.windSpeed ?? 4, 0, 24), storm = clamp(w?.storm ?? 0, 0, 1);
      const now = eng.T();
      if (now > nextGust) {
        gust = rnd(0.55, 1.5) * (1 + storm * 0.6);
        nextGust = now + rnd(1.4, 5);
      }
      const night = game.space === 'desert' ? nightAmount() : 0;
      const K = 4; // шумовые полосы после фильтров тихие — компенсируем усилением (замер: ~-36 дБFS при 5 м/с)
      const base = (0.03 + 0.42 * Math.pow(ws / 16, 1.4)) * env.wind * K * (1 + 0.25 * night);
      const gg = base * gust;
      eng.ramp(wA.g.gain, gg, 0.9); eng.ramp(wB.g.gain, gg * 0.85, 1.1);
      eng.ramp(wA.bp.frequency, 240 + ws * 26, 0.8); eng.ramp(wB.bp.frequency, 420 + ws * 38, 0.8);
      eng.ramp(wW.g.gain, 0.012 * K * Math.pow(ws / 12, 2) * gust * env.wind * (1 + storm * 2.5), 0.8);
      eng.ramp(wW.bp.frequency, 1300 + ws * 70 + gust * 120, 0.7);
      const sandy = (game.player?.sandWalking ? 0.5 : 0) + ws / 24;
      eng.ramp(wS.g.gain, (0.004 + 0.02 * sandy * gust) * env.wind * 6 * (1 + storm * 4.5) * (1 - 0.5 * night), 0.7);
      eng.ramp(stormG.gain, storm * 0.32 * 2.5 * (env.wind > 0.2 ? 1 : 0.2), 1.5);
      eng.ramp(duneG.gain, 0.012 * env.dune * (1 - clamp(ws / 14, 0, 0.6)), 1.5);

      eng.ramp(roomG.gain, 0.1 * Math.min(1, env.hum + env.murmur), 0.8);
      eng.ramp(humG.gain, 0.034 * env.hum, 0.8);
      eng.ramp(rustleG.gain, 0.03 * env.rustle, 1.2);
      eng.ramp(murmurOut.gain, env.murmur * (api.ritualOn ? 1.5 : 1) * 7, 0.9);
      if (env.murmur > 0.02) stepVoices(now);

      if (night > 0.2 && env.wind > 0.2) {
        if (now > nextSlide) { sandSlide(now + 0.02); nextSlide = now + rnd(11, 28) / night; }
        if (now > nextCrackle) { coldCrackle(now + 0.02); nextCrackle = now + rnd(0.7, 2.6) / night; }
      }
      if (env.drip > 0.02 && now > nextDrip) { drip(now + 0.01); nextDrip = now + rnd(1.4, 5.5) / env.drip; }
      if (env.cloth > 0.05 && now > nextCloth) { clothFlap(now + 0.01); nextCloth = now + rnd(5, 14) / env.cloth; }
    },
  };
  return api;
}
