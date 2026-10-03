// Проверка сюжетного директора и диалогов в headless Chromium (на заглушках остальных модулей):
//  1) Start → титр → цепочка DLG_A1_001..004 → Hint → бит-цепочка по Beat:*;
//  2) Реалтайм: нет склеек, PlayCinematic без game.cinematic, виртуальные зоны тропа/щель/сад;
//  3) очередь без наложений, условия, лай, лор.
// node tools/story_test.mjs [--file=ui.html]
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const findChromium = () => {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('crash', () => console.error('PAGE CRASH'));
await page.goto(`file://${join(root, 'dist', arg('file', 'ui.html'))}?autotest=1&q=low&lang=RU`);
await page.waitForFunction(() => window.__rakis?.story, null, { timeout: 120000 });

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };

// --- инструментирование ---
await page.evaluate(() => {
  const g = window.__rakis, log = (window.__log = []);
  for (const e of ['zone', 'subtitle', 'line:end', 'chain:end', 'story:beat']) g.bus.on(e, (p) => log.push([+g.time.toFixed(1), e, p?.id ?? p?.to ?? p?.text?.slice(0, 20) ?? '', p?.state ?? '']));
  g.__weather = []; g.weather.request = (id, blend) => g.__weather.push([id, blend]);
  g.__title = []; const tc = g.ui.titleCard; g.ui.titleCard = (t, h) => { g.__title.push(t); tc(t, h); };
  g.__hint = []; const hh = g.ui.hint; g.ui.hint = (t) => { g.__hint.push(t); hh(t); };
  // «Ходьба» игрока к цели эллипсиса + teleport как у настоящего игрока
  g.player.teleport = (x, y, z, yaw) => { g.player.position.set(x, y, z); g.__tp = [x, z, yaw]; };
  g.player.setInputLocked = (b) => { g.__locked = b; };
  g.player.position.set(0, 0, 0);
  g.__walk = true;
  g.add('mover', { update(dt) { if (!g.__walk) return; const p = g.player.position; const dx = 240 - p.x, dz = 83 - p.z, d = Math.hypot(dx, dz) || 1; if (g.__tp) return; p.x += (dx / d) * 4 * dt; p.z += (dz / d) * 4 * dt; } });
  g.timeScale = 4;
});

// 1. Сюжет с ускорением времени
await page.waitForFunction(() => window.__rakis.time > 12, null, { timeout: 120000 });
let r = await page.evaluate(() => ({ title: window.__rakis.__title, log: window.__log.map((l) => l.join(' ')) }));
ok(r.title.length > 0 && /Ракис/.test(r.title[0]), `TitleCard RU выбран: ${r.title[0]}`);
ok(r.log.some((l) => /subtitle/.test(l)), 'субтитр пошёл');
await page.waitForFunction(() => window.__rakis.story.isCompleted('SB_A1_04_Hint'), null, { timeout: 120000 });
r = await page.evaluate(() => ({ hint: window.__rakis.__hint, completed: window.__rakis.story.beats.filter((b) => b.completed).map((b) => b.id), log: window.__log.filter((l) => l[1] === 'line:end').map((l) => l.join(' ')) }));
ok(r.hint.length === 1 && /C \/ LB|Alt/.test(r.hint[0]), 'Hint показан после цепочки DLG_A1_001');
ok(r.log.length >= 4, `реплики цепочки завершились по порядку: ${r.log.join(' | ')}`);

