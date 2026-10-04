// Проба «зависаний» персонажа (жалоба: «персонаж иногда замирает»). Без рендера: game.simulate шагает симуляцию на CPU.
// На каждом тике пишет: скорость игрока (renderPos), движение камеры, позу ног/рук фигуры, состояние походки; затем ищет «зависания» ≥ 150 мс:
//   PLAYER — ввод вперёд удержан, а фигура движется заметно медленнее ожидаемого, и впереди нет стены/уступа (физика позволяет);
//   CAMERA — игрок бежит, а камера почти не смещается;
//   ANIM   — тело движется (>1 м/с), а поза ног/рук не меняется (стоп анимации, пауза «песка», S.hitch, беговая дорожка).
// Для каждого зависания печатается причина (тег): sandpause/freeze/hitch/airborne/treadmill/collide/slope/unknown.
//   node tools/hang_probe.mjs [--file=rakis_demo.html] [--sand=0|1|2] [--jitter=0|1] [--route=erg,trail,sietch,garden,desert,harvester,worm] [--min=150] [--json=out.json]
//   --sand: 0 — обычный шаг (Shift не нужен), 1 — всё время «походка по песку» (Alt), 2 — чередовать каждые 20 с.
//   Код возврата 1, если найдено хотя бы одно «необъяснённое» зависание игрока/анимации (не физическая стена).
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const file = arg('file', 'rakis_demo.html');
const SAND = +arg('sand', 0), JITTER = +arg('jitter', 0), MIN_MS = +arg('min', 150);
const ROUTE = arg('route', 'erg,trail,sietch,garden,desert,harvester,worm').split(',');
const SEED = +arg('seed', 1);
const jsonOut = arg('json', '');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext/.test(m.text())) errors.push(m.text()); });
await page.goto(`file://${root}/dist/${file}?autotest=1&q=low&lang=RU&drs=0&warm=0`, { timeout: 300000 });
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });

