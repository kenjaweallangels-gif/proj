// Интерьер, нижняя палуба (A): машинное отделение, коридор и трап, кубрик, комната дистикомбов, кают-компания, лаборатория, галерея (шлюз), приёмный зал.
// Каждая комната строится вокруг «чистого» объёма b; перегородки — две стены по 0.2 м (по одной от каждой комнаты).
import { Room, PAL, hole } from './ibuild.js';
import { FA, CA, FB, DOOR } from './layout.js';

export const FACE = {
  '+z': { a: [1, 0, 0], b: [0, 1, 0] }, '-z': { a: [-1, 0, 0], b: [0, 1, 0] },
  '+x': { a: [0, 0, -1], b: [0, 1, 0] }, '-x': { a: [0, 0, 1], b: [0, 1, 0] },
  '+y': { a: [1, 0, 0], b: [0, 0, -1] }, '-y': { a: [1, 0, 0], b: [0, 0, 1] },
};
export const scr = (R, c, n, w, h, k, tilt = 0) => R.screens.push({ c, n, w, h, k, tilt });
export const dec = (R, k, c, n, w, h, rot = 0) => R.decals.push({ k, c, n, w, h, rot });

export function lampPanel(R, x, y, z, sx, sz, i = 1, r = 7, c) {
  R.gbox(x, y - 0.03, z, sx, 0.06, sz, '#fff0cc');
  R.box(x, y + 0.05, z, sx + 0.3, 0.12, sz + 0.3, PAL.DARK, 2);
  R.lamp(x, y - 0.7, z, i, r, c);
}
export function pipeX(R, x0, x1, y, z, r, color = PAL.STEEL, tag = 3) {
  R.cyl((x0 + x1) / 2, y, z, r, r, x1 - x0, color, tag, { axis: 'x', seg: 10 });
  for (let x = x0 + 1.5; x < x1; x += 3.2) R.box(x, y + r + 0.12, z, 0.14, 0.3, r * 2 + 0.2, PAL.DARK, 1);
}
export function pipeZ(R, z0, z1, y, x, r, color = PAL.STEEL, tag = 3) {
  R.cyl(x, y, (z0 + z1) / 2, r, r, z1 - z0, color, tag, { axis: 'z', seg: 10 });
  for (let z = z0 + 1.5; z < z1; z += 3.2) R.box(x, y + r + 0.12, z, r * 2 + 0.2, 0.3, 0.14, PAL.DARK, 1);
}
export function pipeY(R, x, z, y0, y1, r, color = PAL.STEEL, tag = 3) {
  R.cyl(x, (y0 + y1) / 2, z, r, r, y1 - y0, color, tag, { seg: 10 });
  R.cyl(x, y0 + 0.2, z, r * 1.35, r * 1.35, 0.3, PAL.DARK, 1, { seg: 10 });
  R.cyl(x, y1 - 0.2, z, r * 1.35, r * 1.35, 0.3, PAL.DARK, 1, { seg: 10 });
}
/** Шкаф: front — сторона дверцы ('+z'|'-z'|'+x'|'-x'). */
export function cabinet(R, x, z, w, d, h, color = PAL.OLIVE, y = FA, solid = true, front = '+z') {
  R.box(x, y + h / 2, z, w, h, d, color, 0, { s: solid });
  if (front === '+z' || front === '-z') {
    const sg = front === '+z' ? 1 : -1;
    R.box(x, y + h / 2, z + sg * (d / 2 + 0.015), w - 0.14, h - 0.14, 0.03, PAL.DARK, 2);
    R.box(x + w * 0.38, y + h * 0.5, z + sg * (d / 2 + 0.04), 0.06, 0.4, 0.05, PAL.STEEL, 1);
    for (let i = 0; i < 4; i++) R.box(x, y + h * 0.82 + i * 0.07, z + sg * (d / 2 + 0.035), w * 0.6, 0.025, 0.02, '#6d6860', 1);
  } else {
    const sg = front === '+x' ? 1 : -1;
    R.box(x + sg * (w / 2 + 0.015), y + h / 2, z, 0.03, h - 0.14, d - 0.14, PAL.DARK, 2);
    R.box(x + sg * (w / 2 + 0.04), y + h * 0.5, z + d * 0.38, 0.05, 0.4, 0.06, PAL.STEEL, 1);
    for (let i = 0; i < 4; i++) R.box(x + sg * (w / 2 + 0.035), y + h * 0.82 + i * 0.07, z, 0.02, 0.025, d * 0.6, '#6d6860', 1);
  }
}
export function crate(R, x, y, z, s, color = PAL.WOOD, tag = 0, solid = true, ry = 0) {
  const sx = Array.isArray(s) ? s[0] : s, sy = Array.isArray(s) ? s[1] : s, sz = Array.isArray(s) ? s[2] : s;
  R.box(x, y + sy / 2, z, sx, sy, sz, color, tag, { s: solid, ry });
  R.box(x, y + sy * 0.5, z, sx + 0.04, 0.1, sz + 0.04, PAL.DARK, 1, { ry });
}
export function barrel(R, x, y, z, r, h, color, solid = true, glowColor = null) {
  R.cyl(x, y + h / 2, z, r, r, h, color, 1, { seg: 14, s: solid });
  R.cyl(x, y + h * 0.3, z, r * 1.02, r * 1.02, 0.1, PAL.DARK, 2, { seg: 14 });
  R.cyl(x, y + h * 0.7, z, r * 1.02, r * 1.02, 0.1, PAL.DARK, 2, { seg: 14 });
  if (glowColor) R.glow.cyl(x, y + h + 0.01, z, r * 0.88, r * 0.88, 0.04, glowColor, 0, { seg: 14 });
}
/** Трап (ступени, поручни, проходимость): вдоль x от xa (низ, y=ya) к xb (верх, y=yb), ширина по z [z0,z1]. rails — [у z0, у z1]. */
export function stairX(R, xa, ya, xb, yb, z0, z1, rails = [true, true], floorY = FA) {
  const n = Math.max(4, Math.round(Math.abs(yb - ya) / 0.28)), zc = (z0 + z1) / 2, w = z1 - z0;
  const dx = (xb - xa) / n, ang = Math.atan2(yb - ya, xb - xa);
  for (let i = 0; i < n; i++) {
    const xm = xa + dx * (i + 0.5), yt = ya + (yb - ya) * (i + 1) / n;
    R.box(xm, yt - 0.04, zc, Math.abs(dx) + 0.1, 0.08, w, PAL.STEEL, 5, { tess: 99 });
    R.box(xm - dx * 0.5, yt - 0.18, zc, 0.04, 0.24, w, PAL.DARK, 2);
  }
  const L = Math.hypot(xb - xa, yb - ya), mx = (xa + xb) / 2, my = (ya + yb) / 2;
  for (const z of [z0 - 0.05, z1 + 0.05]) R.box(mx, my - 0.22, z, L, 0.36, 0.1, PAL.STEEL, 1, { rz: ang });
  R.plan.addFloor(Math.min(xa, xb), z0, Math.max(xa, xb), z1, xa < xb ? ya : yb, xa < xb ? yb : ya, 'x', 'metal');
  const ns = Math.ceil(Math.abs(xb - xa) / 1.0);
  for (let i = 0; i < ns; i++) {
    const xs0 = xa + (xb - xa) * i / ns, xs1 = xa + (xb - xa) * (i + 1) / ns, ym = ya + (yb - ya) * (i + 0.5) / ns;
    R.plan.addBlock(Math.min(xs0, xs1), floorY - 0.5, z0, Math.max(xs0, xs1), ym - 0.14, z1);
  }
  const hh = 1.0;
  [[z0 - 0.05, rails[0]], [z1 + 0.05, rails[1]]].forEach(([z, on]) => {
    if (!on) return;
    R.box(mx, my + hh, z, L, 0.07, 0.07, PAL.YEL, 1, { rz: ang });
    R.box(mx, my + hh * 0.5, z, L, 0.05, 0.05, PAL.YEL, 1, { rz: ang });
    for (let i = 0; i <= n; i += 2) R.box(xa + dx * i, ya + (yb - ya) * i / n + hh / 2, z, 0.06, hh, 0.06, PAL.YEL, 1);
    for (let i = 0; i < ns; i++) {
      const xs0 = xa + (xb - xa) * i / ns, xs1 = xa + (xb - xa) * (i + 1) / ns, ym = ya + (yb - ya) * (i + 0.5) / ns;
      R.plan.addBlock(Math.min(xs0, xs1), ym - 0.15, z - 0.1, Math.max(xs0, xs1), ym + hh + 0.15, z + 0.1);
    }
  });
}
/** Койка-стеллаж: 3 яруса, длинная ось по x (2.0 x 0.9). */
export function bunk(R, x, z, fab, flip = 1, backSide = -1) {
  const L = 2.0, W = 0.9, y0 = FA;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) R.box(x + sx * (L / 2 - 0.04), y0 + 1.7, z + sz * (W / 2 - 0.04), 0.07, 3.4, 0.07, PAL.STEEL, 1);
  R.solid(x, y0 + 1.7, z, L, 3.4, W);
  for (let k = 0; k < 3; k++) {
    const y = y0 + 0.45 + k * 1.15;
    R.box(x, y, z, L, 0.07, W, PAL.STEEL, 1);
    R.box(x, y + 0.14, z, L - 0.08, 0.2, W - 0.1, fab[(k + Math.abs(Math.round(x))) % fab.length], 6, { jit: 0.1 });
    R.box(x - L * 0.38 * flip, y + 0.32, z, 0.45, 0.16, W * 0.7, '#b9b2a2', 6);
    R.box(x + L * 0.1 * flip, y + 0.27, z + (k % 2 ? 0.1 : -0.1), L * 0.5, 0.1, W * 0.55, fab[(k + 1 + Math.abs(Math.round(x))) % fab.length], 6, { jit: 0.1 });
    R.box(x, y + 0.45, z + backSide * (W / 2 - 0.02), L, 0.5, 0.04, PAL.WALL2, 0);
  }
  for (let k = 0; k < 6; k++) R.box(x + (L / 2 + 0.03) * flip, y0 + 0.3 + k * 0.55, z, 0.04, 0.04, W * 0.5, PAL.STEEL, 1);
}

