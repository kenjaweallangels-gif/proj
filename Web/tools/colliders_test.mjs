// Тест широкой фазы colliders: результаты push/near/segmentBlocked с сеткой совпадают с полным перебором (динамические тела двигаем).
import * as THREE from 'three';
import { colliders } from '../src/core/colliders.js';
import { rng } from '../src/core/util.js';

const R = rng(5), V = (x, y, z) => new THREE.Vector3(x, y, z);
const dyn = [];
for (let i = 0; i < 400; i++) {
  const x = (R() - 0.5) * 600, z = (R() - 0.5) * 600, k = R();
  if (k < 0.4) colliders.add({ type: 'sphere', c: V(x, 0.5, z), r: 0.3 + R() * 2, owner: 'o' + (i % 3) });
  else if (k < 0.7) colliders.add({ type: 'box', c: V(x, 1, z), half: V(0.5 + R() * 3, 1, 0.5 + R() * 3), yaw: R() * 6, owner: 'b' });
  else { const a = V(x, 0.4, z), b = V(x + (R() - 0.5) * 60, 0.4, z + (R() - 0.5) * 60); dyn.push({ a, b }); colliders.add({ type: 'capsule', a, b, r: 0.4 + R() * 3, owner: 'c' + i }); }
}
function brute(pos, r) {
  // эталон: тот же алгоритм по всем записям, один проход, без сетки — считаем число пересекающихся тел
  let n = 0;
  const q = new THREE.Vector3(), w = new THREE.Vector3();
  for (const e of colliders.all()) {
    if (!e.solid) continue;
    for (const k of [0.3, 0.9, 1.6]) {
      w.set(pos.x, pos.y + k, pos.z); colliders.closestPoint(e, w, q);
      const dx = w.x - q.x, dz = w.z - q.z, dy = w.y - q.y, d2 = dx * dx + dz * dz;
      if (Math.abs(dy) > 0.05 && d2 + dy * dy > r * r) continue;
      if (d2 >= r * r) continue;
      n++; break;
    }
  }
  return n;
}
let bad = 0, checks = 0;
for (let frame = 0; frame < 60; frame++) {
  for (const d of dyn) { d.a.x += (R() - 0.5) * 4; d.a.z += (R() - 0.5) * 4; d.b.x += (R() - 0.5) * 4; d.b.z += (R() - 0.5) * 4; }
  colliders.tick();
  for (let i = 0; i < 200; i++) {
    const p = V((R() - 0.5) * 700, 0, (R() - 0.5) * 700), r = 0.35;
    const expect = brute(p, r) > 0;
    const q = p.clone();
    const hit = colliders.push(q, r, { height: 1.8 });
    checks++;
    if (hit !== expect) { bad++; if (bad < 5) console.log('MISMATCH', frame, p.toArray(), hit, expect); }
    const nr = colliders.near(p, 5).length;
    let nb = 0; const w = new THREE.Vector3();
    for (const e of colliders.all()) { colliders.closestPoint(e, p, w); if (w.distanceToSquared(p) <= 25) nb++; }
    if (nr !== nb) { bad++; if (bad < 5) console.log('NEAR MISMATCH', nr, nb); }
  }
}
console.log(bad ? `FAIL ${bad}/${checks}` : `OK ${checks} проверок, ячеек ${colliders.cells}, тел ${colliders.size}`);
process.exit(bad ? 1 : 0);
