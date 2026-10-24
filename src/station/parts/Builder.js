import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYERS } from '../../core/constants.js';

/**
 * Geometry helpers shared by all station parts.
 *
 * Builder collects geometries per material and merges them into one mesh per
 * (material, shadow flag) pair, so a whole station part costs a handful of draw calls.
 * Instancer collects matrices for a repeated small part and emits one InstancedMesh.
 */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
export const Y_AXIS = new THREE.Vector3(0, 1, 0);
export const X_AXIS = new THREE.Vector3(1, 0, 0);
export const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** Texture scale: one hull-texture repeat per this many meters. */
export const TEX_M = 6.5;

export function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

/** Swap u and v (used for decals whose text must run along a cylinder axis). */
export function swapUV(geo, flipU = false, flipV = false) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i), v = uv.getY(i);
    if (flipU) u = 1 - u; if (flipV) v = 1 - v;
    uv.setXY(i, v, u);
  }
  return geo;
}

/** Turn a closed geometry inside-out (for interiors seen from within). */
export function flipInside(geo) {
  const idx = geo.index;
  if (idx) { for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i); idx.setX(i, idx.getX(i + 2)); idx.setX(i + 2, a); } }
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return geo;
}

/** Matrix: translate (+ optional quaternion / scale). */
export function mat(x, y, z, quat = null, scale = null) {
  _v.set(x, y, z);
  return new THREE.Matrix4().compose(_v, quat || _q.identity(), scale || _s.set(1, 1, 1));
}

/** Quaternion rotating local +Y to `dir`. */
export function quatY(dir) { return new THREE.Quaternion().setFromUnitVectors(Y_AXIS, _v.copy(dir).normalize()); }
/** Quaternion rotating local +Z to `dir`. */
export function quatZ(dir) { return new THREE.Quaternion().setFromUnitVectors(Z_AXIS, _v.copy(dir).normalize()); }

/** Cylinder (axis Y by default) from point a to b, radius r. */
export function tubeAB(a, b, r, seg = 8, rb = r) {
  const dir = _v.subVectors(b, a); const len = dir.length(); dir.normalize();
  const g = new THREE.CylinderGeometry(rb, r, len, seg, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir);
  g.applyMatrix4(_m.compose(_s.copy(a).lerp(b, 0.5), q, _v.set(1, 1, 1)));
  return g;
}

/** Cylinder of radius r and length len with its axis along `dir` centred at c. */
export function tubeAt(c, dir, r, len, seg = 16, opts = {}) {
  const g = new THREE.CylinderGeometry(opts.rTop ?? r, r, len, seg, opts.hseg ?? 1, !!opts.open, opts.thetaStart ?? 0, opts.thetaLength ?? Math.PI * 2);
  if (opts.uv !== false) scaleUV(g, (2 * Math.PI * r) / TEX_M * (opts.thetaLength ? opts.thetaLength / (2 * Math.PI) : 1), len / TEX_M);
  g.applyMatrix4(_m.compose(c, quatY(dir), _v.set(1, 1, 1)));
  return g;
}

/** Box w×h×d centred at c with optional quaternion; UVs scaled to TEX_M. */
export function boxAt(c, w, h, d, quat = null, uvScale = true) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (uvScale) {
    // BoxGeometry uv per face is 0..1: scale by the face size (approximate with max dims)
    const uv = g.attributes.uv; const f = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let i = 0; i < uv.count; i++) { const face = Math.floor(i / 4); uv.setXY(i, uv.getX(i) * f[face][0] / TEX_M, uv.getY(i) * f[face][1] / TEX_M); }
  }
  g.applyMatrix4(_m.compose(c, quat || _q.identity(), _v.set(1, 1, 1)));
  return g;
}

/** Shallow dome (half sphere squashed along its axis) with its base at c, bulging along `dir`. */
export function domeAt(c, dir, r, depth, seg = 48) {
  const g = new THREE.SphereGeometry(r, seg, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1, depth / r, 1);
  scaleUV(g, (2 * Math.PI * r) / TEX_M, (Math.PI * r) / TEX_M);
  g.applyMatrix4(_m.compose(c, quatY(dir), _v.set(1, 1, 1)));
  return g;
}

