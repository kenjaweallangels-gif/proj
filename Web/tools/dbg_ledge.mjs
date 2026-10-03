// Отладка: где игрока не пускают с тропы наружу (стена/кайма/уступ). Для нескольких точек тропы идём «наружу» и смотрим причину остановки.
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
  let fwd = 0; g.input.axis = () => ({ x: 0, y: fwd });
  const tr = g.approach.trail;
  const out = [];
  const V = pl.position.constructor;
  for (let i = 40; i < tr.length; i += 24) {
    const p = tr[i], y = p.y ?? g.heightAt(p.x, p.z);
    // направление наружу: на запад (-x) и перпендикуляр к тропе в обе стороны
    const q = tr[Math.min(tr.length - 1, i + 3)];
    const tx = q.x - p.x, tz = q.z - p.z, tl = Math.hypot(tx, tz) || 1;
    const dirs = { W: [-1, 0], L: [tz / tl, -tx / tl], R: [-tz / tl, tx / tl] };
    const row = { i, x: +p.x.toFixed(1), z: +p.z.toFixed(1), y: +y.toFixed(1) };
    for (const [k, d] of Object.entries(dirs)) {
      pl.teleport(p.x, y, p.z, Math.atan2(d[1], d[0]));
      g.simulate(0.3, 1 / 30);
      fwd = 1; pl.cam.yaw = Math.atan2(d[1], d[0]);
      let air = 0, minY = pl.position.y;
      g.simulate(6, 1 / 30, () => { pl.cam.yaw = Math.atan2(d[1], d[0]); if (!pl.grounded) air += 1 / 30; minY = Math.min(minY, pl.position.y); });
      fwd = 0;
      const moved = Math.hypot(pl.position.x - p.x, pl.position.z - p.z);
      row[k] = `${moved.toFixed(1)}m air${air.toFixed(1)} dy${(minY - y).toFixed(1)}`;
    }
    out.push(row);
  }
  return out;
});
for (const x of r) console.log(JSON.stringify(x));
await browser.close();
