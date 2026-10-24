import * as THREE from 'three';
import { offset, sub, rot, roundRect, circle, radialPair, roundRectRadius } from './Mesh.js';

/**
 * Interior equipment kit. Every builder takes K (build context) and a placement matrix M in compartment
 * coordinates, and writes into K.W (MeshWriter) using atlas rects from K.T.
 *
 *   K = { W, T (Atlas), rnd() (seeded random 0..1), lite, detail, rails[] (zone-local handrail segments),
 *         solids[] (zone-local obstacle colliders), set: material-set prefix ('' or 'c:') }
 *
 * Conventions: a "face frame" has X across the face (to the viewer's right), Y up on the face, Z out of the
 * face toward the viewer. Racks: X = 1.05 m (along the module), Y = across the wall.
 */

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export const COL = {
  rail: 0x8fa3ba, railRu: 0x4f6e56, metal: 0xb9bcc0, dark: 0x3a3c40, black: 0x1b1c1e, white: 0xeceae3, offwhite: 0xdedbd2,
  grey: 0x9a9da1, blue: 0x2f5f9e, red: 0xc0352b, yellow: 0xe9b82a, orange: 0xe07a2b, green: 0x4f7f43, cable: 0x2a2b2e,
  cableW: 0xd9d6cc, cableG: 0x7d8086, beige: 0xd6ccb4, seal: 0x2b2c2e, alu: 0xc6c9cc,
};

/** Point in M's frame -> zone coordinates. */
export function pt(M, x, y, z) { return new THREE.Vector3(x, y, z).applyMatrix4(M); }
/** Direction / offset vector in M's frame -> zone coordinates (rotation only, length kept). */
export function dir(M, x, y, z) { const e = M.elements; return new THREE.Vector3(e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z); }

// ------------------------------------------------------------------------------------------------ basics

/** Handrail: bar from a to b (zone coords) standing off the surface along n by `stand`. Registers a grab segment. */
export function handrail(K, a, b, n, color = COL.rail, stand = 0.07, r = 0.016) {
  const W = K.W;
  const A = a.clone().addScaledVector(n, stand), B = b.clone().addScaledVector(n, stand);
  W.tube(K.set + 'metal', [A, B], r, 8, color);
  for (const p of [a, b]) {
    const q = p.clone().addScaledVector(n, stand);
    W.tube(K.set + 'metal', [p.clone().addScaledVector(n, -0.005), q], r * 0.8, 6, color);
    // foot plate
    W.tube(K.set + 'metal', [p.clone().addScaledVector(n, -0.004), p.clone().addScaledVector(n, 0.01)], r * 1.9, 8, COL.grey, false);
  }
  K.rails.push({ a: A, b: B, radius: r });
}

/** Seat track: thin aluminium rail with a slot along a -> b on a surface with normal n. */
export function seatTrack(K, a, b, n) {
  const len = a.distanceTo(b);
  if (len < 0.05) return;
  const X = _a.subVectors(b, a).normalize().clone(), Z = n.clone().normalize(), Y = new THREE.Vector3().crossVectors(Z, X);
  const M = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(a.clone().lerp(b, 0.5).addScaledVector(Z, 0.008));
  K.W.box(K.set + 'metal', M, len, 0.025, 0.016, COL.alu);
  if (!K.lite) K.W.box(K.set + 'paint', offset(M, 0, 0, 0.0085), len, 0.008, 0.002, COL.dark);
}

/** Text placard / sign on a surface (face frame M). */
export function sign(K, M, text, w, h, opts = {}) {
  const ph = Math.round((opts.ph ?? 40) * 0.75);
  const r = K.T.label(text, { ...opts, w: opts.pw ?? Math.round(Math.min(640, ph * w / h)), h: ph });
  K.W.box(K.set + 'equip', offset(M, 0, 0, 0.004), w, h, 0.006, 0xffffff, r, K.T.rect('white'), 16 | 1 | 2 | 4 | 8);
}

/** LED light panel (GLA): housing + glowing diffuser, size w x h, on a surface. */
export function lightPanel(K, M, w = 0.56, h = 0.2, color = [3.2, 3.1, 2.9]) {
  K.W.chamferBox(K.set + 'paint', offset(M, 0, 0, 0.02), w + 0.06, h + 0.05, 0.04, 0.012, COL.offwhite);
  K.W.box('glow', offset(M, 0, 0, 0.041), w, h, 0.004, color, null, null, 16);
  if (!K.lite) for (const sx of [-1, 1]) K.W.box(K.set + 'paint', offset(M, sx * (w / 2 + 0.035), 0, 0.03), 0.02, h * 0.6, 0.03, COL.grey);
}

/** Vent grille with a short collar. */
export function vent(K, M, w = 0.3, h = 0.16) {
  K.W.box(K.set + 'equip', offset(M, 0, 0, 0.012), w, h, 0.024, 0xffffff, K.T.rect('vent'), K.T.rect('grey'));
}

/** Cable bundle along a polyline: n wires twisted together, plus clamps. */
export function cables(K, pts, n = 3, r = 0.012, colors = [COL.cable, COL.cableW, COL.cableG], clampEvery = 0.6) {
  const W = K.W;
  if (pts.length < 2) return;
  if (K.lite) { W.tube(K.set + 'paint', pts, r * 2.2, 5, colors[0]); return; }
  const path = resample(pts, 0.12);
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  for (let w = 0; w < n; w++) {
    const ph = (w / n) * Math.PI * 2, off = n > 1 ? r * 1.15 : 0;
    const ps = path.map((p, i) => {
      frameAt(path, i, T, N, B);
      const a = ph + i * 0.35;
      return p.clone().addScaledVector(N, Math.cos(a) * off).addScaledVector(B, Math.sin(a) * off);
    });
    W.tube(K.set + 'paint', ps, r, 5, colors[w % colors.length]);
  }
  // clamps / ties
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    acc += path[i].distanceTo(path[i - 1]);
    if (acc >= clampEvery) {
      acc = 0;
      frameAt(path, i, T, N, B);
      const M = new THREE.Matrix4().makeBasis(N, T, B).setPosition(path[i]);
      W.cyl(K.set + 'paint', M, r * (n > 1 ? 2.6 : 1.6), r * (n > 1 ? 2.6 : 1.6), 0.018, 8, COL.black, 0);
    }
  }
}

/** Flexible duct (ribbed hose) along a polyline. */
export function duct(K, pts, r = 0.07, color = 0xe8e6de) {
  const path = resample(pts, 0.05);
  const ribs = K.lite ? 0 : 0.12;
  K.W.tube(K.set + 'paint', path, (t) => r * (1 + ribs * Math.max(0, Math.sin(t * path.length * Math.PI * 0.9))), K.lite ? 6 : 10, color);
}

function resample(pts, step) {
  const out = [pts[0].clone()];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = a.distanceTo(b), n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n));
  }
  return out;
}
function frameAt(path, i, T, N, B) {
  const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
  T.subVectors(b, a).normalize();
  N.set(0, 1, 0); if (Math.abs(T.y) > 0.9) N.set(1, 0, 0);
  N.addScaledVector(T, -N.dot(T)).normalize();
  B.crossVectors(T, N);
}

/** Smooth curve through control points (Catmull-Rom), returns points. */
export function curve(points, n = 16) {
  const c = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return c.getPoints(n);
}

/** Bungee cord between two points (sagging slightly toward `sag` direction). */
export function bungee(K, a, b, sag = null, color = COL.black) {
  const mid = a.clone().lerp(b, 0.5);
  if (sag) mid.addScaledVector(sag, 0.02);
  K.W.tube(K.set + 'paint', K.lite ? [a, b] : curve([a, mid, b], 6), 0.005, 4, color);
  if (!K.lite) for (const p of [a, b]) K.W.sphere(K.set + 'metal', new THREE.Matrix4().setPosition(p), 0.012, 6, 4, COL.metal);
}

/** Cargo Transfer Bag: soft box with label face, handle strap and zip line. */
export function bag(K, M, w, h, d, kind = 'ctb') {
  const W = K.W, T = K.T;
  const face = T.rect(kind === 'w' ? 'ctbW' : kind === 'b' ? 'ctbB' : 'ctb');
  W.chamferBox(K.set + 'equip', M, w, h, d, Math.min(0.035, d * 0.25), 0xffffff, face, T.rect('ctbSide'));
  if (K.lite) return;
  // carry strap on top + zipper bead on the front edge
  W.box(K.set + 'paint', offset(M, 0, h / 2 + 0.006, 0), w * 0.35, 0.012, d * 0.18, COL.dark);
  W.box(K.set + 'paint', offset(M, 0, h / 2 - 0.02, d / 2 + 0.003), w * 0.9, 0.008, 0.006, 0x8b8577);
}

