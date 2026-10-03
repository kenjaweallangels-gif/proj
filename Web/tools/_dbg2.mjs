import { createField } from '../src/sietch/cave/field.js';
import { EXIT } from '../src/sietch/cave/layout.js';
const f = createField();
let prev = null, maxDev = 0, maxStep = 0, maxSlope = 0, n = 0;
const floorAt = (x, z, ye) => { let lo = ye - 0.9, hi = ye + 0.9; if (f.air(x, hi, z) >= 0) return NaN; if (f.air(x, lo, z) < 0) return -99; for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (f.air(x, m, z) < 0) hi = m; else lo = m; } return (lo + hi) / 2; };
for (let sd = 0; sd < EXIT.length - 0.5; sd += 0.25) {
  let i = 0; while (i < EXIT.cum.length - 2 && EXIT.cum[i + 1] < sd) i++;
  const t = (sd - EXIT.cum[i]) / (EXIT.cum[i + 1] - EXIT.cum[i]);
  const x = EXIT.nodes[i][0] + (EXIT.nodes[i + 1][0] - EXIT.nodes[i][0]) * t, z = EXIT.nodes[i][1] + (EXIT.nodes[i + 1][1] - EXIT.nodes[i][1]) * t;
  const ye = EXIT.floorAt(sd);
  const y = floorAt(x, z, ye);
  if (!Number.isFinite(y) || y === -99) { console.log('нет пола/потолок', sd.toFixed(2), x.toFixed(1), z.toFixed(1), y); continue; }
  maxDev = Math.max(maxDev, Math.abs(y - ye));
  if (prev !== null) { const st = Math.abs(y - prev); maxStep = Math.max(maxStep, st); maxSlope = Math.max(maxSlope, Math.atan2(st, 0.25) * 57.3); if (st > 0.12) { n++; if (n < 15) console.log('шаг', sd.toFixed(2), x.toFixed(1), z.toFixed(1), y.toFixed(3), prev.toFixed(3)); } }
  prev = y;
}
for (let sd = 101.5; sd < 105; sd += 0.25) {
  let i = 0; while (i < EXIT.cum.length - 2 && EXIT.cum[i + 1] < sd) i++;
  const t = (sd - EXIT.cum[i]) / (EXIT.cum[i + 1] - EXIT.cum[i]);
  const x = EXIT.nodes[i][0] + (EXIT.nodes[i + 1][0] - EXIT.nodes[i][0]) * t, z = EXIT.nodes[i][1] + (EXIT.nodes[i + 1][1] - EXIT.nodes[i][1]) * t;
  console.log(sd, i, x.toFixed(2), z.toFixed(2), 'floor', floorAt(x, z, EXIT.floorAt(sd)).toFixed(3), 'exp', EXIT.floorAt(sd).toFixed(3));
}
console.log({ maxDev: maxDev.toFixed(3), maxStep: maxStep.toFixed(3), maxSlopeDeg: maxSlope.toFixed(1), stepsOver012: n });
