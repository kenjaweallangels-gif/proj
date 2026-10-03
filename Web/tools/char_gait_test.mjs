// Проверка походки без браузера: стопы стоят на земле (скольжение), события шагов, ритм песка.
// node tools/char_gait_test.mjs
import * as THREE from 'three';
import { makeFigure } from '../src/core/figures.js';

function run(name, speed, irr, secs, ctx = {}) {
  const f = makeFigure({ preset: 'Kair', lod: 0 });
  const g = f.group; g.rotation.y = Math.PI / 2; // идём вдоль +X
  const steps = [];
  let t = 0;
  f.onStep = (e) => steps.push({ t: +t.toFixed(2), foot: e.foot, mode: e.mode, i: +e.intensity.toFixed(2) });
  const dt = 1 / 60, v = new THREE.Vector3(), prev = [null, null];
  let avgSum = 0;
  let planted = 0, frames = 0, slipSum = 0, minY = 9, maxY = -9, nan = false, maxLift = 0;
  const sp = { current: speed };
  for (let i = 0; i < secs * 60; i++) {
    t += dt;
    const env = irr ? f.gait.env : 1;
    const cur = speed * (irr ? env : 1);
    sp.current += (cur - sp.current) * Math.min(1, dt * 7);
    g.position.x += sp.current * dt; avgSum += sp.current;
    f.animate(sp.current, dt, irr, { allowPause: true, desert: !!irr, ...ctx });
    g.updateMatrixWorld(true);
    if (t < 1.5) continue;
    for (let k = 0; k < 2; k++) {
      const b = f.parts.limbs[k ? 'R' : 'L'].foot;
      b.getWorldPosition(v);
      if (Number.isNaN(v.x + v.y + v.z)) nan = true;
      if (prev[k]) {
        const sx = (v.x - prev[k].x) / dt - 0; // скорость стопы в мире
        const onGround = v.y < 0.135;
        if (onGround) { frames++; if (Math.abs(sx) < 0.35 * Math.max(0.3, sp.current)) { planted++; } slipSum += Math.abs(sx); }
        maxLift = Math.max(maxLift, v.y - 0.08);
      }
      prev[k] = v.clone(); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
  }
  console.log(`${name}: speed=${speed} frames-on-ground=${frames} planted=${(100 * planted / Math.max(1, frames)).toFixed(0)}% meanFootSpeedOnGround=${(slipSum / Math.max(1, frames)).toFixed(2)} ankleY[${minY.toFixed(3)}..${maxY.toFixed(3)}] maxLift=${maxLift.toFixed(3)} steps=${steps.length} avgSpeed=${(avgSum / (secs * 60)).toFixed(2)} nan=${nan}`);
  return steps;
}
run('walk', 3, 0, 6);
run('run', 6, 0, 6);
run('slow', 1.2, 0, 6);
const d = run('desert', 1.9, 1, 60);
const ints = []; for (let i = 1; i < d.length; i++) ints.push(+(d[i].t - d[i - 1].t).toFixed(2));
console.log('desert step intervals:', ints.join(' '));
const w = run('walk', 3, 0, 6);
const wi = []; for (let i = 1; i < w.length; i++) wi.push(+(w[i].t - w[i - 1].t).toFixed(2));
console.log('walk step intervals:', wi.join(' '));