/** Small item cluster on a surface (velcro): notebooks, pouches, drink bags, tools. */
export function clutter(K, M, w, h, n = 4) {
  if (K.lite) return;
  const W = K.W, r = K.rnd;
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * w * 0.85, y = (r() - 0.5) * h * 0.85, a = (r() - 0.5) * 0.6;
    const Mi = sub(M, x, y, 0, 'z', a);
    const t = r();
    W.box(K.set + 'equip', offset(Mi, 0, 0, 0.002), 0.06, 0.06, 0.004, 0xffffff, T_(K, 'velcro'));
    if (t < 0.22) { // notebook / checklist
      W.box(K.set + 'equip', offset(Mi, 0, 0, 0.012), 0.15, 0.2, 0.015, 0xffffff, K.T.rect('checklist'), K.T.rect('white'));
    } else if (t < 0.4) { // drink bag with straw
      W.chamferBox(K.set + 'paint', offset(Mi, 0, 0, 0.02), 0.09, 0.13, 0.03, 0.012, [0.75, 0.72, 0.65]);
      W.cyl(K.set + 'paint', sub(Mi, 0, 0.08, 0.02), 0.005, 0.005, 0.05, 5, COL.white, 0);
    } else if (t < 0.55) { // pouch
      W.chamferBox(K.set + 'equip', offset(Mi, 0, 0, 0.025), 0.16, 0.11, 0.05, 0.02, 0xffffff, K.T.rect(['fabricBlue', 'fabricOrange', 'fabricGreen'][Math.floor(r() * 3)]));
    } else if (t < 0.68) { // tool (wrench / scissors)
      W.box(K.set + 'metal', offset(Mi, 0, 0, 0.008), 0.02, 0.16, 0.008, COL.metal);
      W.cyl(K.set + 'metal', sub(Mi, 0, 0.085, 0.008, 'x', Math.PI / 2), 0.02, 0.02, 0.008, 8, COL.metal);
    } else if (t < 0.8) { // headset
      W.torus(K.set + 'paint', offset(Mi, 0, 0, 0.02), 0.07, 0.008, 4, 12, COL.black, Math.PI, 0);
      for (const sx of [-1, 1]) W.cyl(K.set + 'paint', sub(Mi, sx * 0.07, 0, 0.02, 'x', Math.PI / 2), 0.03, 0.03, 0.025, 10, COL.dark);
    } else if (t < 0.9) { // food packet
      W.box(K.set + 'paint', offset(Mi, 0, 0, 0.01), 0.1, 0.14, 0.02, [0.85, 0.82, 0.7]);
      W.box(K.set + 'equip', offset(Mi, 0, 0.02, 0.021), 0.08, 0.04, 0.002, 0xffffff, K.T.label(['БОРЩ', 'КОФЕ', 'TORTILLA', 'ТВОРОГ', 'CHICKEN', 'ЧАЙ'][Math.floor(r() * 6)], { w: 128, h: 48, bg: '#f2efe2' }));
    } else { // pen / flashlight
      W.cyl(K.set + 'paint', sub(Mi, 0, 0, 0.01), 0.012, 0.012, 0.16, 8, r() < 0.5 ? COL.black : COL.blue);
    }
  }
}
function T_(K, n) { return K.T.rect(n); }

/** Laptop on a swing arm (arm base at M, opens toward +Z). */
export function laptop(K, M, screen = 'scrBlue', arm = 0.35) {
  const W = K.W;
  // arm: base plate, two links, tilt head
  W.box(K.set + 'metal', offset(M, 0, 0, 0.01), 0.08, 0.08, 0.02, COL.dark);
  const p0 = pt(M, 0, 0, 0.02), p1 = pt(M, 0.04, 0.05, arm * 0.55), p2 = pt(M, 0, 0, arm);
  W.tube(K.set + 'metal', [p0, p1], 0.014, 6, COL.dark);
  W.tube(K.set + 'metal', [p1, p2], 0.012, 6, COL.dark);
  // laptop: base (keyboard up) and screen lid, centred at the arm tip
  const B = sub(M, 0, 0, arm + 0.012, 'x', -0.25);
  W.box(K.set + 'equip', B, 0.34, 0.24, 0.022, 0xffffff, K.T.rect('keyboard'), K.T.rect('dark'));
  const S = sub(B, 0, 0.12, 0.011, 'x', -1.45);
  W.box(K.set + 'equip', offset(S, 0, 0.115, 0), 0.34, 0.23, 0.012, 0xffffff, K.T.rect(screen), K.T.rect('laptopLid'));
}

/** Fixed display panel with bezel (e.g. station status monitor). */
export function display(K, M, w, h, screen = 'scrGraph') {
  K.W.box(K.set + 'equip', offset(M, 0, 0, 0.015), w, h, 0.03, 0xffffff, K.T.rect(screen), K.T.rect('dark'));
}

/** Portable fire extinguisher in a bracket + placard. */
export function extinguisher(K, M) {
  const W = K.W;
  W.box(K.set + 'paint', offset(M, 0, 0, 0.01), 0.16, 0.45, 0.02, COL.dark);
  for (const y of [-0.12, 0.12]) W.torus(K.set + 'metal', sub(M, 0, y, 0.08, 'x', Math.PI / 2), 0.075, 0.01, 4, 14, COL.metal);
  const C = sub(M, 0, 0, 0.08);
  W.lathe(K.set + 'paint', offset(C, 0, -0.2, 0), [[0.0, 0], [0.065, 0.005], [0.068, 0.03], [0.068, 0.3], [0.05, 0.36], [0.02, 0.38]], 14, COL.red);
  W.box(K.set + 'paint', offset(C, 0, 0.21, 0), 0.03, 0.06, 0.03, COL.black);
  W.tube(K.set + 'paint', [pt(C, 0.015, 0.22, 0), pt(C, 0.07, 0.2, 0.02), pt(C, 0.075, 0.05, 0.03)], 0.008, 5, COL.black);
  W.box(K.set + 'paint', offset(C, 0.0, 0.26, 0), 0.08, 0.012, 0.02, COL.black);
  sign(K, offset(M, 0, 0.32, 0.01), 'ОГНЕТУШИТЕЛЬ · FIRE EXT', 0.3, 0.05, { bg: '#c0352b', fg: '#fff', ph: 32 });
}

/** Portable breathing apparatus (PBA): yellow bottle + mask in a pouch. */
export function pba(K, M) {
  const W = K.W;
  W.box(K.set + 'paint', offset(M, 0, 0, 0.01), 0.18, 0.36, 0.02, COL.dark);
  const C = sub(M, 0, -0.02, 0.07);
  W.cyl(K.set + 'paint', C, 0.055, 0.055, 0.26, 12, COL.yellow, 3);
  W.cyl(K.set + 'metal', offset(C, 0, 0.15, 0), 0.02, 0.02, 0.05, 8, COL.metal);
  W.chamferBox(K.set + 'paint', offset(M, 0, 0.12, 0.13), 0.12, 0.1, 0.06, 0.02, [0.85, 0.5, 0.15]);
  sign(K, offset(M, 0, 0.24, 0.01), 'ПБА · PBA', 0.2, 0.045, { bg: '#e0a01a', fg: '#111', ph: 32 });
}

/** Small video camera on a bracket looking along +Z. */
export function camera(K, M) {
  const W = K.W;
  W.box(K.set + 'metal', offset(M, 0, 0, 0.02), 0.05, 0.05, 0.04, COL.dark);
  W.box(K.set + 'paint', offset(M, 0, 0, 0.08), 0.08, 0.07, 0.1, COL.black);
  W.cyl(K.set + 'metal', sub(M, 0, 0, 0.14, 'x', Math.PI / 2), 0.025, 0.028, 0.03, 10, COL.dark);
  W.box('glow', offset(M, 0.03, 0.03, 0.131), 0.008, 0.008, 0.002, [3, 0.2, 0.1], null, null, 16);
}

/** Emergency egress sign with an arrow (glowing). */
export function egressSign(K, M, text = 'ВЫХОД · EXIT →', w = 0.34) {
  const r = K.T.label(text, { w: 320, h: 48, bg: '#1f8a3a', fg: '#ffffff', glow: true });
  K.W.box(K.set + 'equip', offset(M, 0, 0, 0.006), w, w * 0.15, 0.01, 0xffffff, r, K.T.rect('white'));
}

