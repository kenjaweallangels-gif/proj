// Логический тест физики сада (node, без браузера): земля (сетка пола + стенки) + гребни (SDF) + контур Когтя.
//  1) боты идут: устье → площадь → тропы/грядки/пруд → овраг → пустыня и обратно, теми же heightAt/collide, что и игра;
//  2) уклон под ногами, «провалы» (резкий скачок высоты > 0.5 м), застревания;
//  3) подъём на гребень по наружному склону и спрыгивание внутрь (heightAt под ногами);
//  4) совпадение меша пола и heightAt в 200 случайных точках (< 0.02 м; формально тот же набор треугольников).
// node tools/garden_phys_test.mjs [--quiet]
import { heightAt as fieldH, solidSdf } from '../src/desert/field.js';
import { buildClawGeometry } from '../src/desert/rock.js';
import { buildWallTable } from '../src/level/wall.js';
import { createGroundField, buildGrid, buildMeshData, GRID } from '../src/garden/ground.js';
import { createRim } from '../src/garden/rim.js';
import { makeGardenHeight, makeGardenSurface } from '../src/garden/physics.js';
import { MOUTH, RAVINE, C, ringIn, ang, radius } from '../src/garden/layout.js';
import { smoothstep, lerp } from '../src/core/util.js';

const quiet = process.argv.includes('--quiet');
const t0 = performance.now();
const faceX = buildWallTable(() => buildClawGeometry('med'), { z0: 322, z1: 470, yMax: 36 }, 'med', 'east');
const faceAt = (z) => faceX(z, 4);
const field = createGroundField({ desert: fieldH, faceAt });
const grid = buildGrid(field);
const baseG = (x, z) => { const g = grid.sample(x, z); return Number.isFinite(g) ? g : fieldH(x, z); };
const rim = createRim({ base: baseG, faceX, h: 0.8 });
const vol = rim.build();
console.log(`build ${(performance.now() - t0).toFixed(0)} ms`);
// ландшафт с заплаткой (как в игре): под полом на 0.3 ниже
const prevHeight = (x, z) => { const c = grid.coverAt(x, z), g = grid.sample(x, z), h = fieldH(x, z); if (c <= 0 || !Number.isFinite(g)) return h; return Math.min(h, lerp(h, g - 0.3 * smoothstep(0, 1, c), smoothstep(0, 0.6, c))); };
const heightAt = makeGardenHeight({ grid, field, vol, prevHeight });
const surfaceAt = makeGardenSurface({ grid, field, prevSurface: () => 'sand', prevHeight, vol });
const passage = [{ x: MOUTH.x - MOUTH.lining - 2, z: MOUTH.z }, { x: MOUTH.x + 2.5, z: MOUTH.z }];
const inPassage = (x, z) => x > passage[0].x && x < passage[1].x && Math.abs(z - MOUTH.z) < 2.6;
function collide(pos, r) {
  let hit = false;
  if (!inPassage(pos.x, pos.z) && !(pos.y - heightAt(pos.x, pos.z, pos.y) > 2.5)) {
    for (let it = 0; it < 3; it++) {
      const d = solidSdf(pos.x, pos.z); if (d >= r) break;
      const e = 0.25; let gx = solidSdf(pos.x + e, pos.z) - solidSdf(pos.x - e, pos.z), gz = solidSdf(pos.x, pos.z + e) - solidSdf(pos.x, pos.z - e);
      const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl; pos.x += gx * (r - d + 0.01); pos.z += gz * (r - d + 0.01); hit = true;
    }
  }
  if (pos.x > faceAt(pos.z) - 0.2) hit = vol.collide(pos, r) || hit;
  // боковые стенки штольни (в игре — коллайдеры mouth.js)
  if (pos.x < MOUTH.x + 0.9 && pos.x > MOUTH.x - MOUTH.lining) { const lim = MOUTH.w / 2 - r; if (Math.abs(pos.z - MOUTH.z) > lim) { pos.z = MOUTH.z + Math.sign(pos.z - MOUTH.z) * lim; hit = true; } }
  return hit;
}

