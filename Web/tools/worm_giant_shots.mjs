// Быстрые кадры гигантского червя без прогона всей сцены (debugEncounter): общий план, вид из группы, наездники, вблизи, пожиратель.
// node tools/build.mjs --out=worm.html && node tools/worm_giant_shots.mjs --stage=arrive|rest|devour [--w=640 --h=360 --q=low --views=over,top,pov,side,riders,maw --tag=...]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, capture, arg, root } from './lib/harness.mjs';

const stage = arg('stage', 'rest');
const outDir = join(root, 'dist', 'shots', arg('tag', `gs_${stage}`));
const views = arg('views', 'over,top,pov,side,riders').split(',');
const { browser, page, errors } = await openGame({ file: arg('file', 'worm.html'), q: arg('q', 'low'), w: Number(arg('w', 640)), h: Number(arg('h', 360)), at: [Number(arg('px', 270)), Number(arg('pz', 180))], yaw: Number(arg('yaw', -1.9)), hideSubs: true });
await page.evaluate(() => {
  const st = document.createElement('style'); st.textContent = 'body > *:not(canvas) { visibility: hidden !important; }'; document.head.appendChild(st);
  window.__rakis.freecam?.detach?.();
});
const frames = [];
await page.evaluate((h) => { window.__topH = h; }, Number(arg('toph', 500)));
if (arg('hide', '')) await page.evaluate((h) => { for (const n of h.split(',')) { const o = n.split('.').reduce((a, k) => a?.[k], window.__rakis); if (o) Object.defineProperty(o, 'visible', { get: () => false, set() {} }); } }, arg('hide', ''));
if (stage === 'devour') {
  await page.evaluate(() => { window.__rakis.worm.playDevour({ teleport: false }); });
  const d = await page.evaluate(() => { const d = window.__rakis.worm.devourDirector; return { erupt: d.tErupt, snap: d.tSnap }; });
  await page.evaluate(([s]) => window.__step(s, 1 / 10), [d.erupt + Number(arg('after', 3))]);
} else if (stage !== 'none') {
  await page.evaluate(([stage, u]) => { const w = window.__rakis.worm; w.playReveal(); w.debugEncounter({ stage, u: u || undefined }); }, [stage, Number(arg('u', 0))]);
  await page.evaluate(() => window.__step(Number(1.5), 1 / 10));
}
await page.evaluate(() => window.__rakis.freecam?.detach?.());
if (arg('lodstep', '')) await page.evaluate((h) => { const b = window.__rakis.worm.body; b.LOD.steps = [[1e9, h]]; b._lodDirty = true; }, Number(arg('lodstep', 4)));
const info = await page.evaluate(() => { const g = window.__rakis, w = g.worm, sp = w.spine, P = sp.P; let ex = 0; for (let i = 0; i < 401; i++) if (sp.EX[i]) ex++; return { head: [P[0], P[1], P[2]].map((v) => +v.toFixed(0)), exposedM: ex * 4, hs: w.body.headScale, spread: sp.spread, rows: w.body.rows }; });
console.log('scene:', JSON.stringify(info));
let idx = 0;
for (const v of views) {
  const ok = await page.evaluate(([v, stage]) => {
    const g = window.__rakis, V = g.THREE.Vector3, w = g.worm, sp = w.spine, P = sp.P, pl = g.player.position, fc = g.freecam;
    const ex = []; for (let i = 0; i < 401; i++) if (sp.EX[i]) ex.push(i);
    const i0 = ex.length ? ex[0] : 0, i1 = ex.length ? ex[ex.length - 1] : 0, im = (i0 + i1) >> 1;
    const mid = new V(P[im * 3], P[im * 3 + 1], P[im * 3 + 2]), head = new V(P[0], P[1], P[2]);
    const span = Math.hypot(P[i0 * 3] - P[i1 * 3], P[i0 * 3 + 2] - P[i1 * 3 + 2]);
    const dir = new V(head.x - mid.x, 0, head.z - mid.z).normalize(), side = new V(-dir.z, 0, dir.x); if (side.x > 0) side.negate();   // камера со стороны пустыни (хребет — на востоке)
    let cam = null, look = null, fov = 60;
    if (v === 'over') { cam = mid.clone().addScaledVector(side, Math.max(600, span * 0.95)); cam.y = g.heightAt(mid.x, mid.z) + Math.max(350, span * 0.45); look = mid.clone(); fov = 58; }
    else if (v === 'top') { cam = mid.clone().add(new V(0, Math.max(Number(window.__topH || 500), span * 0.55 * 0), 0)).addScaledVector(side, Math.max(450, span * 0.5)); look = mid.clone(); fov = 60; }
    else if (v === 'pov') { cam = new V(pl.x, g.heightAt(pl.x, pl.z) + 1.7, pl.z); look = head.clone().add(new V(0, 12, 0)); fov = 62; }
    else if (v === 'ridge') { cam = new V(pl.x, g.heightAt(pl.x, pl.z) + 40, pl.z).addScaledVector(dir, -60); look = mid.clone(); fov = 80; }
    else if (v === 'side') { cam = head.clone().addScaledVector(side, 260).addScaledVector(dir, -120); cam.y = g.heightAt(cam.x, cam.z) + 25; look = head.clone().addScaledVector(dir, -150).add(new V(0, 12, 0)); fov = 62; }
    else if (v === 'riders' && w.riders.items) { const e = w.riders.items[2].root.matrix.elements; const o = new V(e[12], e[13], e[14]); cam = o.clone().add(new V(8, 3, 9)); look = o.clone().add(new V(0, 1.5, 0)); fov = 50; }
    else if (v === 'ridersfar') { const e = w.riders.items[2].root.matrix.elements; const o = new V(e[12], e[13], e[14]); cam = o.clone().add(new V(70, 25, 90)); look = o.clone().add(new V(0, 10, 0)); fov = 45; }
    else if (v === 'maw') { cam = head.clone().addScaledVector(dir, 140).addScaledVector(side, 90); cam.y = head.y + 35; look = head.clone().add(new V(0, 12, 0)); fov = 55; }
    else if (v === 'devour') { const d = w.devourDirector; cam = new V(d.A.x, 0, d.A.z).addScaledVector(new V(-d.f.z, 0, d.f.x), 260); cam.y = d.gE + 60; look = new V(d.A.x, d.gE + 30, d.A.z); fov = 60; }
    else if (v === 'devour_near') { const d = w.devourDirector; cam = new V(d.A.x, 0, d.A.z).addScaledVector(new V(-d.f.z, 0, d.f.x), 130).addScaledVector(d.f, -90); cam.y = d.gE + 30; look = new V(d.A.x, d.gE + 20, d.A.z); fov = 62; }
    else if (v === 'high') { cam = new V(pl.x - 450, 650, pl.z); look = new V(pl.x, 0, pl.z); fov = 60; }
    if (!cam) return false;
    fc.place(cam, look); if (window.__hide) for (const n of window.__hide) { const o = n.split('.').reduce((a, k) => a?.[k], g); if (o) o.visible = false; } g.camera.fov = fov; g.camera.updateProjectionMatrix();
    return true;
  }, [v, stage]);
  if (!ok) continue;
  await page.evaluate(() => window.__step(0.1, 1 / 10));
  const r = await capture(page, outDir, `${String(idx++).padStart(2, '0')}_${v}`, { minLum: 10 });
  const ri = await page.evaluate(() => ({ calls: window.__rakis.renderer.info.render.calls, tris: window.__rakis.renderer.info.render.triangles }));
  frames.push({ ...r, ...ri, view: v });
  console.log(v.padEnd(12), `lum=${r.lum} nan=${r.nan}/${r.inf} tris=${(ri.tris / 1000).toFixed(0)}k calls=${ri.calls}${r.bad ? '  <-- BAD' : ''}`);
}
const uniq = [...new Set(errors)];
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ info, frames }, null, 1));
await browser.close();
if (uniq.length) console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 20).join('\n'));
process.exit(uniq.length || frames.some((f) => f.bad) ? 1 : 0);
