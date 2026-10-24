import * as THREE from 'three';
import { basis, offset, sub, rot, circle, radialPair, roundRectRadius, MeshWriter, lin } from './Mesh.js';
import { ZoneBuilder, ff, sstep } from './Zone.js';
import {
  COL, pt, dir, handrail, sign, lightPanel, vent, cables, duct, curve, bag, clutter, laptop, display, extinguisher, pba,
  camera, egressSign, rack, boxSolid, hatchFrameRound, hatchDoorRound, inwardTube, plant, treadmill, ergometer, velcro,
} from './Kit.js';

/**
 * Gravity-ring interiors (ring-local coordinates of ring.group: x along the spin axis, polar angle phi from +Y
 * toward +Z, rho = distance from the axis; "down" = +rho, about 0.37 g on the deck at rho = 42 m).
 *
 *   ringHub      the hub drum (station frame, zero-g): static end sections + the rotating collar section
 *                (built into the ring group) with the six spoke hatches; the spine tunnel arrives at +X.
 *   spoke{k}     vertical shafts (rho 4.5 .. 35.6) with a ladder on the anti-spinward side.
 *   pod{k}       sector halls (drum around the rim at the spoke): ring control post / gym / wardroom.
 *   cor{k}       curved corridor from pod k to pod k+1: cabins on both sides, a common area with windows.
 * Sector geometry is built once per variant (k mod 3) at phi = 0 and shared by the sectors (rotated meshes).
 */

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const R = 40, TUBE = 3.3, FLOOR = 42.0, CEIL = FLOOR - 2.45, X0 = -42;   // corridor ceiling 2.45 m above the deck
const POD_R = 4.45, POD_HX = 3.9;
const PHI_A = 4.05 / FLOOR;            // corridor starts at the pod doorway
const SECT = Math.PI / 3;
const P = (x, rho, phi) => V(x, rho * Math.cos(phi), rho * Math.sin(phi));
const radial = (phi) => V(0, Math.cos(phi), Math.sin(phi));
const tangent = (phi) => V(0, -Math.sin(phi), Math.cos(phi));
const X = V(1, 0, 0);

/** Frame on the deck at (x, phi): X = +x, Y = spinward tangent, Z = up (-radial). Floor objects sit on it. */
function deckFrame(x, phi, rho = FLOOR) { return new THREE.Matrix4().makeBasis(X, tangent(phi), radial(phi).negate()).setPosition(P(x, rho, phi)); }
/** Upright frame (for walls / standing objects): X = right, Y = up (-radial), Z = facing direction. */
function uprightFrame(o, facing, up) {
  const z = facing.clone().normalize(), y = up.clone().addScaledVector(z, -up.dot(z)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(o);
}

/** Parametric surface grid: fn(u, v) -> point, n(u, v) -> intended normal. Each cell maps the full uv rect (tiles). */
function surf(W, mat, fn, nfn, u0, u1, nu, v0, v1, nv, color, uv = null, tile = true) {
  const b = W.bucket(mat), col = typeof color === 'number' ? lin(color) : color, I = IDENT;
  const f = uv || { u0: 0, v0: 0, u1: 0, v1: 0 };
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const ua = u0 + (u1 - u0) * i / nu, ub = u0 + (u1 - u0) * (i + 1) / nu, va = v0 + (v1 - v0) * j / nv, vb = v0 + (v1 - v0) * (j + 1) / nv;
    const p = [fn(ua, va), fn(ub, va), fn(ub, vb), fn(ua, vb)];
    const nn = nfn((ua + ub) / 2, (va + vb) / 2);
    const e1 = _e1.subVectors(p[1], p[0]), e2 = _e2.subVectors(p[3], p[0]);
    const flip = _e3.crossVectors(e1, e2).dot(nn) < 0;
    const uvs = tile ? [[f.u0, f.v0], [f.u1, f.v0], [f.u1, f.v1], [f.u0, f.v1]]
      : [[lerp(f.u0, f.u1, i / nu), lerp(f.v0, f.v1, j / nv)], [lerp(f.u0, f.u1, (i + 1) / nu), lerp(f.v0, f.v1, j / nv)], [lerp(f.u0, f.u1, (i + 1) / nu), lerp(f.v0, f.v1, (j + 1) / nv)], [lerp(f.u0, f.u1, i / nu), lerp(f.v0, f.v1, (j + 1) / nv)]];
    const k = b.count;
    const order = flip ? [0, 3, 2, 1] : [0, 1, 2, 3];
    for (const o of order) { const q = p[o], n = nfn(o === 0 || o === 3 ? ua : ub, o < 2 ? va : vb); W._vert(b, I, q.x, q.y, q.z, n.x, n.y, n.z, uvs[o][0], uvs[o][1], col); }
    b.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
    W.tris += 2;
  }
}
const IDENT = new THREE.Matrix4();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _e3 = new THREE.Vector3();
const lerp = (a, b, t) => a + (b - a) * t;

/** Ring bake: AO near the floor/walls, ceiling light rows, darker under-floor / vault. */
function ringBake(lite, kind) {
  return (x, y, z, nx, ny, nz, name) => {
    if (name === 'glow') return 1;
    const rho = Math.hypot(y, z), hgt = FLOOR - rho;            // height above the deck
    const nUp = -(ny * y + nz * z) / Math.max(rho, 1e-6);       // normal . up
    let ao = 1 - 0.35 * sstep(0.4, 0.0, hgt) * (nUp > 0.5 ? 0.4 : 1);
    const side = Math.abs(x);
    ao *= 1 - 0.25 * sstep(kind === 'pod' ? 3.2 : 2.3, kind === 'pod' ? 3.9 : 3.1, side);
    let L = 0;
    if (kind === 'pod') {
      L = 0.7 + 0.3 * sstep(0, 3, hgt);
    } else {
      const dh = Math.max(0.2, (FLOOR - CEIL) - hgt), d2 = dh * dh + x * x;
      L = Math.max(0, nUp * 0.6 + 0.4) * 2.2 / (d2 + 1.2);
    }
    L = Math.min(1.3, L);
    return lite ? ao * (0.35 + 0.8 * L) : ao * (0.65 + 0.35 * L);
  };
}

// ================================================================================================ hub

