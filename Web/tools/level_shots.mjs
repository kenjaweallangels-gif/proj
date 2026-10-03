// Скриншоты подхода и сада: node tools/build.mjs --out=level.html && node tools/level_shots.mjs [--q=low|med] [--only=approach,garden,...] [--tag=name]
// Камеры задаются в абсолютных мировых координатах (y — абсолютная высота), либо через `rel` (y над землёй).
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const q = arg('q', 'med');
const only = arg('only', 'all');
const want = (k) => only === 'all' || only.split(',').includes(k);
const outDir = join(root, 'dist', 'shots', arg('tag', 'level'));
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
page.on('console', (m) => { const t = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !/AudioContext|GPU stall|ReadPixels/.test(t)) errors.push(`${m.type()}: ${t}`); if (/\[approach\]|\[garden\]/.test(t)) console.log(t); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'level.html'))}?autotest=1&q=${q}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.approach && window.__rakis.realTime > 1.5, null, { timeout: 900000 });
await page.evaluate(() => { const g = window.__rakis; g.cinematic.active = true; g.cinematic.owner = 'level_shots'; g.timeScale = 1; });

const hours = async (h) => { await page.evaluate((h) => { const g = window.__rakis; g.weather.request(h >= 21 || h < 4.9 ? 'Night_Clear' : h >= 19.6 ? 'Twilight_Violet' : h >= 17.2 ? 'Dusk_Gold' : 'Clear_Noon', 0.01); g.weather.setHours(h, true); g.weather.snap?.(); }, h); };
async function cam(x, y, z, lx, ly, lz, fov = 62, wait = 1400, rel = false) {
  await page.evaluate(([x, y, z, lx, ly, lz, fov, rel]) => {
    const g = window.__rakis, W = g.world;
    const gy = rel ? W.heightAt(x, z, 1e3) : 0, ly2 = rel ? W.heightAt(lx, lz, 1e3) : 0;
    let cy = y + gy; const V = g.approach?.volume;
    if (V && V.inZone(x, z, 1)) { let n = 0; while (V.sample(x, cy, z) < 0.9 && n++ < 80) cy += 0.5; }
    g.camera.position.set(x, cy, z); g.camera.fov = fov; g.camera.updateProjectionMatrix(); g.camera.lookAt(lx, ly + ly2, lz);
  }, [x, y, z, lx, ly, lz, fov, rel]);
  await page.waitForTimeout(wait);
}
const shot = async (name) => {
  await page.screenshot({ path: join(outDir, `${name}.png`), timeout: Number(arg('shotTimeout', 900000)) });
  const i = await page.evaluate(() => { const g = window.__rakis, r = g.renderer.info.render; return { calls: r.calls, tris: r.triangles, fps: g.stats.fps }; });
  console.log(`shot ${name}: calls=${i.calls} tris=${i.tris} fps=${i.fps}`);
};
globalThis.__h = { hours, cam, shot, page, want, outDir, errors };

const scenes = arg('scenes', 'level_scenes.mjs');
const mod = await import(`./${scenes}`);
await mod.run(globalThis.__h);
console.log('errors:', errors.length ? '\n' + errors.slice(0, 12).join('\n') : 'none');
await browser.close();
