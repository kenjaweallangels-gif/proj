// Водяной погреб B6 (священное хранилище воды), выходной туннель в сад и общие бытовые детали.
// Погреб: широкая лестница с верёвочным поручнем → тамбур со стражей → уплотнитель → неф с тёмным бассейном, колоннами, нишами-кладовыми под
// большие запечатанные сосуды и водосборные тазы под трубками-воронками; в восточном торце — станция измерения (весы, мерные столбики, книга долгов).
import * as THREE from 'three';
import { addBlock, heightAtLocal } from './plan.js';
import { CELLAR, EXIT, cellarStairY, NICHES } from './cave/layout.js';
import { VESSEL, BASIN, CUP, POT, J_A, faceYaw } from './shapes.js';
import { roomHelpers } from './rooms.js';

const _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _d = new THREE.Vector3();
/** Цилиндр между двумя точками (шнур, труба, подпорка). */
function seg(H, mat, a, b, r, col, par) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const g = new THREE.CylinderGeometry(r, r, L, 6, 1);
  _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(); _q.setFromUnitVectors(_up, _d); g.applyQuaternion(_q);
  H.B.geo(mat, g, { pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], color: col, par });
}

export function buildCellar(H) {
  const { B, ctx, R, S, goodsCols, WOOD, jar } = H;
  const { sandals } = roomHelpers;
  B.region = 'B6';
  const C = CELLAR, F = C.floorY, st = C.stairs;
  const ST_END = st.z0 + st.n * st.tread;
  (ctx.mist ||= []); (ctx.drips ||= []);

  // ---------------------------------------------------------------- лестница: верёвочный поручень на столбиках, коврики-«ступеньки» из песка ----
  {
    const hx = st.x - 1.0;   // вдоль западной стены
    const posts = [];
    for (let z = st.z0 + 1.0; z < ST_END; z += 2.6) posts.push(z);
    posts.forEach((z, i) => {
      const y = heightAtLocal(hx, z, 0);
      B.cyl('wood', [hx, y + 0.5, z], 0.03, 0.035, 1.0, 6, { color: WOOD });
      if (i) { const zp = posts[i - 1], yp = heightAtLocal(hx, zp, 0); seg(H, 'cloth', [hx, yp + 0.92, zp], [hx, y + 0.92, z], 0.016, [0.62, 0.5, 0.34], [0, 0, 0]); }
    });
    // сырость: следы капель на ступенях — мелкие тёмные лужицы-плитки
    for (let i = 0; i < 6; i++) { const z = st.z0 + 3 + i * 3.1, y = heightAtLocal(st.x, z, 0); B.cyl('stone', [st.x + (R() - 0.5) * 1.2, y + 0.006, z], 0.22 + R() * 0.15, 0.22, 0.008, 12, { color: [0.18, 0.2, 0.22], par: [1, 0, 0] }); }
    // у верха лестницы: мокрая тряпка-ловушка и кувшин для питья стражи
    jar(st.x + 0.9, st.z0 - 0.4, false, [0.6, 0.45, 0.34], 0);
  }

  // ---------------------------------------------------------------- тамбур (у подножия) ----
  {
    const [lx, , lz] = C.landing.c;
    B.box('clay', [lx + 0.2, F + 0.24, lz - 2.45], [3.0, 0.48, 0.6], { par: [0.9, 0, 0], color: [0.78, 0.66, 0.52] });   // скамья стражи
    addBlock({ x0: lx - 1.3, x1: lx + 1.7, z0: lz - 2.8, z1: lz - 2.1 }, 0);
    H.rug('carpetRed', lx + 0.6, lz + 0.2, 2.8, 1.8, 0.1, 0, 0); H.rug('carpetBlue', lx + 0.9, lz + 0.3, 1.6, 1.0, 0.5, 1, 0);
    H.cushion(lx - 0.8, lz + 1.4, goodsCols[2], 1, 0); H.cushion(lx + 2.0, lz + 1.1, goodsCols[4], 0.9, 0);
    // доска долгов у входа: расписание выдачи воды (охрой)
    B.box('wood', [lx - 0.5, F + 1.55, lz + 3.05], [1.3, 0.8, 0.05], { color: [0.45, 0.34, 0.24] });
    for (let i = 0; i < 12; i++) B.box('cloth', [lx - 1.0 + (i % 6) * 0.18, F + 1.8 - Math.floor(i / 6) * 0.3, lz + 3.0], [0.04, 0.22 + (i % 3) * 0.04, 0.01], { color: [0.7, 0.3, 0.16], par: [0, 0, 0] });
    for (let i = 0; i < 5; i++) { B.geo('brass', new THREE.TorusGeometry(0.05, 0.007, 6, 14), { pos: [lx + 0.4 + i * 0.12, F + 1.9, lz + 3.0], color: [0.78, 0.62, 0.4] }); }
    ctx.poi.cellarLedger = [lx - 0.5, F + 1.5, lz + 2.8];
    S.cellarGuard.push({ x: lx + 2.6, z: lz - 0.2, yaw: faceYaw(-1, 0.3), role: 'stair' }, { x: lx + 0.4, z: lz - 1.8, yaw: faceYaw(0, 1), role: 'sit' });
    sandals(H, 105.4, 30.6, Math.PI / 2, 1);
  }

  // ---------------------------------------------------------------- неф ----
  const P = C.pool, nv = C.nave;
  {
    // бассейн: каменный бортик (эллиптическое кольцо), коллизия, вода рисуется в lighting.js
    const NT = 56, rails = [];
    const ring = (k, y) => { const row = []; for (let i = 0; i <= NT; i++) { const a = (i / NT) * Math.PI * 2; row.push([P.c[0] + P.r[0] * k * Math.cos(a), y, P.c[1] + P.r[1] * k * Math.sin(a)]); } return row; };
    rails.push(ring(1.16, F - 0.02), ring(1.13, F + 0.3), ring(1.0, F + 0.3), ring(0.985, F - 0.2));
    B.rails('stone', rails, { want: [1, 0, 0], color: [0.86, 0.8, 0.7], par: [0.9, 0, 0], uvu: 12, uvv: 1 });
    addBlock({ x0: P.c[0] - P.r[0] * 0.98, x1: P.c[0] + P.r[0] * 0.98, z0: P.c[1] - P.r[1] * 1.0, z1: P.c[1] + P.r[1] * 1.0 }, 0);
    // мерные кольца на шнурах у борта и чаша для питья стражи
    for (let i = 0; i < 6; i++) { const x = P.c[0] - 5 + i * 2; B.cyl('metal', [x, F + 0.62, P.c[1] - P.r[1] * 1.22], 0.025, 0.025, 0.6, 6, { color: [0.45, 0.4, 0.34] }); for (let k = 0; k < 3; k++) B.geo('brass', new THREE.TorusGeometry(0.055, 0.008, 6, 12), { pos: [x, F + 0.42 + k * 0.17, P.c[1] - P.r[1] * 1.22], rot: [Math.PI / 2, 0, 0], color: [0.8, 0.65, 0.4] }); }
    S.pool.push({ x: P.c[0] - 1.9, z: P.c[1] - P.r[1] * 1.42, yaw: faceYaw(0, 1) }, { x: P.c[0] + 2.1, z: P.c[1] + P.r[1] * 1.42, yaw: faceYaw(0, -1) });
    S.cellarGuard.push({ x: P.c[0] + 1.2, z: C.bayZ.n + 2.6, yaw: faceYaw(0, 1), role: 'patrol' });
    ctx.poi.cellarPool = [P.c[0], F + 0.2, P.c[1] - P.r[1] - 0.8];
  }

  // колонны: бронзовые пояса и таблички с отметками уровня воды
  for (const [px, pz] of C.pillars) {
    for (const y of [F + 0.9, F + 2.8]) B.geo('metal', new THREE.TorusGeometry(0.645, 0.032, 6, 22), { pos: [px, y, pz], rot: [Math.PI / 2, 0, 0], color: [0.24, 0.2, 0.17] });
    B.box('brass', [px, F + 1.5, pz + (pz < 37 ? -0.64 : 0.64)], [0.22, 0.34, 0.012], { color: [0.7, 0.55, 0.32] });
  }

  // ниши-кладовые: ряды больших запечатанных сосудов; перед нишей — водосборный таз под воронкой
  const vesselCols = [[0.46, 0.28, 0.18], [0.52, 0.34, 0.22], [0.4, 0.26, 0.2], [0.55, 0.4, 0.26]];
  const vessel = (x, z, sc, col) => {
    B.lathe('clay', VESSEL, [x, F, z], 18, { scale: [sc, sc, sc], color: col, par: [0.25, 0, 0] });
    // восковая печать и крышка из пряного волокна, шнуровая сетка
    B.cyl('cloth', [x, F + 1.54 * sc, z], 0.19 * sc, 0.22 * sc, 0.08 * sc, 10, { color: [0.8, 0.72, 0.55], par: [0, 0, 0] });
    B.sphere('clay', [x + 0.12 * sc, F + 1.57 * sc, z], 0.045 * sc, { color: [0.62, 0.12, 0.08], ws: 8, hs: 6 });
    for (let k = 0; k < 3; k++) B.geo('cloth', new THREE.TorusGeometry((0.5 - k * 0.04) * sc, 0.012, 5, 22), { pos: [x, F + (0.35 + k * 0.28) * sc, z], rot: [Math.PI / 2, 0, 0], color: [0.55, 0.45, 0.3], par: [0, 0, 0] });
  };
  C.bayX.forEach((x, i) => {
    for (const [zb, sg] of [[C.bayZ.n, -1], [C.bayZ.s, 1]]) {
      vessel(x - 0.85, zb - sg * 0.0, 1.0, vesselCols[(i + (sg > 0 ? 1 : 0)) % 4]);
      vessel(x + 0.95, zb + sg * 0.25, 0.86, vesselCols[(i + 2) % 4]);
      if (i % 2 === 0) vessel(x + 0.1, zb - sg * 0.9, 0.62, vesselCols[(i + 1) % 4]);
      addBlock({ x0: x - 1.8, x1: x + 1.8, z0: Math.min(zb - 1.2, zb + 1.2), z1: Math.max(zb - 1.2, zb + 1.2) }, 0);
    }
  });
  // водосборные тазы вдоль длинных стен между нишами (на «столбах»): трубка-воронка с потолка, капли
  for (const x of [118.5, 124.5, 130.5, 136.5]) for (const [zb, sg] of [[31.1, -1], [42.9, 1]]) {
    B.lathe('clay', BASIN, [x, F, zb], 18, { scale: [0.55, 0.55, 0.55], color: [0.44, 0.3, 0.2], par: [0.5, 0, 0] });
    B.cyl('stone', [x, F + 0.2, zb], 0.5, 0.5, 0.02, 14, { color: [0.05, 0.09, 0.12], par: [1, 0, 0] });
    B.cyl('metal', [x, F + 1.7, zb], 0.025, 0.025, 2.6, 5, { color: [0.3, 0.27, 0.24] });
    B.cyl('metal', [x, F + 0.46, zb], 0.02, 0.1, 0.18, 8, { color: [0.38, 0.33, 0.28] });
    ctx.drips.push({ x, y0: F + 0.42, y1: F + 0.2, ytop: F + 0.5, z: zb, period: 5 + R() * 4, phase: R() * 8, bowl: true });
    addBlock({ cx: x, cz: zb, r: 0.45 }, 0);
  }
  // капельницы над бассейном
  for (const [dx, dz] of [[-4, 0.6], [1.5, -0.8], [5, 0.4]]) ctx.drips.push({ x: P.c[0] + dx, y0: F - 0.2, y1: F - 0.3, ytop: -5.0, z: P.c[1] + dz, period: 6 + R() * 5, phase: R() * 8, pool: true });
  // туман над водой и у стен (холодный, редкий)
  for (let i = 0; i < 6; i++) ctx.mist.push({ x: P.c[0] - 6 + i * 2.4, y: F + 0.25, z: P.c[1] + (i % 2 ? 1.2 : -1.2), col: [0.55, 0.66, 0.78], amp: 0.1, rate: 1.1, up: 0.1, spread: 0.6, life: 1.4 });
  for (const x of [114, 126, 138]) ctx.mist.push({ x, y: F + 0.3, z: C.bayZ.n + 1.0, col: [0.55, 0.66, 0.78], amp: 0.07, rate: 1.6, up: 0.08, spread: 0.5, life: 1.2 });
  for (let i = 0; i < 4; i++) ctx.mist.push({ x: st.x, y: heightAtLocal(st.x, st.z0 + 8 + i * 5, 0) + 0.3, z: st.z0 + 8 + i * 5, col: [0.62, 0.7, 0.78], amp: 0.06, rate: 2.0, up: 0.1, spread: 0.5, life: 1.2 });

  // ---------------------------------------------------------------- станция измерения (восточный торец) ----
  {
    const [sx, , sz] = C.station.c;
    const yf = F;
    // каменный стол с весами
    B.box('stone', [sx - 0.3, yf + 0.5, sz], [1.7, 1.0, 0.95], { color: [0.9, 0.84, 0.74], par: [0.9, 0, 0] });
    B.box('wood', [sx - 0.3, yf + 1.02, sz], [1.8, 0.06, 1.05], { color: [0.5, 0.38, 0.27], par: [0.8, 0, 0] });
    addBlock({ x0: sx - 1.2, x1: sx + 0.6, z0: sz - 0.6, z1: sz + 0.6 }, 0);
    // весы: стойка, коромысло, чашки на цепочках, гири
    B.cyl('brass', [sx - 0.3, yf + 1.5, sz], 0.025, 0.03, 0.9, 8, { color: [0.85, 0.7, 0.4] });
    B.box('brass', [sx - 0.3, yf + 1.95, sz], [0.04, 0.04, 0.9], { color: [0.85, 0.7, 0.4] });
    for (const dz of [-0.45, 0.45]) {
      seg(H, 'brass', [sx - 0.3, yf + 1.95, sz + dz], [sx - 0.3, yf + 1.5, sz + dz], 0.005, [0.8, 0.65, 0.4]);
      B.lathe('brass', [[0, 0], [0.16, 0.0], [0.17, 0.01], [0.15, 0.04], [0, 0.03]], [sx - 0.3, yf + 1.5 - 0.02, sz + dz], 12, { color: [0.85, 0.7, 0.4] });
    }
    for (let i = 0; i < 5; i++) B.cyl('brass', [sx + 0.2, yf + 1.1, sz - 0.4 + i * 0.12], 0.025 + i * 0.006, 0.03 + i * 0.006, 0.04 + i * 0.01, 8, { color: [0.75, 0.6, 0.35] });
    // мерные столбики: латунные ободья через 10 см
    for (const [px, pz, hgt] of [[sx + 2.3, sz - 2.0, 2.2], [sx + 2.3, sz + 2.0, 2.2]]) {
      B.cyl('stone', [px, yf + hgt / 2, pz], 0.12, 0.14, hgt, 10, { color: [0.85, 0.78, 0.66], par: [0.9, 0, 0] });
      for (let k = 0; k < 18; k++) B.geo('brass', new THREE.TorusGeometry(0.125 + (k % 5 === 0 ? 0.012 : 0.004), k % 5 === 0 ? 0.012 : 0.006, 5, 14), { pos: [px, yf + 0.2 + k * 0.1, pz], rot: [Math.PI / 2, 0, 0], color: [0.8, 0.66, 0.4] });
    }
    // эталон меры: латунный сосуд на постаменте
    B.cyl('stone', [sx + 1.8, yf + 0.45, sz + 0.1], 0.38, 0.45, 0.9, 12, { color: [0.88, 0.82, 0.72], par: [0.9, 0, 0] });
    B.lathe('brass', VESSEL, [sx + 1.8, yf + 0.9, sz + 0.1], 16, { scale: [0.38, 0.38, 0.38], color: [0.85, 0.7, 0.4] });
    addBlock({ cx: sx + 1.8, cz: sz + 0.1, r: 0.5 }, 0);
    // кафедра с книгой долгов
    B.box('wood', [sx - 1.8, yf + 0.55, sz - 1.2], [0.6, 1.1, 0.5], { color: [0.5, 0.38, 0.27], rot: [0, 0.4, 0] });
    B.box('wood', [sx - 1.8, yf + 1.2, sz - 1.2], [0.85, 0.05, 0.6], { color: [0.55, 0.42, 0.3], rot: [-0.4, 0.4, 0] });
    B.box('cloth', [sx - 1.8, yf + 1.25, sz - 1.2], [0.7, 0.05, 0.45], { color: [0.86, 0.8, 0.66], rot: [-0.4, 0.4, 0], par: [0, 0, 0] });
    addBlock({ cx: sx - 1.8, cz: sz - 1.2, r: 0.55 }, 0);
    ctx.poi.cellarStation = [sx - 0.3, yf + 1.5, sz];
    // полка с мерными чашками вдоль восточной стены
    const wx = sx + C.station.r[0] * 0.78;
    B.box('wood', [wx - 0.3, yf + 1.55, sz + 0.2], [0.34, 0.05, 3.0], { color: [0.5, 0.38, 0.27] });
    for (let i = 0; i < 9; i++) B.lathe('brass', CUP, [wx - 0.3, yf + 1.58, sz - 1.1 + i * 0.3], 8, { scale: [1.5 + (i % 3) * 0.3, 1.6, 1.5 + (i % 3) * 0.3] });
    for (let i = 0; i < 4; i++) jar(wx - 0.55, sz - 1.2 + i * 0.8, i % 2 === 0, [0.6, 0.45, 0.34], yf);
    S.scribe.push({ x: sx - 1.6, z: sz - 0.4, yaw: faceYaw(0, -1), role: 'scribe' });
    S.cellarGuard.push({ x: sx + 1.2, z: sz + 1.6, yaw: faceYaw(-1, 0), role: 'station' });
  }
  ctx.poi.cellarGate = [107.5, F + 1.4, 31.4];
}

