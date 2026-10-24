import * as THREE from 'three';
import { V3, sstep, lerp, fbm3, perpTo } from './Geo.js';
import { buildHand } from './Hands.js';

/**
 * Orlan-MKS class semi-rigid EVA suit (the Russian suit used from the ISS), built on the suit rig.
 *
 * Reference layout (Orlan-M / MK / MKS): rigid aluminium upper torso with the helmet integrated into it;
 * rear-entry: the whole back is a hinged door carrying the life-support backpack, closed by a lever on the
 * right side; large curved main visor plus a small top window, outer gold sun filter on side pivots, two
 * helmet lamps on brackets; chest control panel ("пульт") with toggles, LCD and warning lamps; soft arms
 * with a shoulder bearing, sizing straps, pleated elbow, wrist bearing and glove disconnect; soft lower
 * torso ("brief") and legs with pleated knees and integral boots; red (No 7) or blue (No 6) identification
 * stripes on arms and legs; waist belt with two safety tethers and large carabiners; flag, mission patch,
 * name tag, serial plate. The propulsion add-on (towers on the backpack sides + hand controller on the
 * chest, a SAFER-type self-rescue unit) is fitted for the player's suit only.
 *
 * Materials: fabric, seam, rubber, metal, hard, visor, gold, decal, glow, helmetIn (first person only).
 */

const X = V3(1, 0, 0), Y = V3(0, 1, 0), Z = V3(0, 0, 1), NY = V3(0, -1, 0), NZ = V3(0, 0, -1);
const WHITE = [0.93, 0.93, 0.9];
const OFFWHITE = [0.86, 0.86, 0.83];
const WEBBING = [0.78, 0.79, 0.8];
const GREY = [0.55, 0.57, 0.6];
const DARK = [0.09, 0.095, 0.1];
const SILVER = [0.86, 0.87, 0.89];
const ALU_BLUE = [0.38, 0.52, 0.85];
const ALU_RED = [0.86, 0.32, 0.28];

export const ORLAN_MATERIALS = ['fabric', 'seam', 'rubber', 'metal', 'hard', 'visor', 'gold', 'decal', 'glow', 'helmetIn'];

/** Variants: suit No 6 (blue stripes) and No 7 (red stripes). */
export const ORLAN_VARIANTS = {
  blue: { stripe: [0.08, 0.2, 0.62], num: 'num6', name: 'name6', anod: ALU_BLUE },
  red: { stripe: [0.7, 0.07, 0.06], num: 'num7', name: 'name7', anod: ALU_RED },
};

// ------------------------------------------------------------------------------------------ torso shape
// Upper torso sections along y (suit rig, metres): [y, z centre, half depth, half width, superellipse e]
const TORSO = [
  [1.035, 0.005, 0.165, 0.215, 2.4],
  [1.07, 0.0, 0.178, 0.232, 2.7],
  [1.15, -0.008, 0.195, 0.25, 3.0],
  [1.26, -0.012, 0.205, 0.262, 3.2],
  [1.37, -0.016, 0.205, 0.266, 3.3],
  [1.45, -0.02, 0.196, 0.258, 3.1],
  [1.52, -0.026, 0.178, 0.235, 2.8],
  [1.575, -0.03, 0.155, 0.2, 2.5],
  [1.61, -0.03, 0.135, 0.17, 2.2],
];
function torsoAt(y) {
  const T = TORSO;
  if (y <= T[0][0]) return T[0];
  for (let i = 1; i < T.length; i++) {
    if (y <= T[i][0]) {
      const a = T[i - 1], b = T[i], t = (y - a[0]) / (b[0] - a[0]);
      return a.map((v, k) => lerp(v, b[k], t));
    }
  }
  return T[T.length - 1];
}
/** Point on the torso surface at height y, angle th (0 = front +Z, pi/2 = left +X). */
function torsoPoint(y, th, grow = 0, out = new THREE.Vector3()) {
  const [, zc, hd, hw, e] = torsoAt(y);
  const c = Math.cos(th), s = Math.sin(th), ex = 2 / e;
  return out.set(Math.sign(s) * Math.pow(Math.abs(s), ex) * (hw + grow), y, zc + Math.sign(c) * Math.pow(Math.abs(c), ex) * (hd + grow));
}

// helmet: ellipsoid dome on top of the torso
const HC = V3(0, 1.735, 0.03);
const HR = { x: 0.2, y: 0.205, z: 0.215 };
function helmetPoint(y, th, scale = 1, out = new THREE.Vector3()) {
  const k = Math.max(0, 1 - ((y - HC.y) / HR.y) ** 2);
  const r = Math.sqrt(k) * scale;
  return out.set(Math.sin(th) * HR.x * r, y, HC.z + Math.cos(th) * HR.z * r);
}
const VISOR = { y0: 1.632, y1: 1.818, th: 0.98 };       // main visor opening (+-56 deg)
const TOPWIN = { y0: 1.852, y1: 1.902, th: 0.42 };     // upper window

/**
 * Build the Orlan into B (SkinBuilder on the suit rig). opts: { variant, fp (first-person extras),
 * upm (propulsion add-on), hatchInterior (rear opening + door inside, for an open hatch) }
 */
export function buildOrlan(B, J, opts = {}) {
  const v = opts.variant || ORLAN_VARIANTS.blue;
  const d = B.detail;
  const hi = d >= 0.35, mid = d >= 0.2;
  torso(B, J, opts, hi, mid);
  helmet(B, J, opts, hi, mid);
  chestPanel(B, J, opts, hi, mid);
  backpack(B, J, opts, hi, mid);
  for (const s of [1, -1]) { arm(B, J, s, v, opts, hi, mid); leg(B, J, s, v, opts, hi, mid); }
  lowerTorso(B, J, opts, hi, mid);
  if (mid) belt(B, J, opts, hi);
  markings(B, J, v, opts, hi, mid);
  if (opts.upm) upm(B, J, opts, hi, mid);
  stripes(B, J, v);
  grime(B, v);
}

