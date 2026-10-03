// Единственная «правда» о земле сада: аналитическая высота G(x,z) (котловина + выходной овраг + пол устья, переходящие в пустыню)
// и сетка-карта высот, из которой строится меш пола. Физика (heightAt) берёт ту же сетку и те же треугольники, поэтому
// видимая земля и физическая совпадают до ~1 см. Чистый JS (без THREE) — тестируется в node.
import { smoothstep, clamp, lerp, noise2 } from '../core/util.js';
import { C, MOUTH, RAVINE, PATHS, CHANNELS, BEDS, POND, BASIN, PLAZA, ringIn, ang, radius, floorHeight, polyDist, pathAt } from './layout.js';

/** Область сетки пола (мир). cell — шаг, м. */
export const GRID = { x0: 788, z0: 336, x1: 956, z1: 460, cell: 1 };
/** Низкая стенка/бордюр: высоты над G (м). Физика и визуал используют одни числа. */
export const WALL = { bed: 0.26, bedSoil: 0.2, bedT: 0.32, channel: 0.3, channelT: 0.16 };

function segDist(ax, az, bx, bz, x, z) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

/**
 * desert(x,z) — высота пустыни без участия сада (field.js); faceAt(z) — x грани Когтя у низа.
 * Возвращает {G, mask, cover, ravine, bump, kind, heightAt, ...}.
 */
export function createGroundField({ desert, faceAt }) {
  const FD = (z) => faceAt(z);
  /** Доля «котловины» 1 → 0 на краю гребней и за гранью Когтя. */
  function basinMask(x, z) {
    const r = radius(x, z), rin = ringIn(ang(x, z));
    const m = 1 - smoothstep(rin + 0.8, rin + 3.0, r);
    // западная граница — грань Когтя (пол уходит на 0.8 м под скалу)
    const west = smoothstep(FD(z) - 1.4, FD(z) - 0.8, x);
    // у устья: коридор внутрь скалы
    const mouth = (1 - smoothstep(MOUTH.w * 0.5 + 0.2, MOUTH.w * 0.5 + 0.6, Math.abs(z - MOUTH.z))) * smoothstep(MOUTH.x - MOUTH.lining - 1, MOUTH.x - MOUTH.lining, x);
    return Math.max(m * west, mouth * (x < MOUTH.x + 3 ? 1 : 0));
  }
  /** Овраг: w — доля поперёк (1 на дне, 0 за бортами), s — длина вдоль оси, d — расстояние до оси. */
  function ravineW(x, z) {
    const { d, s } = polyDist(RAVINE.pts, x, z);
    return { w: 1 - smoothstep(RAVINE.w + 0.6, RAVINE.w + 4.2, d), s, d };
  }

  /** Высота дна без низких стенок. */
  function G(x, z) {
    const dB = desert(x, z);
    let h = dB;
    if (x > 856) {
      const rv = ravineW(x, z);
      if (rv.w > 0) {
        const along = smoothstep(RAVINE.fadeFrom, RAVINE.fadeTo, rv.s);
        const hr = lerp(floorHeight(x, z) - 0.15 * smoothstep(0, 40, rv.s), dB, along);
        h = lerp(dB, hr, rv.w);
      }
    }
    const mb = basinMask(x, z);
    if (mb > 0) h = lerp(h, floorHeight(x, z), mb);
    return h;
  }
  /** Доля покрытия мешем пола (1 — наш пол, 0 — пустыня). */
  function cover(x, z) {
    const mb = basinMask(x, z);
    const rv = ravineW(x, z);
    const rw = x > 856 ? rv.w * (1 - smoothstep(RAVINE.fadeTo - 6, RAVINE.fadeTo, rv.s)) : 0;
    return Math.max(mb, rw);
  }

  // ---- низкие стенки/бордюры (для физики; визуал — структуры) ----
  const chanSegs = [];
  for (const ch of CHANNELS) for (let i = 0; i < ch.pts.length - 1; i++) chanSegs.push({ a: ch.pts[i], b: ch.pts[i + 1], half: ch.w / 2 });
  // корзины 4 м: список сегментов, которые могут влиять на точку
  const BK = 4, bx0 = GRID.x0, bz0 = GRID.z0, bnx = Math.ceil((GRID.x1 - GRID.x0) / BK) + 1, bnz = Math.ceil((GRID.z1 - GRID.z0) / BK) + 1;
  const buckets = Array.from({ length: bnx * bnz }, () => []);
  for (const s of chanSegs) {
    const x0 = Math.min(s.a[0], s.b[0]) - 1, x1 = Math.max(s.a[0], s.b[0]) + 1, z0 = Math.min(s.a[1], s.b[1]) - 1, z1 = Math.max(s.a[1], s.b[1]) + 1;
    for (let k = Math.max(0, Math.floor((z0 - bz0) / BK)); k <= Math.min(bnz - 1, Math.floor((z1 - bz0) / BK)); k++) for (let i = Math.max(0, Math.floor((x0 - bx0) / BK)); i <= Math.min(bnx - 1, Math.floor((x1 - bx0) / BK)); i++) buckets[i + bnx * k].push(s);
  }
  /** Добавка к G от стенок желобов и грядок (м). Плавные края (≈6 см). */
  function bump(x, z) {
    let b = 0;
    const bi = Math.floor((x - bx0) / BK), bk = Math.floor((z - bz0) / BK);
    if (bi >= 0 && bk >= 0 && bi < bnx && bk < bnz) {
      for (const s of buckets[bi + bnx * bk]) {
        const d = segDist(s.a[0], s.a[1], s.b[0], s.b[1], x, z);
        if (d > s.half + WALL.channelT + 0.3) continue;
        const k = smoothstep(s.half - 0.05, s.half + 0.03, d) * (1 - smoothstep(s.half + WALL.channelT - 0.03, s.half + WALL.channelT + 0.08, d));
        if (k > 0) b = Math.max(b, WALL.channel * k);
      }
    }
    for (let q = 0; q < BEDS.length; q++) {
      const bd = BEDS[q];
      const ax = Math.abs(x - bd.x) - bd.hx, az = Math.abs(z - bd.z) - bd.hz;
      if (ax > WALL.bedT + 0.2 || az > WALL.bedT + 0.2) continue;
      const m = Math.max(ax, az);                    // <0 внутри грядки
      const wall = smoothstep(-0.05, 0.03, m) * (1 - smoothstep(WALL.bedT - 0.03, WALL.bedT + 0.08, m));
      const soil = 1 - smoothstep(-0.08, 0.0, m);
      b = Math.max(b, WALL.bed * wall, WALL.bedSoil * soil);
    }
    return b;
  }
  /** Вид покрытия: 'soil' | 'stone' | 'water' (мелкая вода). */
  function kind(x, z) {
    if (cover(x, z) < 0.3) return null;
    if (Math.hypot((x - PLAZA.x) / PLAZA.r, (z - PLAZA.z) / (PLAZA.r * 0.85)) < 1 && x > faceAt(z) + 1.2) return 'stone';
    if (x < MOUTH.x + 2.5 && Math.abs(z - MOUTH.z) < MOUTH.w) return 'stone';
    if (Math.abs(x - BASIN.x) < BASIN.w / 2 + 0.4 && Math.abs(z - BASIN.z) < BASIN.d / 2 + 0.4) return 'stone';
    const pu = Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz);
    if (pu < 0.95) return 'water';
    return 'soil';
  }
  return { G, cover, basinMask, ravineW, bump, kind };
}

