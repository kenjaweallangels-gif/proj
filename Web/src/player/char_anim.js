// Процедурная анимация человека v2.
//  • Ноги: IK с «замком» стоп в мире (стопа в опоре не скользит ни при ходьбе, ни при повороте): позиции стоп хранятся в локальной системе
//    корня и на каждом кадре пересчитываются обратным движением тела. Опора катится пятка → стопа → носок; шаг ставится на предсказанное
//    положение таза (длина/частота шага — по скорости: кадансы и коэффициент опоры как у человека; бег — с фазой полёта).
//  • Остановка и старт — через те же шаги (шаг «в упор»), без смешивания поз стоп. Поворот на месте — переступание.
//  • Корпус: встречные вращения таза и плеч, перенос веса, наклон на ускорении, дыхание; руки с отставанием локтя; голова стабилизирована.
//  • «Походка по песку»: рваный ритм (длинный-короткий-пауза, волочение, замирания) — свой генератор, плавно смешивается по весу.
//  • Все пружины — точные критически-демпфированные решения (устойчивы при любом dt); шаг ограничен 0.1 c, длинные кадры дробятся на подшаги.
import { rng, clamp, lerp, smoothstep as sstep } from '../core/util.js';

export const L1 = 0.44, L2 = 0.4, ANK = 0.08, HIP_Y = 0.92, LMAX = L1 + L2 - 0.006;
const TAU = Math.PI * 2;
const frac = (x) => x - Math.floor(x);
const HIPX = 0.09, NEUT_X = 0.098, HEEL = 0.09, TOE_G = 0.27, BALL_DZ = TOE_G - HEEL; // стопа: пятка→голеностоп 0.09, пятка→носок-опора 0.24

/** Критически-демпфированная пружина (точное решение): s = [x, v]; возвращает x. */
function spring(s, target, omega, dt) {
  const d = s[0] - target, e = Math.exp(-omega * dt), t = s[1] + omega * d;
  s[0] = target + (d + t * dt) * e;
  s[1] = (s[1] - omega * t * dt) * e;
  return s[0];
}
const sp = (x = 0) => [x, 0];

/** Стиль походки по умолчанию; пресеты переопределяют (нервный Райн, собранная Илва, широкая Оссана, старик...). */
export const DEFAULT_STYLE = { armSwing: 1, stride: 1, bounce: 1, hunch: 0, composed: 0, nervous: 0, tempo: 1, sway: 1, stance: 0, shoulders: 0, elder: 0 };

// Поворот пары (x, z) на угол φ вокруг Y (как матрица Ry в three): x' = x c + z s, z' = -x s + z c.
const rotX = (x, z, c, s) => x * c + z * s;
const rotZ = (x, z, c, s) => -x * s + z * c;

// Параметры позы «покой/песок» — смешиваются по весу (только не-ножные).
const KEYS = ['drop', 'px', 'roll', 'pyaw', 'spx', 'spz', 'spy', 'chy', 'chx', 'hx', 'a0', 'a1', 'e0', 'e1', 'z0', 'z1', 'air'];
const mk = () => { const o = {}; for (const k of KEYS) o[k] = 0; o.e0 = o.e1 = 0.22; return o; };
const mix = (out, a, b, t) => { for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t; return out; };