// ------------------------------------------------------------------------------------------ torso
function torso(B, J, opts, hi, mid) {
  B.mat('fabric').color(WHITE).bone('chest');
  // waist ring region blends into the spine bone so bending reads at the waist
  const iChest = B.bi('chest'), iSpine = B.bi('spine');
  B.skinFn((p) => { const t = sstep(1.03, 1.1, p.y); return [iSpine, 1 - t, iChest, t]; });
  const n = 48;
  const ys = [];
  const K = B.seg(26, 8);
  for (let i = 0; i <= K; i++) ys.push(lerp(TORSO[0][0], TORSO[TORSO.length - 1][0], i / K));
  // rear entry opening: back sector |th - pi| < OPEN.th, OPEN.y0..y1 (covered by the hatch when closed)
  const OPEN = { y0: 1.085, y1: 1.5, th: 1.0 };
  const ring = (y) => { const [, zc, hd, hw, e] = torsoAt(y); return { c: V3(0, y, zc), ax: Z, ay: X, rx: hd, ry: hw, e }; };
  // loft wants (ax, ay, path) right handed: Z x X = Y -> path +Y. th = 0 is +Z (front), pi/2 is +X.
  const below = ys.filter((y) => y <= OPEN.y0 + 1e-6); below.push(OPEN.y0);
  const middle = ys.filter((y) => y > OPEN.y0 && y < OPEN.y1); middle.unshift(OPEN.y0); middle.push(OPEN.y1);
  const above = ys.filter((y) => y >= OPEN.y1 - 1e-6); above.unshift(OPEN.y1);
  const t0 = 0.5 + OPEN.th / (Math.PI * 2), t1 = 1.5 - OPEN.th / (Math.PI * 2);   // th = 0 front, pi back
  if (opts.hatchInterior) {
    B.loft(dedupe(below).map(ring), { n });
    B.loft(dedupe(middle).map(ring), { n, t0, t1 });
    B.loft(dedupe(above).map(ring), { n });
  } else B.loft(dedupe(ys).map(ring), { n });
  // seam tapes: front panel outline + side seams (raised stitched tape)
  if (mid) {
    B.mat('seam').color(OFFWHITE);
    for (const th of [1.25, -1.25]) {
      const pts = []; for (let i = 0; i <= 10; i++) { const y = lerp(1.05, 1.56, i / 10); pts.push(torsoPoint(y, th, 0.004)); }
      tape(B, pts, 0.012, 0.003);
    }
    const yoke = []; for (let i = 0; i <= 16; i++) yoke.push(torsoPoint(1.47, -1.3 + 2.6 * (i / 16), 0.004));
    tape(B, yoke, 0.012, 0.003);
  }
  if (opts.hatchInterior && mid) {
    // inner shell (white liner seen through the open door), opening seal frame
    B.mat('hard').color([0.62, 0.63, 0.62]);
    const inner = (y) => { const [, zc, hd, hw, e] = torsoAt(y); return { c: V3(0, y, zc), ax: Z, ay: X, rx: hd - 0.012, ry: hw - 0.012, e }; };
    B.loft(dedupe(middle).map(inner), { n: 32, flip: true });
    B.loft([inner(1.035), inner(OPEN.y0)], { n: 32, flip: true });
    B.loft([inner(OPEN.y1), inner(1.6)], { n: 32, flip: true });
    // dark interior depth: a disc-like cap at the bottom (pressure bulkhead toward the legs)
    B.mat('hard').color([0.18, 0.19, 0.2]);
    B.disc(V3(0, 1.05, -0.01), Y, 0.17, { n: 20, sx: 1.3 });
    // seal frame: aluminium rim around the opening
    B.mat('metal').color(SILVER);
    const rim = [];
    const steps = B.seg(14, 6);
    for (let i = 0; i <= steps; i++) rim.push(torsoPoint(lerp(OPEN.y0, OPEN.y1, i / steps), Math.PI - OPEN.th, 0.004));
    for (let i = 1; i <= steps; i++) rim.push(torsoPoint(OPEN.y1, Math.PI - OPEN.th + (2 * OPEN.th) * (i / steps), 0.004));
    for (let i = 1; i <= steps; i++) rim.push(torsoPoint(lerp(OPEN.y1, OPEN.y0, i / steps), Math.PI + OPEN.th, 0.004));
    for (let i = 1; i <= steps; i++) rim.push(torsoPoint(OPEN.y0, Math.PI + OPEN.th - (2 * OPEN.th) * (i / steps), 0.004));
    B.sweep(rim, () => ({ rx: 0.016, ry: 0.01, e: 3 }), { n: 8 });
  }
  // shoulder bearings: torso-side rings (anodised) with a dark gap
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    const c = bearingCentre(J, s), nrm = bearingNormal(s);
    const iC = B.bi('chest'), iU = B.bi(`upperArm${S}`);
    B.skinFn(() => [iC, 0.55, iU, 0.45]).mat('metal').color(SILVER);
    B.lathe(c.clone().addScaledVector(nrm, -0.03), nrm, [[0.112, 0], [0.122, 0.006], [0.124, 0.022], [0.118, 0.03], [0.108, 0.032]], { n: 40 });
    B.mat('hard').color(DARK);
    B.lathe(c.clone().addScaledVector(nrm, 0.002), nrm, [[0.118, 0], [0.119, 0.004]], { n: 40 });
    void S;
  }
}

function bearingCentre(J, s) { const S = s > 0 ? 'L' : 'R'; return J[`upperArm${S}`].clone().add(V3(s * 0.035, 0.0, 0.0)); }
function bearingNormal(s) { return V3(s * 0.94, -0.3, 0.06).normalize(); }
function dedupe(a) { const o = []; for (const y of a.sort((p, q) => p - q)) if (!o.length || Math.abs(y - o[o.length - 1]) > 1e-4) o.push(y); return o; }

/** Raised stitched tape along a path (seam). */
function tape(B, pts, w, h) {
  if (pts.length < 2) return;
  const c = pts.reduce((a, p) => a.add(p), V3()).multiplyScalar(1 / pts.length);
  // section X axis: away from the centroid of the path's surface (outward-ish)
  const ref = pts[Math.floor(pts.length / 2)].clone().sub(c);
  if (ref.lengthSq() < 1e-8) ref.copy(perpTo(pts[1].clone().sub(pts[0]).normalize()));
  B.sweep(pts, () => ({ rx: h, ry: w / 2, e: 4 }), { n: 8, ref: ref.normalize(), nMin: 4 });
}

