// Дымовой тест демо в настоящем браузере: собирает, поднимает vite preview, открывает операции 040 и 070
// в режимах «оба вида» и «глазами», ждёт готовности, делает снимки в test-results/ и падает на ошибках консоли.
//   npm run build && npm run smoke
// Браузер: npx playwright install chromium  (или CHROMIUM_PATH=/путь/к/chrome npm run smoke)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4179;
// vite запускаем напрямую через node (не через npx), чтобы kill() гарантированно останавливал сервер
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const stop = () => { if (server.exitCode === null) server.kill(); };
process.on('exit', stop);
await new Promise((ok, fail) => {
  const t = setTimeout(() => { stop(); fail(new Error(`vite preview не стартовал (порт ${PORT} занят?)`)); }, 20000);
  server.stdout.on('data', (d) => { if (String(d).includes(String(PORT))) { clearTimeout(t); ok(); } });
  server.stderr.on('data', (d) => process.stderr.write(d));
});
mkdirSync('test-results', { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const cases = [
  ['op040_split_step4', '?op=040&view=split&step=4'],
  ['op070_split_step3', '?op=070&view=split&step=3'],
  ['op070_eye_step4', '?op=070&view=eye&step=4&panel=1'],
  ['op040_side_step2', '?op=040&view=side&step=2'],
];
let failed = 0;
for (const [name, qs] of cases) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  // шрифты Google в закрытой сети цеха не грузятся — это не ошибка демо (есть системный запасной шрифт)
  const external = (u) => /fonts\.(googleapis|gstatic)\.com/.test(u || '');
  page.on('console', (m) => { if (m.type() === 'error' && !external(m.location()?.url)) errors.push(`${m.text()} ${m.location()?.url ?? ''}`); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/${qs}`);
  await page.waitForFunction(() => window.__demo && 'ready' in window.__demo, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => ({ ready: window.__demo.ready, step: window.__demo.player?.index, err: window.__demo.error }));
  await page.screenshot({ path: `test-results/${name}.png` });
  const ok = st.ready && !errors.length;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} шаг=${(st.step ?? -1) + 1} ${st.err ?? ''} ${errors.slice(0, 3).join(' | ')}`);
  await page.close();
}
await browser.close();
stop();
process.exit(failed ? 1 : 0);
