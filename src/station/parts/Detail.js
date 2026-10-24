import * as THREE from 'three';
import { bevelBox, ringStack } from './Builder.js';

/**
 * Close-range hardware detail for the station exterior (GPU presets only; 'lite' builds none of it).
 *
 * DetailSet collects small parts (bolts, rivets, latches, sockets, clamps, connector panels…) and merges
 * them into plain meshes per (anchor, material, LOD tier, spatial cell). Every frame `update()` hides the
 * cells that are farther from the camera than their tier's distance, so tens of thousands of parts cost a
 * few dozen draw calls near the camera and nothing from afar:
 *   tier 'fine' — fasteners, buttons, tiny fittings (sub-pixel beyond ~30-40 m)
 *   tier 'mid'  — latches, sockets, housings, clamps, standoffs (sub-pixel beyond ~100-120 m)
 * Structural joints that read from any distance (flanges, berthing rings, panels) go into the part's
 * Builder instead (always drawn, shadow casting).
 *
 * Most parts use two vertex-coloured materials ('detailMetal', 'detailPaint') so a cell is one or two draws
 * regardless of how many finishes it contains. Geometry is appended straight into growable typed arrays
 * (no per-part BufferGeometry), which keeps the build fast with ~10^5 parts.
 */

// ---------------------------------------------------------------- colours (sRGB hex -> linear)
const C = (hex) => new THREE.Color(hex);
export const COL = {
  dark: C(0x3a3d42), bare: C(0xb8bcc2), steel: C(0x8e9196), gold: C(0xd9a63a), copper: C(0xb87333), black: C(0x18191c),
  white: C(0xe0e2e2), offWhite: C(0xd8dad8), gray: C(0x7c8187), darkGray: C(0x4a4e54), yellow: C(0xf2c21a), orange: C(0xe8661b),
  blue: C(0x1f3f7a), red: C(0xa81c1c), green: C(0x2f6a3a), rubber: C(0x141414), beige: C(0xcfc6ae),
};

/** LOD distances (metres) per preset; `quality.detailScale` (QualityGovernor) and ?detaildist=<x> scale them. */
const TIER_DIST = {
  // fine parts are 1-3 cm: under a pixel at 1080p beyond ~25-30 m
  ultra: { fine: 30, mid: 110 }, high: { fine: 26, mid: 95 }, medium: { fine: 18, mid: 65 }, low: { fine: 12, mid: 45 },
};
/**
 * Spatial cells per tier: size (x along the spine, y, z) and grid offset. Large cells = few draw calls; the
 * y/z offsets keep the module cluster (y -14..0, |z| < 15) and the truss inside a single row of cells, so
 * cells are effectively slices along the spine.
 */
const CELL = { fine: [16, 64, 64], mid: [64, 128, 128] };
const CELL_OFS = { fine: [0, 32, 32], mid: [0, 64, 64] };

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n3 = new THREE.Matrix3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _c = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- geometry accumulation

