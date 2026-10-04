// Песок вокруг харвестера: снимки с 15 / 40 / 120 м, стоящий и работающий. Полная игра (материал ландшафта у наносов).
// node tools/build.mjs --out=sand_after.html && node tools/harvester_sand_look.mjs --file=sand_after.html --tag=berm_after [--hours=15]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const outDir = join(root, 'dist', 'shots', arg('tag', 'berm'));
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: Number(arg('w', 960)), height: Number(arg('h', 540)) } });
page.setDefaultTimeout(1800000);
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('AudioContext')) errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'sand_after.html'))}?autotest=1&q=${arg('q', 'med')}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.harvester && window.__rakis.post && window.__rakis.realTime > 1.5, null, { timeout: 1800000, polling: 1000 });
await page.evaluate(() => { window.__rakis.paused = true; });
const hours = Number(arg('hours', 15.5));
// [имя, состояние, дистанция, азимут (рад от +z борта к носу), высота камеры над грунтом]
const VIEWS = [
  ['park_40', 'off', 40, 0.9, 5], ['park_15', 'off', 15, 0.5, 2.2], ['work_40', 'running', 40, 0.9, 5], ['park_120', 'off', 120, 0.9, 14],
  ['work_15', 'running', 15, 0.5, 2.2], ['work_120', 'running', 120, 0.9, 14],
];
const only = arg('only', '').split(',').filter(Boolean);
for (const [name, st, dist, az, h] of VIEWS) {
  if (arg('berm', '1') !== '1') break;
  if (only.length && !only.some((o) => name.includes(o))) continue;
  await page.evaluate(async ([st, dist, az, h, hours]) => {
    const g = window.__rakis, hv = g.harvester, w = g.weather;
    w.clearOverride?.(); w.request('Noon_Approach', 0); w.setHours(hours, true); w.timeScale = 0; w.setOverride({ storm: 0, dust: 0.05, clouds: 0.25, wind: 6 }, 0); w.snap();
    hv.debugSet(st, st === 'running' ? 12 : 0);
    // игрок далеко (дверь закрыта); камера на заданном расстоянии от центра корпуса
    const c = hv.toWorld(0, 0, 0, new g.THREE.Vector3());
    const cx = Math.cos(hv.heading), sx = Math.sin(hv.heading);
    // локальная точка: z борта + dist, x сдвинут по азимуту
    const lx = 10 + Math.sin(az) * dist * 0.8, lz = 22 + Math.cos(az) * dist;
    const p = hv.toWorld(lx, 0, lz, new g.THREE.Vector3());
    const gy = g.world.heightAt(p.x, p.z);
    g.camera.position.set(p.x, gy + h, p.z); g.camera.fov = 60; g.camera.updateProjectionMatrix();
    const t = hv.toWorld(-5, 0, 0, new g.THREE.Vector3());
    g.camera.lookAt(t.x, g.world.heightAt(t.x, t.z) + 9, t.z); g.camera.updateMatrixWorld(true);
    g.player.position.set(p.x, gy, p.z);
    if (g.simulate) g.simulate(st === 'running' ? 6 : 2, 1 / 20);
    for (let i = 0; i < 3; i++) { g.weather.update(1.0); g.desertRoot.update(0.016, g.realTime); hv.update?.(0.05, g.time); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
  }, [st, dist, az, h, hours]);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log('shot', name);
}
// рябь: те же виды, что в sand_look.mjs (эрг, 160/52): имя, часы, пресет, камера
const RIP = [
  ['ripple_dawn_fp15', 6.4, 'Dawn_Ridge', { x: 160, z: 52, h: 1.7, yaw: 0.9, pitch: -0.55 }],
  ['ripple_dusk_fp4', 17.7, 'Dusk_Gold', { x: 160, z: 52, h: 1.7, yaw: 0.9, pitch: -0.2 }],
  ['ripple_noon_mid30', 12, 'Noon_Approach', { x: 160, z: 52, h: 1.8, yaw: 2.2, pitch: -0.05 }],
];
for (const [name, hours, preset, cm] of RIP) {
  if (arg('ripple', '1') !== '1' || (only.length && !only.some((o) => name.includes(o)))) continue;
  await page.evaluate(async ({ hours, preset, cm }) => {
    const g = window.__rakis, w = g.weather;
    w.clearOverride?.(); w.request(preset, 0); w.setHours(hours, true); w.timeScale = 0; w.setOverride({ storm: 0, dust: 0.05, clouds: 0.25, wind: 6 }, 0); w.snap();
    const cam = g.camera; g.player.position.set(cm.x, g.world.heightAt(cm.x, cm.z), cm.z);
    cam.position.set(cm.x, g.world.heightAt(cm.x, cm.z) + cm.h, cm.z); cam.fov = 62; cam.updateProjectionMatrix();
    const c = Math.cos(cm.pitch);
    cam.lookAt(cam.position.x + Math.cos(cm.yaw) * c, cam.position.y + Math.sin(cm.pitch), cam.position.z + Math.sin(cm.yaw) * c); cam.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) { g.weather.update(1.0); g.desertRoot.update(0.016, g.realTime); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
  }, { hours, preset, cm });
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log('shot', name);
}
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].slice(0, 20).join('\n') : 'no console errors');
await browser.close();
