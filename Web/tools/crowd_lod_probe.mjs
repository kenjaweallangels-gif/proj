// Замер толпы сиетча по видам: draw calls, треугольники, состав LOD NPC + скриншоты.
//   node tools/crowd_lod_probe.mjs [--dir=<папка dist>] [--file=rakis_demo.html] [--tag=after] [--q=med] [--shots=1] [--only=a,b]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const dir = arg('dir', join(root, 'dist')), tag = arg('tag', 'after'), q = arg('q', 'med');
const only = arg('only', '').split(',').filter(Boolean);
const outDir = join(root, 'dist', 'shots', 'char_lod'); mkdirSync(outDir, { recursive: true });
// [имя, камера (локально в сиетче), цель, fov]
const VIEWS = [
  ['market_8m', [62, 1.7, 3.2], [61, 1.4, -4.0], 66],
  ['market_wide', [46, 1.8, 0.4], [70, 1.5, -1.0], 70],
  ['gallery_25m', [44, 2.2, -2], [88, 4, 3], 74],
  ['gallery_60m', [41.5, 1.8, 0.2], [100, 1.6, 0.4], 50],
  ['hall_wide', [152, 3.5, 12], [185, 0, -2], 82],
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--disable-dev-shm-usage', ...GL.swiftshader] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[figure_crowd]')) console.log('console', m.text().slice(0, 300)); });
await page.goto(`file://${join(dir, arg('file', 'rakis_demo.html'))}?autotest=1&q=${q}&lang=RU`, { timeout: 900000 });
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.0, null, { timeout: 1800000, polling: 2000 });
await page.evaluate(async () => {
  const g = window.__rakis; const w = g.world; if (w) { w.setVisible(false); w.setVisible = () => {}; }
  if (g.dialogue) g.dialogue.bark = () => null;
  await g.sietch.enter(); g.cinematic = { active: true, owner: 'shots' };
  for (const c of g.companions?.list || []) if (c.figure?.group) c.figure.group.visible = false;
  if (g.player?.figure?.group) g.player.figure.group.visible = false;
  const r = g.render; g.render = (dt) => { if (g.__shotCam) { g.camera.position.copy(g.__shotCam.pos); g.camera.quaternion.copy(g.__shotCam.quat); } r(dt); };
});
for (const [name, pos, tgt, fov] of VIEWS) {
  if (only.length && !only.includes(name)) continue;
  const res = await page.evaluate(async ([pos, tgt, fov]) => {
    const g = window.__rakis, cam = g.camera, S = g.sietch, ri = g.renderer.info, raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    cam.fov = fov; cam.updateProjectionMatrix();
    const w = S.toWorld(pos[0], pos[1], pos[2]), t = S.toWorld(tgt[0], tgt[1], tgt[2]);
    cam.position.copy(w); cam.lookAt(t); g.player?.position?.set(w.x, w.y - 1.6, w.z);
    g.__shotCam = { pos: cam.position.clone(), quat: cam.quaternion.clone() };
    for (let i = 0; i < 40; i++) await raf();
    ri.autoReset = false; ri.reset();
    const N = 4; for (let i = 0; i < N; i++) await raf();
    const calls = ri.render.calls / N, tris = ri.render.triangles / N; ri.autoReset = true;
    const npcs = S.crowd.npcs, cnt = { full: 0, imp: 0, off: 0 };
    for (const n of npcs) cnt[n.lod]++;
    // сколько NPC в кадре и их распределение по дистанциям (до 8 / 8–25 / 25–60 / >60 м)
    const inView = { n: 0, d8: 0, d25: 0, d60: 0, far: 0 };
    const f = new g.THREE.Frustum().setFromProjectionMatrix(new g.THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const v = new g.THREE.Vector3();
    for (const n of npcs) { if (n.lod === 'off') continue; v.copy(S.toWorld(n.x, n.y + 1, n.z)); if (!f.containsPoint(v)) continue; const d = v.distanceTo(cam.position); inView.n++; if (d < 8) inView.d8++; else if (d < 25) inView.d25++; else if (d < 60) inView.d60++; else inView.far++; }
    const far = S.crowd.farCrowd;
    return { calls: Math.round(calls), tris: Math.round(tris), lod: cnt, inView, farInstances: far ? far.items.filter((h) => h.vis).length : 0, farVariants: far ? far.variants.size : 0, fps: g.stats.fps };
  }, [pos, tgt, fov]);
  console.log(name.padEnd(14), JSON.stringify(res));
  if (arg('shots', '1') === '1') { await page.waitForTimeout(500); await page.screenshot({ path: join(outDir, `${tag}_sietch_${name}.png`), timeout: 600000 }); }
}
await browser.close();