/** Foot restraint loops along a strip. */
export function footLoops(K, M, len, n = 3) {
  const W = K.W;
  W.box(K.set + 'metal', offset(M, 0, 0, 0.006), len, 0.04, 0.012, COL.grey);
  if (K.lite) return;
  for (let i = 0; i < n; i++) {
    const x = (i / Math.max(1, n - 1) - 0.5) * len * 0.8;
    W.torus(K.set + 'equip', sub(M, x, 0, 0.012, 'y', Math.PI / 2), 0.07, 0.012, 4, 10, 0xffffff, Math.PI, 0);
  }
}

/** Velcro patch. */
export function velcro(K, M, w = 0.08, h = 0.05, white = false) {
  K.W.box(K.set + 'equip', offset(M, 0, 0, 0.002), w, h, 0.004, 0xffffff, K.T.rect(white ? 'velcroW' : 'velcro'), null, 16);
}

// ------------------------------------------------------------------------------------------------ racks

/**
 * ISPR rack at face frame M (X along the module, Y across the wall, Z into the aisle), face size w x h.
 * type: locker | locker2 | drawers | expA | expB | expC | freezer | eclss | co2 | water | power | med |
 *       galley | ru | ruB | blank | stow | glovebox | cq | prop | open
 */
export function rack(K, M, type, w = 1.05, h = 1.6, opts = {}) {
  const W = K.W, T = K.T, s = K.set;
  const faceName = { locker: 'rackLocker', locker2: 'rackLocker2', drawers: 'rackDrawers', expA: 'rackExpA', expB: 'rackExpB', expC: 'rackExpC', freezer: 'rackFreezer', eclss: 'rackEclss', co2: 'rackEclss2', water: 'rackWater', power: 'rackPower', med: 'rackMed', galley: 'rackGalley', ru: 'rackRu', ruB: 'rackRuB', blank: 'rackBlank', cq: 'rackCQ', prop: 'rackProp', stow: 'rackBlank', glovebox: 'rackExpC', open: 'rackBlank' }[type] || 'rackBlank';
  const face = T.rect(faceName);
  const fw = w - 0.03;
  // face panel (slightly recessed edges show the rack posts)
  if (type !== 'stow' && type !== 'open') W.box(s + 'equip', offset(M, 0, 0, -0.02), fw, h - 0.02, 0.04, 0xffffff, face, T.rect('grey'), 16 | 1 | 2 | 4 | 8);
  // posts and top/bottom rails (the ISPR frame)
  for (const sx of [-1, 1]) W.box(s + 'metal', offset(M, sx * (w / 2 - 0.012), 0, -0.01), 0.024, h, 0.04, COL.alu);
  for (const sy of [-1, 1]) W.box(s + 'paint', offset(M, 0, sy * (h / 2 - 0.015), -0.012), fw - 0.03, 0.03, 0.03, 0xc9c7c0);
  // pivot handles at both ends of the across-dimension
  if (!K.lite) for (const sy of [-1, 1]) {
    const y = sy * (h / 2 - 0.08);
    W.tube(s + 'metal', [pt(M, -0.12, y, 0.0), pt(M, -0.12, y, 0.045), pt(M, 0.12, y, 0.045), pt(M, 0.12, y, 0.0)], 0.009, 6, COL.dark);
  }
  const rnd = K.rnd;
  switch (type) {
    case 'locker': case 'locker2': {
      const n = type === 'locker' ? 2 : 1;
      for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) {
        const cw = (fw - 0.06) / n, ch = (h - 0.12) / 2;
        const x = -fw / 2 + 0.03 + cw * (i + 0.5), y = -h / 2 + 0.06 + ch * (j + 0.5);
        if (!K.lite) for (const yy of [ch / 2 - 0.06, -ch / 2 + 0.06]) W.box(s + 'metal', offset(M, x, y + yy, 0.012), 0.05, 0.022, 0.02, COL.dark);
      }
      break;
    }
    case 'drawers': {
      if (!K.lite) for (let j = 0; j < 9; j++) W.box(s + 'paint', offset(M, 0, -h / 2 + 0.08 + (j + 0.5) * (h - 0.16) / 9 - 0.04, 0.008), fw * 0.25, 0.015, 0.016, COL.dark);
      break;
    }
    case 'expA': case 'expB': case 'expC': {
      // protruding instrument boxes, a cable loop and maybe a laptop
      const n = K.lite ? 1 : 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) {
        const bw = 0.2 + rnd() * 0.22, bh = 0.14 + rnd() * 0.16, bd = 0.04 + rnd() * 0.07;
        const x = (rnd() - 0.5) * (fw - bw) * 0.9, y = (rnd() - 0.5) * (h - bh) * 0.8;
        W.chamferBox(s + 'equip', offset(M, x, y, bd / 2), bw, bh, bd, 0.012, 0xffffff, T.rect(['scrGraph', 'scrText', 'rackExpA', 'scrMicro'][Math.floor(rnd() * 4)]), T.rect('grey'));
      }
      if (!K.lite) {
        const y0 = (rnd() - 0.5) * h * 0.6;
        cables(K, curve([pt(M, -0.35, y0, 0.02), pt(M, -0.2, y0 - 0.25, 0.12), pt(M, 0.15, y0 - 0.2, 0.1), pt(M, 0.32, y0 + 0.1, 0.02)], 10), 2, 0.008, [COL.black, 0x6e7378]);
      }
      if (opts.laptop) laptop(K, offset(M, 0.2, 0.3, 0.0));
      break;
    }
    case 'freezer': {
      for (let j = 0; j < 4; j++) {
        const y = -h / 2 + h * (0.05 + j * 0.225 + 0.21 * 0.42);
        W.torus(s + 'metal', offset(M, 0, y, 0.01), 0.07, 0.014, 5, 16, COL.metal);
        W.cyl(s + 'metal', sub(M, 0, y, 0.02, 'x', Math.PI / 2), 0.035, 0.035, 0.03, 12, COL.dark);
      }
      break;
    }
    case 'eclss': case 'co2': case 'water': case 'prop': {
      if (K.lite) break;
      // external plumbing: two pipes with valves and a filter canister
      const pc = type === 'water' ? 0x9fb8d0 : type === 'prop' ? 0xd0b07a : 0xbfc4c8;
      for (const yy of [-0.25, 0.05]) {
        W.tube(s + 'metal', [pt(M, -fw / 2 + 0.05, yy, 0.04), pt(M, fw / 2 - 0.05, yy, 0.04)], 0.016, 8, pc);
        const vx = (rnd() - 0.5) * 0.5;
        W.cyl(s + 'metal', sub(M, vx, yy, 0.06, 'x', Math.PI / 2), 0.025, 0.025, 0.05, 10, COL.dark);
        W.torus(s + 'paint', offset(M, vx, yy, 0.09), 0.04, 0.007, 4, 12, COL.red);
      }
      W.cyl(s + 'metal', offset(M, 0.3, -0.5, 0.08), 0.06, 0.06, 0.3, 14, COL.alu);
      W.box(s + 'paint', offset(M, 0.3, -0.5, 0.08), 0.13, 0.04, 0.13, COL.blue);
      break;
    }
    case 'power': {
      if (!K.lite) cables(K, [pt(M, -fw / 2 + 0.05, h / 2 - 0.15, 0.02), pt(M, -fw / 2 + 0.08, -h / 2 + 0.2, 0.05)], 3, 0.01, [COL.black, COL.red, COL.black]);
      break;
    }
    case 'med': {
      if (!K.lite) for (let j = 0; j < 6; j++) W.box(s + 'paint', offset(M, 0.05, -h / 2 + h * (0.05 + j * 0.15 + 0.11), 0.008), fw * 0.32, 0.014, 0.016, COL.dark);
      break;
    }
    case 'galley': {
      if (!K.lite) for (let j = 0; j < 7; j++) W.box(s + 'paint', offset(M, 0.0, -h / 2 + h * (0.04 + j * 0.135 + 0.085), 0.008), fw * 0.28, 0.014, 0.016, COL.dark);
      break;
    }
    case 'cq': {
      // crew quarters: soft-walled booth protruding from the rack bay, fabric door
      W.chamferBox(s + 'equip', offset(M, 0, 0, 0.05), fw, h - 0.04, 0.1, 0.03, 0xffffff, T.rect('rackCQ'), T.rect('fabric'));
      W.box(s + 'paint', offset(M, fw / 2 - 0.12, 0, 0.105), 0.03, 0.12, 0.02, COL.dark);
      break;
    }
    case 'glovebox': {
      // Microgravity Science Glovebox: work volume with a window and two glove ports
      const gw = fw - 0.12, gh = h * 0.42, gd = 0.36;
      const G = offset(M, 0, h * 0.1, gd / 2);
      W.chamferBox(s + 'paint', G, gw, gh, gd, 0.03, 0xb9c3cc);
      W.box(s + 'equip', offset(G, 0, -gh * 0.32, gd / 2 + 0.002), gw * 0.95, gh * 0.25, 0.004, 0xffffff, T.rect('gloveboxFront'));
      W.box(s + 'glass', offset(G, 0, gh * 0.08, gd / 2 + 0.004), gw * 0.9, gh * 0.55, 0.01, 0xffffff);
      for (const sx of [-1, 1]) {
        W.torus(s + 'metal', offset(G, sx * gw * 0.24, gh * 0.08, gd / 2 + 0.01), 0.09, 0.018, 6, 20, COL.dark);
        if (!K.lite) W.lathe(s + 'paint', sub(G, sx * gw * 0.24, gh * 0.08, gd / 2 - 0.02, 'x', -Math.PI / 2), [[0.085, 0], [0.07, 0.05], [0.055, 0.12], [0.045, 0.16]], 12, COL.black);
      }
      // work light inside, a sample tray
      W.box('glow', offset(G, 0, gh / 2 - 0.03, 0), gw * 0.7, 0.01, 0.05, [2.5, 2.6, 2.6], null, null, 8);
      W.box(s + 'paint', offset(G, 0, -gh * 0.1, 0.0), gw * 0.4, 0.02, gd * 0.5, COL.grey);
      if (K.solids && opts.solid !== false) K.solids.push(boxSolid(G, gw / 2, gh / 2, gd / 2));
      break;
    }
    case 'stow': case 'open': {
      // open bay: dark interior, shelves of bags held by a net / bungees
      W.box(s + 'paint', offset(M, 0, 0, -0.35), fw, h - 0.04, 0.02, 0x2a2b2e, null, null, 16);
      for (const sx of [-1, 1]) W.box(s + 'paint', offset(M, sx * (fw / 2 - 0.01), 0, -0.18), 0.02, h - 0.04, 0.34, 0x8a8c8e, null, null, sx > 0 ? 2 : 1);
      if (type === 'stow') {
        const rows = 3, bh = (h - 0.1) / rows;
        for (let j = 0; j < rows; j++) {
          const n = 1 + Math.floor(rnd() * 2);
          for (let i = 0; i < n; i++) {
            const bw = (fw - 0.06) / n - 0.02;
            bag(K, offset(M, -fw / 2 + 0.03 + (i + 0.5) * (fw - 0.06) / n, -h / 2 + 0.05 + (j + 0.5) * bh, -0.15 + rnd() * 0.04), bw, bh - 0.04, 0.38, rnd() < 0.25 ? 'w' : rnd() < 0.15 ? 'b' : 'ctb');
          }
        }
        if (!K.lite) for (let j = 1; j < 3; j++) bungee(K, pt(M, -fw / 2 + 0.02, -h / 2 + j * h / 3, 0.06), pt(M, fw / 2 - 0.02, -h / 2 + j * h / 3, 0.06), dir(M, 0, 0, -1));
      }
      break;
    }
    default: break;
  }
  if (!K.lite && opts.label) sign(K, offset(M, -fw / 2 + 0.16, h / 2 - 0.05, 0.002), opts.label, 0.24, 0.04, { ph: 32 });
}

