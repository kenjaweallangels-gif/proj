import * as THREE from 'three';
import { V3, sstep, lerp, fbm3 } from './Geo.js';
import { buildHand } from './Hands.js';

/**
 * Crew member without the suit (IVA): a 1.80 m adult male in typical station clothing — dark navy pique
 * polo shirt (collar, three-button placket, short sleeves with rib cuffs, mission patch, flag, name tag),
 * khaki-grey cargo trousers (belt with buckle, side seams, cargo pockets with velcro flaps, knee folds),
 * rib-knit socks, a wristwatch on the left wrist. Exposed skin: head (cranium, face with brow, nose, lips,
 * chin, ears, eyes), neck, forearms and hands (knuckles, nails), short hair.
 *
 * Proportions follow adult male anthropometry (stature 1.80 m, eye height 1.685 m, biacromial ~0.40 m,
 * upper arm 0.30 m, forearm 0.265 m, hand 0.19 m, thigh 0.43 m, shank 0.415 m, foot 0.27 m).
 * Materials: skin, hair, knit, twill, rib, metal, hard, decal, eye.
 */

export const CREW_MATERIALS = ['skin', 'hair', 'knit', 'twill', 'rib', 'metal', 'hard', 'decal', 'eye', 'fabric', 'rubber'];

const X = V3(1, 0, 0), Y = V3(0, 1, 0), Z = V3(0, 0, 1), NY = V3(0, -1, 0);
const SKIN = [1.0, 1.0, 1.0];
const NAVY = [0.075, 0.1, 0.19];
const KHAKI = [0.3, 0.29, 0.24];
const SOCK = [0.16, 0.165, 0.17];

// torso sections [y, z centre, half depth, half width, superellipse e]
const TORSO = [
  [0.83, 0.002, 0.118, 0.17, 2.3], [0.9, 0.004, 0.117, 0.178, 2.3], [0.97, 0.006, 0.112, 0.176, 2.3], [1.03, 0.008, 0.108, 0.163, 2.25],
  [1.1, 0.01, 0.112, 0.162, 2.25], [1.18, 0.015, 0.12, 0.168, 2.3], [1.26, 0.02, 0.128, 0.176, 2.35], [1.33, 0.02, 0.13, 0.183, 2.4],
  [1.39, 0.012, 0.124, 0.192, 2.5], [1.44, 0.0, 0.112, 0.2, 2.5], [1.475, -0.012, 0.098, 0.178, 2.4], [1.5, -0.02, 0.083, 0.13, 2.2],
  [1.52, -0.022, 0.07, 0.085, 2.1],
];
function at(T, y) {
  if (y <= T[0][0]) return T[0];
  for (let i = 1; i < T.length; i++) if (y <= T[i][0]) { const a = T[i - 1], b = T[i], t = (y - a[0]) / (b[0] - a[0]); return a.map((v, k) => lerp(v, b[k], t)); }
  return T[T.length - 1];
}
function torsoPoint(y, th, grow = 0, out = new THREE.Vector3()) {
  const [, zc, hd, hw, e] = at(TORSO, y);
  const c = Math.cos(th), s = Math.sin(th), ex = 2 / e;
  return out.set(Math.sign(s) * Math.pow(Math.abs(s), ex) * (hw + grow), y, zc + Math.sign(c) * Math.pow(Math.abs(c), ex) * (hd + grow));
}

export function buildCrew(B, J, opts = {}) {
  const mid = B.detail >= 0.2, hi = B.detail >= 0.35;
  shirt(B, J, opts, mid, hi);
  for (const s of [1, -1]) arm(B, J, s, mid, hi);
  trousers(B, J, mid, hi);
  for (const s of [1, -1]) { leg(B, J, s, mid, hi); foot(B, J, s, mid, hi); }
  neck(B, J, mid);
  if (!opts.fp) head(B, J, mid, hi);
  else headFp(B, J);
  if (mid) watch(B, J, hi);
  wear(B);
}

