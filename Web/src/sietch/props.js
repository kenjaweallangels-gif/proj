// Реквизит: рынок B2 (прилавки, станки, водонос, мастерская дистикомбов, детская), стойки B1, коврики B3, зал.
// Заполняет ctx.spots — точки деятельности для толпы; addBlock — коллизия реквизита.
import * as THREE from 'three';
import { addBlock, cell, GALLERY } from './plan.js';
import { rng, clamp } from '../core/util.js';

const J_A = [[0.0, 0], [0.22, 0.0], [0.28, 0.12], [0.28, 0.4], [0.2, 0.68], [0.14, 0.76], [0.17, 0.8], [0.14, 0.82], [0.12, 0.76]];
const J_B = [[0.0, 0], [0.2, 0.0], [0.27, 0.15], [0.28, 0.6], [0.22, 1.0], [0.12, 1.12], [0.15, 1.2], [0.12, 1.22], [0.1, 1.1]];
const CUP = [[0.0, 0], [0.03, 0], [0.035, 0.02], [0.05, 0.08], [0.045, 0.085], [0.03, 0.02]];
const POT = [[0.0, 0], [0.07, 0], [0.09, 0.04], [0.06, 0.14], [0.04, 0.2], [0.03, 0.26], [0.05, 0.3], [0.03, 0.29]];

export const faceYaw = (dx, dz) => Math.atan2(dx, dz);

