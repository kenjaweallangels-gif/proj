// Замер µs/вызов heightAt и solidSdf (node tools/ridge_bench.mjs). Наборы: эрг у старта, Коготь, гряда север/юг, далёкая пустыня.
import { heightAt, solidSdf } from '../src/desert/field.js';
const R = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
function bench(name, pts, fn) {
  for (let i = 0; i < 2000; i++) fn(pts[i % pts.length][0], pts[i % pts.length][1]);
  let acc = 0, us = 1e9;
  const N = 20000;
  for (let rep = 0; rep < 7; rep++) {   // лучший из 7 прогонов (машина общая, шум)
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) acc += fn(pts[i % pts.length][0], pts[i % pts.length][1]);
    us = Math.min(us, Number(process.hrtime.bigint() - t0) / 1e3 / N);
  }
  console.log(`${name}: ${us.toFixed(2)} us`, acc === 12345.678 ? '' : '');
}
const r = R(42);
const sets = {
  erg: Array.from({ length: 4000 }, () => [r() * 500, r() * 300 - 100]),
  claw: Array.from({ length: 4000 }, () => [560 + r() * 300, -50 + r() * 600]),
  ridgeN: Array.from({ length: 4000 }, () => [600 + r() * 400, -1300 + r() * 1300]),
  ridgeS: Array.from({ length: 4000 }, () => [450 + r() * 600, 500 + r() * 1200]),
  far: Array.from({ length: 4000 }, () => [-1000 + r() * 400, 500 + r() * 800]),
};
for (const [k, v] of Object.entries(sets)) {
  bench('heightAt ' + k, v, (x, z) => heightAt(x, z));
  bench('solidSdf ' + k, v, (x, z) => solidSdf(x, z));
}