function buildHub(I) {
  const M = new THREE.Matrix4().makeTranslation(X0, 0, 0);    // static part: station frame, origin at the ring centre
  const Z = new ZoneBuilder(I, 'ringHub', 'Ступица кольца · переход к спицам', M, { lite: I.lite, detail: I.detail, seed: 301 });
  const K = Z.K, W = Z.W, T = I.atlas;
  const r = 4.5, xa = -5.0, xb = 5.1, xc0 = -2.1, xc1 = 2.1;
  // static sections: faceted 16-gon panels
  const nSide = 16, ap = r * Math.cos(Math.PI / nSide), side = 2 * r * Math.sin(Math.PI / nSide);
  const panelRing = (W2, xs, xe, rows, tex) => {
    for (let k = 0; k < nSide; k++) {
      const a = (k / nSide) * Math.PI * 2;
      for (let j = 0; j < rows; j++) {
        const c = V(xs + (j + 0.5) * (xe - xs) / rows, Math.cos(a) * ap, Math.sin(a) * ap);
        W2.box('equip', offset(ff(c, V(0, -Math.cos(a), -Math.sin(a)), X), 0, 0, -0.01), (xe - xs) / rows - 0.01, side + 0.01, 0.02, 0xffffff, T.rect(tex), T.rect('grey'), 16);
      }
    }
  };
  panelRing(W, xa, xc0 - 0.12, 3, 'panel');
  panelRing(W, xc1 + 0.12, xb, 3, 'panelB');
  // end walls
  for (const s of [-1, 1]) {
    const F = s < 0 ? ff(V(xa, 0, 0), X, V(0, 0, -1)) : ff(V(xb, 0, 0), V(-1, 0, 0), V(0, 0, 1));
    if (s < 0) {
      W.poly('equip', F, circle(r + 0.02, 48), 0xffffff, T.rect('panel'));
      rack(K, offset(F, -1.2, 0.2, 0), 'power', 1.0, 1.4);
      W.box('equip', offset(F, 0.6, 0.6, 0.03), 1.4, 0.8, 0.06, 0xffffff, T.rect('rackExpB'), T.rect('grey'));
      display(K, offset(F, 0.6, 0.6, 0.065), 0.8, 0.5, 'scrRing');
      sign(K, offset(F, 0.6, 1.2, 0.0), 'УПРАВЛЕНИЕ ВРАЩЕНИЕМ · SPIN CONTROL', 1.3, 0.1, { ph: 40, border: '#2a2d32' });
      if (!I.lite) { for (let k = 0; k < 6; k++) W.box('paint', offset(F, 0.2 + k * 0.16, 0.05, 0.08), 0.08, 0.08, 0.04, k === 0 ? COL.red : COL.dark); extinguisher(K, offset(F, -2.6, -0.5, 0)); pba(K, offset(F, 2.6, -0.5, 0)); }
      lightPanel(K, offset(F, 0, 2.9, 0), 1.0, 0.25);
    } else {
      // +X end: the spine tunnel arrives at y = -1.0 (round hatch, local frame z = world +z, y = world y)
      const hy = -1.0, hr = 0.5;
      const [o, i] = radialPair(() => r + 0.02, () => 0.01, 48);
      void o; void i;
      // wall with an off-centre round opening: build as a ring around the hole + filler polygon
      const hole = (a) => { const c = Math.cos(a), sn = Math.sin(a); const B = -2 * (sn * hy) * -1; void B; return hr; };
      void hole;
      const n = I.lite ? 32 : 72;
      const outer = [], inner = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        // ray from the hole centre (0, hy) to the circle of radius r: |(t c, hy + t sn)| = r
        const bq = 2 * hy * sn, cq = hy * hy - r * r, t = (-bq + Math.sqrt(bq * bq - 4 * cq)) / 2;
        outer.push([t * c, hy + t * sn]); inner.push([hr * c, hy + hr * sn]);
      }
      W.frame2D('equip', F, outer, inner, 0.03, 0xffffff, T.rect('panelB'), { back: false, outerWall: false, innerWall: false });
      hatchFrameRound(K, offset(F, 0, hy, 0), hr - 0.02, 'ТОННЕЛЬ ФЕРМЫ · TO NODE 2');
      const hinge = offset(F, hr + 0.06, hy, 0.12);
      hatchDoorRound(K, offset(rot(hinge, 'y', 1.9), -hr - 0.06, 0, 0), hr - 0.03);
      if (!I.lite) { sign(K, offset(F, 0, 1.4, 0), 'СТУПИЦА КОЛЬЦА · RING HUB', 1.2, 0.12, { ph: 48, border: '#2a2d32' }); display(K, offset(F, -1.9, 0.6, 0.02), 0.7, 0.44, 'scrGraph'); rack(K, offset(F, 2.0, 0.6, 0), 'locker', 1.0, 1.4); }
      lightPanel(K, offset(F, 0, 3.0, 0), 1.0, 0.25);
      Z.cyl(V(xb - 1.0, hy, 0), V(xb + 1.0, hy, 0), hr - 0.05).passage = true;
      Z.portal('spine', V(xb + 0.05, hy, 0), 0.6);
    }
  }
  // lights and handrails on the static sections
  for (const xs of [(xa + xc0) / 2, (xc1 + xb) / 2]) {
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      lightPanel(K, ff(V(xs, Math.cos(a) * (ap - 0.02), Math.sin(a) * (ap - 0.02)), V(0, -Math.cos(a), -Math.sin(a)), X), 0.9, 0.22);
      const b = a + Math.PI / 4;
      handrail(K, V(xs - 0.6, Math.cos(b) * ap, Math.sin(b) * ap), V(xs + 0.6, Math.cos(b) * ap, Math.sin(b) * ap), V(0, -Math.cos(b), -Math.sin(b)), COL.rail, 0.07);
    }
    if (!I.lite) for (let k = 0; k < 3; k++) { const a = 2.2 + k * 1.7; bag(K, offset(ff(V(xs, Math.cos(a) * (ap - 0.2), Math.sin(a) * (ap - 0.2)), V(0, -Math.cos(a), -Math.sin(a)), X), 0, 0, 0), 0.6, 0.4, 0.35, k % 2 ? 'w' : 'ctb'); }
  }
  // bearing seams between the static sections and the rotating collar: brush seal + hazard band + label
  for (const xs of [xc0 - 0.06, xc1 + 0.06]) {
    W.torus('metal', sub(new THREE.Matrix4(), xs, 0, 0, 'y', Math.PI / 2), r - 0.02, 0.06, 6, 64, 0x9da1a5);
    W.torus('paint', sub(new THREE.Matrix4(), xs + Math.sign(xs) * 0.06, 0, 0, 'y', Math.PI / 2), r - 0.05, 0.025, 4, 64, 0x151617);
    const s = Math.sign(xs);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.3;
      sign(K, offset(ff(V(xs + s * 0.32, Math.cos(a) * (ap - 0.03), Math.sin(a) * (ap - 0.03)), V(0, -Math.cos(a), -Math.sin(a)), X), 0, 0, 0), 'ВРАЩЕНИЕ! · ROTATING SECTION', 0.5, 0.06, { ph: 32, bg: '#e9b82a', fg: '#111' });
    }
  }
  // rotating collar section (ring group): lining with the six spoke hatches, ladder tops, lights
  const RW = new MeshWriter(I.lite ? Math.min(I.detail, 0.5) : I.detail);
  const RK = { ...K, W: RW, rails: [], solids: [] };
  const nc = 24, apc = r * Math.cos(Math.PI / nc), sidec = 2 * r * Math.sin(Math.PI / nc);
  for (let k = 0; k < nc; k++) {
    const a = (k / nc) * Math.PI * 2;
    const spoke = k % 4 === 0;
    for (let j = 0; j < 3; j++) {
      const xs = xc0 + (j + 0.5) * (xc1 - xc0) / 3;
      if (spoke && j === 1) continue;
      RW.box('equip', offset(ff(V(xs, Math.cos(a) * apc, Math.sin(a) * apc), V(0, -Math.cos(a), -Math.sin(a)), X), 0, 0, -0.01), (xc1 - xc0) / 3 - 0.01, sidec + 0.01, 0.02, 0xffffff, T.rect(k % 2 ? 'panel' : 'panelB'), T.rect('grey'), 16);
    }
  }
  for (let s = 0; s < 6; s++) {
    const phi = s * SECT;
    const F = ff(P(0, apc, phi), radial(phi).negate(), X);
    // panel with the spoke opening
    const pw = (xc1 - xc0) / 3 - 0.01;
    const [o, i] = radialPair((a) => roundRectRadius(pw / 2, sidec / 2 + 0.005, 0.001, a), () => 0.72, I.lite ? 24 : 48);
    RW.frame2D('equip', offset(F, 0, 0, -0.01), o, i, 0.02, 0xffffff, T.rect('panelB'), { back: false, outerWall: false, innerWall: false });
    hatchFrameRound(RK, F, 0.7, null);
    const Fl = ff(P(0, apc - 0.05, phi + 0.16), radial(phi).negate(), X);
    sign(RK, offset(Fl, 0, 0, 0), `СПИЦА ${s + 1} · SPOKE ${s + 1}`, 0.7, 0.08, { ph: 40, bg: '#1f8a3a', fg: '#fff' });
    for (const sx of [-1, 1]) handrail(RK, P(sx * 0.85, apc, phi - 0.12), P(sx * 0.85, apc, phi + 0.12), radial(phi).negate(), COL.rail, 0.07);
    lightPanel(RK, ff(P(0, apc - 0.02, phi + SECT / 2), radial(phi + SECT / 2).negate(), X), 1.2, 0.22);
  }
  RW.shade(ringBake(I.lite, 'pod'));
  Z.ringGeos = RW.build();
  Z.ringRails = RK.rails;
  // physics (identical in both frames: the drum is symmetric about the spin axis)
  Z.cyl(V(xa + 0.02, 0, 0), V(xb - 0.02, 0, 0), r - 0.15);
  Z.light(-3.5, 1.5, 0); Z.light(3.5, -1.5, 0);
  Z.carveCone(V(xa - 0.4, 0, 0), V(xb + 0.4, 0, 0), r + 0.3);
  Z.bake = (x, y, z, nx, ny, nz, name) => (name === 'glow' ? 1 : (I.lite ? 0.9 : 1) * (1 - 0.3 * sstep(3.8, 4.6, Math.hypot(y, z))));
  Z.up.set(0, 1, 0);
  Z.collar = { x0: X0 + xc0, x1: X0 + xc1 };
  return Z;
}

