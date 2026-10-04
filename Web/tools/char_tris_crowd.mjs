// Треугольники по LOD для толпы из N фигур (архетипы PALETTES × crowdLook): max/avg LOD0/1/2 + число вариантов группового LOD.
//   node tools/char_tris_crowd.mjs [--n=40]
import { makeFigure, PALETTES, crowdLook, figureFarVariant } from '../src/core/figures.js';
import { geometryFor, triCount } from '../src/player/char_geometry.js';
const n = Number((process.argv.find((a) => a.startsWith('--n=')) || '--n=40').slice(4));
let seed = 777; const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const keys = Object.keys(PALETTES), rows = [], variants = new Map();
for (let i = 0; i < n; i++) {
  const arch = keys[i % keys.length], f = makeFigure({ ...PALETTES[arch], ...crowdLook(arch, R), name: `NPC_${arch}_${i}`, seed: 300 + i, lod: 0 });
  const t = f.stats.tris; rows.push({ arch, t });
  const v = figureFarVariant(f.options);
  if (!variants.has(v.key)) { const g1 = geometryFor(v.o, 1, v.key), g2 = geometryFor(v.o, 2, v.key); variants.set(v.key, [triCount(g1.body) + triCount(g1.cloth), triCount(g2.body) + triCount(g2.cloth)]); }
}
const stat = (l) => { const a = rows.map((r) => r.t[l]); return { max: Math.max(...a) | 0, avg: Math.round(a.reduce((x, y) => x + y, 0) / a.length), min: Math.min(...a) | 0 }; };
console.log('N =', n, ' LOD0', JSON.stringify(stat(0)), ' LOD1', JSON.stringify(stat(1)), ' LOD2', JSON.stringify(stat(2)));
const v = [...variants.values()];
console.log('групповой LOD: вариантов', v.length, ' треугольники на человека: LOD1 avg', Math.round(v.reduce((a, b) => a + b[0], 0) / v.length), ' LOD2 avg', Math.round(v.reduce((a, b) => a + b[1], 0) / v.length));
const worst = rows.sort((a, b) => b.t[0] - a.t[0]).slice(0, 3).map((r) => `${r.arch}:${r.t[0] | 0}`);
console.log('худшие LOD0:', worst.join(' '));
