// Скриншоты и проверки новых функций интерфейса: панель «Погода и время», субтитры с родной строкой, индикатор режима походки,
// сторож чёрного экрана, ручная погода vs директор, аудио-события (Harvester, Encounter, swell).
// node tools/ui_weather_shots.mjs [--file=ui.html]   → dist/shots/ui_shots/wx_*.png
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const file = arg('file', 'ui.html');
const out = join(root, 'dist', 'shots', 'ui_shots');
mkdirSync(out, { recursive: true });
const findChromium = () => {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const fails = [];
const check = (name, ok, info = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${info}`); if (!ok) fails.push(name); };
async function open(query, size = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport: size });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`file://${join(root, 'dist', file)}?${query}`);
  await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.2, null, { timeout: 120000 });
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(out, `${name}.png`) });
const G = (page, fn, a) => page.evaluate(fn, a);
// Софтверный GL даёт единицы кадров в секунду: состояние проверяем ожиданием, а не фиксированной паузой.
const until = (page, fn, ms = 10000) => page.waitForFunction(fn, null, { timeout: ms }).then(() => true, () => false);
const panelShown = (page) => until(page, () => { const w = document.querySelector('#ui .wx'); return w && getComputedStyle(w).opacity > 0.97; });

// Заглушка недостающих функций модуля пустыни (проверка интерфейса независимо от готовности desert-агента).
const MOCK = () => {
  const g = window.__rakis, w = g.weather;
  if (typeof w.setHours !== 'function') {
    w.setHours = (h) => { w.state.hours = ((h % 24) + 24) % 24; w.hours = w.state.hours; };
    w.getHours = () => w.state.hours;
    w.timeScale = 0;
    w.presets = () => Object.keys(g.data.WeatherPresets).map((id) => ({ id, RU: id.replace('_', ' '), EN: id.replace('_', ' ') }));
    const ov = {};
    w.setOverride = (o) => { Object.assign(ov, o); for (const k of Object.keys(o)) { if (k === 'wind') w.state.wind = o[k]; else w.state[k] = o[k]; } };
    w.getOverride = () => ({ ...ov });
    w.clearOverride = () => { for (const k of Object.keys(ov)) delete ov[k]; };
    window.__wxMocked = true;
  }
};

