// Сборка мира: цех, стапель с модулем КМ-2, стеллаж комплектации с панелями, тележка с крепежом,
// готовый модуль на соседнем месте (как выглядит «реальная кухня» после всех операций).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { painted } from '../scene/materials.js';
import { buildGalley } from './galley_build.js';
import { HALL, PLACES, buildHall, solid } from './hall.js';
import { FLOOR, JIG, buildJig } from './jig.js';
import { DONE_BEFORE_SHIFT, STEPS, applyStep, stateFrom } from './process.js';
import * as S from './spec.js';
import { galleyMat as GM, textTexture } from './tex.js';

/** Положение модуля на стапеле: центр модуля по X и Z — в начале координат мира. */
export const GALLEY_ORIGIN = new THREE.Vector3(0, -FLOOR / 1000, -S.G.D / 2000);

function box(w, h, d, m, x, y, z, r = 0.004) {
  const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)), m);
  o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o;
}

/** Копия панели «стоя на ребре» для стеллажа: тонкая ось → X мира, длинная → Z, короткая → Y. */
function kitPanel(src, p) {
  const b = S.panelBox(p);
  const size = b.max.map((v, i) => v - b.min[i]);
  const thin = S.slab(p).axis;
  const rest = [0, 1, 2].filter((i) => i !== thin).sort((i, j) => size[j] - size[i]);
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  // базис: модельная ось thin → X, rest[1] (короче) → Y, rest[0] (длиннее) → Z
  const m = new THREE.Matrix4();
  const cols = [];
  cols[thin] = axes[0]; cols[rest[1]] = axes[1]; cols[rest[0]] = axes[2];
  m.makeBasis(cols[0], cols[1], cols[2]);
  if (m.determinant() < 0) { cols[thin] = axes[0].clone().negate(); m.makeBasis(cols[0], cols[1], cols[2]); }
  const c = b.min.map((v, i) => (v + b.max[i]) / 2);
  const g = src.geometry.clone();
  g.translate(-c[0], -c[1], -c[2]);
  g.applyMatrix4(m);
  g.computeBoundingBox();
  const mesh = new THREE.Mesh(g, src.material);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.userData.featureId = p.id;
  mesh.userData.kitHalfY = -g.boundingBox.min.y;
  mesh.userData.thickX = g.boundingBox.max.x - g.boundingBox.min.x;
  return mesh;
}