export function buildProps(B, ctx) {
  const R = rng(909);
  const S = ctx.spots = { loom: [], stall: [], water: [], repair: [], play: [], bench: [], mat: [], hooks: [], guard: [], coffee: [], funeral: [], shrine: [], quarrel: [], whisper: [], lane: [], elder: [], door: [] };
  const clothKeys = ['stripeOchre', 'stripeBlue', 'stripeRed', 'plain'];
  const goodsCols = [[0.72, 0.38, 0.16], [0.55, 0.22, 0.14], [0.78, 0.62, 0.3], [0.25, 0.36, 0.52], [0.5, 0.45, 0.2], [0.36, 0.5, 0.3]];

  const jar = (x, y, z, big, col) => {
    B.lathe('clay', big ? J_B : J_A, [x, y, z], 14, { color: col || [0.78 + R() * 0.2, 0.52 + R() * 0.15, 0.36], par: [0.2, 0, 0] });
    B.cyl('clay', [x, y + (big ? 1.22 : 0.82), z], 0.12, 0.12, 0.02, 10, { color: [0.2, 0.15, 0.1] });
  };

  // --- Прилавок с навесом и товаром. side: -1 (север, спиной к стене z=-7.5), +1 (юг).
  function stall(x, side, kind) {
    const wz = side * 7.5;
    const zc = wz - side * 2.0;                       // центр прилавка (за ним — проход для торговца)
    B.region = 'B2';
    B.box('stone', [x, 0.5, zc], [2.6, 1.0, 0.9], { par: [0.6, 0.1, 0] });
    B.box('stone', [x, 1.03, zc], [2.75, 0.07, 1.05], { par: [1, 0, 0], color: [1.05, 0.98, 0.9] });
    B.box('wood', [x, 0.45, zc - side * 0.52], [2.4, 0.9, 0.05], { color: [0.9, 0.62, 0.42] });
    addBlock({ x0: x - 1.4, x1: x + 1.4, z0: Math.min(zc - 0.6, zc + 0.6), z1: Math.max(zc - 0.6, zc + 0.6) }, 0);
    // стойки навеса и полотно-«крыша» с наклоном к зрителю
    for (const sx of [-1.4, 1.4]) { B.cyl('wood', [x + sx, 1.4, wz - side * 2.9], 0.04, 0.05, 2.8, 6, { color: [0.5, 0.38, 0.26] }); }
    const key = clothKeys[Math.floor(R() * 4)];
    const rails = [];
    const w = 3.2, nx = 8, nz = 5;
    for (let j = 0; j <= nz; j++) {
      const t = j / nz, row = [];
      for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const zz = wz - side * (0.1 + 2.9 * t);
        const yy = 3.0 - 0.75 * t - 0.14 * Math.sin(u * Math.PI * 3) * (t > 0.2 ? 1 : 0.3) - 0.1 * Math.sin(t * Math.PI);
        row.push([x - w / 2 + w * u, yy, zz]);
      }
      rails.push(row);
    }
    B.rails(`cloth:${key}`, rails, { want: [0, 1, 0], par: (px, py, pz) => [0, 0, clamp((Math.abs(pz - wz) - 0.3) / 2, 0, 1)], uvu: 2, uvv: 1 });
    B.rails(`cloth:${key}`, rails, { want: [0, -1, 0], par: (px, py, pz) => [0, 0, clamp((Math.abs(pz - wz) - 0.3) / 2, 0, 1)], uvu: 2, uvv: 1 });
    // кайма-бахрома
    const fr = rails[nz].map((p) => [p[0], p[1] - 0.18, p[2]]);
    B.rails(`cloth:${key}`, [rails[nz], fr], { want: [0, 0, side], par: [0, 0, 1], uvu: 4, uvv: 0.1 });
    // товар
    const n = 5 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const gx = x - 1.1 + R() * 2.2, gz = zc + (R() - 0.5) * 0.5, c = goodsCols[Math.floor(R() * goodsCols.length)];
      const t = R();
      if (kind === 'spice' || t < 0.35) { B.cyl('cloth', [gx, 1.1 + 0.11, gz], 0.01, 0.17, 0.22, 10, { color: c, par: [0, 0, 0] }); B.cyl('clay', [gx, 1.1 + 0.04, gz], 0.2, 0.2, 0.08, 10, { color: [0.45, 0.32, 0.22] }); }
      else if (t < 0.65) B.box('wood', [gx, 1.27, gz], [0.36, 0.2, 0.28], { rot: [0, R() * 3, 0], color: [0.6 + R() * 0.15, 0.45, 0.3] });
      else B.cyl('clothStatic', [gx, 1.2, gz], 0.1, 0.1, 0.42 + R() * 0.1, 10, { rot: [0, 0, Math.PI / 2], color: c });
    }
    // подвесные пучки и связки на навесе
    for (let i = 0; i < 4; i++) { const hx = x - 1.2 + i * 0.8; B.cyl('clothStatic', [hx, 2.2 - R() * 0.2, wz - side * 1.4], 0.015, 0.05, 0.4, 5, { color: goodsCols[i % 6] }); }
    // стул/ящик для торговца и точка торговца
    B.box('wood', [x - 1.0, 0.22, zc + side * 0.95], [0.5, 0.44, 0.5], { color: [0.7, 0.52, 0.36] });
    S.stall.push({ x, z: wz - side * 1.1, yaw: faceYaw(0, -side), side, cx: x, cz: zc });
    return { x, zc };
  }
  [56, 62, 68, 86, 92].forEach((x, i) => stall(x, -1, i % 2 ? 'spice' : 'goods'));
  [74, 86, 92].forEach((x, i) => stall(x, 1, i % 2 ? 'goods' : 'spice'));

  // --- Ткацкие станки (юг, запад галереи).
  function loom(x, z) {
    B.region = 'B2';
    const h = 2.2, w = 2.0;
    for (const sx of [-w / 2, w / 2]) B.box('wood', [x + sx, h / 2, z], [0.12, h, 0.16], { color: [0.45, 0.34, 0.24] });
    B.box('wood', [x, h - 0.05, z], [w + 0.3, 0.14, 0.18], { color: [0.45, 0.34, 0.24] });
    B.box('wood', [x, 0.5, z], [w + 0.2, 0.1, 0.14], { color: [0.45, 0.34, 0.24] });
    B.box('wood', [x, 1.3, z - 0.18], [w, 0.06, 0.06], { color: [0.55, 0.4, 0.28] });
    // нити основы
    for (let i = 0; i < 38; i++) { const px = x - w / 2 + 0.08 + (i / 37) * (w - 0.16); B.box('clothStatic', [px, 1.38, z], [0.006, 1.7, 0.006], { color: [0.85, 0.8, 0.7] }); }
    // готовое полотно (синее) снизу
    B.rails('cloth:blueCloth', [[[x - w / 2 + 0.07, 0.55, z + 0.01], [x + w / 2 - 0.07, 0.55, z + 0.01]], [[x - w / 2 + 0.07, 1.25, z + 0.01], [x + w / 2 - 0.07, 1.25, z + 0.01]]], { want: [0, 0, 1], par: [0, 0, 0.1], uvu: 2, uvv: 1 });
    B.rails('cloth:blueCloth', [[[x - w / 2 + 0.07, 0.55, z - 0.01], [x + w / 2 - 0.07, 0.55, z - 0.01]], [[x - w / 2 + 0.07, 1.25, z - 0.01], [x + w / 2 - 0.07, 1.25, z - 0.01]]], { want: [0, 0, -1], par: [0, 0, 0.1], uvu: 2, uvv: 1 });
    // катушки и челнок
    for (let i = 0; i < 3; i++) B.cyl('clothStatic', [x - 0.6 + i * 0.5, 0.07, z - 0.5], 0.07, 0.07, 0.14, 8, { color: [[0.2, 0.3, 0.6], [0.6, 0.25, 0.2], [0.8, 0.7, 0.4]][i] });
    B.box('wood', [x - 0.2, 0.22, z - 0.9], [0.5, 0.44, 0.5], { color: [0.7, 0.52, 0.36] });
    addBlock({ x0: x - 1.2, x1: x + 1.2, z0: z - 0.3, z1: z + 0.3 }, 0);
    S.loom.push({ x: x - 0.2, z: z - 0.95, yaw: faceYaw(0, 1), cx: x, cz: z });
  }
  loom(56, 6.55); loom(62, 6.55); loom(68, 6.55);
  // Нить основы свисает с балки (расцветка-полосы)
  for (let i = 0; i < 3; i++) B.box('cloth', [48 + i * 0.4, 1.0, 6.9], [0.04, 2.0, 0.01], { color: [0.2, 0.3, 0.6], par: [0, 0, 1] });

  // --- Торговка водой (юг, x=79).
  {
    const x = 80, z = 6.2;
    B.box('stone', [x, 0.45, z], [2.2, 0.9, 0.9], { par: [0.6, 0.1, 0] });
    B.box('stone', [x, 0.93, z], [2.35, 0.07, 1.05], { par: [1, 0, 0] });
    B.box('cloth', [x, 0.975, z], [1.6, 0.012, 0.6], { color: [0.15, 0.3, 0.55], par: [0, 0, 0] });
    for (let i = 0; i < 5; i++) B.lathe('brass', CUP, [x - 0.7 + i * 0.28, 0.97, z + 0.2], 10, { scale: [1.4, 1.4, 1.4] });
    B.lathe('brass', POT, [x + 0.6, 0.97, z - 0.1], 10, { scale: [1.6, 1.6, 1.6] });
    jar(x - 0.9, 0.0, z - 0.8, true, [0.6, 0.45, 0.34]); jar(x + 0.9, 0.0, z - 0.9, true, [0.66, 0.5, 0.36]); jar(x + 1.45, 0.0, z - 0.2, false, [0.6, 0.45, 0.34]);
    // мерные кувшинчики
    for (let i = 0; i < 3; i++) B.lathe('brass', CUP, [x - 0.3 + i * 0.3, 0.97, z - 0.1], 10, { scale: [2.0, 2.2, 2.0] });
    // стойка водяных колец над прилавком
    B.box('wood', [x, 2.2, z + 0.1], [1.6, 0.05, 0.05], { color: [0.45, 0.34, 0.24] });
    for (const sx of [-0.8, 0.8]) B.box('wood', [x + sx, 1.6, z + 0.1], [0.05, 1.2, 0.05], { color: [0.45, 0.34, 0.24] });
    for (let i = 0; i < 14; i++) {
      const rx = x - 0.7 + (i / 13) * 1.4, ry = 2.1 - (i % 3) * 0.1;
      B.cyl('metal', [rx, 2.12 - (i % 3) * 0.05, z + 0.1], 0.003, 0.003, 0.12 + (i % 3) * 0.1, 3, { color: [0.6, 0.5, 0.35] });
      B.geo('brass', new THREE.TorusGeometry(0.05 + (i % 4) * 0.007, 0.007, 6, 14), { pos: [rx, ry - 0.2 - (i % 3) * 0.06, z + 0.1], rot: [0, i * 0.3, 0], color: [0.75 + (i % 2) * 0.2, 0.62, 0.4] });
    }
    addBlock({ x0: x - 1.2, x1: x + 1.2, z0: z - 0.55, z1: z + 0.55 }, 0);
    S.water.push({ x: x, z: z + 0.95, yaw: faceYaw(0, -1), cx: x, cz: z });
    ctx.poi.waterRings = [x, 2.0, z + 0.1];
  }

  // --- Мастерская дистикомбов (север, x=89 → занят прилавком? используем x=76.5/-6).
  {
    const x = 80, z = -6.2;
    B.box('stone', [x, 0.42, z], [2.1, 0.84, 1.0], { par: [0.7, 0.1, 0] });
    B.box('wood', [x, 0.88, z], [2.2, 0.08, 1.1], { color: [0.5, 0.38, 0.26] });
    // детали: помпа, трубки, дистикомб на крючьях
    B.cyl('metal', [x - 0.6, 1.12, z], 0.05, 0.05, 0.4, 8, { color: [0.5, 0.42, 0.34] });
    B.sphere('metal', [x - 0.6, 1.36, z], 0.07, { color: [0.55, 0.45, 0.34] });
    for (let i = 0; i < 4; i++) B.geo('metal', new THREE.TorusGeometry(0.13 + i * 0.02, 0.011, 6, 18, 4.2), { pos: [x + 0.1 + i * 0.1, 0.94, z + 0.2 - i * 0.1], rot: [Math.PI / 2, 0, i], color: [0.2, 0.2, 0.18] });
    B.box('cloth', [x + 0.5, 0.97, z - 0.1], [0.7, 0.04, 0.5], { color: [0.2, 0.18, 0.16], par: [0, 0, 0] });
    B.lathe('clay', J_A, [x + 0.9, 0.88, z - 0.2], 12, { scale: [0.55, 0.55, 0.55], color: [0.7, 0.5, 0.36] });
    // стойка с дистикомбами на стене
    B.box('wood', [x, 2.0, -7.38], [2.4, 0.06, 0.1], { color: [0.45, 0.34, 0.24] });
    for (let i = 0; i < 4; i++) B.rails('cloth', [[[x - 1.0 + i * 0.6, 2.0, -7.32], [x - 0.7 + i * 0.6, 2.0, -7.32]], [[x - 1.0 + i * 0.6, 0.9, -7.28], [x - 0.7 + i * 0.6, 0.9, -7.28]]], { want: [0, 0, 1], color: [0.22 + i * 0.02, 0.2, 0.18], par: [0, 0, 0.6] });
    B.box('wood', [x + 1.3, 0.22, z + 0.8], [0.5, 0.44, 0.5], { color: [0.45, 0.34, 0.24] });
    addBlock({ x0: x - 1.2, x1: x + 1.2, z0: z - 0.6, z1: z + 0.6 }, 0);
    S.repair.push({ x: x - 0.3, z: z + 0.85, yaw: faceYaw(0, -1), role: 'artisan' }, { x: x + 0.4, z: z + 1.5, yaw: faceYaw(0, -1), role: 'client' });
  }

  // --- Детская зона у лестницы (x 43..51, z -3..3): ковры, подушки, одеяло-«червь».
  {
    B.region = 'B2';
    const place = (key, x, z, w, d, rot = 0, y = 0.025) => {
      const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
      const p = (u, v) => [x + u * c - v * s, y, z + u * s + v * c];
      B.rails(`carpet:${key}`, [[p(-hw, -hd), p(hw, -hd)], [p(-hw, hd), p(hw, hd)]], { want: [0, 1, 0], par: [0, 0, 0], uvu: 1, uvv: 1 });
    };
    place('carpetRed', 47, -0.5, 3.4, 2.4, 0.15); place('carpetBlue', 44.8, 2.4, 2.8, 2.0, -0.2); place('carpetOchre', 49, 2.6, 2.4, 1.8, 0.4);
    for (let i = 0; i < 5; i++) B.cyl('clothStatic', [44 + R() * 6, 0.12, -2 + R() * 4.5], 0.2, 0.22, 0.22, 10, { color: goodsCols[i % 6] });
    // «червь» — тёмное одеяло горкой
    for (let i = 0; i < 6; i++) B.sphere('clothStatic', [46.4 + i * 0.32, 0.18 + Math.sin(i * 0.9) * 0.1, -0.2 + Math.sin(i * 1.2) * 0.22], 0.22 - i * 0.012, { color: [0.35, 0.28, 0.4], ws: 10, hs: 6 });
    S.play.push({ x: 47, z: -0.5, r: 2.4 });
    // ковры вдоль центральной аллеи
    place('carpetRed', 60, 0, 3.2, 2.2, 0.0); place('carpetBlue', 66, -1.4, 2.8, 1.9, 0.1); place('carpetOchre', 72, 1.2, 2.8, 1.9, -0.1); place('carpetBlue', 83, 0.3, 3.2, 2.2, 0.05); place('carpetRed', 91, -0.8, 2.8, 2, 0.3);
    // кофе-ниша: низкая скамья, кофейник, чашки (x=96..99, юг)
    B.box('stone', [97.3, 0.25, 6.8], [2.4, 0.5, 0.7], { par: [0.9, 0, 0] });
    B.lathe('brass', POT, [97.0, 0.5, 6.8], 10, { scale: [1.8, 1.8, 1.8] });
    for (let i = 0; i < 3; i++) B.lathe('brass', CUP, [97.6 + i * 0.22, 0.5, 6.7], 8, { scale: [1.3, 1.3, 1.3] });
    addBlock({ x0: 96, x1: 98.6, z0: 6.4, z1: 7.4 }, 0);
    S.coffee.push({ x: 97.0, z: 5.9, yaw: faceYaw(0, 1), role: 'pour' }, { x: 98.2, z: 5.9, yaw: faceYaw(0, 1), role: 'guest' });
    // скамьи со старейшинами и «урок ритма» (верхний ярус)
    for (const bx of [51.5, 92]) { B.box('stone', [bx, 0.25, -4.3], [1.8, 0.5, 0.5], { par: [0.9, 0, 0] }); addBlock({ x0: bx - 1, x1: bx + 1, z0: -4.6, z1: -4.0 }, 0); }
    S.elder.push({ x: 51.0, z: -3.7, yaw: faceYaw(0, 1) }, { x: 52.0, z: -3.7, yaw: faceYaw(0, 1) }, { x: 92, z: -3.7, yaw: faceYaw(0, 1) });
    S.bench.push({ x: 51.5, z: -3.7, yaw: faceYaw(0, 1) }, { x: 92, z: -3.7, yaw: faceYaw(0, 1) });
  }

  // --- Баннеры с потолка и драпировки с перил.
  {
    B.region = 'B2';
    const ks = ['banner', 'stripeBlue', 'stripeRed', 'stripeOchre', 'banner'];
    for (let i = 0; i < 9; i++) {
      const x = 50 + i * 5.5 + 0.7, z = ((i * 37) % 5 - 2) * 1.4;
      const top = 10.6 + (i % 2) * 0.2, bot = 6.6 - (i % 3) * 0.5;
      B.rails(`cloth:${ks[i % 5]}`, [[[x - 0.55, top, z], [x + 0.55, top, z]], [[x - 0.55, (top + bot) / 2, z], [x + 0.55, (top + bot) / 2, z]], [[x - 0.55, bot, z], [x + 0.55, bot, z]]], { want: [0, 0, 1], par: (px, py) => [0, 0, clamp((top - py) / 3.5, 0, 1)], uvu: 1, uvv: 3 });
      B.rails(`cloth:${ks[i % 5]}`, [[[x - 0.55, top, z], [x + 0.55, top, z]], [[x - 0.55, (top + bot) / 2, z], [x + 0.55, (top + bot) / 2, z]], [[x - 0.55, bot, z], [x + 0.55, bot, z]]], { want: [0, 0, -1], par: (px, py) => [0, 0, clamp((top - py) / 3.5, 0, 1)], uvu: 1, uvv: 3 });
      B.box('wood', [x, top + 0.04, z], [1.3, 0.05, 0.05], { color: [0.45, 0.34, 0.24] });
    }
    for (const s of [-1, 1]) for (let i = 0; i < 7; i++) {
      const x = 55.5 + i * 6.2, z = s * 4.45, k = ['stripeRed', 'stripeBlue', 'stripeOchre'][i % 3];
      B.rails(`cloth:${k}`, [[[x - 1.0, 7.0, z + s * 0.2], [x + 1.0, 7.0, z + s * 0.2]], [[x - 1.0, 5.5, z + s * 0.2], [x + 1.0, 5.5, z + s * 0.2]]], { want: [0, 0, s], par: (px, py) => [0, 0, clamp((7.0 - py) / 1.5, 0, 1)], uvu: 1, uvv: 1 });
    }
  }

  // --- B1: стойка тамперов, крючья, скамья стражи.
  {
    B.region = 'B1';
    // крючья творца (пять): древки из волокна, тёмные наконечники
    for (let i = 0; i < 5; i++) {
      const x = 32.8 + i * 0.5, lean = 0.1 + (i % 2) * 0.04;
      B.cyl('wood', [x, 1.25, -1.62], 0.018, 0.022, 2.5, 6, { rot: [lean, 0, 0], color: [0.5 + (i % 2) * 0.1, 0.38, 0.26] });
      B.geo('metal', new THREE.TorusGeometry(0.1, 0.012, 6, 12, 4.4), { pos: [x, 2.52, -1.5], rot: [0, Math.PI / 2, 0.4], color: [0.14, 0.14, 0.16] });
      B.cyl('cloth', [x, 1.3, -1.6], 0.025, 0.025, 0.08, 6, { color: [0.18, 0.28, 0.5], par: [0, 0, 0] });
    }
    ctx.poi.hooks = [34, 1.4, -1.55];
    // тамперы: четыре (один маленький, раскрашенный)
    for (let i = 0; i < 4; i++) {
      const x = 33.2 + i * 0.7, small = i === 3, s = small ? 0.6 : 1;
      B.cyl('metal', [x, 0.32 * s + 0.28, -1.55], 0.07 * s, 0.07 * s, 0.9 * s, 8, { color: [0.4, 0.34, 0.3] });
      B.cyl('metal', [x, 0.8 * s + 0.28, -1.55], 0.12 * s, 0.07 * s, 0.14 * s, 8, { color: [0.5, 0.42, 0.34] });
      B.cyl('metal', [x, 0.12, -1.55], 0.01, 0.06 * s, 0.24 * s, 8, { rot: [0, 0, 0], color: [0.3, 0.26, 0.24] });
      if (small) B.cyl('cloth', [x, 0.7, -1.55], 0.075 * s, 0.075 * s, 0.2, 8, { color: [0.7, 0.3, 0.2], par: [0, 0, 0] });
    }
    ctx.poi.thumpers = [35.2, 0.9, -1.55];
    // скамьи стражи
    B.box('stone', [16, 0.25, -1.65], [3, 0.5, 0.55], { par: [0.9, 0, 0] });
    addBlock({ x0: 14.4, x1: 17.6, z0: -2, z1: -1.38 }, 0);
    B.box('stone', [31, 0.25, 1.65], [3, 0.5, 0.55], { par: [0.9, 0, 0] });
    addBlock({ x0: 29.4, x1: 32.6, z0: 1.38, z1: 2 }, 0);
    S.guard.push({ x: 18.5, z: 0, yaw: faceYaw(-1, 0), role: 'check' });
    S.guard.push({ x: 13, z: -1.1, yaw: faceYaw(0, 1), role: 'post' });
    S.hooks.push({ x: 32.5, z: -0.3, yaw: faceYaw(0, -1), role: 'sharpen' }, { x: 34.5, z: -0.2, yaw: faceYaw(0, -1), role: 'inspect' });
    S.bench.push({ x: 31.3, z: 1.1, yaw: faceYaw(0, 1) });
    ctx.steamSpots = [{ x: 8.1, y: 0.2, z: -1.7 }, { x: 8.1, y: 0.2, z: 1.7 }, { x: 24.1, y: 0.2, z: -1.7 }, { x: 24.1, y: 0.2, z: 1.7 }, { x: 8.0, y: 3.2, z: 0 }, { x: 24.0, y: 3.2, z: 0 }];
    ctx.poi.sigil = [26.6, 2.1, -1.7]; ctx.poi.carvingEntry = [3.0, 1.9, -1.7];
  }

  // --- B3: коврики-маты у ниши Шианы, мешки.
  {
    B.region = 'B3';
    const sh = ctx.niches.find((n) => n.id === 'Shrine');
    if (sh) {
      for (let i = 0; i < 2; i++) B.rails('carpet:carpetBlue', [[[sh.cx - 0.9 + i * 1.1 - 0.4, 0.02, 0.2], [sh.cx - 0.9 + i * 1.1 + 0.4, 0.02, 0.2]], [[sh.cx - 0.9 + i * 1.1 - 0.4, 0.02, 1.0], [sh.cx - 0.9 + i * 1.1 + 0.4, 0.02, 1.0]]], { want: [0, 1, 0], par: [0, 0, 0] });
      S.shrine.push({ x: sh.cx - 0.9, z: 0.6, yaw: faceYaw(0, 1), role: 'pray' }, { x: sh.cx + 0.2, z: 0.6, yaw: faceYaw(0, 1), role: 'pray' }, { x: sh.cx + 0.8, z: -0.7, yaw: faceYaw(0, 1), role: 'stand' });
      ctx.poi.shrine = [sh.cx, 1.1, sh.wallZ + 1.0];
    }
    // тупик северной ветки: двое скорбящих в синем
    S.funeral.push({ x: 134.2, z: -15.6, yaw: faceYaw(1, 0) }, { x: 134.2, z: -14.4, yaw: faceYaw(1, 0) });
    B.cyl('clay', [134.5, 0.22, -15.0], 0.1, 0.12, 0.36, 8, { color: [0.7, 0.55, 0.4] });
    B.cyl('clay', [134.8, 0.2, -15.3], 0.1, 0.12, 0.32, 8, { color: [0.7, 0.55, 0.4] });
    // мешки/тюки вдоль стен
    for (let i = 0; i < 6; i++) { const x = 106 + i * 6.5 + R() * 2, s = i % 2 ? 1 : -1; B.sphere('clothStatic', [x, 0.28, s * 1.15], 0.28, { scale: [1.2, 0.8, 0.9], color: goodsCols[i % 6], ws: 8, hs: 6 }); }
    ctx.poi.funeral = [135.0, 1.3, -15];
  }
  // --- B4: у решётки.
  ctx.poi.grate = [122, 1.3, 7.2];
  S.guard.push({ x: 124.6, z: 5.0, yaw: faceYaw(-1, 1), role: 'grate' });

  // --- B5: ритуальные места (круг на ярусах) считаются в crowd.js; светильные стойки уже в arch.
  // --- Полосы «дорожек» для блуждания (лейны) — в crowd.js.
  ctx.poi.mural = [70, 6.8, -6.6]; ctx.poi.muralAt = [70, 7.5, -7.3];
  ctx.poi.worm = [155.5, 1.4, 0];
}