// ------------------------------------------------------------------------------------------ helmet
function helmet(B, J, opts, hi, mid) {
  B.bone('chest').mat('hard').color([0.94, 0.94, 0.92]);
  const n = 56;
  const ring = (y, sc = 1) => {
    const k = Math.max(1e-4, 1 - ((y - HC.y) / HR.y) ** 2), r = Math.sqrt(k) * sc;
    return { c: V3(0, y, HC.z), ax: Z, ay: X, rx: HR.z * r, ry: HR.x * r, e: 2.1 };
  };
  const yb = 1.585, ytop = HC.y + HR.y;
  const ys = [];
  const K = B.seg(30, 8);
  for (let i = 0; i <= K; i++) { const t = i / K; ys.push(yb + (ytop - 0.001 - yb) * Math.sin((t * Math.PI) / 2)); }
  const cut = (lo, hi2) => { const a = ys.filter((y) => y > lo && y < hi2); return dedupe([lo, ...a, hi2]); };
  const tV = VISOR.th / (Math.PI * 2), tT = TOPWIN.th / (Math.PI * 2);
  B.loft(cut(yb, VISOR.y0).map((y) => ring(y)), { n });
  B.loft(cut(VISOR.y0, VISOR.y1).map((y) => ring(y)), { n, t0: tV, t1: 1 - tV });
  B.loft(cut(VISOR.y1, TOPWIN.y0).map((y) => ring(y)), { n });
  B.loft(cut(TOPWIN.y0, TOPWIN.y1).map((y) => ring(y)), { n, t0: tT, t1: 1 - tT });
  B.loft(cut(TOPWIN.y1, ytop - 0.001).map((y) => ring(y)), { n, capEnd: true });
  // neck fairing: helmet base flares into the torso yoke
  B.mat('fabric').color(WHITE);
  B.loft([1.555, 1.575, 1.6].map((y) => { const [, zc, hd, hw, e] = torsoAt(y); const h = ring(Math.max(y, yb)); return { c: V3(0, y, lerp(zc, HC.z, 0.5)), ax: Z, ay: X, rx: lerp(hd, h.rx, 0.6) + 0.004, ry: lerp(hw, h.ry, 0.6) + 0.004, e: 2.4 }; }), { n: 40 });
  // visor glass (clear, inset) and frames
  const glass = (W, inset) => (s, t, p) => { const y = lerp(W.y0, W.y1, t); helmetPoint(y, -W.th + 2 * W.th * s, inset, p); };
  B.mat('visor');
  B.patch(glass(VISOR, 0.985), 18, 8, null, { w: 0.4, h: 0.2 });
  B.patch(glass(TOPWIN, 0.985), 8, 3, null, { w: 0.15, h: 0.05 });
  if (opts.fp) {
    // first person: the helmet shell seen from inside (dark liner), with both windows open
    B.mat('helmetIn');
    const inRing = (y) => { const r = ring(y, 0.965); return r; };
    B.loft(cut(1.56, VISOR.y0).map(inRing), { n: 40 });
    B.loft(cut(VISOR.y0, VISOR.y1).map(inRing), { n: 40, t0: tV, t1: 1 - tV });
    B.loft(cut(VISOR.y1, TOPWIN.y0).map(inRing), { n: 40 });
    B.loft(cut(TOPWIN.y0, TOPWIN.y1).map(inRing), { n: 40, t0: tT, t1: 1 - tT });
    B.loft(cut(TOPWIN.y1, ytop - 0.004).map(inRing), { n: 40, capEnd: true });
  }
  // window frames (white anodised / painted rims)
  B.mat('hard').color([0.84, 0.85, 0.86]);
  for (const W of [VISOR, TOPWIN]) {
    const pts = [];
    const m = B.seg(W === VISOR ? 28 : 14, 6);
    for (let i = 0; i <= m; i++) pts.push(helmetPoint(W.y0, -W.th + 2 * W.th * (i / m), 1.008));
    for (let i = 1; i <= 6; i++) pts.push(helmetPoint(lerp(W.y0, W.y1, i / 6), W.th, 1.008));
    for (let i = 1; i <= m; i++) pts.push(helmetPoint(W.y1, W.th - 2 * W.th * (i / m), 1.008));
    for (let i = 1; i <= 6; i++) pts.push(helmetPoint(lerp(W.y1, W.y0, i / 6), -W.th, 1.008));
    B.sweep(pts, () => ({ rx: 0.008, ry: 0.011, e: 3 }), { n: 8, ref: Z });
  }
  {
    // gold sun filter, lowered over the main visor, on side pivots; its white frame / rim
    const F = { y0: VISOR.y0 - 0.02, y1: VISOR.y1 + 0.03, th: VISOR.th + 0.12 };
    B.mat('gold');
    if (!opts.fp) B.patch((s, t, p) => helmetPoint(lerp(F.y0, F.y1, t), -F.th + 2 * F.th * s, 1.04, p), 20, 9, null, { w: 0.45, h: 0.24 });
    B.mat('hard').color([0.9, 0.9, 0.88]);
    const fr = [];
    const m = B.seg(26, 6);
    for (let i = 0; i <= m; i++) fr.push(helmetPoint(F.y1, -F.th + 2 * F.th * (i / m), 1.045));
    B.sweep(fr, () => ({ rx: 0.006, ry: 0.016, e: 4 }), { n: 8, ref: Y });
    const bot = [];
    for (let i = 0; i <= m; i++) bot.push(helmetPoint(F.y0, -F.th + 2 * F.th * (i / m), 1.045));
    if (!opts.fp) B.sweep(bot, () => ({ rx: 0.005, ry: 0.006, e: 3 }), { n: 6, ref: Y });
    // side arms to the pivots + pivot bosses
    for (const s of [1, -1]) {
      const piv = helmetPoint(1.725, s * 1.62, 1.04);
      const a0 = helmetPoint(F.y1, s * F.th, 1.045);
      B.sweep([a0, helmetPoint(1.78, s * 1.35, 1.06), piv], () => ({ rx: 0.006, ry: 0.014, e: 4 }), { n: 8, ref: V3(s, 0, 0) });
      B.mat('hard').color([0.75, 0.76, 0.78]);
      const nrm = V3(s, 0, 0.12).normalize();
      B.lathe(piv.clone().addScaledVector(nrm, -0.012), nrm, [[0.026, 0], [0.027, 0.012], [0.022, 0.02], [0.012, 0.024], [0.001, 0.025]], { n: 18 });
      B.mat('hard').color([0.9, 0.9, 0.88]);
    }
  }
  // helmet lamps on brackets (left and right of the dome), lens = glow
  for (const s of [1, -1]) {
    const base = helmetPoint(1.83, s * 1.25, 1.0);
    const c = base.clone().add(V3(s * 0.045, 0.012, 0.02));
    B.mat('hard').color([0.78, 0.79, 0.8]);
    B.sweep([base.clone().add(V3(-s * 0.005, -0.01, 0)), c.clone().add(V3(0, -0.012, -0.03))], () => ({ rx: 0.008, ry: 0.016, e: 4 }), { n: 8, ref: Z });
    B.mat('hard').color([0.88, 0.88, 0.86]);
    B.lathe(c.clone().add(V3(0, 0, -0.07)), Z, [[0.001, 0], [0.018, 0.002], [0.022, 0.012], [0.024, 0.07], [0.028, 0.09], [0.027, 0.1]], { n: 20, ref: X });
    B.mat('glow').color([1.0, 0.96, 0.88]);
    B.disc(c.clone().add(V3(0, 0, 0.0305)), Z, 0.022, { n: 18 });
    B.mat('metal').color(SILVER);
    B.torus(c.clone().add(V3(0, 0, 0.03)), Z, 0.026, 0.0028, { n: 20, tube: 6 });
    // switch box under the lamp
    B.mat('hard').color(GREY);
    B.rbox(c.clone().add(V3(0, -0.032, -0.03)), X, Y, Z, 0.014, 0.01, 0.022, { bevel: 0.004, n: 12 });
  }
  // top: small handle / camera mount ridge
  if (mid) {
    B.mat('hard').color([0.8, 0.81, 0.82]);
    B.sweep([helmetPoint(1.89, -0.55 + Math.PI, 1.0), V3(0, ytop + 0.01, HC.z - 0.08), helmetPoint(1.89, 0.55 + Math.PI, 1.0)], () => ({ rx: 0.006, ry: 0.006 }), { n: 6 });
  }
}

