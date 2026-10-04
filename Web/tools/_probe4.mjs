import data from '../src/assets/sietch_cave.js';
import { unpack } from '../src/sietch/cave/pack.js';
import * as plan from '../src/sietch/plan.js';
const { header: H, A } = unpack(data);
plan.setGrids({ f0: A.f0, f1: A.f1, w0: A.w0, w1: A.w1, grid: H.grid, noFloor: H.noFloor });
const O = { x: 656, y: 30, z: 250 }, YAW = Math.PI / 3, c = Math.cos(YAW), s = Math.sin(YAW);
const toLocal = (x, z) => ({ x: (x - O.x) * c + (z - O.z) * s, z: -(x - O.x) * s + (z - O.z) * c });
for (const z of [394.6, 395.8, 397.0]) {
  const row = [];
  for (let x = 786; x <= 798; x += 1) { const l = toLocal(x, z); const f = plan.heightAtLocal(l.x, l.z, 0); row.push(`${x}:${plan.hasAnyFloor(l.x, l.z) ? (f + O.y).toFixed(2) : '--'}`); }
  console.log('z', z, row.join(' '));
}
// collision: push test at feet y
for (let x = 788; x <= 797; x += 1) {
  const l = toLocal(x, 395.8); const p = { x: l.x, z: l.z }; const moved = plan.collideLocal(p, 0.35, 0);
  console.log('collide at', x, moved, (p.x - l.x).toFixed(2), (p.z - l.z).toFixed(2));
}
