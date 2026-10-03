// Дополнительные участки цеха: ЭМ-1 (сборка жгутов на макете), СЛ-1 (слесарный, прессы), МЭ-1 (монтаж
// электрооборудования модуля без стапеля). Ставит их в цех, добавляет коллизии и местный свет.
import * as THREE from 'three';
import { solid } from '../hall.js';
import { benchStation } from './bench.js';
import { harnessStation } from './harness.js';
import { installStation } from './install.js';

/** Прямоугольник в СК участка → коллизия в цехе (с учётом поворота участка). */
function block(st, x0, x1, z0, z1) {
  const pts = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => new THREE.Vector3(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), st.yaw || 0).add(st.center));
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const a = Math.min(...xs), b = Math.max(...xs), c = Math.min(...zs), d = Math.max(...zs);
  solid((a + b) / 2, (c + d) / 2, b - a, d - c);
}

export function buildStations(scene) {
  const list = [harnessStation(), benchStation(), installStation()];
  for (const st of list) {
    scene.add(st.root);
    st.asm = st.playerTarget();
    // местный свет над участком (без теней — их даёт общий свет цеха)
    const lamp = new THREE.SpotLight('#fff3e3', 60, 9, Math.PI / 3, 0.8, 1.5);
    lamp.position.set(0, 4.2, 1.2); lamp.target.position.set(0, 0.8, -0.2);
    st.root.add(lamp, lamp.target);
  }
  const [em, sl, me] = list;
  block(em, -1.3, 1.3, -0.9, 0.4); block(em, -2.85, -1.2, -0.45, 0.65); block(em, 1.35, 2.95, -0.2, 0.7); block(em, -2.5, -1.8, 0.75, 1.25);
  block(sl, -1.05, 1.05, -0.4, 0.5); block(sl, -2.35, -1.75, -0.35, 0.3); block(sl, -3.55, -3.15, -0.25, 0.25); block(sl, 1.4, 1.9, -0.25, 0.25); block(sl, 2.6, 4.5, -0.6, 0.75);
  block(me, -1.0, 1.0, -0.55, 0.55); block(me, -2.3, -1.5, 0.9, 1.5); block(me, 1.9, 2.6, 1.1, 1.7); block(me, 1.9, 2.5, -1.9, -1.3);
  return list;
}
