// 3D-модель модуля кухонного КМ-2 по спецификации spec.js. Всё строится в миллиметрах внутри группы root
// (root.scale = 0,001), поэтому координаты СК модуля = локальные координаты root.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HOLO, LAYER_HOLO, setLayer } from '../engine/holo.js';
import * as S from './spec.js';
import { galleyMat as GM, textTexture } from './tex.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Матрица «локальные (u, v, w) панели → СК модуля» (det = +1). */
export function planeMatrix(plane, offset) {
  const m = new THREE.Matrix4();
  if (plane === 'XY') m.makeBasis(V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)).setPosition(0, 0, offset);
  else if (plane === 'ZY') m.makeBasis(V3(0, 0, 1), V3(0, 1, 0), V3(-1, 0, 0)).setPosition(offset, 0, 0);
  else m.makeBasis(V3(1, 0, 0), V3(0, 0, 1), V3(0, -1, 0)).setPosition(0, offset, 0);
  return m;
}

const shapeOf = (pts, holes = []) => {
  const s = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
  return s;
};

function mesh(geo, mat, shadow = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = m.receiveShadow = shadow;
  return m;
}

function rbox(w, h, d, mat, x, y, z, r = 2) {
  const m = mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(r, h, mat, seg = 24) { return mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); }

/** Нормали наружу для ломаной контура (против часовой). */
function outward(pts, i) {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [dy / l, -dx / l];
}

/**
 * Протяжка сечения вдоль кромки панели: path — точки (u, v) кромки, section — замкнутый контур (a, b),
 * a — смещение наружу от кромки (мм), b — по толщине панели (w). Возвращает геометрию в СК модуля.
 */