// ---------------------------------------------------------------------------------------------- МАШИННОЕ ОТДЕЛЕНИЕ
export function engineRoom(plan, glow) {
  const b = { x0: -50.0, x1: -29.6, z0: -19.2, z1: 19.2, y0: FA, y1: CA - 0.3 };
  const R = new Room('engine', 'Машинное отделение', b, { ambient: [0.3, 0.3, 0.3], seed: 1101 }, plan, glow);
  const CY = b.y1;
  for (const x of [-46, -40, -34]) for (const z of [-13, 0, 13]) lampPanel(R, x, CY - 0.05, z, 1.6, 0.5, 1.0, 8);
  R.enclose({ e: [hole(-1.8, 1.8, FA, FA + 3.8)] });
  // главные двигатели
  const xc = -38.5;
  for (const s of [-1, 1]) {
    const z = s * 7.6;
    R.box(xc, FA + 0.3, z, 14.5, 0.6, 4.6, PAL.DARK, 2, { s: true });
    R.box(xc, FA + 1.9, z, 13, 2.6, 3.6, '#4b6a5c', 3, { s: true });
    R.box(xc, FA + 1.9, z - s * 1.85, 13.1, 2.7, 0.14, PAL.STEEL, 1);
    for (let i = 0; i < 6; i++) {
      const cx = xc - 5.4 + i * 2.16;
      for (const dz of [-0.95, 0.95]) {
        R.cyl(cx, FA + 3.6, z + dz, 0.72, 0.72, 1.4, '#7b7f7a', 1, { seg: 12 });
        R.box(cx, FA + 4.45, z + dz, 1.5, 0.35, 1.4, PAL.RUST, 3);
        R.dyn.push({ kind: 'piston', c: [cx, FA + 4.95, z + dz], ph: i * 1.1 + (dz > 0 ? 0.55 : 0) });
      }
      R.cyl(cx, FA + 3.4, z + s * 1.78, 0.3, 0.3, 0.7, PAL.YEL, 4, { axis: 'z', seg: 8 });
    }
    R.cyl(xc, FA + 5.3, z, 0.42, 0.42, 13, PAL.STEEL, 1, { axis: 'x', seg: 12 });
    for (let i = 0; i < 7; i++) R.cyl(xc - 6 + i * 2, FA + 5.3, z, 0.52, 0.52, 0.24, PAL.DARK, 2, { axis: 'x', seg: 12 });
    R.cyl(xc - 7.7, FA + 3.2, z, 1.05, 1.05, 1.6, '#6d4a33', 3, { axis: 'z', seg: 14 });
    R.cyl(xc - 7.7, FA + 3.2, z, 0.5, 0.5, 2.0, PAL.DARK, 2, { axis: 'z', seg: 10 });
    R.cyl(xc - 7.7, (FA + 4.2 + CY) / 2, z, 0.5, 0.5, CY - FA - 4.2, '#2d2b29', 2, { seg: 12 });
    R.cyl(xc - 3.0, (FA + 6.0 + CY) / 2, z, 0.4, 0.4, CY - FA - 6.0, '#2d2b29', 2, { seg: 12 });
    R.dyn.push({ kind: 'wheel', c: [xc + 7.2, FA + 2.2, z], r: 1.4 });
    R.box(xc + 6.6, FA + 1.9, z, 0.7, 1.9, 3.0, PAL.STEEL, 1, { s: true });
    R.box(xc, FA + 3.2, z - s * 1.86, 3.0, 0.9, 0.06, PAL.DARK, 2);
    for (let i = 0; i < 4; i++) R.gbox(xc - 1.2 + i * 0.8, FA + 3.2, z - s * 1.9, 0.5, 0.5, 0.05, i % 2 ? '#ffb347' : '#7fe0a0');
  }
  // генераторы у кормовой стенки
  for (const s of [-1, 1]) {
    R.cyl(-47.8, FA + 1.6, s * 7.6, 1.5, 1.5, 3.6, PAL.OLIVE, 0, { axis: 'x', seg: 18, s: true });
    R.box(-47.8, FA + 3.3, s * 7.6, 2.2, 0.8, 1.2, PAL.DARK, 2);
    for (let i = 0; i < 5; i++) R.cyl(-47.8 - 1.4 + i * 0.7, FA + 1.6, s * 7.6, 1.56, 1.56, 0.1, PAL.STEEL, 1, { axis: 'x', seg: 18 });
  }
  // шкафы РУ вдоль кормовой стены (x=-49.6)
  for (let i = 0; i < 7; i++) {
    const z = -17.5 + i * 1.15;
    cabinet(R, -49.6, z, 0.7, 1.05, 2.4, i % 3 ? PAL.OLIVE : PAL.BLUE, FA, true, '+x');
    R.gbox(-49.19, FA + 1.9, z, 0.03, 0.12, 0.8, i % 2 ? '#ff8a3a' : '#7fe0a0');
  }
  scr(R, [-49.17, FA + 1.35, -14.0], '+x', 1.0, 0.7, 2);
  scr(R, [-49.17, FA + 1.35, -11.7], '+x', 1.0, 0.7, 5);
  // правая сторона: верстак, инструмент, баллоны
  R.box(-45, FA + 0.45, 17.9, 3.6, 0.9, 1.3, PAL.WOOD, 0, { s: true });
  R.box(-45, FA + 0.92, 17.9, 3.7, 0.08, 1.4, PAL.STEEL, 1);
  R.box(-45, FA + 2.3, 19.15, 3.4, 1.5, 0.05, PAL.DARK, 2);
  for (let i = 0; i < 9; i++) R.box(-46.4 + i * 0.35, FA + 2.3, 19.1, 0.06, 1.0 + (i % 3) * 0.12, 0.05, PAL.STEEL, 1);
  for (let i = 0; i < 5; i++) barrel(R, -38 + i * 0.9, FA, 18.5, 0.32, 1.5, i % 2 ? PAL.RED : PAL.BLUE);
  crate(R, -34.0, FA, 18.3, [1.4, 1.0, 1.2]); crate(R, -34.0, FA + 1.0, 18.3, [1.0, 0.8, 1.0], PAL.OLIVE);
  // левая сторона: насосная станция
  for (let i = 0; i < 3; i++) {
    const x = -46 + i * 3.4;
    R.cyl(x, FA + 0.9, -17.2, 0.9, 0.9, 1.8, PAL.BLUE, 0, { seg: 16, s: true });
    R.cyl(x, FA + 2.0, -17.2, 0.5, 0.5, 0.5, PAL.STEEL, 1, { seg: 12 });
    pipeY(R, x, -18.6, FA, CY, 0.22, PAL.STEEL);
  }
  // потолочные трассы и подвесной кран
  pipeX(R, -50, -29.6, CY - 0.5, -18.0, 0.3, '#7a6a52');
  pipeX(R, -50, -29.6, CY - 0.5, 18.0, 0.3, '#4b6a5c');
  pipeX(R, -50, -29.6, CY - 1.3, 18.0, 0.16, '#7a2e1e');
  for (const z of [-11.5, 11.5]) R.box(-40, CY - 0.25, z, 20, 0.4, 0.4, PAL.YEL, 4);
  R.box(-38, CY - 0.25, 0, 0.7, 0.4, 23, PAL.STEEL, 1);
  R.box(-38, CY - 0.95, 3, 1.2, 0.9, 1.0, PAL.YEL, 4);
  R.box(-38, CY - 2.0, 3, 0.06, 1.3, 0.06, PAL.DARK, 2);
  R.box(-38, CY - 2.7, 3, 0.4, 0.4, 0.4, PAL.STEEL, 1);
  // вентиляторы в потолке
  for (const z of [-3.2, 3.2]) { R.cyl(-33, CY - 0.05, z, 1.3, 1.3, 0.2, PAL.DARK, 2, { seg: 16 }); R.dyn.push({ kind: 'fan', c: [-33, CY - 0.28, z], r: 1.1 }); }
  // знаки
  dec(R, 'danger', [b.x1 - 0.02, FA + 3.0, -2.6], '-x', 1.6, 1.6);
  dec(R, 'danger', [b.x0 + 0.02, FA + 3.2, 4.0], '+x', 2.0, 2.0);
  dec(R, 'stencil', [b.x0 + 0.02, FA + 3.0, 14.0], '+x', 3.4, 1.7);
  dec(R, 'carve', [b.x1 - 0.02, FA + 2.0, 8.0], '-x', 2.4, 2.4);
  return R;
}