// ------------------------------------------------------------------------------------------ chest panel
function chestPanel(B, J, opts, hi, mid) {
  B.bone('chest');
  // panel body: mounted on the lower chest, face tilted up toward the wearer
  const tilt = 0.62;
  const ay = V3(0, Math.cos(tilt), Math.sin(tilt)).normalize();      // panel "up" (along the face)
  const az = V3(0, -Math.sin(tilt), Math.cos(tilt)).normalize();     // face normal (forward / up)
  const c = V3(0, 1.255, 0.235);
  B.mat('hard').color([0.86, 0.87, 0.86]);
  B.rbox(c, X, ay, az, 0.165, 0.085, 0.045, { bevel: 0.016, n: 28 });
  // mounting bracket to the chest
  B.mat('hard').color(GREY);
  B.rbox(c.clone().addScaledVector(az, -0.06).add(V3(0, 0.0, -0.01)), X, ay, az, 0.11, 0.055, 0.03, { bevel: 0.01, n: 16 });
  // face decal
  B.mat('decal');
  B.quad(c.clone().addScaledVector(az, 0.045), az, ay, 0.3, 0.155, B.atlasUV('chestPanel'), 0.0015);
  if (mid) {
    // toggle switches with guards (2 rows of 4) and two rotary knobs
    const face = (u, w) => c.clone().addScaledVector(X, u).addScaledVector(ay, w).addScaledVector(az, 0.046);
    for (let i = 0; i < 8; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      const p = face(-0.15 * 0.3 * 1 + (0.1 + col * 0.13 - 0.5) * 0.3, (0.5 - (0.3 + row * 0.36)) * 0.155);
      B.mat('metal').color(SILVER);
      B.lathe(p, az, [[0.004, 0], [0.003, 0.012], [0.0045, 0.016], [0.001, 0.018]], { n: 8 });
      if (hi) { B.mat('hard').color(GREY); for (const sx of [-1, 1]) B.rbox(p.clone().addScaledVector(X, sx * 0.013).addScaledVector(az, 0.007), X, ay, az, 0.002, 0.012, 0.007, { bevel: 0.0015, n: 8 }); }
    }
    for (const [u, col] of [[0.115, [0.75, 0.1, 0.08]], [0.05, [0.12, 0.13, 0.14]]]) {
      const p = face(u, -0.045);
      B.mat('hard').color(col);
      B.lathe(p, az, [[0.016, 0], [0.016, 0.012], [0.013, 0.016], [0.001, 0.017]], { n: 16 });
      if (hi) { B.mat('hard').color([0.9, 0.9, 0.9]); B.rbox(p.clone().addScaledVector(az, 0.017), X, ay, az, 0.002, 0.011, 0.0012, { bevel: 0.001, n: 6 }); }
    }
    // umbilical connectors on the panel sides: electrical (left, black/orange), water (right, red cap)
    for (const s of [1, -1]) {
      const p = c.clone().addScaledVector(X, s * 0.17).addScaledVector(ay, -0.02);
      B.mat('metal').color(SILVER);
      B.lathe(p, V3(s, 0, 0), [[0.022, 0], [0.024, 0.006], [0.024, 0.02], [0.02, 0.024]], { n: 18 });
      B.mat('hard').color(s > 0 ? [0.85, 0.35, 0.05] : [0.7, 0.08, 0.06]);
      B.lathe(p.clone().addScaledVector(V3(s, 0, 0), 0.024), V3(s, 0, 0), [[0.019, 0], [0.019, 0.016], [0.015, 0.02], [0.001, 0.021]], { n: 16 });
    }
    // pressure regulator handle on the lower right abdomen (red), hydraulic hoses
    B.mat('hard').color([0.72, 0.09, 0.07]);
    const rg = torsoPoint(1.11, -0.55, 0.02);
    B.lathe(rg, V3(-0.5, 0, 0.86).normalize(), [[0.03, 0], [0.032, 0.012], [0.028, 0.028], [0.012, 0.034], [0.001, 0.035]], { n: 20 });
    B.mat('metal').color(SILVER);
    B.lathe(rg.clone().addScaledVector(V3(-0.5, 0, 0.86).normalize(), -0.012), V3(-0.5, 0, 0.86).normalize(), [[0.036, 0], [0.037, 0.012]], { n: 20 });
    if (hi) {
      B.mat('hard').color([0.75, 0.76, 0.77]);
      for (const s of [1, -1]) {
        const a = c.clone().addScaledVector(X, s * 0.12).addScaledVector(ay, -0.08).addScaledVector(az, -0.02);
        const b = torsoPoint(1.08, s * 0.95, 0.01);
        const m2 = a.clone().lerp(b, 0.5).add(V3(0, -0.04, 0.05));
        hose(B, [a, m2, b], 0.011, 0.0018);
      }
    }
  }
}

/** Corrugated hose along a curve (quadratic through 3 points). */
function hose(B, pts3, r, amp) {
  const [a, m, b] = pts3;
  const K = B.seg(30, 6);
  const path = [];
  for (let i = 0; i <= K; i++) { const t = i / K; path.push(V3().addScaledVector(a, (1 - t) ** 2).addScaledVector(m, 2 * t * (1 - t)).addScaledVector(b, t * t)); }
  const L = path.reduce((s, p, i) => (i ? s + p.distanceTo(path[i - 1]) : 0), 0);
  B.sweep(path, (t) => ({ rx: r + (B.detail > 0.5 ? amp * Math.cos(t * L * Math.PI * 2 / 0.008) : 0), ry: r + (B.detail > 0.5 ? amp * Math.cos(t * L * Math.PI * 2 / 0.008) : 0) }), { n: 10, nMin: 5 });
}

// ------------------------------------------------------------------------------------------ backpack (door)
function backpack(B, J, opts, hi, mid) {
  B.bone('hatch');
  const zIn = -0.205, zOut = -0.445, x0 = -0.27, x1 = 0.27, y0 = 1.0, y1 = 1.79;
  const c = V3(0, (y0 + y1) / 2, (zIn + zOut) / 2);
  // main shell: fabric-covered (TMG) box with large radii
  B.mat('fabric').color(WHITE);
  B.rbox(c, X, Y, Z, (x1 - x0) / 2, (y1 - y0) / 2, (zIn - zOut) / 2, { bevel: 0.07, n: 40, e: 5 });
  // outer cover flap with stitched border, pockets
  if (mid) {
    B.mat('fabric').color(OFFWHITE);
    B.rbox(V3(0, 1.36, zOut - 0.006), X, Y, Z, 0.22, 0.3, 0.012, { bevel: 0.01, n: 24 });
    B.mat('seam').color(OFFWHITE);
    const fr = [];
    for (const [px, py] of [[-0.21, 1.07], [0.21, 1.07], [0.21, 1.65], [-0.21, 1.65], [-0.21, 1.07]]) fr.push(V3(px, py, zOut - 0.019));
    tape(B, densify(fr, 0.03), 0.012, 0.003);
    B.mat('fabric').color(OFFWHITE);
    for (const s of [1, -1]) B.rbox(V3(s * 0.12, 1.12, zOut - 0.026), X, Y, Z, 0.07, 0.06, 0.016, { bevel: 0.012, n: 16 });      // pockets
  }
  // top handles (two U-shaped rails) and antenna
  B.mat('metal').color(SILVER);
  for (const s of [1, -1]) {
    const a = V3(s * 0.2, y1 - 0.01, -0.27), b = V3(s * 0.2, y1 - 0.01, -0.39);
    B.sweep([a, a.clone().add(V3(0, 0.05, -0.01)), b.clone().add(V3(0, 0.05, 0.01)), b], () => ({ rx: 0.008, ry: 0.008 }), { n: 8 });
  }
  if (mid) {
    B.mat('hard').color(DARK);
    B.lathe(V3(0.17, y1 - 0.01, -0.33), Y, [[0.012, 0], [0.012, 0.02], [0.005, 0.03], [0.003, 0.17], [0.006, 0.175], [0.001, 0.18]], { n: 10 });
  }
  // hinge on the right side (vertical, at the torso back): knuckles
  B.mat('metal').color(SILVER);
  for (const y of [1.12, 1.31, 1.5]) B.lathe(V3(J.hatch.x, y - 0.035, J.hatch.z - 0.012), Y, [[0.014, 0], [0.016, 0.004], [0.016, 0.066], [0.014, 0.07]], { n: 14 });
  // door seal face (inside), visible when the door is open: life-support unit face, rim
  if (opts.hatchInterior && mid) {
    B.mat('metal').color(SILVER);
    B.rbox(V3(0, 1.29, zIn + 0.004), X, Y, Z, 0.235, 0.215, 0.006, { bevel: 0.006, n: 24 });
    B.mat('hard').color([0.72, 0.73, 0.72]);
    B.rbox(V3(0, 1.29, zIn + 0.012), X, Y, Z, 0.2, 0.18, 0.006, { bevel: 0.01, n: 24 });
    B.mat('hard').color(GREY);
    for (const [px, py] of [[-0.1, 1.38], [0.1, 1.38], [0, 1.2]]) B.lathe(V3(px, py, zIn + 0.015), Z, [[0.03, 0], [0.03, 0.01], [0.022, 0.014], [0.001, 0.016]], { n: 16 });
    B.mat('hard').color([0.85, 0.85, 0.83]);
    B.rbox(V3(0.0, 1.47, zIn + 0.02), X, Y, Z, 0.15, 0.02, 0.008, { bevel: 0.005, n: 12 });
  }
  // closing lever: on the right side of the torso, a rod from the door to a handle at the waist
  B.bone('chest');
  if (mid) {
    B.mat('metal').color(SILVER);
    const h0 = torsoPoint(1.16, -1.62, 0.025), h1 = torsoPoint(1.33, -2.05, 0.03);
    B.sweep([h0, h0.clone().lerp(h1, 0.5).add(V3(-0.02, 0, 0)), h1], () => ({ rx: 0.007, ry: 0.007 }), { n: 8 });
    B.mat('hard').color([0.8, 0.12, 0.08]);
    B.lathe(h0.clone().add(V3(0, -0.055, 0)), Y, [[0.001, 0], [0.012, 0.004], [0.014, 0.05], [0.012, 0.06], [0.001, 0.062]], { n: 12 });
  }
}