// ------------------------------------------------------------------------------------------ shirt
function shirt(B, J, opts, mid, hi) {
  const iP = B.bi('pelvis'), iS = B.bi('spine'), iC = B.bi('chest');
  B.mat('knit').color(NAVY).skinFn((p) => {
    if (p.y < 1.1) { const t = sstep(0.98, 1.12, p.y); return [iP, 1 - t, iS, t]; }
    const t = sstep(1.16, 1.3, p.y); return [iS, 1 - t, iC, t];
  });
  const K = B.seg(36, 8);
  const rings = [];
  for (let i = 0; i <= K; i++) {
    const y = lerp(0.85, 1.515, i / K);
    const [, zc, hd, hw, e] = at(TORSO, y);
    // folds: soft vertical drape below the chest, a few horizontal creases at the waist
    const fold = B.detail > 0.5 ? (th) => 1 + 0.012 * Math.sin(th * 9 + y * 13) * sstep(1.2, 0.95, y) + 0.008 * Math.sin(y * 70 + th * 2) * sstep(1.1, 0.95, y) * Math.abs(Math.sin(th)) : null;
    rings.push({ c: V3(0, y, zc), ax: Z, ay: X, rx: hd + 0.006, ry: hw + 0.006, e, r: fold });
  }
  B.loft(rings, { n: 48 });
  // hem: rolled edge
  B.loft([0.845, 0.85, 0.858].map((y, i) => { const [, zc, hd, hw, e] = at(TORSO, y); const g = [0.004, 0.009, 0.006][i]; return { c: V3(0, y, zc), ax: Z, ay: X, rx: hd + g, ry: hw + g, e }; }), { n: 48 });
  // collar (rib knit): a folded band around the neck, open at the front placket
  B.mat('rib').color(NAVY).bone('chest');
  const cy = 1.515;
  const collar = [];
  for (const [dy, g, tilt] of [[-0.004, 0.0, 0], [0.012, 0.004, 0.006], [0.03, 0.012, 0.012], [0.04, 0.02, 0.016], [0.036, 0.03, 0.02]]) {
    const [, zc, hd, hw, e] = at(TORSO, cy);
    collar.push({ c: V3(0, cy + dy, zc - tilt), ax: Z, ay: X, rx: hd * 0.92 + g, ry: hw * 0.95 + g, e });
  }
  B.loft(collar, { n: 40, t0: 0.035, t1: 0.965 });
  if (mid) {
    // placket with three buttons
    B.mat('knit').color([NAVY[0] * 0.9, NAVY[1] * 0.9, NAVY[2] * 0.9]);
    const p0 = torsoPoint(1.43, 0, 0.007), p1 = torsoPoint(1.505, 0, 0.007);
    B.rbox(p0.clone().lerp(p1, 0.5), X, p1.clone().sub(p0).normalize(), V3(0, 0, 1), 0.014, p1.distanceTo(p0) / 2, 0.002, { bevel: 0.0015, n: 8 });
    B.mat('hard').color([0.85, 0.85, 0.82]);
    for (const k of [0.2, 0.5, 0.8]) { const p = p0.clone().lerp(p1, k); B.lathe(p.clone().add(V3(0, 0, 0.0015)), Z, [[0.0055, 0], [0.0055, 0.0015], [0.004, 0.0025], [0.001, 0.0028]], { n: 10 }); }
    // side seams
    B.mat('knit').color([NAVY[0] * 0.8, NAVY[1] * 0.8, NAVY[2] * 0.8]);
    for (const th of [Math.PI / 2, -Math.PI / 2]) {
      const pts = []; for (let i = 0; i <= 10; i++) pts.push(torsoPoint(lerp(0.86, 1.4, i / 10), th, 0.0072));
      B.sweep(pts, () => ({ rx: 0.0012, ry: 0.003, e: 3 }), { n: 6, ref: V3(Math.sin(th), 0, 0) });
    }
    // decals: mission patch on the left chest, name tag on the right chest, flag on the left sleeve (in arm())
    B.mat('decal');
    const tag = (y, th, w, h, name) => { const p = torsoPoint(y, th, 0.0075), n = torsoPoint(y, th, 0.05).sub(torsoPoint(y, th, 0)).normalize(); B.quad(p, n, Y, w, h, B.atlasUV(name), 0.0006); };
    tag(1.35, 0.42, 0.085, 0.085, 'crewPatch');
    tag(1.37, -0.45, 0.09, 0.024, 'nameCrew');
  }
}

