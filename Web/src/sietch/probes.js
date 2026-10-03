// Зонды освещения пещеры (1 м): запечённый тёплый свет с тенями + AO. Используются для реквизита, толпы, декоративных мешей.
import * as THREE from 'three';

export function createProbes(P) {
  const { ox, oy, oz, h, nx, ny, nz, data } = P;
  const out = { r: 0, g: 0, b: 0, ao: 1 };
  const dec = (v) => { const f = v / 255; return f * f * 4; };
  /** Трилинейная выборка → out {r,g,b,ao}. */
  function sample(x, y, z) {
    let fx = (x - ox) / h - 0.5, fy = (y - oy) / h - 0.5, fz = (z - oz) / h - 0.5;
    fx = Math.min(Math.max(fx, 0), nx - 1.001); fy = Math.min(Math.max(fy, 0), ny - 1.001); fz = Math.min(Math.max(fz, 0), nz - 1.001);
    const i = fx | 0, j = fy | 0, k = fz | 0;
    const tx = fx - i, ty = fy - j, tz = fz - k;
    let r = 0, g = 0, b = 0, ao = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
      if (w < 1e-4) continue;
      const id = ((k + dz) * ny + (j + dy)) * nx + (i + dx);
      r += dec(data[id * 4]) * w; g += dec(data[id * 4 + 1]) * w; b += dec(data[id * 4 + 2]) * w; ao += data[id * 4 + 3] * w;
    }
    out.r = r; out.g = g; out.b = b; out.ao = ao / 255;
    return out;
  }
  /**
   * Заполняет атрибуты aGlow (rgb, линейные) и вершинный `color`-множитель AO геометрии реквизита по зондам.
   * Берётся точка на 0.3 м над поверхностью вдоль нормали (лицом к свету).
   */
  function bakeGeometry(geo, opts = {}) {
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const n = pos.count;
    const glow = new Float32Array(n * 3), ao = new Float32Array(n);
    const off = opts.offset ?? 0.3;
    for (let i = 0; i < n; i++) {
      const s = sample(pos.getX(i) + nor.getX(i) * off, pos.getY(i) + nor.getY(i) * off, pos.getZ(i) + nor.getZ(i) * off);
      const dk = opts.dim ?? 1;
      glow[i * 3] = s.r * dk; glow[i * 3 + 1] = s.g * dk; glow[i * 3 + 2] = s.b * dk; ao[i] = s.ao;
    }
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 3));
    geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
    return geo;
  }
  return { sample, bakeGeometry, out };
}
