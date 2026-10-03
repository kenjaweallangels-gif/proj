// Аналитическое поле высот пустыни (детерминированное, без THREE). Единицы — метры.
// heightAt(x, z, spacing?) — spacing > 0 включает фильтрацию по частоте для дальних колец клипмапа.
import { noise2, smoothstep, clamp, lerp } from '../core/util.js';
import {
  WIND_DIR, A1_RIDGE, GOLDEN_PATH, SAFE_ISLANDS, A3_PLATES, ROCK, CORE_CENTER,
  clawCenter, clawHalfWidth, clawHeight,
} from '../core/layout.js';

const Wx = WIND_DIR[0], Wz = WIND_DIR[1];

// ---------- Скала: станции вдоль оси ----------
export const ROCK_NS = 64;
export const rockStations = [];
for (let i = 0; i <= ROCK_NS; i++) {
  const t = -1 + (2 * i) / ROCK_NS;
  const [cx, cz] = clawCenter(t);
  rockStations.push({ t, x: cx, z: cz, w: clawHalfWidth(t), H: clawHeight(t) });
}
/** Высота основания скалы (подножие осыпи), м — «земля поднимается к скале». */
const baseRise = (H) => 0.058 * H;

// Расщелина A4 и фальшивая дверь (мировые координаты, z центра = 326).
export const CLEFT = { x0: 606, x1: 651.5, z: 326, hw: 3.2 };
export const FINS = [
  { cx: 627, cz: 326 - (3.2 + 2.6), hx: 21, hz: 2.6, h: 34 },
  { cx: 627, cz: 326 + (3.2 + 2.6), hx: 21, hz: 2.6, h: 44 },
];
export const FALSE_DOOR = { x: 651.5, z: 326, w: 5.0, h: 7.5 };

const RQ = { d: 1e9, t: 0, i: 0 };
/** Знаковое расстояние до основания скалы (2D); RQ.t — параметр ближайшей точки оси. */
function rockQuery(x, z) {
  let best = 1e9, bt = 0;
  for (let i = 0; i < ROCK_NS; i++) {
    const a = rockStations[i], b = rockStations[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const apx = x - a.x, apz = z - a.z;
    const s = clamp((apx * abx + apz * abz) / (abx * abx + abz * abz), 0, 1);
    const dx = apx - abx * s, dz = apz - abz * s;
    const d = Math.hypot(dx, dz) - lerp(a.w, b.w, s);
    if (d < best) { best = d; bt = lerp(a.t, b.t, s); }
  }
  RQ.d = best; RQ.t = bt;
  return best;
}

const boxSdf = (x, z, cx, cz, hx, hz) => {
  const dx = Math.abs(x - cx) - hx, dz = Math.abs(z - cz) - hz;
  return Math.min(Math.max(dx, dz), 0) + Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
};

/** SDF твёрдого тела скалы: скала − расщелина + «плавники» у входа. <0 — внутри. */
export function solidSdf(x, z) {
  if (x < 560 || x > 860 || z < -80 || z > 640) return 1e9;
  let d = rockQuery(x, z);
  const cleft = boxSdf(x, z, (CLEFT.x0 + CLEFT.x1) / 2, CLEFT.z, (CLEFT.x1 - CLEFT.x0) / 2, CLEFT.hw);
  d = Math.max(d, -cleft);
  for (const f of FINS) d = Math.min(d, boxSdf(x, z, f.cx, f.cz, f.hx, f.hz));
  return d;
}

// ---------- Золотой путь ----------
const PATH = GOLDEN_PATH.map((p) => [p.x, p.z]);
function pathDist(x, z) {
  let best = 1e9;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1];
    const abx = bx - ax, abz = bz - az;
    const s = clamp(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz), 0, 1);
    const d = Math.hypot(x - ax - abx * s, z - az - abz * s);
    if (d < best) best = d;
  }
  return best;
}

