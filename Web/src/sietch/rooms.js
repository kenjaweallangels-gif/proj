// Жилые комнаты семей (B3), спальные эркеры карниза (B2) и бытовые мелочи: ковры-постели, низкие столы, стойки водяных колец, дистикомбы на вешалках,
// кладовые ниши, детский уголок, сандалии у порога, крючья творца на стенах. Занавеси — ПОДВЯЗАННЫЕ (проход открыт) и не имеют коллизии.
import * as THREE from 'three';
import { addBlock, heightAtLocal } from './plan.js';
import { NICHES, BAY, SHELF_BAYS } from './cave/layout.js';
import { CUP, POT, J_A, J_B, DALLAH, faceYaw } from './shapes.js';
import { clamp } from '../core/util.js';

const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** z дальней стены комнаты n на высоте y при смещении dx от оси (null — вне эллипсоида). */
export const roomWallZ = (n, dx, y) => { const k = 1 - ((y - n.cy) / n.ry) ** 2 - (dx / n.rx) ** 2; return k < 0.03 ? null : n.zc + n.side * n.rz * Math.sqrt(k); };
/** x боковой стены (sign ±1) на высоте y при смещении dz от центра. */
export const roomWallX = (n, dz, y, sign) => { const k = 1 - ((y - n.cy) / n.ry) ** 2 - (dz / n.rz) ** 2; return k < 0.03 ? null : n.xc + sign * n.rx * Math.sqrt(k); };

/**
 * Подвязанная занавесь («дверь» без препятствия): ламбрекен на всю ширину + две створки, собранные подхватами к краям проёма.
 * Нет коллизии; в шейдере ткань дополнительно раздвигается вокруг персонажей (mats.js: uCapA/uCapB).
 */
export function tiedCurtain(H, o) {
  const { B, R } = H;
  const { x, z, w, yTop, h, side, key, seed = 0, open = 0.66, tint = [0.92, 0.92, 0.92], axis = 'x' } = o;
  const NU = 10, NT = 12, tieT = 0.52;
  const put = (u, y, v, along) => (axis === 'x' ? [along, y, z + side * v] : [x + side * v, y, along]);
  const c0 = axis === 'x' ? x : z;
  const swayPar = (px, py) => [0, 0, clamp(1 - (py - (yTop - h)) / h, 0, 1) * 1.1 * (0.15 + 0.85 * clamp((yTop - py) / (h * 0.5 + 0.01), 0, 1))];
  const matKey = `cloth:${key}`;
  const wTop = (w / 2) * (1 - open) + 0.12;
  for (const dir of [-1, 1]) {
    const wall = c0 + dir * w / 2;
    const rails = [];
    for (let j = 0; j <= NT; j++) {
      const t = j / NT, y = yTop - h * t;
      const gather = smooth(tieT - 0.12, tieT + 0.2, t);
      const width = wTop * (1 - 0.72 * gather);
      const bulge = 0.1 * smooth(0.25, tieT, t) * (1 - smooth(tieT, 0.95, t)) + 0.04 * t;
      const row = [];
      for (let i = 0; i <= NU; i++) {
        const u = i / NU;
        const fold = Math.sin(u * 15 + seed + dir) * 0.03 * (0.4 + t) + Math.sin(u * 6.3 + seed * 1.7) * 0.02;
        row.push(put(u, y, 0.05 + fold + bulge, wall - dir * u * width));
      }
      rails.push(row);
    }
    const want = axis === 'x' ? [0, 0, -side] : [-side, 0, 0];
    B.rails(matKey, rails, { want, color: tint, par: swayPar, uvu: 1.2, uvv: 2 });
    // подхват-шнур
    const ty = yTop - h * tieT, tw = wTop * 0.28;
    const cp = put(0, ty, 0.1, wall - dir * tw * 0.4);
    B.box('cloth', cp, axis === 'x' ? [tw * 1.1, 0.045, 0.07] : [0.07, 0.045, tw * 1.1], { color: [0.55, 0.3, 0.14], par: [0, 0, 0] });
  }
  // ламбрекен (на всю ширину) с фестоном
  {
    const rails = [];
    for (let j = 0; j <= 2; j++) {
      const row = [];
      for (let i = 0; i <= 18; i++) { const u = i / 18, a = c0 - w / 2 + u * w, hang = 0.3 + 0.07 * Math.sin(u * Math.PI * 6 + seed); row.push(put(u, yTop - hang * (j / 2), 0.06 + 0.012 * Math.sin(u * 40), a)); }
      rails.push(row);
    }
    B.rails(matKey, rails, { want: axis === 'x' ? [0, 0, -side] : [-side, 0, 0], color: [tint[0] * 0.95, tint[1] * 0.95, tint[2] * 0.95], par: [0, 0, 0.12], uvu: 2, uvv: 1 });
  }
  // карниз-штанга
  const rp = put(0, yTop + 0.03, 0.05, c0);
  if (axis === 'x') B.cyl('wood', rp, 0.022, 0.022, w + 0.3, 6, { rot: [0, 0, Math.PI / 2], color: H.WOOD });
  else B.cyl('wood', rp, 0.022, 0.022, w + 0.3, 6, { rot: [Math.PI / 2, 0, 0], color: H.WOOD });
}

