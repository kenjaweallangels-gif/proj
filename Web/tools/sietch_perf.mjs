// Замер производительности сиетча по ключевым видам (headless swiftshader — CPU-растеризация, поэтому кадр пропорционален нагрузке на пиксели/вершины):
// node tools/sietch_perf.mjs [--file=sietch.html] [--dir=<папка с dist>] [--q=low|med] [--frames=30]
// Печатает по каждому виду: мс/кадр, draw calls, треугольники (сумма за кадр), доля видимых мешей (PVS), JS-стоимость update() подсистем.
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
function findChromium() { const base = '/opt/pw-browsers'; if (!existsSync(base)) return undefined; const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n)); return d ? join(base, d, 'chrome-linux', 'chrome') : undefined; }
const only = arg('only', '').split(',').filter(Boolean);
// общие для старой и новой раскладки виды (локальные координаты сиетча)
const VIEWS = [
  ['airlock', [12, 1.5, 0], [22, 1.4, 0], 72],
  ['gallery_entry', [41.5, 1.7, 0], [70, 3, 0], 78],
  ['gallery_wide', [44, 2.2, -2], [88, 7, 3], 84],
  ['passage_B3', [102, 1.6, 0.4], [124, 1.5, 0], 70],
  ['hall_entry', [152, 1.7, 0], [178, -0.5, 0], 80],
  ['hall_wide', [152, 3.5, 12], [185, 0, -2], 82],
  ['hall_godray', [169, -1.0, 3.5], [175, 8, 0], 74],
  ['hall_ledge', [176, -0.5, 0], [192, 3.8, 0], 70],
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
await page.goto(`file://${join(arg('dir', join(root, 'dist')), arg('file', 'sietch.html'))}?autotest=1&q=${arg('q', 'low')}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.0, null, { timeout: 480000 });
await page.evaluate(async () => {
  const g = window.__rakis; const w = g.world; if (w) { w.setVisible(false); w.setVisible = () => {}; }
  await g.sietch.enter(); g.cinematic = { active: true, owner: 'perf' };
  // обёртки для замера JS-стоимости подсистем (одинаково для старой и новой версии)
  const S = g.sietch, acc = { total: 0, crowd: 0, lighting: 0, n: 0 };
  const wrap = (obj, name, key) => { const f = obj[name]; obj[name] = function (...a) { const t = performance.now(); const r = f.apply(this, a); acc[key] += performance.now() - t; return r; }; };
  wrap(S, 'update', 'total'); wrap(S.crowd, 'update', 'crowd'); wrap(S.lighting, 'update', 'lighting');
  const upd = S.update; // game.add хранит ссылку на объект api — обёртка метода работает
  g.__acc = acc;
  const r = g.render; g.render = (dt) => { if (g.__shotCam) { g.camera.position.copy(g.__shotCam.pos); g.camera.quaternion.copy(g.__shotCam.quat); } r(dt); };
});
for (const [name, pos, tgt, fov] of VIEWS) {
  if (only.length && !only.includes(name)) continue;
  const res = await page.evaluate(async ([pos, tgt, fov, frames]) => {
    const g = window.__rakis, cam = g.camera, S = g.sietch, ri = g.renderer.info, raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    cam.fov = fov; cam.updateProjectionMatrix();
    const w = S.toWorld(pos[0], pos[1], pos[2]), t = S.toWorld(tgt[0], tgt[1], tgt[2]);
    cam.position.copy(w); cam.lookAt(t); g.player?.position?.set(w.x, w.y - 1.6, w.z);
    g.__shotCam = { pos: cam.position.clone(), quat: cam.quaternion.clone() };
    for (let i = 0; i < 12; i++) await raf();
    const acc = g.__acc; acc.total = acc.crowd = acc.lighting = 0;
    ri.autoReset = false; ri.reset();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) await raf();
    const dtm = (performance.now() - t0) / frames;
    const calls = ri.render.calls / frames, tris = ri.render.triangles / frames; ri.autoReset = true;
    const meshes = S.meshes.length, vis = S.meshes.filter((m) => m.visible).length;
    return { msFrame: +dtm.toFixed(1), calls: Math.round(calls), tris: Math.round(tris), meshesVisible: `${vis}/${meshes}`, pvs: S.pvsStats ? `${S.pvsStats.visible}/${S.pvsStats.total}` : '-', jsTotal: +(acc.total / frames).toFixed(2), jsCrowd: +(acc.crowd / frames).toFixed(2), jsLighting: +(acc.lighting / frames).toFixed(2) };
  }, [pos, tgt, fov, Number(arg('frames', 30))]);
  console.log(name.padEnd(14), JSON.stringify(res));
}
await browser.close();
