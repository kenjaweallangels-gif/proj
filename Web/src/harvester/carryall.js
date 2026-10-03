// Переносчик гильдии: тяжёлый грузовой аппарат вертикального взлёта (оригинальный дизайн): толстый веретенообразный фюзеляж с грузовым
// «килем» и лебёдками, четыре членистых крыла-«стрекозы» (3 звена на крыло, взмахи с запаздыванием по звеньям, гул ~1.5–1.9 Гц),
// четыре подъёмных кольцевых вентилятора, носовой экипажный гондол, хвостовое оперение, убирающиеся опоры.
// Геометрия — Parts (вершинные цвета + теги) и общий материал корпуса харвестера (панели, заклёпки, пыль).
// API (используется сценарием «пожирание»): group, update, script, setCables, setPod, pod, cabMesh, lugWorld, body, lugLocal.
import * as THREE from 'three';
import { Parts } from './parts.js';
import { C } from './hull.js';
import { buildDecals } from './material.js';

const _m = new THREE.Matrix4();
const KHAKI = '#a99b78', KHAKI2 = '#8d7f5f', TAN = '#a88a5a', TAN2 = '#8f7448', DARK = '#2a2c2e', STEEL = '#85847f', GREEN = '#4d5f57', OLIVE = '#5c6152';

// точки подвеса тросов (локально, под брюхом) — их использует сценарий; не менять
const LUG_LOCAL = [[4, -7.8, 3.4], [4, -7.8, -3.4], [-9, -7.8, 3.0], [-9, -7.8, -3.0]];
// корни крыльев: x, y, z, сторона (+1 правое, -1 левое)
const WROOT = [[5, 2.6, 3.4, 1], [5, 2.6, -3.4, -1], [-5.5, 2.6, 3.4, 1], [-5.5, 2.6, -3.4, -1]];
const SEG_LEN = [8.2, 8.0, 7.4];            // звенья крыла (по размаху), всего ~23.6 м
const CHORD0 = 9.6;                          // хорда у корня

const chordAt = (z) => CHORD0 - 5.6 * Math.min(1, z / 23.6);