// ---------- Гряда A1 ----------
const [[rx0, rz0], [rx1, rz1]] = A1_RIDGE;
const RLEN = Math.hypot(rx1 - rx0, rz1 - rz0);
const RDX = (rx1 - rx0) / RLEN, RDZ = (rz1 - rz0) / RLEN;
const RNX = -RDZ, RNZ = RDX; // нормаль: (-0.37, 0.93) — подветренная сторона (ЮЗ)
const RIDGE_H = 35;
function ridgeHeight(x, z) {
  const px = x - rx0, pz = z - rz0;
  const s = px * RDX + pz * RDZ;       // вдоль гряды, м
  const d = px * RNX + pz * RNZ;       // поперёк: >0 — подветренная (крутая) сторона
  if (s < -130 || s > RLEN + 150 || Math.abs(d) > 130) return 0;
  const sn = s / RLEN;
  // продольный профиль: поднимается к старту, плато, длинный спуск в эрг
  const along = smoothstep(-0.55, 0.12, sn) * (1 - smoothstep(0.62, 1.38, sn));
  const wob = 1 + 0.07 * noise2(s / 70, 3.1);
  const dd = d + 5 * noise2(s / 40, 1.7);
  const wd = dd > 0 ? 46 * (0.9 + 0.3 * along) : 95 * (0.8 + 0.35 * along);
  const q = clamp(Math.abs(dd) / wd, 0, 1);
  const prof = Math.pow(1 - q * q * (3 - 2 * q), 1.25) * (1 - 0.0 * q);
  return RIDGE_H * along * wob * prof + 0.5 * noise2(x / 55, z / 55) * along;
}

// ---------- Дюнные профили ----------
function duneProfile(f, crest) {
  if (f < crest) return Math.pow(f / crest, 1.45);
  const g = (f - crest) / (1 - crest);
  return Math.pow(1 - g, 1.5);
}
const fade = (wl, sp) => (sp <= 0 ? 1 : 1 - smoothstep(wl / 12, wl / 5, sp));

/** Крупные формы, видимые на горизонте (драа) — растут с удалением от ядра карты. */
function draa(x, z, sp) {
  const dx = x - CORE_CENTER[0], dz = z - CORE_CENTER[1];
  const far = smoothstep(750, 2400, Math.hypot(dx, dz));
  if (far <= 0) return 0;
  const u = x * Wx + z * Wz, v = -x * Wz + z * Wx;
  const p = u / 780 + 0.3 * noise2(v / 900, u / 2500) + 0.15 * noise2(v / 350, u / 900);
  const f = p - Math.floor(p);
  const a = 14 + 34 * smoothstep(-0.4, 0.6, noise2(u / 2400 + 5, v / 1400 - 3));
  return far * a * duneProfile(f, 0.84) * fade(780, sp);
}

/** Плоская площадка под большой харвестер (модуль Web/src/harvester): центр (x,z) м, плоская часть радиусом radius, затем плавный спуск на blend м. */
export const FLAT_ZONE = { x: 330, z: -60, radius: 70, blend: 80, level: 5.4 };

// Локальные переопределения рельефа (котловина сада, уступы тропы): {x,z,radius,height:(x,z,baseH)=>y|null}
export const groundPatches = [];
export function heightAt(x, z, spacing = 0) {
  let h = heightBase(x, z, spacing);
  for (let i = 0; i < groundPatches.length; i++) {
    const p = groundPatches[i];
    const d = Math.hypot(x - p.x, z - p.z);
    if (d >= p.radius) continue;
    const y = p.height(x, z, h);
    if (y == null) continue;
    const k = p.blend ? 1 - smoothstep(p.radius - p.blend, p.radius, d) : 1;
    h = h + (y - h) * k;
  }
  return h;
}
function heightBase(x, z, spacing = 0) {
  const h = heightRaw(x, z, spacing);
  const fd = Math.hypot(x - FLAT_ZONE.x, z - FLAT_ZONE.z);
  if (fd >= FLAT_ZONE.radius + FLAT_ZONE.blend) return h;
  const k = 1 - smoothstep(FLAT_ZONE.radius, FLAT_ZONE.radius + FLAT_ZONE.blend, fd);
  const flat = FLAT_ZONE.level + 0.12 * noise2(x / 23, z / 23);
  return lerp(h, flat, k);
}

