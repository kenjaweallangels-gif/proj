// SDF-библиотека сиетча (чистый JS, работает и в Node при запекании, и в браузере).
// Соглашение: d < 0 — пустота (воздух пещеры), d > 0 — камень. Расстояния приближённые (не строго евклидовы), поэтому
// мешер и ray-march используют консервативные шаги.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ----------------------------------------------------------------- шум ----
function hash3(ix, iy, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(iz, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffff) / 32767.5 - 1; // [-1,1]
}
/** Трёхмерный value-noise, [-1,1], квинтическая интерполяция. */
export function vn3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10), w = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash3(ix, iy, iz), b = hash3(ix + 1, iy, iz), c = hash3(ix, iy + 1, iz), d = hash3(ix + 1, iy + 1, iz);
  const e = hash3(ix, iy, iz + 1), f = hash3(ix + 1, iy, iz + 1), g = hash3(ix, iy + 1, iz + 1), h = hash3(ix + 1, iy + 1, iz + 1);
  const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (h - g) * u;
  const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
  return y1 + (y2 - y1) * w;
}
export function vn2(x, z) { return vn3(x, 0.37, z); }
export function fbm3(x, y, z, oct = 3) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let o = 0; o < oct; o++) { s += a * vn3(x * f + o * 11.3, y * f - o * 7.1, z * f + o * 3.7); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// -------------------------------------------------------------- комбинаторы ----
export function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
export function smax(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; }

// ---------------------------------------------------------------- примитивы ----
/** Эллипсоид (аппроксимация И. Квилеза). c — центр, r — полуоси. */
export function sdEllipsoid(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = (px - cx), y = (py - cy), z = (pz - cz);
  const k0 = Math.hypot(x / rx, y / ry, z / rz);
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

/** Подготавливает «трубу» (эллиптический капсуль с коническим изменением радиусов). */
export function makeTube(o) {
  const a = o.a, b = o.b;
  let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const L = Math.hypot(dx, dy, dz) || 1e-6;
  const ax = [dx / L, dy / L, dz / L];
  // боковая ось u = up × ax (горизонтальная), v = ax × u
  let ux = ax[2], uy = 0, uz = -ax[0];
  let ul = Math.hypot(ux, uz);
  if (ul < 1e-3) { ux = 1; uz = 0; ul = 1; }
  ux /= ul; uz /= ul;
  const vx = ax[1] * uz - ax[2] * uy, vy = ax[2] * ux - ax[0] * uz, vz = ax[0] * uy - ax[1] * ux;
  const rw0 = o.rw0 ?? o.rw, rw1 = o.rw1 ?? o.rw, rh0 = o.rh0 ?? o.rh, rh1 = o.rh1 ?? o.rh;
  const m = Math.max(rw0, rw1, rh0, rh1) + (o.pad ?? 1.2);
  return {
    type: 'tube', a, ax, L, u: [ux, uy, uz], v: [vx, vy, vz], rw0, rw1, rh0, rh1,
    bb: [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.min(a[2], b[2]) - m, Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, Math.max(a[2], b[2]) + m],
    k: o.k, tag: o.tag,
  };
}
export function evalTube(t, px, py, pz) {
  const ex0 = px - t.a[0], ey0 = py - t.a[1], ez0 = pz - t.a[2];
  const s = clamp((ex0 * t.ax[0] + ey0 * t.ax[1] + ez0 * t.ax[2]) / t.L, 0, 1);
  const rw = t.rw0 + (t.rw1 - t.rw0) * s, rh = t.rh0 + (t.rh1 - t.rh0) * s;
  const ex = ex0 - t.ax[0] * s * t.L, ey = ey0 - t.ax[1] * s * t.L, ez = ez0 - t.ax[2] * s * t.L;
  const eu = ex * t.u[0] + ey * t.u[1] + ez * t.u[2];
  const ev = ex * t.v[0] + ey * t.v[1] + ez * t.v[2];
  const ea = ex * t.ax[0] + ey * t.ax[1] + ez * t.ax[2];
  const ra = (rw + rh) * 0.5;
  const qa = eu / rw, qb = ev / rh, qc = ea / ra;
  const k0 = Math.sqrt(qa * qa + qb * qb + qc * qc);
  const k1 = Math.sqrt((qa / rw) ** 2 + (qb / rh) ** 2 + (qc / ra) ** 2);
  return k1 < 1e-9 ? -Math.min(rw, rh) : (k0 * (k0 - 1)) / k1;
}

export function makeEll(o) {
  const m = Math.max(o.r[0], o.r[1], o.r[2]) + (o.pad ?? 1.2);
  return { type: 'ell', c: o.c, r: o.r, bb: [o.c[0] - m, o.c[1] - m, o.c[2] - m, o.c[0] + m, o.c[1] + m, o.c[2] + m], k: o.k, tag: o.tag };
}
export function evalEll(e, px, py, pz) { return sdEllipsoid(px, py, pz, e.c[0], e.c[1], e.c[2], e.r[0], e.r[1], e.r[2]); }

/** Вертикальный цилиндр (шахта): центр (cx,cz), радиус r, от y0 до y1 (скруглённые концы). */
export function makeCyl(o) {
  const m = o.r + (o.pad ?? 1.2);
  return { type: 'cyl', cx: o.cx, cz: o.cz, r: o.r, y0: o.y0, y1: o.y1, bb: [o.cx - m, o.y0 - m, o.cz - m, o.cx + m, o.y1 + m, o.cz + m], k: o.k, tag: o.tag };
}
export function evalCyl(c, px, py, pz) {
  const dr = Math.hypot(px - c.cx, pz - c.cz) - c.r;
  const dy = Math.max(c.y0 - py, py - c.y1);
  return dr > 0 && dy > 0 ? Math.hypot(dr, dy) : Math.max(dr, dy);
}

/** Скруглённый бокс (для твёрдых тел: мост, парапет). c — центр, h — полуразмеры, rr — скругление. */
export function makeBox(o) {
  const m = (o.pad ?? 1.2);
  return { type: 'box', c: o.c, h: o.h, rr: o.rr ?? 0.1, bb: [o.c[0] - o.h[0] - m, o.c[1] - o.h[1] - m, o.c[2] - o.h[2] - m, o.c[0] + o.h[0] + m, o.c[1] + o.h[1] + m, o.c[2] + o.h[2] + m], k: o.k, tag: o.tag };
}
export function evalBox(b, px, py, pz) {
  const qx = Math.abs(px - b.c[0]) - b.h[0] + b.rr, qy = Math.abs(py - b.c[1]) - b.h[1] + b.rr, qz = Math.abs(pz - b.c[2]) - b.h[2] + b.rr;
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - b.rr;
}

export function evalPrim(p, x, y, z) {
  switch (p.type) {
    case 'tube': return evalTube(p, x, y, z);
    case 'ell': return evalEll(p, x, y, z);
    case 'cyl': return evalCyl(p, x, y, z);
    case 'box': return evalBox(p, x, y, z);
    case 'fn': return p.fn(x, y, z);
    default: return 1e9;
  }
}
/** Расстояние от точки до расширенного AABB примитива (0 внутри). */
export function bbDist(bb, x, y, z) {
  const dx = Math.max(bb[0] - x, 0, x - bb[3]), dy = Math.max(bb[1] - y, 0, y - bb[4]), dz = Math.max(bb[2] - z, 0, z - bb[5]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Гладкое объединение набора примитивов с пропуском далёких (по AABB). */
export function unionPrims(prims, x, y, z, kDefault, far = 3.0) {
  let acc = 1e9;
  for (let i = 0; i < prims.length; i++) {
    const p = prims[i];
    const bd = bbDist(p.bb, x, y, z);
    if (bd > far) { if (bd < acc) acc = bd; continue; }
    const d = evalPrim(p, x, y, z);
    acc = acc >= 1e8 ? d : smin(acc, d, p.k ?? kDefault);
  }
  return acc;
}
