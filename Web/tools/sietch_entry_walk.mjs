// Проверка бесшовного входа (node, без браузера): ниша тропы (модуль level) ↔ входной ход сиетча на плоскости x = 652.4 — в обе стороны.
// Земля как в игре: внутри пещер (contains) — сетки сиетча, иначе — мир с нишей. Бот идёт 3 м/с, радиус 0.35; отчёт: макс. скачок высоты за шаг, застревания.
// node tools/sietch_entry_walk.mjs
import { heightAt as fieldH, solidSdf } from '../src/desert/field.js';
import { buildClawGeometry } from '../src/desert/rock.js';
import { buildWallTable } from '../src/level/wall.js';
import { createApproachScene, ZONE } from '../src/level/scene.js';
import { makeHeightAt, makeCollide } from '../src/level/physics.js';
import { ENTRY, SIETCH_ORIGIN as O } from '../src/core/layout.js';
import data from '../src/assets/sietch_cave.js';
import { unpack } from '../src/sietch/cave/pack.js';
import * as plan from '../src/sietch/plan.js';
import { CAVE_YAW, ENTRY_CUT } from '../src/sietch/cave/layout.js';

const bx0 = ZONE.x0 - 4, bz0 = ZONE.z0 - 4, bn = Math.ceil(ZONE.x1 - ZONE.x0) + 9, bm = Math.ceil(ZONE.z1 - ZONE.z0) + 9;
const bg = new Float32Array(bn * bm);
for (let k = 0; k < bm; k++) for (let i = 0; i < bn; i++) bg[i + bn * k] = fieldH(bx0 + i, bz0 + k);
const base = (x, z) => { const fx = Math.min(bn - 1.001, Math.max(0, x - bx0)), fz = Math.min(bm - 1.001, Math.max(0, z - bz0)); const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k, o = i + bn * k; return (bg[o] * (1 - u) + bg[o + 1] * u) * (1 - v) + (bg[o + bn] * (1 - u) + bg[o + bn + 1] * u) * v; };
const wallX = buildWallTable(() => buildClawGeometry('med'), { z0: ZONE.z0, z1: ZONE.z1, yMax: ZONE.y1 });
const S = createApproachScene({ base, wallX });
const vol = S.build();
function prevCollide(pos, r) {
  let hit = false;
  if (pos.x > 540 && pos.x < 880 && pos.z > -90 && pos.z < 650) {
    for (let it = 0; it < 3; it++) {
      const d = solidSdf(pos.x, pos.z); if (d >= r) break;
      const e = 0.25; let gx = solidSdf(pos.x + e, pos.z) - solidSdf(pos.x - e, pos.z), gz = solidSdf(pos.x, pos.z + e) - solidSdf(pos.x, pos.z - e);
      const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl; pos.x += gx * (r - d + 0.01); pos.z += gz * (r - d + 0.01); hit = true;
    }
  }
  return hit;
}
const nz = ENTRY.cleft.z;
const passagePts = [];
for (const L of S.LEGS) if (L.slot) for (let i = 0; i < L.line.length; i += 2) passagePts.push({ x: L.line[i][0], y: L.ys[i], z: L.line[i][1] });
passagePts.push({ x: wallX(nz, 31), y: ENTRY.cleft.y, z: nz }, { x: ENTRY.cleft.x + 4, y: ENTRY.cleft.y, z: nz });
const wHeight = makeHeightAt(vol, fieldH);
const wCollide = makeCollide(vol, prevCollide, { passagePts, nativePassage: false, xMax: 652.4 });

// --- сиетч (как в sietch/index.js)
const { header: H, A } = unpack(data);
plan.setGrids({ f0: A.f0, f1: A.f1, w0: A.w0, w1: A.w1, grid: H.grid, noFloor: H.noFloor });
const Y = O.yaw + CAVE_YAW, cY = Math.cos(Y), sY = Math.sin(Y);
const lx = (x, z) => (x - O.x) * cY + (z - O.z) * sY, lz = (x, z) => -(x - O.x) * sY + (z - O.z) * cY;
function contains(p) {
  const x = lx(p.x, p.z), z = lz(p.x, p.z);
  if (!plan.hasAnyFloor(x, z)) return false;
  if (z > 0.5 && x < 2 && z < 30 && (x - ENTRY_CUT.p[0]) * ENTRY_CUT.n[0] + (z - ENTRY_CUT.p[1]) * ENTRY_CUT.n[1] > ENTRY_CUT.cutT) return false;
  const ly = p.y - O.y, f0 = plan.heightAtLocal(x, z, 0), f1 = plan.heightAtLocal(x, z, 6);
  return (ly - f0 > -1.6 && ly - f0 < 37) || (ly - f1 > -1.6 && ly - f1 < 37);
}
let space = 'desert';
const heightAt = (p) => (space === 'sietch' && contains(p) ? O.y + plan.heightAtLocal(lx(p.x, p.z), lz(p.x, p.z), p.y - O.y) : wHeight(p.x, p.z, p.y));
function collide(p, r) {
  if (space === 'sietch') {
    const q = { x: lx(p.x, p.z), z: lz(p.x, p.z) };
    const moved = plan.collideLocal(q, r, p.y - O.y);
    if (moved) { p.x = O.x + q.x * cY - q.z * sY; p.z = O.z + q.x * sY + q.z * cY; }
    return moved;
  }
  return wCollide(p, r);
}