// ---------------------------------------------------------------------------------------------- фюзеляж
function fuselage() {
  const P = new Parts(1201);
  const pts = [[0.15, 17.5], [1.2, 16.8], [2.4, 15.3], [3.5, 12.2], [4.2, 7.5], [4.5, 2], [4.4, -3], [4.0, -8], [3.2, -12], [2.2, -15.5], [1.2, -18.2], [0.5, -20.2]]
    .map(([r, x]) => new THREE.Vector2(r, x));
  const lathe = new THREE.LatheGeometry(pts, 24);
  lathe.rotateZ(-Math.PI / 2);
  _m.makeScale(1, 0.88, 1.12);
  P._push(lathe, KHAKI, 0, 0.02, _m);
  // обшивочные пояса и рёбра
  for (const x of [11, 6, 1, -4, -9, -14]) P.cyl(x, 0, 0, 4.6 - Math.abs(x) * 0.04, 4.6 - Math.abs(x) * 0.04, 0.34, x % 2 ? C.TEAL : STEEL, 1, { axis: 'x', seg: 24, jit: 0.04 });
  for (const s of [-1, 1]) {
    for (let i = 0; i < 8; i++) P.box(-12 + i * 3.4, 0.6, s * 4.95, 2.4, 2.0, 0.12, i % 3 === 0 ? KHAKI2 : KHAKI, 0, { jit: 0.06 });   // накладные панели, люки
    for (let i = 0; i < 5; i++) P.cyl(-9 + i * 4.3, -1.2, s * 5.0, 0.28, 0.28, 0.2, DARK, 2, { axis: 'z', seg: 8 });
  }
  // горбатый моторный отсек, охлаждающие жалюзи, надстройка
  P.box(-2, 4.6, 0, 13, 1.5, 4.8, KHAKI2, 0);
  for (let i = 0; i < 8; i++) P.box(-7.6 + i * 1.7, 5.45, 0, 0.16, 0.5, 5.0, DARK, 1);
  P.box(-2, 5.4, 0, 12, 0.18, 1.0, C.YEL, 4);
  for (const s of [-1, 1]) { P.cyl(-6 + 0, 5.9, s * 1.6, 0.5, 0.65, 1.2, '#4b4640', 3, { seg: 10 }); P.cyl(-6, 6.6, s * 1.6, 0.7, 0.55, 0.3, DARK, 2, { seg: 10 }); }
  // кили: хвост (двойное оперение) и стабилизатор с элеронами
  for (const s of [-1, 1]) {
    P.box(-16.5, 4.4, s * 2.6, 5.2, 6.4, 0.3, KHAKI2, 0, { rz: 0.38, rx: s * 0.1 });
    P.box(-19.2, 6.2, s * 2.6, 1.8, 3.4, 0.22, C.YEL, 4, { rz: 0.38 });
    P.box(-17.5, 1.0, s * 6.6, 4.6, 0.3, 8.6, KHAKI2, 0, { jit: 0.06 });
    P.box(-20.0, 1.0, s * 6.6, 1.2, 0.26, 8.4, TAN2, 0);
    P.box(-17.5, 1.0, s * 10.8, 4.0, 0.34, 0.5, C.YEL, 4);
  }
  P.box(-17.5, 1.0, 0, 4.6, 0.36, 5.0, KHAKI2, 0);
  P.cyl(-21.2, 0.2, 0, 1.1, 0.7, 1.8, DARK, 2, { axis: 'x', seg: 14 });                 // хвостовое сопло
  // носовой экипажный гондол (кабина экипажа) и обзорный купол
  P.cyl(12.8, -1.6, 0, 1.55, 1.8, 4.8, KHAKI, 0, { axis: 'x', seg: 18, jit: 0.03 });
  P.cyl(15.6, -1.6, 0, 0.7, 1.55, 1.2, KHAKI, 0, { axis: 'x', seg: 18 });
  P.cyl(12.6, -1.6, 0, 1.62, 1.62, 0.3, C.TEAL, 1, { axis: 'x', seg: 18 });
  P.box(13.0, -3.4, 0, 1.6, 0.4, 1.2, DARK, 2);
  P.box(10.2, -3.0, 0, 3.0, 0.2, 1.8, STEEL, 1);                                         // трап-люк
  for (let i = 0; i < 4; i++) P.box(9.0 + i * 0.7, -3.25, 0, 0.06, 0.06, 1.7, STEEL, 1);
  // грузовой киль (брюшной грузовой отсек) с створками и рамой лебёдок
  P.box(-2.5, -3.9, 0, 17, 1.5, 6.4, KHAKI2, 0);
  P.box(-2.5, -4.75, 0, 17.4, 0.22, 6.8, STEEL, 1);
  for (const x of [-9, -5, -1, 3, 7]) P.box(x, -4.5, 0, 0.35, 0.8, 6.9, C.YEL, 4);
  for (const s of [-1, 1]) { P.box(-2.5, -4.35, s * 3.3, 17.4, 0.9, 0.2, DARK, 2); P.box(-2.5, -3.2, s * 3.3, 17.4, 0.12, 0.28, C.YEL, 4); }
  // лебёдки: барабаны, кожухи, тросовые обрывки к крюкам
  for (const [x, , z] of LUG_LOCAL) {
    P.cyl(x, -4.7, z, 0.62, 0.62, 1.6, '#4a463f', 1, { axis: 'z', seg: 16 });
    for (const s of [-1, 1]) P.cyl(x, -4.7, z + s * 0.85, 0.82, 0.82, 0.14, STEEL, 1, { axis: 'z', seg: 16 });
    P.box(x, -4.2, z, 1.6, 0.5, 1.3, DARK, 2);
    P.cyl(x, -6.2, z, 0.06, 0.06, 3.2, '#2b2926', 2, { seg: 5 });                         // трос до крюка
    P.box(x, -7.55, z, 0.7, 0.6, 0.6, C.YEL, 4);                                          // обойма
    P.torus(x, -8.1, z, 0.34, 0.09, Math.PI * 1.5, STEEL, 1, { rx: 0, ry: 0, rz: Math.PI * 0.25 });
  }
  // антенны, сенсоры, прожекторы, стойки
  for (const [x, y, z, h] of [[8, 4.2, 1.8, 3.2], [-12, 4.6, -1.6, 4.0], [14, 2.6, 0, 2.4]]) { P.cyl(x, y + h / 2, z, 0.05, 0.1, h, '#2c2a27', 2, { seg: 6 }); P.box(x, y + h * 0.7, z, 1.6, 0.06, 0.06, '#2c2a27', 2); }
  for (const s of [-1, 1]) { P.box(15.0, -0.9, s * 1.0, 0.6, 0.5, 0.7, DARK, 2); P.box(7.5, -3.4, s * 4.2, 0.5, 0.4, 0.5, DARK, 2); }
  // подкосы корней крыльев (кронштейны)
  for (const [x, , z, s] of WROOT) {
    P.cyl(x, 2.7, z * 1.06, 0.55, 0.55, 1.4, STEEL, 1, { axis: 'z', seg: 12 });
    P.box(x, 3.3, z * 0.7, 1.4, 1.5, 1.8, KHAKI2, 0);
    P.box(x + 0.4, 1.0, s * 5.6, 0.5, 2.6, 0.5, STEEL, 1, { rx: s * 0.7 });
  }
  return P.merge();
}

