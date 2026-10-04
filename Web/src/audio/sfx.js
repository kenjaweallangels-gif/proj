// Эффекты (Ред. 3, «реалистичный звук»): сэмплы из src/assets/sfx_bank.js (рендер Tools/sfx/sfx_build.py) + гранулярные/текстурные петли.
// Шаги по поверхностям с вариациями, прыжок/приземление, червь (песчаный рёв, треск, осыпь — без постоянного НЧ-гула), тампер,
// харвестер (дизель, гусеницы, гидравлика, клаксон), переносчик, двери-уплотнители, интерфейс.
// Все AudioParam пишутся через eng.setT/eng.ramp с проверкой Number.isFinite.
import { clamp } from '../core/util.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export function createSfx(game, eng) {
  const { ctx, bus } = eng;
  const sfx = bus.sfx;
  const camPos = new game.THREE.Vector3();
  const play = (n, o) => eng.playSample(n, o);
  const inSietch = () => game.space === 'sietch';
  const wet = (k = 1) => (inSietch() ? 0.3 * k : 0);

  // ---------- Шаги ----------
  let stepBudget = 0, lastStepWin = 0, lastWeight = 1;
  function normSurface(s) {
    s = String(s || 'sand').toLowerCase();
    if (s.includes('packed')) return 'packed';
    if (s.includes('rock')) return 'rock';
    if (s.includes('sietch') || s.includes('stone')) return 'stone';
    if (s.includes('metal')) return 'metal';
    if (s.includes('cloth')) return 'cloth';
    return 'sand';
  }
  /** Мягкий запасной шаг, пока банк сэмплов ещё декодируется. */
  function fallbackStep(g, dest) {
    eng.burst({ type: 'bandpass', f0: 1100, f1: 500, q: 0.8, dur: 0.14, attack: 0.012, gain: 0.12 * g, kind: 'pink', out: dest });
  }
  function footstep(e = {}) {
    const t = eng.T();
    if (t - lastStepWin > 0.25) { lastStepWin = t; stepBudget = 0; }
    if (++stepBudget > 6) return; // не больше 6 шагов за 250 мс
    const p = game.player;
    const isPlayer = !e.actor || e.actor === 'player' || e.actor === 'Kair';
    const surf = normSurface(e.surface);
    const gait = isPlayer ? p?.gait : 'walk';
    const sw = isPlayer && (p?.sandWalking || gait === 'sandwalk');
    const run = isPlayer && gait === 'run';
    const loud = isPlayer ? clamp(e.loudness ?? (0.35 + (p?.noise ?? 0.3) * 0.65), 0.2, 1) : 0.34;
    // интенсивность по скорости: медленно — тихо и мягко, бег — громче и ярче
    const spd = isPlayer ? clamp((p?.speed ?? 3) / 6, 0.25, 1.3) : 0.55;
    lastWeight = -lastWeight;
    const weight = 0.9 + 0.1 * lastWeight + rnd(-0.08, 0.08);   // «тяжёлая/лёгкая» нога + шум
    const g = (isPlayer ? 0.5 : 0.28) * (0.45 + 0.55 * loud) * (0.7 + 0.3 * spd) * weight;
    let dest = sfx, pos = null;
    if (!isPlayer && e.x !== undefined && Number.isFinite(e.x + e.z)) {
      game.camera.getWorldPosition(camPos);
      pos = { x: e.x, y: camPos.y - 1.5, z: e.z };
    }
    const base = { out: dest, pos, pannerOpts: { ref: 3, rolloff: 1.4, max: 80 }, pan: pos ? 0 : lastWeight * 0.07, rateVar: 0.07, send: wet() };
    const lp = rnd(5500, 11000) * (0.7 + 0.3 * spd);
    if (!eng.samplesReady) { fallbackStep(g, pos ? eng.panner(dest, pos, base.pannerOpts) : dest); return; }
    switch (surf) {
      case 'sand':
        if (sw) { // походка по песку: затяжной шорох и неровное «подтягивание» ноги
          play('sandwalk', { ...base, gain: g * 0.9, rate: rnd(0.9, 1.1), lp: rnd(2800, 4500) });
          if (Math.random() < 0.7) play('sandwalk', { ...base, gain: g * 0.4, rate: rnd(1.1, 1.35), lp: 2500, when: t + rnd(0.09, 0.24) });
        } else {
          play(run ? 'sand_run' : 'sand_step', { ...base, gain: g, rate: run ? rnd(1.0, 1.15) : rnd(0.92, 1.08), lp });
          // второй слой: пятка/носок с небольшим сдвигом (зернистость)
          play('sand_tick', { ...base, gain: g * 0.5, rate: rnd(0.9, 1.3), when: t + rnd(0.012, 0.05), hp: 1200 });
          if (run) play('sand_step', { ...base, gain: g * 0.4, rate: rnd(1.2, 1.5), when: t + rnd(0.03, 0.07), lp: 5000 });
        }
        break;
      case 'packed':
        play('packed', { ...base, gain: g * 1.0, rate: rnd(0.9, 1.1), lp });
        play('sand_tick', { ...base, gain: g * 0.4, when: t + 0.02, hp: 1500 });
        break;
      case 'rock':
        play('rock', { ...base, gain: g * 0.9, rate: rnd(0.88, 1.15), lp: lp + 2000 });
        break;
      case 'stone':
        play('stone', { ...base, gain: g * 0.95, rate: rnd(0.9, 1.1), lp, send: Math.max(base.send, 0.3) });
        break;
      case 'metal':
        play('metal', { ...base, gain: g * 0.8, rate: rnd(0.92, 1.08), send: Math.max(base.send, 0.15) });
        break;
      default:
        play('cloth', { ...base, gain: g * 0.9, rate: rnd(0.9, 1.15) });
    }
  }
  /** Прыжок: шорох одежды и лёгкий выброс песка из-под ног. */
  function jump(e = {}) {
    if (!eng.samplesReady) return;
    const surf = normSurface(game.surfaceAt?.(e.x ?? 0, e.z ?? 0));
    play('cloth', { gain: 0.22, rate: rnd(0.9, 1.1), rateVar: 0.05 });
    if (surf === 'sand' || surf === 'packed') play('sand_step', { gain: 0.16, rate: rnd(1.1, 1.3), lp: 3500, when: eng.T() + 0.02 });
  }
  /** Приземление: удар пропорционален скорости падения. */
  function land(e = {}) {
    if (!eng.samplesReady) return;
    const k = clamp(0.3 + 0.7 * ((e.impact ?? 4) / 10), 0.25, 1.1);
    const surf = normSurface(e.surface);
    if (surf === 'sand' || surf === 'packed') play('land_sand', { gain: 0.55 * k, rateVar: 0.06, lp: 8000 });
    else play('land_hard', { gain: 0.5 * k, rateVar: 0.06, send: wet(1.2), lp: 9000 });
    play('cloth', { gain: 0.15 * k, when: eng.T() + 0.03 });
  }

  // ---------- Червь ----------
  // Песчаный рёв приближающегося червя — текстурные петли (rasp + pour), позиция — голова червя, всё гейтится близостью.
  const wormPos = new game.THREE.Vector3();
  const W = { loops: null, pn: null, bus: null, idle: 0 };
  function wormStart() {
    if (W.loops || !eng.samplesReady) return;
    W.bus = eng.gain(1);
    W.pn = eng.panner(W.bus, { x: 0, y: 0, z: 0 }, { ref: 45, rolloff: 1.0, max: 2500 });
    W.bus.connect(sfx);
    const rasp = eng.textureLoop('worm_rasp', { out: W.pn, gain: 0, lp: 600, hp: 70 });
    const pour = eng.textureLoop('sand_pour', { out: W.pn, gain: 0, lp: 6000 });
    W.loops = { rasp, pour };
  }
  function wormStop() {
    if (!W.loops) return;
    for (const l of Object.values(W.loops)) l?.stop(0.8);
    try { W.bus.disconnect(); } catch (_) { /* ok */ }
    W.loops = null; W.pn = null; W.bus = null;
  }
  function rockRattle(pan) {
    play('worm_rock', { gain: rnd(0.12, 0.3), rate: rnd(0.8, 1.3), pan: Number.isFinite(pan) ? pan : rnd(-1, 1), lp: rnd(4000, 9000) });
  }
  function heartbeat() {
    const t = eng.T();
    play('worm_thud', { gain: 0.4, rate: 1.0, rateVar: 0.04 });
    play('worm_thud', { gain: 0.26, rate: 1.1, when: t + 0.2 });
  }

  /** Рёв выхода червя: песчаный хриплый рёв (сэмпл) + осыпь + скрежет пасти + камни. Низ — только короткий удар в начале сэмпла. */
  function breach(pos) {
    if (!eng.samplesReady) return;
    const t = eng.T() + 0.02;
    const po = pos ? { pos, pannerOpts: { ref: 60, rolloff: 0.8, max: 1500 } } : {};
    play('worm_roar', { ...po, gain: 1.0, rateVar: 0.05, send: 0.25, when: t });
    play('sand_pour', { ...po, gain: 0.5, dur: 6, fadeIn: 0.5, fadeOut: 2.5, when: t + 0.3, offset: rnd(0, 1) });
    play('worm_grind', { ...po, gain: 0.45, dur: 3.5, fadeIn: 0.4, fadeOut: 1.5, when: t + 0.6, lp: 3000 });
    for (let i = 0; i < 14; i++) play('worm_crackle', { ...po, gain: rnd(0.2, 0.5), rateVar: 0.2, when: t + 0.2 + i * rnd(0.12, 0.3) });
    for (let i = 0; i < 10; i++) play('worm_rock', { gain: rnd(0.1, 0.3), rate: rnd(0.8, 1.2), pan: rnd(-1, 1), when: t + 0.5 + i * rnd(0.2, 0.45) });
  }

  function thump(pos, strong = 1) {
    play('thumper_hit', { pos, pannerOpts: { ref: 6, rolloff: 1, max: 400 }, gain: 0.7 * strong, rateVar: 0.05, send: wet(0.5) });
  }
  function sealHiss(pos) {
    play('seal_hiss', { pos, pannerOpts: { ref: 5 }, gain: 0.6, rateVar: 0.08, send: 0.4 });
  }
  function falseRock(pos) {
    play('worm_grind', { pos, pannerOpts: { ref: 6 }, gain: 0.5, dur: 2.6, fadeIn: 0.3, fadeOut: 0.8, lp: 1100, rate: 0.85, send: 0.4 });
    play('door_thud', { pos, pannerOpts: { ref: 6 }, gain: 0.6, rate: 0.8, when: eng.T() + 2.4, send: 0.4 });
  }
  function breath(dry = false) { play('breath_dry', { gain: dry ? 0.25 : 0.18, rateVar: 0.1 }); }

  // Далёкий стук дюн/тампера (desert:distantthump): с задержкой по скорости звука, приглушённо, без панорамирования по 3D-модели.
  game.bus.on('desert:distantthump', (e) => {
    if (!eng.samplesReady || !e) return;
    const { d, pan } = eng.relPos(e);
    play('distant_thump', { gain: 0.5 * clamp(1.5 - d / 2600, 0.25, 1), pan, lp: 380, when: eng.T() + clamp(d / 343, 0.2, 6), rateVar: 0.08, send: 0.2 });
  });

  // ---------- Харвестер (комбайн): дизель (петля) + гусеницы + гидравлика + клаксон + шипение пряного заборника ----------
  const harv = { built: false, on: false, level: 0, nextClank: 0, nextHyd: 0, lastPos: null, eng: null, occ: false };
  function harvBuild() {
    if (harv.built || !eng.samplesReady) return harv.built;
    harv.built = true;
    const inp = eng.gain(0);
    const air = eng.filter('lowpass', 6000, 0.5);
    const pn = ctx.createPanner(); pn.panningModel = 'equalpower'; pn.distanceModel = 'inverse'; pn.refDistance = 28; pn.rolloffFactor = 1.15; pn.maxDistance = 4000;
    inp.connect(air); air.connect(pn); pn.connect(sfx); eng.send(inp, 0.12);
    // шипение пряной пыли (заборник): высокочастотный шум с медленной модуляцией
    const hs = eng.loopNoise('white'), hhp = eng.filter('highpass', 2800, 0.5), hlp = eng.filter('lowpass', 8000, 0.5), hg = eng.gain(0.05);
    const am = eng.gain(0.6), lfo = ctx.createOscillator(), lg = eng.gain(0.35); lfo.frequency.value = 0.45; lfo.connect(lg); lg.connect(am.gain); lfo.start();
    hs.connect(hhp); hhp.connect(hlp); hlp.connect(am); am.connect(hg); hg.connect(inp);
    Object.assign(harv, { inp, air, pn, hg });
    return true;
  }
  function harvPos() {
    const p = game.harvester?.position;
    if (p) harv.lastPos = p;
    return harv.lastPos;
  }
  function klaxon(long = false, dest = null) {
    if (!dest) { if (!harvBuild()) return; dest = harv.inp; }
    const t = eng.T() + 0.02;
    if (long) play('klaxon_long', { out: dest, gain: 0.5, when: t, air: false });
    else for (const off of [0, 0.78]) play('klaxon', { out: dest, gain: 0.5, dur: 0.58, fadeIn: 0.02, fadeOut: 0.1, when: t + off, air: false });
  }
  function harvStart(withHorn = true) {
    harvBuild();
    if (withHorn && !harv.on) klaxon(false);
    harv.on = true;
  }
  function harvStop(withHorn = true) {
    if (!harv.built || !harv.on) return;
    harv.on = false;
    if (withHorn) klaxon(true);
  }
  function harvUpdate(dt) {
    if (!harv.built) { if (harv.on) harvBuild(); if (!harv.built) return; }
    const target = harv.on ? 1 : 0;
    harv.level += (target - harv.level) * (1 - Math.exp(-dt / (harv.on ? 2.2 : 3.2)));
    const t = eng.T();
    const H = game.harvester;
    const occ = !!H?.H?.occupied;
    // Двигатель слышен только когда комбайн РАБОТАЕТ и он рядом (ноль дальше ~420 м и в сиетче); внутри кабины — приглушённо.
    let hnear = 1, d = 0;
    const hp = harvPos();
    if (hp && Number.isFinite(hp.x + hp.z) && game.camera) {
      game.camera.getWorldPosition(camPos);
      d = Math.hypot(camPos.x - hp.x, camPos.z - hp.z);
      const x = clamp((420 - d) / (420 - 90), 0, 1);
      hnear = x * x * (3 - 2 * x);
    }
    if (inSietch()) hnear = 0;
    if (occ) hnear = 1;
    const lvl = harv.level < 0.01 ? 0 : harv.level * hnear;
    // петля двигателя живёт только пока слышна
    if (lvl > 0.01 && !harv.eng) harv.eng = eng.textureLoop('engine_loop', { out: harv.inp, gain: 1, xf: 0.12, coherent: true, rate: 0.7 });
    if (harv.eng && lvl <= 0.005 && !harv.on) { harv.eng.stop(0.5); harv.eng = null; }
    if (harv.eng && lvl <= 0.005) harv.eng.setGain(0, 0.3); else harv.eng?.setGain(1, 0.3);
    eng.ramp(harv.inp.gain, lvl < 0.005 ? 0 : lvl * (occ ? 0.75 : 1), 0.25);
    harv.eng?.setRate(0.68 + 0.5 * harv.level, 0.4);
    eng.ramp(harv.hg.gain, 0.03 + 0.05 * (H?.S?.belt ?? harv.level), 0.5);
    if (hp && Number.isFinite(hp.x + (hp.y ?? 0) + hp.z)) {
      eng.setPos(harv.pn, hp, 0.1);
      const cut = occ ? 520 : eng.airCut(d);   // в кабине — глухо
      eng.ramp(harv.air.frequency, cut, 0.3);
    }
    // гусеницы и гидравлика: неровный ритм, зависит от хода
    const drive = H?.S?.drive ?? harv.level;
    if (lvl > 0.08 && drive > 0.1 && t > harv.nextClank) {
      play('track_clank', { out: harv.inp, gain: rnd(0.2, 0.45) * lvl, rateVar: 0.18, lp: rnd(3500, 9000), when: t });
      harv.nextClank = t + (0.18 + Math.random() * 0.22) / (0.5 + drive);
    }
    if (lvl > 0.2 && t > harv.nextHyd) {
      play('hyd_hiss', { out: harv.inp, gain: rnd(0.25, 0.45) * lvl, rateVar: 0.1 });
      harv.nextHyd = t + rnd(6, 13);
    }
  }
  game.bus.on('harvester', ({ state } = {}) => {
    const s = String(state || '').toLowerCase();
    if (s === 'running' || s === 'run') harvStart(false);
    else if (s) harvStop(false);
  });

  // ---------- Сценарий «червь пожирает харвестер» ----------
  const devourPos = (p) => {
    const h = p && p.x !== undefined ? p : game.harvester?.position;
    return h && Number.isFinite(h.x + h.z) ? { x: h.x, y: (h.y ?? 0) + 14, z: h.z } : null;
  };
  const devourDest = (p, ref = 40) => { const q = devourPos(p); return q ? eng.panner(sfx, q, { ref, rolloff: 0.8, max: 3500 }) : sfx; };
  /** Подземный ход червя: нарастающий песчаный шорох, осыпь и треск (без сверхнизкого рокота). */
  function devourRumble(p, dur = 18) {
    if (!eng.samplesReady) return;
    const t = eng.T() + 0.02, dest = devourDest(p, 110);
    const rasp = eng.textureLoop('worm_rasp', { out: dest, gain: 0, lp: 500, hp: 70 });
    const pour = eng.textureLoop('sand_pour', { out: dest, gain: 0, lp: 5000 });
    if (rasp) { rasp.master.gain.setValueAtTime(0, t); rasp.master.gain.linearRampToValueAtTime(0.7, t + dur * 0.9); rasp.lp.frequency.setValueAtTime(500, t); rasp.lp.frequency.linearRampToValueAtTime(3500, t + dur); }
    if (pour) { pour.master.gain.setValueAtTime(0, t); pour.master.gain.linearRampToValueAtTime(0.5, t + dur * 0.9); }
    setTimeout(() => { rasp?.stop(2); pour?.stop(2); }, (dur + 1) * 1000);
    const n = Math.floor(dur * 2.5);
    for (let i = 0; i < n; i++) {
      const at = t + dur * Math.pow(i / n, 0.65), k = 0.35 + i / n;
      play(Math.random() < 0.6 ? 'worm_crackle' : 'worm_rock', { out: dest, gain: rnd(0.08, 0.22) * k, rateVar: 0.2, pan: rnd(-1, 1), when: at });
    }
  }
  /** Тревожный клаксон харвестера: n сигналов с паузами. */
  function devourAlarm(p, n = 5) {
    const dest = devourDest(p, 35), t = eng.T() + 0.05;
    for (let i = 0; i < n; i++) {
      const at = t + i * 1.9;
      if (i === n - 1) play('klaxon_long', { out: dest, gain: 0.55, when: at, air: false });
      else for (const off of [0, 0.78]) play('klaxon', { out: dest, gain: 0.55, dur: 0.58, fadeIn: 0.02, fadeOut: 0.1, when: at + off, air: false });
    }
  }
  /** Переносчик: свист лопастей/струй (петля), растёт по тону и нагрузке, в конце — срыв. */
  function devourCarryall(p, dur = 9) {
    if (!eng.samplesReady) return;
    const t = eng.T() + 0.02, q = devourPos(p);
    const dest = q ? eng.panner(sfx, { x: q.x, y: q.y + 40, z: q.z }, { ref: 45, rolloff: 0.8, max: 3500 }) : sfx;
    const c = eng.textureLoop('carryall_loop', { out: dest, gain: 0, lp: 6000, rate: 0.85, xf: 0.2 });
    if (!c) return;
    c.master.gain.setValueAtTime(0, t); c.master.gain.linearRampToValueAtTime(0.5, t + 1.5); c.master.gain.linearRampToValueAtTime(0.85, t + dur * 0.85);
    const iv = setInterval(() => { const k = clamp((eng.T() - t) / dur, 0, 1); c.setRate(0.85 + 0.45 * k, 0.3); }, 250);
    // срывы: провалы тона
    for (let i = 0; i < 4; i++) setTimeout(() => c.setRate(0.7, 0.1), dur * (0.4 + 0.14 * i) * 1000);
    setTimeout(() => { clearInterval(iv); c.stop(1.2); }, dur * 1000);
  }
  /** Поглощение: рёв червя + скрежет и хруст металла. */
  function devourSwallow(p) {
    if (!eng.samplesReady) return;
    const q = devourPos(p);
    breach(q);
    const t = eng.T() + 0.4, dest = devourDest(p, 50);
    for (let i = 0; i < 14; i++) {
      const at = t + i * rnd(0.12, 0.34);
      play(Math.random() < 0.5 ? 'track_clank' : 'clank', { out: dest, gain: rnd(0.25, 0.55), rate: rnd(0.55, 1.0), when: at, send: 0.3 });
    }
    play('worm_grind', { out: dest, gain: 0.5, dur: 3.5, fadeIn: 0.3, fadeOut: 1.2, when: t, rate: 0.9 });
  }
  /** Обломки: затухающая россыпь лязга и осыпь песка. */
  function devourDebris(p, dur = 8) {
    if (!eng.samplesReady) return;
    const t = eng.T() + 0.05, dest = devourDest(p, 40);
    play('land_hard', { gain: 0.6, rate: 0.7, when: t });
    play('sand_pour', { out: dest, gain: 0.5, dur, fadeIn: 0.6, fadeOut: dur * 0.5, when: t, send: 0.3 });
    for (let i = 0; i < 26; i++) {
      const at = t + dur * 0.9 * Math.pow(Math.random(), 1.7);
      play(Math.random() < 0.5 ? 'track_clank' : 'worm_rock', { out: dest, gain: rnd(0.1, 0.4), rate: rnd(0.7, 1.2), pan: rnd(-0.6, 0.6), when: at, send: 0.35 });
    }
  }

  // ---------- Интерфейс: мягко и ненавязчиво (шина ui, без реверберации) ----------
  const uiPlay = (n, g, o = {}) => play(n, { out: bus.ui, gain: g, ...o });
  const ui = {
    hint() { uiPlay('ui_hint', 0.35, { send: 0.3 }); },
    titleCard() { uiPlay('ui_title', 0.4, { send: 0.5 }); },
    interact() { uiPlay('ui_interact', 0.4, { rateVar: 0.03 }); },
    pause() { uiPlay('ui_pause', 0.5); },
    photo() { uiPlay('ui_shutter', 0.5); },
    tick() { uiPlay('ui_tick', 0.35, { rateVar: 0.03 }); },
  };

  // ---------- Реестр событий (AudioEvents.csv) ----------
  const at = (p) => (p && Number.isFinite(p.x + p.z) ? { pos: p, pannerOpts: { ref: 4 } } : {});
  const EVENTS = {
    'Foot.Sand': (p) => footstep({ surface: 'sand', ...p }), 'Foot.PackedSand': (p) => footstep({ surface: 'packed', ...p }),
    'Foot.Rock': (p) => footstep({ surface: 'rock', ...p }), 'Foot.SietchStone': (p) => footstep({ surface: 'stone', ...p }),
    'Foot.Cloth': (p) => footstep({ surface: 'cloth', ...p }), 'Foot.Metal': (p) => footstep({ surface: 'metal', ...p }),
    'Foot.Unknown': (p) => footstep({ surface: 'sand', ...p }), 'Foot.SandWalk': (p) => footstep({ surface: 'sand', ...p }),
    'Foot.Companion': (p) => footstep({ surface: 'sand', actor: 'companion', ...p }),
    'Player.Jump': (p) => jump(p), 'Player.Land': (p) => land(p),
    'Worm.Breach': (p) => breach(p), 'Worm.Roar': (p) => breach(p),
    'Worm.RockHop': () => rockRattle(rnd(-1, 1)), 'Worm.Heartbeat': () => heartbeat(),
    'Worm.Pass': (p) => { play('worm_rasp', { ...(p ? { pos: p, pannerOpts: { ref: 40, max: 1200 } } : {}), gain: 0.7, dur: 4.5, fadeIn: 1.0, fadeOut: 2, offset: rnd(0, 2), lp: 2500 }); },
    'Worm.RingSandfall': (p) => { play('sand_pour', { ...(p ? { pos: p, pannerOpts: { ref: 30, max: 900 } } : {}), gain: 0.5, dur: 3, fadeIn: 0.4, fadeOut: 1.4, offset: rnd(0, 1.5) }); },
    'Thumper.Hit': (p) => thump(p),
    'Thumper.Deploy': (p) => { play('clank', { ...at(p), gain: 0.4, rate: 0.8, rateVar: 0.05 }); play('sand_tick', { ...at(p), gain: 0.4, when: eng.T() + 0.03 }); },
    'Door.SealHiss': (p) => sealHiss(p), 'Door.FalseRock': (p) => falseRock(p),
    'Water.Drip': (p) => play('drip', { ...at(p), gain: 0.3, rateVar: 0.15, send: 0.7, pannerOpts: { ref: 4 } }),
    'Water.Measure': (p) => play('drip', { ...at(p), gain: 0.25, rate: 1.3, rateVar: 0.1, send: 0.6 }),
    'Loom.Clack': (p) => play('loom_clack', { ...at(p), gain: 0.35, rateVar: 0.08, send: 0.3 }),
    'Stillsuit.Repair': (p) => play('cloth', { ...at(p), gain: 0.2, rateVar: 0.1 }),
    'Wind.Gust': () => game.bus.emit('desert:gust', { strength: 0.8 }),
    'Crowd.Hush': () => {},
    'Player.Breath.Dry': () => breath(true), 'Player.Mask.Seal': () => play('seal_hiss', { gain: 0.25, rate: 1.6, dur: 0.4, fadeOut: 0.2 }),
    'Harvester.Start': () => harvStart(true), 'Harvester.Run': () => harvStart(false), 'Harvester.Stop': () => harvStop(true),
    'Harvester.Board': (p) => { play('door_thud', { ...at(p), gain: 0.35, rate: 1.1, pannerOpts: { ref: 20 } }); play('cloth', { gain: 0.2, when: eng.T() + 0.1 }); },
    'Harvester.Leave': (p) => { play('door_thud', { ...at(p), gain: 0.3, rate: 1.0, pannerOpts: { ref: 20 } }); },
    'Worm.Devour.Rumble': (p) => devourRumble(p), 'Worm.Devour.Alarm': (p) => devourAlarm(p), 'Worm.Devour.Carryall': (p) => devourCarryall(p),
    'Worm.Devour.Swallow': (p) => devourSwallow(p), 'Worm.Devour.Debris': (p) => devourDebris(p),
    'UI.Hint': () => ui.hint(), 'UI.TitleCard': () => ui.titleCard(), 'UI.Interact': () => ui.interact(), 'UI.Pause': () => ui.pause(), 'UI.PhotoShutter': () => ui.photo(), 'UI.Tick': () => ui.tick(),
  };

  // ---------- Подписки ----------
  off_subscribe();
  function off_subscribe() {
    game.bus.on('footstep', footstep);
    game.bus.on('jump', jump);
    game.bus.on('land', land);
    game.bus.on('worm:breach', (e) => breach(e && Number.isFinite(e.x + e.z) ? { x: e.x, y: game.heightAt?.(e.x, e.z) ?? 0, z: e.z } : null));
    game.bus.on('thumper', (e) => thump(e && Number.isFinite(e.x + e.z) ? { x: e.x, y: game.heightAt?.(e.x, e.z) ?? 0, z: e.z } : null));
    game.bus.on('interact', ({ tag } = {}) => {
      if (!tag) return;
      if (/FalseRock/i.test(tag)) falseRock();
      else if (/Thumper/i.test(tag)) EVENTS['Thumper.Deploy']();
      else ui.interact();
    });
    game.bus.on('door', () => sealHiss());
  }

  let breathAt = 0, nextCrack = 0, nextRock = 0;
  return {
    footstep, jump, land, breach, thump, sealHiss, falseRock, rockRattle, heartbeat, ui, devourRumble, devourAlarm, devourCarryall, devourSwallow, devourDebris,
    has: (id) => !!EVENTS[id],
    play(id, pos) { const f = EVENTS[id]; if (f) f(pos); return !!f; },
    update(dt) {
      harvUpdate(dt);
      const w = game.worm, p = game.player;
      const threat = clamp(w?.threat ?? 0, 0, 1);
      // Песчаный рёв червя: ТОЛЬКО при настоящем приближении/выходе червя рядом с игроком в пустыне (Listening — лишь лёгкая дрожь).
      // Полная громкость ближе 45 м, ноль дальше 230 м, в сиетче тишина. Сверхнизких тонов нет вообще.
      const st = w?.state;
      const stateK = st === 'Surface' || st === 'Pass' || st === 'Ridden' ? 1 : st === 'Approach' ? 0.75 : st === 'Listening' ? 0.18 : 0;
      let near = 0;
      const hp = w?.headPos;
      if (stateK > 0 && hp && Number.isFinite(hp.x + hp.z) && game.space === 'desert') {
        game.camera.getWorldPosition(camPos);
        const dd = camPos.distanceTo(hp);
        if (Number.isFinite(dd)) { const x = clamp((230 - dd) / (230 - 45), 0, 1); near = x * x * (3 - 2 * x); }
      }
      const r = clamp(stateK * near * (0.35 + 0.65 * threat), 0, 1);
      const now = eng.T();
      if (r > 0.01) { W.idle = 0; wormStart(); } else if (W.loops && (W.idle += dt) > 4) wormStop();
      if (W.loops) {
        const moving = st === 'Approach' || st === 'Surface' || st === 'Pass' || st === 'Ridden';
        W.loops.rasp?.setGain(r < 0.01 ? 0 : r * 0.7, 0.5);
        W.loops.rasp?.setLP(450 + 6000 * near * near, 0.6);
        W.loops.rasp?.setRate(0.9 + 0.25 * threat, 0.8);
        W.loops.pour?.setGain(moving ? r * 0.55 : 0, 0.8);
        eng.setPos(W.pn, hp, 0.15);
      }
      if (r > 0.04 && eng.samplesReady) {
        // гранулярный треск и камни: Пуассон, частота растёт с угрозой
        const cr = near * stateK * (0.8 + 8 * threat);
        if (Math.random() < cr * dt && now > nextCrack) {
          const j = { x: (hp?.x ?? 0) + rnd(-18, 18), y: hp?.y ?? 0, z: (hp?.z ?? 0) + rnd(-18, 18) };
          play('worm_crackle', { pos: j, pannerOpts: { ref: 20, rolloff: 1, max: 500 }, gain: rnd(0.15, 0.45) * (0.4 + near), rateVar: 0.2 });
          nextCrack = now + 0.03;
        }
        if (threat > 0.15 && near > 0.15 && Math.random() < (0.5 + 6 * threat) * near * dt && now > nextRock) { rockRattle(rnd(-1, 1)); nextRock = now + 0.05; }
      }
      // Сухое дыхание при низкой влаге.
      if (p && (p.moisture ?? 1) < 0.25 && game.space === 'desert' && now > breathAt) { breath(true); breathAt = now + rnd(6, 10); }
    },
  };
}
