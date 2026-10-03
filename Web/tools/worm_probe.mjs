// Диагностика «чёрного экрана»: ищет NaN/Inf в HDR-буфере (до bloom) и считает яркость кадра.
// node tools/build.mjs --out=worm.html && node tools/worm_probe.mjs [--only=pose|encounter] [--gl=swiftshader|egl|default]
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const outDir = join(root, 'dist', 'shots', 'probe');
mkdirSync(outDir, { recursive: true });
function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}
const GL = {
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  egl: ['--use-gl=egl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
  default: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL[arg('gl', 'swiftshader')] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'worm.html'))}?autotest=1&q=${arg('q', 'med')}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.5, null, { timeout: 120000 });
console.log('GL renderer:', await page.evaluate(() => { const gl = window.__rakis.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }));

await page.evaluate(() => {
  const g = window.__rakis; const p0 = g.post.composer.passes[0]; const r0 = p0.render.bind(p0);
  window.__probe = false; window.__nan = null;
  p0.render = (renderer, wb, rb, ...a) => {
    r0(renderer, wb, rb, ...a);
    if (!window.__probe) return;
    const w = rb.width, h = rb.height; const buf = new Uint16Array(w * h * 4); renderer.readRenderTargetPixels(rb, 0, 0, w, h, buf);
    let nan = 0, inf = 0;
    for (let i = 0; i < buf.length; i++) { const e = buf[i] & 0x7c00; if (e === 0x7c00) { if (buf[i] & 0x3ff) nan++; else inf++; } }
    window.__nan = { nan, inf, px: w * h }; window.__probe = false;
  };
});
async function probe(name) {
  await page.evaluate(() => { window.__nan = null; window.__probe = true; });
  await page.waitForFunction(() => window.__nan !== null, null, { timeout: 30000 });
  const r = await page.evaluate(() => window.__nan);
  console.log(name.padEnd(18), 'NaN px:', r.nan, 'Inf px:', r.inf, 'of', r.px);
  return r;
}
let bad = 0;
if (arg('only', 'pose') === 'pose') {
  await page.evaluate(() => { const g = window.__rakis; g.cinematic.active = true; g.worm.debugEncounter({ stage: 'stop' }); g.worm.director.pt = -999; });
  const cams = {
    head_closed: 'const p=new T.Vector3(),d=new T.Vector3(); w.body.mouthWorld(p,d); g.camera.position.copy(p.clone().addScaledVector(d,70).add(new T.Vector3(0,6,0))); g.camera.fov=38; g.camera.updateProjectionMatrix(); g.camera.lookAt(p.clone().addScaledVector(d,6));',
    body_mid: 'const P=w.spine.P; g.camera.position.set(P[270]-70,8,P[272]-40); g.camera.lookAt(P[270],P[271],P[272]);',
    tail_tip: 'const P=w.spine.P; g.camera.position.set(P[270]-30,8,P[272]-30); g.camera.lookAt(P[270],P[271],P[272]);',
  };
  for (const [n, code] of Object.entries(cams)) {
    await page.evaluate(`(() => { const g = window.__rakis, w = g.worm, T = g.THREE; ${code} })()`);
    await page.waitForTimeout(800);
    const r = await probe(n); if (r.nan + r.inf) bad++;
  }
  await page.evaluate(() => { window.__rakis.worm.body.setOpen(1); window.__rakis.worm.director.pt = -999; });
  await page.evaluate(`(() => { const g = window.__rakis, w = g.worm, T = g.THREE; ${cams.head_closed} })()`);
  await page.waitForTimeout(800);
  const r = await probe('head_open'); if (r.nan + r.inf) bad++;
}
console.log(bad ? `FAIL: NaN/Inf найдены в ${bad} кадрах` : 'OK: NaN/Inf не найдены');
await browser.close();
if (errors.length) console.log('console errors:', [...new Set(errors)].slice(0, 10));
process.exit(bad ? 1 : 0);