/** Пара сандалий у порога (снятая обувь — знак жилой комнаты). */
function sandals(H, x, z, yaw, n = 1) {
  const { B, R } = H;
  for (let i = 0; i < n; i++) {
    const px = x + i * 0.32, pz = z + (i % 2) * 0.05;
    for (const sd of [-0.075, 0.075]) {
      const ox = Math.cos(yaw) * sd, oz = -Math.sin(yaw) * sd;
      B.box('clothStatic', [px + ox, 0.012 + heightAtLocal(px, pz, 0), pz + oz], [0.095, 0.022, 0.27], { rot: [0, yaw + (R() - 0.5) * 0.3, 0], color: [0.34, 0.22, 0.13], par: [0, 0, 0] });
      B.box('clothStatic', [px + ox, 0.026 + heightAtLocal(px, pz, 0), pz + oz + 0.05], [0.085, 0.012, 0.1], { rot: [0, yaw, 0], color: [0.5, 0.36, 0.22], par: [0, 0, 0] });
    }
  }
}

function ring(H, x, y, z, r, rot, col) { H.B.geo('brass', new THREE.TorusGeometry(r, 0.007, 6, 14), { pos: [x, y, z], rot, color: col }); }

/** Стойка водяных колец: перекладина на двух стойках, кольца висят на шнурах; ось 'x' — вдоль x у стены z=zw (нормаль в сторону side). */
function ringsRack(H, x, z, axis, count = 12) {
  const { B, WOOD } = H, y0 = 2.25;
  const L = 1.5;
  if (axis === 'x') {
    B.box('wood', [x, y0, z], [L, 0.05, 0.05], { color: WOOD });
    for (const sx of [-L / 2, L / 2]) B.box('wood', [x + sx, y0 - 0.6, z], [0.05, 1.3, 0.05], { color: WOOD });
  } else {
    B.box('wood', [x, y0, z], [0.05, 0.05, L], { color: WOOD });
    for (const sz of [-L / 2, L / 2]) B.box('wood', [x, y0 - 0.6, z + sz], [0.05, 1.3, 0.05], { color: WOOD });
  }
  for (let i = 0; i < count; i++) {
    const u = -L / 2 + 0.1 + (i / (count - 1)) * (L - 0.2), drop = 0.1 + (i % 3) * 0.09;
    const px = axis === 'x' ? x + u : x, pz = axis === 'x' ? z : z + u;
    B.cyl('metal', [px, y0 - drop / 2, pz], 0.003, 0.003, drop, 3, { color: [0.6, 0.5, 0.35] });
    ring(H, px, y0 - drop - 0.05, pz, 0.05 + (i % 4) * 0.007, [0, axis === 'x' ? i * 0.3 : Math.PI / 2 + i * 0.3, 0], [0.75 + (i % 2) * 0.2, 0.62, 0.4]);
  }
}

