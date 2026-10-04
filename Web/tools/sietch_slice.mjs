// ASCII-срез SDF пещеры: node tools/sietch_slice.mjs --y=1 --x=96,152 --z=-16,14 [--step=0.5]  (план)  |  --z0=31.4 --x=.. --y=.. (разрез по z)
import { createField } from '../src/sietch/cave/field.js';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const f = createField();
const step = Number(arg('step', 0.5));
const rng = (s) => s.split(',').map(Number);
const ch = (v) => (v > 0.3 ? '#' : v > 0 ? '+' : v > -0.5 ? '.' : ' ');
if (arg('y', '') !== '') {
  const y = Number(arg('y')), [x0, x1] = rng(arg('x', '96,152')), [z0, z1] = rng(arg('z', '-16,14'));
  console.log(`план y=${y}  x ${x0}..${x1}  z ${z0}..${z1}  (шаг ${step})`);
  for (let z = z0; z <= z1; z += step) { let r = String(z.toFixed(1)).padStart(6) + ' '; for (let x = x0; x <= x1; x += step) r += ch(f.air(x, y, z)); console.log(r); }
} else {
  const z = Number(arg('zs', 0)), [x0, x1] = rng(arg('x', '96,152')), [y0, y1] = rng(arg('ys', '-12,6'));
  console.log(`разрез z=${z}  x ${x0}..${x1}  y ${y0}..${y1}`);
  for (let y = y1; y >= y0; y -= step) { let r = String(y.toFixed(1)).padStart(6) + ' '; for (let x = x0; x <= x1; x += step) r += ch(f.air(x, y, z)); console.log(r); }
}
