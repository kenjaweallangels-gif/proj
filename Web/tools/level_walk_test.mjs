// Логический тест прохода тропы (node, без браузера): бот идёт от ENTRY.trailStart до ENTRY.cleft теми же heightAt/collide, что и игра.
// Повторяет шаг игрока (скорость 3 м/с, замедление на подъёме, скольжение >38°, радиус 0.35). node tools/level_walk_test.mjs [--dt=0.033] [--quiet]
import { heightAt as fieldH, solidSdf } from '../src/desert/field.js';
import { buildClawGeometry } from '../src/desert/rock.js';
import { buildWallTable } from '../src/level/wall.js';
import { createApproachScene, ZONE } from '../src/level/scene.js';
import { makeHeightAt, makeCollide } from '../src/level/physics.js';
import { ENTRY } from '../src/core/layout.js';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const DT = Number(arg('dt', 1 / 30));
const t0 = performance.now();
const bx0 = ZONE.x0 - 4, bz0 = ZONE.z0 - 4, bn = Math.ceil(ZONE.x1 - ZONE.x0) + 9, bm = Math.ceil(ZONE.z1 - ZONE.z0) + 9;
const bg = new Float32Array(bn * bm);
for (let k = 0; k < bm; k++) for (let i = 0; i < bn; i++) bg[i + bn * k] = fieldH(bx0 + i, bz0 + k);
const base = (x, z) => { const fx = Math.min(bn - 1.001, Math.max(0, x - bx0)), fz = Math.min(bm - 1.001, Math.max(0, z - bz0)); const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k, o = i + bn * k; return (bg[o] * (1 - u) + bg[o + 1] * u) * (1 - v) + (bg[o + bn] * (1 - u) + bg[o + bn + 1] * u) * v; };
const wallX = buildWallTable(() => buildClawGeometry('med'), { z0: ZONE.z0, z1: ZONE.z1, yMax: ZONE.y1 }, 'med', 'west', { dz: 0.5, dy: 0.5 });
const S = createApproachScene({ base, wallX });
const vol = S.build();
console.log(`build ${(performance.now() - t0).toFixed(0)} ms`);

// как в desert/index.js: контур скалы
function prevCollide(pos, r) {
  let hit = false;
  if (pos.x > 540 && pos.x < 880 && pos.z > -90 && pos.z < 650) {
    for (let it = 0; it < 3; it++) {
      const d = solidSdf(pos.x, pos.z);
      if (d >= r) break;
      const e = 0.25;
      let gx = solidSdf(pos.x + e, pos.z) - solidSdf(pos.x - e, pos.z), gz = solidSdf(pos.x, pos.z + e) - solidSdf(pos.x, pos.z - e);
      const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
      pos.x += gx * (r - d + 0.01); pos.z += gz * (r - d + 0.01); hit = true;
    }
  }
  return hit;
}
const nz = ENTRY.cleft.z;
const passagePts = [];
for (const L of S.LEGS) if (L.slot) for (let i = 0; i < L.line.length; i += 2) passagePts.push({ x: L.line[i][0], y: L.ys[i], z: L.line[i][1] });
passagePts.push({ x: wallX(nz, 31), y: ENTRY.cleft.y, z: nz }, { x: ENTRY.cleft.x + 4, y: ENTRY.cleft.y, z: nz });
const heightAt = makeHeightAt(vol, fieldH);
const collide = makeCollide(vol, prevCollide, { passagePts, nativePassage: false, xMax: 652.4 });

// путь бота: звенья тропы
const trail = [];
for (const L of S.LEGS) for (let i = 0; i < L.line.length; i++) { if (L.slot && L.line[i][1] < 251.0) continue; trail.push({ x: L.line[i][0], z: L.line[i][1], y: L.ys[i], leg: L.id }); }
const cleft = { x: ENTRY.cleft.x, y: ENTRY.cleft.y, z: ENTRY.cleft.z };