export function sweepEdge(p, path, section) {
  const M = planeMatrix(p.plane, p.offset);
  const pos = [];
  const ring = (i) => {
    const [nu, nv] = outward(path, i);
    return section.map(([a, b]) => V3(path[i][0] + nu * a, path[i][1] + nv * a, b).applyMatrix4(M));
  };
  let prev = ring(0);
  for (let i = 1; i < path.length; i++) {
    const cur = ring(i);
    for (let k = 0; k < section.length; k++) {
      const k2 = (k + 1) % section.length;
      for (const q of [prev[k], cur[k], cur[k2], prev[k], cur[k2], prev[k2]]) pos.push(q.x, q.y, q.z);
    }
    prev = cur;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const U_SECTION = (t, f = 6, s = 1.2) => [[-f, -s], [s, -s], [s, t + s], [-f, t + s], [-f, t], [0, t], [0, 0], [-f, 0]];
const DRIP_SECTION = (t) => [[-6, -1.2], [-1, -1.2], [-1, -8], [1.4, -8], [1.4, t + 1.2], [-6, t + 1.2], [-6, t], [0, t], [0, 0], [-6, 0]];

/** Передняя кромка горизонтальной панели (точки контура у v ≈ v1, включая скругления). */
function frontEdgeXZ(p) {
  const r = p.cornersFront || 0;
  const lim = p.rect.v1 - r - 0.5;
  const idx = p.outline.map((q, i) => (q[1] >= lim ? i : -1)).filter((i) => i >= 0);
  return idx.map((i) => p.outline[i]);
}

// ---------- крепёж ----------
let crossTex = null;
function screwHeadMaterial() {
  if (!crossTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#b8bcc0'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#2a2c2e'; g.fillRect(28, 10, 8, 44); g.fillRect(10, 28, 44, 8);
    crossTex = new THREE.CanvasTexture(c); crossTex.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.MeshPhysicalMaterial({ map: crossTex, metalness: 0.9, roughness: 0.35 });
}
let headMat = null;

const AXES = [V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)];
function orient(obj, axis, sign) {           // ось +Y объекта → ось axis со знаком sign
  obj.quaternion.setFromUnitVectors(V3(0, 1, 0), AXES[axis].clone().multiplyScalar(sign));
}

function screwMesh(f) {
  headMat ||= screwHeadMaterial();
  const m = mesh(new THREE.CylinderGeometry(3.7, 3.7, 0.9, 20), [GM.steel(), headMat, GM.steel()], false);
  const [ax, s] = f.into;
  orient(m, ax, -s);                          // торец головки — наружу
  m.position.set(...f.pos);
  return m;
}

function insertMesh(f) {
  const m = mesh(new THREE.CylinderGeometry(5.5, 5.5, 0.4, 20), GM.alu(), false);
  const [ax, s] = f.into;
  orient(m, ax, -s);
  const p = V3(...f.pos);
  p.setComponent(ax, p.getComponent(ax) - s * 0.15);
  m.position.copy(p);
  return m;
}

function bracketMesh(b) {
  const { leg, t, len } = S.BRACKET;
  const parts = [];
  for (const L of [b.legA, b.legB]) {
    const size = [0, 0, 0];
    size[L.axis] = leg; size[L.face] = t; size[b.jointAxis] = len;
    const c = [...b.corner];
    c[L.axis] += L.sign * leg / 2;
    c[L.face] += L.faceSign * t / 2;
    const g = new THREE.BoxGeometry(...size);
    g.translate(...c);
    parts.push(g);
  }
  return mesh(mergeGeometries(parts), GM.alodine());
}

// ---------- оборудование ----------
function displayTexture(text) { return textTexture([text], { w: 256, h: 64, bg: '#03140a', fg: '#43ff8a', border: null, size: 40 }); }

function oven(e) {
  const [w, h, d] = e.size;
  const g = new THREE.Group();
  g.add(rbox(w, h, d, GM.stainless(), 0, h / 2, d / 2, 3));
  const door = rbox(w - 16, h * 0.68, 8, GM.stainless(), 0, h * 0.36, d + 4, 3);
  const win = rbox(w - 70, h * 0.4, 2, GM.glassDark(), 0, h * 0.36, d + 8.5, 6);
  const handle = cyl(6, w - 50, GM.chrome()); handle.rotation.z = Math.PI / 2; handle.position.set(0, h * 0.66, d + 28);
  for (const sx of [-1, 1]) { const st = cyl(4, 22, GM.chrome(), 12); st.rotation.x = Math.PI / 2; st.position.set(sx * (w / 2 - 35), h * 0.66, d + 17); g.add(st); }
  const panel = rbox(w - 16, h * 0.2, 4, GM.glassDark(), 0, h * 0.86, d + 2, 2);
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(90, 22), new THREE.MeshBasicMaterial({ map: displayTexture('180° 12:30'), toneMapped: false }));
  disp.position.set(-40, h * 0.86, d + 4.2);
  disp.userData.display = true;
  for (const k of [0, 1]) { const b = cyl(8, 6, GM.chrome(), 16); b.rotation.x = Math.PI / 2; b.position.set(60 + k * 40, h * 0.86, d + 5); g.add(b); }
  g.add(door, win, handle, panel, disp);
  return g;
}

function beverage(e) {
  const [w, h, d] = e.size;
  const g = new THREE.Group();
  g.add(rbox(w, h, d, GM.stainless(), 0, h / 2, d / 2, 3));
  g.add(rbox(w - 10, 70, 6, GM.glassDark(), 0, h - 45, d + 3, 2));
  for (let k = 0; k < 4; k++) { const b = cyl(7, 5, GM.chrome(), 16); b.rotation.x = Math.PI / 2; b.position.set(-75 + k * 50, h - 45, d + 7); g.add(b); }
  g.add(rbox(w - 30, 70, 50, GM.stainless(), 0, h - 125, d - 10, 3));             // варочная головка
  const jug = new THREE.Group();
  const body = mesh(new THREE.CylinderGeometry(55, 62, 150, 32, 1, true), GM.glass());
  body.position.y = 75;
  const lid = cyl(57, 18, GM.blackPlastic(), 32); lid.position.y = 158;
  const coffee = cyl(54, 70, new THREE.MeshPhysicalMaterial({ color: '#2a160a', roughness: 0.15 }), 24); coffee.position.y = 36;
  const hnd = mesh(new THREE.TorusGeometry(35, 7, 10, 20, Math.PI), GM.blackPlastic()); hnd.rotation.z = -Math.PI / 2; hnd.position.set(62, 85, 0);
  jug.add(body, lid, coffee, hnd);
  jug.position.set(0, 22, d - 80);
  g.add(jug, rbox(w - 20, 12, 120, GM.steel(), 0, 8, d - 70, 2));                 // поддон
  return g;
}

function boiler(e) {
  const [w, h, d] = e.size;
  const g = new THREE.Group();
  g.add(rbox(w, h, d, GM.stainless(), 0, h / 2, d / 2, 3));
  const tap = cyl(8, 40, GM.chrome(), 16); tap.position.set(0, h * 0.45, d + 10);
  const sp = cyl(5, 30, GM.chrome(), 12); sp.rotation.x = Math.PI / 2; sp.position.set(0, h * 0.6, d + 15);
  const led = new THREE.Mesh(new THREE.CircleGeometry(5, 16), new THREE.MeshBasicMaterial({ color: '#ff9a2a', toneMapped: false }));
  led.position.set(0, h - 40, d + 0.5); led.userData.indicator = true;
  g.add(tap, sp, led);
  return g;
}

function cbPanel(e) {
  const [w, h, d] = e.size;
  const g = new THREE.Group();
  g.add(rbox(w, h, d, GM.greyPlastic(), 0, h / 2, d / 2, 3));
  for (let k = 0; k < 6; k++) {
    const b = cyl(6, 18, GM.blackPlastic(), 14); b.rotation.x = Math.PI / 2; b.position.set(-85 + k * 34, h * 0.55, d + 9);
    const c = cyl(6.5, 3, GM.diffuserOff(), 14); c.rotation.x = Math.PI / 2; c.position.set(-85 + k * 34, h * 0.55, d + 12);
    g.add(b, c);
  }
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(w - 20, 14), new THREE.MeshStandardMaterial({ map: textTexture(['ПЕЧ1 ПЕЧ2 КОФ КИП СВЕТ РЕЗ'], { w: 512, h: 40, size: 24, border: null }) }));
  lab.position.set(0, h * 0.2, d + 0.3);
  g.add(lab);
  return g;
}

