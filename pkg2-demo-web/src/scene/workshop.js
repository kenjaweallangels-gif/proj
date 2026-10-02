// Окружение рабочего места: верстак с оснасткой или секция фюзеляжа, пол, тара/тележки/подъёмник, метки ArUco, свет.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LAYER_HOLO, markerFrame } from '../engine/holo.js';

const MARKER_TEX_RATIO = 320 / 240;      // PNG метки: 240 px + белое поле 2×40 px (tools/make_markers.py --raw)

function mat(color, rough = 0.8, metal = 0.05) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function box(sx, sy, sz, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  return o;
}

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#5b5f63'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},255,0.025)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 8);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function label(text, { size = 0.06, color = '#e8f1f5', bg = 'rgba(10,20,26,.75)' } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = '600 44px "IBM Plex Sans", system-ui, sans-serif';
  c.width = Math.ceil(g.measureText(text).width + 36); c.height = 64;
  g.font = '600 44px "IBM Plex Sans", system-ui, sans-serif';
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 18, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(size * c.width / c.height, size, 1);
  return s;
}

export function buildWorkshop(scene, renderer, P, { markerUrl = (id) => `./markers/marker_${id}.png` } = {}) {
  const root = new THREE.Group();
  root.name = 'workshop';
  scene.add(root);
  const { center, size } = P.bounds;
  const fy = P.floorY;

  // свет и отражения
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  scene.background = new THREE.Color(P.isFuselage ? '#22272c' : '#2a2e33');
  scene.fog = new THREE.Fog(scene.background, 6, 18);
  root.add(new THREE.HemisphereLight('#dfe8ef', '#3b3f44', 0.9));
  const sun = new THREE.DirectionalLight('#fff4e6', 1.6);
  sun.position.set(center[0] + 1.5, fy + 4.5, center[2] + 2.0);
  sun.target.position.set(...center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 12 });
  sun.shadow.bias = -0.0004;
  root.add(sun, sun.target);

  // пол
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center[0], fy, center[2]);
  floor.receiveShadow = true;
  root.add(floor);

  if (P.isFixture) {
    // верстак и ложемент: верх ложемента = y 0 СК операции (минимум деталей/меток)
    // ложемент (тёмная плита) — верх на 1 мм ниже самой низкой метки/детали; под ним столешница
    const base = P.bounds.min[1] - 0.001;
    const top = [size[0] + 0.5, 0.04, size[2] + 0.4];
    const ty = base - 0.012 - 0.02;
    root.add(box(size[0] + 0.2, 0.012, size[2] + 0.1, mat('#3e4246', 0.6, 0.2), center[0], base - 0.006, center[2]));
    root.add(box(top[0], top[1], top[2], mat('#6b665c', 0.85), center[0], ty, center[2]));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      root.add(box(0.05, ty - fy, 0.05, mat('#2b2e31', 0.5, 0.6), center[0] + sx * (top[0] / 2 - 0.06), (ty + fy) / 2, center[2] + sz * (top[2] / 2 - 0.06)));
    }
  }

  if (P.isFuselage) {
    // секция фюзеляжа изнутри: обшивка, шпангоуты, окна, рельсы кресел
    const R = 1.95, cy = fy + 0.55, len = 7.5;
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, len, 64, 1, true), new THREE.MeshStandardMaterial({ color: '#9aa3a6', roughness: 0.9, side: THREE.BackSide }));
    shell.rotation.x = Math.PI / 2;
    shell.position.set(center[0], cy, center[2]);
    shell.receiveShadow = true;
    root.add(shell);
    const frameMat = mat('#7c8a7f', 0.7, 0.3);
    for (let i = -7; i <= 7; i++) {
      const fr = new THREE.Mesh(new THREE.TorusGeometry(R - 0.04, 0.035, 8, 64), frameMat);
      fr.position.set(center[0], cy, center[2] + i * 0.5);
      fr.castShadow = true;
      root.add(fr);
    }
    const winMat = new THREE.MeshStandardMaterial({ color: '#cfe6ff', emissive: '#9cc8ff', emissiveIntensity: 0.6, roughness: 0.2 });
    for (let i = -6; i <= 6; i += 2) for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.34), winMat);
      const ang = side * 1.25;
      w.position.set(center[0] + side * Math.sin(Math.abs(ang)) * (R - 0.06), cy + Math.cos(ang) * 0.0 + 0.55, center[2] + i * 0.5 + 0.25);
      w.lookAt(center[0], w.position.y, w.position.z);
      root.add(w);
    }
    for (const sx of [-0.55, 0.55]) root.add(box(0.03, 0.02, len, mat('#b9bec4', 0.4, 0.7), center[0] + sx, fy + 0.01, center[2]));
  }

  // источники деталей: тара, тележка, подъёмник, стеллаж
  const sources = [];
  const kindColor = { bin: '#2f5f9e', cart: '#5c6670', lift: '#c9a227', rack: '#4f5a52', bench: null };
  for (const p of P.parts.values()) {
    if (!p.src || !kindColor[p.srcKind]) continue;
    const [x, y, z] = p.src;
    if (p.srcKind === 'bin') root.add(box(0.17, 0.012, 0.17, mat(kindColor.bin, 0.6), x, y - 0.04, z));
    if (p.srcKind === 'cart') {
      root.add(box(0.5, 0.025, 0.35, mat(kindColor.cart, 0.5, 0.4), x, y - 0.03, z));
      root.add(box(0.03, y - 0.03 - fy, 0.03, mat('#333', 0.5, 0.6), x - 0.22, (y + fy) / 2, z));
    }
    if (p.srcKind === 'lift') {     // подъёмник откатывают после установки детали — см. sources в main.js
      const lift = new THREE.Group();
      lift.add(box(1.7, 0.04, 0.7, mat(kindColor.lift, 0.5, 0.3), x, y - 0.27, z));
      lift.add(box(0.08, y - 0.27 - fy, 0.08, mat('#4a4a4a', 0.5, 0.6), x, (y - 0.27 + fy) / 2, z));
      lift.userData.partId = p.id;
      sources.push(lift);
      root.add(lift);
    }
    if (p.srcKind === 'rack') root.add(box(0.1, y - fy + 0.6, 1.2, mat(kindColor.rack, 0.6, 0.3), x - 0.1, (y + fy) / 2 + 0.3, z));
    if (p.cell) {
      const l = label(p.cell, { size: 0.045 });
      l.position.set(x, y + 0.08, z + 0.1);
      root.add(l);
    }
  }

  // метки ArUco (реальные наклейки) + рамки подсветки (голограмма, слой 1)
  const loader = new THREE.TextureLoader();
  const markerFrames = [];
  for (const m of P.markers) {
    const side = m.size * MARKER_TEX_RATIO;
    const g = new THREE.PlaneGeometry(side, side);
    g.rotateX(-Math.PI / 2);                     // нормаль +Y, «верх» картинки к −Z — как СК метки в пакете
    const mm = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 });
    loader.load(markerUrl(m.id), (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; mm.map = t; mm.needsUpdate = true;
    }, undefined, () => { mm.color.set('#bbbbbb'); });
    const o = new THREE.Mesh(g, mm);
    o.position.set(...m.pos);
    o.quaternion.set(...m.rot);
    o.receiveShadow = true;
    root.add(o);
    // белая подложка чуть больше метки, чтобы метка не «висела» на стене фюзеляжа
    const back = new THREE.Mesh(new THREE.BoxGeometry(side * 1.1, 0.004, side * 1.1), mat('#e8e8e8', 0.8));
    back.position.set(0, -0.003, 0);
    o.add(back);
    const fr = markerFrame(m.size);
    fr.position.copy(o.position);
    fr.quaternion.copy(o.quaternion);
    fr.visible = false;
    fr.layers.set(LAYER_HOLO);
    root.add(fr);
    markerFrames.push(fr);
  }
  return { root, markerFrames, sun, sources };
}
