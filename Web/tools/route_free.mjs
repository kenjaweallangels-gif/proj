// Сквозная проверка СВОБОДНОГО движения (без рендера: game.simulate шагает симуляцию на CPU):
//  A. плавность: шаг 60 Гц + интерполяция — скорость отрисовки игрока/камеры/спутников стабильна при рваном dt;
//  B. прыжок (Space в обычном режиме) и приземление;  C. сиетч → щель → тропа вниз → пустыня (обратный маршрут);
//  D. спрыгнуть с уступа тропы на пустыню (падение, посадка, без телепорта);  E. снова вверх по тропе и в сиетч (бесшовно).
//   node tools/route_free.mjs [--file=cur.html] [--q=low]
import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const file = arg('file', 'rakis_demo.html'), q = arg('q', 'low');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext/.test(m.text())) errors.push(m.text()); });
await page.goto(`file://${root}/dist/${file}?autotest=1&q=${q}&lang=RU&drs=0&warm=0`);
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });

await page.evaluate(() => {
  const g = window.__rakis;
  const st = { fwd: 0, run: 0, jump: 0 };
  window.__in = st;
  g.input.axis = () => ({ x: 0, y: st.fwd });
  const held = g.input.held; g.input.held = (a) => (a === 'Sprint' ? !!st.run : held(a));
  const pressed = g.input.pressed; g.input.pressed = (a) => (a === 'Jump' && st.jump ? (st.jump = 0, true) : pressed(a));
  const log = (g.__trace = { pos: [], spaces: [] });
  g.bus.on('space', (e) => log.spaces.push(`${e.from}→${e.space}@${g.player.position.x.toFixed(0)},${g.player.position.z.toFixed(0)}`));
  // бот: идёт к точке, поворачивая камеру; останавливается при достижении/застревании
  let rs = 12345; const rnd = () => (rs = (rs * 16807) % 2147483647) / 2147483647;
  window.__walk = (x, z, maxSec = 60, tol = 1.2, run = false) => {
    const pl = g.player; st.fwd = 1; st.run = run ? 1 : 0;
    let best = 1e9, lastBest = 0, sideT = 0, side = 1.1, t = 0, reason = 'timeout', maxDy = 0, minY = 1e9, py = pl.position.y, airT = 0;
    g.simulate(maxSec, 1 / 30, () => {
      t += 1 / 30;
      if (window.__rec && Math.round(t * 30) % 5 === 0) window.__rec.push([pl.position.x, pl.position.z]);
      const dx = x - pl.position.x, dz = z - pl.position.z, d = Math.hypot(dx, dz);
      // обход препятствий (каирны/валуны на тропе): если 1.2 с нет прогресса — уходим в сторону на 1 с, чередуя стороны
      let off = 0;
      if (t - lastBest > 1.2) {
        sideT += 1 / 30;
        if (sideT < 1.3) off = side; else { sideT = 0; side = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 1.3); lastBest = t - 0.6; }
      }
      const yaw = Math.atan2(dz, dx) + off; pl.cam.yaw = yaw;
      maxDy = Math.max(maxDy, Math.abs(pl.position.y - py)); py = pl.position.y; if (!pl.grounded) airT += 1 / 30;
      if (d < tol) { reason = 'reached'; return false; }
      if (d < best - 0.25) { best = d; lastBest = t; } else if (t - lastBest > 12) { reason = 'stuck'; return false; }
    });
    st.fwd = 0; st.run = 0;
    const p = pl.position;
    return { reason, t: +t.toFixed(1), pos: [p.x, p.y, p.z].map((v) => +v.toFixed(1)), space: g.space, zone: g.zone, maxDy: +maxDy.toFixed(2), airT: +airT.toFixed(2) };
  };
});
const J = (o) => JSON.stringify(o);
let fail = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fail++; };