function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n));
  }
  return out;
}

// ------------------------------------------------------------------------------------------ arms
function arm(B, J, s, v, opts, hi, mid) {
  const S = s > 0 ? 'L' : 'R';
  const sh = J[`upperArm${S}`], el = J[`forearm${S}`], wr = J[`hand${S}`];
  const bc = bearingCentre(J, s), bn = bearingNormal(s);
  const iC = B.bi('chest'), iU = B.bi(`upperArm${S}`), iF = B.bi(`forearm${S}`), iH = B.bi(`hand${S}`);
  // weights by height (bind pose: the arm hangs straight down)
  const yE = el.y, yW = wr.y;
  const armSkin = (p) => {
    if (p.y > yE + 0.07) { const t = sstep(sh.y + 0.01, sh.y - 0.07, p.y); return [iC, 1 - t, iU, t]; }
    if (p.y > yW + 0.03) { const t = sstep(yE + 0.06, yE - 0.07, p.y); return [iU, 1 - t, iF, t]; }
    const t = sstep(yW + 0.008, yW - 0.02, p.y); return [iF, 1 - t, iH, t];
  };
  B.mat('fabric').color(WHITE).skinFn(armSkin);
  // sleeve path: from the bearing outward, bending down along the arm axis
  const ax = V3(sh.x + s * 0.012, 0, sh.z + 0.004);
  const p0 = bc.clone().addScaledVector(bn, 0.004);
  const p1 = bc.clone().addScaledVector(bn, 0.05);
  const p2 = V3(ax.x + s * 0.03, sh.y - 0.085, ax.z);
  const p3 = V3(ax.x + s * 0.008, sh.y - 0.15, ax.z);
  const cap = curve([p0, p1, p2, p3], B.seg(12, 4));
  B.sweep(cap, (t) => { const r = lerp(0.108, 0.088, sstep(0, 1, t)); return { rx: r, ry: r }; }, { n: 32, ref: Z });
  // upper arm with the stripe band, convolute elbow, forearm
  const conv = sstep(0.25, 0.6, B.detail);
  const prof = (y) => {
    let r;
    if (y > yE + 0.08) r = lerp(0.082, 0.088, sstep(yE + 0.08, sh.y - 0.15, y));
    else if (y > yE - 0.07) r = 0.082 + 0.0035 * conv * Math.cos(((y - (yE + 0.08)) / 0.025) * Math.PI * 2) - 0.002;
    else r = lerp(0.056, 0.078, sstep(yW + 0.05, yE - 0.07, y));
    return r;
  };
  const yTop = sh.y - 0.15, yBot = yW + 0.04;
  const nR = B.seg(70, 10);
  const pts = [];
  for (let i = 0; i <= nR; i++) { const y = lerp(yTop, yBot, i / nR); pts.push(V3(lerp(ax.x + s * 0.008, wr.x, sstep(yTop, yBot, y) * 0.0), y, lerp(ax.z, wr.z + 0.004, (yTop - y) / (yTop - yBot)))); }
  B.sweep(pts, (t, i) => { const r = prof(pts[i].y); return { rx: r, ry: r * 1.02 }; }, { n: 32, ref: X });
  // sizing straps along the outside and inside of the upper arm and forearm, with buckles
  if (mid) {
    for (const [ang, ya, yb] of [[0, sh.y - 0.12, yE + 0.09], [Math.PI, sh.y - 0.16, yE + 0.09], [0, yE - 0.08, yW + 0.07]]) {
      const ptsS = [];
      for (let i = 0; i <= 8; i++) { const y = lerp(ya, yb, i / 8); const r = prof(y) + 0.003; ptsS.push(V3(ax.x + s * Math.cos(ang) * r, y, lerp(ax.z, wr.z, (yTop - y) / (yTop - yBot)) + Math.sin(ang) * r)); }
      B.mat('fabric').color(WEBBING);
      B.sweep(ptsS, () => ({ rx: 0.0025, ry: 0.011, e: 5 }), { n: 6, ref: V3(s * Math.cos(ang), 0, Math.sin(ang)) });
      if (hi) {
        B.mat('metal').color(SILVER);
        const bp = ptsS[3].clone().add(V3(s * Math.cos(ang) * 0.004, 0, 0));
        B.rbox(bp, V3(0, 0, 1), Y, V3(s * Math.cos(ang), 0, 0), 0.014, 0.01, 0.003, { bevel: 0.002, n: 10 });
      }
    }
  }
  // wrist: bearing + glove disconnect (anodised lock ring)
  B.skinFn(armSkin);
  const wc = V3(wr.x, yW + 0.035, wr.z + 0.004);
  B.mat('metal').color(SILVER);
  B.lathe(wc, NY, [[0.06, -0.008], [0.064, -0.004], [0.065, 0.014], [0.061, 0.018], [0.058, 0.02]], { n: 40, ref: X });
  B.mat('hard').color(DARK);
  B.lathe(wc.clone().add(V3(0, -0.02, 0)), NY, [[0.0585, 0], [0.0585, 0.004]], { n: 40, ref: X });
  B.mat('metal').color(v.anod);
  B.lathe(wc.clone().add(V3(0, -0.024, 0)), NY, [[0.058, 0], [0.062, 0.003], [0.062, 0.014], [0.057, 0.018]], { n: 40, ref: X });
  if (hi) { // lock buttons
    B.mat('metal').color(SILVER);
    for (const a of [0.6, 0.6 + Math.PI]) B.rbox(wc.clone().add(V3(Math.cos(a) * 0.064, -0.03, Math.sin(a) * 0.064)), V3(-Math.sin(a), 0, Math.cos(a)), Y, V3(Math.cos(a), 0, Math.sin(a)), 0.007, 0.005, 0.004, { bevel: 0.002, n: 8 });
  }
  // gauntlet: short glove cuff below the disconnect, into the hand
  B.mat('fabric').color(OFFWHITE);
  B.lathe(V3(wr.x, yW - 0.0, wr.z + 0.004), Y, [[0.042, -0.01], [0.05, 0.0], [0.054, 0.012], [0.056, 0.016]], { n: 28, ref: X });
  buildHand(B, J, { s, glove: true, fabricKey: 'fabric', rubberKey: 'rubber' });

  // forearm accessories
  B.skinFn(null).bone(`forearm${S}`);
  if (mid) {
    if (s > 0) {
      // left: wrist mirror (on the back of the wrist, on an elastic strap) and cuff checklist
      B.mat('fabric').color(GREY);
      B.lathe(V3(wr.x, yW + 0.065, wr.z + 0.004), NY, [[0.0705, 0], [0.0705, 0.022]], { n: 28, ref: X });
      const mc = V3(wr.x + 0.072, yW + 0.076, wr.z + 0.004);
      B.mat('hard').color(DARK);
      B.rbox(mc, Z, Y, X, 0.033, 0.024, 0.005, { bevel: 0.004, n: 14 });
      B.mat('metal').color([1, 1, 1]);
      B.rbox(mc.clone().add(V3(0.0052, 0, 0)), Z, Y, X, 0.029, 0.02, 0.0007, { bevel: 0.0006, n: 10 });
      // checklist: ring-bound cards on a plate on the top of the forearm
      const cl = V3(wr.x + 0.05, yE - 0.12, wr.z + 0.05);
      const nrm = V3(0.7, 0, 0.7).normalize(), up = Y;
      B.mat('hard').color([0.3, 0.32, 0.34]);
      B.rbox(cl, nrm.clone().cross(up).negate(), up, nrm, 0.047, 0.035, 0.004, { bevel: 0.003, n: 12 });
      B.mat('decal');
      B.quad(cl.clone().addScaledVector(nrm, 0.0045), nrm, NY, 0.088, 0.066, B.atlasUV('checklist'), 0.0006);
      B.mat('metal').color(SILVER);
      for (const k of [-1, 1]) B.torus(cl.clone().addScaledVector(nrm.clone().cross(up), k * 0.022).add(V3(0, 0.036, 0)), nrm.clone().cross(up), 0.006, 0.0012, { n: 10, tube: 4 });
    } else {
      // right: manometer (suit pressure gauge)
      const mc = V3(wr.x - 0.067, yW + 0.09, wr.z + 0.012);
      const nrm = V3(-1, 0, 0.25).normalize();
      B.mat('metal').color(SILVER);
      B.lathe(mc.clone().addScaledVector(nrm, -0.012), nrm, [[0.028, 0], [0.03, 0.004], [0.03, 0.014], [0.026, 0.016]], { n: 24, ref: Y });
      B.mat('decal');
      B.quad(mc.clone().addScaledVector(nrm, 0.0042), nrm, Y, 0.05, 0.05, B.atlasUV('manometer'), 0.0005);
      B.mat('fabric').color(GREY);
      B.lathe(V3(wr.x, yW + 0.08, wr.z + 0.004), NY, [[0.07, 0], [0.07, 0.024]], { n: 28, ref: X });
    }
  }
}