// ---------------------------------------------------------------------------------------------- КОРИДОР + ТРАП НА ВЕРХНЮЮ ПАЛУБУ
export function corridor(plan, glow) {
  const b = { x0: -29.0, x1: 7.8, z0: -3.4, z1: 3.4, y0: FA, y1: CA - 0.3 };
  const R = new Room('corridor', 'Главный коридор', b, { ambient: [0.3, 0.3, 0.29], seed: 1102 }, plan, glow);
  const CY = b.y1;
  for (const x of [-26, -19, -12, -5, 2, 6.2]) lampPanel(R, x, CY - 0.05, x > -6 ? -1.4 : 0, 1.4, 0.4, 0.9, 6.5);
  const dz = (x0) => hole(x0, x0 + 1.9, FA, FA + 3.2);
  R.enclose({ w: [hole(-1.8, 1.8, FA, FA + 3.8)], n: [dz(-26), dz(-16), dz(-2)], s: [dz(-26), dz(-16), dz(-2)], e: false,
    ceilHole: { x0: -6.8, x1: 8.0, z0: 0.2, z1: 3.8 } });   // проём в перекрытии над трапом на верхнюю палубу (совпадает с проёмом пола зала)
  R.slab(7.8, 14.9, -3.4, 8.0, CY + 0.3, 3.4, PAL.WALL, 0);   // перемычка над проходом в галерею
  // пороги в стыках (толщина перегородок): без них пол «обрывается» между комнатами
  R.floor(7.8, -3.4, 8.0, 3.4, FA, PAL.FLOOR, 5);
  R.floor(-29.6, -1.8, -29.0, 1.8, FA, PAL.FLOOR, 5);
  for (const x0 of [-26, -16, -2]) { R.floor(x0, 3.4, x0 + 1.9, 3.8, FA, PAL.FLOOR, 5); R.floor(x0, -3.8, x0 + 1.9, -3.4, FA, PAL.FLOOR, 5); }
  // трап вдоль +z: подъём на запад к залу переработки
  stairX(R, 7.8, FA, -6.8, FB, 0.45, 3.2, [true, false]);
  for (const [x, nm] of [[-25.05, 'num1'], [-15.05, 'num2'], [-1.05, 'num3']]) {
    dec(R, nm, [x, FA + 3.55, 3.38], '-z', 1.2, 0.5);
    dec(R, nm, [x, FA + 3.55, -3.38], '+z', 1.2, 0.5);
  }
  dec(R, 'arrow', [-4, FA + 2.6, -3.38], '+z', 1.4, 0.7);
  dec(R, 'exit', [6.2, FA + 3.8, -3.38], '+z', 1.6, 0.6);
  dec(R, 'danger', [-27.6, FA + 3.0, -3.38], '+z', 1.2, 1.2);
  pipeX(R, -29, 7.8, CY - 0.6, -2.9, 0.22, '#7a6a52');
  pipeX(R, -29, -8.2, CY - 0.6, 2.9, 0.22, '#4b6a5c');   // не доходит до трапа (по нему идёт голова)
  R.box(-10, CY - 1.0, 0, 36, 0.1, 0.6, PAL.DARK, 2);
  for (let x = -28; x < 7.8; x += 1.3) R.box(x, CY - 1.0, 0, 0.05, 0.2, 0.7, PAL.STEEL, 1);
  R.cyl(-9.0, FA + 1.0, -3.2, 0.14, 0.14, 0.7, PAL.RED, 0, { seg: 8 });
  R.box(-8.0, FA + 1.9, -3.37, 0.5, 0.5, 0.05, '#d8d8d0', 0);
  R.box(-8.0, FA + 1.9, -3.34, 0.3, 0.1, 0.03, PAL.RED, 0);
  R.box(-12, FA + 0.01, -2.0, 34, 0.02, 0.2, PAL.YEL, 4);
  return R;
}

