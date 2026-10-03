// Запекание пещеры: SDF → меш (surface nets) + вершинные AO/свет/цвет + сетки пола и стен + объём зондов света.
// Чистый JS (Node/браузер). Результат — {header, buffers}, упаковка/сжатие — в pack.js.
import { createField, rayHit } from './field.js';
import { surfaceNets } from './mesher.js';
import { buildVolume, march, visibility } from './volume.js';
import { smoothstep, clamp, vn3 } from './sdf.js';
import * as L from './layout.js';
import { buildLights, shadeAt } from './light.js';
import { buildDecals } from './decals.js';

import { BOUNDS, GRID } from './consts.js';
export { BOUNDS, GRID };

const hash1 = (n) => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** Активность блока surface nets: |SDF в центре| меньше полудиагонали (+запас на неточность SDF). */
export function makeBlockActive(V, k = 1.15, m = 2.0) { return (cx, cy, cz, half) => Math.abs(V.sample(cx, cy, cz)) < half * k + m; }

/**
 * Открытые торцы: треугольники за плоскостью проёма не рисуем — туннели не закрыты «крышкой» и не торчат наружу.
 *  • выход в сад: (p − mouth)·dir > EXIT.cutT;  • вход (расщелина): (p − ENTRY_CUT.p)·n > 0 (дальше — ниша тропы, модуль level).
 */
export function trimExitCap(mesh) {
  const E = L.EXIT, EC = L.ENTRY_CUT, P = mesh.positions, I = mesh.indices;
  const out = new Uint32Array(I.length);
  let n = 0;
  const sideExit = (v) => (P[v * 3] - E.mouth[0]) * E.dir[0] + (P[v * 3 + 2] - E.mouth[1]) * E.dir[1] - E.cutT;
  const sideEntry = (v) => ((P[v * 3] - EC.p[0]) * EC.n[0] + (P[v * 3 + 2] - EC.p[1]) * EC.n[1]) - EC.cutT;
  const inEntryZone = (v) => P[v * 3 + 2] > 0.5 && P[v * 3] < 2 && P[v * 3 + 2] < 30;   // область входного хода (локально)
  const inExitZone = (v) => P[v * 3 + 2] < -40 && P[v * 3] > 185;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    if (inExitZone(a) && inExitZone(b) && inExitZone(c) && sideExit(a) > 0 && sideExit(b) > 0 && sideExit(c) > 0) continue;
    if (inEntryZone(a) && inEntryZone(b) && inEntryZone(c) && sideEntry(a) > 0 && sideEntry(b) > 0 && sideEntry(c) > 0) continue;
    out[n++] = a; out[n++] = b; out[n++] = c;
  }
  mesh.indices = out.slice(0, n);
}