// ---- A. плавность ----
await page.evaluate(() => window.__rakis.debug.goto('erg'));
const smooth = await page.evaluate(() => {
  const g = window.__rakis, pl = g.player, st = window.__in;
  st.fwd = 1;
  g.simulate(3, 1 / 30); // разогнаться (игрок, камера, спутники)
  const ds = [], cs = [], ks = [];
  let lp = pl.renderPos.clone(), lc = g.camera.position.clone(), lk = g.companions.list[0]?.position.clone();
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let tAll = 0;
  for (let i = 0; i < 240; i++) {
    const dt = 0.007 + rnd() * 0.012; // рваный кадр: 7..19 мс
    g.simulate(dt, dt); tAll += dt;
    ds.push(pl.renderPos.distanceTo(lp) / dt); lp.copy(pl.renderPos);
    cs.push(g.camera.position.distanceTo(lc) / dt); lc.copy(g.camera.position);
    if (lk) { ks.push(g.companions.list[0].position.distanceTo(lk) / dt); lk.copy(g.companions.list[0].position); }
  }
  st.fwd = 0;
  const cv = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return { mean: +m.toFixed(2), cv: +(Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) / (m || 1)).toFixed(3) }; };
  return { player: cv(ds), camera: cv(cs), companion: cv(ks) };
});
console.log('smoothness', J(smooth));
check('A. render speed of player steady (CV<0.12)', smooth.player.cv < 0.12, J(smooth.player));
check('A. camera speed steady (CV<0.2)', smooth.camera.cv < 0.2, J(smooth.camera));
check('A. companion speed steady (CV<0.3)', smooth.companion.cv < 0.3, J(smooth.companion));

// ---- B. прыжок ----
await page.evaluate(() => window.__rakis.debug.goto('start'));
const jump = await page.evaluate(() => {
  const g = window.__rakis, pl = g.player;
  g.simulate(1, 1 / 30);
  const y0 = pl.position.y; let apex = y0, landed = false, airT = 0, land = null;
  g.bus.on('land', (e) => { land = e.impact; });
  window.__in.jump = 1;
  g.simulate(2, 1 / 60, () => { apex = Math.max(apex, pl.position.y); if (!pl.grounded) airT += 1 / 60; });
  return { y0: +y0.toFixed(2), apex: +(apex - y0).toFixed(2), airT: +airT.toFixed(2), grounded: pl.grounded, yEnd: +(pl.position.y - y0).toFixed(2), land };
});
console.log('jump', J(jump));
check('B. jump apex 0.5..1.2 m, lands, grounded', jump.apex > 0.5 && jump.apex < 1.2 && jump.grounded && Math.abs(jump.yEnd) < 0.3, J(jump));

// ---- E. вверх по тропе в сиетч ----
// Щель (последние ~5 м) — извилистая трещина шириной ~1 м: бот идёт по заранее проверенным точкам (в мире), остальное — по тропе.
const CLEFT_WP = [[646.2, 251.7], [648.9, 251.4], [652.0, 250.6], [654.5, 250.2], [657.2, 252.1]];
const KS = 408; // индекс точки тропы у развилки: дальше тропа уходит в тупик-нишу, а щель поворачивает на восток
await page.evaluate(() => { window.__rakis.debug.goto('trail'); window.__rakis.simulate(1, 1 / 30); });
const trail = await page.evaluate(() => (window.__rakis.approach.trail || []).map((q) => [q.x, q.z]));
console.log('trail points', trail.length);
let ok2 = true;
for (let i = 0; i <= KS && ok2; i += 6) {
  const r = await page.evaluate(([x, z]) => window.__walk(x, z, 40), trail[i]);
  if (r.reason !== 'reached') { console.log('STUCK on trail up', i, J(r)); ok2 = false; }
}
if (ok2) {
  for (const [x, z] of CLEFT_WP) {
    const r = await page.evaluate(([x, z]) => window.__walk(x, z, 20, 0.45), [x, z]);
    if (r.reason !== 'reached') { console.log('STUCK in cleft', J([x, z]), J(r)); ok2 = false; break; }
  }
}
if (ok2) { const r = await page.evaluate(() => { const g = window.__rakis; const w = g.sietch.toWorld(14, 0, 0, new g.THREE.Vector3()); return window.__walk(w.x, w.z, 60); }); console.log('→ B1 airlock (local x=14)', J(r)); ok2 = r.reason === 'reached'; }
const inS = await page.evaluate(() => ({ space: window.__rakis.space, zone: window.__rakis.zone, p: window.__rakis.player.position.toArray().map((v) => +v.toFixed(1)) }));
check('E. trail up → cleft → sietch (seamless)', ok2 && inS.space === 'sietch', J(inS));

