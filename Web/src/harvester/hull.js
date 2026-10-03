// Процедурная геометрия харвестера «Сарт-Макр ХВ-017» (оригинальный дизайн). Локальные оси: +x — вперёд (ковш),
// +y — вверх (0 — подошва гусениц), +z — правый борт. Размеры: ~113 x 45 x 35 м.
import * as THREE from 'three';
import { Parts } from './parts.js';
import { TRK, UNITS, trackFrameParts } from './tracks.js';

export const C = {
  HULL: '#b9783f', HULL2: '#99623a', HULL3: '#a66a3c', SLATE: '#3a3f45', STEEL: '#85847f', DARKS: '#25272a',
  CREAM: '#cfbd9a', TEAL: '#2f726b', YEL: '#d6a31f', RUSTY: '#6d3c22', OLIVE: '#5c6152', BLACK: '#141413',
};

export const DIM = { length: 113, width: 45, height: 35.5 };
export const SCOOP_PIVOT = new THREE.Vector3(33, 13.5, 0);
export const AUGER_POS = new THREE.Vector3(50, 4.6, 0);
export const TOWERS = [[-14, 9], [-14, -9]];            // башни-центрифуги (x, z)
export const FANS = [[38.15, 21.2, -10.5], [38.15, 21.2, -15.5], [-52.6, 14.4, 0]];
export const STACKS = [                                 // трубы: [x, y_top, z]
  [-40, 35.0, -12], [-40, 35.4, -6], [-40, 35.4, 6], [-40, 35.0, 12],
  [25, 32.0, -13.5], [29.5, 32.0, -13.5],
];
export const KLAXON = [[28, 28.3, 8.2], [28, 28.3, 17.8], [32, 25.6, -17.5], [-47, 29.5, 0]];
export const BEACONS = [[-40, 37.1, -12], [-40, 37.5, 12], [36.2, 35.6, 12], [27, 33.5, 9.5], [-24, 31.2, 12], [-24, 31.2, -12]];
export const BELT = { a: [35.2, 17.9], b: [10.2, 29.4], halfW: 3.0 };       // нижний/верхний конец ленты в (x,y)
export const CONSOLE_POS = new THREE.Vector3(12.5, 0, 25.2);                 // пульт запуска у трапа (локально)
export const SPILL = new THREE.Vector3(-56, 7.5, 0);                         // сброс пряности (шлейф)
export const FLOODS = [[36.5, 25.6, 9.6], [36.5, 25.6, 16.4]];              // прожекторы кабины

function railing(P, posts, x0, z0, x1, z1, y, o = {}) {
  const h = o.h || 1.1, dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), ry = -Math.atan2(dz, dx);
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
  const col = o.color || C.YEL;
  P.box(mx, y + h, mz, L, 0.1, 0.1, col, 1, { ry, jit: 0.05 });
  P.box(mx, y + h * 0.55, mz, L, 0.07, 0.07, col, 1, { ry, jit: 0.05 });
  P.box(mx, y + 0.12, mz, L, 0.24, 0.05, '#4a4741', 3, { ry });
  const n = Math.max(1, Math.round(L / 1.9));
  for (let i = 0; i <= n; i++) posts.push({ x: x0 + dx * i / n, y, z: z0 + dz * i / n, h });
}

