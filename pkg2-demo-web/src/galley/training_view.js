// Обучающая сборка КМ-2 на стапеле — 3D: учебная модель изделия (цветные полупрозрачные детали по категориям,
// сотовые панели в три слоя: обшивка — соты — обшивка, закладные вставки и пазы видны), инструменты
// (смеситель клея, пистолет с герметиком, кисть, валик, салфетка, отвёртка, краскопульт, рулетка), траектории
// установки по направлению посадки (без прохода сквозь установленные детали), подписи с номерами позиций.
// Цель для плеера сборки (assembly_player): уроки — шаги, 10 с на урок при ×1.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYER_HOLO, LAYER_REAL } from '../engine/holo.js';
import { ease } from './assembly_player.js';
import { planeMatrix } from './galley_build.js';
import { PLACES } from './hall.js';
import * as S from './spec.js';
import { approachDir, buildLessons, stateAt } from './training.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------- цвета категорий (учебные, не как у реального изделия) ----------
const CAT = {
  skin: ['#4fb0ff', 0.2], skinPainted: ['#f1ead8', 0.3], core: ['#ffb648', 0.75], edge: ['#2d6f9a', 0.7],
  groove: ['#4a2f7a', 0.75], insert: ['#b38bff', 0.95], glue: ['#ffd23f', 0.9], seal: ['#ff2bd6', 0.95],
  bracket: ['#ff8a3d', 0.9], screw: ['#e9edf2', 1], fitting: ['#3ddc84', 0.85], trim: ['#2ec4b6', 0.75],
  film: ['#ff6fae', 0.7], sheet: ['#c9d6df', 0.5], sink: ['#9ad0ec', 0.6], tap: ['#d0d0ff', 0.85],
  harness: ['#ff4d4d', 0.95], clamp: ['#ffd166', 0.95], water: ['#4da3ff', 0.9], equipment: ['#9aa6b8', 0.5],
  light: ['#fff07a', 0.85], door: ['#c4a7ff', 0.4], hinge: ['#ff5c8a', 0.95], decor: ['#9be564', 0.9], load: ['#7c8796', 0.3],
};
function catOf(f) {
  const k = f?.kind;
  return ({ bracket: 'bracket', screw: 'screw', fitting: 'fitting', trim: 'trim', film: 'film', sheet: 'sheet', sink: 'sink',
    faucet: 'tap', valve: 'tap', siphon: 'tap', harness: 'harness', clamp: 'clamp', water: 'water', equipment: 'equipment', light: 'light',
    door: 'door', hinge: 'hinge', latch: 'hinge', placard: 'decor', handle: 'decor', turnbutton: 'decor', retainer: 'decor',
    trolley: 'load', stdunit: 'load' })[k] || 'equipment';
}

const MATS = {};
function mat(cat, hi = false) {
  const key = `${cat}${hi ? '+' : ''}`;
  if (MATS[key]) return MATS[key];
  const [c, op] = CAT[cat];
  const m = new THREE.MeshStandardMaterial({
    color: c, transparent: true, opacity: hi ? Math.min(1, op + 0.15) : op, roughness: 0.45, metalness: 0.1,
    emissive: new THREE.Color(c), emissiveIntensity: hi ? 0.75 : cat.startsWith('skin') ? 0.12 : 0.22, depthWrite: op >= 0.7, side: THREE.DoubleSide,
  });
  MATS[key] = m;
  return m;
}

/** Текстура сот: шестигранные ячейки (≈ 20 мм на ячейку в учебном масштабе — чтобы было видно). */
let HEX = null;
function honeycombTexture() {
  if (HEX) return HEX;
  const c = document.createElement('canvas'); c.width = 256; c.height = 222;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,182,72,0.18)'; g.fillRect(0, 0, 256, 222);
  g.strokeStyle = '#ffb648'; g.lineWidth = 4;
  const r = 32, h = Math.sqrt(3) * r;
  for (let col = -1; col < 6; col++) for (let row = -1; row < 4; row++) {
    const cx = col * 1.5 * r * 1.0, cy = row * h + (col % 2 ? h / 2 : 0);
    g.beginPath();
    for (let k = 0; k <= 6; k++) { const a = (Math.PI / 3) * k; g[k ? 'lineTo' : 'moveTo'](cx * 1.0667 + r * Math.cos(a), cy + r * Math.sin(a)); }
    g.stroke();
  }
  HEX = new THREE.CanvasTexture(c);
  HEX.wrapS = HEX.wrapT = THREE.RepeatWrapping;
  HEX.repeat.set(1 / 72, 1 / 62);
  HEX.colorSpace = THREE.SRGBColorSpace;
  return HEX;
}
function coreMaterial() {
  return (MATS.core ??= new THREE.MeshStandardMaterial({ map: honeycombTexture(), color: '#ffc46a', transparent: true, opacity: 0.6,
    roughness: 0.6, emissive: new THREE.Color('#ff8c00'), emissiveIntensity: 0.28, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.02 }));
}