// ------------------------------------------------------------------------------------------ arms
function arm(B, J, s, mid, hi) {
  const S = s > 0 ? 'L' : 'R';
  const sh = J[`upperArm${S}`], el = J[`forearm${S}`], wr = J[`hand${S}`];
  const iC = B.bi('chest'), iU = B.bi(`upperArm${S}`), iF = B.bi(`forearm${S}`), iH = B.bi(`hand${S}`);
  const skin = (p) => {
    if (p.y > el.y + 0.05) { const t = sstep(sh.y + 0.03, sh.y - 0.06, p.y); return [iC, 1 - t, iU, t]; }
    if (p.y > wr.y + 0.03) { const t = sstep(el.y + 0.04, el.y - 0.05, p.y); return [iU, 1 - t, iF, t]; }
    const t = sstep(wr.y + 0.012, wr.y - 0.015, p.y); return [iF, 1 - t, iH, t];
  };
  // anatomical arm (skin): deltoid, biceps / triceps, elbow, forearm muscle belly, wrist (flattened)
  const yTop = sh.y + 0.01, yBot = wr.y + 0.004;
  const K = B.seg(44, 10);
  const pts = [], sec = [];
  for (let i = 0; i <= K; i++) {
    const y = lerp(yTop, yBot, i / K);
    const u = (sh.y - y) / (sh.y - wr.y);                       // 0 shoulder .. 1 wrist
    const x = lerp(sh.x + s * 0.008, wr.x, sstep(0, 1, u));
    const z = lerp(sh.z, wr.z, u);
    let rx, rz, oz = 0;
    if (y > el.y) {
      const v = (sh.y - y) / (sh.y - el.y);
      rx = 0.046 - 0.006 * v + 0.006 * Math.exp(-(((v - 0.15) / 0.18) ** 2));                 // deltoid
      rz = 0.047 + 0.004 * Math.exp(-(((v - 0.55) / 0.25) ** 2)) - 0.008 * sstep(0.7, 1, v);   // biceps / triceps
      oz = 0.004 * Math.exp(-(((v - 0.55) / 0.25) ** 2));
    } else {
      const v = (el.y - y) / (el.y - wr.y);
      rx = 0.04 + 0.006 * Math.exp(-(((v - 0.25) / 0.2) ** 2)) - 0.018 * sstep(0.35, 1, v);
      rz = 0.039 + 0.005 * Math.exp(-(((v - 0.2) / 0.2) ** 2)) - 0.012 * sstep(0.4, 1, v);
      if (v < 0.08) { rx += 0.002; }
    }
    pts.push(V3(x, y, z + oz)); sec.push({ rx: rz, ry: rx });
  }
  // sweep downward with ref Z: ring X = Z (front/back depth), ring Y = T x X
  B.mat('skin').color(SKIN).skinFn(skin);
  B.sweep(pts, (t, i) => ({ rx: sec[i].rx, ry: sec[i].ry, e: 2.1 }), { n: 28, ref: Z });
  // short sleeve over the upper arm (loose), rib cuff
  const ySl = sh.y - 0.175;
  const sp = [], ss = [];
  const K2 = B.seg(14, 5);
  for (let i = 0; i <= K2; i++) {
    const t = i / K2;
    const p0 = V3(sh.x - s * 0.02, sh.y + 0.045, sh.z), p1 = V3(sh.x + s * 0.012, ySl, sh.z + 0.004);
    const p = p0.clone().lerp(p1, sstep(0, 1, t));
    p.x += s * 0.02 * Math.sin(Math.PI * t);
    sp.push(p); ss.push(lerp(0.072, 0.062, t));
  }
  B.mat('knit').color(NAVY).skinFn(skin);
  B.sweep(sp, (t, i) => ({ rx: ss[i] * 0.98, ry: ss[i], e: 2.1, r: B.detail > 0.5 ? (th) => 1 + 0.03 * Math.sin(th * 5 + t * 6) * t : null }), { n: 30, ref: Z });
  B.mat('rib').color(NAVY);
  B.lathe(V3(sh.x + s * 0.012, ySl - 0.008, sh.z + 0.004), Y, [[0.058, 0], [0.063, 0.003], [0.063, 0.014], [0.061, 0.018]], { n: 30, ref: X });
  if (mid && s > 0) {
    B.mat('decal').bone(`upperArm${S}`);
    B.wrapDecal(V3(sh.x + s * 0.01, 0, sh.z + 0.004), Y, Z, 0.071, 1.35, sh.y - 0.08, 0.06, 0.04, B.atlasUV('flag'));
  }
  // hand
  B.skinFn(skin);
  buildHand(B, J, { s, glove: false, skinCol: SKIN });
}

