// Логический тест физики высокой котловины-сада (node, без браузера): земля (сетка пола) + стены чаши + контур Когтя + основание массива.
//  1) меш пола и heightAt совпадают в 200 случайных точках (< 0.02 м; тот же набор треугольников);
//  2) пол непрерывен: нет дыр/ступеней внутри чаши и у лаза, нет «кучи песка» у входа (пол у лаза плоский y = MOUTH.y, пустыня глубоко под полом);
//  3) вход: лаз → центр и обратно (боты теми же heightAt/collide, что и игра);
//  4) ИЗ ЧАШИ НЕ ВЫЙТИ: 72 направления × (идём к цели за стеной) и (то же с прыжками), на каждом шаге радиус ≤ ringIn(θ), нет падений вниз;
//  5) снаружи НЕ ВОЙТИ: боты из пустыни к центру останавливаются у основания массива.
// node tools/garden_phys_test.mjs
import { heightAt as fieldH, solidSdf } from '../src/desert/field.js';
import { buildClawGeometry } from '../src/desert/rock.js';
import { buildWallTable } from '../src/level/wall.js';
import { createGroundField, buildGrid, buildMeshData, GRID } from '../src/garden/ground.js';
import { createRim } from '../src/garden/rim.js';
import { makeGardenHeight, makeGardenSurface, makeGardenCollide } from '../src/garden/physics.js';
import { MOUTH, C, FLOOR_Y, ringIn, ringH, ang, radius } from '../src/garden/layout.js';

const t0 = performance.now();
const Zr = { x0: 740, x1: 1000, z0: 322, z1: 470 };
const faceX = buildWallTable(() => buildClawGeometry('med'), { z0: 322, z1: 470, yMax: 150 }, 'med', 'east');
const faceAt = (z) => faceX(z, FLOOR_Y);
const field = createGroundField({ faceAt });
const grid = buildGrid(field);
const rim = createRim({ faceX, desertAt: fieldH, quality: 'med' });
const md = rim.build();
console.log(`build ${(performance.now() - t0).toFixed(0)} ms, rim ${md.index.length / 3} tris`);
const heightAt = makeGardenHeight({ grid, prevHeight: fieldH });
const surfaceAt = makeGardenSurface({ grid, field, prevSurface: () => 'sand' });
const collide = makeGardenCollide({ prevCollide: () => false, faceAt, footR: rim.footR, Zr });
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) { fails++; process.exitCode = 1; } };
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const inBasinXZ = (x, z, m = 1.5) => radius(x, z) < ringIn(ang(x, z)) - m && x > faceAt(z) + 1.5;

// ---------- 1) совпадение сетки с мешем ----------
{
  const mesh = buildMeshData(grid);
  const P = mesh.position, I = mesh.index;
  let worst = 0, n = 0;
  while (n < 200) {
    const x = C.x - 30 + rnd() * 60, z = C.z - 30 + rnd() * 60;
    const g = grid.sample(x, z); if (!Number.isFinite(g) || grid.coverAt(x, z) < 0.99) continue;
    let found = NaN;
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
    worst = Math.max(worst, Number.isFinite(found) ? Math.abs(found - heightAt(x, z, 99)) : 99);
  }
  check('1. mesh == heightAt (200 pts)', worst < 0.02, `worst ${worst.toFixed(4)} m`);
}

