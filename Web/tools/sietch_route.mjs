// Сквозной проход «живым» игроком (W + поворот к цели) в обе стороны: тропа → расщелина → шлюз → галерея → B3 → зал → выход → сад и обратно.
// node tools/sietch_route.mjs [--file=sietch.html] [--q=low] [--leg=in|out|both] [--shots]
// Печатает позицию/пространство/зону в контрольных точках; STUCK — если прогресс к цели остановился. Снимки: dist/shots/sietch_route/.
import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const out = join(root, 'dist', 'shots', 'sietch_route'); mkdirSync(out, { recursive: true });
const shots = process.argv.includes('--shots');
function findChromium() { const base = '/opt/pw-browsers'; if (!existsSync(base)) return undefined; const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n)); return d ? join(base, d, 'chrome-linux', 'chrome') : undefined; }
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 480, height: 270 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error' && !/AudioContext/.test(m.text())) errs.push(m.text()); });
await p.goto(`file://${join(root, 'dist', arg('file', 'sietch.html'))}?autotest=1&q=${arg('q', 'low')}&lang=RU`);
await p.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 480000, polling: 1000 });
const info = () => p.evaluate(() => { const g = window.__rakis, q = g.player.position; return { pos: [q.x, q.y, q.z].map((v) => +v.toFixed(1)), space: g.space, zone: g.zone }; });
let bad = 0;
const from = arg('from', 'trail');
async function walkTo(x, z, label, maxSec = 60, shot = false) {
  await p.keyboard.down('KeyW');
  // прогресс считаем по ИГРОВОМУ времени (g.time): под нагрузкой кадры редкие, настенные часы не годятся
  let best = 1e9, tBest = null, minY = 1e9, maxY = -1e9, last = null, maxJump = 0, tStart = null, guard = 0;
  while (guard++ < 4000) {
    const d = await p.evaluate(([x, z]) => { const g = window.__rakis, pl = g.player; g.sietch.crowd.guardReleased = true; const dx = x - pl.position.x, dz = z - pl.position.z; const yaw = Math.atan2(dz, dx); if (pl.cam) pl.cam.yaw = yaw; pl.yaw = yaw; return [Math.hypot(dx, dz), pl.position.y, g.time, pl.position.x, pl.position.z]; }, [x, z]);
    const [dist, y, gt, px, pz] = d;
    if (tStart === null) { tStart = gt; tBest = gt; }
    if (last !== null) { const dxz = Math.hypot(px - last[0], pz - last[1]); maxJump = Math.max(maxJump, Math.abs(y - last[2]) - 0.4 * dxz); }
    last = [px, pz, y]; minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    if (dist < 1.3) break;
    if (dist < best - 0.3) { best = dist; tBest = gt; } else if (gt - tBest > 4) { console.log('STUCK', label, dist.toFixed(1), JSON.stringify(await info())); bad++; break; }
    if (gt - tStart > maxSec) { console.log('TIMEOUT', label, dist.toFixed(1)); bad++; break; }
    await p.waitForTimeout(400);
  }
  await p.keyboard.up('KeyW');
  const inf = await info();
  console.log(label.padEnd(26), JSON.stringify(inf), `y ${minY.toFixed(1)}..${maxY.toFixed(1)}, скачок сверх уклона ${Math.max(0, maxJump).toFixed(2)}`);
  if (maxJump > 0.8) { bad++; console.log('  ! СКАЧОК высоты'); }
  if (shot || shots) await p.screenshot({ path: join(out, label.replace(/[^\w]+/g, '_') + '.png'), timeout: 600000 });
}
await p.evaluate(async (from) => { const g = window.__rakis; if (from === 'hall') await g.sietch.enter('exitStart'); else g.debug.goto(from === 'cleft' ? 'cleft' : 'trail'); g.timeScale = 2.5; }, from);
await p.waitForTimeout(3000);
const leg = arg('leg', 'both');
const S = (fn, ...a) => p.evaluate(([f, a]) => window.__rakis.sietch[f](...a), [fn, a]);
const local = async (pts) => p.evaluate((pts) => pts.map(([x, z]) => { const w = window.__rakis.sietch.toWorld(x, 0, z); return [w.x, w.z]; }), pts);
if (leg !== 'out' && from === 'hall') {
  // старт у выхода из зала: зал → туннель → сад (по оси туннеля)
  const ex = await p.evaluate(() => window.__rakis.sietch.exitPath.map((q) => [q.x, q.z]));
  for (let i = 1; i < ex.length; i += 2) await walkTo(ex[i][0], ex[i][1], `exit_${i}`, 60, i === ex.length - 1 || i === Math.floor(ex.length / 2));
  await walkTo(808, 395, 'to_garden', 90, true);
  await walkTo(830, 395, 'garden_in', 60, true);
} else if (leg !== 'out') {
  const pts0 = await p.evaluate(() => (window.__rakis.approach?.trail || []).map((q) => [q.x, q.z]));
  const pts = from === 'cleft' ? [] : pts0;
  console.log('trail points', pts0.length, 'walked', pts.length);
  const step = 6;
  for (let i = step; i < pts.length; i += step) await walkTo(pts[i][0], pts[i][1], `trail_${i}`, 30, false);
  const c = await p.evaluate(() => window.__rakis.approach.cleftPos);
  await walkTo(c.x - 2.5, c.z, 'cleft_slot', 40);
  await walkTo(c.x + 3, c.z, 'cleft', 40, true);
  const route = await local([[-1.5, 3.5], [2.4, 0], [12, 0], [24, 0], [36, -0.3], [44, 0], [60, 0.5], [76, 0], [96, 0], [104, 0.4], [126, 0.5], [146, 0], [153, 0], [166, 0]]);
  for (let i = 0; i < route.length; i++) await walkTo(route[i][0], route[i][1], `sietch_${i}`, 60, i === 0);
  // зал → выход (по оси туннеля) → сад
  const ex = await p.evaluate(() => window.__rakis.sietch.exitPath.map((q) => [q.x, q.z]));
  const hall = await local([[172, -8], [184, -10]]);
  for (const h of hall) await walkTo(h[0], h[1], 'hall_to_exit', 60);
  for (let i = 1; i < ex.length; i += 2) await walkTo(ex[i][0], ex[i][1], `exit_${i}`, 60, i === ex.length - 1 || i === Math.floor(ex.length / 2));
  await walkTo(808, 395, 'to_garden', 90, true);
  await walkTo(830, 395, 'garden_in', 60, true);
}
if (leg !== 'in') {
  // обратно: сад → устье → туннель → зал → шлюз → расщелина → тропа
  if (leg === 'out') await p.evaluate(() => { const g = window.__rakis; g.debug.goto('garden'); });
  await p.waitForTimeout(2500);
  await walkTo(808, 395, 'garden_back', 90);
  const ex = await p.evaluate(() => window.__rakis.sietch.exitPath.map((q) => [q.x, q.z]));
  for (let i = ex.length - 1; i >= 0; i -= 2) await walkTo(ex[i][0], ex[i][1], `exit_back_${i}`, 60, i === ex.length - 1);
  const back = from === 'hall' ? await local([[172, -8]]) : await local([[172, -8], [160, 0], [146, 0], [126, 0.5], [104, 0.4], [96, 0], [76, 0], [60, 0.5], [44, 0], [36, -0.3], [24, 0], [12, 0], [2.4, 0], [-1.5, 3.5]]);
  for (let i = 0; i < back.length; i++) await walkTo(back[i][0], back[i][1], `back_${i}`, 60, i === back.length - 1);
  if (from !== 'hall') { const c = await p.evaluate(() => window.__rakis.approach.cleftPos); await walkTo(c.x - 8, c.z + 4, 'cleft_out', 60, true); }
}
console.log('ошибки страницы:', errs.length ? [...new Set(errs)].slice(0, 6) : 'нет', ' СБОЕВ:', bad);
await b.close();
process.exit(bad ? 1 : 0);