await page.evaluate(([SAND, JITTER, MIN_MS, SEED]) => {
  const g = window.__rakis, pl = g.player;
  const st = { fwd: 0, run: 0 };
  g.input.axis = () => ({ x: 0, y: st.fwd });
  const held = g.input.held; g.input.held = (a) => (a === 'Sprint' ? !!st.run : held(a));
  const key = (down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: 'AltLeft' }));
  // замер CPU-времени каждого модуля за тик (всплески > 3×медианы — кандидаты в «микро-стопы»: заливка террейна/сада/сиетча, GC, ...)
  const modT = (window.__modT = {});
  for (const m of g.modules) for (const k of ['update', 'lateUpdate']) {
    const f = m.mod[k]; if (typeof f !== 'function') continue;
    m.mod[k] = function (...a) { const t0 = performance.now(); try { return f.apply(this, a); } finally { modT[m.name] = (modT[m.name] || 0) + performance.now() - t0; } };
  }
  let seed = SEED * 7919 + 13; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const L = pl.figure.parts.limbs;
  const poseSig = () => [L.L.hip.rotation.x, L.R.hip.rotation.x, L.L.kn.rotation.x, L.R.kn.rotation.x, L.L.sh.rotation.x, L.R.sh.rotation.x, pl.figure.parts.pelvis.position.y * 3];
  const OWN = { ignore: new Set(['player', 'companion:Ilva', 'companion:Rayn', 'companion:Ossana']) };
  const probe = new g.THREE.Vector3();
  const blockedAhead = (yaw) => {
    const p = pl.position;
    probe.set(p.x + Math.cos(yaw) * 0.32, p.y, p.z + Math.sin(yaw) * 0.32);
    const c = g.collide(probe, 0.35, OWN) && Math.hypot(probe.x - p.x - Math.cos(yaw) * 0.32, probe.z - p.z - Math.sin(yaw) * 0.32) > 0.06;
    const h = g.heightAt(p.x + Math.cos(yaw) * 0.45, p.z + Math.sin(yaw) * 0.45, p.y + 0.3) - p.y > 0.5;
    return c || h;
  };
  const rec = (window.__rec = []);
  window.__spaces = [];
  g.bus.on('space', (e) => window.__spaces.push(`${e.from}→${e.space}`));
  let simT = 0, sandOn = false;
  const setSand = (on) => { if (on !== sandOn) { sandOn = on; key(on); } };

  /** Идти sec секунд: к точке target ({x,z}) или «бродить» (target=null). Пишет записи в __rec с меткой label. */
  window.__drive = (label, target, sec, tol = 1.5) => {
    st.fwd = 1;
    let heading = rnd() * 6.28, headT = 0, lastBest = 0, best = 1e9, side = 0, sideT = 0, t = 0, stuckT = 0;
    let lp = pl.renderPos.clone(), lc = g.camera.position.clone(), lps = poseSig(), lphi = pl.figure._anim.state?.phi ?? 0, held0 = 0;
    const start = rec.length;
    const dtOf = () => (JITTER ? 0.007 + rnd() * 0.012 : 1 / 60);
    let n = 0;
    for (; t < sec;) {
      const dt = dtOf(); t += dt; simT += dt;
      if (SAND === 1) setSand(true); else if (SAND === 2) setSand(Math.floor(simT / 20) % 2 === 1); else setSand(false);
      // курс
      let yaw;
      if (target) {
        const dx = target.x - pl.position.x, dz = target.z - pl.position.z, d = Math.hypot(dx, dz);
        if (d < tol) break;
        if (d < best - 0.25) { best = d; lastBest = t; }
        if (t - lastBest > 1.2) { sideT += dt; if (sideT < 1.3) side = side || 1.1; else { sideT = 0; side = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 1.3); lastBest = t - 0.6; } } else side = 0;
        yaw = Math.atan2(dz, dx) + side;
      } else {
        // бродим; упёрлись в стену (скорость мала ≥0.3 с) — сразу выбираем новый курс, чтобы тест не «висел» на препятствии
        headT -= dt; if (pl.speed < 0.6 && n > 40) stuckT += dt; else stuckT = 0;
        if (headT <= 0 || stuckT > 0.3) { headT = 1.5 + rnd() * 3; heading += stuckT > 0.3 ? (rnd() < 0.5 ? -1 : 1) * (1.2 + rnd() * 1.6) : (rnd() - 0.5) * 2.2; stuckT = 0; }
        yaw = heading;
      }
      pl.cam.yaw = yaw;
      for (const k in modT) modT[k] = 0;
      const w0 = performance.now();
      g.simulate(dt, dt);
      const wall = performance.now() - w0;
      let topM = '', topV = 0; for (const k in modT) if (modT[k] > topV) { topV = modT[k]; topM = k; }
      const S = pl.figure._anim.state || {};
      const sig = poseSig();
      let pd = 0; for (let i = 0; i < sig.length; i++) pd += Math.abs(sig[i] - lps[i]);
      const mv = pl.renderPos.distanceTo(lp), cm = g.camera.position.distanceTo(lc);
      held0 += dt;
      rec.push({
        label, t: simT, dt, held: held0, v: mv / dt, cv: cm / dt, pd: pd / dt, spd: pl.speed, gr: pl.grounded, env: pl.figure.gait.env, hitch: S.hitch || 0,
        mode: S.mode, wMove: S.wMove, wD: S.wDesert, phi: S.phi, dphi: Math.abs((S.phi ?? 0) - lphi), speedL: S.speedL, sand: pl.moveMode === 'desert', slope: pl.slope,
        wall, topM, topV, blocked: blockedAhead(yaw), space: g.space, x: pl.position.x, z: pl.position.z,
      });
      lp.copy(pl.renderPos); lc.copy(g.camera.position); lps = sig; lphi = S.phi ?? 0; n++;
    }
    st.fwd = 0;
    return { n, t: +t.toFixed(1), reached: !!target && Math.hypot(target.x - pl.position.x, target.z - pl.position.z) < tol };
  };
  window.__stop = () => { st.fwd = 0; setSand(false); };
}, [SAND, JITTER, MIN_MS, SEED]);

