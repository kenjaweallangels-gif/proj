import * as THREE from 'three';

/**
 * Fast geometry writer for the station interiors.
 *
 * Interiors are made of tens of thousands of small parts. Building a BufferGeometry per part and merging
 * them is far too slow for that, so primitives append raw vertex data (position, normal, uv, colour) to
 * per-material buckets of plain arrays. A zone turns each bucket into one indexed BufferGeometry.
 *
 * Every primitive takes a placement matrix M (primitive local -> zone local; rotation + translation only,
 * sizes are passed as parameters, so normals transform with the same rotation) and a colour (0xRRGGBB, sRGB,
 * stored linear in the colour attribute; it later gets multiplied by the baked lighting / AO factor).
 * UVs only matter for the atlas-textured material: `uv` is an atlas rect {u0, v0, u1, v1}.
 */

const _lin = new Map();
/** sRGB hex -> linear [r, g, b] (cached). */
export function lin(hex) {
  let c = _lin.get(hex);
  if (!c) { const col = new THREE.Color(hex); c = [col.r, col.g, col.b]; _lin.set(hex, c); }
  return c;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _t = new THREE.Vector3();
const _m = new THREE.Matrix4();
const ZERO_UV = { u0: 0, v0: 0, u1: 0, v1: 0 };

/** Placement matrix from position + quaternion (both optional). */
export function place(x = 0, y = 0, z = 0, quat = null) { return new THREE.Matrix4().compose(_t.set(x, y, z), quat || _q.identity(), _s); }
/** Matrix from an origin and three orthonormal axes (columns). */
export function basis(o, X, Y, Z) { return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(o); }
/** M * translate(x, y, z) as a new matrix. */
export function offset(M, x, y, z) { return M.clone().multiply(_m.makeTranslation(x, y, z)); }
/** M * rotation(axis, angle) as a new matrix ('x' | 'y' | 'z'). */
export function rot(M, axis, a) {
  const r = axis === 'x' ? _m.makeRotationX(a) : axis === 'y' ? _m.makeRotationY(a) : _m.makeRotationZ(a);
  return M.clone().multiply(r);
}
/** M * translate * rotate (convenience). */
export function sub(M, x, y, z, axis = null, a = 0) { const r = offset(M, x, y, z); return axis ? r.multiply(axis === 'x' ? _m.makeRotationX(a) : axis === 'y' ? _m.makeRotationY(a) : _m.makeRotationZ(a)) : r; }

class Bucket {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
  get count() { return this.p.length / 3; }
}

export class MeshWriter {
  /** detail: tessellation factor (quality.detail; 0.2 on 'lite'). */
  constructor(detail = 1) {
    this.detail = detail;
    this.buckets = new Map();
    this.tris = 0;
  }

  bucket(name) { let b = this.buckets.get(name); if (!b) { b = new Bucket(); this.buckets.set(name, b); } return b; }
  seg(n, min = 3) { return Math.max(min, Math.round(n * Math.min(1.25, this.detail))); }

  _vert(b, M, x, y, z, nx, ny, nz, u, v, col) {
    const e = M.elements;
    b.p.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
    b.n.push(e[0] * nx + e[4] * ny + e[8] * nz, e[1] * nx + e[5] * ny + e[9] * nz, e[2] * nx + e[6] * ny + e[10] * nz);
    b.u.push(u, v);
    b.c.push(col[0], col[1], col[2]);
  }

  /** Quad from 4 local corners (counter-clockwise seen from the front), flat normal. */
  _quad(b, M, a, bb, c, d, n, col, uv) {
    const base = b.count;
    this._vert(b, M, a[0], a[1], a[2], n[0], n[1], n[2], uv.u0, uv.v0, col);
    this._vert(b, M, bb[0], bb[1], bb[2], n[0], n[1], n[2], uv.u1, uv.v0, col);
    this._vert(b, M, c[0], c[1], c[2], n[0], n[1], n[2], uv.u1, uv.v1, col);
    this._vert(b, M, d[0], d[1], d[2], n[0], n[1], n[2], uv.u0, uv.v1, col);
    b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.tris += 2;
  }

  /**
   * Box centred at M's origin, size sx (local X) x sy (Y) x sz (Z).
   * uv: atlas rect for the front (+Z) face; side: rect for the other faces (default: uv's centre texel).
   * faces: bit mask of faces to emit (+X 1, -X 2, +Y 4, -Y 8, +Z 16, -Z 32), default all.
   */
  box(mat, M, sx, sy, sz, color = 0xffffff, uv = null, side = null, faces = 63) {
    const b = this.bucket(mat), col = typeof color === 'number' ? lin(color) : color;
    const x = sx / 2, y = sy / 2, z = sz / 2;
    const f = uv || ZERO_UV;
    let s = side || uv;
    if (!side && uv) { const cu = (uv.u0 + uv.u1) / 2, cv = (uv.v0 + uv.v1) / 2; s = { u0: cu, v0: cv, u1: cu, v1: cv }; }
    s = s || ZERO_UV;
    if (faces & 16) this._quad(b, M, [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], [0, 0, 1], col, f);
    if (faces & 32) this._quad(b, M, [x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], [0, 0, -1], col, s);
    if (faces & 1) this._quad(b, M, [x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], [1, 0, 0], col, s);
    if (faces & 2) this._quad(b, M, [-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], [-1, 0, 0], col, s);
    if (faces & 4) this._quad(b, M, [-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], [0, 1, 0], col, s);
    if (faces & 8) this._quad(b, M, [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], [0, -1, 0], col, s);
  }

  /** Box placed by its centre in M's frame (no rotation). */
  boxAt(mat, M, cx, cy, cz, sx, sy, sz, color, uv = null, side = null, faces = 63) {
    this.box(mat, M.clone().multiply(_m.makeTranslation(cx, cy, cz)), sx, sy, sz, color, uv, side, faces);
  }

  /** Single quad w x h facing +Z at M. */
  quad(mat, M, w, h, color = 0xffffff, uv = null) {
    const b = this.bucket(mat), col = typeof color === 'number' ? lin(color) : color;
    this._quad(b, M, [-w / 2, -h / 2, 0], [w / 2, -h / 2, 0], [w / 2, h / 2, 0], [-w / 2, h / 2, 0], [0, 0, 1], col, uv || ZERO_UV);
  }

  /**
   * Box with chamfered edges (soft goods, rounded equipment). k = chamfer size.
   * Built as a convex hull of 24 points: 6 inset faces + 12 edge strips + 8 corner triangles.
   */
  chamferBox(mat, M, sx, sy, sz, k, color = 0xffffff, uv = null, side = null) {
    const x = sx / 2, y = sy / 2, z = sz / 2;
    k = Math.min(k, x * 0.9, y * 0.9, z * 0.9);
    const b = this.bucket(mat), col = typeof color === 'number' ? lin(color) : color;
    const f = uv || ZERO_UV;
    let s = side;
    if (!s) { const cu = (f.u0 + f.u1) / 2, cv = (f.v0 + f.v1) / 2; s = { u0: cu, v0: cv, u1: cu, v1: cv }; }
    const xi = x - k, yi = y - k, zi = z - k;
    // faces
    this._quad(b, M, [-xi, -yi, z], [xi, -yi, z], [xi, yi, z], [-xi, yi, z], [0, 0, 1], col, f);
    this._quad(b, M, [xi, -yi, -z], [-xi, -yi, -z], [-xi, yi, -z], [xi, yi, -z], [0, 0, -1], col, s);
    this._quad(b, M, [x, -yi, zi], [x, -yi, -zi], [x, yi, -zi], [x, yi, zi], [1, 0, 0], col, s);
    this._quad(b, M, [-x, -yi, -zi], [-x, -yi, zi], [-x, yi, zi], [-x, yi, -zi], [-1, 0, 0], col, s);
    this._quad(b, M, [-xi, y, zi], [xi, y, zi], [xi, y, -zi], [-xi, y, -zi], [0, 1, 0], col, s);
    this._quad(b, M, [-xi, -y, -zi], [xi, -y, -zi], [xi, -y, zi], [-xi, -y, zi], [0, -1, 0], col, s);
    const r2 = Math.SQRT1_2, r3 = 1 / Math.sqrt(3);
    // edges parallel to X
    for (const sy2 of [-1, 1]) for (const sz2 of [-1, 1]) {
      const a = [-xi, sy2 * y, sz2 * zi], bb = [xi, sy2 * y, sz2 * zi], c = [xi, sy2 * yi, sz2 * z], d = [-xi, sy2 * yi, sz2 * z];
      const n = [0, sy2 * r2, sz2 * r2];
      if (sy2 * sz2 > 0) this._quad(b, M, d, c, bb, a, n, col, s); else this._quad(b, M, a, bb, c, d, n, col, s);
    }
    // edges parallel to Y
    for (const sx2 of [-1, 1]) for (const sz2 of [-1, 1]) {
      const a = [sx2 * x, -yi, sz2 * zi], bb = [sx2 * x, yi, sz2 * zi], c = [sx2 * xi, yi, sz2 * z], d = [sx2 * xi, -yi, sz2 * z];
      const n = [sx2 * r2, 0, sz2 * r2];
      if (sx2 * sz2 > 0) this._quad(b, M, a, bb, c, d, n, col, s); else this._quad(b, M, d, c, bb, a, n, col, s);
    }
    // edges parallel to Z
    for (const sx2 of [-1, 1]) for (const sy2 of [-1, 1]) {
      const a = [sx2 * x, sy2 * yi, -zi], bb = [sx2 * x, sy2 * yi, zi], c = [sx2 * xi, sy2 * y, zi], d = [sx2 * xi, sy2 * y, -zi];
      const n = [sx2 * r2, sy2 * r2, 0];
      if (sx2 * sy2 > 0) this._quad(b, M, d, c, bb, a, n, col, s); else this._quad(b, M, a, bb, c, d, n, col, s);
    }
    // corners
    for (const sx2 of [-1, 1]) for (const sy2 of [-1, 1]) for (const sz2 of [-1, 1]) {
      const base = b.count, n = [sx2 * r3, sy2 * r3, sz2 * r3];
      const p1 = [sx2 * x, sy2 * yi, sz2 * zi], p2 = [sx2 * xi, sy2 * y, sz2 * zi], p3 = [sx2 * xi, sy2 * yi, sz2 * z];
      for (const p of [p1, p2, p3]) this._vert(b, M, p[0], p[1], p[2], n[0], n[1], n[2], s.u0, s.v0, col);
      if (sx2 * sy2 * sz2 > 0) b.i.push(base, base + 1, base + 2); else b.i.push(base, base + 2, base + 1);
      this.tris++;
    }
  }

  /**
   * Cylinder / cone frustum along local Y, centred at M (r0 at -h/2, r1 at +h/2).
   * caps: 0 none, 1 bottom, 2 top, 3 both. uv: rect wrapped around the side (u around, v along).
   * arc: angular extent (radians), start at local +X.
   */
  cyl(mat, M, r0, r1, h, seg = 16, color = 0xffffff, caps = 3, uv = null, arc = Math.PI * 2, a0 = 0) {
    const b = this.bucket(mat), col = typeof color === 'number' ? lin(color) : color;
    const n = this.seg(seg, 5), f = uv || ZERO_UV;
    const base = b.count, y0 = -h / 2, y1 = h / 2;
    const slope = (r0 - r1) / h, nl = Math.hypot(1, slope);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * arc, c = Math.cos(a), s = Math.sin(a);
      const u = f.u0 + (f.u1 - f.u0) * (i / n);
      this._vert(b, M, r0 * c, y0, r0 * s, c / nl, slope / nl, s / nl, u, f.v0, col);
      this._vert(b, M, r1 * c, y1, r1 * s, c / nl, slope / nl, s / nl, u, f.v1, col);
    }
    for (let i = 0; i < n; i++) { const k = base + i * 2; b.i.push(k, k + 1, k + 3, k, k + 3, k + 2); }
    this.tris += n * 2;
    const full = arc >= Math.PI * 2 - 1e-6;
    if (caps & 1 && r0 > 0) this._fan(b, M, r0, y0, -1, n, col, f, arc, a0, full);
    if (caps & 2 && r1 > 0) this._fan(b, M, r1, y1, 1, n, col, f, arc, a0, full);
  }

  _fan(b, M, r, y, dir, n, col, f, arc, a0) {
    const base = b.count;
    const cu = (f.u0 + f.u1) / 2, cv = (f.v0 + f.v1) / 2;
    this._vert(b, M, 0, y, 0, 0, dir, 0, cu, cv, col);
    for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * arc; this._vert(b, M, r * Math.cos(a), y, r * Math.sin(a), 0, dir, 0, cu, cv, col); }
    for (let i = 0; i < n; i++) { if (dir > 0) b.i.push(base, base + i + 2, base + i + 1); else b.i.push(base, base + i + 1, base + i + 2); }
    this.tris += n;
  }

  /** Flat disc (or annulus with rIn > 0) in local XY plane facing +Z. uv rect mapped over the disc square. */
  disc(mat, M, r, seg = 24, color = 0xffffff, uv = null, rIn = 0) {
    const b = this.bucket(mat), col = typeof color === 'number' ? lin(color) : color;
    const n = this.seg(seg, 6), f = uv || ZERO_UV, base = b.count;
    const mu = (x) => f.u0 + (f.u1 - f.u0) * (x / r * 0.5 + 0.5), mv = (y) => f.v0 + (f.v1 - f.v0) * (y / r * 0.5 + 0.5);
    if (rIn <= 0) {
      this._vert(b, M, 0, 0, 0, 0, 0, 1, mu(0), mv(0), col);
      for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2, x = r * Math.cos(a), y = r * Math.sin(a); this._vert(b, M, x, y, 0, 0, 0, 1, mu(x), mv(y), col); }
      for (let i = 0; i < n; i++) b.i.push(base, base + i + 1, base + i + 2);
      this.tris += n;
    } else {
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        this._vert(b, M, rIn * c, rIn * s, 0, 0, 0, 1, mu(rIn * c), mv(rIn * s), col);
        this._vert(b, M, r * c, r * s, 0, 0, 0, 1, mu(r * c), mv(r * s), col);
      }
      for (let i = 0; i < n; i++) { const k = base + i * 2; b.i.push(k, k + 1, k + 3, k, k + 3, k + 2); }
      this.tris += n * 2;
    }
  }

  /** Torus around local Z (in the XY plane) — seals, rings, hoops. */
  torus(mat, M, R, r, rs = 6, ts = 24, color = 0xffffff, arc = Math.PI * 2, a0 = 0) {
    const b = this.bucket(mat), col = typeof color === 'number' ? lin(color) : color;
    const nr = this.seg(rs, 3), nt = this.seg(ts, 6), base = b.count;
    for (let j = 0; j <= nt; j++) {
      const t = a0 + (j / nt) * arc, ct = Math.cos(t), st = Math.sin(t);
      for (let i = 0; i <= nr; i++) {
        const p = (i / nr) * Math.PI * 2, cp = Math.cos(p), sp = Math.sin(p);
        this._vert(b, M, (R + r * cp) * ct, (R + r * cp) * st, r * sp, cp * ct, cp * st, sp, 0, 0, col);
      }
    }
    for (let j = 0; j < nt; j++) for (let i = 0; i < nr; i++) {
      const a = base + j * (nr + 1) + i, c = a + nr + 1;
      b.i.push(a, c, a + 1, a + 1, c, c + 1);
    }
    this.tris += nt * nr * 2;
  }

  /** UV sphere (or ellipsoid with sx, sy, sz radii). */
  sphere(mat, M, rx, ws = 12, hs = 8, color = 0xffffff, ry = rx, rz = rx, thetaLen = Math.PI) {
    const b = this.bucket(mat), col = typeof color === 'number' ? lin(color) : color;
    const nw = this.seg(ws, 5), nh = this.seg(hs, 3), base = b.count;
    for (let j = 0; j <= nh; j++) {
      const th = (j / nh) * thetaLen, st = Math.sin(th), ct = Math.cos(th);
      for (let i = 0; i <= nw; i++) {
        const ph = (i / nw) * Math.PI * 2, x = st * Math.cos(ph), z = st * Math.sin(ph);
        _n.set(x / rx, ct / ry, z / rz).normalize();
        this._vert(b, M, rx * x, ry * ct, rz * z, _n.x, _n.y, _n.z, 0, 0, col);
      }
    }
    for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) {
      const a = base + j * (nw + 1) + i, c = a + nw + 1;
      b.i.push(a, a + 1, c, a + 1, c + 1, c);
    }
    this.tris += nw * nh * 2;
  }

  /** Surface of revolution about local Y. prof: [[r, y], ...] from bottom to top. */
  lathe(mat, M, prof, seg = 16, color = 0xffffff) {
    const b = this.bucket(mat), col = typeof color === 'number' ? lin(color) : color;
    const n = this.seg(seg, 5), base = b.count, m = prof.length;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      for (let j = 0; j < m; j++) {
        const p = prof[j], pp = prof[Math.max(0, j - 1)], pn = prof[Math.min(m - 1, j + 1)];
        const dr = pn[0] - pp[0], dy = pn[1] - pp[1], l = Math.hypot(dr, dy) || 1;
        const nx = dy / l, ny = -dr / l;
        this._vert(b, M, p[0] * c, p[1], p[0] * s, nx * c, ny, nx * s, 0, 0, col);
      }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < m - 1; j++) {
      const a = base + i * m + j, c = a + m;
      b.i.push(a, a + 1, c + 1, a, c + 1, c);
    }
    this.tris += n * (m - 1) * 2;
  }

  /**
   * Tube swept along a polyline of zone-local points (cables, hoses, ducts). r may be a function of the
   * parameter 0..1 (ribbed ducts). Parallel-transport frames; open ends unless caps.
   */
  tube(mat, pts, r, sides = 6, color = 0xffffff, caps = true, M = null) {   // closed ends by default (no see-through tube ends)
    const b = this.bucket(mat), col = typeof color === 'number' ? lin(color) : color;
    const n = this.seg(sides, 3), m = pts.length;
    if (m < 2) return;
    const I = M || IDENT;
    const base = b.count;
    const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), prevT = new THREE.Vector3();
    // initial normal: any perpendicular
    T.subVectors(pts[1], pts[0]).normalize();
    N.set(0, 1, 0); if (Math.abs(T.y) > 0.9) N.set(1, 0, 0);
    N.addScaledVector(T, -N.dot(T)).normalize();
    let total = 0; const acc = [0];
    for (let k = 1; k < m; k++) { total += pts[k].distanceTo(pts[k - 1]); acc.push(total); }
    for (let k = 0; k < m; k++) {
      prevT.copy(T);
      if (k === 0) T.subVectors(pts[1], pts[0]);
      else if (k === m - 1) T.subVectors(pts[k], pts[k - 1]);
      else T.subVectors(pts[k + 1], pts[k - 1]);
      T.normalize();
      // parallel transport of N
      if (k > 0) { _v.crossVectors(prevT, T); const sl = _v.length(); if (sl > 1e-6) { _q.setFromAxisAngle(_v.multiplyScalar(1 / sl), Math.asin(Math.min(1, sl))); N.applyQuaternion(_q); } N.addScaledVector(T, -N.dot(T)).normalize(); }
      B.crossVectors(T, N);
      const rr = typeof r === 'function' ? r(total > 0 ? acc[k] / total : 0) : r;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        const nx = N.x * c + B.x * s, ny = N.y * c + B.y * s, nz = N.z * c + B.z * s;
        this._vert(b, I, pts[k].x + nx * rr, pts[k].y + ny * rr, pts[k].z + nz * rr, nx, ny, nz, 0, 0, col);
      }
    }
    for (let k = 0; k < m - 1; k++) for (let i = 0; i < n; i++) {
      const a = base + k * (n + 1) + i, c = a + n + 1;
      b.i.push(a, a + 1, c, a + 1, c + 1, c);
    }
    this.tris += (m - 1) * n * 2;
    if (caps) {
      for (const [k, sgn] of [[0, -1], [m - 1, 1]]) {
        const d = k === 0 ? _v.subVectors(pts[0], pts[1]).normalize() : _v.subVectors(pts[m - 1], pts[m - 2]).normalize();
        const cb = b.count;
        this._vert(b, I, pts[k].x, pts[k].y, pts[k].z, d.x, d.y, d.z, 0, 0, col);
        const ring = base + k * (n + 1);
        for (let i = 0; i < n; i++) b.i.push(cb, sgn > 0 ? ring + i : ring + i + 1, sgn > 0 ? ring + i + 1 : ring + i);
        this.tris += n;
      }
    }
  }

  /**
   * Flat ring between two closed 2D paths (same point count, corresponding points) in local XY, extruded
   * along Z by depth (front face at +depth/2). Emits front, back (optional), outer and inner walls.
   * Used for hatch frames, seals, bulkheads with openings.
   */
  frame2D(mat, M, outer, inner, depth, color = 0xffffff, uv = null, { back = true, outerWall = true, innerWall = true } = {}) {
    // closed solids only (geometry quality pass): a panel seen from behind or edge-on through an opening must show
    // its back face and the opening's wall, never a culled shell. The flags are kept for the 'lite' builder.
    if (this.detail > 0.5) { back = true; innerWall = true; outerWall = true; }
    const b = this.bucket(mat), col = typeof color === 'number' ? lin(color) : color;
    const n = outer.length, z0 = -depth / 2, z1 = depth / 2;
    const f = uv || ZERO_UV;
    // bounds for planar uv
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of outer) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const mu = (x) => f.u0 + (f.u1 - f.u0) * ((x - minX) / (maxX - minX || 1)), mv = (y) => f.v0 + (f.v1 - f.v0) * ((y - minY) / (maxY - minY || 1));
    const face = (z, nz) => {
      const base = b.count;
      for (let i = 0; i < n; i++) {
        this._vert(b, M, outer[i][0], outer[i][1], z, 0, 0, nz, mu(outer[i][0]), mv(outer[i][1]), col);
        this._vert(b, M, inner[i][0], inner[i][1], z, 0, 0, nz, mu(inner[i][0]), mv(inner[i][1]), col);
      }
      for (let i = 0; i < n; i++) {
        const a = base + i * 2, c = base + ((i + 1) % n) * 2;
        if (nz > 0) b.i.push(a, c, a + 1, a + 1, c, c + 1); else b.i.push(a, a + 1, c, a + 1, c + 1, c);
      }
      this.tris += n * 2;
    };
    face(z1, 1);
    if (back) face(z0, -1);
    const wall = (path, outward) => {
      const base = b.count;
      for (let i = 0; i < n; i++) {
        const p = path[(i - 1 + n) % n], c = path[i], q = path[(i + 1) % n];
        let nx = q[1] - p[1], ny = -(q[0] - p[0]); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        if (!outward) { nx = -nx; ny = -ny; }
        this._vert(b, M, c[0], c[1], z0, nx, ny, 0, f.u0, f.v0, col);
        this._vert(b, M, c[0], c[1], z1, nx, ny, 0, f.u0, f.v0, col);
      }
      for (let i = 0; i < n; i++) {
        const a = base + i * 2, c = base + ((i + 1) % n) * 2;
        if (outward) b.i.push(a, c, a + 1, a + 1, c, c + 1); else b.i.push(a, a + 1, c, a + 1, c + 1, c);
      }
      this.tris += n * 2;
    };
    // paths are counter-clockwise: the right-hand normal of the edge points outward
    if (outerWall) wall(outer, true);
    if (innerWall) wall(inner, false);
  }

  /** Filled convex/star-shaped 2D polygon (fan from the centroid) in local XY, facing +Z, optionally extruded. */
  poly(mat, M, path, color = 0xffffff, uv = null, depth = 0) {
    const b = this.bucket(mat), col = typeof color === 'number' ? lin(color) : color;
    const n = path.length, f = uv || ZERO_UV;
    let cx = 0, cy = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of path) { cx += p[0] / n; cy += p[1] / n; minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    const mu = (x) => f.u0 + (f.u1 - f.u0) * ((x - minX) / (maxX - minX || 1)), mv = (y) => f.v0 + (f.v1 - f.v0) * ((y - minY) / (maxY - minY || 1));
    const z = depth / 2;
    const fan = (zz, nz) => {
      const base = b.count;
      this._vert(b, M, cx, cy, zz, 0, 0, nz, mu(cx), mv(cy), col);
      for (const p of path) this._vert(b, M, p[0], p[1], zz, 0, 0, nz, mu(p[0]), mv(p[1]), col);
      for (let i = 0; i < n; i++) { const a = base + 1 + i, c = base + 1 + ((i + 1) % n); if (nz > 0) b.i.push(base, a, c); else b.i.push(base, c, a); }
      this.tris += n;
    };
    fan(z, 1);
    if (depth > 0) {
      fan(-z, -1);
      const base = b.count;
      for (let i = 0; i < n; i++) {
        const p = path[i], q = path[(i + 1) % n];
        let nx = q[1] - p[1], ny = -(q[0] - p[0]); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const k = b.count;
        this._vert(b, M, p[0], p[1], -z, nx, ny, 0, f.u0, f.v0, col); this._vert(b, M, q[0], q[1], -z, nx, ny, 0, f.u0, f.v0, col);
        this._vert(b, M, q[0], q[1], z, nx, ny, 0, f.u0, f.v0, col); this._vert(b, M, p[0], p[1], z, nx, ny, 0, f.u0, f.v0, col);
        b.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
      }
      this.tris += n * 2;
      void base;
    }
  }

  /** Multiply every vertex colour of every bucket by fn(x, y, z, nx, ny, nz) (baked light / AO). */
  shade(fn, from = null) {
    for (const [name, b] of this.buckets) {
      const start = from ? (from.get(name) || 0) : 0;
      const p = b.p, n = b.n, c = b.c;
      for (let i = start, cnt = b.count; i < cnt; i++) {
        const k = i * 3;
        const f = fn(p[k], p[k + 1], p[k + 2], n[k], n[k + 1], n[k + 2], name);
        c[k] *= f; c[k + 1] *= f; c[k + 2] *= f;
      }
    }
  }

  /** Vertex counts per bucket (to shade only what was added after a mark). */
  mark() { const m = new Map(); for (const [k, b] of this.buckets) m.set(k, b.count); return m; }

  /** Convert every bucket into an indexed BufferGeometry: Map name -> geometry. Clears the writer. */
  build() {
    const out = new Map();
    for (const [name, b] of this.buckets) {
      if (!b.i.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      g.setIndex(b.count > 65535 ? new THREE.Uint32BufferAttribute(b.i, 1) : new THREE.Uint16BufferAttribute(b.i, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out.set(name, g);
    }
    this.buckets.clear();
    this.tris = 0;
    return out;
  }
}
const IDENT = new THREE.Matrix4();

// ------------------------------------------------------------------------------------------------ 2D paths

/** Rounded rectangle path (counter-clockwise), w x h, corner radius r, `k` points per corner. */
export function roundRect(w, h, r, k = 5) {
  const pts = [], x = w / 2 - r, y = h / 2 - r;
  const corners = [[x, -y, -Math.PI / 2], [x, y, 0], [-x, y, Math.PI / 2], [-x, -y, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= k; i++) { const a = a0 + (i / k) * Math.PI / 2; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

/** Circle path (counter-clockwise). */
export function circle(r, n = 24, a0 = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  return pts;
}

/**
 * Sample two star-shaped outlines at the same angles so they can be joined by frame2D:
 * fnA(theta) / fnB(theta) return the radius at angle theta. Returns [outer, inner].
 */
export function radialPair(fnOuter, fnInner, n = 48, a0 = 0) {
  const o = [], i = [];
  for (let k = 0; k < n; k++) {
    const a = a0 + (k / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const ro = fnOuter(a), ri = fnInner(a);
    o.push([ro * c, ro * s]); i.push([ri * c, ri * s]);
  }
  return [o, i];
}

/** Radius of a rounded rectangle (half sizes hx, hy, corner r) along direction angle a (ray from the centre). */
export function roundRectRadius(hx, hy, r, a) {
  const c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  // intersect the ray with the rounded box: solve on the quarter shape
  let t = Math.min(c > 1e-9 ? hx / c : Infinity, s > 1e-9 ? hy / s : Infinity);
  const px = t * c, py = t * s;
  if (px > hx - r && py > hy - r) {
    // corner arc centred at (hx - r, hy - r)
    const ox = hx - r, oy = hy - r;
    const B = -2 * (c * ox + s * oy), C = ox * ox + oy * oy - r * r;
    const disc = B * B - 4 * C;
    if (disc >= 0) t = (-B + Math.sqrt(disc)) / 2;
  }
  return t;
}

/** Radius of a regular-ish octagon (square half size h with corner chamfer c) along angle a. */
export function octRadius(h, c, a) {
  const cs = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
  const t1 = cs > 1e-9 ? h / cs : Infinity, t2 = sn > 1e-9 ? h / sn : Infinity;
  // chamfer line x + y = 2h - c
  const t3 = (2 * h - c) / (cs + sn);
  return Math.min(t1, t2, t3);
}
