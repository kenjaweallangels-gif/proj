// Реквизит сиетча (под пещерную архитектуру): низкие слоистые ковры и подушки, занавеси-«двери» из пряного волокна,
// лавки и станки в нишах под карнизом, водяная станция с кольцами и мерными чашками, мастерская дистикомбов с костюмами на стойках,
// ткацкие станки, кувшины-кладовые, стойки крючьев и тамперов, вентиляционные решётки (ветроловки), мерные кольца у цистерны.
// Заполняет ctx.spots — точки деятельности для толпы; addBlock — коллизия реквизита.
import * as THREE from 'three';
import { addBlock, heightAtLocal, HALL, LEDGE, NICHES, FUNERAL } from './plan.js';
import { PATHS, B2_ALCOVES, SHELF_BAYS, NICHE_Z } from './cave/layout.js';
import { rng, clamp } from '../core/util.js';
import { J_A, J_B, CUP, POT, faceYaw, pathZ } from './shapes.js';
import { buildRooms, buildBays, buildKitchen, buildMusic, tiedCurtain } from './rooms.js';
import { buildCellar, buildExit, buildDetails } from './cellar.js';

export { faceYaw, pathZ };

export function buildProps(B, ctx) {
  const R = rng(909);
  const A = ctx.anchors;
  const S = ctx.spots = { loom: [], stall: [], water: [], repair: [], play: [], bench: [], mat: [], hooks: [], guard: [], coffee: [], funeral: [], shrine: [], quarrel: [], whisper: [], lane: [], elder: [], door: [], sleep: [], family: [], kidroom: [], musician: [], cook: [], scribe: [], cellarGuard: [], pool: [], audience: [] };
  const clothKeys = ['stripeOchre', 'stripeBlue', 'stripeRed', 'plain'];
  const goodsCols = [[0.72, 0.38, 0.16], [0.55, 0.22, 0.14], [0.78, 0.62, 0.3], [0.25, 0.36, 0.52], [0.5, 0.45, 0.2], [0.36, 0.5, 0.3]];
  const WOOD = [0.5, 0.4, 0.3]; // «дерево Дюны»: прессованное волокно/пластик-кость
  const gy = (x, z, yf = 0) => heightAtLocal(x, z, yf);
  const wallP = (id) => A[id]?.p || [0, 0, 0];

  // ------------------------------------------------------------------ помощники ----
  const jar = (x, z, big, col, y0) => {
    const y = y0 ?? gy(x, z);
    B.lathe('clay', big ? J_B : J_A, [x, y, z], 14, { color: col || [0.78 + R() * 0.2, 0.52 + R() * 0.15, 0.36], par: [0.2, 0, 0] });
    B.cyl('clay', [x, y + (big ? 1.22 : 0.82), z], 0.12, 0.12, 0.02, 10, { color: [0.2, 0.15, 0.1] });
  };
  /** Ковёр, облегающий пол (сетка высот). layer — порядок наслоения (0.012 м на слой). */
  const rug = (key, x, z, w, d, rot = 0, layer = 0, yf = 0) => {
    const c = Math.cos(rot), s = Math.sin(rot), nu = Math.max(2, Math.ceil(w / 0.4)), nv = Math.max(2, Math.ceil(d / 0.4));
    const rails = [];
    for (let j = 0; j <= nv; j++) {
      const row = [];
      for (let i = 0; i <= nu; i++) {
        const u = (i / nu - 0.5) * w, v = (j / nv - 0.5) * d;
        const px = x + u * c - v * s, pz = z + u * s + v * c;
        const edge = Math.min(i, nu - i, j, nv - j) === 0 ? -0.006 : 0;
        row.push([px, gy(px, pz, yf) + 0.022 + 0.012 * layer + edge + 0.008 * Math.sin(u * 5 + v * 4 + layer * 3), pz]);
      }
      rails.push(row);
    }
    B.rails(`carpet:${key}`, rails, { want: [0, 1, 0], par: [0, 0, 0], uvu: 1, uvv: 1 });
  };
  const cushion = (x, z, col, s = 1, yf = 0, y0 = null) => B.sphere('clothStatic', [x, (y0 ?? gy(x, z, yf)) + 0.09 * s, z], 0.22 * s, { scale: [1, 0.46, 1], color: col, ws: 10, hs: 6, rot: [0, R() * 3, 0] });
  /** Висящая ткань (качается): plane normal ±z (axis 'x': полотнище вдоль x) или ±x (axis 'z'). */
  const hanging = (x, yTop, z, w, h, axis, side, key, seed = 0, tint = [1, 1, 1], gap = 0, door = false) => {
    if (door) (ctx.curtains ||= []).push({ x, z, axis, side, w, yTop, h });
    const nx = 16, ny = 9, rails = [];
    for (let j = 0; j <= ny; j++) {
      const row = [], t = j / ny, y = yTop - h * t;
      for (let i = 0; i <= nx; i++) {
        let s = i / nx - 0.5;
        if (gap > 0) s = s < 0 ? s * (1 - gap) - gap * 0.5 : s * (1 - gap) + gap * 0.5;
        const fold = Math.sin(i * 1.55 + seed) * 0.06 * (0.35 + t * 0.65) + 0.05 * Math.sin(seed * 2 + i * 0.5);
        if (axis === 'x') row.push([x + s * w, y, z + side * (0.04 + fold)]);
        else row.push([x + side * (0.04 + fold), y, z + s * w]);
      }
      rails.push(row);
    }
    const want = axis === 'x' ? [0, 0, -side] : [-side, 0, 0];
    B.rails(`cloth:${key}`, rails, { want, color: tint, par: (px, py) => [0, 0, clamp(1 - (py - (yTop - h)) / (h || 1), 0, 1) * 1.3 * (0.2 + 0.8 * clamp((yTop - py) / (h * 0.5 + 0.01), 0, 1))], uvu: 2, uvv: 2 });
    if (axis === 'x') B.cyl('wood', [x, yTop + 0.03, z + side * 0.04], 0.022, 0.022, w + 0.3, 6, { rot: [0, 0, Math.PI / 2], color: WOOD });
    else B.cyl('wood', [x + side * 0.04, yTop + 0.03, z], 0.022, 0.022, w + 0.3, 6, { rot: [Math.PI / 2, 0, 0], color: WOOD });
  };
  const kKeys = ['blueCloth', 'stripeRed', 'plain', 'stripeOchre', 'stripeBlue', 'hemp'];
  const H = { B, ctx, R, S, gy, jar, rug, cushion, hanging, goodsCols, clothKeys, WOOD, kKeys, wallP, A };

  // ================================================================== B1: расщелина и шлюз ====
  {
    B.region = 'B1';
    // стойка крючьев творца и тамперов у северной стены (рядом со входом — как в каноне)
    const hw = wallP('hooksWall'); const wz = hw[2];
    B.box('wood', [34.5, 1.72, wz + 0.1], [4.4, 0.07, 0.1], { color: WOOD });
    for (const sx of [32.4, 36.6]) B.box('wood', [sx, 0.9, wz + 0.1], [0.08, 1.8, 0.08], { color: WOOD });
    for (let i = 0; i < 5; i++) {
      const x = 32.8 + i * 0.5, lean = 0.1 + (i % 2) * 0.04;
      B.cyl('wood', [x, 1.27, wz + 0.2 + (i % 2) * 0.05], 0.018, 0.022, 2.5, 6, { rot: [lean, 0, 0], color: [0.55 + (i % 2) * 0.1, 0.42, 0.3] });
      B.geo('metal', new THREE.TorusGeometry(0.1, 0.012, 6, 12, 4.4), { pos: [x, 2.52, wz + 0.35], rot: [0, Math.PI / 2, 0.4], color: [0.14, 0.14, 0.16] });
      B.cyl('cloth', [x, 1.3, wz + 0.22], 0.025, 0.025, 0.08, 6, { color: [0.18, 0.28, 0.5], par: [0, 0, 0] });
    }
    ctx.poi.hooks = [34, 1.4, wz + 0.3];
    for (let i = 0; i < 4; i++) {
      const x = 33.2 + i * 0.7, small = i === 3, s = small ? 0.6 : 1, zt = wz + 0.55;
      B.cyl('metal', [x, 0.32 * s + 0.28, zt], 0.07 * s, 0.07 * s, 0.9 * s, 8, { color: [0.4, 0.34, 0.3] });
      B.cyl('metal', [x, 0.8 * s + 0.28, zt], 0.12 * s, 0.07 * s, 0.14 * s, 8, { color: [0.5, 0.42, 0.34] });
      B.cyl('metal', [x, 0.12, zt], 0.01, 0.06 * s, 0.24 * s, 8, { color: [0.3, 0.26, 0.24] });
      if (small) B.cyl('cloth', [x, 0.7, zt], 0.075 * s, 0.075 * s, 0.2, 8, { color: [0.7, 0.3, 0.2], par: [0, 0, 0] });
    }
    ctx.poi.thumpers = [35.2, 0.9, wz + 0.55];
    addBlock({ x0: 32.3, x1: 36.8, z0: wz - 0.1, z1: wz + 0.85 }, 0);
    S.hooks.push({ x: 32.5, z: wz + 1.35, yaw: faceYaw(0, -1), role: 'sharpen' }, { x: 34.7, z: wz + 1.35, yaw: faceYaw(0, -1), role: 'inspect' });
    // скамья стражи (вырезана в глине-обмазке у стены шлюза) + ковры
    const gb = wallP('guardBench');
    B.box('clay', [15.4, 0.22, gb[2] + 0.3], [2.8, 0.44, 0.55], { par: [0.9, 0, 0], color: [0.85, 0.7, 0.55] });
    addBlock({ x0: 14.0, x1: 16.8, z0: gb[2] - 0.1, z1: gb[2] + 0.62 }, 0);
    S.bench.push({ x: 15.4, z: gb[2] + 0.9, yaw: faceYaw(0, -1) });
    rug('carpetRed', 17.8, 0.1, 2.8, 1.9, 0.12, 0); rug('carpetBlue', 18.6, 0.35, 1.7, 1.2, 0.55, 1); rug('carpetOchre', 12.5, -0.5, 2.0, 1.4, -0.2, 0);
    cushion(19.8, 1.0, goodsCols[0], 1); cushion(19.3, -0.8, goodsCols[3], 0.9);
    // ловушки влаги: серо-синие тряпки, свисающие с потолка у уплотнителей
    for (const [x0, n] of [[10.4, 4], [21.6, 4]]) for (let i = 0; i < n; i++) { const zz = pathZ(PATHS.B1, x0) + (i - 1.5) * 0.45; B.rails('cloth:plain', [[[x0 - 0.18, 2.55, zz], [x0 + 0.18, 2.55, zz]], [[x0 - 0.2, 1.95 - (i % 2) * 0.2, zz + 0.02], [x0 + 0.2, 1.95 - (i % 2) * 0.2, zz + 0.02]]], { want: [1, 0, 0], color: [0.45, 0.5, 0.58], par: [0, 0, 0.8] }); }
    // мешки с песком у входа
    for (let i = 0; i < 4; i++) B.sphere('clothStatic', [1.2 + i * 0.5, 0.2, 1.05 + (i % 2) * 0.15], 0.24, { scale: [1.2, 0.8, 0.9], color: [0.62, 0.5, 0.36], ws: 8, hs: 6 });
    S.guard.push({ x: 18.5, z: 0, yaw: faceYaw(-1, 0), role: 'check' });
    S.guard.push({ x: 13, z: gb[2] + 0.75, yaw: faceYaw(0, 1), role: 'post' });
    ctx.poi.sigil = [27.0, 2.1, wallP('sigilWall')[2] + 0.2]; ctx.poi.carvingEntry = [3.0, 1.9, -1.0];
  }

  // ================================================================== B2: галерея ====
  const stallAlcove = (x, side, kind) => {
    B.region = 'B2';
    const zc = side * 4.6; // прилавок на границе ниши
    B.box('clay', [x, 0.42, zc], [2.5, 1.2, 0.7], { par: [0.5, 0.1, 0], color: [0.92, 0.78, 0.6] });
    B.box('wood', [x, 1.03, zc], [2.65, 0.07, 0.85], { color: [0.6, 0.45, 0.32], par: [0.6, 0, 0] });
    addBlock({ x0: x - 1.35, x1: x + 1.35, z0: Math.min(zc - 0.45, zc + 0.45), z1: Math.max(zc - 0.45, zc + 0.45) }, 0);
    const key = clothKeys[Math.floor(R() * 4)];
    // навес-полог: от кромки ниши вперёд, с наклоном вниз
    const w = 3.2, nx = 8, nz = 4, rails = [];
    for (let j = 0; j <= nz; j++) {
      const t = j / nz, row = [];
      for (let i = 0; i <= nx; i++) { const u = i / nx; row.push([x - w / 2 + w * u, 2.95 - 0.7 * t - 0.12 * Math.sin(u * Math.PI * 3) * (t > 0.2 ? 1 : 0.3), side * (4.9 - 1.7 * t)]); }
      rails.push(row);
    }
    const parF = (px, py, pz) => [0, 0, clamp((Math.abs(pz) - 3.4) / -1.5, 0, 1) * 0.0 + clamp(1.5 - (Math.abs(pz) - 3.2), 0, 1) * 0.4];
    B.rails(`cloth:${key}`, rails, { want: [0, 1, 0], par: parF, uvu: 2, uvv: 1 });
    B.rails(`cloth:${key}`, rails, { want: [0, -1, 0], par: parF, uvu: 2, uvv: 1 });
    const fr = rails[nz].map((p) => [p[0], p[1] - 0.2, p[2]]);
    B.rails(`cloth:${key}`, [rails[nz], fr], { want: [0, 0, side], par: [0, 0, 1], uvu: 4, uvv: 0.1 });
    for (const sx of [-1.45, 1.45]) B.cyl('wood', [x + sx, 1.2, side * 3.2], 0.04, 0.045, 2.4, 6, { color: WOOD });
    // товар
    const n = 5 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const gx = x - 1.0 + R() * 2.0, gz = zc + (R() - 0.5) * 0.4, c = goodsCols[Math.floor(R() * goodsCols.length)], t = R();
      if (kind === 'spice' || t < 0.35) { B.cyl('cloth', [gx, 1.1 + 0.11, gz], 0.01, 0.17, 0.22, 10, { color: c, par: [0, 0, 0] }); B.cyl('clay', [gx, 1.1 + 0.04, gz], 0.2, 0.2, 0.08, 10, { color: [0.45, 0.32, 0.22] }); }
      else if (t < 0.65) B.box('wood', [gx, 1.27, gz], [0.36, 0.2, 0.28], { rot: [0, R() * 3, 0], color: [0.6 + R() * 0.15, 0.45, 0.3] });
      else B.cyl('clothStatic', [gx, 1.2, gz], 0.1, 0.1, 0.42 + R() * 0.1, 10, { rot: [0, 0, Math.PI / 2], color: c });
    }
    // кладовая в глубине ниши: ряды кувшинов
    for (let i = 0; i < 4; i++) jar(x - 1.0 + i * 0.62, side * (6.65 + (i % 2) * 0.2), i % 2 === 0, goodsCols[(i + 2) % 6].map((v) => v * 1.1));
    // боковые занавеси — подвязаны к столбам ниши
    hanging(x - 1.55, 3.0, side * 4.15, 0.6, 1.9, 'x', side, kKeys[Math.floor(R() * 6)], R() * 5);
    hanging(x + 1.55, 3.0, side * 4.15, 0.6, 1.9, 'x', side, kKeys[Math.floor(R() * 6)], R() * 5);
    rug(clothKeys[(Math.floor(R() * 3)) === 0 ? 0 : 1] === 'stripeOchre' ? 'carpetOchre' : 'carpetRed', x, side * 3.25, 2.4, 1.3, (R() - 0.5) * 0.2, 0);
    B.box('wood', [x - 1.0, 0.22, zc + side * 1.0 + side * 0.4], [0.5, 0.44, 0.5], { color: [0.7, 0.52, 0.36] });
    S.stall.push({ x, z: side * 5.45, yaw: faceYaw(0, -side), side, cx: x, cz: zc });
  };
  B2_ALCOVES.north.forEach((x, i) => { if (x === 79) return; if (x === 92) { buildKitchen(H); return; } stallAlcove(x, -1, i % 2 ? 'spice' : 'goods'); });
  buildMusic(H);
  [74, 86, 92].forEach((x, i) => stallAlcove(x, 1, i % 2 ? 'goods' : 'spice'));

  // --- ткацкие станки (юг, западные ниши)
  const loom = (x) => {
    B.region = 'B2';
    const z = 6.5, h = 2.1, w = 1.75;
    for (const sx of [-w / 2, w / 2]) B.box('wood', [x + sx, h / 2, z], [0.12, h, 0.16], { color: WOOD });
    B.box('wood', [x, h - 0.05, z], [w + 0.3, 0.14, 0.18], { color: WOOD });
    B.box('wood', [x, 0.5, z], [w + 0.2, 0.1, 0.14], { color: WOOD });
    B.box('wood', [x, 1.3, z - 0.18], [w, 0.06, 0.06], { color: [0.55, 0.4, 0.28] });
    for (let i = 0; i < 34; i++) { const px = x - w / 2 + 0.08 + (i / 33) * (w - 0.16); B.box('clothStatic', [px, 1.38, z], [0.006, 1.7, 0.006], { color: [0.85, 0.8, 0.7] }); }
    for (const dz of [0.01, -0.01]) B.rails('cloth:blueCloth', [[[x - w / 2 + 0.07, 0.55, z + dz], [x + w / 2 - 0.07, 0.55, z + dz]], [[x - w / 2 + 0.07, 1.25, z + dz], [x + w / 2 - 0.07, 1.25, z + dz]]], { want: [0, 0, Math.sign(dz)], par: [0, 0, 0.1], uvu: 2, uvv: 1 });
    for (let i = 0; i < 3; i++) B.cyl('clothStatic', [x - 0.55 + i * 0.5, 0.07, z - 0.55], 0.07, 0.07, 0.14, 8, { color: [[0.2, 0.3, 0.6], [0.6, 0.25, 0.2], [0.8, 0.7, 0.4]][i] });
    B.box('wood', [x - 0.2, 0.22, z - 1.0], [0.5, 0.44, 0.5], { color: [0.7, 0.52, 0.36] });
    rug('carpetBlue', x, 5.1, 2.4, 1.5, 0.05, 0);
    addBlock({ x0: x - 1.1, x1: x + 1.1, z0: z - 0.3, z1: z + 0.3 }, 0);
    S.loom.push({ x: x - 0.2, z: z - 1.0, yaw: faceYaw(0, 1), cx: x, cz: z });
  };
  B2_ALCOVES.south.slice(0, 3).forEach(loom);
  for (let i = 0; i < 3; i++) B.box('cloth', [48 + i * 0.4, 1.0, 3.9], [0.04, 2.0, 0.01], { color: [0.2, 0.3, 0.6], par: [0, 0, 1] });

  // --- водяная станция (южная ниша x=80): мерные чашки, кольца, большие кувшины
  {
    B.region = 'B2';
    const x = 80, z = 4.6;
    B.box('clay', [x, 0.38, z], [2.3, 1.06, 0.8], { par: [0.6, 0.1, 0], color: [0.85, 0.72, 0.58] });
    B.box('wood', [x, 0.93, z], [2.45, 0.07, 0.95], { color: [0.6, 0.45, 0.32], par: [0.9, 0, 0] });
    B.box('cloth', [x, 0.975, z], [1.6, 0.012, 0.6], { color: [0.15, 0.3, 0.55], par: [0, 0, 0] });
    for (let i = 0; i < 5; i++) B.lathe('brass', CUP, [x - 0.7 + i * 0.28, 0.97, z + 0.2], 10, { scale: [1.4, 1.4, 1.4] });
    B.lathe('brass', POT, [x + 0.6, 0.97, z - 0.1], 10, { scale: [1.6, 1.6, 1.6] });
    for (let i = 0; i < 3; i++) B.lathe('brass', CUP, [x - 0.3 + i * 0.3, 0.97, z - 0.1], 10, { scale: [2.0, 2.2, 2.0] });
    jar(x - 1.1, 6.5, true, [0.6, 0.45, 0.34]); jar(x + 0.2, 6.7, true, [0.66, 0.5, 0.36]); jar(x + 1.2, 6.55, false, [0.6, 0.45, 0.34]); jar(x - 0.5, 6.75, false);
    // стойка водяных колец на шнурах (символ долга/общего счёта)
    B.box('wood', [x, 2.3, z + 0.1], [1.7, 0.05, 0.05], { color: WOOD });
    for (const sx of [-0.85, 0.85]) B.box('wood', [x + sx, 1.65, z + 0.1], [0.05, 1.3, 0.05], { color: WOOD });
    for (let i = 0; i < 14; i++) {
      const rx = x - 0.7 + (i / 13) * 1.4, ry = 2.2 - (i % 3) * 0.1;
      B.cyl('metal', [rx, 2.22 - (i % 3) * 0.05, z + 0.1], 0.003, 0.003, 0.12 + (i % 3) * 0.1, 3, { color: [0.6, 0.5, 0.35] });
      B.geo('brass', new THREE.TorusGeometry(0.05 + (i % 4) * 0.007, 0.007, 6, 14), { pos: [rx, ry - 0.2 - (i % 3) * 0.06, z + 0.1], rot: [0, i * 0.3, 0], color: [0.75 + (i % 2) * 0.2, 0.62, 0.4] });
    }
    addBlock({ x0: x - 1.25, x1: x + 1.25, z0: z - 0.5, z1: z + 0.5 }, 0);
    rug('carpetBlue', x, 3.3, 2.6, 1.3, 0.04, 0);
    S.water.push({ x, z: 5.5, yaw: faceYaw(0, -1), cx: x, cz: z });
    ctx.poi.waterRings = [x, 2.0, z + 0.1];
  }

  // --- мастерская дистикомбов (север, x=79): верстак, помпа, костюмы на стойках
  {
    B.region = 'B2';
    const x = 79, z = -6.1;
    B.box('clay', [x, 0.34, z], [2.1, 1.0, 0.9], { par: [0.7, 0.1, 0], color: [0.85, 0.72, 0.58] });
    B.box('wood', [x, 0.88, z], [2.2, 0.08, 1.0], { color: [0.55, 0.42, 0.3] });
    B.cyl('metal', [x - 0.6, 1.12, z], 0.05, 0.05, 0.4, 8, { color: [0.5, 0.42, 0.34] });
    B.sphere('metal', [x - 0.6, 1.36, z], 0.07, { color: [0.55, 0.45, 0.34] });
    for (let i = 0; i < 4; i++) B.geo('metal', new THREE.TorusGeometry(0.13 + i * 0.02, 0.011, 6, 18, 4.2), { pos: [x + 0.1 + i * 0.1, 0.94, z + 0.2 - i * 0.1], rot: [Math.PI / 2, 0, i], color: [0.2, 0.2, 0.18] });
    B.box('cloth', [x + 0.5, 0.97, z - 0.1], [0.7, 0.04, 0.5], { color: [0.2, 0.18, 0.16], par: [0, 0, 0] });
    B.lathe('clay', J_A, [x + 0.9, 0.88, z - 0.2], 12, { scale: [0.55, 0.55, 0.55], color: [0.7, 0.5, 0.36] });
    // стойка с дистикомбами на дальней стене ниши
    B.box('wood', [x - 0.1, 2.1, -7.15], [2.6, 0.06, 0.1], { color: WOOD });
    for (let i = 0; i < 4; i++) {
      const sx = x - 1.0 + i * 0.62;
      B.rails('cloth', [[[sx - 0.2, 2.05, -7.08], [sx + 0.2, 2.05, -7.08]], [[sx - 0.26, 1.35, -7.02], [sx + 0.26, 1.35, -7.02]], [[sx - 0.2, 0.8, -7.05], [sx + 0.2, 0.8, -7.05]]], { want: [0, 0, 1], color: [0.2 + i * 0.02, 0.19, 0.17], par: [0, 0, 0.5] });
      B.sphere('clothStatic', [sx, 2.0, -7.02], 0.09, { color: [0.14, 0.13, 0.12], ws: 8, hs: 6 });
    }
    B.box('wood', [x + 1.3, 0.22, z + 0.9], [0.5, 0.44, 0.5], { color: [0.45, 0.34, 0.24] });
    rug('carpetOchre', x, -4.0, 2.4, 1.3, 0, 0);
    addBlock({ x0: x - 1.15, x1: x + 1.15, z0: z - 0.55, z1: z + 0.55 }, 0);
    S.repair.push({ x: x - 0.3, z: z + 1.0, yaw: faceYaw(0, -1), role: 'artisan' }, { x: x + 0.4, z: z + 1.7, yaw: faceYaw(0, -1), role: 'client' });
  }

  // --- детская зона у лестниц (x 43..51): ковры, подушки, одеяло-«червь», мел на стенах (декали)
  {
    B.region = 'B2';
    rug('carpetRed', 47, -0.5, 3.4, 2.4, 0.15, 0); rug('carpetBlue', 44.8, 2.2, 2.8, 2.0, -0.2, 0); rug('carpetOchre', 49, 2.2, 2.4, 1.8, 0.4, 0);
    rug('carpetBlue', 47.5, 0.3, 1.8, 1.3, 0.7, 1);
    for (let i = 0; i < 6; i++) cushion(44 + R() * 6, -2 + R() * 4.5, goodsCols[i % 6], 1);
    for (let i = 0; i < 6; i++) B.sphere('clothStatic', [46.4 + i * 0.32, gy(46.4 + i * 0.32, -0.2) + 0.18 + Math.sin(i * 0.9) * 0.1, -0.2 + Math.sin(i * 1.2) * 0.22], 0.22 - i * 0.012, { color: [0.35, 0.28, 0.4], ws: 10, hs: 6 });
    S.play.push({ x: 47, z: -0.5, r: 2.4 });
    // ковры вдоль центральной аллеи (слоистые)
    rug('carpetRed', 60, 0, 3.2, 2.2, 0.0, 0); rug('carpetBlue', 60.6, 0.2, 1.8, 1.2, 0.5, 1);
    rug('carpetBlue', 66, -1.4, 2.8, 1.9, 0.1, 0); rug('carpetOchre', 72, 1.2, 2.8, 1.9, -0.1, 0); rug('carpetRed', 72.4, 1.0, 1.5, 1.0, 0.4, 1);
    rug('carpetBlue', 84, 0.3, 3.2, 2.2, 0.05, 0); rug('carpetRed', 91, -0.8, 2.8, 2, 0.3, 0); rug('carpetOchre', 91.4, -0.6, 1.5, 1.1, -0.3, 1);
    for (let i = 0; i < 7; i++) cushion(58 + R() * 36, (R() - 0.5) * 3.2, goodsCols[(i + 1) % 6], 0.9);
    // кофейная ниша у восточного торца: низкая скамья-плита, кофейник, чашки
    const cx = 89.0, cz = 2.4;
    B.box('clay', [cx, 0.25, cz + 0.9], [2.4, 0.5, 0.6], { par: [0.9, 0, 0], color: [0.85, 0.72, 0.58] });
    B.lathe('brass', POT, [cx - 0.3, 0.5, cz + 0.9], 10, { scale: [1.8, 1.8, 1.8] });
    for (let i = 0; i < 3; i++) B.lathe('brass', CUP, [cx + 0.3 + i * 0.22, 0.5, cz + 0.8], 8, { scale: [1.3, 1.3, 1.3] });
    rug('carpetRed', cx + 0.2, cz - 0.3, 2.4, 1.4, 0.05, 0);
    addBlock({ x0: cx - 1.3, x1: cx + 1.3, z0: cz + 0.55, z1: cz + 1.3 }, 0);
    S.coffee.push({ x: cx - 0.2, z: cz - 0.2, yaw: faceYaw(0, 1), role: 'pour' }, { x: cx + 1.0, z: cz - 0.1, yaw: faceYaw(-0.3, 1), role: 'guest' });
    // старейшины на подушках у лестниц (низкие сиденья-«скамья»)
    for (const [bx, bz] of [[50.8, -3.0], [92.2, -3.0]]) { rug('carpetOchre', bx, bz, 2.2, 1.2, 0.05, 0); B.box('wood', [bx, 0.22, bz - 0.65], [1.8, 0.44, 0.35], { color: [0.6, 0.45, 0.32], par: [0.8, 0, 0] }); }
    S.elder.push({ x: 50.3, z: -2.8, yaw: faceYaw(0, 1) }, { x: 51.3, z: -2.8, yaw: faceYaw(0, 1) }, { x: 92, z: -2.8, yaw: faceYaw(0, 1) });
    S.bench.push({ x: 50.8, z: -2.8, yaw: faceYaw(0, 1) }, { x: 92, z: -2.8, yaw: faceYaw(0, 1) });
  }

  // --- карниз (верхний ярус): ковры, подушки, занавеси спальных ниш, драпировка парапета
  {
    B.region = 'B2';
    const yf = 6.5;
    for (const [x, s] of [[56, 1], [64, -1], [72, 1], [84, -1], [92, 1], [60, -1]]) { rug('carpetRed', x, s * 6.1, 3.0, 1.6, 0.1 * s, 0, yf); rug('carpetBlue', x + 0.4, s * 6.2, 1.6, 1.0, 0.5, 1, yf); cushion(x - 1.0, s * 6.0, goodsCols[(x | 0) % 6], 1, yf); cushion(x + 1.2, s * 6.5, goodsCols[(x + 2 | 0) % 6], 0.9, yf); }
    buildBays(H);
    for (const s of [-1, 1]) for (let i = 0; i < 8; i++) {
      const x = 54 + i * 5.6; if (x > 72 && x < 79) continue;
      B.rails(`cloth:${['stripeRed', 'stripeBlue', 'stripeOchre'][i % 3]}`, [[[x - 0.8, 6.95, s * 5.1], [x + 0.8, 6.95, s * 5.1]], [[x - 0.8, 5.6, s * 4.7], [x + 0.8, 5.6, s * 4.7]]], { want: [0, 0, -s], par: (px, py) => [0, 0, clamp((6.95 - py) / 1.3, 0, 1)], uvu: 1, uvv: 1 });
    }
  }
  // --- вентиляционные решётки (ветроловки) в стенах галереи и росы-тряпки под ними
  {
    B.region = 'B2';
    for (const x of [58, 64, 70, 76.5, 83, 89, 95]) for (const sg of [-1, 1]) {
      const a = A[`vent_${x}_${sg}`]; if (!a) continue;
      const [px, py0, pz] = a.p, nz = a.n; const py = py0 + 0.68;
      B.geo('metal', new THREE.TorusGeometry(0.3, 0.03, 6, 18), { pos: [px + nz[0] * 0.02, py, pz + nz[2] * 0.02], rot: [0, nz[2] < 0 ? Math.PI : 0, 0], color: [0.3, 0.27, 0.24] });
      for (let k = -2; k <= 2; k++) B.box('metal', [px + nz[0] * 0.03, py + k * 0.1, pz + nz[2] * 0.03], [0.5, 0.025, 0.02], { rot: [0, 0, 0], color: [0.25, 0.23, 0.2] });
      B.rails('cloth', [[[px - 0.12, py - 0.35, pz + nz[2] * 0.06], [px + 0.12, py - 0.35, pz + nz[2] * 0.06]], [[px - 0.14, py - 1.1, pz + nz[2] * 0.09], [px + 0.14, py - 1.1, pz + nz[2] * 0.09]]], { want: [0, 0, nz[2]], color: [0.45, 0.5, 0.56], par: [0, 0, 0.9] });
    }
  }
  // световые колодцы B2: тканевые «паруса» ловят росу под шахтами
  for (const x of [62, 88]) { B.region = 'B2'; for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; B.rails('cloth:hemp', [[[x + Math.cos(a) * 0.5, 9.6, Math.sin(a) * 0.5], [x + Math.cos(a + 0.7) * 0.5, 9.6, Math.sin(a + 0.7) * 0.5]], [[x + Math.cos(a) * 1.0, 8.2, Math.sin(a) * 1.0], [x + Math.cos(a + 0.9) * 1.0, 8.2, Math.sin(a + 0.9) * 1.0]]], { want: [0, -1, 0], color: [0.8, 0.8, 0.82], par: [0, 0, 0.7] }); } }

  // ================================================================== B3: жилые ниши ====
  {
    B.region = 'B3';
    buildRooms(H);
    // святилище Шианы (открытая ниша): лента, чаша с песком, цветок
    const sh = ctx.niches.find((n) => n.id === 'Shrine');
    if (sh) {
      const z = sh.zn + sh.side * 1.2, y = gy(sh.cx, z) + 0.55;
      B.box('stone', [sh.cx, y - 0.28, z], [1.6, 0.52, 0.8], { par: [0.8, 0, 0], color: [0.92, 0.86, 0.78] });
      B.lathe('clay', [[0.0, 0], [0.18, 0.02], [0.22, 0.1], [0.2, 0.18], [0.17, 0.18], [0.0, 0.1]], [sh.cx - 0.5, y, z], 14, { color: [0.8, 0.65, 0.5] });
      B.cyl('sand', [sh.cx - 0.5, y + 0.08, z], 0.17, 0.17, 0.02, 12, { par: [0, 0, 2], color: [1, 0.9, 0.7] });
      B.cyl('wood', [sh.cx + 0.4, y + 0.25, z], 0.008, 0.008, 0.5, 4, { color: [0.4, 0.3, 0.2] });
      B.sphere('cloth', [sh.cx + 0.4, y + 0.52, z], 0.06, { color: [0.7, 0.62, 0.5], par: [0, 0, 0.1] });
      B.box('cloth', [sh.cx, y + 1.1, z + sh.side * 0.7], [0.1, 1.0, 0.012], { color: [0.12, 0.25, 0.6], par: [0, 0, 1] });
      B.box('cloth', [sh.cx + 0.25, y + 0.9, z + sh.side * 0.7], [0.08, 0.7, 0.012], { color: [0.2, 0.34, 0.7], par: [0, 0, 1] });
      rug('carpetBlue', sh.cx - 0.9, sh.zn - sh.side * 0.9, 0.9, 1.5, 0.0, 0); rug('carpetBlue', sh.cx + 0.4, sh.zn - sh.side * 0.9, 0.9, 1.5, 0.1, 0);
      S.shrine.push({ x: sh.cx - 0.9, z: sh.zn - sh.side * 0.9, yaw: faceYaw(0, 1), role: 'pray' }, { x: sh.cx + 0.4, z: sh.zn - sh.side * 0.9, yaw: faceYaw(0, 1), role: 'pray' }, { x: sh.cx + 0.9, z: pathZ(PATHS.C, sh.cx) + 0.3, yaw: faceYaw(0, 1), role: 'stand' });
      ctx.poi.shrine = [sh.cx, y + 0.5, z];
    }
    // поминальная ниша: плотная занавесь в торце северной ветки, двое в синем у входа
    {
      const fx = FUNERAL.x, fz = FUNERAL.z;
      for (let k = 0; k < 2; k++) hanging(fx - 0.2, 2.5, fz + (k ? 0.85 : -0.85), 1.7, 2.4, 'z', -1, 'blueCloth', 7 + k, [0.6, 0.65, 0.85]);
      B.box('cloth', [fx - 0.28, 1.4, fz], [0.02, 1.0, 0.9], { color: [0.7, 0.78, 0.95], par: [0, 0, 0.2] });
      B.cyl('clay', [fx - 3.5, gy(fx - 3.5, fz) + 0.18, fz - 0.4], 0.1, 0.12, 0.36, 8, { color: [0.7, 0.55, 0.4] });
      B.cyl('clay', [fx - 3.2, gy(fx - 3.2, fz) + 0.16, fz + 0.3], 0.1, 0.12, 0.32, 8, { color: [0.7, 0.55, 0.4] });
      S.funeral.push({ x: fx - 3.9, z: fz - 0.6, yaw: faceYaw(1, 0) }, { x: fx - 3.9, z: fz + 0.6, yaw: faceYaw(1, 0) });
      addBlock({ x0: fx - 1.0, x1: fx + 6, z0: fz - 2.6, z1: fz + 2.6 }, 0);
      ctx.poi.funeral = [fx - 0.6, 1.3, fz];
    }
    // мешки/тюки вдоль стен проходов
    for (let i = 0; i < 8; i++) { const x = 104 + i * 5.8 + R() * 2, zc = pathZ(PATHS.C, x), s = i % 2 ? 1 : -1; B.sphere('clothStatic', [x, 0.24, zc + s * 0.95], 0.26, { scale: [1.2, 0.8, 0.9], color: goodsCols[i % 6], ws: 8, hs: 6 }); }
    // ряды водяных бутылей у стены северной/южной ветки
    for (let i = 0; i < 5; i++) { jar(104 + i * 0.6, pathZ(PATHS.N, 104) - 0.0 - 1.3 + 0.0, false, [0.62, 0.48, 0.36]); }
  }

  // ================================================================== B4: цистерна ====
  {
    B.region = 'B4';
    const g = A.grateWall?.p || [123, 1.3, 8];
    // кованая решётка (проём закрыт; сквозь прутья видна вода)
    const gx = 122, gz = 8.0, top = 2.8;
    for (let i = 0; i <= 17; i++) { const x = gx - 1.7 + i * 0.2; B.cyl('metal', [x, gy(gx, gz) + top / 2, gz], 0.025, 0.025, top, 6, { color: [0.38, 0.3, 0.24] }); }
    for (const y of [0.45, 1.4, 2.35]) B.box('metal', [gx, gy(gx, gz) + y, gz], [3.5, 0.05, 0.06], { color: [0.4, 0.32, 0.25] });
    for (let i = 0; i < 4; i++) B.geo('metal', new THREE.TorusGeometry(0.28 - i * 0.055, 0.012, 6, 20), { pos: [gx, gy(gx, gz) + 1.5, gz + 0.04], color: [0.42, 0.34, 0.26] });
    for (let i = 0; i < 28; i++) { const x = gx - 1.7 + (i % 18) * 0.2; B.box('metal', [x, gy(gx, gz) + 0.5 + Math.floor(i / 18) * 0.9 + (i % 3) * 0.1, gz - 0.028], [0.06, 0.012, 0.01], { color: [0.9, 0.8, 0.6] }); }
    ctx.poi.grate = [gx, 1.4, gz - 0.9];
    // мерные столбики у кромки воды + шнуры с кольцами; пластиковая труба-«слеза» водосбора
    for (let i = 0; i < 5; i++) { const x = 114 + i * 2.3; const zz = 11.0; B.cyl('metal', [x, 0.5, zz], 0.04, 0.04, 1.0, 6, { color: [0.45, 0.4, 0.34] }); for (let k = 0; k < 3; k++) B.geo('brass', new THREE.TorusGeometry(0.06, 0.008, 6, 12), { pos: [x, 0.3 + k * 0.2, zz], rot: [Math.PI / 2, 0, 0], color: [0.8, 0.65, 0.4] }); }
    B.cyl('metal', [133, 4.3, 27.3], 0.07, 0.07, 1.2, 8, { rot: [Math.PI / 2, 0.3, 0], color: [0.4, 0.34, 0.28] });
    jar(131.8, 12.2, true, [0.62, 0.46, 0.34], 0); jar(132.7, 12.0, false, [0.6, 0.45, 0.34], 0);
    S.guard.push({ x: 120.2, z: 7.1, yaw: faceYaw(0.8, 1), role: 'grate' });
  }

  // ================================================================== B5: зал ====
  {
    B.region = 'B5';
    const cx = HALL.cx, cz = HALL.cz;
    // циновки на ярусах — места для сидения
    const clusters = [0.65, 1.3, 1.95, 2.6, -0.65, -2.2, -2.75];
    clusters.forEach((th, ci) => {
      for (const k of [1, 2, 3]) {
        const r = HALL.bowlR + (k + 0.5) * HALL.tierW;
        const a = th, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        rug(['carpetRed', 'carpetBlue', 'carpetOchre'][(ci + k) % 3], x, z, 2.4, 1.3, -a + Math.PI / 2 + 0.0, 0);
      }
    });
    // помост наиба: слоистые ковры, низкая каменная кафедра, знамёна
    const ly = LEDGE.y;
    rug('carpetRed', 193.5, 0, 4.6, 3.0, 0.0, 0, ly + 0.01); rug('carpetBlue', 193.2, 0.1, 3.0, 1.9, 0.2, 1, ly + 0.01); rug('carpetOchre', 197.5, 0, 3.0, 2.2, 0.0, 0, ly + 0.01);
    B.box('clay', [195.8, ly + 0.28, 0], [0.6, 0.56, 1.1], { color: [0.88, 0.74, 0.58], par: [0.9, 0, 0] });
    for (const s of [-1, 1]) hanging(198.2, ly + 4.2, s * 3.3, 1.5, 3.8, 'x', 1, 'banner', s * 3, [1, 1, 1]);
    cushion(192.2, -2.4, goodsCols[1], 1, 0, ly); cushion(192.2, 2.4, goodsCols[3], 1, 0, ly);
    // знамёна на стенах между нишами (ткань из пряного волокна)
    [-2.8, -2.25, -1.75, -1.25, -0.78, 0.78, 1.25, 1.75, 2.25, 2.8].forEach((th, i) => {
      const x = cx + Math.cos(th) * (HALL.hx - 1.0), z = Math.sin(th) * (HALL.hz - 0.8);
      const axis = Math.abs(Math.cos(th)) > 0.7 ? 'z' : 'x';
      const nxs = -Math.sign(Math.cos(th)), nzs = -Math.sign(Math.sin(th));
      if (axis === 'x') hanging(x, 8.4, z, 1.6, 3.4, 'x', nzs || 1, ['banner', 'stripeBlue', 'stripeRed'][i % 3], i, [0.95, 0.95, 0.95]);
      else hanging(x, 8.4, z, 1.6, 3.4, 'z', nxs || 1, ['banner', 'stripeBlue', 'stripeRed'][i % 3], i, [0.95, 0.95, 0.95]);
    });
    ctx.poi.worm = [190.5, ly + 1.4, 0];
    addBlock({ x0: LEDGE.x0 - 0.3, x1: LEDGE.x0 + 0.3, z0: -LEDGE.hz, z1: LEDGE.hz }, 1);
  }

  buildCellar(H);
  buildExit(H);
  buildDetails(H);
  ctx.poi.mural = [70, 6.8, 6.0]; ctx.poi.muralAt = [70, 8.0, 6.3];
  return S;
}
