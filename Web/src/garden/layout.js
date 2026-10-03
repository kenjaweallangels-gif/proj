// Раскладка сада «Табр-ан-Нур»: котловина за Когтем. Координаты — мировые (м). Чистые функции, без THREE.
import { noise2, smoothstep, clamp, lerp } from '../core/util.js';
import { GARDEN } from '../core/layout.js';

export const C = GARDEN.center;                 // (840, 395)
export const FLOOR_Y = GARDEN.floorY;           // 4
export const R_FLOOR = 52;                      // средний радиус дна котловины (внутренний край гребней)
/** Линия восточной грани Когтя у котловины (по лучам в реальный меш): x(z) на высоте 6–30 м. */
export const FACE = (z) => 798.3 + 0.58 * (z - 390);
/**
 * Устье туннеля на восточной грани Когтя (стык с выходным туннелем сиетча).
 * Контракт с сиетчем: ось туннеля у устья — +X (мировая), на отрезке x ∈ [MOUTH.x − MOUTH.lining, MOUTH.x] сад рисует собственную облицовку
 * (арка w × h), пол — плоский y = MOUTH.y; туннель сиетча должен приходить сюда по оси z = MOUTH.z на высоте пола MOUTH.y
 * и с сечением не больше (w × h).
 */
export const MOUTH = { x: 801.2, z: 395.8, y: 5, w: 3.0, h: 3.1, lining: 6 };
export const PORTAL = GARDEN.portal;            // (790, 5, 392): выход из туннеля сиетча (внутри скалы)

/** Угол от центра (x → z), рад. */
export const ang = (x, z) => Math.atan2(z - C.z, x - C.x);
export const radius = (x, z) => Math.hypot(x - C.x, z - C.z);

/** Внутренний радиус гребня в направлении θ. */
export const ringIn = (th) => R_FLOOR + 3.2 * noise2(th * 2.6 + 1.3, 4.1) + 1.2 * noise2(th * 6.1, 9.7);
/** Высота гребня над дном в направлении θ, м. */
export const RAVINE_TH = 0.27;                  // направление выходного оврага (рад от +X к +Z, ≈15°)
const ringH0 = (th) => 16 + 7.5 * (0.5 + 0.5 * noise2(th * 2.0 + 3.3, 1.9)) + 3 * noise2(th * 5.3, 2.2);
export const ringH = (th) => {
  const u = Math.atan2(Math.sin(th - RAVINE_TH), Math.cos(th - RAVINE_TH)) / 0.3;
  return ringH0(th) * (1 - 0.66 * Math.exp(-u * u));   // седловина гребня: овраг-выход проходит через неё
};

/** Выходной овраг: ломаная по дну (x, z) от грядок через седловину гребня в пустыню; w — полуширина плоского дна. */
export const RAVINE = { pts: [[864, 403.5], [878, 406.5], [890, 410], [902, 412.5], [914, 416.5], [926, 419.5], [940, 421.5]], w: 2.4, fadeFrom: 36, fadeTo: 62 };
/** Расстояние до ломаной и длина вдоль неё: {d, s}. */
export function polyDist(pts, x, z) {
  let best = 1e9, bs = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9, l = Math.sqrt(l2);
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; bs = acc + t * l; }
    acc += l;
  }
  return { d: best, s: bs };
}
/** Протоптанные земляные тропы (визуально и для surfaceAt): ширина w (м). */
export const PATHS = [
  { id: 'main', w: 1.5, pts: [[803, 395.8], [812, 396.4], [822, 395.2], [832, 397.5], [842, 402.8], [852, 404], [864, 403.5], [878, 406.5], [890, 410], [902, 412.5]] },
  { id: 'north', w: 1.2, pts: [[812, 396], [818, 386], [824, 376], [828, 366], [826.5, 356]] },
  { id: 'south', w: 1.2, pts: [[832, 398], [829, 410], [830, 422], [836, 434], [846, 442]] },
  { id: 'beds', w: 1.0, pts: [[852, 404], [852.5, 395], [851, 386], [850, 372]] },
  { id: 'beds2', w: 1.0, pts: [[852, 404], [852.5, 412], [851, 421], [850, 428]] },
  { id: 'pond', w: 1.1, pts: [[864, 403.5], [872, 401.5], [880, 403]] },
];
export function pathAt(x, z) {
  let best = 0;
  for (const p of PATHS) { const d = polyDist(p.pts, x, z).d; const k = 1 - smoothstep(p.w * 0.45, p.w * 0.5 + 0.55, d); if (k > best) best = k; }
  return best;
}

/**
 * Высота «дна» котловины (чистая, без пустыни): террасы (три ступени по 0.4–0.45 м с пологими скатами ≈5°), плоский пол устья (y = MOUTH.y)
 * с пологим спуском к площади, подошва осыпи у гребней (до +1.2 м), пруд-котлован. Все уклоны ≤ 12°.
 */
export function floorHeight(x, z) {
  let y = FLOOR_Y - 0.45 * smoothstep(833, 841, x) - 0.45 * smoothstep(853, 861, x) - 0.4 * smoothstep(871, 879, x);
  y += 0.05 * noise2(x / 9, z / 9) + 0.02 * noise2(x / 3.1, z / 3.1);
  // подошва осыпи (круглая чаша), слабее у выходного оврага
  const r = radius(x, z), th = ang(x, z), rin = ringIn(th);
  const rav = Math.exp(-(((Math.atan2(Math.sin(th - RAVINE_TH), Math.cos(th - RAVINE_TH))) / 0.2) ** 2));
  y += 1.2 * (0.8 + 0.2 * noise2(x / 6, z / 6)) * smoothstep(rin - 9, rin + 0.5, r) * (1 - 0.8 * rav);
  // пруд: котлован
  const pu = Math.hypot((x - POND.x) / (POND.rx + 0.9), (z - POND.z) / (POND.rz + 0.9));
  y -= 0.42 * (1 - smoothstep(0.35, 1.0, pu));
  // пол устья: плоско y = MOUTH.y внутри проёма, затем пологий спуск (≈4.5°) до уровня площади
  const k = (1 - smoothstep(MOUTH.x + 1.5, MOUTH.x + 14, x)) * (1 - smoothstep(MOUTH.w * 0.5 + 0.8, MOUTH.w * 0.5 + 7, Math.abs(z - MOUTH.z)));
  return lerp(y, MOUTH.y, k);
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
export const PLAZA = { x: 810.5, z: 396.2, r: 6.2 };
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
