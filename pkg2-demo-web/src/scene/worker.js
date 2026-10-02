// Вид со стороны: голова сборщика в очках, конус окна дисплея 52° (то, где возможны голограммы) и поле зрения глаза.
import * as THREE from 'three';

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
  const skin = new THREE.MeshStandardMaterial({ color: '#c9a184', roughness: 0.7 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 16), skin);
  head.scale.set(0.85, 1.05, 1);
  head.position.set(0, 0.02, 0.07);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.112, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#e6a619', roughness: 0.45 }));
  helmet.position.set(0, 0.045, 0.07);
  const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.03), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.3, metalness: 0.5 }));
  glasses.position.set(0, 0.0, -0.01);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.7, 6, 16), new THREE.MeshStandardMaterial({ color: '#33506e', roughness: 0.8 }));
  torso.position.set(0, -0.68, 0.14);
  torso.scale.set(1.25, 1, 0.75);          // плечи шире, чем глубина корпуса
  const body = new THREE.Group();          // корпус поворачивается только по рысканию
  body.add(torso);
  g.add(head, helmet, glasses);
  for (const o of [g, body]) o.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  const disp = frustumLines(win.h, win.v, 1.1, '#58e6ff', 0.9);
  disp.rotation.x = THREE.MathUtils.degToRad(win.cy);
  const eye = frustumLines(110, 75, 0.6, '#ffffff', 0.25);
  g.add(disp, eye);
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