// ------------------------------------------------------------------------------------------ trousers / legs / feet
function trousers(B, J, mid, hi) {
  const iP = B.bi('pelvis'), iS = B.bi('spine'), iTL = B.bi('thighL'), iTR = B.bi('thighR');
  B.mat('twill').color(KHAKI).skinFn((p) => {
    if (p.y > 0.98) { const t = sstep(0.98, 1.06, p.y); return [iP, 1 - t, iS, t]; }
    const t = sstep(0.93, 0.8, p.y) * 0.65 * sstep(0.0, 0.07, Math.abs(p.x));
    return [iP, 1 - t, p.x > 0 ? iTL : iTR, t];
  });
  const prof = [[1.045, 0.008, 0.112, 0.168, 2.3], [1.0, 0.006, 0.12, 0.176, 2.4], [0.95, 0.004, 0.124, 0.184, 2.5], [0.9, 0.002, 0.122, 0.186, 2.5],
    [0.85, 0.0, 0.11, 0.176, 2.4], [0.81, 0.0, 0.085, 0.14, 2.2], [0.79, 0.0, 0.05, 0.08, 2.0], [0.782, 0.0, 0.02, 0.03, 2.0]];
  B.loft(prof.map(([y, zc, hd, hw, e]) => ({ c: V3(0, y, zc), ax: X, ay: Z, rx: hw, ry: hd, e })), { n: 44, capEnd: true });
  // belt + buckle
  B.bone('pelvis').mat('hard').color([0.06, 0.06, 0.065]);
  B.loft([1.012, 1.02, 1.04, 1.048].map((y, i) => { const g = [0.0, 0.003, 0.003, 0.0][i]; return { c: V3(0, y, 0.007), ax: Z, ay: X, rx: 0.115 + g, ry: 0.171 + g, e: 2.35 }; }), { n: 44 });
  B.mat('metal').color([0.7, 0.72, 0.74]);
  B.rbox(V3(0, 1.03, 0.126), X, Y, Z, 0.026, 0.02, 0.004, { bevel: 0.003, n: 12 });
  if (mid) {
    // belt loops
    B.mat('twill').color(KHAKI);
    for (const th of [0.6, -0.6, 1.4, -1.4, Math.PI]) {
      const p = V3(Math.sin(th) * 0.175, 1.03, 0.007 + Math.cos(th) * 0.119);
      B.rbox(p, V3(Math.cos(th), 0, -Math.sin(th)), Y, V3(Math.sin(th), 0, Math.cos(th)), 0.006, 0.022, 0.0025, { bevel: 0.0015, n: 6 });
    }
  }
}

