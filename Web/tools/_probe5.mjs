import { heightAt as fieldH } from '../src/desert/field.js';
import { buildClawGeometry } from '../src/desert/rock.js';
import { buildWallTable } from '../src/level/wall.js';
import { createGroundField, buildGrid } from '../src/garden/ground.js';
import { createRim } from '../src/garden/rim.js';
import { ringIn, ang, radius } from '../src/garden/layout.js';
const faceX = buildWallTable(() => buildClawGeometry('med'), { z0: 322, z1: 470, yMax: 36 }, 'med', 'east');
const faceAt = (z) => faceX(z, 4);
const field = createGroundField({ desert: fieldH, faceAt });
const grid = buildGrid(field);
const baseG = (x, z) => { const g = grid.sample(x, z); return Number.isFinite(g) ? g : fieldH(x, z); };
const rim = createRim({ base: baseG, faceX, h: 0.8 });
const vol = rim.build();
for (const [x, z] of [[814.4, 418.9], [855.1, 345.2], [860.5, 349.5], [863, 443.3], [890.9, 385.8], [830, 400], [850, 420]]) {
  const g = grid.sample(x, z); const m = vol.surfaceY(x, z, g + 0.3);
  const th = ang(x, z);
  console.log(x, z, 'g', g.toFixed(2), 'm', m.toFixed(2), 'diff', (m - g).toFixed(2), 'r', radius(x, z).toFixed(1), 'ringIn', ringIn(th).toFixed(1), 'cover', grid.coverAt(x, z).toFixed(2), 'bump', field.bump(x, z).toFixed(2));
}
