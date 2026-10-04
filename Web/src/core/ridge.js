// Хребет «Когтя Шайтана»: цепь скальных массивов к северу и югу от Когтя (чистые данные и геометрия осей, без THREE).
// Ось каждого массива — сплайн Катмулла–Рома по опорным точкам [x, z, полуширина основания w, высота гребня H] (м), станции каждые 16 м.
// Станции — единый источник правды для SDF-коллизий (field.js), подъёма земли у подножия и меша (desert/ridge.js).
// Сам Коготь (layout.js: ROCK, clawCenter…) не меняется: хребет начинается за его северным остриём и за южным «кулаком»
// и обходит золотой путь, площадку харвестера, червя, сад (овраг-выход на ВСВ) — см. tools/ridge_check.mjs.
import { noise2, clamp } from './util.js';

export const RIDGE_STEP = 16;                // шаг станций, м

/** Массивы. dir — порядок точек: запад — слева от направления (как у Когтя: от севера к югу). */
export const MASSIFS = [
  // ---- север: от Когтя (z = 23) вдаль ----
  { id: 'N1', seed: 1.3, pts: [[800, -70, 40, 150], [818, -150, 62, 215], [850, -270, 86, 268], [880, -390, 62, 205], [896, -450, 34, 140]] },
  { id: 'N2', seed: 2.9, pts: [[925, -560, 46, 160], [942, -690, 92, 315], [968, -850, 112, 350], [952, -1000, 78, 250], [930, -1090, 40, 150]] },
  { id: 'N3', seed: 4.1, pts: [[905, -1170, 44, 125], [858, -1260, 64, 190], [790, -1330, 52, 150]] },
  // отрог на запад от N2 (проход между ним и N1 ~150 м)
  { id: 'N2s', seed: 5.7, pts: [[880, -735, 38, 160], [790, -765, 50, 175], [712, -840, 34, 130]] },
  // отдельная «бутта» в эрге к востоку
  { id: 'Be', seed: 6.2, pts: [[1040, -330, 36, 175], [1062, -255, 50, 205], [1050, -170, 34, 150]] },
  // ---- кольцевая стена сада: дуга радиусом ~158 м вокруг GARDEN (840, 395), внутренний край ≥ 110 м от центра; концы вросли в Коготь (щелей нет) ----
  { id: 'G', seed: 3.3, pts: [[765, 258, 40, 185], [829, 227, 44, 200], [931, 253, 44, 220], [995, 331, 44, 230], [1011, 416, 44, 235], [984, 502, 44, 220], [910, 556, 44, 200], [824, 563, 44, 185], [790, 525, 40, 175]] },
  // ---- юг: за «кулаком» Когтя (z ≈ 517) ----
  { id: 'S1', seed: 7.7, pts: [[716, 692, 60, 170], [692, 800, 96, 285], [652, 925, 108, 335], [612, 1035, 80, 255], [596, 1100, 42, 150]] },
  // отрог на восток от S1 (дальше от сада)
  { id: 'S1s', seed: 8.4, pts: [[702, 845, 40, 150], [800, 880, 50, 185], [895, 940, 36, 135]] },
  { id: 'S2', seed: 9.9, pts: [[585, 1170, 52, 135], [545, 1290, 92, 305], [498, 1425, 104, 350], [506, 1545, 74, 235], [470, 1625, 38, 140]] },
];

