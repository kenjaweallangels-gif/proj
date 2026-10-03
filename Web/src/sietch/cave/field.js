// Поле расстояний (SDF) пещерного сиетча: гладкие объединения туннелей/камер, вырезы-полки, шум «следов инструмента»,
// пол как функция высоты F(x,z) (лестницы/чаша/ярусы/карниз). air(x,y,z) < 0 — воздух.
import { clamp, smoothstep, smin, smax, vn3, fbm3, makeTube, makeEll, makeCyl, makeBox, evalPrim, bbDist, unionPrims, sdEllipsoid } from './sdf.js';
import * as L from './layout.js';

const TAU = Math.PI * 2;
const { HALL, CISTERN, GALLERY, LEDGE } = L;

// ------------------------------------------------------------------- построение примитивов ----
function tubeLine(out, nodes, tag, k = 1.0) {
  for (let i = 0; i < nodes.length - 1; i++) {
    const [x0, z0, h0, rw0, rh0] = nodes[i], [x1, z1, h1, rw1, rh1] = nodes[i + 1];
    out.push(makeTube({ a: [x0, h0, z0], b: [x1, h1, z1], rw0, rw1, rh0, rh1, tag, k }));
  }
}
function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Стойка стен/потолка зала: радиус по эллипсу (с лёгким «дрожанием»). */
const wobble = (x, y, z) => 1 + 0.035 * vn3(x * 0.11, 3.1, z * 0.11) + 0.02 * vn3(x * 0.3, y * 0.2, z * 0.3);
const roofY = L.vaultRoof;
function hallD(x, y, z) {
  const dx = x - HALL.cx, dz = z, rx = HALL.hx, rz = HALL.hz;
  const w = wobble(x, y, z);
  const k0 = Math.hypot(dx / rx, dz / rz) / w;
  const k1 = Math.hypot(dx / (rx * rx), dz / (rz * rz)) / w;
  const dWall = k1 < 1e-6 ? -rz : (k0 * (k0 - 1)) / k1;
  const re = Math.min(k0, 1);
  const roof = roofY(re);
  const slope = (roofY(Math.min(1, re + 0.012)) - roofY(Math.max(0, re - 0.012))) / 0.024 / 21;
  const dRoof = (y - roof) / Math.sqrt(1 + Math.min(slope * slope, 40));
  return smax(dWall, dRoof, 1.6);
}

