import * as THREE from 'three';

/**
 * Skinned mesh builder for the astronaut rigs (suit and crew clothing).
 *
 * Parts are generated in the bind pose, in body space (metres; +Y up, +Z forward, +X = the body's left,
 * origin on the floor between the feet). Every vertex carries up to two bone influences (skinIndex /
 * skinWeight), a linear vertex colour (tints the tiling PBR textures: stripes, grime, coloured cloth) and
 * UVs in metres (the materials scale them to their texture tile). Vertices are collected per material key;
 * `build()` returns one BufferGeometry per key, ready for a SkinnedMesh.
 *
 * Primitives: loft (superellipse rings, the workhorse for limbs, torso, helmet, boxes), sweep (rings along
 * a path with parallel-transport frames), lathe, rounded box, ellipsoid, torus, disc, flat / curved patches
 * (decals with atlas UVs). All take a `detail` factor (segment counts scale, with sane minimums) so the same
 * code produces every LOD.
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;

/** Hash-based value noise in 3D (deterministic, ~0..1), for grime / colour variation baked into vertices. */
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const h = (i, j, k) => { const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), sx), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), sx), sy),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), sx), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), sx), sy), sz);
}
export function fbm3(x, y, z, oct = 3) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { v += a * noise3(x * f, y * f, z * f); a *= 0.5; f *= 2.03; } return v; }

/** Orthonormal frame helpers. */
export function perpTo(v, out = new THREE.Vector3()) {
  if (Math.abs(v.y) < 0.9) out.set(0, 1, 0); else out.set(1, 0, 0);
  return out.addScaledVector(v, -out.dot(v)).normalize();
}

class Bucket {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.si = []; this.sw = []; this.idx = []; this.count = 0; }
}

export class SkinBuilder {
  /**
   * @param {Map<string, number>} boneIndex bone name -> index
   * @param {number} detail tessellation factor (1 = LOD0)
   */
  constructor(boneIndex, detail = 1) {
    this.boneIndex = boneIndex;
    this.detail = detail;
    this.buckets = new Map();
    this._mat = 'fabric';
    this._col = [1, 1, 1];
    this._skin = null;          // (p) -> [i0, w0, i1, w1]
    this._skinRigid = [0, 1, 0, 0];
    this._colorFn = null;       // (p, n, rgbOut) -> void (modifies)
    this.tris = 0;
    this.tag = '';              // optional filter tag (e.g. 'fpHide'); parts with a filtered tag are skipped
    this.skipTags = null;
    this.atlas = null;
  }

  /** Segment count scaled by the detail factor. */
  seg(n, min = 3) { return Math.max(min, Math.round(n * this.detail)); }

  mat(key) { this._mat = key; return this; }
  color(c) {
    if (typeof c === 'number') { const t = new THREE.Color(c); this._col = [t.r, t.g, t.b]; } else if (Array.isArray(c)) this._col = c.slice(0, 3); else this._col = [c.r, c.g, c.b];
    return this;
  }
  colorFn(fn) { this._colorFn = fn; return this; }
  /** Rigid binding to one bone. */
  bone(name) {
    const i = this.boneIndex.get(name);
    if (i === undefined) throw new Error(`SkinBuilder: unknown bone ${name}`);
    this._skin = null; this._skinRigid = [i, 1, 0, 0];
    return this;
  }
  /** Linear blend from bone a (at p0) to bone b (at p1) along the segment p0 -> p1 (smoothstep). */
  blend(a, b, p0, p1) {
    const ia = this.boneIndex.get(a), ib = this.boneIndex.get(b);
    if (ia === undefined || ib === undefined) throw new Error(`SkinBuilder: unknown bone ${a}/${b}`);
    const d = p1.clone().sub(p0); const L2 = Math.max(d.lengthSq(), 1e-9); const o = p0.clone();
    this._skin = (p) => { const t = sstep(0, 1, _p.copy(p).sub(o).dot(d) / L2); return [ia, 1 - t, ib, t]; };
    return this;
  }
  /** Custom skin function (p) -> [i0, w0, i1, w1] (bone indices, weights). */
  skinFn(fn) { this._skin = fn; return this; }
  /** Decal atlas rectangle (needs B.atlas). */
  atlasUV(name) { return this.atlas ? this.atlas.uv(name) : { u0: 0, v0: 0, u1: 0.001, v1: 0.001 }; }
  /** Helper for custom skin functions. */
  bi(name) { return this.boneIndex.get(name); }