// ------------------------------------------------------------------ сетка

/** Сетка высот: Float32Array nx*nz; треугольники режутся одной диагональю (i,k)-(i+1,k+1) — heightAt совпадает с мешем. */
export function buildGrid(field, G = GRID) {
  const nx = Math.round((G.x1 - G.x0) / G.cell) + 1, nz = Math.round((G.z1 - G.z0) / G.cell) + 1;
  const h = new Float32Array(nx * nz), cv = new Float32Array(nx * nz);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const x = G.x0 + i * G.cell, z = G.z0 + k * G.cell;
    h[i + nx * k] = field.G(x, z);
    cv[i + nx * k] = field.cover(x, z);
  }
  // ячейка включается, если хотя бы одна вершина покрыта
  const cellOn = new Uint8Array((nx - 1) * (nz - 1));
  for (let k = 0; k < nz - 1; k++) for (let i = 0; i < nx - 1; i++) {
    const o = i + nx * k;
    if (cv[o] > 0.001 || cv[o + 1] > 0.001 || cv[o + nx] > 0.001 || cv[o + nx + 1] > 0.001) cellOn[i + (nx - 1) * k] = 1;
  }
  const c = G.cell;
  /** Высота меша в (x,z); NaN, если ячейки нет. Треугольники: (00,10,11) и (00,11,01). */
  function sample(x, z) {
    const fx = (x - G.x0) / c, fz = (z - G.z0) / c;
    if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return NaN;
    const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k;
    if (!cellOn[i + (nx - 1) * k]) return NaN;
    const o = i + nx * k, h00 = h[o], h10 = h[o + 1], h01 = h[o + nx], h11 = h[o + nx + 1];
    return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h11 - h01) * u + (h01 - h00) * v;
  }
  /** Покрытие (0..1) в точке, билинейно. */
  function coverAt(x, z) {
    const fx = (x - G.x0) / c, fz = (z - G.z0) / c;
    if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return 0;
    const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k, o = i + nx * k;
    return (cv[o] * (1 - u) + cv[o + 1] * u) * (1 - v) + (cv[o + nx] * (1 - u) + cv[o + nx + 1] * u) * v;
  }
  return { nx, nz, h, cv, cellOn, G, sample, coverAt };
}