function lightBar(e, facing) {
  const [w, h, d] = e.size;
  const g = new THREE.Group();
  g.add(rbox(w, h, d, GM.alu(), 0, h / 2, d / 2, 2));
  const dif = new THREE.Mesh(new THREE.PlaneGeometry(w - 20, facing === 'down' ? d - 8 : h - 4), new THREE.MeshPhysicalMaterial({ color: '#f4f4f0', roughness: 0.3, emissive: '#fff4e0', emissiveIntensity: 0 }));
  if (facing === 'down') { dif.rotation.x = Math.PI / 2; dif.position.set(0, -0.3, d / 2); } else dif.position.set(0, h / 2, d + 0.3);
  dif.userData.lamp = true;
  g.add(dif);
  return g;
}

function trolley(bay) {
  const { w, h, d } = S.TROLLEY;
  const g = new THREE.Group();
  g.add(rbox(w, h - 40, d, GM.alu(), 0, (h - 40) / 2 + 40, d / 2, 6));
  for (let k = 0; k < 9; k++) g.add(rbox(w - 30, 6, 3, GM.aluDark(), 0, 140 + k * 100, d + 1.5, 2));       // рёбра двери
  g.add(rbox(120, 40, 10, GM.blackPlastic(), 0, h - 70, d + 3, 4));                                         // ручка-ниша
  g.add(rbox(30, 50, 12, GM.red(), w / 2 - 40, h - 160, d + 5, 3));                                         // защёлка
  for (const sx of [-1, 1]) for (const sz of [0, 1]) {
    const wh = cyl(20, 16, GM.rubber(), 18); wh.rotation.z = Math.PI / 2; wh.position.set(sx * (w / 2 - 30), 20, 60 + sz * (d - 120));
    g.add(wh);
  }
  g.add(rbox(60, 12, 30, GM.red(), -50, 18, d - 10, 3), rbox(60, 12, 30, new THREE.MeshPhysicalMaterial({ color: '#2f8a3b', roughness: 0.4 }), 50, 18, d - 10, 3));
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(160, 40), new THREE.MeshStandardMaterial({ map: textTexture([`TRL ${bay}`], { w: 256, h: 64, size: 36 }) }));
  lab.position.set(0, h - 140, d + 3.5);
  g.add(lab);
  return g;
}