export function buildPrims() {
  const voids = [], solids = [];
  // --- B1
  tubeLine(voids, L.TUNNELS.B1, 'B1', 0.8);
  tubeLine(voids, L.TUNNELS.slit, 'slit', 0.4);
  // --- B2: нижний зал, карнизы, лестничные тоннели, ниши-лавки, спальные ниши, эркеры, колодцы, вентиляция
  voids.push(makeTube({ a: [46, 3.8, 0], b: [93, 3.8, 0], rw: 4.6, rh: 8.2, tag: 'B2', k: 1.3, pad: 2.5 }));
  for (const s of [-1, 1]) {
    voids.push(makeTube({ a: [51.5, 7.4, s * 6.3], b: [97, 7.4, s * 6.3], rw: 2.3, rh: 3.0, tag: 'shelf', k: 1.2 }));
    voids.push(makeTube({ a: [42, 1.35, s * 6.0], b: [51.5, 7.3, s * 6.0], rw: 1.85, rh: 2.4, tag: 'stairs', k: 0.8 }));
    voids.push(makeEll({ c: [41.2, 1.5, s * 5.2], r: [2.8, 2.0, 2.3], tag: 'stairFoot', k: 1.0 }));
  }
  const R = rnd(77);
  for (let i = 0; i < 15; i++) { // естественные эркеры нижних стен
    const x = 48 + i * 3.2 + R() * 1.5, s = i % 2 ? 1 : -1;
    voids.push(makeEll({ c: [x, 2.6 + R() * 4.5, s * (4.1 + R() * 0.5)], r: [1.5 + R() * 1.4, 1.5 + R() * 1.6, 1.4 + R() * 1.0], tag: 'bulge', k: 1.2 }));
  }
  for (const x of L.B2_ALCOVES.north) voids.push(makeEll({ c: [x, 1.3, -5.5], r: [2.1, 2.0, 2.3], tag: 'alcove', k: 0.7 }));
  for (const x of L.B2_ALCOVES.south) voids.push(makeEll({ c: [x, 1.3, 5.5], r: [2.1, 2.0, 2.3], tag: 'alcove', k: 0.7 }));
  for (const x of L.SHELF_BAYS) for (const s of [-1, 1]) voids.push(makeEll({ c: [x + (s > 0 ? 1 : 0), 7.4, s * 8.3], r: [1.7, 1.8, 1.9], tag: 'bay', k: 0.7 }));
  for (const w of L.WELLS) {
    if (w.slit) continue;
    voids.push(makeCyl({ cx: w.x, cz: w.z, r: w.r, y0: w.y0, y1: w.y1, tag: 'well', k: 0.9 }));
  }
  // вентиляционные ходы (ветрозаборники) — короткие тёмные отверстия в «столбах» между нишами и в потолках проходов
  for (const x of [58, 64, 70, 76.5, 83, 89, 95]) for (const s of [-1, 1]) voids.push(makeTube({ a: [x, 3.6, s * 4.1], b: [x, 4.4, s * 6.8], rw: 0.3, rh: 0.3, tag: 'vent', k: 0.1, pad: 0.6 }));
  for (const x of [16, 31, 108, 118, 126, 134, 142]) voids.push(makeCyl({ cx: x, cz: x < 50 ? 0 : (x % 2 ? 0.2 : -0.2), r: 0.24, y0: 2.4, y1: 5.2, tag: 'vent', k: 0.1, pad: 0.6 }));
  // --- B3
  tubeLine(voids, L.TUNNELS.C, 'C'); tubeLine(voids, L.TUNNELS.N, 'N'); tubeLine(voids, L.TUNNELS.S, 'S');
  for (const n of L.NICHES) voids.push(makeEll({ c: [n.xc, 1.0, n.side * 2.9], r: [n.rx, 1.7, 1.9], tag: 'niche', k: 0.6 }));
  voids.push(makeEll({ c: [L.FUNERAL.x + 1.4, 1.0, L.FUNERAL.z], r: L.FUNERAL.r, tag: 'funeral', k: 0.8 }));
  // --- B4
  voids.push(makeEll({ c: CISTERN.ellC, r: CISTERN.ellR, tag: 'B4', k: 1.5, pad: 3 }));
  const R4 = rnd(404);
  for (let i = 0; i < 7; i++) voids.push(makeEll({ c: [112 + i * 4.2 + R4() * 2, 3 + R4() * 3, i % 2 ? 9.5 + R4() * 1.5 : 26.5 - R4() * 1.5], r: [2 + R4() * 1.5, 1.8 + R4(), 1.8 + R4()], tag: 'cove', k: 1.0 }));
  // --- B5: зал, шахта, ниши
  voids.push({ type: 'fn', fn: hallD, bb: [146, -4, -21, 205, 36, 21], k: 1.2, tag: 'hall' });
  voids.push(makeCyl({ cx: HALL.cx, cz: HALL.cz, r: HALL.shaftR, y0: 22, y1: HALL.shaftTop, tag: 'shaft', k: 1.2 }));
  for (const a of L.HALL_ALCOVES) {
    const x = HALL.cx + Math.cos(a.th) * (HALL.hx + 0.6), z = Math.sin(a.th) * (HALL.hz + 0.6);
    voids.push(makeEll({ c: [x, a.y, z], r: [a.r * 0.9, 1.8, a.r], tag: 'hallAlcove', k: 0.9 }));
  }
  // карманы уплотнителей: вертикальные щели в стенах, куда сворачивается мембрана
  for (const sl of L.SEALS) for (const sg of [-1, 1]) {
    const o = sl.hw + 0.32;
    voids.push(makeCyl({ cx: sl.axis === 'x' ? sl.x : sl.x + sg * o, cz: sl.axis === 'x' ? sl.z + sg * o : sl.z, r: 0.26, y0: -0.5, y1: sl.yc + sl.rh - 0.15, tag: 'pocket', k: 0.15, pad: 0.8 }));
  }
  // --- твёрдые тела: мост, парапеты карниза, колонны цистерны, парапет помоста
  solids.push(makeBox({ c: [75.5, 5.5, 0], h: [1.55, 0.55, 5.6], rr: 0.25, tag: 'bridge' }));
  solids.push(makeEll({ c: [75.5, 4.3, 0], r: [1.6, 1.7, 4.2], tag: 'bridgeBelly' }));
  for (const s of [-1, 1]) {
    solids.push(makeBox({ c: [62.6, 6.45, s * 4.95], h: [10.9, 0.5, 0.21], rr: 0.1, tag: 'parapet' }));
    solids.push(makeBox({ c: [87.6, 6.45, s * 4.95], h: [9.8, 0.5, 0.21], rr: 0.1, tag: 'parapet' }));
  }
  for (const [px, pz] of CISTERN.pillars) solids.push(makeCyl({ cx: px, cz: pz, r: 0.62, y0: -4, y1: 14, tag: 'pillar', k: 0.5 }));
  solids.push(makeBox({ c: [LEDGE.x0 + 0.5, LEDGE.y + 0.5, 0], h: [0.25, 0.5, LEDGE.hz - 0.1], rr: 0.1, tag: 'ledgeFront' }));
  for (const s of [-1, 1]) solids.push(makeBox({ c: [LEDGE.x0 + 1.7, LEDGE.y + 0.5, s * (LEDGE.hz - 0.15)], h: [1.9, 0.5, 0.2], rr: 0.1, tag: 'ledgeSide' }));
  return { voids, solids };
}