// ================================================================================================ spoke

function buildSpoke(I) {
  const Z = new ZoneBuilder(I, 'spoke', 'Спица · шахта с лестницей', new THREE.Matrix4(), { frame: 'ring', lite: I.lite, detail: I.detail, seed: 311 });
  const K = Z.K, W = Z.W;
  const r0 = 4.45, r1 = 35.6, rr = 0.75, phi = 0;
  const up = radial(phi).negate(), t = tangent(phi);
  // shaft tube along +radial
  inwardTube(K, ff(P(0, r0, phi), radial(phi), X), r1 - r0, rr, 0xd9d8d2, 28);
  // ladder on the anti-spinward side: two rails + rungs every 0.33 m
  const lad = -0.52;
  for (const sx of [-0.2, 0.2]) W.tube('metal', [P(sx, r0 + 0.1, phi).addScaledVector(t, lad), P(sx, r1, phi).addScaledVector(t, lad)], 0.02, 6, COL.alu);
  for (let rho = r0 + 0.3; rho < r1; rho += 0.33) {
    W.tube('metal', [P(-0.2, rho, phi).addScaledVector(t, lad), P(0.2, rho, phi).addScaledVector(t, lad)], 0.014, 5, COL.alu);
  }
  // stand-offs from the rails to the wall every 2 m, ribs, light strips, cables, level markers
  for (let rho = r0 + 1; rho < r1; rho += 2.0) {
    for (const sx of [-0.2, 0.2]) W.tube('metal', [P(sx, rho, phi).addScaledVector(t, lad), P(sx, rho, phi).addScaledVector(t, -rr + 0.02)], 0.012, 4, COL.dark);
    W.torus('metal', ff(P(0, rho + 1.0, phi), radial(phi), X), rr - 0.02, 0.02, 4, 24, COL.dark);
    lightPanel(K, ff(P(0, rho + 0.4, phi).addScaledVector(t, rr - 0.03), t.clone().negate(), X), 0.12, 0.6, [3.0, 2.95, 2.8]);
    if (Math.round(rho) % 6 === 1 && !I.lite) {
      const g = (0.09 * rho / 9.81).toFixed(2);
      sign(K, ff(P(rr - 0.03, rho + 0.9, phi), V(-1, 0, 0), t.clone().negate()), `R ${rho.toFixed(0)} м · ${g} g`, 0.36, 0.06, { ph: 32, bg: '#e9b82a', fg: '#111' });
    }
  }
  if (!I.lite) cables(K, [P(-0.55, r0 + 0.2, phi).addScaledVector(t, 0.3), P(-0.55, r1, phi).addScaledVector(t, 0.3)], 3, 0.012);
  // volumes, ladder, portals
  Z.cyl(P(0, r0 - 1.2, phi), P(0, r1 + 1.0, phi), rr - 0.07);
  Z.ladders.push({ a: P(0, r0 + 0.1, phi).addScaledVector(t, lad), b: P(0, FLOOR, phi).addScaledVector(t, lad), up: up.clone(), side: t.clone() });
  Z.portal('ringHub', P(0, r0, phi), 0.7);
  Z.portal('pod', P(0, r1, phi), 0.7);
  Z.light(0, 10, 0); Z.light(0, 25, 0);
  Z.carveSpoke = true;
  Z.bake = (x, y, z, nx, ny, nz, name) => (name === 'glow' ? 1 : I.lite ? 0.85 : 0.95);
  return Z;
}

// ================================================================================================ pod

const POD_NAMES = ['Центральный пост кольца', 'Спортзал кольца', 'Кают-компания'];
const POD_SIGNS = ['ЦЕНТРАЛЬНЫЙ ПОСТ · RING CONTROL', 'СПОРТЗАЛ · GYM', 'КАЮТ-КОМПАНИЯ · WARDROOM'];