/** Дистикомбы на вешалке (тёмные «шкуры» с трубками). Ось 'x'/'z' — направление перекладины. */
function suitsRack(H, x, z, axis, n = 3, y0 = 2.1) {
  const { B, WOOD, R } = H;
  const L = n * 0.62 + 0.3;
  if (axis === 'x') B.box('wood', [x, y0, z], [L, 0.06, 0.08], { color: WOOD }); else B.box('wood', [x, y0, z], [0.08, 0.06, L], { color: WOOD });
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + 0.35 + i * 0.62, c = 0.18 + R() * 0.06;
    const P = (a, b, v) => (axis === 'x' ? [x + u + a, b, z + v] : [x + v, b, z + u + a]);
    B.rails('cloth', [[P(-0.2, y0 - 0.05, 0), P(0.2, y0 - 0.05, 0)], [P(-0.27, y0 - 0.7, 0.03), P(0.27, y0 - 0.7, 0.03)], [P(-0.2, y0 - 1.3, 0.02), P(0.2, y0 - 1.3, 0.02)]], { want: axis === 'x' ? [0, 0, 1] : [1, 0, 0], color: [c, c * 0.95, c * 0.85], par: [0, 0, 0.5] });
    B.rails('cloth', [[P(-0.2, y0 - 0.05, 0), P(0.2, y0 - 0.05, 0)], [P(-0.27, y0 - 0.7, 0.03), P(0.27, y0 - 0.7, 0.03)], [P(-0.2, y0 - 1.3, 0.02), P(0.2, y0 - 1.3, 0.02)]], { want: axis === 'x' ? [0, 0, -1] : [-1, 0, 0], color: [c, c * 0.95, c * 0.85], par: [0, 0, 0.5] });
    B.sphere('clothStatic', P(0, y0 - 0.1, 0.0), 0.07, { color: [0.14, 0.13, 0.12], ws: 8, hs: 6 });
    // трубки уловителя влаги
    B.cyl('metal', P(0.2, y0 - 0.6, 0.06), 0.012, 0.012, 0.7, 5, { color: [0.4, 0.34, 0.3] });
  }
}

/** Крючья творца на доске (декоративные, «маорийские» крючки): два изогнутых крюка и верёвка. */
function hooksBoard(H, x, y, z, axis = 'x', nrm = 1) {
  const { B, WOOD } = H;
  if (axis === 'x') B.box('wood', [x, y, z], [0.9, 0.12, 0.04], { color: WOOD }); else B.box('wood', [x, y, z], [0.04, 0.12, 0.9], { color: WOOD });
  for (const k of [-0.28, 0.28]) {
    const px = axis === 'x' ? x + k : x + nrm * 0.07, pz = axis === 'x' ? z + nrm * 0.07 : z + k;
    B.geo('metal', new THREE.TorusGeometry(0.1, 0.014, 6, 12, 4.4), { pos: [px, y - 0.2, pz], rot: [axis === 'x' ? 0 : 0, axis === 'x' ? 0 : Math.PI / 2, 0.4], color: [0.14, 0.14, 0.16] });
    B.cyl('wood', [px, y - 0.05, pz], 0.014, 0.014, 0.16, 5, { color: [0.55, 0.42, 0.3] });
  }
}

/** Игрушки детского уголка: деревянный червь из шаров, кубики, кукла из тряпочки, «тамперок». */
function toys(H, x, z, yf = 0) {
  const { B, R, rug, goodsCols } = H;
  rug('carpetRed', x, z, 1.5, 1.2, (R() - 0.5) * 0.5, 0, yf);
  const y0 = heightAtLocal(x, z, yf);
  for (let i = 0; i < 7; i++) B.sphere('clothStatic', [x - 0.55 + i * 0.17, y0 + 0.07 + 0.012, z + Math.sin(i * 0.9) * 0.14], 0.085 - i * 0.004, { color: [0.35 + i * 0.03, 0.28, 0.42], ws: 8, hs: 6 });
  B.sphere('clothStatic', [x + 0.65, y0 + 0.08, z + 0.1], 0.09, { color: [0.4, 0.25, 0.3], ws: 8, hs: 6 });
  for (let i = 0; i < 4; i++) B.box('wood', [x - 0.2 + (i % 2) * 0.12, y0 + 0.05 + Math.floor(i / 2) * 0.09, z - 0.3 + (i % 2) * 0.03], [0.09, 0.09, 0.09], { rot: [0, R() * 3, 0], color: goodsCols[(i + 2) % 6] });
  B.cyl('wood', [x + 0.45, y0 + 0.18, z - 0.3], 0.012, 0.016, 0.36, 5, { rot: [0, 0, 0.9], color: [0.55, 0.42, 0.3] });
  B.cyl('clothStatic', [x + 0.1, y0 + 0.11, z + 0.35], 0.012, 0.07, 0.2, 8, { color: [0.7, 0.3, 0.2] });
  B.sphere('clothStatic', [x + 0.1, y0 + 0.24, z + 0.35], 0.045, { color: [0.62, 0.45, 0.34], ws: 8, hs: 6 });
}

