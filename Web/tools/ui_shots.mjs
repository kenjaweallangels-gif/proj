// Скриншоты интерфейса: титульный экран (без skip), HUD при ходьбе, субтитры, пауза, фоторежим, леттербокс, концовка.
// node tools/ui_shots.mjs [--file=ui.html]   → dist/shots/ui_shots/*.png
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
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
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
const setSub = (page, size, bg) => G(page, ([s, b]) => { const g = window.__rakis; g.settings.subSize = s; g.settings.subBg = b; const h = g.ui.root.parentElement; h.dataset.sub = s; h.dataset.bg = b ? '1' : '0'; }, [size, bg]);

// 1. Титульный экран RU (1080p) / EN
let page = await open('q=low&lang=RU', { width: 1920, height: 1080 });
await page.waitForTimeout(800);
await shot(page, '01_title_ru');
await page.close();
page = await open('q=low&lang=EN');
await shot(page, '02_title_en');
await page.close();

// 2. Игра: старт по клику
page = await open('q=low&lang=RU');
await page.mouse.click(640, 300);
await page.waitForTimeout(5200);
await shot(page, '03_start_titlecard');

// 3. HUD на песке: шум, ритм, угроза, влага
await G(page, () => {
  const g = window.__rakis, p = g.player;
  p.noise = 0.55; p.sandWalking = true; p.regularity = 0.2; p.intervals = [0.62, 0.41, 0.77, 0.5, 0.35]; p.moisture = 0.62; p.inShade = false;
});
await page.waitForTimeout(900);
await shot(page, '04_hud_walk');
await G(page, () => { const g = window.__rakis; g.player.regularity = 0.95; g.player.intervals = [0.5, 0.5, 0.5, 0.5, 0.5]; g.player.noise = 0.8; g.worm.state = 'Approach'; g.worm.threat = 0.8; g.player.moisture = 0.2; });
await page.waitForTimeout(900);
await shot(page, '05_hud_threat');
await G(page, () => { const g = window.__rakis; g.worm.state = 'Dormant'; g.worm.threat = 0; g.player.noise = 0; g.player.sandWalking = false; g.player.moisture = 0.5; g.player.focus = { label: { RU: 'Осмотреть', EN: 'Inspect' }, tag: 'x' }; });
await page.waitForTimeout(600);
await shot(page, '06_prompt');
await G(page, () => { window.__rakis.player.focus = null; });

// 4. Субтитры, лай, лор, подсказка
await G(page, () => { const g = window.__rakis; g.dialogue.play('DLG_A1_003'); g.ui.hint('Удерживайте Alt / LB — походка по песку. Сбивайте ритм: Пробел / A.'); });
await page.waitForTimeout(1300);
await shot(page, '07_subtitles_hint');
await G(page, () => { const g = window.__rakis; g.dialogue.bark('Trader', 'Market', { x: g.player.position.x + 3, y: 0, z: g.player.position.z - 6 }); });
await page.waitForTimeout(900);
await shot(page, '08_bark');
await G(page, () => { const g = window.__rakis; g.dialogue.stopAll(); g.dialogue.lore('LORE_Cistern_Grate'); });
await page.waitForTimeout(1800);
await shot(page, '09_lore');
await setSub(page, 'L', true);
await G(page, () => { window.__rakis.dialogue.play('DLG_A3_002'); });
await page.waitForTimeout(1200);
await shot(page, '10_subtitles_L_bg');
await G(page, () => { window.__rakis.dialogue.stopAll(); });
await setSub(page, 'M', false);

// 5. Леттербокс + субтитр
await G(page, () => { const g = window.__rakis; g.cinematic.active = true; g.dialogue.play('DLG_A3_002'); });
await page.waitForTimeout(1600);
await shot(page, '11_letterbox');
await G(page, () => { const g = window.__rakis; g.cinematic.active = false; g.dialogue.stopAll(); });
await page.waitForTimeout(1200);

// 6. Пауза
await page.keyboard.press('Escape');
await page.waitForTimeout(700);
await shot(page, '12_pause');
await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
await shot(page, '13_pause_nav');
// 7. Фоторежим из паузы (второй пункт)
await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await page.keyboard.down('KeyW'); await page.waitForTimeout(500); await page.keyboard.up('KeyW');
await page.mouse.wheel(0, 300);
await page.waitForTimeout(300);
await shot(page, '14_photo');
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
console.log('after photo exit', JSON.stringify(await G(page, () => ({ paused: window.__rakis.paused, photo: window.__rakis.ui.photoActive, ts: window.__rakis.timeScale, fov: window.__rakis.camera.fov }))));
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
console.log('after resume', JSON.stringify(await G(page, () => ({ paused: window.__rakis.paused, blocking: window.__rakis.ui.blocking }))));
// 8. Концовка
await G(page, () => window.__rakis.debug.goto('end'));
await page.waitForTimeout(8000);
await shot(page, '15_end');
await page.close();

// 9. Аудио-граф строится без ошибок
page = await open('q=low&lang=RU&autotest=1');
const audio = await G(page, async () => {
  const g = window.__rakis; const a = g.audio;
  a.resume();
  for (const s of ['DesertCalm', 'DesertDrone', 'WormThreat', 'WormReveal', 'SietchLife', 'SietchNarrow', 'HallChorale']) a.setMusic(s);
  a.event('Foot.Rock'); a.event('Door.SealHiss'); a.event('Worm.Breach', { x: 10, y: 0, z: 10 }); a.event('UI.Hint'); a.finalChord();
  g.bus.emit('footstep', { x: 1, z: 2, yaw: 0, surface: 'sand', actor: 'player' });
  g.bus.emit('footstep', { x: 3, z: 2, yaw: 0, surface: 'rock', actor: 'Ilva' });
  g.bus.emit('worm:breach', { x: 5, z: 5 });
  await new Promise((r) => setTimeout(r, 1500));
  return { ready: a.ready, running: a.running, state: a.musicState, ctx: a.engine?.ctx.state };
});
console.log('audio', JSON.stringify(audio));
await page.close();
await browser.close();
if (errors.length) { console.error(`ОШИБКИ (${errors.length}):\n` + [...new Set(errors)].slice(0, 30).join('\n')); process.exit(1); }
console.log('OK: без ошибок; скриншоты в dist/shots/ui_shots');