class FArr {
  constructor(n = 4096, T = Float32Array) { this.T = T; this.a = new T(n); this.n = 0; }
  reserve(k) {
    if (this.n + k <= this.a.length) return;
    let s = this.a.length * 2; while (s < this.n + k) s *= 2;
    const b = new this.T(s); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  trim() { return this.a.slice(0, this.n); }
}

/** Appends transformed copies of template geometries into one position/normal/uv(/color) buffer set. */
export class GeoAccum {
  constructor(withColor = false) {
    this.pos = new FArr(); this.nor = new FArr(); this.uv = new FArr(); this.col = withColor ? new FArr() : null;
    this.idx = new FArr(4096, Uint32Array); this.count = 0;
  }
  add(geo, matrix = null, color = null) {
    const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, n = P.count, base = this.count;
    this.pos.reserve(n * 3); this.nor.reserve(n * 3); this.uv.reserve(n * 2); if (this.col) this.col.reserve(n * 3);
    const pa = this.pos.a, na = this.nor.a, ua = this.uv.a;
    let po = this.pos.n, uo = this.uv.n;
    const e = matrix ? matrix.elements : null;
    if (e) _n3.getNormalMatrix(matrix);
    const ne = _n3.elements;
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      let nx = N ? N.getX(i) : 0, ny = N ? N.getY(i) : 1, nz = N ? N.getZ(i) : 0;
      if (e) {
        pa[po] = e[0] * x + e[4] * y + e[8] * z + e[12]; pa[po + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; pa[po + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        const tx = ne[0] * nx + ne[3] * ny + ne[6] * nz, ty = ne[1] * nx + ne[4] * ny + ne[7] * nz, tz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
        const l = Math.hypot(tx, ty, tz) || 1; nx = tx / l; ny = ty / l; nz = tz / l;
      } else { pa[po] = x; pa[po + 1] = y; pa[po + 2] = z; }
      na[po] = nx; na[po + 1] = ny; na[po + 2] = nz;
      po += 3;
      if (U) { ua[uo] = U.getX(i); ua[uo + 1] = U.getY(i); } else { ua[uo] = 0; ua[uo + 1] = 0; }
      uo += 2;
    }
    this.pos.n = po; this.nor.n = po; this.uv.n = uo;
    if (this.col) {
      const ca = this.col.a; let co = this.col.n;
      const r = color ? color.r : 1, g = color ? color.g : 1, b = color ? color.b : 1;
      for (let i = 0; i < n; i++) { ca[co] = r; ca[co + 1] = g; ca[co + 2] = b; co += 3; }
      this.col.n = co;
    }
    // flip the winding when the matrix mirrors (negative determinant)
    const flip = e ? matrix.determinant() < 0 : false;
    const I = geo.index;
    const m = I ? I.count : n;
    this.idx.reserve(m);
    const ia = this.idx.a; let io = this.idx.n;
    for (let k = 0; k < m; k += 3) {
      const a = I ? I.getX(k) : k, b = I ? I.getX(k + 1) : k + 1, c = I ? I.getX(k + 2) : k + 2;
      ia[io] = base + a; ia[io + 1] = base + (flip ? c : b); ia[io + 2] = base + (flip ? b : c); io += 3;
    }
    this.idx.n = io;
    this.count += n;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.trim(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.trim(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.trim(), 2));
    if (this.col) g.setAttribute('color', new THREE.BufferAttribute(this.col.trim(), 3));
    g.setIndex(new THREE.BufferAttribute(this.idx.trim(), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// ---------------------------------------------------------------- shared templates (lazy: built inside the station
// constructor, so the round ones pick up the preset's tessellation factor through three-lod)

const _tpl = new Map();
export function tpl(name) {
  let g = _tpl.get(name);
  if (g) return g;
  switch (name) {
    // unit hex bolt head: circumradius 1, height 1 (+Y), slightly tapered (16 triangles)
    case 'bolt': g = ringStack(6, [[1, 0], [0.86, 1]]); break;
    // low button / rivet head (unit radius, height 1; 13 triangles)
    case 'rivet': g = ringStack(5, [[1, 0], [0.5, 1]]); break;
    // flat washer / boss: unit radius, height 1
    case 'disc8': g = ringStack(8, [[1, 0], [1, 1]]); break;
    case 'disc12': g = ringStack(12, [[1, 0], [1, 1]]); break;
    // unit cylinders centred on the origin along Y (closed)
    case 'cyl6': g = new THREE.CylinderGeometry(1, 1, 1, 6, 1); break;
    case 'cyl8': g = new THREE.CylinderGeometry(1, 1, 1, 8, 1); break;
    case 'cyl12': g = new THREE.CylinderGeometry(1, 1, 1, 12, 1); break;
    case 'cyl16': g = new THREE.CylinderGeometry(1, 1, 1, 16, 1); break;
    case 'cyl16open': g = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true); break;
    case 'cone12': g = new THREE.CylinderGeometry(0.55, 1, 1, 12, 1, true); break;
    case 'box': g = new THREE.BoxGeometry(1, 1, 1); break;
    // chamfered unit-ish boxes (bevel as a fraction of the unit edge: scale them roughly uniformly)
    case 'bbox': g = bevelBox(1, 1, 1, 0.12); break;
    case 'bboxSoft': g = bevelBox(1, 1, 1, 0.22); break;
    // half torus strap (P-clamp): ring radius 1 in the XY plane, upper half
    case 'strap': g = new THREE.TorusGeometry(1, 0.16, 4, 10, Math.PI); break;
    case 'torus': g = new THREE.TorusGeometry(1, 0.12, 5, 20); break;
    case 'sphere': g = new THREE.SphereGeometry(1, 10, 6); break;
    default: throw new Error(`Detail: unknown template ${name}`);
  }
  if (!g.boundingSphere) g.computeBoundingSphere();
  _tpl.set(name, g);
  return g;
}

// ---------------------------------------------------------------- the set

export class DetailSet {
  constructor(ctx, root) {
    this.ctx = ctx;
    this.root = root;
    this.materials = ctx.materials;
    const m = ctx.materials;
    if (!m.factories.detailMetal) m.register('detailMetal', () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.42, metalness: 0.85, roughnessMap: ctx.textures.noise({ scale: 8, seed: 5 }) }));
    if (!m.factories.detailPaint) m.register('detailPaint', () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.12 }));
    const q = ctx.quality || {};
    const d = TIER_DIST[q.preset] || TIER_DIST.high;
    const mult = parseFloat(ctx.params?.get?.('detaildist')) || 1;
    this.dist = { fine: d.fine * mult, mid: d.mid * mult };
    this.anchor = null;            // current anchor Object3D (null = root)
    this.buckets = new Map();
    this.entries = [];             // { mesh, center (anchor-local), radius, tier }
    this.parts = 0;
  }