/** Кольцевой подъёмный вентилятор (неподвижный кожух + опорная пилонная связь). */
function ductHousing(sd) {
  const P = new Parts(1301);
  P.cyl(0, 0, 0, 2.5, 2.5, 1.5, KHAKI2, 0, { seg: 26, open: true });
  P.cyl(0, 0.78, 0, 2.62, 2.62, 0.2, STEEL, 1, { seg: 26 });
  P.cyl(0, -0.78, 0, 2.55, 2.55, 0.2, DARK, 2, { seg: 26 });
  P.cyl(0, 0, 0, 0.5, 0.5, 1.4, DARK, 2, { seg: 12 });
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + 0.4; P.box(Math.cos(a) * 1.25, -0.3, Math.sin(a) * 1.25, 2.4, 0.12, 0.3, STEEL, 1, { ry: -a }); }
  P.box(0, 0.2, -sd * 3.0, 1.0, 1.0, 3.6, KHAKI2, 0);              // пилон к фюзеляжу
  P.box(0, -0.2, -sd * 3.2, 2.2, 0.3, 2.4, STEEL, 1);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; P.box(Math.cos(a) * 2.55, 0.8, Math.sin(a) * 2.55, 0.3, 0.14, 0.24, C.YEL, 4, { ry: -a }); }
  return P.merge();
}
function ductFan() {
  const P = new Parts(1302);
  P.cyl(0, 0, 0, 0.55, 0.55, 0.5, '#3a3d40', 2, { seg: 12 });
  for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; P.box(Math.cos(a) * 1.3, 0, Math.sin(a) * 1.3, 1.75, 0.05, 0.62, k % 3 === 0 ? C.YEL : STEEL, 1, { ry: -a, rx: 0.0, rz: 0.12 }); }
  P.cyl(0, 0, 0, 2.3, 2.3, 0.06, '#1f1e1c', 2, { seg: 24, open: true });
  return P.merge();
}

