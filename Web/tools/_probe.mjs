import { heightAt as fieldH } from '../src/desert/field.js';
import { buildClawGeometry } from '../src/desert/rock.js';
import { buildWallTable } from '../src/level/wall.js';
import { createGroundField, buildGrid } from '../src/garden/ground.js';
const faceX = buildWallTable(() => buildClawGeometry('med'), { z0: 322, z1: 470, yMax: 36 }, 'med', 'east');
const faceAt = (z) => faceX(z, 4);
const field = createGroundField({ desert: fieldH, faceAt });
const grid = buildGrid(field);
const [cx, cz] = process.argv.slice(2).map(Number);
for (let z = cz - 8; z <= cz + 8; z += 2) {
  const row = [];
  for (let x = cx - 12; x <= cx + 12; x += 2) row.push(((grid.sample(x, z) ?? NaN)).toFixed(1).padStart(5));
  console.log(String(z).padStart(4), row.join(''));
}
console.log('desert');
for (let z = cz - 8; z <= cz + 8; z += 2) {
  const row = [];
  for (let x = cx - 12; x <= cx + 12; x += 2) row.push(fieldH(x, z).toFixed(1).padStart(5));
  console.log(String(z).padStart(4), row.join(''));
}
