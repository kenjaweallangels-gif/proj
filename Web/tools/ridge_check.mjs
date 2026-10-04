// Проверка хребта: зазоры до игровых зон и статистика (node tools/ridge_check.mjs).
// Требование: основание хребта (SDF) и зона влияния на землю (RIDGE_REACH) не заходят в защищённые области.
import { ridgeQuery, MASSIFS, RIDGE_REACH, RIDGE_NSEG, apronWeight } from '../src/core/ridge.js';
import { GOLDEN_PATH, GARDEN, WORM_SPAWN, WORM_REVEAL, ENTRY, SIETCH_ORIGIN, START } from '../src/core/layout.js';
import { FLAT_ZONE, solidSdf } from '../src/desert/field.js';

const zones = [];
const add = (name, x, z, r = 0) => zones.push({ name, x, z, r });
GOLDEN_PATH.forEach((p) => add('path ' + p.id, p.x, p.z, 40));
for (let i = 0; i < GOLDEN_PATH.length - 1; i++) {
  const a = GOLDEN_PATH[i], b = GOLDEN_PATH[i + 1];
  for (let k = 1; k < 6; k++) add('path seg', a.x + (b.x - a.x) * k / 6, a.z + (b.z - a.z) * k / 6, 40);
}
add('start', START.x, START.z, 60);
add('harvester flat', FLAT_ZONE.x, FLAT_ZONE.z, FLAT_ZONE.radius + FLAT_ZONE.blend);
add('worm reveal', WORM_REVEAL.x, WORM_REVEAL.z, 80);
add('worm spawn', WORM_SPAWN.x, WORM_SPAWN.z, 80);
add('trail start', ENTRY.trailStart.x, ENTRY.trailStart.z, 40);
add('cleft', ENTRY.cleft.x, ENTRY.cleft.z, 40);
add('sietch origin', SIETCH_ORIGIN.x, SIETCH_ORIGIN.z, 40);
add('garden mouth', GARDEN.portal.x, GARDEN.portal.z, 20);

let ok = true;
// сад: котловина r ≤ 100 не должна касаться основания хребта (стена вокруг — снаружи), тропа/расщелина Когтя — без влияния хребта вовсе
for (let k = 0; k < 72; k++) for (const r of [0, 60, 100]) {
  const d = ridgeQuery(GARDEN.center.x + r * Math.cos(k * Math.PI / 36), GARDEN.center.z + r * Math.sin(k * Math.PI / 36));
  if (d < 8) { ok = false; console.log(`FAIL garden r=${r} ang=${k * 5}: ridge d=${d.toFixed(1)}`); }
}
let ringMin = 1e9;
for (let k = 0; k < 72; k++) ringMin = Math.min(ringMin, ridgeQuery(GARDEN.center.x + 100 * Math.cos(k * Math.PI / 36), GARDEN.center.z + 100 * Math.sin(k * Math.PI / 36)));
console.log('garden: min d(хребет) на r=100 =', ringMin.toFixed(1));
// зона тропы/расщелины/сиетча (x 560..720, z 200..350): хребет не влияет (heightAt не меняется)
for (let x = 560; x <= 720; x += 8) for (let z = 200; z <= 350; z += 8) if (ridgeQuery(x, z) < RIDGE_REACH && apronWeight(x, z) > 0) { ok = false; console.log(`FAIL trail zone ${x},${z} d=${ridgeQuery(x, z).toFixed(1)}`); }
for (const z of zones) {
  // зона не должна попасть под влияние хребта: d - r >= RIDGE_REACH (проверяем центр и 8 точек по окружности)
  let dmin = ridgeQuery(z.x, z.z);
  for (let k = 0; k < 8; k++) dmin = Math.min(dmin, ridgeQuery(z.x + z.r * Math.cos(k * Math.PI / 4), z.z + z.r * Math.sin(k * Math.PI / 4)));
  let aw = 0;
  for (let k = 0; k < 8; k++) aw = Math.max(aw, apronWeight(z.x + z.r * Math.cos(k * Math.PI / 4), z.z + z.r * Math.sin(k * Math.PI / 4)));
  aw = Math.max(aw, apronWeight(z.x, z.z));
  if (dmin < RIDGE_REACH && aw > 0.001) { ok = false; console.log(`FAIL ${z.name} (${z.x.toFixed(0)},${z.z.toFixed(0)}) r=${z.r}: ridge d=${dmin.toFixed(1)} < ${RIDGE_REACH}`); }
}
// ближайший зазор от основания хребта до Когтя и между массивами (проходимость)
let cl = 1e9;
for (let z = 20; z <= 520; z += 5) for (let x = 560; x <= 900; x += 5) { if (solidSdf(x, z) < 0 && ridgeQuery(x, z) < 0) cl = Math.min(cl, 0); }
console.log('claw/ridge overlap:', cl === 0 ? 'YES (check)' : 'no');
let total = 0, hmin = 1e9, hmax = 0;
for (const m of MASSIFS) {
  total += m.len; for (let i = 0; i <= m.n; i++) { if (m.sh[i] > 60) hmin = Math.min(hmin, m.sh[i]); hmax = Math.max(hmax, m.sh[i]); }
  console.log(`${m.id}: длина ${m.len.toFixed(0)} м, станций ${m.n + 1}, Hmax ${Math.max(...m.sh).toFixed(0)}, wmax ${Math.max(...m.sw).toFixed(0)}`);
}
console.log(`всего осей ${total.toFixed(0)} м (+ Коготь 460 м), сегментов ${RIDGE_NSEG}, H ${hmin.toFixed(0)}..${hmax.toFixed(0)} м`);
console.log(ok ? 'PASS clearance' : 'FAIL clearance');
process.exit(ok ? 0 : 1);