// ---------------------------------------------------------------------------------------------- крыло: звено i, сторона sd (+1 правое)
function wingSeg(i, sd) {
  const P = new Parts(1400 + i * 7 + (sd > 0 ? 0 : 3));
  const z0 = SEG_LEN.slice(0, i).reduce((a, b) => a + b, 0), len = SEG_LEN[i], z1 = z0 + len;
  const c0 = chordAt(z0), c1 = chordAt(z1);
  // передний лонжерон (труба) и задняя кромка
  P.cyl(0, 0, sd * len / 2, 0.32 - i * 0.04, 0.32 - i * 0.04, len, '#3d3a35', 1, { axis: 'z', seg: 10 });
  P.box(-(c0 + c1) / 2 - 0.1, -0.04, sd * len / 2, 0.22, 0.2, len, '#3d3a35', 1, { ry: sd * Math.atan2(c0 - c1, len) * -0.5 });
  // мембрана: панели между нервюрами со слегка отличающимся тоном, как лоскутная перепонка
  const nR = 6;
  for (let r = 0; r < nR; r++) {
    const t0 = r / nR, t1 = (r + 1) / nR, zA = t0 * len, zB = t1 * len;
    const cA = c0 + (c1 - c0) * t0, cB = c0 + (c1 - c0) * t1, cm = (cA + cB) / 2, zm = (zA + zB) / 2;
    P.box(-cm / 2 - 0.15, -0.06, sd * zm, cm, 0.12, (zB - zA) - 0.06, (r + i) % 3 === 0 ? TAN2 : (r + i) % 3 === 1 ? TAN : '#9b8052', 0, { jit: 0.07 });
    P.box(-cm * 0.5 - 0.15, 0.1, sd * zA, cA, 0.14, 0.16, '#3d3a35', 1);                 // нервюра сверху
    P.box(-cm * 0.5 - 0.15, -0.2, sd * zm, cm * 0.96, 0.05, 0.12, '#5b5448', 3);          // нижняя тяга
    // щитки на задней кромке (закрылки)
    P.box(-cm - 0.35, -0.08, sd * zm, 0.9, 0.1, (zB - zA) - 0.14, r % 2 ? C.TEAL : TAN, 0);
  }
  // продольные жилки
  for (const f of [0.28, 0.55, 0.8]) P.box(-(c0 + c1) / 2 * f - 0.1, 0.07, sd * len / 2, 0.1, 0.08, len, '#4a443d', 1);
  // шарниры и гидроцилиндры
  P.cyl(0, 0, sd * z0, 0.5, 0.5, 0.7, STEEL, 1, { axis: 'z', seg: 12 });
  if (i < 2) P.cyl(-0.4, -0.5, sd * (len - 0.2), 0.4, 0.4, 0.6, STEEL, 1, { axis: 'z', seg: 12 });
  P.cyl(-1.0, -0.3, sd * len * 0.55, 0.14, 0.14, len * 0.55, '#7a2e1e', 2, { axis: 'z', seg: 6 });
  if (i === 2) {   // законцовка: сигнальные полосы
    P.box(-1.8, 0.13, sd * (len - 0.9), 3.4, 0.08, 1.4, C.YEL, 4);
    P.box(-c1 - 0.5, -0.1, sd * (len - 0.2), 0.6, 0.3, 0.5, C.YEL, 4);
  }
  return P.merge();
}

/** Спасательная капсула экипажа: веретено 8 м с иллюминатором; в сценарии «пожирание» взлетает с крыши к переносчику. */
function podGeo() {
  const P = new Parts(1210);
  P.cyl(0, 0, 0, 2.2, 2.2, 6.4, '#c4b08a', 0, { axis: 'x', seg: 14, jit: 0.03 });
  P.cyl(3.6, 0, 0, 0.9, 2.2, 1.6, '#c4b08a', 0, { axis: 'x', seg: 14, jit: 0.03 });
  P.cyl(-3.6, 0, 0, 2.0, 1.6, 0.9, '#4b4640', 1, { axis: 'x', seg: 14 });
  P.cyl(1.0, 0, 0, 2.28, 2.28, 0.5, C.TEAL, 1, { axis: 'x', seg: 14 });
  P.box(0.2, 2.35, 0, 1.6, 0.35, 0.6, C.YEL, 4);
  P.cyl(0, 2.6, 0, 0.16, 0.16, 1.5, '#7a2e1e', 2, { seg: 6 });
  return P.merge();
}