/** Низкий стол с набором для пряного кофе и подушками по кругу. */
function lowTable(H, x, z, rot = 0, cups = 3) {
  const { B, R, cushion, goodsCols, WOOD } = H;
  const y0 = heightAtLocal(x, z, 0), c = Math.cos(rot), s = Math.sin(rot);
  const P = (a, b, h) => [x + a * c - b * s, y0 + h, z + a * s + b * c];
  B.box('wood', P(0, 0, 0.3), [1.25, 0.06, 0.8], { rot: [0, -rot, 0], color: [0.55, 0.4, 0.28], par: [0.7, 0, 0] });
  for (const [a, b] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]]) B.box('wood', P(a, b, 0.14), [0.07, 0.28, 0.07], { rot: [0, -rot, 0], color: WOOD });
  B.lathe('brass', DALLAH, P(-0.3, 0.05, 0.33), 10, { scale: [1.3, 1.3, 1.3] });
  for (let i = 0; i < cups; i++) B.lathe('brass', CUP, P(0.05 + i * 0.2, -0.12 + (i % 2) * 0.18, 0.33), 8, { scale: [1.3, 1.3, 1.3] });
  B.cyl('clay', P(0.35, 0.25, 0.37), 0.08, 0.1, 0.1, 8, { color: [0.5, 0.3, 0.22] });
  for (let i = 0; i < 4; i++) { const a = rot + i * Math.PI / 2 + 0.4; cushion(x + Math.cos(a) * 1.0, z + Math.sin(a) * 0.85, goodsCols[(i + 1) % 6], 1); }
  addBlock({ x0: x - 0.7, x1: x + 0.7, z0: z - 0.5, z1: z + 0.5 }, 0);
}

/** Спальное место: ковёр, тюфяк, подушка; yaw — направление «головой» (atan2(dx,dz)). Возвращает спот для спящего. */
function bed(H, x, z, yawHead, col, yf = 0) {
  const { B, R, rug } = H;
  const y0 = heightAtLocal(x, z, yf);
  const hx = Math.sin(yawHead), hz = Math.cos(yawHead);
  rug(['carpetBlue', 'carpetRed', 'carpetOchre'][Math.floor(R() * 3)], x, z, 1.1, 2.3, -yawHead, 0, yf);
  B.box('clothStatic', [x, y0 + 0.07, z], [0.78, 0.1, 1.9], { rot: [0, yawHead, 0], color: col, par: [0, 0, 0] });
  B.sphere('clothStatic', [x + hx * 0.78, y0 + 0.17, z + hz * 0.78], 0.17, { scale: [1.5, 0.6, 1.0], color: [0.78, 0.72, 0.6], ws: 10, hs: 6, rot: [0, yawHead, 0] });
  // свёрнутое одеяло в ногах
  B.cyl('clothStatic', [x - hx * 0.78, y0 + 0.16, z - hz * 0.78], 0.1, 0.1, 0.66, 8, { rot: [0, yawHead + Math.PI / 2, Math.PI / 2], color: [0.3, 0.26, 0.4] });
  return { x: x - hx * 0.05, z: z - hz * 0.05, yaw: yawHead, y: y0 + 0.14 };
}

