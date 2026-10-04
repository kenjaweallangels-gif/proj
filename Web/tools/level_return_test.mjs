// Тест обратного пути и «призрачных стен» на тропе (node): бот идёт ОТ ниши вниз к подножию теми же heightAt/collide, что и игра;
// затем проверка прыжков с уступов (heightAt в воздухе возвращает землю ниже, а collide в чистом воздухе ничего не выталкивает).
// node tools/level_return_test.mjs
import { heightAt as fieldH, solidSdf } from '../src/desert/field.js';
import { buildClawGeometry } from '../src/desert/rock.js';
import { buildWallTable } from '../src/level/wall.js';
import { createApproachScene, ZONE } from '../src/level/scene.js';
import { makeHeightAt, makeCollide } from '../src/level/physics.js';
import { ENTRY } from '../src/core/layout.js';

const t0 = performance.now();
const bx0 = ZONE.x0 - 4, bz0 = ZONE.z0 - 4, bn = Math.ceil(ZONE.x1 - ZONE.x0) + 9, bm = Math.ceil(ZONE.z1 - ZONE.z0) + 9;
const bg = new Float32Array(bn * bm);
for (let k = 0; k < bm; k++) for (let i = 0; i < bn; i++) bg[i + bn * k] = fieldH(bx0 + i, bz0 + k);
const base = (x, z) => { const fx = Math.min(bn - 1.001, Math.max(0, x - bx0)), fz = Math.min(bm - 1.001, Math.max(0, z - bz0)); const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k, o = i + bn * k; return (bg[o] * (1 - u) + bg[o + 1] * u) * (1 - v) + (bg[o + bn] * (1 - u) + bg[o + bn + 1] * u) * v; };
const wallX = buildWallTable(() => buildClawGeometry('med'), { z0: ZONE.z0, z1: ZONE.z1, yMax: ZONE.y1 }, 'med', 'west', { dz: 0.5, dy: 0.5 });
const S = createApproachScene({ base, wallX });
const vol = S.build();
console.log(`build ${(performance.now() - t0).toFixed(0)} ms`);
function prevCollide(pos, r) {
  let hit = false;
  // как в desert/index.js: на уступах (выше рельефа > 2.5 м) контур скалы не выталкивает
  if (pos.y !== undefined && pos.y - fieldH(pos.x, pos.z) > 2.5) return false;
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
const heightAt = makeHeightAt(vol, fieldH);
const collide = makeCollide(vol, prevCollide, { passagePts, nativePassage: true, xMax: 652.4 });

// ---- обратный путь ----
const trail = [];
for (const L of S.LEGS) for (let i = 0; i < L.line.length; i++) trail.push({ x: L.line[i][0], z: L.line[i][1], y: L.ys[i], leg: L.id });
const rev = trail.slice().reverse();
{
  const DT = 1 / 30, R = 0.35;
  const pos = { x: ENTRY.cleft.x - 0.5, z: ENTRY.cleft.z, y: ENTRY.cleft.y };
  pos.y = heightAt(pos.x, pos.z, pos.y);
  let wi = 0, t = 0, vx = 0, vz = 0, stuck = 0, lastP = { x: pos.x, z: pos.z }, falls = 0, maxSlope = 0;
  let ok = false;
  while (t < 300) {
    let best = 1e9, bi = wi;
    for (let i = Math.max(0, wi - 5); i < Math.min(rev.length, wi + 60); i++) { const d = (rev[i].x - pos.x) ** 2 + (rev[i].z - pos.z) ** 2 + ((rev[i].y - pos.y) * 1.5) ** 2; if (d < best) { best = d; bi = i; } }
    wi = bi;
    const tgt = rev[Math.min(rev.length - 1, wi + 2)];
    if (wi >= rev.length - 3) { ok = true; break; }
    let dx = tgt.x - pos.x, dz = tgt.z - pos.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const e = 0.6, h = (x, z) => heightAt(x, z, pos.y + 0.3);
    const gx = (h(pos.x + e, pos.z) - h(pos.x - e, pos.z)) / (2 * e), gz = (h(pos.x, pos.z + e) - h(pos.x, pos.z - e)) / (2 * e);
    const gl = Math.hypot(gx, gz), sd = Math.atan(gl) * 57.3; maxSlope = Math.max(maxSlope, sd);
    const lam = 1 - Math.exp(-7 * DT); vx += (dx * 3 - vx) * lam; vz += (dz * 3 - vz) * lam;
    const st = Math.min(1, Math.max(0, (sd - 42) / 12)) * 5, sx = gl > 1e-4 ? -gx / gl * st : 0, sz = gl > 1e-4 ? -gz / gl * st : 0;
    const ox = pos.x, oz = pos.z; pos.x += (vx + sx) * DT; pos.z += (vz + sz) * DT;
    if (collide(pos, R)) { vx = (pos.x - ox) / DT - sx; vz = (pos.z - oz) / DT - sz; }
    const rise = heightAt(pos.x, pos.z, pos.y) - pos.y;
    if (rise > 0.5) { pos.x = ox; pos.z = oz; vx = vz = 0; }
    const gy = heightAt(pos.x, pos.z, pos.y);
    if (gy < pos.y - 1.2) falls++;
    pos.y = Math.abs(gy - pos.y) > 1.2 ? gy : pos.y + (gy - pos.y) * (1 - Math.exp(-18 * DT));
    t += DT;
    if (Math.hypot(pos.x - lastP.x, pos.z - lastP.z) > 0.6) { lastP = { x: pos.x, z: pos.z }; stuck = 0; } else stuck += DT;
    if (process.argv.includes("--trace") && t > 10 && Math.floor(t * 30) % 15 === 0) console.log(`t=${t.toFixed(1)} pos=(${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}) tgt=(${tgt.x.toFixed(1)},${tgt.y.toFixed(1)},${tgt.z.toFixed(1)}) wi=${wi} leg=${rev[wi].leg} v=(${vx.toFixed(2)},${vz.toFixed(2)}) ground=${gy.toFixed(2)}`);
    if (stuck > 6) { console.log(`STUCK pos=(${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}) leg=${rev[wi].leg} wi=${wi}/${rev.length}`); break; }
  }
  console.log(`${ok ? 'OK  ' : 'FAIL'} return: t=${t.toFixed(0)} s, falls=${falls}, maxSlope=${maxSlope.toFixed(0)} deg, end=(${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)})`);
  if (!ok) process.exitCode = 1;
}

// ---- призрачные стены: в чистом воздухе рядом с тропой collide не должен смещать позицию ----
{
  let tested = 0, phantom = 0; const bad = [];
  for (let i = 0; i < trail.length; i += 3) {
    const p = trail[i];
    for (let a = 0; a < 6.283; a += 0.7) for (const rr of [2.5, 4.5]) {
      const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr, y = p.y + 0.2;
      // «чистый воздух»: SDF > 1.5 на всех высотах тела и дальше от земли, чем 2.5 м → прыжок с уступа
      let clear = true; for (const k of [0.1, 0.75, 1.25, 1.75]) if (vol.sample(x, y + k, z) < 1.5) clear = false;
      if (!clear || y - fieldH(x, z) < 3 || !vol.inZone(x, z, 3)) continue;
      const pos = { x, y, z }; const hit = collide(pos, 0.35);
      tested++;
      if (hit || Math.hypot(pos.x - x, pos.z - z) > 1e-3) { phantom++; if (bad.length < 6) bad.push(`(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)})`); }
    }
  }
  console.log(`${phantom ? 'FAIL' : 'OK  '} air samples ${tested}, phantom pushes ${phantom} ${bad.join(' ')}`);
  if (phantom) process.exitCode = 1;
}
// ---- спрыгнуть: от уступа 1.5+ м наружу — земля внизу достижима (heightAt в воздухе возвращает землю, не потолок) ----
{
  let edges = 0, fine = 0;
  for (let i = 0; i < trail.length; i += 4) {
    const p = trail[i];
    for (const a of [0, 1.57, 3.14, 4.71]) {
      const x = p.x + Math.cos(a) * 3.5, z = p.z + Math.sin(a) * 3.5;
      if (!vol.inZone(x, z, 2)) continue;
      const g = heightAt(x, z, p.y + 0.2);
      if (g < p.y - 1.5) { edges++; if (g >= fieldH(x, z) - 0.5) fine++; }
    }
  }
  console.log(`${edges === fine ? 'OK  ' : 'FAIL'} jumpable edges ${edges}, ground reachable below ${fine}`);
  if (edges !== fine) process.exitCode = 1;
}
