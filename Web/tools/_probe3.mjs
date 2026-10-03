import { heightAt as fieldH } from '../src/desert/field.js';
import { buildClawGeometry } from '../src/desert/rock.js';
import { buildWallTable } from '../src/level/wall.js';
import { createGroundField, buildGrid } from '../src/garden/ground.js';
import { createRim } from '../src/garden/rim.js';
const faceX = buildWallTable(() => buildClawGeometry('med'), { z0: 322, z1: 470, yMax: 36 }, 'med', 'east');
const faceAt = (z) => faceX(z, 4);
const field = createGroundField({ desert: fieldH, faceAt });
const grid = buildGrid(field);
const baseG = (x, z) => { const g = grid.sample(x, z); return Number.isFinite(g) ? g : fieldH(x, z); };
const rim = createRim({ base: baseG, faceX, h: 0.8 });
const vol = rim.build();
const { nx, ny, nz, d } = vol;
const lab = new Int32Array(nx * ny * nz);
const comps = [];
const stack = [];
for (let s = 0; s < d.length; s++) {
  if (d[s] >= 0 || lab[s]) continue;
  const id = comps.length + 1; let n = 0, minY = 1e9, sx = 0, sy = 0, sz = 0, touchesBottom = false;
  stack.push(s); lab[s] = id;
  while (stack.length) {
    const c = stack.pop(); n++;
    const i = c % nx, j = ((c / nx) | 0) % ny, k = (c / (nx * ny)) | 0;
    sx += i; sy += j; sz += k; if (j <= 1) touchesBottom = true;
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = i + di, b = j + dj, e = k + dk;
      if (a < 0 || b < 0 || e < 0 || a >= nx || b >= ny || e >= nz) continue;
      const q = a + nx * (b + ny * e);
      if (d[q] < 0 && !lab[q]) { lab[q] = id; stack.push(q); }
    }
  }
  comps.push({ id, n, touchesBottom, c: [(vol.x0 + sx / n * vol.h).toFixed(1), (vol.y0 + sy / n * vol.h).toFixed(1), (vol.z0 + sz / n * vol.h).toFixed(1)] });
}
comps.sort((a, b) => b.n - a.n);
console.log('components', comps.length);
console.log(comps.slice(0, 14).map((c) => `${c.n} cells bottom=${c.touchesBottom} at ${c.c.join(',')}`).join('\n'));