  _bucket(tier, mat, shadow, anchor, cx, cy, cz) {
    const cs = CELL[tier];
    const co = CELL_OFS[tier];
    const ck = `${Math.floor((cx + co[0]) / cs[0])},${Math.floor((cy + co[1]) / cs[1])},${Math.floor((cz + co[2]) / cs[2])}`;
    const key = `${anchor.uuid}|${mat}|${tier}|${ck}`;
    let b = this.buckets.get(key);
    if (!b) { b = { acc: new GeoAccum(mat === 'detailMetal' || mat === 'detailPaint'), mat, tier, shadow, anchor }; this.buckets.set(key, b); }
    return b;
  }

  /**
   * Add a template `geo` placed by `matrix` (anchor-local) — or an already positioned geometry (matrix null).
   * mat: 'metal' | 'paint' (vertex coloured, `color` from COL) or a library material name.
   * Detail never casts sun shadows (contact shading comes from the AO pass); `shadow` is accepted and ignored.
   */
  add(tier, mat, color, geo, matrix = null, shadow = false) {
    const anchor = this.anchor || this.root;
    if (matrix) _c.setFromMatrixPosition(matrix);
    else { if (!geo.boundingSphere) geo.computeBoundingSphere(); _c.copy(geo.boundingSphere.center); }
    // fine parts all share the metal material (painted buttons at 1-3 cm read the same): one draw per fine cell
    const name = mat === 'metal' || (mat === 'paint' && tier === 'fine') ? 'detailMetal' : mat === 'paint' ? 'detailPaint' : mat;
    this._bucket(tier, name, false, anchor, _c.x, _c.y, _c.z).acc.add(geo, matrix, color);
    this.parts++;
  }

  // ---- convenience placements (matrices are anchor-local; scratch matrices are fine as inputs) ----