// 2. Реалтайм: никаких склеек/карточек времени, виртуальные зоны тропы/щели, PlayCinematic не трогает game.cinematic
r = await page.evaluate(async () => {
  const g = window.__rakis, st = g.story;
  g.__walk = false;
  const hasEll = st.beats.some((b) => b.action === 'Ellipsis');
  const cards = g.__title.slice();
  g.ui.cutCard = () => { g.__cut = true; };
  // PlayCinematic: реалтайм-последовательность через Promise модуля; game.cinematic остаётся false
  let cinSeen = false; g.bus.on('cinematic', () => { cinSeen = true; });
  let resolveReveal; g.worm.playReveal = () => new Promise((r) => { resolveReveal = r; });
  st.playCinematic('LS_WormReveal');
  await new Promise((r) => setTimeout(r, 200));
  const during = { cin: g.cinematic.active, seen: cinSeen };
  resolveReveal();
  await new Promise((r) => setTimeout(r, 100));
  // тропа: подножие → подъём → щель
  const fired = (id) => st.isFired(id);
  const P = g.player.position, T = (x, y, z) => { P.set(x, y, z); };
  g.timeScale = 1;
  // headless-рендер медленный: ждём по условию (до 40 с), а не фиксированное время
  const until = async (f, ms = 40000) => { const t0 = performance.now(); while (!f() && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 100)); return f(); };
  const hold = (x, y, z) => { g.__hold = [x, y, z]; };
  const pu = g.player.update?.bind(g.player); g.player.update = (...a) => { pu?.(...a); if (g.__hold) P.set(...g.__hold); };   // удерживаем позицию после физики игрока
  hold(606, g.heightAt(606, 300), 300); await new Promise((r) => setTimeout(r, 2500));
  const beforeTrail = fired('SB_A5_02_Climb');
  hold(630, g.heightAt(630, 275) + 8, 275); const onTrail = await until(() => fired('SB_A5_02_Climb'));
  hold(645, 30, 251); const cleft = await until(() => fired('SB_A6_00_Cleft'));
  hold(840, 4, 395); const garden = await until(() => fired('SB_C1_03_Plants'));
  return { hasEll, cards, during, beforeTrail, onTrail, cleft, garden, cut: !!g.__cut, cin: g.cinematic.active };
});
ok(!r.hasEll, 'в StoryBeats нет действий Ellipsis');
ok(!r.cards.some((t) => /спустя|later/i.test(t)) && !r.cut, `нет карточек «N часов спустя»: ${JSON.stringify(r.cards)}`);
ok(!r.during.cin && !r.during.seen && !r.cin, 'PlayCinematic не включает game.cinematic');
ok(!r.beforeTrail && r.onTrail, `ZoneEnter:A5_Trail по положению на тропе (до: ${r.beforeTrail}, на тропе: ${r.onTrail})`);
ok(r.cleft, 'A6_Cleft: обнаружение щели у входа');
ok(r.garden, 'C1_Garden: сюжет сада по положению (без game.garden — геометрия)');

// 3. Диалоги: очередь, условия, лай, лор
r = await page.evaluate(async () => {
  const g = window.__rakis, d = g.dialogue; d.stopAll(); g.timeScale = 20;
  g.__hold = null; g.player.position.set(240, 0, 83); g.zone = 'A2_Erg';
  const cond = { zone: d.isConditionMet('ZoneEnter:A2_Erg'), noise: d.isConditionMet('NoiseAbove:5'), worm: d.isConditionMet('WormState:Dormant'), moist: d.isConditionMet('MoistureBelow:2') };
  const order = [];
  g.bus.on('subtitle', (s) => s.kind === 'line' && order.push(s.id));
  const p1 = d.play('DLG_A2_001'), p2 = d.play('DLG_A3_003'); // две цепочки подряд
  await Promise.all([p1, p2]);
  // условие в середине цепочки: DLG_WRM_P01 → P02 (без условий) и первая реплика с условием играет всегда
  const first = []; g.bus.on('subtitle', (s) => first.push(s.id));
  await d.play('DLG_WRM_L01');
  g.player.position.set(0, 0, 0);
  const b1 = d.bark('Trader', 'Market', { x: 3, y: 0, z: 3 }), b2 = d.bark('Trader', 'Market', { x: 3, y: 0, z: 3 }), b3 = d.bark('Guard', null, { x: 80, y: 0, z: 0 });
  return { order, cond, first, bark: [!!b1, !!b2, !!b3] };
});
const want = ['DLG_A2_001', 'DLG_A2_002', 'DLG_A3_003', 'DLG_A3_004', 'DLG_A3_005', 'DLG_A3_006', 'DLG_A3_007'];
ok(JSON.stringify(r.order.slice(0, want.length)) === JSON.stringify(want), `очередь без наложений: ${r.order.join(',')}`);
ok(r.cond.zone && !r.cond.noise && r.cond.worm && r.cond.moist, `условия: ${JSON.stringify(r.cond)}`);
ok(r.first.includes('DLG_WRM_L01'), 'первая реплика цепочки с условием WormState:Listening играет всегда');
ok(r.bark[0] && !r.bark[1] && !r.bark[2], `лай: глобальный лимитер и радиус 10 м: ${r.bark}`);

await browser.close();
if (errors.length) { console.error(`ОШИБКИ (${errors.length}):\n` + [...new Set(errors)].slice(0, 20).join('\n')); fails++; }
console.log(fails ? `FAILED: ${fails}` : 'OK: сюжет и диалоги');
process.exit(fails ? 1 : 0);
