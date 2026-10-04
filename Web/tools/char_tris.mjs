// Подсчёт треугольников фигур по LOD (без браузера): node tools/char_tris.mjs
import { figureTriangles } from '../src/core/figures.js';
const rows = [['Kair'], ['Ilva'], ['Rayn'], ['Ossana'], ['Rider'], ['Rider2'], ['Harmat'], ['Priestess'], ['Guard']];
for (const [p] of rows) { const t = figureTriangles({ preset: p }); console.log(p.padEnd(10), 'LOD0', t[0] | 0, 'LOD1', t[1] | 0, 'LOD2', t[2] | 0); }
for (const n of ['npc_a', 'npc_b', 'npc_c']) { const t = figureTriangles({ name: n }); console.log(n.padEnd(10), 'LOD0', t[0] | 0, 'LOD1', t[1] | 0, 'LOD2', t[2] | 0); }
const c = figureTriangles({ name: 'kid', height: 1.2 }); console.log('child'.padEnd(10), 'LOD0', c[0] | 0, 'LOD1', c[1] | 0, 'LOD2', c[2] | 0);