// ---------------------------------------------------------------------------------------------- КУБРИК
export function dorm(plan, glow) {
  const b = { x0: -29.0, x1: -9.4, z0: 3.8, z1: 19.2, y0: FA, y1: 14.6 };
  const R = new Room('dorm', 'Кубрик', b, { ambient: [0.34, 0.3, 0.27], seed: 1103 }, plan, glow);
  const CY = b.y1;
  for (const x of [-26, -20, -14]) for (const z of [7, 12, 17]) lampPanel(R, x, CY - 0.05, z, 1.2, 0.4, 0.75, 6.5, [1.0, 0.78, 0.55]);
  const dz = (x0) => hole(x0, x0 + 1.9, FA, FA + 3.2);
  R.enclose({ s: [dz(-26), dz(-16)], e: [hole(11.0, 12.8, FA, FA + 3.0)], floorColor: PAL.FLOOR2 });
  const FAB = [PAL.FAB1, PAL.FAB2, PAL.FAB3, PAL.FAB4];
  for (let k = 0; k < 7; k++) bunk(R, -27.4 + k * 2.55, 18.65, FAB, 1, 1);
  for (let k = 0; k < 7; k++) if (k !== 1 && k !== 5) bunk(R, -27.4 + k * 2.55, 12.8, FAB, -1, -1);   // проходы к двери и в торце
  for (let k = 0; k < 7; k++) if (k !== 1 && k !== 5) bunk(R, -27.4 + k * 2.55, 6.4, FAB, 1, -1);
  // ковёр и стол в проходе, тумбы
  R.box(-18, FA + 0.02, 15.6, 12, 0.03, 2.4, '#6b3a30', 6);
  R.box(-18, FA + 0.78, 15.6, 8.0, 0.1, 0.9, PAL.WOOD, 0, { s: true });
  for (const x of [-21.4, -14.6]) R.box(x, FA + 0.38, 15.6, 0.1, 0.75, 0.8, PAL.DARK, 2);
  for (const s of [-1, 1]) R.box(-18, FA + 0.46, 15.6 + s * 0.85, 8.0, 0.08, 0.34, PAL.WOOD, 0, { s: true });
  for (let i = 0; i < 5; i++) R.cyl(-21 + i * 1.6, FA + 0.88, 15.4, 0.1, 0.09, 0.14, '#b9b2a2', 1, { seg: 8 });
  R.box(-18, FA + 0.02, 9.6, 14, 0.03, 2.0, '#4a5b52', 6);
  for (let i = 0; i < 5; i++) crate(R, -26 + i * 1.3, FA, 9.4 + (i % 2) * 0.4, [0.8, 0.5, 0.6], i % 2 ? PAL.OLIVE : PAL.WOOD);
  // шкафчики вдоль восточной стены
  for (let i = 0; i < 5; i++) cabinet(R, b.x1 - 0.4, 5.4 + i * 2.4, 0.8, 0.7, 2.2, i % 2 ? PAL.OLIVE : PAL.BLUE, FA, true, '-x');
  // бельё на верёвке
  for (let i = 0; i < 8; i++) R.box(-26 + i * 1.1, FA + 3.0 - (i % 3) * 0.05, 9.6, 0.04, 0.9 - (i % 3) * 0.15, 0.7, FAB[i % 4], 6, { rz: (i % 3 - 1) * 0.04 });
  R.box(-21.5, FA + 3.5, 9.6, 9.0, 0.02, 0.02, PAL.DARK, 2);
  // слои истории: роспись возрожденцев, имперский трафарет, резьба
  dec(R, 'mural', [b.x0 + 0.02, FA + 2.4, 11.5], '+x', 5.2, 3.0);
  dec(R, 'hands', [b.x0 + 0.02, FA + 1.5, 16.6], '+x', 2.0, 1.4);
  dec(R, 'tally', [b.x1 - 0.02, FA + 3.1, 10.0], '-x', 2.4, 1.0);
  dec(R, 'eye', [-18, b.y1 - 0.02, 12.0], '-y', 1.4, 1.4);
  dec(R, 'notice', [-14, FA + 2.6, b.z1 - 0.02], '-z', 1.5, 1.0);
  dec(R, 'schedule', [-24, FA + 2.6, b.z1 - 0.02], '-z', 2.0, 1.2);
  dec(R, 'carve', [-20, FA + 2.4, b.z0 + 0.02], '+z', 2.0, 2.0);
  return R;
}