export function createAnimator(parts, cfg = {}) {
  const { root, pelvis, spine, chest, neck, headPivot, limbs } = parts;
  const style = Object.assign({}, DEFAULT_STYLE, cfg.style || {});
  const R = rng(cfg.seed ?? 1337);
  const sc = () => root.scale.y || 1;
  const sides = [limbs.L, limbs.R];
  const S = {
    t: R() * 50, ph: 0, wMove: 0, wRun: 0, wDesert: 0, wSlide: 0, wTalk: 0, spPrev: 0, accel: 0, yawPrev: null, yawRate: 0, Hp: HIP_Y - 0.01,
    sway: 0, lean: 0, headYaw: 0, headPitch: 0, lookYaw: 0, lookW: 0, glanceT: 1 + R() * 3, glanceTarget: 0, glance: 0,
    breath: R() * 6, shiftT: 2 + R() * 4, shiftTarget: 0, shift: 0, talk: false, hitch: 0, env: 1, speedL: 0, moving: false, bodyZ: 0,
    pelvisYaw: 0, nerv: 0, nervT: 0.5, vx: 0, vz: 0, mode: 'idle', phi: 0, steps: 0, ds: 0.62, dActive: false, posValid: false, px: 0, pz: 0, turnAcc: 0,
  };
  // пружины (x, v)
  const K = {
    hp: sp(HIP_Y - 0.01), px: sp(), roll: sp(), pyaw: sp(), amp: sp(), ampRun: sp(), a0: sp(), a1: sp(), e0: sp(0.2), e1: sp(0.2), h0: sp(), h1: sp(),
    lean: sp(), slide: sp(), spx: sp(), headYaw: sp(), headPitch: sp(), headRoll: sp(), glance: sp(), nerv: sp(), shift: sp(), lookYaw: sp(), ds: sp(0.62),
    f0y: sp(ANK), f1y: sp(ANK), f0p: sp(), f1p: sp(), vx: sp(), vz: sp(), yawRate: sp(),
  };
  const N = mk(), Dp = mk(), I = mk(), M1 = mk(), P = mk();
  const out = { kz: [0, 0], ky: [0.48, 0.48], az: [0, 0], ay: [ANK, ANK], hipY: HIP_Y };
  const hooks = { onStep: null };

  // ------------------------------------------------------------------ ноги: «замок» стоп ----
  // Координаты — в локальной системе корня (единицы корня): x влево фигуры, z вперёд. Позиция голеностопа стоп в итоге: ax, az, ay.
  const mkFoot = (i) => ({
    i, side: i ? 1 : -1, stance: true, s: 0.3, p: 0, Hx: (i ? 1 : -1) * NEUT_X, Hz: (i ? -0.02 : 0.03) - HEEL, yaw: 0, // замок пятки (мир)
    sx: 0, sz: 0, sy: ANK, sp: 0, syaw: 0, tx: 0, tz: 0, // старт и цель махового шага
    fixed: false, fdur: 0, ft: 0, lift: 0.07, u: 0, ax: (i ? 1 : -1) * NEUT_X, az: (i ? -0.02 : 0.03), ay: ANK, pitch: 0, toe: 0, swingT: 0, swingDur: 0.4, firstStep: 0,
  });
  const F = [mkFoot(0), mkFoot(1)];
  let rollTheta = 0, rollDz = 0, rollDy = 0;
  /** Профиль опоры: s∈[0,1] → смещение голеностопа от пятки (dz, dy) и тангаж θ (+ носками вниз). */
  function rollModel(s, run) {
    const s1 = 0.1, s2 = 0.6, th0 = lerp(-0.3, -0.06, run);
    let th, dz, dy;
    if (s < s1) {
      th = th0 * (1 - sstep(0, s1, s));
      const c = Math.cos(th), sn = Math.sin(th); dz = HEEL * c + ANK * sn; dy = -HEEL * sn + ANK * c;
    } else if (s < s2) { th = 0; dz = HEEL; dy = ANK; }
    else {
      const k = (s - s2) / (1 - s2); th = 0.78 * Math.pow(k, 1.25);
      const c = Math.cos(th), sn = Math.sin(th), vz = -BALL_DZ, vy = ANK;
      dz = TOE_G + vz * c + vy * sn; dy = -vz * sn + vy * c;
    }
    rollTheta = th; rollDz = dz; rollDy = dy;
  }
  // Применить к стопам обратное движение тела (замок в мире).
  function lockFrame(dx, dz, dyaw) {
    const c = Math.cos(dyaw), s = Math.sin(dyaw);
    for (const f of F) {
      let x, z;
      x = f.Hx - dx; z = f.Hz - dz; f.Hx = x * c - z * s; f.Hz = x * s + z * c;
      x = f.sx - dx; z = f.sz - dz; f.sx = x * c - z * s; f.sz = x * s + z * c;
      if (f.fixed) { x = f.tx - dx; z = f.tz - dz; f.tx = x * c - z * s; f.tz = x * s + z * c; }
      f.yaw = clamp(f.yaw - dyaw, -1.1, 1.1); f.syaw = clamp(f.syaw - dyaw, -1.1, 1.1);
    }
  }
  // Стопа в опоре → голеностоп
  function stanceAnkle(f, run) {
    rollModel(f.s, run);
    const fs = Math.sin(f.yaw), fc = Math.cos(f.yaw);
    f.ax = f.Hx + fs * rollDz; f.az = f.Hz + fc * rollDz; f.ay = rollDy; f.pitch = rollTheta;
  }
  function onStepEvent(f, mode, ago, vL, rel) {
    hooks.onStep?.({ ago, foot: f.i ? 'R' : 'L', side: f.i, intensity: clamp(0.35 + vL * 0.12, 0, 1) * rel, mode, speed: vL * sc() });
  }

  const G = { f: 1.8, Tc: 1.1, ds: 0.6, vx: 0, vz: 0, ve: 0, run: 0 };
  function startSwing(f, fixed, dur, tx, tz, lift) {
    // стартовая поза маха: текущая поза голеностопа
    f.sx = f.ax; f.sz = f.az; f.sy = f.ay; f.sp = f.pitch; f.syaw = f.yaw;
    f.stance = false; f.fixed = fixed; f.swingT = 0; f.lift = lift;
    if (fixed) { f.tx = tx; f.tz = tz; f.swingDur = dur; }
  }
  function touchdown(f, run, ago, vL) {
    const rollTd = lerp(-0.3, -0.06, run);
    // голеностоп при касании = H + Rot(th0)(HEEL, ANK) → H
    const c = Math.cos(rollTd), sn = Math.sin(rollTd), dz0 = HEEL * c + ANK * sn;
    const fs = Math.sin(f.yaw), fc = Math.cos(f.yaw);
    f.Hx = f.ax - fs * dz0; f.Hz = f.az - fc * dz0;
    f.stance = true; f.fixed = false; f.s = 0;
    onStepEvent(f, S.wDesert > 0.5 ? 'desert' : run > 0.5 ? 'run' : 'walk', ago, vL, 1);
    S.steps++;
  }

  // ------------------------------------------------------------------ stepper «походки по песку» ----
  const D = {
    feet: [{ wz: 0.02, swing: false, u: 0, lift: 0, pitch: 0 }, { wz: -0.02, swing: false, u: 0, lift: 0, pitch: 0 }],
    beat: null, next: 0, pause: 0, count: 0, settle: [0, 0], env: 1,
  };
  function pickBeat() {
    if (D.pause > 0) { const b = { type: 'pause', dur: D.pause, t: 0 }; D.pause = 0; return b; }
    const r = R(), c = ++D.count;
    const type = c % 3 === 1 ? (r < 0.7 ? 'long' : 'drag') : c % 3 === 2 ? (r < 0.7 ? 'short' : 'drag') : (r < 0.5 ? 'short' : 'long');
    const bt = { type, foot: D.next, t: 0, startZ: D.feet[D.next].wz, freeze: null };
    if (type === 'long') { bt.dur = 0.56 + R() * 0.14; bt.len = 0.5 + R() * 0.12; bt.lift = 0.05; }
    else if (type === 'short') { bt.dur = 0.34 + R() * 0.12; bt.len = 0.2 + R() * 0.1; bt.lift = 0.028; }
    else { bt.dur = 0.5 + R() * 0.15; bt.len = 0.36; bt.lift = 0.006; bt.dragged = true; }
    if (R() < 0.1 && type !== 'drag') bt.freeze = { at: 0.35 + R() * 0.3, dur: 0.35 + R() * 0.55, done: false };
    D.next ^= 1;
    return bt;
  }
  function endBeat(bt, vL) {
    if (bt.type === 'pause') return;
    const f = D.feet[bt.foot];
    f.swing = false; f.u = 1;
    D.settle[bt.foot] = 0.25;
    hooks.onStep?.({ ago: Math.max(0, bt.t - bt.dur), foot: bt.foot ? 'R' : 'L', side: bt.foot, intensity: bt.dragged ? 0.3 : bt.type === 'long' ? 0.45 : 0.3, mode: 'desert', speed: vL * sc() });
    if (R() < 0.22) D.pause = 0.4 + R() * 0.7;
  }
  function stepDesert(dt, vL, intent, allowPause) {
    D.settle[0] = Math.max(0, D.settle[0] - dt); D.settle[1] = Math.max(0, D.settle[1] - dt);
    S.bodyZ += vL * dt;
    if (!D.beat && intent) D.beat = pickBeat();
    let env = 0.12;
    const bt = D.beat;
    if (bt) {
      if (bt.type === 'pause') {
        if (!allowPause) D.beat = null;
        else { bt.t += dt; if (bt.t >= bt.dur) D.beat = null; env = 0.04; }
      } else {
        const f = D.feet[bt.foot];
        f.swing = true;
        let adv = dt;
        if (bt.freeze && !bt.freeze.done && bt.t / bt.dur >= bt.freeze.at) { bt.freeze.dur -= dt; adv = 0; if (bt.freeze.dur <= 0) bt.freeze.done = true; }
        bt.t += adv;
        const u = clamp(bt.t / bt.dur, 0, 1), e = u * u * (3 - 2 * u);
        f.u = u;
        f.wz = lerp(bt.startZ, S.bodyZ + bt.len * 0.55, e);
        f.lift = bt.lift * Math.sin(Math.PI * Math.pow(u, 0.8));
        f.pitch = lerp(0.18, -0.16, u);
        env = (0.32 + 1.15 * Math.pow(Math.sin(Math.PI * u), 1.1)) * (bt.type === 'drag' ? 0.8 : 1);
        if (bt.freeze && !bt.freeze.done && adv === 0) env = 0.03;
        if (u >= 1) { f.lift = 0; f.pitch = 0; endBeat(bt, vL); D.beat = null; }
      }
    }
    for (let i = 0; i < 2; i++) {
      const f = D.feet[i];
      if (!f.swing) {
        if (f.wz < S.bodyZ - 0.36) f.wz = S.bodyZ - 0.36;
        if (f.wz > S.bodyZ + 0.5) f.wz = S.bodyZ + 0.5;
        f.lift = 0; f.pitch += (0 - f.pitch) * (1 - Math.exp(-12 * dt));
      }
    }
    D.env = intent ? env : 1;
    return D.env;
  }
  const DF = [{ z: 0, y: ANK, p: 0 }, { z: 0, y: ANK, p: 0 }];
  function desertPose(o, dt, vL, intent, allowPause) {
    const env = stepDesert(dt, vL, intent, allowPause);
    S.env = env;
    for (let i = 0; i < 2; i++) { const f = D.feet[i]; DF[i].z = f.wz - S.bodyZ; DF[i].y = ANK + f.lift; DF[i].p = f.pitch; }
    if (Math.abs(S.bodyZ) > 50) { for (const f of D.feet) f.wz -= S.bodyZ; if (D.beat?.startZ !== undefined) D.beat.startZ -= S.bodyZ; S.bodyZ = 0; }
    const swingFoot = D.feet[0].swing ? 0 : D.feet[1].swing ? 1 : -1;
    const stance = swingFoot < 0 ? (D.next ^ 1) : 1 - swingFoot;
    const swayT = (stance === 0 ? -1 : 1) * 0.03 * style.sway;
    o.px = swayT; o.drop = 0.075 + style.stance * 0.02; o.roll = -swayT * 0.8;
    o.spx = 0.17 + style.hunch * 0.6; o.hx = 0.1;
    o.pyaw = (DF[0].z - DF[1].z) * 0.1; o.chy = -o.pyaw * 0.6; o.spy = 0;
    o.a0 = o.a1 = -0.06; o.e0 = o.e1 = 0.7; o.z0 = o.z1 = 0; o.air = 0;
    o.a0 += DF[1].z * 0.35 * style.armSwing; o.a1 += DF[0].z * 0.35 * style.armSwing;
    return o;
  }

  // ------------------------------------------------------------------ обычная ходьба/бег: корпус ----
  const nrm = { sx: 0, spx: 0, drop: 0 };
  function normalPose(o, ve, run, slope) {
    const wm = S.wMove, ph0 = frac(S.phi), ph1 = frac(S.phi + 0.5);
    const c0 = Math.cos(TAU * ph0), s0 = Math.sin(TAU * ph0);
    // опорные веса (плавные): стопа i в опоре, мягкие края
    const w0 = F[0].stance ? sstep(0, 0.12, F[0].s) * (1 - sstep(0.82, 1.0, F[0].s)) * 0.5 + 0.5 * (F[0].s < 0.5 ? 1 : 0.4) : 0;
    const w1 = F[1].stance ? sstep(0, 0.12, F[1].s) * (1 - sstep(0.82, 1.0, F[1].s)) * 0.5 + 0.5 * (F[1].s < 0.5 ? 1 : 0.4) : 0;
    const ws = w0 + w1 > 0.01 ? (w1 - w0) / (w0 + w1) : 0; // -1 опора левой … +1 правой
    const vv = Math.min(ve, 6.5), swayK = style.sway * (1 - style.composed * 0.4);
    o.drop = run * 0.04 + 0.012 + Math.min(0.02, vv * 0.006) + style.hunch * 0.02;
    o.px = ws * (0.014 + 0.006 * Math.min(1, vv / 1.5)) * swayK * (1 - run * 0.6);
    o.roll = ws * 0.03 * swayK * (1 - run * 0.4);
    // таз ведёт вперёд ногу на стороне маха; плечи — встречно
    const pyAmp = (0.035 + 0.022 * Math.min(vv, 3) + run * 0.05) * swayK;
    o.pyaw = c0 * pyAmp * wm;
    o.spy = -o.pyaw * 0.8; o.chy = -o.pyaw * 1.15;
    o.spx = 0.035 + 0.03 * Math.min(1, vv / 3) + run * 0.2 + style.hunch * 0.5;
    o.spz = -ws * 0.03 * swayK; o.chx = 0.008 * Math.cos(TAU * ph0 * 2);
    // руки: противофаза ногам; локоть отстаёт по фазе
    const amp = clamp((0.14 + 0.115 * vv) * (1 + run * 0.35), 0, 0.95) * style.armSwing;
    const a0 = amp * Math.cos(TAU * ph1), a1 = amp * c0;
    const eb = lerp(0.2 + 0.04 * vv, 1.15, run), ea = (0.18 + 0.09 * vv) * (1 + run * 0.35);
    o.a0 = a0; o.a1 = a1;
    o.e0 = eb + ea * (0.5 + 0.5 * Math.cos(TAU * (ph1 - 0.13))); o.e1 = eb + ea * (0.5 + 0.5 * Math.cos(TAU * (ph0 - 0.13)));
    o.z0 = o.z1 = 0; o.hx = 0; o.air = 0;
    if (run > 0.01) {
      // полёт: таз выше, когда обе стопы в маху
      const fl = (F[0].stance ? 0 : 1) * (F[1].stance ? 0 : 1);
      o.air = fl * 0.045 * run;
    }
    return o;
  }

  // ------------------------------------------------------------------ покой ----
  function idlePose(o, dt) {
    S.breath += dt * 1.55;
    S.shiftT -= dt;
    if (S.shiftT <= 0) { S.shiftT = 4 + R() * 7; S.shiftTarget = (R() < 0.5 ? -1 : 1) * (0.01 + R() * 0.012); if (R() < 0.25) S.shiftTarget = 0; }
    const sh = spring(K.shift, S.shiftTarget, 2.2, dt);
    o.px = sh; o.roll = -sh * 1.5; o.drop = 0.004 + Math.abs(sh) * 0.4 + style.elder * 0.03; o.pyaw = sh * 1.2;
    o.spx = 0.02 + style.hunch * 0.5 + style.elder * 0.08; o.spz = sh * 1.1; o.spy = -sh * 0.8; o.chy = 0; o.chx = 0; o.hx = style.elder * 0.05 + style.nervous * 0.03;
    o.a0 = o.a1 = 0.02 - style.composed * 0.02; o.e0 = o.e1 = 0.2 + style.hunch * 2; o.z0 = o.z1 = 0; o.air = 0;
    return o;
  }

  // ------------------------------------------------------------------ IK ноги ----
  const tmp = { x: 0, y: 0, z: 0 };
  function solveLeg(i, ax, ay, az, pitch, toe, yaw, Hp, px, roll, pyaw) {
    const lg = sides[i], side = i ? 1 : -1;
    // вектор от таза до голеностопа → в систему таза (Ry(pyaw)·Rz(roll))^-1
    let x = ax - px, y = ay - Hp, z = az;
    const cp = Math.cos(pyaw), sp_ = Math.sin(pyaw);
    let x1 = x * cp - z * sp_, z1 = x * sp_ + z * cp;
    const cr = Math.cos(roll), sr = Math.sin(roll);
    let x2 = x1 * cr + y * sr, y2 = -x1 * sr + y * cr;
    const tx = x2 - HIPX * side, ty = y2, tz = z1;
    // отведение: x голеностопа = (L1 + L2 cos k) sin α; k зависит от α — две итерации
    let alpha = Math.asin(clamp(tx / (L1 + L2), -0.6, 0.6)), kf = 0, phi = 0;
    for (let it = 0; it < 2; it++) {
      const ca = Math.cos(alpha);
      let ey = ty, ez = tz, d = Math.hypot(ez, ey);
      const lmax = LMAX * ca;
      if (d > lmax) { ez *= lmax / d; ey *= lmax / d; d = lmax; }
      if (d < 0.2) d = 0.2;
      const l1 = L1 * ca, l2 = L2 * ca;
      const cosK = clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1);
      kf = Math.PI - Math.acos(cosK);
      const al = Math.atan2(ez, -ey), cg = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
      phi = al + Math.acos(cg);
      out.az[i] = ez; out.ay[i] = Hp + ey;
      if (it === 0) alpha = Math.asin(clamp(tx / (L1 + L2 * Math.cos(kf)), -0.6, 0.6));
    }
    lg.hip.rotation.x = -phi;
    lg.hip.rotation.z = alpha;
    const yr = clamp(yaw - pyaw, -0.9, 0.9);
    lg.hip.rotation.y = yr * 0.2; lg.foot.rotation.y = yr * 0.8;
    lg.kn.rotation.x = kf;
    lg.foot.rotation.x = pitch - (-phi + kf);
    lg.toe.rotation.x = toe;
    out.kz[i] = L1 * Math.sin(phi); out.ky[i] = Hp - L1 * Math.cos(phi);
  }
  const reachY = (z, x, y) => y + Math.sqrt(Math.max(0.01, LMAX * LMAX - z * z - x * x));