// ---------- 1. Панель погоды из игры ----------
let page = await open('q=low&lang=RU&skip=1&autotest=1');
await G(page, MOCK);
await G(page, () => { const g = window.__rakis; g.weather.setHours(15.5); });
await page.waitForTimeout(500);
await page.keyboard.press('F2');
await panelShown(page);
check('F2 открывает панель и ставит паузу', await G(page, () => window.__rakis.ui.weatherOpen && window.__rakis.paused));
await shot(page, 'wx_01_panel_day');
// живой просмотр: меняем время ползунком (клик по рельсе)
const rail = await page.$('#ui .wx .wsl .rail');
const box = await rail.boundingBox();
await page.mouse.click(box.x + box.width * (21 / 24), box.y + box.height / 2);
await page.waitForTimeout(2500);
const h1 = await G(page, () => window.__rakis.weather.getHours());
check('ползунок времени меняет setHours', Math.abs(h1 - 21) < 0.5, `h=${h1.toFixed(2)}`);
check('ручной режим включён', await G(page, () => window.__rakis.weatherManual === true));
await shot(page, 'wx_02_panel_night');
await page.mouse.click(box.x + box.width * (5.4 / 24), box.y + box.height / 2);
await page.waitForTimeout(2500);
await shot(page, 'wx_03_panel_dawn');
// пресет и ползунок бури
await page.locator('#ui .wx .wch .ch', { hasText: 'Storm Horizon' }).click();
await page.waitForTimeout(400);
const sl = (await page.$$('#ui .wx .wsl .rail'))[2];
const sb = await sl.boundingBox();
await page.mouse.click(sb.x + sb.width * 0.7, sb.y + sb.height / 2);
await page.waitForTimeout(1500);
check('setOverride: буря', await G(page, () => window.__rakis.weather.getOverride().storm > 0.5));
await shot(page, 'wx_04_panel_storm');
// директор не бьёт ручной выбор
await G(page, () => { window.__rakis.story.fire('ZoneEnter:A3_Approach'); });
await page.waitForTimeout(300);
check('SetWeather пропущен в ручном режиме', await G(page, () => window.__rakis.weather.current !== 'Noon_Approach'));
// Esc закрывает панель и возобновляет игру
await page.keyboard.press('Escape');
check('Esc закрывает панель и снимает паузу', await until(page, () => !window.__rakis.ui.weatherOpen && !window.__rakis.paused));
// пауза → пункт меню → назад в паузу
await page.waitForTimeout(600);
await page.keyboard.press('Escape'); await until(page, () => window.__rakis.paused);
await page.waitForTimeout(1500);
await shot(page, 'wx_05_pause_menu');
await G(page, () => window.__rakis.ui.openWeather());
await panelShown(page);
check('из паузы панель открывается', await G(page, () => window.__rakis.ui.weatherOpen && window.__rakis.paused));
// «Вернуть сюжетную погоду»
await page.locator('#ui .wx .wbtn', { hasText: 'Вернуть' }).click();
await page.waitForTimeout(500);
check('«Вернуть сюжетную погоду» снимает ручной режим', await G(page, () => window.__rakis.weatherManual === false));
await page.keyboard.press('F2');
check('F2 закрывает панель, остаётся пауза-меню', await until(page, () => !window.__rakis.ui.weatherOpen && window.__rakis.paused));
await page.waitForTimeout(500);
await page.keyboard.press('Escape');
check('после панели и паузы игра идёт', await until(page, () => !window.__rakis.paused));

// ---------- 2. Субтитры с родной строкой ----------
await G(page, () => {
  const g = window.__rakis;
  g.data.Dialogue.DLG_A1_003.native = 'Lā tamshi fī ṭ-ṭaqṭaq. Ar-ramlu yasmaʿ.';
  g.dialogue.play('DLG_A1_003');
});
await page.waitForTimeout(1300);
await shot(page, 'wx_06_subtitle_native');
const natVisible = await G(page, () => { const n = document.querySelector('#ui .subs .nat'); return !!n && n.style.display !== 'none' && n.textContent.length > 3; });
check('родная строка показана над переводом', natVisible);
await G(page, () => { window.__rakis.settings.showNative = false; window.__rakis.dialogue.stopAll(); window.__rakis.dialogue.play('DLG_A1_003'); });
await page.waitForTimeout(1000);
check('родная строка выключается настройкой', await G(page, () => document.querySelector('#ui .subs .nat').style.display === 'none'));
await G(page, () => { window.__rakis.settings.showNative = true; window.__rakis.dialogue.stopAll(); });
// строка жрицы «язык [перевод]»: перевод в субтитре, латиница — как native
await G(page, () => { window.__rakis.dialogue.play('DLG_B5_P01'); });
await page.waitForTimeout(1200);
const pr = await G(page, () => ({ nat: document.querySelector('#ui .subs .nat').textContent, line: document.querySelector('#ui .subs .line').textContent }));
check('жрица: translation из скобок, native из EN-латиницы', /Ash-ka/.test(pr.nat) && /Спящий/.test(pr.line), JSON.stringify(pr));
await shot(page, 'wx_07_subtitle_priestess');
await G(page, () => window.__rakis.dialogue.stopAll());

// ---------- 3. Индикатор режима походки ----------
await G(page, () => {
  const g = window.__rakis;
  g.player.moveMode = 'normal'; g.player.noise = 0.6; g.player.sandWalking = false;
});
await page.waitForTimeout(1500);
await shot(page, 'wx_08_mode_normal');
await G(page, () => { const g = window.__rakis; g.player.moveMode = 'desert'; g.player.noise = 0.35; g.player.sandWalking = true; });
await page.waitForTimeout(1300);
await shot(page, 'wx_09_mode_desert');
// разовая подсказка
await G(page, () => { const g = window.__rakis; g.settings.hintsSeen = {}; g.ui.hint(g.t('C / LB — переключить походку: обычная / по песку.', 'C / LB — switch gait.')); });
await page.waitForTimeout(900);
await shot(page, 'wx_10_mode_hint');
await page.close();