const shapeOf = (pts, holes = []) => {
  const s = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
  return s;
};

/** Только позиция и нормаль (с индексом) — чтобы любые геометрии сливались. */
function pn(geo, m4) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (geo.attributes.normal) g.setAttribute('normal', geo.attributes.normal.clone()); else g.computeVertexNormals();
  g.setIndex(geo.index ? Array.from(geo.index.array) : [...Array(geo.attributes.position.count).keys()]);
  if (m4) g.applyMatrix4(m4);
  return g;
}

// ---------- инструменты (мм, «рабочая точка» в начале координат) ----------
function toolMat(c, o = {}) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.2, ...o }); }
function cylY(r, h, m, y = 0) { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), m); o.position.y = y; return o; }
function boxM(w, h, d, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; }
function buildTools() {
  const T = {};
  // смеситель клея (двухкомпонентный картридж с пистолетом): носик вниз
  T.dispenser = new THREE.Group();
  T.dispenser.add(new THREE.Mesh(new THREE.ConeGeometry(7, 90, 16), toolMat('#f2f2f2', { transparent: true, opacity: 0.85 })));
  T.dispenser.children[0].position.y = 45; T.dispenser.children[0].rotation.x = Math.PI;
  T.dispenser.add(cylY(18, 150, toolMat('#d9a441', { transparent: true, opacity: 0.8 }), 165), cylY(18, 150, toolMat('#7aa2c9', { transparent: true, opacity: 0.8 }), 165));
  T.dispenser.children[1].position.x = -20; T.dispenser.children[2].position.x = 20;
  T.dispenser.add(boxM(80, 30, 50, toolMat('#2e3238'), 0, 260), boxM(24, 120, 30, toolMat('#2e3238'), 0, 320, -50));
  // пистолет с картриджем герметика
  T.gun = new THREE.Group();
  T.gun.add(new THREE.Mesh(new THREE.ConeGeometry(6, 70, 14), toolMat('#f5f5f0')));
  T.gun.children[0].position.y = 35; T.gun.children[0].rotation.x = Math.PI;
  T.gun.add(cylY(24, 210, toolMat('#f5f5f0'), 175), boxM(10, 260, 10, toolMat('#c0392b'), 0, 180, -34), boxM(30, 110, 22, toolMat('#c0392b'), 0, 300, -70));
  // кисть
  T.brush = new THREE.Group();
  T.brush.add(boxM(50, 34, 10, toolMat('#5b4636', { roughness: 0.9 }), 0, 17), boxM(54, 22, 14, toolMat('#b9bec3', { metalness: 0.8 }), 0, 45), cylY(8, 170, toolMat('#c89a62'), 140));
  // валик
  T.roller = new THREE.Group();
  const rl = new THREE.Mesh(new THREE.CylinderGeometry(25, 25, 160, 24), toolMat('#3a3d41', { roughness: 0.8 })); rl.rotation.x = Math.PI / 2; rl.position.y = 25; T.roller.add(rl);
  T.roller.add(boxM(8, 120, 8, toolMat('#b9bec3', { metalness: 0.8 }), 0, 90, 0), cylY(12, 120, toolMat('#e3b41c'), 200));
  // салфетка
  T.rag = new THREE.Group(); T.rag.add(boxM(130, 18, 100, toolMat('#e8f1f5', { roughness: 1 }), 0, 9), boxM(60, 50, 40, toolMat('#5aa0d0', { roughness: 0.6 }), 0, 45));
  // отвёртка (аккумуляторная): бита вниз вдоль −Y
  T.driver = new THREE.Group();
  T.driver.add(cylY(2.5, 60, toolMat('#a8adb2', { metalness: 0.9 }), 30), cylY(16, 110, toolMat('#1f6fd1'), 115), boxM(30, 30, 120, toolMat('#20252a'), 0, 150, -60));
  // краскопульт
  T.spray = new THREE.Group();
  T.spray.add(boxM(40, 60, 160, toolMat('#9aa1a8', { metalness: 0.6 }), 0, 0, 80), cylY(35, 90, toolMat('#d6dbe0', { transparent: true, opacity: 0.8 }), 70), boxM(26, 120, 30, toolMat('#2e3238'), 0, -70, 130));
  const mist = new THREE.Mesh(new THREE.ConeGeometry(140, 420, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#f1ead8', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  mist.rotation.x = Math.PI / 2; mist.position.z = -210; T.spray.add(mist);
  // лупа (осмотр)
  T.lens = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(45, 6, 10, 32), toolMat('#20252a')); T.lens.add(ring);
  T.lens.add(new THREE.Mesh(new THREE.CircleGeometry(44, 32), new THREE.MeshStandardMaterial({ color: '#cfefff', transparent: true, opacity: 0.25, side: THREE.DoubleSide })));
  T.lens.add(boxM(12, 110, 12, toolMat('#20252a'), 0, -100, 0));
  for (const t of Object.values(T)) { t.visible = false; t.traverse((o) => { o.raycast = () => {}; o.castShadow = false; }); }
  return T;
}

// ---------- подписи ----------
function labelSprite(text, color = '#58e6ff') {
  const c = document.createElement('canvas'); c.width = 1400; c.height = 120;
  const g = c.getContext('2d');
  let size = 50; g.font = `600 ${size}px "IBM Plex Sans", sans-serif`;
  while (g.measureText(text).width > 1350 && size > 24) { size -= 2; g.font = `600 ${size}px "IBM Plex Sans", sans-serif`; }
  const w = Math.min(1390, g.measureText(text).width + 36);
  g.fillStyle = 'rgba(6,20,26,0.82)'; g.beginPath(); g.roundRect(4, 8, w, 104, 18); g.fill();
  g.strokeStyle = color; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.fillText(text, 22, 62);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  // постоянный размер на экране (не растёт вблизи), ≈ 2 % высоты кадра
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false, sizeAttenuation: false }));
  sp.center.set(0, 0.5);
  sp.scale.set(0.06 * 1400 / 120, 0.06, 1);
  sp.userData.wf = (w + 8) / 1400;                    // доля ширины холста, занятая подписью
  sp.renderOrder = 60;
  return sp;
}