const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/** Заполняет станции массива: m.n, m.sx/sz/sw/sh (Float64Array), m.len. Высота H уже включает шапки на концах и шумовую модуляцию. */
function build(m) {
  const P = m.pts, K = P.length - 1;
  // плотная выборка сплайна (шаг ~2 м) для длины дуги
  const dense = [];
  for (let k = 0; k < K; k++) {
    const a = P[Math.max(0, k - 1)], b = P[k], c = P[k + 1], d = P[Math.min(K, k + 2)];
    for (let i = 0; i < 80; i++) {
      const t = i / 80;
      dense.push([0, 1, 2, 3].map((q) => catmull(a[q], b[q], c[q], d[q], t)));
    }
  }
  dense.push(P[K].slice());
  const acc = [0];
  for (let i = 1; i < dense.length; i++) acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const L = acc[acc.length - 1];
  const n = Math.max(2, Math.round(L / RIDGE_STEP));
  m.n = n; m.len = L;
  m.sx = new Float64Array(n + 1); m.sz = new Float64Array(n + 1); m.sw = new Float64Array(n + 1); m.sh = new Float64Array(n + 1);
  const capL = Math.min(0.2 * L, 1.15 * Math.max(P[0][2], P[K][2]) + 25);
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const s = (L * i) / n;
    while (j < acc.length - 2 && acc[j + 1] < s) j++;
    const f = clamp((s - acc[j]) / Math.max(1e-6, acc[j + 1] - acc[j]), 0, 1);
    const a = dense[j], b = dense[j + 1];
    let w = a[2] + (b[2] - a[2]) * f, H = a[3] + (b[3] - a[3]) * f;
    // шумовая модуляция: плавная (период > 100 м), чтобы линейная интерполяция станций совпадала с мешем
    w *= 1 + 0.13 * noise2(s / 130 + m.seed, 1.7) + 0.05 * noise2(s / 55 + m.seed, 4.4);
    H *= 1 + 0.10 * noise2(s / 85 + m.seed, 8.1) + 0.05 * noise2(s / 40 + m.seed, 2.2);
    // закруглённые концы
    const e = Math.min(s, L - s);
    const cap = e >= capL ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow((capL - e) / capL, 2)));
    m.sx[i] = a[0] + (b[0] - a[0]) * f; m.sz[i] = a[1] + (b[1] - a[1]) * f;
    m.sw[i] = Math.max(1.0, w * Math.max(cap, 0.07));
    m.sh[i] = Math.min(350, H) * cap;
  }
}
MASSIFS.forEach(build);

/** Станция массива в точке дуги s (линейная интерполяция): out = {x, z, w, H, tx, tz}. */
export function massifAt(m, s, out = {}) {
  const u = clamp(s / m.len, 0, 1) * m.n;
  const i = Math.min(m.n - 1, Math.floor(u)), f = u - i;
  out.x = m.sx[i] + (m.sx[i + 1] - m.sx[i]) * f;
  out.z = m.sz[i] + (m.sz[i + 1] - m.sz[i]) * f;
  out.w = m.sw[i] + (m.sw[i + 1] - m.sw[i]) * f;
  out.H = m.sh[i] + (m.sh[i + 1] - m.sh[i]) * f;
  // касательная: центральная разность по станциям (сглаживает углы ломаной)
  const a = Math.max(0, i - (f < 0.5 ? 1 : 0)), b = Math.min(m.n, i + (f < 0.5 ? 1 : 2));
  const tx = m.sx[b] - m.sx[a], tz = m.sz[b] - m.sz[a], tl = Math.hypot(tx, tz) || 1;
  out.tx = tx / tl; out.tz = tz / tl;
  return out;
}

// ---------- плоские сегменты и корзины ----------
const segs = [];            // {x0,z0,dx,dz,il,w0,w1,H0,H1,m}
for (const m of MASSIFS) {
  for (let i = 0; i < m.n; i++) {
    const dx = m.sx[i + 1] - m.sx[i], dz = m.sz[i + 1] - m.sz[i];
    segs.push({ x0: m.sx[i], z0: m.sz[i], dx, dz, il: 1 / (dx * dx + dz * dz), w0: m.sw[i], w1: m.sw[i + 1], H0: m.sh[i], H1: m.sh[i + 1] });
  }
}
export const RIDGE_NSEG = segs.length;
const SX = new Float64Array(segs.length), SZ = new Float64Array(segs.length), SDX = new Float64Array(segs.length), SDZ = new Float64Array(segs.length), SIL = new Float64Array(segs.length);
const SW0 = new Float64Array(segs.length), SW1 = new Float64Array(segs.length), SH0 = new Float64Array(segs.length), SH1 = new Float64Array(segs.length);
segs.forEach((s, i) => { SX[i] = s.x0; SZ[i] = s.z0; SDX[i] = s.dx; SDZ[i] = s.dz; SIL[i] = s.il; SW0[i] = s.w0; SW1[i] = s.w1; SH0[i] = s.H0; SH1[i] = s.H1; });