// ---- маршрут ----
const J = (o) => JSON.stringify(o);
const drive = (label, target, sec, tol) => page.evaluate(([l, t, s, tl]) => window.__drive(l, t, s, tl), [label, target, sec, tol]);
const goto = (name) => page.evaluate(async (n) => { await window.__rakis.debug.goto(n); window.__rakis.simulate(1, 1 / 30); }, name);
const log = (m) => console.log(m);

if (ROUTE.includes('erg')) {
  await goto('erg');
  for (const [x, z] of [[279, 95], [360, 140], [450, 189], [531, 252], [603, 344]]) log('erg ' + J(await drive('erg', { x, z }, 90, 2.5)));
}
if (ROUTE.includes('trail')) {
  await goto('trail');
  const trail = await page.evaluate(() => (window.__rakis.approach.trail || []).map((q) => [q.x, q.z]));
  for (let i = 0; i <= 408; i += 6) { const r = await drive('trail', { x: trail[i][0], z: trail[i][1] }, 40, 1.2); if (!r.reached) { log('trail stuck at ' + i); break; } }
  for (const [x, z] of [[646.2, 251.7], [648.9, 251.4], [652.0, 250.6], [654.5, 250.2], [657.2, 252.1]]) await drive('cleft', { x, z }, 20, 0.45);
}
if (ROUTE.includes('sietch')) {
  for (const pt of ['sietch', 'market', 'hall']) { await goto(pt); log(`sietch/${pt} ` + J(await drive('sietch:' + pt, null, 40))); }
}
if (ROUTE.includes('garden')) { await goto('garden'); log('garden ' + J(await drive('garden', null, 50))); }
if (ROUTE.includes('desert')) { await goto('A3'); log('desert-A3 ' + J(await drive('desert', null, 50))); await goto('start'); log('desert-start ' + J(await drive('desert', null, 50))); }
if (ROUTE.includes('harvester')) {
  await page.evaluate(() => { const g = window.__rakis, h = g.harvester; if (g.ui?.startGame && !g.ui.started) g.ui.startGame({ silent: true }); if (h?.position) { g.player.teleport(h.position.x - 30, g.heightAt(h.position.x - 30, h.position.z), h.position.z, 0); g.simulate(1, 1 / 30); } });
  log('harvester ' + J(await drive('harvester', await page.evaluate(() => { const h = window.__rakis.harvester?.position; return h ? { x: h.x - 8, z: h.z } : null; }), 40, 3)));
  log('harvester-wander ' + J(await drive('harvester', null, 40)));
}
if (ROUTE.includes('worm')) { await goto('worm'); await page.evaluate(() => window.__rakis.simulate(8, 1 / 30)); log('worm ' + J(await drive('worm', null, 60))); }