/** Box obstacle collider (zone coords) from a frame and half sizes. */
export function boxSolid(M, hx, hy, hz, name = 'equip') {
  const c = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  M.decompose(c, q, s);
  return { type: 'box', center: c, halfSize: new THREE.Vector3(hx, hy, hz), quaternion: q, name };
}

// ------------------------------------------------------------------------------------------------ hatches

/** CBM hatch opening size (square with rounded corners). */
export const CBM = { w: 1.18, r: 0.2 };

/**
 * CBM hatch frame on a bulkhead (face frame M, opening centred): raised frame, seal, latch pads,
 * hatch placards. `depth` = thickness of the frame ring.
 */
export function hatchFrameCBM(K, M, label = null) {
  const W = K.W, s = K.set;
  const o = roundRect(CBM.w + 0.24, CBM.w + 0.24, CBM.r + 0.1, K.lite ? 2 : 5), i = roundRect(CBM.w, CBM.w, CBM.r, K.lite ? 2 : 5);
  W.frame2D(s + 'metal', offset(M, 0, 0, 0.035), o, i, 0.07, 0xa9adb1);
  const o2 = roundRect(CBM.w + 0.04, CBM.w + 0.04, CBM.r + 0.02, K.lite ? 2 : 5);
  W.frame2D(s + 'paint', offset(M, 0, 0, 0.075), o2, i, 0.012, COL.seal, null, { back: false, outerWall: true, innerWall: false });
  if (!K.lite) {
    // latch pads around the frame
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8, rr = CBM.w / 2 + 0.09;
      const x = Math.cos(a) * rr * 1.05, y = Math.sin(a) * rr * 1.05;
      W.box(s + 'metal', offset(M, Math.max(-0.68, Math.min(0.68, x)), Math.max(-0.68, Math.min(0.68, y)), 0.08), 0.06, 0.06, 0.02, COL.dark);
    }
    stripeFrame(K, M, CBM.w + 0.3, 0.035);
  }
  if (label) sign(K, offset(M, 0, CBM.w / 2 + 0.2, 0.0), label, 0.62, 0.075, { ph: 40, bg: '#f4f2ea', border: '#3a3d42' });
}

/** Hazard-striped thin border around a square opening (on the bulkhead). */
function stripeFrame(K, M, size, wdt) {
  const r = K.T.rect('stripes');
  for (const [x, y, w, h] of [[0, size / 2 + wdt / 2, size + wdt * 2, wdt], [0, -size / 2 - wdt / 2, size + wdt * 2, wdt], [size / 2 + wdt / 2, 0, wdt, size], [-size / 2 - wdt / 2, 0, wdt, size]]) {
    K.W.box(K.set + 'equip', offset(M, x, y, 0.003), w, h, 0.004, 0xffffff, r, null, 16);
  }
}

/**
 * CBM hatch door (closed position at M, face toward +Z). Built at the origin of M so callers can rotate it
 * about a hinge. Window, central gearbox handle, MPEV valve, placards.
 */
export function hatchDoorCBM(K, M) {
  const W = K.W, T = K.T, s = K.set;
  const p = roundRect(CBM.w - 0.04, CBM.w - 0.04, CBM.r - 0.02, K.lite ? 2 : 5);
  W.poly(s + 'equip', offset(M, 0, 0, 0), p, 0xffffff, T.rect('hatchCBM'), 0.06);
  // stiffening ribs on the back side
  if (!K.lite) for (const y of [-0.3, 0, 0.3]) W.box(s + 'metal', offset(M, 0, y, -0.05), CBM.w - 0.2, 0.05, 0.04, 0xa3a7ab);
  // window
  W.torus(s + 'metal', offset(M, 0, 0.3, 0.035), 0.075, 0.016, 6, 18, COL.dark);
  W.disc(s + 'glass', offset(M, 0, 0.3, 0.032), 0.07, 18, 0xffffff);
  W.disc(s + 'paint', offset(M, 0, 0.3, 0.02), 0.07, 18, 0x101418);
  // central handle: gearbox hub + crank
  W.cyl(s + 'metal', sub(M, 0, -0.05, 0.06, 'x', Math.PI / 2), 0.09, 0.1, 0.05, 16, 0x8e9296);
  W.box(s + 'metal', offset(M, 0.12, -0.05, 0.095), 0.28, 0.035, 0.025, COL.dark);
  W.cyl(s + 'paint', sub(M, 0.25, -0.05, 0.13, 'x', Math.PI / 2), 0.018, 0.018, 0.07, 8, COL.black);
  // MPEV valve and latch handles
  W.cyl(s + 'metal', sub(M, -0.35, 0.3, 0.05, 'x', Math.PI / 2), 0.03, 0.03, 0.04, 10, COL.dark);
  W.torus(s + 'paint', offset(M, -0.35, 0.3, 0.075), 0.04, 0.006, 4, 12, COL.yellow);
  if (!K.lite) for (const sx of [-1, 1]) W.tube(s + 'metal', [pt(M, sx * 0.42, -0.35, 0.03), pt(M, sx * 0.42, -0.35, 0.09), pt(M, sx * 0.42, -0.12, 0.09), pt(M, sx * 0.42, -0.12, 0.03)], 0.012, 6, COL.alu);
}