/** Радиус влияния за пределами основания: подъём земли (120 м) и наветренный намёт дюн (170 м). */
export const RIDGE_REACH = 170;
const CELL = 48;
let gx0 = 1e9, gz0 = 1e9, gx1 = -1e9, gz1 = -1e9;
for (const m of MASSIFS) for (let i = 0; i <= m.n; i++) {
  const r = m.sw[i] + RIDGE_REACH;
  gx0 = Math.min(gx0, m.sx[i] - r); gx1 = Math.max(gx1, m.sx[i] + r); gz0 = Math.min(gz0, m.sz[i] - r); gz1 = Math.max(gz1, m.sz[i] + r);
}
gx0 = Math.floor(gx0 / CELL) * CELL; gz0 = Math.floor(gz0 / CELL) * CELL;
const GW = Math.ceil((gx1 - gx0) / CELL) + 1, GH = Math.ceil((gz1 - gz0) / CELL) + 1;
export const RIDGE_BOUNDS = { x0: gx0, z0: gz0, x1: gx0 + GW * CELL, z1: gz0 + GH * CELL };
const cellStart = new Int32Array(GW * GH + 1);
const cellList = [];
{
  const lists = Array.from({ length: GW * GH }, () => []);
  const half = CELL * 0.7072;
  for (let c = 0; c < GW * GH; c++) {
    const cx = gx0 + ((c % GW) + 0.5) * CELL, cz = gz0 + (Math.floor(c / GW) + 0.5) * CELL;
    for (let i = 0; i < segs.length; i++) {
      const px = cx - SX[i], pz = cz - SZ[i];
      let s = (px * SDX[i] + pz * SDZ[i]) * SIL[i]; s = s < 0 ? 0 : s > 1 ? 1 : s;
      const dx = px - SDX[i] * s, dz = pz - SDZ[i] * s;
      const w = Math.max(SW0[i], SW1[i]);
      if (Math.sqrt(dx * dx + dz * dz) < w + RIDGE_REACH + half) lists[c].push(i);
    }
  }
  for (let c = 0; c < GW * GH; c++) { cellStart[c] = cellList.length; for (const i of lists[c]) cellList.push(i); }
  cellStart[GW * GH] = cellList.length;
}
const CL = Int32Array.from(cellList);

/** Результат ridgeQuery: d — знаковое расстояние до основания (м), H — высота гребня у ближайшей точки, ox/oz — единичный вектор «наружу» (от оси к точке). */
export const RQR = { d: 1e9, H: 0, ox: 0, oz: 0 };
/** Знаковое расстояние до основания хребта (2D), 1e9 — если дальше RIDGE_REACH от всех массивов. Без аллокаций. */
export function ridgeQuery(x, z) {
  RQR.d = 1e9;
  const ix = Math.floor((x - gx0) / CELL), iz = Math.floor((z - gz0) / CELL);
  if (ix < 0 || iz < 0 || ix >= GW || iz >= GH) return 1e9;
  const c = iz * GW + ix;
  let best = 1e9, bi = -1, bsx = 0, bsz = 0, bs = 0;
  for (let k = cellStart[c], e = cellStart[c + 1]; k < e; k++) {
    const i = CL[k];
    const apx = x - SX[i], apz = z - SZ[i];
    let s = (apx * SDX[i] + apz * SDZ[i]) * SIL[i];
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const dx = apx - SDX[i] * s, dz = apz - SDZ[i] * s;
    const d = Math.sqrt(dx * dx + dz * dz) - (SW0[i] + (SW1[i] - SW0[i]) * s);
    if (d < best) { best = d; bi = i; bsx = dx; bsz = dz; bs = s; }
  }
  if (bi < 0) return 1e9;
  RQR.d = best;
  RQR.H = SH0[bi] + (SH1[bi] - SH0[bi]) * bs;
  const l = Math.sqrt(bsx * bsx + bsz * bsz) || 1;
  RQR.ox = bsx / l; RQR.oz = bsz / l;
  return best;
}

/** Вес влияния хребта на землю (фартук, намёт): 0 в зоне тропы/расщелины/сиетча на западе Когтя (x < 730, z 150..600) — там рельеф неизменен. */
export function apronWeight(x, z) {
  if ((x >= 800 || z <= 100 || z >= 640) && (x < 700 || x > 980 || z < 270 || z > 520)) return 1;
  const sx = x <= 730 ? 0 : (x - 730) / 70, sz = z < 150 ? (z - 100) / 50 : z > 600 ? (640 - z) / 40 : 1;
  const ax = sx * sx * (3 - 2 * sx), az = sz * sz * (3 - 2 * sz);
  const g = Math.hypot(x - 840, z - 395), gk = g < 85 ? 0 : g > 125 ? 1 : (g - 85) / 40;   // сад (GARDEN): внутри r < 85 рельеф не меняется
  return Math.min(1 - (1 - ax) * az, gk * gk * (3 - 2 * gk));
}
