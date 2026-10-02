// План сиетча (локальные координаты, +X вглубь, +Z на юг, Y вверх) и «земля»:
// ячейки-помещения, высота пола (лестницы, ярусы, балкон, чаша), SDF-коллизия (два уровня), зоны.
import { SIETCH } from '../core/layout.js';
import { clamp } from '../core/util.js';

export const HALL = { cx: 175, cz: 0, hx: 25, hz: 17.5, bowlY: -2.7, bowlR: SIETCH.B5.bowlR, tierW: 1.9, tierH: 0.45, tiers: 6 };
export const GALLERY = { balconyY: 6, stair0: 41, stair1: 50, stairW: 1.9, riser: 0.2, tread: 0.3 };
export const FUNERAL = { x: 136, z: -15, w: 2 };
export const BRIDGE = { x0: 74.5, x1: 77.5 };

/** Ячейки-помещения. spring/crown — высота стены и замка бочарного свода (поперёк оси). walk=false — только геометрия. */
export const CELLS = [
  { id: 'B1', zone: 'B1_Airlock', x0: 0, x1: 40, z0: -2, z1: 2, spring: 3.6, crown: 5.0, axis: 'x' },
  { id: 'B2', zone: 'B2_Gallery', x0: 40, x1: 100, z0: -7.5, z1: 7.5, spring: 9, crown: 12, axis: 'x' },
  { id: 'B3c', zone: 'B3_Passages', x0: 100, x1: 146, z0: -1.5, z1: 1.5, spring: 2.9, crown: 3.8, axis: 'x' },
  { id: 'B3v', zone: 'B3_Passages', x0: 146, x1: 150, z0: -2.5, z1: 2.5, spring: 4.0, crown: 5.2, axis: 'x' },
  { id: 'B3n1', zone: 'B3_Passages', x0: 100, x1: 118, z0: -6.5, z1: -3.5, spring: 2.9, crown: 3.8, axis: 'x' },
  { id: 'B3n2', zone: 'B3_Passages', x0: 115, x1: 118, z0: -16.5, z1: -3.5, spring: 2.9, crown: 3.8, axis: 'z' },
  { id: 'B3n3', zone: 'B3_Passages', x0: 115, x1: 136, z0: -16.5, z1: -13.5, spring: 2.9, crown: 3.8, axis: 'x' },
  { id: 'B3s1', zone: 'B3_Passages', x0: 100, x1: 123.5, z0: 3.5, z1: 6.5, spring: 2.9, crown: 3.8, axis: 'x' },
  { id: 'B4a', zone: 'B4_Cistern', x0: 120.5, x1: 123.5, z0: 6.5, z1: 8, spring: 2.9, crown: 3.8, axis: 'z' },
  { id: 'B4', zone: 'B4_Cistern', x0: 110, x1: 140, z0: 8, z1: 28, spring: 6, crown: 8, axis: 'x', walk: false },
  { id: 'B5', zone: 'B5_Hall', x0: 150, x1: 200, z0: -17.5, z1: 17.5, spring: 9, crown: 9, axis: null, custom: true },
];
// Жилые ниши (занавесь в плоскости стены коридора). side: -1 север, +1 юг.
export const NICHES = [];
{
  const north = [104, 110.5, 117, 123.5, 130, 136.5, 143];
  north.forEach((x, i) => NICHES.push({ id: `Nn${i}`, x0: x, x1: x + 2.4, side: -1, wallZ: -1.5, open: false, curtain: i % 3 }));
  const south = [113, 126, 133, 140];
  south.forEach((x, i) => NICHES.push({ id: `Ns${i}`, x0: x, x1: x + 2.4, side: 1, wallZ: 1.5, open: false, curtain: (i + 1) % 3 }));
  NICHES.push({ id: 'Shrine', x0: 105.5, x1: 108.5, side: 1, wallZ: 1.5, open: true, curtain: 0 });
}
for (const n of NICHES) {
  const d = 1.6;
  const z0 = n.side < 0 ? n.wallZ - d : n.wallZ, z1 = n.side < 0 ? n.wallZ : n.wallZ + d;
  CELLS.push({ id: n.id, zone: 'B3_Passages', x0: n.x0, x1: n.x1, z0, z1, spring: 2.6, crown: 2.6, axis: null, walk: false, niche: true });
}
// Тупик северной ветки: ниша в торце (x=136), z∈[-16,-14].
CELLS.push({ id: 'FunNiche', zone: 'B3_Passages', x0: 136, x1: 137.8, z0: -16, z1: -14, spring: 2.6, crown: 2.6, axis: null, walk: false, niche: true });

