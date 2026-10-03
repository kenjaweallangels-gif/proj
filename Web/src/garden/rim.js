// Каменное кольцо котловины: гребни со всех сторон (на западе — сама восточная грань Когтя), SDF → surface nets.
// Гребни сидят на реальном рельефе; изнутри — отвесные слоистые стены, снаружи — пологие осыпи. Площадки под ветроловушки,
// полка для совы, валуны у подножия, проём устья туннеля в грани Когтя. Чистый JS (node-тестируемый).
import { Volume, noise3, fbm3, smin, smooth, mix, clamp, sdEllipsoid, sdBox } from '../level/sdf.js';
import { rng } from '../core/util.js';
import { C, FLOOR_Y, MOUTH, RAVINE, polyDist, ang, ringIn, ringH, ridgePads, owlLedge, radius } from './layout.js';

export const RIM_ZONE = { x0: 764, x1: 960, z0: 322, z1: 470, y0: -1.2, y1: 36, h: 0.8 };

export function createRim({ base, faceX, h = RIM_ZONE.h }) {
  const Z = { ...RIM_ZONE, h };
  const R = rng(777);
  const pads = ridgePads();
  const ledge = owlLedge();

  // относительная высота гребня над дном
  const rel = (r, th) => {
    const d = r - ringIn(th), H = ringH(th);
    if (d <= 0) return 0;
    if (d < 10) { const t = d / 10; return H * (1 - (1 - t) ** 3); }
    return H * (1 - smooth(0, 1, (d - 10) / (H * 2.9)));
  };
  const crestAt = (th) => FLOOR_Y + ringH(th);

  // валуны у подножия (3D)
  const BOUL = [];
  for (let i = 0; i < 90; i++) {
    const th = R() * Math.PI * 2, r = ringIn(th) + (R() - 0.35) * 5;
    const x = C.x + Math.cos(th) * r, z = C.z + Math.sin(th) * r;
    if (x < faceX(z, 8) + 2) continue;
    if (Math.hypot(x - 806, z - 394) < 12) continue;
    if (x > 850 && polyDist(RAVINE.pts, x, z).d < RAVINE.w + 3.5) continue;
    const s = 0.9 + Math.pow(R(), 2) * 2.6;
    BOUL.push({ x, y: base(x, z) + s * 0.1, z, rx: s * (0.9 + R() * 0.6), ry: s * (0.55 + R() * 0.35), rz: s * (0.8 + R() * 0.5), yaw: R() * 6.28 });
  }
  const BC = 6, bnx = Math.ceil((Z.x1 - Z.x0) / BC) + 1, bnz = Math.ceil((Z.z1 - Z.z0) / BC) + 1;
  const bgrid = Array.from({ length: bnx * bnz }, () => []);
  for (const b of BOUL) {
    b.cy = Math.cos(b.yaw); b.sy = Math.sin(b.yaw); const Rm = Math.max(b.rx, b.ry, b.rz) + 1;
    for (let k = Math.floor((b.z - Rm - Z.z0) / BC); k <= Math.floor((b.z + Rm - Z.z0) / BC); k++) for (let i = Math.floor((b.x - Rm - Z.x0) / BC); i <= Math.floor((b.x + Rm - Z.x0) / BC); i++) if (i >= 0 && k >= 0 && i < bnx && k < bnz) bgrid[i + bnx * k].push(b);
  }
  const boulderD = (x, y, z) => {
    const ci = Math.floor((x - Z.x0) / BC), ck = Math.floor((z - Z.z0) / BC);
    if (ci < 0 || ck < 0 || ci >= bnx || ck >= bnz) return 99;
    let d = 99;
    for (const b of bgrid[ci + bnx * ck]) {
      const dx = x - b.x, dz = z - b.z;
      const v = sdEllipsoid(dx * b.cy + dz * b.sy, y - b.y, -dx * b.sy + dz * b.cy, b.rx, b.ry, b.rz);
      if (v < d) d = v;
    }
    return d;
  };

  // высота поверхности гребня в точке (карта высот) с площадками
  const surf = (x, z) => {
    const r = radius(x, z), th = ang(x, z);
    let y = FLOOR_Y + rel(r, th);
    for (const p of pads) {
      const dd = Math.hypot(x - p.x, z - p.z);
      if (dd < p.r + 5) { const lvl = FLOOR_Y + ringH(p.th ?? ang(p.x, p.z)) - 0.8; y = mix(y, Math.max(lvl, 0), 1 - smooth(p.r, p.r + 5, dd)); }
    }
    return Math.max(y, base(x, z));
  };
  // полка совы: ellipsoid-карниз, прижатый к внутренней стене
  const ledgeD = (x, y, z) => {
    const dx = x - ledge.x, dz = z - ledge.z;
    if (Math.abs(dx) > 6 || Math.abs(dz) > 6) return 99;
    // направление «наружу» (к стене) — по радиусу
    const ux = Math.cos(ledge.th), uz = Math.sin(ledge.th);
    const a = dx * ux + dz * uz, b = -dx * uz + dz * ux;
    return sdEllipsoid(a + 0.3, y - (ledge.y - 0.55), b, 2.0, 0.55, 1.5);
  };
  // устье туннеля: полость вдоль +x от x0 до гребня грани, прямоугольное сечение со скруглением
  const mouthD = (x, y, z) => {
    const w = faceX(MOUTH.z, MOUTH.y + 2);
    const len = (w + 10 - Z.x0) / 2;
    return sdBox(x - (Z.x0 + len - 1), y - (MOUTH.y + MOUTH.h / 2 - 0.2), z - MOUTH.z, len, MOUTH.h / 2 + 0.4, MOUTH.w / 2 + 0.1, 0.5);
  };
  const wallD = (x, y, z) => {
    if (x > 860) return 99;
    const d = x - (faceX(z, y) + 0.55);
    if (d > 6) return d;
    return Math.max(d, -mouthD(x, y, z));
  };

  // выходной овраг: вырез над дном (борта слегка расходятся с высотой — V-образный каньон)
  const cutTmp = { d: 0, s: 0 };
  const ravineCut = (x, y, z) => {
    if (x < 850) return 99;
    const q = polyDist(RAVINE.pts, x, z);
    const g = base(x, z);
    const wy = RAVINE.w + 0.5 + 0.32 * Math.max(0, y - g) + 0.5 * noise3(x * 0.3, y * 0.2, z * 0.3);
    return Math.max(q.d - wy, g - y);
  };
  function dfCheap(x, y, z) {
    let d = (y - surf(x, z)) * 0.8;
    { const c = ravineCut(x, y, z); if (c < 3) d = Math.max(d, -c); }
    const b = boulderD(x, y, z); if (b < d) d = smin(d, b, 0.5);
    const l = ledgeD(x, y, z); if (l < d) d = smin(d, l, 0.4);
    const w = wallD(x, y, z); d = smin(d, w, 1.0);
    // нависающий карниз внутренней стены: 3D-смещение зависит от высоты
    return d;
  }
  function dfFull(x, y, z) {
    const d = dfCheap(x, y, z);
    if (d > 3.2 || d < -3.2) return d;
    const r = radius(x, z), th = ang(x, z);
    const dd = r - ringIn(th);
    const wallK = smooth(-2, 3, dd) * (1 - smooth(10, 22, dd));      // сильнее на внутренней стене
    const n = 0.7 * fbm3(x * 0.2, y * 0.25, z * 0.2, 3) + 0.3 * noise3(x * 0.9, y * 0.9, z * 0.9);
    const sy = y * 0.52 + 0.9 * noise3(x * 0.05, y * 0.02, z * 0.05);
    const fr = sy - Math.floor(sy);
    const strata = smooth(0.78, 0.97, fr) - 0.55 * smooth(0, 0.25, fr);
    // у самой земли шум гасим: пол должен быть ровным (его рисует и держит отдельная сетка), скала «вырастает» из него
    const gk = smooth(0.1, 2.8, y - base(x, z));
    return d + (n * (0.8 + 0.9 * wallK) + strata * 0.4 * wallK) * gk;
  }

  const nx = Math.round((Z.x1 - Z.x0) / h) + 1, nz = Math.round((Z.z1 - Z.z0) / h) + 1, ny = Math.round((Z.y1 - Z.y0) / h) + 1;
  const volume = new Volume([Z.x0, Z.y0, Z.z0], [nx, ny, nz], h);
  return {
    ZONE: Z, volume, BOUL, ledge, pads, surf, dfCheap, dfFull, crestAt,
    build() { volume.fill(dfCheap, dfFull, 4, 1.9); volume.buildColumns(3); return volume; },
  };
}
