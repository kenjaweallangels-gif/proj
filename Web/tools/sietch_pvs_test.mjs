// Проверка PVS: из случайных точек камеры (на 1.6 м над проходимым полом) бросаем лучи к вершинам чанков; если чанк виден (луч свободен), а в PVS-строке
// ячейки камеры его нет — это потенциальный «провал» (кусок стены не нарисуется). node tools/sietch_pvs_test.mjs [--n=400]
import data from '../src/assets/sietch_cave.js';
import { unpack } from '../src/sietch/cave/pack.js';
import { createField } from '../src/sietch/cave/field.js';
import { buildVolume } from '../src/sietch/cave/volume.js';
import { BOUNDS } from '../src/sietch/cave/consts.js';
import * as plan from '../src/sietch/plan.js';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const { header: H, A } = unpack(data);
plan.setGrids({ f0: A.f0, f1: A.f1, w0: A.w0, w1: A.w1, grid: H.grid, noFloor: H.noFloor });
const field = createField();
const V = buildVolume((x, y, z) => field.air(x, y, z), BOUNDS, 0.5);
const pv = H.pvs, idx = A.pvsIdx, bits = A.pvsBits, q = H.quant;
// вершины чанков
const I = A.idx, P = A.pos;
const chunks = H.chunks.map((c) => { const pts = []; const nt = c.count / 3; for (let i = 0; i < 60; i++) { const t = Math.floor(((i + 0.5) / 60) * nt), v = I[c.start + t * 3 + (i % 3)]; pts.push([q.o[0] + P[v * 3] * q.s, q.o[1] + P[v * 3 + 1] * q.s, q.o[2] + P[v * 3 + 2] * q.s]); } return { pts, bs: c.bs }; });
function clear(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz); if (L < 0.4) return true;
  const ix = dx / L, iy = dy / L, iz = dz / L; let t = 0.2; const te = L - 0.35;
  while (t < te) { const d = V.sample(a[0] + ix * t, a[1] + iy * t, a[2] + iz * t); if (d > -0.03) return false; t += Math.max(0.2, -d * 0.85); }
  return true;
}
let seed = 987654321; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const g = H.grid; const N = Number(arg('n', 400));
let tested = 0, missingCases = 0, missingChunks = 0, visTotal = 0, worst = [];
while (tested < N) {
  const x = g.ox + rnd() * g.nx * g.h, z = g.oz + rnd() * g.nz * g.h;
  if (!plan.hasAnyFloor(x, z)) continue;
  const lay = rnd() < 0.15 ? 6.5 : 0;
  const fy = plan.heightAtLocal(x, z, lay);
  const cam = [x, fy + 1.6, z];
  if (V.sample(cam[0], cam[1], cam[2]) > -0.3) continue;
  const i = Math.floor((cam[0] - pv.ox) / pv.cs), j = Math.floor((cam[1] - pv.oy) / pv.cs), k = Math.floor((cam[2] - pv.oz) / pv.cs);
  const row = idx[(k * pv.ny + j) * pv.nx + i];
  tested++;
  if (row < 0) { missingCases++; worst.push([cam.map((v) => +v.toFixed(1)), 'нет строки']); continue; }
  let miss = 0;
  chunks.forEach((c, ci) => {
    const d = Math.hypot(c.bs[0] - cam[0], c.bs[1] - cam[1], c.bs[2] - cam[2]) - c.bs[3];
    if (d > 115) return;
    let vis = 0;
    for (const p of c.pts) if (clear(cam, p)) vis++;
    if (vis >= 3) { visTotal++; if (!(bits[row * pv.nb + (ci >> 3)] & (1 << (ci & 7)))) { miss++; missingChunks++; } }
  });
  if (miss) { missingCases++; worst.push([cam.map((v) => +v.toFixed(1)), miss]); }
}
console.log(`камер ${tested}; с пропуском чанков: ${missingCases}; пропущено видимых (≥3 вершин) чанков: ${missingChunks} из ${visTotal}`);
console.log('худшие:', worst.sort((a, b) => b[1] - a[1]).slice(0, 8).map((w) => `${w[0]} → ${w[1]}`).join(' | '));