/**
 * Цель плеера «обучающая сборка». world — мир цеха, hooks — onBegin, onEnd, onLesson(lesson, index).
 */
export function trainingTarget(world, viz, { onBegin, onEnd, onLesson } = {}) {
  const g = world.galley;
  const lessons = buildLessons();
  const N = lessons.length;
  const states = [];
  const stAt = (i) => (states[i] ??= stateAt(lessons, i));
  let style = 'glasses';
  let B = null;                                     // построенная модель
  let lastI = -1;
  const kitWas = new Map();

  function build() {
    const root = new THREE.Group(); root.name = 'training';
    g.root.updateMatrixWorld(true);
    root.matrixAutoUpdate = false; root.matrix.copy(g.root.matrixWorld); root.matrixWorldNeedsUpdate = true;
    const inv = new THREE.Matrix4().copy(g.root.matrixWorld).invert();
    const P = new Map();                            // id → { obj, meshes:[{m, cat}], center, kind }
    const add = (id, obj, meshes) => {
      root.add(obj);
      const box = new THREE.Box3().setFromObject(obj, true);
      P.set(id, { obj, meshes, center: box.getCenter(V()), size: box.getSize(V()), f: S.featureById.get(id) });
      obj.visible = false;
    };
    // панели — сэндвич: обшивка, соты, обшивка + контур, пазы, закладные вставки
    // у каждой панели свой цвет обшивки — чтобы различать детали
    const PANEL_COL = ['#3d9bff', '#3fcf7a', '#a77bff', '#ffc23d', '#ff7aa8', '#2fd3c6', '#7fa8ff', '#ff9d4d', '#c6e04a', '#e47cff'];
    for (const [k, p] of S.PANELS.entries()) {
      const sk = `skin${k}`;
      CAT[sk] = [PANEL_COL[k % PANEL_COL.length], 0.26];
      const o = new THREE.Group();
      const shape = shapeOf(p.outline, p.holes), M = planeMatrix(p.plane, p.offset);
      const ext = (z0, d) => { const e = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: 4 }); e.translate(0, 0, z0); e.applyMatrix4(M); return e; };
      const lo = new THREE.Mesh(ext(0, 0.8), mat(sk)), hi = new THREE.Mesh(ext(p.t - 0.8, 0.8), mat(sk));
      const core = new THREE.Mesh(ext(0.8, p.t - 1.6), coreMaterial());
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(ext(0, p.t), 25), new THREE.LineBasicMaterial({ color: CAT.edge[0], transparent: true, opacity: 0.7 }));
      o.add(lo, core, hi, edges);
      const outer = p.outerFace ? (p.outerFace === 'lo' ? hi : lo) : null;      // наружная (под плёнку) — не красится
      const gr = S.GROOVES.filter((x) => x.panel === p.id).map((x) => { const b = new THREE.BoxGeometry(...x.max.map((v, i) => v - x.min[i] + 1)); b.translate(...x.min.map((v, i) => (v + x.max[i]) / 2)); return b; });
      if (gr.length) o.add(new THREE.Mesh(mergeGeometries(gr), mat('groove')));
      const ins = g.inserts.filter((x) => x.panel === p.id).map((x) => { x.mesh.updateMatrix(); return pn(x.mesh.geometry, x.mesh.matrix); });
      if (ins.length) o.add(new THREE.Mesh(mergeGeometries(ins), mat('insert')));
      add(p.id, o, [{ m: lo, cat: sk, skin: lo !== outer }, { m: hi, cat: sk, skin: hi !== outer }]);
    }
    // остальные детали — по категориям; жгуты и трубы — отдельными сетками (растут при прокладке)
    const owner = new Map([...g.items].map(([id, o]) => [o, id]));
    const by = new Map();
    g.root.traverse((m) => {
      if (!m.isMesh) return;
      let o = m; while (o && !owner.has(o)) o = o.parent;
      if (!o) return;
      const id = owner.get(o);
      if (S.panelById.has(id)) return;
      if (!by.has(id)) by.set(id, []);
      by.get(id).push(m);
    });
    for (const [id, ms] of by) {
      const f = S.featureById.get(id);
      const cat = catOf(f);
      const o = new THREE.Group();
      const meshes = [];
      const m4 = new THREE.Matrix4();
      if (f?.kind === 'harness' || f?.kind === 'water') {
        for (const m of ms) { m4.multiplyMatrices(inv, m.matrixWorld); const x = new THREE.Mesh(pn(m.geometry, m4), mat(cat)); o.add(x); meshes.push({ m: x, cat, grow: true }); }
      } else {
        const geo = mergeGeometries(ms.map((m) => { m4.multiplyMatrices(inv, m.matrixWorld); return pn(m.geometry, m4); }), false);
        const x = new THREE.Mesh(geo, cat === 'film' ? mat('film').clone() : mat(cat)); o.add(x); meshes.push({ m: x, cat });
      }
      add(id, o, meshes);
    }
    // клей в пазах: валик по длине паза (растёт при нанесении)
    const beads = new Map();
    for (const gr of S.GROOVES) {
      const size = gr.max.map((v, i) => v - gr.min[i]);
      const a = size.indexOf(Math.max(...size));
      const s = size.map((v, i) => (i === a ? 1 : Math.max(1.5, v * 0.6)));
      const m = new THREE.Mesh(new THREE.BoxGeometry(...s), mat('glue'));
      m.visible = false; root.add(m);
      if (!beads.has(gr.joint)) beads.set(gr.joint, []);
      beads.get(gr.joint).push({ m, a, min: gr.min, max: gr.max, len: size[a] });
    }
    // герметик: тюбиком по контуру выреза раковины, в паз профиля кромки стола, змейкой по столешнице
    const top = S.G.deckTop + 0.6;
    const sinkRing = (() => { const { x, z, w, d } = S.SINK; const hw = w / 2 + 14, hd = d / 2 + 14, r = 40, pts = [];
      const arc = (cx, cz, a0) => { for (let k = 0; k <= 6; k++) { const a = a0 + (k / 6) * (Math.PI / 2); pts.push(V(x + cx + r * Math.cos(a), top + 2, z + cz + r * Math.sin(a))); } };
      arc(hw - r, hd - r, 0); arc(-hw + r, hd - r, Math.PI / 2); arc(-hw + r, -hd + r, Math.PI); arc(hw - r, -hd + r, Math.PI * 1.5); return pts; })();
    const deck = S.panelById.get('DECK');
    const front = deck.outline.filter((q) => q[1] >= deck.rect.v1 - 60).sort((a, b) => a[0] - b[0]).map(([u, v]) => V(u, S.G.deckTop - deck.t / 2, v + 4));
    const snake = []; for (let k = 0; k < 7; k++) { const z = 60 + k * 120; snake.push(V(k % 2 ? 760 : -760, top - 0.2, z), V(k % 2 ? -760 : 760, top - 0.2, z)); }
    const seals = {};
    for (const [key, pts, closed] of [['sink', sinkRing, true], ['trim', front, false], ['snake', snake, false]]) {
      const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal', 0.1);
      const segs = Math.max(64, pts.length * 12), radial = 6;
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, key === 'snake' ? 3 : 3.5, radial, closed), mat(key === 'snake' ? 'glue' : 'seal'));
      m.visible = false; root.add(m);
      seals[key] = { m, curve, per: radial * 6, segs };
    }
    // клей кистью под плёнку и плёнка на столе — с плоскостью отсечения (наносится полосой вдоль панели)
    const clip = new THREE.Plane(V(-1, 0, 0), 99);                  // 99 м — ничего не отсекается
    const glueLayer = {};
    for (const side of ['SIDE-L', 'SIDE-R']) {
      const p = S.panelById.get(side);
      const sh = new THREE.ShapeGeometry(shapeOf(S.sideProfile()), 4);
      sh.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, p.outerFace === 'lo' ? p.t + 0.2 : -0.2));
      sh.applyMatrix4(planeMatrix(p.plane, p.offset));
      const gm = new THREE.MeshStandardMaterial({ color: '#ffe08a', transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0, emissive: new THREE.Color('#ffd23f'), emissiveIntensity: 0.15, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: [clip] });
      const m = new THREE.Mesh(sh, gm); m.visible = false;
      P.get(side).obj.add(m);
      glueLayer[side] = m;
    }
    for (const id of ['FILM-L', 'FILM-R']) { const e = P.get(id); if (e) e.meshes[0].m.material.clippingPlanes = [clip]; }
    // поза на столе подготовки: наружной стороной вверх, длиной вдоль стола
    const tableW = V(PLACES.prepTable[0], 0.866 + 0.0125, PLACES.prepTable[1]);
    const tableL = tableW.clone().applyMatrix4(inv);
    const tablePose = {};
    for (const side of ['SIDE-L', 'SIDE-R']) {
      const p = S.panelById.get(side), e = P.get(side);
      const n = V(p.outerFace === 'lo' ? -1 : 1, 0, 0), b = V(0, 1, 0), c = n.clone().cross(b);
      const Ms = new THREE.Matrix4().makeBasis(n, b, c), Md = new THREE.Matrix4().makeBasis(V(0, 1, 0), V(1, 0, 0), V(0, 0, -1));
      const R = Md.multiply(Ms.transpose());
      const q = new THREE.Quaternion().setFromRotationMatrix(R);
      tablePose[side] = { q, p: tableL.clone().sub(e.center.clone().applyQuaternion(q)) };
    }
    const tools = buildTools();
    for (const t of Object.values(tools)) root.add(t);
    // подписи — в мире (метры)
    const labels = new THREE.Group(); labels.name = 'training-labels';
    g.root.parent.add(root, labels);
    root.visible = false; labels.visible = false;
    B = { root, P, beads, seals, glueLayer, clip, tablePose, tools, labels, inv, labelPool: [] };
    applyStyle();
  }

  function applyStyle() {
    if (!B) return;
    const L = style === 'glasses' ? LAYER_HOLO : LAYER_REAL;
    for (const r of [B.root, B.labels]) r.traverse((o) => o.layers.set(L));
  }

  // ---------- траектории ----------
  const rackLocal = (id, e) => B.inv && viz.sourceOf(id).applyMatrix4(B.inv).sub(e.center);
  const SMALL = new Set(['bracket', 'screw', 'clamp', 'hinge', 'latch', 'turnbutton', 'placard', 'retainer', 'trim', 'fitting']);
  function routeOf(id, L) {
    const e = B.P.get(id);
    const d = V(...approachDir(id));
    const big = e.f?.kind === 'panel' || e.f?.kind === 'equipment' || e.f?.kind === 'door' || e.f?.kind === 'sink';
    const Ls = e.f?.kind === 'panel' ? (d.y ? 700 : 600) : big ? 400 : 220;
    const Sp = d.clone().multiplyScalar(Ls);
    const frontShift = Math.max(0, 1500 - (e.center.z + Sp.z));
    const Fp = Sp.clone().add(V(0, 0, frontShift));
    let pts, q0 = null;
    if (L.carries?.length || B.tablePose[id] && L.parts.includes(id) && L.carries) {
      const tp = B.tablePose[id];
      pts = [tp.p.clone(), tp.p.clone().add(V(0, 450, 0)), Fp, Sp, V()]; q0 = tp.q;
    } else if (SMALL.has(e.f?.kind)) pts = [Fp.clone().add(V(0, 120, 120)), Fp, Sp, V()];
    else { const s = rackLocal(id, e); pts = [s, V(s.x, Math.max(s.y, Fp.y), Fp.z), Fp, Sp, V()]; }
    // длины: последний участок (посадка) — 35 % времени
    const lens = []; let tot = 0;
    for (let k = 1; k < pts.length - 1; k++) { const l = pts[k].distanceTo(pts[k - 1]); lens.push(l); tot += l; }
    return { pts, lens, tot, q0 };
  }
  function poseAt(r, k, out) {
    const kk = ease(k);
    if (kk >= 0.65) { const s = (kk - 0.65) / 0.35; out.p.lerpVectors(r.pts[r.pts.length - 2], r.pts[r.pts.length - 1], s); out.q.identity(); return out; }
    let d = (kk / 0.65) * r.tot;
    for (let i = 0; i < r.lens.length; i++) {
      if (d <= r.lens[i] || i === r.lens.length - 1) { out.p.lerpVectors(r.pts[i], r.pts[i + 1], r.lens[i] ? Math.min(1, d / r.lens[i]) : 1); break; }
      d -= r.lens[i];
    }
    if (r.q0) out.q.copy(r.q0).slerp(new THREE.Quaternion(), Math.min(1, kk / 0.5)); else out.q.identity();
    return out;
  }

  // ---------- кадр урока ----------
  const pose = { p: V(), q: new THREE.Quaternion() };
  let routes = new Map();
  function setPose(e, p, q) { e.obj.position.copy(p); e.obj.quaternion.copy(q); }
  function home(e) { e.obj.position.set(0, 0, 0); e.obj.quaternion.identity(); }

  function onLessonChange(i) {
    const st = stAt(i), L = lessons[Math.min(i, N - 1)], doing = i < N ? L : null;
    for (const [id, e] of B.P) {
      home(e);
      let vis = st.installed.has(id);
      if (e.f?.kind === 'film') vis = st.film.has(id);
      e.obj.visible = vis;
      for (const x of e.meshes) {
        x.m.material = x.cat === 'film' ? x.m.material : mat(x.cat);
        if (x.grow) x.m.geometry.setDrawRange(0, Infinity);
        if (x.skin && st.painted) x.m.material = mat('skinPainted');
      }
    }
    // боковина на столе (плёнка уже наклеена или клеится сейчас)
    for (const side of ['SIDE-L', 'SIDE-R']) {
      const onTable = st.filmOnTable.has(side) || (doing?.place === 'table' && doing.panel === side);
      if (onTable && !st.installed.has(side)) { const e = B.P.get(side), t = B.tablePose[side]; setPose(e, t.p, t.q); e.obj.visible = true;
        const fid = side === 'SIDE-L' ? 'FILM-L' : 'FILM-R', fe = B.P.get(fid); if (fe && st.film.has(fid)) { setPose(fe, t.p, t.q); fe.obj.visible = true; } }
      B.glueLayer[side].visible = false;
    }
    for (const [j, bs] of B.beads) for (const b of bs) { b.m.visible = st.glued.has(j); setBead(b, 1); }
    for (const [k, s] of Object.entries(B.seals)) { s.m.visible = st.sealed.has(k); s.m.geometry.setDrawRange(0, Infinity); }
    // текущие детали — подсветка, маршруты
    routes = new Map();
    if (doing) {
      const ids = [...doing.parts, ...(doing.action === 'fasten' ? doing.fasteners : [])].filter((id) => B.P.has(id));
      for (const id of ids) for (const x of B.P.get(id).meshes) if (x.cat !== 'film') x.m.material = mat(x.cat, true);
      if (['install', 'fasten'].includes(doing.action) || (doing.action === 'check' && doing.parts.length)) for (const id of doing.parts) if (B.P.has(id)) routes.set(id, routeOf(id, doing));
    }
    labelsFor(doing, i);
    onLesson?.(doing, i);
  }

  function setBead(b, k) {
    const c = b.min.map((v, i) => (v + b.max[i]) / 2);
    const sc = [1, 1, 1]; sc[b.a] = Math.max(0.001, b.len * k);
    const pos = [...c]; pos[b.a] = b.min[b.a] + (b.len * k) / 2;
    b.m.scale.set(...sc); b.m.position.set(...pos);
  }
  function tool(name, p, opts = {}) {
    for (const [k, t] of Object.entries(B.tools)) if (k !== name) t.visible = false;
    if (!name) return;
    const t = B.tools[name]; t.visible = true; t.position.copy(p);
    t.quaternion.copy(opts.q || new THREE.Quaternion());
    if (opts.spin) t.rotateY(opts.spin);
  }

  // подписи
  const tmp = V();
  function labelsFor(L, i) {
    for (const x of B.labelPool) { x.sp.visible = false; x.line.visible = false; }
    B.labels.userData.list = [];
    if (!L) return;
    // столбцы подписей — по бокам места работы урока, чуть выше него
    const f = focusOf(i);
    B.labels.userData.base = { x: f.p.x, y: f.p.y + 0.1 + 0.12 * f.dist, z: f.p.z + 0.12, half: 0.2 + 0.22 * f.dist, row: 0.075 * f.dist };
    (L.labels || []).forEach((lb, k) => {
      let x = B.labelPool[k];
      if (!x) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), new THREE.LineBasicMaterial({ color: '#58e6ff', transparent: true, opacity: 0.85, depthTest: false }));
        line.renderOrder = 59;
        x = { sp: null, line, text: '' }; B.labelPool[k] = x; B.labels.add(line);
      }
      if (x.text !== lb.text) {
        if (x.sp) { B.labels.remove(x.sp); x.sp.material.map.dispose(); }
        x.sp = labelSprite(lb.text, L.place === 'table' ? '#ff6fae' : '#58e6ff'); x.text = lb.text; B.labels.add(x.sp);
      }
      x.sp.visible = true; x.line.visible = true; x.id = lb.id; x.k = k;
      B.labels.userData.list.push(x);
    });
    applyStyle();
  }
  function updateLabels() {
    for (const x of B.labels.userData.list || []) {
      const e = B.P.get(x.id);
      if (!e || !e.obj.visible) { x.sp.visible = x.line.visible = false; continue; }
      x.sp.visible = x.line.visible = true;
      tmp.copy(e.center).applyQuaternion(e.obj.quaternion).add(e.obj.position).applyMatrix4(B.root.matrix);    // центр детали в мире
      // подписи — столбцами слева и справа от изделия (или стола), линия-выноска к детали
      const left = x.k % 2 === 0, row = Math.floor(x.k / 2);
      const base = B.labels.userData.base;
      const at = V(base.x + (left ? -base.half : base.half), base.y - row * base.row, base.z);
      x.sp.center.set(left ? x.sp.userData.wf : 0, 0.5);
      x.sp.position.copy(at);
      const a = x.line.geometry.attributes.position; a.setXYZ(0, at.x, at.y, at.z); a.setXYZ(1, tmp.x, tmp.y, tmp.z); a.needsUpdate = true;
      x.line.geometry.computeBoundingSphere();
    }
  }

  // ---------- действия уроков ----------
  function actionFrame(L, f) {
    const a = L.action;
    const k = Math.min(1, Math.max(0, (f - 0.15) / 0.75));          // 15 % — пояснение, 75 % — работа, 10 % — итог
    if (a === 'install' || a === 'check' || a === 'fasten') {
      const ids = [...routes.keys()];
      const n = ids.length, win = n > 1 ? 0.55 : 1;
      ids.forEach((id, j) => {
        const e = B.P.get(id), r = routes.get(id);
        const s0 = n > 1 ? (j / n) * (1 - win) : 0;
        const kk = Math.min(1, Math.max(0, ((a === 'fasten' ? Math.min(1, k / 0.55) : k) - s0) / win));
        e.obj.visible = kk > 0 || f > 0.12;
        poseAt(r, kk, pose); setPose(e, pose.p, pose.q);
        for (const c of L.carries || []) { const fe = B.P.get(c); if (fe) { fe.obj.visible = true; setPose(fe, pose.p, pose.q); } }
      });
      if (a === 'fasten') {
        const scr = L.fasteners.filter((id) => B.P.has(id));
        const ks = Math.min(1, Math.max(0, (k - 0.55) / 0.45));
        scr.forEach((id, j) => {
          const e = B.P.get(id), fe = S.FASTENERS.find((x) => x.id === id) || e.f;
          const s0 = j / Math.max(1, scr.length), s1 = (j + 1) / Math.max(1, scr.length);
          const kk = Math.min(1, Math.max(0, (ks - s0) / (s1 - s0)));
          e.obj.visible = ks > s0;
          const out = fe?.into ? V().setComponent(fe.into[0], -fe.into[1]) : V(0, 0, 1);
          e.obj.position.copy(out).multiplyScalar(40 * (1 - kk));
          if (ks > s0 && ks <= s1 && fe?.pos) {
            const q = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), out.clone().negate());
            tool('driver', V(...fe.pos).add(out.clone().multiplyScalar(40 * (1 - kk) + 1)), { q, spin: kk * 40 });
          }
        });
        if (ks <= 0 || ks >= 1) tool(null);
      } else tool(null);
      return;
    }
    if (a === 'glue') {
      const bs = L.joints.flatMap((j) => B.beads.get(j) || []);
      const n = bs.length || 1, pos = k * n, cur = Math.min(n - 1, Math.floor(pos));
      bs.forEach((b, j) => { b.m.visible = j < pos; setBead(b, Math.min(1, Math.max(0, pos - j))); });
      const b = bs[cur];
      if (b && k > 0 && k < 1) { const p = b.min.map((v, i) => (v + b.max[i]) / 2); p[b.a] = b.min[b.a] + b.len * Math.min(1, pos - cur); p[1] += 6; tool('dispenser', V(...p), { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0, 0.25)) }); }
      else tool(null);
      return;
    }
    if (a === 'seal') {
      const s = B.seals[L.seal]; if (!s) return;
      s.m.visible = k > 0; s.m.geometry.setDrawRange(0, Math.floor(k * s.segs) * s.per);
      if (k > 0 && k < 1) tool('gun', s.curve.getPointAt(Math.min(0.999, k)).add(V(0, 4, 0)), { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.6, 0, 0)) });
      else tool(null);
      return;
    }
    if (L.place === 'table') {
      const side = L.panel, e = B.P.get(side), t = B.tablePose[side];
      setPose(e, t.p, t.q); e.obj.visible = true;
      // полоса вдоль стола (мир X): от левого края панели к правому
      const x0 = PLACES.prepTable[0] - 1.03, x1 = PLACES.prepTable[0] + 1.03, xc = x0 + (x1 - x0) * k;
      B.clip.constant = xc;
      const zc = PLACES.prepTable[1], yTop = 0.866 + 0.026;
      const local = (wx, wy, wz) => V(wx, wy, wz).applyMatrix4(B.inv);
      const zig = Math.sin(k * Math.PI * 14) * 0.36;
      if (a === 'brush') { B.glueLayer[side].visible = true; tool(k > 0 && k < 1 ? 'brush' : null, local(xc, yTop, zc + zig)); }
      if (a === 'film') {
        B.glueLayer[side].visible = true;
        const fid = side === 'SIDE-L' ? 'FILM-L' : 'FILM-R', fe = B.P.get(fid);
        if (fe) { fe.obj.visible = k > 0; setPose(fe, t.p, t.q); }
        tool(k > 0 && k < 1 ? 'roller' : null, local(xc, yTop + 0.002, zc), { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)) });
      }
      if (a === 'degrease') { B.clip.constant = 99; tool(k > 0 && k < 1 ? 'rag' : null, local(x0 + (x1 - x0) * k, yTop, zc + zig)); }
      if (k >= 1 && a !== 'film') B.clip.constant = 99;
      return;
    }
    B.clip.constant = 99;
    if (a === 'degrease') { tool(k > 0 && k < 1 ? 'rag' : null, V(-700 + 1400 * k, 300 + 600 * Math.abs(Math.sin(k * 9)), 880)); return; }
    if (a === 'paint') {
      const row = Math.floor(k * 6), u = (k * 6) % 1, x = row % 2 ? 700 - 1400 * u : -700 + 1400 * u;
      tool(k > 0 && k < 1 ? 'spray' : null, V(x, 1900 - row * 320, 1150));
      // окрашено всё, что выше текущего прохода краскопульта (проходы сверху вниз)
      const yNow = k >= 1 || stAt(lessons.indexOf(L)).painted ? -1e9 : 1900 - row * 320;     // второй слой — по окрашенному
      for (const e of B.P.values()) for (const x2 of e.meshes) if (x2.skin) x2.m.material = e.center.y > yNow ? mat('skinPainted') : mat(x2.cat, L.parts.includes(e.f?.id));
      return;
    }
    if (a === 'wire') {
      for (const id of L.parts) { const e = B.P.get(id); if (!e) continue; e.obj.visible = k > 0; for (const x of e.meshes) if (x.grow) { const cnt = x.m.geometry.index.count; x.m.geometry.setDrawRange(0, Math.floor((cnt * k) / 6) * 6); } }
      tool(null); return;
    }
    if (a === 'inspect') { tool(k > 0 && k < 1 ? 'lens' : null, V(Math.cos(k * Math.PI * 2) * 600, 1000 + Math.sin(k * Math.PI * 2) * 600, 950)); return; }
    tool(null);
  }

  /** Куда смотреть на уроке: точка в мире (м) и расстояние до неё — для камеры «ведёт по урокам». */
  function focusOf(i) {
    if (!B) build();
    const L = lessons[Math.min(i, N - 1)];
    const W = (v) => v.clone().applyMatrix4(B.root.matrix);
    if (i >= N || !L) return { p: W(V(0, 1000, S.G.D / 2)), dist: 2.9 };
    if (L.place === 'table') return { p: V(PLACES.prepTable[0], 0.88, PLACES.prepTable[1]), dist: 1.15, table: true };
    if (L.action === 'seal' && B.seals[L.seal]) return { p: W(B.seals[L.seal].curve.getPointAt(0.5)), dist: L.seal === 'sink' ? 1.2 : 1.8 };
    const pts = [];
    if (L.action === 'glue') for (const j of L.joints) for (const b of B.beads.get(j) || []) pts.push(V(...b.min.map((v, k) => (v + b.max[k]) / 2)));
    for (const id of [...L.parts, ...(L.action === 'fasten' ? L.fasteners : [])]) { const e = B.P.get(id); if (e) pts.push(e.center); }
    if (!pts.length) return { p: W(V(0, 1000, S.G.D / 2)), dist: 2.9 };
    const c = pts.reduce((a, b) => a.add(b), V()).multiplyScalar(1 / pts.length);
    const box = new THREE.Box3().setFromPoints(pts);
    const span = box.getSize(V()).length() / 1000;
    const big = L.parts.some((id) => ['panel', 'equipment', 'door'].includes(B.P.get(id)?.f?.kind));
    return { p: W(c), dist: THREE.MathUtils.clamp(0.9 + span * 0.9, big ? 2.2 : 1.2, 2.9) };
  }

  return {
    name: 'Обучение · стапель СТ-3 · модуль КМ-2',
    focusOf,
    steps: lessons.map((l) => ({ id: l.id, title: l.title })),
    lessons,
    training: true,
    secPerStep: 10,
    get style() { return style; },
    setStyle(s) { style = s === 'glasses' ? 'glasses' : 'holo'; applyStyle(); },
    begin() {
      if (!B) build();
      B.root.visible = true; B.labels.visible = true;
      g.root.visible = false;                                         // реального модуля нет — учебная модель
      for (const [id, k] of world.kit) { kitWas.set(id, k.visible); k.visible = false; }
      viz.root.visible = false; viz.labels.visible = false;
      lastI = -1;
      onBegin?.();
    },
    apply(i, f) {
      if (i !== lastI) { lastI = i; onLessonChange(i); }
      if (i < N && f > 0) actionFrame(lessons[i], f); else { tool(null); B.clip.constant = 99; }
      updateLabels();
    },
    end() {
      if (B) { B.root.visible = false; B.labels.visible = false; tool(null); }
      g.root.visible = true;
      for (const [id, k] of world.kit) k.visible = kitWas.get(id) ?? k.visible;
      onEnd?.();
    },
  };
}
