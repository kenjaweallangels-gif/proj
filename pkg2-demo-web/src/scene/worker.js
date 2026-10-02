// Вид со стороны: голова сборщика в очках, конус окна дисплея 52° (то, где возможны голограммы) и поле зрения глаза.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LAYER_HOLO, setLayer } from '../engine/holo.js';
import { twillSet, withRepeat } from './textures.js';

function frustumLines(hDeg, vDeg, len, color, opacity) {
  const tx = Math.tan(THREE.MathUtils.degToRad(hDeg / 2)) * len, ty = Math.tan(THREE.MathUtils.degToRad(vDeg / 2)) * len;
  const c = [[-tx, ty], [tx, ty], [tx, -ty], [-tx, -ty]].map(([x, y]) => new THREE.Vector3(x, y, -len));
  const pts = [];
  for (const p of c) pts.push(new THREE.Vector3(), p);
  for (let i = 0; i < 4; i++) pts.push(c[i], c[(i + 1) % 4]);
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2 * tx, 2 * ty),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * 0.12, side: THREE.DoubleSide, depthWrite: false }));
  face.position.z = -len;
  const g = new THREE.Group();
  g.add(lines, face);
  return g;
}

export function buildWorker(scene, win) {
  const g = new THREE.Group();
  g.name = 'worker';
  // голова: кожа (sheen — мягкий «пушковый» отлив по краям), шея, уши
  const skin = new THREE.MeshPhysicalMaterial({
    color: '#c69a7c', roughness: 0.55, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color('#ffb59a'),
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 48, 32), skin);
  head.scale.set(0.82, 1.08, 0.98);
  head.position.set(0, 0.0, 0.07);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.024, 16, 12), skin);
    ear.scale.set(0.45, 1, 0.8);
    ear.position.set(sx * 0.083, 0.0, 0.08);
    g.add(ear);
  }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.04, 16), skin);
  nose.rotation.x = -Math.PI / 2 - 0.25;
  nose.position.set(0, -0.022, -0.028);
  // каска: купол (вращение профиля), козырёк, рёбра жёсткости — глянцевый пластик
  const hatMat = new THREE.MeshPhysicalMaterial({ color: '#f2f2ee', roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const prof = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI / 2;   // от края к макушке — нормали наружу
  prof.push(new THREE.Vector2(Math.cos(a) * 0.118, Math.sin(a) * 0.115)); }
  const dome = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), hatMat);
  dome.position.set(0, 0.045, 0.075);
  dome.scale.set(0.95, 1, 1.12);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.14, 0.008, 48, 1, false), hatMat);
  brim.scale.set(0.9, 1, 1.22);
  brim.position.set(0, 0.045, 0.055);
  const rib = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.006, 8, 32, Math.PI), hatMat);
  rib.rotation.y = Math.PI / 2;
  rib.position.set(0, 0.048, 0.075);
  rib.scale.set(1, 1, 1.12);
  // очки: оправа и тонированные линзы с отражениями
  const frameMat = new THREE.MeshPhysicalMaterial({ color: '#0d0e10', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
  const lensMat = new THREE.MeshPhysicalMaterial({ color: '#1a2630', roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.72, clearcoat: 1 });
  const glasses = new THREE.Group();
  const bridge = new THREE.Mesh(new RoundedBoxGeometry(0.168, 0.042, 0.022, 3, 0.008), frameMat);
  glasses.add(bridge);
  for (const sx of [-1, 1]) {
    const lens = new THREE.Mesh(new RoundedBoxGeometry(0.068, 0.034, 0.006, 3, 0.003), lensMat);
    lens.position.set(sx * 0.038, 0, -0.012);
    const arm = new THREE.Mesh(new RoundedBoxGeometry(0.006, 0.012, 0.12, 2, 0.002), frameMat);
    arm.position.set(sx * 0.082, 0.004, 0.055);
    glasses.add(lens, arm);
  }
  glasses.position.set(0, 0.008, -0.02);
  // корпус: спецодежда (саржа) с силуэтом плеч и груди, светоотражающая полоса, руки
  const fabric = new THREE.MeshPhysicalMaterial({
    color: '#2c3e57', roughness: 0.9, sheen: 0.5, sheenRoughness: 0.7, sheenColor: new THREE.Color('#5d7393'), ...withRepeat(twillSet(), 10, 6),
  });
  const torsoProf = [[0.0, -0.78], [0.15, -0.78], [0.165, -0.55], [0.17, -0.35], [0.185, -0.2], [0.17, -0.12], [0.07, -0.08], [0.0, -0.075]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProf, 48), fabric);
  torso.scale.set(1.25, 1, 0.68);              // плечи шире, чем глубина корпуса
  torso.position.set(0, -0.05, 0.12);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.048, 0.12, 24), skin);
  neck.position.set(0, -0.1, 0.09);
  const reflect = new THREE.Mesh(new THREE.CylinderGeometry(0.172, 0.172, 0.035, 48, 1, true),
    new THREE.MeshPhysicalMaterial({ color: '#c8cdd0', roughness: 0.25, metalness: 0.9, side: THREE.DoubleSide }));
  reflect.scale.set(1.25, 1, 0.69);
  reflect.position.set(0, -0.45, 0.12);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 10, 32), fabric);
  collar.rotation.x = Math.PI / 2;
  collar.position.set(0, -0.135, 0.095);
  const body = new THREE.Group();          // корпус поворачивается только по рысканию
  body.add(torso, neck, reflect, collar);
  for (const sx of [-1, 1]) {              // руки — согнуты, кисти перед корпусом (работа с деталью)
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.26, 8, 20), fabric);
    upper.position.set(sx * 0.23, -0.36, 0.1);
    upper.rotation.set(0.25, 0, sx * 0.12);
    const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.036, 0.22, 8, 20), fabric);
    fore.position.set(sx * 0.2, -0.56, -0.04);
    fore.rotation.set(-1.15, 0, -sx * 0.25);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.042, 20, 14), new THREE.MeshStandardMaterial({ color: '#2a2b2d', roughness: 0.75 }));
    glove.scale.set(0.8, 0.6, 1.2);
    glove.position.set(sx * 0.15, -0.62, -0.17);
    body.add(upper, fore, glove);
  }
  g.add(head, nose, dome, brim, rib, glasses);
  for (const o of [g, body]) o.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
  const disp = frustumLines(win.h, win.v, 1.1, '#58e6ff', 0.9);
  disp.rotation.x = THREE.MathUtils.degToRad(win.cy);
  const eye = frustumLines(110, 75, 0.6, '#ffffff', 0.25);
  g.add(setLayer(disp, LAYER_HOLO), setLayer(eye, LAYER_HOLO));     // не участвуют в AO, видны только со стороны
  scene.add(g, body);
  return {
    group: g, body,
    update(position, quaternion, yaw) {
      g.position.copy(position); g.quaternion.copy(quaternion);
      body.position.copy(position); body.rotation.set(0, yaw, 0);
    },
    set visible(v) { g.visible = v; body.visible = v; },
  };
}
