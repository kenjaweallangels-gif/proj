// Окружение рабочего места (фотореалистично): цех с наливным полом, верстак с антистатическим ковриком и ложементом
// или секция фюзеляжа изнутри (обшивка в грунте, шпангоуты, стрингеры, иллюминаторы, пол с рельсами кресел),
// тара/тележки/подъёмник/стеллаж, метки ArUco на подложках, свет: окружение цеха (IBL) + светильники с мягкими тенями.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { LAYER_HOLO, LAYER_LABEL, markerFrame } from '../engine/holo.js';
import { bakeEnvironment } from './environment.js';
import { material, painted } from './materials.js';
import { epoxyFloorSet, esdMatSet, primerSet, withRepeat } from './textures.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const MARKER_TEX_RATIO = 320 / 240;      // PNG метки: 240 px + белое поле 2×40 px (tools/make_markers.py --raw)
// Секция фюзеляжа (условная узкофюзеляжная): центр сечения над полом, радиус обшивки, высота профиля шпангоута.
export const FUSELAGE = { centerAboveFloor: 1.15, radius: 1.98, frameDepth: 0.15, framePitch: 0.5, length: 8 };

function box(sx, sy, sz, m, x = 0, y = 0, z = 0, r = 0.004) {
  const g = r > 0 ? new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r, sx / 2.2, sy / 2.2, sz / 2.2)) : new THREE.BoxGeometry(sx, sy, sz);
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  return o;
}

function cyl(r, h, m, x, y, z, seg = 20) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  return o;
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
  s.layers.set(LAYER_LABEL);
  return s;
}

/** Колёсико тележки/подъёмника: вилка + резиновое колесо. */
function caster(x, y, z, r = 0.04) {
  const g = new THREE.Group();
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.03, 24), material('rubber'));
  wheel.rotation.z = Math.PI / 2;
  wheel.position.set(0, r, 0);
  wheel.castShadow = true;
  g.add(wheel, box(0.04, 0.03, 0.05, material('steel'), 0, 2 * r + 0.015, 0, 0.003));
  g.position.set(x, y, z);
  return g;
}

/** Пластиковый лоток для мелких деталей (открытый ящик со стенками). */
function bin(x, y, z, color = '#2f5f9e', w = 0.15, h = 0.075, d = 0.18) {
  const m = painted(color, { rough: 0.45, metal: 0, peel: 96, coat: 0.1 });
  const g = new THREE.Group();
  const t = 0.004;
  g.add(box(w, t, d, m, 0, t / 2, 0, 0.001));
  g.add(box(w, h, t, m, 0, h / 2, -d / 2 + t / 2, 0.001), box(w, h * 0.7, t, m, 0, h * 0.35, d / 2 - t / 2, 0.001));
  for (const s of [-1, 1]) g.add(box(t, h, d, m, s * (w / 2 - t / 2), h / 2, 0, 0.001));
  g.position.set(x, y, z);
  return g;
}

function benchLamp(root, x, y, z, len) {
  // подвесной линейный светильник над верстаком: корпус + рассеиватель + источник RectAreaLight
  const housing = box(len, 0.05, 0.16, painted('#d8dadc', { rough: 0.4, metal: 0.3 }), x, y + 0.03, z, 0.01);
  housing.castShadow = false;
  const diff = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.04, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.98, 0.94).multiplyScalar(4) }));
  diff.rotation.x = Math.PI / 2;
  diff.position.set(x, y + 0.004, z);
  const light = new THREE.RectAreaLight('#fff6ea', 18, len - 0.04, 0.12);
  light.position.set(x, y, z);
  light.lookAt(x, y - 1, z);
  for (const s of [-1, 1]) {
    const wire = cyl(0.0015, 2, material('steel'), x + s * len * 0.4, y + 1.05, z, 6);
    wire.castShadow = false;
    root.add(wire);
  }
  root.add(housing, diff, light);
  return light;
}

