// Отладка: загрузить char.html и вывести консоль/ошибки. node tools/char_dbg.mjs [мс ожидания]
import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = '/opt/pw-browsers'; const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
const b = await chromium.launch({ executablePath: join(base, d, 'chrome-linux', 'chrome'), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 400, height: 400 } });
p.on('console', (m) => { if (!/AudioContext/.test(m.text())) console.log(m.type(), m.text().slice(0, 900)); });
p.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 900)));
await p.goto('file://' + join(root, 'dist', 'char.html') + '?autotest=1&q=high&lang=RU&skip=1');
await p.waitForTimeout(Number(process.argv[2] || 40000));
console.log(await p.evaluate(() => (window.__rakis ? window.__rakis.realTime : 'none')));
await b.close();
