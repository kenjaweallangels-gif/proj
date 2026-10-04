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
  // выход в сад: точки задаются через EXIT (см. EXITV ниже) — здесь только зал → стена
  ['22_exit_start', [184, 1.4, -8], [184, -0.3, -22], 74],
  // комнаты семей
  ['40_room_open_Nn1', [126, 1.6, -0.3], [126, 1.0, -9.5], 78],
  ['41_room_Nn1_inside', [126, 1.7, -3.0], [126.5, 0.9, -9.0], 82],
  ['42_room_Nn0_curtain', [111, 1.6, 1.4], [111, 1.3, -4.5], 74],
  ['42b_curtain_standing_in_door', [111, 1.6, -2.0], [111.0, 1.3, -4.5], 74],
  ['43_room_Ns2_inside', [142, 1.7, 2.6], [142, 0.8, 9.5], 82],
  ['44_room_Ns2_kids', [140.5, 1.5, 4.0], [139.2, 0.3, 7.6], 76],
  ['45_corridor_doors', [118, 1.6, 0.3], [140, 1.5, 0.0], 78],
  ['46_bay_on_shelf', [62, 7.7, 5.6], [62.5, 7.2, 10.5], 80],
  ['47_sleepers_Nn2', [141, 1.5, -3.0], [140.5, 0.4, -9.8], 78],
  ['47b_sleeper_close', [139.0, 1.5, -5.8], [139.95, 0.3, -8.4], 70],
  ['48_shadow_gallery', [66, 1.7, 1.8], [66, 1.6, 5.6], 76],
  ['48c_self_shadow_wall', [126.3, 1.6, -0.5], [126.3, 1.0, -1.5], 70],
  ['49_kids_corridor', [112, 1.5, 0.3], [125, 1.0, 0.2], 74],
  // водяной погреб
  ['50_cellar_stairs', [101.3, -0.4, 11.5], [101.3, -4.6, 26.0], 76],
  ['51_cellar_landing', [101.6, -7.4, 29.0], [108.5, -7.6, 31.4], 76],
  ['52_cellar_nave', [112.5, -7.4, 31.4], [136, -7.4, 37], 82],
  ['53_cellar_pool', [127, -7.5, 32.0], [127, -9.3, 38.5], 74],
  ['54_cellar_station', [139, -7.4, 37], [147, -7.6, 37], 76],
  ['55_cellar_vessels', [121.5, -7.3, 33.2], [121.5, -7.5, 29.6], 70],
  // атмосфера
  ['60_kitchen', [88.6, 1.6, -1.0], [91.4, 0.8, -6.3], 72],
  ['61_musician', [62.5, 1.6, -2.0], [66.4, 0.8, -0.8], 66],
  ['62_gallery_life', [48, 2.0, 3.0], [66, 1.5, -1.0], 82],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || findChromium(),
  args: ['--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(arg('w', 896)), height: Number(arg('h', 504)) } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); if (m.text().startsWith('[sietch]')) console.log(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const file = arg('file', 'sietch.html');
await page.goto(`file://${join(root, 'dist', file)}?autotest=1&q=${q}&lang=RU${process.argv.includes('--keepworld') ? '&keepworld=1' : ''}`);
await page.waitForFunction(() => window.__rakis && window.__rakis.realTime > 1.0, null, { timeout: 480000 });
await page.evaluate(async (hide) => { const g0 = window.__rakis; if (hide && g0.dialogue) g0.dialogue.bark = () => null; if (hide) { const h = () => { for (const c of g0.companions?.list || []) { if (c.figure?.group) c.figure.group.visible = false; } if (g0.player?.figure?.group) g0.player.figure.group.visible = false; }; g0.__hideCompanions = h; const r0 = g0.render; g0.render = (dt) => { h(); r0(dt); }; } const w = window.__rakis.world; if (w && !new URLSearchParams(location.search).has('keepworld')) { w.setVisible(false); w.setVisible = () => {}; } await window.__rakis.sietch.enter(); window.__rakis.cinematic = { active: true, owner: 'shots' }; }, !process.argv.includes('--companions'));
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
  const info = await page.evaluate(async () => {
    const g = window.__rakis, ri = g.renderer.info, raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    ri.autoReset = false; await raf(); ri.reset(); await raf(); await raf();
    const calls = ri.render.calls / 2, tris = ri.render.triangles / 2; ri.autoReset = true;
    return { fps: g.stats.fps, zone: g.sietch.zoneAt?.(g.camera.position), calls, tris, pvs: `${g.sietch.pvsStats.visible}/${g.sietch.pvsStats.total}`, shadows: g.sietch.life.shadows.filter((q) => q.mesh.visible).length, crowd: Object.fromEntries(Object.entries(g.sietch.crowd.prof).map(([k, v]) => [k, +v.toFixed(1)])), prof: Object.fromEntries(Object.entries(g.sietch.prof).map(([k, v]) => [k, +v.toFixed(2)])) };
  });
  console.log(name, JSON.stringify(info));
};

for (const [name, pos, tgt, fov, w] of VIEWS) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  await shoot(name, pos, tgt, fov, w);
}

// Выходной туннель: кадры вдоль оси (по api.exitPath): середина, последний прямой участок, устье.
if (!only.length || only.some((o) => o.startsWith('2') || o === 'exit')) {
  const pts = await page.evaluate(() => window.__rakis.sietch.exitPath.map((p) => { const l = window.__rakis.sietch.toLocal(p); return [l.x, l.y, l.z]; }));
  const at = (k) => pts[Math.max(0, Math.min(pts.length - 1, k))];
  const n = pts.length;
  const mk = (name, i0, i1, dy = 1.5, fov = 76) => { const a = at(i0), b = at(i1); return [name, [a[0], a[1] + dy, a[2]], [b[0], b[1] + dy - 0.2, b[2]], fov]; };
  for (const [name, pos, tgt, fov] of [mk('20_exit_mid', 40, 44), mk('21_exit_leg_a', 6, 11), mk('23_exit_final_in', n - 8, n - 1), mk('24_exit_mouth_close', n - 3, n - 1, 1.6, 70), mk('25_exit_turn', 30, 34), mk('26_exit_light_a', n - 12, n - 1, 1.5, 70), mk('27_exit_light_b', n - 6, n - 1, 1.5, 70)]) {
    if (only.length && !only.some((o) => name.includes(o) || o === 'exit')) continue;
    await shoot(name, pos, tgt, fov);
  }
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
