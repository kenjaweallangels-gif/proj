// Эмбиент (Ред. 3): ветер слоями (тело, свист по кромкам скал, шипение дрейфующего песка), порывы по desert:gust, осыпи по desert:sandslide;
// сиетч — тон каменных залов (без гудения 180 Гц), далёкое бормотание толпы (шумовая текстура, не слова), стуки инструментов, капли, плеск воды, ткань;
// сад — ручей, птицы, горлицы, насекомые. Всё через шину amb; параметры пишутся только через eng.ramp/eng.setT (защита от NaN).
import { clamp, lerp, smoothstep } from '../core/util.js';
import { ENTRY, GARDEN } from '../core/layout.js';

/** Профили зон: ветер, свист (открытые кромки скал), интерьерные слои, реверберация. */
const ENV = {
  A1_Ridge: { wind: 1, whistle: 1, rev: 'desert', lp: 20000 },
  A2_Erg: { wind: 0.9, whistle: 0.25, rev: 'desert', lp: 20000 },
  A3_Approach: { wind: 1, whistle: 0.6, rev: 'desert', lp: 20000 },
  A4_Crevice: { wind: 0.7, whistle: 0.8, drip: 0.15, rev: 'desert', lp: 20000 },
  A5_Trail: { wind: 0.85, whistle: 1, rev: 'desert', lp: 20000 },
  A6_Cleft: { wind: 0.6, whistle: 0.9, drip: 0.25, rev: 'desert', lp: 20000 },
  C1_Garden: { wind: 0.22, garden: 1, rev: 'desert', lp: 20000 },
  B1_Airlock: { wind: 0.05, hum: 0.5, murmur: 0.1, drip: 0.6, work: 0.1, rev: 'sietch', lp: 9000 },
  B2_Gallery: { wind: 0, hum: 0.8, murmur: 0.55, drip: 0.2, cloth: 0.6, work: 0.7, rev: 'sietch', lp: 11000 },
  B3_Passages: { wind: 0, hum: 0.5, murmur: 0.14, drip: 0.4, cloth: 0.7, work: 0.3, rev: 'sietch', lp: 8000 },
  B4_Cistern: { wind: 0, hum: 0.25, murmur: 0.03, drip: 1, rev: 'cistern', lp: 8000 },
  B5_Hall: { wind: 0, hum: 0.4, murmur: 0.38, rustle: 0.6, work: 0.1, rev: 'hall', lp: 12000 },
  B6_Cellar: { wind: 0, hum: 0.3, murmur: 0.03, drip: 1, rev: 'cistern', lp: 6500 },
};

