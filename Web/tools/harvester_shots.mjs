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
const want = (k) => only === 'all' || only.split(',').includes(k);
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
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/AudioContext/.test(m.text())) errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'harvester.html'))}?autotest=1&q=${q}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.harvester && window.__rakis.realTime > 1.5, null, { timeout: 600000 });

// камера под контролем теста
await page.evaluate(() => { const g = window.__rakis; g.cinematic.active = true; g.cinematic.owner = 'harvester_shots'; });

async function cam(x, y, z, lx, ly, lz, fov = 60, wait = 1200) {
  await page.evaluate(([x, y, z, lx, ly, lz, fov]) => {
    const g = window.__rakis; g.camera.position.set(x, y + (g.world?.heightAt?.(x, z) ?? 0), z); g.camera.fov = fov; g.camera.updateProjectionMatrix(); g.camera.lookAt(lx, ly + (g.world?.heightAt?.(lx, lz) ?? 0), lz);
  }, [x, y, z, lx, ly, lz, fov]);
  await page.waitForTimeout(wait);
}
const shot = (name) => page.screenshot({ path: join(outDir, `${name}.png`), timeout: 240000 });
const H = await page.evaluate(() => { const p = window.__rakis.harvester.position; return { x: p.x, y: p.y, z: p.z }; });
console.log('harvester at', JSON.stringify(H));
const stats = async (tag) => console.log(tag, JSON.stringify(await page.evaluate(() => {
  const g = window.__rakis; let draws = 0, tris = 0, inst = 0;
  g.harvester.root.traverse((o) => { if (!o.isMesh || !o.visible) return; let p = o.parent, vis = true; while (p) { if (!p.visible) vis = false; p = p.parent; } if (!vis) return; draws++; const geo = o.geometry; const n = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3; tris += n * (o.isInstancedMesh ? o.count : 1); if (o.isInstancedMesh) inst += o.count; });
  const pc = g.scene.getObjectByProperty('isMesh', true) && 0;
  return { harvesterDraws: draws + 2, harvesterTris: Math.round(tris), instances: inst, fps: g.stats.fps, state: g.harvester.state };
})));