/** Опора шасси: бедро + голень + лыжа; геометрия в системе шарнира, нога смотрит вниз (-y). */
function legGeo() {
  const P = new Parts(1500);
  P.cyl(0, -1.4, 0, 0.32, 0.4, 2.8, STEEL, 1, { seg: 10 });
  P.cyl(0, -3.2, 0, 0.2, 0.26, 2.4, '#c8c4bb', 1, { seg: 8 });
  P.box(0, -4.5, 0, 2.6, 0.28, 1.1, DARK, 2);
  P.box(0, -4.35, 0, 2.4, 0.12, 0.9, C.YEL, 4);
  P.cyl(0.4, -2.0, 0.5, 0.1, 0.1, 2.6, '#7a2e1e', 2, { seg: 6, rz: 0.12 });
  return P.merge();
}

export function createCarryall(game, hullMat, glowMat, lampMat, quality, decalMat) {
  const group = new THREE.Group();
  group.name = 'Carryall';
  const body = new THREE.Group();
  group.add(body);
  const fus = new THREE.Mesh(fuselage(), hullMat);
  fus.frustumCulled = false; fus.castShadow = false;
  body.add(fus);

  // свечение: кабина, окна гондола, огни, сопла
  const G = new Parts(1203);
  G.box(15.0, 2.0, 0, 1.2, 1.3, 3.0, '#ffcf7a', 0, { rz: -0.5, jit: 0.1 });
  G.box(13.2, 2.9, 0, 3.4, 1.1, 3.4, '#ffcf7a', 0, { rz: -0.2, jit: 0.1 });
  for (const z of [-1, 1]) { G.box(-1, 3.4, z * 4.3, 8, 0.28, 0.1, '#ffd9a0', 0); G.cyl(13.0, -1.2, z * 1.6, 0.4, 0.4, 0.08, '#ffcf7a', 0, { axis: 'z', seg: 10 }); G.cyl(11.6, -1.2, z * 1.7, 0.4, 0.4, 0.08, '#ffcf7a', 0, { axis: 'z', seg: 10 }); }
  G.cyl(16.1, -1.6, 0, 0.5, 0.5, 0.06, '#fff1c8', 0, { axis: 'x', seg: 10 });
  G.cyl(-22.1, 0.2, 0, 0.7, 0.4, 0.2, '#ff7a2a', 0, { axis: 'x', seg: 12 });
  for (const s of [-1, 1]) { G.box(15.0, -0.6, s * 1.0, 0.1, 0.35, 0.5, '#fff1c8', 0); G.box(7.5, -3.55, s * 4.2, 0.1, 0.3, 0.4, '#fff1c8', 0); }
  const glass = new THREE.Mesh(G.merge(), glowMat); glass.frustumCulled = false; body.add(glass);

  // декали: эмблема, номер борта, шевроны — на плоских накладках
  if (decalMat) {
    const dl = [];
    for (const s of [-1, 1]) {
      const n = s > 0 ? '+z' : '-z', zz = s * 5.12 * 1.0;
      dl.push({ k: 'sigil', c: [-2, 0.6, zz + s * 0.02], n, w: 2.2, h: 2.2 }, { k: 'num', c: [-8.5, 0.6, zz + s * 0.02], n, w: 3.2, h: 1.2 });
      dl.push({ k: 'chev', c: [4.5, -3.6, s * 3.52], n, w: 6.0, h: 0.7 });
    }
    dl.push({ k: 'num', c: [-3, 5.58, 0], n: '+y', w: 5.5, h: 2.0, rot: Math.PI / 2 }, { k: 'sigil', c: [-12, 5.9, 0], n: '+y', w: 2.4, h: 2.4 });
    const dm = new THREE.Mesh(buildDecals(dl), decalMat); dm.frustumCulled = false; dm.renderOrder = 2; body.add(dm);
  }

  // ----- крылья: цепочки звеньев (иерархия групп), геометрия по сторонам
  const segGeo = { 1: [0, 1, 2].map((i) => wingSeg(i, 1)), '-1': [0, 1, 2].map((i) => wingSeg(i, -1)) };
  const wings = WROOT.map(([x, y, z, sd]) => {
    const root = new THREE.Group(); root.position.set(x, y, z); body.add(root);
    const mesh0 = new THREE.Mesh(segGeo[sd][0], hullMat); mesh0.frustumCulled = false; root.add(mesh0);
    const j1 = new THREE.Group(); j1.position.set(0, 0, sd * SEG_LEN[0]); root.add(j1);
    const mesh1 = new THREE.Mesh(segGeo[sd][1], hullMat); mesh1.frustumCulled = false; mesh1.position.z = -sd * SEG_LEN[0]; j1.add(mesh1);
    const j2 = new THREE.Group(); j2.position.set(0, 0, sd * SEG_LEN[1]); j1.add(j2);
    const mesh2 = new THREE.Mesh(segGeo[sd][2], hullMat); mesh2.frustumCulled = false; mesh2.position.z = -sd * (SEG_LEN[0] + SEG_LEN[1]); j2.add(mesh2);
    return { root, j1, j2, sd, x };
  });

  // ----- подъёмные кольцевые вентиляторы (по одному под внутренним звеном каждого крыла)
  const ductPos = [[5, 0.2, 8.2, 1], [5, 0.2, -8.2, -1], [-5.5, 0.2, 8.2, 1], [-5.5, 0.2, -8.2, -1]];
  const ductGeo = { 1: ductHousing(1), '-1': ductHousing(-1) };
  const fanGeo = ductFan();
  const fans = ductPos.map(([x, y, z, sd]) => {
    const h = new THREE.Mesh(ductGeo[sd], hullMat); h.position.set(x, y, z); h.frustumCulled = false; body.add(h);
    const f = new THREE.Mesh(fanGeo, hullMat); f.position.set(x, y - 0.1, z); f.frustumCulled = false; body.add(f);
    const gl = new THREE.Mesh(new THREE.CircleGeometry(2.1, 20), new THREE.MeshBasicMaterial({ color: 0xff8a40, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }));
    gl.rotation.x = Math.PI / 2; gl.position.set(x, y - 0.95, z); body.add(gl);
    return f;
  });

  // ----- убирающиеся опоры
  const legGeoM = legGeo();
  const legs = [[6.5, -4.7, 3.7, 1], [6.5, -4.7, -3.7, -1], [-9.5, -4.7, 3.4, 1], [-9.5, -4.7, -3.4, -1]].map(([x, y, z, sd]) => {
    const g = new THREE.Group(); g.position.set(x, y, z); body.add(g);
    const m = new THREE.Mesh(legGeoM, hullMat); m.frustumCulled = false; g.add(m);
    return { g, sd };
  });

  // ----- навигационные огни: зелёный/красный на законцовках передних крыльев, белые стробы на хвосте, красный маяк в брюхе
  const navGeo = new THREE.SphereGeometry(0.3, 8, 6);
  const navMats = {
    green: new THREE.MeshBasicMaterial({ color: 0x20ff50 }), red: new THREE.MeshBasicMaterial({ color: 0xff2010 }),
    white: new THREE.MeshBasicMaterial({ color: 0xffffff }), amber: new THREE.MeshBasicMaterial({ color: 0xff9a30 }),
  };
  const mkNav = (mat, parent, x, y, z) => { const m = new THREE.Mesh(navGeo, mat); m.position.set(x, y, z); m.frustumCulled = false; parent.add(m); return m; };
  mkNav(navMats.green, wings[0].j2, -3.4, 0.05, SEG_LEN[2] - 0.2);
  mkNav(navMats.red, wings[1].j2, -3.4, 0.05, -(SEG_LEN[2] - 0.2));
  mkNav(navMats.white, body, -19.5, 6.0, 2.6); mkNav(navMats.white, body, -19.5, 6.0, -2.6);
  mkNav(navMats.amber, body, 14.8, 3.6, 0); mkNav(navMats.red, body, -3, -5.0, 0);

  // ----- анимация и сценарный режим
  const q = new THREE.Quaternion(), pos = new THREE.Vector3(), _p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const state = { a: Math.random() * 6.28, hd: 0, x: 0, z: 0 };
  const script = { on: false, pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, flap: 12, strain: 0, hidden: false };
  const hover = { orbit: 0, flap: 0, fan: 0, gear: 0 };

  // Подъёмные тросы: 4 стальных каната от крюков переносчика к крышевым захватам харвестера
  const CAB_N = 4, CAB_SEG = 10;
  const cabMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true), new THREE.MeshStandardMaterial({ color: '#34322e', roughness: 0.5, metalness: 0.8 }), CAB_N * CAB_SEG);
  cabMesh.frustumCulled = false; cabMesh.count = 0; cabMesh.castShadow = false;
  const lugWorld = LUG_LOCAL.map(() => new THREE.Vector3());
  const cabQ = new THREE.Quaternion(), cabM = new THREE.Matrix4(), cabP = Array.from({ length: CAB_SEG + 1 }, () => new THREE.Vector3()), cabD = new THREE.Vector3(), cabC = new THREE.Vector3(), cabS = new THREE.Vector3();
  const UPV = new THREE.Vector3(0, 1, 0);
  /** targets: 4 мировых точки на харвестере; tension 0 (провис) … 1 (струна); vib — амплитуда дрожи, м. */
  function setCables(targets, tension = 1, vib = 0, time = 0) {
    if (!targets) { cabMesh.count = 0; return; }
    let n = 0;
    for (let i = 0; i < CAB_N; i++) {
      const A = lugWorld[i], B = targets[i];
      const len = A.distanceTo(B);
      const sag = (1 - tension) * len * 0.16;
      for (let k = 0; k <= CAB_SEG; k++) {
        const u = k / CAB_SEG, w = u * (1 - u) * 4;
        cabP[k].lerpVectors(A, B, u);
        cabP[k].y -= sag * w;
        const wig = vib * w * Math.sin(u * 9 + time * 19 + i * 1.7);
        cabP[k].x += wig; cabP[k].z += wig * 0.6;
      }
      for (let k = 0; k < CAB_SEG; k++) {
        const a = cabP[k], b = cabP[k + 1];
        cabD.subVectors(b, a); const l = cabD.length();
        if (!(l > 1e-4)) { cabS.set(0, 0, 0); cabM.compose(a, cabQ.identity(), cabS); cabMesh.setMatrixAt(n++, cabM); continue; }
        cabD.multiplyScalar(1 / l);
        cabQ.setFromUnitVectors(UPV, cabD);
        cabC.addVectors(a, b).multiplyScalar(0.5);
        cabM.compose(cabC, cabQ, cabS.set(1, l, 1));
        cabMesh.setMatrixAt(n++, cabM);
      }
    }
    cabMesh.count = n;
    cabMesh.instanceMatrix.needsUpdate = true;
  }
  // капсула экипажа
  const pod = new THREE.Mesh(podGeo(), hullMat);
  pod.frustumCulled = false; pod.visible = false;
  const podGlow = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), glowMat); podGlow.position.set(2.2, 0.5, 1.9); pod.add(podGlow);
  const podGlow2 = podGlow.clone(); podGlow2.position.z = -1.9; pod.add(podGlow2);

  function update(dt, time, H) {
    if (!group.visible) return;
    if (script.on) {
      group.position.copy(script.pos);
      body.rotation.set(script.roll, -script.yaw, script.pitch, 'YZX');
      hover.flap += dt * script.flap;
      animate(dt, time, script.strain, 1);
      body.updateMatrixWorld(true);
      for (let i = 0; i < 4; i++) lugWorld[i].set(LUG_LOCAL[i][0], LUG_LOCAL[i][1], LUG_LOCAL[i][2]).applyMatrix4(body.matrixWorld);
      return;
    }
    hover.orbit += dt * 0.045;
    const R = 34;
    const cx = H.x - 4 + Math.cos(hover.orbit) * R, cz = H.z + Math.sin(hover.orbit) * R * 0.75;
    const wy = Math.max(H.y, 0) + 62 + Math.sin(time * 0.35) * 2.2;
    const tx = -Math.sin(hover.orbit) * R, tz = Math.cos(hover.orbit) * R * 0.75;
    const hd = Math.atan2(tz, tx);
    group.position.set(cx, wy, cz);
    body.rotation.set(0.04 * Math.sin(time * 0.6) + 0.07, -hd, 0.03 * Math.sin(time * 0.43), 'YZX');
    hover.flap += dt * (9 + (H.running ? 3 : 0));
    animate(dt, time, 0, 0);
    group.visible = true;
  }
  function animate(dt, time, strain, scripted) {
    const amp = 1 + 0.5 * strain;
    for (let i = 0; i < 4; i++) {
      const w = wings[i], ph = hover.flap + (w.x < 0 ? 0.9 : 0);
      const a0 = (0.12 + 0.36 * amp * Math.sin(ph)) * (1 + 0.12 * Math.sin(ph * 0.5));
      const a1 = (0.10 + 0.34 * amp * Math.sin(ph - 0.9)) * 0.85;
      const a2 = (0.08 + 0.36 * amp * Math.sin(ph - 1.8)) * 0.8;
      const s = w.sd > 0 ? -1 : 1;              // + θ вокруг x опускает правый край, поднимает левый
      w.root.rotation.x = s * a0;
      w.j1.rotation.x = s * a1;
      w.j2.rotation.x = s * a2;
      w.root.rotation.y = -w.sd * 0.04 * Math.sin(ph * 0.5);      // лёгкий поворот по ветру
    }
    hover.fan += dt * (26 + 10 * strain);
    for (let i = 0; i < 4; i++) fans[i].rotation.y = hover.fan * (i % 2 ? -1 : 1);
    // шасси: убраны на высоте, выпущены у земли (нужна высота над грунтом)
    const alt = group.position.y - (game.world?.heightAt?.(group.position.x, group.position.z) ?? 0);
    const gk = alt < 40 ? 1 : alt < 70 ? 1 - (alt - 40) / 30 : 0;
    hover.gear += (gk - hover.gear) * (1 - Math.exp(-dt * 1.4));
    for (const l of legs) { l.g.rotation.z = (1 - hover.gear) * 1.25; l.g.rotation.x = l.sd * (1 - hover.gear) * 0.25; }
    // огни
    const bl = Math.pow(0.5 + 0.5 * Math.sin(time * 4.5), 6);
    navMats.white.color.setScalar(0.15 + 0.85 * bl);
    navMats.amber.color.setRGB(1, 0.6, 0.2).multiplyScalar(0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(time * 2.1), 3));
    navMats.red.color.setRGB(1, 0.15, 0.08).multiplyScalar(0.55 + 0.45 * Math.sin(time * 3.0 + 1.0));
  }
  /** Поставить капсулу: pos — центр (мир), yaw — курс. */
  function setPod(pos2, yaw, visible = true, pitch = 0) {
    pod.visible = visible;
    if (visible) { pod.position.copy(pos2); pod.rotation.set(0, -yaw, pitch, 'YZX'); }
  }
  return { group, update, script, setCables, setPod, pod, cabMesh, lugWorld, body, get lugLocal() { return LUG_LOCAL; } };
}
