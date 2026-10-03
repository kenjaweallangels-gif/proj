// Подсчёт треугольников по LOD без браузера: node tools/char_tris_node.mjs [Preset|Archetype]
import { makeFigure, PRESETS, PALETTES } from '../src/core/figures.js';
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['Kair', 'Ilva', 'Harmat', 'Priestess', 'Stillsuit', 'Trader', 'Child', 'Elder'];
for (const n of names) {
  const o = PRESETS[n] ? { preset: n } : { ...PALETTES[n], name: 'NPC_' + n + '_1' };
  const f = makeFigure({ ...o, lod: 0 });
  const per = [0, 1, 2].map((l) => { const e = f.stats; return e.tris[l]; });
  console.log(n.padEnd(10), per.join(' / '));
}