function buildPod(I, v) {
  const Z = new ZoneBuilder(I, `podV${v}`, POD_NAMES[v], new THREE.Matrix4(), { frame: 'ring', lite: I.lite, detail: I.detail, seed: 321 + v });
  const K = Z.K, W = Z.W, T = I.atlas;
  const phi = 0, up = radial(phi).negate(), t = tangent(phi);
  const PC = R;   // drum centre radius
  // drum point: angle b around the drum axis, measured from +radial toward +tangent
  const D = (x, b, rr = POD_R) => V(x, 0, 0).add(radial(phi).multiplyScalar(PC + rr * Math.cos(b))).addScaledVector(t, rr * Math.sin(b));
  const Dn = (b) => radial(phi).multiplyScalar(-Math.cos(b)).addScaledVector(t, -Math.sin(b));
  const bFloor = Math.acos((FLOOR - PC) / POD_R);     // ~63 deg
  const doorTop = FLOOR - 2.6, bDoor = Math.acos((doorTop - PC) / POD_R);
  // drum lining: x strips, b strips; skip the doorways (|x| < 1.05, b in [bFloor, bDoor] on both sides) and the spoke hole
  const nb = I.lite ? 14 : 28, nx = 8;
  for (let i = 0; i < nx; i++) {
    const xa = -POD_HX + i * (2 * POD_HX / nx), xb2 = xa + 2 * POD_HX / nx;
    for (let j = 0; j < nb; j++) {
      const ba = bFloor + (2 * Math.PI - 2 * bFloor) * j / nb, bb = bFloor + (2 * Math.PI - 2 * bFloor) * (j + 1) / nb;
      const bm = (ba + bb) / 2;
      const inDoor = Math.abs(xa + xb2) / 2 < 1.05 && ((bm > bFloor && bm < bDoor) || (bm > 2 * Math.PI - bDoor && bm < 2 * Math.PI - bFloor));
      const inSpoke = Math.abs((xa + xb2) / 2) < 1.0 && Math.abs(bm - Math.PI) < 0.2;
      if (inDoor || inSpoke) continue;
      surf(W, 'equip', (u, w) => D(u, w), (u, w) => Dn(w), xa, xb2, 1, ba, bb, 1, 0xffffff, T.rect(j % 3 === 1 ? 'panelB' : 'wallRing'));
    }
  }
  // doorway jambs (tunnel from the drum wall to the corridor start) both sides
  for (const s of [-1, 1]) {
    const pa = s * (FLOOR * Math.sin(PHI_A) > 0 ? PHI_A : PHI_A);
    void pa;
  }
  // spoke opening collar at the top
  W.torus('metal', ff(P(0, PC - POD_R + 0.02, phi), radial(phi), X), 0.8, 0.05, 6, 32, COL.dark);
  // end walls (x = +-POD_HX): circular segment above the floor chord
  for (const s of [-1, 1]) {
    const pts = [];
    const n = I.lite ? 20 : 40;
    for (let k = 0; k <= n; k++) { const b = bFloor + (2 * Math.PI - 2 * bFloor) * k / n; const p = D(0, b); pts.push([p.dot(t), -(p.dot(radial(phi)) - PC)]); }
    // frame: X = tangent*(-s)... build directly in ring-local via a basis: local x = t, local y = up, local z = -s * X (facing inward)
    const F = new THREE.Matrix4().makeBasis(s > 0 ? t.clone().negate() : t.clone(), up, V(-s, 0, 0)).setPosition(V(s * POD_HX, 0, 0).add(radial(phi).multiplyScalar(PC)));
    const path = pts.map(([a, b]) => [s > 0 ? -a : a, b]);
    if (s > 0) path.reverse();
    W.poly('equip', F, path, 0xffffff, T.rect('wallRing'));
  }
  // floor: curved deck (rho = FLOOR) over the hall width
  const zFloor = Math.sqrt(POD_R * POD_R - (FLOOR - PC) ** 2);
  const pf = zFloor / FLOOR;
  surf(W, 'equip', (x, p) => P(x, FLOOR, p), (x, p) => radial(p).negate(), -POD_HX, POD_HX, 8, -pf, pf, 8, 0xffffff, T.rect(v === 1 ? 'mat' : v === 2 ? 'carpet' : 'floorGrate'));
  // skirting along the floor edges
  for (const s of [-1, 1]) W.tube('paint', [P(-POD_HX, FLOOR - 0.05, s * pf * 0.99), P(POD_HX, FLOOR - 0.05, s * pf * 0.99)], 0.05, 4, 0x5b6470);
  // ladder from the spoke down to the floor (continuation of the spoke ladder)
  const lad = -0.52;
  for (const sx of [-0.2, 0.2]) W.tube('metal', [P(sx, PC - POD_R, phi).addScaledVector(t, lad), P(sx, FLOOR, phi).addScaledVector(t, lad)], 0.022, 6, COL.alu);
  for (let rho = PC - POD_R + 0.25; rho < FLOOR - 0.1; rho += 0.33) W.tube('metal', [P(-0.2, rho, phi).addScaledVector(t, lad), P(0.2, rho, phi).addScaledVector(t, lad)], 0.015, 5, COL.alu);
  // safety cage hoops on the upper half
  if (!I.lite) for (let rho = PC - POD_R + 0.6; rho < FLOOR - 2.4; rho += 0.7) W.torus('metal', ff(P(0, rho, phi).addScaledVector(t, lad + 0.35), up, X), 0.42, 0.012, 4, 20, COL.yellow, Math.PI * 1.2, -Math.PI * 0.1);
  W.box('equip', offset(deckFrame(0, -0.016), 0, 0, 0.005), 1.0, 0.6, 0.01, 0xffffff, T.rect('stripes'), null, 16);
  // lights: a ring of panels around the vault + wall sconces
  for (let k = 0; k < 6; k++) {
    const b = Math.PI + (k - 2.5) * 0.32;
    for (const x of [-2.3, 2.3]) lightPanel(K, ff(D(x, b, POD_R - 0.03), Dn(b), X), 1.0, 0.28);
  }
  // hall sign + variant content
  sign(K, new THREE.Matrix4().makeBasis(t.clone(), up, V(1, 0, 0)).setPosition(V(-POD_HX + 0.02, 0, 0).add(radial(phi).multiplyScalar(FLOOR - 3.2))), POD_SIGNS[v], 2.4, 0.22, { ph: 48, border: '#2a2d32' });
  const E = (x, p, rho = FLOOR) => deckFrame(x, p, rho);
  const faceEnd = (s, p, h) => uprightFrame(V(s * (POD_HX - 0.02), 0, 0).add(radial(phi + p).multiplyScalar(FLOOR - h)), V(-s, 0, 0), up);
  if (v === 0) {
    // ring control post: consoles along both end walls, big displays, chairs
    for (const s of [-1, 1]) {
      for (const p of [-0.045, 0.0, 0.045]) {
        const Fc = faceEnd(s, p, 0.0);
        W.box('paint', offset(Fc, 0, 0.45, 0.35), 1.6, 0.9, 0.7, 0xcfd3d6);
        W.box('equip', sub(Fc, 0, 0.95, 0.4, 'x', -0.6), 1.5, 0.35, 0.02, 0xffffff, T.rect('keyboard'));
        display(K, offset(Fc, -0.4, 1.4, 0.05), 0.65, 0.42, ['scrRing', 'scrMap', 'scrGraph'][Math.round(p * 30 + 1 + s) % 3]);
        display(K, offset(Fc, 0.4, 1.4, 0.05), 0.65, 0.42, ['scrText', 'scrEarth', 'scrDock'][Math.round(p * 30 + 1) % 3]);
        Z.solids.push(boxSolid(offset(Fc, 0, 0.45, 0.35), 0.8, 0.45, 0.35));
        // chair
        const Fch = offset(Fc, 0, 0, 1.15);
        W.box('paint', offset(Fch, 0, 0.45, 0), 0.5, 0.08, 0.5, 0x2f3a48);
        W.box('paint', offset(Fch, 0, 0.75, 0.24), 0.5, 0.6, 0.06, 0x2f3a48);
        W.cyl('metal', offset(Fch, 0, 0.22, 0), 0.03, 0.03, 0.44, 8, COL.dark);
      }
      display(K, offset(faceEnd(s, 0, 0), 0, 2.6, 0.03), 2.4, 1.2, s > 0 ? 'scrMap' : 'scrRing');
    }
    // central round table with a station model on it
    const Ft = E(0, 0.03);
    W.cyl('paint', sub(Ft, 0, 0, 0.75, 'x', Math.PI / 2), 0.7, 0.7, 0.05, 32, 0xd0d4d8);
    W.cyl('metal', sub(Ft, 0, 0, 0.37, 'x', Math.PI / 2), 0.08, 0.12, 0.74, 12, COL.dark);
    W.torus('paint', offset(Ft, 0, 0, 0.95), 0.25, 0.03, 6, 24, COL.white);
    W.cyl('paint', sub(Ft, 0, 0, 0.95, 'x', 0), 0.015, 0.015, 0.5, 6, COL.grey);
    Z.solids.push(boxSolid(offset(Ft, 0, 0, 0.4), 0.7, 0.7, 0.4));
  } else if (v === 1) {
    // gym: treadmill, bike, weight rack, bench, mirror wall
    const Ftr = E(-1.8, -0.04);
    treadmill(K, rot(Ftr, 'z', Math.PI / 2), 1.9);
    Z.solids.push(boxSolid(offset(Ftr, 0, 0, 0.12), 0.32, 0.95, 0.15));
    const Fb = E(1.8, -0.045);
    ergometer(K, rot(Fb, 'z', -Math.PI / 2));
    W.box('paint', offset(Fb, 0.0, 0.25, 0.55), 0.3, 0.1, 0.06, 0x222222);   // saddle (with gravity a seat is useful)
    W.cyl('metal', offset(Fb, 0.0, 0.25, 0.4), 0.025, 0.025, 0.3, 8, COL.dark);
    Z.solids.push(boxSolid(offset(Fb, 0, 0, 0.3), 0.35, 0.35, 0.3));
    // weight rack along the -x end wall
    const Fw = faceEnd(-1, 0, 0);
    W.box('metal', offset(Fw, 0, 0.6, 0.25), 1.8, 0.05, 0.5, COL.dark);
    for (let k = 0; k < 6; k++) { W.cyl('paint', sub(Fw, -0.75 + k * 0.3, 0.7, 0.25, 'x', Math.PI / 2), 0.1 + k * 0.01, 0.1 + k * 0.01, 0.05, 16, COL.black); }
    W.box('metal', offset(Fw, 0, 0.0, 0.25), 1.8, 0.05, 0.5, COL.dark);
    W.box('metal', offset(Fw, 0, 1.25, 0.05), 2.4, 1.1, 0.02, 0xdfe6ea);   // mirror
    // wall bars on the +x end wall
    const Fwb = faceEnd(1, 0, 0);
    for (const sx of [-0.6, 0.6]) W.box('metal', offset(Fwb, sx, 1.3, 0.1), 0.06, 2.6, 0.06, 0xb48a5a);
    for (let k = 0; k < 9; k++) W.cyl('metal', sub(Fwb, 0, 0.2 + k * 0.28, 0.1, 'z', Math.PI / 2), 0.02, 0.02, 1.2, 8, 0xb48a5a);
    // bench + mats
    const Fbe = E(0.8, 0.045);
    W.box('paint', offset(Fbe, 0, 0, 0.42), 0.4, 1.2, 0.08, 0x2f3a48);
    for (const sy of [-0.45, 0.45]) W.box('metal', offset(Fbe, 0, sy, 0.2), 0.3, 0.05, 0.4, COL.dark);
    Z.solids.push(boxSolid(offset(Fbe, 0, 0, 0.23), 0.2, 0.6, 0.23));
    display(K, offset(faceEnd(1, 0.05, 0), 0, 2.2, 0.03), 1.2, 0.7, 'scrGraph');
  } else {
    // wardroom: long table with benches, galley counter on the +x end wall, fridge, screen, plants
    const Ft = E(0, 0.0);
    W.box('equip', offset(Ft, 0, 0, 0.76), 1.0, 3.4, 0.05, 0xffffff, T.rect('wood'));
    for (const sy of [-1.4, 1.4]) W.box('metal', offset(Ft, 0, sy, 0.37), 0.08, 0.08, 0.74, COL.dark);
    for (const sx of [-0.85, 0.85]) {
      W.box('paint', offset(Ft, sx, 0, 0.45), 0.35, 3.2, 0.06, 0x2f3a48);
      for (const sy of [-1.3, 1.3]) W.box('metal', offset(Ft, sx, sy, 0.22), 0.05, 0.05, 0.44, COL.dark);
    }
    if (!I.lite) for (let k = 0; k < 8; k++) {
      const y = -1.4 + k * 0.4;
      W.cyl('paint', sub(Ft, (k % 2 ? -0.3 : 0.3), y, 0.795, 'x', Math.PI / 2), 0.12, 0.12, 0.012, 16, COL.white);
      W.cyl('paint', sub(Ft, (k % 2 ? -0.15 : 0.15), y + 0.1, 0.84, 'x', Math.PI / 2), 0.03, 0.035, 0.1, 10, [0.6, 0.15, 0.1]);
    }
    Z.solids.push(boxSolid(offset(Ft, 0, 0, 0.4), 0.5, 1.7, 0.4));
    for (const sx of [-0.85, 0.85]) Z.solids.push(boxSolid(offset(Ft, sx, 0, 0.23), 0.18, 1.6, 0.25));
    const Fg = faceEnd(1, 0, 0);
    W.box('paint', offset(Fg, 0, 0.45, 0.3), 3.0, 0.9, 0.6, 0xdcdedf);
    W.box('metal', offset(Fg, 0, 0.92, 0.3), 3.05, 0.04, 0.62, COL.alu);
    for (let k = 0; k < 3; k++) { W.box('equip', offset(Fg, -1.0 + k * 0.8, 1.35, 0.15), 0.6, 0.4, 0.3, 0xffffff, T.rect('rackGalley'), T.rect('grey')); }
    W.box('paint', offset(Fg, 1.3, 1.1, 0.35), 0.6, 2.2, 0.7, 0xe8e8e6);
    sign(K, offset(Fg, 1.3, 1.6, 0.71), 'ХОЛОДИЛЬНИК', 0.4, 0.06, { ph: 32 });
    sign(K, offset(Fg, -0.5, 1.75, 0.0), 'КАМБУЗ · GALLEY', 0.8, 0.1, { ph: 40 });
    Z.solids.push(boxSolid(offset(Fg, 0, 0.45, 0.3), 1.5, 0.45, 0.3));
    display(K, offset(faceEnd(-1, 0, 0), 0, 1.7, 0.03), 2.0, 1.1, 'scrEarth');
    if (!I.lite) for (const p of [-0.06, 0.06]) { const Fp = E(-3.4, p); W.cyl('paint', offset(Fp, 0, 0, 0.25), 0.2, 0.15, 0.5, 14, 0x6b5a45); plant(K, offset(rot(Fp, 'x', -Math.PI / 2), 0, 0.5, 0), 'tomato', 2.2); }
  }
  // fire safety near the doorways
  if (!I.lite) for (const s of [-1, 1]) {
    extinguisher(K, uprightFrame(V(1.6, 0, 0).add(radial(s * 0.085).multiplyScalar(FLOOR - 1.0)), tangent(0).multiplyScalar(-s), up));
  }
  // volumes: hall (polar box) + ladder column to the spoke
  Z.polar(-POD_HX + 0.05, POD_HX - 0.05, PC - 2.5, FLOOR, -pf * 0.995, pf * 0.995);
  Z.cyl(P(0, PC - POD_R - 0.6, 0), P(0, PC - 2.2, 0), 0.7);
  Z.portal('spoke', P(0, PC - POD_R, phi), 0.7);
  Z.portal('corPrev', P(0, FLOOR - 1.2, -pf), 1.2);
  Z.portal('corNext', P(0, FLOOR - 1.2, pf), 1.2);
  Z.light(-1.5, FLOOR - 3.2, 0); Z.light(1.5, FLOOR - 3.2, 0);
  Z.bake = ringBake(I.lite, 'pod');
  Z.podCarve = true;
  return Z;
}

