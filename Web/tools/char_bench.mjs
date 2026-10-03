// Время сборки геометрии вариантов: node tools/char_bench.mjs
import { makeFigure } from '../src/core/figures.js';
let t = performance.now();
const keys = new Set();
for (let i = 0; i < 60; i++) { const f = makeFigure({ name: 'NPC_' + i, height: 1.6 + (i % 7) * 0.03 }); keys.add(f.options.seed + '|' + JSON.stringify(f.options.robeStyle)); }
console.log('60 figures (LOD1 build only):', (performance.now() - t).toFixed(0), 'ms');
t = performance.now();
for (let i = 0; i < 60; i++) makeFigure({ name: 'NPC_' + i, height: 1.6 + (i % 7) * 0.03 });
console.log('same 60 again (cached geometry):', (performance.now() - t).toFixed(0), 'ms');