export function buildRooms(H) {
  const { B, ctx, R, S, jar, rug, cushion, goodsCols, WOOD, kKeys } = H;
  B.region = 'B3';
  ctx.niches = []; ctx.rooms = [];
  for (const n of NICHES) {
    const s = n.side, xc = n.xc, zc = n.zc, rx = n.rx, rz = n.rz;
    const yfl = heightAtLocal(xc, zc, 0);
    const mouth = n.mouth;
    ctx.niches.push({ ...n, cx: xc, mouthZ: mouth, zn: zc });
    ctx.rooms.push({ id: n.id, xc, zc, side: s, rx, rz, kind: n.kind });
    if (n.kind === 'shrine') continue; // святилище оформляется отдельно (index/props: B3-shrine)
    // --- занавесь: подвязана; в открытых комнатах — собрана к самым краям
    tiedCurtain(H, { x: xc, z: mouth, w: 2.3, yTop: 2.3, h: 2.25, side: s, key: kKeys[(n.curtain * 2 + (xc | 0)) % 6], seed: xc, open: n.open ? 0.88 : 0.66, tint: [0.92, 0.92, 0.92] });
    if (!n.open) (ctx.curtains ||= []).push({ x: xc, z: mouth, axis: 'x', side: s, w: 2.3, yTop: 2.3, h: 2.25 });
    // --- у порога: сандалии, водяные кольца на гвоздях, свет — шар (см. globes)
    sandals(H, xc - 0.55, mouth - s * 0.75, s > 0 ? 0 : Math.PI, 2);
    // --- спальные места у дальней стены
    const nb = n.id === 'Ns2' ? 3 : n.id === 'Nn1' ? 2 : n.rz > 3 ? 3 : 2;
    const sleepers = [];
    for (let i = 0; i < nb; i++) {
      const dx = (i - (nb - 1) / 2) * 1.05;
      const wz = roomWallZ(n, dx, 0.5) ?? zc + s * rz * 0.8;
      const bz = wz - s * 1.25;
      const sp = bed(H, xc + dx + (n.id === 'Ns2' ? -0.3 : 0), bz, s > 0 ? 0 : Math.PI, goodsCols[(i + n.curtain * 2) % 6].map((v) => v * 0.8));
      sleepers.push(sp);
    }
    S.sleep.push(...sleepers.slice(0, n.id === 'Nn2' || n.id === 'Ns2' || n.id === 'Nn0' ? 1 : 0).map((sp) => ({ ...sp, room: n.id })));
    // --- центр: низкий стол с кофейным набором (в «семейных» и «старших» комнатах)
    const tz = zc - s * Math.min(0.2, rz * 0.1);
    if (n.id !== 'Ns0') {
      lowTable(H, xc + 0.15, tz, 0.1, 3);
      S.family.push({ x: xc + 0.15, z: tz + s * 1.15, yaw: faceYaw(0, -s), room: n.id }, { x: xc - 1.0, z: tz, yaw: faceYaw(1, 0), room: n.id });
    }
    // --- стойка водяных колец у западной стены, дистикомбы у восточной
    const wxW = roomWallX(n, 0, 2.0, -1) ?? xc - rx, wxE = roomWallX(n, -s * 0.5, 2.0, 1) ?? xc + rx;
    ringsRack(H, wxW + 0.28, zc + s * rz * 0.15, 'z', 11);
    suitsRack(H, wxE - 0.3, zc + s * rz * 0.1, 'z', n.rz > 3 ? 3 : 2);
    // --- кладовые ниши: большие кувшины, сундуки, корзины
    for (const sx of [-1, 1]) {
      const px = xc + sx * (rx - 0.45), pz = zc + s * rz * 0.35;
      jar(px, pz, true, goodsCols[(Math.abs(Math.round(px)) + 1) % 6].map((v) => v * 0.9), yfl);
      jar(px + sx * -0.18, pz + 0.55, false, undefined, yfl);
    }
    B.box('wood', [xc + 1.6, yfl + 0.2, wxE ? zc + s * (rz - 1.0) : zc], [0.7, 0.4, 0.42], { color: [0.45, 0.34, 0.24], rot: [0, 0.15, 0] });
    // --- крючья творца над постелью
    {
      const wz = roomWallZ(n, 0, 2.15);
      if (wz !== null) hooksBoard(H, xc, 2.15, wz - s * 0.1, 'x', -s);
    }
    // --- детский уголок
    if (n.id === 'Nn1' || n.id === 'Ns2' || n.id === 'Nn0') { const kx = xc + (n.id === 'Nn0' ? -0.6 : -1.5), kz = zc + s * (rz * 0.35); toys(H, kx, kz, 0); S.kidroom.push({ x: kx, z: kz, room: n.id }); }
    // --- профессия комнаты
    if (n.id === 'Nn0') { // ткацкая комната: станок у восточной стены
      const lx = xc + 1.1, lz = zc + s * (rz - 0.7);
      for (const sx of [-0.8, 0.8]) B.box('wood', [lx + sx, 1.0, lz], [0.1, 2.0, 0.14], { color: WOOD });
      B.box('wood', [lx, 1.95, lz], [1.8, 0.12, 0.16], { color: WOOD }); B.box('wood', [lx, 0.4, lz], [1.7, 0.09, 0.12], { color: WOOD });
      for (let i = 0; i < 24; i++) B.box('clothStatic', [lx - 0.74 + (i / 23) * 1.48, 1.2, lz], [0.006, 1.5, 0.006], { color: [0.85, 0.8, 0.7] });
      B.rails('cloth:stripeBlue', [[[lx - 0.7, 0.6, lz + 0.01], [lx + 0.7, 0.6, lz + 0.01]], [[lx - 0.7, 1.15, lz + 0.01], [lx + 0.7, 1.15, lz + 0.01]]], { want: [0, 0, 1], par: [0, 0, 0.1], uvu: 2, uvv: 1 });
      addBlock({ x0: lx - 0.95, x1: lx + 0.95, z0: Math.min(lz, lz) - 0.25, z1: lz + 0.25 }, 0);
      S.loom.push({ x: lx, z: lz - s * 0.95, yaw: faceYaw(0, s), cx: lx, cz: lz, room: n.id });
      for (let i = 0; i < 4; i++) B.sphere('clothStatic', [lx - 1.2 + i * 0.3, yfl + 0.12, lz - s * 1.5 + (i % 2) * 0.2], 0.12, { color: [[0.2, 0.3, 0.6], [0.6, 0.25, 0.2], [0.8, 0.7, 0.4], [0.3, 0.5, 0.3]][i], ws: 8, hs: 6 });
    }
    if (n.id === 'Ns0') { // кладовая-«пантри»: ряды кувшинов и мешков, связки трав под потолком
      for (let i = 0; i < 7; i++) jar(xc - 2 + (i % 4) * 0.7, zc + s * (0.4 + Math.floor(i / 4) * 0.8), i % 3 === 0, goodsCols[i % 6].map((v) => v * 0.9), yfl);
      for (let i = 0; i < 5; i++) B.sphere('clothStatic', [xc + 0.8 + i * 0.42, yfl + 0.22, zc + s * (rz - 0.5)], 0.26, { scale: [1.2, 0.8, 0.9], color: goodsCols[i % 6], ws: 8, hs: 6 });
      for (let i = 0; i < 6; i++) { const hx = xc - 1.2 + i * 0.5; B.cyl('cloth', [hx, 2.45, zc + s * 0.2], 0.03, 0.05, 0.4, 6, { color: [0.35 + (i % 2) * 0.12, 0.42, 0.25], par: [0, 0, 0.6] }); }
    }
    if (n.id === 'Ns1') { // мастерская дистикомбов (открытая): верстак и вторая вешалка
      suitsRack(H, xc - 0.2, zc + s * (rz - 0.35), 'x', 3, 2.15);
      B.box('wood', [xc + 1.2, 0.5, zc - s * 0.4], [1.3, 0.08, 0.7], { color: [0.55, 0.42, 0.3], par: [0.7, 0, 0] });
      for (const [a, b] of [[-0.5, -0.25], [0.5, -0.25], [-0.5, 0.25], [0.5, 0.25]]) B.box('wood', [xc + 1.2 + a, 0.25, zc - s * 0.4 + b], [0.07, 0.5, 0.07], { color: WOOD });
      B.lathe('brass', POT, [xc + 1.5, 0.54, zc - s * 0.4], 10, { scale: [1.4, 1.4, 1.4] });
      for (let i = 0; i < 3; i++) B.geo('metal', new THREE.TorusGeometry(0.13 + i * 0.02, 0.011, 6, 18, 4.2), { pos: [xc + 0.9 + i * 0.12, 0.56, zc - s * 0.3 - i * 0.08], rot: [Math.PI / 2, 0, i], color: [0.2, 0.2, 0.18] });
      addBlock({ x0: xc + 0.5, x1: xc + 1.9, z0: Math.min(zc - s * 0.8, zc - s * 0.0) - 0.05, z1: Math.max(zc - s * 0.8, zc - s * 0.0) + 0.05 }, 0);
      S.repair.push({ x: xc + 1.2, z: zc + s * 0.4, yaw: faceYaw(0, -s), role: 'artisan', room: n.id });
    }
    if (n.id === 'Nn2') { // комната старших: жаровня-кофейник, два кресла-подушки у стола
      B.cyl('clay', [xc - 1.6, yfl + 0.14, zc + s * 0.6], 0.2, 0.26, 0.28, 10, { color: [0.45, 0.28, 0.2] });
      B.cyl('metal', [xc - 1.6, yfl + 0.29, zc + s * 0.6], 0.17, 0.17, 0.03, 10, { color: [0.15, 0.14, 0.13] });
      S.family.push({ x: xc + 1.3, z: tz - s * 0.2, yaw: faceYaw(-1, 0), room: n.id });
    }
  }
}

