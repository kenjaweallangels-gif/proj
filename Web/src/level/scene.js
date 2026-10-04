// Раскладка подъёма по Когтю: поле расстояний (SDF) осыпи, гребня-«полки», уступов, валунов, плавника-«щели», арки и ниши входа.
// Чистая функция: createApproachScene({ base, wallX }) → { volume, LEGS, BOULDERS, ... }. Без THREE (запуск в node для тестов).
// Устройство: «земля» (осыпь, натянутая на изгибы тропы, с врезкой и насыпью) — карта высот Hg на сетке 0.5 м (дёшево);
// всё нависающее/вертикальное (слот, плавник, зуб, арка, валуны, ниша, масса стены) — честные 3D-примитивы.
// Тропа (S3-trail): извилистая (боковое «блуждание» осей), ширина меняется (сужения 1.6 м, площадки до 4–5 м),
// продольный профиль — марши ступеней (шаг 0.26 м) между полого-наклонными участками и ровными площадками на поворотах.
import { Volume, noise3, fbm3, smin, smooth, mix, clamp, sdEllipsoid, sdBox } from './sdf.js';
import { rng } from '../core/util.js';
import { ENTRY } from '../core/layout.js';

export const ZONE = { x0: 580, x1: 664, z0: 230, z1: 318, y0: 1.5, y1: 57.5, h: 0.5 };
const CLEFT = ENTRY.cleft;
/** Масса стены начинается на WALL_IN м ВНУТРИ скалы (за её гранью): пол/ступени входят в камень без щели между полом и Когтем. */
export const WALL_IN = 0.3;

// Плавник параллелен стене; щель (слот) между ним и стеной: gap — ширина на уровне пола.
export const FIN = { z0: 240, z1: 266, T: 3.6, gap: 3.4, top: 52 };
export const NOTCH = { z: CLEFT.z, y: CLEFT.y, hw: 1.25, h: 3.9, depth: 8.5 };

