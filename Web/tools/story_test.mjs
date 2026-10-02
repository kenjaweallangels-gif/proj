// Проверка сюжетного директора и диалогов в headless Chromium (на заглушках остальных модулей):
//  1) Start → титр → цепочка DLG_A1_001..004 → Hint → бит-цепочка по Beat:*;
//  2) Эллипсис A2: игрок «идёт» к цели → затемнение → телепорт → Beat:SB_A1_06 → отложенные ZoneEnter;
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
ok(r.hint.length === 1 && /Alt/.test(r.hint[0]), 'Hint показан после цепочки DLG_A1_001');
ok(r.log.length >= 4, `реплики цепочки завершились по порядку: ${r.log.join(' | ')}`);

// 2. Эллипсис A2
await page.waitForFunction(() => window.__rakis.story.ellipsisPhase !== 'none', null, { timeout: 120000 }).catch(() => {});
const ph = await page.evaluate(() => window.__rakis.story.ellipsisPhase);
ok(ph !== 'none', `эллипсис предложен/идёт (phase=${ph})`);
await page.waitForFunction(() => window.__rakis.story.isCompleted('SB_A1_06_EllipsisA2'), null, { timeout: 120000 });
r = await page.evaluate(() => ({ tp: window.__rakis.__tp, pos: window.__rakis.player.position.toArray(), cards: window.__rakis.__title, locked: window.__rakis.__locked, wx: window.__rakis.__weather }));
ok(r.tp && Math.abs(r.tp[0] - 240) < 0.1, `игрок перенесён к A2: ${JSON.stringify(r.tp)}`);
await page.waitForFunction(() => window.__rakis.story.ellipsisPhase === 'none', null, { timeout: 60000 });
r = await page.evaluate(() => ({ locked: window.__rakis.__locked, log: window.__log.filter((l) => l[1] === 'zone').map((l) => l.join(' ')), fired: window.__rakis.story.beats.filter((b) => b.fired).map((b) => b.id) }));
ok(r.locked === false, 'ввод разблокирован после склейки');
ok(r.fired.includes('SB_A2_00_Title') && r.fired.includes('SB_A2_10_Tension'), 'биты зоны прибытия ZoneEnter:A2_Erg исполнены после склейки');
console.log('zone events:', r.log.join(' | '));

// 3. Диалоги: очередь, условия, лай, лор
r = await page.evaluate(async () => {
  const g = window.__rakis, d = g.dialogue; d.stopAll(); g.timeScale = 20;
  const order = [];
  g.bus.on('subtitle', (s) => s.kind === 'line' && order.push(s.id));
  const p1 = d.play('DLG_A2_001'), p2 = d.play('DLG_A3_003'); // две цепочки подряд
  await Promise.all([p1, p2]);
  const cond = { zone: d.isConditionMet('ZoneEnter:A2_Erg'), noise: d.isConditionMet('NoiseAbove:5'), worm: d.isConditionMet('WormState:Dormant'), moist: d.isConditionMet('MoistureBelow:2') };
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
