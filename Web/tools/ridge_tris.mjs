// Число треугольников хребта по качеству (node tools/ridge_tris.mjs): ближний/дальний LOD и сумма.
import { buildMassifChunk, ridgeChunks } from '../src/desert/ridge.js';
const L = { low: [[6, 33], [18, 17]], med: [[3.5, 73], [10, 37]], high: [[2.5, 97], [8, 49]] };
for (const [q, lv] of Object.entries(L)) {
  const out = lv.map(([ds, np]) => ridgeChunks().reduce((a, c) => a + buildMassifChunk(c.m, c.s0, c.s1, ds, np).geo.index.count / 3, 0));
  console.log(`${q}: LOD0 всех кусков ${out[0]} tri, LOD1 ${out[1]} tri, кусков ${ridgeChunks().length}`);
}
