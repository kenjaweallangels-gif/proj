// Тест режимов движения игрока (обычный / походка по песку), событий шагов, спутников и ткани в реальной игре.
// node tools/build.mjs --out=char.html && node tools/char_player_test.mjs [--file=char.html]
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const outDir = join(root, 'dist', 'shots', 'charplayer');
mkdirSync(outDir, { recursive: true });
function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('crash', () => console.log('PAGE CRASHED'));
page.on('console', (m) => { if ((m.type() === 'warning' || m.type() === 'error') && !/AudioContext/.test(m.text())) console.log('console.' + m.type(), m.text().slice(0, 300)); });
await page.goto(`file://${join(root, 'dist', arg('file', 'char.html'))}?autotest=1&q=low&lang=RU&skip=1`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.5, null, { timeout: 120000 });

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); if (!ok) fails++; };
const wait = (sec) => page.evaluate((s) => new Promise((res) => { const g = window.__rakis; const t0 = g.time; const id = setInterval(() => { if (g.time - t0 >= s) { clearInterval(id); res(); } }, 30); }), sec);
const ev = (fn, a) => page.evaluate(fn, a);

await ev(() => {
  const g = window.__rakis; g.__ev = { noise: [], foot: [], stutter: 0, sand: [] };
  g.bus.on('noise', (e) => g.__ev.noise.push(e)); g.bus.on('footstep', (e) => { if (e.actor === 'player') g.__ev.foot.push(g.time); });
  g.bus.on('stutter', () => g.__ev.stutter++); g.bus.on('sandwalk', (e) => g.__ev.sand.push(e.on));
});
check('player + figure API', await ev(() => { const f = window.__rakis.player.figure; return !!f.parts.limbs.L.sh && !!f.gait && typeof f.animate === 'function' && window.__rakis.player.moveMode === 'normal'; }));

// 1. обычная ходьба: ~3 м/с, регулярный ритм, шаги из анимации
await page.keyboard.down('KeyW'); await wait(3.5);
let s = await ev(() => { const p = window.__rakis.player; return { speed: p.speed, mode: p.moveMode, sw: p.sandWalking, reg: p.regularity, noise: p.noise, steps: window.__rakis.__ev.foot.length }; });
check('walk ~3 m/s, mode normal', Math.abs(s.speed - 3) < 0.5 && s.mode === 'normal' && !s.sw, JSON.stringify(s));
check('walk loud + regular', s.noise > 0.25 && s.reg > 0.6, `noise=${s.noise.toFixed(2)} reg=${s.reg.toFixed(2)}`);
check('footsteps from animation', s.steps >= 6, `steps=${s.steps}`);
await page.screenshot({ path: join(outDir, '1_walk.png') });
await page.keyboard.down('ShiftLeft'); await wait(2);
s = await ev(() => ({ speed: window.__rakis.player.speed, noise: window.__rakis.player.noise }));
check('run ~6 m/s, loud', s.speed > 5 && s.noise > 0.7, JSON.stringify(s));
await page.screenshot({ path: join(outDir, '2_run.png') });
await page.keyboard.up('ShiftLeft');