// ---------------------------------------------------------------------------------------------- КОМНАТА ДИСТИКОМБОВ И РЕКУПЕРАЦИИ ВЛАГИ
export function stills(plan, glow) {
  const b = { x0: -9.0, x1: 7.6, z0: 3.8, z1: 19.2, y0: FA, y1: 14.6 };
  const R = new Room('stills', 'Дистикомбы и рекуперация влаги', b, { ambient: [0.3, 0.32, 0.33], seed: 1104 }, plan, glow);
  const CY = b.y1;
  for (const x of [-5, 0, 5]) for (const z of [7, 13, 17.5]) lampPanel(R, x, CY - 0.05, z, 1.4, 0.4, 0.8, 6.5, [0.85, 0.95, 1.0]);
  R.enclose({ s: [hole(-2, -0.1, FA, FA + 3.2)], w: [hole(11.0, 12.8, FA, FA + 3.0)] });
  R.floor(-9.4, 11.0, -9.0, 12.8, FA, PAL.FLOOR, 5);
  for (let i = 0; i < 8; i++) {   // дистикомбы на вешалках
    const x = -7.0 + i * 1.7, z = 18.2;
    R.box(x, FA + 1.95, z + 0.5, 0.06, 0.06, 0.8, PAL.STEEL, 1);
    R.box(x, FA + 1.45, z, 0.55, 1.1, 0.28, '#34322e', 6, { jit: 0.2 });
    R.box(x, FA + 0.55, z, 0.42, 0.8, 0.24, '#3b3a33', 6, { jit: 0.2 });
    R.box(x, FA + 2.15, z, 0.28, 0.28, 0.28, '#2c2a27', 6);
  }
  R.box(-0.5, FA + 2.5, 18.8, 15, 0.08, 0.08, PAL.STEEL, 1);
  R.box(-0.5, FA + 0.4, 18.65, 15.2, 0.8, 0.9, PAL.WOOD, 0, { s: true });
  for (let i = 0; i < 3; i++) {   // баки рекуперации
    const x = -5.6 + i * 5.4, z = 8.6;
    R.cyl(x, FA + 1.6, z, 1.5, 1.5, 3.2, '#5a7a82', 1, { seg: 18, s: true });
    R.cyl(x, FA + 3.35, z, 1.3, 1.5, 0.3, PAL.STEEL, 1, { seg: 18 });
    R.cyl(x, FA + 1.0, z, 1.53, 1.53, 0.12, PAL.DARK, 2, { seg: 18 });
    R.cyl(x, FA + 2.2, z, 1.53, 1.53, 0.12, PAL.DARK, 2, { seg: 18 });
    pipeY(R, x, z, FA + 3.4, CY, 0.2, PAL.STEEL);
    R.gbox(x, FA + 2.6, z - 1.52, 0.5, 0.9, 0.03, '#6fc7ff');
    R.box(x, FA + 2.6, z - 1.5, 0.62, 1.0, 0.04, PAL.DARK, 2);
  }
  R.box(5.8, FA + 0.45, 12.5, 1.2, 0.9, 2.6, PAL.STEEL, 1, { s: true });
  R.box(5.8, FA + 0.95, 12.5, 1.1, 0.08, 2.4, '#7a9aa0', 1);
  R.box(-6.8, FA + 0.3, 12.5, 0.8, 0.6, 2.8, PAL.WOOD, 0, { s: true });
  dec(R, 'water', [b.x0 + 0.02, FA + 2.7, 15.0], '+x', 2.0, 1.3);
  dec(R, 'carve', [b.x1 - 0.02, FA + 2.4, 14.0], '-x', 2.2, 2.2);
  dec(R, 'tally', [b.x0 + 0.02, FA + 1.6, 6.0], '+x', 2.0, 0.8);
  return R;
}

