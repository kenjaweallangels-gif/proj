// Проверка в настоящей игре: подключение борта к ядру (game.heightAt/collide), прогулка от грунта до мостика, снимки снаружи и изнутри, draw calls.
// node tools/build.mjs --out=harvester.html && node tools/harvester_game_test.mjs [--q=low] [--w=800 --h=450]
import { openGame, capture, arg, root } from './lib/harness.mjs';
import { join } from 'node:path';

const outDir = join(root, 'dist', 'shots', arg('tag', 'hvgame'));
const { browser, page, errors } = await openGame({ file: arg('file', 'harvester.html'), q: arg('q', 'low'), w: Number(arg('w', 800)), h: Number(arg('h', 450)), at: [250, 20] });
await page.evaluate(() => { const g = window.__rakis; g.cinematic.active = true; g.cinematic.owner = 'hv_test'; g.harvester.debugSet('running'); });
console.log('autoWired', await page.evaluate(() => window.__rakis.harvester.autoWired));
// камера в ЛОКАЛЬНЫХ координатах харвестера
const camLocal = (p, t, fov = 62) => page.evaluate(([p, t, fov]) => {
  const g = window.__rakis, h = g.harvester;
  const a = h.toWorld(p[0], p[1], p[2]), b = h.toWorld(t[0], t[1], t[2]);
  g.camera.position.copy(a); g.camera.fov = fov; g.camera.updateProjectionMatrix(); g.camera.lookAt(b);
}, [p, t, fov]);
const stats = () => page.evaluate(() => { const r = window.__rakis.renderer.info.render; return { calls: r.calls, tris: r.triangles, fps: window.__rakis.stats.fps }; });

// 1) снаружи
await page.evaluate(() => window.__step(1.5, 0.1));
const res = [];
res.push(await capture(page, outDir, 'g_ext_far', { cameraFn: () => { const g = window.__rakis, p = g.harvester.toWorld(-150, 8, 175); g.camera.position.copy(p); g.camera.lookAt(g.harvester.toWorld(0, 14, 0)); } }));
console.log('ext far', JSON.stringify(await stats()));
await camLocal([60, 8, 45], [30, 14, 8]);
res.push(await capture(page, outDir, 'g_ext_close', {}));
console.log('ext close', JSON.stringify(await stats()));
await camLocal([42, 7, 36], [20, 8, 25.6], 70);
res.push(await capture(page, outDir, 'g_ramp', {}));

// 2) интерьер строится заранее: шагаем симуляцию
const prog = await page.evaluate(() => { const h = window.__rakis.harvester; let n = 0; while (!h.interior.ready && n < 80) { window.__step(0.1, 0.1); n++; } return { ready: h.interior.ready, steps: n, stats: h.interior.stats() }; });
console.log('interior', JSON.stringify(prog));

// 3) прогулка (реальные game.heightAt / game.collide)
const walk = await page.evaluate(() => {
  const g = window.__rakis, h = g.harvester, T = g.THREE;
  const L = (x, z) => h.toWorld(x, 0, z);
  const route = [['foot', 40, 25.6], ['ramp', 26, 25.6], ['landing', 10.5, 24.0], ['door', 11.3, 20.0], ['gallery', 11, 3.0], ['corr', 6.0, 1.8], ['stair-top', -6.4, 1.8], ['hall', -9, 1.8], ['hall-n', -9, 8], ['hall-e', 8, 12.3], ['passage', 18, 12.3], ['chart', 23.5, 12.3], ['stair-base', 25.6, 17.2], ['stair-top-e', 36.2, 16.9], ['bridge', 36, 14.5]];
  const p = g.player.position; const w0 = L(route[0][1], route[0][2]);
  g.player.teleport?.(w0.x, g.heightAt(w0.x, w0.z), w0.z, 0);
  const log = []; let tele = 0, blocked = 0;
  const inv = new T.Matrix4();
  for (const [name, lx, lz] of route) {
    const tgt = L(lx, lz); let stuck = 0;
    for (let i = 0; i < 2500; i++) {
      const dx = tgt.x - p.x, dz = tgt.z - p.z, d = Math.hypot(dx, dz); if (d < 0.25) break;
      const sp = Math.min(d, 0.15), ox = p.x, oz = p.z, cur = p.y;
      p.x += dx / d * sp; p.z += dz / d * sp;
      g.collide(p, 0.35, undefined);
      const gy = g.heightAt(p.x, p.z, cur + 0.3), rise = gy - cur;
      if (rise > 0.5) { p.x = ox; p.z = oz; blocked++; if (++stuck > 6) break; continue; }
      if (Math.abs(gy - cur) > 1.2) tele++;
      p.y = gy;
      if (i % 40 === 0) window.__step(0.016, 0.016);
    }
    inv.copy(h.root.matrixWorld).invert();
    const v = new T.Vector3().copy(p).applyMatrix4(inv);
    log.push(`${name}: ${Math.hypot(tgt.x - p.x, tgt.z - p.z) < 0.5 ? 'ok' : 'FAIL'} local=${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)} on=${h.contains(p)} occ=${h.occupied} room=${h.roomAt(p)?.name || '-'}`);
  }
  return { log, tele, blocked };
});
console.log(walk.log.join('\n'));
console.log('blocked', walk.blocked, 'teleports', walk.tele);

// 4) интерьер глазами игрока
const eye = (p, t, fov = 70) => camLocal(p, t, fov);
for (const [n, p, t] of [['g_gallery', [11, 12.3, 12], [11, 12, 3]], ['g_corridor', [6, 12.3, -1], [-20, 12.5, 0]], ['g_hall', [10, 19.6, 8], [-14, 21, -5]], ['g_bridge', [26.5, 24.6, 13], [37, 25, 13]]]) {
  await eye(p, t);
  await page.evaluate(() => window.__step(0.3, 0.1));
  res.push(await capture(page, outDir, n, {}));
  console.log(n, JSON.stringify(await stats()));
}
await browser.close();
console.log(JSON.stringify(res));
const uniq = [...new Set(errors)];
if (uniq.length) { console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 20).join('\n')); process.exit(1); }
console.log('GAME TEST OK');