/** Catmull-Rom through points, k samples per span. */
function curve(P, k) {
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let j = 0; j < k; j++) {
      const t = j / k, t2 = t * t, t3 = t2 * t;
      out.push(V3().addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t).addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1).addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t).addScaledVector(p3, 0.5 * t3 - 0.5 * t2));
    }
  }
  out.push(P[P.length - 1].clone());
  return out;
}

// ------------------------------------------------------------------------------------------ lower torso
function lowerTorso(B, J, opts, hi, mid) {
  // soft "brief": waist (under the rigid torso ring) down to the crotch, skinned pelvis -> thighs at the bottom
  const iP = B.bi('pelvis'), iS = B.bi('spine'), iTL = B.bi('thighL'), iTR = B.bi('thighR');
  B.mat('fabric').color(WHITE).skinFn((p) => {
    if (p.y > 0.98) { const t = sstep(0.98, 1.06, p.y); return [iP, 1 - t, iS, t]; }
    const t = sstep(0.95, 0.84, p.y) * 0.6 * sstep(0.0, 0.08, Math.abs(p.x));
    return [iP, 1 - t, p.x > 0 ? iTL : iTR, t];
  });
  const prof = [
    [1.075, 0.0, 0.16, 0.205, 2.4], [1.04, 0.002, 0.168, 0.215, 2.6], [1.0, 0.004, 0.172, 0.224, 2.8], [0.95, 0.006, 0.165, 0.228, 2.8],
    [0.9, 0.008, 0.148, 0.218, 2.6], [0.86, 0.01, 0.12, 0.19, 2.4], [0.835, 0.012, 0.085, 0.14, 2.2], [0.822, 0.014, 0.04, 0.07, 2.0],
  ];
  const rings = prof.map(([y, zc, hd, hw, e]) => ({ c: V3(0, y, zc), ax: Z, ay: X, rx: hd, ry: hw, e }));
  // loft goes downward: flip handedness (path -Y): ax = X, ay = Z
  B.loft(rings.map((r) => ({ ...r, ax: X, ay: Z, rx: r.ry, ry: r.rx })), { n: 44, capEnd: true });
  // waist bearing/seal ring between the rigid torso and the soft lower torso
  B.bone('spine').mat('metal').color(SILVER);
  B.loft([1.03, 1.04, 1.055, 1.065].map((y, i) => { const g = [0.0, 0.006, 0.006, 0.0][i]; return { c: V3(0, y, 0.004), ax: Z, ay: X, rx: 0.17 + g, ry: 0.22 + g, e: 2.5 }; }), { n: 44 });
}

// ------------------------------------------------------------------------------------------ legs
function leg(B, J, s, v, opts, hi, mid) {
  const S = s > 0 ? 'L' : 'R';
  const hip = J[`thigh${S}`], kn = J[`shin${S}`], an = J[`foot${S}`], toe = J[`toes${S}`];
  const iP = B.bi('pelvis'), iT = B.bi(`thigh${S}`), iS = B.bi(`shin${S}`), iF = B.bi(`foot${S}`), iX = B.bi(`toes${S}`);
  const legSkin = (p) => {
    if (p.y > kn.y + 0.08) { const t = sstep(hip.y + 0.02, hip.y - 0.08, p.y); return [iP, 1 - t, iT, t]; }
    if (p.y > an.y + 0.07) { const t = sstep(kn.y + 0.07, kn.y - 0.07, p.y); return [iT, 1 - t, iS, t]; }
    const t = sstep(an.y + 0.06, an.y - 0.01, p.y); return [iS, 1 - t, iF, t];
  };
  B.mat('fabric').color(WHITE).skinFn(legSkin);
  const conv = sstep(0.25, 0.6, B.detail);
  const prof = (y) => {
    if (y > kn.y + 0.09) return lerp(0.092, 0.112, sstep(kn.y + 0.09, hip.y, y));
    if (y > kn.y - 0.09) return 0.096 + 0.0045 * conv * Math.cos(((y - (kn.y + 0.09)) / 0.03) * Math.PI * 2);
    if (y > an.y + 0.12) return lerp(0.084, 0.094, sstep(an.y + 0.12, kn.y - 0.09, y));
    return 0.082 + 0.003 * conv * Math.cos(((y - (an.y + 0.12)) / 0.022) * Math.PI * 2);
  };
  const yTop = hip.y + 0.04, yBot = an.y + 0.02;
  const nR = B.seg(80, 12);
  const pts = [];
  for (let i = 0; i <= nR; i++) {
    const y = lerp(yTop, yBot, i / nR);
    const t = (yTop - y) / (yTop - yBot);
    pts.push(V3(lerp(hip.x + s * 0.008, an.x, t), y, lerp(hip.z + 0.0, an.z + 0.012, t) + 0.012 * Math.sin(t * Math.PI)));
  }
  B.sweep(pts, (t, i) => { const r = prof(pts[i].y); return { rx: r, ry: r * 1.04 }; }, { n: 36, ref: X });
  // sizing straps / lacing on the outside of the thigh and shin
  if (mid) {
    for (const [ya, yb] of [[hip.y - 0.08, kn.y + 0.1], [kn.y - 0.1, an.y + 0.14]]) {
      const ptsS = [];
      for (let i = 0; i <= 8; i++) { const y = lerp(ya, yb, i / 8); const r = prof(y) + 0.003; const t = (yTop - y) / (yTop - yBot); ptsS.push(V3(lerp(hip.x + s * 0.008, an.x, t) + s * r, y, lerp(hip.z, an.z + 0.012, t) + 0.012 * Math.sin(t * Math.PI))); }
      B.mat('fabric').color(WEBBING);
      B.sweep(ptsS, () => ({ rx: 0.0028, ry: 0.013, e: 5 }), { n: 6, ref: V3(s, 0, 0) });
      if (hi) {
        B.mat('metal').color(SILVER);
        for (const k of [2, 6]) B.rbox(ptsS[k].clone().add(V3(s * 0.004, 0, 0)), Z, Y, V3(s, 0, 0), 0.016, 0.011, 0.003, { bevel: 0.002, n: 10 });
      }
    }
  }
  // boot: upper (fabric over a rigid shell), sole (rubber), heel; skinned shin -> foot -> toes
  bootOrlan(B, J, s, an, toe, legSkin, hi, mid, iS, iF, iX);
}