// ---------- 4) совпадение сетки с мешем ----------
{
  const md = buildMeshData(grid);
  let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const P = md.position, I = md.index;
  let worst = 0, n = 0;
  while (n < 200) {
    const x = 800 + rnd() * 120, z = 340 + rnd() * 110;
    const g = grid.sample(x, z); if (!Number.isFinite(g) || grid.coverAt(x, z) < 0.99) continue;
    // ищем треугольник меша, содержащий (x,z): перебор по ячейке
    let found = NaN;
    const ci = Math.floor(x - GRID.x0), ck = Math.floor(z - GRID.z0);
    for (let t = 0; t < I.length; t += 3) {
      const ax = P[I[t] * 3], az = P[I[t] * 3 + 2];
      if (ax < x - 1.01 || ax > x + 0.01 || az < z - 1.01 || az > z + 0.01) continue;
      const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
      const x0 = P[a * 3], z0 = P[a * 3 + 2], x1 = P[b * 3], z1 = P[b * 3 + 2], x2 = P[c * 3], z2 = P[c * 3 + 2];
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d, l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d, l2 = 1 - l0 - l1;
      if (l0 >= -1e-6 && l1 >= -1e-6 && l2 >= -1e-6) { found = l0 * P[a * 3 + 1] + l1 * P[b * 3 + 1] + l2 * P[c * 3 + 1]; break; }
    }
    n++;
    if (Number.isFinite(found)) worst = Math.max(worst, Math.abs(found - g));
    else worst = 99;
  }
  console.log(`mesh vs grid.sample at 200 pts: worst ${worst.toFixed(4)} m`);
  if (worst > 0.02) { console.log('FAIL mesh/physics mismatch'); process.exitCode = 1; }
}

// ---------- 1-2) боты ----------
function walk(name, way, { maxT = 400, start } = {}) {
  const DT = 1 / 30, R = 0.35;
  const pos = { x: way[0][0], z: way[0][1], y: 0 }; pos.y = start ?? heightAt(pos.x, pos.z, 99);
  let wi = 1, t = 0, stuck = 0, lastD = 1e9, maxSlope = 0, jumps = 0, vx = 0, vz = 0, minDy = 0, maxStep = 0;
  while (t < maxT && wi < way.length) {
    const tg = way[wi]; let dx = tg[0] - pos.x, dz = tg[1] - pos.z; const d = Math.hypot(dx, dz);
    if (d < 1.2) { wi++; lastD = 1e9; stuck = 0; continue; }
    dx /= d; dz /= d;
    const e = 0.6, h = (x, z) => heightAt(x, z, pos.y + 0.3);
    const gx = (h(pos.x + e, pos.z) - h(pos.x - e, pos.z)) / (2 * e), gz = (h(pos.x, pos.z + e) - h(pos.x, pos.z - e)) / (2 * e);
    const gl = Math.hypot(gx, gz), sd = Math.atan(gl) * 57.3; maxSlope = Math.max(maxSlope, sd);
    let sl = 1; if (gl > 1e-4) { const up = (dx * gx + dz * gz) / gl; if (up > 0) sl = 1 - 0.3 * Math.min(1, Math.max(0, (sd - 22) / 7)) * up; }
    const lam = 1 - Math.exp(-7 * DT); vx += (dx * 3 * sl - vx) * lam; vz += (dz * 3 * sl - vz) * lam;
    const st = Math.min(1, Math.max(0, (sd - 42) / 12)) * 5, sx = gl > 1e-4 ? -gx / gl * st : 0, sz = gl > 1e-4 ? -gz / gl * st : 0;
    const ox = pos.x, oz = pos.z; pos.x += (vx + sx) * DT; pos.z += (vz + sz) * DT;
    if (collide(pos, R)) { vx = (pos.x - ox) / DT - sx; vz = (pos.z - oz) / DT - sz; }
    // уступ
    const rise = heightAt(pos.x, pos.z, pos.y) - pos.y;
    if (rise > 0.5) { pos.x = ox; pos.z = oz; vx = vz = 0; }
    const gy = heightAt(pos.x, pos.z, pos.y);
    maxStep = Math.max(maxStep, Math.abs(gy - pos.y));
    if (gy < pos.y - 1.2) jumps++;
    pos.y = Math.abs(gy - pos.y) > 1.2 ? gy : pos.y + (gy - pos.y) * (1 - Math.exp(-18 * DT));
    t += DT;
    if (d > lastD - 0.02) stuck += DT; else { stuck = 0; lastD = d; }
    if (stuck > 8) return { name, ok: false, wi, pos: [pos.x.toFixed(1), pos.y.toFixed(1), pos.z.toFixed(1)], t: t.toFixed(0), maxSlope: maxSlope.toFixed(0) };
  }
  return { name, ok: wi >= way.length, t: t.toFixed(0), maxSlope: maxSlope.toFixed(0), falls: jumps, maxStep: maxStep.toFixed(2), end: [pos.x.toFixed(1), pos.y.toFixed(1), pos.z.toFixed(1)] };
}
const ravEnd = RAVINE.pts[RAVINE.pts.length - 1];
const loop = [[796, MOUTH.z], [803, MOUTH.z], [812, 396.5], [822, 395.5], [832, 397.5], [842, 402.8], [852, 404], [864, 403.5], [878, 406.5], [890, 410], [902, 412.5], [914, 416.5], [926, 419.5], [940, 421.5], [960, 424]];
const results = [];
results.push(walk('mouth->ravine->desert', loop));
results.push(walk('desert->ravine->mouth', loop.slice().reverse(), { start: undefined }));
results.push(walk('garden loop', [[808, 396], [818, 386], [826, 368], [828, 396], [836, 420], [846, 436], [830, 412], [850, 404], [852, 380], [870, 372], [878, 390], [868, 420], [840, 440], [820, 410], [808, 396]]));
results.push(walk('beds crossing', [[836, 395], [843, 382], [843, 388], [843, 397], [861, 397], [861, 405], [861, 412], [850, 420], [850, 404]]));
for (const r of results) console.log(r.ok ? 'OK  ' : 'FAIL', JSON.stringify(r));
if (results.some((r) => !r.ok)) process.exitCode = 1;

