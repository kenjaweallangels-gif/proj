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
  // симулятор участка КМ-2 (galley.html): вступление, свободный режим, переход с голограммами, близорукость
  ['galley_intro', 'galley.html'],
  ['galley_free', 'galley.html?intro=0'],
  ['galley_step_090', 'galley.html?step=090.02'],
  ['galley_myopia', 'galley.html?intro=0&vision=myopia'],
  ['tablet', 'tablet.html'],
  // профили очков и имитация сборки: Aura 70° 6DoF с автоимитацией, One Pro 3DoF, Air 2 Pro 46° на переходе с голограммами
  ['galley_auto_aura', 'galley.html?intro=0&auto=1&glasses=aura'],
  ['galley_onepro_3dof', 'galley.html?intro=0&glasses=onepro'],
  ['galley_air2pro_090', 'galley.html?step=090.02&glasses=air2pro'],
  ['galley_free_corner', 'galley.html?step=070.01&auto=1&autocam=free'],
  // поле зрения: центр 72° (перспектива) и один глаз
  ['galley_narrow_072', 'galley.html?step=090.02&field=0'],
  ['galley_mono_right', 'galley.html?intro=0&vision=monoR'],
  // выбор режима на старте: ручной — стоит у входа, управление с первого шага
  ['galley_manual', 'galley.html#manual'],
  // виртуальная сборка без деталей (плеер)
  ['galley_virtual', 'galley.html?intro=0&asm=1&field=0'],
  ['galley_station_em1', 'galley.html?intro=0&place=em1&field=0'],
  ['galley_station_sl1_virtual', 'galley.html?intro=0&place=sl1&asm=1&field=0'],
  ['galley_station_me1_tp', 'galley.html?intro=0&place=me1&tp=1'],
  ['galley_clean', 'galley.html?intro=0&view=clean&glasses=aura'],
  ['galley_direct', 'galley.html?intro=0&view=direct&glasses=lumaultra'],
  ['galley_system_full', 'galley.html?intro=0&sys=cat&glasses=aura&field=0'],
  ['galley_sim_em1', 'galley.html?intro=0&place=em1&auto=1&field=0'],
  ['galley_third_person', 'galley.html?intro=0&tp=1&glasses=aura'],
  // обучающая сборка: цветная учебная модель, уроки с советами и предупреждениями
  ['galley_training', 'galley.html?intro=0&train=1&field=0&tts=0'],
  // режим ПО очков: штатно (очки как экран) и своё ПО на SDK для закупаемого комплекта XREAL One Pro + Eye
  ['galley_sw_stock', 'galley.html?step=090.02&field=0&sw=stock'],
  // стенд очков: тестовые картинки на экране очков (2D и стерео SBS)
  ['lab_field', 'lab.html?p=field&glasses=lumaultra'],
  ['galley_sw_sdk_oneproeye', 'galley.html?step=090.02&field=0&glasses=oneproeye&sw=sdk'],
];
let failed = 0;
const only = process.env.SMOKE_ONLY?.split(',');            // SMOKE_ONLY=galley_manual,tablet — только эти сценарии
for (const [name, qs] of cases.filter(([n]) => !only || only.includes(n))) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  // шрифты Google в закрытой сети цеха не грузятся — это не ошибка демо (есть системный запасной шрифт)
  const external = (u) => /fonts\.(googleapis|gstatic)\.com/.test(u || '');
  page.on('console', (m) => { if (m.type() === 'error' && !external(m.location()?.url)) errors.push(`${m.text()} ${m.location()?.url ?? ''}`); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/${qs}`, { timeout: 120000 });   // без GPU полное поле грузится долго
  await page.waitForFunction(() => window.__demo && 'ready' in window.__demo, null, { timeout: 180000 });
  await page.waitForTimeout(2500);
  const st = await page.evaluate(() => ({ ready: window.__demo.ready, step: window.__demo.player?.index ?? window.__demo.run?.index, err: window.__demo.error }));
  await page.screenshot({ path: `test-results/${name}.png`, timeout: 120000 });
  const ok = st.ready && !errors.length;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} шаг=${(st.step ?? -1) + 1} ${st.err ?? ''} ${errors.slice(0, 3).join(' | ')}`);
  await page.close();
}
await browser.close();
stop();
process.exit(failed ? 1 : 0);
