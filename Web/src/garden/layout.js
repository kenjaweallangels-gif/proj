// Раскладка сада «Табр-ан-Нур»: ВЫСОКАЯ скрытая котловина в теле скалы. Координаты — мировые (м). Чистые функции, без THREE.
// Дно — на GARDEN.floorY (36 м, чуть выше зала сиетча 30 м), стены 45–110 м над дном со всех сторон (на западе — сама восточная грань «Когтя»),
// выхода в пустыню нет. Единственный вход — низкий лаз (MOUTH) из выходного туннеля сиетча.
import { noise2, smoothstep, clamp, lerp } from '../core/util.js';
import { GARDEN } from '../core/layout.js';

export const C = GARDEN.center;                 // (832, 398)
export const FLOOR_Y = GARDEN.floorY;           // 36
export const R_FLOOR = GARDEN.radius;           // средний радиус дна котловины (до подножия стен)
/** Линия восточной грани Когтя у котловины (по лучам в реальный меш): x(z) на высоте ≈ 36 м (грубо; точная — wall-таблица в index.js). */
export const FACE = (z) => 797.2 + 0.58 * (z - 395);
/**
 * Лаз на восточной грани Когтя (стык с выходным туннелем сиетча). Ось — +X (мир). На отрезке x ∈ [MOUTH.x − MOUTH.lining, MOUTH.x + 0.9]
 * сад рисует собственную облицовку (грубый овальный лаз w × h (≈ 2.0 × 2.25 м, без рамы и арки)), пол — плоский y = MOUTH.y. Туннель сиетча приходит сюда по оси z = MOUTH.z
 * на высоте пола MOUTH.y с таким же сечением (см. sietch/cave/layout.js: EXIT.sect).
 */
export const MOUTH = { x: GARDEN.portal.x, z: GARDEN.portal.z, y: GARDEN.portal.y, w: 2.0, h: 2.25, lining: 3 };
/** Стык со штольней сиетча: внутренний конец облицовки лаза. */
export const PORTAL = { x: MOUTH.x - MOUTH.lining, y: MOUTH.y, z: MOUTH.z };

/** Угол от центра (x → z), рад. */
export const ang = (x, z) => Math.atan2(z - C.z, x - C.x);
export const radius = (x, z) => Math.hypot(x - C.x, z - C.z);
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Периодический по углу шум (без шва на ±π). */
export const pn = (th, k, s = 0) => noise2(Math.cos(th) * k + s * 3.7, Math.sin(th) * k + s * 1.9 + 11.3);

/** Внутренний радиус стены (у подножия) в направлении θ; на западе котловина доходит до самой грани Когтя. */
export const ringIn = (th) => R_FLOOR + 3.4 * pn(th, 1.5, 1.3) + 1.4 * pn(th, 3.6, 9.7) + 11 * Math.exp(-((wrapA(th - Math.PI) / 0.62) ** 2));
/** Высота гребня стены над дном в направлении θ, м (46…112; на западе выше — там грань Когтя ≥ 160 м). */
export const ringH = (th) => clamp(80 + 38 * pn(th, 1.2, 3.3) + 7 * pn(th, 3.1, 2.2), 46, 112);

/** Номинальные высоты уступов-полок (м над подножием при H = 110; масштабируются на H(θ)/110): слои твёрдой породы. */
/** Наклон стены наружу (м на м высоты). */
export const WALL_LEAN = 0.055;
export const LEDGE_H = [5.5, 11, 18, 26, 36, 48, 62, 78, 94];
/** Глубина (вынос наружу) уступа k в направлении θ, м: 0.3…1.9. Над «уступом совы» (OWL.th) глубина не меньше 2.2 м. */
export const OWL = { th: (96 * Math.PI) / 180, k: 1 };
export const ledgeDepth = (th, k) => {
  let d = 0.35 + 1.5 * (0.5 + 0.5 * pn(th, 2.6, k * 5.1 + 0.7));
  if (k === OWL.k) d = Math.max(d, 2.4 * Math.exp(-((wrapA(th - OWL.th) / 0.1) ** 2)));
  return d;
};
/** Выступ-полка для совы: позиция на площадке уступа (в мире) и угол «наружу». */
export function owlLedge() {
  const th = OWL.th, rin = ringIn(th), H = ringH(th);
  const h = LEDGE_H[OWL.k] * H / 110;
  let acc = 0; for (let q = 0; q < OWL.k; q++) acc += ledgeDepth(th, q);
  const r = rin + 0.3 + WALL_LEAN * h + acc + ledgeDepth(th, OWL.k) * 0.55;
  const yb = floorHeight(C.x + Math.cos(th) * (rin + 0.3), C.z + Math.sin(th) * (rin + 0.3));   // подножие стены (с осыпью), как в rim.js
  return { x: C.x + Math.cos(th) * r, z: C.z + Math.sin(th) * r, y: yb + h + 0.14, th };
}

/**
 * Высота «дна» котловины (чистая функция, без пустыни и без Когтя): едва заметные холмики и западинки (±0.3 м), подошва осыпи у стен
 * (до +1.7 м, щебень и намёты песка), плоский пол лаза (y = MOUTH.y) со сглаженным выходом в котловину. Уклоны ≤ 12°.
 */
export function floorHeight(x, z) {
  let y = FLOOR_Y + 0.22 * noise2(x / 13, z / 13) + 0.12 * noise2(x / 4.7 + 3, z / 4.7) + 0.035 * noise2(x / 1.7, z / 1.7 + 8);
  // широкая пологая западина в центре (место, где скапливается сухой наносной грунт)
  const dc = Math.hypot(x - (C.x + 4), z - (C.z + 1));
  y -= 0.28 * (1 - smoothstep(4, 22, dc));
  // подошва осыпи: круглая чаша, растёт к стенам (за подножием продолжается — пол «уходит» под скалу)
  const r = radius(x, z), th = ang(x, z), rin = ringIn(th);
  y += 1.7 * (0.8 + 0.2 * noise2(x / 6, z / 6)) * smoothstep(rin - 10, rin + 0.5, r) * (1 + 0.5 * smoothstep(rin + 0.5, rin + 6, r));
  // пол лаза: ровно y = MOUTH.y внутри проёма и ещё несколько метров, дальше — плавно в рельеф
  const k = (1 - smoothstep(MOUTH.x + 2.5, MOUTH.x + 11, x)) * (1 - smoothstep(MOUTH.w * 0.5 + 1.0, MOUTH.w * 0.5 + 7, Math.abs(z - MOUTH.z)));
  return lerp(y, MOUTH.y, k);
}

/** Центры «укрытий»: крупные камни (валуны) задаются во flora.js, а здесь — только общая функция «насколько место закрыто от ветра/затенено стеной». */
export function shade(x, z) {
  const r = radius(x, z), th = ang(x, z), rin = ringIn(th);
  return smoothstep(rin - 16, rin - 1.5, r) * clamp(ringH(th) / 70, 0.5, 1.2);
}
/** Направление ветра в мировых координатах (куда дует), как в core/layout.js: WIND_YAW_DEG. */
export const WIND_DIR2 = [Math.cos((60 * Math.PI) / 180), Math.sin((60 * Math.PI) / 180)];
