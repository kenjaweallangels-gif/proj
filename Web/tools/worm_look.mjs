// Быстрый осмотр вида червя: ставит сцену в стадию (stop/arrive/depart) через worm.debugEncounter и снимает набор ракурсов.
// node tools/build.mjs --out=worm.html && node tools/worm_look.mjs [--stage=stop] [--w=960 --h=540] [--views=aerial,hero,head,rings,ossana] [--tag=look]
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const outDir = join(root, 'dist', 'shots', arg('tag', 'look'));
mkdirSync(outDir, { recursive: true });
function findChromium() {
  const base = '/opt/pw-browsers';
  const d = existsSync(base) ? readdirSync(base).find((n) => /^chromium-\d+$/.test(n)) : null;
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(arg('w', 960)), height: Number(arg('h', 540)) } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'worm.html'))}?autotest=1&q=${arg('q', 'med')}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.5, null, { timeout: 900000 });
await page.evaluate(([stage]) => {
  const g = window.__rakis;
  g.zone = 'A2_Erg'; g.player.position.set(279, g.heightAt(279, 95), 95); g.paused = true;
  g.worm.debugEncounter({ stage });
  g.camera.fov = 55; g.camera.updateProjectionMatrix();
}, [arg('stage', 'stop')]);
const views = arg('views', 'aerial,hero,head,rings,ossana').split(',');
const code = {
  aerial: 'cam.position.set(d.G.x - d.path.f.x * 60, d.G.y + 190, d.G.z - d.path.f.z * 60); cam.fov = 62; cam.updateProjectionMatrix(); cam.lookAt(d.G.x, d.G.y, d.G.z);',
  hero: 'cam.position.set(d.G.x, d.G.y + 1.7, d.G.z); cam.fov = 70; cam.updateProjectionMatrix(); const hd = w.headPos; cam.lookAt(hd.x, hd.y + 6, hd.z);',
  head: 'const hd = w.headPos, f = new T.Vector3(Math.cos(w.K.yaw), 0, Math.sin(w.K.yaw)); cam.position.set(hd.x + f.x * 95 + f.z * 40, g.heightAt(hd.x, hd.z) + 5, hd.z + f.z * 95 - f.x * 40); cam.fov = 45; cam.updateProjectionMatrix(); cam.lookAt(hd.x, hd.y + 4, hd.z);',
  rings: 'const P = w.spine.P; const k = 14; cam.position.set(P[k * 3] + 38 * d.path.r.x, g.heightAt(P[k * 3], P[k * 3 + 2]) + 6, P[k * 3 + 2] + 38 * d.path.r.z); cam.fov = 50; cam.updateProjectionMatrix(); cam.lookAt(P[k * 3], P[k * 3 + 1] + 8, P[k * 3 + 2]);',
  ossana: 'const e = w.riders.items[1].root.matrix.elements; const o = new T.Vector3(e[12], e[13], e[14]); cam.position.set(o.x + 14, o.y + 4, o.z + 14); cam.fov = 35; cam.updateProjectionMatrix(); cam.lookAt(o.x, o.y + 1, o.z);',
};
let i = 0;
for (const v of views) {
  await page.evaluate(`(() => { const g = window.__rakis, T = g.THREE, w = g.worm, d = w.director, cam = g.camera;
    const step = (sec, dt) => { const n = Math.round(sec / dt); for (let k = 0; k < n; k++) { g.dt = dt; g.time += dt; for (const { mod } of g.modules) mod.update?.(dt, g.time); } };
    step(1.5, 1 / 30); ${code[v]} })()`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(outDir, `${String(i++).padStart(2, '0')}_${v}.png`), timeout: 600000 });
  console.log('shot', v);
}
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) { console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 20).join('\n')); process.exit(1); }
console.log('OK');