// ---------- 2) непрерывность пола, нет кучи песка у входа ----------
{
  let holes = 0, steep = 0, maxSlope = 0, n = 0;
  for (let i = 0; i < 6000; i++) {
    const x = C.x - 45 + rnd() * 90, z = C.z - 45 + rnd() * 90;
    if (!inBasinXZ(x, z, 1.0)) continue;
    n++;
    const g = grid.sample(x, z); if (!Number.isFinite(g)) { holes++; continue; }
    const e = 0.5, gx = (heightAt(x + e, z, 99) - heightAt(x - e, z, 99)) / (2 * e), gz = (heightAt(x, z + e, 99) - heightAt(x, z - e, 99)) / (2 * e);
    const s = Math.atan(Math.hypot(gx, gz)) * 57.3; maxSlope = Math.max(maxSlope, s); if (s > 25) steep++;
  }
  check('2a. no holes in the floor inside the ring', holes === 0 && n > 2000, `${n} pts, holes ${holes}, max slope ${maxSlope.toFixed(1)}°, >25°: ${steep}`);
  // у лаза: плоско y = MOUTH.y, без бермы
  let worstBerm = 0;
  for (let x = MOUTH.x - 2.5; x <= MOUTH.x + 8; x += 0.5) for (let z = MOUTH.z - 2; z <= MOUTH.z + 2; z += 0.5) {
    const h = heightAt(x, z, 99); if (!Number.isFinite(h) || x < faceAt(z) + 0.5) continue;
    worstBerm = Math.max(worstBerm, Math.abs(h - MOUTH.y));
  }
  check('2b. floor at the mouth is flat (no sand pile/berm), |h - 36| < 0.1 over 8 m', worstBerm < 0.1, `worst ${worstBerm.toFixed(3)} m`);
  // пустыня сквозь пол не торчит: везде под полом глубже 5 м
  let over = -1e9;
  for (let k = 0; k < grid.nz; k++) for (let i = 0; i < grid.nx; i++) if (grid.cv[i + grid.nx * k] > 0.5) { const x = GRID.x0 + i, z = GRID.z0 + k; over = Math.max(over, fieldH(x, z) - grid.h[i + grid.nx * k]); }
  check('2c. terrain stays far below the floor (max terrain - floor < -5 m)', over < -5, `max ${over.toFixed(1)} m`);
  // поверхность у лаза — камень, дальше почва/песок
  check('2d. surfaceAt', surfaceAt(MOUTH.x + 1, MOUTH.z) === 'stone' && ['soil', 'sand'].includes(surfaceAt(C.x, C.z)), `${surfaceAt(MOUTH.x + 1, MOUTH.z)}/${surfaceAt(C.x, C.z)}`);
}

// ---------- ботов-ходоков ----------
function walk(name, way, { maxT = 400, y0, air = false } = {}) {
  const DT = 1 / 30, R = 0.35;
  const pos = { x: way[0][0], z: way[0][1], y: 0 }; pos.y = y0 ?? heightAt(pos.x, pos.z, 99);
  let wi = 1, t = 0, stuck = 0, lastD = 1e9, maxSlope = 0, falls = 0, vx = 0, vz = 0, maxStep = 0, maxOver = -1e9, minY = pos.y, jt = 0;
  while (t < maxT && wi < way.length) {
    const tg = way[wi]; let dx = tg[0] - pos.x, dz = tg[1] - pos.z; const d = Math.hypot(dx, dz);
    if (d < 1.2) { wi++; lastD = 1e9; stuck = 0; continue; }
    dx /= d; dz /= d;
    const e = 0.6, h = (x, z) => heightAt(x, z, pos.y + 0.3);
    const gx = (h(pos.x + e, pos.z) - h(pos.x - e, pos.z)) / (2 * e), gz = (h(pos.x, pos.z + e) - h(pos.x, pos.z - e)) / (2 * e);
    const gl = Math.hypot(gx, gz), sd = Math.atan(gl) * 57.3; maxSlope = Math.max(maxSlope, sd);
    const lam = 1 - Math.exp(-7 * DT); vx += (dx * 3 - vx) * lam; vz += (dz * 3 - vz) * lam;
    const ox = pos.x, oz = pos.z; pos.x += vx * DT; pos.z += vz * DT;
    // прыжок: поднимаем ноги над землёй на ~0.9 м (collide на высоте не должен «выпускать» из чаши)
    jt += DT; const jumpY = air ? Math.max(0, Math.sin((jt % 0.8) / 0.8 * Math.PI)) * 0.9 : 0;
    const py = pos.y; pos.y = heightAt(pos.x, pos.z, pos.y) + jumpY;
    if (collide(pos, R)) { vx = (pos.x - ox) / DT; vz = (pos.z - oz) / DT; }
    pos.y = py;
    const rise = heightAt(pos.x, pos.z, pos.y) - pos.y;
    if (rise > 0.5) { pos.x = ox; pos.z = oz; vx = vz = 0; }
    const gy = heightAt(pos.x, pos.z, pos.y);
    maxStep = Math.max(maxStep, Math.abs(gy - pos.y));
    if (gy < pos.y - 1.2) falls++;
    pos.y = Math.abs(gy - pos.y) > 1.2 ? gy : pos.y + (gy - pos.y) * (1 - Math.exp(-18 * DT));
    minY = Math.min(minY, pos.y);
    if (pos.x > faceAt(pos.z) + 3) maxOver = Math.max(maxOver, radius(pos.x, pos.z) - ringIn(ang(pos.x, pos.z)));
    t += DT;
    if (d > lastD - 0.02) stuck += DT; else { stuck = 0; lastD = d; }
    if (stuck > 8) return { name, ok: false, stuck: true, wi, pos, t, maxSlope, falls, maxStep, maxOver, minY };
  }
  return { name, ok: wi >= way.length, pos, t, maxSlope, falls, maxStep, maxOver, minY };
}
const fmt = (r) => JSON.stringify({ ...r, pos: [r.pos.x, r.pos.y, r.pos.z].map((v) => +v.toFixed(1)), t: +r.t.toFixed(0), maxSlope: +r.maxSlope.toFixed(0), maxStep: +r.maxStep.toFixed(2), maxOver: +r.maxOver.toFixed(2), minY: +r.minY.toFixed(1) });