export function createAmbience(game, eng) {
  const { ctx, bus } = eng;
  const out = bus.amb;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const play = (n, o) => eng.playSample(n, { out, ...o });

  // ---------- Ветер: тело (шум, НЧ срезан), свист (узкие полосы), шипение песка (гранулярная текстура) ----------
  const windOut = eng.gain(1);
  const windLP = eng.filter('lowpass', 9000, 0.5);       // в сиетче ветер глохнет
  windOut.connect(windLP); windLP.connect(out);
  const mkBody = (f, pan) => {
    const s = eng.loopNoise('pink'), hp = eng.filter('highpass', 130, 0.6), lp = eng.filter('lowpass', f, 0.6), g = eng.gain(0);
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(eng.stereoPan(windOut, pan));
    return { lp, g };
  };
  const wA = mkBody(600, -0.55), wB = mkBody(1000, 0.55);
  const mkWhistle = (f, pan) => {
    const s = eng.loopNoise('white'), bp = eng.filter('bandpass', f, 26), g = eng.gain(0);
    s.connect(bp); bp.connect(g); g.connect(eng.stereoPan(windOut, pan));
    return { bp, g, f, next: 0 };
  };
  const whistles = [mkWhistle(1500, -0.4), mkWhistle(2300, 0.4)];

  let gust = 1, nextGust = 0;
  const env = { wind: 1, whistle: 0, hum: 0, murmur: 0, drip: 0, cloth: 0, rustle: 0, garden: 0, work: 0 };
  const ENV_KEYS = Object.keys(env);

  // ---------- Слои-текстуры (создаются лениво, гаснут при нулевом уровне) ----------
  const LAY = {};
  function layer(key, name, level, opts, tc, dt) {
    const e = LAY[key] || (LAY[key] = { ctl: null, idle: 0 });
    if (level > 0.004) {
      e.idle = 0;
      if (!e.ctl && eng.samplesReady) e.ctl = eng.textureLoop(name, { gain: 0, ...opts });
      e.ctl?.setGain(level, tc);
    } else if (e.ctl) {
      e.ctl.setGain(0, tc);
      if ((e.idle += dt) > 6) { e.ctl.stop(0.5); e.ctl = null; }
    }
    return e.ctl;
  }
  // Реверберирующий приёмник бормотания/комнаты (эхо залов)
  const roomOut = eng.gain(1); roomOut.connect(out); eng.send(roomOut, 0.35);
  const murmurOut = eng.gain(1); murmurOut.connect(out); eng.send(murmurOut, 0.5);

  // ---------- Случайные события сиетча ----------
  let nextDrip = 0, nextCloth = 0, nextWork = 0, nextLap = 0;
  function drip(t, cistern) {
    play(cistern && Math.random() < 0.5 ? 'dripdeep' : 'drip', { gain: rnd(0.12, 0.3), rateVar: 0.18, pan: rnd(-0.9, 0.9), send: cistern ? 1.0 : 0.8, when: t, lp: rnd(5000, 10000) });
  }
  function clothFlap(t) {
    play('cloth', { gain: rnd(0.08, 0.2), rateVar: 0.15, pan: rnd(-0.9, 0.9), send: 0.3, when: t, lp: rnd(3500, 6000) });
  }
  function workClank(t) {
    const pan = rnd(-0.9, 0.9), far = rnd(0, 1);
    const hits = Math.random() < 0.4 ? 2 + ((Math.random() * 3) | 0) : 1;
    let at = t;
    for (let i = 0; i < hits; i++) {
      play(Math.random() < 0.12 ? 'anvil' : 'clank', { gain: rnd(0.1, 0.28) * (1 - 0.5 * far), rate: rnd(0.85, 1.25), pan, send: 0.5, when: at, lp: lerp(9000, 3500, far) });
      at += rnd(0.3, 0.7);
    }
  }

  // ---------- Хоровой напев «ру… ру…» (зал): сэмпл голосов с плавными краями ----------
  function chant(seconds = 4) {
    const t0 = eng.T() + 0.05;
    for (let k = 0; k * 3.6 < seconds; k++) {
      play('chant', { gain: 0.55, dur: Math.min(4, seconds - k * 3.6 + 0.4), fadeIn: 0.5, fadeOut: 0.7, send: 0.9, when: t0 + k * 3.6, rateVar: 0.01 });
    }
  }

  // ---------- Ночная пустыня: далёкие осыпи и холодный треск песка ----------
  let nextSlide = 0, nextCrackle = 0;
  function sandSlide(t) {
    play('sand_pour', { gain: rnd(0.1, 0.2), rate: rnd(0.7, 0.95), dur: rnd(2.5, 5), fadeIn: 1, fadeOut: 1.5, pan: rnd(-0.9, 0.9), lp: 2800, send: 0.4, when: t, offset: rnd(0, 1) });
  }
  function coldCrackle(t) {
    const n = 1 + ((Math.random() * 4) | 0), pan = rnd(-0.8, 0.8);
    for (let i = 0; i < n; i++) play('sand_tick', { gain: rnd(0.08, 0.2), rateVar: 0.3, pan: pan + rnd(-0.1, 0.1), send: 0.3, when: t + i * rnd(0.03, 0.18) });
  }
  /** 0..1: глубокая ночь по часам погоды (плавные края на рассвете и закате). */
  function nightAmount() {
    const w = game.weather;
    const h = typeof w?.getHours === 'function' ? w.getHours() : w?.hours;
    if (typeof h !== 'number' || !Number.isFinite(h)) return 0;
    const x = ((h % 24) + 24) % 24;
    const sm = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    return x < 12 ? 1 - sm(4.6, 6.2, x) : sm(18.2, 19.8, x);
  }

  // ---------- Сад: ручей (текстура), птицы и горлицы (сэмплы), насекомые (шум с AM) ----------
  const insSrc = eng.loopNoise('white'), insBP = eng.filter('bandpass', 5400, 16), insAM = eng.gain(0.5), insG = eng.gain(0);
  const insLFO = ctx.createOscillator(), insLG = eng.gain(0.5); insLFO.frequency.value = 34; insLFO.connect(insLG); insLG.connect(insAM.gain); insLFO.start();
  insSrc.connect(insBP); insBP.connect(insAM); insAM.connect(insG); insG.connect(out);
  let nextBird = 0, nextDove = 0, nextPlop = 0, nextIns = 0;

  // ---------- Проёмы: расстояние до ближайшего выхода наружу ----------
  const OPENINGS = [{ ...ENTRY.cleft, kind: 'desert' }, { ...GARDEN.portal, kind: 'garden' }];
  function nearestOpening() {
    const p = game.player?.position;
    if (!p) return { d: 999, kind: 'desert' };
    let best = { d: 999, kind: 'desert' };
    const list = game.sietch?.openings?.length ? game.sietch.openings : OPENINGS;
    for (const o of list) {
      const d = Math.hypot(p.x - o.x, (p.y - (o.y ?? p.y)) * 0.7, p.z - o.z);
      if (Number.isFinite(d) && d < best.d) best = { d, kind: o.kind || 'desert' };
    }
    return best;
  }

  // ---------- События пустыни ----------
  game.bus.on('desert:gust', (e) => {
    const s = clamp(e?.strength ?? 0.6, 0, 1);
    gust = Math.max(gust, 1.2 + 1.0 * s); nextGust = eng.T() + rnd(2.5, 4.5);   // порыв: тело + свист + шипение резко вверх и спад
  });
  game.bus.on('desert:sandslide', (e) => {
    if (!e || !eng.samplesReady || game.space === 'sietch') return;
    const k = clamp(e.intensity ?? 0.5, 0.1, 1);
    const pos = Number.isFinite(e.x + e.z) ? { x: e.x, y: (game.heightAt?.(e.x, e.z) ?? 0) + 1, z: e.z } : null;
    play('sand_pour', { ...(pos ? { pos, pannerOpts: { ref: 20, rolloff: 1, max: 300 } } : {}), gain: 0.35 * k, dur: rnd(2.5, 4), fadeIn: 0.5, fadeOut: 1.5, offset: rnd(0, 1), lp: 5000 });
  });

  // ---------- Обновление ----------
  const api = {
    chant,
    gardenFlag: false,
    /** Звуковой «порыв» по событию Wind.Gust. */
    gustNow() { gust = 1.8; },
    update(dt) {
      const w = game.weather;
      const inS = game.space === 'sietch';
      const op = nearestOpening();
      const ext = inS ? smoothstep(40, 3, op.d) * 0.85 : 1;
      const int = inS ? 1 : smoothstep(26, 2, op.d) * 0.65;
      const zoneNow = game.zone || 'A1_Ridge';
      const inGarden = !inS && (zoneNow === 'C1_Garden' || api.gardenFlag);
      const intZone = inS && zoneNow.startsWith('B') ? zoneNow : 'B1_Airlock';
      const extProf = inS ? (op.kind === 'garden' ? ENV.C1_Garden : ENV.A3_Approach) : (inGarden ? ENV.C1_Garden : (ENV[zoneNow] || ENV.A1_Ridge));
      const intProf = ENV[intZone];
      const e = {};
      for (const key of ENV_KEYS) e[key] = ext * (extProf[key] ?? 0) + (inS || int > 0.01 ? int * (intProf[key] ?? 0) : 0);
      const k = 1 - Math.exp(-dt / 0.8);
      for (const key of ENV_KEYS) env[key] = lerp(env[key], e[key], k);
      const revW = {};
      revW[extProf.rev] = (revW[extProf.rev] || 0) + ext;
      revW[intProf.rev] = (revW[intProf.rev] || 0) + (inS ? 1 : int);
      eng.setReverbMix(revW);
      const extLP = extProf.lp * (1 - 0.5 * clamp(game.weather?.storm ?? 0, 0, 1) * (extProf.wind > 0.2 ? 1 : 0));
      const wInt = int / (int + ext + 1e-3);
      eng.ramp(eng.masterLP.frequency, game.paused ? 700 : lerp(extLP, intProf.lp, wInt), 0.4);
      eng.ramp(windLP.frequency, lerp(9000, 650, wInt), 0.5);   // ветер в сиетче глухой, как из-за стены
      const ws = clamp(w?.windSpeed ?? 4, 0, 24), storm = clamp(w?.storm ?? 0, 0, 1);
      const now = eng.T();
      if (now > nextGust) { gust = rnd(0.6, 1.4) * (1 + storm * 0.6); nextGust = now + rnd(1.6, 5); }
      const night = game.space === 'desert' ? nightAmount() : 0;
      const night0 = nightAmount();
      // Тело ветра: уровень по скорости, спектр темнее при слабом ветре
      const base = (0.012 + 0.2 * Math.pow(ws / 16, 1.5)) * env.wind * (1 + 0.25 * night + storm * 0.8);
      const gg = base * gust;
      eng.ramp(wA.g.gain, gg, 0.9); eng.ramp(wB.g.gain, gg * 0.8, 1.1);
      eng.ramp(wA.lp.frequency, 380 + ws * 40 + gust * 80, 0.8); eng.ramp(wB.lp.frequency, 650 + ws * 60 + gust * 120, 0.8);
      // Свист по кромкам скал: растёт ~ квадрат скорости, зависит от открытости зоны; частота плавает случайно
      const wl = 0.1 * Math.pow(ws / 12, 2.2) * env.whistle * env.wind * gust * (1 + storm);
      whistles.forEach((s, i) => {
        eng.ramp(s.g.gain, wl * (i ? 0.7 : 1), 0.6);
        if (now > s.next) { s.next = now + rnd(0.6, 1.8); eng.ramp(s.bp.frequency, clamp(s.f * rnd(0.7, 1.5) * (0.85 + ws / 30), 700, 4200), 0.5); }
      });
      // Шипение дрейфующего песка
      const sandy = (game.player?.sandWalking ? 0.3 : 0) + ws / 20;
      const hiss = (0.01 + 0.2 * clamp(sandy, 0, 1.3) * gust) * env.wind * (1 + storm * 2) * (1 - 0.5 * night);
      layer('hiss', 'sand_pour', hiss * (ws > 2.5 ? 1 : ws / 2.5), { out: windOut, lp: 7000 }, 0.8, dt);

      // Сиетч: каменный тон зала + бормотание (две текстуры: тихая и плотная толпа) — без тональных гудений
      const room = Math.min(1, env.hum + env.murmur);
      layer('room', 'room_stone', 0.1 * room, { out: roomOut }, 0.9, dt);
      const m = env.murmur * (api.ritualOn ? 1.5 : 1);
      layer('babA', 'babble_1', 0.34 * m, { out: murmurOut, lp: 3000 }, 0.9, dt);
      layer('babB', 'babble_2', 0.3 * m * m, { out: murmurOut, lp: 3000 }, 0.9, dt);

      if (night > 0.2 && env.wind > 0.2) {
        if (now > nextSlide) { sandSlide(now + 0.02); nextSlide = now + rnd(11, 28) / night; }
        if (now > nextCrackle) { coldCrackle(now + 0.02); nextCrackle = now + rnd(0.7, 2.6) / night; }
      }
      // Сад
      const gd = env.garden;
      layer('brook', 'brook', 0.28 * gd, { out, lp: 9000 }, 1.2, dt);
      eng.ramp(insG.gain, 0.05 * gd * (0.35 + 0.65 * night0), 1.5);
      if (gd > 0.05 && eng.samplesReady) {
        if (now > nextIns) { nextIns = now + rnd(2, 5); eng.ramp(insLFO.frequency, rnd(26, 44), 2); eng.ramp(insBP.frequency, rnd(4800, 6200), 2); }
        const day = 1 - night0;
        if (day > 0.1 && now > nextBird) { play('bird', { gain: rnd(0.1, 0.25), rateVar: 0.15, pan: rnd(-0.9, 0.9), send: 0.35, when: now + 0.02 }); nextBird = now + rnd(0.7, 3.5) / (gd * (0.2 + 0.8 * day)); }
        if (day > 0.1 && now > nextDove) { play('dove', { gain: 0.16, rateVar: 0.05, pan: rnd(-0.8, 0.8), send: 0.5, when: now + 0.02 }); nextDove = now + rnd(9, 22) / gd; }
        if (now > nextPlop) { play('drip', { gain: rnd(0.08, 0.2), rate: rnd(0.55, 0.9), pan: rnd(-0.5, 0.5), send: 0.3, when: now + 0.01 }); nextPlop = now + rnd(0.5, 2.5) / gd; }
      }
      if (eng.samplesReady) {
        if (env.drip > 0.02 && now > nextDrip) { drip(now + 0.01, env.drip > 0.6); nextDrip = now + rnd(1.4, 5.5) / env.drip; }
        if (env.cloth > 0.05 && now > nextCloth) { clothFlap(now + 0.01); nextCloth = now + rnd(5, 14) / env.cloth; }
        if (env.work > 0.05 && now > nextWork) { workClank(now + 0.01); nextWork = now + rnd(2.5, 8) / env.work; }
        if (env.drip > 0.6 && now > nextLap) { play('water_lap', { gain: rnd(0.1, 0.22), rateVar: 0.1, pan: rnd(-0.8, 0.8), send: 0.9, when: now + 0.01 }); nextLap = now + rnd(6, 14); }
      }
    },
  };
  return api;
}
