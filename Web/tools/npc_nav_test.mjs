// Проверка навигации горожан сиетча (без рендера): связность целей занятий, качество путей A*, ритуальный сбор в зал.
//   node tools/npc_nav_test.mjs [--file=rakis_demo.html] [--ritual=1]
import { chromium } from 'playwright';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const file = arg('file', 'rakis_demo.html');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/AudioContext/.test(m.text())) errors.push(m.text()); });
try {
  await page.goto(`file://${root}/dist/${file}?autotest=1&q=low&lang=RU&drs=0&warm=0`, { timeout: 600000 });
  await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
  await page.evaluate(async () => { let a = 777; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; await window.__rakis.sietch.enter('B2'); window.requestAnimationFrame = () => 0; });
  const res = await page.evaluate((withRitual) => {
    const g = window.__rakis, S = g.sietch, c = S.crowd, nav = c.nav, plan = S.plan, ctx = S.ctx, spots = ctx.spots;
    const out = { checks: [], info: {} };
    const check = (name, ok, extra = '') => out.checks.push({ name, ok: !!ok, extra });
    const mainOf = (x, z) => { const k = nav.nearestCell(x, z, 1.5); return k >= 0 && nav.comp[k] === nav.mainComp; };
    // --- 1. цели занятий достижимы
    const bad = [];
    const T = [];
    for (const s of spots.stall) for (const o of [-0.9, 0, 0.9]) T.push(['stallFront', s.x + o, s.side * 3.3]);
    for (const s of spots.water) for (const o of [-0.9, 0, 0.9]) T.push(['waterFront', s.x + o, 3.7]);
    for (const s of spots.loom) T.push(['loomFront', s.x, s.z - 1.0]);
    if (spots.bench[0]) T.push(['bench', spots.bench[0].x + 1.8, spots.bench[0].z + 1.4]);
    if (spots.musician[0]) T.push(['music', spots.musician[0].x, spots.musician[0].z + 2]);
    if (spots.shrine[2]) T.push(['shrine', spots.shrine[2].x, spots.shrine[2].z]);
    for (const m of c.social.mealSpots) T.push(['meal', m.x, m.z]);
    for (const [k, x, z] of T) if (!mainOf(x, z)) bad.push(`${k}@${x.toFixed(1)},${z.toFixed(1)}`);
    out.info.targets = T.length; out.info.badTargets = bad.slice(0, 12);
    check('цели занятий в главной компоненте', bad.length <= Math.ceil(T.length * 0.08), `${bad.length}/${T.length}`);
    check('места трапезы найдены (>=10)', c.social.mealSpots.length >= 10, `${c.social.mealSpots.length}`);
    // --- 2. пути между случайными точками
    let seed = 99; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pts = []; for (let i = 0; i < 400 && pts.length < 120; i++) { const p = nav.randomPoint(44, 150, -22, 22, 0.6, R); if (p) pts.push(p); }
    let ok = 0, fail = 0, worstClr = 9, ratioSum = 0, nPath = 0, maxRatio = 0, ms = 0, wallBad = 0, samples = 0;
    for (let i = 0; i + 1 < pts.length; i += 2) {
      let res; const t0 = performance.now();
      nav.request(pts[i], pts[i + 1], (p) => { res = p || 'fail'; });
      let guard = 0; while (!res && guard++ < 5000) nav.pump(2000);
      ms += performance.now() - t0;
      if (!res || res === 'fail') { fail++; continue; }
      ok++;
      let len = 0, px = pts[i].x, pz = pts[i].z;
      for (const q of res) {
        const d = Math.hypot(q[0] - px, q[1] - pz), n = Math.max(1, Math.ceil(d / 0.25));
        for (let s = 1; s <= n; s++) { const x = px + ((q[0] - px) * s) / n, z = pz + ((q[1] - pz) * s) / n, w = plan.wallDistLocal(x, z, 0); samples++; if (w < 0.2) wallBad++; worstClr = Math.min(worstClr, w); }
        len += d; px = q[0]; pz = q[1];
      }
      const st = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z); if (st > 4) { const r = len / st; ratioSum += r; nPath++; maxRatio = Math.max(maxRatio, r); }
    }
    out.info.paths = { ok, fail, avgMs: +(ms / Math.max(1, ok + fail)).toFixed(2), worstClearance: +worstClr.toFixed(2), wallSamplesBad: wallBad, samples, avgRatio: +(ratioSum / Math.max(1, nPath)).toFixed(2), maxRatio: +maxRatio.toFixed(2) };
    check('A*: все пары найдены', fail === 0, `${fail} провалов`);
    check('A*: путь не заходит в стены (зазор >= 0.2 м)', wallBad === 0, `${wallBad}/${samples}, min ${worstClr.toFixed(2)}`);
    check('A*: средняя извилистость < 1.6', ratioSum / Math.max(1, nPath) < 1.6, `${(ratioSum / Math.max(1, nPath)).toFixed(2)}`);
    // --- 2b. правая полоса: пути с полосой смещены вправо относительно путей без полосы
    {
      let sum = 0, cnt = 0;
      for (let i = 0; i + 1 < pts.length; i += 2) {
        let a, b; nav.request(pts[i], pts[i + 1], (p) => { a = p || 'fail'; }, { lane: true }); nav.request(pts[i], pts[i + 1], (p) => { b = p || 'fail'; }, { lane: false });
        let guard = 0; while ((!a || !b) && guard++ < 5000) nav.pump(2000);
        if (!a || !b || a === 'fail' || b === 'fail' || a.length < 3) continue;
        // боковое смещение вершин a от ломаной b (вправо от хода — положительное)
        for (let k = 0; k < a.length - 1; k++) {
          const [x, z] = a[k]; let best = 1e9, sg = 0;
          for (let j = 0; j + 1 < b.length; j++) {
            const [x0, z0] = b[j], [x1, z1] = b[j + 1], dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2)), px = x0 + dx * u, pz = z0 + dz * u, d = Math.hypot(x - px, z - pz);
            if (d < best) { best = d; const l = Math.sqrt(l2); sg = ((x - px) * (-dz / l) + (z - pz) * (dx / l)); }
          }
          if (best < 1.2) { sum += sg; cnt++; }
        }
      }
      out.info.lane = { meanRightOffset: +(sum / Math.max(1, cnt)).toFixed(3), n: cnt };
      check('правая полоса: путь смещён вправо (> 0.05 м в среднем)', cnt > 20 && sum / cnt > 0.05, `${(sum / Math.max(1, cnt)).toFixed(3)} м, n=${cnt}`);
    }
    // --- 3. уплотнитель погреба закрыт для толпы: путь из галереи в погреб не строится
    { let res; nav.request({ x: 60, z: 0 }, { x: 125, z: 33 }, (p) => { res = p || 'fail'; }); let guard = 0; while (!res && guard++ < 5000) nav.pump(2000); check('погреб за уплотнителем закрыт для толпы', res === 'fail'); }
    // --- 4. ритуальный сбор
    if (withRitual) {
      const t0 = performance.now();
      g.sietch.startRitual();
      const el = c.npcs.filter((n) => n.rit);
      g.simulate(150, 1 / 20);
      const seated = el.filter((n) => n.mode === 'seat').length, walking = el.filter((n) => n.mode === 'walk').length;
      out.info.ritual = { eligible: el.length, seated, walking, ms: Math.round(performance.now() - t0) };
      check('ритуал: >=90% дошли и сели за 150 с', seated >= el.length * 0.9, `${seated}/${el.length}, ещё идут ${walking}`);
    }
    out.info.navStats = nav.stats; out.info.cells = nav.cellsOk; out.info.comps = nav.nComp;
    return out;
  }, arg('ritual', '1') !== '0');
  console.log(JSON.stringify(res.info));
  let fail = 0;
  for (const c of res.checks) { console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name} ${c.extra}`); if (!c.ok) fail++; }
  if (errors.length) { console.log('ERRORS', errors.slice(0, 5)); fail++; }
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exitCode = fail ? 1 : 0;
} finally { await browser.close(); }
