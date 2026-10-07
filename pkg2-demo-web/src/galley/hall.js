// Участок сборки монументов (цех 12): пол, стены из сэндвич-панелей, колонны и фермы, светильники, ворота,
// рабочее место сборщика, стеллаж комплектации, клеевой стол, окрасочная кабина, стеллажи хранения.
// Мировые координаты в метрах; стапель с модулем — в начале координат. Коллизии — список прямоугольников XZ.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { material, painted } from '../scene/materials.js';
import { epoxyFloorSet, fbm, grayMap, normalMap, normalize, withRepeat } from '../scene/textures.js';
import { galleyMat as GM, textTexture } from './tex.js';

export const HALL = { x0: -20, x1: 20, z0: -13, z1: 13, h: 10 };
export const PLACES = {
  entrance: { pos: [-18.6, 6.5], look: [1, 0] },
  workplace: { pos: [-7.2, -3.4], desk: [-7.2, -4.4], dock: [-6.75, 0.78, -4.25] },
  jigFront: { pos: [0, 2.6] },
  kitRack: [2.9, -0.4],
  kitCart: [2.3, 1.7],
  glueTable: [-2.8, -1.9],
  prepTable: [-2.95, 1.9],          // стол подготовки панелей у стапеля (плёнка до установки), столешница 0,85 м
};

const colliders = [];          // {x0, x1, z0, z1}
function solid(x, z, w, d) { colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 }); }

function box(w, h, d, m, x, y, z, r = 0.004) {
  const o = new THREE.Mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)) : new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  return o;
}

function ribbedWallSet() {
  const S = 256;
  const h = new Float32Array(S * S);
  const n = normalize(fbm(S, { sx: 4, octaves: 4, seed: 301 }));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const t = (x / S) * 4 % 1;                                   // 4 гофра на текстуру (≈ 1 м)
    h[y * S + x] = Math.max(0, 1 - Math.abs(t - 0.5) * 6) * 0.8 + n[y * S + x] * 0.05;
  }
  return { normalMap: normalMap(S, h, 2.5), roughnessMap: grayMap(S, (i) => 0.55 + n[i] * 0.15) };
}

/** Двутавр (колонна) — профиль экструзией. */
function iBeam(h, w = 0.3, d = 0.3, tf = 0.02, tw = 0.012, m) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, -d / 2); s.lineTo(w / 2, -d / 2); s.lineTo(w / 2, -d / 2 + tf); s.lineTo(tw / 2, -d / 2 + tf);
  s.lineTo(tw / 2, d / 2 - tf); s.lineTo(w / 2, d / 2 - tf); s.lineTo(w / 2, d / 2); s.lineTo(-w / 2, d / 2);
  s.lineTo(-w / 2, d / 2 - tf); s.lineTo(-tw / 2, d / 2 - tf); s.lineTo(-tw / 2, -d / 2 + tf); s.lineTo(-w / 2, -d / 2 + tf);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  const o = new THREE.Mesh(g, m);
  o.castShadow = o.receiveShadow = true;
  return o;
}

function strut(a, b, r, m) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 8), m);
  o.position.copy(A).add(B).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.sub(A).normalize());
  o.castShadow = true;
  return o;
}

function sign(lines, w, h, opts) {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: textTexture(lines, opts), roughness: 0.6 }));
}

