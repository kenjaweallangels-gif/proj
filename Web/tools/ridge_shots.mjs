// Снимки хребта: node tools/ridge_shots.mjs [--file=rakis_demo.html] [--q=low] [--only=name,name] [--out=dir]
// Камеры: старт, эрг (север/юг), тропа, сад, пустыня за хребтом (восток/запад), вид сверху-издалека.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { root, arg, findChromium, GL } from './lib/harness.mjs';
const file = arg('file', 'rakis_demo.html'), q = arg('q', 'low');
const out = arg('out', `${root}/dist/shots/ridge`);
const only = arg('only', '').split(',').filter(Boolean);
mkdirSync(out, { recursive: true });
const S = [
  // имя, x, z, yaw (направление взгляда: atan2(dz, dx)), смещение глаз
  ['start', 0, 0, Math.atan2(270, 680)],
  ['start_north', 0, 0, Math.atan2(-700, 900)],
  ['erg_north', 330, 60, Math.atan2(-700, 560)],
  ['erg_south', 420, 190, Math.atan2(600, 400)],
  ['trail', 618, 306, Math.atan2(-40, 60)],
  ['trail_north', 600, 290, Math.atan2(-420, 200)],
  ['garden', 840, 395, Math.atan2(250, -80)],
  ['garden_east', 850, 395, 0.0],
  ['behind_east', 1250, -600, Math.PI],
  ['behind_south', 760, 1500, Math.atan2(-300, -200)],
  ['pass_n1_n2', 860, -470, Math.atan2(-150, 60)],
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('ERR', e));
await page.goto(`file://${root}/dist/${file}?autotest=1&q=${q}&lang=RU&drs=0&warm=0`, { timeout: 600000 });
await page.waitForFunction(() => window.__rakis?.realTime > 1.5, null, { timeout: 900000, polling: 1000 });
for (const [name, x, z, yaw] of S) {
  if (only.length && !only.includes(name)) continue;
  await page.evaluate(([x, z, yaw]) => {
    const g = window.__rakis; g.player.teleport(x, g.heightAt(x, z), z, yaw); g.simulate(1.5, 1 / 30);
    if (g.ui?.el) for (const k of ['subs', 'lore', 'tcard', 'hintEl']) if (g.ui.el[k]) g.ui.el[k].style.visibility = 'hidden';
  }, [x, z, yaw]);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 400000 });
  console.log('saved', name);
}
await browser.close();
