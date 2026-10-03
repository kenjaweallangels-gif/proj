// Скриншоты меню «Сценарии / Scenarios» и проверка его действий (на заглушках: worm.playDevour, debug.goto).
// node tools/scenarios_shots.mjs [--file=ui.html]   → dist/shots/scenarios/*.png
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const out = join(root, 'dist', 'shots', 'scenarios');
mkdirSync(out, { recursive: true });
const findChromium = () => {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };
for (const lang of ['RU', 'EN']) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`file://${join(root, 'dist', arg('file', 'ui.html'))}?autotest=1&q=low&lang=${lang}`);
  await page.waitForFunction(() => window.__rakis?.ui?.started && window.__rakis.realTime > 1.5, null, { timeout: 120000 });
  await page.evaluate(() => { const g = window.__rakis; g.__calls = []; g.debug.goto = (n) => g.__calls.push(n); g.worm.playDevour = () => { g.__calls.push('devour'); return Promise.resolve(); }; g.harvester = g.harvester || { state: 'running' }; g.ui.openPause(); });
  await page.waitForTimeout(500);
  const labels0 = await page.$$eval('.rk .pause .item .lab', (n) => n.map((x) => x.textContent));
  ok(labels0.some((t) => /Сценарии|Scenarios/.test(t)), `пункт «Сценарии» в паузе: ${labels0.join(' | ')}`);
  if (lang === 'RU') await page.screenshot({ path: join(out, '01_pause.png') });
  // открыть подменю кликом
  await page.evaluate(() => { [...document.querySelectorAll('.rk .pause .item')].find((e) => /Сценарии|Scenarios/.test(e.textContent)).click(); });
  await page.waitForTimeout(500);
  const labels = await page.$$eval('.rk .pause .item .lab', (n) => n.map((x) => x.textContent));
  ok(labels.length >= 9, `подменю: ${labels.join(' | ')}`);
  await page.screenshot({ path: join(out, `02_scenarios_${lang.toLowerCase()}.png`) });
  // Esc/назад → в паузу
  await page.evaluate(() => window.__rakis.ui.resume());
  // «Червь пожирает харвестер»
  await page.evaluate(() => { [...document.querySelectorAll('.rk .pause .item')].find((e) => /харвестер|harvester/i.test(e.textContent)).click(); });
  await page.waitForFunction(() => window.__rakis.__calls.includes('devour'), null, { timeout: 30000 }).then(() => ok(true, 'devour запущен из меню'), () => ok(false, 'devour не запущен'));
  // быстрый переход
  await page.evaluate(() => window.__rakis.ui.openPause());
  await page.waitForTimeout(400);
  await page.evaluate(() => { [...document.querySelectorAll('.rk .pause .item')].find((e) => /Сценарии|Scenarios/.test(e.textContent)).click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { [...document.querySelectorAll('.rk .pause .item')].find((e) => /Тайный сад|Hidden garden/.test(e.textContent)).click(); });
  await page.waitForFunction(() => window.__rakis.__calls.includes('garden'), null, { timeout: 10000 }).then(() => ok(true, 'переход garden вызван'), () => ok(false, 'переход garden не вызван'));
  ok(!(await page.evaluate(() => window.__rakis.paused)), 'меню закрыто после выбора');
  await page.close();
}
await browser.close();
if (errors.length) { console.error(`ОШИБКИ (${errors.length}):\n` + [...new Set(errors)].slice(0, 10).join('\n')); fails++; }
console.log(fails ? `FAILED: ${fails}` : 'OK: меню сценариев');
process.exit(fails ? 1 : 0);
