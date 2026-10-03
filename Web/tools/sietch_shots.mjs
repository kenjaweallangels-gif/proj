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
  ['01_cleft', [-1.2, 1.6, 4.8], [-3, 1.6, 9], 72],
  ['02_seal_outer', [4.5, 1.5, 0.2], [8, 1.4, 0], 74],
  ['02b_seal_opening', [5.6, 1.5, 0.1], [8, 1.3, 0], 70, 1000],
  ['02c_seal_open', [5.6, 1.5, 0.1], [8, 1.3, 0], 70, 2600],
  ['03_airlock', [12, 1.5, 0], [22, 1.4, 0], 72],
  ['04_inner_passage', [27, 1.5, 0.3], [40, 1.6, 0], 72],
  ['05_gallery_entry', [41.5, 1.7, 0], [70, 3, 0], 78],
  ['06_gallery_wide', [44, 2.2, -2], [88, 7, 3], 84],
  ['07_shelf', [58, 7.6, -6.3], [82, 7.8, -6.3], 76],
  ['08_market_close', [62, 1.7, 0.6], [61, 1.4, -5.4], 66],
  ['09_water_station', [80, 1.7, 0.8], [80, 1.3, 5.2], 62],
  ['10_looms', [58, 1.7, 1.4], [58, 1.3, 6.2], 62],
  ['11_niche_curtain', [114, 1.6, 0.4], [114, 1.4, -3.6], 66],
  ['12_passage', [102, 1.6, 0.4], [124, 1.5, 0], 70],
  ['13_shrine', [108, 1.6, 0.2], [108, 1.0, 3.4], 64],
  ['14_cistern', [122, 1.6, 6.0], [124, 0.5, 16], 74],
  ['15_hall_entry', [152, 1.7, 0], [178, -0.5, 0], 80],
  ['16_hall_wide', [152, 3.5, 12], [185, 0, -2], 82],
  ['17_hall_vault', [160, 0, 0], [175, 19, 0], 84],
  ['18_godray', [169, -1.0, 3.5], [175, 8, 0], 74],
  ['19_ledge', [176, -0.5, 0], [192, 3.8, 0], 70],
  ['20_exit_tunnel', [206, -5.7, -27], [208, -7.2, -32], 74],
  ['21_exit_portal', [181, -20.9, -44], [195, -23.6, -46.2], 76],
  ['22_exit_start', [184, 0.0, -18.5], [195, -3.1, -23], 74],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || findChromium(),
  args: ['--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 896, height: 504 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); if (m.text().startsWith('[sietch]')) console.log(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const file = arg('file', 'sietch.html');
await page.goto(`file://${join(root, 'dist', file)}?autotest=1&q=${q}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.0, null, { timeout: 480000 });
await page.evaluate(async () => { const w = window.__rakis.world; if (w && !new URLSearchParams(location.search).has('keepworld')) { w.setVisible(false); w.setVisible = () => {}; } await window.__rakis.sietch.enter(); window.__rakis.cinematic = { active: true, owner: 'shots' }; });
await page.waitForTimeout(500);

const shoot = async (name, pos, tgt, fov = 70, wait = Number(arg('wait', 1500))) => {
  await page.evaluate(([pos, tgt, fov]) => {
    const g = window.__rakis, cam = g.camera, S = g.sietch;
    cam.fov = fov; cam.updateProjectionMatrix();
    const w = S.toWorld(pos[0], pos[1], pos[2]), t = S.toWorld(tgt[0], tgt[1], tgt[2]);
    cam.position.copy(w); cam.lookAt(t);
    if (g.player?.position) { g.player.position.set(w.x, w.y - 1.6, w.z); }
    g.__shotCam = { pos: cam.position.clone(), quat: cam.quaternion.clone() };
    if (!g.__shotHook) { g.__shotHook = true; const r = g.render; g.render = (dt) => { if (g.__shotCam && g.cinematic.owner === 'shots') { g.camera.position.copy(g.__shotCam.pos); g.camera.quaternion.copy(g.__shotCam.quat); } r(dt); }; }
  }, [pos, tgt, fov]);
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(outDir, `${name}.png`), timeout: 420000 });
  const info = await page.evaluate(() => { const g = window.__rakis, r = g.renderer.info.render; return { fps: g.stats.fps, zone: g.sietch.zoneAt?.(g.camera.position), calls: r.calls, tris: r.triangles, lights: g.scene.children.length }; });
  console.log(name, JSON.stringify(info));
};

for (const [name, pos, tgt, fov, w] of VIEWS) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  await shoot(name, pos, tgt, fov, w);
}

// Зал с толпой на ярусах (после рассадки).
if (!only.length || only.some((o) => o.startsWith('30'))) {
  await page.evaluate(() => window.__rakis.sietch.crowd.debugSeatAll?.());
  await shoot('30_hall_crowd', [153, 3.2, 10], [180, -1.0, -2], 78, 2500);
  await shoot('31_hall_crowd_close', [166, 0.4, 9], [176, -0.5, 4], 68, 1500);
}
// Финал (в реальном времени, без кат-сцен): наиб оборачивается к игроку, когда тот на помосте/рядом.
if (!only.length || only.includes('finale')) {
  await page.evaluate(() => { window.__rakis.sietch.crowd.debugSeatAll?.(); window.__finale = window.__rakis.sietch.playFinale(); });
  for (const [name, pos, tgt, fov, t] of [
    ['finale_a', [150.5, 3.0, 6], [176, 0, -1], 78, 1],
    ['finale_b', [178, -0.4, 5.5], [192.5, 4.0, 0.2], 62, 6],
    ['finale_c', [184.5, 1.0, 2.0], [192.5, 4.2, 0.2], 50, 19],
  ]) {
    await page.waitForFunction((t) => window.__rakis.sietch.finale.t >= t || !window.__rakis.sietch.finale.active, t, { timeout: 480000, polling: 200 });
    await shoot(name, pos, tgt, fov, 600);
  }
}
await browser.close();
if (errors.length) { console.error(`СООБЩЕНИЯ (${errors.length}):\n` + [...new Set(errors)].slice(0, 30).join('\n')); process.exit(1); }
console.log('OK: без ошибок');
