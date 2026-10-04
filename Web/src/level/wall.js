// Таблица положения западной стены «Когтя» у входа: wallX(z, y) → x поверхности меша скалы (м).
// Строится лучами по реальной геометрии buildClawGeometry (desert/rock.js), чтобы выступы тропы сидели точно на стене.
// Если геометрия недоступна — линейная аппроксимация.

const FALLBACK_W = (z) => 651 - 0.126 * (z - 225);
const FALLBACK_E = (z) => 798 + 0.58 * (z - 390);

export function buildWallTable(getGeometry, zone, quality = 'med', side = 'west', res = {}) {
  const east = side === 'east';
  const { z0, z1, yMax } = zone;
  const dz = res.dz ?? 2, dy = res.dy ?? 4;
  const nz = Math.ceil((z1 - z0) / dz) + 1, ny = Math.ceil(yMax / dy) + 1;
  const tab = new Float32Array(nz * ny);
  let ok = false;
  try {
    const g = getGeometry(quality);
    const P = g.getAttribute('position'), I = g.index.array;
    // Растеризация: для каждого треугольника рядом со входом — x его плоскости в узлах сетки (z, y); берём первый по лучу (запад: min x, восток: max x).
    // Это то же «первое пересечение луча вдоль оси x», что давал Raycaster, но без перебора всех пар луч×треугольник (годится для шага 0.5 м).
    tab.fill(NaN);
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const ax = P.getX(a), ay = P.getY(a), az = P.getZ(a), bx = P.getX(b), by = P.getY(b), bz = P.getZ(b), cx = P.getX(c), cy = P.getY(c), cz = P.getZ(c);
      if ((east ? (Math.min(ax, bx, cx) < 740 || Math.max(ax, bx, cx) > 860) : (Math.min(ax, bx, cx) < 600 || Math.max(ax, bx, cx) > 700))) continue;
      const mnz = Math.min(az, bz, cz), mxz = Math.max(az, bz, cz), mny = Math.min(ay, by, cy), mxy = Math.max(ay, by, cy);
      if (mxz < z0 - 14 || mnz > z1 + 14 || mny > yMax + 60) continue;
      const k0 = Math.max(0, Math.ceil((mnz - z0) / dz)), k1 = Math.min(nz - 1, Math.floor((mxz - z0) / dz));
      const j0 = Math.max(0, Math.ceil((mny - 0.5) / dy)), j1 = Math.min(ny - 1, Math.floor((mxy - 0.5) / dy));
      if (k0 > k1 || j0 > j1) continue;
      // барицентрика в плоскости (z, y)
      const den = (by - cy) * (az - cz) + (cz - bz) * (ay - cy);
      if (Math.abs(den) < 1e-9) continue;
      for (let k = k0; k <= k1; k++) {
        const pz = z0 + k * dz;
        for (let j = j0; j <= j1; j++) {
          const py = j * dy + 0.5;
          const u = ((by - cy) * (pz - cz) + (cz - bz) * (py - cy)) / den, v = ((cy - ay) * (pz - cz) + (az - cz) * (py - cy)) / den, w = 1 - u - v;
          if (u < -1e-7 || v < -1e-7 || w < -1e-7) continue;
          const x = u * ax + v * bx + w * cx, o = k * ny + j, cur = tab[o];
          if (!Number.isFinite(cur) || (east ? x > cur : x < cur)) tab[o] = x;
        }
      }
    }
    // заполнить NaN ближайшими значениями по y (ниже подошвы стены лучи могут уходить в песок)
    let any = 0;
    for (let k = 0; k < nz; k++) {
      let last = NaN;
      for (let j = ny - 1; j >= 0; j--) { const v = tab[k * ny + j]; if (Number.isFinite(v)) { last = v; any++; } else if (Number.isFinite(last)) tab[k * ny + j] = last; }
      for (let j = 0; j < ny; j++) if (!Number.isFinite(tab[k * ny + j])) tab[k * ny + j] = (east ? FALLBACK_E : FALLBACK_W)(z0 + k * dz);
    }
    ok = any > 0;
  } catch (e) {
    ok = false;
  }
  if (!ok) for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) tab[k * ny + j] = (east ? FALLBACK_E : FALLBACK_W)(z0 + k * dz);
  const fn = (z, y) => {
    const fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / dz)), fy = Math.min(ny - 1.001, Math.max(0, (y - 0.5) / dy));
    const k = fz | 0, j = fy | 0, u = fz - k, v = fy - j;
    const a = tab[k * ny + j], b = tab[(k + 1) * ny + j], c = tab[k * ny + j + 1], d = tab[(k + 1) * ny + j + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  fn.fromGeometry = ok;
  return fn;
}
