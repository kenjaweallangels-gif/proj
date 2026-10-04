// Микробенч широкой фазы: старый перебор (tools/_colliders_old.mjs = версия до сетки) vs сетка; push по 420 телам, как в игре.
import * as THREE from 'three';
import { colliders as NEW } from '../src/core/colliders.js';
import { colliders as OLD } from './_colliders_old.mjs';
import { rng } from '../src/core/util.js';
const R = rng(3), V = (x, y, z) => new THREE.Vector3(x, y, z);
for (const C of [OLD, NEW]) {
  const r = rng(9);
  for (let i = 0; i < 420; i++) {
    const x = 560 + r() * 120, z = 230 + r() * 120, k = r();
    if (k < 0.6) C.add({ type: 'sphere', c: V(x, 10, z), r: 0.5 + r() * 3, owner: 'o' });
    else if (k < 0.85) C.add({ type: 'box', c: V(x, 10, z), half: V(1, 1, 1), yaw: r() * 3, owner: 'b' });
    else C.add({ type: 'capsule', a: V(x, 10, z), b: V(x + 4, 10, z + 4), r: 0.4, owner: 'c' });
  }
}
const N = 50000, P = [];
for (let i = 0; i < N; i++) P.push(V(560 + R() * 120, 10, 230 + R() * 120));
for (const [name, C] of [['old (linear)', OLD], ['new (grid)', NEW]]) {
  C.tick?.();
  for (let i = 0; i < 2000; i++) C.push(P[i].clone(), 0.35, {});
  const t = performance.now();
  for (let i = 0; i < N; i++) C.push(P[i].clone(), 0.35, { height: 1.8 });
  console.log(name.padEnd(14), ((performance.now() - t) / N * 1000).toFixed(2), 'us / push');
}