// ================================================================================================ corridor

const COMMON_NAMES = ['Бытовой блок · душ, санузел', 'Салон · библиотека', 'Мастерская · лаборатория'];
const CABIN_W = 2.4;

function buildCorridor(I, v) {
  const Z = new ZoneBuilder(I, `corV${v}`, 'Коридор кольца', new THREE.Matrix4(), { frame: 'ring', lite: I.lite, detail: I.detail, seed: 341 + v });
  const K = Z.K, W = Z.W, T = I.atlas;
  const p0 = PHI_A, p1 = SECT - PHI_A;
  const tubeX = (rho) => Math.sqrt(Math.max(0, TUBE * TUBE - (rho - R) ** 2));
  const xf = tubeX(FLOOR) - 0.02, xc = tubeX(CEIL) - 0.02;
  const aisle = 1.0;
  // layout along phi (arc length at the partition radius ~ 40.3)
  const rp = 40.3, arc = (p1 - p0) * rp;
  const vest = 2.0, nCab = 4, common = arc - 2 * vest - 2 * nCab * CABIN_W;
  const segs = [];   // { kind: 'vest'|'cab'|'common', a, b (phi) }
  let s0 = p0;
  const push = (kind, len, extra = {}) => { const a = s0, b = s0 + len / rp; segs.push({ kind, a, b, ...extra }); s0 = b; };
  push('vest', vest);
  for (let i = 0; i < nCab; i++) push('cab', CABIN_W, { n: i });
  push('common', common);
  for (let i = 0; i < nCab; i++) push('cab', CABIN_W, { n: nCab + i });
  push('vest', vest);
  // ---------- floor (aisle grating, carpet elsewhere), ceiling, lights
  const np = Math.max(8, Math.round(arc / 1.0));
  surf(W, 'equip', (x, p) => P(x, FLOOR, p), (x, p) => radial(p).negate(), -aisle, aisle, 2, p0 - 0.01, p1 + 0.01, np, 0xffffff, T.rect('floorGrate'));
  for (const s of [-1, 1]) surf(W, 'c:equip', (x, p) => P(x, FLOOR, p), (x, p) => radial(p).negate(), s > 0 ? aisle : -xf, s > 0 ? xf : -aisle, 2, p0, p1, np, 0xffffff, T.rect('carpet'));
  surf(W, 'equip', (x, p) => P(x, CEIL, p), (x, p) => radial(p), -xc, xc, 4, p0 - 0.01, p1 + 0.01, np, 0xffffff, T.rect('ceilRing'));
  for (let k = 0; k <= np; k += 2) {
    const p = lerp(p0, p1, k / np);
    lightPanel(K, ff(P(0, CEIL + 0.01, p), radial(p), tangent(p)), 1.1, 0.22);
  }
  // ---------- tube lining on both sides (lower wall, window band, upper wall)
  const psi = (rho) => Math.acos((rho - R) / TUBE);
  const psiF = psi(FLOOR), psiC = psi(CEIL), psiW0 = psi(R + 0.28), psiW1 = psi(R - 0.28);
  const Lp = (s) => (ps, p) => V(s * TUBE * Math.sin(ps), 0, 0).add(radial(p).multiplyScalar(R + TUBE * Math.cos(ps)));
  const Ln = (s) => (ps, p) => V(-s * Math.sin(ps), 0, 0).add(radial(p).multiplyScalar(-Math.cos(ps)));
  for (const s of [-1, 1]) {
    surf(W, 'c:equip', Lp(s), Ln(s), psiF, psiW0 - 0.012, 3, p0, p1, np, 0xffffff, T.rect('wallRing'));
    surf(W, 'c:equip', Lp(s), Ln(s), psiW1 + 0.012, psiC, 2, p0, p1, np, 0xffffff, T.rect('ceilRing'));
    // window band: sill and lintel strips, glass, mullions every 1.5 m
    surf(W, 'c:metal', (ps, p) => Lp(s)(ps, p).addScaledVector(V(1, 0, 0), -s * 0.03), Ln(s), psiW0 - 0.012, psiW0 + 0.004, 1, p0, p1, np, COL.alu);
    surf(W, 'c:metal', (ps, p) => Lp(s)(ps, p).addScaledVector(V(1, 0, 0), -s * 0.03), Ln(s), psiW1 - 0.004, psiW1 + 0.012, 1, p0, p1, np, COL.alu);
    surf(W, 'c:glass', Lp(s), Ln(s), psiW0, psiW1, 1, p0, p1, np, 0xffffff);
    for (let k = 0; k <= np; k += 2) {
      const p = lerp(p0, p1, k / np);
      W.tube('c:metal', [Lp(s)(psiW0, p).addScaledVector(V(1, 0, 0), -s * 0.02), Lp(s)(psiW1, p).addScaledVector(V(1, 0, 0), -s * 0.02)], 0.025, 4, COL.alu);
    }
    Z.window({ type: 'band', x: X0 + s * 3.5, n: V(s, 0, 0), r0: R - 0.28, r1: R + 0.28 }, 'c:');
  }
  // ---------- partitions with doors along the cabin blocks; cabin dividers; open cabins get interiors
  const H = FLOOR - CEIL;
  for (const sg of segs) {
    if (sg.kind === 'vest') {
      // airtight door frame at the pod end + side lockers, extinguisher, signs
      const pEnd = sg.a === p0 ? p0 : p1, dirS = sg.a === p0 ? 1 : -1;
      // door jamb: a thick frame 2.1 x 2.2 around the opening (sill on the deck, lintel below the 2.45 m ceiling)
      const jw = 2.1, jh = 2.2;
      const F = ff(P(0, FLOOR - jh / 2, pEnd), tangent(pEnd).multiplyScalar(dirS), V(-dirS, 0, 0));
      const outer = [], inner = [];
      const n = 32;
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; outer.push([Math.cos(a) * 3.6, Math.sin(a) * 2.2 + 0.25].map((q, i2) => i2 === 0 ? q : q)); const rr = roundRectRadius(jw / 2, jh / 2, 0.15, a); inner.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; const ro = roundRectRadius(xc + 0.02, 1.32, 0.01, a); outer[k] = [Math.cos(a) * ro, Math.sin(a) * ro]; }
      W.frame2D('paint', offset(F, 0, 0, 0.05), outer, inner, 0.1, 0xb9c0c8, null, { back: true, outerWall: false, innerWall: true });
      W.frame2D('metal', offset(F, 0, 0, 0.12), roundRect2(jw + 0.16, jh + 0.16, 0.2), roundRect2(jw, jh, 0.15), 0.06, 0x8f969d);
      // sliding door (open, parked in the wall pocket) + hazard strip on the threshold
      W.box('equip', offset(F, jw * 0.5 + 0.55, 0, 0.0), 1.05, jh, 0.06, 0xffffff, T.rect('doorRing'), T.rect('grey'));
      W.box('equip', offset(F, 0, -jh / 2 + 0.02, 0.06), jw, 0.06, 0.12, 0xffffff, T.rect('stripes'));
      if (!I.lite) {
        sign(K, offset(F, 0, jh / 2 + 0.12, 0.11), dirS > 0 ? '← СЕКТОР · SECTOR HALL' : 'СЕКТОР · SECTOR HALL →', 1.0, 0.1, { ph: 40, bg: '#1f8a3a', fg: '#fff', glow: true });
        const Fl = ff(P(-aisle + 0.02, FLOOR - 1.2, (sg.a + sg.b) / 2), V(1, 0, 0), tangent(0).clone());
        rack(K, Fl, 'locker2', 1.2, 1.9);
        const Fr = ff(P(aisle - 0.02, FLOOR - 1.2, (sg.a + sg.b) / 2), V(-1, 0, 0), tangent(0).clone().negate());
        rack(K, Fr, 'drawers', 1.2, 1.9);
      }
      // side walls of the vestibule at |x| = aisle
      for (const sx of [-1, 1]) surf(W, 'equip', (p, rho) => P(sx * aisle, rho, p), () => V(-sx, 0, 0), sg.a, sg.b, 2, CEIL, FLOOR, 2, 0xffffff, T.rect('wallRing'));
      continue;
    }
    if (sg.kind === 'common') {
      const pm = (sg.a + sg.b) / 2;
      commonArea(Z, v, sg.a, sg.b, xf, xc);
      Z.polar(-xf + 0.35, xf - 0.35, CEIL + 0.3, FLOOR, sg.a, sg.b);
      void pm;
      continue;
    }
    // cabin: partitions on both sides with a door; open cabins (n = 1 and 6) get interiors
    for (const sx of [-1, 1]) {
      const open = (sg.n === 1 && sx > 0) || (sg.n === 6 && sx < 0);
      const dA = sg.a + 0.25 / rp, dB = dA + 0.95 / rp;    // door span
      // partition panels except the door opening
      surf(W, 'equip', (p, rho) => P(sx * aisle, rho, p), () => V(-sx, 0, 0), sg.a, dA, 1, CEIL, FLOOR, 2, 0xffffff, T.rect('wallRing'));
      surf(W, 'equip', (p, rho) => P(sx * aisle, rho, p), () => V(-sx, 0, 0), dB, sg.b, 2, CEIL, FLOOR, 2, 0xffffff, T.rect('wallRing'));
      surf(W, 'equip', (p, rho) => P(sx * aisle, rho, p), () => V(-sx, 0, 0), dA, dB, 1, CEIL, FLOOR - 2.15, 1, 0xffffff, T.rect('wallRing'));
      // door: closed panel or open (slid into the wall); frame trim; name plate
      const dm = (dA + dB) / 2;
      const Fd = uprightFrame(P(sx * (aisle - 0.01), FLOOR - 1.075, dm), V(-sx, 0, 0), radial(dm).negate());
      if (!open) W.box('equip', offset(Fd, 0, 0, -0.03), 0.95, 2.15, 0.04, 0xffffff, T.rect('doorRing'), T.rect('grey'));
      else W.box('equip', offset(Fd, sx * 0.0 - 0.75, 0, -0.07), 0.95, 2.15, 0.04, 0xffffff, T.rect('doorRing'), T.rect('grey'));
      W.frame2D('metal', offset(Fd, 0, 0, 0.0), roundRect2(1.07, 2.25, 0.04), roundRect2(0.95, 2.15, 0.02), 0.03, 0x9aa1a8);
      const sec = v + 1, num = sg.n + 1 + (sx > 0 ? 0 : 8);
      sign(K, offset(Fd, 0.75, 0.55, 0.0), `КАЮТА ${sec}-${String(num).padStart(2, '0')}`, 0.36, 0.06, { ph: 32, bg: '#2a3b52', fg: '#fff' });
      // cabin dividers (only visible for open cabins)
      if (open) cabin(Z, sx, sg.a, sg.b, aisle, xf, xc, dA, dB, v + sg.n);
    }
    // aisle side handrail (waist height) along the partitions
    if (!I.lite) for (const sx of [-1, 1]) W.tube('metal', [P(sx * (aisle - 0.06), FLOOR - 0.95, sg.a + 0.05 / rp), P(sx * (aisle - 0.06), FLOOR - 0.95, sg.a + 0.2 / rp)], 0.02, 6, COL.rail);
  }
  // ---------- volumes and links
  Z.polar(-aisle + 0.02, aisle - 0.02, CEIL + 0.2, FLOOR, p0 - 0.05, p1 + 0.05);
  Z.portal('podPrev', P(0, FLOOR - 1.2, p0), 1.2);
  Z.portal('podNext', P(0, FLOOR - 1.2, p1), 1.2);
  const pm = (p0 + p1) / 2;
  Z.light(0, ...[P(0, FLOOR - 2.2, pm - 0.15).y, P(0, FLOOR - 2.2, pm - 0.15).z]);
  Z.light(0, ...[P(0, FLOOR - 2.2, pm + 0.15).y, P(0, FLOOR - 2.2, pm + 0.15).z]);
  Z.bake = ringBake(I.lite, 'corridor');
  Z.ringCarve = true;
  Z.commonName = COMMON_NAMES[v];
  Z.commonRange = segs.find((s) => s.kind === 'common');
  return Z;
}