const byId = Object.fromEntries(CELLS.map((c) => [c.id, c]));
export const cell = (id) => byId[id];

/** Высота потолка ячейки в точке (бочарный свод поперёк оси). */
export function ceilAt(c, x, z) {
  if (!c.axis || c.crown === c.spring) return c.spring;
  const half = c.axis === 'x' ? (c.z1 - c.z0) / 2 : (c.x1 - c.x0) / 2;
  const d = c.axis === 'x' ? z - (c.z0 + c.z1) / 2 : x - (c.x0 + c.x1) / 2;
  const t = clamp(Math.abs(d) / half, 0, 1);
  return c.spring + (c.crown - c.spring) * Math.sqrt(1 - t * t);
}
export const inCell = (c, x, z, e = 0) => x >= c.x0 - e && x <= c.x1 + e && z >= c.z0 - e && z <= c.z1 + e;

// ---------------------------------------------------------------- пол ----
function hallHeightSmooth(x, z) {
  const r = Math.hypot(x - HALL.cx, z - HALL.cz);
  if (r < HALL.bowlR - 0.3) return HALL.bowlY + 0.16 * (r / HALL.bowlR) ** 2;
  // ступени с коротким скатом (0.3 м), чтобы контроллер игрока не «прыгал»
  const rr = r - HALL.bowlR;
  const k = Math.floor(rr / HALL.tierW);
  const f = rr - k * HALL.tierW;
  const base = HALL.bowlY + HALL.tierH * k, top = HALL.bowlY + HALL.tierH * (k + 1);
  const y = f < 0.3 ? base + (top - base) * (f / 0.3) : top;
  return Math.min(0, k >= HALL.tiers ? 0 : y);
}

export function stairH(x) {
  const t = (x - GALLERY.stair0) / GALLERY.tread;
  if (t <= 0) return 0;
  const n = Math.floor(t), f = t - n;
  return Math.min(GALLERY.balconyY, (n + clamp(f / 0.35, 0, 1)) * GALLERY.riser);
}

// Прямоугольники верхнего уровня (локальные координаты).
const UP = [
  { x0: 50, x1: 98, z0: -7.4, z1: -4.75, h: 6 },
  { x0: 50, x1: 98, z0: 4.75, z1: 7.4, h: 6 },
  { x0: BRIDGE.x0, x1: BRIDGE.x1, z0: -4.8, z1: 4.8, h: 6 },
];
const STAIRS = [{ x0: GALLERY.stair0, x1: GALLERY.stair1 + 0.01, z0: -7.4, z1: -5.7 }, { x0: GALLERY.stair0, x1: GALLERY.stair1 + 0.01, z0: 5.7, z1: 7.4 }];
const STAIR_FOOT_X = GALLERY.stair0 + 1.5;
const LEVEL_Y = 0.5; // выше — верхний уровень (лестница/балкон/мост)

export function heightAtLocal(x, z, yh) {
  if (yh > LEVEL_Y) {
    for (const s of STAIRS) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return stairH(x);
    for (const r of UP) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.h;
  } else {
    for (const s of STAIRS) if (x >= s.x0 && x <= STAIR_FOOT_X && z >= s.z0 && z <= s.z1) { const h = stairH(x); if (h <= yh + 0.45) return h; }
  }
  if (x >= 150 && x <= 200 && z >= -17.5 && z <= 17.5) return hallHeightSmooth(x, z);
  return 0;
}

