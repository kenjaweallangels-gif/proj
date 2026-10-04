// Проба гигантского червя: размеры тела, маршрут и остановка, расстояния до игрока/харвестера, NaN, стоимость CPU, кадры общим планом.
// node tools/build.mjs --out=worm.html && node tools/worm_giant_probe.mjs [--scene=arrival|devour] [--w=480 --h=270 --q=low --views=top,pov,side,riders --tag=giant]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, capture, arg, root } from './lib/harness.mjs';

const scene = arg('scene', 'arrival');
const outDir = join(root, 'dist', 'shots', arg('tag', `giant_${scene}`));
const views = arg('views', 'top,pov,side,riders').split(',');
const dt = Number(arg('dt', 1 / 12));
const { browser, page, errors } = await openGame({ file: arg('file', 'worm.html'), q: arg('q', 'low'), w: Number(arg('w', 480)), h: Number(arg('h', 270)), at: [Number(arg('px', 270)), Number(arg('pz', 180))], yaw: Number(arg('yaw', -1.9)), hideSubs: true });
await page.evaluate(() => { const w = window.__rakis.worm, u0 = w.update, l0 = w.lateUpdate; window.__wms = 0; window.__wn = 0; w.update = (a, b) => { const t = performance.now(); u0(a, b); window.__wms += performance.now() - t; window.__wn++; }; w.lateUpdate = (a, b) => { const t = performance.now(); l0(a, b); window.__wms += performance.now() - t; }; });

const stat = () => page.evaluate((scene) => {
  const g = window.__rakis, w = g.worm, sp = w.spine, P = sp.P, pl = g.player.position;
  const N = sp.EX.length > 401 ? 401 : 401;
  let nan = 0; for (let i = 0; i < N * 3; i++) if (!Number.isFinite(P[i])) nan++;
  let dMin = 1e9, dHead = Math.hypot(P[0] - pl.x, P[2] - pl.z), dHarv = 1e9, ex = 0, hMax = -1e9;
  const hv = g.harvester?.position;
  for (let i = 0; i < N; i++) {
    if (!sp.EX[i]) continue; ex++;
    dMin = Math.min(dMin, Math.hypot(P[i * 3] - pl.x, P[i * 3 + 2] - pl.z) - 20 * sp.RS[i]);
    if (hv) dHarv = Math.min(dHarv, Math.hypot(P[i * 3] - hv.x, P[i * 3 + 2] - hv.z) - 20 * sp.RS[i]);
    hMax = Math.max(hMax, P[i * 3 + 1] - sp.GY[i] + 20 * sp.RS[i]);
  }
  let L = 0; for (let i = 1; i < N; i++) L += Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 1] - P[i * 3 - 2], P[i * 3 + 2] - P[i * 3 - 1]);
  const phase = w.encounterPhase() !== 'none' ? w.encounterPhase() : w.devourPhase();
  return { t: +(g.time - window.__t0).toFixed(1), phase, head: [P[0], P[1], P[2]].map((v) => +v.toFixed(0)), v: +w.K.speed.toFixed(1), exposedLenM: ex * 4, topAbove: +hMax.toFixed(1), len: +L.toFixed(0), nan, dHead: +dHead.toFixed(0), dBody: +dMin.toFixed(0), dHarvester: +dHarv.toFixed(0), rows: w.body.rows, shake: +(g.shake || 0).toFixed(3), bodyDist: +w.bodyDistance().toFixed(0) };
}, scene);
const step = async (s) => { const t0 = Date.now(); await page.evaluate(([s, d]) => { window.__wms = 0; window.__wn = 0; window.__step(s, d); }, [s, dt]); return Date.now() - t0; };
const frames = [];
let idx = 0;
async function shots(label) {
  for (const v of views) {
    const c = await page.evaluate(([v, scene]) => {
      const g = window.__rakis, V = g.THREE.Vector3, w = g.worm, sp = w.spine, P = sp.P, pl = g.player.position, fc = g.freecam;
      const ex = []; for (let i = 0; i < 401; i++) if (sp.EX[i]) ex.push(i);
      const i0 = ex.length ? ex[0] : 0, i1 = ex.length ? ex[ex.length - 1] : 0, im = (i0 + i1) >> 1;
      const mid = new V(P[im * 3], P[im * 3 + 1], P[im * 3 + 2]), head = new V(P[0], P[1], P[2]);
      const span = Math.hypot(P[i0 * 3] - P[i1 * 3], P[i0 * 3 + 2] - P[i1 * 3 + 2]);
      let cam = null, look = null;
      if (v === 'top') { cam = mid.clone().add(new V(0.01, Math.max(900, span * 1.05), 0.01)); look = mid.clone(); }
      else if (v === 'pov') { cam = new V(pl.x, g.heightAt(pl.x, pl.z) + 1.7, pl.z); look = head.clone().add(new V(0, 10, 0)); }
      else if (v === 'side') { const d = new V(head.x - mid.x, 0, head.z - mid.z); const s = new V(-d.z, 0, d.x).normalize().multiplyScalar(Math.max(700, span * 0.9)); cam = mid.clone().add(s); cam.y = Math.max(cam.y, g.heightAt(cam.x, cam.z)) + 90; look = mid.clone().lerp(head, 0.3); }
      else if (v === 'riders' && w.riders.items) { const e = w.riders.items[2].root.matrix.elements; const o = new V(e[12], e[13], e[14]); cam = o.clone().add(new V(7, 4, 8)); look = o.clone().add(new V(0, 1.5, 0)); }
      else if (v === 'maw') { cam = head.clone().add(new V(120, 40, 120)); look = head.clone().add(new V(0, 10, 0)); }
      if (!cam) return null;
      fc.place(cam, look); g.camera.fov = v === 'riders' ? 50 : 60; g.camera.updateProjectionMatrix();
      return { cam: cam.toArray().map((x) => +x.toFixed(0)) };
    }, [v, scene]);
    if (!c) continue;
    await page.evaluate(() => window.__step(0.1, 1 / 12));
    const r = await capture(page, outDir, `${String(idx).padStart(2, '0')}_${label}_${v}`, { minLum: 10 });
    const ri = await page.evaluate(() => ({ calls: window.__rakis.renderer.info.render.calls, tris: window.__rakis.renderer.info.render.triangles }));
    frames.push({ ...r, ...ri, view: v });
    console.log(`${String(idx).padStart(2, '0')}_${label}_${v}`.padEnd(26), `lum=${r.lum} nan=${r.nan}/${r.inf} tris=${(ri.tris / 1000).toFixed(0)}k calls=${ri.calls}${r.bad ? '  <-- BAD' : ''}`);
  }
  idx++;
}