function heightRaw(x, z, spacing = 0) {
  const u = x * Wx + z * Wz, v = -x * Wz + z * Wx;

  // влияние дорожки/островов/плит: подавляет дюны, чтобы идти было приятно
  const dp = pathDist(x, z);
  let calm = 0.15 + 0.85 * Math.pow(smoothstep(22, 150, dp), 1.2);

  let isleInfl = 0;
  for (const s of SAFE_ISLANDS) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < s.r * 3) isleInfl = Math.max(isleInfl, 1 - smoothstep(s.r * 0.9, s.r * 2.6, d));
  }
  if (x > 440 && x < 640 && z > 180 && z < 360) {
    const dpl = Math.hypot(x - 540, z - 270);
    isleInfl = Math.max(isleInfl, 0.8 * (1 - smoothstep(60, 150, dpl)));
  }
  calm *= 1 - isleInfl;
  const mouthK = 1 - smoothstep(20, 85, Math.hypot(x - 632, z - 326));   // ровная площадка у устья расщелины
  calm *= 1 - 0.92 * mouthK;

  // Основные поперечные дюны (бархано-подобные, ориентированы по ветру)
  let h = 0;
  const wl1 = 190;
  if (fade(wl1, spacing) > 0.001) {
    const p = u / wl1 + 0.22 * noise2(v / 310, u / 900) + 0.10 * noise2(v / 120, u / 330) + v / 1900;
    const f = p - Math.floor(p);
    const amp = (5 + 10 * smoothstep(-0.5, 0.6, noise2(u / 650 + 11, v / 420 + 5)))
      * (0.35 + 0.65 * smoothstep(-0.55, 0.1, noise2(v / 280 + 2, u / 520)));
    h += amp * duneProfile(f, 0.86) * calm * fade(wl1, spacing);
  }
  // Линейные (сейф) дюны вдоль ветра
  const wl2 = 260;
  if (fade(wl2, spacing) > 0.001) {
    const p2 = v / wl2 + 0.35 * noise2(u / 700 + 8, v / 500) + 0.12 * noise2(u / 200, v / 160);
    const s = Math.abs(Math.sin(Math.PI * p2));
    const amp2 = 4.5 * smoothstep(-0.2, 0.6, noise2(u / 900 - 4, v / 600 + 9));
    h += amp2 * (1 - Math.pow(1 - s, 2.2)) * calm * fade(wl2, spacing);
  }
  // Накладные малые дюны
  const wl3 = 56;
  if (fade(wl3, spacing) > 0.001) {
    const p3 = u / wl3 + 0.3 * noise2(v / 90, u / 160 + 4) + 0.1 * noise2(v / 30, u / 50);
    const f3 = p3 - Math.floor(p3);
    h += (1.1 + 1.6 * smoothstep(-0.3, 0.7, noise2(u / 240 + 2, v / 180))) * duneProfile(f3, 0.82) * calm * fade(wl3, spacing);
  }
  // Ветровые валы
  const wl4 = 15;
  if (fade(wl4, spacing) > 0.001) {
    const p4 = u / wl4 + 0.5 * noise2(v / 22, u / 40 + 1);
    const f4 = p4 - Math.floor(p4);
    h += 0.28 * duneProfile(f4, 0.8) * (0.4 + 0.6 * calm) * fade(wl4, spacing);
  }
  // Пологие волны рельефа
  h += (2.4 * noise2(x / 640 + 3, z / 640) * (0.5 + 0.5 * calm) + 0.9 * noise2(x / 130, z / 130 + 9) * (0.4 + 0.6 * calm) * fade(130, spacing)) * (1 - 0.85 * mouthK);

  h += draa(x, z, spacing);
  h += ridgeHeight(x, z);

  // Подъём к скале (осыпной фартук)
  if (x > 470 && x < 900 && z > -200 && z < 760) {
    const d = rockQuery(x, z);
    const bh = baseRise(clawHeightAt(RQ.t));
    if (d < 120) {
      const q = smoothstep(0, 110, d);
      const g = 0.85 + 0.15 * noise2(x / 22, z / 22);
      const rise = bh * Math.pow(1 - q, 1.7) * g + 2.5 * Math.pow(1 - q, 3) * noise2(x / 9, z / 9) * (1 - mouthK);
      h = lerp(h, 0, clamp(1 - q, 0, 1) * 0.55) + rise;
    }
  }

  // Каменные острова (купола)
  for (const s of SAFE_ISLANDS) {
    const dx = x - s.x, dz = z - s.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > (s.r * 1.6) * (s.r * 1.6)) continue;
    const re = s.r * (1 + 0.2 * noise2(x * 0.22, z * 0.22));
    const q = Math.sqrt(d2) / re;
    if (q < 1.15) h = lerp(h, 0.4 + s.r * 0.2 * Math.pow(Math.max(0, 1 - q * q), 0.55), 1 - smoothstep(0.9, 1.15, q));
  }
  // Плиты A3 (чуть приподняты)
  h += plateRaise(x, z);
  return h;
}