// ------------------------------------------------------- SDF-коллизия ----
const GX0 = -2, GZ0 = -22, GX1 = 202, GZ1 = 30, GS = 0.25;
const NX = Math.ceil((GX1 - GX0) / GS), NZ = Math.ceil((GZ1 - GZ0) / GS);
const blocks0 = []; // препятствия нижнего уровня: {x0,x1,z0,z1} или {cx,cz,r}
const blocks1 = [];
let sdf0 = null, sdf1 = null;

export function addBlock(b, level = 0) { (level ? blocks1 : blocks0).push(b); sdf0 = sdf1 = null; }
const doors = []; // {x, open(0..1)}
export function registerDoor(d) { doors.push(d); }

function buildGrid(level) {
  const open = new Uint8Array(NX * NZ);
  const mark = (x0, x1, z0, z1, v) => {
    const i0 = clamp(Math.floor((x0 - GX0) / GS), 0, NX - 1), i1 = clamp(Math.ceil((x1 - GX0) / GS), 0, NX);
    const j0 = clamp(Math.floor((z0 - GZ0) / GS), 0, NZ - 1), j1 = clamp(Math.ceil((z1 - GZ0) / GS), 0, NZ);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) open[j * NX + i] = v;
  };
  const wall = 0.12; // шаг от грани стены
  if (level === 0) {
    for (const c of CELLS) if (c.walk !== false && !c.custom) mark(c.x0 + wall, c.x1 - wall, c.z0 + wall, c.z1 - wall, 1);
    // стыки ячеек: убрать «стены» между смежными проходами
    for (const c of CELLS) if (c.walk !== false && !c.custom) for (const d of CELLS) {
      if (d === c || d.walk === false || d.custom) continue;
      const ox0 = Math.max(c.x0, d.x0), ox1 = Math.min(c.x1, d.x1), oz0 = Math.max(c.z0, d.z0), oz1 = Math.min(c.z1, d.z1);
      if (ox1 - ox0 >= -0.001 && oz1 - oz0 >= -0.001 && (ox1 - ox0 > 0.01 || oz1 - oz0 > 0.01)) {
        // общая граница: открыть полосу прохода
        if (ox1 - ox0 < 0.01) mark(ox0 - wall, ox0 + wall, oz0 + wall, oz1 - wall, 1);
        else if (oz1 - oz0 < 0.01) mark(ox0 + wall, ox1 - wall, oz0 - wall, oz0 + wall, 1);
      }
    }
    const h = CELLS.find((c) => c.id === 'B5');
    mark(h.x0 + wall, h.x1 - wall, h.z0 + wall, h.z1 - wall, 1);
    mark(h.x0 - wall - 0.2, h.x0 + wall + 0.2, -2.3, 2.3, 1); // портал зала
    // под лестницами и балконом (низ): ступени закрыты, кроме подножия
    for (const s of STAIRS) mark(STAIR_FOOT_X, s.x1, s.z0, s.z1, 0);
    // кромка B1→B2 и B2→B3
    mark(39.5, 40.5, -1.9, 1.9, 1);
    mark(99.5, 100.5, -6.4, -3.6, 1); mark(99.5, 100.5, -1.4, 1.4, 1); mark(99.5, 100.5, 3.6, 6.4, 1);
    for (const b of blocks0) {
      if (b.r) mark(b.cx - b.r, b.cx + b.r, b.cz - b.r, b.cz + b.r, 0);
      else mark(b.x0, b.x1, b.z0, b.z1, 0);
    }
  } else {
    for (const r of UP) mark(r.x0, r.x1, r.z0, r.z1, 1);
    for (const s of STAIRS) mark(s.x0, s.x1, s.z0, s.z1, 1);
    for (const b of blocks1) { if (b.r) mark(b.cx - b.r, b.cx + b.r, b.cz - b.r, b.cz + b.r, 0); else mark(b.x0, b.x1, b.z0, b.z1, 0); }
  }
  // Знаковое расстояние (хэмфер 3-4): + в проходимой зоне, − в заблокированной.
  const d = new Float32Array(NX * NZ);
  const pass = (target) => {
    const INF = 1e6;
    for (let k = 0; k < d.length; k++) d[k] = open[k] === target ? INF : 0;
    const w1 = 1, w2 = 1.4142;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i; let v = d[k]; if (v === 0) continue;
      if (i > 0) v = Math.min(v, d[k - 1] + w1);
      if (j > 0) { v = Math.min(v, d[k - NX] + w1); if (i > 0) v = Math.min(v, d[k - NX - 1] + w2); if (i < NX - 1) v = Math.min(v, d[k - NX + 1] + w2); }
      d[k] = v;
    }
    for (let j = NZ - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) {
      const k = j * NX + i; let v = d[k]; if (v === 0) continue;
      if (i < NX - 1) v = Math.min(v, d[k + 1] + w1);
      if (j < NZ - 1) { v = Math.min(v, d[k + NX] + w1); if (i < NX - 1) v = Math.min(v, d[k + NX + 1] + w2); if (i > 0) v = Math.min(v, d[k + NX - 1] + w2); }
      d[k] = v;
    }
    return d.slice();
  };
  const inside = pass(1); // для проходимых клеток — расстояние до ближайшей непроходимой
  const outside = pass(0);
  const out = new Float32Array(NX * NZ);
  for (let k = 0; k < out.length; k++) out[k] = open[k] ? (inside[k] - 0.5) * GS : -(outside[k] - 0.5) * GS;
  return out;
}
function sample(g, x, z) {
  const fx = (x - GX0) / GS - 0.5, fz = (z - GZ0) / GS - 0.5;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= NX - 1 || j >= NZ - 1) return -1;
  const tx = fx - i, tz = fz - j, k = j * NX + i;
  return (g[k] * (1 - tx) + g[k + 1] * tx) * (1 - tz) + (g[k + NX] * (1 - tx) + g[k + NX + 1] * tx) * tz;
}
export function sdfAt(level, x, z) { ensureGrids(); return sample(level ? sdf1 : sdf0, x, z); }
export function ensureGrids() { if (!sdf0) { sdf0 = buildGrid(0); sdf1 = buildGrid(1); } }