// ------------------------------------------------------------------- пол ----
const NICHE_FOOT = L.NICHES.map((n) => ({ x: n.xc, z: n.side * 2.9, rx: n.rx, rz: 1.9 }));
const ALCOVES = [...L.B2_ALCOVES.north.map((x) => ({ x, z: -5.5 })), ...L.B2_ALCOVES.south.map((x) => ({ x, z: 5.5 }))];

export function hallFloor(x, z) {
  const r = Math.hypot(x - HALL.cx, z - HALL.cz);
  let y;
  if (r < HALL.bowlR) y = HALL.bowlY - 0.05 + 0.05 * (r / HALL.bowlR) ** 2 + 0.035 * vn3(x * 1.3, 0.2, z * 1.3) * (1 - r / HALL.bowlR);
  else {
    const s = (r - HALL.bowlR) / HALL.tierW, k = Math.floor(s), f = s - k;
    y = HALL.bowlY + HALL.tierH * (k + smoothstep(0, 0.22, f));
  }
  y = Math.min(0, y);
  // помост (балкон-уступ) наиба + боковые лестницы
  const ml = smoothstep(LEDGE.x0 - 0.4, LEDGE.x0 + 0.5, x) * (1 - smoothstep(LEDGE.hz - 0.6, LEDGE.hz + 0.2, Math.abs(z)));
  y = Math.max(y, LEDGE.y * ml - 9 * (1 - ml));
  const az = Math.abs(z);
  if (x > LEDGE.stairX0 - 0.5 && x < LEDGE.stairX1 + 0.6 && az > 4.0 && az < 9.6) {
    const mx = smoothstep(LEDGE.stairX0 - 0.4, LEDGE.stairX0 + 0.1, x) * (1 - smoothstep(LEDGE.stairX1 - 0.1, LEDGE.stairX1 + 0.4, x));
    y = Math.max(y, LEDGE.y * clamp((9.2 - az) / 4.6, 0, 1) * mx - 9 * (1 - mx));
  }
  return y;
}

export function floorY(x, z) {
  let f = 0;
  const az = Math.abs(z);
  if (x > 40 && x < 100.5) {
    const hx = clamp((x - GALLERY.stairX0) / (GALLERY.nSteps * GALLERY.tread), 0, 1) * GALLERY.balconyY;
    if (hx > 0 && az > 3.5) {
      let alc = 0;
      if (az > 3.5 && az < 8.4) for (const a of ALCOVES) { const dx = (x - a.x) / 2.1, dz = (z - a.z) / 2.3; const e = Math.hypot(dx, dz); if (e < 1) alc = Math.max(alc, 1 - smoothstep(0.72, 1.0, e)); }
      f = hx * smoothstep(4.0, 4.6, az) * (1 - alc);
    }
  }
  if (x > 100 && x < 148) {
    for (const n of NICHE_FOOT) { const dx = (x - n.x) / n.rx, dz = (z - n.z) / n.rz; const e = dx * dx + dz * dz; if (e < 1) f = Math.max(f, 0.22 * (1 - smoothstep(0.55, 1.0, Math.sqrt(e)))); }
    if (z > 5 && z < 32) {
      const nb = Math.pow(Math.pow(Math.abs(x - CISTERN.cx) / CISTERN.basinHX, 4) + Math.pow(Math.abs(z - CISTERN.cz) / CISTERN.basinHZ, 4), 0.25);
      f = Math.min(f, CISTERN.basinY * (1 - smoothstep(0.84, 1.0, nb)));
    }
  }
  if (x >= 148) f = hallFloor(x, z);
  // лёгкие неровности (стёртость, наносы)
  const sc = x > 146 && x < 200 && Math.hypot(x - HALL.cx, z) < 6.2 ? 0.2 : 1;
  f += (0.045 * vn3(x * 0.55, 0.6, z * 0.55) + 0.06 * vn3(x * 0.13, 1.3, z * 0.13)) * sc;
  return f;
}

