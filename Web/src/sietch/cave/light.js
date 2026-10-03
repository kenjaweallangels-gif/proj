// Источники запечённого света (светошары, шахты-колодцы, луч зала) и функция освещения точки с тенями по SDF-объёму.
import { visibility } from './volume.js';
import * as L from './layout.js';
import { clamp, smoothstep } from './sdf.js';

export const AMBER = [1.0, 0.6, 0.26];

/** Источники: omni — точечные (d0 — мягкость, radius — предел), beam — вертикальный конус света сверху вниз. */
export function buildLights(globes) {
  const omni = [], beams = [];
  for (const g of globes) omni.push({ x: g.x, y: g.y, z: g.z, color: AMBER, intensity: 0.62 * g.k, d0: 2.8, radius: 15, shadow: true });
  for (const w of L.WELLS) {
    if (w.slit) continue;
    beams.push({ x: w.x, z: w.z, y0: 0, y1: w.y0 + 1, rTop: w.r, rBot: w.rBottom, color: [0.42, 0.6, 0.95], intensity: 1.15 });
    omni.push({ x: w.x, y: 0.7, z: w.z, color: [0.4, 0.58, 0.95], intensity: 0.5, d0: 3, radius: 12, shadow: true });
  }
  const H = L.HALL;
  beams.push({ x: H.cx, z: H.cz, y0: H.bowlY, y1: H.vaultTop + 1, rTop: H.shaftR, rBot: 3.3, color: [1.0, 0.86, 0.62], intensity: 1.5 });
  omni.push({ x: H.cx, y: H.bowlY + 1.0, z: H.cz, color: [1.0, 0.8, 0.55], intensity: 1.0, d0: 5, radius: 22, shadow: true });
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.2; omni.push({ x: H.cx + Math.cos(a) * 11, y: 15, z: H.cz + Math.sin(a) * 9, color: [1.0, 0.7, 0.4], intensity: 1.0, d0: 6, radius: 22, shadow: true }); }
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; omni.push({ x: H.cx + Math.cos(a) * 4, y: 10, z: H.cz + Math.sin(a) * 4, color: [1.0, 0.8, 0.55], intensity: 0.7, d0: 5, radius: 14, shadow: true }); }
  omni.push({ x: -3.3, y: 1.6, z: -1.3, color: [0.4, 0.58, 0.9], intensity: 1.4, d0: 2.4, radius: 9, shadow: true });
  return { omni, beams };
}

/** Освещение точки p с нормалью n (null — зонд без направления). Возвращает [r,g,b] (может быть > 1). */
export function shadeAt(lights, V, p, n, ao) {
  let r = 0, g = 0, b = 0;
  const x = p[0], y = p[1], z = p[2];
  const sx = n ? x + n[0] * 0.18 : x, sy = n ? y + n[1] * 0.18 : y, sz = n ? z + n[2] * 0.18 : z;
  for (const s of lights.omni) {
    const dx = s.x - x, dy = s.y - y, dz = s.z - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const R = s.radius;
    if (d2 > R * R) continue;
    const d = Math.sqrt(d2) + 1e-4;
    let w = (1 / (1 + (d / s.d0) ** 2)) * (1 - d / R) ** 1.5;
    let ndl = 0.7;
    if (n) ndl = clamp(((n[0] * dx + n[1] * dy + n[2] * dz) / d) * 0.65 + 0.35, 0.05, 1);
    const vis = d < 0.5 ? 1 : visibility(V, s.x, s.y, s.z, sx, sy, sz);
    // прямой свет + дешёвое «переотражение» без теней (даёт мягкое заполнение в нишах)
    const wd = w * ndl * vis * s.intensity;
    const wb = (s.intensity * 0.07 * (1 - d / R) ** 2) / (1 + (d / 7) ** 2) * ao;
    const k = wd + wb;
    r += s.color[0] * k; g += s.color[1] * k; b += s.color[2] * k;
  }
  for (const s of lights.beams) {
    if (y > s.y1 || y < s.y0 - 0.6) continue;
    const t = clamp((y - s.y0) / (s.y1 - s.y0), 0, 1);
    const R = s.rBot + (s.rTop - s.rBot) * t;
    const hd = Math.hypot(x - s.x, z - s.z);
    if (hd > R + 1.2) continue;
    const inside = 1 - smoothstep(R - 0.5, R + 0.5, hd);
    if (inside <= 0) continue;
    const lamb = n ? clamp(-n[1] * 0.85 + 0.15, 0, 1) : 0.5;
    const w = s.intensity * inside * lamb * (0.7 + 0.3 * (1 - t));
    r += s.color[0] * w; g += s.color[1] * w; b += s.color[2] * w;
  }
  return [r, g, b];
}
