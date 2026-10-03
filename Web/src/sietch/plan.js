// «Земля» сиетча: высота пола и коллизия стен берутся из запечённых сеток, полученных из SDF пещеры
// (floor-scan по полю + евклидово расстояние до стен на высоте тела). Два слоя: нижний (пол < 4.4 м) и верхний (карниз, мост, помост).
// Реквизит и уплотнители добавляют поверх свою коллизию (addBlock / registerDoor).
import { HALL, GALLERY, LEDGE, FUNERAL, SEALS, NICHES } from './cave/layout.js';

export { HALL, GALLERY, LEDGE, FUNERAL, SEALS, NICHES };
export const BRIDGE = { x0: 74.0, x1: 77.0 };
export const LAYER_Y = 3.4;

let G = null;
export function setGrids(grids) { G = grids; }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function floorSample(F, x, z) {
  const { h, ox, oz, nx, nz } = G.grid, NF = G.noFloor;
  const fx = (x - ox) / h - 0.5, fz = (z - oz) / h - 0.5;
  let i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return NaN;
  const tx = fx - i, tz = fz - j, k = j * nx + i;
  const a = F[k], b = F[k + 1], c = F[k + nx], d = F[k + nx + 1];
  const wa = (1 - tx) * (1 - tz), wb = tx * (1 - tz), wc = (1 - tx) * tz, wd = tx * tz;
  let s = 0, w = 0;
  if (a !== NF) { s += a * wa; w += wa; }
  if (b !== NF) { s += b * wb; w += wb; }
  if (c !== NF) { s += c * wc; w += wc; }
  if (d !== NF) { s += d * wd; w += wd; }
  return w > 0.2 ? s / w / 100 : NaN;
}

export function heightAtLocal(x, z, yFeet = 0) {
  if (!G) return 0;
  const first = yFeet > LAYER_Y ? G.f1 : G.f0, second = yFeet > LAYER_Y ? G.f0 : G.f1;
  let h = floorSample(first, x, z);
  if (Number.isNaN(h)) h = floorSample(second, x, z);
  return Number.isNaN(h) ? 0 : h;
}
/** Есть ли пол в точке (для расстановки реквизита/проверки). */
export function hasFloor(x, z, yFeet = 0) { if (!G) return false; return !Number.isNaN(floorSample(yFeet > LAYER_Y ? G.f1 : G.f0, x, z)); }

// ------------------------------------------------------------ коллизия ----
const blocks0 = [], blocks1 = []; // {x0,x1,z0,z1} или {cx,cz,r}
export function addBlock(b, level = 0) { (level ? blocks1 : blocks0).push(b); }
const doors = [];
export function registerDoor(d) { doors.push(d); }

function wallSample(W, x, z) {
  const { h, ox, oz, nx, nz } = G.grid;
  const fx = (x - ox) / h - 0.5, fz = (z - oz) / h - 0.5;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return -1;
  const tx = fx - i, tz = fz - j, k = j * nx + i;
  return ((W[k] * (1 - tx) + W[k + 1] * tx) * (1 - tz) + (W[k + nx] * (1 - tx) + W[k + nx + 1] * tx) * tz) * 0.05;
}
function blockDist(list, x, z) {
  let m = 9;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    let d;
    if (b.r !== undefined) d = Math.hypot(x - b.cx, z - b.cz) - b.r;
    else { const dx = Math.max(b.x0 - x, 0, x - b.x1), dz = Math.max(b.z0 - z, 0, z - b.z1); d = Math.hypot(dx, dz); if (dx === 0 && dz === 0) d = -Math.min(x - b.x0, b.x1 - x, z - b.z0, b.z1 - z); }
    if (d < m) m = d;
  }
  return m;
}
function dist(W, list, x, z) { return Math.min(wallSample(W, x, z), blockDist(list, x, z)); }

/** Выталкивает локальную позицию p ({x,z}) из стен; true, если сдвинули. */
export function collideLocal(p, r, yFeet) {
  if (!G) return false;
  const lv = yFeet > LAYER_Y;
  const W = lv ? G.w1 : G.w0, list = lv ? blocks1 : blocks0;
  let moved = false;
  for (let it = 0; it < 4; it++) {
    const s = dist(W, list, p.x, p.z);
    if (s >= r) break;
    const e = 0.12;
    const gx = dist(W, list, p.x + e, p.z) - dist(W, list, p.x - e, p.z), gz = dist(W, list, p.x, p.z + e) - dist(W, list, p.x, p.z - e);
    const gl = Math.hypot(gx, gz);
    if (gl < 1e-4) break;
    const push = r - s;
    p.x += (gx / gl) * push; p.z += (gz / gl) * push; moved = true;
  }
  // уплотнители (пока закрыты — стена)
  for (const d of doors) {
    if (d.open > 0.85) continue;
    if (d.axis === 'z') {
      if (Math.abs(p.x - d.x) < d.hw + 0.7 && Math.abs(p.z - d.z) < r + 0.14) { const side = d.side ?? (p.z < d.z ? -1 : 1); p.z = d.z + side * (r + 0.14); moved = true; }
    } else if (Math.abs(p.z - d.z) < d.hw + 0.9 && Math.abs(p.x - d.x) < r + 0.14) {
      const side = d.side ?? (p.x < d.x ? -1 : 1);
      p.x = d.x + side * (r + 0.14); moved = true;
    }
  }
  return moved;
}

export function zoneAtLocal(x, z) {
  if (x < 40.5) return 'B1_Airlock';
  if (x < 99) return 'B2_Gallery';
  if (x >= 150) return 'B5_Hall';
  if (z > 6.6 && x > 119.5 && x < 125.5) return 'B4_Cistern';
  return 'B3_Passages';
}
export function surfaceAtLocal(x, z) {
  return x > 160 && Math.hypot(x - HALL.cx, z - HALL.cz) < HALL.bowlR - 0.1 ? 'sand' : 'stone';
}

/** Ступень зала: радиальные ярусы (для рассадки толпы и т. п.). */
export function hallHeightSmooth(x, z) { return heightAtLocal(x, z, 0); }