/** Square vestibule (CBM passage) from M (start plane) along +Z for `len`, with bolt ring and jumpers. */
export function vestibuleCBM(K, M, len, opts = {}) {
  const W = K.W, s = K.set;
  const iw = CBM.w + 0.02;
  // inner walls: rounded square tube (faces inward)
  const pth = roundRect(iw + 0.16, iw + 0.16, CBM.r + 0.06, K.lite ? 2 : 4);
  const inner = roundRect(iw, iw, CBM.r, K.lite ? 2 : 4);
  // tube walls: frame2D with only the inner wall, depth = len
  W.frame2D(s + 'paint', offset(M, 0, 0, len / 2), pth, inner, len, 0xc9cbcb, null, { back: false, outerWall: false, innerWall: true });
  if (K.lite) return;
  // CBM ring: bolts + seal band at the middle
  const mid = offset(M, 0, 0, len * 0.5);
  W.frame2D(s + 'metal', mid, roundRect(iw + 0.02, iw + 0.02, CBM.r + 0.01, 4), roundRect(iw - 0.07, iw - 0.07, CBM.r - 0.03, 4), 0.06, 0x8f9397, null, { back: true, outerWall: false, innerWall: true });
  for (let k = 0; k < 16; k++) {
    const t = k / 16, per = 4 * (iw - 0.07);
    let d = t * per, x, y; const hw = (iw - 0.07) / 2;
    if (d < per / 4) { x = -hw + d; y = -hw; } else if (d < per / 2) { x = hw; y = -hw + d - per / 4; } else if (d < 3 * per / 4) { x = hw - (d - per / 2); y = hw; } else { x = -hw; y = hw - (d - 3 * per / 4); }
    const nx = Math.abs(x) >= hw - 1e-6 ? -Math.sign(x) : 0, ny = Math.abs(y) >= hw - 1e-6 ? -Math.sign(y) : 0;
    W.cyl(s + 'metal', sub(offset(mid, x + nx * 0.01, y + ny * 0.01, 0.0), 0, 0, 0, nx !== 0 ? 'z' : 'x', nx !== 0 ? Math.PI / 2 : 0), 0.018, 0.018, 0.04, 6, COL.dark);
  }
  // utility jumpers in two corners
  if (opts.jumpers !== false) {
    const c = iw / 2 - 0.09;
    for (const [sx, sy] of [[1, 1], [-1, -1]]) {
      cables(K, [pt(M, sx * c, sy * c, -0.05), pt(M, sx * c, sy * c, len + 0.05)], 3, 0.012);
      duct(K, [pt(M, sx * c, -sy * (c - 0.02), -0.05), pt(M, sx * (c - 0.03), -sy * (c - 0.05), len * 0.5), pt(M, sx * c, -sy * (c - 0.02), len + 0.05)], 0.035, 0xd8d6cc);
    }
  }
  if (opts.lamp) lightPanel(K, sub(M, 0, iw / 2, len / 2, 'x', Math.PI / 2), 0.3, 0.12);
}

/** Open CBM door attached at the opening's +X edge, swung `angle` (rad) into the module (toward +Z of M). */
export function openDoorCBM(K, M, angle = 1.75, side = 1) {
  const hinge = offset(M, side * (CBM.w / 2 + 0.02), 0, 0.1);
  const D = rot(hinge, 'y', side * angle);
  hatchDoorCBM(K, offset(D, -side * (CBM.w / 2 - 0.02), 0, 0.04));
  // hinge barrels
  for (const y of [-0.35, 0.35]) K.W.cyl(K.set + 'metal', offset(hinge, 0, y, 0), 0.025, 0.025, 0.14, 8, COL.dark);
  if (K.solids) K.solids.push(boxSolid(offset(D, -side * (CBM.w / 2), 0, 0.04), CBM.w / 2, CBM.w / 2, 0.06, 'hatchDoor'));
}

/** Round (Russian / IDSS) hatch frame on a bulkhead: torus rim, seal and latches. r = opening radius. */
export function hatchFrameRound(K, M, r = 0.42, label = null) {
  const W = K.W, s = K.set;
  const n = K.lite ? 16 : 40;
  W.frame2D(s + 'metal', offset(M, 0, 0, 0.04), circle(r + 0.13, n), circle(r, n), 0.08, 0x9b9f97);
  W.torus(s + 'paint', offset(M, 0, 0, 0.082), r + 0.025, 0.014, 4, 32, COL.seal);
  if (!K.lite) for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    W.box(s + 'metal', sub(M, Math.cos(a) * (r + 0.09), Math.sin(a) * (r + 0.09), 0.09, 'z', a), 0.05, 0.035, 0.025, COL.dark);
  }
  if (label) sign(K, offset(M, 0, r + 0.22, 0.0), label, 0.5, 0.07, { ph: 40, bg: '#efecdc', border: '#3a3d42' });
}

/** Round hatch door (closed at M): handwheel with spokes, window, latch levers. */
export function hatchDoorRound(K, M, r = 0.42) {
  const W = K.W, T = K.T, s = K.set;
  W.cyl(s + 'equip', sub(M, 0, 0, 0, 'x', Math.PI / 2), r - 0.01, r - 0.01, 0.07, 32, 0xffffff, 3, T.rect('hatchRu'));
  // the cap faces (+Z after the rotation is -Y of the cylinder): put a textured disc on the front
  W.disc(s + 'equip', offset(M, 0, 0, 0.036), r - 0.015, 32, 0xffffff, T.rect('hatchRu'));
  W.torus(s + 'metal', offset(M, 0, 0, 0.11), 0.17, 0.016, 6, 24, 0x6f7377);
  W.cyl(s + 'metal', sub(M, 0, 0, 0.075, 'x', Math.PI / 2), 0.05, 0.05, 0.07, 12, COL.dark);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; W.tube(s + 'metal', [pt(M, 0, 0, 0.11), pt(M, Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0.11)], 0.01, 5, 0x6f7377); }
  W.torus(s + 'metal', offset(M, 0, r * 0.62, 0.045), 0.055, 0.012, 5, 16, COL.dark);
  W.disc(s + 'glass', offset(M, 0, r * 0.62, 0.042), 0.05, 16);
  W.disc(s + 'paint', offset(M, 0, r * 0.62, 0.03), 0.05, 16, 0x101418);
}

/** Round tunnel (vestibule) along +Z of M. */
export function vestibuleRound(K, M, len, r = 0.45, opts = {}) {
  const W = K.W, s = K.set;
  W.cyl(s + 'paint', sub(M, 0, 0, len / 2, 'x', Math.PI / 2), r, r, len, K.lite ? 14 : 28, 0xc4c7bd, 0);
  // flip the tube inward: draw a second, inward-facing copy (faces toward the axis)
  inwardTube(K, M, len, r, opts.color ?? 0xc4c7bd);
  if (K.lite) return;
  W.torus(s + 'metal', offset(M, 0, 0, len * 0.5), r - 0.01, 0.025, 5, 28, 0x8f9397);
  for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; W.cyl(s + 'metal', sub(offset(M, Math.cos(a) * (r - 0.02), Math.sin(a) * (r - 0.02), len * 0.5), 0, 0, 0, 'z', a + Math.PI / 2), 0.014, 0.014, 0.05, 6, COL.dark); }
  if (opts.jumpers !== false) cables(K, [pt(M, r * 0.6, -r * 0.6, -0.05), pt(M, r * 0.6, -r * 0.6, len + 0.05)], 3, 0.01);
}

/** Inward-facing cylinder wall along +Z of M (radius r, length len). */
export function inwardTube(K, M, len, r, color, seg = 28, uv = null, mat = 'paint') {
  const W = K.W, b = W.bucket(K.set + mat);
  const n = W.seg(seg, 8), base = b.count, col = color;
  const c = typeof col === 'number' ? null : col;
  const Mz = M;
  const e = Mz.elements;
  void e; void c;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, x = Math.cos(a) * r, y = Math.sin(a) * r;
    const u = uv ? uv.u0 + (uv.u1 - uv.u0) * (i / n) : 0;
    W._vert(b, Mz, x, y, 0, -Math.cos(a), -Math.sin(a), 0, u, uv ? uv.v0 : 0, linCol(color));
    W._vert(b, Mz, x, y, len, -Math.cos(a), -Math.sin(a), 0, u, uv ? uv.v1 : 0, linCol(color));
  }
  for (let i = 0; i < n; i++) { const k = base + i * 2; b.i.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  W.tris += n * 2;
}
/**
 * Pressure-shell liner behind a compartment's walls: inward-facing cylinder along +Z of M (radius r, length len)
 * in ~0.25 m quads, leaving out the quads in front of `holes` ([{ p, d, r }] in M-local coordinates: hole axis
 * through p along unit d, radius r — window wells, radial hatch vestibules). Anything seen through a seam or a
 * gap between panels / racks shows this dark shell instead of open space.
 */
