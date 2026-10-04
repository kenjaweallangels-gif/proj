// Разбивка треугольников LOD по функциям-источникам: node tools/char_tris_breakdown.mjs [preset] [lod]
import { makeFigure } from '../src/core/figures.js';
import { GB, geometryFor } from '../src/player/char_geometry.js';
const preset = process.argv[2] || 'Kair', lod = Number(process.argv[3] ?? 0);
const acc = new Map();
const orig = GB.prototype.loft;
GB.prototype.loft = function (...a) {
  const before = this.idx.length;
  const r = orig.apply(this, a);
  const st = new Error().stack.split('\n').slice(2, 8).map((l) => l.trim().replace(/^at /, '').replace(/\s*\(.*$/, ''));
  const name = st.find((n) => n && !/^(ellipsoid|tube|hose|band|strip|Object\.|new )/.test(n) && n !== 'GB.loft') || st[0];
  const key = st.slice(0, 2).join(' < ');
  acc.set(key, (acc.get(key) || 0) + (this.idx.length - before) / 3);
  return r;
};
const f = makeFigure({ preset, lod });

const rows = [...acc.entries()].sort((a, b) => b[1] - a[1]);
let tot = 0; for (const [, v] of rows) tot += v;
console.log(preset, 'tris (all LODs built):', tot | 0);
for (const [k, v] of rows.slice(0, 28)) console.log(String(v | 0).padStart(7), k);