if (want('views')) {
  const P2 = [108, 43], P4 = [279, 95];
  await cam(P2[0], 1.7, P2[1], H.x, 14, H.z, 62); await shot('view_P2'); await stats('P2');
  await cam(P4[0], 1.7, P4[1], H.x, 14, H.z, 62); await shot('view_P4'); await stats('P4');
  await cam(P4[0] + 60, 1.7, P4[1] - 60, H.x, 14, H.z, 62); await shot('view_approach');
  await cam(H.x + 40, 90, H.z + 230, H.x, 12, H.z, 40); await shot('view_aerial');
}
if (want('close')) {
  await cam(H.x - 20, 2, H.z + 70, H.x - 6, 14, H.z, 55); await shot('close_side');
  await cam(H.x + 30, 1.8, H.z + 36, H.x + 30, 7, H.z + 18, 60); await shot('close_tracks');
  await cam(H.x + 90, 5, H.z + 25, H.x + 52, 5, H.z, 62); await shot('close_scoop');
  await cam(H.x + 55, 12, H.z + 50, H.x + 28, 24, H.z + 12, 55); await shot('close_cabin');
  await cam(H.x + 26, 1.7, H.z + 30, H.x + 13, 9, H.z + 22, 70); await shot('close_ladder');
  await cam(H.x - 80, 18, H.z + 20, H.x - 40, 24, H.z, 55); await shot('close_rear');
  await cam(H.x - 4, 40, H.z + 40, H.x - 14, 28, H.z, 60); await shot('close_towers');
}
if (want('startup')) {
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
if (want('run')) {
  await page.evaluate(() => { const g = window.__rakis; window.__fpN = 0; const w = g.world, o = w.addFootprint.bind(w); w.addFootprint = (x, z, yaw, op) => { if (op && op.type === 'worm') window.__fpN++; return o(x, z, yaw, op); }; if (g.harvester.state === 'off') g.harvester.debugSet('running'); g.timeScale = 4; });
  await page.waitForTimeout(6000);
  const H2 = await page.evaluate(() => { const p = window.__rakis.harvester.position; return { x: p.x, y: p.y, z: p.z, h: window.__rakis.harvester.heading }; });
  console.log('moved to', JSON.stringify(H2));
  await page.evaluate(() => { window.__rakis.timeScale = 1; });
  await cam(H2.x - 130, 14, H2.z + 80, H2.x - 40, 14, H2.z, 62, 1500); await shot('run_plume_wide');
  await cam(H2.x - 85, 8, H2.z + 38, H2.x - 55, 9, H2.z, 62, 1200); await shot('run_plume_close');
  await cam(H2.x + 80, 6, H2.z + 60, H2.x + 40, 6, H2.z, 62, 1200); await shot('run_scoop_dust');
  await cam(H2.x + 10, 3, H2.z + 60, H2.x - 25, 14, H2.z, 60, 1200); await shot('run_side');
  await cam(H2.x + 105, 4, H2.z + 22, H2.x + 52, 7, H2.z, 62, 1200); await shot('run_front');
  await stats('running');
  // колея
  await page.evaluate(() => { const g = window.__rakis; g.harvester.stop(); g.timeScale = 4; });
  await page.waitForFunction(() => window.__rakis.harvester.state === 'off', null, { timeout: 300000, polling: 200 });
  await page.evaluate(() => { window.__rakis.timeScale = 1; });
  const H3 = await page.evaluate(() => { const p = window.__rakis.harvester.position; return { x: p.x, z: p.z, h: window.__rakis.harvester.heading, n: window.__fpN }; });
  console.log('furrow stamps', H3.n);
  const c3 = Math.cos(H3.h), s3 = Math.sin(H3.h), loc = (lx, lz) => [H3.x + lx * c3 - lz * s3, H3.z + lx * s3 + lz * c3];
  const cp = loc(-72, 30), lp = loc(-40, 14);
  await cam(cp[0], 14, cp[1], lp[0], 0, lp[1], 60, 1500); await shot('stopped_furrows');
}
if (want('night')) {
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
  await cam(H4.x + 70, 5, H4.z + 20, H4.x + 45, 6, H4.z, 62, 1500); await shot('night_front');
}


if (want('interact')) {
  // реальный путь игрока: подойти к пульту, увидеть подсказку, нажать E, дождаться running, нажать E ещё раз, дождаться off; плюс коллизия
  await page.evaluate(() => { const g = window.__rakis; g.cinematic.active = false; g.harvester.debugSet('off'); window.__log = []; g.bus.on('harvester', (e) => window.__log.push(`${g.time.toFixed(1)} ${e.state}`)); g.bus.on('interact', (e) => window.__log.push(`interact ${e.tag}`)); });
  const ip = await page.evaluate(() => { const i = window.__rakis.harvester.interactable; return [i.position.x, i.position.y, i.position.z]; });
  await page.evaluate(([x, y, z]) => { window.__rakis.player.teleport?.(x + 1, y, z + 1.5, Math.atan2(-1.5, -1)); }, ip);
  await page.waitForTimeout(2500);
  const f1 = await page.evaluate(() => { const f = window.__rakis.player.focus; return f ? { label: f.label, tag: f.tag } : null; });
  console.log('focus (off):', JSON.stringify(f1), JSON.stringify(await page.evaluate(() => { const g = window.__rakis; return { cin: g.cinematic, uiBlock: !!g.ui?.blocking, locked: g.player.inputLocked, pos: g.player.position.toArray().map((v) => +v.toFixed(1)), it: g.harvester.interactable.position.toArray().map((v) => +v.toFixed(1)), en: g.harvester.interactable.enabled, n: g.interactables.length }; })));
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1500);
  console.log('state after E:', await page.evaluate(() => window.__rakis.harvester.state));
  await page.evaluate(() => { window.__rakis.timeScale = 4; });
  await page.waitForFunction(() => window.__rakis.harvester.state === 'running', null, { timeout: 600000, polling: 200 });
  await page.evaluate(() => { window.__rakis.timeScale = 1; });
  const ip2 = await page.evaluate(() => { const i = window.__rakis.harvester.interactable; return [i.position.x, i.position.y, i.position.z]; });
  await page.evaluate(([x, y, z]) => { window.__rakis.player.teleport?.(x + 1, y, z + 1.5, Math.atan2(-1.5, -1)); }, ip2);
  await page.waitForTimeout(2500);
  const f2 = await page.evaluate(() => { const f = window.__rakis.player.focus; return f ? { label: f.label, tag: f.tag } : null; });
  console.log('focus (running):', JSON.stringify(f2));
  // коллизия: точка внутри корпуса выталкивается, точка снаружи — нет
  console.log('collide', JSON.stringify(await page.evaluate(() => {
    const g = window.__rakis, T = g.THREE, h = g.harvester, p = h.position;
    const c = Math.cos(h.heading), s = Math.sin(h.heading);
    const mk = (lx, lz) => new T.Vector3(p.x + lx * c - lz * s, 0, p.z + lx * s + lz * c);
    const a = mk(0, 5), b = mk(0, 40), d = mk(60, 0), e = mk(48, 0);
    const ra = g.collide(a, 0.4), rb = g.collide(b, 0.4), rd = g.collide(d, 0.4), re = g.collide(e, 0.4);
    const loc = (v) => { const dx = v.x - p.x, dz = v.z - p.z; return [(dx * c + dz * s).toFixed(1), (-dx * s + dz * c).toFixed(1)]; };
    return { inside: [ra, loc(a)], outside: [rb, loc(b)], faraway: [rd, loc(d)], scoop: [re, loc(e)] };
  })));
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(800);
  await page.evaluate(() => { window.__rakis.timeScale = 4; });
  await page.waitForFunction(() => window.__rakis.harvester.state === 'off', null, { timeout: 600000, polling: 200 });
  await page.evaluate(() => { window.__rakis.timeScale = 1; });
  console.log((await page.evaluate(() => window.__log)).join('\n'));
}

const fps = await page.evaluate(() => window.__rakis.stats.fps);
console.log('fps (swiftshader)', fps);
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) { console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 30).join('\n')); process.exit(1); }
console.log('OK: без ошибок консоли');