/** Выталкивает локальную позицию p ({x,y,z}) из стен; true, если сдвинули. */
export function collideLocal(p, r, yFeet) {
  ensureGrids();
  const g = yFeet > LEVEL_Y ? sdf1 : sdf0;
  let moved = false;
  for (let it = 0; it < 4; it++) {
    const s = sample(g, p.x, p.z);
    if (s >= r) break;
    const e = 0.2;
    const gx = sample(g, p.x + e, p.z) - sample(g, p.x - e, p.z), gz = sample(g, p.x, p.z + e) - sample(g, p.x, p.z - e);
    const gl = Math.hypot(gx, gz);
    if (gl < 1e-4) break;
    const push = r - s;
    p.x += (gx / gl) * push; p.z += (gz / gl) * push; moved = true;
  }
  // двери-уплотнители (пока закрыты — стена)
  for (const d of doors) {
    if (d.open > 0.85) continue;
    if (Math.abs(p.z) < 2.0 && Math.abs(p.x - d.x) < r + 0.16) {
      const side = d.side ?? (p.x < d.x ? -1 : 1);
      p.x = d.x + side * (r + 0.16); moved = true;
    }
  }
  return moved;
}

export function zoneAtLocal(x, z) {
  let best = null;
  for (const c of CELLS) if (!c.niche && inCell(c, x, z, 0.05)) { best = c; if (c.id === 'B4a') break; }
  if (best) return best.zone;
  if (x < 0) return 'B1_Airlock';
  if (x > 150) return 'B5_Hall';
  if (x > 100) return 'B3_Passages';
  if (x > 40) return 'B2_Gallery';
  return 'B1_Airlock';
}
export function surfaceAtLocal(x, z) {
  return Math.hypot(x - HALL.cx, z - HALL.cz) < HALL.bowlR - 0.1 ? 'sand' : 'stone';
}
export { STAIRS, UP, hallHeightSmooth };
