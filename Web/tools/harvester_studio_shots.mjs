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
if (arg('run', '0') === '1') await page.evaluate(() => window.__rakis.harvester.debugSet('running'));
if (arg('night', '0') === '1') await page.evaluate(() => { const g = window.__rakis; g.world.sunDir.set(0.3, -0.2, 0.5).normalize(); });

// cam([lx,ly,lz], [tx,ty,tz], fov) — локальные координаты модели
async function cam(name, p, t, fov = 60, wait = 700) {
  await page.evaluate(([p, t, fov]) => {
    const g = window.__rakis, h = g.harvester;
    const a = h.toWorld(p[0], p[1], p[2]), b = h.toWorld(t[0], t[1], t[2]);
    g.camera.position.copy(a); g.camera.fov = fov; g.camera.updateProjectionMatrix(); g.camera.lookAt(b);
    g.player.position.copy(a); g.player.position.y -= 1.62;
  }, [p, t, fov]);
  const url = await page.evaluate(() => { window.__rakis.step(6, 0.05); return window.__rakis.shot(); });
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
  int: [],
  carry: [],
};
let list = set === 'all' ? Object.values(SHOTS).flat() : SHOTS[set] || [];
const only = arg('only', '');
if (only) list = list.filter((s) => only.split(',').includes(s[0]));
for (const s of list) await cam(...s);
console.log('fps (swiftshader)', await page.evaluate(() => 0));
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) { console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 30).join('\n')); process.exit(1); }
console.log('OK');
