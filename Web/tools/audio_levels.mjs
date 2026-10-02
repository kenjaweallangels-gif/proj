// Замер уровней процедурного звука в headless Chromium (AudioContext работает без устройства вывода).
// node tools/audio_levels.mjs [--file=ui.html] [--sec=7]   → таблица RMS/peak (dBFS) по состояниям музыки и эффектам.
import { chromium } from 'playwright';
import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const findChromium = () => {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`file://${join(root, 'dist', arg('file', 'ui.html'))}?autotest=1&q=low&lang=RU`);
await page.waitForFunction(() => window.__rakis?.audio, null, { timeout: 120000 });
await page.evaluate(() => window.__rakis.audio.resume());
const sec = Number(arg('sec', 7));

const measure = (name, setup, seconds = sec) => page.evaluate(async ([name, setupSrc, seconds]) => {
  const g = window.__rakis, a = g.audio;
  // eslint-disable-next-line no-new-func
  new Function('g', 'a', setupSrc)(g, a);
  const rms = [], peaks = [];
  const t0 = performance.now();
  while (performance.now() - t0 < seconds * 1000) {
    await new Promise((r) => setTimeout(r, 50));
    const l = a.level(); rms.push(l.rms); peaks.push(l.peak);
  }
  const mean = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
  return { name, rmsMean: +mean(rms).toFixed(1), rmsMax: +Math.max(...rms).toFixed(1), peak: +Math.max(...peaks).toFixed(1), t: +a.engine.ctx.currentTime.toFixed(1) };
}, [name, setup, seconds]);

const rows = [];
rows.push(await measure('ambience (wind 5 m/s, Silence)', "a.setMusic('Silence')", 4));
for (const s of ['DesertCalm', 'DesertDrone', 'WormThreat', 'WormReveal', 'SietchLife', 'SietchNarrow', 'HallChorale']) {
  // угроза червя включает и инфразвук SFX, поэтому для WormThreat замеряем музыку при threat 0.7, но «rumble» отдельным рядом
  rows.push(await measure(`music ${s}`, `g.worm.threat = ${s === 'WormThreat' ? 0.7 : 0}; g.worm.state='Dormant'; a.setMusic('${s}')`, s === 'WormReveal' ? 16 : sec + 3));
}
await page.evaluate(() => { window.__rakis.worm.threat = 0; });
for (const [zone, space] of [['A4_Crevice', 'desert'], ['B1_Airlock', 'sietch'], ['B2_Gallery', 'sietch'], ['B3_Passages', 'sietch'], ['B4_Cistern', 'sietch'], ['B5_Hall', 'sietch']]) {
  rows.push(await measure(`ambience ${zone}`, `a.setMusic('Silence'); g.zone='${zone}'; g.space='${space}'`, 6));
}
await page.evaluate(() => { const g = window.__rakis; g.zone = 'A2_Erg'; g.space = 'desert'; g.weather.windSpeed = 14; g.weather.storm = 0.8; });
rows.push(await measure('ambience windstorm 14 m/s', "a.setMusic('Silence')", 5));
await page.evaluate(() => { const g = window.__rakis; g.weather.windSpeed = 5; g.weather.storm = 0; g.zone = 'A1_Ridge'; });
await page.evaluate(() => { const g = window.__rakis; g.worm.threat = 0; g.audio.setMusic('Silence'); });
rows.push(await measure('footsteps sand x6', "for (let i=0;i<6;i++) setTimeout(()=>g.bus.emit('footstep',{x:0,z:0,yaw:0,surface:'sand',actor:'player'}), i*350)", 3));
rows.push(await measure('footsteps rock+companion', "for (let i=0;i<6;i++) setTimeout(()=>g.bus.emit('footstep',{x:3,z:0,yaw:0,surface:i%2?'rock':'packed',actor:i%2?'Ilva':'player'}), i*350)", 3));
rows.push(await measure('worm breach', "g.bus.emit('worm:breach',{x:30,z:20})", 7));
rows.push(await measure('worm threat 0.9 rumble', "g.worm.threat = 0.9; g.worm.state='Approach'", 5));
await page.evaluate(() => { const g = window.__rakis; g.worm.threat = 0; g.worm.state = 'Dormant'; });
rows.push(await measure('thumper + door hiss', "g.bus.emit('thumper',{x:5,z:5}); a.event('Door.SealHiss')", 4));
console.table(rows);
await browser.close();
if (errors.length) { console.error(`ОШИБКИ (${errors.length}):\n` + [...new Set(errors)].slice(0, 20).join('\n')); process.exit(1); }
