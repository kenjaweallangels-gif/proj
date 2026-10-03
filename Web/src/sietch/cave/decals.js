// Конформные декали (три слоя истории: резьба / печати Квизарата / росписи / детский мел / ладони) — запекаются вместе с пещерой:
// сетка квадрата проецируется на реальную поверхность камня по SDF, освещение и AO — те же, что у стен.
import { rayHit } from './field.js';
import { DECALS } from './decals_layout.js';
import { shadeAt } from './light.js';
import { march } from './volume.js';
import { clamp } from './sdf.js';

export function buildDecals({ field, V, lights, log }) {
  const groups = new Map(); // tex → {pos, nor, uv, glow, ao, idx}
  let skipped = 0;
  const up = [0, 1, 0];
  for (const d of DECALS) {
    const dl = Math.hypot(...d.d);
    const dir = d.d.map((v) => v / dl);
    const t = rayHit(field, d.o, dir, d.maxT || 14);
    if (t < 0) { skipped++; continue; }
    const c = [d.o[0] + dir[0] * t, d.o[1] + dir[1] * t, d.o[2] + dir[2] * t];
    const n = field.grad(c[0], c[1], c[2], 0.1).map((v) => -v);
    // касательные: u — по горизонтали вдоль стены, v — вверх вдоль стены
    let ux = up[1] * n[2] - up[2] * n[1], uy = up[2] * n[0] - up[0] * n[2], uz = up[0] * n[1] - up[1] * n[0];
    let ul = Math.hypot(ux, uy, uz); if (ul < 0.2) { skipped++; continue; } ux /= ul; uy /= ul; uz /= ul;
    let vx = n[1] * uz - n[2] * uy, vy = n[2] * ux - n[0] * uz, vz = n[0] * uy - n[1] * ux;
    const rot = d.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot);
    [ux, uy, uz, vx, vy, vz] = [ux * cr + vx * sr, uy * cr + vy * sr, uz * cr + vz * sr, -ux * sr + vx * cr, -uy * sr + vy * cr, -uz * sr + vz * cr];
    const w = d.w, h = d.h, NX = d.nx || Math.max(6, Math.ceil(w / 0.22)), NY = d.ny || Math.max(6, Math.ceil(h / 0.22));
    let g = groups.get(d.tex);
    if (!g) { g = { tex: d.tex, pos: [], nor: [], uv: [], glow: [], ao: [], idx: [], count: 0, layer: d.layer || 1 }; groups.set(d.tex, g); }
    const base = g.pos.length / 3;
    const ok = new Uint8Array((NX + 1) * (NY + 1));
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
      const s = (i / NX - 0.5) * w, tt = (j / NY - 0.5) * h;
      // точка в плоскости касания, отодвинутая по нормали, затем проекция на поверхность вдоль −n
      let px = c[0] + ux * s + vx * tt + n[0] * 0.8, py = c[1] + uy * s + vy * tt + n[1] * 0.8, pz = c[2] + uz * s + vz * tt + n[2] * 0.8;
      const hit = rayHit(field, [px, py, pz], [-n[0], -n[1], -n[2]], 2.0);
      let q;
      if (hit < 0) { q = [px - n[0] * 0.8, py - n[1] * 0.8, pz - n[2] * 0.8]; } else { q = [px - n[0] * hit, py - n[1] * hit, pz - n[2] * hit]; ok[j * (NX + 1) + i] = 1; }
      const nn = field.grad(q[0], q[1], q[2], 0.08).map((v) => -v);
      const off = 0.006 + 0.005 * (d.layer || 1);
      const pos = [q[0] + nn[0] * off, q[1] + nn[1] * off, q[2] + nn[2] * off];
      g.pos.push(...pos); g.nor.push(...nn);
      const uu = d.flipU ? 1 - i / NX : i / NX;
      g.uv.push(uu, j / NY);
      const ao = clamp(1 - 0.0, 0, 1);
      const aoV = aoSimple(V, pos, nn);
      const sh = shadeAt(lights, V, pos, nn, aoV);
      g.glow.push(sh[0], sh[1], sh[2]); g.ao.push(aoV);
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i, b = a + 1, cc = a + NX + 1, dd = cc + 1;
      if (!(ok[a] && ok[b] && ok[cc] && ok[dd])) continue;
      g.idx.push(base + a, base + b, base + dd, base + a, base + dd, base + cc);
    }
    g.count++;
  }
  if (skipped) log(`декали: пропущено ${skipped} (нет стены)`);
  // подгонка ориентации треугольников под нормали
  const out = [];
  for (const g of groups.values()) {
    for (let t = 0; t < g.idx.length; t += 3) {
      const a = g.idx[t], b = g.idx[t + 1], c = g.idx[t + 2];
      const P = g.pos, N = g.nor;
      const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
      const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * N[a * 3] + ny * N[a * 3 + 1] + nz * N[a * 3 + 2] < 0) { g.idx[t + 1] = c; g.idx[t + 2] = b; }
    }
    out.push({ tex: g.tex, count: g.count, layer: g.layer, positions: new Float32Array(g.pos), normals: new Float32Array(g.nor), uvs: new Float32Array(g.uv), glow: new Float32Array(g.glow), ao: new Float32Array(g.ao), indices: new Uint32Array(g.idx) });
  }
  return out;
}

function aoSimple(V, p, n) {
  let occ = 0;
  const ox = p[0] + n[0] * 0.1, oy = p[1] + n[1] * 0.1, oz = p[2] + n[2] * 0.1;
  const dirs = [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
  let k = 0;
  for (const d of dirs) {
    const dot = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
    if (dot < 0.1) continue;
    const t = march(V, ox, oy, oz, d[0] * 0.5 + n[0] * 0.5, d[1] * 0.5 + n[1] * 0.5, d[2] * 0.5 + n[2] * 0.5, 4, 0.15, 0.06);
    occ += 1 - t / 4; k++;
  }
  return clamp(1 - (k ? occ / k : 0) * 1.1, 0.1, 1);
}