console.log('pre :', JSON.stringify(await stat()));
const log = [];
if (scene === 'arrival') {
  await page.evaluate(() => { window.__rakis.worm.playReveal(); });
  await page.evaluate(() => { window.__rakis.freecam.detach?.(); });
  const got = new Set();
  let guard = 0, cpu = 0;
  while (guard++ < 400) {
    await step(2);
    const w = await page.evaluate(() => ({ ms: window.__wms / Math.max(1, window.__wn) }));
    cpu = Math.max(cpu, w.ms);
    const s = await stat(); log.push(s);
    if (guard % 5 === 0) console.log(JSON.stringify(s), 'wormMs/step', w.ms.toFixed(2));
    if (s.nan) console.error('NaN!', JSON.stringify(s));
    if (s.phase === 'stop' && !got.has('stop')) { got.add('stop'); await step(12); console.log('stop:', JSON.stringify(await stat())); await shots('stop'); }
    if (s.phase === 'dismount' && !got.has('dismount')) { got.add('dismount'); await step(8); await shots('dismount'); }
    if (s.phase === 'talk' || s.phase === 'rest') break;
  }
  const last = await stat();
  console.log('FINAL:', JSON.stringify(last), '| worm CPU max per step (ms, loaded machine):', cpu.toFixed(2));
  console.log('closest body-to-player over scene:', Math.min(...log.map((s) => s.dBody)), 'm; closest head:', Math.min(...log.map((s) => s.dHead)));
  console.log('maxShake:', Math.max(...log.map((s) => s.shake)));
} else {
  await page.evaluate(() => { window.__rakis.worm.playDevour({ teleport: false }); });
  await page.evaluate(() => { window.__rakis.freecam.detach?.(); });
  const d = await page.evaluate(() => { const d = window.__rakis.worm.devourDirector; return { erupt: d.tErupt, snap: d.tSnap, retract: d.tRetract0 }; });
  await step(d.erupt + 2.5);
  console.log('devour@erupt+2.5', JSON.stringify(await stat()));
  await shots('erupt');
  await step(d.snap - d.erupt + 1.5);
  await shots('swallow');
  const m = await page.evaluate(() => { const g = window.__rakis, w = g.worm; return { hs: w.body.headScale, holeR: w.devourDirector.holeR, spread: w.spine.spread, flare: w.spine.flare, harv: g.harvester.state }; });
  console.log('devour sizes:', JSON.stringify(m));
}
const uniq = [...new Set(errors)];
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ log, frames }, null, 1));
await browser.close();
if (uniq.length) console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 20).join('\n'));
process.exit(uniq.length || frames.some((f) => f.bad) ? 1 : 0);
