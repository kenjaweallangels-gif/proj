// Скольжение стоп: точка пятки/носка опорной стопы должна стоять на месте в мире. node tools/char_slide_test.mjs
import * as THREE from 'three';
import { makeFigure } from '../src/core/figures.js';
function run(name, speed, secs, o = {}) {
  const f = makeFigure({ preset: 'Kair', lod: 0 });
  const g = f.group, A = f._anim, v = new THREE.Vector3(), prev = [null, null];
  let n = 0, sum = 0, mx = 0, steps = 0, nan = false;
  f.onStep = () => steps++;
  const dt = o.dt || 1 / 60;
  let t = 0, sp = 0;
  for (let i = 0; i < secs / dt; i++) {
    t += dt;
    const target = typeof speed === 'function' ? speed(t) : speed;
    sp += (target - sp) * Math.min(1, dt * 5);
    g.rotation.y = o.turn ? Math.PI / 2 + Math.sin(t * 0.8) * o.turn * 0.5 + t * (o.spin || 0) : Math.PI / 2;
    const yaw = g.rotation.y; g.position.x += Math.sin(yaw) * sp * dt; g.position.z += Math.cos(yaw) * sp * dt;
    f.animate(sp, dt, 0);
    g.updateMatrixWorld(true);
    for (let k = 0; k < 2; k++) {
      const F = A.feet[k], b = f.parts.limbs[k ? 'R' : 'L'].foot;
      let pt = null;
      if (F.stance && !F.fixed && F.s > 0.15 && F.s < 0.5) pt = [0, -0.08, -0.09];
      else if (F.stance && !F.fixed && F.s > 0.75) pt = [0, -0.08, 0.18];
      if (pt && t > 1.2) {
        v.set(...pt).applyMatrix4(b.matrixWorld);
        if (Number.isNaN(v.x + v.y + v.z)) nan = true;
        if (prev[k]) { const d = Math.hypot(v.x - prev[k].x, v.z - prev[k].z) / dt; sum += d; n++; mx = Math.max(mx, d); if (d > 1.0 && o.verbose) console.log("  spike", name, t.toFixed(2), k, F.s.toFixed(2), A.state.mode, d.toFixed(2)); }
        prev[k] = v.clone();
      } else prev[k] = null;
    }
  }
  console.log(`${name}: contact-point slide mean ${(sum / Math.max(1, n) * 100).toFixed(1)} cm/s max ${(mx * 100).toFixed(0)} cm/s (n=${n}) steps=${steps} nan=${nan}`);
}
run('walk 1.4', 1.4, 8);
run('walk 3', 3, 8);
run('run 6', 6, 8);
run('slow 0.6', 0.6, 8);
run('accel-decel', (t) => (t % 6 < 3 ? 2.2 : 0), 12, { verbose: 1 });
run('turning walk', 1.5, 10, { turn: 1.2, spin: 0.0 });
run('walk dt=0.1', 1.4, 8, { dt: 0.1 });
run('walk dt=0.05', 3, 8, { dt: 0.05 });
