// Профиль сборки комнат интерьера (без браузера): время на комнату, число вершин. node tools/harvester_int_prof.mjs
import { Plan } from '../src/harvester/ibuild.js';
import { Parts } from '../src/harvester/parts.js';
import { engineRoom, corridor, dorm, stills, mess, lab, gallery, feedHall } from '../src/harvester/rooms_a.js';
import { hall, passage, chart, bridge } from '../src/harvester/rooms_b.js';
const plan = new Plan(), glow = new Parts(4);
let total = 0;
for (const f of [gallery, corridor, feedHall, hall, chart, bridge, passage, mess, dorm, stills, lab, engineRoom]) {
  const t0 = performance.now();
  const R = f(plan, glow);
  const t1 = performance.now();
  const g = R.P.merge();
  const t2 = performance.now();
  total += t2 - t0;
  console.log(R.id.padEnd(10), 'build', (t1 - t0).toFixed(0).padStart(4), 'ms  merge', (t2 - t1).toFixed(0).padStart(4), 'ms  verts', g.attributes.position.count);
}
console.log('total', total.toFixed(0), 'ms');