// ------------------------------------------------------------------- детали (выпуклости) ----
function hallDetail(x, y, z) {
  if (x < 149 || x > 204 || z > 19.5 || z < -19.5) return 0;
  const re = Math.hypot((x - HALL.cx) / HALL.hx, z / HALL.hz);
  if (re > 1.03) return 0;
  const th = Math.atan2(z / HALL.hz, (x - HALL.cx) / HALL.hx);
  const dome = smoothstep(7.5, 13, y);
  const ring = Math.pow(0.5 + 0.5 * Math.cos(re * TAU * 9.5), 3) * 0.55 * smoothstep(0.08, 0.2, re);
  const rib = Math.pow(0.5 + 0.5 * Math.cos(th * 20), 7) * 0.95 * smoothstep(0.1, 0.4, re) * smoothstep(1.5, 7.5, y);
  let d = ring * dome + rib;
  // рельеф «Глотка» на восточной стене за помостом: концентрические кольца вокруг (z=0, y=6)
  if (x > 193) {
    const rr = Math.hypot(z, (y - 6.2) * 0.85);
    const wall = smoothstep(195, 198.5, x);
    d += wall * ((Math.pow(0.5 + 0.5 * Math.cos(rr * TAU / 0.95), 2) * 0.3 - 0.22) * (1 - smoothstep(2.4, 4.6, rr)));
  }
  return d;
}

const SEAL_MASKS = L.SEALS;
function noiseMask(x, y, z) {
  let m = 1;
  for (const s of SEAL_MASKS) {
    const d = s.axis === 'x' ? Math.abs(x - s.x) : (Math.abs(x - s.x) < 3.2 ? Math.abs(z - s.z) : 9);
    if (d < 3) m *= 1 - 0.96 * Math.exp(-((d / 1.3) ** 2));
  }
  return m;
}
function noiseScale(x, y, z) {
  const b2 = smoothstep(40, 46, x) * (1 - smoothstep(94, 100, x));
  const hall = smoothstep(146, 153, x);
  const cis = z > 7 ? smoothstep(108, 114, x) * (1 - smoothstep(136, 142, x)) * smoothstep(7, 10, z) : 0;
  return 1 + 0.55 * b2 + 0.9 * hall + 0.65 * cis;
}
export function rockNoise(x, y, z) {
  const n = 0.3 * vn3(x * 0.19, y * 0.23, z * 0.19) + 0.17 * vn3(x * 0.5 + 5, y * 0.55, z * 0.5) + 0.075 * vn3(x * 1.3 + 9, y * 1.5, z * 1.3 + 4) + 0.032 * vn3(x * 3.1 + 2, y * 3.3, z * 3.1);
  return n;
}

// -------------------------------------------------------------------- итоговое поле ----
export function createField() {
  const { voids, solids } = buildPrims();
  const field = {
    voids, solids,
    /** Расстояние до поверхности воздуха: <0 — внутри пещеры. */
    air(x, y, z) {
      let d = unionPrims(voids, x, y, z, 1.0);
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (bbDist(s.bb, x, y, z) > 1.6) continue;
        d = smax(d, -evalPrim(s, x, y, z), s.type === 'box' ? 0.18 : 0.5);
      }
      if (d < 4) d += ((rockNoise(x, y, z) * noiseScale(x, y, z)) * noiseMask(x, y, z) + hallDetail(x, y, z)) * (1 - smoothstep(2.4, 4, d));
      const f = floorY(x, z);
      let df = f - y;
      if (Math.abs(df) < 1.6) {
        const e = 0.18, gx = (floorY(x + e, z) - floorY(x - e, z)) / (2 * e), gz = (floorY(x, z + e) - floorY(x, z - e)) / (2 * e);
        df /= Math.sqrt(1 + gx * gx + gz * gz);
      }
      return smax(d, df, 0.45);
    },
    floorY,
    grad(x, y, z, e = 0.07, out = [0, 0, 0]) {
      out[0] = field.air(x + e, y, z) - field.air(x - e, y, z);
      out[1] = field.air(x, y + e, z) - field.air(x, y - e, z);
      out[2] = field.air(x, y, z + e) - field.air(x, y, z - e);
      const l = Math.hypot(out[0], out[1], out[2]) || 1;
      out[0] /= l; out[1] /= l; out[2] /= l;
      return out;
    },
  };
  return field;
}

/** Ходьба лучом по SDF до поверхности (из воздуха в камень). Возвращает t или -1. */
export function rayHit(field, o, d, maxT = 20) {
  let t = 0.02;
  for (let i = 0; i < 200 && t < maxT; i++) {
    const v = field.air(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t);
    if (v > -0.004) return t;
    t += Math.max(0.02, -v * 0.8);
  }
  return -1;
}
export { sdEllipsoid, fbm3 };
