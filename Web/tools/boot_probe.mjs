// Проба загрузки: открывает dist/<file>, печатает консоль и прогресс загрузки (для диагностики зависаний/ошибок при старте).
// node tools/boot_probe.mjs [--file=worm.html --q=low --sec=240]
import { chromium } from 'playwright';
import { join } from 'node:path';
import { findChromium, GL, root, arg } from './lib/harness.mjs';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: Number(arg('w', 640)), height: Number(arg('h', 360)) } });
page.on('console', (m) => { if (!/AudioContext/.test(m.text())) console.log(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
await page.goto(`file://${join(root, 'dist', arg('file', 'worm.html'))}?autotest=1&q=${arg('q', 'low')}&lang=RU`);
const t0 = Date.now(), sec = Number(arg('sec', 240));
while (Date.now() - t0 < sec * 1000) {
  const s = await page.evaluate(() => ({ rt: window.__rakis?.realTime ?? -1, load: document.getElementById('loading')?.textContent ?? 'done' })).catch(() => null);
  console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(s));
  if (s && s.rt > 1.5) break;
  await page.waitForTimeout(5000);
}
await browser.close();