function bootOrlan(B, J, s, an, toe, legSkin, hi, mid, iS, iF, iX) {
  const footSkin = (p) => {
    if (p.y > an.y + 0.02) { const t = sstep(an.y + 0.06, an.y - 0.0, p.y); return [iS, 1 - t, iF, t]; }
    const t = sstep(toe.z - 0.03, toe.z + 0.02, p.z); return [iF, 1 - t, iX, t];
  };
  B.skinFn(footSkin);
  // upper: loft along +Z from heel to toe, section in (X, Y): (ax, ay, path) = (X, Y, Z) right handed
  const z0 = an.z - 0.085, z1 = toe.z + 0.105;
  const K = B.seg(22, 6);
  const rings = [];
  for (let i = 0; i <= K; i++) {
    const t = i / K, z = lerp(z0, z1, t);
    const toeRound = t > 0.8 ? Math.sqrt(Math.max(0.02, 1 - ((t - 0.8) / 0.2) ** 2)) : 1;
    const heelRound = t < 0.1 ? Math.sqrt(Math.max(0.15, 1 - ((0.1 - t) / 0.1) ** 2)) : 1;
    const h = lerp(0.105, 0.06, sstep(0.25, 0.85, t)) * Math.min(toeRound, heelRound) + 0.01;
    const w = (0.06 + 0.012 * Math.sin(Math.PI * Math.min(1, t * 1.3))) * Math.min(toeRound, heelRound * 1.1) + 0.006;
    rings.push({ c: V3(an.x + s * 0.004, 0.035 - 0.004 + h * 0.5, z), ax: X, ay: Y, rx: w, ry: h * 0.5 + 0.002, e: 3.2 });
  }
  B.mat('fabric').color([0.9, 0.9, 0.87]);
  B.loft(rings, { n: 30, capStart: true, capEnd: true });
  // ankle cuff: covers the junction to the leg
  B.mat('fabric').color(OFFWHITE);
  B.lathe(V3(an.x, an.y - 0.03, an.z + 0.0), Y, [[0.088, 0], [0.092, 0.02], [0.09, 0.06], [0.084, 0.075]], { n: 30, ref: X });
  // sole and heel (rubber), toe cap (rubber)
  B.mat('rubber').color([1, 1, 1]);
  B.rbox(V3(an.x + s * 0.004, 0.017, (z0 + z1) / 2), X, Y, Z, 0.068, 0.017, (z1 - z0) / 2 + 0.006, { bevel: 0.012, n: 28 });
  if (mid) {
    B.rbox(V3(an.x + s * 0.004, 0.06, z1 - 0.03), X, Y, Z, 0.058, 0.025, 0.032, { bevel: 0.02, n: 20 });
    // binding straps across the instep with buckles (foot restraint fitting)
    B.mat('fabric').color(WEBBING);
    for (const z of [an.z + 0.05, an.z + 0.1]) B.patch((u, w2, p, n) => { const a = (u - 0.5) * Math.PI * 0.95; p.set(an.x + s * 0.004 + Math.sin(a) * 0.071, 0.038 + Math.cos(a) * 0.072, z - (w2 - 0.5) * 0.024); n.set(Math.sin(a), Math.cos(a), 0); }, 10, 1);
    if (hi) { B.mat('metal').color(SILVER); B.rbox(V3(an.x + s * 0.073, 0.07, an.z + 0.075), Z, Y, V3(s, 0, 0), 0.03, 0.014, 0.004, { bevel: 0.003, n: 10 }); }
  }
}

// ------------------------------------------------------------------------------------------ belt & tethers
function belt(B, J, opts, hi) {
  B.bone('pelvis').mat('fabric').color(WEBBING);
  B.loft([0.985, 1.0, 1.015].map((y, i) => ({ c: V3(0, y, 0.004), ax: Z, ay: X, rx: 0.177 + (i === 1 ? 0.002 : 0), ry: 0.231 + (i === 1 ? 0.002 : 0), e: 2.8 })), { n: 44 });
  // D-rings at the hips and two safety tethers with large hooks clipped back to the belt
  for (const s of [1, -1]) {
    const dr = V3(s * 0.2, 1.0, 0.1);
    B.mat('metal').color(SILVER);
    B.torus(dr.clone().add(V3(0, -0.02, 0.015)), V3(s * 0.4, 0, 0.9).normalize(), 0.018, 0.0035, { n: 16, tube: 6 });
    if (!hi) continue;
    // tether: braided sleeve, hanging loop
    const a = dr.clone().add(V3(0, -0.035, 0.02));
    const pts = curve([a, a.clone().add(V3(s * 0.03, -0.12, 0.04)), a.clone().add(V3(s * 0.05, -0.2, 0.03)), a.clone().add(V3(s * 0.06, -0.1, 0.0)), V3(s * 0.235, 0.98, -0.02)], 6);
    B.mat('fabric').color(s > 0 ? [0.25, 0.35, 0.65] : [0.8, 0.78, 0.7]);
    B.sweep(pts, () => ({ rx: 0.0065, ry: 0.0065 }), { n: 8 });
    // hook (carabiner): body + gate
    const hc = V3(s * 0.24, 0.955, -0.03);
    B.mat('metal').color([0.8, 0.82, 0.85]);
    const hk = [];
    for (let i = 0; i <= 16; i++) { const t = (i / 16) * Math.PI * 1.7 - 0.2; hk.push(hc.clone().add(V3(s * 0.006, Math.cos(t) * 0.045, Math.sin(t) * 0.028))); }
    B.sweep(hk, () => ({ rx: 0.0055, ry: 0.0055 }), { n: 8 });
    B.sweep([hk[0], hk[16]], () => ({ rx: 0.004, ry: 0.004 }), { n: 6 });
    B.mat('hard').color([0.9, 0.7, 0.1]);
    B.rbox(hc.clone().add(V3(s * 0.008, -0.055, 0)), Z, Y, V3(s, 0, 0), 0.012, 0.012, 0.006, { bevel: 0.003, n: 8 });
  }
}

