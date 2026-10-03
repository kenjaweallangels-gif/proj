// Отладка событий шагов при низком fps: node tools/char_dbg2.mjs
import { makeFigure } from '../src/core/figures.js';
const f = makeFigure({ preset: 'Kair', lod: 0 });
let t = 0; const ev = [];
f.onStep = (e) => ev.push([+(t - (e.ago || 0)).toFixed(3), e.foot, +(e.ago || 0).toFixed(3)]);
f.group.rotation.y = 1.57;
for (let i = 0; i < 40; i++) { t += 0.1; f.animate(3, 0.1, 0); }
console.log(JSON.stringify(ev));
