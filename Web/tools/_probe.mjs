import { ringIn } from '../src/garden/layout.js';
import { buildClawGeometry } from '../src/desert/rock.js';
import { buildWallTable } from '../src/level/wall.js';
import { heightAt as fh } from '../src/desert/field.js';
import { createGroundField, buildGrid } from '../src/garden/ground.js';
const faceX = buildWallTable(() => buildClawGeometry('med'), { z0: 322, z1: 470, yMax: 36 }, 'med', 'east');
const F = createGroundField({ desert: fh, faceAt: (z) => faceX(z, 4) });
const t0 = performance.now();
const grid = buildGrid(F);
console.log('grid', grid.nx, grid.nz, (performance.now() - t0) | 0, 'ms; cells', grid.cellOn.reduce((a, b) => a + b, 0));
let maxS = 0; const bad = [];
for (let k = 1; k < grid.nz - 1; k++) for (let i = 1; i < grid.nx - 1; i++) {
  if (!grid.cellOn[i + (grid.nx - 1) * k]) continue;
  const x = grid.G.x0 + i, z = grid.G.z0 + k;
  const gx = (grid.h[i + 1 + grid.nx * k] - grid.h[i - 1 + grid.nx * k]) / 2, gz = (grid.h[i + grid.nx * (k + 1)] - grid.h[i + grid.nx * (k - 1)]) / 2;
  const s = Math.atan(Math.hypot(gx, gz)) * 57.3;
  if (s > 14 && grid.cv[i + grid.nx * k] > 0.9 && (Math.hypot(x - 840, z - 395) < ringIn(Math.atan2(z - 395, x - 840)) - 1.5 || x > 889)) bad.push([x, z, s.toFixed(0), grid.h[i + grid.nx * k].toFixed(1)]);
  maxS = Math.max(maxS, s);
}
console.log('max slope', maxS.toFixed(1), 'bad', bad.length, bad.slice(0, 12).join(' | '));
for (const z of [395.8, 404, 410, 415]) { const row = []; for (let x = 796; x <= 940; x += 8) row.push(F.G(x, z).toFixed(1)); console.log('z', z, row.join(' ')); }