// ---------------------------------------------------------------------------------------------- КАЮТ-КОМПАНИЯ
export function mess(plan, glow) {
  const b = { x0: -29.0, x1: -9.4, z0: -19.2, z1: -3.8, y0: FA, y1: 14.6 };
  const R = new Room('mess', 'Кают-компания', b, { ambient: [0.36, 0.31, 0.26], seed: 1105 }, plan, glow);
  const CY = b.y1;
  for (const x of [-26, -20, -14]) for (const z of [-7, -12, -17]) lampPanel(R, x, CY - 0.05, z, 1.3, 0.4, 0.8, 7, [1.0, 0.82, 0.58]);
  const dz = (x0) => hole(x0, x0 + 1.9, FA, FA + 3.2);
  R.enclose({ n: [dz(-26), dz(-16)], e: [hole(-12.8, -11.0, FA, FA + 3.0)], floorColor: PAL.FLOOR2 });
  for (let i = 0; i < 3; i++) for (const zc of [-8.0, -12.4]) {
    const x = -25 + i * 5.2;
    R.box(x, FA + 0.78, zc, 3.4, 0.1, 1.1, PAL.WOOD, 0, { s: true });
    for (const dx of [-1.5, 1.5]) R.box(x + dx, FA + 0.38, zc, 0.12, 0.76, 0.9, PAL.DARK, 2);
    for (const s of [-1, 1]) R.box(x, FA + 0.46, zc + s * 0.95, 3.4, 0.08, 0.34, PAL.WOOD, 0, { s: true });
    for (let k = 0; k < 3; k++) R.cyl(x - 1.1 + k * 1.1, FA + 0.88, zc + (k % 2 ? 0.2 : -0.2), 0.12, 0.1, 0.09, '#cfc6b3', 1, { seg: 10 });
    R.cyl(x + 0.2, FA + 0.97, zc, 0.12, 0.12, 0.28, PAL.STEEL, 1, { seg: 8 });
  }
  // камбуз у дальней стены (z=-19.2)
  R.box(-21, FA + 0.5, -18.6, 11, 1.0, 1.0, PAL.STEEL, 1, { s: true });
  R.box(-21, FA + 1.02, -18.6, 11.2, 0.06, 1.1, '#9aa09a', 1);
  for (let i = 0; i < 3; i++) {
    R.cyl(-25 + i * 1.6, FA + 1.4, -18.6, 0.55, 0.5, 0.7, '#6b6a65', 1, { seg: 14 });
    R.cyl(-25 + i * 1.6, FA + 1.78, -18.6, 0.52, 0.52, 0.05, PAL.DARK, 2, { seg: 14 });
  }
  R.box(-18.4, FA + 1.5, -18.8, 1.6, 1.0, 0.8, PAL.DARK, 2);
  R.gbox(-18.4, FA + 1.0, -18.38, 1.3, 0.05, 0.03, '#ff7a2a');
  for (let i = 0; i < 10; i++) R.cyl(-27.5 + i * 0.55, FA + 3.1, -19.0, 0.12 + (i % 3) * 0.03, 0.12, 0.3, i % 2 ? '#8a8d86' : '#a0865a', 1, { seg: 8 });
  R.box(-21, FA + 2.85, -19.0, 11, 0.06, 0.3, PAL.WOOD, 0);
  R.box(-21, FA + 3.5, -19.0, 7.0, 0.3, 0.3, PAL.DARK, 2);
  R.cyl(-10.4, FA + 1.3, -17.8, 0.9, 0.9, 2.6, '#5a7a82', 1, { seg: 16, s: true });
  for (let i = 0; i < 6; i++) crate(R, -10.4, FA + (i % 3) * 0.55, -6.0 - Math.floor(i / 3) * 0.9, [0.8, 0.5, 0.7], i % 2 ? PAL.OLIVE : PAL.WOOD);
  dec(R, 'schedule', [b.x0 + 0.02, FA + 2.4, -8.0], '+x', 2.4, 1.5);
  dec(R, 'mural', [b.x0 + 0.02, FA + 2.4, -14.0], '+x', 4.6, 2.7);
  dec(R, 'eagle', [b.x1 - 0.02, FA + 3.0, -6.0], '-x', 1.6, 1.6);
  dec(R, 'carve', [b.x1 - 0.02, FA + 2.2, -16.4], '-x', 2.4, 2.4);
  dec(R, 'notice', [-15, FA + 2.6, b.z0 + 0.02], '+z', 1.4, 1.0);
  dec(R, 'hands', [-12, FA + 1.7, b.z0 + 0.02], '+z', 1.6, 1.1);
  dec(R, 'water', [-27, FA + 2.2, b.z0 + 0.02], '+z', 1.6, 1.0);
  return R;
}

