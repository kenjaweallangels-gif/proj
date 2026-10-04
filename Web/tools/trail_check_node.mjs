// Проверка тропы без браузера: строит сцену подхода и меш (как index.js), сравнивает видимую высоту с heightAt, ищет дыры.
//   node tools/trail_check_node.mjs [--q=med] [--json=file]
import { heightAt as fieldH } from '../src/desert/field.js';
import { buildClawGeometry } from '../src/desert/rock.js';
import { buildWallTable } from '../src/level/wall.js';
import { createApproachScene, ZONE, WALL_IN } from '../src/level/scene.js';
import { buildApproachMesh, NOTCH_X_MAX } from '../src/level/mesh.js';
import { makeHeightAt } from '../src/level/physics.js';
import { analyze, printReport } from './lib/trail_metrics.mjs';
import { writeFileSync } from 'node:fs';

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const t0 = performance.now();
const bx0 = ZONE.x0 - 4, bz0 = ZONE.z0 - 4, bn = Math.ceil(ZONE.x1 - ZONE.x0) + 9, bm = Math.ceil(ZONE.z1 - ZONE.z0) + 9;
const bg = new Float32Array(bn * bm);
for (let k = 0; k < bm; k++) for (let i = 0; i < bn; i++) bg[i + bn * k] = fieldH(bx0 + i, bz0 + k);
const base = (x, z) => { const fx = Math.min(bn - 1.001, Math.max(0, x - bx0)), fz = Math.min(bm - 1.001, Math.max(0, z - bz0)); const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k, o = i + bn * k; return (bg[o] * (1 - u) + bg[o + 1] * u) * (1 - v) + (bg[o + bn] * (1 - u) + bg[o + bn + 1] * u) * v; };
const claw = buildClawGeometry(arg('q', 'med'));
const wallX = buildWallTable(() => claw, { z0: ZONE.z0, z1: ZONE.z1, yMax: ZONE.y1 }, 'med', 'west', { dz: 0.5, dy: 0.5 });
const S = createApproachScene({ base, wallX });
const vol = S.build();
const msh = buildApproachMesh(S, vol, { base, wallX });
const heightAt = makeHeightAt(vol, fieldH);
console.log(`build ${(performance.now() - t0).toFixed(0)} ms, tris ${msh.index.length / 3 | 0}, wallFromGeometry=${wallX.fromGeometry}`);

const trail = [];
{ let s = 0, prev = null;
  for (const L of S.LEGS) for (let i = 0; i < L.line.length; i++) {
    const p = { x: L.line[i][0], y: L.ys[i], z: L.line[i][1] };
    if (prev) { const d = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z); if (d < 0.2) continue; s += Math.hypot(p.x - prev.x, p.z - prev.z); }
    p.s = s; trail.push(p); prev = p;
  } }
const cp = claw.getAttribute('position');
const R = analyze({
  lat: (arg('lat', '')).split(',').filter(Boolean).map(Number).length ? arg('lat', '').split(',').map(Number) : undefined,
  trail, zone: ZONE, heightAt, baseAt: base, wallAt: wallX, wallIn: WALL_IN, notchX: NOTCH_X_MAX,
  sampleSolid: (x, y, z) => vol.sample(x, y, z),
  meshes: [{ pos: msh.position, idx: msh.index, tag: 'a' }, { pos: cp.array, idx: claw.index.array, tag: 'c' }],
});
R.slotFree = S.slotFree ? { min: +Math.min(...S.slotFree).toFixed(2), max: +Math.max(...S.slotFree).toFixed(2) } : null;
printReport(R, '[trail]');
console.log('slot free corridor width (fin..wall):', JSON.stringify(R.slotFree));
if (arg('json', '')) writeFileSync(arg('json', ''), JSON.stringify(R, null, 1));