  /** Hex bolt head (across-corners diameter 2r, height h) at matrix M (local +Y = out of the surface). */
  bolt(M, r = 0.012, h = 0.008, color = COL.bare, tier = 'fine') { this.add(tier, 'metal', color, tpl('bolt'), _m2.copy(M).multiply(_m.makeScale(r, h, r))); }
  rivet(M, r = 0.008, h = 0.004, color = COL.bare, tier = 'fine') { this.add(tier, 'metal', color, tpl('rivet'), _m2.copy(M).multiply(_m.makeScale(r, h, r))); }
  /** Tie-down button / painted rivet. */
  button(M, r = 0.014, h = 0.006, color = COL.offWhite, tier = 'fine') { this.add(tier, 'paint', color, tpl('rivet'), _m2.copy(M).multiply(_m.makeScale(r, h, r))); }
  /** Template scaled by (sx, sy, sz) at local offset (x, y, z) inside frame M. */
  part(tier, mat, color, name, M, x, y, z, sx, sy, sz, shadow = false) {
    _m.makeScale(sx, sy, sz).setPosition(x, y, z);
    this.add(tier, mat, color, tpl(name), _m2.copy(M).multiply(_m), shadow);
  }
  /** Template with an extra local rotation quaternion. */
  partQ(tier, mat, color, name, M, x, y, z, q, sx, sy, sz, shadow = false) {
    _m.compose(_v.set(x, y, z), q, _s.set(sx, sy, sz));
    this.add(tier, mat, color, tpl(name), _m2.copy(M).multiply(_m), shadow);
  }
  /** Cylinder template from a to b (anchor-local points), radius r. */
  rod(tier, mat, color, a, b, r, name = 'cyl8', shadow = false) {
    _v.subVectors(b, a); const len = _v.length(); if (len < 1e-5) return; _v.divideScalar(len);
    _q.setFromUnitVectors(Y, _v);
    _m.compose(_v2.addVectors(a, b).multiplyScalar(0.5), _q, _s.set(r, len, r));
    this.add(tier, mat, color, tpl(name), _m, shadow);
  }

  /** Merge every bucket into meshes under their anchors. */
  build() {
    const t0 = performance.now();
    let tris = 0;
    for (const b of this.buckets.values()) {
      if (!b.acc.count) continue;
      const geo = b.acc.build();
      const mesh = new THREE.Mesh(geo, this.materials.get(b.mat));
      mesh.name = `detail:${b.tier}:${b.mat}`;
      mesh.castShadow = b.shadow; mesh.receiveShadow = true;
      mesh.userData.noBatch = true;
      b.anchor.add(mesh);
      this.entries.push({ mesh, center: geo.boundingSphere.center.clone(), radius: geo.boundingSphere.radius, tier: b.tier });
      tris += geo.index.count / 3;
    }
    this.buckets.clear();
    this.triangles = tris;
    this.buildMs = performance.now() - t0;
    return this.entries.length;
  }

  /** Show cells within their tier distance of the camera (call once per frame; no allocations). */
  update(camera) {
    camera.getWorldPosition(_cam);
    const k = this.ctx.quality?.detailScale ?? 1;
    // inside a compartment the exterior is seen only through windows: fasteners there are not worth their triangles
    const df = this.interiorView ? -1e9 : this.dist.fine * k, dm = this.dist.mid * k;
    for (let i = 0, n = this.entries.length; i < n; i++) {
      const e = this.entries[i];
      _c.copy(e.center).applyMatrix4(e.mesh.parent.matrixWorld);
      e.mesh.visible = _c.distanceTo(_cam) - e.radius < (e.tier === 'fine' ? df : dm);
    }
  }
}

// ---------------------------------------------------------------- hardware kits
// Frames: M is a Matrix4 whose local +Y points out of the mounting surface (HullFrame.surface convention:
// X tangential, Y outward, Z along the module axis). Sizes in metres.

const _M = new THREE.Matrix4();
const _M2 = new THREE.Matrix4();
const _qa = new THREE.Quaternion();

/** Ring of `n` bolts of radius rb on a circle of radius R in the local XZ plane (normal +Y) of M, at height y. */
export function boltCircle(D, M, R, n, y = 0, rb = 0.012, hb = 0.008, color = COL.bare, tier = 'fine', phase = 0) {
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * Math.PI * 2;
    _M.makeTranslation(R * Math.cos(a), y, R * Math.sin(a));
    D.bolt(_M2.copy(M).multiply(_M), rb, hb, color, tier);
  }
}