// ---- C. обратно: из сиетча через щель и вниз по тропе в пустыню ----
let ok = inS.space === 'sietch';
for (const [x, z] of CLEFT_WP.slice().reverse().slice(1).concat([trail[KS]])) {
  if (!ok) break;
  const w = await page.evaluate(([x, z]) => window.__walk(x, z, 25, 0.45), [x, z]);
  if (w.reason !== 'reached') { console.log('STUCK in cleft (out)', J([x, z]), J(w)); ok = false; }
}
const down = trail.slice(0, KS + 1).reverse();
for (let i = 0; i < down.length && ok; i += 6) {
  const r = await page.evaluate(([x, z]) => window.__walk(x, z, 40), down[i]);
  if (r.reason !== 'reached') { console.log('STUCK on trail down', i, J(r)); ok = false; }
}
const endPos = await page.evaluate(() => ({ p: window.__rakis.player.position.toArray().map((v) => +v.toFixed(1)), space: window.__rakis.space, zone: window.__rakis.zone }));
console.log('end of way back', J(endPos));
check('C. sietch → cleft → trail down to desert', ok && endPos.space === 'desert', J(endPos));
console.log('space log', J(await page.evaluate(() => window.__rakis.__trace.spaces)));

// ---- D. спрыгнуть с уступа ----
// верхние звенья тропы: идём «наружу» (на запад) и проверяем, что игрок может сойти с уступа и упасть до пустыни.
const cliff = await page.evaluate(() => {
  const g = window.__rakis, tr = g.approach.trail, pl = g.player;
  for (let i = Math.floor(tr.length * 0.5); i < tr.length * 0.95; i += 8) {
    const p = tr[i], y = p.y ?? g.heightAt(p.x, p.z);
    const out = g.heightAt(p.x - 14, p.z, y);
    if (y - out < 8) continue;
    pl.teleport(p.x, y, p.z, Math.PI); g.simulate(0.5, 1 / 30);
    // пробный проход: упали ли
    let air = 0; window.__in.fwd = 1;
    g.simulate(5, 1 / 30, () => { pl.cam.yaw = Math.PI; if (!pl.grounded) air += 1 / 30; });
    window.__in.fwd = 0;
    if (air > 0.5) { pl.teleport(p.x, y, p.z, Math.PI); g.simulate(0.5, 1 / 30); return { i, x: p.x, z: p.z, y, drop: y - out }; }
  }
  return null;
});
if (!cliff) check('D. found a ledge where the player can step off (drop > 8 m)', false);
else {
  console.log('ledge', J(cliff));
  const r = await page.evaluate(([x, z]) => window.__walk(x - 14, z, 20), [cliff.x, cliff.z]);
  const after = await page.evaluate(() => { const g = window.__rakis, pl = g.player; g.simulate(4, 1 / 30); return { y: +pl.position.y.toFixed(2), ground: +g.heightAt(pl.position.x, pl.position.z, pl.position.y).toFixed(2), grounded: pl.grounded }; });
  console.log('cliff jump', J(r), J(after));
  check('D. fell off ledge and landed on ground (airT>0.5s, no teleport)', r.airT > 0.5 && after.grounded && Math.abs(after.y - after.ground) < 0.3 && r.maxDy < 1.6, J({ ...r, after }));
}
console.log(errors.length ? 'ERRORS ' + J([...new Set(errors)].slice(0, 6)) : 'no console errors');
await browser.close();
process.exit(fail ? 1 : 0);