/** Экран терминала «Система сборщика»: сменное задание и статусы операций (вместо одной строки текста). */
function terminalScreen() {
  const c = document.createElement('canvas'); c.width = 1160; c.height = 680;
  const g = c.getContext('2d');
  g.fillStyle = '#0d1c26'; g.fillRect(0, 0, 1160, 680);
  g.fillStyle = '#163447'; g.fillRect(0, 0, 1160, 70);
  g.fillStyle = '#e8f3f7'; g.font = '600 34px "IBM Plex Sans", sans-serif'; g.textBaseline = 'middle'; g.fillText('Система сборщика', 24, 36);
  g.fillStyle = '#8fb6c8'; g.font = '400 24px "IBM Plex Sans", sans-serif'; g.fillText('Иванов С. А. · таб. № 1047 · 07:28', 760, 36);
  g.fillStyle = '#bfe9ff'; g.font = '600 28px "IBM Plex Sans", sans-serif'; g.fillText('Сменное задание 02.10.2026 · стапель СТ-3 · КМ2.000.000 СБ № 017', 24, 110);
  const rows = [['010', 'Подготовка рабочего места и стапеля', 'к выполнению', '#ffc845'], ['020–050', 'Каркас, перегородки, полки (смена 1.10)', 'выполнено', '#4ee69a'],
    ['060', 'Стол-перегородка и столешница', 'к выполнению', '#ffc845'], ['070', 'Выдержка клея до фиксации', 'к выполнению', '#ffc845'], ['080–110', 'Уголки, вставки, кромки, ниши', 'к выполнению', '#ffc845'],
    ['120–140', 'Окраска, плёнка', 'к выполнению', '#ffc845'], ['145–175', 'Облицовка, раковина, электромонтаж, дверцы', 'к выполнению', '#ffc845'], ['180–190', 'Оборудование, предъявление ОТК', 'к выполнению', '#ffc845']];
  g.font = '400 26px "IBM Plex Sans", sans-serif';
  rows.forEach(([op, t, st, col], i) => {
    const y = 160 + i * 56;
    g.fillStyle = i % 2 ? '#10232f' : '#132a38'; g.fillRect(16, y - 24, 1128, 50);
    g.fillStyle = '#58e6ff'; g.fillText(op, 32, y); g.fillStyle = '#dcf6ff'; g.fillText(t, 170, y);
    g.fillStyle = col; g.fillText(st, 930, y);
  });
  g.fillStyle = '#58e6ff'; g.fillRect(16, 620, 260, 46); g.fillStyle = '#04161c'; g.font = '600 26px "IBM Plex Sans", sans-serif'; g.fillText('Открыть ТП в очках', 34, 643);
  g.fillStyle = '#8fb6c8'; g.font = '400 22px "IBM Plex Sans", sans-serif'; g.fillText('ТП 7.КМ2.00001 · КД КМ2.000.000 СБ · чат с мастером', 300, 643);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/** Клавиатура: ряды клавиш с кириллицей. */
function keyboardTexture() {
  const c = document.createElement('canvas'); c.width = 840; c.height = 250;
  const g = c.getContext('2d'); g.fillStyle = '#121315'; g.fillRect(0, 0, 840, 250);
  const rows = ['ЁЙЦУКЕНГШЩЗХЪ', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮ'];
  g.font = '600 18px "IBM Plex Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 0; k < 14; k++) { g.fillStyle = '#26282c'; g.fillRect(10 + k * 58, 10, 52, 44); }
  rows.forEach((r, i) => [...r].forEach((ch, k) => { const x = 20 + i * 20 + k * 58, y = 64 + i * 56; g.fillStyle = '#26282c'; g.fillRect(x, y, 52, 48); g.fillStyle = '#cfd3d6'; g.fillText(ch, x + 26, y + 24); }));
  g.fillStyle = '#26282c'; g.fillRect(200, 232 - 6, 380, 20);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

let dockLabel = null;
export function buildHall(scene) {
  RectAreaLightUniformsLib.init();
  const root = new THREE.Group();
  root.name = 'hall';
  scene.add(root);
  const { x0, x1, z0, z1, h } = HALL;
  const W = x1 - x0, D = z1 - z0;
  const lamps = [];

  // ---------- пол ----------
  const fl = withRepeat(epoxyFloorSet('#9a9ea2'), W / 4, D / 4);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshPhysicalMaterial({ ...fl, clearcoat: 0.45, clearcoatRoughness: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);
  // разметка: проход (зелёные края), зона стапеля (жёлто-чёрная), места хранения (белые)
  const lineMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 });
  const stripe = (x, z, w, d, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat(c)); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.002, z); m.receiveShadow = true; root.add(m); };
  stripe(-2, 4.9, 36, 0.1, '#2f8f46'); stripe(-2, 8.1, 36, 0.1, '#2f8f46');
  stripe(-2, 6.5, 36, 3.1, '#5d7b66');
  for (let x = -19.5; x < 16; x += 2.5) stripe(x, 6.5, 0.5, 0.06, '#e8e8e2');
  const hatch = document.createElement('canvas'); hatch.width = 256; hatch.height = 32;
  const hg = hatch.getContext('2d'); hg.fillStyle = '#e1b21b'; hg.fillRect(0, 0, 256, 32); hg.fillStyle = '#151515';
  for (let i = -2; i < 16; i++) { hg.beginPath(); hg.moveTo(i * 32, 32); hg.lineTo(i * 32 + 16, 32); hg.lineTo(i * 32 + 32, 0); hg.lineTo(i * 32 + 16, 0); hg.fill(); }
  const ht = new THREE.CanvasTexture(hatch); ht.colorSpace = THREE.SRGBColorSpace; ht.wrapS = THREE.RepeatWrapping;
  const zone = (x, z, w, d) => {
    for (const [cx, cz, ww, dd, rot] of [[x, z - d / 2, w, 0.12, 0], [x, z + d / 2, w, 0.12, 0], [x - w / 2, z, d, 0.12, 1], [x + w / 2, z, d, 0.12, 1]]) {
      const t = ht.clone(); t.needsUpdate = true; t.repeat.set(ww / 0.6, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, dd), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }));
      m.rotation.x = -Math.PI / 2; if (rot) m.rotation.z = Math.PI / 2;
      m.position.set(cx, 0.003, cz); m.receiveShadow = true; root.add(m);
    }
  };
  zone(0.6, 0.2, 7.2, 6.6);
  zone(9.5, -3.2, 5, 4.2);

  // ---------- стены (сэндвич-панели), цоколь, ленточное остекление ----------
  const rib = ribbedWallSet();
  const wallMat = (len) => new THREE.MeshPhysicalMaterial({ color: '#cfd3d6', roughness: 0.6, metalness: 0.2, ...withRepeat(rib, len, 1) });
  const plinth = painted('#5d6268', { rough: 0.5, metal: 0.2 });
  const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color('#dbe8f4').multiplyScalar(2.4), toneMapped: true });
  const mull = painted('#3d4247', { rough: 0.4, metal: 0.5 });
  const walls = [
    { len: W, pos: [0, h / 2, z0], rot: 0 }, { len: W, pos: [0, h / 2, z1], rot: Math.PI },
    { len: D, pos: [x0, h / 2, 0], rot: Math.PI / 2 }, { len: D, pos: [x1, h / 2, 0], rot: -Math.PI / 2 },
  ];
  for (const wl of walls) {
    const g = new THREE.Group();
    g.position.set(...wl.pos); g.rotation.y = wl.rot;
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(wl.len, h), wallMat(wl.len));
    panel.receiveShadow = true;
    g.add(panel);
    g.add(box(wl.len, 1.2, 0.08, plinth, 0, -h / 2 + 0.6, 0.04, 0.01));
    // ленточное остекление 6–7,6 м
    const band = new THREE.Mesh(new THREE.PlaneGeometry(wl.len - 2, 1.6), glass);
    band.position.set(0, 1.8, 0.01);
    g.add(band);
    for (let x = -wl.len / 2 + 1; x <= wl.len / 2 - 1; x += 1.5) g.add(box(0.08, 1.7, 0.08, mull, x, 1.8, 0.04, 0.005));
    g.add(box(wl.len - 2, 0.1, 0.12, mull, 0, 1.0, 0.06, 0.005), box(wl.len - 2, 0.1, 0.12, mull, 0, 2.6, 0.06, 0.005));
    root.add(g);
  }
  // дверь у входа (западная стена): дневной свет за стеклом
  const door = new THREE.Group();
  door.position.set(x0 + 0.05, 0, PLACES.entrance.pos[1]);
  door.rotation.y = Math.PI / 2;
  door.add(box(1.3, 2.3, 0.1, mull, 0, 1.15, 0, 0.01));
  const dglass = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color('#e4eef8').multiplyScalar(3) }));
  dglass.position.set(0, 1.45, 0.06); door.add(dglass);
  door.add(sign(['ВХОД', 'Участок сборки монументов · цех 12'], 1.0, 0.3, { w: 512, h: 160, bg: '#1f5ea8', fg: '#fff', size: 52, border: null }));
  door.children[door.children.length - 1].position.set(0, 2.55, 0.06);
  root.add(door);
  const dayLight = new THREE.RectAreaLight('#dfe9f5', 6, 1.2, 2.2);
  dayLight.position.set(x0 + 0.2, 1.2, PLACES.entrance.pos[1]); dayLight.lookAt(0, 1.2, PLACES.entrance.pos[1]);
  root.add(dayLight);
  // секционные ворота (южная стена)
  const gate = box(6, 5, 0.12, painted('#b9bec3', { rough: 0.45, metal: 0.4 }), 11, 2.5, z1 - 0.08, 0.01);
  root.add(gate);
  for (let y = 0.5; y < 5; y += 0.6) root.add(box(6, 0.02, 0.14, mull, 11, y, z1 - 0.08, 0.002));

  // ---------- колонны, фермы, светильники ----------
  const colMat = painted('#6f7f8c', { rough: 0.45, metal: 0.45 });
  const trussMat = painted('#7d8b95', { rough: 0.5, metal: 0.5 });
  for (let x = x0 + 2; x <= x1 - 2; x += 6) {
    for (const z of [z0 + 0.25, z1 - 0.25]) { const c = iBeam(h - 0.4, 0.3, 0.3, 0.02, 0.012, colMat); c.position.set(x, 0, z); root.add(c); solid(x, z, 0.4, 0.5); }
    // ферма: верхний и нижний пояса, стойки и раскосы
    const yb = h - 1.6, yt = h - 0.3;
    root.add(strut([x, yb, z0], [x, yb, z1], 0.05, trussMat), strut([x, yt, z0], [x, yt, z1], 0.05, trussMat));
    for (let z = z0; z < z1 - 0.1; z += 2) {
      root.add(strut([x, yb, z], [x, yt, z], 0.03, trussMat), strut([x, yb, z], [x, yt, z + 2], 0.025, trussMat));
    }
  }
  // кровля
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: '#4c5258', roughness: 0.8 }));
  roof.rotation.x = Math.PI / 2; roof.position.y = h; root.add(roof);
  // промышленные светильники (high-bay): корпус + светящийся диск
  const lampHouse = painted('#9aa1a7', { rough: 0.35, metal: 0.7 });
  const lampEmit = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff7ec').multiplyScalar(16) });
  for (let x = x0 + 5; x <= x1 - 2; x += 6) for (let z = z0 + 3; z <= z1 - 2; z += 4.5) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 0.25, 24, 1, true), lampHouse);
    body.material.side = THREE.DoubleSide;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.28, 24), lampEmit);
    disc.rotation.x = Math.PI / 2; disc.position.y = -0.12;
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.2, 6), lampHouse); cable.position.y = 0.72;
    g.add(body, disc, cable);
    g.position.set(x, h - 2.1, z);
    root.add(g);
    lamps.push(g);
  }

  // ---------- рабочее место сборщика ----------
  const wp = new THREE.Group();
  const [wx, wz] = PLACES.workplace.desk;
  wp.position.set(wx, 0, wz);
  const deskTop = painted('#c9c4b6', { rough: 0.6, metal: 0, peel: 128, coat: 0.3 });
  const frame = painted('#3b4148', { rough: 0.38, metal: 0.4 });
  wp.add(box(1.6, 0.03, 0.8, deskTop, 0, 0.75, 0, 0.004));
  wp.add(box(1.56, 0.003, 0.76, new THREE.MeshStandardMaterial({ color: '#2d4a52', roughness: 0.85 }), 0, 0.767, 0, 0.001));
  for (const sx of [-0.75, 0.75]) for (const sz of [-0.35, 0.35]) wp.add(box(0.04, 0.74, 0.04, frame, sx, 0.37, sz, 0.004));
  // терминал системы сборщика: монитор, клавиатура
  const mon = new THREE.Group();
  mon.add(box(0.62, 0.38, 0.03, GM.blackPlastic(), 0, 0, 0, 0.01));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.34), new THREE.MeshBasicMaterial({ map: terminalScreen(), toneMapped: true }));
  scr.position.z = 0.016; mon.add(scr);
  mon.add(box(0.05, 0.3, 0.05, GM.blackPlastic(), 0, -0.3, -0.04, 0.01), box(0.25, 0.015, 0.18, GM.blackPlastic(), 0, -0.45, -0.04, 0.005));
  mon.position.set(-0.25, 1.22, -0.25);
  wp.add(mon);
  // клавиатура (раскладка), мышь на коврике, настольная лампа, лоток документов с сменным заданием
  const kb = box(0.44, 0.018, 0.14, GM.blackPlastic(), -0.25, 0.778, 0.1, 0.004); wp.add(kb);
  const keys = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.125), new THREE.MeshStandardMaterial({ map: keyboardTexture(), roughness: 0.6 }));
  keys.rotation.x = -Math.PI / 2; keys.position.set(-0.25, 0.788, 0.1); wp.add(keys);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.18), new THREE.MeshStandardMaterial({ color: '#1d2a33', roughness: 0.9 })); pad.rotation.x = -Math.PI / 2; pad.position.set(0.12, 0.7705, 0.12); wp.add(pad);
  const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 12), GM.blackPlastic()); mouse.scale.set(0.9, 0.45, 1.5); mouse.position.set(0.12, 0.78, 0.12); mouse.castShadow = true; wp.add(mouse);
  const lampArm = new THREE.Group(); lampArm.position.set(-0.7, 0.77, -0.25); wp.add(lampArm);
  lampArm.add(box(0.14, 0.02, 0.14, GM.blackPlastic(), 0, 0.01, 0, 0.006));
  lampArm.add(strut([0, 0.02, 0], [0.05, 0.42, 0.05], 0.008, GM.blackPlastic()), strut([0.05, 0.42, 0.05], [0.25, 0.48, 0.18], 0.008, GM.blackPlastic()));
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.09, 20, 1, true), GM.blackPlastic()); shade.material.side = THREE.DoubleSide; shade.position.set(0.27, 0.45, 0.2); lampArm.add(shade);
  const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4e0').multiplyScalar(3) })); bulb.rotation.x = Math.PI / 2; bulb.position.set(0.27, 0.41, 0.2); lampArm.add(bulb);
  const trayD = box(0.34, 0.03, 0.26, painted('#2f6fb0', { rough: 0.5 }), 0.62, 0.785, -0.15, 0.004); wp.add(trayD);
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.297), new THREE.MeshStandardMaterial({ map: textTexture(['СМЕННОЕ ЗАДАНИЕ', '02.10.2026 · 1 смена · стапель СТ-3', 'КМ-2 № 017 · оп. 010, 060–190'], { w: 420, h: 594, size: 34, bg: '#ffffff' }), roughness: 0.8 }));
  sheet.rotation.x = -Math.PI / 2; sheet.rotation.z = 0.08; sheet.position.set(0.62, 0.802, -0.15); wp.add(sheet);
  // зарядная станция AR-очков
  const dock = new THREE.Group();
  dock.add(box(0.22, 0.04, 0.12, GM.greyPlastic(), 0, 0.02, 0, 0.01));
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.004, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#3dff7a').multiplyScalar(3) }));
  led.position.set(0.09, 0.041, 0.05); led.rotation.x = -Math.PI / 2; dock.add(led);
  dock.position.set(0.45, 0.78, 0.15);
  wp.add(dock);
  const lab = sign(['Зарядная станция AR-очков', 'инв. 0071'], 0.2, 0.06, { w: 512, h: 150, size: 40 });
  dockLabel = lab;
  lab.position.set(0.45, 0.83, 0.215); lab.rotation.x = -0.5; wp.add(lab);
  // стул, инструментальная тумба, шкафчик
  const chair = new THREE.Group();
  chair.add(box(0.45, 0.06, 0.45, new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.8 }), 0, 0.48, 0, 0.02));
  chair.add(box(0.45, 0.5, 0.05, new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.8 }), 0, 0.8, 0.22, 0.02));
  chair.add(box(0.05, 0.45, 0.05, GM.steel(), 0, 0.23, 0, 0.01));
  chair.position.set(-0.1, 0, 0.7); chair.rotation.y = 0.4; wp.add(chair);
  const cab = painted('#b3261e', { rough: 0.35, metal: 0.35 });
  wp.add(box(0.7, 0.9, 0.5, cab, 1.3, 0.45, -0.1, 0.01));
  for (let k = 0; k < 5; k++) wp.add(box(0.6, 0.012, 0.01, GM.chrome(), 1.3, 0.2 + k * 0.16, 0.155, 0.003));
  const locker = painted('#8d969e', { rough: 0.45, metal: 0.4 });
  wp.add(box(0.6, 1.9, 0.5, locker, -1.3, 0.95, -0.1, 0.01));
  const nm = sign(['Таб. № 1047'], 0.18, 0.05, { w: 256, h: 72, size: 40 }); nm.position.set(-1.3, 1.6, 0.152); wp.add(nm);
  // доска документов на стене
  const board = sign(['СХЕМА УЧАСТКА · ИОТ-12-07 · ГРАФИК ТО СТАПЕЛЕЙ'], 1.6, 0.9, { w: 1024, h: 576, bg: '#f3f3ef', size: 44 });
  board.position.set(0, 1.6, -0.6); wp.add(board);
  root.add(wp);
  solid(wx, wz, 1.7, 0.9); solid(wx + 1.3, wz - 0.1, 0.75, 0.55); solid(wx - 1.3, wz - 0.1, 0.65, 0.55);

  // ---------- клеевой стол с местной вытяжкой ----------
  const gt = new THREE.Group();
  const [gx, gz] = PLACES.glueTable;
  gt.position.set(gx, 0, gz);
  gt.add(box(1.4, 0.04, 0.8, painted('#d7dadc', { rough: 0.35, metal: 0.6 }), 0, 0.9, 0, 0.004));
  for (const sx of [-0.65, 0.65]) for (const sz of [-0.35, 0.35]) gt.add(box(0.04, 0.88, 0.04, frame, sx, 0.44, sz, 0.004));
  for (let k = 0; k < 4; k++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.2, 16), painted(k % 2 ? '#d9d4c3' : '#5a6b7c', { rough: 0.4, metal: 0 }));
    c.rotation.z = Math.PI / 2; c.position.set(-0.4, 0.94, -0.2 + k * 0.06); c.castShadow = true; gt.add(c);
  }
  const gun = box(0.3, 0.06, 0.08, GM.blackPlastic(), 0.1, 0.95, 0.1, 0.01); gt.add(gun);
  // вытяжной рукав
  gt.add(strut([0.6, 0.9, -0.35], [0.6, 1.9, -0.35], 0.03, frame), strut([0.6, 1.9, -0.35], [0.2, 1.6, 0], 0.05, painted('#e3b41c', { rough: 0.5 })));
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.2, 24, 1, true), painted('#e3b41c', { rough: 0.5 }));
  hood.material.side = THREE.DoubleSide; hood.position.set(0.2, 1.5, 0); gt.add(hood);
  const tl = sign(['КЛЕЕВОЙ СТОЛ', 'работа с вытяжкой · СИЗ'], 0.5, 0.16, { w: 512, h: 160, bg: '#ffffff', size: 44 });
  tl.position.set(0, 1.0, 0.401); gt.add(tl);
  root.add(gt); solid(gx, gz, 1.5, 0.9);

  // ---------- стол подготовки панелей у стапеля: боковина целиком (2,05 × 0,86 м) — наклейка плёнки до установки ----------
  {
    const pt = new THREE.Group();
    const [px, pz] = PLACES.prepTable;
    pt.position.set(px, 0, pz);
    pt.add(box(2.3, 0.04, 1.05, painted('#cfd3d6', { rough: 0.45, metal: 0.5 }), 0, 0.83, 0, 0.004));
    pt.add(box(2.26, 0.006, 1.01, new THREE.MeshStandardMaterial({ color: '#3b4a3f', roughness: 0.95 }), 0, 0.853, 0, 0.001));   // мягкое покрытие
    for (const sx of [-1.08, 1.08]) for (const sz of [-0.46, 0.46]) pt.add(box(0.05, 0.81, 0.05, frame, sx, 0.405, sz, 0.004));
    pt.add(box(2.1, 0.03, 0.03, frame, 0, 0.18, -0.46, 0.004), box(2.1, 0.03, 0.03, frame, 0, 0.18, 0.46, 0.004));
    for (const sx of [-0.7, 0, 0.7]) pt.add(box(0.36, 0.02, 0.9, new THREE.MeshStandardMaterial({ color: '#2c2f33', roughness: 0.9 }), sx, 0.866, 0, 0.004));   // прокладки
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 24), painted('#d9cfc2', { rough: 0.6, metal: 0 }));
    roll.rotation.x = Math.PI / 2; roll.position.set(1.0, 0.2, 0); pt.add(roll);                                  // рулон плёнки на полке
    const lab = sign(['СТОЛ ПОДГОТОВКИ ПАНЕЛЕЙ', 'плёнка · обезжиривание · клей'], 0.6, 0.18, { w: 640, h: 192, bg: '#ffffff', size: 46 });
    lab.position.set(0, 0.7, 0.53); pt.add(lab);
    root.add(pt); solid(px, pz, 2.35, 1.1);
  }

  // ---------- окрасочная кабина (у северной стены) ----------
  const booth = new THREE.Group();
  booth.position.set(-13, 0, -9);
  const bframe = painted('#d5d8da', { rough: 0.4, metal: 0.5 });
  booth.add(box(6, 0.15, 4, bframe, 0, 3.4, 0, 0.01));
  for (const sx of [-3, 3]) for (const sz of [-2, 2]) booth.add(box(0.12, 3.4, 0.12, bframe, sx, 1.7, sz, 0.01));
  const curtain = new THREE.MeshPhysicalMaterial({ color: '#d8a02a', roughness: 0.4, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  for (const [x, z, w, r] of [[0, 2, 6, 0], [-3, 0, 4, Math.PI / 2]]) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(w, 3.2, 40, 1), curtain);
    const pos = c.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 9) * 0.04);
    c.geometry.computeVertexNormals();
    c.position.set(x, 1.65, z); c.rotation.y = r; booth.add(c);
  }
  booth.add(box(5.6, 2.6, 0.3, painted('#9aa3aa', { rough: 0.6 }), 0, 1.4, -1.85, 0.01));      // фильтровальная стенка
  const bs = sign(['ОКРАСОЧНАЯ КАБИНА · ОК-2'], 1.6, 0.3, { w: 768, h: 144, bg: '#fff', size: 56 }); bs.position.set(0, 3.0, 2.01); booth.add(bs);
  root.add(booth); solid(-13, -9, 6.3, 4.3);

  // ---------- стеллажи хранения панелей (вдоль северной стены) ----------
  const upr = painted('#2b5d94', { rough: 0.4, metal: 0.4 }), bm = painted('#e06a1d', { rough: 0.4, metal: 0.4 });
  const sheetMat = GM.skinRaw();
  for (let k = 0; k < 3; k++) {
    const rx = 2 + k * 2.8, rz = z0 + 1.1;
    for (const sx of [-1.35, 1.35]) for (const sz of [-0.5, 0.5]) root.add(box(0.08, 4.5, 0.08, upr, rx + sx, 2.25, rz + sz, 0.004));
    for (const y of [0.15, 1.6, 3.0, 4.4]) for (const sz of [-0.5, 0.5]) root.add(box(2.7, 0.1, 0.05, bm, rx, y, rz + sz, 0.004));
    for (const y of [0.2, 1.65, 3.05]) {
      const st = box(2.4, 0.18 + (k % 2) * 0.06, 1.0, sheetMat, rx, y + 0.13, rz, 0.004);
      st.scale.set(0.001, 0.001, 0.001); st.geometry = new RoundedBoxGeometry(2400, 180 + (k % 2) * 60, 1000, 2, 4); root.add(st);
    }
    solid(rx, rz, 2.9, 1.2);
  }

  // ---------- знаки, огнетушитель, часы ----------
  const ext = new THREE.Group();
  ext.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 20), GM.red()));
  ext.children[0].position.y = 0.25; ext.position.set(-4.5, 0.4, z0 + 0.25);
  root.add(ext);
  const fsign = sign(['ОГНЕТУШИТЕЛЬ'], 0.4, 0.12, { w: 512, h: 150, bg: '#c4161c', fg: '#fff', size: 60, border: null });
  fsign.position.set(-4.5, 1.6, z0 + 0.12); root.add(fsign);

  // ---------- освещение ----------
  const hemi = new THREE.HemisphereLight('#eef3f7', '#5b5f63', 0.6);          // цех ≈ 500–750 лк
  root.add(hemi);
  const key = new THREE.DirectionalLight('#fff3e3', 3.0);
  key.position.set(4, h - 1, 5);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 25 });
  key.shadow.radius = 4; key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02;
  root.add(key, key.target);
  // местный свет над стапелем (подвесной линейный светильник)
  const task = new THREE.SpotLight('#fff6ea', 230, 12, Math.PI / 4, 0.7, 1.4);
  task.position.set(0.8, 5.2, 2.6); task.target.position.set(0, 1.0, 0);
  task.castShadow = true; task.shadow.mapSize.set(2048, 2048); task.shadow.radius = 3; task.shadow.bias = -0.0002; task.shadow.normalBias = 0.01;
  Object.assign(task.shadow.camera, { near: 0.5, far: 12 });
  root.add(task, task.target);
  for (const [x, z] of [[0, 1.6], [-7.2, -4.1]]) {
    const ra = new THREE.RectAreaLight('#fff4e6', 9, 1.6, 0.3);
    ra.position.set(x, 3.6, z); ra.lookAt(x, 0, z);
    root.add(ra);
    const fix = box(1.65, 0.06, 0.32, painted('#d8dadc', { rough: 0.4, metal: 0.3 }), x, 3.63, z, 0.01);
    fix.castShadow = false; root.add(fix);
    const dif = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.28), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff8ee').multiplyScalar(6) }));
    dif.rotation.x = Math.PI / 2; dif.position.set(x, 3.596, z); root.add(dif);
    for (const sx of [-0.7, 0.7]) root.add(strut([x + sx, 3.66, z], [x + sx, h - 1.6, z], 0.003, GM.steel()));
  }

  // стены — препятствия
  colliders.push({ x0: x0 - 1, x1: x0 + 0.3, z0, z1 }, { x0: x1 - 0.3, x1: x1 + 1, z0, z1 }, { x0, x1, z0: z0 - 1, z1: z0 + 0.3 }, { x0, x1, z0: z1 - 0.3, z1: z1 + 1 });
  return { root, colliders, lamps, key, task, dockLabel };
}

export { colliders, solid };