/** Оформление последних метров выходного туннеля: песчаный порог, садовый инвентарь, связки трав, вёдра. */
export function buildExit(H) {
  const { B, ctx, R, jar, WOOD } = H;
  B.region = 'B5';
  const E = EXIT;
  const at = (s, lat) => {
    let i = 0; while (i < E.cum.length - 2 && E.cum[i + 1] < s) i++;
    const t = (s - E.cum[i]) / Math.max(1e-3, E.cum[i + 1] - E.cum[i]);
    const ax = E.nodes[i][0] + (E.nodes[i + 1][0] - E.nodes[i][0]) * t, az = E.nodes[i][1] + (E.nodes[i + 1][1] - E.nodes[i][1]) * t;
    const dx = E.nodes[i + 1][0] - E.nodes[i][0], dz = E.nodes[i + 1][1] - E.nodes[i][1], l = Math.hypot(dx, dz) || 1;
    return [ax - (dz / l) * lat, az + (dx / l) * lat, Math.atan2(dx, dz)];
  };
  const sEnd = E.length - E.tail;
  // песчаный нанос у устья (ковёр из «песка» с рябью): три слоя
  for (let k = 0; k < 4; k++) {
    const [x, z, yaw] = at(sEnd - 1.0 - k * 1.9, (k % 2 ? 0.5 : -0.4));
    const y = heightAtLocal(x, z, 0);
    B.cyl('sand', [x, y + 0.012 + k * 0.004, z], 1.3 - k * 0.12, 1.4 - k * 0.1, 0.02, 14, { scale: [1.0, 1, 0.65], rot: [0, yaw, 0], color: [1, 0.9, 0.72], par: [0, 0, 2] });
  }
  // садовый инвентарь у правой стены: кетмень, лейки, корзины, мешок с семенами
  {
    const [x, z, yaw] = at(sEnd - 9, 1.15), y = heightAtLocal(x, z, 0);
    seg(H, 'wood', [x, y, z], [x + Math.sin(yaw + 1.57) * 0.0 + 0.0, y + 1.6, z], 0.018, [0.55, 0.42, 0.3]);
    B.box('metal', [x, y + 1.6, z], [0.14, 0.02, 0.12], { color: [0.3, 0.27, 0.24] });
    for (let i = 0; i < 3; i++) jar(...at(sEnd - 8 + i * 0.4, 1.1).slice(0, 2), i === 0, [0.6, 0.45, 0.34], undefined);
    const [bx, bz] = at(sEnd - 10.5, 1.1);
    B.sphere('clothStatic', [bx, heightAtLocal(bx, bz, 0) + 0.25, bz], 0.3, { scale: [1.1, 0.9, 0.9], color: [0.62, 0.5, 0.36], ws: 8, hs: 6 });
  }
  // связки сушёных трав и нитки на крюках под потолком у устья
  for (let k = 0; k < 4; k++) {
    const [x, z] = at(sEnd - 4 - k * 2.2, k % 2 ? 1.0 : -1.0);
    const y = heightAtLocal(x, z, 0);
    B.cyl('cloth', [x, y + 2.4, z], 0.03, 0.055, 0.45, 6, { color: [0.3 + (k % 2) * 0.1, 0.4, 0.22], par: [0, 0, 0.6] });
  }
}

