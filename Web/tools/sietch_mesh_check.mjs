// Проверка меша пещеры на дыры: граничные рёбра (используются одним треугольником), вывод кластеров. node tools/sietch_mesh_check.mjs [--cell=0.34]
import { createField } from '../src/sietch/cave/field.js';
import { surfaceNets } from '../src/sietch/cave/mesher.js';
import { buildVolume } from '../src/sietch/cave/volume.js';
import { BOUNDS } from '../src/sietch/cave/consts.js';
import { makeBlockActive } from '../src/sietch/cave/bake.js';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const cell = Number(arg('cell', 0.34));
const t0 = Date.now();
const field = createField();
const air = (x, y, z) => field.air(x, y, z);
const box = arg('box', '');
const B = box ? { min: box.split(',').slice(0, 3).map(Number), max: box.split(',').slice(3).map(Number) } : BOUNDS;
const V = buildVolume(air, B, 0.5);
const mesh = surfaceNets(air, B, cell, makeBlockActive(V, Number(arg('k', 1.15)), Number(arg('margin', 2.0))));
console.log(`mesh ${((Date.now() - t0) / 1000).toFixed(1)}s: ${mesh.positions.length / 3} verts, ${mesh.indices.length / 3} tris`);
const I = mesh.indices, P = mesh.positions;
const edges = new Map();
for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
  const a = I[t + e], b = I[t + (e + 1) % 3];
  const k = a < b ? a * 4294967296 + b : b * 4294967296 + a;
  const rec = edges.get(k);
  if (rec) rec.n++; else edges.set(k, { n: 1, a, b });
}
const bnd = [], nonman = [];
const inB = (x, y, z) => x > B.min[0] + 1 && y > B.min[1] + 1 && z > B.min[2] + 1 && x < B.max[0] - 1 && y < B.max[1] - 1 && z < B.max[2] - 1;
for (const r of edges.values()) {
  if (!inB(P[r.a * 3], P[r.a * 3 + 1], P[r.a * 3 + 2])) continue; if (r.n === 1) bnd.push(r); else if (r.n > 2) nonman.push(r); }
console.log(`граничных рёбер: ${bnd.length}, неманифолдных: ${nonman.length}`);
const cl = new Map();
for (const r of bnd) {
  const x = (P[r.a * 3] + P[r.b * 3]) / 2, y = (P[r.a * 3 + 1] + P[r.b * 3 + 1]) / 2, z = (P[r.a * 3 + 2] + P[r.b * 3 + 2]) / 2;
  const k = `${Math.floor(x / 4) * 4},${Math.floor(y / 4) * 4},${Math.floor(z / 4) * 4}`;
  cl.set(k, (cl.get(k) || 0) + 1);
}
const arr = [...cl.entries()].sort((a, b) => b[1] - a[1]);
console.log('кластеры (x,y,z блока 4 м → рёбер):');
for (const [k, n] of arr.slice(0, Number(arg('top', 40)))) console.log('  ', k, n);
if (arg('dump', '')) {
  const [cx, cy, cz] = arg('dump').split(',').map(Number);
  let n = 0;
  for (const r of bnd) {
    const x = (P[r.a * 3] + P[r.b * 3]) / 2, y = (P[r.a * 3 + 1] + P[r.b * 3 + 1]) / 2, z = (P[r.a * 3 + 2] + P[r.b * 3 + 2]) / 2;
    if (Math.abs(x - cx) > 2 || Math.abs(y - cy) > 2 || Math.abs(z - cz) > 2) continue;
    console.log(`edge @ ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)} air=${air(x, y, z).toFixed(3)} V=${V.sample(x, y, z).toFixed(3)} len=${Math.hypot(P[r.a * 3] - P[r.b * 3], P[r.a * 3 + 1] - P[r.b * 3 + 1], P[r.a * 3 + 2] - P[r.b * 3 + 2]).toFixed(3)}`);
    { // блок-кандидат по x/z-плоскостям: центры соседних блоков
      const h = cell, BS = 8, bs = BS * h;
      const out = [];
      for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
        const ib = Math.floor((x - B.min[0]) / bs) + dx, kb = Math.floor((z - B.min[2]) / bs) + dz, jb = Math.floor((y - B.min[1]) / bs);
        const ccx = B.min[0] + (ib + 0.5) * bs, ccy = B.min[1] + (jb + 0.5) * bs, ccz = B.min[2] + (kb + 0.5) * bs;
        out.push(`${dx}${dz}:V=${V.sample(ccx, ccy, ccz).toFixed(2)}/a=${air(ccx, ccy, ccz).toFixed(2)}`);
      }
      console.log('    ' + out.join(' '));
    }
    if (++n > 6) break;
  }
}
process.exit(0);
