// Осмотр пасти: вертикальная колонна головы с заданным раскрытием/раструбом, несколько ракурсов.
// node tools/build.mjs --out=worm.html && node tools/worm_maw_look.mjs [--opens=0,0.15,0.5,1] [--scale=2.2] [--views=side,top,close,low]
import { join } from 'node:path';
import { openGame, capture, arg, root } from './lib/harness.mjs';
const outDir = join(root, 'dist', 'shots', arg('tag', 'maw'));
const { browser, page, errors } = await openGame({ file: arg('file', 'worm.html'), q: arg('q', 'med'), w: Number(arg('w', 1100)), h: Number(arg('h', 620)), at: [270, 180], yaw: -1.9, hideSubs: true });
const opens = arg('opens', '0,0.15,0.5,1').split(',').map(Number);
const views = arg('views', 'side,top,close,low').split(',');
const scale = Number(arg('scale', 2.2)), H = Number(arg('h0', 30));
await page.evaluate(([scale, H]) => {
  const g = window.__rakis, w = g.worm, V = g.THREE.Vector3;
  const A = { x: 300, z: 140 }, gy = g.heightAt(A.x, A.z);
  w.spine.reset(new V(A.x, gy - 70, A.z), 1, 0, (x, z) => g.heightAt(x, z), 70);
  for (let y = gy - 70; y <= gy + H; y += 1) w.spine.push(new V(A.x, y, A.z));
  w.spine.flare = scale; w.spine.flareLen = 90; w.body.headScale = scale;
  w.spine.compute(0, 0);
  w.body.group.visible = true;
  window.__A = { x: A.x, z: A.z, gy };
  window.__upd = (o) => { w.body.setOpen(o); w.spine.compute(0, 0); w.body.update(); };
}, [scale, H]);
let i = 0;
for (const o of opens) {
  await page.evaluate((o) => window.__upd(o), o);
  for (const v of views) {
    const r = await capture(page, outDir, `${String(i).padStart(2, '0')}_o${o}_${v}`, { minLum: 5, cameraFn: ([v, H, sc]) => {
      const g = window.__rakis, A = window.__A, cam = g.camera;
      const top = A.gy + H + 6 * sc;
      const pos = { side: [A.x - 150, A.gy + 20, A.z + 90, A.x, top - 6, A.z, 50], top: [A.x - 25, top + 70, A.z + 20, A.x, top - 10, A.z, 60], close: [A.x - 60, top + 22, A.z + 40, A.x, top - 4, A.z, 55], low: [A.x - 110, A.gy + 4, A.z + 40, A.x, top, A.z, 45] }[v];
      cam.position.set(pos[0], pos[1], pos[2]); cam.fov = pos[6]; cam.updateProjectionMatrix(); cam.lookAt(pos[3], pos[4], pos[5]);
    }, camArg: [v, H, scale] });
    console.log(`o=${o} ${v}`.padEnd(18), `lum=${r.lum} nan=${r.nan}/${r.inf}${r.bad ? ' BAD' : ''}`);
  }
  i++;
}
await browser.close();
const u = [...new Set(errors)]; if (u.length) console.error('КОНСОЛЬ:\n' + u.slice(0, 15).join('\n'));