const pos = { x: ENTRY.trailStart.x, z: ENTRY.trailStart.z, y: 0 };
pos.y = heightAt(pos.x, pos.z);
let wi = 0, t = 0, lastProg = 0, lastProgT = 0, maxSlope = 0, falls = 0, slideT = 0, slow = 0;
let vx = 0, vz = 0;
const R = 0.35, WALK = 3.0, GOAL_T = 240;
let phase = 'trail';
const log = [];
let minDistToTrail = 0;
while (t < GOAL_T) {
  // цель: точка впереди по тропе (ищем ближайшую, берём +1.8 м)
  let best = 1e9, bi = wi;
  for (let i = Math.max(0, wi - 20); i < Math.min(trail.length, wi + 60); i++) { const d = (trail[i].x - pos.x) ** 2 + (trail[i].z - pos.z) ** 2 + ((trail[i].y - pos.y) * 1.5) ** 2; if (d < best) { best = d; bi = i; } }
  wi = bi;
  let tgt = trail[Math.min(trail.length - 1, wi + 4)];
  if (wi >= trail.length - 3) tgt = { x: cleft.x + 1.5, z: cleft.z };      // из слота в нишу
  let dx = tgt.x - pos.x, dz = tgt.z - pos.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  // склон
  const e = 0.6, gx = (heightAt(pos.x + e, pos.z, pos.y) - heightAt(pos.x - e, pos.z, pos.y)) / (2 * e), gz = (heightAt(pos.x, pos.z + e, pos.y) - heightAt(pos.x, pos.z - e, pos.y)) / (2 * e);
  const gl = Math.hypot(gx, gz), slopeDeg = Math.atan(gl) * 180 / Math.PI; maxSlope = Math.max(maxSlope, slopeDeg);
  let sl = 1;
  if (gl > 1e-4) { const up = (dx * gx + dz * gz) / gl; if (up > 0) sl = 1 - 0.3 * Math.min(1, Math.max(0, (slopeDeg - 22) / 7)) * up; }
  const lam = 1 - Math.exp(-14 * DT);
  vx += (dx * WALK * sl - vx) * lam; vz += (dz * WALK * sl - vz) * lam;
  const st = Math.min(1, Math.max(0, (slopeDeg - 38) / 12)); const slideV = st * 5;
  const sx = gl > 1e-4 ? -gx / gl * slideV : 0, sz = gl > 1e-4 ? -gz / gl * slideV : 0;
  if (slideV > 1) slideT += DT;
  const ox = pos.x, oz = pos.z;
  pos.x += (vx + sx) * DT; pos.z += (vz + sz) * DT;
  if (collide(pos, R)) { vx = (pos.x - ox) / DT - sx; vz = (pos.z - oz) / DT - sz; }
  const gy = heightAt(pos.x, pos.z, pos.y);
  if (gy < pos.y - 1.2) falls++;
  pos.y = Math.abs(gy - pos.y) > 1.2 ? gy : pos.y + (gy - pos.y) * (1 - Math.exp(-12 * DT));
  t += DT;
  const prog = wi;
  if (prog > lastProg + 2) { lastProg = prog; lastProgT = t; }
  if (t - lastProgT > 12) { console.log(`STUCK at t=${t.toFixed(1)} pos=(${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}) leg=${trail[wi].leg} wi=${wi}/${trail.length}`); break; }
  if (Math.hypot(pos.x - cleft.x, pos.z - cleft.z) < 1.2 && Math.abs(pos.y - cleft.y) < 1.5) { console.log(`REACHED cleft t=${t.toFixed(1)} s, falls=${falls}, maxSlope=${maxSlope.toFixed(0)} deg, slideT=${slideT.toFixed(1)} s`); phase = 'done'; break; }
  if (!arg('quiet') && Math.floor(t * 30) % 300 === 0) console.log(`t=${t.toFixed(0)} pos=(${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}) leg=${trail[wi].leg} slope=${slopeDeg.toFixed(0)}`);
}
if (phase !== 'done') { console.log(`FAIL phase=${phase} t=${t.toFixed(1)} falls=${falls}`); process.exitCode = 1; }

// ---- скрытность входа: с каких точек пустыни (глаз 1.7 м над землёй) виден проём ниши ----
{
  const tgt = { x: wallX(nz, 31) - 0.3, y: ENTRY.cleft.y + 1.8, z: nz };
  let vis = 0, tot = 0; const visPts = [];
  for (let x = 540; x <= 625; x += 5) for (let z = 215; z <= 345; z += 5) {
    const gy = fieldH(x, z) + 1.7;
    const n = Math.ceil(Math.hypot(tgt.x - x, tgt.y - gy, tgt.z - z) / 0.5);
    let blocked = false;
    for (let i = 1; i < n; i++) { const k = i / n; if (vol.sample(x + (tgt.x - x) * k, gy + (tgt.y - gy) * k, z + (tgt.z - z) * k) < 0) { blocked = true; break; } }
    tot++; if (!blocked) { vis++; if (visPts.length < 14) visPts.push(`(${x},${z})`); }
  }
  console.log(`niche mouth visible from ${vis}/${tot} desert eye points (${(100 * vis / tot).toFixed(0)}%)`, visPts.join(' '));
}
