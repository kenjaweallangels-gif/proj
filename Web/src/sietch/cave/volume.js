// Грубый объём SDF (шаг 0.5 м) для запекания: трассировка лучей AO/теней, поиск полов, зондовый объём освещения.

export function buildVolume(sdf, bounds, h = 0.5, log = () => {}) {
  const ox = bounds.min[0], oy = bounds.min[1], oz = bounds.min[2];
  const nx = Math.ceil((bounds.max[0] - ox) / h) + 1, ny = Math.ceil((bounds.max[1] - oy) / h) + 1, nz = Math.ceil((bounds.max[2] - oz) / h) + 1;
  const data = new Float32Array(nx * ny * nz);
  const B = 4; // блок 2 м
  let evals = 0;
  for (let kb = 0; kb < nz; kb += B) for (let jb = 0; jb < ny; jb += B) for (let ib = 0; ib < nx; ib += B) {
    const i1 = Math.min(nx, ib + B), j1 = Math.min(ny, jb + B), k1 = Math.min(nz, kb + B);
    const cx = ox + (ib + B / 2) * h, cy = oy + (jb + B / 2) * h, cz = oz + (kb + B / 2) * h;
    const dc = sdf(cx, cy, cz); evals++;
    const far = Math.abs(dc) > 3.4;
    for (let k = kb; k < k1; k++) for (let j = jb; j < j1; j++) for (let i = ib; i < i1; i++) {
      if (far) { data[(k * ny + j) * nx + i] = dc; continue; }
      data[(k * ny + j) * nx + i] = sdf(ox + i * h, oy + j * h, oz + k * h); evals++;
    }
  }
  log(`volume: ${nx}x${ny}x${nz}, evals ${evals}`);
  const sample = (x, y, z) => {
    let fx = (x - ox) / h, fy = (y - oy) / h, fz = (z - oz) / h;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return 2;
    const i = fx | 0, j = fy | 0, k = fz | 0;
    fx -= i; fy -= j; fz -= k;
    const o = (k * ny + j) * nx + i, sy = nx, sz = nx * ny;
    const a = data[o] * (1 - fx) + data[o + 1] * fx, b = data[o + sy] * (1 - fx) + data[o + sy + 1] * fx;
    const c = data[o + sz] * (1 - fx) + data[o + sz + 1] * fx, d = data[o + sz + sy] * (1 - fx) + data[o + sz + sy + 1] * fx;
    return (a * (1 - fy) + b * fy) * (1 - fz) + (c * (1 - fy) + d * fy) * fz;
  };
  return { ox, oy, oz, h, nx, ny, nz, data, sample };
}

/** Сферическая трассировка по объёму. Возвращает расстояние до камня или maxT, если не встретили. */
export function march(V, ox, oy, oz, dx, dy, dz, maxT, t0 = 0.2, eps = 0.05) {
  let t = t0;
  while (t < maxT) {
    const d = V.sample(ox + dx * t, oy + dy * t, oz + dz * t); // d<0 — воздух
    if (d > -eps) return t;
    t += Math.max(0.2, -d * 0.9);
  }
  return maxT;
}
/** Мягкая видимость между двумя точками (1 — свободно, 0 — закрыто). */
export function visibility(V, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-3) return 1;
  const ix = dx / L, iy = dy / L, iz = dz / L;
  let t = 0.25, res = 1;
  while (t < L - 0.2) {
    const d = -V.sample(ax + ix * t, ay + iy * t, az + iz * t); // свободное расстояние
    if (d < 0.02) return 0;
    res = Math.min(res, 6 * d / t);
    if (res < 0.02) return 0;
    t += Math.max(0.2, d * 0.85);
  }
  return Math.min(1, res);
}
