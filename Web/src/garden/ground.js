// Единственная «правда» о земле сада: аналитическая высота G(x,z) (дно высокой котловины, продолженное под стены) и сетка-карта высот,
// из которой строится меш пола. Физика (heightAt) берёт ту же сетку и те же треугольники, поэтому видимая земля и физическая совпадают до ~1 см.
// Пустыня лежит на ~30 м ниже и в саду не участвует вовсе (ни «заплатки», ни торчащих дюн/барьера у лаза). Чистый JS (без THREE) — тестируется в node.
import { smoothstep, clamp, noise2 } from '../core/util.js';
import { C, MOUTH, ringIn, ang, radius, floorHeight, shade, ringH } from './layout.js';

/** Область сетки пола (мир). cell — шаг, м. */
export const GRID = { x0: 778, z0: 350, x1: 884, z1: 446, cell: 1 };

/**
 * faceAt(z) — x грани Когтя на уровне пола. Возвращает {G, cover, basinMask, kind, sandiness}.
 */
export function createGroundField({ faceAt }) {
  const FD = (z) => faceAt(z);
  /** Доля «котловины» 1 → 0: внутри стен (с запасом под подножие стен 2.4 м), на западе — до грани Когтя (пол уходит на 0.8 м под скалу). */
  function basinMask(x, z) {
    const r = radius(x, z), rin = ringIn(ang(x, z));
    const m = 1 - smoothstep(rin + 1.2, rin + 2.6, r);
    const west = smoothstep(FD(z) - 1.4, FD(z) - 0.8, x);
    // у лаза: коридор внутрь скалы (пол плоский до внутреннего конца облицовки и ещё на 1.5 м — стык с туннелем сиетча)
    const mouth = (1 - smoothstep(MOUTH.w * 0.5 + 0.2, MOUTH.w * 0.5 + 0.6, Math.abs(z - MOUTH.z))) * smoothstep(MOUTH.x - MOUTH.lining - 3, MOUTH.x - MOUTH.lining - 1.5, x);
    return Math.max(m * west, mouth * (x < MOUTH.x + 3 ? 1 : 0));
  }
  /** Высота дна: везде floorHeight (под стенами продолжается, поэтому в сетке нет «обрывов» между покрытыми и непокрытыми вершинами). */
  const G = (x, z) => floorHeight(x, z);
  const cover = (x, z) => basinMask(x, z);
  /** 0..1: намёты песка (у стен, в «тени» стен, пятнами). */
  function sandiness(x, z) {
    return clamp(0.18 + 0.55 * shade(x, z) * (0.6 + 0.4 * noise2(x / 5, z / 5)) + 0.3 * noise2(x / 11 + 7, z / 11), 0, 1);
  }
  /** Вид покрытия: 'soil' | 'sand' | 'stone' (плита лаза). */
  function kind(x, z) {
    if (cover(x, z) < 0.3) return null;
    if (x < MOUTH.x + 2.5 && Math.abs(z - MOUTH.z) < MOUTH.w) return 'stone';
    return sandiness(x, z) > 0.55 ? 'sand' : 'soil';
  }
  return { G, cover, basinMask, kind, sandiness };
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
    const gx = (hl - hr) / (2 * G.cell), gz = (hd - hu) / (2 * G.cell);
    const l = Math.hypot(gx, 1, gz); nor[q * 3] = gx / l; nor[q * 3 + 1] = 1 / l; nor[q * 3 + 2] = gz / l;
    cov[q] = grid.cv[i + nx * k];
  }
  return { position: pos, normal: nor, cover: cov, index: new Uint32Array(idx) };
}

/** Карта-сплат (RGBA8) над областью: R — (резерв, 0), G — тень/сырость стен (грунт темнее), B — песок/наносы, A — «зелень» (0 — голая земля). Разрешение res (м/пиксель). */
export function buildSplat(field, area, res = 0.5) {
  const w = Math.ceil((area.x1 - area.x0) / res), hgt = Math.ceil((area.z1 - area.z0) / res);
  const data = new Uint8Array(w * hgt * 4);
  for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) {
    const x = area.x0 + (i + 0.5) * res, z = area.z0 + (j + 0.5) * res;
    const o = (i + w * j) * 4;
    const nz = noise2(x * 0.7, z * 0.7);
    const sh = shade(x, z);
    // песок: намёты у стен и пятна в открытой части; вокруг камней грунт темнее и грубее
    const sand = clamp(field.sandiness(x + nz * 0.3, z - nz * 0.25));
    // «тень»: у подножия высоких стен грунт чуть темнее и холоднее
    const dark = sh * (0.5 + 0.5 * noise2(x / 7 + 1, z / 7));
    // сухие пятна лишайника/корочки на почве (почвенная биокорка): густота зависит от тени
    const green = clamp((1 - sand) * (0.22 + 0.5 * sh) * (0.5 + 0.5 * noise2(x / 6 + 3, z / 6)));
    data[o] = 0; data[o + 1] = Math.round(clamp(dark) * 255); data[o + 2] = Math.round(sand * 255); data[o + 3] = Math.round(green * 255);
  }
  return { data, w, h: hgt, area, res };
}
