// Отладочный снимок: сценарий пожирания до t секунд, выполнить --hack="js" (опц.), снять вид сверху (--view=aerial|side). node tools/worm_dbg_shot.mjs --devour=33 --hack="..."
import { join } from 'node:path';
import { openGame, capture, arg, root } from './lib/harness.mjs';

const { browser, page, errors } = await openGame({ file: arg('file', 'worm.html'), q: arg('q', 'low'), w: Number(arg('w', 640)), h: Number(arg('h', 360)), gl: arg('gl', 'swiftshader'), hideSubs: true, at: [270, 180], yaw: -1.9 });
await page.evaluate((t) => { window.__rakis.worm.playDevour(); window.__step(t, 1 / 30); }, Number(arg('devour', 33)));
if (arg('hack', '')) console.log(await page.evaluate((c) => { try { return String(eval(c)); } catch (e) { return 'ERR ' + e.message; } }, arg('hack', '')));
const view = arg('view', 'aerial');
const r = await capture(page, join(root, 'dist', 'shots', arg('tag', 'dbg')), `${arg('name', 'dbg')}_${view}`, {
  cameraFn: (v) => {
    const g = window.__rakis, d = g.worm.devourDirector, cam = g.camera;
    if (v === 'aerial') { cam.position.set(d.A.x - d.f.x * 90 + 40, d.gE + 260, d.A.z - d.f.z * 90 + 40); cam.fov = 60; }
    else if (v === 'top') { cam.position.set(d.A.x + 0.1, d.gE + 330, d.A.z); cam.fov = 70; }
    else { const side = { x: -d.f.z, z: d.f.x }; const gx = d.A.x + side.x * 230, gz = d.A.z + side.z * 230; cam.position.set(gx, g.heightAt(gx, gz) + 6, gz); cam.fov = 48; }
    cam.updateProjectionMatrix(); cam.lookAt(d.A.x, d.gE + (v === 'side' ? 45 : 5), d.A.z);
  }, camArg: view,
});
console.log(JSON.stringify(r));
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) console.error(uniq.join('\n'));
