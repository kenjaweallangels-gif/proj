// Стоимость червя по стадиям: CPU мс на worm.update (min/медиана по N вызовам — на нагруженной машине min надёжнее) и треугольники кадра.
// node tools/worm_giant_bench.mjs [--file=worm.html --q=med --n=80]. Запускать и на старом, и на новом коде — сравнивать числа.
import { openGame, arg } from './lib/harness.mjs';

const { browser, page, errors } = await openGame({ file: arg('file', 'worm.html'), q: arg('q', 'low'), w: Number(arg('w', 480)), h: Number(arg('h', 270)), at: [270, 180], yaw: -1.9, hideSubs: true });
const N = Number(arg('n', 80));
async function stage(name, setup) {
  await page.evaluate(setup);
  await page.evaluate(() => window.__step(1.0, 1 / 12));
  const r = await page.evaluate(async (N) => {
    const g = window.__rakis, w = g.worm, a = [];
    for (let i = 0; i < N; i++) {
      g.dt = 1 / 30; g.time += 1 / 30;
      const t0 = performance.now(); w.update(1 / 30, g.time); a.push(performance.now() - t0);
    }
    a.sort((x, y) => x - y);
    g.renderer.info.reset(); g.render(1 / 30);
    const info = g.renderer.info.render;
    return { min: a[0], med: a[N >> 1], p90: a[Math.floor(N * 0.9)], tris: info.triangles, calls: info.calls, exposed: w.exposed };
  }, N);
  console.log(name.padEnd(10), `update ms min=${r.min.toFixed(2)} med=${r.med.toFixed(2)} p90=${r.p90.toFixed(2)} | frame tris=${(r.tris / 1000).toFixed(0)}k calls=${r.calls} exposed=${r.exposed}`);
}
await stage('arrive', () => { const g = window.__rakis, w = g.worm; w.playReveal(); g.freecam?.detach?.(); w.debugEncounter({ stage: 'arrive' }); });
await stage('stop', () => { const g = window.__rakis; g.worm.debugEncounter({ stage: 'stop' }); });
await stage('rest', () => { const g = window.__rakis; g.worm.debugEncounter({ stage: 'rest' }); });
// камера у середины тела — худший случай по сетке
await stage('rest-near', () => { const g = window.__rakis, w = g.worm, P = w.spine.P, i = 60, V = g.THREE.Vector3; g.freecam?.place?.(new V(P[i * 3] + 60, g.heightAt(P[i * 3] + 60, P[i * 3 + 2]) + 15, P[i * 3 + 2]), new V(P[i * 3], P[i * 3 + 1] + 10, P[i * 3 + 2])); });
const uniq = [...new Set(errors)];
await browser.close();
if (uniq.length) console.error('КОНСОЛЬ:\n' + uniq.slice(0, 10).join('\n'));
