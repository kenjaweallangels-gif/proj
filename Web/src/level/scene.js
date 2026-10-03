// Раскладка подъёма по Когтю: поле расстояний (SDF) осыпи, уступов, валунов, плавника-«щели», арки и ниши входа.
// Чистая функция: createApproachScene({ base, wallX }) → { volume, LEGS, BOULDERS, ... }. Без THREE (запуск в node для тестов).
// Устройство: «земля» (осыпь, натянутая на зигзаг тропы, с врезкой и насыпью) — карта высот Hg на сетке 0.5 м (дёшево);
// всё нависающее/вертикальное (полка над обрывом, слот, плавник, зуб, арка, валуны, ниша, масса стены) — честные 3D-примитивы.
import { Volume, noise3, fbm3, smin, smooth, mix, clamp, sdEllipsoid, sdBox } from './sdf.js';
import { rng } from '../core/util.js';
import { ENTRY } from '../core/layout.js';

export const ZONE = { x0: 580, x1: 664, z0: 230, z1: 318, y0: 1.5, y1: 57.5, h: 0.5 };
const CLEFT = ENTRY.cleft;

// Плавник параллелен стене; щель (слот) между ним и стеной: gap — ширина на уровне пола.
export const FIN = { z0: 240, z1: 270, T: 3.6, gap: 2.1, top: 52 };
export const NOTCH = { z: CLEFT.z, y: CLEFT.y, hw: 1.25, h: 3.9, depth: 8.5 };