// ------------------------------------------------------------------------------------------ markings
function markings(B, J, v, opts, hi, mid) {
  if (!mid) return;
  B.mat('decal');
  // flag on the left upper arm, mission patch on the right upper arm (wrapped on the sleeve)
  const sl = J.upperArmL, sr = J.upperArmR;
  // wrapDecal angles: 0 = front (+Z), +pi/2 = +X (the left side)
  B.bone('upperArmL');
  B.wrapDecal(V3(sl.x + 0.012, 0, sl.z + 0.004), Y, Z, 0.0875, 1.25, sl.y - 0.205, 0.075, 0.05, B.atlasUV('flag'));
  B.bone('upperArmR');
  B.wrapDecal(V3(sr.x - 0.012, 0, sr.z + 0.004), Y, Z, 0.0875, -1.25, sr.y - 0.205, 0.075, 0.075, B.atlasUV('patch'));
  // chest: name tag (left), "ОРЛАН-МКС" lettering above the panel, serial plate (right)
  B.bone('chest');
  const tag = (y, th, w, h, name, lift = 0.004) => {
    const p = torsoPoint(y, th, lift), n = torsoPoint(y, th, 0.05).sub(torsoPoint(y, th, 0)).normalize();
    B.quad(p, n, Y, w, h, B.atlasUV(name), 0.0008);
  };
  tag(1.41, 0.42, 0.12, 0.03, v.name);
  tag(1.41, -0.42, 0.13, 0.032, 'orlan');
  tag(1.12, 0.65, 0.12, 0.03, 'serial');
  // big suit number on the backpack door and the legs
  B.bone('hatch');
  B.quad(V3(0, 1.56, -0.465), NZ, Y, 0.16, 0.16, B.atlasUV(v.num), 0.0012);
  B.quad(V3(0, 1.69, -0.452), NZ, Y, 0.24, 0.06, B.atlasUV('aurora'), 0.0012);
  B.quad(V3(-0.13, 1.08, -0.468), NZ, Y, 0.12, 0.03, B.atlasUV('hatchLabel'), 0.0012);
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    B.bone(`thigh${S}`);
    const hip = J[`thigh${S}`];
    B.wrapDecal(V3(hip.x + s * 0.005, 0, hip.z + 0.012), Y, Z, 0.105, s * 0.9, hip.y - 0.25, 0.06, 0.06, B.atlasUV(v.num));
  }
}

// ------------------------------------------------------------------------------------------ propulsion add-on
function upm(B, J, opts, hi, mid) {
  // two nozzle towers on the backpack sides (thrust puffs: EvaPhysics.NOZZLES) + hand controller on the chest
  B.bone('hatch');
  for (const s of [1, -1]) {
    const x = s * 0.30, z = -0.375;
    B.mat('hard').color([0.85, 0.86, 0.85]);
    B.rbox(V3(x, 1.5, z), X, Y, Z, 0.03, 0.27, 0.04, { bevel: 0.012, n: 16 });
    B.mat('metal').color([0.6, 0.62, 0.65]);
    for (const y of [1.27, 1.74]) for (const d of [V3(s, 0, 0), Z, NZ, Y.clone().multiplyScalar(y > 1.5 ? 1 : -1)]) {
      const p = V3(x, y, z).addScaledVector(d, d.y ? 0.012 : (d.x ? 0.03 : 0.04));
      B.lathe(p, d, [[0.008, 0], [0.011, 0.012], [0.012, 0.014]], { n: 10 });
    }
    B.mat('hard').color([0.75, 0.6, 0.15]);
    B.rbox(V3(x, 1.5, z - 0.041), X, Y, Z, 0.022, 0.05, 0.002, { bevel: 0.001, n: 6 });
  }
  B.mat('hard').color([0.85, 0.86, 0.85]);
  B.rbox(V3(0, 0.98, -0.34), X, Y, Z, 0.22, 0.035, 0.1, { bevel: 0.02, n: 20 });
  // hand controller module (stowed low on the right chest; the right hand grips it while thrusting)
  B.bone('chest');
  const hc = V3(-0.17, 1.17, 0.215);
  B.mat('hard').color([0.2, 0.21, 0.23]);
  B.rbox(hc, X, Y, Z, 0.045, 0.032, 0.03, { bevel: 0.01, n: 14 });
  B.mat('decal');
  B.quad(hc.clone().add(V3(0, 0.0, 0.0305)), Z, Y, 0.085, 0.057, B.atlasUV('hcm'), 0.0008);
  B.mat('hard').color([0.15, 0.15, 0.16]);
  B.lathe(hc.clone().add(V3(0, 0.032, 0.0)), Y, [[0.012, 0], [0.011, 0.05], [0.015, 0.06], [0.013, 0.075], [0.001, 0.077]], { n: 12 });
  B.mat('hard').color(GREY);
  B.rbox(hc.clone().add(V3(0.0, 0, -0.04)), X, Y, Z, 0.03, 0.02, 0.012, { bevel: 0.005, n: 10 });
}

// ------------------------------------------------------------------------------------------ stripes
/** Identification bands (blue No 6 / red No 7) on the upper arms, thighs and shins: tint the white outer layer. */
function stripes(B, J, v) {
  const yA = J.upperArmL.y - 0.2, yT = 0.72, yS = 0.3;
  B.shade('fabric', (p, n, c) => {
    if (c[0] < 0.88 || c[2] < 0.85) return;                  // only the white outer layer (not straps / webbing)
    const ax = Math.abs(p.x);
    const arm = ax > 0.19 && p.y > yA - 0.03 && p.y < yA + 0.03;
    const leg = ax > 0.02 && ax < 0.24 && ((p.y > yT - 0.028 && p.y < yT + 0.028) || (p.y > yS - 0.02 && p.y < yS + 0.02));
    if (arm || leg) { c[0] = v.stripe[0]; c[1] = v.stripe[1]; c[2] = v.stripe[2]; }
  });
}

// ------------------------------------------------------------------------------------------ grime
/** Baked wear: knees, shins, boots, glove palms / fingertips, lower torso; tiny colour variation everywhere. */
function grime(B, v) {
  const f = (p, n, c) => {
    const no = fbm3(p.x * 9, p.y * 9, p.z * 9, 3);
    let g = 0.025 * (no - 0.5);
    const kneeL = Math.exp(-(((p.y - 0.53) / 0.07) ** 2)) * sstep(-0.02, 0.06, p.z);
    g -= 0.08 * kneeL * sstep(0.3, 0.7, no);
    g -= 0.05 * sstep(0.32, 0.12, p.y) * sstep(0.35, 0.65, no);           // shins / boots
    g -= 0.08 * sstep(0.08, 0.0, p.y);                                    // sole edges
    g -= 0.05 * sstep(0.85, 0.7, p.y) * sstep(0.18, 0.3, Math.abs(p.x)) * sstep(0.3, 0.7, no);  // gloves (hanging at the hips)
    g -= 0.03 * sstep(1.0, 0.86, p.y) * sstep(0.4, 0.8, no);
    const k = 1 + g;
    c[0] *= k; c[1] *= k; c[2] *= k * (1 - 0.01 * kneeL);
  };
  B.shade('fabric', f);
  B.shade('seam', f);
}