function leg(B, J, s, mid, hi) {
  const S = s > 0 ? 'L' : 'R';
  const hip = J[`thigh${S}`], kn = J[`shin${S}`], an = J[`foot${S}`];
  const iP = B.bi('pelvis'), iT = B.bi(`thigh${S}`), iS = B.bi(`shin${S}`), iF = B.bi(`foot${S}`);
  const skin = (p) => {
    if (p.y > kn.y + 0.06) { const t = sstep(hip.y + 0.03, hip.y - 0.08, p.y); return [iP, 1 - t, iT, t]; }
    if (p.y > an.y + 0.06) { const t = sstep(kn.y + 0.06, kn.y - 0.06, p.y); return [iT, 1 - t, iS, t]; }
    const t = sstep(an.y + 0.05, an.y - 0.01, p.y); return [iS, 1 - t, iF, t];
  };
  B.mat('twill').color(KHAKI).skinFn(skin);
  const yTop = hip.y + 0.05, yBot = an.y + 0.045;
  const K = B.seg(48, 10);
  const pts = [], sec = [];
  for (let i = 0; i <= K; i++) {
    const y = lerp(yTop, yBot, i / K);
    const u = (yTop - y) / (yTop - yBot);
    pts.push(V3(lerp(hip.x + s * 0.01, an.x, u), y, lerp(hip.z + 0.005, an.z + 0.012, u) + 0.008 * Math.sin(u * Math.PI)));
    // loose cargo trousers: thigh, knee, a slight flare to the hem; knee folds
    let r = y > kn.y ? lerp(0.074, 0.095, sstep(kn.y, hip.y, y)) : lerp(0.064, 0.072, sstep(an.y, kn.y, y));
    sec.push(r);
  }
  const folds = B.detail > 0.5;
  B.sweep(pts, (t, i) => ({ rx: sec[i] * 0.97, ry: sec[i], e: 2.15, r: folds ? (th) => 1 + 0.025 * Math.exp(-(((pts[i].y - kn.y) / 0.06) ** 2)) * Math.sin(pts[i].y * 160 + th * 3) * Math.max(0, Math.cos(th - Math.PI / 2 * 0)) + 0.012 * Math.sin(th * 7 + pts[i].y * 30) * sstep(0.3, 0.12, pts[i].y) : null }), { n: 34, ref: Z });
  // hem
  B.lathe(V3(an.x, yBot - 0.004, an.z + 0.012), Y, [[0.06, 0], [0.067, 0.004], [0.067, 0.014]], { n: 32, ref: Z });
  if (mid) {
    // cargo pocket with flap and velcro on the outside of the thigh
    B.bone(`thigh${S}`).mat('twill').color([KHAKI[0] * 0.95, KHAKI[1] * 0.95, KHAKI[2] * 0.95]);
    const yc = 0.66;
    const u = (yTop - yc) / (yTop - yBot);
    const c = V3(lerp(hip.x + s * 0.01, an.x, u), yc, lerp(hip.z + 0.005, an.z + 0.012, u));
    const r = lerp(0.074, 0.095, sstep(kn.y, hip.y, yc));
    B.patch((a, b2, p, n) => { const th = -s * (a - 0.5) * 1.1; n.set(s * Math.cos(th), 0, Math.sin(th)); p.copy(c).addScaledVector(n, r + 0.012).add(V3(0, (b2 - 0.5) * 0.16, 0)); }, 8, 4);
    B.patch((a, b2, p, n) => { const th = -s * (a - 0.5) * 1.15; n.set(s * Math.cos(th), 0.2, Math.sin(th)).normalize(); p.copy(c).addScaledVector(V3(s * Math.cos(th), 0, Math.sin(th)), r + 0.017).add(V3(0, 0.07 + (b2 - 0.5) * 0.05, 0)); }, 8, 2);
    // side tape (outseam)
    B.skinFn(skin).mat('twill').color([KHAKI[0] * 0.85, KHAKI[1] * 0.85, KHAKI[2] * 0.85]);
    const seam = pts.filter((_, i) => i % 3 === 0).map((p, k, arr) => p.clone().add(V3(s * (sec[Math.min(sec.length - 1, k * 3)] + 0.001), 0, 0)));
    B.sweep(seam, () => ({ rx: 0.0012, ry: 0.003, e: 3 }), { n: 5, ref: V3(s, 0, 0) });
    B.bone(`thigh${S}`).mat('decal');
    B.quad(c.clone().addScaledVector(V3(s, 0, 0), r + 0.0205).add(V3(0, 0.08, 0)), V3(s, 0.15, 0).normalize(), Y, 0.07, 0.025, B.atlasUV('velcro'), 0.0006);
  }
}

function foot(B, J, s, mid, hi) {
  const S = s > 0 ? 'L' : 'R';
  const an = J[`foot${S}`], toe = J[`toes${S}`];
  const iS = B.bi(`shin${S}`), iF = B.bi(`foot${S}`), iX = B.bi(`toes${S}`);
  B.mat('rib').color(SOCK).skinFn((p) => {
    if (p.y > an.y + 0.02) { const t = sstep(an.y + 0.07, an.y, p.y); return [iS, 1 - t, iF, t]; }
    const t = sstep(toe.z - 0.025, toe.z + 0.015, p.z); return [iF, 1 - t, iX, t];
  });
  // sock over the ankle (up into the trouser leg)
  B.lathe(V3(an.x, an.y - 0.02, an.z + 0.005), Y, [[0.036, 0], [0.038, 0.04], [0.042, 0.1], [0.045, 0.12]], { n: 24, ref: Z });
  // foot: heel to toes along +Z; section (X, Y); arch on the inside, toes rounded
  const z0 = an.z - 0.062, z1 = toe.z + 0.085;
  const K = B.seg(24, 6);
  const rings = [];
  for (let i = 0; i <= K; i++) {
    const t = i / K, z = lerp(z0, z1, t);
    const heel = t < 0.15 ? Math.sqrt(Math.max(0.2, 1 - ((0.15 - t) / 0.15) ** 2)) : 1;
    const tip = t > 0.82 ? Math.sqrt(Math.max(0.05, 1 - ((t - 0.82) / 0.18) ** 2)) : 1;
    const h = lerp(0.075, 0.03, sstep(0.15, 0.8, t)) * Math.min(heel, tip) + 0.004;
    const w = (0.03 + 0.016 * sstep(0.1, 0.7, t)) * Math.min(heel * 1.1, tip * 0.95 + 0.05) + 0.004;
    rings.push({ c: V3(an.x + s * 0.004 * t, 0.004 + h * 0.5, z), ax: X, ay: Y, rx: w, ry: h * 0.5 + 0.002, e: 2.6,
      r: (th) => { const inner = Math.cos(th) * -s; const arch = th > Math.PI ? 1 : 1; return 1 - 0.06 * Math.max(0, inner) * sstep(0.3, 0.6, t) * arch; } });
  }
  B.loft(rings, { n: 26, capStart: true, capEnd: true });
  // sole patch (darker, denser knit)
  if (mid) {
    B.mat('rib').color([0.09, 0.09, 0.095]);
    B.patch((a, b2, p, n) => { const z = lerp(z0 + 0.012, z1 - 0.012, b2); const w = 0.028 + 0.012 * sstep(0.1, 0.7, b2); p.set(an.x + s * 0.004 * b2 + (a - 0.5) * 2 * w, 0.0035, z); n.set(0, -1, 0); }, 4, 8);
  }
}