  /** Is the current tag filtered out? */
  get skip() { return !!(this.skipTags && this.tag && this.skipTags.has(this.tag)); }

  _bucket() { let b = this.buckets.get(this._mat); if (!b) { b = new Bucket(); this.buckets.set(this._mat, b); } return b; }

  _vert(b, p, n, u, v, col = null) {
    b.pos.push(p.x, p.y, p.z); b.nrm.push(n.x, n.y, n.z); b.uv.push(u, v);
    let c = col || this._col;
    if (this._colorFn) { const o = [c[0], c[1], c[2]]; this._colorFn(p, n, o); c = o; }
    b.col.push(c[0], c[1], c[2]);
    const s = this._skin ? this._skin(p) : this._skinRigid;
    if (s[3] > 0.999) { b.si.push(s[2], s[0], 0, 0); b.sw.push(1, 0, 0, 0); } else { b.si.push(s[0], s[2], 0, 0); b.sw.push(s[1], s[3], 0, 0); }
    return b.count++;
  }

  // ------------------------------------------------------------------------------------------ loft
  /**
   * Loft through rings. ring = { c: Vector3 centre, ax, ay: Vector3 unit section axes, rx, ry, e (superellipse
   * exponent, 2 = ellipse), r?: (theta) -> radial multiplier, col?: [r,g,b] ring colour, v?: explicit V }.
   * The surface normal points away from the ring centre for right-handed (ax, ay, ax x ay = path direction).
   * opts: { n: segments around (before detail), capStart, capEnd, t0, t1 (partial: fraction of the turn),
   *         uScale (metres per U unit, default perimeter-based), flip, colFn: (ringIndex, theta) -> rgb }
   */
  loft(rings, opts = {}) {
    if (this.skip || rings.length < 2) return;
    const n = this.seg(opts.n ?? 24, opts.nMin ?? 4);
    const partial = opts.t0 !== undefined || opts.t1 !== undefined;
    const t0 = opts.t0 ?? 0, t1 = opts.t1 ?? 1;
    const cols = partial ? n + 1 : n;
    const R = rings.length;
    // grid of points
    const P = new Array(R * cols);
    for (let j = 0; j < R; j++) {
      const g = rings[j];
      const e = g.e ?? 2, ex = 2 / e;
      for (let i = 0; i < cols; i++) {
        const th = (t0 + (t1 - t0) * (i / (partial ? n : n))) * Math.PI * 2;
        const cs = Math.cos(th), sn = Math.sin(th);
        let x = Math.sign(cs) * Math.pow(Math.abs(cs), ex) * g.rx, y = Math.sign(sn) * Math.pow(Math.abs(sn), ex) * g.ry;
        if (g.r) { const m = g.r(th); x *= m; y *= m; }
        if (g.ox) x += g.ox; if (g.oy) y += g.oy;
        P[j * cols + i] = new THREE.Vector3().copy(g.c).addScaledVector(g.ax, x).addScaledVector(g.ay, y);
      }
    }
    // normals: cross of the around / along tangents (wrapping around for closed rings)
    const N = new Array(R * cols);
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < cols; i++) {
        const ip = partial ? Math.min(i + 1, cols - 1) : (i + 1) % cols, im = partial ? Math.max(i - 1, 0) : (i - 1 + cols) % cols;
        const jp = Math.min(j + 1, R - 1), jm = Math.max(j - 1, 0);
        _a.subVectors(P[j * cols + ip], P[j * cols + im]);
        _b.subVectors(P[jp * cols + i], P[jm * cols + i]);
        const nn = new THREE.Vector3().crossVectors(_a, _b);
        if (nn.lengthSq() < 1e-14) { // degenerate (pole): radial from the ring centre
          nn.subVectors(P[j * cols + i], rings[j].c);
          if (nn.lengthSq() < 1e-14) nn.crossVectors(rings[j].ax, rings[j].ay).multiplyScalar(j === 0 ? -1 : 1);
        }
        nn.normalize();
        if (opts.flip) nn.negate();
        N[j * cols + i] = nn;
      }
    }
    // UVs in metres: U = arc length around the mean perimeter, V = distance along the centres
    const b = this._bucket();
    const base = b.count;
    let vAcc = 0;
    const per = [];
    for (let j = 0; j < R; j++) {
      let L = 0; for (let i = 1; i < cols; i++) L += P[j * cols + i].distanceTo(P[j * cols + i - 1]);
      if (!partial) L += P[j * cols].distanceTo(P[j * cols + cols - 1]);
      per.push(L);
    }
    const meanPer = per.reduce((s, x) => s + x, 0) / R;
    const uLen = opts.uLen ?? meanPer;
    for (let j = 0; j < R; j++) {
      if (j > 0) vAcc += rings[j].c.distanceTo(rings[j - 1].c) + 0.5 * Math.abs((rings[j].rx + rings[j].ry) - (rings[j - 1].rx + rings[j - 1].ry)) * 0.5;
      const v = rings[j].v ?? vAcc;
      const ringCol = rings[j].col || null;
      for (let i = 0; i <= cols - (partial ? 1 : 0); i++) {
        const ii = i % cols;
        const u = (i / (partial ? cols - 1 : cols)) * uLen;
        const col = opts.colFn ? opts.colFn(j, (t0 + (t1 - t0) * (i / (partial ? n : n))) * Math.PI * 2) : ringCol;
        this._vert(b, P[j * cols + ii], N[j * cols + ii], u, v, col);
      }
    }
    const stride = partial ? cols : cols + 1;
    for (let j = 0; j < R - 1; j++) {
      for (let i = 0; i < stride - 1; i++) {
        const a = base + j * stride + i, c = a + stride;
        if (opts.flip) b.idx.push(a, c, a + 1, a + 1, c, c + 1); else b.idx.push(a, a + 1, c, a + 1, c + 1, c);
        this.tris += 2;
      }
    }
    if (!partial) {
      if (opts.capStart) this._cap(rings[0], P, 0, cols, true, opts);
      if (opts.capEnd) this._cap(rings[R - 1], P, (R - 1) * cols, cols, false, opts);
    }
  }

  _cap(ring, P, off, cols, start, opts) {
    const b = this._bucket();
    const nn = new THREE.Vector3().crossVectors(ring.ax, ring.ay).normalize();
    if (start) nn.negate();
    if (opts.flip) nn.negate();
    const c = ring.c.clone();
    if (ring.ox || ring.oy) c.addScaledVector(ring.ax, ring.ox || 0).addScaledVector(ring.ay, ring.oy || 0);
    const ci = this._vert(b, c, nn, 0, 0, ring.col || null);
    const first = b.count;
    for (let i = 0; i < cols; i++) {
      const p = P[off + i];
      _d.subVectors(p, c);
      this._vert(b, p, nn, _d.dot(ring.ax), _d.dot(ring.ay), ring.col || null);
    }
    const flip = start !== !!opts.flip;
    for (let i = 0; i < cols; i++) {
      const a = first + i, d = first + ((i + 1) % cols);
      if (flip) b.idx.push(ci, d, a); else b.idx.push(ci, a, d);
      this.tris++;
    }
  }

  // ------------------------------------------------------------------------------------------ derived shapes
  /**
   * Sweep along a polyline path with parallel-transport frames. sections: (t, k) -> { rx, ry, e, r, col, ox, oy }
   * t = 0..1 along the path (by length). ref: initial section X axis hint.
   */
  sweep(path, section, opts = {}) {
    if (this.skip) return;
    const pts = path;
    const M = pts.length;
    const L = [0];
    for (let i = 1; i < M; i++) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = L[M - 1] || 1;
    const T = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b2 = pts[Math.min(M - 1, i + 1)];
      return new THREE.Vector3().subVectors(b2, a).normalize();
    });
    let X = opts.ref ? opts.ref.clone() : perpTo(T[0]);
    X.addScaledVector(T[0], -X.dot(T[0])).normalize();
    const rings = [];
    for (let i = 0; i < M; i++) {
      if (i > 0) { // parallel transport
        const q = new THREE.Quaternion().setFromUnitVectors(T[i - 1], T[i]);
        X.applyQuaternion(q); X.addScaledVector(T[i], -X.dot(T[i])).normalize();
      }
      const Y = new THREE.Vector3().crossVectors(T[i], X);
      const s = section(L[i] / total, i);
      rings.push({ c: pts[i], ax: X.clone(), ay: Y, ...s });
    }
    this.loft(rings, opts);
  }

  /** Straight tube / limb from a to b with radius profile prof(t) -> r (or {rx, ry, e, ox, oy}), K rings. */
  limb(a, b, prof, opts = {}) {
    const K = Math.max(2, this.seg(opts.k ?? 12, 2));
    const pts = [];
    const tk = opts.tk || ((i) => i / (K - 1));
    for (let i = 0; i < K; i++) pts.push(new THREE.Vector3().lerpVectors(a, b, tk(i, K)));
    this.sweep(pts, (t, i) => { const r = prof(tk(i, K)); return typeof r === 'number' ? { rx: r, ry: r } : r; }, opts);
  }

  /** Lathe about an axis: profile [[r, h], ...] (h along axis from origin). */
  lathe(origin, axis, profile, opts = {}) {
    if (this.skip) return;
    const ax = axis.clone().normalize();
    const X = opts.ref ? opts.ref.clone().addScaledVector(ax, -opts.ref.dot(ax)).normalize() : perpTo(ax);
    const Y = new THREE.Vector3().crossVectors(ax, X);
    const rings = profile.map(([r, h, col]) => ({ c: origin.clone().addScaledVector(ax, h), ax: X, ay: Y, rx: Math.max(r, 1e-5), ry: Math.max(r, 1e-5), e: opts.e ?? 2, col }));
    this.loft(rings, opts);
  }

  /** Torus (ring) in the plane perpendicular to axis. */
  torus(center, axis, R, r, opts = {}) {
    if (this.skip) return;
    const ax = axis.clone().normalize();
    const X = opts.ref ? opts.ref.clone().addScaledVector(ax, -opts.ref.dot(ax)).normalize() : perpTo(ax);
    const Y = new THREE.Vector3().crossVectors(ax, X);
    const m = this.seg(opts.n ?? 32, 6);
    const pts = [];
    for (let i = 0; i <= m; i++) { const t = (i / m) * Math.PI * 2; pts.push(center.clone().addScaledVector(X, Math.cos(t) * R).addScaledVector(Y, Math.sin(t) * R)); }
    // sweep closed path: duplicate end point; tube cross-section
    this.sweep(pts, () => ({ rx: r * (opts.sx ?? 1), ry: r * (opts.sy ?? 1), e: opts.e ?? 2 }), { n: opts.tube ?? 8, ref: ax, nMin: 3 });
  }

  /** Rounded box: centre, axes (unit x, y, z), half sizes, corner radius (as a superellipse section along y). */
  rbox(c, ax, ay, az, hx, hy, hz, opts = {}) {
    if (this.skip) return;
    const bev = Math.min(opts.bevel ?? 0.15 * Math.min(hx, hy, hz), hy * 0.99, hx * 0.99, hz * 0.99);
    const e = opts.e ?? 6;
    // section in the (az, ax) plane, path along +ay ... loft wants right-handed (ax_s, ay_s, path): (az, ax) x -> ay
    const ring = (y, sx) => ({ c: c.clone().addScaledVector(ay, y), ax: az, ay: ax, rx: hz * sx - (1 - sx) * 0, ry: hx * sx, e });
    const k = bev / Math.max(hx, hz);
    const rings = [ring(-hy, 1 - k), ring(-hy + bev * 0.3, 1 - k * 0.35), ring(-hy + bev, 1), ring(hy - bev, 1), ring(hy - bev * 0.3, 1 - k * 0.35), ring(hy, 1 - k)];
    this.loft(rings, { n: opts.n ?? 24, capStart: true, capEnd: true, nMin: 8 });
  }

  /** Ellipsoid (or part of it: v0..v1 of the meridian, 0 = -axis pole) about centre with axes (unit). */
  ellipsoid(c, ax, ay, az, rx, ry, rz, opts = {}) {
    if (this.skip) return;
    const K = this.seg(opts.k ?? 12, 3);
    const v0 = opts.v0 ?? 0, v1 = opts.v1 ?? 1;
    const rings = [];
    for (let i = 0; i <= K; i++) {
      const t = v0 + (v1 - v0) * (i / K);
      const phi = -Math.PI / 2 + t * Math.PI;
      const s = Math.max(Math.cos(phi), 1e-4);
      rings.push({ c: c.clone().addScaledVector(ay, Math.sin(phi) * ry), ax: az, ay: ax, rx: rz * s, ry: rx * s, e: opts.e ?? 2, r: opts.r });
    }
    this.loft(rings, { n: opts.n ?? 16, t0: opts.t0, t1: opts.t1, capStart: opts.capStart, capEnd: opts.capEnd });
  }

  /** Flat disc (n-gon) facing `normal`. */
  disc(c, normal, r, opts = {}) {
    if (this.skip) return;
    const nn = normal.clone().normalize();
    const X = opts.ref ? opts.ref.clone().addScaledVector(nn, -opts.ref.dot(nn)).normalize() : perpTo(nn);
    const Y = new THREE.Vector3().crossVectors(nn, X);
    const m = this.seg(opts.n ?? 16, 6);
    const b = this._bucket();
    const uv = opts.uv; // {u0,v0,u1,v1} maps the disc's bounding square
    const ci = this._vert(b, c, nn, uv ? (uv.u0 + uv.u1) / 2 : 0, uv ? (uv.v0 + uv.v1) / 2 : 0);
    for (let i = 0; i < m; i++) {
      const t = (i / m) * Math.PI * 2, x = Math.cos(t), y = Math.sin(t);
      _a.copy(c).addScaledVector(X, x * r * (opts.sx ?? 1)).addScaledVector(Y, y * r);
      this._vert(b, _a, nn, uv ? uv.u0 + (x * 0.5 + 0.5) * (uv.u1 - uv.u0) : x * r, uv ? uv.v0 + (y * 0.5 + 0.5) * (uv.v1 - uv.v0) : y * r);
    }
    for (let i = 0; i < m; i++) { b.idx.push(ci, ci + 1 + i, ci + 1 + ((i + 1) % m)); this.tris++; }
  }

  /**
   * Generic parametric patch: fn(s, t, outP, outN) for s, t in 0..1 (outN may be left zero: computed numerically).
   * uv: {u0, v0, u1, v1} (atlas decals) or null (metres from the patch extent).
   */
  patch(fn, ns, nt, uv = null, opts = {}) {
    if (this.skip) return;
    ns = Math.max(1, this.seg(ns, 1)); nt = Math.max(1, this.seg(nt, 1));
    const b = this._bucket();
    const base = b.count;
    const P = [], N = [];
    for (let j = 0; j <= nt; j++) for (let i = 0; i <= ns; i++) {
      const p = new THREE.Vector3(), nn = new THREE.Vector3();
      fn(i / ns, j / nt, p, nn);
      P.push(p); N.push(nn);
    }
    for (let j = 0; j <= nt; j++) for (let i = 0; i <= ns; i++) {
      const k = j * (ns + 1) + i;
      if (N[k].lengthSq() < 1e-12) {
        const ip = Math.min(i + 1, ns), im = Math.max(i - 1, 0), jp = Math.min(j + 1, nt), jm = Math.max(j - 1, 0);
        _a.subVectors(P[j * (ns + 1) + ip], P[j * (ns + 1) + im]); _b.subVectors(P[jp * (ns + 1) + i], P[jm * (ns + 1) + i]);
        N[k].crossVectors(_a, _b).normalize();
      }
      const u = uv ? uv.u0 + (uv.u1 - uv.u0) * (i / ns) : (i / ns) * (opts.w || 1);
      const v = uv ? uv.v0 + (uv.v1 - uv.v0) * (j / nt) : (j / nt) * (opts.h || 1);
      this._vert(b, P[k], N[k], u, v);
    }
    for (let j = 0; j < nt; j++) for (let i = 0; i < ns; i++) {
      const a = base + j * (ns + 1) + i, c = a + ns + 1;
      b.idx.push(a, a + 1, c, a + 1, c + 1, c); this.tris += 2;
    }
  }

  /** Flat quad decal: centre, normal, up hint, width, height, atlas uv rect; lifted by `lift` along the normal. */
  quad(c, normal, up, w, h, uv, lift = 0.0008) {
    const nn = normal.clone().normalize();
    const Y = up.clone().addScaledVector(nn, -up.dot(nn)).normalize();
    const X = new THREE.Vector3().crossVectors(Y, nn);
    const o = c.clone().addScaledVector(nn, lift);
    this.patch((s, t, p, n) => { p.copy(o).addScaledVector(X, (s - 0.5) * w).addScaledVector(Y, (t - 0.5) * h); n.copy(nn); }, 1, 1, uv);
  }

  /**
   * Decal wrapped on a cylinder-like surface: axis point a, axis direction d, radius r (function of the axis
   * coordinate or number), centred at angle `ang` measured from refDir, width w (arc length), height h.
   */
  wrapDecal(a, d, ref, r, ang, along, w, h, uv, lift = 0.0012, ns = 8) {
    const dd = d.clone().normalize();
    const X = ref.clone().addScaledVector(dd, -ref.dot(dd)).normalize();
    const Y = new THREE.Vector3().crossVectors(dd, X);
    const rf = typeof r === 'number' ? () => r : r;
    this.patch((s, t, p, n) => {
      const ax = along + (t - 0.5) * h;
      const R = rf(ax) + lift;
      const th = ang + ((s - 0.5) * w) / R;
      n.copy(X).multiplyScalar(Math.cos(th)).addScaledVector(Y, Math.sin(th));
      p.copy(a).addScaledVector(dd, ax).addScaledVector(n, R);
    }, ns, 2, uv);
  }

  // ------------------------------------------------------------------------------------------ output
  /** Build one BufferGeometry per material key: Map<key, BufferGeometry>. */
  build() {
    const out = new Map();
    for (const [k, b] of this.buckets) {
      if (!b.count) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(b.sw, 4));
      g.setIndex(b.count > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      g.userData.tris = b.idx.length / 3;
      out.set(k, g);
    }
    return out;
  }

  /** Post-process vertex colours of one material key: fn(p, n, rgb) modifies rgb in place. */
  shade(key, fn) {
    const b = this.buckets.get(key);
    if (!b) return;
    const p = new THREE.Vector3(), n = new THREE.Vector3(), c = [0, 0, 0];
    for (let i = 0; i < b.count; i++) {
      p.fromArray(b.pos, i * 3); n.fromArray(b.nrm, i * 3);
      c[0] = b.col[i * 3]; c[1] = b.col[i * 3 + 1]; c[2] = b.col[i * 3 + 2];
      fn(p, n, c);
      b.col[i * 3] = c[0]; b.col[i * 3 + 1] = c[1]; b.col[i * 3 + 2] = c[2];
    }
  }
}

export { _c as _scratchC, _n as _scratchN };