export function sphereAt(c, r, ws = 16, hs = 12, quat = null) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  scaleUV(g, (2 * Math.PI * r) / TEX_M, (Math.PI * r) / TEX_M);
  g.applyMatrix4(_m.compose(c, quat || _q.identity(), _v.set(1, 1, 1)));
  return g;
}

/** Torus with axis along `dir`, centre c. */
export function torusAt(c, dir, R, r, rs = 8, ts = 32, arc = Math.PI * 2) {
  const g = new THREE.TorusGeometry(R, r, rs, ts, arc);
  g.applyMatrix4(_m.compose(c, quatZ(dir), _v.set(1, 1, 1)));
  return g;
}

/**
 * Ring with a cross-section `profile` [[radius, axialOffset], ...] around the axis `dir` through c: flanges,
 * weld lands, gaskets, berthing rings. Each profile segment is its own lathe strip, so corners stay crisp
 * (flat normals per segment). Walk the profile counter-clockwise in (r, y) — outward wall upward, top face
 * inward — for outward-facing surfaces.
 */
export function latheAt(c, dir, profile, seg = 48) {
  const parts = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    if (Math.abs(r0 - r1) < 1e-6 && Math.abs(y0 - y1) < 1e-6) continue;
    const g = new THREE.LatheGeometry([new THREE.Vector2(r0, y0), new THREE.Vector2(r1, y1)], seg);
    const uv = g.attributes.uv, circ = 2 * Math.PI * Math.max(r0, r1) / TEX_M, l = Math.hypot(r1 - r0, y1 - y0) / TEX_M;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * circ, uv.getY(k) * l);
    parts.push(g);
  }
  const g = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (parts.length > 1) for (const p of parts) p.dispose();
  g.applyMatrix4(_m.compose(c, quatY(dir), _v.set(1, 1, 1)));
  return g;
}

/**
 * Run `fn` with the three-lod tessellation factor at 1: for shapes whose segment count is a design value
 * (hexagonal rings, six-sided frusta) and must not be scaled by the preset's detail factor.
 */
export function exact(fn) {
  const f = globalThis.__THREE_DETAIL;
  globalThis.__THREE_DETAIL = 1;
  try { return fn(); } finally { globalThis.__THREE_DETAIL = f; }
}

/** Box w×h×d with chamfered edges (bevel b) centred at c, optional quaternion; planar UVs in TEX_M. */
export function bevelBoxAt(c, w, h, d, quat = null, bevel = Math.min(w, h, d) * 0.12) {
  const g = bevelBox(w, h, d, bevel);
  g.applyMatrix4(_m.compose(c, quat || _q.identity(), _v.set(1, 1, 1)));
  return g;
}

/** Thin plane (PlaneGeometry, normal +Z) placed by matrix. */
export function planeAt(w, h, matrix) {
  const g = new THREE.PlaneGeometry(w, h);
  g.applyMatrix4(matrix);
  return g;
}

/* ---------------------------------------------------------------- flat-shaded convex primitives */


/** Small polygon mesh builder: convex faces, flat normals (outward from `center`), planar UVs in metres / TEX_M. */
export class Poly {
  constructor(center = new THREE.Vector3()) { this.center = center; this.p = []; this.n = []; this.uv = []; this.i = []; }
  face(pts) {
    // Newell normal
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      nx += (a.y - b.y) * (a.z + b.z); ny += (a.z - b.z) * (a.x + b.x); nz += (a.x - b.x) * (a.y + b.y);
      cx += a.x; cy += a.y; cz += a.z;
    }
    cx /= pts.length; cy /= pts.length; cz /= pts.length;
    let l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    let order = pts;
    if (nx * (cx - this.center.x) + ny * (cy - this.center.y) + nz * (cz - this.center.z) < 0) { nx = -nx; ny = -ny; nz = -nz; order = pts.slice().reverse(); }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const base = this.p.length / 3;
    for (const q of order) {
      this.p.push(q.x, q.y, q.z); this.n.push(nx, ny, nz);
      if (ax >= ay && ax >= az) this.uv.push(q.z / TEX_M, q.y / TEX_M); else if (ay >= az) this.uv.push(q.x / TEX_M, q.z / TEX_M); else this.uv.push(q.x / TEX_M, q.y / TEX_M);
    }
    for (let k = 1; k < order.length - 1; k++) this.i.push(base, base + k, base + k + 1);
    return this;
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}