export function shellTube(K, M, len, r, holes = [], color = 0x34373a, mat = 'paint') {
  const W = K.W, b = W.bucket(K.set + mat);
  const nA = W.seg(56, 16), nL = Math.max(1, Math.ceil(len / 0.25)), col = linCol(color);
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  let quads = 0;
  for (let i = 0; i < nA; i++) {
    const a0 = (i / nA) * Math.PI * 2, a1 = ((i + 1) / nA) * Math.PI * 2, am = (a0 + a1) / 2;
    for (let j = 0; j < nL; j++) {
      const z0 = (j / nL) * len, z1 = ((j + 1) / nL) * len;
      c.set(Math.cos(am) * r, Math.sin(am) * r, (z0 + z1) / 2);
      let skip = false;
      for (const h of holes) {
        v.subVectors(c, h.p);
        const t = v.dot(h.d);
        if (t > -0.3 && v.addScaledVector(h.d, -t).length() < h.r) { skip = true; break; }
      }
      if (skip) continue;
      const base = b.count;
      for (const [a, z] of [[a0, z0], [a0, z1], [a1, z0], [a1, z1]]) W._vert(b, M, Math.cos(a) * r, Math.sin(a) * r, z, -Math.cos(a), -Math.sin(a), 0, 0, 0, col);
      b.i.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      quads++;
    }
  }
  W.tris += quads * 2;
}

const _lc = new THREE.Color();
function linCol(c) { if (typeof c !== 'number') return c; _lc.set(c); return [_lc.r, _lc.g, _lc.b]; }

// ------------------------------------------------------------------------------------------------ crew / special equipment

/** Extravehicular spacesuit (EMU-like) standing on a mount, facing +Z of M (M at the waist). */
export function spacesuit(K, M, flag = 'ru') {
  const W = K.W, s = K.set, T = K.T;
  const white = 0xf0eee6;
  // hard upper torso + backpack
  W.chamferBox(s + 'equip', offset(M, 0, 0.32, 0), 0.5, 0.48, 0.34, 0.1, 0xffffff, T.rect('fabric'));
  W.chamferBox(s + 'paint', offset(M, 0, 0.36, -0.29), 0.48, 0.62, 0.22, 0.05, 0xe6e4dc);
  // helmet + gold visor
  W.sphere(s + 'paint', offset(M, 0, 0.72, 0.03), 0.17, 16, 10, white);
  W.sphere(s + 'metal', sub(M, 0, 0.72, 0.075, 'x', Math.PI / 2), 0.15, 14, 6, 0xd4a640, 0.15, 0.15, Math.PI * 0.42);
  W.torus(s + 'metal', sub(M, 0, 0.56, 0.0, 'x', Math.PI / 2), 0.15, 0.025, 6, 20, 0xb0b3b6);
  // display & control module on the chest
  W.box(s + 'paint', offset(M, 0, 0.22, 0.2), 0.26, 0.11, 0.08, 0x8d9196);
  W.box(s + 'equip', offset(M, -0.05, 0.23, 0.242), 0.09, 0.05, 0.004, 0xffffff, T.rect('scrText'), null, 16);
  // arms
  for (const sx of [-1, 1]) {
    const sh = pt(M, sx * 0.3, 0.46, 0), el = pt(M, sx * 0.38, 0.12, 0.05), wr = pt(M, sx * 0.33, -0.15, 0.12);
    W.tube(s + 'paint', [sh, el], 0.075, 10, white, true);
    W.tube(s + 'paint', [el, wr], 0.065, 10, white, true);
    W.torus(s + 'metal', basisAt(wr, el), 0.058, 0.012, 4, 14, COL.alu);
    W.sphere(s + 'paint', new THREE.Matrix4().setPosition(wr.clone().add(dir(M, 0, -0.06, 0.03))), 0.06, 10, 8, 0x2b2c2e, 0.055, 0.08);
    // red/blue identification stripes on the legs (Russian Orlan-like markings: blue stripes)
    if (!K.lite) W.torus(s + 'paint', basisAt(el.clone().lerp(sh, 0.4), el), 0.077, 0.01, 4, 14, flag === 'ru' ? COL.blue : COL.red);
  }
  // lower torso + legs
  W.chamferBox(s + 'equip', offset(M, 0, -0.05, 0), 0.4, 0.26, 0.3, 0.08, 0xffffff, T.rect('fabric'));
  for (const sx of [-1, 1]) {
    const hip = pt(M, sx * 0.12, -0.16, 0), knee = pt(M, sx * 0.13, -0.58, 0.05), ank = pt(M, sx * 0.13, -0.98, 0.0);
    W.tube(s + 'paint', [hip, knee], 0.085, 10, white, true);
    W.tube(s + 'paint', [knee, ank], 0.075, 10, white, true);
    W.chamferBox(s + 'paint', offset(M, sx * 0.13, -1.04, 0.06), 0.13, 0.1, 0.26, 0.03, 0xd8d6cc);
    if (!K.lite) W.torus(s + 'paint', basisAt(hip.clone().lerp(knee, 0.5), knee), 0.088, 0.012, 4, 14, flag === 'ru' ? COL.blue : COL.red);
  }
  // flag patch on the shoulder
  if (!K.lite) W.box(s + 'equip', offset(M, -0.25, 0.42, 0.13), 0.09, 0.06, 0.004, 0xffffff, T.rect('flagRu'), null, 16);
  // mount: vertical post from the backpack to the wall
  W.box(s + 'metal', offset(M, 0, 0.3, -0.5), 0.12, 0.5, 0.2, COL.dark);
}
function basisAt(p, towards) {
  const Z = towards.clone().sub(p).normalize();
  const X = new THREE.Vector3(1, 0, 0); if (Math.abs(Z.x) > 0.9) X.set(0, 1, 0);
  X.addScaledVector(Z, -X.dot(Z)).normalize();
  const Y = new THREE.Vector3().crossVectors(Z, X);
  return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(p);
}

/** Sleeping bag hanging on a wall (face frame M). */
export function sleepingBag(K, M, color = 'fabricBlue') {
  const W = K.W, T = K.T, s = K.set;
  W.chamferBox(s + 'equip', offset(M, 0, 0, 0.08), 0.62, 1.7, 0.16, 0.07, 0xffffff, T.rect(color));
  W.chamferBox(s + 'equip', offset(M, 0, 0.68, 0.12), 0.4, 0.25, 0.12, 0.05, 0xffffff, T.rect('fabric'));
  if (K.lite) return;
  for (const y of [-0.4, 0.2]) W.box(s + 'paint', offset(M, 0, y, 0.165), 0.66, 0.04, 0.01, COL.black);
  W.tube(s + 'paint', [pt(M, 0.25, 0.75, 0.17), pt(M, 0.25, -0.75, 0.17)], 0.006, 4, 0x777777);
}