/** Спальные эркеры карниза (B2, y=6): постели, сундуки, кувшины, подвязанные занавеси на проёме, крючья. */
export function buildBays(H) {
  const { B, ctx, R, S, jar, rug, cushion, goodsCols, kKeys, WOOD } = H;
  B.region = 'B2';
  const yf = 6.5;
  SHELF_BAYS.forEach((x, i) => {
    for (const s of [-1, 1]) {
      const bx = x + (s > 0 ? 1 : 0), cz = s * BAY.cz;
      const yfl = heightAtLocal(bx, cz, yf);
      // занавесь на границе эркера (z = ±6.4): шире, подвязана
      tiedCurtain(H, { x: bx, z: s * 6.35, w: 4.2, yTop: 8.55, h: 2.4, side: s, key: kKeys[(x + s + 5) % 6 | 0], seed: x * 0.7, open: 0.74, tint: [0.9, 0.9, 0.9] });
      (ctx.curtains ||= []).push({ x: bx, z: s * 6.35, axis: 'x', side: s, w: 4.2, yTop: 8.55, h: 2.4 });
      // постели: два спальных места вдоль дальней стены и ковёр
      const sleepers = [];
      for (let k = 0; k < 2; k++) {
        const bz = s * (BAY.cz + 0.7);
        sleepers.push(bed(H, bx - 1.0 + k * 1.35, bz, s > 0 ? 0 : Math.PI, goodsCols[(i + k + 2) % 6].map((v) => v * 0.8), yf));
      }
      if ((i + (s > 0 ? 1 : 0)) % 3 === 0) S.sleep.push({ ...sleepers[0], room: `Bay${i}${s}`, level: 1 });
      rug('carpetOchre', bx + 0.4, s * (BAY.cz - 1.4), 3.0, 1.5, 0.1, 0, yf);
      cushion(bx - 1.6, s * (BAY.cz - 1.2), goodsCols[(i + 3) % 6], 0.9, yf); cushion(bx + 1.8, s * (BAY.cz - 1.5), goodsCols[(i + 5) % 6], 0.9, yf);
      B.box('wood', [bx + 1.7, yfl + 0.2, s * (BAY.cz + 1.4)], [0.7, 0.4, 0.45], { color: [0.45, 0.34, 0.24], rot: [0, 0.2, 0] });
      jar(bx - 1.9, s * (BAY.cz + 1.3), true, goodsCols[(i + 1) % 6].map((v) => v * 0.9), yfl); jar(bx - 1.55, s * (BAY.cz + 1.55), false, undefined, yfl);
      // крючья творца и стойка колец на дальней стене
      const k = 1 - ((8.4 - BAY.cy) / BAY.ry) ** 2, zw = cz + s * BAY.rz * Math.sqrt(Math.max(0.1, k)) * 0.98;
      hooksBoard(H, bx, 8.5, zw - s * 0.12, 'x', -s);
      sandals(H, bx - 0.4, s * 6.9, s > 0 ? 0 : Math.PI, 1);
    }
  });
}

