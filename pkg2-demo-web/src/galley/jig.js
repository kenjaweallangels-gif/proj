// Стапель СТ-3 для сборки модуля кухонного КМ-2. Строится в мм в СК модуля (тот же масштаб и начало, что у
// группы модуля): y = 0 — плоскость основания модуля, пол цеха — y = FLOOR. Габарит стапеля привязан к модулю:
// задняя и боковые фермы с раскосами, верхняя траверса с винтовыми прижимами крышки, рычажные прижимы боковин,
// винтовые упоры задней панели, упоры высоты стола и съёмные кронштейны полки со шкалами, ложементы основания,
// метки для привязки AR-очков.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { G } from './spec.js';
import { textTexture, rulerTexture } from './tex.js';
import { painted } from '../scene/materials.js';
import { galleyMat as GM } from './tex.js';

export const FLOOR = -320;                 // пол цеха относительно основания модуля, мм
export const JIG = { x: 1150, zBack: -350, zFront: 1000, top: 2450 };

const blue = () => painted('#2b5d94', { rough: 0.38, metal: 0.35, peel: 48, coat: 0.3 });
const yellow = () => painted('#e3b41c', { rough: 0.4, metal: 0.3, peel: 64, coat: 0.3 });

function box(sx, sy, sz, m, x, y, z, r = 3) {
  const o = new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r, sx / 2.2, sy / 2.2, sz / 2.2)), m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  return o;
}

/** Балка прямоугольного профиля между двумя точками (мм). */
function beam(a, b, w, h, m) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const o = new THREE.Mesh(new RoundedBoxGeometry(w, len, h, 2, 4), m);
  o.position.copy(A).add(B).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  o.castShadow = o.receiveShadow = true;
  return o;
}

function cyl(r, h, m, seg = 20) { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); o.castShadow = o.receiveShadow = true; return o; }

/** Винтовой прижим: корпус-гайка, винт, рукоятка-вороток, резиновая пята. axis — направление на деталь. */
function screwClamp(pos, axis, len) {
  const g = new THREE.Group();
  const dir = new THREE.Vector3(...axis).normalize();
  const nut = box(50, 40, 50, yellow(), 0, 0, 0, 4);
  const screw = cyl(9, len, GM.steel(), 16); screw.position.y = -len / 2;
  const pad = cyl(28, 14, GM.rubber(), 24); pad.position.y = -len - 7;
  const bar = cyl(6, 160, GM.steel(), 12); bar.rotation.z = Math.PI / 2; bar.position.y = 50;
  const knob = cyl(12, 30, GM.red(), 16); knob.rotation.z = Math.PI / 2; knob.position.set(90, 50, 0);
  const shaft = cyl(9, 60, GM.steel(), 16); shaft.position.y = 30;
  g.add(nut, screw, pad, bar, knob, shaft);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  g.position.set(...pos);
  return g;
}

/** Рычажный (горизонтальный) прижим на кронштейне: основание, рычаг, шток с пятой. */
function toggleClamp(pos, sideSign) {
  const g = new THREE.Group();
  g.add(box(90, 20, 50, GM.steel(), 0, 0, 0, 3));
  const lever = box(150, 14, 18, GM.steel(), -sideSign * 40, 45, 0, 4); lever.rotation.z = sideSign * 0.5; g.add(lever);
  const grip = box(60, 26, 26, GM.red(), -sideSign * 110, 85, 0, 8); grip.rotation.z = sideSign * 0.5; g.add(grip);
  const rod = cyl(7, 90, GM.steel(), 14); rod.rotation.z = Math.PI / 2; rod.position.set(sideSign * 70, 20, 0); g.add(rod);
  const pad = cyl(22, 12, GM.rubber(), 20); pad.rotation.z = Math.PI / 2; pad.position.set(sideSign * 120, 20, 0); g.add(pad);
  g.position.set(...pos);
  return g;
}

function marker(id, size = 120) {
  const g = new THREE.Group();
  const back = box(size * 1.25, size * 1.25, 3, GM.alu(), 0, 0, 0, 2);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshPhysicalMaterial({ color: '#f4f4f2', roughness: 0.55, clearcoat: 0.4 }));
  m.position.z = 1.7;
  new THREE.TextureLoader().load(`./markers/marker_${id}.png`, (t) => { t.colorSpace = THREE.SRGBColorSpace; m.material.map = t; m.material.needsUpdate = true; });
  g.add(back, m);
  return g;
}