function ladder(P, x, z, y0, y1, face, o = {}) {
  // face: '+z'|'-z'|'+x'|'-x' (куда смотрит лестница)
  const w = o.w || 0.62, alongX = face === '+z' || face === '-z';
  const col = o.color || '#8d8a82';
  const rail = (s) => (alongX ? P.box(x + s * w / 2, (y0 + y1) / 2, z, 0.07, y1 - y0, 0.07, col, 1) : P.box(x, (y0 + y1) / 2, z + s * w / 2, 0.07, y1 - y0, 0.07, col, 1));
  rail(-1); rail(1);
  for (let y = y0 + 0.25; y < y1; y += 0.3) {
    if (alongX) P.box(x, y, z, w, 0.04, 0.04, col, 1); else P.box(x, y, z, 0.04, 0.04, w, col, 1);
  }
  // предохранительные дуги
  if (o.cage) {
    for (let y = y0 + 2.4; y < y1 - 0.5; y += 1.2) {
      const d = face[0] === '+' ? 1 : -1;
      if (alongX) P.torus(x, y, z + d * 0.42, 0.42, 0.025, Math.PI, col, 1, { rz: 0, ry: d > 0 ? 0 : Math.PI, rx: 0 });
      else P.torus(x + d * 0.42, y, z, 0.42, 0.025, Math.PI, col, 1, { ry: d > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
  }
}

function stairs(P, x0, y0, x1, y1, z, width, color = C.STEEL) {
  const n = Math.max(2, Math.round(Math.abs(y1 - y0) / 0.28));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    P.box(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z, Math.abs(x1 - x0) / n + 0.25, 0.07, width, color, 1);
  }
  const L = Math.hypot(x1 - x0, y1 - y0), a = Math.atan2(y1 - y0, x1 - x0);
  for (const s of [-1, 1]) P.box((x0 + x1) / 2, (y0 + y1) / 2 - 0.12, z + s * (width / 2 + 0.02), L, 0.28, 0.08, color, 1, { rz: a });
}

function grille(P, cx, cy, cz, w, h, face, n, color = C.BLACK) {
  P.box(cx, cy, cz, face[1] === 'z' ? w : 0.3, h, face[1] === 'z' ? 0.3 : w, '#26241f', 2);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n - 0.5;
    const off = face[0] === '+' ? 0.22 : -0.22;
    if (face[1] === 'z') P.box(cx, cy + t * h * 0.9, cz + off, w * 0.92, h * 0.5 / n, 0.1, color, 1, { rx: face[0] === '+' ? -0.35 : 0.35 });
    else P.box(cx + off, cy + t * h * 0.9, cz, 0.1, h * 0.5 / n, w * 0.92, color, 1, { rz: face[0] === '+' ? 0.35 : -0.35 });
  }
}

export function buildHarvester(quality) {
  const q = quality === 'low' ? 0.5 : quality === 'high' ? 1.25 : 1;
  const P = new Parts(777);    // основной корпус
  const G = new Parts(31);     // светящиеся
  const R = P.R;
  const posts = [];
  const bolts = [];
  const decals = [];
  const { HULL, HULL2, HULL3, SLATE, STEEL, DARKS, CREAM, TEAL, YEL, RUSTY, OLIVE, BLACK } = C;
  const glowWin = '#ffd58a', glowLamp = '#fff1c8', glowRed = '#ff3b1c', glowAmber = '#ff9a2a';

  // ======================================================== ШАССИ И ГУСЕНИЧНЫЕ РАМЫ
  P.box(-7, 8.6, 0, 92, 2.5, 30, SLATE, 1);
  P.box(-7, 7.6, 0, 88, 0.8, 22, DARKS, 2);
  for (let i = 0; i < 9; i++) P.box(-48 + i * 10.5, 8.6, 0, 1.0, 2.9, 31, SLATE, 1);       // поперечные балки
  trackFrameParts(P);
  // карданные валы/редукторы между тележками (видно в просвете x∈[-15,15])
  for (const s of [-1, 1]) {
    P.cyl(0, 6.2, s * 17, 1.0, 1.0, 29.5, DARKS, 2, { axis: 'x', seg: 10 });
    for (let i = -2; i <= 2; i++) P.cyl(i * 5.5, 6.2, s * 17, 1.35, 1.35, 0.5, STEEL, 1, { axis: 'x', seg: 10 });
  }
  P.cyl(0, 6.4, 0, 2.6, 2.6, 28, DARKS, 2, { axis: 'z', seg: 14 });                       // поперечная ось/дифференциал
  P.cyl(0, 6.4, 0, 3.2, 3.2, 3.0, STEEL, 1, { axis: 'z', seg: 16 });

  // ======================================================== НИЖНИЙ КОРПУС
  P.box(-7.5, 13.65, 0, 87, 7.7, 40, HULL, 0);
  // скошенный «лоб»
  P.prism([[36, 17.5], [36, 9.8], [41.6, 9.8]], 0, 40, HULL2, 0);
  P.box(38.3, 12.3, 0, 5.2, 0.5, 40.2, HULL3, 0, { rz: -0.0 });
  // кормовая стенка: обводы
  P.prism([[-51, 17.5], [-51, 9.8], [-55, 9.8]], 0, 40, HULL2, 0);
  // пояса жёсткости и акцентная полоса гильдии
  for (const s of [-1, 1]) {
    P.box(-7.5, 14.2, s * 20.17, 87.4, 0.42, 0.4, TEAL, 0);
    P.box(-7.5, 10.4, s * 20.12, 87.2, 1.4, 0.3, SLATE, 3);          // нижний бронепояс
    P.box(-7.5, 17.4, s * 20.12, 87.2, 0.3, 0.45, STEEL, 1);          // верхний фланец
    // пилястры
    for (let i = 0; i < 21; i++) {
      const x = -49.5 + i * 4.2;
      P.box(x, 13.65, s * 20.2, 0.7, 7.6, 0.5, HULL2, 0);
      P.box(x, 17.2, s * 20.35, 1.1, 0.3, 0.8, STEEL, 1);
      for (const yy of [10.6, 13.6, 16.4]) bolts.push({ x, y: yy, z: s * 20.5, ax: 'z', sgn: s });
    }
  }
  // люки обслуживания, решётки, лючки (чередуются по бортам)
  for (let i = 0; i < 20; i++) {
    const s = i % 2 ? 1 : -1, x = -47.3 + i * 4.2, kind = (i * 7) % 4;
    if (Math.abs(x - 12.5) < 3.5 && s > 0) continue;                  // место под трап
    if (kind === 0) {
      P.box(x, 13.0, s * 20.28, 2.6, 3.4, 0.14, DARKS, 3);
      P.box(x, 13.0, s * 20.38, 2.2, 3.0, 0.1, HULL3, 0);
      P.cyl(x + 0.8, 13.0, s * 20.5, 0.28, 0.28, 0.16, STEEL, 1, { axis: 'z', seg: 8 });
    } else if (kind === 1) {
      grille(P, x, 13.3, s * 20.25, 2.6, 4.0, s > 0 ? '+z' : '-z', 9);
    } else if (kind === 2) {
      P.box(x, 14.6, s * 20.3, 2.6, 1.6, 0.2, OLIVE, 3);                // латка
      P.box(x + 0.4, 12.2, s * 20.3, 1.7, 1.2, 0.2, '#6b6a5d', 3, { rz: 0.05 });
    } else {
      for (let k = 0; k < 3; k++) P.cyl(x - 0.8 + k * 0.8, 15.3, s * 20.55, 0.22, 0.22, 0.5, DARKS, 2, { axis: 'z', seg: 8 });
      P.box(x, 12.4, s * 20.3, 2.4, 0.6, 0.2, YEL, 4);
    }
  }
  // трубопроводы вдоль борта: фланцы, гидролинии
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
    const y = 11.3 + k * 0.55, x0 = -30 + k * 2, x1 = 6 - k * 3;
    P.cyl((x0 + x1) / 2, y, s * 20.75, 0.22, 0.22, x1 - x0, k === 1 ? '#7a2e1e' : '#3a3d40', 2, { axis: 'x', seg: 8 });
    for (let x = x0; x <= x1; x += 4) P.cyl(x, y, s * 20.75, 0.32, 0.32, 0.25, STEEL, 1, { axis: 'x', seg: 8 });
  }
  // вмятины и латаные листы: слегка повёрнутые накладки
  for (let i = 0; i < 46 * q; i++) {
    const s = R() < 0.5 ? -1 : 1, x = -49 + R() * 84, y = 10.5 + R() * 6.4, w = 1 + R() * 2.4, h = 0.8 + R() * 1.6;
    P.box(x, y, s * 20.26, w, h, 0.1, R() < 0.5 ? OLIVE : HULL3, R() < 0.3 ? 3 : 0, { rz: (R() - 0.5) * 0.12 });
  }
  // рёбра по лобовой и кормовой стенкам
  for (let i = 0; i < 9; i++) {
    const z = -18 + i * 4.5;
    P.box(37.8, 13.5, z, 0.8, 5.5, 0.9, HULL2, 0, { rz: -0.4 });
  }

  // ======================================================== ВЕРХНИЙ КОРПУС (технологическая палуба)
  P.box(-15, 20.75, 0, 58, 6.5, 33, '#c2ac84', 0);
  P.box(-15, 24.1, 0, 58.6, 0.35, 33.6, STEEL, 1);                    // карниз
  for (const s of [-1, 1]) {
    for (let i = 0; i < 18; i++) {
      const x = -42.5 + i * 3.3;
      P.box(x, 20.75, s * 16.7, 0.6, 6.3, 0.4, HULL3, 0);
    }
    for (let i = 0; i < 9; i++) {
      const x = -41 + i * 6.4;
      if (i % 3 === 0) grille(P, x, 21.3, s * 16.75, 3.4, 3.2, s > 0 ? '+z' : '-z', 8);
      else if (i % 3 === 1) { P.box(x, 21, s * 16.75, 3.0, 3.6, 0.2, DARKS, 3); P.box(x, 21, s * 16.9, 2.6, 3.2, 0.1, '#8b5a34', 0); }
      else { P.box(x, 21.3, s * 16.8, 2.8, 2.2, 0.2, OLIVE, 3, { rz: 0.03 }); for (let k = 0; k < 4; k++) P.cyl(x - 1 + k * 0.7, 19.6, s * 16.95, 0.2, 0.2, 0.4, DARKS, 2, { axis: 'z', seg: 8 }); }
    }
    P.box(-15, 19.0, s * 16.95, 57, 0.35, 0.3, TEAL, 0);
    P.box(-15, 22.8, s * 16.95, 57, 0.3, 0.3, STEEL, 1);
  }

  // кормовой технологический блок (переработка), второй ярус
  P.box(-34, 26.7, 0, 20, 5.2, 25, '#5f8079', 0);
  P.box(-34, 29.4, 0, 20.6, 0.35, 25.6, STEEL, 1);
  for (const s of [-1, 1]) for (let i = 0; i < 7; i++) {
    const x = -42 + i * 2.9;
    P.box(x, 26.7, s * 12.7, 0.5, 5.0, 0.35, '#46605a', 0);
    if (i % 2) grille(P, x + 1.45, 26.4, s * 12.7, 2.2, 3.0, s > 0 ? '+z' : '-z', 7);
  }
  // кормовые трубы с раструбами и бандажами
  for (const [sx, ty, sz] of STACKS.slice(0, 4)) {
    P.cyl(sx, (29.2 + ty) / 2, sz, 1.5, 1.7, ty - 29.2, '#4b4640', 3, { seg: 18 });
    P.cyl(sx, ty + 0.3, sz, 2.0, 1.55, 0.7, '#25221f', 2, { seg: 18 });
    P.cyl(sx, ty + 0.95, sz, 1.6, 1.6, 0.18, RUSTY, 3, { seg: 18 });
    for (let y = 30.2; y < ty - 0.5; y += 1.9) P.cyl(sx, y, sz, 1.82, 1.82, 0.22, STEEL, 1, { seg: 18 });
    P.cyl(sx, 29.5, sz, 2.4, 2.4, 0.5, SLATE, 1, { seg: 18 });
    // растяжки
    for (const a of [0.6, 2.2, 3.8, 5.4]) {
      const tx = sx + Math.cos(a) * 2.0, tz = sz + Math.sin(a) * 2.0, bx = sx + Math.cos(a) * 3.6, bz = sz + Math.sin(a) * 3.6;
      const L = Math.hypot(bx - tx, 4.2, bz - tz);
      P.box((tx + bx) / 2, (ty - 1.5 + 29.6) / 2, (tz + bz) / 2, 0.06, L, 0.06, '#26241f', 2, { rz: Math.cos(a) * 0.3, rx: -Math.sin(a) * 0.3 });
    }
  }
  // башни-центрифуги: неподвижное основание + (отдельно) вращающийся барабан
  for (const [tx, tz] of TOWERS) {
    P.cyl(tx, 25.4, tz, 6.4, 6.9, 2.8, HULL3, 0, { seg: 28 });
    P.cyl(tx, 26.9, tz, 6.6, 6.6, 0.35, STEEL, 1, { seg: 28 });
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; P.box(tx + Math.cos(a) * 6.55, 25.4, tz + Math.sin(a) * 6.55, 0.6, 2.6, 0.5, HULL2, 0, { ry: -a }); }
    P.cyl(tx, 32.6, tz, 2.2, 3.4, 2.2, SLATE, 1, { seg: 20 });             // верхняя вытяжная воронка
    P.cyl(tx, 34.0, tz, 2.4, 2.4, 0.6, '#2a2724', 2, { seg: 20 });
    P.cyl(tx, 31.45, tz, 5.9, 5.9, 0.28, STEEL, 1, { seg: 28 });
    // лестница-шахта на башне
    ladder(P, tx + 6.7, tz, 24.1, 31.4, '+x', { cage: false });
  }
  // трубопроводы между бункером и башнями
  P.cyl(-2, 28.4, 0, 0.9, 0.9, 28, '#4b4640', 3, { axis: 'x', seg: 12 });
  for (const tz of [-9, 9]) { P.cyl(-14, 28.4, tz / 2, 0.8, 0.8, Math.abs(tz) + 0.2, '#4b4640', 3, { axis: 'z', seg: 12 }); }
  for (let x = -14; x <= 10; x += 3.5) P.cyl(x, 28.4, 0, 1.12, 1.12, 0.3, STEEL, 1, { axis: 'x', seg: 12 });
  // бункер в конце конвейера
  P.box(8.2, 27.0, 0, 6.4, 5.2, 8.6, HULL, 0);
  P.prism([[4.8, 29.6], [11.8, 29.6], [10.5, 31.8], [6.1, 31.8]], 0, 8.6, HULL2, 0);
  P.box(11.4, 27.6, 0, 0.5, 3, 7.4, DARKS, 2);
  // охлаждающие рёбра на крыше верхнего корпуса
  for (let i = 0; i < 8; i++) P.box(-3 - i * 0.9, 25.0, 0, 0.18, 1.8, 14, '#6e625a', 1);
  // вентиляционные шахты и люки по крыше
  for (let i = 0; i < 12 * q; i++) {
    const x = -43 + R() * 55, z = (R() - 0.5) * 28;
    if (x < -23 && Math.abs(z) < 12.8) continue;
    if (Math.abs(x + 14) < 8 && Math.abs(Math.abs(z) - 9) < 8) continue;
    if (x > 6 && Math.abs(z) < 5) continue;
    if (R() < 0.5) { P.cyl(x, 24.7, z, 0.9, 1.1, 1.0, STEEL, 1, { seg: 10 }); P.cyl(x, 25.3, z, 1.2, 0.9, 0.25, DARKS, 2, { seg: 10 }); }
    else { P.box(x, 24.4, z, 2.4, 0.4, 2.4, HULL3, 3); P.box(x, 24.7, z, 1.6, 0.3, 1.6, DARKS, 2); }
  }
  // кормовой радиатор: рама (рёбра — инстансами снаружи)
  P.box(-52.6, 14.4, 0, 0.8, 7.4, 38.4, SLATE, 1);
  P.box(-53.4, 18.15, 0, 3.2, 0.6, 38.4, STEEL, 1);
  P.box(-53.4, 10.7, 0, 3.2, 0.6, 38.4, STEEL, 1);
  for (const z of [-19, -9.5, 0, 9.5, 19]) P.box(-53.4, 14.4, z, 3.2, 7.4, 0.5, STEEL, 1);
  // шлюз сброса пряности (выгрузной раструб) — выход шлейфа
  P.prism([[-51, 9.7], [-51, 5.6], [-58.5, 4.2], [-58.5, 7.2]], 0, 14, '#4a443d', 3);
  P.box(-58.7, 5.7, 0, 0.6, 3.0, 14.6, RUSTY, 3);
  P.box(-56, 8.2, 0, 8.4, 0.4, 14.6, HULL2, 0, { rz: -0.14 });
  for (const z of [-7.4, 7.4]) P.box(-55, 6, z, 7.6, 3.6, 0.35, STEEL, 1, { rz: 0.08 });
  for (let i = 0; i < 6; i++) P.box(-52.3 - i * 1.2, 4.4 + i * 0.05, 0, 0.1, 0.1, 13.2, '#2c2a26', 2);

  // ======================================================== ПОДАЮЩИЙ КОНВЕЙЕР (ферма + желоб)
  {
    const [ax, ay] = BELT.a, [bx, by] = BELT.b, hw = BELT.halfW;
    const L = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    // желоб
    P.box(mx, my - 0.3, 0, L + 1.6, 0.5, hw * 2 + 0.6, SLATE, 1, { rz: ang });
    for (const s of [-1, 1]) {
      P.box(mx, my + 0.5, s * (hw + 0.45), L + 1.6, 1.5, 0.35, HULL2, 0, { rz: ang });
      P.box(mx, my + 1.35, s * (hw + 0.45), L + 1.6, 0.2, 0.55, STEEL, 1, { rz: ang });
    }
    // лента (тёмная резина с рёбрами — рёбра-планки движутся отдельным инстансом)
    P.box(mx, my + 0.02, 0, L + 0.6, 0.18, hw * 2 - 0.1, '#1d1c1a', 2, { rz: ang });
    // опорная ферма: стойки с раскосами
    const nTr = 6;
    for (let i = 0; i <= nTr; i++) {
      const t = i / nTr, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      for (const s of [-1, 1]) {
        P.box(x, (17.5 + y - 0.7) / 2, s * (hw + 0.5), 0.45, y - 0.7 - 17.5, 0.45, STEEL, 1);
        if (i < nTr) {
          const x2 = ax + (bx - ax) * (i + 1) / nTr, y2 = ay + (by - ay) * (i + 1) / nTr;
          const hh = Math.max(y, y2) - 17.5 - 0.7;
          const dl = Math.hypot(x2 - x, hh);
          P.box((x + x2) / 2, 17.5 + hh / 2 - 0.4, s * (hw + 0.5), 0.2, dl, 0.2, '#6d6860', 1, { rz: Math.atan2(x2 - x, hh) * (i % 2 ? -1 : 1) * 0 + (i % 2 ? 0.5 : -0.5) });
        }
      }
      P.box(x, (17.5 + y) / 2 - 0.4, 0, 0.35, y - 17.5 - 0.7, 0.3, '#554f48', 1);
    }
    // арка-кожух над лентой в верхней трети
    for (const t of [0.52, 0.64, 0.76, 0.88]) {
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      P.box(x, y + 2.3, 0, 0.4, 0.4, hw * 2 + 1.2, STEEL, 1);
      for (const s of [-1, 1]) P.box(x, y + 1.3, s * (hw + 0.55), 0.35, 2.0, 0.35, STEEL, 1);
    }
    P.box(bx + 0.8, by - 0.3, 0, 2.2, 1.2, hw * 2 + 0.6, HULL, 0);
    // приёмная горловина у лобовой стенки
    P.box(ax + 1.2, ay - 1.5, 0, 3.6, 3.4, hw * 2 + 1.6, HULL2, 0);
    P.box(ax + 3.0, ay - 2.4, 0, 0.5, 3.0, hw * 2 + 1.4, DARKS, 2);
  }

  // ======================================================== МОСТИК (кабина) — правый борт, впереди
  {
    // основание-«палуба»
    P.box(29, 20.0, 12.75, 16, 5.0, 12.5, HULL2, 0);
    P.box(29, 22.6, 12.75, 17.0, 0.35, 13.3, STEEL, 1);
    // сам мостик
    P.prism([[24, 22.75], [35, 22.75], [38.6, 27.6], [24, 27.6]], 13, 11.2, CREAM, 0);
    // козырёк
    P.box(37.3, 27.9, 13, 3.8, 0.35, 12.4, HULL2, 0, { rz: 0.0 });
    P.box(31, 27.8, 13, 15.6, 0.4, 12, HULL, 0);
    // окна: лобовые (наклон), боковые
    const sl = Math.atan2(3.6, 4.85), len = Math.hypot(3.6, 4.85);
    for (let i = 0; i < 5; i++) {
      const z = 8.3 + i * 2.1 + 0.9;
      G.box(36.75 + 0.07, 25.2, z, 0.08, len - 0.9, 1.75, glowWin, 0, { rz: -sl, jit: 0.15 });
      P.box(36.75 + 0.1, 25.2, z - 1.05, 0.2, len - 0.4, 0.14, DARKS, 2, { rz: -sl });
    }
    P.box(36.85, 25.2, 18.85, 0.2, len - 0.4, 0.14, DARKS, 2, { rz: -sl });
    for (const s of [7.62, 18.38]) {
      for (let i = 0; i < 6; i++) {
        const x = 25.3 + i * 1.75;
        G.box(x + 0.7, 25.2, s + (s < 10 ? -0.02 : 0.02), 1.5, 2.2, 0.08, glowWin, 0, { jit: 0.2 });
        P.box(x + 1.6, 25.2, s, 0.2, 2.6, 0.18, DARKS, 2);
      }
      P.box(30.5, 26.55, s, 13, 0.14, 0.2, DARKS, 2);
      P.box(30.5, 23.85, s, 13, 0.14, 0.2, DARKS, 2);
    }
    // задняя стенка мостика, дверь с трапом
    P.box(23.9, 25.0, 12.9, 0.3, 4.4, 11.2, HULL2, 0);
    // нижняя палуба: иллюминаторы
    for (let i = 0; i < 5; i++) { G.cyl(24 + i * 3.1, 20.4, 18.98, 0.5, 0.5, 0.1, glowWin, 0, { axis: 'z', seg: 12, jit: 0.2 }); P.cyl(24 + i * 3.1, 20.4, 18.93, 0.66, 0.66, 0.14, DARKS, 2, { axis: 'z', seg: 12 }); }
    // крыша: оборудование, мачты
    P.cyl(28, 30.2, 10, 0.28, 0.35, 4.6, STEEL, 1, { seg: 8 });                // радар (вращается отдельно)
    P.box(30, 28.35, 13, 6, 0.4, 5, '#6d6860', 1);
    for (const [x, z, h] of [[24.8, 8.4, 6.8], [34.5, 17.8, 7.4], [26, 17.8, 5.6], [24.5, 13.5, 4.8]]) {
      P.cyl(x, 28 + h / 2, z, 0.06, 0.14, h, '#2c2a27', 2, { seg: 6 });
      P.box(x, 28 + h * 0.62, z, 2.1, 0.07, 0.07, '#2c2a27', 2);
      P.box(x, 28 + h * 0.8, z, 1.3, 0.07, 0.07, '#2c2a27', 2, { ry: 0.8 });
    }
    // прожекторы (корпуса); сами лампы — в glow
    for (const [fx, fy, fz] of FLOODS) {
      P.box(fx - 0.35, fy, fz, 0.9, 1.0, 1.4, DARKS, 2);
      G.box(fx + 0.2, fy, fz, 0.18, 0.75, 1.15, glowLamp, 0);
    }
    for (const fz of [8.4, 12.4, 17.4]) { P.box(36.8, 28.2, fz, 0.6, 0.5, 0.9, DARKS, 2); G.box(37.15, 28.2, fz, 0.1, 0.38, 0.7, glowLamp, 0); }
    // лестница на крышу мостика
    ladder(P, 23.7, 9.2, 22.8, 28.1, '-x', { cage: false });
    // перила крыши мостика
    railing(P, posts, 24.2, 7.7, 37.8, 7.7, 28.0, { h: 1.0 });
    railing(P, posts, 24.2, 18.2, 37.8, 18.2, 28.0, { h: 1.0 });
    railing(P, posts, 24.2, 7.7, 24.2, 18.2, 28.0, { h: 1.0 });
  }

  // ======================================================== МОТОРНАЯ РУБКА (левый борт, впереди)
  {
    P.box(29, 21.5, -13, 18, 8.0, 12, HULL, 0);
    P.box(29, 25.7, -13, 18.6, 0.4, 12.6, STEEL, 1);
    P.box(38.1, 21.2, -13, 0.5, 6.4, 11.6, DARKS, 2);                         // лицевая рама вентиляторов
    for (const [fx, fy, fz] of FANS.slice(0, 2)) {
      P.cyl(fx - 0.4, fy, fz, 3.0, 3.0, 0.5, STEEL, 1, { axis: 'x', seg: 26 });
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; P.box(fx + 0.5, fy + Math.sin(a) * 2.9, fz + Math.cos(a) * 2.9, 0.15, 0.25, 0.25, STEEL, 1); }
      P.cyl(fx + 0.9, fy, fz, 3.1, 3.1, 0.15, '#1f1e1c', 2, { axis: 'x', seg: 26, open: true });
      // защитная решётка
      for (let k = 0; k < 7; k++) P.box(fx + 1.15, fy + (k - 3) * 0.75, fz, 0.06, 0.07, 5.0 * Math.cos(Math.asin((k - 3) * 0.75 / 2.9)), '#2a2825', 1);
    }
    for (let i = 0; i < 6; i++) grille(P, 21 + i * 2.8, 21.5, -19.05, 2.2, 5.5, '-z', 8);
    P.box(29, 26.2, -13, 18, 0.5, 12, SLATE, 1);
    for (const sx of [25, 29.5]) {
      P.cyl(sx, 28.75, -13.5, 1.0, 1.15, 5.2, '#4b4640', 3, { seg: 14 });
      P.cyl(sx, 31.5, -13.5, 1.5, 1.1, 0.8, '#25221f', 2, { seg: 14 });
      P.cyl(sx, 32.0, -13.5, 1.2, 1.2, 0.2, RUSTY, 3, { seg: 14 });
    }
    railing(P, posts, 20, -19.2, 38, -19.2, 17.5, { h: 1.0 });
    // трап вдоль борта корпуса впереди
    stairs(P, 20, 17.5, 14, 24.15, -17.5, 1.1);
  }

  // ======================================================== ЛОБОВАЯ ПАЛУБА, ЛЕСТНИЦЫ, ПЕРИЛА
  railing(P, posts, 37.4, -19.4, 37.4, -7.2, 17.5);
  railing(P, posts, 37.4, 6.2, 37.4, 19.4, 17.5);
  railing(P, posts, 14.2, -19.4, 14.2, -19.4, 17.5);
  for (const s of [-1, 1]) {
    railing(P, posts, -50.4, s * 19.4, 14, s * 19.4, 17.5);
    railing(P, posts, -43.5, s * 16.2, 14, s * 16.2, 24.1, { h: 1.0 });
  }
  railing(P, posts, -50.4, -19.4, -50.4, 19.4, 17.5);
  railing(P, posts, -43.5, -16.2, -43.5, 16.2, 24.1, { h: 1.0 });
  railing(P, posts, 14, -16.2, 14, -2.5, 24.1, { h: 1.0 });
  railing(P, posts, 14, 2.5, 14, 16.2, 24.1, { h: 1.0 });
  // верхний ярус кормового блока
  railing(P, posts, -44, -12.5, -24, -12.5, 29.4, { h: 1.0 });
  railing(P, posts, -44, 12.5, -24, 12.5, 29.4, { h: 1.0 });
  railing(P, posts, -44, -12.5, -44, 12.5, 29.4, { h: 1.0 });
  railing(P, posts, -24, -12.5, -24, -4, 29.4, { h: 1.0 });
  railing(P, posts, -24, 4, -24, 12.5, 29.4, { h: 1.0 });
  // лестницы: основной трап к пульту, на палубу, на башню, на борт
  stairs(P, 4, 17.6, -8, 24.1, 15.4, 1.2);
  stairs(P, -24, 24.1, -30, 29.4, -10.5, 1.1);
  // боковая лестница с земли до палубы — у пульта запуска
  {
    const lx = CONSOLE_POS.x, lz = 20.65;
    ladder(P, lx, lz, 0.3, 17.5, '+z', { cage: true, w: 0.7 });
    for (const dx of [-0.65, 0.65]) P.box(lx + dx, 4.9, lz + 0.18, 0.28, 9.8, 0.28, STEEL, 1);         // опорные стойки
    P.box(lx, 9.9, lz + 0.22, 1.9, 0.18, 0.55, STEEL, 1);
    P.box(lx, 17.3, 20.8, 2.2, 0.2, 1.4, STEEL, 1);                                                    // площадка
    P.box(lx, 0.25, lz + 1.5, 3.2, 0.5, 3.4, '#4a4741', 1);                                           // стальной трап-основание
    // пульт запуска
    const cx = CONSOLE_POS.x, cz = CONSOLE_POS.z;
    P.box(cx, 0.55, cz, 1.8, 1.1, 1.3, '#2e3136', 1);
    P.box(cx, 1.35, cz - 0.15, 1.6, 0.8, 1.0, '#3a3f45', 1, { rx: -0.45 });
    G.box(cx, 1.4, cz - 0.45, 1.1, 0.45, 0.06, '#7fe0a0', 0, { rx: -0.45 });
    P.box(cx, 0.5, cz + 0.2, 0.5, 1.0, 0.5, '#2e3136', 1);
    P.cyl(cx + 0.6, 1.1, cz + 0.4, 0.08, 0.08, 1.8, '#26241f', 2, { seg: 6 });
    G.box(cx + 0.6, 2.05, cz + 0.4, 0.28, 0.2, 0.28, glowAmber, 0);
    // кабель-канал к борту
    P.cyl(cx - 1, 0.35, cz - 2.2, 0.16, 0.16, 5, '#161614', 2, { axis: 'z', seg: 6, rz: 0 });
    P.cyl(cx - 1, 2.6, 20.8, 0.12, 0.12, 4.6, '#161614', 2, { seg: 6 });
  }

  // ======================================================== СТЫКОВОЧНЫЕ ЗАХВАТЫ ПЕРЕНОСЧИКА (на крыше)
  const clamps = [[-4, 10.5], [-4, -10.5], [-26.5, 8], [-26.5, -8]];
  for (const [cx, cz] of clamps) {
    const y0 = cx > -10 ? 24.15 : 29.5;
    P.box(cx, y0 + 0.2, cz, 4.4, 0.4, 4.4, STEEL, 1);
    P.box(cx, y0 + 0.5, cz, 3.6, 0.2, 3.6, YEL, 4);
    P.cyl(cx, y0 + 1.6, cz, 0.7, 0.9, 2.2, DARKS, 2, { seg: 12 });
    P.cyl(cx, y0 + 2.8, cz, 1.3, 1.3, 0.5, '#6d6860', 1, { seg: 16 });
    P.box(cx, y0 + 3.2, cz, 1.0, 0.6, 3.6, YEL, 4);
    for (const s of [-1, 1]) {
      P.box(cx, y0 + 3.9, cz + s * 1.6, 0.8, 1.7, 0.45, STEEL, 1, { rx: s * 0.28 });
      P.box(cx, y0 + 4.8, cz + s * 1.1, 0.7, 0.5, 1.2, STEEL, 1);
    }
    P.cyl(cx - 1.4, y0 + 1.2, cz + 1.6, 0.18, 0.18, 2, '#7a2e1e', 2, { seg: 8 });
    P.cyl(cx + 1.4, y0 + 1.2, cz - 1.6, 0.18, 0.18, 2, '#7a2e1e', 2, { seg: 8 });
    for (const s of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.cyl(cx + s[0] * 1.7, y0 + 0.5, cz + s[1] * 1.7, 0.2, 0.2, 0.25, '#8a7f70', 1, { seg: 6 });
    G.box(cx, y0 + 5.2, cz, 0.3, 0.14, 0.3, glowAmber, 0);
  }

  // ======================================================== ДЕКАЛИ (трафареты)
  decals.push(
    { k: 'sigil', c: [-20, 14.0, 20.62], n: '+z', w: 5.6, h: 5.6 },
    { k: 'name', c: [-35.5, 14.7, 20.62], n: '+z', w: 17, h: 4.0 },
    { k: 'num', c: [-4, 14.2, 20.62], n: '+z', w: 8.0, h: 3.0 },
    { k: 'sigil', c: [-20, 14.0, -20.62], n: '-z', w: 5.6, h: 5.6 },
    { k: 'name', c: [-3, 14.7, -20.62], n: '-z', w: 17, h: 4.0 },
    { k: 'num', c: [-35, 14.2, -20.62], n: '-z', w: 8.0, h: 3.0 },
    { k: 'stencil', c: [7, 12.8, 20.62], n: '+z', w: 6.5, h: 3.2 },
    { k: 'noent', c: [16.5, 14.5, 20.62], n: '+z', w: 3.4, h: 3.4 },
    { k: 'warn', c: [9.5, 16.0, 20.62], n: '+z', w: 1.6, h: 1.6 },
    { k: 'tally', c: [-44.5, 12.2, 20.62], n: '+z', w: 8, h: 1.8 },
    { k: 'glyphs', c: [-26, 22.2, 16.98], n: '+z', w: 6, h: 2.8 },
    { k: 'name', c: [-18, 21.2, -16.98], n: '-z', w: 14, h: 3.3 },
    { k: 'num', c: [31, 21.3, 19.04], n: '+z', w: 7.0, h: 2.6 },
    { k: 'chev', c: [37.9, 12.8, 0], n: '+x', w: 24, h: 3.0, rot: 0 },
    { k: 'sigil', c: [37.95, 14.5, 12.5], n: '+x', w: 4, h: 4 },
    { k: 'num', c: [-51.04, 14.5, -9], n: '-x', w: 7, h: 2.6, flip: true },
    { k: 'chev', c: [-51.04, 11.6, 6], n: '-x', w: 16, h: 1.8 },
    // крыша: заметны с воздуха
    { k: 'sigil', c: [-15, 24.35, 0], n: '+y', w: 9, h: 9, rot: 0.0 },
    { k: 'num', c: [-15, 24.35, 12], n: '+y', w: 8, h: 3 },
    { k: 'num', c: [-34, 29.65, 0], n: '+y', w: 12, h: 4.5, rot: Math.PI / 2 },
    { k: 'warn', c: [26.5, 17.52, 0], n: '+y', w: 2.2, h: 2.2 },
  );

  // ======================================================== ВНЕШНИЕ ЭЛЕМЕНТЫ ДЛЯ ИНСТАНСИНГА
  // радиаторные рёбра
  const fins = [];
  for (let i = 0; i < Math.round(60 * q); i++) fins.push({ x: -54.1, y: 14.4, z: -18.5 + i * (37 / Math.round(60 * q)) + 0.3 });

  // ======================================================== ЛАМПЫ вдоль палуб (светятся ночью)
  for (const s of [-1, 1]) for (let x = -46; x <= 30; x += 11) {
    P.box(x, 18.55, s * 19.85, 0.5, 0.5, 0.5, DARKS, 2);
    G.box(x, 18.45, s * 20.12, 0.35, 0.28, 0.12, glowLamp, 0);
  }
  for (let x = -40; x <= 8; x += 12) for (const z of [-15.8, 15.8]) {
    P.box(x, 25.0, z, 0.5, 0.5, 0.5, DARKS, 2);
    G.box(x, 24.9, z + Math.sign(z) * 0.28, 0.35, 0.28, 0.12, glowLamp, 0);
  }

  const main = P.merge();
  const glow = G.merge();

  // ======================================================== ПОДВИЖНЫЕ ЧАСТИ
  // ---- ковш (поза: опущен), геометрия в системе шарнира
  const S = new Parts(404);
  {
    // шарнирный узел и рычаги
    S.cyl(33, 13.5, 0, 1.9, 1.9, 24, SLATE, 1, { axis: 'z', seg: 18 });
    for (const s of [-1, 1]) {
      // главные стрелы — коробчатые балки
      const ex = 49, ey = 4.2, sx = 33, sy = 13.5, L = Math.hypot(ex - sx, ey - sy), ang = Math.atan2(ey - sy, ex - sx);
      S.box((sx + ex) / 2, (sy + ey) / 2, s * 12, L, 2.5, 1.6, HULL2, 0, { rz: ang });
      S.box((sx + ex) / 2, (sy + ey) / 2 + 1.3, s * 12, L, 0.2, 2.0, STEEL, 1, { rz: ang });
      // гидроцилиндры подъёма
      const hx0 = 30, hy0 = 17.5, hx1 = 44, hy1 = 9.5, hl = Math.hypot(hx1 - hx0, hy1 - hy0), ha = Math.atan2(hy1 - hy0, hx1 - hx0);
      S.cyl((hx0 + hx1) / 2 - 0.0, (hy0 + hy1) / 2, s * 8.5, 0.55, 0.55, hl * 0.55, '#3a3d40', 2, { rz: ha + Math.PI / 2, seg: 10, ox: 0 });
      S.cyl((hx0 + hx1) / 2 + 3.4, (hy0 + hy1) / 2 - 2.0, s * 8.5, 0.32, 0.32, hl * 0.5, STEEL, 1, { rz: ha + Math.PI / 2, seg: 8 });
    }
    // днище головы: наклонная плита от лезвия вверх к горловине
    const lipX = 56.5, lipY = -0.7, rearX = 40, rearY = 5.8;
    const fl = Math.hypot(lipX - rearX, rearY - lipY), fa = Math.atan2(rearY - lipY, rearX - lipX);
    S.box((lipX + rearX) / 2, (lipY + rearY) / 2, 0, fl, 0.7, 40, HULL2, 3, { rz: fa + Math.PI });
    // режущая кромка: лезвие + зубья
    S.box(lipX + 0.2, lipY + 0.25, 0, 1.6, 0.5, 40.4, '#3b3a38', 1, { rz: fa + Math.PI - 0.25 });
    for (let i = 0; i < 40; i++) {
      const z = -19.5 + i;
      S.box(lipX + 1.0, lipY + 0.05, z, 1.8, 0.35, 0.72, i % 2 ? '#4c4842' : '#5a5148', 3, { rz: -0.2 });
    }
    // капот-козырёк: наклонная верхняя плита
    const hxA = 56, hyA = 9.8, hxB = 37, hyB = 15.6, hL = Math.hypot(hxA - hxB, hyA - hyB), hA = Math.atan2(hyA - hyB, hxA - hxB);
    S.box((hxA + hxB) / 2, (hyA + hyB) / 2, 0, hL, 0.6, 40, HULL, 0, { rz: hA });
    for (let i = 0; i < 11; i++) {
      const z = -18 + i * 3.6;
      S.box((hxA + hxB) / 2 + 0.4, (hyA + hyB) / 2 + 0.75, z, hL - 0.6, 0.5, 0.45, HULL2, 0, { rz: hA });
    }
    S.box(56.2, 9.6, 0, 0.7, 0.5, 40.4, YEL, 4, { rz: hA });
    const onHood = (u, z, hh) => [hxA + (hxB - hxA) * u, hyA + (hyB - hyA) * u + hh, z];
    for (let i = 0; i < 6; i++) for (const u of [0.35, 0.7]) {
      const [x, y, z] = onHood(u, -16.5 + i * 6.6 + (u > 0.5 ? 3.3 : 0), 0.9);
      S.box(x, y, z, 2.8, 1.2, 2.6, i % 2 ? HULL2 : '#8a5a36', 3, { rz: hA });
      for (let k = 0; k < 4; k++) S.box(x + 0.1, y + 0.7 + k * 0.0, z - 1 + k * 0.66, 0.1, 0.12, 0.3, '#2b2926', 2, { rz: hA });
    }
    for (let i = 0; i < 9; i++) { const [x, y, z] = onHood(0.12, -17 + i * 4.3, 1.1); S.box(x, y, z, 1.0, 1.0, 0.9, STEEL, 1, { rz: hA }); }
    for (const z of [-12, 12]) { const [x, y] = onHood(0.5, z, 2.0); S.cyl(x, y, z, 0.35, 0.35, 3, '#3a3d40', 2, { seg: 8 }); S.box(x, y + 1.6, z, 1.6, 0.25, 1.6, STEEL, 1); }
    // клыки-пластины зубьев ряд 2 (крупные скребки над кромкой)
    for (let i = 0; i < 20; i++) S.box(55.2, 3.2, -19 + i * 2, 0.4, 2.6, 0.5, '#4c4842', 3, { rz: -0.1 });
    // боковые стенки (крупные трапеции-призмы)
    for (const s of [-1, 1]) {
      S.prism([[56.5, -0.8], [56.5, 9.8], [37, 15.6], [37, 6], [40.5, 5.8]], s * 19.8, 0.7, HULL, 0);
      S.prism([[56.5, -0.8], [56.5, 9.8], [55, 9.4], [55, -0.8]], s * 19.4, 0.5, STEEL, 1);
      // рамная обвязка стенки: кромки по контуру, раскосы, ступица шарнира, болтовые пояса
      S.box(56.2, 4.5, s * 20.3, 0.9, 10.6, 0.7, HULL2, 0);
      S.box(39.0, 10.2, s * 20.3, 0.9, 9.6, 0.7, HULL2, 0);
      S.box(47.0, 12.9, s * 20.35, 20.4, 0.7, 0.8, STEEL, 1, { rz: 0.30 });
      S.box(47.7, 0.4, s * 20.35, 17.4, 0.9, 0.8, '#3b3a38', 3, { rz: 0.12 });
      S.box(46, 3.6, s * 20.35, 16, 0.5, 0.5, '#6d6860', 1, { rz: 0.42 });
      S.box(46, 3.6, s * 20.35, 16, 0.5, 0.5, '#6d6860', 1, { rz: -0.42 });
      S.cyl(33, 13.5, s * 20.9, 2.7, 2.7, 1.0, '#6d6860', 1, { axis: 'z', seg: 20 });
      S.cyl(33, 13.5, s * 21.5, 1.2, 1.2, 0.6, '#2b2926', 2, { axis: 'z', seg: 12 });
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; S.cyl(33 + Math.cos(a) * 2.1, 13.5 + Math.sin(a) * 2.1, s * 21.5, 0.2, 0.2, 0.3, '#9a8f80', 1, { axis: 'z', seg: 6 }); }
      for (let k = 0; k < 16; k++) S.cyl(56.2, -0.2 + k * 0.62, s * 20.7, 0.14, 0.14, 0.2, '#9a8f80', 1, { axis: 'z', seg: 6 });
      // наружные гидроцилиндры подъёма (двойные)
      for (const dz of [0.0, 1.2]) {
        S.cyl(38.5, 14.4, s * (21.4 + dz), 0.5, 0.5, 6.4, '#3a3d40', 2, { rz: 1.18, seg: 10 });
        S.cyl(42.7, 12.9, s * (21.4 + dz), 0.3, 0.3, 4.6, '#c8c4bb', 1, { rz: 1.18, seg: 8 });
      }
      // боковые отвалы-скребки
      S.box(52, 1.2, s * 20.5, 6.4, 1.8, 0.4, '#3b3a38', 3, { rz: 0.1 });
      S.box(52.2, 1.55, s * 20.8, 5.6, 0.2, 0.3, YEL, 4, { rz: 0.1 });
    }
    // внутренние отражатели (воронка к горловине)
    for (const s of [-1, 1]) {
      S.box(44.5, 5.6, s * 11.2, 17, 7.0, 0.5, '#7b5a3a', 3, { ry: s * 0.42 });
      S.box(44.5, 5.6, s * 11.2, 17.2, 0.4, 0.8, STEEL, 1, { ry: s * 0.42 });
    }
    S.box(40.4, 8.5, 0, 0.6, 7, 8.4, DARKS, 2);   // горловина
    // надписи-шевроны на козырьке — декали вне ковша не нужны; клёпаные накладки
    for (let i = 0; i < 12; i++) S.box(50 + (R() - 0.5) * 5, 11.0 + (R() - 0.5) * 1.4, (R() - 0.5) * 36, 1.4 + R(), 0.12, 1.2 + R() * 1.4, OLIVE, 3, { rz: hA });
    // фары ковша
    for (const z of [-17, -9, 9, 17]) { S.box(56.4, 8.6, z, 0.6, 0.7, 1.1, DARKS, 2); }
  }
  const scoopDecals = [];
  for (const s of [-1, 1]) {
    const n = s > 0 ? '+z' : '-z', zz = s * 20.52;
    scoopDecals.push({ k: 'sigil', c: [46, 6.3, zz], n, w: 5.2, h: 5.2 });
    scoopDecals.push({ k: 'chev', c: [48, 2.4, zz + s * 0.0], n, w: 14, h: 1.8, rot: 0 });
    scoopDecals.push({ k: 'num', c: [48.5, 10.4, zz], n, w: 5.6, h: 2.1, rot: -0.3 });
  }
  const scoop = S.merge(-SCOOP_PIVOT.x, -SCOOP_PIVOT.y, -SCOOP_PIVOT.z);

  // ---- шнек (вращается вокруг оси z)
  const A = new Parts(505);
  {
    A.cyl(0, 0, 0, 1.35, 1.35, 39, '#4b4640', 3, { axis: 'z', seg: 20 });
    for (let i = 0; i < 4; i++) for (let k = 0; k < 24; k++) {
      const z = -18.4 + k * 1.6, a = i * Math.PI / 2 + k * 0.5, r = 1.9;
      A.box(Math.cos(a) * r, Math.sin(a) * r, z, 1.5, 0.35, 1.6, (k + i) % 6 === 0 ? YEL : '#6b6054', (k + i) % 6 === 0 ? 4 : 3, { rz: a + 0.3 * 0, ry: 0 });
      if (k % 3 === 0) A.box(Math.cos(a) * 2.5, Math.sin(a) * 2.5, z, 0.5, 0.7, 0.7, '#2b2926', 1, { rz: a });
    }
    for (const s of [-1, 1]) { A.cyl(0, 0, s * 19.6, 2.2, 2.2, 0.8, SLATE, 1, { axis: 'z', seg: 18 }); }
  }
  const auger = A.merge();

  // ---- барабан центрифуги
  const D = new Parts(606);
  {
    D.cyl(0, 0, 0, 5.1, 5.1, 4.4, '#8f6a45', 0, { seg: 32 });
    for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; D.box(Math.cos(a) * 5.2, 0, Math.sin(a) * 5.2, 0.9, 4.4, 0.55, '#6d4a2c', 3, { ry: -a }); }
    for (const y of [-2.0, 0, 2.0]) D.cyl(0, y, 0, 5.4, 5.4, 0.3, STEEL, 1, { seg: 32 });
    D.cyl(0, 2.9, 0, 3.0, 5.0, 1.4, '#7b5a3a', 3, { seg: 24 });
    D.box(0, 2.2, 0, 8.8, 0.35, 0.7, YEL, 4);
    D.box(0, 2.2, 0, 0.7, 0.35, 8.8, YEL, 4);
  }
  const drum = D.merge();

  // ---- вентилятор (ось x)
  const F = new Parts(707);
  {
    F.cyl(0, 0, 0, 0.7, 0.7, 0.6, '#1d1c1a', 2, { axis: 'x', seg: 12 });
    for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; F.box(0, Math.sin(a) * 1.7, Math.cos(a) * 1.7, 0.1, 2.0, 0.55, k % 3 === 0 ? YEL : STEEL, 1, { rx: a + Math.PI / 2 * 0 - 0 }); }
    F.cyl(0.1, 0, 0, 2.7, 2.7, 0.18, '#3a3835', 1, { axis: 'x', seg: 26, open: true });
  }
  const fan = F.merge();

  // ---- антенна-радар
  const RD = new Parts(808);
  {
    RD.box(0, 0.4, 0, 5.4, 0.35, 1.8, STEEL, 1);
    RD.box(2.7, 0.8, 0, 0.3, 1.0, 1.8, STEEL, 1);
    RD.box(-2.7, 0.8, 0, 0.3, 1.0, 1.8, STEEL, 1);
    RD.cyl(0, 0.1, 0, 0.4, 0.55, 0.6, DARKS, 2, { seg: 10 });
  }
  const radar = RD.merge();

  // ---- далёкий упрощённый корпус (LOD)
  const FAR = new Parts(909);
  {
    for (const u of UNITS) FAR.box(u.x, 4.7, u.z, 32, 9.4, TRK.width, '#2b2926', 2);
    FAR.box(-7.5, 13.65, 0, 87, 7.7, 40, HULL, 0);
    FAR.box(-7, 8.6, 0, 92, 2.5, 30, SLATE, 1);
    FAR.box(-15, 20.75, 0, 58, 6.5, 33, HULL2, 0);
    FAR.box(-34, 26.7, 0, 20, 5.2, 25, HULL, 0);
    FAR.box(29, 20.0, 12.75, 16, 5.0, 12.5, HULL2, 0);
    FAR.box(30, 25.2, 13, 13, 5, 11.2, CREAM, 0);
    FAR.box(29, 21.5, -13, 18, 8.0, 12, HULL, 0);
    for (const [tx, tz] of TOWERS) FAR.cyl(tx, 29, tz, 5.8, 6.6, 9, HULL3, 0, { seg: 14 });
    for (const [sx, ty, sz] of STACKS) FAR.cyl(sx, (ty + 18) / 2, sz, 1.5, 1.7, ty - 18, '#4b4640', 3, { seg: 8 });
    FAR.box(23, 23.5, -2, 28, 0.9, 7, HULL2, 0, { rz: 0.45 });
    FAR.prism([[36, 17.5], [36, 9.8], [41.6, 9.8]], 0, 40, HULL2, 0);
    FAR.box(48.5, 7.4, 0, 17.5, 0.7, 40, HULL2, 3, { rz: -0.37 });
    FAR.box(46.5, 10.5, 0, 19.5, 0.6, 40, HULL, 0, { rz: 0.3 });
    for (const s of [-1, 1]) FAR.prism([[56.5, -0.8], [56.5, 9.8], [37, 15.6], [37, 6], [40.5, 5.8]], s * 19.8, 0.7, HULL, 0);
    FAR.box(-54.5, 14.4, 0, 3, 7.4, 38, SLATE, 1);
  }
  const far = FAR.merge();

  return { scoopDecals, main, glow, scoop, auger, drum, fan, radar, far, posts, bolts, fins, decals, clamps };
}
