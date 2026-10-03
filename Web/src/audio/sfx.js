// Эффекты: шаги по поверхностям (спутники — тише и в пространстве), червь (инфразвук, камни, рёв, сердце),
// тампер, двери-уплотнители, звуки интерфейса. Всё синтезируется из шума и осцилляторов.
import { clamp } from '../core/util.js';

const rnd = (a, b) => a + Math.random() * (b - a);

export function createSfx(game, eng) {
  const { ctx, bus } = eng;
  const sfx = bus.sfx;
  const camPos = new game.THREE.Vector3();

  // ---------- Шаги ----------
  let stepBudget = 0, lastStepWin = 0, lastFoot = 1;
  function normSurface(s) {
    s = String(s || 'sand').toLowerCase();
    if (s.includes('packed')) return 'packed';
    if (s.includes('rock')) return 'rock';
    if (s.includes('sietch') || s.includes('stone')) return 'stone';
    if (s.includes('metal')) return 'metal';
    if (s.includes('cloth')) return 'cloth';
    return 'sand';
  }
  function footstep(e = {}) {
    const t = eng.T();
    if (t - lastStepWin > 0.25) { lastStepWin = t; stepBudget = 0; }
    if (++stepBudget > 6) return; // ограничитель: не больше 6 шагов за 250 мс
    const p = game.player;
    const isPlayer = !e.actor || e.actor === 'player' || e.actor === 'Kair';
    const surf = normSurface(e.surface);
    const sw = isPlayer && p?.sandWalking;
    const loud = isPlayer ? clamp(e.loudness ?? (0.35 + (p?.noise ?? 0.3) * 0.65), 0.2, 1) : 0.34;
    const g = (isPlayer ? 1 : 0.5) * (0.4 + 0.6 * loud);
    // Выход: игрок — слегка чередуем стороны, спутники — 3D.
    let dest = sfx;
    if (!isPlayer && e.x !== undefined) {
      game.camera.getWorldPosition(camPos);
      dest = eng.panner(sfx, { x: e.x, y: camPos.y - 1.5, z: e.z }, { ref: 3, rolloff: 1.4, max: 80 });
    } else { lastFoot = -lastFoot; dest = eng.stereoPan(sfx, lastFoot * 0.08); }
    const detune = rnd(0.88, 1.12);
    switch (surf) {
      case 'sand':
        if (sw) { // походка по песку: мягкий шурх без атаки
          eng.burst({ type: 'lowpass', f0: 950 * detune, f1: 380, q: 0.5, dur: 0.26, attack: 0.045, gain: 0.2 * g, kind: 'pink', out: dest });
        } else {
          eng.burst({ type: 'bandpass', f0: 1000 * detune, f1: 480, q: 0.8, dur: 0.17, attack: 0.012, gain: 0.3 * g, kind: 'pink', out: dest });
          eng.burst({ type: 'highpass', f0: 3000, q: 0.5, dur: 0.06, attack: 0.004, gain: 0.07 * g, kind: 'white', out: dest, when: eng.T() + 0.02 });
        }
        break;
      case 'packed': // барабанный песок: низкий «бум»
        eng.blip({ freq: 96 * detune, freq1: 52, dur: 0.22, gain: 0.5 * g, out: dest });
        eng.burst({ type: 'bandpass', f0: 800, f1: 400, q: 0.9, dur: 0.1, gain: 0.18 * g, kind: 'pink', out: dest });
        break;
      case 'rock':
        eng.burst({ type: 'bandpass', f0: 2800 * detune, q: 4, dur: 0.035, attack: 0.001, gain: 0.45 * g, kind: 'white', out: dest });
        eng.blip({ freq: 1500 * detune, freq1: 900, dur: 0.05, gain: 0.12 * g, out: dest });
        eng.burst({ type: 'highpass', f0: 4200, q: 0.5, dur: 0.05, gain: 0.07 * g, out: dest, when: eng.T() + rnd(0.02, 0.05) });
        break;
      case 'stone':
        eng.blip({ freq: 200 * detune, freq1: 120, dur: 0.1, gain: 0.3 * g, out: dest, send: 0.5 });
        eng.burst({ type: 'bandpass', f0: 1600, q: 2, dur: 0.04, attack: 0.001, gain: 0.25 * g, kind: 'white', out: dest, send: 0.5 });
        break;
      case 'metal':
        eng.blip({ freq: 780 * detune, dur: 0.18, gain: 0.12 * g, type: 'triangle', out: dest, send: 0.3 });
        eng.burst({ type: 'bandpass', f0: 3200, q: 5, dur: 0.05, gain: 0.25 * g, out: dest });
        break;
      default: // cloth
        eng.burst({ type: 'bandpass', f0: 500, q: 0.7, dur: 0.12, attack: 0.03, gain: 0.12 * g, kind: 'pink', out: dest });
    }
  }

  // ---------- Червь ----------
  const wormOut = eng.gain(0); wormOut.connect(bus.sfx);
  // Инфразвуковой рокот: расстроенные низкие синусы + коричневый шум.
  const subs = [26, 31.5, 38, 44.5].map((f, i) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = [0, 9, -7, 5][i];
    const g = eng.gain([0.4, 0.32, 0.22, 0.14][i]);
    // медленное дрожание амплитуды
    const lfo = ctx.createOscillator(), lg = eng.gain(0.25); lfo.frequency.value = rnd(0.2, 0.7); lfo.connect(lg); lg.connect(g.gain);
    o.connect(g); g.connect(wormOut); o.start(); lfo.start();
    return o;
  });
  const bodySrc = eng.loopNoise('brown'), bodyBP = eng.filter('bandpass', 72, 0.9), bodyG = eng.gain(0.5);
  bodySrc.connect(bodyBP); bodyBP.connect(bodyG); bodyG.connect(wormOut);
  // Шипение песка от движущегося тела (AM 0.5–3 Гц).
  const hissSrc = eng.loopNoise('white'), hissBP = eng.filter('bandpass', 3600, 0.6), hissG = eng.gain(0), hissAM = eng.gain(0);
  const hissLFO = ctx.createOscillator(), hissLG = eng.gain(0.5); hissLFO.frequency.value = 1.2; hissLFO.connect(hissLG); hissLG.connect(hissAM.gain); hissLFO.start();
  hissSrc.connect(hissBP); hissBP.connect(hissAM); hissAM.connect(hissG); hissG.connect(sfx);
  hissAM.gain.value = 0.5;

  let nextRock = 0, nextBeat = 0, beatPhase = 0;
  const wormPos = new game.THREE.Vector3();
  function rockRattle(pan) {
    const dest = eng.stereoPan(sfx, pan);
    eng.burst({ type: 'bandpass', f0: rnd(900, 2200), q: 3, dur: 0.035, attack: 0.001, gain: rnd(0.05, 0.12), kind: 'white', out: dest });
    eng.blip({ freq: rnd(700, 1800), freq1: rnd(400, 800), dur: 0.05, gain: rnd(0.03, 0.07), out: dest });
  }
  function heartbeat() {
    const t = eng.T();
    eng.blip({ freq: 62, freq1: 40, dur: 0.14, gain: 0.5, out: bus.sfx, attack: 0.012 });
    eng.blip({ freq: 52, freq1: 38, dur: 0.12, gain: 0.34, out: bus.sfx, attack: 0.012, when: t + 0.19 });
  }

  /** Рёв выхода червя: слои шума, свип LP, гармоники и падающий саб. */
  function breach(pos) {
    const t = eng.T() + 0.02;
    const dest = pos ? eng.panner(bus.sfx, pos, { ref: 60, rolloff: 0.8, max: 1500 }) : bus.sfx;
    const mk = (kind, f0, f1, f2, q, dur, atk, g, type = 'lowpass') => {
      const src = ctx.createBufferSource(); src.buffer = eng.noiseBuf(kind); src.loop = true;
      const f = eng.filter(type, f0, q);
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.35); f.frequency.exponentialRampToValueAtTime(f2, t + dur);
      const gn = eng.gain(0);
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g, t + atk); gn.gain.setTargetAtTime(0, t + dur * 0.55, dur * 0.18);
      src.connect(f); f.connect(gn); gn.connect(dest); eng.send(gn, 0.25);
      src.start(t, rnd(0, 2), dur + 1); src.stop(t + dur + 1);
    };
    mk('brown', 70, 900, 140, 1.2, 6, 0.5, 1.0);               // масса тела
    mk('pink', 300, 2400, 500, 2.5, 5, 0.35, 0.7, 'bandpass'); // рёв
    mk('white', 1500, 5500, 1800, 0.7, 3.5, 0.25, 0.28, 'bandpass'); // песок и шипение
    // Хриплый «голос»: пилы с модуляцией (FM-подобный хрип)
    for (const f of [41, 55, 61.5]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 4.5);
      const lp = eng.filter('lowpass', 420, 1.5), gn = eng.gain(0);
      const mod = ctx.createOscillator(), mg = eng.gain(f * 0.6); mod.frequency.value = rnd(23, 38); mod.connect(mg); mg.connect(o.frequency); mod.start(t); mod.stop(t + 5);
      gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(0.18, t + 0.5); gn.gain.setTargetAtTime(0, t + 2.6, 0.7);
      o.connect(lp); lp.connect(gn); gn.connect(dest); o.start(t); o.stop(t + 5);
    }
    // Саб-дроп (без панорамы — давит всем телом)
    eng.blip({ freq: 64, freq1: 20, dur: 3.6, gain: 0.9, out: bus.sfx, attack: 0.08 });
    eng.blip({ freq: 128, freq1: 40, dur: 2.2, gain: 0.25, out: bus.sfx, attack: 0.06, send: 0.3 });
    // Камни, подпрыгивающие вокруг
    for (let i = 0; i < 14; i++) setTimeout(() => rockRattle(rnd(-1, 1)), 200 + i * rnd(120, 260));
  }

  function thump(pos, strong = 1) {
    const dest = pos ? eng.panner(sfx, pos, { ref: 6, rolloff: 1, max: 400 }) : sfx;
    eng.blip({ freq: 84, freq1: 38, dur: 0.38, gain: 0.7 * strong, out: dest, attack: 0.006 });
    eng.burst({ type: 'lowpass', f0: 520, f1: 150, q: 0.7, dur: 0.14, gain: 0.35 * strong, kind: 'brown', out: dest });
    eng.burst({ type: 'bandpass', f0: 2200, q: 2, dur: 0.02, attack: 0.001, gain: 0.12 * strong, out: dest });
  }

  function sealHiss(pos) {
    const dest = pos ? eng.panner(sfx, pos, { ref: 5 }) : sfx;
    eng.burst({ type: 'highpass', f0: 1800, f1: 5200, q: 0.6, dur: 1.5, attack: 0.08, gain: 0.3, kind: 'white', out: dest, send: 0.5 });
    eng.burst({ type: 'bandpass', f0: 600, f1: 400, q: 0.8, dur: 1.2, attack: 0.1, gain: 0.14, kind: 'pink', out: dest, send: 0.5 });
    eng.blip({ freq: 180, freq1: 140, dur: 0.5, gain: 0.15, out: dest, type: 'triangle' });
  }
  function falseRock(pos) {
    const dest = pos ? eng.panner(sfx, pos, { ref: 6 }) : sfx;
    eng.burst({ type: 'lowpass', f0: 240, f1: 80, q: 0.9, dur: 2.6, attack: 0.2, gain: 0.7, kind: 'brown', out: dest, send: 0.4 });
    eng.burst({ type: 'bandpass', f0: 760, f1: 520, q: 7, dur: 2.2, attack: 0.3, gain: 0.12, kind: 'pink', out: dest, send: 0.4 });
    for (let i = 0; i < 6; i++) eng.burst({ type: 'bandpass', f0: rnd(1500, 3000), q: 3, dur: 0.04, gain: 0.1, out: dest, when: eng.T() + rnd(0.2, 2.2) });
  }
  function breath(dry = false) {
    eng.burst({ type: 'bandpass', f0: dry ? 900 : 650, f1: dry ? 600 : 420, q: 0.8, dur: dry ? 1.1 : 0.8, attack: 0.3, gain: dry ? 0.07 : 0.05, kind: 'pink', out: bus.sfx });
  }

  // ---------- Харвестер (комбайн): дизель-турбинный гул, лязг гусениц, клаксон, шипение пряной пыли ----------
  // События: 'Harvester.Start' (клаксон, раскрутка), 'Harvester.Run' (петля, пока на шине 'harvester' state:'running'), 'Harvester.Stop' (гудок, выбег).
  // Позиция — game.harvester?.position; громкость — по расстоянию (PannerNode + «поглощение воздухом»).
  const harv = { built: false, on: false, level: 0, pitch: 0.6, nextClank: 0, lastPos: null };
  function harvBuild() {
    if (harv.built) return;
    harv.built = true;
    const inp = eng.gain(0);                       // сумма источников (уровень = раскрутка)
    const air = eng.filter('lowpass', 6000, 0.5);
    const pn = ctx.createPanner(); pn.panningModel = 'equalpower'; pn.distanceModel = 'inverse'; pn.refDistance = 28; pn.rolloffFactor = 1.15; pn.maxDistance = 4000;
    inp.connect(air); air.connect(pn); pn.connect(sfx); eng.send(inp, 0.12);
    const body = eng.loopNoise('brown'), bl = eng.filter('lowpass', 150, 0.7), bg = eng.gain(1.6);
    body.connect(bl); bl.connect(bg); bg.connect(inp);
    // дизель: расстроенные пилы через НЧ-фильтр с «чухом» (AM ≈ 10 Гц)
    const chug = eng.gain(0.65), lfo = ctx.createOscillator(), lg = eng.gain(0.3); lfo.frequency.value = 10.4; lfo.connect(lg); lg.connect(chug.gain); lfo.start();
    const dl = eng.filter('lowpass', 210, 0.9); dl.connect(chug); chug.connect(inp);
    const oscs = [[27.5, 0], [41.2, 7], [55.3, -6], [82.7, 4]].map(([f, d]) => {
      const o = ctx.createOscillator(); o.type = f > 50 ? 'square' : 'sawtooth'; o.frequency.value = f; o.detune.value = d;
      const g = eng.gain(f > 50 ? 0.12 : 0.3); o.connect(g); g.connect(dl); o.start(); return { o, f };
    });
    // турбина: тонкий вой, растёт с оборотами
    const wh = ctx.createOscillator(); wh.type = 'sawtooth'; wh.frequency.value = 410;
    const wbp = eng.filter('bandpass', 700, 4), wg = eng.gain(0.03); wh.connect(wbp); wbp.connect(wg); wg.connect(inp); wh.start();
    // шипение пряной пыли
    const hs = eng.loopNoise('white'), hhp = eng.filter('highpass', 2600, 0.5), ham = eng.gain(0.5), hg = eng.gain(0.06);
    const hl = ctx.createOscillator(), hlg = eng.gain(0.3); hl.frequency.value = 0.7; hl.connect(hlg); hlg.connect(ham.gain); hl.start();
    hs.connect(hhp); hhp.connect(ham); ham.connect(hg); hg.connect(inp);
    Object.assign(harv, { inp, air, pn, oscs, wh, wg, lfo });
  }
  function harvPos() {
    const p = game.harvester?.position;
    if (p) harv.lastPos = p;
    return harv.lastPos;
  }
  function klaxon(long = false, dest = null) {
    if (!dest) { harvBuild(); dest = harv.inp; }
    const t = eng.T() + 0.02, blasts = long ? [[0, 1.6]] : [[0, 0.55], [0.75, 0.55]];
    for (const [off, d] of blasts) {
      for (const f of [392, 311]) {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
        const bp = eng.filter('bandpass', 950, 0.9), g = eng.gain(0);
        g.gain.setValueAtTime(0, t + off); g.gain.linearRampToValueAtTime(0.1, t + off + 0.03); g.gain.setValueAtTime(0.1, t + off + d - 0.06); g.gain.linearRampToValueAtTime(0, t + off + d);
        o.connect(bp); bp.connect(g); g.connect(dest); o.start(t + off); o.stop(t + off + d + 0.05);
      }
    }
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
    if (!harv.built) return;
    const target = harv.on ? 1 : 0;
    harv.level += (target - harv.level) * (1 - Math.exp(-dt / (harv.on ? 2.2 : 3.2)));   // раскрутка / выбег
    harv.pitch = 0.55 + 0.45 * harv.level;
    const t = eng.T();
    const lvl = harv.level < 0.01 ? 0 : harv.level;
    eng.ramp(harv.inp.gain, lvl, 0.25);
    for (const o of harv.oscs) eng.ramp(o.o.frequency, o.f * harv.pitch, 0.3);
    eng.ramp(harv.wh.frequency, 260 + 260 * harv.level, 0.3);
    eng.ramp(harv.wg.gain, 0.01 + 0.05 * harv.level * harv.level, 0.3);
    eng.ramp(harv.lfo.frequency, 6 + 5 * harv.level, 0.3);
    const hp = harvPos();
    if (hp) {
      const p = harv.pn;
      if (p.positionX) { p.positionX.setTargetAtTime(hp.x, t, 0.1); p.positionY.setTargetAtTime(hp.y ?? 0, t, 0.1); p.positionZ.setTargetAtTime(hp.z, t, 0.1); } else p.setPosition(hp.x, hp.y ?? 0, hp.z);
      game.camera.getWorldPosition(camPos);
      const d = Math.hypot(camPos.x - hp.x, camPos.z - hp.z);
      eng.ramp(harv.air.frequency, clamp(9000 / (1 + d / 160), 450, 9000), 0.3);
    }
    // лязг гусениц
    if (lvl > 0.15 && t > harv.nextClank) {
      eng.burst({ type: 'bandpass', f0: rnd(800, 2600), q: rnd(3, 7), dur: rnd(0.03, 0.08), attack: 0.001, gain: rnd(0.15, 0.4) * lvl, kind: 'white', out: harv.inp, when: t });
      if (Math.random() < 0.5) eng.blip({ freq: rnd(150, 260), freq1: rnd(90, 150), dur: 0.1, gain: 0.22 * lvl, type: 'triangle', out: harv.inp, when: t });
      harv.nextClank = t + (0.2 + Math.random() * 0.14) / (0.6 + harv.pitch * 0.4);
    }
  }
  game.bus.on('harvester', ({ state } = {}) => {
    const s = String(state || '').toLowerCase();
    if (s === 'running' || s === 'run') harvStart(false);
    else if (s) harvStop(false);
  });


  // ---------- Сценарий «червь пожирает харвестер» ----------
  // Фазы приходят событием шины 'worm:devour' {phase, x?, z?, duration?} (см. audio/index.js): рокот червя нарастает → клаксон →
  // переносчик тянет на пределе → рёв и поглощение → обломки. Позиция по умолчанию — game.harvester.position.
  const devourPos = (p) => {
    const h = p && p.x !== undefined ? p : game.harvester?.position;
    return h ? { x: h.x, y: (h.y ?? 0) + 14, z: h.z } : null;
  };
  const devourDest = (p, ref = 40) => { const q = devourPos(p); return q ? eng.panner(sfx, q, { ref, rolloff: 0.8, max: 3500 }) : sfx; };
  /** Рокот червя под землёй: низкие синусы + бурый шум, растёт за dur секунд, затем затухает. */
  function devourRumble(p, dur = 18) {
    const t = eng.T() + 0.02, dest = devourDest(p, 110);
    const out = eng.gain(0.0001); out.connect(dest);
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(1, t + dur * 0.9); out.gain.setTargetAtTime(0, t + dur, 2);
    for (const [f, det] of [[23, 0], [31, 8], [39, -6], [47, 5]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.detune.value = det;
      o.frequency.setValueAtTime(f * 0.8, t); o.frequency.linearRampToValueAtTime(f * 1.2, t + dur);
      const g = eng.gain(0.3); o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 9);
    }
    const src = ctx.createBufferSource(); src.buffer = eng.noiseBuf('brown'); src.loop = true;
    const lp = eng.filter('lowpass', 60, 0.8); lp.frequency.setValueAtTime(60, t); lp.frequency.exponentialRampToValueAtTime(280, t + dur);
    const ng = eng.gain(1.1); src.connect(lp); lp.connect(ng); ng.connect(out); src.start(t, rnd(0, 2)); src.stop(t + dur + 9);
    // песок осыпается всё чаще
    const n = Math.floor(dur * 2.5);
    for (let i = 0; i < n; i++) {
      const at = t + dur * Math.pow(i / n, 0.65);
      eng.burst({ type: 'bandpass', f0: rnd(900, 2200), q: 3, dur: 0.04, attack: 0.001, gain: rnd(0.04, 0.1) * (0.4 + i / n), kind: 'white', out: eng.stereoPan(sfx, rnd(-1, 1)), when: at });
    }
  }
  /** Тревожный клаксон харвестера: n сигналов с паузами. */
  function devourAlarm(p, n = 5) {
    const dest = devourDest(p, 35);
    for (let i = 0; i < n; i++) setTimeout(() => klaxon(i === n - 1, dest), i * 1900);
  }
  /** Переносчик: двигатели на пределе (поднимающийся тон, дрожание винтов), в конце срыв. */
  function devourCarryall(p, dur = 9) {
    const t = eng.T() + 0.02, q = devourPos(p), dest = q ? eng.panner(sfx, { x: q.x, y: q.y + 40, z: q.z }, { ref: 45, rolloff: 0.8, max: 3500 }) : sfx;
    const out = eng.gain(0); out.connect(dest); eng.send(out, 0.2);
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.55, t + 1.5); out.gain.linearRampToValueAtTime(0.9, t + dur * 0.85); out.gain.setTargetAtTime(0, t + dur, 0.8);
    const rotor = ctx.createOscillator(); rotor.type = 'sawtooth';
    rotor.frequency.setValueAtTime(92, t); rotor.frequency.exponentialRampToValueAtTime(136, t + dur);
    const rl = eng.filter('lowpass', 640, 0.9), am = eng.gain(0.6), lfo = ctx.createOscillator(), lg = eng.gain(0.4);
    lfo.frequency.setValueAtTime(10, t); lfo.frequency.linearRampToValueAtTime(17, t + dur); lfo.connect(lg); lg.connect(am.gain);
    rotor.connect(rl); rl.connect(am); am.connect(out);
    const whine = ctx.createOscillator(); whine.type = 'sawtooth';
    whine.frequency.setValueAtTime(420, t); whine.frequency.exponentialRampToValueAtTime(820, t + dur);
    const wb = eng.filter('bandpass', 900, 5), wg = eng.gain(0.05); whine.connect(wb); wb.connect(wg); wg.connect(out);
    const air = ctx.createBufferSource(); air.buffer = eng.noiseBuf('pink'); air.loop = true;
    const ab = eng.filter('bandpass', 1100, 0.7), ag = eng.gain(0.22); air.connect(ab); ab.connect(ag); ag.connect(out);
    for (const o of [rotor, lfo, whine]) { o.start(t); o.stop(t + dur + 4); }
    air.start(t, rnd(0, 2)); air.stop(t + dur + 4);
    // перегруженный двигатель: срывы
    for (let i = 0; i < 4; i++) {
      const at = t + dur * (0.4 + 0.14 * i);
      rl.frequency.setValueAtTime(640, at); rl.frequency.linearRampToValueAtTime(380, at + 0.25); rl.frequency.linearRampToValueAtTime(700 + i * 60, at + 0.6);
    }
  }
  /** Поглощение: рёв червя + скрежет металла. */
  function devourSwallow(p) {
    const q = devourPos(p);
    breach(q);
    const t = eng.T() + 0.4, dest = devourDest(p, 50);
    for (let i = 0; i < 12; i++) {
      const at = t + i * rnd(0.12, 0.34);
      eng.burst({ type: 'bandpass', f0: rnd(350, 2400), q: rnd(4, 9), dur: rnd(0.08, 0.2), attack: 0.002, gain: rnd(0.25, 0.6), kind: 'white', out: dest, when: at, send: 0.3 });
      eng.blip({ freq: rnd(90, 220), freq1: rnd(40, 80), dur: 0.3, gain: 0.35, type: 'triangle', out: dest, when: at });
    }
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(260, t + 2.6);
    const bp = eng.filter('bandpass', 700, 6), g = eng.gain(0);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.14, t + 0.2); g.gain.setTargetAtTime(0, t + 1.6, 0.5);
    o.connect(bp); bp.connect(g); g.connect(dest); o.start(t); o.stop(t + 3);
  }
  /** Обломки: затухающая россыпь лязга и осыпь песка. */
  function devourDebris(p, dur = 8) {
    const t = eng.T() + 0.05, dest = devourDest(p, 40);
    eng.blip({ freq: 70, freq1: 28, dur: 1.4, gain: 0.8, out: sfx, attack: 0.02 });
    eng.burst({ type: 'highpass', f0: 2200, q: 0.5, dur, attack: 0.6, gain: 0.16, kind: 'white', out: dest, when: t, send: 0.4 });
    eng.burst({ type: 'lowpass', f0: 380, f1: 90, q: 0.8, dur: dur * 0.8, attack: 0.3, gain: 0.5, kind: 'brown', out: dest, when: t });
    for (let i = 0; i < 26; i++) {
      const at = t + dur * 0.9 * Math.pow(Math.random(), 1.7);
      eng.burst({ type: 'bandpass', f0: rnd(500, 3200), q: rnd(3, 8), dur: rnd(0.04, 0.14), attack: 0.001, gain: rnd(0.1, 0.4), kind: 'white', out: eng.stereoPan(dest, rnd(-0.6, 0.6)), when: at, send: 0.35 });
    }
  }

  // ---------- Интерфейс ----------
  const ui = {
    hint() { eng.blip({ freq: 660, dur: 0.5, gain: 0.07, type: 'sine', out: bus.ui, attack: 0.04, send: 0.5 }); eng.blip({ freq: 990, dur: 0.6, gain: 0.04, out: bus.ui, attack: 0.05, when: eng.T() + 0.08, send: 0.5 }); },
    titleCard() { eng.blip({ freq: 146.8, dur: 2.4, gain: 0.12, type: 'triangle', out: bus.ui, attack: 0.5, send: 0.8 }); eng.blip({ freq: 220, dur: 2.2, gain: 0.07, out: bus.ui, attack: 0.6, send: 0.8 }); },
    interact() { eng.blip({ freq: 520, dur: 0.07, gain: 0.07, out: bus.ui }); },
    pause() { eng.blip({ freq: 330, freq1: 250, dur: 0.18, gain: 0.08, out: bus.ui }); },
    photo() { eng.burst({ type: 'bandpass', f0: 3000, q: 1, dur: 0.03, gain: 0.2, out: bus.ui }); eng.burst({ type: 'bandpass', f0: 1800, q: 1, dur: 0.05, gain: 0.15, out: bus.ui, when: eng.T() + 0.07 }); },
    tick() { eng.blip({ freq: 740, dur: 0.04, gain: 0.05, out: bus.ui }); },
  };

  // ---------- Реестр событий (AudioEvents.csv) ----------
  const EVENTS = {
    'Foot.Sand': (p) => footstep({ surface: 'sand', ...p }), 'Foot.PackedSand': (p) => footstep({ surface: 'packed', ...p }),
    'Foot.Rock': (p) => footstep({ surface: 'rock', ...p }), 'Foot.SietchStone': (p) => footstep({ surface: 'stone', ...p }),
    'Foot.Cloth': (p) => footstep({ surface: 'cloth', ...p }), 'Foot.Metal': (p) => footstep({ surface: 'metal', ...p }),
    'Foot.Unknown': (p) => footstep({ surface: 'sand', ...p }), 'Foot.SandWalk': (p) => footstep({ surface: 'sand', ...p }),
    'Foot.Companion': (p) => footstep({ surface: 'sand', actor: 'companion', ...p }),
    'Worm.Breach': (p) => breach(p), 'Worm.Roar': (p) => breach(p),
    'Worm.RockHop': () => rockRattle(rnd(-1, 1)), 'Worm.Heartbeat': () => heartbeat(),
    'Worm.Pass': (p) => { eng.burst({ type: 'lowpass', f0: 700, f1: 90, q: 1, dur: 4, attack: 0.5, gain: 0.7, kind: 'brown', out: p ? eng.panner(sfx, p, { ref: 40, max: 1200 }) : sfx }); },
    'Worm.RingSandfall': () => eng.burst({ type: 'highpass', f0: 2500, q: 0.5, dur: 3, attack: 0.4, gain: 0.12, out: sfx }),
    'Thumper.Hit': (p) => thump(p), 'Thumper.Deploy': (p) => { eng.burst({ type: 'bandpass', f0: 1200, q: 2, dur: 0.1, gain: 0.2, out: sfx }); eng.blip({ freq: 180, freq1: 90, dur: 0.15, gain: 0.25, out: sfx }); },
    'Door.SealHiss': (p) => sealHiss(p), 'Door.FalseRock': (p) => falseRock(p),
    'Water.Drip': () => {}, 'Water.Measure': (p) => eng.blip({ freq: 1800, freq1: 2100, dur: 0.12, gain: 0.05, out: p ? eng.panner(sfx, p) : sfx, send: 0.6 }),
    'Loom.Clack': (p) => eng.burst({ type: 'bandpass', f0: 1100, q: 3, dur: 0.03, gain: 0.15, out: p ? eng.panner(sfx, p) : sfx, send: 0.3 }),
    'Stillsuit.Repair': () => eng.burst({ type: 'bandpass', f0: 1400, f1: 900, q: 1.5, dur: 0.5, attack: 0.08, gain: 0.08, out: sfx }),
    'Wind.Gust': () => {},
    'Crowd.Hush': () => {},
    'Player.Breath.Dry': () => breath(true), 'Player.Mask.Seal': () => { eng.burst({ type: 'highpass', f0: 2500, q: 0.5, dur: 0.35, attack: 0.02, gain: 0.12, out: sfx }); },
    'Harvester.Start': () => harvStart(true), 'Harvester.Run': () => harvStart(false), 'Harvester.Stop': () => harvStop(true),
    'Worm.Devour.Rumble': (p) => devourRumble(p), 'Worm.Devour.Alarm': (p) => devourAlarm(p), 'Worm.Devour.Carryall': (p) => devourCarryall(p),
    'Worm.Devour.Swallow': (p) => devourSwallow(p), 'Worm.Devour.Debris': (p) => devourDebris(p),
    'UI.Hint': () => ui.hint(), 'UI.TitleCard': () => ui.titleCard(), 'UI.Interact': () => ui.interact(), 'UI.Pause': () => ui.pause(), 'UI.PhotoShutter': () => ui.photo(), 'UI.Tick': () => ui.tick(),
  };

  // ---------- Подписки ----------
  const off = [];
  off.push(game.bus.on('footstep', footstep));
  off.push(game.bus.on('worm:breach', (e) => breach(e ? { x: e.x, y: game.heightAt?.(e.x, e.z) ?? 0, z: e.z } : null)));
  off.push(game.bus.on('thumper', (e) => thump(e ? { x: e.x, y: game.heightAt?.(e.x, e.z) ?? 0, z: e.z } : null)));
  off.push(game.bus.on('interact', ({ tag } = {}) => {
    if (!tag) return;
    if (/FalseRock/i.test(tag)) falseRock();
    else if (/Thumper/i.test(tag)) EVENTS['Thumper.Deploy']();
    else ui.interact();
  }));
  off.push(game.bus.on('door', () => sealHiss()));
  off.push(game.bus.on('stutter', () => {}));

  let breathAt = 0;
  return {
    footstep, breach, thump, sealHiss, falseRock, rockRattle, heartbeat, ui, devourRumble, devourAlarm, devourCarryall, devourSwallow, devourDebris,
    has: (id) => !!EVENTS[id],
    play(id, pos) { const f = EVENTS[id]; if (f) f(pos); return !!f; },
    update(dt) {
      harvUpdate(dt);
      const w = game.worm, p = game.player;
      const threat = clamp(w?.threat ?? 0, 0, 1);
      // Расстояние до головы червя.
      let prox = 0;
      if (w?.headPos && w.state !== 'Dormant') {
        game.camera.getWorldPosition(camPos);
        const d = camPos.distanceTo(w.headPos);
        prox = clamp(1 - d / 320, 0, 1);
      }
      const rumble = clamp(Math.max(Math.pow(threat, 0.8) * 0.42, prox * prox * 0.75), 0, 1);
      eng.ramp(wormOut.gain, rumble, 0.5);
      const pitch = 1 + threat * 0.25;
      subs.forEach((o, i) => eng.ramp(o.frequency, [26, 31.5, 38, 44.5][i] * pitch, 0.6));
      const moving = w && (w.state === 'Approach' || w.state === 'Surface' || w.state === 'Pass');
      eng.ramp(hissG.gain, moving ? 0.1 * clamp(0.4 + threat * 0.6, 0, 1) * (0.3 + prox * 0.7) : 0, 0.8);
      const now = eng.T();
      // Камни «тук-тук»: частота 0 → 12 Гц по угрозе.
      if (threat > 0.15 && now > nextRock) { rockRattle(rnd(-1, 1)); nextRock = now + 1 / (0.6 + threat * 12) * rnd(0.5, 1.5); }
      // Сердцебиение при высокой угрозе (60 → 110 ударов/мин).
      if (threat > 0.5 && now > nextBeat) { heartbeat(); nextBeat = now + 60 / (60 + (threat - 0.5) * 100); }
      // Сухое дыхание при низкой влаге.
      if (p && (p.moisture ?? 1) < 0.25 && game.space === 'desert' && now > breathAt) { breath(true); breathAt = now + rnd(6, 10); }
    },
  };
}
