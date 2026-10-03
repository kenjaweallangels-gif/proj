// Раскладка сада «Табр-ан-Нур»: котловина за Когтем. Координаты — мировые (м). Чистые функции, без THREE.
import { noise2, smoothstep, clamp, lerp } from '../core/util.js';
import { GARDEN } from '../core/layout.js';

export const C = GARDEN.center;                 // (840, 395)
export const FLOOR_Y = GARDEN.floorY;           // 4
export const R_FLOOR = 52;                      // средний радиус дна котловины (внутренний край гребней)
/** Линия восточной грани Когтя у котловины (по лучам в реальный меш): x(z) на высоте 6–30 м. */
export const FACE = (z) => 798.3 + 0.58 * (z - 390);
export const MOUTH = { x: 799.5, z: 392, y: 5, w: 3.0, h: 4.3 };   // устье туннеля на восточной грани Когтя (портал сиетча)
export const PORTAL = GARDEN.portal;            // (790, 5, 392): выход из туннеля сиетча (внутри скалы)

/** Угол от центра (x → z), рад. */
export const ang = (x, z) => Math.atan2(z - C.z, x - C.x);
export const radius = (x, z) => Math.hypot(x - C.x, z - C.z);

/** Внутренний радиус гребня в направлении θ. */
export const ringIn = (th) => R_FLOOR + 3.2 * noise2(th * 2.6 + 1.3, 4.1) + 1.2 * noise2(th * 6.1, 9.7);
/** Высота гребня над дном в направлении θ, м. */
export const ringH = (th) => 16 + 7.5 * (0.5 + 0.5 * noise2(th * 2.0 + 3.3, 1.9)) + 3 * noise2(th * 5.3, 2.2);

/** Высота «дна» с террасами (ступени вниз к востоку, 0.45 м) и пологим пандусом от устья туннеля (вход выше дна на 1 м). */
export function floorHeight(x, z) {
  let y = FLOOR_Y - 0.45 * smoothstep(835, 840.5, x) - 0.45 * smoothstep(855, 860.5, x);
  y += 0.07 * noise2(x / 9, z / 9) + 0.03 * noise2(x / 3.1, z / 3.1);
  // пандус у устья: до x≈801 высота 5 (пол туннеля), затем вниз до дна
  const k = (1 - smoothstep(801, 808, x)) * (1 - smoothstep(5, 10, Math.abs(z - MOUTH.z)));
  return lerp(y, MOUTH.y + 0.02, k);
}

// Гидрология: канавы (каменные желоба), чаша-распределитель, пруд. Все в мировых координатах, ломаные по дну.
export const SPOUT = { x: 804.4, z: 399.4 };                       // носик перелива цистерны в стене рядом с устьем
export const BASIN = { x: 829, z: 399.5, w: 4.6, d: 4.2 };         // распределительная чаша
export const POND = { x: 884, z: 399.5, rx: 4.4, rz: 3.0 };        // замыкающий пруд
export const CHANNELS = [
  // из стены к чаше
  { id: 'main', pts: [[807.9, 399.4], [814, 399.5], [820, 399.5], [826.7, 399.5]], w: 0.55 },
  // от северных ветроловушек (qanat) к чаше
  { id: 'north', pts: [[824, 354], [826.5, 366], [827.5, 378], [828, 390], [828.4, 397.3]], w: 0.5 },
  // восточная ветка вдоль террас к пруду
  { id: 'east', pts: [[831.3, 399.5], [840, 399.5], [850, 399.5], [861, 399.5], [872, 399.5], [879.6, 399.5]], w: 0.5 },
  // южная ветка
  { id: 'south', pts: [[829, 401.6], [829.4, 408], [829.8, 416], [830.6, 426], [833, 433]], w: 0.45 },
];
// Ветроловушки (башни-конденсаторы) на северном гребне: позиции (центр основания), высота башни 9 м.
export function windtrapSites() {
  const out = [];
  for (const deg of [-128, -113, -98]) {
    const th = (deg * Math.PI) / 180;
    const r = ringIn(th) + 9.5;
    out.push({ x: C.x + Math.cos(th) * r, z: C.z + Math.sin(th) * r, th, ring: ringIn(th) });
  }
  return out;
}
/** Площадки на гребне (выравнивание): {x,z,r}. */
export function ridgePads() { return windtrapSites().map((s) => ({ x: s.x, z: s.z, r: 4.6 })); }
/** Выступ-полка для совы (на южном склоне): позиция вершины полки. */
export function owlLedge() {
  const th = (96 * Math.PI) / 180, r = ringIn(th) + 0.9;
  return { x: C.x + Math.cos(th) * r, z: C.z + Math.sin(th) * r, y: FLOOR_Y + 8.2, th };
}

/** Пятна расчистки: где нельзя ставить дикие растения (каналы, грядки, площадь). */
export const BEDS = (() => {
  const beds = [];
  for (const x of [843, 861]) for (const [z, sgn] of [[388, -1], [411, 1]]) beds.push({ x, z, hx: 7, hz: 4.6 });
  for (const z of [377, 421]) beds.push({ x: 850, z, hx: 7.5, hz: 3.4 });
  return beds;
})();
export const PLAZA = { x: 808.5, z: 394.5, r: 7.0 };
export function nearChannel(x, z, margin = 1.5) {
  for (const ch of CHANNELS) {
    for (let i = 0; i < ch.pts.length - 1; i++) {
      const [ax, az] = ch.pts[i], [bx, bz] = ch.pts[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < ch.w + margin) return true;
    }
  }
  return false;
}
export function inBed(x, z, m = 0) { for (const b of BEDS) if (Math.abs(x - b.x) < b.hx + m && Math.abs(z - b.z) < b.hz + m) return b; return null; }