function clawHeightAt(t) { return clawHeight(clamp(t, -1, 1)); }
// ---------- Плиты ----------
function plateQuery(x, z) {
  // возвращает 0..1 маску плиты
  let m = 0;
  for (const p of A3_PLATES) {
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz > (p.w + p.d) * (p.w + p.d) * 1.6) continue;
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const lx = (dx * c + dz * s) / p.w, lz = (-dx * s + dz * c) / p.d;
    const e = Math.max(Math.abs(lx), Math.abs(lz)) + 0.1 * noise2(x * 0.25, z * 0.25);
    m = Math.max(m, 1 - smoothstep(0.92, 1.0, e));
  }
  return m;
}
function plateRaise(x, z) {
  if (x < 440 || x > 640 || z < 180 || z > 360) return 0;
  const m = plateQuery(x, z);
  return m > 0 ? 0.32 * m + 0.06 * noise2(x * 0.6, z * 0.6) * m : 0;
}

/** Маски материала: rock (острова, плиты, подножие скалы) и packed (плотный песок). 0..1 */
export function masks(x, z, out = { rock: 0, packed: 0 }) {
  let rock = 0;
  for (const s of SAFE_ISLANDS) {
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz > (s.r * 1.4) * (s.r * 1.4)) continue;
    const re = s.r * (1 + 0.2 * noise2(x * 0.22, z * 0.22));
    rock = Math.max(rock, 1 - smoothstep(0.85, 1.12, Math.sqrt(dx * dx + dz * dz) / re));
  }
  if (x > 440 && x < 640 && z > 180 && z < 360) rock = Math.max(rock, plateQuery(x, z));
  if (x > 520 && x < 900 && z > -140 && z < 700) {
    const d = rockQuery(x, z);
    rock = Math.max(rock, (1 - smoothstep(4, 55, d)) * (0.55 + 0.45 * noise2(x / 6, z / 6)));
  }
  // плотный песок: межгрядья и «пан»
  const dp = pathDist(x, z);
  const pan = 0.55 * (1 - smoothstep(10, 90, dp)) * smoothstep(-0.2, 0.5, noise2(x / 130 + 7, z / 130));
  const flats = smoothstep(0.1, 0.6, noise2(x / 210 - 5, z / 210 + 3)) * 0.6;
  out.rock = rock;
  out.packed = Math.max(pan, flats * (1 - rock)) * (1 - rock);
  const fd = Math.hypot(x - FLAT_ZONE.x, z - FLAT_ZONE.z);
  if (fd < FLAT_ZONE.radius + FLAT_ZONE.blend) out.packed = Math.max(out.packed, 0.7 * (1 - smoothstep(FLAT_ZONE.radius, FLAT_ZONE.radius + FLAT_ZONE.blend * 0.6, fd)));
  return out;
}

const _m = { rock: 0, packed: 0 };
export function surfaceAt(x, z) {
  masks(x, z, _m);
  if (_m.rock > 0.5) return 'rock';
  if (_m.packed > 0.55) return 'packed';
  return 'sand';
}

export function normalAt(x, z, out = [0, 1, 0]) {
  const e = 0.6;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx / (2 * e), nz = -hz / (2 * e);
  const il = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
  out[0] = nx * il; out[1] = il; out[2] = nz * il;
  return out;
}

export { rockQuery, boxSdf, plateQuery, pathDist, ridgeHeight, RQ, baseRise };
