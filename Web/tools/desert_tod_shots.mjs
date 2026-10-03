// Скриншоты суток/погоды пустыни: node tools/desert_tod_shots.mjs [--q=med] [--file=desert.html] [--only=a,b] [--tag=tod]
// Игра ставится на паузу, камера задаётся вручную, weather.setHours(h, true) → мгновенно.
// Виды: claw (на скалу), sun (на солнце), moon (на луну), sky (в зенит), low (низко над песком), back (от скалы).
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const q = arg('q', 'med');
const only = arg('only', '').split(',').filter(Boolean);
const outDir = join(root, 'dist', 'shots', arg('tag', 'tod'));
mkdirSync(outDir, { recursive: true });

function findChromium() {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
}

// [имя, часы, пресет, override|null, вид]
const clear = { storm: 0, dust: 0.05, clouds: 0.25 };
const SHOTS = [
  ['h05_predawn', 5, 'Dawn_Ridge', clear, 'claw'],
  ['h07_sunrise', 7, 'Dawn_Ridge', clear, 'sun'],
  ['h07_claw', 7, 'Dawn_Ridge', clear, 'claw'],
  ['h09_morning', 9, 'Morning_Erg', null, 'claw'],
  ['h12_noon', 12, 'Noon_Approach', clear, 'claw'],
  ['h12_noon_sky', 12, 'Noon_Approach', clear, 'sky'],
  ['h16_afternoon', 16, 'Morning_Erg', clear, 'claw'],
  ['h185_goldenhour', 18.5, 'Morning_Erg', clear, 'sun'],
  ['h185_golden_claw', 18.5, 'Morning_Erg', clear, 'claw'],
  ['h195_dusk', 19.5, 'Morning_Erg', clear, 'sun'],
  ['h195_dusk_claw', 19.5, 'Morning_Erg', clear, 'claw'],
  ['h22_night', 22, 'Morning_Erg', clear, 'claw'],
  ['h22_night_moon', 22, 'Morning_Erg', clear, 'moon'],
  ['h22_night_sky', 22, 'Morning_Erg', clear, 'sky'],
  ['h02_night', 2, 'Morning_Erg', clear, 'claw'],
  ['h02_night_sky', 2, 'Morning_Erg', clear, 'sky'],
  ['storm_noon', 12, 'Storm_Horizon', { storm: 0.55 }, 'claw'],
  ['storm_full', 14, 'Storm_Horizon', { storm: 1, dust: 0.9, wind: 17 }, 'claw'],
  ['storm_full_dusk', 18.5, 'Storm_Horizon', { storm: 1, dust: 0.9, wind: 17 }, 'sun'],
  ['haze_noon', 12, 'Noon_Approach', { haze: 1, dust: 0.35 }, 'low'],
  ['cloudy_sunset', 18.7, 'Morning_Erg', { clouds: 1 }, 'sun'],
  ['night_storm', 23, 'Storm_Horizon', { storm: 0.8 }, 'claw'],
];

async function session(list) {
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || findChromium(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(arg('w', 1280)), height: Number(arg('h', 720)) } });
page.setDefaultTimeout(300000);
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('AudioContext')) errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'desert.html'))}?autotest=1&q=${q}&lang=RU`);
await page.waitForFunction(() => window.__rakis && window.__rakis.post && window.__rakis.audio, null, { timeout: 600000 });
await page.evaluate(() => { window.__rakis.paused = true; });

for (const [name, hours, preset, ov, view] of list) {
  await page.evaluate(({ hours, preset, ov, view }) => {
    const g = window.__rakis, w = g.weather;
    w.clearOverride?.();
    w.request(preset, 0);
    if (w.setHours) w.setHours(hours, true); else { w.state.hours = hours; }
    w.timeScale = 0;
    if (ov && w.setOverride) w.setOverride(ov, 0);
    w.snap();
    const cam = g.camera;
    const x = 0, z = 0;
    cam.position.set(x, g.world.heightAt(x, z) + 1.8, z);
    cam.fov = 62; cam.updateProjectionMatrix();
    const sd = g.world.sunDir;
    let yaw = Math.atan2(270, 680), pitch = 0.1;
    if (view === 'sun') { yaw = Math.atan2(sd.z, sd.x); pitch = Math.max(0.05, Math.asin(Math.max(sd.y, 0)) * 0.6 + 0.05); }
    else if (view === 'moon') { const m = w.moons?.[0]?.dir; if (m) { yaw = Math.atan2(m.z, m.x); pitch = Math.asin(Math.max(m.y, -0.2)) * 0.8 + 0.1; } else pitch = 0.3; }
    else if (view === 'sky') { yaw += 2.4; pitch = 0.75; }
    else if (view === 'low') { yaw -= 0.6; pitch = 0.0; cam.position.y = g.world.heightAt(x, z) + 0.9; }
    else if (view === 'back') { yaw += Math.PI; }
    const c = Math.cos(pitch);
    cam.lookAt(cam.position.x + Math.cos(yaw) * c, cam.position.y + Math.sin(pitch), cam.position.z + Math.sin(yaw) * c);
    cam.updateMatrixWorld(true);
  }, { hours, preset, ov, view });
  // прогрев: несколько кадров с обновлением погоды/неба
  for (let i = 0; i < 2; i++) {
    await page.evaluate(async () => {
      const g = window.__rakis; g.weather.update(1.0); g.desertRoot.update(0.016, g.realTime);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
  }
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log('shot', name);
}
const uniq = [...new Set(errors)];
console.log(uniq.length ? 'ERRORS:\n' + uniq.slice(0, 20).join('\n') : 'no console errors');
await browser.close();
}
const todo = SHOTS.filter(([n]) => !only.length || only.some((o) => n.includes(o)));
const chunk = Number(arg('chunk', 2));
for (let i = 0; i < todo.length; i += chunk) {
  for (let tries = 0; tries < 3; tries++) { try { await session(todo.slice(i, i + chunk)); break; } catch (e) { console.log('retry', String(e).slice(0, 120)); } }
}
