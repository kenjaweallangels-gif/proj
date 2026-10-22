// Small, allocation-light linear algebra for the renderer. Matrices are column-major Float32Array(16), the layout WGSL
// expects for mat4x4f. World: right-handed, Y up, metres; cameras look down -Z in view space.
import type { Vec3 } from '../contracts.ts';

export type Mat4 = Float32Array;

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  mul: (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  dist: (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  madd: (a: Vec3, b: Vec3, s: number): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
};

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const deg = (d: number): number => (d * Math.PI) / 180;

/**
 * Layout angle convention (d0_layout.json): an angle `a` in degrees maps to the horizontal direction (sin a, 0, cos a).
 * Used for valley_axis_deg, cave facing_deg and sun azimuth_deg.
 */
export function dirFromLayoutAngle(aDeg: number): Vec3 {
  const a = deg(aDeg);
  return [Math.sin(a), 0, Math.cos(a)];
}

export function sunDirection(azimuthDeg: number, elevationDeg: number): Vec3 {
  const a = deg(azimuthDeg);
  const e = deg(elevationDeg);
  return [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
}

export const m4 = {
  identity(out: Mat4 = new Float32Array(16)): Mat4 {
    out.fill(0);
    out[0] = out[5] = out[10] = out[15] = 1;
    return out;
  },

  multiply(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
    const r = out === a || out === b ? new Float32Array(16) : out;
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      r[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      r[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      r[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      r[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    if (r !== out) out.set(r);
    return out;
  },

  /** Reversed-Z infinite perspective for WebGPU clip space (depth 1 at near plane, 0 at infinity). */
  perspectiveReversedInfinite(fovY: number, aspect: number, near: number, out: Mat4 = new Float32Array(16)): Mat4 {
    const f = 1 / Math.tan(fovY / 2);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[11] = -1;
    out[14] = near;
    return out;
  },

  /** Orthographic projection with WebGPU depth range [0, 1] (near -> 0). */
  ortho(l: number, r: number, b: number, t: number, n: number, f: number, out: Mat4 = new Float32Array(16)): Mat4 {
    out.fill(0);
    out[0] = 2 / (r - l);
    out[5] = 2 / (t - b);
    out[10] = -1 / (f - n);
    out[12] = -(r + l) / (r - l);
    out[13] = -(t + b) / (t - b);
    out[14] = -n / (f - n);
    out[15] = 1;
    return out;
  },

  lookAt(eye: Vec3, target: Vec3, up: Vec3, out: Mat4 = new Float32Array(16)): Mat4 {
    let z = v3.norm(v3.sub(eye, target));
    if (Math.abs(v3.dot(z, up)) > 0.9999) z = v3.norm(v3.add(z, [1e-4, 0, 1e-4]));
    const x = v3.norm(v3.cross(up, z));
    const y = v3.cross(z, x);
    out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
    out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
    out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
    out[12] = -v3.dot(x, eye); out[13] = -v3.dot(y, eye); out[14] = -v3.dot(z, eye); out[15] = 1;
    return out;
  },

  invert(m: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (Math.abs(det) < 1e-30) return m4.identity(out);
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  },

  translation(x: number, y: number, z: number, out: Mat4 = new Float32Array(16)): Mat4 {
    m4.identity(out);
    out[12] = x; out[13] = y; out[14] = z;
    return out;
  },

  rotationX(a: number, out: Mat4 = new Float32Array(16)): Mat4 {
    const c = Math.cos(a), s = Math.sin(a);
    m4.identity(out);
    out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
    return out;
  },

  /** Rotation about +Y. Layout rotation_y_deg uses this (local +X maps to (cos a, 0, -sin a)). */
  rotationY(a: number, out: Mat4 = new Float32Array(16)): Mat4 {
    const c = Math.cos(a), s = Math.sin(a);
    m4.identity(out);
    out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
    return out;
  },

  rotationZ(a: number, out: Mat4 = new Float32Array(16)): Mat4 {
    const c = Math.cos(a), s = Math.sin(a);
    m4.identity(out);
    out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
    return out;
  },

  scaling(x: number, y: number, z: number, out: Mat4 = new Float32Array(16)): Mat4 {
    m4.identity(out);
    out[0] = x; out[5] = y; out[10] = z;
    return out;
  },

  /** T * Ry * S */
  trs(t: Vec3, rotY: number, s: Vec3, out: Mat4 = new Float32Array(16)): Mat4 {
    const c = Math.cos(rotY), sn = Math.sin(rotY);
    out[0] = c * s[0]; out[1] = 0; out[2] = -sn * s[0]; out[3] = 0;
    out[4] = 0; out[5] = s[1]; out[6] = 0; out[7] = 0;
    out[8] = sn * s[2]; out[9] = 0; out[10] = c * s[2]; out[11] = 0;
    out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
    return out;
  },

  transformPoint(m: Mat4, p: Vec3): Vec3 {
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    const iw = Math.abs(w) > 1e-20 ? 1 / w : 1;
    return [
      (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw,
      (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw,
      (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw,
    ];
  },

  transformDir(m: Mat4, d: Vec3): Vec3 {
    return [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
  },
};

/** Frustum planes (normal pointing inside) extracted from a view-projection matrix; near + 4 side planes + explicit far. */
export type Plane = [number, number, number, number];

export function frustumPlanes(vp: Mat4, camPos: Vec3, forward: Vec3, far: number): Plane[] {
  const row = (r: number): [number, number, number, number] => [vp[r], vp[4 + r], vp[8 + r], vp[12 + r]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  const planes: Plane[] = [
    [r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]], // left
    [r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]], // right
    [r3[0] + r1[0], r3[1] + r1[1], r3[2] + r1[2], r3[3] + r1[3]], // bottom
    [r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]], // top
    [r3[0] - r2[0], r3[1] - r2[1], r3[2] - r2[2], r3[3] - r2[3]], // near (reversed-Z: z <= w)
  ];
  for (const p of planes) {
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    p[0] /= l; p[1] /= l; p[2] /= l; p[3] /= l;
  }
  // Far plane: dot(-forward, p) + dot(forward, cam) + far >= 0
  planes.push([-forward[0], -forward[1], -forward[2], v3.dot(forward, camPos) + far]);
  return planes;
}

export function aabbInFrustum(planes: Plane[], min: Vec3, max: Vec3): boolean {
  for (const p of planes) {
    const x = p[0] >= 0 ? max[0] : min[0];
    const y = p[1] >= 0 ? max[1] : min[1];
    const z = p[2] >= 0 ? max[2] : min[2];
    if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
  }
  return true;
}

/** Deterministic PRNG (mulberry32) for CPU-side procedural placement. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}
