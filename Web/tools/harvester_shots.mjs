// Скриншоты харвестера: виды с золотого пути (P2, P4), крупные планы, запуск по кадрам, работа со шлейфом, ночь.
// node tools/build.mjs --out=harvester.html && node tools/harvester_shots.mjs [--q=low|med|high] [--only=views|close|startup|run|night|all]
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const q = arg('q', 'med');
const only = arg('only', 'all');
const outDir = join(root, 'dist', 'shots', arg('tag', 'harvester'));
mkdirSync(outDir, { recursive: true });

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
const page = await browser.newPage({ viewport: { width: Number(arg('w', 1280)), height: Number(arg('h', 720)) } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'harvester.html'))}?autotest=1&q=${q}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.harvester && window.__rakis.realTime > 1.5, null, { timeout: 180000 });

// камера под контролем теста
await page.evaluate(() => { const g = window.__rakis; g.cinematic.active = true; g.cinematic.owner = 'harvester_shots'; });

async function cam(x, y, z, lx, ly, lz, fov = 60, wait = 1200) {
  await page.evaluate(([x, y, z, lx, ly, lz, fov]) => {
    const g = window.__rakis; g.camera.position.set(x, y, z); g.camera.fov = fov; g.camera.updateProjectionMatrix(); g.camera.lookAt(lx, ly, lz);
  }, [x, y, z, lx, ly, lz, fov]);
  await page.waitForTimeout(wait);
}
const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`) });
const H = await page.evaluate(() => { const p = window.__rakis.harvester.position; return { x: p.x, y: p.y, z: p.z }; });
console.log('harvester at', JSON.stringify(H));
const stats = async (tag) => console.log(tag, JSON.stringify(await page.evaluate(() => { const g = window.__rakis, r = g.renderer.info.render; return { calls: r.calls, tris: r.triangles, fps: g.stats.fps, state: g.harvester.state }; })));

if (only === 'all' || only === 'views') {
  const P2 = [108, 43], P4 = [279, 95];
  await cam(P2[0], 1.7, P2[1], H.x, 14, H.z, 62); await shot('view_P2'); await stats('P2');
  await cam(P4[0], 1.7, P4[1], H.x, 14, H.z, 62); await shot('view_P4'); await stats('P4');
  await cam(P4[0] + 60, 1.7, P4[1] - 60, H.x, 14, H.z, 62); await shot('view_approach');
  await cam(H.x + 40, 90, H.z + 230, H.x, 12, H.z, 40); await shot('view_aerial');
}
if (only === 'all' || only === 'close') {
  await cam(H.x - 20, 2, H.z + 70, H.x - 6, 14, H.z, 55); await shot('close_side');
  await cam(H.x + 30, 1.8, H.z + 36, H.x + 30, 7, H.z + 18, 60); await shot('close_tracks');
  await cam(H.x + 90, 5, H.z + 25, H.x + 52, 5, H.z, 62); await shot('close_scoop');
  await cam(H.x + 55, 12, H.z + 50, H.x + 28, 24, H.z + 12, 55); await shot('close_cabin');
  await cam(H.x + 26, 1.7, H.z + 30, H.x + 13, 9, H.z + 22, 70); await shot('close_ladder');
  await cam(H.x - 80, 18, H.z + 20, H.x - 40, 24, H.z, 55); await shot('close_rear');
  await cam(H.x - 4, 40, H.z + 40, H.x - 14, 28, H.z, 60); await shot('close_towers');
}
if (only === 'all' || only === 'startup') {
  await page.evaluate(() => { const g = window.__rakis; g.timeScale = 1; window.__log = []; g.bus.on('harvester', (e) => window.__log.push(`${g.time.toFixed(1)} ${e.state}`)); g.bus.on('noise', (e) => e.source === 'Harvester' && window.__log.push(`${g.time.toFixed(1)} noise ${e.loudness.toFixed(2)}`)); g.audio = g.audio || {}; const ev = g.audio.event; g.audio.event = (id, pos) => { window.__log.push(`${g.time.toFixed(1)} audio ${id}`); return ev?.call(g.audio, id, pos); }; });
  // игрок рядом с пультом: проверяем интерактив
  const ip = await page.evaluate(() => { const i = window.__rakis.harvester.interactable; return [i.position.x, i.position.y, i.position.z]; });
  console.log('interactable', ip);
  await page.evaluate(([x, y, z]) => { const g = window.__rakis; g.player.position.set(x + 1.2, y, z + 1.5); g.cinematic.active = true; }, ip);
  await cam(ip[0] + 22, 3, ip[2] + 40, H.x + 5, 16, H.z, 58, 800); await shot('start_0_off');
  console.log('focus before', JSON.stringify(await page.evaluate(() => { const f = window.__rakis.player.focus; return f ? { label: f.label, tag: f.tag } : null; })));
  await page.evaluate(() => { window.__rakis.harvester.toggle(); window.__rakis.timeScale = 3; });
  const times = [1.5, 3, 5, 7, 9, 11, 14];
  let i = 0;
  // простая версия: по game.time
  await page.evaluate(() => { window.__t0 = window.__rakis.time; });
  for (const t of times) {
    await page.waitForFunction((t) => window.__rakis.time >= window.__t0 + t, t, { timeout: 600000, polling: 100 });
    await page.evaluate(() => { window.__rakis.paused = true; });
    await page.waitForTimeout(500);
    await shot(`start_${++i}_t${t}`);
    await page.evaluate(() => { window.__rakis.paused = false; });
    await stats(`t=${t}`);
  }
  console.log((await page.evaluate(() => window.__log)).join('\n'));
  console.log('focus running', JSON.stringify(await page.evaluate(() => { const f = window.__rakis.player.focus; return f ? { label: f.label, tag: f.tag } : null; })));
  await page.evaluate(() => { window.__rakis.timeScale = 1; });
}
if (only === 'all' || only === 'run') {
  await page.evaluate(() => { const g = window.__rakis; if (g.harvester.state === 'off') g.harvester.debugSet('running'); g.timeScale = 4; });
  await page.waitForTimeout(6000);
  const H2 = await page.evaluate(() => { const p = window.__rakis.harvester.position; return { x: p.x, y: p.y, z: p.z, h: window.__rakis.harvester.heading }; });
  console.log('moved to', JSON.stringify(H2));
  await page.evaluate(() => { window.__rakis.timeScale = 1; });
  await cam(H2.x - 130, 14, H2.z + 80, H2.x - 40, 14, H2.z, 62, 1500); await shot('run_plume_wide');
  await cam(H2.x - 85, 8, H2.z + 38, H2.x - 55, 9, H2.z, 62, 1200); await shot('run_plume_close');
  await cam(H2.x + 80, 6, H2.z + 60, H2.x + 40, 6, H2.z, 62, 1200); await shot('run_scoop_dust');
  await cam(H2.x + 10, 3, H2.z + 60, H2.x - 25, 14, H2.z, 60, 1200); await shot('run_side');
  await stats('running');
  // колея
  await page.evaluate(() => { const g = window.__rakis; g.harvester.stop(); g.timeScale = 4; });
  await page.waitForFunction(() => window.__rakis.harvester.state === 'off', null, { timeout: 300000, polling: 200 });
  await page.evaluate(() => { window.__rakis.timeScale = 1; });
  const H3 = await page.evaluate(() => { const p = window.__rakis.harvester.position; return { x: p.x, z: p.z }; });
  await cam(H3.x - 30, 55, H3.z + 90, H3.x - 60, 0, H3.z + 10, 55, 1500); await shot('stopped_furrows');
}
if (only === 'all' || only === 'night') {
  await page.evaluate(() => {
    const g = window.__rakis, w = g.weather;
    const ids = Object.keys(g.data?.WeatherPresets || {});
    window.__ids = ids;
    if (w?.setHours) w.setHours(22);
    else if (w) { const night = ids.find((i) => /night|dusk|eve/i.test(i)); if (night) w.request(night, 0); w.state.hours = 22; }
    g.harvester.debugSet('running');
  });
  console.log('presets', JSON.stringify(await page.evaluate(() => window.__ids)));
  await page.waitForTimeout(1500);
  const H4 = await page.evaluate(() => { const p = window.__rakis.harvester.position; return { x: p.x, z: p.z }; });
  await cam(279, 1.7, 95, H4.x, 14, H4.z, 62, 1500); await shot('night_P4');
  await cam(H4.x + 40, 3, H4.z + 55, H4.x + 20, 14, H4.z, 60, 1500); await shot('night_close');
}

const fps = await page.evaluate(() => window.__rakis.stats.fps);
console.log('fps (swiftshader)', fps);
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) { console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 30).join('\n')); process.exit(1); }
console.log('OK: без ошибок консоли');
