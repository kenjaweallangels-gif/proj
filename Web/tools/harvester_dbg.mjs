// Отладка загрузки: печатает консоль страницы и состояние каждые 5 с.
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = '/opt/pw-browsers';
const d = existsSync(base) ? readdirSync(base).find((n) => /^chromium-\d+$/.test(n)) : null;
const b = await chromium.launch({ executablePath: d ? join(base, d, 'chrome-linux', 'chrome') : undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
p.on('console', (m) => !/AudioContext/.test(m.text()) && console.log(m.type(), m.text().slice(0, 700)));
p.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 700)));
const q = process.argv[2] || 'low';
await p.goto(`file://${join(root, 'dist', process.argv[3] || 'harvester.html')}?autotest=1&q=${q}&lang=RU`);
for (let i = 0; i < 12; i++) {
  await p.waitForTimeout(5000);
  console.log(i, JSON.stringify(await p.evaluate(() => ({ g: !!window.__rakis, h: !!(window.__rakis && window.__rakis.harvester), rt: window.__rakis && window.__rakis.realTime, fps: window.__rakis && window.__rakis.stats.fps }))));
}
await b.close();