function tag(text, w = 90, h = 34) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: textTexture([text], { w: 256, h: 96, bg: '#ffffff', size: 56 }), roughness: 0.6 }));
  return m;
}

export function buildJig() {
  const root = new THREE.Group();
  root.name = 'jig';
  root.scale.setScalar(0.001);
  const B = blue(), Y = yellow();
  const { x: X, zBack: ZB, zFront: ZF, top: TOP } = JIG;
  const baseTop = -60, baseBot = -160;
  const markers = [];

  // ---- основание: рама из профиля 100×100, регулируемые опоры ----
  for (const z of [ZB, ZF]) root.add(beam([-X - 50, (baseTop + baseBot) / 2, z], [X + 50, (baseTop + baseBot) / 2, z], 100, 100, B));
  for (const x of [-X, -400, 400, X]) root.add(beam([x, (baseTop + baseBot) / 2, ZB], [x, (baseTop + baseBot) / 2, ZF], 100, 100, B));
  for (const x of [-X, X]) for (const z of [ZB, ZF]) {
    const rod = cyl(12, baseBot - FLOOR - 20, GM.steel(), 14); rod.position.set(x, (baseBot + FLOOR + 20) / 2, z); root.add(rod);
    const pad = cyl(45, 20, GM.rubber(), 24); pad.position.set(x, FLOOR + 10, z); root.add(pad);
    const nut = cyl(22, 18, GM.steel(), 6); nut.position.set(x, baseBot - 30, z); root.add(nut);
  }
  // ложементы основания с фиксаторами Ф1–Ф4
  [[-700, 120], [700, 120], [-700, 760], [700, 760]].forEach(([x, z], i) => {
    root.add(box(140, 60, 140, Y, x, -30, z, 4));
    const t = tag(`Ф${i + 1}`); t.position.set(x, -30, z + 71); root.add(t);
  });

  // ---- стойки: задние и передние, высота TOP ----
  for (const x of [-X, X]) for (const z of [ZB, ZF]) root.add(beam([x, baseTop, z], [x, TOP, z], 100, 100, B));
  // задняя ферма: ригели и раскосы
  const rearY = [300, 1100, 1800, TOP];
  for (const y of rearY) root.add(beam([-X, y, ZB], [X, y, ZB], 80, 80, B));
  for (let i = 0; i < rearY.length - 1; i++) {
    root.add(beam([-X, rearY[i], ZB], [0, rearY[i + 1], ZB], 50, 50, B), beam([X, rearY[i], ZB], [0, rearY[i + 1], ZB], 50, 50, B));
  }
  // боковые фермы
  const sideY = [300, 1300, TOP];
  for (const x of [-X, X]) {
    for (const y of sideY) root.add(beam([x, y, ZB], [x, y, ZF], 80, 80, B));
    root.add(beam([x, 300, ZB], [x, 1300, ZF], 50, 50, B), beam([x, 1300, ZB], [x, TOP, ZF], 50, 50, B));
  }
  // верхняя траверса с винтовыми прижимами крышки
  root.add(beam([-X, TOP + 90, 300], [X, TOP + 90, 300], 100, 100, Y));
  for (const x of [-X, X]) root.add(box(140, 90, 140, Y, x, TOP + 45, 300, 4));
  for (const x of [-420, 420]) root.add(screwClamp([x, TOP + 40, 300], [0, -1, 0], TOP + 40 - G.H - 24));

  // ---- прижимы задней панели (винтовые, с задних ригелей) ----
  for (const y of [1100, 1800]) for (const x of [-500, 500]) root.add(screwClamp([x, y, ZB + 40], [0, 0, 1], -ZB - 40 - 24));

  // ---- рычажные прижимы боковин на консолях ----
  const sideSigns = [-1, 1];
  let fIdx = 5;
  for (const s of sideSigns) {
    for (const [y, z] of [[450, 200], [450, 720], [1650, 150], [1650, 480]]) {
      const armLen = X - 50 - (G.W / 2 + 160);
      root.add(beam([s * (X - 50), y, z], [s * (X - 50 - armLen), y, z], 60, 40, Y));
      root.add(toggleClamp([s * (G.W / 2 + 140), y + 30, z], -s));
    }
    // базовые фиксаторы боковин (Ф5–Ф8)
    for (const [y, z] of [[900, 430], [1950, 300]]) {
      root.add(beam([s * (X - 50), y, z], [s * (G.W / 2 + 30), y, z], 50, 50, Y));
      const pin = cyl(10, 40, GM.steel(), 16); pin.rotation.z = Math.PI / 2; pin.position.set(s * (G.W / 2 + 10), y, z); root.add(pin);
      const t = tag(`Ф${fIdx++}`); t.position.set(s * (G.W / 2 + 100), y + 45, z + 26); root.add(t);
    }
  }

  // ---- упоры высоты стола и кронштейны полки (с передних стоек), шкалы ----
  for (const s of sideSigns) {
    const deckY = G.deckTop - G.tDeck;
    root.add(beam([s * X, deckY - 25, ZF - 50], [s * (G.IN - 40), deckY - 25, ZF - 50], 50, 50, Y));
    root.add(beam([s * (G.IN - 40), deckY - 25, ZF - 50], [s * (G.IN - 40), deckY - 25, G.D - 30], 40, 40, Y));
    root.add(box(60, 20, 60, GM.rubber(), s * (G.IN - 40), deckY - 10, G.D - 60, 3));
    const shY = G.shelfTop - G.tShelf;
    root.add(beam([s * X, shY - 25, ZF - 50], [s * (G.IN - 40), shY - 25, ZF - 50], 50, 50, Y));
    root.add(beam([s * (G.IN - 40), shY - 25, ZF - 50], [s * (G.IN - 40), shY - 25, 560], 40, 40, Y));
    // мерная шкала на внутренней грани передней стойки: 0…2400 мм от основания
    const tex = rulerTexture();
    for (let k = 0; k < 3; k++) {
      const t = tex.clone(); t.needsUpdate = true;
      const r = new THREE.Mesh(new THREE.PlaneGeometry(30, 1000), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }));
      r.position.set(s * (X - 51), k * 1000 + 500, ZF);
      r.rotation.y = -s * Math.PI / 2;
      root.add(r);
    }
  }

  // ---- метки привязки AR (на передних стойках) ----
  [[17, -1, 1650], [19, 1, 1650], [3, -1, 600], [5, 1, 600]].forEach(([id, s, y]) => {
    const m = marker(id);
    m.position.set(s * X, y, ZF + 52);
    root.add(m);
    markers.push({ id, obj: m });
  });

  // табличка стапеля
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(420, 120), new THREE.MeshStandardMaterial({
    map: textTexture(['СТАПЕЛЬ СТ-3 · КМ-2', 'калибровка 30.09.2026 · инв. № 0412'], { w: 768, h: 220, bg: '#f2f2ee', size: 60 }), roughness: 0.6 }));
  plate.position.set(0, 300, ZB - 42);
  plate.rotation.y = Math.PI;
  root.add(plate);
  const plate2 = plate.clone(); plate2.position.set(-X, 1000, ZF + 52); plate2.rotation.y = 0; plate2.scale.setScalar(0.6); root.add(plate2);

  // переносная площадка-ступень у стапеля
  const step = new THREE.Group();
  const alu = GM.alu();
  step.add(box(600, 30, 400, alu, 0, 220 + FLOOR, 0, 4), box(600, 30, 300, alu, 0, 440 + FLOOR, -100, 4));
  const grip = new THREE.MeshStandardMaterial({ color: '#232323', roughness: 0.95 });
  step.add(box(560, 2, 360, grip, 0, 236 + FLOOR, 0, 0.5), box(560, 2, 260, grip, 0, 456 + FLOOR, -100, 0.5));
  for (const sx of [-280, 280]) for (const sz of [-180, 180]) step.add(beam([sx, FLOOR, sz], [sx, (sz < 0 ? 440 : 220) + FLOOR, sz], 30, 30, alu));
  step.position.set(1500, 0, 1350);
  step.rotation.y = -0.3;
  root.add(step);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, markers };
}
