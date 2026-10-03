// Проверка: блокирует ли валун-коллайдер тропу и в старой сборке (perf_baseline.html).
import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const file = arg('file', 'perf_baseline.html');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('ERR', e));
await page.goto(`file://${root}/dist/${file}?autotest=1&q=low&lang=RU&drs=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
const r = await page.evaluate(() => {
  const g = window.__rakis, V = g.THREE.Vector3;
  const OWN = { ignore: new Set(['player', 'companion:Ilva', 'companion:Rayn', 'companion:Ossana']) };
  const out = [];
  for (const x of [616, 617, 618, 618.5, 619, 620, 621, 622]) {
    const p = new V(x, g.heightAt(x, 306.1, 9), 306.1); const o = p.clone();
    const hit = g.collide(p, 0.35, OWN);
    out.push([x, +o.y.toFixed(2), hit, +(p.x - o.x).toFixed(2), +(p.z - o.z).toFixed(2)]);
  }
  const near = g.colliders.near(new V(620, 9, 306), 8).filter((e) => e.owner !== 'player').map((e) => ({ owner: e.owner, c: e.c?.toArray().map((v) => +v.toFixed(1)), r: +e.r?.toFixed(2) }));
  return { out, near };
});
console.log(JSON.stringify(r.near));
for (const x of r.out) console.log(x.join('\t'));
await browser.close();
