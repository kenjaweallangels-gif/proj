// Относительная стоимость частей кадра пустыни: node tools/desert_gpu_proxy.mjs [--q=med] [--w=640 --h=360] [--file=desert.html]
// Растеризатор — swiftshader (CPU), поэтому числа не равны мс на реальном GPU, но доли (ALU/текстуры/заливка) показательны.
// Конфигурации выключают по одной части сцены; печатается мс/кадр (медиана из 3) и вклад части (full − без неё).
import { chromium } from 'playwright';
import { join } from 'node:path';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const q = arg('q', 'med');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: Number(arg('w', 640)), height: Number(arg('h', 360)) } });
page.setDefaultTimeout(900000);
await page.goto(`file://${join(root, 'dist', arg('file', 'desert.html'))}?autotest=1&q=${q}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.post && window.__rakis.audio, null, { timeout: 900000 });
const res = await page.evaluate(async () => {
  const g = window.__rakis, w = g.weather, world = g.world, post = g.post;
  g.paused = true;
  w.clearOverride?.(); w.request('Morning_Erg', 0); w.setHours(9, true); w.timeScale = 0; w.setOverride({ storm: 0, dust: 0.05, clouds: 0.3, wind: 7 }, 0); w.snap();
  const cam = g.camera; cam.position.set(160, world.heightAt(160, 52) + 1.8, 52);
  cam.lookAt(cam.position.x + 0.6, cam.position.y + 0.05, cam.position.z + 0.7); cam.updateMatrixWorld(true);
  const gl = g.renderer.getContext(); const px = new Uint8Array(4);
  const frame = () => { w.update(0.016); g.desertRoot.update(0.016, g.realTime); const t0 = performance.now(); post.render(0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return performance.now() - t0; };
  const med = (f) => { f(); frame(); const a = [frame(), frame(), frame()].sort((x, y) => x - y); return a[1]; };
  const cfg = {
    full: { on() {}, off() {} },
    no_sky: { on() { world.sky.dome.visible = false; }, off() { world.sky.dome.visible = true; } },
    no_terrain: { on() { world.terrain.setVisible(false); }, off() { world.terrain.setVisible(true); } },
    no_fx: { on() { world.fx.group.visible = false; }, off() { world.fx.group.visible = true; } },
    no_atmo_pass: { on() { if (post.haze) post.haze.enabled = false; }, off() { if (post.haze) post.haze.enabled = true; } },
    no_bloom: { on() { if (post.bloom) post.bloom.enabled = false; }, off() { if (post.bloom) post.bloom.enabled = true; } },
    no_shadows: { on() { g.world.sky.sun.castShadow = false; }, off() { g.world.sky.sun.castShadow = true; } },
    no_rock_dressing: { on() { world.parts.forEach((p) => p.group && (p.group.visible = false)); }, off() { world.parts.forEach((p) => p.group && (p.group.visible = true)); } },
  };
  const out = {};
  for (const [name, c] of Object.entries(cfg)) { c.on(); out[name] = +med(() => {}).toFixed(0); c.off(); }
  out.full = +med(() => {}).toFixed(0);
  out.contrib = {};
  for (const k of Object.keys(out)) if (k !== 'full' && k !== 'contrib') out.contrib[k.replace('no_', '')] = out.full - out[k];
  g.renderer.info.autoReset = false; g.renderer.info.reset(); frame();
  out.drawCalls = g.renderer.info.render.calls; out.tris = g.renderer.info.render.triangles; g.renderer.info.autoReset = true;
  return out;
});
console.log(q, JSON.stringify(res));
await browser.close();