const P3 = (x, y, z) => new THREE.Vector3(x, y, z);

/** Box w×h×d centred at the origin with chamfered edges (bevel b): 44 triangles, flat shaded. */
export function bevelBox(w, h, d, b = Math.min(w, h, d) * 0.12) {
  const X = w / 2, Yh = h / 2, Z = d / 2;
  b = Math.min(b, X * 0.9, Yh * 0.9, Z * 0.9);
  const pl = new Poly();
  const pt = (sx, sy, sz, k) => k === 0 ? P3(sx * X, sy * (Yh - b), sz * (Z - b)) : k === 1 ? P3(sx * (X - b), sy * Yh, sz * (Z - b)) : P3(sx * (X - b), sy * (Yh - b), sz * Z);
  const S = [-1, 1];
  // main faces
  for (const s of S) {
    pl.face([pt(s, -1, -1, 0), pt(s, 1, -1, 0), pt(s, 1, 1, 0), pt(s, -1, 1, 0)]);
    pl.face([pt(-1, s, -1, 1), pt(1, s, -1, 1), pt(1, s, 1, 1), pt(-1, s, 1, 1)]);
    pl.face([pt(-1, -1, s, 2), pt(1, -1, s, 2), pt(1, 1, s, 2), pt(-1, 1, s, 2)]);
  }
  // edge chamfers
  for (const sa of S) for (const sb of S) {
    pl.face([pt(sa, sb, -1, 0), pt(sa, sb, 1, 0), pt(sa, sb, 1, 1), pt(sa, sb, -1, 1)]);   // along Z
    pl.face([pt(-1, sa, sb, 1), pt(1, sa, sb, 1), pt(1, sa, sb, 2), pt(-1, sa, sb, 2)]);   // along X
    pl.face([pt(sa, -1, sb, 0), pt(sa, 1, sb, 0), pt(sa, 1, sb, 2), pt(sa, -1, sb, 2)]);   // along Y
  }
  // corners
  for (const sx of S) for (const sy of S) for (const sz of S) pl.face([pt(sx, sy, sz, 0), pt(sx, sy, sz, 1), pt(sx, sy, sz, 2)]);
  return pl.geo();
}

/**
 * Convex plate: polygon `pts` ([[x, y], ...] in the XY plane, any winding) extruded along Z by `t` (centred), with
 * the rim chamfered by `c` (0 = square edges). Closed, flat shaded; planar UVs in metres / TEX_M.
 */
export function plate(pts, t, c = 0) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const pl = new Poly(P3(cx, cy, 0));
  // inset polygon for the chamfered faces (move each vertex toward the centroid by c)
  const inset = pts.map(([x, y]) => { const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1; return [x - dx / l * c, y - dy / l * c]; });
  const h = t / 2, hc = Math.max(0, h - c);
  const top = inset.map(([x, y]) => P3(x, y, h)), bot = inset.map(([x, y]) => P3(x, y, -h));
  const midT = pts.map(([x, y]) => P3(x, y, hc)), midB = pts.map(([x, y]) => P3(x, y, -hc));
  pl.face(top); pl.face(bot);
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    pl.face([midB[k], midB[k1], midT[k1], midT[k]]);
    if (c > 0) { pl.face([top[k], top[k1], midT[k1], midT[k]]); pl.face([bot[k], bot[k1], midB[k1], midB[k]]); }
  }
  return pl.geo();
}

/**
 * Prism / frustum stack along +Y from rings [[r, y], ...] with `sides` sides (flat shaded), optional top cap.
 * Used for hex bolts, rivets, buttons, bosses.
 */
