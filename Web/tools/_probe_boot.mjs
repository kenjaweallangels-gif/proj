// Временный пробник загрузки: печатает консоль страницы и прогресс realTime.
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning' || /\[(garden|boot)/.test(t)) console.log(m.type(), t.slice(0, 300)); });
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 400)));
await p.goto(`file://${join(root, 'dist', arg('file', 'garden.html'))}?autotest=1&q=low&lang=RU&drs=0&warm=0`, { timeout: 900000 });
const t0 = Date.now();
for (let i = 0; i < 400; i++) {
  const s = await p.evaluate(() => ({ rt: window.__rakis?.realTime, garden: !!window.__rakis?.garden })).catch((e) => String(e));
  console.log(((Date.now() - t0) / 1000).toFixed(0), JSON.stringify(s));
  if (s && s.rt > 1.5) break;
  await p.waitForTimeout(5000);
}
await b.close();
