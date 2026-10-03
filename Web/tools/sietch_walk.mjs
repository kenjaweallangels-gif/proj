// Тест проходимости сиетча без браузера: заливка по запечённым сеткам пола/стен (радиус игрока 0.35) от шлюза B1.
// node tools/sietch_walk.mjs  — проверяет достижимость всех зон, спотов реквизита и портала, а также посадку внутри скалы.
import data from '../src/assets/sietch_cave.js';
import { unpack } from '../src/sietch/cave/pack.js';
import * as plan from '../src/sietch/plan.js';
import { CAVE_YAW, EXIT, SEALS } from '../src/sietch/cave/layout.js';
import { clawInside, SIETCH_ORIGIN as O, GARDEN, ENTRY } from '../src/core/layout.js';

const { header: H, A } = unpack(data);
const grids = { f0: A.f0, f1: A.f1, w0: A.w0, w1: A.w1, grid: H.grid, noFloor: H.noFloor };
plan.setGrids(grids);
const G = H.grid, R = 0.35;
const key = (i, j, l) => (l * G.nz + j) * G.nx + i;
const seen = new Map(); // key → y
const cx = (i) => G.ox + (i + 0.5) * G.h, cz = (j) => G.oz + (j + 0.5) * G.h;
const idx = (x, z) => [Math.floor((x - G.ox) / G.h), Math.floor((z - G.oz) / G.h)];
const start = { x: 2.4, z: 0 };
const q = [];
{ const [i, j] = idx(start.x, start.z); const y = plan.heightAtLocal(start.x, start.z, 0); q.push([i, j, y]); seen.set(key(i, j, 0), y); }
const W = [grids.w0, grids.w1];
let head = 0;
while (head < q.length) {
  const [i, j, y] = q[head++];
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const ni = i + di, nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= G.nx || nj >= G.nz) continue;
    const x = cx(ni), z = cz(nj);
    const lay = y > plan.LAYER_Y ? 1 : 0;
    const wd = W[lay][nj * G.nx + ni] * 0.05;
    if (wd < R) continue;
    const ny = plan.heightAtLocal(x, z, y);
    if (!plan.hasFloor(x, z, y)) continue;
    if (Math.abs(ny - y) > 0.55) continue;
    const k = key(ni, nj, ny > plan.LAYER_Y ? 1 : 0);
    if (seen.has(k)) continue;
    seen.set(k, ny); q.push([ni, nj, ny]);
  }
}
const reach = (x, z, label) => {
  let best = 9, by = 0;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const [i, j] = idx(x + dx * 0.25, z + dz * 0.25);
    for (const l of [0, 1]) if (seen.has(key(i, j, l))) { const d = Math.hypot(dx, dz) * 0.25; if (d < best) { best = d; by = seen.get(key(i, j, l)); } }
  }
  const ok = best < 9;
  console.log(`${ok ? 'OK ' : 'XX '} ${label.padEnd(22)} (${x}, ${z})${ok ? ` y=${by.toFixed(2)}` : ''}`);
  return ok;
};
console.log('достижимых клеток:', seen.size);
const pts = [
  [2.4, 0, 'B1 спавн'], [-2.4, 7.4, 'вход-расщелина'], [12, 0, 'шлюз'], [30, 0.5, 'проход B1'], [44, 0, 'B2 вход'], [60, 0, 'B2 центр'], [95, 0, 'B2 восток'],
  [56, 6.5, 'карниз юг (ярус 2)'], [56, -6.3, 'карниз север'], [75.5, 0, 'мост (низ)'], [75.5, 3.5, 'карниз у моста'],
  [55, -4.8, 'ниша-лавка'], [80, 5.4, 'водяная станция'], [79, -5.2, 'мастерская'], [57, 5.4, 'ткачиха'], [47, -0.5, 'дети'],
  [104, 0.5, 'B3 начало'], [114, 0.4, 'B3 центр'], [114, -2.9, 'ниша север'], [108, 2.9, 'святилище'], [121.4, 7.0, 'у решётки B4'], [140, 0, 'B3 конец'],
  [104, -7.4, 'N ветка'], [130, -14.9, 'N тупик'], [153, 0, 'B5 вход'], [167, 0, 'чаша край'], [175, 0, 'чаша центр'], [185, 6, 'ярус'], [192.2, 0.2, 'помост наиба'],
  [194, 7, 'лестница помоста'], [183, -14, 'выход: начало'], [187, -45, 'выход: портал'], [194, -46, 'портал (конец)'],
];
let bad = 0;
for (const [x, z, l] of pts) if (!reach(x, z, l)) bad++;
// посадка внутри скалы
const c = Math.cos(O.yaw + CAVE_YAW), s = Math.sin(O.yaw + CAVE_YAW);
let worst = 1e9, wp = null;
for (const [k, y] of seen) {
  const l = Math.floor(k / (G.nz * G.nx)); const r = k - l * G.nz * G.nx; const j = Math.floor(r / G.nx), i = r - j * G.nx;
  const x = cx(i), z = cz(j);
  const wx = O.x + x * c - z * s, wz = O.z + x * s + z * c;
  const m = clawInside(wx, wz, 0);
  if (m < worst) { worst = m; wp = [x, z, wx, wz]; }
}
console.log('минимальный запас до края скалы по проходимой зоне: %s м, в точке', worst.toFixed(1), wp?.map((v) => v.toFixed(1)).join(' '));
const pw = [O.x + 194 * c + 46.2 * s, O.z + 194 * s - 46.2 * c];
console.log('портал в мире ≈', pw.map((v) => v.toFixed(1)).join(', '), ' ожидается', GARDEN.portal.x, GARDEN.portal.z);
const ew = [O.x + -3 * c - 9 * s, O.z + -3 * s + 9 * c];
console.log('устье расщелины в мире ≈', ew.map((v) => v.toFixed(1)).join(', '), ' ожидается ~', ENTRY.cleft.x, ENTRY.cleft.z);
if (process.argv.includes('--dump')) {
  const rows = [];
  for (let z = -9; z <= 9; z += 0.5) { let r = String(z).padStart(5) + ' '; for (let x = 40; x <= 100; x += 0.5) { const [i, j] = idx(x, z); const a = seen.get(key(i, j, 0)), b = seen.get(key(i, j, 1)); r += b !== undefined ? '^' : a !== undefined ? '.' : ' '; } rows.push(r); }
  console.log(rows.join('\n'));
}
console.log(bad ? `ПРОВАЛ: недостижимо точек: ${bad}` : 'OK: все точки достижимы');
process.exit(bad ? 1 : 0);