// ---------- 3) вход и выход: лаз <-> центр ----------
{
  const way = [[MOUTH.x - 0.5, MOUTH.z], [MOUTH.x + 4, MOUTH.z], [C.x - 12, C.z - 2], [C.x, C.z], [C.x + 15, C.z + 10], [C.x - 8, C.z - 20], [C.x - 12, C.z + 2]];
  const rIn = walk('mouth -> garden loop', way, { y0: MOUTH.y });
  const rOut = walk('garden -> mouth', way.slice().reverse().concat([[MOUTH.x + 0.5, MOUTH.z]]));
  for (const r of [rIn, rOut]) check(`3. ${r.name}`, r.ok && r.falls === 0 && r.maxStep < 0.6 && r.minY > FLOOR_Y - 2.5, fmt(r));
}

// ---------- 4) из чаши не выйти: пешком и прыжками ----------
{
  let worst = -1e9, bad = 0, total = 0, falls = 0, minY = 1e9;
  for (const air of [false, true]) for (let k = 0; k < 72; k++) {
    const th = (k / 72) * Math.PI * 2 - Math.PI + 0.02;
    const rr = ringIn(th);
    // из ближней точки внутри (r = rr − 6) тянемся к цели далеко за стеной (rr + 80) — «на гребень/в пустыню»
    const sx = C.x + Math.cos(th) * (rr - 6), sz = C.z + Math.sin(th) * (rr - 6);
    if (!inBasinXZ(sx, sz, 2)) continue;
    // направление, ведущее в лаз, — легитимный выход в туннель: пропускаем только узкий сектор по оси лаза
    const toMouth = Math.abs(Math.atan2(Math.sin(th - ang(MOUTH.x, MOUTH.z)), Math.cos(th - ang(MOUTH.x, MOUTH.z))));
    if (toMouth < 0.12) continue;
    const r = walk(`out ${air ? 'jump' : 'walk'} ${(th * 57.3) | 0}`, [[sx, sz], [C.x + Math.cos(th) * (rr + 80), C.z + Math.sin(th) * (rr + 80)]], { maxT: 25, air });
    total++;
    worst = Math.max(worst, r.maxOver); falls += r.falls; minY = Math.min(minY, r.minY);
    // идём 25 с к цели: либо упёрлись (stuck), либо время вышло — в обоих случаях радиус не выходит за кольцо
    if (r.maxOver > -0.3 || r.falls > 0 || r.minY < FLOOR_Y - 2.5) { bad++; if (bad < 6) console.log('  escaped?', fmt(r)); }
  }
  check('4. cannot leave the garden (72 directions, on foot and jumping)', bad === 0 && total > 100, `${total} runs, worst overshoot ${worst.toFixed(2)} m (must be < -0.3), falls ${falls}, min y ${minY.toFixed(1)}`);
}

// ---------- 5) снаружи не войти: из пустыни к центру ----------
{
  let bad = 0, total = 0, minR = 1e9;
  for (let k = 0; k < 48; k++) {
    const th = (k / 48) * Math.PI * 2 - Math.PI + 0.03;
    const sx = C.x + Math.cos(th) * (rim.footR(th) + 25), sz = C.z + Math.sin(th) * (rim.footR(th) + 25);
    if (sx < faceAt(sz) + 12 || solidSdf(sx, sz) < 3 || sx > Zr.x1 - 5 || sz < Zr.z0 + 5 || sz > Zr.z1 - 5) continue;   // старт внутри Когтя/за границей коллизий
    const r = walk(`in ${(th * 57.3) | 0}`, [[sx, sz], [C.x, C.z]], { maxT: 40, y0: fieldH(sx, sz) });
    total++;
    const dEnd = radius(r.pos.x, r.pos.z) - rim.footR(ang(r.pos.x, r.pos.z)); minR = Math.min(minR, dEnd);
    if (dEnd < -0.5 && solidSdf(r.pos.x, r.pos.z) > 1.5) { bad++; if (bad < 6) console.log('  entered?', fmt(r)); }
  }
  check('5. cannot enter the massif from the desert', bad === 0 && total >= 6, `${total} runs, closest ${minR.toFixed(2)} m from the foot line (must be >= -0.5)`);
}
console.log(fails ? `FAILED: ${fails}` : 'ALL PASS', `(${((performance.now() - t0) / 1000).toFixed(1)} s)`);