function roundRect2(w, h, r) {
  const pts = [], x = w / 2 - r, y = h / 2 - r, k = 3;
  for (const [cx, cy, a0] of [[x, -y, -Math.PI / 2], [x, y, 0], [-x, y, Math.PI / 2], [-x, -y, Math.PI]]) for (let i = 0; i <= k; i++) { const a = a0 + (i / k) * Math.PI / 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

/** Open cabin interior between phi a..b on side sx: dividers, bunk under the window band, desk, locker, items. */
function cabin(Z, sx, a, b, aisle, xf, xc, dA, dB, seed) {
  const K = Z.K, W = Z.W, T = Z.I.atlas;
  const prev = K.set; K.set = 'c:';
  // dividers (constant phi planes) from the partition to the tube wall
  const tubeX = (rho) => Math.sqrt(Math.max(0, TUBE * TUBE - (rho - R) ** 2));
  for (const [p, nrm] of [[a, 1], [b, -1]]) {
    surf(W, 'c:equip', (x, rho) => P(sx * x, rho, p), () => tangent(p).multiplyScalar(nrm), aisle, Math.max(xf, xc), 3, CEIL, FLOOR, 3, 0xffffff, T.rect('wallRing'));
  }
  void tubeX;
  const pm = (a + b) / 2;
  const up = radial(pm).negate();
  // bunk along the outer wall (raised), with bedding and pillow
  const bx = sx * 2.25;
  const Fb = new THREE.Matrix4().makeBasis(V(sx, 0, 0), tangent(pm).multiplyScalar(sx), up).setPosition(P(bx, FLOOR - 0.55, pm));
  W.box('c:paint', offset(Fb, 0, 0, -0.08), 0.9, 2.0, 0.16, 0xc9ccd0);
  W.chamferBox('c:equip', offset(Fb, 0, 0, 0.06), 0.85, 1.95, 0.14, 0.04, 0xffffff, T.rect('bedding'));
  W.chamferBox('c:equip', offset(Fb, 0, 0.75, 0.17), 0.5, 0.3, 0.1, 0.04, 0xffffff, T.rect('fabric'));
  W.box('c:metal', offset(Fb, -0.4 * 0, 0, -0.35), 0.06, 1.9, 0.5, COL.dark);
  Z.solids.push(boxSolid(offset(Fb, 0, 0, -0.1), 0.45, 1.0, 0.45, 'bunk'));
  // desk with a screen + chair at the partition side
  const Fdk = new THREE.Matrix4().makeBasis(tangent(pm).multiplyScalar(-sx), up, V(-sx, 0, 0)).setPosition(P(sx * (aisle + 0.4), FLOOR, b - 0.5 / 40.3));
  W.box('c:equip', offset(Fdk, 0, 0.74, -0.25), 0.9, 0.04, 0.55, 0xffffff, T.rect('wood'));
  W.box('c:metal', offset(Fdk, 0.4, 0.37, -0.25), 0.04, 0.74, 0.5, COL.dark);
  display(K, sub(Fdk, 0, 1.05, -0.48, 'y', 0), 0.45, 0.28, 'scrBlue');
  laptop(K, sub(Fdk, 0.0, 0.76, -0.2, 'x', -Math.PI / 2), 'scrText', 0.02);
  // locker by the door, photos and a personal item on the wall
  const Fl = new THREE.Matrix4().makeBasis(V(-1, 0, 0), up, tangent(a)).setPosition(P(sx * (aisle + 0.5), FLOOR - 1.0, a + 0.02 / 40));
  W.box('c:equip', offset(Fl, 0, 0, 0.25), 0.8, 2.0, 0.5, 0xffffff, T.rect('rackLocker2'), T.rect('white'));
  if (!Z.I.lite) {
    W.box('c:equip', offset(Fdk, -0.2, 1.5, -0.52), 0.18, 0.22, 0.004, 0xffffff, T.rect('photoCrew'), null, 16);
    W.box('c:equip', offset(Fdk, 0.2, 1.5, -0.52), 0.2, 0.14, 0.004, 0xffffff, T.rect('photoEarth'), null, 16);
    lightPanel(K, ff(P(sx * 1.9, CEIL + 0.01, pm), radial(pm), tangent(pm)), 0.6, 0.2, [2.6, 2.4, 2.0]);
  }
  // volume: cabin floor space + the doorway
  Z.polar(sx > 0 ? aisle + 0.05 : -xf + 0.3, sx > 0 ? xf - 0.3 : -aisle - 0.05, CEIL + 0.3, FLOOR, a + 0.02, b - 0.02);
  // doorway: from the corridor centre line through the door into the cabin
  Z.polar(sx > 0 ? 0 : -1.7, sx > 0 ? 1.7 : 0, FLOOR - 2.1, FLOOR, dA + 0.005, dB - 0.005);
  K.set = prev;
  void seed; void dA; void dB;
}

/** Common area of corridor variant v between phi a..b (full tube width, windows both sides). */
function commonArea(Z, v, a, b, xf, xc) {
  const K = Z.K, W = Z.W, T = Z.I.atlas;
  const prev = K.set; K.set = 'c:';
  const pm = (a + b) / 2, up = radial(pm).negate();
  const E = (x, p) => deckFrame(x, p);
  sign(K, ff(P(0, CEIL + 0.35, a + 0.02), tangent(a).negate(), V(1, 0, 0)), COMMON_NAMES[v].toUpperCase(), 1.6, 0.13, { ph: 40, border: '#2a2d32' });
  if (v === 0) {
    // hygiene block: two shower stalls and two toilets as cubicles along both sides, wash basins
    for (const sx of [-1, 1]) for (const k of [0, 1]) {
      const p = a + (k + 0.6) * (b - a) / 2.4;
      const F = new THREE.Matrix4().makeBasis(tangent(p).multiplyScalar(-sx), up, V(-sx, 0, 0)).setPosition(P(sx * 1.8, FLOOR, p));
      W.box('c:paint', offset(F, -0.85, 1.1, 0), 0.04, 2.2, 1.3, 0xd8dde2);
      W.box('c:paint', offset(F, 0.85, 1.1, 0), 0.04, 2.2, 1.3, 0xd8dde2);
      W.box('c:equip', offset(F, 0, 1.1, 0.64), 1.7, 2.2, 0.03, 0xffffff, T.rect('doorRing'));
      sign(K, offset(F, 0, 1.9, 0.66), (k ? 'ДУШ · SHOWER' : 'САНУЗЕЛ · WC'), 0.5, 0.07, { ph: 32, bg: '#2a3b52', fg: '#fff' });
      Z.solids.push(boxSolid(offset(F, 0, 1.1, 0), 0.9, 1.1, 0.65, 'cubicle'));
    }
    const Fb = E(0, pm);
    for (const sy of [-0.5, 0.5]) { W.box('c:paint', offset(Fb, 0, sy, 0.8), 0.5, 0.4, 0.15, 0xe8eaec); W.cyl('c:metal', offset(Fb, 0, sy, 0.95), 0.015, 0.015, 0.15, 6, COL.alu); }
    W.box('c:paint', offset(Fb, 0, 0, 0.4), 0.3, 1.2, 0.8, 0xc9ccd0);
    Z.solids.push(boxSolid(offset(Fb, 0, 0, 0.45), 0.25, 0.65, 0.45));
  } else if (v === 1) {
    // lounge: sofas facing the windows, low table, bookshelves, a big screen, plants
    for (const sx of [-1, 1]) {
      const F = new THREE.Matrix4().makeBasis(tangent(pm).multiplyScalar(sx), up, V(sx, 0, 0)).setPosition(P(sx * 1.4, FLOOR, pm));
      W.chamferBox('c:equip', offset(F, 0, 0.25, 0), 2.6, 0.45, 0.8, 0.08, 0xffffff, T.rect('fabricBlue'));
      W.chamferBox('c:equip', offset(F, 0, 0.6, -0.35), 2.6, 0.6, 0.18, 0.06, 0xffffff, T.rect('fabricBlue'));
      Z.solids.push(boxSolid(offset(F, 0, 0.25, -0.05), 1.3, 0.25, 0.42, 'sofa'));
      for (const p of [pm - 0.06, pm + 0.06]) { const Fs = new THREE.Matrix4().makeBasis(V(-1, 0, 0), up, tangent(p)).setPosition(P(sx * 2.3, FLOOR, p)); W.box('c:equip', offset(Fs, 0, 0.9, 0), 0.6, 1.8, 0.35, 0xffffff, T.rect('rackDrawers'), T.rect('wood')); }
    }
    const Ft = E(0, pm);
    W.box('c:equip', offset(Ft, 0, 0, 0.4), 0.7, 1.2, 0.04, 0xffffff, T.rect('wood'));
    W.box('c:metal', offset(Ft, 0, 0, 0.2), 0.08, 0.08, 0.4, COL.dark);
    Z.solids.push(boxSolid(offset(Ft, 0, 0, 0.21), 0.35, 0.6, 0.21));
    if (!Z.I.lite) for (const p of [a + 0.03, b - 0.03]) { const Fp = E(0, p); W.cyl('c:paint', sub(Fp, 0, 0, 0.25, 'x', Math.PI / 2), 0.2, 0.16, 0.5, 14, 0x6b5a45); plant(K, offset(rot(Fp, 'x', -Math.PI / 2), 0, 0.5, 0), 'pepper', 2.2); }
  } else {
    // workshop / lab: workbenches along both sides with tools and screens, a 3D printer
    for (const sx of [-1, 1]) {
      const F = new THREE.Matrix4().makeBasis(tangent(pm).multiplyScalar(-sx), up, V(-sx, 0, 0)).setPosition(P(sx * 2.0, FLOOR, pm));
      W.box('c:paint', offset(F, 0, 0.45, 0), 3.0, 0.9, 0.7, 0xc9ccd0);
      W.box('c:equip', offset(F, 0, 0.92, 0), 3.05, 0.04, 0.72, 0xffffff, T.rect('wood'));
      display(K, offset(F, -0.8, 1.4, -0.3), 0.6, 0.38, 'scrGraph');
      W.box('c:equip', offset(F, 0.8, 1.6, -0.34), 1.0, 0.8, 0.02, 0xffffff, T.rect('grille'));
      if (!Z.I.lite) for (let k = 0; k < 5; k++) W.box('c:metal', offset(F, 0.45 + k * 0.17, 1.6, -0.3), 0.02, 0.25, 0.02, COL.metal);
      Z.solids.push(boxSolid(offset(F, 0, 0.45, 0), 1.5, 0.45, 0.35, 'bench'));
    }
    const Fp = E(0, pm);
    W.box('c:paint', offset(Fp, 0, 0, 0.6), 0.6, 0.6, 1.2, 0x3a3c40);
    W.box('c:glass', offset(Fp, 0, 0, 0.75), 0.5, 0.62, 0.5, 0xffffff);
    sign(K, offset(Fp, 0, -0.31, 1.0), '3D-ПРИНТЕР', 0.4, 0.06, { ph: 32 });
    Z.solids.push(boxSolid(offset(Fp, 0, 0, 0.6), 0.3, 0.3, 0.6));
  }
  // windows both sides are part of the lining; add handrails/lamps
  for (const sx of [-1, 1]) lightPanel(K, ff(P(sx * 1.6, CEIL + 0.01, pm), radial(pm), tangent(pm)), 0.8, 0.25, [2.6, 2.5, 2.2]);
  K.set = prev;
}

// ================================================================================================ assembly

/** Rotate a zone record (built at phi = 0) to sector k. Returns a new record sharing the geometry. */
function sectorRecord(rec, k, id, name, links) {
  const phi = k * SECT;
  const q = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), phi);
  const Mr = new THREE.Matrix4().makeRotationX(phi);
  const r = { ...rec, id, name, M: Mr.clone().multiply(rec.M), shared: true };
  r.volumes = rec.volumes.map((v) => {
    if (v.type === 'polar') return { ...v, p0: v.p0 + phi, p1: v.p1 + phi };
    if (v.type === 'cyl') return { ...v, a: v.a.clone().applyQuaternion(q), b: v.b.clone().applyQuaternion(q) };
    const o = { ...v, center: v.center.clone().applyQuaternion(q), quat: q.clone().multiply(v.quat) }; o.qi = o.quat.clone().invert(); return o;
  });
  r.solids = rec.solids.map((c) => (c.type === 'box' ? { ...c, center: c.center.clone().applyQuaternion(q), quaternion: q.clone().multiply(c.quaternion) } : { ...c }));
  r.rails = rec.rails.map((h) => ({ a: h.a.clone().applyQuaternion(q), b: h.b.clone().applyQuaternion(q), radius: h.radius }));
  r.ladders = rec.ladders.map((l) => ({ a: l.a.clone().applyQuaternion(q), b: l.b.clone().applyQuaternion(q), up: l.up.clone().applyQuaternion(q), side: l.side ? l.side.clone().applyQuaternion(q) : null }));
  r.lights = rec.lights.map((p) => p.clone().applyQuaternion(q));
  r.portals = rec.portals.map((p) => ({ ...p, center: p.center.clone().applyQuaternion(q), to: links[p.to] ?? p.to }));
  r.sphere = rec.sphere.clone(); r.sphere.center.applyQuaternion(q);
  r.phi = phi; r.sector = k;
  return r;
}