// ---- анализ ----
const res = await page.evaluate(([MIN_MS]) => {
  const rec = window.__rec, min = MIN_MS / 1000;
  const out = { ticks: rec.length, seconds: +rec.reduce((s, r) => s + r.dt, 0).toFixed(1), hangs: [] };
  const run = (kind, test, tag) => {
    let i = 0;
    while (i < rec.length) {
      if (!test(rec[i])) { i++; continue; }
      let j = i, dur = 0;
      while (j < rec.length && test(rec[j]) && rec[j].label === rec[i].label) { dur += rec[j].dt; j++; }
      if (dur >= min) {
        const seg = rec.slice(i, j), tags = {};
        for (const r of seg) { const k = tag(r); tags[k] = (tags[k] || 0) + 1; }
        const top = Object.entries(tags).sort((a, b) => b[1] - a[1])[0][0];
        out.hangs.push({ kind, ms: Math.round(dur * 1000), at: seg[0].label + '@' + seg[0].t.toFixed(1), pos: [+seg[0].x.toFixed(0), +seg[0].z.toFixed(0)], cause: top, tags, vMean: +(seg.reduce((s, r) => s + r.v, 0) / seg.length).toFixed(2) });
      }
      i = j;
    }
  };
  const causeP = (r) => !r.gr ? 'airborne' : r.blocked ? 'wall' : r.hitch > 0 ? 'hitch' : r.sand && r.env < 0.2 ? 'sandpause' : r.slope > 38 ? 'slope' : r.wMove < 0.5 ? 'animlag' : 'unknown';
  // PLAYER: ввод удержан ≥0.5 с, а скорость фигуры мала. Порог: обычный шаг 0.8 м/с, песок 0.4 м/с.
  run('PLAYER', (r) => r.held > 0.5 && r.v < (r.sand ? 0.4 : 0.8), causeP);
  // CAMERA: игрок движется, камера нет
  run('CAMERA', (r) => r.v > 1.5 && r.cv < 0.3, () => 'camera');
  // ANIM: тело движется, поза не меняется
  run('ANIM', (r) => r.v > 1.0 && r.pd < 0.05, (r) => r.hitch > 0 ? 'hitch' : r.sand ? (r.env < 0.2 ? 'sandpause' : 'sandbeat') : r.mode !== 'gait' ? 'mode:' + r.mode : r.wMove < 0.5 ? 'wMove' : 'unknown');
  // «Рывки скорости»: доля времени, когда игрок идёт ≥1 с, но v < 50% от медианы
  const walking = rec.filter((r) => r.held > 1 && !r.blocked && r.gr);
  const vs = walking.map((r) => r.v).sort((a, b) => a - b);
  out.walkMedianV = +(vs[vs.length >> 1] || 0).toFixed(2);
  out.slowFrac = +(walking.filter((r) => r.v < 0.5 * out.walkMedianV).length / (walking.length || 1)).toFixed(3);
  out.unexplained = out.hangs.filter((h) => (h.kind === 'PLAYER' || h.kind === 'ANIM') && !['wall', 'airborne'].includes(h.cause));
  out.byCause = {};
  for (const h of out.hangs) { const k = h.kind + ':' + h.cause; (out.byCause[k] ||= { n: 0, ms: 0, max: 0 }); out.byCause[k].n++; out.byCause[k].ms += h.ms; out.byCause[k].max = Math.max(out.byCause[k].max, h.ms); }
  const ws = rec.map((r) => r.wall).sort((a, b) => a - b);
  out.tick = { medMs: +ws[ws.length >> 1].toFixed(2), p99Ms: +ws[Math.floor(ws.length * 0.99)].toFixed(2), maxMs: +ws[ws.length - 1].toFixed(1) };
  out.spikes = rec.filter((r) => r.wall > Math.max(12, 4 * ws[ws.length >> 1])).sort((a, b) => b.wall - a.wall).slice(0, 8).map((r) => `${r.label}@${r.t.toFixed(1)} ${r.wall.toFixed(0)}мс модуль=${r.topM}(${r.topV.toFixed(0)})`);
  out.spaces = window.__spaces;
  return out;
}, [MIN_MS]);

console.log(`\nsand=${SAND} jitter=${JITTER} ticks=${res.ticks} (${res.seconds} с) walkMedianV=${res.walkMedianV} slowFrac=${res.slowFrac}`);
console.log('by cause:', J(res.byCause));
console.log('tick CPU (без рендера):', J(res.tick), '\n  всплески:', J(res.spikes));
for (const h of res.hangs.slice(0, 40)) console.log(`  ${h.kind.padEnd(6)} ${String(h.ms).padStart(5)} мс  ${h.at.padEnd(18)} [${h.pos}] ${h.cause} v=${h.vMean}`);
if (res.hangs.length > 40) console.log(`  ... и ещё ${res.hangs.length - 40}`);
console.log(`space log: ${J(res.spaces)}`);
console.log(errors.length ? 'ERRORS ' + J([...new Set(errors)].slice(0, 6)) : 'no console errors');
if (jsonOut) writeFileSync(jsonOut, J(res));
const bad = res.hangs.filter((h) => (h.kind === 'PLAYER' || h.kind === 'ANIM') && h.cause !== 'wall' && h.cause !== 'airborne').length + res.hangs.filter((h) => h.kind === 'CAMERA').length;
console.log(bad ? `FAIL: ${bad} зависаний ≥ ${MIN_MS} мс (необъяснённых физикой)` : `PASS: зависаний ≥ ${MIN_MS} мс нет`);
await browser.close();
process.exit(bad ? 1 : 0);