const smin = (a, b, k) => { const hh = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - hh * hh * k * 0.25; };

  // ------------------------------------------------------------------ главный шаг ----
  let lastX = 0, lastZ = 0;
  function update(dt, speed, irregular, ctx = {}) {
    dt = Math.min(dt, 0.1);
    if (dt <= 0) return out;
    const n = dt > 0.036 ? Math.ceil(dt / 0.033) : 1, h = dt / n;
    const grp = root.parent, s = sc();
    S.t += dt;
    // --- движение тела за кадр (в локальной системе корня) ---
    const yaw = grp ? grp.rotation.y : 0;
    let dyaw = 0, dxl = 0, dzl = 0, measuredOk = false;
    if (S.yawPrev === null) S.yawPrev = yaw;
    dyaw = yaw - S.yawPrev; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)); S.yawPrev = yaw;
    if (grp) {
      const gx = grp.position.x, gz = grp.position.z;
      if (S.posValid) {
        const dx = gx - S.px, dz = gz - S.pz, cy = Math.cos(yaw - dyaw), sy = Math.sin(yaw - dyaw); // локальная система предыдущего кадра
        const lx = (dx * cy - dz * sy) / s, lz = (dx * sy + dz * cy) / s, m = Math.hypot(lx, lz), ex = speed / s * dt;
        if (m < 0.5 + ex * 2 && (m > 0.5 * ex - 0.003 || ex < 1e-4) && m < ex * 1.8 + 0.004 + (ctx.vel ? ex : 0)) { dxl = lx; dzl = lz; measuredOk = true; }
      }
      S.px = gx; S.pz = gz; S.posValid = true;
    }
    if (!measuredOk) { dxl = 0; dzl = speed / s * dt; } // «беговая дорожка»: фигура не смещается, но идёт
    S.yawRate = spring(K.yawRate, dyaw / dt, 9, dt);
    S.accel += ((speed - S.spPrev) / dt - S.accel) * (1 - Math.exp(-10 * dt)); S.spPrev = speed;
    // скорость (локальная, единицы корня/с), сглаженная
    spring(K.vx, dxl / dt, 14, dt); spring(K.vz, dzl / dt, 14, dt);
    const vx = K.vx[0], vz = K.vz[0], ve = Math.hypot(vx, vz);
    S.vx = vx; S.vz = vz;
    const vL = speed / s;

    const wantDesert = irregular > 0.45 || ctx.desert === true;
    if (wantDesert && !S.dActive) {
      S.dActive = true; D.beat = null; D.pause = 0;
      D.feet[0].wz = S.bodyZ + F[0].az; D.feet[1].wz = S.bodyZ + F[1].az;
      D.feet.forEach((f) => { f.swing = false; f.lift = 0; f.pitch = 0; });
    }
    if (!wantDesert && S.dActive && S.wDesert < 0.02) {
      S.dActive = false;
      // нормальная походка продолжается из положения песчаной: замок на текущих стопах
      for (let i = 0; i < 2; i++) { const f = F[i]; f.ax = f.side * NEUT_X; f.az = DF[i].z; f.ay = DF[i].y; f.pitch = DF[i].p; f.s = 0.3; f.stance = true; f.fixed = false; f.yaw = 0; f.Hx = f.ax; f.Hz = f.az - HEEL; }
      S.mode = 'idle'; S.steps = 0;
    }
    S.wDesert = clamp(spring(K.h0, wantDesert ? 1 : 0, 6, dt), 0, 1);
    const turn = Math.abs(S.yawRate);
    const turnPace = turn > 0.55 && ve < 0.5 ? Math.min(1.1, turn * 0.2) : 0;
    const veEff = Math.max(ve, turnPace);
    S.speedL = veEff;
    const wmT = sstep(0.1, 0.55, veEff);
    S.wMove = clamp(spring(K.h1, wmT, 8, dt), 0, 1);
    const runT = sstep(3.5, 5.0, ve) * (1 - S.wDesert);
    S.wRun = clamp(spring(K.ampRun, runT, 5, dt), 0, 1);
    S.wSlide = clamp(spring(K.slide, ctx.sliding ? clamp(ctx.sliding, 0, 1) : 0, 6, dt), 0, 1);
    const slope = clamp(ctx.slope || 0, -0.6, 0.6);
    const run = S.wRun;

    // --- параметры шага ---
    const fq = clamp(1.3 + 0.42 * veEff - 0.016 * veEff * veEff, 1.2, 3.4) * style.tempo;
    G.f = fq; G.Tc = 2 / fq; // style.stride масштабирует длину шага ниже
    const dsT = lerp(0.64, 0.36, sstep(2.2, 5.5, ve));
    G.ds = clamp(spring(K.ds, dsT, 3, dt), 0.34, 0.66); G.run = run;
    const stepScale = style.stride * (1 - 0.32 * run);

    // --- подшаги ходьбы ---
    if (S.wDesert < 0.999) {
      for (let k = 0; k < n; k++) {
        lockFrame(dxl / n, dzl / n, dyaw / n);
        gaitCore(h, ve, veEff, vx, vz, run, stepScale, slope, n === 1 ? 0 : 0);
      }
    } else { lockFrame(dxl, dzl, dyaw); }
    // ноги в положении «опора» пересчитываем в голеностоп для вывода
    // (в gaitCore; здесь — только песок)
    normalPose(N, ve, run, slope);
    if (S.wDesert > 0.001 || wantDesert) desertPose(Dp, dt, vL, ve > 0.15, ctx.allowPause === true); else { S.env = 1; for (const k of KEYS) Dp[k] = N[k]; }
    idlePose(I, dt);
    mix(M1, N, Dp, S.wDesert);
    mix(P, I, M1, S.wMove);
    // совместимость: фаза для внешнего мира
    S.ph = frac(S.phi);

    // ---------- применение: таз ----------
    const drop = P.drop;
    let Hp = HIP_Y - 0.012 - drop - S.wSlide * 0.2;
    // цели стоп = смесь нормальной и песчаной походки
    const wd = S.wDesert;
    let ax0 = F[0].ax, az0 = F[0].az, ay0 = F[0].ay, p0 = F[0].pitch, ax1 = F[1].ax, az1 = F[1].az, ay1 = F[1].ay, p1 = F[1].pitch;
    if (wd > 0.001) {
      const dx = NEUT_X;
      ax0 = lerp(ax0, -dx, wd); ax1 = lerp(ax1, dx, wd);
      az0 = lerp(az0, DF[0].z, wd); az1 = lerp(az1, DF[1].z, wd); ay0 = lerp(ay0, DF[0].y, wd); ay1 = lerp(ay1, DF[1].y, wd); p0 = lerp(p0, DF[0].p, wd); p1 = lerp(p1, DF[1].p, wd);
    }
    // уклон: стопы параллельны склону
    p0 -= slope * 0.8 * (F[0].stance ? 1 : 0.5); p1 -= slope * 0.8 * (F[1].stance ? 1 : 0.5);
    if (S.wSlide > 0.01) { az0 = lerp(az0, 0.28, S.wSlide); az1 = lerp(az1, -0.16, S.wSlide); }
    // высота таза: чтобы обе стопы достали
    const lim = smin(reachY(az0, ax0 - P.px + HIPX, ay0), reachY(az1, ax1 - P.px - HIPX, ay1), 0.03);
    const hpS = smin(spring(K.hp, Hp, 14, dt), lim - 0.006, 0.02) + P.air;
    S.Hp = hpS;
    const px = P.px;
    pelvis.position.y = hpS; pelvis.position.x = px;
    pelvis.rotation.z = P.roll; pelvis.rotation.y = P.pyaw;
    const toe0 = -Math.max(0, p0) * 0.9, toe1 = -Math.max(0, p1) * 0.9;
    const f0y = ay0, f1y = ay1, f0p = p0, f1p = p1;
    solveLeg(0, ax0, f0y, az0, f0p, toe0, F[0].yaw * (1 - wd), hpS, px, P.roll, P.pyaw);
    solveLeg(1, ax1, f1y, az1, f1p, toe1, F[1].yaw * (1 - wd), hpS, px, P.roll, P.pyaw);
    out.hipY = hpS;

    // ---------- торс ----------
    const leanT = clamp(S.accel * 0.018, -0.1, 0.14);
    const lean = spring(K.lean, leanT, 6, dt) + clamp(slope * 0.9, -0.25, 0.3) + S.wSlide * -0.25;
    const bank = clamp(S.yawRate * Math.min(speed, 6) * 0.006, -0.12, 0.12);
    const hitchK = S.hitch > 0 ? Math.sin(Math.PI * clamp(1 - S.hitch / 0.22, 0, 1)) : 0;
    spine.rotation.x = P.spx * 0.55 + lean * 0.5 + hitchK * 0.05;
    chest.rotation.x = P.spx * 0.45 + lean * 0.5 + P.chx + Math.sin(S.breath) * 0.012 * (1 - S.wMove) * (style.composed ? 0.7 : 1) + hitchK * 0.06;
    spine.rotation.z = P.spz + bank * 0.6; chest.rotation.z = bank * 0.4 - P.roll * 0.3;
    spine.rotation.y = P.spy; chest.rotation.y = P.chy - clamp(S.yawRate * 0.05, -0.15, 0.15) * S.wMove;
    const totalYaw = P.pyaw + P.spy + P.chy;
    neck.rotation.x = 0.02 + (style.hunch + style.elder * 0.1) * 0.5;

    // ---------- голова: стабилизация + взгляд (пружины, без рывков) ----------
    S.glanceT -= dt;
    if (S.glanceT <= 0) {
      S.glanceT = (style.nervous ? 0.6 : 2.5) + R() * (style.nervous ? 1.4 : 4.5);
      S.glanceTarget = R() < 0.4 ? 0 : (R() < 0.5 ? -1 : 1) * (0.25 + R() * (0.35 + style.nervous * 0.4));
    }
    const glance = spring(K.glance, S.glanceTarget * (0.4 + 0.6 * (1 - S.wMove * 0.6)) * (1 - S.lookW * 0.8), style.nervous ? 9 : 4.5, dt);
    S.headYaw = spring(K.headYaw, S.lookYaw, 11, dt);
    headPivot.rotation.y = S.headYaw + glance - totalYaw * 0.85;
    const pitchComp = -(spine.rotation.x + chest.rotation.x + neck.rotation.x) * 0.6;
    S.wTalk += ((S.talk ? 1 : 0) - S.wTalk) * (1 - Math.exp(-6 * dt));
    let talkNod = 0;
    if (S.wTalk > 0.01) talkNod = Math.sin(S.t * 7.3) * 0.035 * S.wTalk + Math.sin(S.t * 2.1) * 0.03 * S.wTalk;
    headPivot.rotation.x = pitchComp + P.hx + talkNod + Math.sin(S.t * 0.7) * 0.006 + hitchK * 0.04;
    headPivot.rotation.z = -(pelvis.rotation.z + spine.rotation.z + chest.rotation.z) * 0.8 + (style.nervous ? Math.sin(S.t * 13) * 0.004 : 0);

    // ---------- руки: пружины амплитуд, отставание локтя ----------
    const idle = 1 - S.wMove, br = Math.sin(S.breath);
    for (let i = 0; i < 2; i++) {
      const lg = sides[i], sd = i ? 1 : -1;
      const a = P['a' + i], e = P['e' + i];
      lg.sh.rotation.x = -a;
      lg.sh.rotation.z = sd * (0.075 + 0.05 * idle + S.wRun * 0.05 - S.wDesert * 0.06 + br * 0.006 * idle) + sd * P['z' + i];
      lg.sh.rotation.y = 0;
      lg.el.rotation.x = -e - (style.nervous ? 0.25 * idle : 0);
      lg.hand.rotation.x = -0.1 - 0.1 * Math.max(0, -a); lg.hand.rotation.z = sd * 0.05;
      lg.sh.position.y = 0.21 + br * 0.003 * idle + (style.nervous ? 0.012 : 0) + style.shoulders * 0.01;
    }
    // жесты при речи (правая рука)
    if (S.wTalk > 0.01) {
      const w = S.wTalk * idle, lg = limbs.R;
      lg.sh.rotation.x = lerp(lg.sh.rotation.x, -0.55 + Math.sin(S.t * 2.3) * 0.22, w);
      lg.el.rotation.x = lerp(lg.el.rotation.x, -(1.0 + Math.sin(S.t * 3.1 + 1) * 0.3), w);
      lg.sh.rotation.z = lerp(lg.sh.rotation.z, 0.25, w);
      lg.hand.rotation.z = Math.sin(S.t * 4.3) * 0.25 * w;
    }
    // нервозность (Райн): редкие быстрые повороты, сглаженные пружиной
    if (style.nervous) {
      S.nervT -= dt;
      if (S.nervT <= 0) { S.nervT = 0.4 + R() * 1.4; S.nerv = (R() - 0.5) * 0.1; }
      const nv = spring(K.nerv, S.nerv, 40, dt);
      chest.rotation.y += nv * 0.3 * idle; headPivot.rotation.x += Math.abs(nv) * 0.4 * idle;
    }
    if (S.wSlide > 0.01) for (let i = 0; i < 2; i++) { const sd = i ? 1 : -1; sides[i].sh.rotation.z += sd * 0.7 * S.wSlide; sides[i].sh.rotation.x -= 0.2 * S.wSlide; }
    if (S.hitch > 0) S.hitch -= dt;
    if (!Number.isFinite(hpS + P.px + P.pyaw + F[0].az + F[1].az)) { for (const k in K) { K[k][0] = Number.isFinite(K[k][0]) ? K[k][0] : 0; K[k][1] = 0; } K.hp[0] = HIP_Y - 0.01; this.reset?.(); }
    return out;
  }

  // Ядро ходьбы: фазы, касания/отрывы, траектории маха.
  function gaitCore(h, ve, veEff, vx, vz, run, stepScale, slope) {
    const moving = veEff > 0.12;
    const frozen = S.hitch > 0;
    if (S.mode === 'idle') {
      if (moving && !frozen) {
        // старт: первой идёт задняя стопа
        const k = F[0].az <= F[1].az ? 0 : 1;
        S.mode = 'gait'; S.steps = 0;
        S.phi = frac(G.ds - 0.5 * k);
        startSwing(F[k], false, 0, 0, 0, 0.07);
        F[k].firstStep = 1; F[1 - k].s = 0.12;
      }
    }
    if (S.mode === 'gait') {
      if (!frozen) S.phi = frac(S.phi + h * G.f * 0.5);
      let allStance = true;
      for (const f of F) {
        const p = frac(S.phi + 0.5 * f.i);
        f.p = p;
        if (f.fixed) { allStance = false; continue; }
        const wantStance = p < G.ds;
        if (f.stance && !wantStance) { startSwing(f, false, 0, 0, 0, lerp(0.07, 0.19, run) * style.bounce * (0.85 + 0.3 * Math.min(1, veEff / 2))); }
        else if (!f.stance && wantStance) { touchdown(f, run, 0, veEff); f.firstStep = 0; }
        if (!f.stance) allStance = false;
      }
      if (!moving && allStance) { S.mode = 'idle'; S.idleT = 0; }
    } else if (!frozen) {
      // покой: если стопы разнесены по z — задняя приставляется к передней (шаг «в упор»)
      S.idleT = (S.idleT || 0) + h;
      const a = F[0], b = F[1];
      if (S.idleT > 0.3 && !a.fixed && !b.fixed && Math.abs(a.az - b.az) > 0.085 && !moving) {
        const rear = a.az < b.az ? a : b, front = rear === a ? b : a;
        startSwing(rear, true, 0.46, rear.side * NEUT_X, front.az - 0.03 - 0.02 * rear.side, 0.04);
      }
    }
    // обновление стоп
    const Tc = 2 / G.f, tdK = G.ds * Tc * 0.38 * stepScale;
    for (const f of F) {
      if (f.stance) {
        if (S.mode === 'gait') f.s = clamp(f.p / G.ds, 0, 1);
        else f.s += (0.3 - f.s) * (1 - Math.exp(-10 * h)); // в покое стопа плавно ложится плоско
        stanceAnkle(f, run);
      } else if (f.fixed) {
        f.swingT += h;
        const u = clamp(f.swingT / f.swingDur, 0, 1), e = u * u * u * (10 - 15 * u + 6 * u * u);
        f.ax = lerp(f.sx, f.tx, e); f.az = lerp(f.sz, f.tz, e);
        f.ay = lerp(f.sy, ANK + 0.02, e) + f.lift * Math.sin(Math.PI * u) ** 1.2; f.pitch = lerp(f.sp, 0, sstep(0, 0.9, u)); f.yaw = lerp(f.syaw, 0, e);
        if (u >= 1) { f.stance = true; f.fixed = false; f.s = 0.3; f.Hx = f.ax; f.Hz = f.az - HEEL; f.yaw = 0; f.ft = 0; onStepEvent(f, "walk", 0, 0.3, 0.45); }
      } else {
        // мах в ходьбе: цель — предсказанная позиция таза
        const u = clamp((f.p - G.ds) / (1 - G.ds), 0, 1.0001);
        f.u = u;
        const Trem = (1 - u) * (1 - G.ds) * Tc, dth = S.yawRate * Trem;
        const cth = Math.cos(dth), sth = Math.sin(dth);
        const fs = f.firstStep ? 0.55 : 1;
        // нейтральное положение стопы в системе будущего таза
        const rx = f.side * (NEUT_X + 0.006 + 0.01 * Math.min(1, veEff / 3)) + vx * tdK * fs, rz = -0.0276 + vz * tdK * fs;
        let tx = vx * Trem + rotX(rx, rz, cth, sth);
        let tz = vz * Trem + rotZ(rx, rz, cth, sth);
        // стопа не пересекает среднюю линию
        if (f.side * tx < 0.05) tx = f.side * 0.05;
        f.tx = tx; f.tz = tz;
        const e = u * u * u * (10 - 15 * u + 6 * u * u);
        const e2 = 1 - Math.pow(1 - u, 2.4);
        f.ax = lerp(f.sx, tx, e); f.az = lerp(f.sz, tz, e);
        const base = lerp(f.sy, ANK + 0.023, sstep(0, 1, u) ** 1.5);
        f.ay = base + f.lift * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.72)), 1.0);
        const tdTh = lerp(-0.3, -0.06, run);
        f.pitch = lerp(f.sp, tdTh, sstep(0.0, 0.8, u)) + 0.12 * Math.sin(Math.PI * u) * (1 - run);
        f.yaw = lerp(f.syaw, f.side * 0.06, e2);
        f.toe = 0;
      }
    }
  }

  return {
    update, state: S, out, hooks, style, feet: F,
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
      } else S.hitch = 0.22;
    },
    reset() {
      S.bodyZ = 0; D.beat = null; D.pause = 0; for (const f of D.feet) { f.swing = false; f.lift = 0; f.wz = f === D.feet[0] ? 0.02 : -0.02; }
      S.posValid = false; S.mode = 'idle'; S.steps = 0;
      for (const f of F) { f.stance = true; f.fixed = false; f.s = 0.3; f.yaw = 0; f.Hx = f.side * NEUT_X; f.Hz = (f.i ? -0.02 : 0.03) - HEEL; }
    },
  };
}