// ------------------------------------------------------------------------------------------ neck / head
function neck(B, J, mid) {
  const iC = B.bi('chest'), iN = B.bi('neck'), iH = B.bi('head');
  B.mat('skin').color(SKIN).skinFn((p) => {
    if (p.y < 1.53) { const t = sstep(1.48, 1.53, p.y); return [iC, 1 - t, iN, t]; }
    const t = sstep(1.58, 1.63, p.y); return [iN, 1 - t, iH, t];
  });
  const rings = [];
  for (const [y, zc, rz, rx] of [[1.475, -0.02, 0.07, 0.085], [1.5, -0.022, 0.058, 0.066], [1.53, -0.02, 0.054, 0.058], [1.56, -0.016, 0.054, 0.057], [1.6, -0.012, 0.058, 0.06], [1.63, -0.012, 0.062, 0.064]]) {
    rings.push({ c: V3(0, y, zc), ax: Z, ay: X, rx: rz, ry: rx, e: 2.1, r: (th) => 1 + 0.12 * Math.max(0, Math.cos(th)) ** 4 * Math.exp(-(((y - 1.565) / 0.03) ** 2)) });   // larynx
  }
  B.loft(rings, { n: 28 });
}

/** Head: loft of superellipse rings along y with facial relief from analytic bumps (front = th 0). */
function head(B, J, mid, hi) {
  B.bone('head');
  const yC = 1.705;
  // relief: functions of (y, th) returning radial offsets (m) — th 0 = face (+Z), +pi/2 = left (+X)
  const g = (x, m, w) => Math.exp(-(((x - m) / w) ** 2));
  const front = (th, w) => g(Math.atan2(Math.sin(th), Math.cos(th)), 0, w);
  const relief = (y, th) => {
    let r = 0;
    r += 0.012 * g(y, 1.738, 0.012) * front(th, 0.6);                 // brow ridge
    r -= 0.012 * g(y, 1.712, 0.01) * (g(th, 0.42, 0.18) + g(th, -0.42, 0.18));   // eye sockets
    r += 0.03 * g(y, 1.676, 0.022) * front(th, 0.12) * sstep(1.645, 1.66, y); // nose
    r += 0.01 * g(y, 1.66, 0.012) * front(th, 0.16);                    // nose tip / nostrils
    r += 0.006 * g(y, 1.69, 0.025) * (g(th, 0.75, 0.25) + g(th, -0.75, 0.25)); // cheekbones
    r += 0.006 * g(y, 1.638, 0.006) * front(th, 0.32);                  // upper lip
    r += 0.005 * g(y, 1.624, 0.006) * front(th, 0.28);                  // lower lip
    r -= 0.003 * g(y, 1.631, 0.003) * front(th, 0.3);                   // mouth line
    r += 0.008 * g(y, 1.6, 0.012) * front(th, 0.3);                     // chin
    return r;
  };
  // [y, zc, half depth (z), half width (x), e]
  const H = [[1.6, 0.0, 0.055, 0.055, 2], [1.605, 0.012, 0.075, 0.062, 2.1], [1.62, 0.015, 0.088, 0.066, 2.2], [1.64, 0.012, 0.096, 0.07, 2.3],
    [1.66, 0.008, 0.1, 0.072, 2.3], [1.69, 0.006, 0.104, 0.076, 2.4], [1.72, 0.003, 0.107, 0.078, 2.4], [1.75, -0.002, 0.108, 0.08, 2.3],
    [1.78, -0.008, 0.104, 0.078, 2.2], [1.81, -0.014, 0.092, 0.07, 2.1], [1.83, -0.018, 0.075, 0.058, 2.0], [1.845, -0.022, 0.05, 0.04, 2.0], [1.853, -0.024, 0.02, 0.016, 2.0]];
  const K = B.seg(44, 10);
  const rings = [];
  for (let i = 0; i <= K; i++) {
    const y = lerp(H[0][0], H[H.length - 1][0], i / K);
    const [, zc, hd, hw, e] = at(H, y);
    // jaw: the lower face is narrower at the front, wide at the angle of the jaw
    rings.push({ c: V3(0, y, zc - 0.012), ax: Z, ay: X, rx: hd, ry: hw, e, r: (th) => {
      const rr = Math.max(hd, hw);
      return 1 + relief(y, th) / rr - 0.06 * g(y, 1.62, 0.02) * (1 - Math.abs(Math.cos(th)));
    } });
  }
  B.mat('skin').color(SKIN).colorFn((p, n, c) => {
    // lips slightly redder, brow / jaw stubble darker, ear and nose tips warmer
    const lip = g(p.y, 1.631, 0.008) * sstep(0.07, 0.09, p.z) * g(p.x, 0, 0.025);
    c[0] *= 1 + 0.12 * lip; c[1] *= 1 - 0.1 * lip; c[2] *= 1 - 0.06 * lip;
    const stubble = sstep(1.665, 1.6, p.y) * sstep(0.0, 0.06, p.z + 0.02) * (1 - lip);
    const k = 1 - 0.12 * stubble; c[0] *= k; c[1] *= k; c[2] *= k * 1.02;
    const sock = g(p.y, 1.712, 0.008) * (g(p.x, 0.032, 0.012) + g(p.x, -0.032, 0.012));
    c[0] *= 1 - 0.18 * sock; c[1] *= 1 - 0.2 * sock; c[2] *= 1 - 0.15 * sock;
  });
  B.loft(rings, { n: 48, capEnd: true });
  B.colorFn(null);
  // ears
  for (const s of [1, -1]) {
    B.mat('skin').color([1.03, 0.97, 0.95]);
    const c = V3(s * 0.079, 1.705, -0.022);
    B.ellipsoid(c, V3(s, 0, 0), Y, V3(0, 0, 1), 0.012, 0.031, 0.02, { k: 8, n: 12, r: (th) => 1 + 0.15 * Math.cos(th * 2) });
    if (mid) { B.mat('skin').color([0.75, 0.6, 0.55]); B.ellipsoid(c.clone().add(V3(s * 0.006, 0.002, 0.003)), V3(s, 0, 0), Y, Z, 0.004, 0.017, 0.009, { k: 6, n: 10 }); }
  }
  // eyes: eyeballs with iris (decal), eyelids
  for (const s of [1, -1]) {
    const c = V3(s * 0.032, 1.712, 0.072);
    B.mat('eye').color([0.95, 0.93, 0.9]);
    B.ellipsoid(c, X, Y, Z, 0.0118, 0.0118, 0.0118, { k: 8, n: 12 });
    if (mid) {
      B.mat('decal');
      B.patch((a, b2, p, n) => { const th = (a - 0.5) * 0.9, ph = (b2 - 0.5) * 0.9; n.set(Math.sin(th) * Math.cos(ph), Math.sin(ph), Math.cos(th) * Math.cos(ph)); p.copy(c).addScaledVector(n, 0.0121); }, 4, 4, B.atlasUV('iris'));
      B.mat('skin').color([0.95, 0.85, 0.8]);
      B.patch((a, b2, p, n) => { const th = (a - 0.5) * 1.8, ph = 0.25 + b2 * 0.6; n.set(Math.sin(th) * Math.cos(ph), Math.sin(ph), Math.cos(th) * Math.cos(ph)); p.copy(c).addScaledVector(n, 0.0128); }, 8, 3);
      B.patch((a, b2, p, n) => { const th = (a - 0.5) * 1.6, ph = -0.85 + b2 * 0.5; n.set(Math.sin(th) * Math.cos(ph), Math.sin(ph), Math.cos(th) * Math.cos(ph)); p.copy(c).addScaledVector(n, 0.0126); }, 8, 2);
      // eyebrows
      B.mat('hair').color([1, 1, 1]);
      B.patch((a, b2, p, n) => { const th = (s > 0 ? 0.15 : -0.9) + a * 0.75; const y = 1.727 + 0.004 * Math.sin(a * Math.PI) + b2 * 0.006; n.set(Math.sin(th), 0.2, Math.cos(th)).normalize(); p.set(Math.sin(th) * 0.082, y, -0.015 + Math.cos(th) * 0.098); }, 6, 1);
    }
  }
  // hair: short cut, a cap over the cranium with a hairline (front higher, temples, back of the neck)
  B.mat('hair').color([1, 1, 1]);
  const HK = B.seg(20, 6);
  const hr = [];
  for (let i = 0; i <= HK; i++) {
    const y = lerp(1.68, 1.856, i / HK);
    const [, zc, hd, hw, e] = at(H, Math.min(y, 1.853));
    hr.push({ c: V3(0, y, zc - 0.012), ax: Z, ay: X, rx: hd + 0.005, ry: hw + 0.005, e, y });
  }
  // the hairline: hair covers th outside +-front where y < hairline(th)
  const hairline = (th) => { const f = Math.cos(th); return 1.68 + 0.105 * sstep(-0.1, 0.75, f) + 0.012 * g(th, 1.1, 0.25) + 0.012 * g(th, -1.1, 0.25); };
  B.patch((a, b2, p, n) => {
    const th = a * Math.PI * 2;
    const yl = hairline(th);
    const y = lerp(yl, 1.856, b2);
    const [, zc, hd, hw, e] = at(H, Math.min(y, 1.853));
    const ex = 2 / e, cs = Math.cos(th), sn = Math.sin(th);
    const rr = 0.0045 + 0.0015 * b2;
    p.set(Math.sign(sn) * Math.pow(Math.abs(sn), ex) * (hw + rr), y, zc - 0.012 + Math.sign(cs) * Math.pow(Math.abs(cs), ex) * (hd + rr));
  }, B.seg(48, 10), B.seg(10, 3));
  void hr;
}