/** Мелкие детали по всему сиетчу: крючья творца на стенах галереи, мерные кольца у дверей комнат. */
export function buildDetails(H) {
  const { B, ctx, A, WOOD } = H;
  const { hooksBoard } = roomHelpers;
  B.region = 'B2';
  // крючья творца: на столбах между нишами (по вент-якорям) — на высоте руки
  for (const x of [58, 70, 83, 95]) for (const sg of [-1, 1]) {
    const a = A[`vent_${x}_${sg}`]; if (!a) continue;
    const [px, , pz] = a.p, n = a.n;
    hooksBoard(H, px + 0.9, 1.75, pz + n[2] * 0.06, 'x', n[2] > 0 ? 1 : -1);
  }
  // кольца на гвоздях у дверей комнат
  B.region = 'B3';
  for (const n of NICHES) {
    if (n.kind === 'shrine') continue;
    const x = n.xc + 1.45, z = n.side * 1.5;
    B.box('wood', [x, 1.5, z + n.side * 0.0], [0.02, 0.02, 0.1], { color: WOOD });
    for (let k = 0; k < 4; k++) B.geo('brass', new THREE.TorusGeometry(0.05 + k * 0.004, 0.007, 6, 14), { pos: [x, 1.46 - k * 0.04, z], rot: [0, Math.PI / 2, 0], color: [0.78, 0.62, 0.4] });
  }
}