/** Данные меша (position/normal/uv/index) по сетке: только включённые ячейки. */
export function buildMeshData(grid) {
  const { nx, nz, h, cellOn, G } = grid;
  const used = new Int32Array(nx * nz).fill(-1);
  const idx = [];
  let nv = 0;
  for (let k = 0; k < nz - 1; k++) for (let i = 0; i < nx - 1; i++) {
    if (!cellOn[i + (nx - 1) * k]) continue;
    for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const q = (i + a) + nx * (k + b); if (used[q] < 0) used[q] = nv++; }
    const v00 = used[i + nx * k], v10 = used[i + 1 + nx * k], v01 = used[i + nx * (k + 1)], v11 = used[i + 1 + nx * (k + 1)];
    idx.push(v00, v01, v11, v00, v11, v10);          // (00,10,11) и (00,11,01) — вверх (+Y)
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), cov = new Float32Array(nv);
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const q = used[i + nx * k]; if (q < 0) continue;
    const x = G.x0 + i * G.cell, z = G.z0 + k * G.cell, y = h[i + nx * k];
    pos[q * 3] = x; pos[q * 3 + 1] = y; pos[q * 3 + 2] = z;
    const hl = h[Math.max(0, i - 1) + nx * k], hr = h[Math.min(nx - 1, i + 1) + nx * k], hd = h[i + nx * Math.max(0, k - 1)], hu = h[i + nx * Math.min(nz - 1, k + 1)];
    let gx = (hl - hr) / (2 * G.cell), gz = (hd - hu) / (2 * G.cell);
    const l = Math.hypot(gx, 1, gz); nor[q * 3] = gx / l; nor[q * 3 + 1] = 1 / l; nor[q * 3 + 2] = gz / l;
    cov[q] = grid.cv[i + nx * k];
  }
  return { position: pos, normal: nor, cover: cov, index: new Uint32Array(idx) };
}

/** Карта-сплат (RGBA8) над областью: R — тропа, G — влага, B — песок/наносы, A — густота «зелени» (0 — голая земля). Разрешение res (м/пиксель). */
export function buildSplat(field, area, res = 0.5) {
  const w = Math.ceil((area.x1 - area.x0) / res), hgt = Math.ceil((area.z1 - area.z0) / res);
  const data = new Uint8Array(w * hgt * 4);
  for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
    const x = area.x0 + (i + 0.5) * res, z = area.z0 + (j + 0.5) * res;
    const o = (i + w * j) * 4;
    const nz = noise2(x * 0.7, z * 0.7);
    // тропа: неровный край
    const path = pathAt(x + nz * 0.25, z - nz * 0.2);
    // влага: у желобов и пруда
    let wet = 0;
    for (const ch of CHANNELS) for (let q = 0; q < ch.pts.length - 1; q++) {
      const d = segDist(ch.pts[q][0], ch.pts[q][1], ch.pts[q + 1][0], ch.pts[q + 1][1], x, z);
      wet = Math.max(wet, 1 - smoothstep(0.4, 2.2 + nz, d));
    }
    wet = Math.max(wet, 1 - smoothstep(0.7, 1.6, Math.hypot((x - POND.x) / (POND.rx + 0.5), (z - POND.z) / (POND.rz + 0.5))));
    // песок: у гребней и в овраге
    const r = radius(x, z), th = ang(x, z), rin = ringIn(th);
    let sand = smoothstep(rin - 10, rin - 1, r) * (0.6 + 0.4 * noise2(x / 5, z / 5));
    const rv = field.ravineW(x, z);
    sand = Math.max(sand, rv.w * 0.85 * (0.7 + 0.3 * nz));
    const green = (1 - sand) * (0.35 + 0.65 * Math.max(wet, 0.25 + 0.3 * noise2(x / 14 + 3, z / 14))) * (1 - path);
    data[o] = Math.round(clamp(path) * 255); data[o + 1] = Math.round(clamp(wet) * 255); data[o + 2] = Math.round(clamp(sand) * 255); data[o + 3] = Math.round(clamp(green) * 255);
  }
  return { data, w, h: hgt, area, res };
}
