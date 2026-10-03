// Процедурная анимация человека: ходьба/бег с IK ног (стопы стоят на месте), покой, повороты, склон, скольжение
// и «походка по песку» (рваный ритм: длинный-короткий-пауза, волочение стопы, замирания, полуприсед).
// Поза считается тремя генераторами (покой / обычная / песок) и смешивается по весам; затем накладываются слои (дыхание, взгляд, речь).
import { rng, clamp, lerp, damp, smoothstep as sstep } from '../core/util.js';

export const L1 = 0.44, L2 = 0.4, ANK = 0.08, HIP_Y = 0.92, LMAX = L1 + L2 - 0.006;
const TAU = Math.PI * 2;
const frac = (x) => x - Math.floor(x);

const KEYS = ['fz0', 'fz1', 'fy0', 'fy1', 'fp0', 'fp1', 'ft0', 'ft1', 'drop', 'px', 'roll', 'pyaw', 'spx', 'spz', 'spy', 'chy', 'chx', 'hx', 'a0', 'a1', 'e0', 'e1', 'z0', 'z1', 'air'];
const mk = () => { const o = {}; for (const k of KEYS) o[k] = 0; o.fy0 = o.fy1 = ANK; o.e0 = o.e1 = 0.22; return o; };
const mix = (out, a, b, t) => { for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t; return out; };

/** Стиль походки по умолчанию; пресеты переопределяют (нервный Райн, собранная Илва, широкая Оссана, старик...). */
export const DEFAULT_STYLE = { armSwing: 1, stride: 1, bounce: 1, hunch: 0, composed: 0, nervous: 0, tempo: 1, sway: 1, stance: 0, shoulders: 0, elder: 0 };