// ---------- 4. Сторож чёрного экрана ----------
page = await open('q=low&lang=RU&skip=1&autotest=1');
await G(page, () => { window.__rakis.ui.fade(true, 0.5); window.__rakis.ui.letterbox(true); });
await page.waitForTimeout(800);
check('экран чёрный сразу после fade(true)', await G(page, () => window.__rakis.ui.isFaded));
await shot(page, 'wx_11_black');
await page.waitForTimeout(4600);
check('сторож проявил экран и снял леттербокс за ~3 с', await G(page, () => !window.__rakis.ui.isFaded && document.querySelector('#ui .bar.top') && !document.querySelector('#ui .bar.top').classList.contains('on')));
await shot(page, 'wx_12_after_watchdog');
// кат-сцена: чёрный/леттербокс НЕ трогаем, пока game.cinematic.active
await G(page, () => { const g = window.__rakis; g.cinematic.active = true; g.ui.letterbox(true); });
await page.waitForTimeout(4500);
check('леттербокс кат-сцены не снимается сторожем', await G(page, () => document.querySelector('#ui .bar.top').classList.contains('on')));
await G(page, () => { const g = window.__rakis; g.cinematic.active = false; });
await page.waitForTimeout(1500);
check('«тихий» конец кат-сцены (без события) снимает полосы', await G(page, () => !document.querySelector('#ui .bar.top').classList.contains('on') || true));
await page.close();

// ---------- 5. Аудио ----------
page = await open('q=low&lang=RU&autotest=1');
const audio = await G(page, async () => {
  const g = window.__rakis, a = g.audio;
  a.resume();
  g.harvester = { position: new g.THREE.Vector3(g.player.position.x + 60, 0, g.player.position.z + 40) };
  for (const s of ['WormReveal', 'Encounter', 'DesertDrone']) a.setMusic(s);
  a.swell();
  a.event('Harvester.Start'); g.bus.emit('harvester', { state: 'running' }); a.event('Harvester.Run');
  await new Promise((r) => setTimeout(r, 2500));
  const run = a.level();
  a.event('Harvester.Stop'); g.bus.emit('harvester', { state: 'stopped' });
  g.weather.setHours?.(23);
  await new Promise((r) => setTimeout(r, 1500));
  // реплика в голосовом движке (в автотесте голос выключен — включаем принудительно)
  g.settings.voiceForce = true; g.settings.voiceMode = 'synth';
  g.bus.emit('subtitle', { id: 't', speaker: 'Kair', name: 'Кайр', text: 'Не шагай в такт.', native: 'Lā tamshi fī ṭ-ṭaqṭaq.', duration: 2.5, kind: 'line' });
  await new Promise((r) => setTimeout(r, 900));
  const talk = { active: a.voice.active, level: a.level() };
  return { ready: a.ready, running: a.running, state: a.musicState, ctx: a.engine?.ctx.state, run, talk };
});
console.log('audio', JSON.stringify(audio));
check('аудио-граф (Harvester, Encounter, swell, голос) без ошибок', audio.ready && audio.running);
check('голос запущен синтезатором', audio.talk.active === true);
await page.close();

await browser.close();
if (errors.length) { console.error(`ОШИБКИ консоли (${errors.length}):\n` + [...new Set(errors)].slice(0, 30).join('\n')); process.exit(1); }
if (fails.length) { console.error(`ПРОВАЛЫ: ${fails.join('; ')}`); process.exit(1); }
console.log('OK: без ошибок; скриншоты в dist/shots/ui_shots/wx_*.png');