// ---------------------------------------------------------------------------------------------- ЛАБОРАТОРИЯ ПРОБ ПРЯНОСТИ
export function lab(plan, glow) {
  const b = { x0: -9.0, x1: 7.6, z0: -19.2, z1: -3.8, y0: FA, y1: 14.6 };
  const R = new Room('lab', 'Лаборатория проб', b, { ambient: [0.3, 0.32, 0.34], seed: 1106 }, plan, glow);
  const CY = b.y1;
  for (const x of [-5, 0, 5]) for (const z of [-7, -12, -17]) lampPanel(R, x, CY - 0.05, z, 1.4, 0.4, 0.9, 6.5, [0.9, 0.97, 1.0]);
  R.enclose({ n: [hole(-2, -0.1, FA, FA + 3.2)], w: [hole(-12.8, -11.0, FA, FA + 3.0)] });
  R.floor(-9.4, -12.8, -9.0, -11.0, FA, PAL.FLOOR, 5);
  for (const x of [-4.2, 1.6]) {
    R.box(x, FA + 0.46, -11.2, 3.6, 0.92, 1.5, '#6b7870', 1, { s: true });
    R.box(x, FA + 0.94, -11.2, 3.7, 0.06, 1.6, '#c9cfc8', 1);
    for (let i = 0; i < 6; i++) {
      R.cyl(x - 1.4 + i * 0.55, FA + 1.25, -11.4 + (i % 2) * 0.5, 0.13, 0.13, 0.5, '#b9d6d8', 1, { seg: 8 });
      R.glow.cyl(x - 1.4 + i * 0.55, FA + 1.15, -11.4 + (i % 2) * 0.5, 0.09, 0.09, 0.28, i % 3 ? '#ff9a3a' : '#6fd0ff', 0, { seg: 8 });
    }
    R.box(x, FA + 1.06, -10.6, 0.5, 0.2, 0.4, PAL.DARK, 2);
  }
  R.box(0, FA + 0.5, -18.6, 14.5, 1.0, 1.1, '#6b7870', 1, { s: true });
  R.box(0, FA + 1.02, -18.6, 14.6, 0.06, 1.2, '#c9cfc8', 1);
  R.cyl(-5.2, FA + 1.35, -18.6, 0.55, 0.55, 0.7, PAL.STEEL, 1, { seg: 14 });
  R.cyl(-5.2, FA + 1.75, -18.6, 0.5, 0.5, 0.08, PAL.DARK, 2, { seg: 14 });
  R.dyn.push({ kind: 'spin', c: [-5.2, FA + 1.84, -18.6], r: 0.42 });
  R.box(-2.5, FA + 1.3, -18.7, 0.4, 0.6, 0.4, PAL.DARK, 2);
  R.cyl(-2.5, FA + 1.75, -18.7, 0.06, 0.06, 0.4, PAL.STEEL, 1, { seg: 6 });
  cabinet(R, 5.8, -18.4, 3.0, 1.2, 2.4, '#6b7870', FA, true, '+z');
  R.gbox(5.8, FA + 1.5, -17.78, 2.6, 0.9, 0.03, '#bfe8ff');
  R.box(b.x0 + 0.3, FA + 1.3, -7.5, 0.5, 2.6, 3.8, PAL.DARK, 2, { s: true });
  for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) R.glow.box(b.x0 + 0.58, FA + 0.5 + r * 0.6, -9.1 + i * 0.6, 0.05, 0.22, 0.3, (i + r) % 3 ? '#ff9a3a' : '#e07020');
  scr(R, [-2.0, FA + 2.0, b.z0 + 0.03], '+z', 1.8, 1.0, 3);
  scr(R, [1.2, FA + 2.0, b.z0 + 0.03], '+z', 1.8, 1.0, 4);
  dec(R, 'hazard', [6.3, FA + 3.2, b.z0 + 0.02], '+z', 1.4, 1.4);
  dec(R, 'spicechart', [-5.2, FA + 2.9, b.z0 + 0.02], '+z', 2.4, 1.5);
  dec(R, 'eagle', [b.x1 - 0.02, FA + 3.0, -10.0], '-x', 1.5, 1.5);
  dec(R, 'notice', [b.x0 + 0.02, FA + 2.7, -16.0], '+x', 1.4, 1.0);
  return R;
}

// ---------------------------------------------------------------------------------------------- ГАЛЕРЕЯ (ШЛЮЗ) — вход с трапа
export function gallery(plan, glow) {
  const b = { x0: 8.0, x1: 13.8, z0: -19.2, z1: 19.2, y0: FA, y1: 14.6 };
  const R = new Room('gallery', 'Шлюз-галерея', b, { ambient: [0.34, 0.33, 0.31], seed: 1107 }, plan, glow);
  for (const z of [-15, -8, -2, 4, 11.3, 16]) lampPanel(R, 10.9, b.y1 - 0.05, z, 0.5, 1.4, 0.95, 7);
  R.enclose({
    w: [hole(-3.4, 3.4, FA, b.y1)],
    e: [hole(-2.6, 2.6, FA, FA + 4.2)],
    n: [hole(DOOR.x0, DOOR.x1, FA, DOOR.y1)],
  });
  R.ceil(13.8, -2.6, 14.4, 2.6, b.y1, PAL.CEIL, 1);   // перекрытие зазора между стенами галереи и кают-компании над проходом
  R.box((DOOR.x0 + DOOR.x1) / 2, DOOR.y1 + 0.45, 19.0, DOOR.x1 - DOOR.x0 + 0.8, 0.5, 0.4, PAL.YEL, 4);
  R.gbox((DOOR.x0 + DOOR.x1) / 2, DOOR.y1 + 0.2, 18.98, 1.4, 0.12, 0.03, '#8be0a0');
  for (let i = 0; i < 5; i++) cabinet(R, 13.3, -17.5 + i * 1.15, 0.9, 1.0, 2.4, i % 2 ? PAL.OLIVE : PAL.BLUE, FA, true, '-x');
  for (let i = 0; i < 4; i++) cabinet(R, 13.3, 6.2 + i * 1.15, 0.9, 1.0, 2.4, i % 2 ? PAL.BLUE : PAL.OLIVE, FA, true, '-x');
  R.box(8.5, FA + 0.25, -9.0, 0.7, 0.5, 4.0, PAL.WOOD, 0, { s: true });
  R.box(8.5, FA + 0.25, 11.0, 0.7, 0.5, 2.5, PAL.WOOD, 0, { s: true });
  crate(R, 8.7, FA, -17.3, [1.0, 0.9, 1.0], PAL.RED);
  R.cyl(8.3, FA + 1.0, 14.5, 0.12, 0.12, 0.7, PAL.RED, 0, { seg: 8 });
  R.box(8.1, FA + 1.9, 16.5, 0.05, 0.8, 1.2, PAL.RED, 0);
  dec(R, 'exit', [10.9, FA + 4.0, 19.18], '-z', 2.2, 0.7);
  dec(R, 'noent', [b.x0 + 0.02, FA + 2.4, 7.0], '+x', 1.3, 1.3);
  dec(R, 'stencil', [b.x0 + 0.02, FA + 2.6, -8.0], '+x', 2.4, 1.2);
  dec(R, 'hands', [10.9, FA + 1.5, b.z0 + 0.02], '+z', 1.4, 1.0);
  dec(R, 'eagle', [10.9, FA + 3.0, b.z0 + 0.02], '+z', 1.5, 1.5);
  return R;
}