/** Generic plant: kind lettuce | wheat | tomato | pepper | flower, rooted at M (grows along +Y). */
export function plant(K, M, kind = 'lettuce', size = 1) {
  const W = K.W, r = K.rnd, s = K.set;
  const green = [0.18, 0.45, 0.12];
  const leaf = (base, tipDir, len, wid, col) => {
    // a curved leaf: two triangles strips along the midrib
    const mid = base.clone().addScaledVector(tipDir, len * 0.5);
    const side = new THREE.Vector3().crossVectors(tipDir, dir(M, 0, 1, 0));
    if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
    side.normalize().multiplyScalar(wid);
    const droop = dir(M, 0, -1, 0).multiplyScalar(len * 0.15);
    const tip = base.clone().addScaledVector(tipDir, len).add(droop);
    const b = W.bucket(s + 'plant');
    const n = new THREE.Vector3().crossVectors(side, tipDir).normalize();
    const c = [col[0] * (0.8 + r() * 0.4), col[1] * (0.8 + r() * 0.4), col[2] * (0.8 + r() * 0.4)];
    const I = new THREE.Matrix4();
    const k = b.count;
    for (const p of [base, mid.clone().add(side), tip, mid.clone().sub(side)]) W._vert(b, I, p.x, p.y, p.z, n.x, n.y, n.z, 0, 0, c);
    b.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
    W.tris += 2;
  };
  const up = dir(M, 0, 1, 0), o = pt(M, 0, 0, 0);
  if (kind === 'lettuce') {
    const n = K.lite ? 5 : 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r(), el = 0.5 + r() * 0.7;
      const d = dir(M, Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
      leaf(o.clone().addScaledVector(up, 0.01), d, (0.09 + r() * 0.06) * size, (0.04 + r() * 0.02) * size, [0.35, 0.62, 0.18]);
    }
  } else if (kind === 'wheat') {
    const n = K.lite ? 5 : 14;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, tilt = r() * 0.25;
      const d = dir(M, Math.cos(a) * tilt, 1, Math.sin(a) * tilt).normalize();
      const p0 = o.clone().add(dir(M, (r() - 0.5) * 0.06, 0, (r() - 0.5) * 0.06));
      leaf(p0, d, (0.22 + r() * 0.12) * size, 0.006 * size, [0.4, 0.62, 0.2]);
      if (!K.lite && r() < 0.6) W.sphere(s + 'plant', new THREE.Matrix4().setPosition(p0.clone().addScaledVector(d, (0.3 + r() * 0.05) * size)), 0.008, 5, 4, [0.75, 0.68, 0.32], 0.008, 0.025);
    }
  } else if (kind === 'tomato' || kind === 'pepper') {
    const stems = K.lite ? 2 : 4;
    for (let j = 0; j < stems; j++) {
      const a = (j / stems) * Math.PI * 2 + r();
      const top = o.clone().add(dir(M, Math.cos(a) * 0.05, (0.2 + r() * 0.12) * size, Math.sin(a) * 0.05));
      W.tube(s + 'plant', [o, o.clone().lerp(top, 0.5).add(dir(M, Math.cos(a) * 0.02, 0, 0)), top], 0.004, 4, green);
      for (let i = 0; i < 4; i++) {
        const p = o.clone().lerp(top, 0.3 + i * 0.2), b2 = a + i * 2.1;
        leaf(p, dir(M, Math.cos(b2), 0.3, Math.sin(b2)).normalize(), 0.06 * size, 0.025 * size, [0.22, 0.5, 0.15]);
      }
      if (r() < 0.8) W.sphere(s + 'plant', new THREE.Matrix4().setPosition(top.clone().add(dir(M, 0.02, -0.06, 0.02))), kind === 'tomato' ? 0.022 : 0.018, 8, 6, kind === 'tomato' ? [0.75, 0.08, 0.04] : [0.95, 0.55, 0.05], kind === 'tomato' ? 0.022 : 0.016, kind === 'tomato' ? 0.022 : 0.03);
    }
  } else if (kind === 'flower') {
    const stems = K.lite ? 2 : 3;
    for (let j = 0; j < stems; j++) {
      const a = (j / stems) * Math.PI * 2 + r();
      const top = o.clone().add(dir(M, Math.cos(a) * 0.04, (0.16 + r() * 0.08) * size, Math.sin(a) * 0.04));
      W.tube(s + 'plant', [o, top], 0.003, 4, green);
      leaf(o.clone().lerp(top, 0.3), dir(M, Math.cos(a), 0.2, Math.sin(a)).normalize(), 0.05 * size, 0.02 * size, [0.25, 0.5, 0.15]);
      const petals = K.lite ? 4 : 8;
      for (let i = 0; i < petals; i++) { const b2 = (i / petals) * Math.PI * 2; leaf(top, dir(M, Math.cos(b2), 0.15, Math.sin(b2)).normalize(), 0.03 * size, 0.012 * size, [0.95, 0.42, 0.08]); }
      W.sphere(s + 'plant', new THREE.Matrix4().setPosition(top), 0.01, 6, 4, [0.4, 0.25, 0.05]);
    }
  }
}

/** Plant growth chamber (Veggie / APH-like): box with LED bank, front window, plants on a root tray. */
export function growthChamber(K, M, w = 0.9, h = 0.55, d = 0.5, kind = 'lettuce', pink = true) {
  const W = K.W, s = K.set;
  // body (open front): back, sides, top with the LED bank, root tray
  W.box(s + 'paint', offset(M, 0, 0, -d / 2), w, h, 0.02, 0xe6e6e2);
  for (const sx of [-1, 1]) W.box(s + 'paint', offset(M, sx * w / 2, 0, 0), 0.02, h, d, 0xe6e6e2);
  W.box(s + 'paint', offset(M, 0, h / 2, 0), w, 0.05, d, 0xdcdcd8);
  W.box(s + 'paint', offset(M, 0, -h / 2 + 0.03, 0), w - 0.02, 0.06, d - 0.02, 0x3a3c40);
  // LEDs: alternate pink (red+blue) and white rows
  const n = K.lite ? 2 : 5;
  for (let i = 0; i < n; i++) {
    const z = -d / 2 + (i + 0.5) * d / n;
    W.box('glow', offset(M, 0, h / 2 - 0.028, z), w - 0.08, 0.004, d / n * 0.5, pink && i % 2 === 0 ? [3.2, 0.9, 2.2] : [2.6, 2.6, 2.4], null, null, 8);
  }
  // plants in a row (pillows)
  const np = Math.max(2, Math.round(w / 0.16));
  for (let i = 0; i < np; i++) {
    const x = -w / 2 + (i + 0.5) * w / np;
    for (const z of [-d * 0.18, d * 0.18]) {
      W.chamferBox(s + 'equip', offset(M, x, -h / 2 + 0.075, z), 0.09, 0.03, 0.09, 0.012, 0xffffff, K.T.rect('fabric'));
      plant(K, offset(M, x, -h / 2 + 0.09, z), kind, kind === 'wheat' ? 1.0 : 0.85);
    }
  }
  // transparent front door
  W.box(s + 'glass', offset(M, 0, 0, d / 2), w - 0.02, h - 0.02, 0.008, 0xffffff);
  W.box(s + 'metal', offset(M, 0, -h / 2 + 0.01, d / 2), w, 0.02, 0.02, COL.alu);
  W.box(s + 'metal', offset(M, 0, h / 2 - 0.01, d / 2), w, 0.02, 0.02, COL.alu);
}

/** T2-style treadmill on a wall: frame, running belt, side rails, harness bungees, display. */
export function treadmill(K, M, len = 1.9) {
  const W = K.W, s = K.set, T = K.T;
  W.box(s + 'paint', offset(M, 0, 0, 0.08), len, 0.62, 0.16, 0xc8cacb);
  W.box(s + 'paint', offset(M, 0, 0, 0.161), len - 0.25, 0.48, 0.004, 0x1d1e20);
  for (const x of [-len / 2 + 0.06, len / 2 - 0.06]) W.cyl(s + 'metal', sub(M, x, 0, 0.15, 'x', 0), 0.05, 0.05, 0.5, 12, COL.alu);
  for (const sy of [-1, 1]) W.box(s + 'metal', offset(M, 0, sy * 0.33, 0.25), len * 0.7, 0.03, 0.03, COL.dark);
  for (const sy of [-1, 1]) for (const x of [-len * 0.3, len * 0.3]) W.box(s + 'metal', offset(M, x, sy * 0.33, 0.2), 0.03, 0.03, 0.1, COL.dark);
  // harness: two bungee cords up from the deck plus the vest strap set floating above
  const top = 1.0;
  for (const sy of [-1, 1]) bungee(K, pt(M, -0.05, sy * 0.3, 0.16), pt(M, -0.02, sy * 0.18, top), null, 0x2f5f9e);
  W.chamferBox(s + 'equip', offset(M, 0, 0, top + 0.05), 0.4, 0.3, 0.12, 0.04, 0xffffff, T.rect('fabricBlue'));
  display(K, sub(M, len / 2 - 0.05, 0, 0.6, 'y', -Math.PI / 2), 0.3, 0.2, 'scrGraph');
  W.box(s + 'metal', offset(M, len / 2 - 0.05, 0, 0.35), 0.04, 0.04, 0.5, COL.dark);
  sign(K, sub(M, -len / 2 + 0.25, -0.24, 0.17), 'T2 · БЕГОВАЯ ДОРОЖКА', 0.42, 0.05, { ph: 32 });
}