export function ringStack(sides, rings, { top = true, bottom = false, phase = Math.PI / sides } = {}) {
  const pl = new Poly(P3(0, (rings[0][1] + rings[rings.length - 1][1]) / 2, 0));
  const ring = (r, y) => { const a = []; for (let k = 0; k < sides; k++) { const t = phase + (k / sides) * Math.PI * 2; a.push(P3(r * Math.cos(t), y, r * Math.sin(t))); } return a; };
  const R = rings.map(([r, y]) => ring(r, y));
  for (let j = 0; j < R.length - 1; j++) {
    const a = R[j], b = R[j + 1];
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      if (rings[j + 1][0] < 1e-6) pl.face([a[k], a[k1], b[k]]);
      else if (rings[j][0] < 1e-6) pl.face([a[k], b[k1], b[k]]);
      else pl.face([a[k], a[k1], b[k1], b[k]]);
    }
  }
  const last = R[R.length - 1];
  if (top && rings[rings.length - 1][0] > 1e-6) pl.face(last);
  if (bottom && rings[0][0] > 1e-6) pl.face(R[0]);
  return pl.geo();
}

/** Every text decal built by any Builder (static station frame only): { text, position }. Station copies it into `station.labels`. */
export const LABELS = [];

export class Builder {
  constructor(materials) {
    this.materials = materials;
    this.buckets = new Map();   // key -> { material, geos, shadow }
    this.labelsDynamic = false; // set true on builders whose parent moves (ring): their labels are not registered
    this.detail = null;         // DetailSet for close-range hardware (Detail.js); null on 'lite'
  }

  /** Add a geometry (already positioned) to the bucket of material `name`. `shadow` false = tiny emissive/detail part. */
  add(name, geo, shadow = true, materialOverride = null) {
    const key = materialOverride ? `${name}#${materialOverride.uuid}#${shadow}` : `${name}#${shadow}`;
    let b = this.buckets.get(key);
    if (!b) { b = { material: materialOverride || this.materials.get(name), geos: [], shadow, name }; this.buckets.set(key, b); }
    b.geos.push(geo);
    return geo;
  }

  /** Text decal (plane w×h, normal +Z before `matrix`). Uses materials.label(text) (one draw call per unique text). */
  label(text, w, h, matrix, opts = {}) {
    const texOpts = { width: opts.width ?? 1024, height: opts.height ?? 128, color: opts.color ?? '#1b1f24', font: opts.font ?? 'bold 90px "Segoe UI", Arial, sans-serif', bg: opts.bg ?? null };
    const g = planeAt(w, h, matrix);
    if (opts.swap) swapUV(g, !!opts.flipU, !!opts.flipV);
    if (!this.labelsDynamic) LABELS.push({ text, position: new THREE.Vector3().setFromMatrixPosition(matrix), width: w });
    return this.add('label', g, false, this.materials.label(text, texOpts));
  }

  /** Text decal centred at p with outward normal n; text reads left-to-right for a viewer facing -n with +Y up. */
  labelAt(text, w, h, p, n, opts = {}) {
    const nn = _v.copy(n).normalize();
    const right = opts.right ? _s.copy(opts.right).normalize() : _s.crossVectors(Y_AXIS, nn).normalize();
    const up = new THREE.Vector3().crossVectors(nn, right);
    const M = new THREE.Matrix4().makeBasis(right, up, nn).setPosition(p);
    return this.label(text, w, h, M, opts);
  }