/** First person: the head is around the camera; only the nose / brow edge would be seen — skip it. */
function headFp() {}

// ------------------------------------------------------------------------------------------ watch
function watch(B, J, hi) {
  const wr = J.handL;
  B.bone('forearmL');
  const c = V3(wr.x, wr.y + 0.035, wr.z + 0.002);
  B.mat('hard').color([0.05, 0.05, 0.055]);
  B.loft([-0.009, -0.006, 0.006, 0.009].map((dy, i) => ({ c: c.clone().add(V3(0, dy, 0)), ax: X, ay: Z, rx: 0.0225 + (i % 3 ? 0.0012 : 0), ry: 0.029 + (i % 3 ? 0.0012 : 0), e: 2.2 })).map((r) => ({ ...r, ax: Z, ay: X, rx: r.ry, ry: r.rx })), { n: 28 });
  // case on the back of the wrist (lateral side in the bind pose)
  const n = V3(1, 0, 0);
  B.mat('metal').color([0.72, 0.74, 0.76]);
  B.lathe(c.clone().add(V3(0.022, 0, 0)), n, [[0.017, 0], [0.019, 0.003], [0.019, 0.008], [0.017, 0.01], [0.001, 0.0105]], { n: 24, ref: Y });
  B.mat('decal');
  B.disc(c.clone().add(V3(0.0327, 0, 0)), n, 0.0155, { n: 24, ref: V3(0, 0, 1), uv: B.atlasUV('watch') });
  if (hi) { B.mat('metal').color([0.72, 0.74, 0.76]); B.lathe(c.clone().add(V3(0.03, 0.0, 0.021)), Z, [[0.003, 0], [0.003, 0.004], [0.001, 0.005]], { n: 8 }); }
}

// ------------------------------------------------------------------------------------------ wear
function wear(B) {
  B.shade('twill', (p, n, c) => {
    const no = fbm3(p.x * 12, p.y * 12, p.z * 12, 3);
    const k = 1 + 0.05 * (no - 0.5) - 0.06 * Math.exp(-(((p.y - 0.5) / 0.05) ** 2)) * sstep(0.0, 0.05, p.z) + 0.04 * sstep(0.95, 1.0, Math.abs(n.y));
    c[0] *= k; c[1] *= k; c[2] *= k;
  });
  B.shade('knit', (p, n, c) => { const k = 1 + 0.04 * (fbm3(p.x * 10, p.y * 10, p.z * 10, 2) - 0.5); c[0] *= k; c[1] *= k; c[2] *= k; });
  B.shade('skin', (p, n, c) => {
    // subtle variation: redder knuckles / elbows, paler inner forearm
    const no = fbm3(p.x * 30, p.y * 30, p.z * 30, 2);
    c[0] *= 1 + 0.03 * (no - 0.5); c[1] *= 1 - 0.02 * (no - 0.5);
  });
}