const toW = (x, z) => ({ x: O.x + x * cY - z * sY, z: O.z + x * sY + z * cY });
const R = 0.35, WALK = 3.0, DT = 1 / 30;
function walk(label, start, waypoints, inside = false) {
  const pos = { x: start.x, z: start.z, y: ENTRY.cleft.y }; pos.y = inside ? O.y + plan.heightAtLocal(lx(pos.x, pos.z), lz(pos.x, pos.z), 0) : wHeight(pos.x, pos.z, pos.y); space = contains(pos) ? 'sietch' : 'desert';
  let t = 0, wi = 0, maxJump = 0, stuckT = 0, lastD = 1e9, spaceChanges = 0, maxStepUp = 0;
  const trace = [];
  while (wi < waypoints.length && t < 120) {
    const tg = waypoints[wi], dx = tg.x - pos.x, dz = tg.z - pos.z, d = Math.hypot(dx, dz);
    if (d < 0.5) { wi++; stuckT = 0; lastD = 1e9; continue; }
    const ox = pos.x, oz = pos.z;
    pos.x += (dx / d) * WALK * DT; pos.z += (dz / d) * WALK * DT;
    collide(pos, R);
    const gy = heightAt(pos);
    maxJump = Math.max(maxJump, Math.abs(gy - pos.y)); maxStepUp = Math.max(maxStepUp, gy - pos.y);
    pos.y = gy;
    const nowSpace = contains(pos) ? 'sietch' : 'desert';
    if (nowSpace !== space) { space = nowSpace; spaceChanges++; trace.push(`t=${t.toFixed(1)} → ${space} @ (${pos.x.toFixed(1)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(1)})`); }
    t += DT;
    if (d < lastD - 0.02) { lastD = d; stuckT = 0; } else if ((stuckT += DT) > 3) { console.log(`XX ${label}: застрял у (${pos.x.toFixed(1)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(1)}) к точке ${wi}`); return false; }
  }
  const ok = wi >= waypoints.length && maxJump < 0.35;
  console.log(`${ok ? 'OK' : 'XX'} ${label}: ${t.toFixed(1)} с, макс. скачок высоты за шаг ${maxJump.toFixed(2)} м, смен пространства ${spaceChanges}${trace.length ? ' | ' + trace.join(' ; ') : ''}`);
  return ok;
}
// путь внутрь: ниша (тропа) → плоскость → B1; затем обратно в нишу
const cleft = ENTRY.cleft;
const inPts = [{ x: cleft.x - 3, z: nz }, { x: cleft.x, z: nz }, toW(-1.0, 2.6), toW(0.6, 1.0), toW(2.4, 0), toW(12, 0)];
let ok = walk('ниша → B1', { x: cleft.x - 5, z: nz }, inPts);
ok = walk('B1 → ниша', toW(12, 0), [toW(2.4, 0), toW(0.6, 1.0), toW(-1.0, 2.6), { x: cleft.x, z: nz }, { x: cleft.x - 3, z: nz }, { x: cleft.x - 5, z: nz }], true) && ok;
// (диагностика --profile) профиль высоты вдоль входа: мир (ниша) и сиетч рядом с плоскостью
if (process.argv.includes('--profile')) {
  for (let k = -4; k <= 4; k++) {
    const q = { x: ENTRY_CUT.p[0] + ENTRY_CUT.n[0] * -k * 0.5, z: ENTRY_CUT.p[1] + ENTRY_CUT.n[1] * -k * 0.5 };
    const w = toW(q.x, q.z), P = { x: w.x, z: w.z, y: 30 };
    console.log(`k=${k} мир x=${w.x.toFixed(2)}: ниша y=${wHeight(w.x, w.z, 30).toFixed(3)} сиетч y=${(O.y + plan.heightAtLocal(q.x, q.z, 0)).toFixed(3)} contains=${contains(P)}`);
  }
}
process.exit(ok ? 0 : 1);
