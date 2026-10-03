import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const file = arg('file', 'cur.html');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
page.on('pageerror', (e) => console.log('ERR', e));
await page.goto(`file://${root}/dist/${file}?autotest=1&q=low&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
const r = await page.evaluate(() => {
  const g = window.__rakis, pl = g.player;
  g.input.axis = () => ({ x: 0, y: 1 });
  g.debug.goto('erg');
  g.simulate(3, 1 / 30);
  const rows = [];
  let lp = pl.renderPos.clone(), lq = pl.position.clone();
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 60; i++) {
    const dt = 0.007 + rnd() * 0.012;
    g.simulate(dt, dt);
    const dxz = Math.hypot(pl.renderPos.x - lp.x, pl.renderPos.z - lp.z) / dt, dy = (pl.renderPos.y - lp.y) / dt;
    const pxz = Math.hypot(pl.position.x - lq.x, pl.position.z - lq.z) / dt;
    rows.push([+(dt * 1000).toFixed(1), +dxz.toFixed(2), +dy.toFixed(2), +pxz.toFixed(2), +pl.speed.toFixed(2), pl.grounded ? 1 : 0]);
    lp.copy(pl.renderPos); lq.copy(pl.position);
  }
  return rows;
});
console.log('dt_ms  rXZ  rY  pXZ  speed grounded'); for (const x of r) console.log(x.join('\t'));
await browser.close();