// 2. Песок: C — переключатель (без удержания)
await page.keyboard.press('KeyC'); await wait(5);
s = await ev(() => { const p = window.__rakis.player; return { speed: p.speed, mode: p.moveMode, sw: p.sandWalking, reg: p.regularity, iv: p.intervals.map((v) => +v.toFixed(2)), last: p.lastStepLoudness, noise: p.noise }; });
check('C toggles desert mode (sandWalking)', s.mode === 'desert' && s.sw, JSON.stringify(s));
check('desert quieter than walk', s.last < 0.25, `last=${s.last.toFixed(3)}`);
// средняя скорость ~1.8 и нерегулярность ритма (по событиям шагов из анимации)
const f0 = await ev(() => window.__rakis.__ev.foot.length);
const p0 = await ev(() => ({ x: window.__rakis.player.position.x, z: window.__rakis.player.position.z }));
const regSamples = [];
for (let i = 0; i < 24; i++) { await wait(0.5); regSamples.push(await ev(() => window.__rakis.player.regularity)); }
const p1 = await ev(() => ({ x: window.__rakis.player.position.x, z: window.__rakis.player.position.z }));
const avg = Math.hypot(p1.x - p0.x, p1.z - p0.z) / 12;
const times = await ev((n) => window.__rakis.__ev.foot.slice(n), f0);
const ivs = times.slice(1).map((t, i) => t - times[i]);
const mean = ivs.reduce((a, b) => a + b, 0) / Math.max(1, ivs.length), cv = Math.sqrt(ivs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ivs.length)) / mean;
check('desert rhythm irregular by itself (CV of step intervals)', cv > 0.3, `cv=${cv.toFixed(2)} n=${ivs.length} intervals=${ivs.map((v) => v.toFixed(2)).join(' ')}`);
check('desert regularity low', Math.min(...regSamples) < 0.4, `min=${Math.min(...regSamples).toFixed(2)}`);
check('desert avg speed ~1.8 m/s', avg > 1.3 && avg < 2.3, `avg=${avg.toFixed(2)}`);
await page.screenshot({ path: join(outDir, '3_desert.png') });
// Space — дополнительные срывы ритма
const e0 = await ev(() => window.__rakis.__ev.stutter);
for (let i = 0; i < 4; i++) { await page.keyboard.press('Space'); await wait(0.7); }
check('stutter events', (await ev(() => window.__rakis.__ev.stutter)) - e0 >= 3);
await page.keyboard.press('KeyC'); await wait(1.2);
s = await ev(() => ({ mode: window.__rakis.player.moveMode, sw: window.__rakis.player.sandWalking, speed: window.__rakis.player.speed }));
check('C again returns to normal', s.mode === 'normal' && !s.sw && s.speed > 2.2, JSON.stringify(s));
// Alt — момент
await page.keyboard.down('AltLeft'); await wait(1);
check('Alt hold = desert', await ev(() => window.__rakis.player.moveMode === 'desert'));
await page.keyboard.up('AltLeft'); await wait(0.5);
check('Alt release = normal', await ev(() => window.__rakis.player.moveMode === 'normal'));
// Shift отменяет переключатель
await page.keyboard.press('KeyC'); await wait(0.3);
await page.keyboard.down('ShiftLeft'); await wait(0.5);
check('Shift cancels desert toggle', await ev(() => window.__rakis.player.moveMode === 'normal'));
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW'); await wait(6);
const ev2 = await ev(() => window.__rakis.__ev.sand.join());
check('sandwalk bus events', /true/.test(ev2) && /false/.test(ev2), ev2);
s = await ev(() => ({ speed: window.__rakis.player.speed, noise: window.__rakis.player.noise }));
check('standing is silent', s.speed < 0.1 && s.noise < 0.05, JSON.stringify(s));

// 3. Спутники и Оссана
await page.keyboard.down('KeyW'); await wait(6); await page.keyboard.up('KeyW'); await wait(2);
const comp = await ev(() => { const g = window.__rakis; const p = g.player.position; return g.companions.list.map((c) => ({ id: c.id, d: Math.hypot(c.position.x - p.x, c.position.z - p.z) })); });
check('companions follow', comp.length >= 2 && comp[0].d < 6 && comp[1].d < 10, JSON.stringify(comp));
await ev(() => { const g = window.__rakis; g.cinematic.active = true; g.cinematic.active = false; g.bus.emit('cinematic', { active: false, id: 'WormReveal' }); });
await wait(0.3);
check('Ossana does NOT auto-join after WormReveal', await ev(() => !window.__rakis.companions.list.some((c) => c.id === 'Ossana')));
await ev(() => window.__rakis.companions.join('Ossana'));
check('companions.join(Ossana) still works', await ev(() => window.__rakis.companions.list.some((c) => c.id === 'Ossana')));
await page.screenshot({ path: join(outDir, '4_companions.png') });

// 4. Ветер: фигуры читают глобальный
await ev(() => { const g = window.__rakis; g.weather?.request?.('storm', 0.1); });
await wait(4);
const wi = await ev(() => { const g = window.__rakis; const u = g.player.figure.parts.cloth.material; return { ws: g.weather?.windSpeed, hasU: !!u }; });
check('weather/cloth wired', wi.hasU, JSON.stringify(wi));
await page.screenshot({ path: join(outDir, '5_wind.png') });

await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) { console.error(`ОШИБКИ (${uniq.length}):\n` + uniq.slice(0, 20).join('\n')); fails++; }
console.log(fails ? `FAILED: ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