export function buildWorld(scene) {
  const hall = buildHall(scene);
  const jig = buildJig();
  const galley = buildGalley();
  jig.root.position.copy(GALLEY_ORIGIN);
  galley.root.position.copy(GALLEY_ORIGIN);
  scene.add(jig.root, galley.root);
  // стапель — препятствие (с проходом спереди: модуль открыт к сборщику)
  solid(0, (JIG.zBack + JIG.zFront) / 2000 + GALLEY_ORIGIN.z, 2 * JIG.x / 1000 + 0.2, (JIG.zFront - JIG.zBack) / 1000 + 0.15);

  // ---------- стеллаж комплектации: панели стоят на ребре в гребёнке ----------
  const rack = new THREE.Group();
  const [rx, rz] = PLACES.kitRack;
  rack.position.set(rx, 0, rz);
  const frameM = painted('#2b5d94', { rough: 0.4, metal: 0.4 });
  const felt = new THREE.MeshStandardMaterial({ color: '#3a3f44', roughness: 0.95 });
  rack.add(box(1.6, 0.08, 2.4, frameM, 0, 0.12, 0, 0.006), box(1.56, 0.02, 2.36, felt, 0, 0.17, 0, 0.004));
  for (const sz of [-1.15, 1.15]) for (const sx of [-0.75, 0.75]) rack.add(box(0.06, 0.12, 0.06, GM.rubber(), sx, 0.04, sz, 0.01));
  for (let k = 0; k <= 12; k++) for (const sz of [-1.12, 1.12]) rack.add(box(0.02, 0.9, 0.04, frameM, -0.72 + k * 0.12, 0.62, sz, 0.004));
  for (const sz of [-1.12, 1.12]) rack.add(box(1.5, 0.04, 0.04, frameM, 0, 1.08, sz, 0.006));
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.14), new THREE.MeshStandardMaterial({ map: textTexture(['КОМПЛЕКТ КМ-2 № 017', 'панели 060–080'], { w: 512, h: 144, size: 46 }) }));
  tag.position.set(0, 1.0, 1.15); rack.add(tag);
  scene.add(rack);
  solid(rx, rz, 1.7, 2.5);
  const kit = new Map();
  let slot = 0;
  const pre = stateFrom(0, DONE_BEFORE_SHIFT).installed;
  for (const p of S.PANELS.filter((q) => !pre.has(q.id))) {
    const k = kitPanel(galley.items.get(p.id), p);
    k.scale.setScalar(0.001);
    k.position.set(-0.66 + slot * 0.12 + 0.06, 0.18 + k.userData.kitHalfY * 0.001, 0);
    rack.add(k);
    kit.set(p.id, k);
    slot = (slot + 1) % 12;
  }

  // ---------- тележка комплектации: лотки с уголками, винтами, профили, фурнитура ----------
  const cart = new THREE.Group();
  const [cx, cz] = PLACES.kitCart;
  cart.position.set(cx, 0, cz);
  const cm = painted('#5c6670', { rough: 0.4, metal: 0.45 });
  cart.add(box(0.9, 0.03, 0.6, cm, 0, 0.85, 0, 0.006), box(0.9, 0.03, 0.6, cm, 0, 0.25, 0, 0.006));
  for (const sx of [-0.43, 0.43]) for (const sz of [-0.28, 0.28]) {
    cart.add(box(0.03, 0.8, 0.03, cm, sx, 0.5, sz, 0.004));
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 18), GM.rubber()); wh.rotation.z = Math.PI / 2; wh.position.set(sx, 0.05, sz); cart.add(wh);
  }
  const binColors = ['#2f5f9e', '#2f5f9e', '#3c7a4a', '#d0a31e', '#2f5f9e', '#b3261e'];
  const binLabels = ['УГОЛКИ КМ2.300.010', 'ВИНТЫ М4×10', 'ХОМУТЫ ХП-10', 'ПЕТЛИ, ЗАЩЁЛКИ', 'ФИКСАТОРЫ', 'ТАБЛИЧКИ'];
  binColors.forEach((c, i) => {
    const bx = -0.3 + (i % 3) * 0.3, bz = -0.14 + Math.floor(i / 3) * 0.28;
    const bm = painted(c, { rough: 0.45, metal: 0, peel: 96, coat: 0.1 });
    cart.add(box(0.26, 0.012, 0.24, bm, bx, 0.872, bz, 0.002));
    for (const [w, d, ox, oz] of [[0.26, 0.006, 0, -0.12], [0.26, 0.006, 0, 0.12], [0.006, 0.24, -0.13, 0], [0.006, 0.24, 0.13, 0]]) cart.add(box(w, 0.08, d, bm, bx + ox, 0.91, bz + oz, 0.002));
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.04), new THREE.MeshStandardMaterial({ map: textTexture([binLabels[i]], { w: 512, h: 96, size: 40 }) }));
    l.position.set(bx, 0.93, bz + 0.124); cart.add(l);
  });
  // профили кромок — пучком на нижней полке
  for (let k = 0; k < 6; k++) cart.add(box(0.85, 0.012, 0.03, GM.alu(), 0, 0.28 + k * 0.014, -0.15 + (k % 3) * 0.05, 0.002));
  scene.add(cart);
  solid(cx, cz, 1.0, 0.7);

  // ---------- готовый модуль на соседнем месте (после ОТК, частично в защитной плёнке) ----------
  const done = buildGalley();
  const full = { installed: new Set(), glued: new Set(), paint: null, film: new Set(), fastened: new Set() };
  for (const s of STEPS) applyStep(full, s);
  done.setState(full, { powered: false });
  done.root.position.set(9.5, 0.14, -3.7);
  done.root.rotation.y = -0.35;
  scene.add(done.root);
  // поддон под готовым модулем
  const pallet = box(2.1, 0.14, 1.2, painted('#a57a45', { rough: 0.8, metal: 0 }), 9.5, 0.07, -3.27, 0.004);
  pallet.rotation.y = -0.35; scene.add(pallet);
  const wrap = new THREE.Mesh(new THREE.BoxGeometry(1.76, 1.0, 0.9), new THREE.MeshPhysicalMaterial({ color: '#dfe8ee', roughness: 0.15, transparent: true, opacity: 0.28, clearcoat: 1, side: THREE.DoubleSide }));
  wrap.position.set(9.5, 0.7, -3.27); wrap.rotation.y = -0.35; scene.add(wrap);
  const dl = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.2), new THREE.MeshStandardMaterial({ map: textTexture(['КМ-2 № 016 · ОТК ✓', '01.10.2026'], { w: 512, h: 144, bg: '#e8f6ea', size: 46 }) }));
  dl.position.set(9.5 + 0.35, 1.4, -3.27 + 0.95); dl.rotation.y = -0.35; scene.add(dl);
  solid(9.5, -3.4, 2.4, 1.6);

  return { hall, jig, galley, kit, rack, cart, finished: done, colliders: hall.colliders };
}

export { HALL, PLACES };
