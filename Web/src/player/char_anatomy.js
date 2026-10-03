// Анатомия фигуры: сглаженные профили (монотонная кубическая интерполяция), суперэллиптические сечения и «мышечные» объёмы.
// Чистая математика без three: используется char_geometry.js. Координаты — абсолютные в позе привязки (рост ≈1.75 м, +Z вперёд, +X влево фигуры).
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const gauss = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2) - (((y - cy) / sy) ** 2));

// ------------------------------------------------------------------------------------------ PCHIP ----
const TAN = new WeakMap();
function tangents(t, k) {
  let per = TAN.get(t);
  if (!per) { per = {}; TAN.set(t, per); }
  if (per[k]) return per[k];
  const n = t.length, d = new Array(n - 1), h = new Array(n - 1), m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = t[i + 1][0] - t[i][0]; d[i] = (t[i + 1][k] - t[i][k]) / (h[i] || 1e-9); }
  if (n === 2) { m[0] = m[1] = d[0]; per[k] = m; return m; }
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  const edge = (h0, h1, d0, d1) => { let s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1); if (s * d0 <= 0) s = 0; else if (d0 * d1 <= 0 && Math.abs(s) > 3 * Math.abs(d0)) s = 3 * d0; return s; };
  m[0] = edge(h[0], h[1], d[0], d[1]); m[n - 1] = edge(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  per[k] = m;
  return m;
}
/** Таблица [[y, v1, v2, ...]] по возрастанию y → значение колонки k на высоте y, гладко (C1), без выбросов. */
export function pchip(t, y, k) {
  const n = t.length;
  if (y <= t[0][0]) return t[0][k];
  if (y >= t[n - 1][0]) return t[n - 1][k];
  let i = 1; while (i < n - 1 && y > t[i][0]) i++;
  const m = tangents(t, k), x0 = t[i - 1][0], h = t[i][0] - x0, s = (y - x0) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * t[i - 1][k] + (s3 - 2 * s2 + s) * h * m[i - 1] + (-2 * s3 + 3 * s2) * t[i][k] + (s3 - s2) * h * m[i];
}

// ------------------------------------------------------------------------------------------ телосложение ----
// sh/chest/waist/hip/depth/limb/head — множители ширины; mus — мускулатура, fat — жир, bust, belly, glute, neck.
export const BUILDS = {
  m: { sh: 1, chest: 1, waist: 1, hip: 1, depth: 1, bust: 0, limb: 1, head: 0.91, mus: 1, fat: 0.35, belly: 0.2, glute: 0.6, neck: 1 },
  f: { sh: 0.88, chest: 0.92, waist: 0.86, hip: 1.1, depth: 0.95, bust: 1, limb: 0.9, head: 0.88, mus: 0.45, fat: 0.8, belly: 0.2, glute: 1.0, neck: 0.82 },
  c: { sh: 0.85, chest: 0.92, waist: 1.02, hip: 0.95, depth: 0.98, bust: 0, limb: 0.9, head: 1.12, mus: 0.1, fat: 0.7, belly: 0.55, glute: 0.3, neck: 0.78 },
  a: { sh: 1.04, chest: 0.98, waist: 0.88, hip: 1.0, depth: 0.98, bust: 0.45, limb: 0.97, head: 0.89, mus: 1.1, fat: 0.25, belly: 0.1, glute: 0.9, neck: 0.9 },
  e: { sh: 1.05, chest: 1.1, waist: 1.14, hip: 1.05, depth: 1.08, bust: 0, limb: 1.0, head: 0.91, mus: 0.55, fat: 1.0, belly: 0.9, glute: 0.5, neck: 1.0 },
};

// Базовые профили торса (мужчина): y, rx, rz, cz, n (суперэллипс: 2 — эллипс, больше — «квадратнее»).
const TORSO_BASE = [
  [0.74, 0.150, 0.094, 0.000, 2.2], [0.80, 0.166, 0.100, -0.002, 2.3], [0.87, 0.178, 0.110, -0.004, 2.4], [0.94, 0.172, 0.108, -0.003, 2.4],
  [1.01, 0.158, 0.102, 0.000, 2.3], [1.07, 0.150, 0.099, 0.002, 2.3], [1.14, 0.152, 0.103, 0.004, 2.3], [1.22, 0.160, 0.111, 0.007, 2.4],
  [1.30, 0.168, 0.119, 0.008, 2.5], [1.37, 0.171, 0.118, 0.003, 2.5], [1.42, 0.160, 0.104, -0.004, 2.4], [1.46, 0.128, 0.086, -0.009, 2.3],
  [1.495, 0.071, 0.071, -0.008, 2.1], [1.53, 0.056, 0.060, -0.004, 2.0], [1.58, 0.053, 0.058, 0.000, 2.0], [1.63, 0.051, 0.057, 0.006, 2.0],
];
const zoneW = (y, B) => {
  const K = [[0.74, B.hip], [0.9, B.hip], [1.06, B.waist], [1.22, B.chest], [1.38, B.sh], [1.47, lerp(B.sh, B.neck, 0.6)], [1.52, B.neck]];
  if (y <= K[0][0]) return K[0][1];
  for (let i = 1; i < K.length; i++) if (y <= K[i][0]) return lerp(K[i - 1][1], K[i][1], sstep(K[i - 1][0], K[i][0], y));
  return K[K.length - 1][1];
};
export function torsoTable(build) {
  const B = BUILDS[build] || BUILDS.m;
  return TORSO_BASE.map(([y, rx, rz, cz, n]) => [y, rx * zoneW(y, B), rz * B.depth * (y > 1.15 && y < 1.4 ? 1 + B.bust * 0.12 : 1), cz + (y > 1.15 && y < 1.4 ? B.bust * 0.01 : 0), n]);
}

