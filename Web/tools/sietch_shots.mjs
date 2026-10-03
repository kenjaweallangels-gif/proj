// Скриншоты сиетча: node tools/sietch_shots.mjs [--q=low|med|high] [--only=a,b] [--file=sietch.html] [--wait=1500]
// Вызывает window.__rakis.sietch.enter(), ставит камеру в ключевые точки и снимает Web/dist/shots/sietch/*.png.
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const q = arg('q', 'med');
const only = arg('only', '').split(',').filter(Boolean);
const outDir = join(root, 'dist', 'shots', 'sietch');
mkdirSync(outDir, { recursive: true });

function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}

// Точки обзора: локальные координаты сиетча [x,y,z] → цель [x,y,z]. fov необязателен.
const VIEWS = [
  ['01_cleft', [1.0, 1.5, 0.1], [8, 1.4, 0], 72],
  ['02_airlock', [12, 1.5, 0], [22, 1.4, 0], 72],
  ['03_inner_passage', [27, 1.5, 0.3], [40, 1.6, 0], 72],
  ['04_gallery_entry', [41.5, 1.7, 0], [70, 3, 0], 78],
  ['05_gallery_wide', [44, 2.2, -2], [88, 7, 3], 84],
  ['06_hall_wide', [152, 1.7, 0], [178, -0.5, 0], 80],
  ['07_hall_vault', [160, 0, 0], [175, 19, 0], 84],
  ['08_passage', [102, 1.6, 0.4], [124, 1.5, 0], 70],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); if (m.text().startsWith('[sietch]')) console.log(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const file = arg('file', 'sietch.html');
await page.goto(`file://${join(root, 'dist', file)}?autotest=1&q=${q}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.0, null, { timeout: 480000 });
await page.evaluate(async () => { await window.__rakis.sietch.enter(); window.__rakis.cinematic = { active: true, owner: 'shots' }; });

const shoot = async (name, pos, tgt, fov = 70, wait = Number(arg('wait', 1500))) => {
  await page.evaluate(([pos, tgt, fov]) => {
    const g = window.__rakis, o = g.sietch.root.position, cam = g.camera;
    cam.fov = fov; cam.updateProjectionMatrix();
    cam.position.set(o.x + pos[0], o.y + pos[1], o.z + pos[2]);
    cam.lookAt(o.x + tgt[0], o.y + tgt[1], o.z + tgt[2]);
    g.__shotCam = { pos: cam.position.clone(), quat: cam.quaternion.clone() };
    if (!g.__shotHook) { g.__shotHook = true; const r = g.render; g.render = (dt) => { if (g.__shotCam && g.cinematic.owner === 'shots') { g.camera.position.copy(g.__shotCam.pos); g.camera.quaternion.copy(g.__shotCam.quat); } r(dt); }; }
  }, [pos, tgt, fov]);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  const info = await page.evaluate(() => { const g = window.__rakis, r = g.renderer.info.render; return { fps: g.stats.fps, zone: g.sietch.zoneAt?.(g.camera.position), calls: r.calls, tris: r.triangles, lights: g.scene.children.length }; });
  console.log(name, JSON.stringify(info));
};

for (const [name, pos, tgt, fov] of VIEWS) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  await shoot(name, pos, tgt, fov);
}

// Зал с толпой на ярусах (после рассадки).
if (!only.length || only.some((o) => o.startsWith('30'))) {
  await page.evaluate(() => window.__rakis.sietch.crowd.debugSeatAll?.());
  await shoot('30_hall_crowd', [153, 3.2, 10], [180, -1.0, -2], 78, 2500);
  await shoot('31_hall_crowd_close', [166, 0.4, 9], [176, -0.5, 4], 68, 1500);
}
// Финал: кадры playFinale() по прогрессу (время кат-сцены идёт по game.dt, а не по реальному времени).
if (!only.length || only.includes('finale')) {
  await page.evaluate(() => { window.__rakis.cinematic = { active: false, owner: null }; window.__rakis.__shotCam = null; window.__rakis.sietch.crowd.debugSeatAll?.(); window.__finale = window.__rakis.sietch.playFinale(); });
  for (const t of [1, 4, 7.5, 10.5, 13.5, 16, 18.5, 20.2]) {
    await page.waitForFunction((t) => window.__rakis.sietch.finale.t >= t || !window.__rakis.sietch.finale.active, t, { timeout: 240000, polling: 100 });
    await page.screenshot({ path: join(outDir, `finale_${String(Math.round(t * 10)).padStart(3, '0')}.png`) });
    console.log('finale', t);
  }
}
await browser.close();
if (errors.length) { console.error(`СООБЩЕНИЯ (${errors.length}):\n` + [...new Set(errors)].slice(0, 30).join('\n')); process.exit(1); }
console.log('OK: без ошибок');