function stdUnit() {
  const { w, h, d } = S.STD_UNIT;
  const g = new THREE.Group();
  g.add(rbox(w, h, d, GM.alu(), 0, h / 2, d / 2, 5));
  g.add(rbox(60, 24, 8, GM.blackPlastic(), 0, h / 2, d + 3, 3));
  return g;
}

// ---------- сборка модели ----------
export function buildGalley() {
  const root = new THREE.Group();
  root.name = 'galley';
  root.scale.setScalar(0.001);
  const items = new Map();         // id → Object3D (реальная деталь)
  const grooves = [];              // {joint, panel, mesh}
  const inserts = [];              // {panel, mesh}
  const lamps = [], displays = [];
  const panelMeshes = [];

  const add = (id, obj) => {
    obj.traverse((o) => { o.userData.featureId = id; });
    obj.userData.featureId = id;
    root.add(obj);
    items.set(id, obj);
    return obj;
  };

  // панели: обшивки (торцы капов) + торец сотового заполнителя
  for (const p of S.PANELS) {
    const g = new THREE.ExtrudeGeometry(shapeOf(p.outline, p.holes), { depth: p.t, bevelEnabled: false, curveSegments: 4 });
    g.applyMatrix4(planeMatrix(p.plane, p.offset));
    const m = mesh(g, [GM.skinRaw(), GM.core()]);
    m.name = p.id;
    panelMeshes.push(m);
    add(p.id, m);
  }
  // пазы (видны как тёмные прорези до установки ответной панели; после клея — валик клея)
  for (const gr of S.GROOVES) {
    const size = gr.max.map((v, i) => v - gr.min[i] + 1.6);
    const c = gr.min.map((v, i) => (v + gr.max[i]) / 2);
    const m = mesh(new THREE.BoxGeometry(...size), GM.grooveEmpty(), false);
    m.position.set(...c);
    m.userData.featureId = gr.joint;
    root.add(m);
    grooves.push({ joint: gr.joint, panel: gr.panel, mesh: m });
  }
  // вставки (залиты в панели заранее), уголки, винты
  for (const f of S.FASTENERS) {
    if (f.kind === 'insert') { const m = insertMesh(f); m.userData.featureId = f.id; root.add(m); inserts.push({ panel: f.panel, mesh: m }); }
  }
  for (const b of S.BRACKETS) add(b.id, bracketMesh(b));
  for (const f of S.FASTENERS) if (f.kind === 'screw') add(f.id, screwMesh(f));

  // узлы крепления
  for (const f of S.FITTINGS) {
    const g = new THREE.Group();
    const [w, h, d] = f.size;
    if (f.id.startsWith('FT-FL')) {
      g.add(rbox(w, h, d, GM.alodine(), 0, h / 2, 0, 3));
      const stud = cyl(6, 20, GM.steel(), 16); stud.position.set(0, -8, 0); g.add(stud);
      const pl = cyl(9, 10, GM.chrome(), 16); pl.rotation.z = Math.PI / 2; pl.position.set(0, h / 2, d / 2 - 10); g.add(pl);
    } else {
      g.add(rbox(d, 6, w, GM.alodine(), 0, 3, 0, 2));
      const lug = rbox(8, h, 40, GM.alodine(), 0, h / 2 + 6, 0, 2); g.add(lug);
      const hole = mesh(new THREE.TorusGeometry(8, 2.5, 8, 20), GM.steel()); hole.rotation.y = Math.PI / 2; hole.position.set(0, h - 4, 0); g.add(hole);
    }
    g.position.set(...f.pos);
    add(f.id, g);
  }

  // кромочные профили (протяжка сечения; двусторонний материал — обход сечения не зависит от направления кромки)
  const trimAlu = GM.alu().clone(); trimAlu.side = THREE.DoubleSide;
  const trimSteel = GM.stainless().clone(); trimSteel.side = THREE.DoubleSide;
  for (const t of S.TRIMS) {
    const p = S.panelById.get(t.panel);
    let geo;
    if (t.profile === 'kick') geo = sweepEdge(p, [[p.rect.u1, p.rect.v0 + 5], [p.rect.u1, p.rect.v1 - 5]], U_SECTION(p.t, 16, 1));
    else if (p.plane === 'XZ') geo = sweepEdge(p, frontEdgeXZ(p), t.profile === 'drip' ? DRIP_SECTION(p.t) : U_SECTION(p.t));
    else geo = sweepEdge(p, S.sideFrontEdge(), U_SECTION(p.t, 5, 1.2));
    add(t.id, mesh(geo, t.profile === 'kick' ? trimSteel : trimAlu));
  }

  // декоративная плёнка на наружные стороны боковин
  const films = new Map();
  for (const d of S.DECOR.filter((x) => x.kind === 'film')) {
    const p = S.panelById.get(d.panel);
    const g = new THREE.ShapeGeometry(shapeOf(S.sideProfile()), 4);
    const w = p.outerFace === 'lo' ? p.t + 0.4 : -0.4;
    g.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, w));
    g.applyMatrix4(planeMatrix(p.plane, p.offset));
    const m = mesh(g, GM.film().clone(), false);
    m.receiveShadow = true;
    films.set(d.id, add(d.id, m));
  }

  // столешница и фартук из нержавеющего листа
  {
    const deck = S.panelById.get('DECK');
    const outline = S.rectOutline({ ...deck.rect, u0: -824, u1: 824 }, { v1: { bulge: deck.bulgeFront } }, { C: deck.cornersFront, D: deck.cornersFront });
    const g = new THREE.ExtrudeGeometry(shapeOf(outline, deck.holes), { depth: 0.6, bevelEnabled: false });
    g.applyMatrix4(planeMatrix('XZ', S.G.deckTop + 0.6));
    const sheet = new THREE.Group();
    sheet.add(mesh(g, GM.stainless()));
    add('SHEET-DECK', sheet);
    const bs = S.PLUMBING.find((x) => x.id === 'SHEET-BS');
    add('SHEET-BS', rbox(bs.size[0], bs.size[1], 0.5, GM.stainless(), bs.pos[0], bs.pos[1], bs.pos[2], 0.2));
  }

  // раковина
  {
    const { x, z, w, d, depth } = S.SINK;
    const g = new THREE.Group();
    const rim = new THREE.ExtrudeGeometry(shapeOf(S.roundedRect(x, z, w, d, 34), [S.roundedRect(x, z, w - 22, d - 22, 28)]), { depth: 1.5, bevelEnabled: false });
    rim.applyMatrix4(planeMatrix('XZ', S.G.deckTop + 2.1));
    const wall = new THREE.ExtrudeGeometry(shapeOf(S.roundedRect(x, z, w - 20, d - 20, 30), [S.roundedRect(x, z, w - 22, d - 22, 28)]), { depth, bevelEnabled: false });
    wall.applyMatrix4(planeMatrix('XZ', S.G.deckTop + 0.6));
    // дно: контур (u, −v) в XY, поворот −90° вокруг X → (u, 0, v), нормаль вверх
    const bottom = new THREE.ShapeGeometry(shapeOf(S.roundedRect(x, z, w - 22, d - 22, 28).map(([u, v]) => [u, -v])), 6);
    bottom.rotateX(-Math.PI / 2);
    bottom.translate(0, S.G.deckTop - depth + 0.6, 0);
    const bmesh = mesh(bottom, GM.stainless());
    const drain = cyl(24, 2, GM.chrome(), 28); drain.position.set(x, S.G.deckTop - depth + 2, z);
    const hole = cyl(18, 2.2, GM.rubber(), 24); hole.position.set(x, S.G.deckTop - depth + 2.2, z);
    g.add(mesh(rim, GM.stainless()), mesh(wall, GM.stainless()), bmesh, drain, hole);
    add('SINK-1', g);
  }
  // кран питьевой воды: основание, стойка, гусак, рычаг
  {
    const f = S.PLUMBING.find((x) => x.id === 'FAUCET-1');
    const g = new THREE.Group();
    const base = cyl(22, 14, GM.chrome(), 28); base.position.set(0, 7, 0);
    const col = cyl(13, 150, GM.chrome(), 24); col.position.set(0, 89, 0);
    const curve = new THREE.QuadraticBezierCurve3(V3(0, 160, 0), V3(0, 260, 40), V3(0, 175, 120));
    const spout = mesh(new THREE.TubeGeometry(curve, 24, 9, 16), GM.chrome());
    const tip = cyl(10, 14, GM.chrome(), 16); tip.position.set(0, 170, 120);
    const lever = rbox(10, 10, 70, GM.chrome(), 22, 140, -20, 4); lever.rotation.x = -0.4;
    g.add(base, col, spout, tip, lever);
    g.position.set(...f.pos);
    add('FAUCET-1', g);
  }
  // кран запорный
  {
    const f = S.PLUMBING.find((x) => x.id === 'VALVE-1');
    const g = new THREE.Group();
    const body = cyl(14, 60, GM.brass(), 20); body.position.set(0, 0, 0);
    const ball = mesh(new THREE.SphereGeometry(18, 20, 14), GM.brass());
    const stem = cyl(4, 18, GM.steel(), 10); stem.rotation.x = Math.PI / 2; stem.position.set(0, 0, 22);
    const handle = rbox(70, 8, 18, GM.red(), 0, 0, 34, 4);
    g.add(body, ball, stem, handle);
    g.position.set(...f.pos);
    add('VALVE-1', g);
  }

  // трубопроводы, сифон, жгуты, хомуты
  for (const h of [...S.HARNESS, ...S.PLUMBING.filter((x) => x.kind === 'water')]) {
    const curve = new THREE.CatmullRomCurve3(h.path.map((p) => V3(...p)), false, 'centripetal', 0.2);
    const isH = h.kind === 'harness';
    const mat = isH ? GM.braid() : h.color === '#d9dde0' ? GM.pipeWhite() : h.id === 'SIPHON-1' ? GM.chrome() : GM.pipeGrey();
    const g = new THREE.Group();
    g.add(mesh(new THREE.TubeGeometry(curve, Math.max(24, h.path.length * 16), h.d / 2, 12), mat));
    if (isH) {
      const end = h.path[h.path.length - 1];
      const con = cyl(h.d * 0.85, 26, GM.aluDark(), 16);
      const t = curve.getTangent(1);
      con.quaternion.setFromUnitVectors(V3(0, 1, 0), t);
      con.position.set(...end);
      g.add(con);
    }
    add(h.id, g);
  }
  for (const c of S.CLAMPS) {
    const h = S.HARNESS.find((x) => x.id === c.on);
    const g = new THREE.Group();
    const ring = mesh(new THREE.TorusGeometry(h.d / 2 + 1.5, 1.2, 8, 20), GM.steel());
    g.add(ring, rbox(14, 2, 12, GM.steel(), 0, -(h.d / 2 + 6), 0, 0.5));
    g.position.set(...c.pos);
    add(c.id, g);
  }

  // оборудование и светильники
  for (const e of [...S.EQUIPMENT]) {
    let g;
    if (e.id.startsWith('OVEN')) g = oven(e);
    else if (e.id === 'BEV-1') g = beverage(e);
    else if (e.id === 'BOIL-1') g = boiler(e);
    else if (e.id === 'CB-1') g = cbPanel(e);
    else if (e.id === 'LIGHT-1') g = lightBar(e, 'down');
    else if (e.id === 'LIGHT-2') g = lightBar(e, 'front');
    else { const bar = cyl(7, e.size[0], GM.chrome(), 16); bar.rotation.z = Math.PI / 2; g = new THREE.Group(); g.add(bar); }
    g.position.set(...e.pos);
    if (e.kind === 'light') g.position.y -= e.size[1] / 2;
    g.traverse((o) => { if (o.userData.lamp) lamps.push(o); if (o.userData.display || o.userData.indicator) displays.push(o); });
    add(e.id, g);
  }

  // дверцы на петлях (поворот вокруг оси петель — для осмотра отсеков)
  const doors = new Map();
  for (const d of S.DOORS) {
    const pivot = new THREE.Group();
    const hx = d.hinge === 'L' ? d.x0 : d.x1;
    pivot.position.set(hx, 0, d.z + d.t);
    const w = d.x1 - d.x0, h = d.y1 - d.y0, s = d.hinge === 'L' ? 1 : -1;
    const panel = rbox(w, h, d.t, GM.film(), s * w / 2, (d.y0 + d.y1) / 2, -d.t / 2, 3);
    pivot.add(panel);
    if (d.flap) {      // откидной клапан мусоросборника: контур и ручка
      const fl = rbox(w - 80, 180, 2, GM.aluDark(), s * w / 2, 900, 0.8, 4); pivot.add(fl);
      pivot.add(rbox(90, 14, 10, GM.chrome(), s * w / 2, 990, 6, 5));
    }
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(90, 22), new THREE.MeshStandardMaterial({ map: textTexture([d.flap ? 'ОТХОДЫ' : `ОТСЕК ${d.id.slice(-1)}`], { w: 256, h: 64, size: 30 }) }));
    lab.position.set(s * w / 2, d.y1 - 50, 0.4);
    pivot.add(lab);
    pivot.userData.open = 0;
    doors.set(d.id, pivot);
    add(d.id, pivot);
  }
  for (const hg of S.HINGES) {
    const d = S.DOORS.find((x) => x.id === hg.door);
    const g = new THREE.Group();
    const knuckle = cyl(4, 40, GM.stainless(), 16); knuckle.position.set(0, 0, 2);
    const s = d.hinge === 'L' ? 1 : -1;
    g.add(knuckle, rbox(28, 40, 1.5, GM.stainless(), s * 16, 0, 0.8, 0.5), rbox(1.5, 40, 22, GM.stainless(), -s * 4, 0, -11, 0.5));
    g.position.set(...hg.pos);
    add(hg.id, g);
  }
  for (const l of S.LATCHES) {
    const g = new THREE.Group();
    const bez = cyl(11, 3, GM.chrome(), 24); bez.rotation.x = Math.PI / 2; bez.position.z = 1.5;
    const btn = cyl(7, 4, GM.blackPlastic(), 20); btn.rotation.x = Math.PI / 2; btn.position.z = 3.5;
    const slot = rbox(10, 2, 1, GM.chrome(), 0, 0, 5.6, 0.3);
    g.add(bez, btn, slot);
    g.position.set(...l.pos);
    add(l.id, g);
  }

  // фурнитура и таблички
  for (const d of S.DECOR) {
    if (d.kind === 'placard') {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(120, 20), new THREE.MeshStandardMaterial({
        map: textTexture([d.bay ? `ТЕЛЕЖКА ${d.bay} · MAX 90 кг` : 'ОТХОДЫ'], { w: 512, h: 86, bg: '#f4d33a', size: 38 }), roughness: 0.5 }));
      m.position.set(...d.pos);
      add(d.id, m);
    } else if (d.kind === 'turnbutton') {
      const g = new THREE.Group();
      g.add(rbox(28, 20, 6, GM.blackPlastic(), 0, 0, 3, 2));
      const lever = rbox(46, 9, 5, GM.blackPlastic(), 0, 0, 8, 2); lever.rotation.z = 0.25; g.add(lever);
      g.position.set(...d.pos);
      add(d.id, g);
    } else if (d.kind === 'handle') {
      const g = new THREE.Group();
      const bar = cyl(12, 380, GM.chrome(), 20); bar.position.set(30, 0, 0);
      for (const sy of [-1, 1]) { const so = cyl(9, 30, GM.chrome(), 14); so.rotation.z = Math.PI / 2; so.position.set(15, sy * 170, 0); g.add(so); }
      g.add(bar);
      g.position.set(...d.pos);
      add(d.id, g);
    }
  }

  // загрузка: тележки, контейнеры, мусоросборник
  for (const it of S.INSERTS_LOAD) {
    let g;
    if (it.kind === 'trolley') {
      const b = S.BAYS[it.bay];
      g = trolley(it.bay); g.position.set((b.x0 + b.x1) / 2, S.G.tBase, 30);
    } else {
      const xs = [-622, -206, 206, 622];
      g = stdUnit(); g.position.set(xs[it.comp], S.G.shelfTop + 6 + it.row * 240, 175);
    }
    add(it.id, g);
  }

  return {
    root, items, grooves, inserts, films, doors, lamps, displays, panelMeshes,

    /** Применить состояние изделия (из process.stateBefore / stateFrom). */
    setState(st, { powered = false } = {}) {
      for (const [id, o] of items) {
        const f = S.featureById.get(id);
        if (!f) continue;
        let vis = st.installed.has(id);
        if (f.kind === 'screw') vis = st.installed.has(f.bracket);
        else if (f.kind === 'clamp') vis = st.installed.has(f.on);
        else if (f.kind === 'film') vis = st.film.has(id);
        o.visible = vis;
      }
      const skin = !st.paint ? GM.skinRaw() : st.paint === 'primer' ? GM.skinPrimer() : GM.skinPaint();
      for (const m of panelMeshes) m.material = [skin, GM.core()];
      for (const g of grooves) {
        const j = S.jointById.get(g.joint);
        // после окраски шов с клеем закрыт покрытием — валик не виден
        g.mesh.visible = st.installed.has(g.panel) && !(st.paint && st.installed.has(j.a));
        g.mesh.material = st.glued.has(g.joint) ? GM.grooveGlue() : GM.grooveEmpty();
      }
      for (const i of inserts) i.mesh.visible = st.installed.has(i.panel);
      for (const l of lamps) l.material.emissiveIntensity = powered ? 2.2 : 0;
      for (const d of displays) d.visible = powered;
    },

    /** Голограмма детали (копия с аддитивным материалом и контуром рёбер). */
    makeHolo(id, color = HOLO.part) {
      const src = items.get(id);
      if (!src) return null;
      const h = src.clone(true);
      const fill = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const line = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      const meshes = [];
      h.traverse((o) => { if (o.isMesh) meshes.push(o); });
      for (const m of meshes) {
        m.material = fill;
        m.castShadow = m.receiveShadow = false;
        const tri = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
        if (tri < 4000) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 28), line));
      }
      h.visible = true;
      h.userData = { holoFill: fill, holoLine: line, featureId: id };
      return setLayer(h, LAYER_HOLO);
    },
  };
}