/** Кухня галереи (северная ниша x=92): глиняный очаг с углями, большой котёл, стол с хлебом и пряностями, связки трав, корзины с топливом. Дым уходит вверх (life.js). */
export function buildKitchen(H) {
  const { B, ctx, R, S, jar, goodsCols, WOOD } = H;
  B.region = 'B2';
  const sx = 91.2, sz = -6.35, y0 = heightAtLocal(sx, sz, 0);
  B.cyl('clay', [sx, y0 + 0.32, sz], 0.44, 0.52, 0.64, 14, { color: [0.62, 0.44, 0.32], par: [0.2, 0.7, 0] });
  B.box('clothStatic', [sx, y0 + 0.24, sz + 0.42], [0.4, 0.26, 0.08], { color: [0.04, 0.025, 0.015], par: [0, 0, 0] });
  B.cyl('metal', [sx, y0 + 0.67, sz], 0.42, 0.42, 0.04, 14, { color: [0.2, 0.18, 0.16] });
  B.lathe('brass', POT, [sx, y0 + 0.69, sz], 14, { scale: [2.6, 2.4, 2.6], color: [0.78, 0.52, 0.28], par: [0.4, 0.5, 0] });
  B.cyl('brass', [sx, y0 + 1.5, sz], 0.012, 0.012, 1.6, 5, { color: [0.4, 0.34, 0.28] });
  addBlock({ cx: sx, cz: sz, r: 0.62 }, 0);
  ctx.fire = { x: sx, y: y0 + 0.26, z: sz + 0.4 };
  // стол-прилавок кухни
  const cx = 92.7, cz = -4.55;
  B.box('wood', [cx, y0 + 0.9, cz], [1.9, 0.07, 0.85], { color: [0.58, 0.43, 0.3], par: [0.7, 0.3, 0] });
  for (const [a, b] of [[-0.85, -0.35], [0.85, -0.35], [-0.85, 0.35], [0.85, 0.35]]) B.box('wood', [cx + a, y0 + 0.45, cz + b], [0.08, 0.9, 0.08], { color: WOOD });
  for (let i = 0; i < 4; i++) B.cyl('clay', [cx - 0.7 + i * 0.28, y0 + 0.97, cz - 0.1 + (i % 2) * 0.2], 0.12, 0.09, 0.06, 10, { color: [0.62, 0.44, 0.32] });
  for (let i = 0; i < 3; i++) B.cyl('clothStatic', [cx + 0.45, y0 + 0.95 + i * 0.03, cz + 0.12], 0.17, 0.17, 0.025, 12, { color: [0.78, 0.6, 0.34], par: [0, 0, 0] });
  B.lathe('brass', DALLAH, [cx + 0.1, y0 + 0.93, cz - 0.15], 10, { scale: [1.4, 1.4, 1.4] });
  addBlock({ x0: cx - 1.0, x1: cx + 1.0, z0: cz - 0.45, z1: cz + 0.45 }, 0);
  // полка с пряностями на дальней стене и связки трав/перца
  B.box('wood', [91.8, y0 + 1.7, -7.05], [2.3, 0.05, 0.28], { color: WOOD });
  for (let i = 0; i < 9; i++) { const c = [[0.72, 0.38, 0.16], [0.55, 0.22, 0.14], [0.78, 0.62, 0.3], [0.36, 0.5, 0.3]][i % 4]; B.cyl('clay', [90.8 + i * 0.25, y0 + 1.82, -7.0], 0.07, 0.08, 0.16, 8, { color: c }); }
  for (let i = 0; i < 5; i++) B.cyl('cloth', [90.9 + i * 0.45, y0 + 2.5, -6.8], 0.03, 0.06, 0.45, 6, { color: [0.62 - (i % 2) * 0.25, 0.28 + (i % 2) * 0.2, 0.14], par: [0, 0, 0.6] });
  for (let i = 0; i < 3; i++) B.sphere('clothStatic', [89.9 + i * 0.5, y0 + 0.2, -5.8 - i * 0.2], 0.22, { scale: [1.2, 0.8, 1], color: [0.45, 0.38, 0.28], ws: 8, hs: 6 });   // корзины с топливом
  jar(93.1, -6.7, true, [0.62, 0.46, 0.34], y0);
  S.cook.push({ x: 92.0, z: -5.4, yaw: faceYaw(-0.9, -0.9) });
}

/** Музыкант на ковре в галерее и слушатели на подушках вокруг. */
export function buildMusic(H) {
  const { B, ctx, R, S, rug, cushion, goodsCols } = H;
  B.region = 'B2';
  const x = 66.4, z = -0.9;
  rug('carpetOchre', x, z - 0.1, 3.0, 2.2, 0.0, 1, 0);
  cushion(x, z + 0.15, goodsCols[4], 1.25, 0);
  S.musician.push({ x, z: z + 0.15, yaw: faceYaw(0.35, 1) });
  for (const [dx, dz, yaw] of [[-1.5, 0.9, faceYaw(1.4, -0.7)], [1.6, 0.8, faceYaw(-1.4, -0.6)], [0.1, 1.9, faceYaw(0, -1)]]) { cushion(x + dx, z + dz, goodsCols[(Math.abs(dx * 3) | 0) % 6], 1, 0); S.audience.push({ x: x + dx, z: z + dz, yaw }); }
}

export const roomHelpers = { sandals, ringsRack, suitsRack, hooksBoard, toys, lowTable, bed };