export const CHUNK = 16;
export function bakeCave(opts = {}) {
  const log = opts.log || (() => {});
  const T0 = Date.now();
  const lap = (s) => log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${s}`);
  const cell = opts.cell || 0.34;
  const field = createField();
  const air = (x, y, z) => field.air(x, y, z);
  lap('поле создано');

  // 1. Грубый объём (0.5 м).
  const V = buildVolume(air, BOUNDS, 0.5, log);
  lap('объём готов');

  // 2. Меш.
  const mesh = surfaceNets(air, BOUNDS, cell, makeBlockActive(V), log);
  trimExitCap(mesh);
  const NV = mesh.positions.length / 3;
  lap(`меш: ${NV} вершин, ${mesh.indices.length / 3} треугольников`);

  // 3. Светошары (финальные позиции) и источники.
  const globes = placeGlobes(V, field);
  lap(`светошаров ${globes.length}`);
  const lights = buildLights(globes);

  // 4. Атрибуты вершин.
  const att = vertexAttributes(mesh, V, field, lights, globes, log);
  lap('атрибуты вершин готовы');

  // 5. Якоря.
  const anchors = {};
  for (const [id, a] of Object.entries(L.ANCHORS)) {
    const dl = Math.hypot(...a.d);
    const d = a.d.map((v) => v / dl);
    const t = rayHit(field, a.o, d, a.maxT || 40);
    if (t < 0) { log(`! якорь ${id}: стена не найдена`); continue; }
    const p = [a.o[0] + d[0] * t, a.o[1] + d[1] * t, a.o[2] + d[2] * t];
    const n = field.grad(p[0], p[1], p[2], 0.08).map((v) => -v);
    anchors[id] = { p, n };
  }

  // 6. Декали (конформные).
  const decals = buildDecals({ field, V, lights, globes, anchors, log });
  lap(`декали: ${decals.reduce((s, d) => s + d.count, 0)} шт.`);

  // 7. Сетки пола/стен.
  const grids = buildGrids(field, V, log);
  lap('сетки пола готовы');

  // 8. Объём зондов освещения (1 м).
  const probes = buildProbes(V, lights, log);
  lap('зонды освещения готовы');

  // 9. Чанки (по центроиду треугольника).
  const chunks = buildChunks(mesh, CHUNK);
  lap(`чанков ${chunks.list.length}`);

  // 10. Потенциальная видимость чанков из ячеек 8 м (отсечение «за стеной»).
  const pvs = buildPVS(V, mesh, chunks, log);
  lap(`PVS: ячеек ${pvs.rows}, чанков ${chunks.list.length}`);

  return { mesh, att, chunks, pvs, grids, probes, globes, anchors, decals, lights, bounds: BOUNDS, cell, bakeMs: Date.now() - T0 };
}

// ------------------------------------------------------------------ светошары ----
function placeGlobes(V, field) {
  const plan = L.planGlobePositions();
  const out = [];
  plan.forEach((g) => {
    // потолок над желаемой точкой
    let y = g.y;
    // найти воздух вокруг желаемой высоты
    let ceil = null;
    for (let yy = g.y - 2.8; yy < 34; yy += 0.1) {
      if (V.sample(g.x, yy, g.z) < -0.15) { ceil = yy; break; }
    }
    if (ceil === null) { return; }
    // подъём до потолка
    let top = ceil;
    for (let yy = ceil; yy < 34; yy += 0.1) { if (V.sample(g.x, yy, g.z) < -0.15) top = yy; else break; }
    y = Math.min(g.y, top - 0.55);
    y = Math.max(y, ceil + 0.2);
    if (V.sample(g.x, y, g.z) > -0.4) { /* у самой стены — всё равно оставляем, чуть сместив к центру */ }
    out.push({ ...g, y });
  });
  return out;
}

// ------------------------------------------------------------------ вершинные атрибуты ----
const DIRS = (() => { const a = []; const N = 16; for (let i = 0; i < N; i++) { const u = (i + 0.5) / N, ph = i * 2.399963; const r = Math.sqrt(u); a.push([Math.cos(ph) * r, Math.sin(ph) * r, Math.sqrt(1 - u)]); } return a; })();

function aoAt(V, p, n, seed) {
  // базис касательных
  let tx, ty, tz;
  if (Math.abs(n[1]) < 0.9) { tx = n[2]; ty = 0; tz = -n[0]; } else { tx = 1; ty = 0; tz = 0; }
  let tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
  const bx = n[1] * tz - n[2] * ty, by = n[2] * tx - n[0] * tz, bz = n[0] * ty - n[1] * tx;
  const rot = hash1(seed) * 6.2831853, cr = Math.cos(rot), sr = Math.sin(rot);
  const ox = p[0] + n[0] * 0.12, oy = p[1] + n[1] * 0.12, oz = p[2] + n[2] * 0.12;
  const MAXT = 5.0;
  let occ = 0, near = 0;
  for (let i = 0; i < DIRS.length; i++) {
    const d = DIRS[i];
    const lx = d[0] * cr - d[1] * sr, ly = d[0] * sr + d[1] * cr, lz = d[2];
    const dx = tx * lx + bx * ly + n[0] * lz, dy = ty * lx + by * ly + n[1] * lz, dz = tz * lx + bz * ly + n[2] * lz;
    const t = march(V, ox, oy, oz, dx, dy, dz, MAXT, 0.15, 0.06);
    occ += 1 - t / MAXT;
    near += t < 1.0 ? 1 - t : 0;
  }
  occ /= DIRS.length; near /= DIRS.length;
  return clamp(1 - occ * 1.25 - near * 0.5, 0.04, 1);
}

function segDist(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / l2, 0, 1);
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}
const PATH_SEGS = [];
for (const k of Object.keys(L.PATHS)) { const P = L.PATHS[k]; for (let i = 0; i < P.length - 1; i++) PATH_SEGS.push([P[i], P[i + 1]]); }
for (let i = 0; i < L.EXIT.nodes.length - 1; i++) PATH_SEGS.push([L.EXIT.nodes[i], L.EXIT.nodes[i + 1]]);
PATH_SEGS.push([[44, 0], [98, 0]], [[44, -2.4], [98, -2.4]], [[44, 2.4], [98, 2.4]], [[150, 0], [166, 0]]);
const pathDist = (x, z) => { let m = 9; for (const s of PATH_SEGS) { const d = segDist(x, z, s[0], s[1]); if (d < m) m = d; } return m; };

function vertexAttributes(mesh, V, field, lights, globes, log) {
  const NV = mesh.positions.length / 3;
  const col = new Uint8Array(NV * 4), par = new Uint8Array(NV * 4), glow = new Uint8Array(NV * 4);
  const P = mesh.positions, N = mesh.normals;
  const p = [0, 0, 0], n = [0, 0, 0];
  // пространственный хэш светошаров для копоти
  for (let v = 0; v < NV; v++) {
    p[0] = P[v * 3]; p[1] = P[v * 3 + 1]; p[2] = P[v * 3 + 2];
    n[0] = N[v * 3]; n[1] = N[v * 3 + 1]; n[2] = N[v * 3 + 2];
    const x = p[0], y = p[1], z = p[2];
    const ao = aoAt(V, p, n, v);
    const sh = shadeAt(lights, V, p, n, ao);
    // --- цвет: низкочастотные вариации охры/умбры
    const n1 = vn3(x * 0.07, y * 0.09, z * 0.07), n2 = vn3(x * 0.16 + 4, y * 0.2, z * 0.16), n3 = vn3(x * 0.4 - 3, y * 0.5, z * 0.4);
    let r = 1 + 0.10 * n1 + 0.06 * n3, g = 1 + 0.07 * n1 - 0.05 * n2 + 0.05 * n3, b = 1 - 0.1 * n1 + 0.1 * n2;
    const region = L.REGION_BY_X(x, z, y);
    const stairsB6 = x > 96 && x < 106.5 && z > 9 && y < 0;
    if (region === 'B1') { r *= 0.92; g *= 0.9; b *= 0.88; }
    if (region === 'B5') { r *= 1.06; g *= 1.04; }
    if (region === 'B6') { r *= 0.86; g *= 0.97; b *= 1.12; }
    else if (stairsB6) { const k = clamp(-y / 9, 0, 1); r *= 1 - 0.14 * k; b *= 1 + 0.12 * k; }
    const inCist = x > 106 && x < 144 && z > 8.2;
    if (inCist) { r *= 0.9; g *= 0.96; b *= 1.08; }
    // --- копоть: потолок над светошарами + общий
    let soot = (n[1] < -0.2 ? 0.2 + 0.25 * (-n[1]) : 0.04) + 0.1 * (1 - ao);
    if (n[1] < 0.3) for (let i = 0; i < globes.length; i++) {
      const g0 = globes[i];
      if (Math.abs(g0.x - x) > 2.4 || Math.abs(g0.z - z) > 2.4) continue;
      const dy = y - g0.y; if (dy < -0.4 || dy > 3.0) continue;
      const d = Math.hypot(g0.x - x, g0.z - z, dy * 0.6);
      soot += 0.6 * Math.exp(-(d * d) / 1.5) * (n[1] < 0 ? 1 : 0.5);
    }
    if (region === 'B1') soot += 0.12;
    soot = clamp(soot, 0, 1);
    // --- полировка ладонями: стены на высоте руки в узких местах, пол по тропе, ступени
    let polish = 0;
    const fl = field.floorAt(x, y, z), hh = y - fl;
    const horizontalWall = Math.abs(n[1]) < 0.55;
    if (horizontalWall && hh > 0.7 && hh < 1.9) {
      const tNar = march(V, p[0] + n[0] * 0.15, p[1] + n[1] * 0.15, p[2] + n[2] * 0.15, n[0], n[1], n[2], 3.6, 0.1, 0.05);
      const nar = 1 - smoothstep(1.4, 3.4, tNar);
      polish = nar * smoothstep(0.7, 1.1, hh) * (1 - smoothstep(1.5, 1.9, hh)) * (0.55 + 0.45 * vn3(x * 1.3, y * 1.3, z * 1.3));
    } else if (n[1] > 0.7) {
      const pd = pathDist(x, z);
      polish = 0.55 * (1 - smoothstep(0.5, 1.6, pd)) * (0.7 + 0.3 * vn3(x * 2, 1, z * 2));
      if (region === 'B5' && Math.hypot(x - L.HALL.cx, z) > L.HALL.bowlR) polish = Math.max(polish, 0.25);
    }
    // --- влага
    let wet = 0;
    if (inCist) wet = clamp((1 - smoothstep(-1.4, 2.2, y)) * 0.9 + (n[1] < -0.2 ? 0.2 : 0), 0, 1) * (0.7 + 0.3 * vn3(x * 0.6, y, z * 0.6) + 0.3);
    if (region === 'B6') wet = clamp(0.4 + 0.5 * (1 - smoothstep(-9.2, -5.5, y)) + (n[1] < -0.2 ? 0.22 : 0) + 0.15 * vn3(x * 0.5, y * 0.5, z * 0.5), 0, 1);
    else if (stairsB6) wet = Math.max(wet, clamp(-y / 9, 0, 1) * 0.55);
    wet = clamp(wet, 0, 1);
    // --- песок/пыль
    const rr = Math.hypot(x - L.HALL.cx, z - L.HALL.cz);
    let sand = 0;
    if (n[1] > 0.5) {
      sand = 0.3 * (1 - ao) * n[1];
      if (rr < L.HALL.bowlR + 0.15 && x > 160) sand = 1;
      if (region === 'B1') sand = Math.max(sand, 0.8 * (1 - smoothstep(2, 16, x)) * n[1]);
    }
    col[v * 4] = clamp(r * 128, 0, 255); col[v * 4 + 1] = clamp(g * 128, 0, 255); col[v * 4 + 2] = clamp(b * 128, 0, 255); col[v * 4 + 3] = ao * 255;
    par[v * 4] = soot * 255; par[v * 4 + 1] = clamp(polish, 0, 1) * 255; par[v * 4 + 2] = wet * 255; par[v * 4 + 3] = clamp(sand, 0, 1) * 255;
    for (let c = 0; c < 3; c++) glow[v * 4 + c] = clamp(Math.sqrt(sh[c] / 4) * 255, 0, 255);
  }
  return { col, par, glow };
}

// ------------------------------------------------------------------ сетки пола/стен ----
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
/** Евклидово преобразование расстояний: возвращает расстояние (в клетках) до ближайшей клетки mask===1. */
export function edt2d(mask, nx, nz) {
  const INF = 1e12;
  const g = new Float64Array(nx * nz);
  const n = Math.max(nx, nz);
  const f = new Float64Array(n), o = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let j = 0; j < nz; j++) { for (let i = 0; i < nx; i++) f[i] = mask[j * nx + i] ? 0 : INF; edt1d(f, nx, o, v, z); for (let i = 0; i < nx; i++) g[j * nx + i] = o[i]; }
  for (let i = 0; i < nx; i++) { for (let j = 0; j < nz; j++) f[j] = g[j * nx + i]; edt1d(f, nz, o, v, z); for (let j = 0; j < nz; j++) g[j * nx + i] = Math.sqrt(o[j]); }
  return g;
}

function buildGrids(field, V, log) {
  const { h, ox, oz, nx, nz } = GRID;
  const NOFLOOR = -32768;
  const f0 = new Float32Array(nx * nz).fill(NaN), f1 = new Float32Array(nx * nz).fill(NaN);
  const YMAX = 34, YMIN = -29, STEP = 0.5;
  let cols = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = ox + (i + 0.5) * h, z = oz + (j + 0.5) * h;
    const floors = [];
    let prevAir = V.sample(x, YMAX, z) < 0, prevY = YMAX;
    for (let y = YMAX - STEP; y >= YMIN; y -= STEP) {
      const a = V.sample(x, y, z) < 0;
      if (prevAir && !a) {
        // пол между y и prevY: уточняем по точному полю
        let lo = y - 0.06, hi = prevY + 0.06;
        if (field.air(x, lo, z) < 0) lo = y - 0.4;
        if (field.air(x, hi, z) >= 0) hi = prevY + 0.4;
        if (field.air(x, lo, z) >= 0 && field.air(x, hi, z) < 0) {
          for (let it = 0; it < 9; it++) { const m = (lo + hi) / 2; if (field.air(x, m, z) < 0) hi = m; else lo = m; }
          const fy = (lo + hi) / 2;
          // запас высоты над полом
          let head = true;
          for (let hy = 0.3; hy <= 1.75; hy += 0.35) if (V.sample(x, fy + hy, z) > -0.02) { head = false; break; }
          if (head) floors.push(fy);
        }
      }
      prevAir = a; prevY = y;
    }
    if (floors.length) cols++;
    floors.sort((p, q) => p - q);
    const idx = j * nx + i;
    for (const fy of floors) { if (fy < 4.4 && Number.isNaN(f0[idx])) f0[idx] = fy; }
    for (let q = floors.length - 1; q >= 0; q--) if (floors[q] >= 2.4) { f1[idx] = floors[q]; break; }
  }
  log(`grids: columns with floor ${cols}`);
  // лестницы — настоящие ступени (меш ступеней добавляет рантайм/props, здесь — высоты)
  applyStairHeights(f0, f1, nx, nz);
  // проходимость + расстояние до стен для каждого слоя
  const walls = [];
  for (const F of [f0, f1]) {
    const blocked = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const idx = j * nx + i, fy = F[idx];
      if (Number.isNaN(fy)) { blocked[idx] = 1; continue; }
      const x = ox + (i + 0.5) * h, z = oz + (j + 0.5) * h;
      let ok = true;
      for (const hy of [0.5, 0.95, 1.45, 1.75]) if (field.air(x, fy + hy, z) > -0.03) { ok = false; break; }
      if (!ok) { blocked[idx] = 1; continue; }
      for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const fn = F[jj * nx + ii]; if (!Number.isNaN(fn) && Math.abs(fn - fy) > 0.78) { ok = false; break; }
      }
      if (!ok) blocked[idx] = 1;
    }
    const open = new Uint8Array(nx * nz); for (let k = 0; k < open.length; k++) open[k] = blocked[k] ? 0 : 1;
    const dB = edt2d(blocked, nx, nz), dO = edt2d(open, nx, nz);
    const sd = new Int8Array(nx * nz);
    for (let k = 0; k < sd.length; k++) {
      const m = open[k] ? (dB[k] - 0.5) * h : -(dO[k] - 0.5) * h;
      sd[k] = clamp(Math.round(m / 0.05), -127, 127);
    }
    walls.push(sd);
  }
  const q = (F) => { const o = new Int16Array(F.length); for (let k = 0; k < F.length; k++) o[k] = Number.isNaN(F[k]) ? NOFLOOR : Math.round(F[k] * 100); return o; };
  return { f0: q(f0), f1: q(f1), w0: walls[0], w1: walls[1], NOFLOOR };
}

/** Ступени: заменяем гладкий скат дискретными высотами в областях лестниц. */
export function stairTop(x, z) {
  const az = Math.abs(z);
  // B2 (север и юг): подъём вдоль +X от stairX0
  if (x >= L.GALLERY.stairX0 && x < L.GALLERY.stairX0 + L.GALLERY.nSteps * L.GALLERY.tread && az > 4.2 && az < 7.9) {
    const k = Math.floor((x - L.GALLERY.stairX0) / L.GALLERY.tread);
    return (k + 1) * L.GALLERY.riser;
  }
  // помост B5: подъём вдоль −|z|
  if (x >= L.LEDGE.stairX0 && x < L.LEDGE.stairX1 && az > L.LEDGE.hz && az < 9.4) {
    const nS = 8, run = 4.6 / nS;
    const k = Math.floor((9.2 - az) / run);
    return clamp((k + 1) * (L.LEDGE.y / nS), 0, L.LEDGE.y);
  }
  // лестница водяного погреба (ступени 0.18 м)
  const CS = L.CELLAR.stairs;
  if (x > CS.x - 1.3 && x < CS.x + 1.3 && z > CS.z0 - 0.3 && z < CS.z0 + CS.n * CS.tread + 0.45) return L.cellarStairY(z);
  return null;
}
function applyStairHeights(f0, f1, nx, nz) {
  const { h, ox, oz } = GRID;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = ox + (i + 0.5) * h, z = oz + (j + 0.5) * h;
    const s = stairTop(x, z); if (s === null) continue;
    const idx = j * nx + i;
    for (const F of [f0, f1]) { const fy = F[idx]; if (!Number.isNaN(fy) && Math.abs(fy - s) < 0.5) F[idx] = s; }
  }
}

// ------------------------------------------------------------------ зонды света (1 м) ----
function buildProbes(V, lights, log) {
  const h = 1.0, ox = BOUNDS.min[0], oy = BOUNDS.min[1], oz = BOUNDS.min[2];
  const nx = Math.ceil((BOUNDS.max[0] - ox) / h), ny = Math.ceil((BOUNDS.max[1] - oy) / h), nz = Math.ceil((BOUNDS.max[2] - oz) / h);
  const data = new Uint8Array(nx * ny * nz * 4);
  const isAir = new Uint8Array(nx * ny * nz);
  const nrm = [0, 1, 0];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = ox + (i + 0.5) * h, y = oy + (j + 0.5) * h, z = oz + (k + 0.5) * h;
    const d = V.sample(x, y, z);
    if (d > -0.15) continue;
    const id = (k * ny + j) * nx + i;
    isAir[id] = 1;
    const pp = [x, y, z];
    const ao = aoAt(V, pp, nrm, id);
    const sh = shadeAt(lights, V, pp, null, ao);
    for (let c = 0; c < 3; c++) data[id * 4 + c] = clamp(Math.sqrt(sh[c] / 4) * 255, 0, 255);
    data[id * 4 + 3] = clamp(ao * 255, 0, 255);
  }
  // растекание значений в соседние клетки камня (чтобы трилинейная выборка у стен не темнела)
  for (let pass = 0; pass < 3; pass++) {
    const snap = data.slice(), snapAir = isAir.slice();
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const id = (k * ny + j) * nx + i; if (snapAir[id]) continue;
      let c = 0, a = [0, 0, 0, 0];
      for (const o of [1, -1, ny * nx, -ny * nx, nx, -nx]) { const nid = id + o; if (snapAir[nid]) { c++; for (let q = 0; q < 4; q++) a[q] += snap[nid * 4 + q]; } }
      if (c) { for (let q = 0; q < 4; q++) data[id * 4 + q] = a[q] / c; isAir[id] = 1; }
    }
  }
  log(`probes: ${nx}x${ny}x${nz}`);
  return { ox, oy, oz, h, nx, ny, nz, data };
}

// ------------------------------------------------------------------ чанки ----
function buildChunks(mesh, size) {
  const P = mesh.positions, I = mesh.indices;
  const NT = I.length / 3;
  const keyOf = new Int32Array(NT);
  const map = new Map();
  const keys = [];
  for (let t = 0; t < NT; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const cx = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
    const key = `${Math.floor(cx / size)},${Math.floor(cy / size)},${Math.floor(cz / size)}`;
    let id = map.get(key);
    if (id === undefined) { id = keys.length; map.set(key, id); keys.push(key); }
    keyOf[t] = id;
  }
  const counts = new Int32Array(keys.length);
  for (let t = 0; t < NT; t++) counts[keyOf[t]]++;
  const starts = new Int32Array(keys.length); let acc = 0;
  for (let k = 0; k < keys.length; k++) { starts[k] = acc; acc += counts[k] * 3; }
  const out = new Uint32Array(I.length); const cur = starts.slice();
  const bb = keys.map(() => [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]);
  for (let t = 0; t < NT; t++) {
    const k = keyOf[t];
    for (let c = 0; c < 3; c++) {
      const v = I[t * 3 + c]; out[cur[k]++] = v;
      const B = bb[k];
      for (let q = 0; q < 3; q++) { const w = P[v * 3 + q]; if (w < B[q]) B[q] = w; if (w > B[q + 3]) B[q + 3] = w; }
    }
  }
  const list = keys.map((key, k) => { const B = bb[k]; const cx = (B[0] + B[3]) / 2, cy = (B[1] + B[4]) / 2, cz = (B[2] + B[5]) / 2; return { start: starts[k], count: counts[k] * 3, bs: [cx, cy, cz, Math.hypot(B[3] - B[0], B[4] - B[1], B[5] - B[2]) / 2 + 0.2], key }; });
  mesh.indices = out;
  return { list };
}

// ------------------------------------------------------------------ PVS (видимость чанков из ячеек 8 м) ----
function clearLine(V, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
  if (L < 0.4) return true;
  const ix = dx / L, iy = dy / L, iz = dz / L;
  let t = 0.2;
  const tEnd = L - 0.35;
  while (t < tEnd) {
    const d = V.sample(ax + ix * t, ay + iy * t, az + iz * t);
    if (d > -0.03) return false;
    t += Math.max(0.2, -d * 0.85);
  }
  return true;
}

/**
 * Для каждой воздушной ячейки 8 м (по объёму V) считает, какие чанки меша видны хотя бы из одной из ~14 точек ячейки до одной из ~28 точек на чанке.
 * Результат: idx[ячейка] → строка таблицы (или −1), bits[строка] — битовая маска по чанкам. Чанки дальше FAR (по сфере) невидимы.
 */
function buildPVS(V, mesh, chunks, log, CS = 8, FAR = 115) {
  const list = chunks.list, NC = list.length, P = mesh.positions, I = mesh.indices;
  const ox = BOUNDS.min[0], oy = BOUNDS.min[1], oz = BOUNDS.min[2];
  const nx = Math.ceil((BOUNDS.max[0] - ox) / CS), ny = Math.ceil((BOUNDS.max[1] - oy) / CS), nz = Math.ceil((BOUNDS.max[2] - oz) / CS);
  // целевые точки чанков
  const targets = list.map((c, k) => {
    const pts = [], nt = c.count / 3, n = Math.min(30, nt);
    for (let i = 0; i < n; i++) {
      const t = Math.floor(((i + 0.5) / n) * nt), v = I[c.start + t * 3 + (i % 3)];
      pts.push([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
    }
    return pts;
  });
  const rowOf = new Int16Array(nx * ny * nz).fill(-1);
  const rows = [];
  const NB = Math.ceil(NC / 8);
  let seed = 12345; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let pairs = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    // воздушные точки внутри ячейки
    const pts = [];
    for (let a = 0; a < 90 && pts.length < 14; a++) {
      const x = ox + (i + rnd()) * CS, y = oy + (j + rnd()) * CS, z = oz + (k + rnd()) * CS;
      if (V.sample(x, y, z) < -0.35) pts.push([x, y, z]);
    }
    if (!pts.length) continue;
    const cx = ox + (i + 0.5) * CS, cy = oy + (j + 0.5) * CS, cz = oz + (k + 0.5) * CS, cr = CS * 0.87;
    const bits = new Uint8Array(NB);
    for (let c = 0; c < NC; c++) {
      const bs = list[c].bs;
      const dd = Math.hypot(bs[0] - cx, bs[1] - cy, bs[2] - cz) - bs[3] - cr;
      if (dd > FAR) continue;
      let vis = dd < 2;           // рядом — всегда
      for (let t = 0; t < targets[c].length && !vis; t++) {
        const q = targets[c][t];
        for (let a = 0; a < pts.length; a++) { pairs++; if (clearLine(V, pts[a][0], pts[a][1], pts[a][2], q[0], q[1], q[2])) { vis = true; break; } }
      }
      if (vis) bits[c >> 3] |= 1 << (c & 7);
    }
    rowOf[(k * ny + j) * nx + i] = rows.length;
    rows.push(bits);
  }
  const data = new Uint8Array(rows.length * NB);
  rows.forEach((r, i) => data.set(r, i * NB));
  // консервативная дилатация: ячейка видит всё, что видят её воздушные соседи по 6 граням
  const out = new Uint8Array(data.length);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const r = rowOf[(k * ny + j) * nx + i]; if (r < 0) continue;
    for (let b = 0; b < NB; b++) out[r * NB + b] = data[r * NB + b];
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const ii = i + di, jj = j + dj, kk = k + dk; if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
      const r2 = rowOf[(kk * ny + jj) * nx + ii]; if (r2 < 0) continue;
      for (let b = 0; b < NB; b++) out[r * NB + b] |= data[r2 * NB + b];
    }
  }
  let on = 0; for (const v of out) { let x = v; while (x) { on += x & 1; x >>= 1; } }
  log(`pvs: ячеек ${rows.length}, пар лучей ${(pairs / 1e6).toFixed(1)} М, среднее видимых чанков ${(on / Math.max(1, rows.length)).toFixed(1)} из ${NC}`);
  return { cs: CS, ox, oy, oz, nx, ny, nz, nb: NB, nc: NC, rows: rows.length, idx: rowOf, bits: out };
}
