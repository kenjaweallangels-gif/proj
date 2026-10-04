// Численная проверка формы наносов (без рендера): высоты, максимальные уклоны (в градусах), асимметрия по ветру, нулевая кромка.
// node tools/harvester_berm_check.mjs
import { bermHeight } from '../src/harvester/berm.js';
const winds = [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -0.7071, z: 0.7071 }];
for (const w of winds) {
  let hmax = 0, smax = 0, smaxLee = 0, edge = 0, area = 0;
  const E = 0.5;
  for (let x = -84; x <= 86; x += 1) for (let z = -52; z <= 52; z += 1) {
    const h = bermHeight(x, z, w);
    hmax = Math.max(hmax, h); area += h;
    if (x === -84 || x === 86 || z === -52 || z === 52) edge = Math.max(edge, h);
    const gx = (bermHeight(x + E, z, w) - bermHeight(x - E, z, w)) / (2 * E), gz = (bermHeight(x, z + E, w) - bermHeight(x, z - E, w)) / (2 * E);
    const s = Math.hypot(gx, gz);
    smax = Math.max(smax, s);
  }
  // профили: по ветру (подветренная сторона) и против
  const prof = (nx, nz) => { const out = []; for (const d of [0, 2, 4, 6, 9, 14, 20]) { const x = nx > 0 ? 58.5 + d : nx < 0 ? -57.5 - d : 0, z = nz > 0 ? 23.6 + d : nz < 0 ? -23.6 - d : 0; out.push(bermHeight(x, z, w).toFixed(2)); } return out.join(' '); };
  console.log(`ветер (${w.x.toFixed(2)}, ${w.z.toFixed(2)}): hmax=${hmax.toFixed(2)} м, макс. уклон=${(Math.atan(smax) * 180 / Math.PI).toFixed(1)}°, край сетки max=${edge.toFixed(3)}, объём≈${area.toFixed(0)} м³`);
  console.log('  нос(+x) 0,2,4,6,9,14,20 м от силуэта:', prof(1, 0), '| корма(-x):', prof(-1, 0), '| +z:', prof(0, 1), '| -z:', prof(0, -1));
}