/** Build the hub (ZoneBuilder, station frame) and all ring zone records. */
export function buildRing(I) {
  const hub = buildHub(I);
  const spoke = buildSpoke(I).finish();
  const pods = [0, 1, 2].map((v) => buildPod(I, v).finish());
  const cors = [0, 1, 2].map((v) => buildCorridor(I, v));
  const corMeta = cors.map((z) => ({ commonName: z.commonName, commonRange: z.commonRange }));
  const corRecs = cors.map((z) => z.finish());
  const records = [];
  for (let k = 0; k < 6; k++) {
    const v = k % 3, kn = (k + 1) % 6, kp = (k + 5) % 6;
    const sp = sectorRecord(spoke, k, `spoke${k}`, `Спица ${k + 1} · шахта`, { ringHub: 'ringHub', pod: `pod${k}` });
    sp.carveSpoke = true;
    records.push(sp);
    const pd = sectorRecord(pods[v], k, `pod${k}`, `Сектор ${k + 1} · ${POD_NAMES[v]}`, { spoke: `spoke${k}`, corPrev: `cor${kp}`, corNext: `cor${k}` });
    pd.podCarve = true;
    records.push(pd);
    const cr = sectorRecord(corRecs[v], k, `cor${k}`, `Коридор кольца · сектор ${k + 1}–${kn + 1}`, { podPrev: `pod${k}`, podNext: `pod${kn}` });
    cr.ringCarve = true;
    cr.commonName = corMeta[v].commonName; cr.commonRange = corMeta[v].commonRange ? { a: corMeta[v].commonRange.a + k * SECT, b: corMeta[v].commonRange.b + k * SECT } : null;
    records.push(cr);
  }
  return { hub, records };
}

export const RING = { R, FLOOR, CEIL, X0, SECT, PHI_A, POD_R, POD_HX, TUBE };