export function createAnimator(parts, cfg = {}) {
  const { root, pelvis, spine, chest, neck, headPivot, limbs } = parts;
  const style = Object.assign({}, DEFAULT_STYLE, cfg.style || {});
  const R = rng(cfg.seed ?? 1337);
  const sc = () => root.scale.y || 1;
  const feet = [limbs.L, limbs.R];
  const S = {
    t: R() * 50, ph: R(), wMove: 0, wRun: 0, wDesert: 0, wSlide: 0, wTalk: 0, spPrev: 0, accel: 0, yawPrev: null, yawRate: 0, Hp: HIP_Y - 0.01,
    sway: 0, lean: 0, headYaw: 0, headPitch: 0, lookYaw: 0, lookW: 0, glanceT: 1 + R() * 3, glanceTarget: 0, glance: 0, floorPrev: [0, 0],
    breath: R() * 6, shiftT: R() * 6, shiftTarget: 0, shift: 0, talk: false, hitch: 0, env: 1, speedL: 0, moving: false, bodyZ: 0,
    pelvisYaw: 0, fidgetT: 3 + R() * 5, fidget: 0, nerv: 0, nervT: 0.5,
  };
  const N = mk(), Dp = mk(), I = mk(), M1 = mk(), P = mk();
  const out = { kz: [0, 0], ky: [0.48, 0.48], az: [0, 0], ay: [ANK, ANK], hipY: HIP_Y };
  const hooks = { onStep: null };

  // ------------------------------------------------------------------ stepper «походки по песку» ----
  const D = {
    feet: [{ wz: 0.02, swing: false, u: 0, lift: 0, pitch: 0, drag: false }, { wz: -0.02, swing: false, u: 0, lift: 0, pitch: 0, drag: false }],
    beat: null, next: 0, pause: 0, count: 0, settle: [0, 0], freezeAt: -1, freezeT: 0,
  };
  function pickBeat() {
    if (D.pause > 0) { const b = { type: 'pause', dur: D.pause, t: 0 }; D.pause = 0; return b; }
    const r = R(), c = ++D.count;
    // «длинный-короткий-пауза»: шаблон с рандомом
    let type = c % 3 === 1 ? (r < 0.7 ? 'long' : 'drag') : c % 3 === 2 ? (r < 0.7 ? 'short' : 'drag') : (r < 0.5 ? 'short' : 'long');
    const bt = { type, foot: D.next, t: 0, startZ: D.feet[D.next].wz, freeze: null };
    if (type === 'long') { bt.dur = 0.56 + R() * 0.14; bt.len = 0.5 + R() * 0.12; bt.lift = 0.05; }
    else if (type === 'short') { bt.dur = 0.34 + R() * 0.12; bt.len = 0.2 + R() * 0.1; bt.lift = 0.028; }
    else { bt.dur = 0.5 + R() * 0.15; bt.len = 0.36; bt.lift = 0.006; bt.dragged = true; }
    if (R() < 0.1 && type !== 'drag') { bt.freeze = { at: 0.35 + R() * 0.3, dur: 0.35 + R() * 0.55, done: false }; }
    D.next ^= 1;
    return bt;
  }
  function endBeat(bt, vL) {
    if (bt.type === 'pause') return;
    const f = D.feet[bt.foot];
    f.swing = false; f.u = 1;
    D.settle[bt.foot] = 0.25;
    hooks.onStep?.({ foot: bt.foot ? 'R' : 'L', side: bt.foot, intensity: bt.dragged ? 0.3 : bt.type === 'long' ? 0.45 : 0.3, mode: 'desert', speed: vL * sc() });
    const r = R();
    if (r < 0.22) D.pause = 0.4 + R() * 0.7;
  }
  function stepDesert(dt, vL, intent, allowPause) {
    D.settle[0] = Math.max(0, D.settle[0] - dt); D.settle[1] = Math.max(0, D.settle[1] - dt);
    S.bodyZ += vL * dt;
    if (!D.beat && intent) D.beat = pickBeat();
    let env = 0.12;
    const bt = D.beat;
    if (bt) {
      if (bt.type === 'pause') {
        if (!allowPause) { D.beat = null; }
        else { bt.t += dt; if (bt.t >= bt.dur) D.beat = null; env = 0.04; }
      } else {
        const f = D.feet[bt.foot];
        f.swing = true;
        let adv = dt;
        if (bt.freeze && !bt.freeze.done) {
          if (bt.t / bt.dur >= bt.freeze.at) { bt.freeze.dur -= dt; adv = 0; if (bt.freeze.dur <= 0) bt.freeze.done = true; }
        }
        bt.t += adv;
        const u = clamp(bt.t / bt.dur, 0, 1);
        const e = u * u * (3 - 2 * u);
        f.u = u;
        const target = S.bodyZ + bt.len * 0.55;
        f.wz = lerp(bt.startZ, target, e);
        f.lift = bt.lift * Math.sin(Math.PI * Math.pow(u, 0.8));
        f.pitch = lerp(0.18, -0.16, u);
        env = (0.32 + 1.15 * Math.pow(Math.sin(Math.PI * u), 1.1)) * (bt.type === 'drag' ? 0.8 : 1);
        if (bt.freeze && !bt.freeze.done && adv === 0) env = 0.03;
        if (u >= 1) { f.lift = 0; f.pitch = 0; endBeat(bt, vL); D.beat = null; }
      }
    }
    // опорные стопы: волочатся, если тело уходит дальше досягаемости
    for (let i = 0; i < 2; i++) {
      const f = D.feet[i];
      if (!f.swing) {
        const lim = 0.36;
        if (f.wz < S.bodyZ - lim) f.wz = S.bodyZ - lim;
        if (f.wz > S.bodyZ + 0.5) f.wz = S.bodyZ + 0.5;
        f.lift = 0; f.pitch = damp(f.pitch, 0, 12, dt);
      }
    }
    D.env = intent ? env : 1;
    return D.env;
  }
  function desertPose(o, dt, vL, intent, allowPause) {
    const env = stepDesert(dt, vL, intent, allowPause);
    S.env = env;
    for (let i = 0; i < 2; i++) {
      const f = D.feet[i];
      o['fz' + i] = f.wz - S.bodyZ;
      o['fy' + i] = ANK + f.lift;
      o['fp' + i] = f.pitch - (f.swing ? 0 : 0);
      o['ft' + i] = 0;
    }
    // подавление уплывания bodyZ
    if (Math.abs(S.bodyZ) > 50) { for (const f of D.feet) f.wz -= S.bodyZ; if (D.beat?.startZ !== undefined) D.beat.startZ -= S.bodyZ; S.bodyZ = 0; }
    const swingFoot = D.feet[0].swing ? 0 : D.feet[1].swing ? 1 : -1;
    const stance = swingFoot < 0 ? (D.next ^ 1) : 1 - swingFoot;
    const swayT = (stance === 0 ? -1 : 1) * 0.03 * style.sway;
    o.px = swayT;
    o.drop = 0.075 + style.stance * 0.02;
    o.roll = -swayT * 0.8;
    o.spx = 0.17 + style.hunch * 0.6; o.hx = 0.1;
    o.pyaw = (D.feet[0].wz - D.feet[1].wz - 0) * 0.1;
    o.chy = -o.pyaw * 0.6; o.spy = 0;
    o.a0 = o.a1 = -0.06; o.e0 = o.e1 = 0.7; o.z0 = o.z1 = 0;
    // руки слегка качаются — минимально
    o.a0 += (D.feet[1].wz - S.bodyZ) * 0.35 * style.armSwing; o.a1 += (D.feet[0].wz - S.bodyZ) * 0.35 * style.armSwing;
    return o;
  }

  // ------------------------------------------------------------------ обычная ходьба/бег ----
  function normalPose(o, ph, ve, slope) {
    const wRun = S.wRun;
    const stepLen = (0.26 + 0.15 * ve) * style.stride * (1 + wRun * 0.12);
    const ds = lerp(0.6, 0.4, wRun);
    const half = stepLen * ds;
    const lift = lerp(0.075, 0.2, wRun) * style.bounce;
    for (let i = 0; i < 2; i++) {
      const pl = frac(ph + i * 0.5);
      let z, y = ANK, pitch = 0, toe = 0;
      if (pl < ds) {
        const s = pl / ds;
        z = lerp(half, -half, s);
        pitch = s < 0.1 ? lerp(-0.3, 0, s / 0.1) : s < 0.62 ? 0 : 0.6 * Math.pow((s - 0.62) / 0.38, 1.3);
        if (wRun > 0.3) pitch = lerp(pitch, s < 0.1 ? 0.1 : pitch, 0.5);
      } else {
        const u = (pl - ds) / (1 - ds);
        const e = u * u * (3 - 2 * u) * 0.5 + u * 0.5;
        z = lerp(-half, half, e);
        y = ANK + lift * Math.sin(Math.PI * Math.pow(u, 0.75));
        pitch = lerp(0.6, -0.3, sstep(0, 0.85, u));
        // колено вперёд при взмахе: за счёт IK
      }
      y += 0.12 * Math.sin(Math.max(0, pitch));
      pitch -= slope * 0.8;
      toe = -Math.max(0, pitch) * 0.9;
      o['fz' + i] = z + 0.01; o['fy' + i] = y; o['fp' + i] = pitch; o['ft' + i] = toe;
    }
    // воздушная фаза бега
    o.air = 0;
    if (wRun > 0.01) { const p2 = frac(ph * 2); if (p2 > ds && p2 < 0.5 + 0.0) { o.air = Math.sin(Math.PI * (p2 - ds) / Math.max(0.01, 0.5 - ds)) * 0.06 * wRun; } }
    const c0 = Math.cos(TAU * ph), s0 = Math.sin(TAU * ph);
    o.drop = wRun * 0.045 + style.hunch * 0.02;
    o.px = -s0 * 0.02 * style.sway * (1 - wRun * 0.5);
    o.roll = s0 * 0.035 * style.sway;
    o.pyaw = (o.fz0 - o.fz1) * (0.18 + wRun * 0.06) * style.sway * (1 - style.composed * 0.4);
    o.spy = -o.pyaw * 0.5; o.chy = -o.pyaw * 0.55;
    o.spx = 0.035 + 0.03 * Math.min(1, ve / 3) + wRun * 0.2 + style.hunch * 0.5;
    o.spz = -s0 * 0.015 * style.sway;
    o.chx = 0.01 * c0;
    const ka = (1.1 + wRun * 0.7) * style.armSwing;
    o.a0 = o.fz1 * ka * 0.95; o.a1 = o.fz0 * ka * 0.95;
    o.e0 = 0.2 + Math.max(0, o.a0) * 0.45 + wRun * 1.0; o.e1 = 0.2 + Math.max(0, o.a1) * 0.45 + wRun * 1.0;
    o.z0 = o.z1 = 0;
    o.hx = 0;
    return o;
  }

  // ------------------------------------------------------------------ покой ----
  function idlePose(o, dt) {
    S.breath += dt * 1.55;
    S.shiftT -= dt;
    if (S.shiftT <= 0) { S.shiftT = 4 + R() * 6; S.shiftTarget = (R() < 0.5 ? -1 : 1) * (0.012 + R() * 0.012); }
    S.shift = damp(S.shift, S.shiftTarget, 1.2, dt);
    const sh = S.shift;
    o.fz0 = 0.03; o.fz1 = -0.02; o.fy0 = o.fy1 = ANK; o.fp0 = o.fp1 = 0; o.ft0 = o.ft1 = 0;
    o.px = sh; o.roll = -sh * 1.6; o.drop = 0.004 + Math.abs(sh) * 0.4 + style.elder * 0.03; o.pyaw = sh * 1.5;
    o.spx = 0.02 + style.hunch * 0.5 + style.elder * 0.08; o.spz = sh * 1.2; o.spy = -sh * 1.0; o.chy = 0; o.chx = 0; o.hx = 0 + style.elder * 0.05 + style.nervous * 0.03;
    o.a0 = o.a1 = 0.02 - style.composed * 0.02; o.e0 = o.e1 = 0.2 + style.hunch * 2; o.z0 = o.z1 = 0; o.air = 0;
    return o;
  }

  // ------------------------------------------------------------------ IK ----
  function solveLeg(i, z, y, pitch, toe, hipY, sway) {
    const lg = feet[i];
    let ty = y - hipY, tz = z;
    let d = Math.hypot(tz, ty);
    if (d > LMAX) { tz *= LMAX / d; ty *= LMAX / d; d = LMAX; }
    if (d < 0.2) d = 0.2;
    const cosK = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1);
    const kf = Math.PI - Math.acos(cosK);
    const al = Math.atan2(tz, -ty);
    const cg = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const phi = al + Math.acos(cg);
    lg.hip.rotation.x = -phi;
    lg.kn.rotation.x = kf;
    lg.foot.rotation.x = pitch - (-phi + kf);
    lg.toe.rotation.x = toe;
    lg.hip.rotation.z = -sway / 0.84;
    // координаты колена/голеностопа для коллизий ткани (корень-пространство)
    out.kz[i] = L1 * Math.sin(phi); out.ky[i] = hipY - L1 * Math.cos(phi);
    out.az[i] = tz; out.ay[i] = hipY + ty;
  }

  // ------------------------------------------------------------------ главный шаг ----
  function update(dt, speed, irregular, ctx = {}) {
    dt = Math.min(dt, 0.1);
    if (dt <= 0) return;
    S.t += dt;
    const s = sc();
    const vL = speed / s;
    const grp = root.parent;
    // скорость поворота
    const yaw = grp ? grp.rotation.y : 0;
    if (S.yawPrev === null) S.yawPrev = yaw;
    let dy = yaw - S.yawPrev; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); S.yawPrev = yaw;
    S.yawRate = damp(S.yawRate, dy / dt, 12, dt);
    S.accel = damp(S.accel, (speed - S.spPrev) / dt, 10, dt); S.spPrev = speed;

    const wantDesert = irregular > 0.45 || ctx.desert === true;
    if (wantDesert && !S.dActive) { S.dActive = true; D.beat = null; D.pause = 0; D.feet[0].wz = S.bodyZ + 0.02; D.feet[1].wz = S.bodyZ - 0.02; D.feet.forEach((f) => { f.swing = false; f.lift = 0; }); }
    if (!wantDesert && S.wDesert < 0.02) S.dActive = false;
    S.wDesert = damp(S.wDesert, wantDesert ? 1 : 0, 7, dt);
    // темп: при остановке на месте и повороте — шаги на месте
    const turnPace = Math.abs(S.yawRate) > 0.6 ? Math.min(1.2, Math.abs(S.yawRate) * 0.22) : 0;
    const veRaw = vL + turnPace * (1 - sstep(0.4, 1.0, vL));
    S.speedL = damp(S.speedL, veRaw, 14, dt);
    const ve = S.speedL;
    S.wMove = damp(S.wMove, sstep(0.12, 0.7, ve), 9, dt);
    S.wRun = damp(S.wRun, sstep(3.7, 5.0, ve) * (1 - S.wDesert), 5, dt);
    S.wSlide = damp(S.wSlide, ctx.sliding ? clamp(ctx.sliding, 0, 1) : 0, 6, dt);
    const slope = clamp(ctx.slope || 0, -0.6, 0.6);

    // фаза обычной походки (по пройденному пути: стопы не скользят)
    const stepLen = (0.26 + 0.15 * ve) * style.stride * (1 + S.wRun * 0.12);
    if (S.hitch > 0) S.hitch -= dt;
    if (ve > 0.1 && S.hitch <= 0) S.ph = frac(S.ph + (ve * dt * style.tempo) / (2 * stepLen));
    for (let i = 0; i < 2; i++) {
      const fl = Math.floor(S.ph + i * 0.5 + 1000);
      if (fl !== S.floorPrev[i]) {
        if (S.floorPrev[i] && S.wMove > 0.6 && S.wDesert < 0.5) hooks.onStep?.({ foot: i ? 'R' : 'L', side: i, intensity: clamp(0.35 + ve * 0.12, 0, 1), mode: S.wRun > 0.5 ? 'run' : 'walk', speed });
        S.floorPrev[i] = fl;
      }
    }

    // позы
    normalPose(N, S.ph, ve, slope);
    if (S.wDesert > 0.01 || wantDesert) desertPose(Dp, dt, vL * 1.0, ve > 0.15, ctx.allowPause === true);
    else { Dp.fz0 = N.fz0; S.env = 1; }
    idlePose(I, dt);
    mix(M1, N, Dp, S.wDesert);
    mix(P, I, M1, S.wMove);

    // ---------- применение ----------
    const stu = S.wMove > 0.05 ? 1 : 0;
    const drop = P.drop;
    let Hp = HIP_Y - 0.012 - drop;
    // скольжение/склон
    Hp -= S.wSlide * 0.2;
    // доступность ног: опускаем таз, чтобы обе стопы достали
    let fz0 = P.fz0, fz1 = P.fz1, fy0 = P.fy0, fy1 = P.fy1;
    if (S.wSlide > 0.01) { fz0 = lerp(fz0, 0.28, S.wSlide); fz1 = lerp(fz1, -0.16, S.wSlide); }
    const reach = (z, y) => y + Math.sqrt(Math.max(0.01, LMAX * LMAX - z * z));
    const lim = Math.min(reach(fz0, fy0), reach(fz1, fy1));
    Hp = Math.min(Hp, lim - 0.004) + P.air;
    S.Hp = damp(S.Hp, Hp, 40, dt);
    const sway = P.px;
    pelvis.position.y = S.Hp;
    pelvis.position.x = sway;
    pelvis.rotation.z = P.roll; pelvis.rotation.y = P.pyaw;
    solveLeg(0, fz0, fy0, P.fp0, P.ft0, S.Hp, sway);
    solveLeg(1, fz1, fy1, P.fp1, P.ft1, S.Hp, sway);
    out.hipY = S.Hp;

    // торс: наклон на ускорении/склоне
    S.lean = damp(S.lean, clamp(S.accel * 0.018, -0.1, 0.14), 6, dt);
    const lean = S.lean + clamp(slope * 0.9, -0.25, 0.3) + S.wSlide * -0.25;
    const bank = clamp(S.yawRate * Math.min(speed, 6) * 0.006, -0.12, 0.12);
    spine.rotation.x = P.spx * 0.55 + lean * 0.5;
    chest.rotation.x = P.spx * 0.45 + lean * 0.5 + P.chx + Math.sin(S.breath) * 0.012 * (1 - S.wMove) * (style.composed ? 0.7 : 1);
    spine.rotation.z = P.spz + bank * 0.6; chest.rotation.z = bank * 0.4 - P.roll * 0.3;
    spine.rotation.y = P.spy; chest.rotation.y = P.chy - clamp(S.yawRate * 0.05, -0.15, 0.15) * S.wMove;
    const totalYaw = P.pyaw + P.spy + P.chy;
    neck.rotation.x = 0.02 + (style.hunch + style.elder * 0.1) * 0.5;

    // голова: стабилизация + взгляд + микродвижения
    S.glanceT -= dt;
    if (S.glanceT <= 0) {
      S.glanceT = (style.nervous ? 0.6 : 2.5) + R() * (style.nervous ? 1.4 : 4.5);
      S.glanceTarget = R() < 0.4 ? 0 : (R() < 0.5 ? -1 : 1) * (0.25 + R() * (0.35 + style.nervous * 0.4));
    }
    S.glance = damp(S.glance, S.glanceTarget * (0.4 + 0.6 * (1 - S.wMove * 0.6)) * (1 - S.lookW * 0.8), style.nervous ? 9 : 4, dt);
    S.headYaw = damp(S.headYaw, S.lookYaw, 12, dt);
    headPivot.rotation.y = S.headYaw + S.glance - totalYaw * 0.85 - chest.rotation.y * 0.0;
    const pitchComp = -(spine.rotation.x + chest.rotation.x + neck.rotation.x) * 0.6;
    let talkNod = 0;
    S.wTalk = damp(S.wTalk, S.talk ? 1 : 0, 6, dt);
    if (S.wTalk > 0.01) talkNod = Math.sin(S.t * 7.3) * 0.035 * S.wTalk + Math.sin(S.t * 2.1) * 0.03 * S.wTalk;
    headPivot.rotation.x = pitchComp + P.hx + talkNod + Math.sin(S.t * 0.7) * 0.006;
    headPivot.rotation.z = -(pelvis.rotation.z + spine.rotation.z + chest.rotation.z) * 0.8 + (style.nervous ? Math.sin(S.t * 13) * 0.004 : 0);

    // руки
    const idle = 1 - S.wMove;
    const br = Math.sin(S.breath);
    for (let i = 0; i < 2; i++) {
      const lg = feet[i], sd = i ? 1 : -1;
      const a = P['a' + i], e = P['e' + i];
      lg.sh.rotation.x = -a;
      lg.sh.rotation.z = sd * (0.075 + 0.05 * idle + S.wRun * 0.05 - S.wDesert * 0.06 + br * 0.006 * idle) + sd * P['z' + i];
      lg.sh.rotation.y = 0;
      lg.el.rotation.x = -e - (style.nervous ? 0.25 * idle : 0);
      lg.hand.rotation.x = -0.1; lg.hand.rotation.z = sd * 0.05;
      lg.sh.position.y = 0.21 + br * 0.003 * idle + (style.nervous ? 0.012 : 0) + style.shoulders * 0.01;
    }
    // жесты при речи (правая рука)
    if (S.wTalk > 0.01) {
      const w = S.wTalk * idle;
      const lg = limbs.R;
      lg.sh.rotation.x = lerp(lg.sh.rotation.x, -0.55 + Math.sin(S.t * 2.3) * 0.22, w);
      lg.el.rotation.x = lerp(lg.el.rotation.x, -(1.0 + Math.sin(S.t * 3.1 + 1) * 0.3), w);
      lg.sh.rotation.z = lerp(lg.sh.rotation.z, 0.25, w);
      lg.hand.rotation.z = Math.sin(S.t * 4.3) * 0.25 * w;
    }
    // слой нервозности (Райн): быстрые подёргивания
    if (style.nervous) {
      S.nervT -= dt;
      if (S.nervT <= 0) { S.nervT = 0.4 + R() * 1.4; S.nerv = (R() - 0.5) * 0.1; }
      chest.rotation.y += S.nerv * 0.3 * idle; headPivot.rotation.x += Math.abs(S.nerv) * 0.4 * idle;
    }
    // скольжение: руки в стороны
    if (S.wSlide > 0.01) for (let i = 0; i < 2; i++) { const sd = i ? 1 : -1; feet[i].sh.rotation.z += sd * 0.7 * S.wSlide; feet[i].sh.rotation.x -= 0.2 * S.wSlide; }

    return out;
  }

  return {
    update, state: S, out, hooks, style,
    get env() { return S.env; },
    get desertness() { return S.wDesert; },
    setTalking(b) { S.talk = b; },
    setLook(yaw, w) { S.lookYaw = yaw * w; S.lookW = w; },
    /** Сбой ритма: Space/stutter. В походке по песку — пауза или замирание стопы в воздухе; в обычной — запинка. */
    stutter() {
      if (S.wDesert > 0.5) {
        D.pause = Math.max(D.pause, 0.5 + R() * 0.5);
        const bt = D.beat;
        if (bt && bt.type !== 'pause' && !bt.freeze) bt.freeze = { at: Math.min(0.9, bt.t / bt.dur + 0.02), dur: 0.35 + R() * 0.3, done: false };
      } else S.hitch = 0.16 + R() * 0.12;
    },
    reset() { S.bodyZ = 0; D.beat = null; D.pause = 0; for (const f of D.feet) { f.swing = false; f.lift = 0; f.wz = f === D.feet[0] ? 0.02 : -0.02; } },
  };
}
