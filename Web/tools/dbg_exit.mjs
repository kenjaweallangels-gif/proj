// Отладка: путь из воздушного шлюза сиетча наружу (почему бот застревает).
import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const file = arg('file', 'cur.html');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('ERR', e));
await page.goto(`file://${root}/dist/${file}?autotest=1&q=low&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
const r = await page.evaluate(async () => {
  const g = window.__rakis, pl = g.player, V = g.THREE.Vector3;
  await g.debug.goto('sietch');
  g.simulate(0.5, 1 / 30);
  const rows = [];
  const w = new V(), l = new V();
  for (let lz = -2; lz <= 10; lz += 1) {
    let line = `lz=${String(lz).padStart(3)} `;
    for (let lx = -6; lx <= 12; lx += 1) {
      g.sietch.toWorld(lx, 0, lz, w);
      const p = new V(w.x, 30, w.z);
      const inside = g.sietch.contains(p);
      const hit = g.sietch.collide(p.clone(), 0.35) ;
      const gy = g.sietch.heightAt(w.x, w.z, 30);
      line += inside ? (hit ? 'x' : '.') : (hit ? 'X' : ' ');
    }
    rows.push(line);
  }
  // положение игрока и выходных точек
  return { rows, spawn: pl.position.toArray(), cl: g.sietch.toWorld(-2.2, 0, 7.2, new V()).toArray(), trailEnd: g.approach.trail[g.approach.trail.length - 1].toArray(), local0: g.sietch.toWorld(0, 0, 0, new V()).toArray(), local1: g.sietch.toWorld(1, 0, 0, new V()).toArray(), localz1: g.sietch.toWorld(0, 0, 1, new V()).toArray() };
});
console.log('legend: . inside free, x inside blocked, X outside blocked, space outside free; columns lx=-6..12, rows lz=-2..10');
for (const x of r.rows) console.log(x);
console.log(JSON.stringify({ spawn: r.spawn, cl: r.cl, trailEnd: r.trailEnd, local0: r.local0, local1: r.local1, localz1: r.localz1 }));
await browser.close();