export function buildWorkshop(scene, renderer, P, { markerUrl = (id) => `./markers/marker_${id}.png`, quality = 'high' } = {}) {
  RectAreaLightUniformsLib.init();
  const root = new THREE.Group();
  root.name = 'workshop';
  scene.add(root);
  const { center, size } = P.bounds;
  const fy = P.floorY;
  const F = FUSELAGE;
  const cy = fy + F.centerAboveFloor;                // ось фюзеляжа (вдоль X: шпангоуты 17, 18, 19 идут по X)
  const hangarY = P.isFuselage ? cy - F.radius - 0.02 : fy;

  // окружение цеха: отражения и рассеянный свет; фон — то же окружение, размытое как «вне фокуса»
  const env = bakeEnvironment(renderer);
  scene.environment = env;
  scene.background = env;
  scene.backgroundBlurriness = 0.32;
  scene.backgroundIntensity = P.isFuselage ? 0.55 : 0.85;
  scene.environmentIntensity = P.isFuselage ? 0.45 : 0.85;
  // дальний пол цеха растворяется в дымке того же тона, что и стены, — без резкого «края мира»
  scene.fog = new THREE.FogExp2(P.isFuselage ? '#3f4348' : '#62676d', 0.035);

  // пол цеха
  const fl = withRepeat(epoxyFloorSet(), 20, 20);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshPhysicalMaterial({
    ...fl, color: '#ffffff', metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.25,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(center[0], hangarY, center[2]);
  floor.receiveShadow = true;
  root.add(floor);

  // разметка зоны рабочего места (жёлтая краска по полу)
  const paint = new THREE.MeshStandardMaterial({ color: '#d9a21b', roughness: 0.5 });
  const zone = P.isFuselage ? [F.length + 1.2, 2 * F.radius + 1.6] : [size[0] + 2.2, size[2] + 2.4];
  for (const [w, d, dx, dz] of [[zone[0], 0.07, 0, -zone[1] / 2], [zone[0], 0.07, 0, zone[1] / 2], [0.07, zone[1], -zone[0] / 2, 0], [0.07, zone[1], zone[0] / 2, 0]]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paint);
    s.rotation.x = -Math.PI / 2;
    s.position.set(center[0] + dx, hangarY + 0.0008, (P.isFuselage ? 0 : center[2]) + dz);
    s.receiveShadow = true;
    root.add(s);
  }

  // ---------- свет ----------
  root.add(new THREE.HemisphereLight('#eef3f7', '#4a4d50', P.isFuselage ? 0.15 : 0.25));
  const key = P.isFuselage
    ? new THREE.SpotLight('#fff1de', 32, 9, Math.PI / 3.2, 0.6, 1.6)     // прожектор на штативе внутри секции
    : new THREE.DirectionalLight('#fff4e6', 2.4);                       // верхние светильники цеха
  if (P.isFuselage) key.position.set(center[0] + 1.6, fy + 2.55, 0.9);
  else key.position.set(center[0] + 1.2, fy + 5.0, center[2] + 1.6);
  key.target.position.set(...center);
  key.castShadow = true;
  const smap = quality === 'low' ? 1024 : 2048;
  key.shadow.mapSize.set(smap, smap);
  key.shadow.radius = 5;
  key.shadow.blurSamples = 16;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.015;
  if (key.isDirectionalLight) Object.assign(key.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 1, far: 12 });
  else Object.assign(key.shadow.camera, { near: 0.2, far: 9 });
  root.add(key, key.target);

  if (P.isFixture) {
    // ---------- верстак ----------
    // ложемент (плита оснастки) — верх на 1 мм ниже самой низкой метки/детали; под ним коврик и столешница
    const base = P.bounds.min[1] - 0.001;
    const top = [size[0] + 0.55, 0.04, size[2] + 0.45];
    const ty = base - 0.012 - 0.003 - top[1] / 2;
    root.add(box(size[0] + 0.22, 0.012, size[2] + 0.12, material('anodized'), center[0], base - 0.006, center[2], 0.002));
    const esd = withRepeat(esdMatSet(), 4, 2);
    root.add(box(top[0] - 0.04, 0.003, top[2] - 0.04, new THREE.MeshStandardMaterial({ ...esd, metalness: 0 }), center[0], base - 0.0135, center[2], 0.001));
    const laminate = painted('#c9c3b5', { rough: 0.55, metal: 0, peel: 128, coat: 0.3 });
    root.add(box(top[0], top[1], top[2], laminate, center[0], ty, center[2], 0.004));
    // каркас: стойки, царги, нижняя полка, регулируемые опоры
    const frame = painted('#3b4148', { rough: 0.38, metal: 0.4 });
    const legH = ty - top[1] / 2 - fy;
    const lx = top[0] / 2 - 0.06, lz = top[2] / 2 - 0.06;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      root.add(box(0.05, legH - 0.03, 0.05, frame, center[0] + sx * lx, fy + 0.03 + (legH - 0.03) / 2, center[2] + sz * lz, 0.004));
      root.add(cyl(0.025, 0.012, material('rubber'), center[0] + sx * lx, fy + 0.006, center[2] + sz * lz));
      root.add(cyl(0.006, 0.03, material('steel'), center[0] + sx * lx, fy + 0.025, center[2] + sz * lz, 10));
    }
    for (const sz of [-1, 1]) root.add(box(2 * lx, 0.06, 0.03, frame, center[0], ty - top[1] / 2 - 0.04, center[2] + sz * lz, 0.004));
    for (const sx of [-1, 1]) root.add(box(0.03, 0.06, 2 * lz, frame, center[0] + sx * lx, ty - top[1] / 2 - 0.04, center[2], 0.004));
    root.add(box(2 * lx - 0.05, 0.02, 2 * lz - 0.05, painted('#59616a', { rough: 0.5, metal: 0.3 }), center[0], fy + 0.18, center[2], 0.003));
    // ящик с инструментом на нижней полке
    root.add(box(0.5, 0.22, 0.28, painted('#b5281f', { rough: 0.35, metal: 0.3 }), center[0] - 0.35, fy + 0.3, center[2], 0.01));
    benchLamp(root, center[0], fy + 2.05, center[2] - 0.05, Math.min(1.5, top[0] * 0.8));
  }

  if (P.isFuselage) {
    // ---------- секция фюзеляжа ----------
    const R = F.radius, L = F.length, cx = center[0];
    const pr = primerSet();
    const skinMat = new THREE.MeshPhysicalMaterial({ ...withRepeat(pr, 6, 3), metalness: 0.2, side: THREE.DoubleSide });
    const skin = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 96, 1, true), skinMat);
    skin.rotation.z = Math.PI / 2;                   // ось вдоль X
    skin.position.set(cx, cy, 0);
    skin.receiveShadow = true;
    root.add(skin);
    // шпангоуты: стенка (кольцо) + внутренняя полка (Z-профиль), шаг 0,5 м, через 0 — шп. 18
    const frameMat = new THREE.MeshPhysicalMaterial({ ...withRepeat(primerSet('#93a06a'), 4, 1), metalness: 0.25 });
    const ringShape = new THREE.Shape().absarc(0, 0, R - 0.002, 0, Math.PI * 2, false);
    ringShape.holes.push(new THREE.Path().absarc(0, 0, R - F.frameDepth, 0, Math.PI * 2, true));
    const webGeo = new THREE.ExtrudeGeometry(ringShape, { depth: 0.004, bevelEnabled: false, curveSegments: 96 });
    const flangeGeo = new THREE.CylinderGeometry(R - F.frameDepth, R - F.frameDepth, 0.045, 96, 1, true);
    const n = Math.floor(L / 2 / F.framePitch);
    for (let i = -n; i <= n; i++) {
      const x = cx + i * F.framePitch;
      const web = new THREE.Mesh(webGeo, frameMat);
      web.rotation.y = Math.PI / 2;
      web.position.set(x - 0.002, cy, 0);
      const fl2 = new THREE.Mesh(flangeGeo, frameMat);
      fl2.rotation.z = Math.PI / 2;
      fl2.position.set(x + 0.0205, cy, 0);
      for (const o of [web, fl2]) { o.castShadow = o.receiveShadow = true; root.add(o); }
    }
    // стрингеры — по окружности через 9°, кроме зоны пола
    const strMat = material('aluminium');
    for (let a = -170; a <= 170; a += 9) {
      const t = THREE.MathUtils.degToRad(a);
      const y = cy + Math.cos(t) * (R - 0.018), z = Math.sin(t) * (R - 0.018);
      if (y < fy + 0.05) continue;
      const s = box(L, 0.022, 0.018, strMat, cx, y, z, 0.002);
      s.rotation.x = t;                            // толщина профиля — по радиусу
      root.add(s);
    }
    // иллюминаторы: рамка + стекло с дневным светом снаружи
    const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color('#dfeeff').multiplyScalar(2.2) });
    const winFrame = material('aluminium');
    const wShape = new THREE.Shape();
    const ww = 0.24, wh = 0.34, wr = 0.1;
    wShape.moveTo(-ww / 2 + wr, -wh / 2);
    wShape.lineTo(ww / 2 - wr, -wh / 2); wShape.quadraticCurveTo(ww / 2, -wh / 2, ww / 2, -wh / 2 + wr);
    wShape.lineTo(ww / 2, wh / 2 - wr); wShape.quadraticCurveTo(ww / 2, wh / 2, ww / 2 - wr, wh / 2);
    wShape.lineTo(-ww / 2 + wr, wh / 2); wShape.quadraticCurveTo(-ww / 2, wh / 2, -ww / 2, wh / 2 - wr);
    wShape.lineTo(-ww / 2, -wh / 2 + wr); wShape.quadraticCurveTo(-ww / 2, -wh / 2, -ww / 2 + wr, -wh / 2);
    const outer = new THREE.Shape(wShape.getPoints(24).map((p) => p.clone().multiplyScalar(1.28)));
    outer.holes.push(new THREE.Path(wShape.getPoints(24)));
    const ringGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.02, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 });
    const glassGeo = new THREE.ShapeGeometry(wShape, 16);
    const winAng = THREE.MathUtils.degToRad(88);      // от верха сечения: центр окна ≈ 1,2 м над полом
    for (let i = -n; i < n; i++) for (const side of [-1, 1]) {
      const x = cx + (i + 0.5) * F.framePitch;
      const y = cy + Math.cos(winAng) * (R - 0.03), z = side * Math.sin(winAng) * (R - 0.03);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.lookAt(x, cy, 0);
      const ring = new THREE.Mesh(ringGeo, winFrame);
      ring.castShadow = true;
      const gl = new THREE.Mesh(glassGeo, glass);
      gl.position.z = -0.01;
      g.add(ring, gl);
      root.add(g);
    }
    // теплозвукоизоляция между шпангоутами над окнами (серебристые маты); y = R·sinθ, z = R·cosθ после поворота
    const blanket = new THREE.MeshPhysicalMaterial({ color: '#b9bcbd', roughness: 0.45, metalness: 0.6, ...withRepeat(primerSet('#b9bcbd'), 1, 1) });
    blanket.map = null;
    for (let i = -n; i < n; i++) for (const side of [-1, 1]) {
      if ((i + n) % 3 === 1) continue;           // часть пролётов ещё не закрыта — видна конструкция
      const t0 = THREE.MathUtils.degToRad(side > 0 ? 12 : 138);
      const g = new THREE.CylinderGeometry(R - 0.03, R - 0.03, F.framePitch - 0.06, 24, 1, true, t0, THREE.MathUtils.degToRad(30));
      const m = new THREE.Mesh(g, blanket);
      m.rotation.z = Math.PI / 2;
      m.position.set(cx + (i + 0.5) * F.framePitch, cy, 0);
      m.material.side = THREE.DoubleSide;
      m.receiveShadow = true;
      root.add(m);
    }
    // пол: панели с противоскользящим покрытием, рельсы кресел, балки
    const halfW = Math.sqrt(R * R - (cy - fy) ** 2) - 0.02;
    const floorPanel = new THREE.MeshPhysicalMaterial({ color: '#4a4e52', roughness: 0.85, ...withRepeat(esdMatSet(), 8, 2) });
    floorPanel.map = null;
    root.add(box(L, 0.012, 2 * halfW, floorPanel, cx, fy - 0.006, 0, 0.002));
    for (const z of [-1.25, -0.8, 0.8, 1.25]) {
      root.add(box(L, 0.016, 0.03, material('aluminium'), cx, fy + 0.008, z, 0.002));
      root.add(box(L, 0.004, 0.012, painted('#1b1d20', { rough: 0.6 }), cx, fy + 0.0165, z, 0.001));
    }
    // ложемент-подставка под секцию (видна снаружи)
    for (const sx of [-1, 1]) root.add(box(0.4, cy - F.radius * 0.7 - hangarY, 2.4, painted('#2f6aa3', { rough: 0.4, metal: 0.3 }), cx + sx * (L / 2 - 0.6), (cy - F.radius * 0.7 + hangarY) / 2, 0, 0.01));
    // гирлянда временного освещения под потолком
    const tubeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff7ea').multiplyScalar(5) });
    for (const z of [-0.55, 0.55]) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.2, 12), tubeMat);
      tube.rotation.z = Math.PI / 2;
      tube.position.set(cx, cy + R * 0.86, z);
      root.add(tube);
      const ra = new THREE.RectAreaLight('#fff3e4', 14, 1.2, 0.08);
      ra.position.copy(tube.position);
      ra.lookAt(tube.position.x, fy, z * 0.4);
      root.add(ra);
    }
    // прожектор на штативе (источник ключевого света)
    const tri = new THREE.Group();
    const lp = key.position;
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3;
      const foot = new THREE.Vector3(lp.x + Math.cos(a) * 0.35, fy, lp.z + Math.sin(a) * 0.35);
      const dir = lp.clone().sub(foot);
      const leg = cyl(0.008, dir.length(), material('steel'), 0, 0, 0, 8);
      leg.position.copy(foot).addScaledVector(dir, 0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      tri.add(leg);
    }
    const head = box(0.22, 0.16, 0.1, painted('#e0b21c', { rough: 0.35, metal: 0.4 }), lp.x, lp.y + 0.08, lp.z, 0.01);
    head.castShadow = false;
    tri.add(head);
    root.add(tri);
  }

  // ---------- источники деталей: тара, тележка, подъёмник, стеллаж ----------
  const sources = [];
  const carts = new Map();
  for (const p of P.parts.values()) {
    if (!p.src) continue;
    const [x, y, z] = p.src;
    if (p.srcKind === 'bin') {
      root.add(bin(x, y - 0.045, z));
      // боковой стол под лотки
      if (!carts.has('bin-table')) {
        const xs = [...P.parts.values()].filter((q) => q.srcKind === 'bin').map((q) => q.src);
        const minX = Math.min(...xs.map((v) => v[0])), maxX = Math.max(...xs.map((v) => v[0]));
        const minZ = Math.min(...xs.map((v) => v[2])), maxZ = Math.max(...xs.map((v) => v[2]));
        const tw = maxX - minX + 0.3, td = maxZ - minZ + 0.34, tx = (minX + maxX) / 2, tz = (minZ + maxZ) / 2;
        const tTop = y - 0.045 - 0.01;
        root.add(box(tw, 0.02, td, painted('#59616a', { rough: 0.45, metal: 0.35 }), tx, tTop, tz, 0.003));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) root.add(box(0.035, tTop - fy, 0.035, painted('#3b4148', { rough: 0.38, metal: 0.4 }), tx + sx * (tw / 2 - 0.03), (tTop + fy) / 2, tz + sz * (td / 2 - 0.03), 0.003));
        carts.set('bin-table', true);
      }
    }
    if (p.srcKind === 'cart' && !carts.has(p.cell ?? p.id)) {
      // тележка: две полки, ручка, колёса. Ячейки A/B — на одной тележке
      const xs = [...P.parts.values()].filter((q) => q.srcKind === 'cart').map((q) => q.src);
      const cxm = (Math.min(...xs.map((v) => v[0])) + Math.max(...xs.map((v) => v[0]))) / 2;
      const czm = (Math.min(...xs.map((v) => v[2])) + Math.max(...xs.map((v) => v[2]))) / 2;
      if (!carts.has('cart')) {
        const cw = 0.6, cd = 0.75, top = Math.min(...xs.map((v) => v[1])) - 0.025;
        const m = painted('#5c6670', { rough: 0.4, metal: 0.45 });
        const shelf = painted('#8b939a', { rough: 0.5, metal: 0.2, peel: 96 });
        root.add(box(cw, 0.025, cd, shelf, cxm, top, czm, 0.006));
        root.add(box(cw, 0.025, cd, shelf, cxm, fy + 0.2, czm, 0.006));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          root.add(cyl(0.012, top - fy - 0.1, m, cxm + sx * (cw / 2 - 0.02), (top + fy + 0.1) / 2, czm + sz * (cd / 2 - 0.02), 12));
          root.add(caster(cxm + sx * (cw / 2 - 0.05), fy, czm + sz * (cd / 2 - 0.05)));
        }
        const handle = cyl(0.012, cw, material('steel'), cxm, top + 0.18, czm + cd / 2, 12);
        handle.rotation.z = Math.PI / 2;
        root.add(handle);
        for (const sx of [-1, 1]) root.add(cyl(0.01, 0.2, m, cxm + sx * (cw / 2 - 0.02), top + 0.08, czm + cd / 2, 10));
        // ложементы-лотки на тележке под ячейки
        for (const c of new Set([...P.parts.values()].filter((q) => q.srcKind === 'cart').map((q) => q.cell))) {
          const ps = [...P.parts.values()].filter((q) => q.srcKind === 'cart' && q.cell === c).map((q) => q.src);
          const bx = ps.reduce((a, v) => a + v[0], 0) / ps.length, bz = ps.reduce((a, v) => a + v[2], 0) / ps.length;
          root.add(bin(bx, top + 0.012, bz, c === 'A' ? '#2f5f9e' : '#3c7a4a', 0.32, 0.05, 0.22));
        }
        carts.set('cart', true);
      }
      carts.set(p.cell ?? p.id, true);
    }
    if (p.srcKind === 'lift') {     // подъёмник откатывают после установки детали — см. sources в main.js
      const lift = new THREE.Group();
      const yellow = painted('#d9a91c', { rough: 0.38, metal: 0.35 });
      const platY = y - 0.27;
      lift.add(box(1.7, 0.04, 0.7, yellow, x, platY, z, 0.008));
      lift.add(box(1.7, 0.03, 0.04, painted('#1d1f22', { rough: 0.5 }), x, platY + 0.035, z + 0.33, 0.004));
      lift.add(box(0.12, platY - fy - 0.12, 0.12, painted('#45494e', { rough: 0.4, metal: 0.5 }), x, (platY + fy + 0.12) / 2, z, 0.006));
      lift.add(cyl(0.045, platY - fy - 0.3, material('chrome'), x, (platY + fy) / 2 + 0.05, z + 0.12, 20));
      lift.add(box(1.2, 0.08, 0.8, yellow, x, fy + 0.09, z, 0.01));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) lift.add(caster(x + sx * 0.5, fy, z + sz * 0.32, 0.035));
      lift.userData.partId = p.id;
      sources.push(lift);
      root.add(lift);
    }
    if (p.srcKind === 'rack') {
      // стеллаж: перфорированные стойки, полки, деталь лежит наклонно на нижней полке
      const rk = painted('#4f5a52', { rough: 0.45, metal: 0.4 });
      const h = y - fy + 0.9, d = 0.5, w = 1.25;
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) root.add(box(0.04, h, 0.04, rk, x - 0.1 + sx * d / 2, fy + h / 2, z + sz * w / 2, 0.004));
      for (const sy of [0.15, y - fy - 0.03, h - 0.02]) root.add(box(d + 0.04, 0.02, w + 0.04, painted('#7b857e', { rough: 0.5, metal: 0.3 }), x - 0.1, fy + sy, z, 0.004));
    }
    if (p.cell) {
      const l = label(p.cell, { size: 0.045 });
      l.position.set(x, y + 0.08, z + 0.1);
      root.add(l);
    }
  }

  // ---------- метки ArUco (наклейки на алюминиевых подложках) + рамки подсветки (голограмма, слой 1) ----------
  const loader = new THREE.TextureLoader();
  const markerFrames = [];
  for (const m of P.markers) {
    const side = m.size * MARKER_TEX_RATIO;
    const g = new THREE.PlaneGeometry(side, side);
    g.rotateX(-Math.PI / 2);                     // нормаль +Y, «верх» картинки к −Z — как СК метки в пакете
    const mm = new THREE.MeshPhysicalMaterial({ color: '#f4f4f2', roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.3 });
    loader.load(markerUrl(m.id), (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; mm.map = t; mm.needsUpdate = true;
    }, undefined, () => { mm.color.set('#bbbbbb'); });
    const o = new THREE.Mesh(g, mm);
    o.position.set(...m.pos);
    o.quaternion.set(...m.rot);
    o.receiveShadow = true;
    root.add(o);
    // алюминиевая подложка чуть больше метки, чтобы метка не «висела» на стене фюзеляжа
    const back = box(side * 1.12, 0.004, side * 1.12, material('aluminium'), 0, -0.0025, 0, 0.0015);
    o.add(back);
    const fr = markerFrame(m.size);
    fr.position.copy(o.position);
    fr.quaternion.copy(o.quaternion);
    fr.visible = false;
    fr.layers.set(LAYER_HOLO);
    root.add(fr);
    markerFrames.push(fr);
  }
  return { root, markerFrames, sun: key, sources };
}
