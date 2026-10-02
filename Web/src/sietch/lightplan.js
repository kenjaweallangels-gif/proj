// Расстановка светошаров и световых колодцев (данные; геометрию кронштейнов делает arch.js, свет — lighting.js).
import { HALL } from './plan.js';

/** @typedef {{x:number,y:number,z:number,region:string,k:number,wall?:number[]|null,chain?:number,hot?:number}} Globe */

export function planGlobes() {
  /** @type {Globe[]} */
  const G = [];
  const add = (region, x, y, z, k = 1, wall = null, chain = 0) => G.push({ x, y, z, region, k, wall, chain });
  // B1: на стенах, чередуясь.
  [4, 12, 18, 26, 31, 37].forEach((x, i) => { const s = i % 2 ? 1 : -1; add('B1', x, 3.0, s * 1.74, 1, [0, 0, -s]); });
  // B2: нижний ярус на стенах под балконом, балкон, подвесные.
  for (let i = 0; i < 10; i++) { const x = 47 + i * 5.6; add('B2', x, 3.4, -7.2, 1.0, [0, 0, 1]); add('B2', x + 2.8, 3.4, 7.2, 1.0, [0, 0, -1]); }
  for (let i = 0; i < 8; i++) { const x = 53 + i * 6; add('B2', x, 7.6, i % 2 ? -7.2 : 7.2, 0.9, [0, 0, i % 2 ? 1 : -1]); }
  for (let i = 0; i < 9; i++) add('B2', 48 + i * 6, 8.4 - (i % 2) * 0.8, ((i * 37) % 5 - 2) * 0.9, 1.15, null, 12 - (8.4 - (i % 2) * 0.8));
  add('B2', 42, 3.2, 0.0, 0.8, null, 0);
  // B3: низкие, меньше. Центр (z=0), север, юг.
  for (let x = 103; x < 148; x += 5.5) add('B3', x, 2.35, (Math.round(x) % 2 ? -1 : 1) * 1.38, 0.8, [0, 0, (Math.round(x) % 2 ? 1 : -1)]);
  for (let x = 104; x < 118; x += 5) add('B3', x, 2.35, -6.38, 0.75, [0, 0, 1]);
  add('B3', 116.5, 2.35, -10, 0.7, [0, 0, 0]);
  for (let x = 118; x < 134; x += 5.5) add('B3', x, 2.35, -13.62, 0.7, [0, 0, 1]);
  for (let x = 103; x < 123; x += 5) add('B3', x, 2.35, 6.38, 0.75, [0, 0, -1]);
  // B4: цистерна — над водой.
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) add('B4', 118 + i * 7, 4.6 - (i + j) % 2 * 0.5, 13 + j * 8, 1.0, null, 3.4);
  add('B4', 122, 2.4, 7.0, 0.6, [0, 0, 0]);
  // B5: у стен, по кольцу ярусов, над шахтой.
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2 + 0.26; const r = 18.8; add('B5', HALL.cx + Math.cos(a) * r, 1.55, HALL.cz + Math.sin(a) * r * 0.97, 1.2, null, 0); }
  for (let i = 0; i < 7; i++) { const x = 156 + i * 7; add('B5', x, 4.2, -17.1, 1.0, [0, 0, 1]); add('B5', x, 4.2, 17.1, 1.0, [0, 0, -1]); }
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add('B5', HALL.cx + Math.cos(a) * 9.5, 13.0 + (i % 2) * 1.5, HALL.cz + Math.sin(a) * 9.5, 0.9, null, 11.5); }
  add('B5', 152, 3.4, -3.3, 0.9, [1, 0, 0]); add('B5', 152, 3.4, 3.3, 0.9, [1, 0, 0]);
  return G;
}

/** Световые колодцы с поверхности (холодный сине-белый луч вниз). */
export function planWells() {
  return [
    { region: 'B2', x: 62, z: 0, y0: 12.3, r: 1.05, h: 3.0, kind: 'well' },
    { region: 'B2', x: 88, z: 0, y0: 12.3, r: 1.05, h: 3.0, kind: 'well' },
    { region: 'B3', x: 127, z: 0, y0: 3.8, r: 0.5, h: 2.2, kind: 'slit' },
  ];
}