export function createApproachScene({ base, wallX, quality = 'med', h = ZONE.h }) {
  const Z = { ...ZONE, h };
  const R = rng(4177);
  const wxs = (z) => 651.2 - 0.126 * (z - 225);                       // линейная аппроксимация стены
  const wx = (z, y) => wallX(clamp(z, Z.z0 + 1, Z.z1 - 1), clamp(y, 0, Z.y1 - 1));
  const wxFloor = (z) => wx(z, 29);

  // ---------- аналитические тела слота: плавник, зуб, пробка, «желваки» ----------
  const finD = (x, y, z) => {
    if (z < FIN.z0 - 4 || z > FIN.z1 + 4 || y > Z.y1 || x < 600) return 99;
    const w = wx(z, Math.min(y, 40));
    const lean = clamp((y - 30) * 0.045, 0, 1.25) + 0.35 * Math.sin(z * 0.37);
    const xi = w - FIN.gap + lean;
    const xo = xi - FIN.T + 0.5 * noise3(z * 0.2, y * 0.1, 3.3);
    const zc = (FIN.z0 + FIN.z1) / 2, hz = (FIN.z1 - FIN.z0) / 2;
    const top = FIN.top - 6 * (0.5 + 0.5 * noise3(z * 0.12, 4.4, 0)) - 4 * smooth(0, 1, (Math.abs(z - zc) - hz * 0.4) / (hz * 0.6));
    const ylo = 2;
    return sdBox(x - (xi + xo) / 2, y - (ylo + top) / 2, z - zc, (xi - xo) / 2, (top - ylo) / 2, hz, 0.9);
  };
  const toothZ = 262.3;
  const toothD = (x, y, z) => {
    if (z < toothZ - 3 || z > toothZ + 3 || x < 630) return 99;
    return sdEllipsoid(x - (wx(toothZ, 29) - 0.2), y - 30.9, z - toothZ, 1.35, 2.5, 1.6);
  };
  const plugD = (x, y, z) => {
    const zt = FIN.z0 + 2.2;
    if (z < zt - 3.5 || z > zt + 3.5 || x < 630) return 99;
    return sdEllipsoid(x - (wx(zt, 29) - FIN.gap * 0.5), y - 30.5, z - zt, 2.4, 3.2, 2.0);
  };
  // «желваки»: попеременно со стороны плавника и стены сужают коридор слота и заставляют путь вилять (S-изгиб)
  const LUMPS = [
    { z: 264.6, side: 'fin', rx: 1.5, ry: 2.9, rz: 1.9, dx: 0.35 },
    { z: 259.4, side: 'wall', rx: 1.6, ry: 2.7, rz: 1.7, dx: 0.1 },
    { z: 254.6, side: 'fin', rx: 1.4, ry: 2.6, rz: 1.8, dx: 0.3 },
  ];
  const lumpD = (x, y, z) => {
    if (z < 250 || z > 268 || x < 630) return 99;
    let d = 99;
    for (const q of LUMPS) {
      if (Math.abs(z - q.z) > q.rz + 2) continue;
      const w = wx(q.z, 28);
      const cx = q.side === 'fin' ? w - FIN.gap + q.dx + 0.35 * Math.sin(q.z * 0.37) : w - q.dx;
      const v = sdEllipsoid(x - cx, y - (27.4 + 0.05 * (q.z - 258)), z - q.z, q.rx, q.ry, q.rz);
      if (v < d) d = v;
    }
    return d;
  };
  const notchD = (x, y, z) => {
    if (Math.abs(z - NOTCH.z) > 3 || y < 28 || y > 37) return 99;
    const w = wx(NOTCH.z, 30);
    const dx = x - (w + NOTCH.depth * 0.5 - 1.6), dz = z - NOTCH.z;
    const hw = NOTCH.hw * (1 - 0.18 * smooth(0, 1, (y - CLEFT.y) / NOTCH.h));
    return sdBox(dx, y - (CLEFT.y + NOTCH.h * 0.5 - 0.1), dz, NOTCH.depth * 0.5 + 8, NOTCH.h * 0.5 + 0.1, hw, 0.35);
  };
  const wallD = (x, y, z) => {
    if (x < 620) return 99;
    const w = wx(z, y) + WALL_IN;
    const d = w - x;
    if (d > 8) return d;
    return Math.max(d, -notchD(x, y, z));
  };

  // ---------- маршрут: опорные точки звеньев ----------
  // ground:true — «земляное» звено (карта высот: врезка + насыпь); иначе 3D-тело (слот: вертикальные края).
  // w0 — полуширина; wob — амплитуда бокового блуждания оси; land — доли длины, где ровная площадка с видом; pinch — доли длины, где сужение.
  const LEGS = [
    { id: 'apron', ground: true, R: 22, w0: 1.2, flare: 0.8, batter: 0.9, wob: 1.8, seed: 1.7, land: [0.5], pinch: [0.78], pts: [[606, 300], [611, 303.5], [619, 305.8], [627, 304.2], [632.5, 302.5]] },
    { id: 'z1', ground: true, R: 21, w0: 1.15, flare: 0.75, batter: 0.9, wob: 1.9, seed: 3.1, land: [], pinch: [0.38], pts: [[632.5, 302.5], [636.5, 298.8], [630, 296.2], [620, 296.8], [611, 294.2], [603.5, 293.2]] },
    { id: 'z2', ground: true, R: 19, w0: 1.15, flare: 0.75, batter: 0.9, wob: 1.9, seed: 5.3, land: [0.55], pinch: [0.25], pts: [[603.5, 293.2], [600.6, 289], [607, 286.6], [617, 287.8], [627, 285], [637, 283]] },
    { id: 'z3', ground: true, R: 14, w0: 1.1, flare: 0.7, batter: 0.9, wob: 1.6, seed: 7.9, land: [0.42], pinch: [0.7], pts: [[637, 283], [639, 279], [632, 277.5], [621, 278.2], [612, 275.4], [607, 274]] },
    { id: 'shelf', ground: true, R: 9, w0: 1.05, flare: 0.62, batter: 0.85, wob: 1.9, seed: 9.4, rail: 99, land: [0.5], pinch: [0.28, 0.82], pts: [[607, 274], [605.8, 271.2], [611.5, 269.2], [618, 271.4], [624, 270.2], [629.5, 267.6], [635, 269.2], [639.2, 268.4]] },
  ];

  function densify(pts, ds = 0.5) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const n = Math.max(2, Math.ceil(len / ds));
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        const o = [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
        if (p1[2] !== undefined && p2[2] !== undefined) o.push(mix(p1[2], p2[2], t));
        out.push(o);
      }
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  }
  const arcLen = (line) => { let s = 0; for (let i = 1; i < line.length; i++) s += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]); return s; };

  // боковое «блуждание» оси (концы звена закреплены: стыки звеньев не рвутся)
  for (const L of LEGS) {
    L.line = densify(L.pts);
    const n = L.line.length, len = arcLen(L.line);
    const base0 = L.line.map((p) => p.slice());
    let s = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) s += Math.hypot(base0[i][0] - base0[i - 1][0], base0[i][1] - base0[i - 1][1]);
      const a = base0[Math.max(0, i - 1)], b = base0[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const f = smooth(0, 5, s) * smooth(0, 5, len - s);
      const off = L.wob * f * (1.15 * noise3(s * 0.11 + L.seed, 1.3, 0) + 0.55 * noise3(s * 0.31, 2.9, L.seed));
      L.line[i][0] = base0[i][0] - tz * off; L.line[i][1] = base0[i][1] + tx * off;
    }
    L.len = arcLen(L.line);
  }

  // ---------- продольный профиль: площадки, пологие участки, марши ступеней ----------
  const GLd = LEGS.filter((l) => l.ground);
  let S_TOT = 0;
  for (const L of GLd) { L.s0 = S_TOT; S_TOT += L.len; L.s1 = S_TOT; }
  const Y_START = base(LEGS[0].pts[0][0], LEGS[0].pts[0][1]) + 0.05, Y_SHELF = 24.4;
  const FLATS = [{ s: 0, half: 2.4 }, { s: S_TOT, half: 3.4 }];
  for (let i = 0; i < GLd.length - 1; i++) FLATS.push({ s: GLd[i].s1, half: 2.9 });
  for (const L of GLd) for (const f of L.land || []) FLATS.push({ s: L.s0 + f * L.len, half: 2.3 });
  const flatMask = (s) => { let m = 0; for (const f of FLATS) m = Math.max(m, 1 - smooth(f.half, f.half + 1.8, Math.abs(s - f.s))); return m; };
  const STEP_H = 0.26;
  {
    // плотность набора высоты по длине: площадки = 0, марши (шум выше порога) густо, остальное — полого
    const pts = [];
    for (const L of GLd) for (let i = 0; i < L.line.length; i++) {
      if (i > 0) { const d = Math.hypot(L.line[i][0] - L.line[i - 1][0], L.line[i][1] - L.line[i - 1][1]); pts.push({ L, i, s: pts.length ? pts[pts.length - 1].s + d : 0 }); }
      else pts.push({ L, i, s: pts.length ? pts[pts.length - 1].s : 0 });
    }
    let acc = 0;
    for (let k = 0; k < pts.length; k++) {
      const q = pts[k], fl = flatMask(q.s);
      q.dens = (1 - fl) * (0.28 + 1.5 * smooth(-0.1, 0.5, noise3(q.s * 0.085, 3.1, 0.5)));
      if (k > 0) acc += 0.5 * (q.dens + pts[k - 1].dens) * (q.s - pts[k - 1].s);
      q.cum = acc;
    }
    const rise = Y_SHELF - Y_START;
    for (const L of GLd) L.ys = new Float32Array(L.line.length);
    for (const q of pts) {
      const y = Y_START + rise * (q.cum / acc);
      const t = (y - Y_START) / STEP_H, fl = Math.floor(t);
      const stepped = Y_START + (fl + smooth(0.5, 1.0, t - fl)) * STEP_H;
      const slope = q.dens * rise / acc;                  // локальный уклон оси, м/м
      q.L.ys[q.i] = mix(y, stepped, smooth(0.07, 0.15, slope));   // ступени только на «маршах», пологие участки — гладкая тропа
    }
  }

  // ширина тропы по длине: естественные колебания, площадки-«балкончики» и сужения (проход между камнями)
  for (const L of GLd) {
    const n = L.line.length, wid = new Float32Array(n);
    let s = L.s0;
    for (let i = 0; i < n; i++) {
      if (i > 0) s += Math.hypot(L.line[i][0] - L.line[i - 1][0], L.line[i][1] - L.line[i - 1][1]);
      let w = L.w0 * (0.92 + 0.34 * noise3(s * 0.07, 7.7, L.seed));
      for (const f of FLATS) w += (f.s === 0 || f.s === S_TOT ? 0.6 : 1.15) * (1 - smooth(f.half - 0.5, f.half + 2.8, Math.abs(s - f.s)));
      for (const pf of L.pinch || []) { const sc = L.s0 + pf * L.len; w -= 0.5 * (1 - smooth(0.4, 3.2, Math.abs(s - sc))); }
      wid[i] = clamp(w, 0.8, 2.6);
    }
    L.wid = wid; L.w = L.w0;
  }
  const Y_SLOT0 = Y_SHELF + 0.2;

  // ---------- слот: ось по свободному коридору между плавником/желваками и стеной ----------
  const dfWalls = (x, y, z) => Math.min(finD(x, y, z), toothD(x, y, z), plugD(x, y, z), lumpD(x, y, z), wallD(x, y, z));
  const SLOT_Y = [[268.5, Y_SLOT0], [265.5, 25.5], [263.4, 25.8], [260.5, 27.0], [258.4, 27.6], [255.4, 27.9], [252.6, 29.3], [251, 30.0], [246, 30.1]];
  const slotYAt = (z) => { for (let i = 0; i < SLOT_Y.length - 1; i++) { const a = SLOT_Y[i], b = SLOT_Y[i + 1]; if (z <= a[0] && z >= b[0]) return mix(a[1], b[1], (a[0] - z) / (a[0] - b[0])); } return z > SLOT_Y[0][0] ? SLOT_Y[0][1] : SLOT_Y[SLOT_Y.length - 1][1]; };
  const slotCenter = [];
  for (let z = 268.5; z >= 246 - 1e-6; z -= 0.5) {
    const w = wxFloor(z), yy = slotYAt(z) + 1.0;
    let best = null, a0 = null;
    for (let x = w - 7; x <= w + 0.4; x += 0.05) {
      const free = dfWalls(x, yy, z) > 0.0;
      if (free && a0 === null) a0 = x;
      if ((!free || x + 0.05 > w + 0.4) && a0 !== null) { const b0 = free ? x : x - 0.05; if (!best || b0 - a0 > best[1] - best[0]) best = [a0, b0]; a0 = null; }
    }
    if (!best) best = [w - 2.5, w - 0.5];
    slotCenter.push({ z, y: slotYAt(z), cx: (best[0] + best[1]) / 2, free: best[1] - best[0] });
  }
  // сгладить ось (скользящее среднее 2.5 м), чтобы изгиб читался плавным
  const slotSm = slotCenter.map((q, i) => { let sx = 0, c = 0; for (let k = -2; k <= 2; k++) { const r = slotCenter[clamp(i + k, 0, slotCenter.length - 1)]; sx += r.cx; c++; } return { ...q, cx: sx / c }; });
  {
    const slotPts = [[wxs(270) - 6.2, 269.2], ...slotSm.filter((_, i) => i % 3 === 0 || i === slotSm.length - 1).map((q) => [q.cx, q.z, q.y])];
    LEGS.push({ id: 'slot', R: 3, w0: 1.0, w: 1.0, flare: 0.1, steps: { h: 0.22 }, rail: 5, pts: slotPts, slot: true, noWobble: true });
    const L = LEGS[LEGS.length - 1];
    L.line = densify(L.pts, 0.5);
    L.len = arcLen(L.line);
    const n = L.line.length, ys = new Float32Array(n), wid = new Float32Array(n);
    let last = Y_SLOT0;
    for (let i = 0; i < n; i++) {
      const z = L.line[i][1];
      ys[i] = Math.max(L.line[i].length > 2 ? L.line[i][2] : Y_SLOT0, last); last = ys[i];
      const q = slotSm[clamp(Math.round((268.5 - z) / 0.5), 0, slotSm.length - 1)];
      // тело пола шире свободного коридора: перекрывает плавник и стену, под ногами нет «щелей до земли»
      wid[i] = z > 268.4 ? 1.1 : q.free / 2 + 0.9;
    }
    L.ys = ys; L.wid = wid;
    L.free = slotSm.map((q) => q.free);
  }
  let ARCH_LEG = LEGS.find((l) => l.id === 'z3');

  // ---------- сетка xz: поля звеньев ----------
  const gx0 = Z.x0, gz0 = Z.z0, gnx = Math.round((Z.x1 - Z.x0) / h) + 1, gnz = Math.round((Z.z1 - Z.z0) / h) + 1;
  for (const L of LEGS) {
    L.Fd = new Float32Array(gnx * gnz).fill(99); L.Fy = new Float32Array(gnx * gnz); L.Fs = new Float32Array(gnx * gnz); L.Fw = new Float32Array(gnx * gnz).fill(L.w0);
    const line = L.line, n = line.length;
    const sAt = new Float32Array(n); for (let i = 1; i < n; i++) sAt[i] = sAt[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    const reach = L.ground ? Math.max(L.R, 30) + 2 : Math.max(L.R, 16.6) + 2;
    for (let i = 0; i < n - 1; i++) {
      const ax = line[i][0], az = line[i][1], bx = line[i + 1][0], bz = line[i + 1][1];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach - gx0) / h)), i1 = Math.min(gnx - 1, Math.ceil((Math.max(ax, bx) + reach - gx0) / h));
      const k0 = Math.max(0, Math.floor((Math.min(az, bz) - reach - gz0) / h)), k1 = Math.min(gnz - 1, Math.ceil((Math.max(az, bz) + reach - gz0) / h));
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
      for (let k = k0; k <= k1; k++) for (let ii = i0; ii <= i1; ii++) {
        const px = gx0 + ii * h, pz = gz0 + k * h;
        let t = ((px - ax) * dx + (pz - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(px - ax - dx * t, pz - az - dz * t);
        const o = ii + gnx * k;
        if (d < L.Fd[o]) { L.Fd[o] = d; L.Fy[o] = L.ys[i] + (L.ys[i + 1] - L.ys[i]) * t; L.Fs[o] = sAt[i] + (sAt[i + 1] - sAt[i]) * t; L.Fw[o] = L.wid[i] + (L.wid[i + 1] - L.wid[i]) * t; }
      }
    }
  }
  const gridAt = (F, x, z) => {
    const fx = (x - gx0) / h, fz = (z - gz0) / h;
    if (fx < 0 || fz < 0 || fx >= gnx - 1 || fz >= gnz - 1) return 99;
    const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k, o = i + gnx * k;
    return (F[o] * (1 - u) + F[o + 1] * u) * (1 - v) + (F[o + gnx] * (1 - u) + F[o + gnx + 1] * u) * v;
  };

  // ---------- карта высот «земли»: осыпь + врезка/насыпь тропы ----------
  const GL = LEGS.filter((l) => l.ground);
  const groundRaw = (x, z) => {
    const b = base(x, z);
    let sw = 0, sy = 0, fade = 0, dmin = 99;
    for (const L of GL) {
      const d = gridAt(L.Fd, x, z) - gridAt(L.Fw, x, z);
      if (d > L.R) continue;
      const dd = Math.max(d, 0);
      const wgt = 1 / Math.pow(dd + 0.55, 2.6);
      sw += wgt; sy += wgt * gridAt(L.Fy, x, z);
      const f = 1 - smooth(L.R * 0.35, L.R, dd);
      if (f > fade) fade = f;
      if (dd < dmin) dmin = dd;
    }
    if (sw === 0) return b;
    let G = sy / sw;
    if (dmin > 1.8) {                                  // уступы-полки вдали от самой тропы
      const q = (G - 4) / 2.2, fl = Math.floor(q);
      const st = 4 + (fl + smooth(0.55, 0.95, q - fl)) * 2.2;
      G = mix(G, st, 0.55 * smooth(1.8, 4.5, dmin));
    }
    G += (0.55 * noise3(x * 0.13, 2.2, z * 0.13) + 0.25 * noise3(x * 0.37, 5.1, z * 0.37)) * smooth(0.8, 3, dmin);
    return Math.max(b, mix(b, G, fade));
  };
  const Hg = new Float32Array(gnx * gnz);
  for (let k = 0; k < gnz; k++) for (let i = 0; i < gnx; i++) {
    const x = gx0 + i * h, z = gz0 + k * h, o = i + gnx * k;
    let H = groundRaw(x, z);
    let dBest = 99, yBest = 0;
    const edgeF = smooth(0, 7, Math.min(x - gx0, z - gz0, gz0 + (gnz - 1) * h - z));   // у края зоны насыпь сходит на нет (стык с нетронутой пустыней)
    for (const L of GL) {
      const Ld = L.Fd[o], Lw = L.Fw[o]; if (Ld > 32) continue;
      const yp = L.Fy[o], e = Math.max(0, Ld - Lw);
      if (Ld - Lw < dBest) { dBest = Ld - Lw; yBest = yp; }
      // неровность кромки: откос то круче, то площе (естественная осыпь, а не ровная насыпь)
      const wob = 0.85 + 0.35 * noise3(x * 0.21 + L.seed, 4.4, z * 0.21);
      H = Math.min(H, yp + L.batter * wob * e);        // врезка в склон
      // насыпь: вогнутый откос (круто у полотна, к подножию всё площе, как конус осыпи); доходит до земли плавно, без обрыва на границе
      const bz = base(x, z);
      if (yp > bz + 0.05) {
        const ell = Math.min(30, (yp - bz) * 1.9 * (0.62 / L.flare) ** 0.5) * wob, t = e / ell;
        if (t < 1) H = Math.max(H, bz + (yp - bz) * (1 - t) * (1 - t) * edgeF);
      }
    }
    // полотно: у самой оси высота строго = высота тропы (чужие насыпи/врезки соседних звеньев его не искажают), к краям — плавно в откос
    if (dBest < 1.0) H = mix(H, yBest, 1 - smooth(0, 1.0, dBest));
    Hg[o] = Math.max(H, base(x, z) - 0.12);
  }
  // маска «тропа» (для гашения шума) по всем звеньям
  const Tg = new Float32Array(gnx * gnz);
  for (let o = 0; o < Tg.length; o++) {
    let t = 0;
    for (const L of LEGS) { const d = L.Fd[o] - L.Fw[o]; if (d < 1.3) t = Math.max(t, 1 - smooth(0, 1.3, d)); }
    Tg[o] = t;
  }
  const lerpGrid = (F, x, z, out) => {
    const fx = (x - gx0) / h, fz = (z - gz0) / h;
    if (fx < 0 || fz < 0 || fx >= gnx - 1 || fz >= gnz - 1) return out;
    const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k, o = i + gnx * k;
    return (F[o] * (1 - u) + F[o + 1] * u) * (1 - v) + (F[o + gnx] * (1 - u) + F[o + gnx + 1] * u) * v;
  };
  const groundOf = (x, z) => lerpGrid(Hg, x, z, base(x, z));
  const treadAt = (x, z) => lerpGrid(Tg, x, z, 0);

  // ---------- валуны ----------
  const BOULDERS = [];
  const addBoulder = (x, y, z, rx, ry, rz, yaw, tag) => BOULDERS.push({ x, y, z, rx, ry, rz, yaw, cy: Math.cos(yaw), sy: Math.sin(yaw), R: Math.max(rx, ry, rz), tag, box: R() < 0.55 && tag !== 'rail' });
  const pathClear = (x, z) => { let d = 99; for (const L of LEGS) { const v = gridAt(L.Fd, x, z) - gridAt(L.Fw, x, z); if (v < d) d = v; } return d; };
  for (let tries = 0; tries < 1200 && BOULDERS.length < 150; tries++) {
    const x = Z.x0 + 6 + R() * (Z.x1 - Z.x0 - 24), z = Z.z0 + 8 + R() * (Z.z1 - Z.z0 - 20);
    if (x > wxs(z) - 1.5) continue;
    const big = R() < 0.1, mid = R() < 0.4;
    const r = big ? 2.6 + R() * 2.2 : mid ? 1.2 + R() * 1.1 : 0.55 + R() * 0.7;
    if (pathClear(x, z) < r * 0.9 + 1.0) continue;
    if (z < 273 && x > 616) continue;                  // зона плавника не засоряется
    const g = groundOf(x, z);
    addBoulder(x, g + r * 0.12, z, r * (0.9 + R() * 0.5), r * (0.55 + R() * 0.35), r * (0.8 + R() * 0.5), R() * 6.28, 'rand');
  }
  const key = [
    [638, 300, 2.8, 2.0, 2.3, 0.4], [612, 299, 2.2, 1.6, 2.4, 1.1], [598, 291, 3.0, 2.2, 3.2, 0.2], [641, 281, 2.4, 2.5, 2.2, 0.8], [603, 278, 3.2, 2.4, 2.8, 0.5],
    [600, 304, 3.4, 2.0, 2.6, 1.0], [628, 311, 3.0, 1.9, 2.4, 0.3],
  ];
  for (const [x, z, rx, ry, rz, yw] of key) if (pathClear(x, z) > Math.max(rx, rz) * 0.8) addBoulder(x, groundOf(x, z) + ry * 0.2, z, rx, ry, rz, yw, 'key');
  // сужения: пара крупных камней по бокам тропы («проход между глыбами»)
  for (const L of GLd) for (const pf of L.pinch || []) {
    const i = Math.round((L.line.length - 1) * pf);
    const a = L.line[Math.max(0, i - 1)], b = L.line[Math.min(L.line.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    for (const sg of [1, -1]) {
      const r = 0.9 + R() * 0.5, off = L.wid[i] + r * 1.2 + 0.1;       // внутренний край камня — по краю полотна (не вдаётся в него)
      const px = L.line[i][0] - dz * sg * off, pz = L.line[i][1] + dx * sg * off;
      if (px > wxs(pz) - 2) continue;
      let other = 99; for (const L2 of LEGS) if (L2 !== L) other = Math.min(other, gridAt(L2.Fd, px, pz) - gridAt(L2.Fw, px, pz));
      if (other < r + 1.0) continue;                   // не перегораживать соседнее звено (поворот-«шпилька»)
      if (R() < 0.8) addBoulder(px, L.ys[i] + r * 0.25, pz, r * 1.15, r * 0.95, r, R() * 6.28, 'pinch');
    }
  }
  // каймовые камни над обрывом (rail): защита от падения
  const RAIL = [];
  for (const L of LEGS) {
    if (!L.rail) continue;
    let acc = 0, sRun = 0;
    for (let i = 1; i < L.line.length; i++) {
      const sd = Math.hypot(L.line[i][0] - L.line[i - 1][0], L.line[i][1] - L.line[i - 1][1]);
      acc += sd; sRun += sd;
      if (sRun > L.rail) break;
      if (acc < 1.15 + 0.9 * R()) continue;
      acc = 0;
      const dx = L.line[i][0] - L.line[i - 1][0], dz = L.line[i][1] - L.line[i - 1][1], dl = Math.hypot(dx, dz) || 1;
      const nx = dz / dl, nz = -dx / dl, yp = L.ys[i];
      for (const sg of [1, -1]) {
        const rr = 0.5 + R() * 0.34, off = L.wid[i] + rr * 1.15 + 0.05;
        const sx = L.line[i][0] + nx * sg * off, sz = L.line[i][1] + nz * sg * off;
        if (sx > wxs(sz) - 1.0) continue;
        if (yp - groundOf(sx, sz) > 1.6 && R() < 0.82) RAIL.push({ x: sx, y: yp + 0.15, z: sz, r: rr });
      }
    }
  }
  for (const r of RAIL) addBoulder(r.x, r.y, r.z, r.r * 1.15, r.r * 0.95, r.r, R() * 6.28, 'rail');

  const BC = 5, bnx = Math.ceil((Z.x1 - Z.x0) / BC) + 1, bnz = Math.ceil((Z.z1 - Z.z0) / BC) + 1;
  const bgrid = Array.from({ length: bnx * bnz }, () => []);
  for (const b of BOULDERS) {
    const i0 = Math.floor((b.x - b.R - 1 - Z.x0) / BC), i1 = Math.floor((b.x + b.R + 1 - Z.x0) / BC);
    const k0 = Math.floor((b.z - b.R - 1 - Z.z0) / BC), k1 = Math.floor((b.z + b.R + 1 - Z.z0) / BC);
    for (let k = Math.max(0, k0); k <= Math.min(bnz - 1, k1); k++) for (let i = Math.max(0, i0); i <= Math.min(bnx - 1, i1); i++) bgrid[i + bnx * k].push(b);
  }
  const boulderD = (x, y, z) => {
    const ci = Math.floor((x - Z.x0) / BC), ck = Math.floor((z - Z.z0) / BC);
    if (ci < 0 || ck < 0 || ci >= bnx || ck >= bnz) return 99;
    const cell = bgrid[ci + bnx * ck];
    let d = 99;
    for (let q = 0; q < cell.length; q++) {
      const b = cell[q];
      const dx = x - b.x, dz = z - b.z;
      const lx = dx * b.cy + dz * b.sy, lz = -dx * b.sy + dz * b.cy;
      const v = b.box ? sdBox(lx, y - b.y, lz, b.rx * 0.88, b.ry * 0.9, b.rz * 0.88, Math.min(b.rx, b.ry, b.rz) * 0.42) : sdEllipsoid(lx, y - b.y, lz, b.rx, b.ry, b.rz);
      if (v < d) d = v;
    }
    return d;
  };

  // ---------- арка («ветровое окно») над тропой на звене z3 ----------
  const ARCH = (() => {
    const L = ARCH_LEG, i = Math.floor(L.line.length * 0.42);
    const p = L.line[i], q = L.line[i + 2] || L.line[i - 2];
    const tx = q[0] - p[0], tz = q[1] - p[1], tl = Math.hypot(tx, tz) || 1;
    return { x: p[0], z: p[1], y: L.ys[i], tx: tx / tl, tz: tz / tl };
  })();
  const archD = (x, y, z) => {
    const dx = x - ARCH.x, dz = z - ARCH.z;
    if (Math.abs(dx) > 10 || Math.abs(dz) > 10) return 99;
    const u = dx * ARCH.tx + dz * ARCH.tz, v = -dx * ARCH.tz + dz * ARCH.tx, yy = y - ARCH.y;
    if (Math.abs(u) > 4.5 || Math.abs(v) > 9 || yy > 12 || yy < -3) return 99;
    const slab = sdEllipsoid(u, yy - 2.6, v, 1.9, 7.2, 6.4);
    const hole = sdEllipsoid(u * 0.35, yy - 0.7, v, 1.6, 3.3, 2.35);
    return Math.max(slab, -hole * 1.4);
  };

  // 3D-тело слота (вертикальные борта, ступени)
  const SL = LEGS.filter((l) => !l.ground);
  const bodyD = (x, y, z) => {
    let body = 99;
    for (let q = 0; q < SL.length; q++) {
      const L = SL[q];
      const Ld = gridAt(L.Fd, x, z); if (Ld > 16) continue;
      const Lw = gridAt(L.Fw, x, z);
      let yp = gridAt(L.Fy, x, z);
      if (L.steps) {
        const k = (yp - L.ys[0]) / L.steps.h;
        yp = L.ys[0] + (Math.floor(k) + smooth(0.55, 1.0, k - Math.floor(k))) * L.steps.h;
      }
      const dy = y - yp;
      const b = Math.max(Ld - Lw - L.flare * Math.max(-dy, 0), dy);
      if (b < body) body = b;
    }
    return body;
  };

  function dfCheap(x, y, z) {
    let d = (y - groundOf(x, z)) * 0.8;
    const bd = boulderD(x, y, z); if (bd < d) d = smin(d, bd, 0.5);
    const ad = archD(x, y, z); if (ad < d) d = Math.min(d, ad);
    const sb = bodyD(x, y, z); if (sb < d) d = smin(d, sb, 0.35);
    if (x > 625) {
      const f = finD(x, y, z); if (f < d) d = smin(d, f, 0.9);
      const t = toothD(x, y, z); if (t < d) d = smin(d, t, 0.4);
      const p = plugD(x, y, z); if (p < d) d = smin(d, p, 0.5);
      const lp = lumpD(x, y, z); if (lp < d) d = smin(d, lp, 0.6);
      const w = wallD(x, y, z); d = smin(d, w, 0.8);
    }
    return d;
  }
  function dfFull(x, y, z) {
    const d = dfCheap(x, y, z);
    if (d > 3 || d < -3) return d;
    const tread = treadAt(x, z);
    const n = 0.55 * fbm3(x * 0.42, y * 0.52, z * 0.42, 3) + 0.22 * noise3(x * 1.6, y * 1.6, z * 1.6);
    // осадочные слои: полки и карнизы через ~1.7 м по высоте
    const sy = y * 0.6 + 0.9 * noise3(x * 0.05, y * 0.02, z * 0.05);
    const fr = sy - Math.floor(sy);
    const strata = smooth(0.78, 0.97, fr) - 0.55 * smooth(0.0, 0.25, fr);
    return d + n * 0.8 * (1 - 0.8 * tread) + strata * 0.34 * (1 - tread);
  }

  const volume = new Volume([Z.x0, Z.y0, Z.z0], [gnx, Math.round((Z.y1 - Z.y0) / h) + 1, gnz], h);
  return {
    ZONE: Z, LEGS, BOULDERS, RAIL, ARCH, FIN, NOTCH, LUMPS, FLATS, S_TOT, volume, dfCheap, dfFull, groundOf, wx, wxs, wallD, pathClear, gridAt, treadAt,
    slotFree: LEGS.find((l) => l.slot).free,
    pathDist: (x, z) => { let d = 99, yp = 0, leg = null, w = 0; for (const L of LEGS) { const lw = gridAt(L.Fw, x, z), v = gridAt(L.Fd, x, z) - lw; if (v < d) { d = v; leg = L; yp = gridAt(L.Fy, x, z); w = lw; } } return { d, yp, leg, w }; },
    build() { volume.fill(dfCheap, dfFull, 4, 1.8); volume.buildColumns(4); return volume; },
  };
}
