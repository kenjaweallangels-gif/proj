// Отладка геометрии без браузера: node tools/char_dbg.mjs
import { makeFigure } from '../src/core/figures.js';
for (const p of ['Stillsuit', 'Kair']) {
  const f = makeFigure({ preset: p, lod: 0 });
  const g = f.parts.body.geometry, reg = g.attributes.region.array, cnt = {};
  for (const r of reg) cnt[r] = (cnt[r] || 0) + 1;
  console.log(p, JSON.stringify(cnt), 'maskState', f.options.maskState, 'hood', f.options.hood, 'cowl', f.options.cowl);
}
