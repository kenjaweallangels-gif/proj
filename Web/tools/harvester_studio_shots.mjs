// Скриншоты студии харвестера. Камеры заданы в ЛОКАЛЬНЫХ координатах модели (x вперёд, y вверх от подошвы гусениц, z правый борт).
// node tools/harvester_studio_shots.mjs --set=ext|int|carry|all [--q=low|med|high] [--w=1280 --h=720] [--run=1] [--tag=name]
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const q = arg('q', 'med'), set = arg('set', 'ext');
const outDir = join(root, 'dist', 'shots', arg('tag', 'hv'));
mkdirSync(outDir, { recursive: true });
const base = '/opt/pw-browsers';
const d = existsSync(base) ? readdirSync(base).find((n) => /^chromium-\d+$/.test(n)) : null;
const browser = await chromium.launch({
  executablePath: d ? join(base, d, 'chrome-linux', 'chrome') : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(arg('w', 1100)), height: Number(arg('h', 620)) } });
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/AudioContext|GPU stall/.test(m.text())) errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', 'harvester_studio.html')}?q=${q}`, { waitUntil: 'commit', timeout: 120000 });
await page.waitForFunction(() => window.__rakis && window.__rakis.harvester && window.__rakis.frames() > 3, null, { timeout: 300000 });
await page.evaluate(() => window.__rakis.step(5, 0.05));
if (arg('run', '0') === '1') await page.evaluate(() => window.__rakis.harvester.debugSet('running'));
if (arg('night', '0') === '1') await page.evaluate(() => { const g = window.__rakis; g.world.sunDir.set(0.3, -0.2, 0.5).normalize(); });

// cam([lx,ly,lz], [tx,ty,tz], fov) — локальные координаты модели
async function cam(name, p, t, fov = 60, frame = 'H') {
  if (p === 'C') { [p, t, fov] = [t, fov, arguments[4]]; frame = 'C'; }
  await page.evaluate(([p, t, fov, frame]) => {
    const g = window.__rakis, h = g.harvester;
    const conv = (v) => (frame === 'C' ? (h.carryall.body.updateMatrixWorld(true), new g.THREE.Vector3(v[0], v[1], v[2]).applyMatrix4(h.carryall.body.matrixWorld)) : h.toWorld(v[0], v[1], v[2]));
    const a = conv(p), b = conv(t);
    g.camera.position.copy(a); g.camera.fov = fov; g.camera.updateProjectionMatrix(); g.camera.lookAt(b);
    g.player.position.copy(a); g.player.position.y -= 1.62;
  }, [p, t, fov, frame]);
  const url = await page.evaluate(() => { window.__rakis.step(6, 0.05); return window.__rakis.shot(); });
  if (arg('stats', '0') === '1') console.log(name, JSON.stringify(await page.evaluate(() => { const g = window.__rakis, ri = g.renderer.info; ri.autoReset = false; ri.reset(); g.render(); const r = ri.render; ri.autoReset = true; return { calls: r.calls, tris: r.triangles }; })));
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', name);
}
const SHOTS = {
  ext: [
    ['ext_P2', [-150, 5, 175], [0, 14, 0], 55],
    ['ext_side', [-20, 3, 95], [-4, 14, 0], 58],
    ['ext_front34', [120, 6, 75], [10, 12, 0], 58],
    ['ext_close_cab', [66, 8, 38], [30, 17, 8], 60],
    ['ext_close_rear', [-95, 6, 45], [-45, 14, 0], 58],
    ['ext_aerial', [30, 130, 170], [0, 8, 0], 45],
    ['ext_tracks', [20, 3, 52], [20, 6, 20], 65],
    ['ext_scoop', [95, 5, 30], [52, 5, 0], 62],
    ['ext_wall', [-24, 14, 34], [-24, 14, 20], 60],
    ['ext_wall2', [0, 8, 60], [0, 12, 20], 60],
  ],
  int: [
    ['int_door_out', [11.3, 12.4, 24.5], [11.3, 12.0, 18], 62],
    ['int_gallery', [11, 12.3, 3], [11, 12.0, 15], 70],
    ['int_corridor', [6, 12.3, -1], [-20, 12.5, 0], 70],
    ['int_stair', [7, 12.2, -2], [-5, 15, 2.5], 70],
    ['int_dorm', [-12, 12.3, 5.2], [-22, 12.6, 14], 75],
    ['int_mess', [-12, 12.3, -5], [-24, 12.0, -15], 75],
    ['int_lab', [5, 12.3, -5], [-3, 12.0, -14], 75],
    ['int_stills', [5, 12.3, 6], [-4, 12, 16], 75],
    ['int_feed', [17, 12.3, 5], [30, 13, -5], 75],
    ['int_engine', [-31.5, 12.5, 2], [-42, 13, -6], 75],
    ['int_hall', [10, 19.6, 8], [-14, 21, -5], 75],
    ['int_hall2', [-8, 19.6, -10], [-14, 20.5, 9], 75],
    ['int_catwalk', [-12, 22.9, 14.5], [-35, 22.5, 14.5], 75],
    ['int_chart', [23.2, 19.6, 12.3], [32, 19.8, 12.5], 75],
    ['int_bridge', [26.5, 24.6, 13], [37, 25, 13], 75],
    ['int_bridge2', [35, 24.6, 9.5], [27, 24.4, 14], 75],
  ],
  carry: [
    ['car_side', 'C', [-4, 3, 48], [-2, 0, 0], 50],
    ['car_front34', 'C', [38, 6, 28], [0, 0, 0], 55],
    ['car_under', 'C', [8, -26, 12], [-2, -3, 0], 55],
    ['car_top', 'C', [-6, 40, 6], [-2, 2, 0], 50],
    ['car_nose', 'C', [26, 3, 10], [13, 0, 0], 60],
    ['car_wing', 'C', [-10, 6, 32], [-4, 2, 14], 55],
    ['car_tail', 'C', [-38, 6, 14], [-16, 2, 0], 55],
  ],
};
if (set === 'int' || set === 'all') {
  const info = await page.evaluate(() => { const g = window.__rakis, h = g.harvester; const t0 = performance.now(); let n = 0; const st = { eng: 0, belt: 0, state: 'off' }; while (!h.interior.ready && n < 60) { const a = performance.now(); h.interior.update(0.016, 0, st, { build: true, visible: false }); n++; } return { ms: Math.round(performance.now() - t0), steps: n, stats: h.interior.stats() }; });
  console.log('interior built', JSON.stringify(info));
}
let list = set === 'all' ? Object.values(SHOTS).flat() : SHOTS[set] || [];
const only = arg('only', '');
if (only) list = list.filter((s) => only.split(',').includes(s[0]));
for (const s of list) await cam(...s);
console.log('fps (swiftshader)', await page.evaluate(() => 0));
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) { console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 30).join('\n')); process.exit(1); }
console.log('OK');