// ---------- 3) гребень: подъём снаружи, спуск внутрь ----------
{
  // идём по лучу от пустыни (r = ringIn + 60) к центру с запада-востока в нескольких направлениях; считаем максимум высоты и «падения»
  for (const deg of [-60, 0, 70, 120, 180]) {
    const th = deg * Math.PI / 180, r0 = ringIn(th);
    const way = [[C.x + Math.cos(th) * (r0 + 22), C.z + Math.sin(th) * (r0 + 22)], [C.x + Math.cos(th) * (r0 + 5), C.z + Math.sin(th) * (r0 + 5)], [C.x + Math.cos(th) * (r0 - 8), C.z + Math.sin(th) * (r0 - 8)], [C.x, C.z]];
    const r = walk(`ridge ${deg}deg`, way, { maxT: 200 });
    console.log(r.ok ? 'OK  ' : 'info', JSON.stringify(r));
  }
}
if (process.argv.includes('--dbg')) {
  const [dx, dz] = process.argv.slice(process.argv.indexOf('--dbg') + 1).map(Number);
  for (let z = dz - 3; z <= dz + 3; z += 1) console.log(z, [-3, -2, -1, 0, 1, 2, 3].map((o) => { const x = dx + o; const g = grid.sample(x, z); return `${(heightAt(x, z, g + 0.3) - g).toFixed(2)}/${[0.75, 1.25, 1.75].map((k) => vol.sample(x, g + k, z).toFixed(1)).join(',')}`; }).join('  '));
}
console.log('surface @ plaza', surfaceAt(812, 396), '@ bed', surfaceAt(843, 388), '@ path', surfaceAt(822, 396), '@ ravine', surfaceAt(902, 412.5), '@ ridge', surfaceAt(C.x + 60, C.z - 5));
