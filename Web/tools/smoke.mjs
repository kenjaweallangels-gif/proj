// Автотест: открывает dist/rakis_demo.html в headless Chromium, проверяет отсутствие ошибок,
// прогоняет ключевые точки демо и снимает скриншоты в dist/shots/.
// node tools/smoke.mjs [--q=low] [--shots=start,P4,worm,sietch,hall]
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const q = arg('q', 'low');
const shots = arg('shots', 'start').split(',');
const outDir = join(root, 'dist', 'shots', arg('tag', 'main'));
mkdirSync(outDir, { recursive: true });

function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const file = arg('file', 'rakis_demo.html');
const url = `file://${join(root, 'dist', file)}?autotest=1&q=${q}&lang=RU`;
await page.goto(url);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.5, null, { timeout: 300000, polling: 1000 });
for (const s of shots) {
  await page.evaluate((s) => window.__rakis.debug?.goto?.(s), s);
  await page.waitForTimeout(Number(arg('wait', 2500)));
  await page.screenshot({ path: join(outDir, `${s}.png`) });
  const info = await page.evaluate(() => ({ fps: window.__rakis.stats.fps, zone: window.__rakis.zone, space: window.__rakis.space, worm: window.__rakis.worm?.state }));
  console.log(s, JSON.stringify(info));
}
await browser.close();
if (errors.length) { console.error(`ОШИБКИ (${errors.length}):\n` + [...new Set(errors)].slice(0, 30).join('\n')); process.exit(1); }
console.log('OK: без ошибок');