/** Ring of `n` radial bolts (heads pointing outward) on a cylinder of radius R about the local Y axis of M, at height y. */
export function radialBolts(D, M, R, n, y = 0, rb = 0.012, hb = 0.008, color = COL.bare, tier = 'fine', phase = 0) {
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    // local frame: X tangential, Y radial, Z along the axis
    _M.set(-s, c, 0, R * c, 0, 0, 1, y, c, s, 0, R * s, 0, 0, 0, 1);
    D.bolt(_M2.copy(M).multiply(_M), rb, hb, color, tier);
  }
}

/** Bolt row from local (x0, z0) to (x1, z1) on the XZ plane of M at height y. */
export function boltRow(D, M, x0, z0, x1, z1, n, y = 0, rb = 0.01, hb = 0.007, color = COL.bare, tier = 'fine', kind = 'bolt') {
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0.5 : k / (n - 1);
    _M.makeTranslation(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t);
    if (kind === 'rivet') D.rivet(_M2.copy(M).multiply(_M), rb, hb, color, tier); else D.bolt(_M2.copy(M).multiply(_M), rb, hb, color, tier);
  }
}

/** Worksite interface fixture (WIF): bolted base plate + square socket with a dark bore and a yellow ring. */
export function wif(D, M) {
  D.part('mid', 'metal', COL.bare, 'bbox', M, 0, 0.008, 0, 0.16, 0.016, 0.16);
  D.part('mid', 'metal', COL.steel, 'bbox', M, 0, 0.055, 0, 0.075, 0.08, 0.075);
  D.part('mid', 'paint', COL.yellow, 'cyl8', M, 0, 0.098, 0, 0.034, 0.008, 0.034);
  D.part('fine', 'paint', COL.black, 'cyl8', M, 0, 0.1, 0, 0.022, 0.006, 0.022);
  for (const [x, z] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]]) { _M.makeTranslation(x, 0.016, z); D.bolt(_M2.copy(M).multiply(_M), 0.008, 0.006); }
}

/** CBM / berthing latch housing (tangential X, outward Y, axial Z): bevelled box, hook arm, bolts. */
export function latch(D, M, flip = 1) {
  D.part('mid', 'metal', COL.steel, 'bbox', M, 0, 0.06, 0, 0.16, 0.12, 0.24, true);
  D.part('mid', 'metal', COL.dark, 'bbox', M, 0, 0.13, flip * 0.05, 0.09, 0.05, 0.2);
  D.part('mid', 'metal', COL.bare, 'cyl8', M, 0, 0.13, flip * -0.06, 0.03, 0.12, 0.03);
  for (const [x, z] of [[-0.06, -0.1], [0.06, -0.1], [-0.06, 0.1], [0.06, 0.1]]) { _M.makeTranslation(x, 0.12, z); D.bolt(_M2.copy(M).multiply(_M), 0.008, 0.006); }
}