// ---------------------------------------------------------------------------------------------- ПРИЁМНЫЙ ЗАЛ (подача сырья от ковша)
export function feedHall(plan, glow) {
  const b = { x0: 14.4, x1: 35.0, z0: -19.2, z1: 19.2, y0: FA, y1: CA - 0.3 };
  const R = new Room('feed', 'Приёмный зал', b, { ambient: [0.3, 0.29, 0.28], seed: 1108 }, plan, glow);
  const CY = b.y1;
  for (const x of [18, 24, 30]) for (const z of [-13, 0, 13]) lampPanel(R, x, CY - 0.05, z, 1.6, 0.5, 1.0, 8, [1.0, 0.82, 0.55]);
  R.enclose({ w: [hole(-2.6, 2.6, FA, FA + 4.2)] });
  R.floor(13.8, -2.6, 14.4, 2.6, FA, PAL.FLOOR, 5);
  // наклонная подающая лента от носа вверх к залу (z ±2.4)
  const xa = 34.4, ya = FA + 0.9, xb = 15.4, yb = CY - 2.0, hw = 2.4;
  const ang = Math.atan2(yb - ya, xb - xa) + Math.PI, L = Math.hypot(xb - xa, yb - ya), mx = (xa + xb) / 2, my = (ya + yb) / 2;
  R.box(mx, my - 0.25, 0, L + 0.4, 0.4, hw * 2 + 0.6, PAL.DARK, 2, { rz: ang });
  for (const s of [-1, 1]) {
    R.box(mx, my + 0.3, s * (hw + 0.3), L, 1.0, 0.24, PAL.OLIVE, 0, { rz: ang });
    R.box(mx, my + 0.85, s * (hw + 0.3), L, 0.14, 0.4, PAL.STEEL, 1, { rz: ang });
  }
  R.box(mx, my + 0.05, 0, L + 0.2, 0.14, hw * 2, '#1d1c1a', 2, { rz: ang });
  R.dyn.push({ kind: 'belt', a: [xa, ya + 0.14, 0], b: [xb, yb + 0.14, 0], hw: hw - 0.25, n: 22 });
  for (let i = 0; i <= 6; i++) {
    const t = i / 6, x = xa + (xb - xa) * t, y = ya + (yb - ya) * t;
    for (const s of [-1, 1]) R.box(x, (FA + y) / 2 - 0.3, s * (hw + 0.4), 0.4, y - FA - 0.5, 0.4, PAL.STEEL, 1, { s: false });   // опоры внутри объёма ленты (R.solid ниже)
    R.box(x, (FA + y) / 2 - 0.3, 0, 0.3, y - FA - 0.6, 0.3, '#554f48', 1, { s: false });
  }
  R.solid((xa + xb) / 2, FA + 2.4, 0, xa - xb, 4.8, 2 * (hw + 0.6));
  // дробилка у начала ленты на носовой стене
  R.box(34.0, FA + 2.4, 0, 1.8, 4.0, 7.6, PAL.OLIVE, 0, { s: true });
  R.box(34.95, FA + 2.4, 0, 0.1, 3.2, 6.8, PAL.DARK, 2);
  for (let i = 0; i < 5; i++) R.box(34.9, FA + 1.0 + i * 0.5, 0, 0.1, 0.15, 6.4, PAL.STEEL, 1, { rz: -0.3 });
  R.gbox(34.94, FA + 3.6, 2.5, 0.03, 0.4, 0.8, '#ff8a3a');
  // боковые приводы вдоль стен
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const x = 19 + i * 5.6;
      R.box(x, FA + 1.1, s * 17.4, 3.4, 2.2, 2.0, '#5b6a62', 3, { s: true });
      R.cyl(x, FA + 1.3, s * 16.25, 0.9, 0.9, 0.5, PAL.STEEL, 1, { axis: 'z', seg: 14 });
      R.dyn.push({ kind: 'spinz', c: [x, FA + 1.3, s * 15.95], r: 0.82 });
      pipeY(R, x + 1.2, s * 18.6, FA + 2.2, CY, 0.25, PAL.STEEL);
    }
    R.box(30.5, FA + 0.7, s * 12.2, 1.0, 1.4, 1.6, PAL.DARK, 2, { s: true });
  }
  pipeX(R, 14.4, 35.0, CY - 0.6, -9, 0.35, '#7a6a52');
  pipeX(R, 14.4, 35.0, CY - 0.6, 9, 0.35, '#4b6a5c');
  for (const s of [-1, 1]) { R.cyl(26, (FA + CY) / 2, s * 13.4, 0.5, 0.5, CY - FA, '#3a3d40', 2, { seg: 12, s: true }); R.cyl(26, FA + 2.2, s * 13.4, 0.3, 0.3, 4.4, '#c8c4bb', 1, { seg: 8 }); }
  R.box(30.5, FA + 0.3, 7.5, 3.0, 0.6, 2.2, '#c47a2c', 6, { s: true, jit: 0.15 });
  R.box(31, FA + 0.65, 7.2, 1.6, 0.4, 1.2, '#d68a34', 6, { jit: 0.15 });
  R.box(20.5, FA + 0.3, -7.5, 2.4, 0.6, 2.0, '#c47a2c', 6, { s: true, jit: 0.15 });
  scr(R, [22, FA + 2.6, b.z1 - 0.03], '-z', 2.0, 1.2, 3);
  scr(R, [26, FA + 2.6, b.z1 - 0.03], '-z', 2.0, 1.2, 6);
  dec(R, 'danger', [22, FA + 3.8, b.z0 + 0.02], '+z', 1.8, 1.8);
  dec(R, 'stencil', [28, FA + 3.6, b.z0 + 0.02], '+z', 3.0, 1.5);
  dec(R, 'noent', [30, FA + 2.6, b.z1 - 0.02], '-z', 1.5, 1.5);
  dec(R, 'num2', [16.0, FA + 3.0, b.z0 + 0.02], '+z', 1.4, 0.6);
  dec(R, 'hands', [18.0, FA + 1.9, b.z1 - 0.02], '-z', 1.5, 1.1);
  return R;
}
