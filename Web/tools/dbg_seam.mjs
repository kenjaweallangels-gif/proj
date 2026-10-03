// Отладка шва «щель ↔ сиетч»: из конца тропы идём к воздушному шлюзу реальной физикой игрока (без BFS).
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
  let fwd = 1; g.input.axis = () => ({ x: 0, y: fwd });
  const out = [];
  const tr = g.approach.trail, end = tr[tr.length - 1];
  const tryWalk = (label, sx, sy, sz, tx, tz, sec = 8) => {
    pl.teleport(sx, sy, sz, Math.atan2(tz - sz, tx - sx)); g.simulate(0.3, 1 / 30);
    const log = [];
    g.simulate(sec, 1 / 30, (_, i) => {
      pl.cam.yaw = Math.atan2(tz - pl.position.z, tx - pl.position.x);
      if (i % 15 === 0) log.push(`${pl.position.x.toFixed(1)},${pl.position.y.toFixed(1)},${pl.position.z.toFixed(1)}${g.space[0]}`);
    });
    out.push(label + ': ' + log.join(' '));
  };
  const wp = g.sietch.toWorld(14, 0, 0, new g.THREE.Vector3());
  tryWalk('end→airlock direct', end.x, end.y, end.z, wp.x, wp.z);
  tryWalk('(646,251.2)→(652,250.6)', 646, 30.1, 251.2, 652, 250.6);
  tryWalk('(646.5,250.6)→(652,250.6)', 646.5, 30.1, 250.6, 652, 250.6);
  tryWalk('airlock spawn→end', 657.2, 30, 252.1, end.x, end.z);
  tryWalk('(651,250.5)→(646,251.5)', 651, 30, 250.5, 646, 251.5);
  return out;
});
for (const x of r) console.log(x);
await browser.close();
