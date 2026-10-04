// Отладка IK/замка: расхождение голеностопа с целью, положение таза. node tools/char_dbg_ik.mjs [speed]
import * as THREE from 'three';
import { makeFigure } from '../src/core/figures.js';
const speed = Number(process.argv[2] || 1.4);
const f = makeFigure({ preset: 'Kair', lod: 0 });
const g = f.group, A = f._anim, v = new THREE.Vector3();
g.rotation.y = Math.PI / 2;
const dt = 1 / 60;
let t = 0, errMax = 0, errSum = 0, n = 0;
const rows = [];
for (let i = 0; i < 60 * 6; i++) {
  t += dt;
  g.position.x += speed * dt;
  f.animate(speed, dt, 0);
  g.updateMatrixWorld(true);
  if (t > 3 && t < 3.5) {
    const row = { t: t.toFixed(2), Hp: A.state.Hp.toFixed(3), mode: A.state.mode, phi: A.state.phi.toFixed(2) };
    for (let k = 0; k < 2; k++) {
      const F = A.feet[k], b = f.parts.limbs[k ? 'R' : 'L'].foot;
      v.set(0, 0, 0).applyMatrix4(b.matrixWorld);
      // цель в мире: корень → мир
      const tgt = new THREE.Vector3(F.ax, F.ay, F.az).applyMatrix4(f.parts.root.matrixWorld);
      const e = v.distanceTo(tgt); const dl = f.parts.root.worldToLocal(v.clone()).sub(new THREE.Vector3(F.ax, F.ay, F.az)); row['d' + k] = [dl.x, dl.y, dl.z].map((q) => q.toFixed(3)).join(',');
      row['e' + k] = e.toFixed(3); row['s' + k] = F.stance ? F.s.toFixed(2) : 'sw' + (F.u || 0).toFixed(2); row['az' + k] = F.az.toFixed(2);
      errMax = Math.max(errMax, e); errSum += e; n++;
    }
    rows.push(row);
  }
}
console.log('IK error max', errMax.toFixed(4), 'mean', (errSum / n).toFixed(4));
console.table(rows.filter((_, i) => i % 3 === 0));
