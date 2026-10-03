// Сквозная проверка бесшовной географии: тропа → щель → сиетч → выходной туннель → сад.
// Ведёт игрока «ботом» (телепорт-шагами по точкам с проверкой коллизий/высот) и снимает кадры.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = new URL('../dist/shots/route/', import.meta.url).pathname; mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`file://${new URL('../dist/rakis_demo.html', import.meta.url).pathname}?autotest=1&q=low&lang=RU`);
await p.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 420000, polling: 1000 });
const info = () => p.evaluate(() => { const g = window.__rakis, q = g.player.position; return { pos: [q.x, q.y, q.z].map((v) => +v.toFixed(1)), space: g.space, zone: g.zone }; });
// Держим W, поворачивая игрока к цели; проверяем прогресс.
async function walkTo(x, z, label, maxSec = 90) {
  const t0 = Date.now();
  await p.keyboard.down('KeyW');
  let best = 1e9, stuck = 0;
  while ((Date.now() - t0) / 1000 < maxSec * 6) {
    const d = await p.evaluate(([x, z]) => { const g = window.__rakis, pl = g.player; const dx = x - pl.position.x, dz = z - pl.position.z; const yaw = Math.atan2(dz, dx); if (pl.cam) pl.cam.yaw = yaw; pl.yaw = yaw; return Math.hypot(dx, dz); }, [x, z]);
    if (d < 2.5) break;
    if (d < best - 0.3) { best = d; stuck = 0; } else if (++stuck > 40) { console.log('STUCK', label, d.toFixed(1), JSON.stringify(await info())); break; }
    await p.waitForTimeout(250);
  }
  await p.keyboard.up('KeyW');
  console.log(label, JSON.stringify(await info()));
  await p.screenshot({ path: out + label + '.png' });
}
await p.evaluate(() => window.__rakis.debug.goto('trail'));
await p.waitForTimeout(3000);
const pts = await p.evaluate(() => { const g = window.__rakis; const tr = g.approach?.trail || []; return tr.map((q) => [q.x, q.z]); });
console.log('trail points', pts.length);
const step = Math.max(1, Math.floor(pts.length / 10));
for (let i = step; i < pts.length; i += step) await walkTo(pts[i][0], pts[i][1], `trail_${i}`);
const c = await p.evaluate(() => window.__rakis.approach.cleftPos);
await walkTo(c.x + 6, c.z, 'cleft_in');
console.log('sietch?', JSON.stringify(await info()));
await p.evaluate(() => window.__rakis.sietch.enter('exit'));
await p.waitForTimeout(2500);
await walkTo(806, 395, 'to_garden', 120);
await walkTo(830, 395, 'garden_in', 60);
console.log('errors', errs.length ? [...new Set(errs)].slice(0, 6) : 'none');
await b.close();