/** Cycle ergometer (CEVIS-like): no seat, pedals with clip-in shoes, handle bar, display. */
export function ergometer(K, M) {
  const W = K.W, s = K.s;
  void s;
  const S = K.set;
  W.chamferBox(S + 'paint', offset(M, 0, 0, 0.12), 0.6, 0.4, 0.24, 0.05, 0xd0d2d3);
  W.cyl(S + 'metal', sub(M, 0, 0, 0.28, 'x', 0), 0.03, 0.03, 0.46, 10, COL.dark);
  for (const sy of [-1, 1]) {
    W.box(S + 'metal', offset(M, 0.1 * sy, sy * 0.23, 0.3), 0.26, 0.03, 0.02, COL.dark);
    W.box(S + 'paint', offset(M, 0.22 * sy, sy * 0.26, 0.33), 0.12, 0.05, 0.08, COL.black);
  }
  W.tube(S + 'metal', [pt(M, -0.25, 0, 0.24), pt(M, -0.4, 0, 0.75), pt(M, -0.35, 0, 0.9)], 0.02, 8, COL.dark);
  W.tube(S + 'metal', [pt(M, -0.35, -0.25, 0.9), pt(M, -0.35, 0.25, 0.9)], 0.015, 8, COL.black);
  display(K, sub(M, -0.36, 0, 0.98, 'y', Math.PI / 2), 0.2, 0.14, 'scrGraph');
  sign(K, offset(M, 0.15, 0, 0.241), 'ВЕЛОЭРГОМЕТР · CEVIS', 0.42, 0.05, { ph: 32 });
}

/** Advanced resistive exercise device (ARED-like): platform, two vacuum cylinders, lift bar. */
export function resistive(K, M) {
  const W = K.W, S = K.set;
  W.box(S + 'paint', offset(M, 0, 0, 0.06), 1.3, 0.75, 0.12, 0xcfd1d2);
  for (const sx of [-1, 1]) {
    W.cyl(S + 'metal', offset(M, sx * 0.55, 0.25, 0.45), 0.11, 0.11, 0.0001, 4, COL.alu, 0);
    W.cyl(S + 'metal', sub(M, sx * 0.55, 0.25, 0.4, 'x', Math.PI / 2), 0.11, 0.11, 0.55, 16, COL.alu, 3);
    W.cyl(S + 'metal', sub(M, sx * 0.55, -0.25, 0.4, 'x', Math.PI / 2), 0.04, 0.04, 0.55, 10, COL.dark, 3);
  }
  // arm and bar
  W.box(S + 'metal', offset(M, 0, -0.2, 0.75), 0.08, 0.08, 0.06, COL.dark);
  W.tube(S + 'metal', [pt(M, -0.45, -0.25, 0.85), pt(M, 0.45, -0.25, 0.85)], 0.022, 10, COL.metal);
  W.box(S + 'paint', offset(M, 0, -0.1, 0.13), 0.5, 0.3, 0.012, COL.black);
  sign(K, offset(M, 0, 0.32, 0.121), 'ARED · СИЛОВОЙ ТРЕНАЖЁР', 0.5, 0.06, { ph: 32 });
}

/** Toilet compartment (WHC-like): fabric-walled cabinet with the toilet unit inside, door partly open. */
export function toilet(K, M) {
  const W = K.W, S = K.set, T = K.T;
  // unit (on the back wall of a rack bay)
  W.chamferBox(S + 'paint', offset(M, 0, -0.25, 0.18), 0.5, 0.5, 0.36, 0.06, 0xd8dbdc);
  W.lathe(S + 'paint', sub(M, 0, 0.05, 0.25, 'x', Math.PI / 2), [[0.0, -0.05], [0.1, -0.04], [0.12, 0.0], [0.1, 0.02]], 16, 0xeeeeea);
  W.cyl(S + 'paint', sub(M, -0.18, 0.12, 0.35, 'z', 0.4), 0.025, 0.035, 0.32, 10, 0xe8b830);
  W.tube(S + 'paint', [pt(M, -0.2, -0.05, 0.3), pt(M, -0.28, 0.0, 0.45), pt(M, -0.24, 0.1, 0.5)], 0.016, 6, 0xd9d9d0);
  // footrests and thigh bars
  for (const sx of [-1, 1]) W.tube(S + 'metal', [pt(M, sx * 0.22, 0.28, 0.08), pt(M, sx * 0.22, 0.28, 0.5)], 0.015, 6, COL.metal);
  W.tube(S + 'metal', [pt(M, -0.22, 0.28, 0.5), pt(M, 0.22, 0.28, 0.5)], 0.015, 6, COL.metal);
  W.box(S + 'equip', offset(M, 0.0, 0.62, 0.02), 0.6, 0.3, 0.03, 0xffffff, T.rect('checklist'));
  sign(K, offset(M, 0, 0.82, 0.04), 'АСУ · WHC', 0.3, 0.05, { ph: 32 });
}

/** Medical restraint table (CMRS-like) mounted on the deck with straps. */
export function restraintTable(K, M) {
  const W = K.W, S = K.set, T = K.T;
  W.chamferBox(S + 'paint', offset(M, 0, 0, 0.24), 0.6, 1.9, 0.06, 0.02, 0x2d4f7a);
  W.chamferBox(S + 'equip', offset(M, 0, 0.8, 0.29), 0.36, 0.22, 0.06, 0.025, 0xffffff, T.rect('fabric'));
  for (const y of [-0.6, -0.1, 0.4]) {
    W.box(S + 'paint', offset(M, 0, y, 0.275), 0.64, 0.06, 0.01, COL.black);
    W.box(S + 'metal', offset(M, 0.33, y, 0.27), 0.03, 0.05, 0.03, COL.alu);
  }
  for (const y of [-0.7, 0.7]) W.box(S + 'metal', offset(M, 0, y, 0.11), 0.08, 0.08, 0.22, COL.dark);
}

/** Defibrillator (AED) in a bracket. */
export function defibrillator(K, M) {
  const W = K.W, S = K.set;
  W.chamferBox(S + 'paint', offset(M, 0, 0, 0.06), 0.28, 0.3, 0.1, 0.02, 0x2fa04a);
  W.box(S + 'paint', offset(M, 0, 0.02, 0.112), 0.2, 0.14, 0.004, 0xf2f2ee);
  W.box('glow', offset(M, 0.07, -0.1, 0.112), 0.03, 0.03, 0.002, [0.2, 3.0, 0.4], null, null, 16);
  W.cyl(S + 'paint', sub(M, -0.04, -0.1, 0.113, 'x', Math.PI / 2), 0.022, 0.022, 0.006, 12, 0xd8a020, 3);
  sign(K, offset(M, 0, 0.22, 0.01), 'ДЕФИБРИЛЛЯТОР · AED', 0.36, 0.05, { bg: '#2fa04a', fg: '#fff', ph: 32 });
}

/** Ultrasound unit: laptop-like case with a probe on a coiled cable. */
export function ultrasound(K, M) {
  const W = K.W, S = K.set;
  laptop(K, M, 'scrMed', 0.25);
  const p0 = pt(M, 0.18, -0.1, 0.25), p1 = pt(M, 0.3, -0.25, 0.3);
  W.tube(S + 'paint', curve([p0, p0.clone().lerp(p1, 0.5).add(dir(M, 0, -0.05, 0.05)), p1], 8), 0.006, 4, COL.black);
  W.cyl(S + 'paint', basisAt(p1, p0), 0.02, 0.03, 0.12, 10, 0xe0e0dc);
}

/** Microscope (LMM-like) on a small bench: base, column, objective turret, eyepieces. */
export function microscope(K, M) {
  const W = K.W, S = K.set;
  W.chamferBox(S + 'paint', offset(M, 0, 0, 0.04), 0.4, 0.3, 0.08, 0.02, 0xe2e3e1);
  W.box(S + 'paint', offset(M, -0.12, 0, 0.25), 0.08, 0.12, 0.42, 0xe2e3e1);
  W.box(S + 'paint', offset(M, 0, 0, 0.18), 0.22, 0.2, 0.025, COL.dark);
  W.cyl(S + 'metal', sub(M, 0, 0, 0.3, 'x', Math.PI / 2), 0.05, 0.04, 0.08, 12, COL.dark);
  for (let k = 0; k < 3; k++) W.cyl(S + 'metal', sub(M, Math.cos(k * 2.1) * 0.03, Math.sin(k * 2.1) * 0.03, 0.24, 'x', Math.PI / 2), 0.012, 0.01, 0.06, 8, COL.alu);
  for (const sy of [-1, 1]) W.cyl(S + 'paint', sub(M, -0.08, sy * 0.035, 0.46, 'y', -0.5), 0.016, 0.016, 0.12, 8, COL.black);
  display(K, sub(M, 0.28, 0.0, 0.35, 'y', -0.5), 0.28, 0.18, 'scrMicro');
}
