// Отладочный снимок: --at=x,y,z --yaw=rad [--file=cur.html] [--out=path.png] [--shake]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const file = arg('file', 'cur.html');
const at = arg('at', '618,9,306').split(',').map(Number);
const yaw = +arg('yaw', '0');
const out = arg('out', `${root}/dist/shots/dbg.png`);
mkdirSync(`${root}/dist/shots`, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('ERR', e));
await page.goto(`file://${root}/dist/${file}?autotest=1&q=${arg("q","low")}&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
await page.evaluate(([at, yaw]) => {
  const g = window.__rakis; g.player.teleport(at[0], at[1], at[2], yaw); g.simulate(1, 1 / 30);
  if (g.ui?.el) for (const k of ['subs', 'lore', 'tcard', 'hintEl']) if (g.ui.el[k]) g.ui.el[k].style.visibility = 'hidden';
}, [at, yaw]);
await page.waitForTimeout(6000);
await page.screenshot({ path: out, timeout: 400000 });
console.log('saved', out);
await browser.close();