/** Сечение «сглаженный суперэллипс + объёмы»: bump(a, y, px, pz, s, c) → смещение наружу (м). */
export function bodyRing(y, cx, cz, rx, rz, N, n, bump) {
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
    const m = n === 2 ? 1 : Math.pow(Math.pow(Math.abs(s), n) + Math.pow(Math.abs(c), n), -1 / n);
    const px = s * rx * m, pz = c * rz * m;
    const k = bump ? 1 + bump(a, y, px, pz, s, c) / (Math.hypot(px, pz) || 1e-4) : 1;
    pts.push([cx + px * k, y, cz + pz * k]);
  }
  return pts;
}

// ------------------------------------------------------------------------------------------ объёмы торса ----
/** Фабрика «мускулатуры/жира» торса под телосложение. Возвращает bump(a, y, px, pz, s, c) для центра x=0. */
export function torsoBump(B, age = 0.3) {
  const mus = B.mus, fat = B.fat, bust = B.bust, belly = B.belly * (0.6 + age * 0.8), gl = B.glute;
  return (a, y, px, pz, s, c) => {
    const ax = Math.abs(px), front = sstep(0.05, 0.75, c), back = sstep(-0.05, -0.75, c), side = sstep(0.35, 0.95, Math.abs(s));
    let d = 0;
    // грудь/грудные мышцы
    d += front * (0.015 * mus + 0.004) * gauss(ax, y, 0.075, 1.31, 0.055, 0.04);
    d += front * 0.04 * bust * gauss(ax, y, 0.083, 1.255, 0.06, 0.05);
    d -= front * 0.004 * gauss(ax, y, 0.0, 1.30, 0.012, 0.08);                                     // грудина
    // живот и подвздошные
    d += front * (0.004 + 0.045 * belly) * gauss(ax, y, 0.0, 1.06, 0.11, 0.09);
    d += side * (0.006 + 0.02 * fat) * gauss(ax, y, 0.15, 0.99, 0.05, 0.05);                       // «ручки»
    // спина: лопатки, широчайшие, ягодицы, поясница
    d += back * 0.009 * mus * gauss(ax, y, 0.085, 1.36, 0.05, 0.055);
    d += (back * 0.7 + side * 0.5) * 0.013 * mus * gauss(ax, y, 0.15, 1.30, 0.045, 0.075);
    d -= back * 0.005 * mus * gauss(ax, y, 0, 1.22, 0.014, 0.16);                                 // борозда позвоночника
    d += back * (0.03 * gl + 0.012 * fat) * gauss(ax, y, 0.085, 0.855, 0.06, 0.07);              // ягодицы
    d += back * 0.01 * gauss(ax, y, 0, 1.0, 0.07, 0.04);                                          // изгиб поясницы
    // трапеции и шея
    d += 0.016 * mus * gauss(ax, y, 0.08, 1.47, 0.07, 0.03) * (0.4 + 0.6 * back);
    d += 0.003 * gauss(ax, y, 0.04, 1.54, 0.03, 0.05) * side;                                       // грудино-ключично-сосцевидные
    d += front * 0.0045 * gauss(ax, y, 0.0, 1.55, 0.012, 0.015);                                   // кадык
    // ключицы
    d += front * 0.005 * gauss(ax, y, 0.1, 1.43, 0.06, 0.012);
    return d;
  };
}