/** Connector / umbilical panel: plate with a rows×cols grid of round connectors (capped or open), bolts at corners. */
export function connectorPanel(D, M, w = 0.42, h = 0.3, cols = 3, rows = 2, seed = 0) {
  D.part('mid', 'paint', COL.gray, 'bbox', M, 0, 0.012, 0, w, 0.024, h);
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const x = (i - (cols - 1) / 2) * (w / cols), z = (j - (rows - 1) / 2) * (h / rows);
    const r = Math.min(w / cols, h / rows) * 0.3;
    const capped = ((i * 7 + j * 3 + seed) % 3) !== 0;
    D.part('mid', 'metal', COL.bare, 'cyl12', M, x, 0.05, z, r, 0.05, r);
    D.part('fine', 'metal', COL.dark, 'bolt', M, x, 0.075, z, r * 1.12, 0.018, r * 1.12);
    if (capped) D.part('fine', 'paint', (i + j + seed) % 2 ? COL.orange : COL.black, 'disc12', M, x, 0.093, z, r * 0.9, 0.022, r * 0.9);
    else D.part('fine', 'paint', COL.black, 'disc8', M, x, 0.092, z, r * 0.55, 0.004, r * 0.55);
  }
  boltRow(D, M, -w / 2 + 0.025, -h / 2 + 0.025, w / 2 - 0.025, -h / 2 + 0.025, 2, 0.024);
  boltRow(D, M, -w / 2 + 0.025, h / 2 - 0.025, w / 2 - 0.025, h / 2 - 0.025, 2, 0.024);
}

/** Louvred vent: frame + slats (w across X, d along Z). */
export function vent(D, M, w = 0.4, d = 0.3, slats = 6) {
  D.part('mid', 'metal', COL.dark, 'bbox', M, 0, 0.02, 0, w, 0.04, d);
  for (let k = 0; k < slats; k++) {
    const z = (k + 0.5 - slats / 2) * (d - 0.06) / slats;
    D.partQ('fine', 'metal', COL.darkGray, 'box', M, 0, 0.045, z, _qa.setFromAxisAngle(_v.set(1, 0, 0), 0.6), w - 0.05, 0.006, (d - 0.06) / slats * 0.9);
  }
  boltRow(D, M, -w / 2 + 0.015, -d / 2 + 0.015, -w / 2 + 0.015, d / 2 - 0.015, 2, 0.04, 0.007, 0.005);
  boltRow(D, M, w / 2 - 0.015, -d / 2 + 0.015, w / 2 - 0.015, d / 2 - 0.015, 2, 0.04, 0.007, 0.005);
}

/** P-clamp around a line of radius r: strap half-loop over the line + base block + bolt (line along local Z). */
export function pClamp(D, M, r, color = COL.bare, tier = 'mid') {
  const k = r + 0.012;
  _M.compose(_v.set(0, 0, 0), _qa.identity(), _s.set(k, k, 0.12));
  D.add(tier, 'metal', color, tpl('strap'), _M2.copy(M).multiply(_M));
  D.part(tier, 'metal', color, 'box', M, -k - 0.015, -r * 0.4, 0, 0.04, 0.02, 0.03);
  D.part(tier, 'metal', color, 'box', M, k + 0.015, -r * 0.4, 0, 0.04, 0.02, 0.03);
  _M.makeTranslation(k + 0.015, -r * 0.4 + 0.01, 0); D.bolt(_M2.copy(M).multiply(_M), 0.007, 0.006, COL.bare, 'fine');
}

/** Stand-off foot: round boss on a square bolted pad (handrail stanchions, MMOD standoffs). */
export function standoffFoot(D, M, pad = 0.07, boss = 0.022, tier = 'mid', color = COL.steel) {
  D.part(tier, 'metal', color, 'bbox', M, 0, 0.006, 0, pad, 0.012, pad);
  D.part(tier, 'metal', color, 'disc8', M, 0, 0.012, 0, boss * 1.4, 0.012, boss * 1.4);
  const o = pad / 2 - 0.012;
  for (const [x, z] of [[-o, -o], [o, -o], [-o, o], [o, o]]) { _M.makeTranslation(x, 0.012, z); D.bolt(_M2.copy(M).multiply(_M), 0.0065, 0.005, COL.bare, 'fine'); }
}
