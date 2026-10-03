// Геометрия бинокулярного зрения и очков для модели зрения (без three.js — тестируется в node).
// Углы в градусах; для глаза «наружу» (к виску) — положительное x, вверх — положительное y.
//  • поле каждого глаза: ≈ 60° к носу, ≈ 100° к виску, ≈ 58° вверх (бровь), ≈ 72° вниз (щека) — периметрия
//    (Goldmann); перекрытие двух глаз ≈ 120°, всё поле ≈ 200°;
//  • зона слияния Panum: 6–10′ в центре и ≈ 6–7 % эксцентриситета на периферии — вне неё предметы ближе или
//    дальше точки фиксации двоятся (физиологическое двоение);
//  • острота: минимальный угол разрешения растёт линейно с эксцентриситетом, MAR = MAR0·(1 + e/E2), E2 ≈ 2,5°;
//  • апертура очков для каждого глаза — из размеров рамки и линз (glasses_model.DESIGN) и расстояния от глаза
//    до линзы: сквозь линзу — затемнённый вид и окно дисплея, вокруг рамки — открытая периферия.

export const FIELD = { temporal: 100, nasal: 60, up: 58, down: 72 };
export const IPD_MM = 64;

/** Поле одного глаза (эллипс по квадрантам): true, если направление (xt — к виску, y) видно этим глазом. */
export function inEyeField(xt, y, f = FIELD) {
  const ex = xt >= 0 ? xt / f.temporal : -xt / f.nasal;
  const ey = y >= 0 ? y / f.up : -y / f.down;
  return ex * ex + ey * ey <= 1;
}

/** Ширина бинокулярного поля (оба глаза) и всего поля по горизонтали на высоте y, градусы. */
export function horizontalExtent(y = 0, f = FIELD) {
  const k = y >= 0 ? y / f.up : -y / f.down;
  if (k >= 1) return { binocular: 0, total: 0 };
  const s = Math.sqrt(1 - k * k);
  // правый глаз: от −nasal·s (к носу = влево) до +temporal·s; левый — зеркально
  return { binocular: 2 * f.nasal * s, total: 2 * f.temporal * s };
}

/** Зона слияния Panum (полный размер, градусы) на эксцентриситете e. */
export function panumDeg(e) { return 0.12 + 0.065 * e; }

/** Бинокулярная диспаратность предмета на расстоянии d (м) при фиксации на dFix (м), градусы (+ — ближе фиксации). */
export function disparityDeg(d, dFix, ipdMM = IPD_MM) {
  return (ipdMM / 1000) * (1 / d - 1 / dFix) * (180 / Math.PI);
}

/** Минимальный угол разрешения, угл. мин, на эксцентриситете e (MAR0 = 1′ — острота 1,0). */
export function marArcmin(e, mar0 = 1, e2 = 2.5) { return mar0 * (1 + e / e2); }

/**
 * Апертура очков для одного глаза по размерам рамки (мм) и профилю устройства. Возвращает градусы:
 * линза к носу / к виску / вверх / вниз, ширина ободка, наружный край рамки у виска, полоса дужки.
 */
export function eyeAperture(design, device, ipdMM = IPD_MM) {
  const D = design;
  const atanD = (a, b) => (Math.atan2(a, b) * 180) / Math.PI;
  const vertex = D.optics === 'flat' ? 17 : 21;                  // от глаза до задней поверхности оптики, мм
  const wrapZ = (xmm) => (D.wrap || 0) * (xmm / 1000) ** 2 * 18 * 1000;   // отгиб рамки назад (как в модели очков)
  const bridge = 9, half = ipdMM / 2, outer = bridge + D.lw;
  const up = device.housing + 5;                                 // нижняя грань модуля над линзой (как в профиле)
  const topMM = vertex * Math.tan((up * Math.PI) / 180);
  return {
    vertex,
    nasal: atanD(half - bridge, vertex),
    temporal: atanD(outer - half, vertex - wrapZ(outer)),
    up,
    down: atanD(D.lh - topMM, vertex),
    rim: atanD(D.rim, vertex),
    frameT: atanD(D.W / 2 - half, vertex - wrapZ(D.W / 2)),
    templeY: -6,
    templeH: atanD(7, D.W / 2 - half + 6),
  };
}

/**
 * Грани куба для развёртки «полное поле»: вперёд, вправо, влево, вверх, вниз (назад не нужна — поле ≤ 200°).
 * F — направление грани, R — вправо по изображению, U — вверх (голова: x вправо, y вверх, z вперёд).
 */
export const CUBE_FACES = [
  { F: [0, 0, 1], R: [1, 0, 0], U: [0, 1, 0] },
  { F: [1, 0, 0], R: [0, 0, -1], U: [0, 1, 0] },
  { F: [-1, 0, 0], R: [0, 0, 1], U: [0, 1, 0] },
  { F: [0, 1, 0], R: [1, 0, 0], U: [0, 0, -1] },
  { F: [0, -1, 0], R: [1, 0, 0], U: [0, 0, 1] },
];

/** Направление (голова) → грань и координаты на ней (0..1). */
export function faceOf([x, y, z]) {
  const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
  let i;
  if (az >= ax && az >= ay) i = z > 0 ? 0 : -1;
  else if (ax >= ay) i = x > 0 ? 1 : 2;
  else i = y > 0 ? 3 : 4;
  if (i < 0) return null;
  const f = CUBE_FACES[i], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const d = [x, y, z], k = dot(d, f.F);
  return { face: i, u: (dot(d, f.R) / k) * 0.5 + 0.5, v: (dot(d, f.U) / k) * 0.5 + 0.5 };
}

/** Углы (азимут, возвышение), градусы → единичный вектор направления в СК головы. */
export function dirOf(az, el) {
  const r = Math.PI / 180, ce = Math.cos(el * r);
  return [ce * Math.sin(az * r), Math.sin(el * r), ce * Math.cos(az * r)];
}

/** Экран (смещение от центра, градусы) в равнопромежуточной проекции → азимут и возвышение. */
export function equidistantToAngles(tx, ty) {
  const r = Math.hypot(tx, ty);
  if (r < 1e-9) return { az: 0, el: 0 };
  const k = Math.PI / 180, s = Math.sin(r * k) / r;
  const d = [tx * s, ty * s, Math.cos(r * k)];
  return { az: (Math.atan2(d[0], d[2]) * 180) / Math.PI, el: (Math.atan2(d[1], Math.hypot(d[0], d[2])) * 180) / Math.PI };
}
