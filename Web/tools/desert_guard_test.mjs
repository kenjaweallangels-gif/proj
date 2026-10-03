// Тест «чёрного кадра»: в сцену добавляется меш, выдающий NaN/Inf/огромные значения, + буря + прорыв червя;
// проверяется, что итоговый кадр не чёрный (средняя яркость по углам вне меша) и нет ошибок консоли.
// node tools/build.mjs --out=desert.html && node tools/desert_guard_test.mjs [--q=med]
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const q = arg('q', 'med');
function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(600000);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('AudioContext')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'desert.html'))}?autotest=1&q=${q}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.post && window.__rakis.audio);
await page.evaluate(() => { window.__rakis.paused = true; });

const cases = [
  ['clean', 0], ['nan_quad', 1], ['inf_quad', 2], ['huge_quad', 3],
];
let bad = 0;
for (const [name, mode] of cases) {
  const res = await page.evaluate(async (mode) => {
    const g = window.__rakis, T = g.THREE;
    g.weather.request('Storm_Horizon', 0); g.weather.setHours(12, true); g.weather.setOverride({ storm: 1 }, 0); g.weather.snap();
    g.bus.emit('worm:breach', { x: 300, z: 100, power: 1 });
    g.camera.position.set(0, g.world.heightAt(0, 0) + 1.8, 0); g.camera.lookAt(100, 10, 40); g.camera.updateMatrixWorld(true);
    let mesh = null;
    if (mode) {
      const body = ['float z = uZero; gl_FragColor = vec4(vec3(z / z), 1.0);', 'float z = uZero; gl_FragColor = vec4(vec3(1.0 / z), 1.0);', 'gl_FragColor = vec4(vec3(1e30), 1.0);'][mode - 1];
      const m = new T.ShaderMaterial({ uniforms: { uZero: { value: 0 } }, vertexShader: 'void main(){ gl_Position = vec4(position.xy * 0.4 + vec2(-0.5, 0.0), 0.0, 1.0); }', fragmentShader: 'uniform float uZero; void main(){ ' + body + ' }', depthTest: false, depthWrite: false });
      mesh = new T.Mesh(new T.PlaneGeometry(2, 2), m); mesh.frustumCulled = false; mesh.renderOrder = 100; g.scene.add(mesh);
    }
    for (let i = 0; i < 3; i++) { g.weather.update(0.5); g.desertRoot.update(0.016, g.realTime); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
    const c = document.querySelector('canvas');
    const tmp = document.createElement('canvas'); tmp.width = c.width; tmp.height = c.height;
    const x = tmp.getContext('2d'); x.drawImage(c, 0, 0);
    const mean = (px, py, w, h) => { const d = x.getImageData(px, py, w, h).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; };
    const W = c.width, H = c.height;
    const out = { right: mean(Math.floor(W * 0.7), Math.floor(H * 0.2), Math.floor(W * 0.25), Math.floor(H * 0.6)), full: mean(0, 0, W, H) };
    if (mesh) { g.scene.remove(mesh); }
    return out;
  }, mode);
  const ok = res.right > 8;
  if (!ok) bad++;
  console.log(name, JSON.stringify(res), ok ? 'OK' : 'BLACK');
}
console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].slice(0, 10).join('\n') : 'no console errors');
await browser.close();
process.exit(bad ? 1 : 0);