// ------------------------------------------------------------------------------------------ ноги ----
export const LEG_ROWS = [ // y, rx, rz, cz
  [0.06, 0.032, 0.036, 0.004], [0.10, 0.033, 0.039, 0.002], [0.16, 0.036, 0.042, -0.001], [0.24, 0.043, 0.050, -0.006], [0.31, 0.050, 0.058, -0.010], [0.38, 0.055, 0.063, -0.010],
  [0.44, 0.052, 0.058, -0.002], [0.49, 0.052, 0.058, 0.006], [0.54, 0.057, 0.064, 0.008], [0.62, 0.069, 0.077, 0.008], [0.72, 0.082, 0.090, 0.004], [0.82, 0.090, 0.098, 0.0],
  [0.90, 0.092, 0.100, -0.002], [0.98, 0.088, 0.096, -0.002],
];
export function legBump(B, s) {
  const mus = B.mus, fat = B.fat, fem = B.bust > 0.3 ? 1 : 0;
  return (a, y, px, pz, sn, c) => {
    const front = sstep(0.1, 0.8, c), back = sstep(-0.1, -0.8, c), outer = sstep(0.1, 0.8, s * sn), inner = sstep(0.1, 0.8, -s * sn);
    let d = 0;
    d += front * (0.007 * mus + 0.002) * gauss(0, y, 0, 0.70, 1, 0.11);                            // квадрицепс
    d += outer * (0.007 * mus + 0.006 * fat + 0.006 * fem) * gauss(0, y, 0, 0.68, 1, 0.1);        // латеральная широкая + «галифе»
    d += inner * (0.005 * mus + 0.005 * fat) * gauss(0, y, 0, 0.72, 1, 0.1);                       // приводящие
    d += back * (0.006 * mus + 0.01 * fat) * gauss(0, y, 0, 0.74, 1, 0.1);                         // бицепс бедра
    d += front * 0.005 * gauss(0, y, 0, 0.505, 1, 0.025);                                           // коленная чашечка
    d -= (inner + outer) * 0.003 * gauss(0, y, 0, 0.485, 1, 0.03);
    d += back * (0.011 * mus + 0.004) * gauss(0, y, 0, 0.375, 1, 0.055) * (0.8 + 0.4 * inner);   // икроножная
    d -= front * 0.004 * gauss(0, y, 0, 0.27, 1, 0.09);                                             // голень (ребро)
    d += outer * 0.003 * gauss(0, y, 0, 0.1, 1, 0.025) + inner * 0.003 * gauss(0, y, 0, 0.09, 1, 0.025); // лодыжки
    return d;
  };
}

// ------------------------------------------------------------------------------------------ руки ----
export const ARM_ROWS = [ // y, rx, rz, cz
  [0.86, 0.025, 0.030, 0], [0.92, 0.028, 0.033, 0], [0.99, 0.034, 0.038, 0.002], [1.06, 0.039, 0.040, 0.002], [1.12, 0.035, 0.037, 0],
  [1.19, 0.039, 0.041, 0.002], [1.27, 0.044, 0.047, 0.004], [1.35, 0.048, 0.051, 0.002], [1.41, 0.052, 0.054, 0.0], [1.46, 0.046, 0.048, 0],
];
export function armBump(B, s) {
  const mus = B.mus, fat = B.fat;
  return (a, y, px, pz, sn, c) => {
    const front = sstep(0.1, 0.8, c), back = sstep(-0.1, -0.8, c), outer = sstep(0.1, 0.8, s * sn);
    let d = 0;
    d += (0.007 * mus + 0.003) * gauss(0, y, 0, 1.395, 1, 0.045);                                    // дельтовидная
    d += front * (0.008 * mus + 0.002) * gauss(0, y, 0, 1.25, 1, 0.055);                           // бицепс
    d += back * (0.006 * mus + 0.004 * fat) * gauss(0, y, 0, 1.28, 1, 0.055);                       // трицепс
    d += back * 0.005 * gauss(0, y, 0, 1.12, 1, 0.02);                                              // локоть
    d += (outer * 0.5 + front * 0.5) * (0.006 * mus + 0.002) * gauss(0, y, 0, 1.04, 1, 0.05);   // разгибатели/плечелучевая
    d -= 0.003 * gauss(0, y, 0, 0.9, 1, 0.025);                                                     // запястье
    return d;
  };
}

/** Поле поверхности торса: (a, y) → [x, z] точки тела; для зазоров одежды (грудь, живот, ягодицы не должны «прорезать» ткань). */
export function makeTorsoField(build, age = 0.3) {
  const B = BUILDS[build] || BUILDS.m, tt = torsoTable(build), tb = torsoBump(B, age);
  return (a, y) => {
    const yy = Math.max(0.74, Math.min(1.6, y));
    const rx = pchip(tt, yy, 1), rz = pchip(tt, yy, 2), cz = pchip(tt, yy, 3), n = pchip(tt, yy, 4), s = Math.sin(a), c = Math.cos(a);
    const m = Math.pow(Math.pow(Math.abs(s), n) + Math.pow(Math.abs(c), n), -1 / n), px = s * rx * m, pz = c * rz * m, k = 1 + tb(a, yy, px, pz, s, c) / (Math.hypot(px, pz) || 1e-4);
    return [px * k, cz + pz * k];
  };
}
