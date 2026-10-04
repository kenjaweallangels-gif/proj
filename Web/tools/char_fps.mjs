// Быстрый замер fps/время в headless: node tools/char_fps.mjs [--w=480 --h=270]
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
function findChromium() { const base = '/opt/pw-browsers'; if (!existsSync(base)) return undefined; const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n)); return d ? join(base, d, 'chrome-linux', 'chrome') : undefined; }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(arg('w', 480)), height: Number(arg('h', 270)) } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'char.html'))}?autotest=1&q=low&lang=RU&skip=1`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.5, null, { timeout: 120000 });
for (let i = 0; i < 4; i++) {
  const a = await page.evaluate(() => ({ t: window.__rakis.time, r: window.__rakis.realTime, f: window.__rakis.stats.fps }));
  await page.waitForTimeout(3000);
  const b = await page.evaluate(() => ({ t: window.__rakis.time, r: window.__rakis.realTime, f: window.__rakis.stats.fps }));
  console.log(`game dt/real dt = ${((b.t - a.t) / (b.r - a.r)).toFixed(2)} fps=${b.f}`);
}
await browser.close();
