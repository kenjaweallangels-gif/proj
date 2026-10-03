import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
await page.goto(`file://${root}/dist/${arg('file', 'cur.html')}?autotest=1&q=low&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
console.log(await page.evaluate(() => { const tr = window.__rakis.approach.trail; return tr.slice(380).filter((_, i) => i % 3 === 0).map((q, i) => `${380 + i * 3}:${q.x.toFixed(1)},${q.y.toFixed(1)},${q.z.toFixed(1)}`).join(' | '); }));
await browser.close();