  /** Merge every bucket into a mesh under `parent`. Returns the meshes. */
  build(parent, { name = 'part', noShadowLayer = true } = {}) {
    const meshes = [];
    for (const b of this.buckets.values()) {
      if (!b.geos.length) continue;
      const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
      if (!merged) { console.warn('[Station] merge failed for', b.name); continue; }
      if (b.geos.length > 1) for (const g of b.geos) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, b.material);
      mesh.name = `${name}:${b.name}`;
      mesh.castShadow = b.shadow; mesh.receiveShadow = true;
      if (!b.shadow && noShadowLayer && (b.material.emissive && b.material.emissiveIntensity > 1)) mesh.layers.set(LAYERS.NO_SHADOW);
      if (b.material.transparent) { mesh.renderOrder = 10; mesh.receiveShadow = false; }
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}

/** Collects instance matrices for one small geometry and emits an InstancedMesh. */
export class Instancer {
  constructor(geometry, material, { shadow = false, name = 'inst' } = {}) {
    this.geometry = geometry; this.material = material; this.shadow = shadow; this.name = name;
    this.matrices = [];
  }
  add(matrix) { this.matrices.push(matrix.clone()); }
  /** Unit cylinder (r=1, h=1 along Y) instance along segment a-b with radius r. */
  addSegment(a, b, r) {
    const dir = _v.subVectors(b, a); const len = dir.length(); if (len < 1e-6) return; dir.normalize();
    _q.setFromUnitVectors(Y_AXIS, dir);
    this.matrices.push(new THREE.Matrix4().compose(_s.copy(a).lerp(b, 0.5), _q, new THREE.Vector3(r, len, r)));
  }
  build(parent) {
    const n = this.matrices.length;
    if (!n) return null;
    const im = new THREE.InstancedMesh(this.geometry, this.material, n);
    for (let i = 0; i < n; i++) im.setMatrixAt(i, this.matrices[i]);
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = this.shadow; im.receiveShadow = true;
    im.name = this.name;
    im.computeBoundingSphere();
    parent.add(im);
    this.matrices.length = 0;
    return im;
  }
}

/** Shared unit geometries (cached). */
const _unit = {};
export function unitCylinder(seg = 6) { return _unit[`cyl${seg}`] || (_unit[`cyl${seg}`] = new THREE.CylinderGeometry(1, 1, 1, seg, 1)); }
export function unitBox() { return _unit.box || (_unit.box = new THREE.BoxGeometry(1, 1, 1)); }

/** Collider factories (world/station frame). */
export const Colliders = {
  capsule(a, b, radius, name = '', dynamic = false) { return { type: 'capsule', a: a.clone(), b: b.clone(), radius, name, dynamic }; },
  sphere(center, radius, name = '', dynamic = false) { return { type: 'sphere', center: center.clone(), radius, name, dynamic }; },
  box(center, halfSize, quaternion = null, name = '', dynamic = false) { return { type: 'box', center: center.clone(), halfSize: halfSize.clone(), quaternion: quaternion ? quaternion.clone() : new THREE.Quaternion(), name, dynamic }; },
};

/**
 * A cylindrical module description + helpers to place features on its hull.
 * Local frame: cylinder axis = local Y, placed by `frame` (position + quaternion).
 */
export class HullFrame {
  constructor(center, dir, radius, length, name = '') {
    this.center = center.clone(); this.dir = dir.clone().normalize(); this.r = radius; this.len = length; this.name = name;
    this.quat = quatY(this.dir);
    this.invQuat = this.quat.clone().invert();
    this.frame = new THREE.Matrix4().compose(this.center, this.quat, new THREE.Vector3(1, 1, 1));
  }
  /** Angle around the axis at which the hull normal points along `worldDir` (projected). */
  thetaFor(worldDir) { const l = _v.copy(worldDir).applyQuaternion(this.invQuat); return Math.atan2(l.z, l.x); }
  /** Matrix placing a feature at axial offset t, angle theta, radial distance rho. Feature local: X tangential, Y outward normal, Z along axis. */
  surface(t, theta, rho, out = new THREE.Matrix4()) {
    const c = Math.cos(theta), s = Math.sin(theta);
    out.set(-s, c, 0, rho * c,
      0, 0, 1, t,
      c, s, 0, rho * s,
      0, 0, 0, 1);
    return out.premultiply(this.frame);
  }
  /** World point on the axis at offset t. */
  axisPoint(t, out = new THREE.Vector3()) { return out.copy(this.dir).multiplyScalar(t).add(this.center); }
  /** World point on the hull at (t, theta, rho). */
  point(t, theta, rho, out = new THREE.Vector3()) { return out.set(rho * Math.cos(theta), t, rho * Math.sin(theta)).applyMatrix4(this.frame); }
  /** World outward normal at theta. */
  normal(theta, out = new THREE.Vector3()) { return out.set(Math.cos(theta), 0, Math.sin(theta)).applyQuaternion(this.quat); }
  endA(out = new THREE.Vector3()) { return this.axisPoint(-this.len / 2, out); }
  endB(out = new THREE.Vector3()) { return this.axisPoint(this.len / 2, out); }
}