export function createApproachScene({ base, wallX, quality = 'med', h = ZONE.h }) {
  const Z = { ...ZONE, h };
  const R = rng(4177);
  const wxs = (z) => 651.2 - 0.126 * (z - 225);                       // линейная аппроксимация стены
  const wx = (z, y) => wallX(clamp(z, Z.z0 + 1, Z.z1 - 1), clamp(y, 0, Z.y1 - 1));
  const wxFloor = (z) => wx(z, 29);

  // ---------- звенья тропы ----------
  // ground:true — «земляное» звено (карта высот: врезка + насыпь); иначе 3D-тело (полка/слот: вертикальные края).
  const LEGS = [
    { id: 'apron', ground: true, R: 24, w: 1.6, flare: 1.1, batter: 1.0, pts: [[606, 300], [612, 305], [622, 306], [632, 303]] },
    { id: 'z1', ground: true, R: 22, w: 1.45, flare: 1.0, batter: 0.9, pts: [[632, 303], [636, 299], [628, 297], [616, 296], [604, 293]] },
    { id: 'z2', ground: true, R: 20, w: 1.4, flare: 1.0, batter: 0.9, pts: [[604, 293], [601, 289], [610, 287], [622, 286], [636, 283]] },
    { id: 'z3', ground: true, R: 15, w: 1.3, flare: 0.8, batter: 0.9, pts: [[636, 283], [638, 279], [630, 278], [618, 277], [607, 274]] },
    { id: 'shelf', R: 4, w: 1.0, flare: 0.2, rail: 99, pts: [[607, 274], [606, 271], [614, 271], [626, 270], [636, 269.5]] },
  ];
  const slotPts = [];
  {
    const zs = [268.5, 266, 262, 257, 253, 251, 246];
    const ys = [24.6, 25.6, 26.6, 27.8, 29.0, 30.0, 30.1];
    slotPts.push([wxs(270) - 6.5, 269.5]);
    zs.forEach((z, i) => slotPts.push([wxFloor(z) - (FIN.gap * 0.5 + 0.1), z, ys[i]]));
  }
  LEGS.push({ id: 'slot', R: 3, w: 0.95, flare: 0.1, steps: { h: 0.3 }, rail: 7, pts: slotPts, slot: true });

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
  const Y_START = base(LEGS[0].pts[0][0], LEGS[0].pts[0][1]) + 0.05, Y_SHELF = 24.4;
  let S_TOT = 0;
  for (const L of LEGS) {
    L.line = densify(L.pts);
    L.len = 0; for (let i = 1; i < L.line.length; i++) L.len += Math.hypot(L.line[i][0] - L.line[i - 1][0], L.line[i][1] - L.line[i - 1][1]);
    if (!L.slot) S_TOT += L.len;
  }
  const GRADE = (Y_SHELF - Y_START) / S_TOT;
  let sAcc = 0;
  for (const L of LEGS) {
    const n = L.line.length, ys = new Float32Array(n);
    if (L.slot) {
      let last = Y_SHELF;
      for (let i = 0; i < n; i++) { ys[i] = Math.max(L.line[i].length > 2 ? L.line[i][2] : Y_SHELF, last); last = ys[i]; }
    } else {
      let s = 0;
      for (let i = 0; i < n; i++) {
        if (i > 0) s += Math.hypot(L.line[i][0] - L.line[i - 1][0], L.line[i][1] - L.line[i - 1][1]);
        ys[i] = Y_START + (sAcc + s) * GRADE;
      }
      sAcc += s;
    }
    L.ys = ys;
  }

  // ---------- сетка xz: поля звеньев ----------
  const gx0 = Z.x0, gz0 = Z.z0, gnx = Math.round((Z.x1 - Z.x0) / h) + 1, gnz = Math.round((Z.z1 - Z.z0) / h) + 1;
  for (const L of LEGS) {
    L.Fd = new Float32Array(gnx * gnz).fill(99); L.Fy = new Float32Array(gnx * gnz); L.Fs = new Float32Array(gnx * gnz);
    const line = L.line, n = line.length;
    const sAt = new Float32Array(n); for (let i = 1; i < n; i++) sAt[i] = sAt[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    const reach = Math.max(L.R, L.w + 14) + 2;
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
        if (d < L.Fd[o]) { L.Fd[o] = d; L.Fy[o] = L.ys[i] + (L.ys[i + 1] - L.ys[i]) * t; L.Fs[o] = sAt[i] + (sAt[i + 1] - sAt[i]) * t; }
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
      const d = gridAt(L.Fd, x, z) - L.w;
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
    for (const L of GL) {
      const Ld = L.Fd[o]; if (Ld > L.w + 12) continue;
      const yp = L.Fy[o], e = Math.max(0, Ld - L.w);
      H = Math.min(H, yp + L.batter * e);              // врезка в склон
      H = Math.max(H, yp - L.flare * e);               // насыпь
    }
    Hg[o] = Math.max(H, base(x, z) - 0.12);
  }
  // маска «тропа» (для гашения шума) по всем звеньям
  const Tg = new Float32Array(gnx * gnz);
  for (let o = 0; o < Tg.length; o++) {
    let t = 0;
    for (const L of LEGS) { const d = L.Fd[o] - L.w; if (d < 1.3) t = Math.max(t, 1 - smooth(0, 1.3, d)); }
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
  const pathClear = (x, z) => { let d = 99; for (const L of LEGS) { const v = gridAt(L.Fd, x, z) - L.w; if (v < d) d = v; } return d; };
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
  // каймовые камни над обрывом (rail): защита от падения
  const RAIL = [];
  for (const L of LEGS) {
    if (!L.rail) continue;
    let acc = 0, sRun = 0;
    for (let i = 1; i < L.line.length; i++) {
      const sd = Math.hypot(L.line[i][0] - L.line[i - 1][0], L.line[i][1] - L.line[i - 1][1]);
      acc += sd; sRun += sd;
      if (sRun > L.rail) break;
      if (acc < 1.15) continue;
      acc = 0;
      const dx = L.line[i][0] - L.line[i - 1][0], dz = L.line[i][1] - L.line[i - 1][1], dl = Math.hypot(dx, dz) || 1;
      const nx = dz / dl, nz = -dx / dl, yp = L.ys[i];
      for (const sg of [1, -1]) {
        const sx = L.line[i][0] + nx * sg * (L.w + 0.45), sz = L.line[i][1] + nz * sg * (L.w + 0.45);
        if (sx > wxs(sz) - 1.0) continue;
        if (yp - groundOf(sx, sz) > 1.6) RAIL.push({ x: sx, y: yp + 0.15, z: sz, r: 0.62 + R() * 0.22 });
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
    const L = LEGS[3], i = Math.floor(L.line.length * 0.42);
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
    const hole = sdEllipsoid(u * 0.35, yy - 0.2, v, 1.6, 2.7, 2.35);
    return Math.max(slab, -hole * 1.4);
  };

  // ---------- плавник, слот, зуб, пробка, ниша, стена ----------
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
  const notchD = (x, y, z) => {
    if (Math.abs(z - NOTCH.z) > 3 || y < 28 || y > 37) return 99;
    const w = wx(NOTCH.z, 30);
    const dx = x - (w + NOTCH.depth * 0.5 - 1.6), dz = z - NOTCH.z;
    const hw = NOTCH.hw * (1 - 0.18 * smooth(0, 1, (y - CLEFT.y) / NOTCH.h));
    return sdBox(dx, y - (CLEFT.y + NOTCH.h * 0.5 - 0.1), dz, NOTCH.depth * 0.5 + 8, NOTCH.h * 0.5 + 0.1, hw, 0.35);
  };
  const wallD = (x, y, z) => {
    if (x < 620) return 99;
    const w = wx(z, y) - 0.55;
    const d = w - x;
    if (d > 8) return d;
    return Math.max(d, -notchD(x, y, z));
  };

  // 3D-тела полки и слота (вертикальные борта)
  const SL = LEGS.filter((l) => !l.ground);
  const bodyD = (x, y, z) => {
    let body = 99;
    for (let q = 0; q < SL.length; q++) {
      const L = SL[q];
      const Ld = gridAt(L.Fd, x, z); if (Ld > L.w + 14) continue;
      let yp = gridAt(L.Fy, x, z);
      if (L.steps) {
        const k = (yp - L.ys[0]) / L.steps.h;
        yp = L.ys[0] + (Math.floor(k) + smooth(0.62, 1.0, k - Math.floor(k))) * L.steps.h;
      }
      const dy = y - yp;
      const b = Math.max(Ld - L.w - L.flare * Math.max(-dy, 0), dy);
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
    ZONE: Z, LEGS, BOULDERS, RAIL, ARCH, FIN, NOTCH, volume, dfCheap, dfFull, groundOf, wx, wxs, wallD, pathClear, gridAt,
    pathDist: (x, z) => { let d = 99, yp = 0, leg = null; for (const L of LEGS) { const v = gridAt(L.Fd, x, z) - L.w; if (v < d) { d = v; leg = L; yp = gridAt(L.Fy, x, z); } } return { d, yp, leg }; },
    build() { volume.fill(dfCheap, dfFull, 4, 1.8); volume.buildColumns(4); return volume; },
  };
}
