// Офлайн-рендер музыкальных состояний в WAV/f32 (headless Chromium, OfflineAudioContext) — замеры без прослушивания.
//   node tools/music_render.mjs [--states=A,B] [--sec=36] [--seed=1] [--out=/tmp/mus] [--raw] [--duck]
// Пишет <out>/<имя>.f32 (interleaved stereo float32, 48 кГц) и <out>/<имя>.json; анализ: python3 Tools/tts/music_analyze.py <out>.
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const flag = (k) => process.argv.includes(`--${k}`);
const out = arg('out', '/tmp/mus_render');
mkdirSync(out, { recursive: true });
const sec = Number(arg('sec', 36));
const seed = Number(arg('seed', 1));
const states = arg('states', 'DesertCalm,DesertDrone,Night,Garden,WormThreat,WormReveal,Devour,Encounter,SietchLife,SietchNarrow,HallChorale').split(',');

const bundle = await esbuild.build({
  entryPoints: [join(root, 'tools', 'music_render_entry.js')], bundle: true, format: 'iife', write: false, target: ['es2020'], logLevel: 'warning', legalComments: 'none',
});
const findChromium = () => {
  const base = '/opt/pw-browsers';
  if (!existsSync(base)) return undefined;
  const d = readdirSync(base).find((n) => /^chromium-\d+$/.test(n));
  return d ? join(base, d, 'chrome-linux', 'chrome') : undefined;
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await page.goto('about:blank');
await page.addScriptTag({ content: bundle.outputFiles[0].text });
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });

// Сценарии: угроза червя растёт; пик Devour/Reveal — с начала; дакинг — окно «речи».
const SCEN = {
  WormThreat: { threat: [0, 0.1, 10, 0.2, 22, 0.5, 34, 0.75, 1000, 0.9] },
};
for (const st of states) {
  const o = { state: st, seconds: sec, seed, raw: flag('raw'), ...(SCEN[st] || {}) };
  if (flag('duck')) o.speech = [Number(arg('s0', 14)), Number(arg('s1', 22))];
  if (process.argv.some((a) => a.startsWith('--switch='))) o.switches = JSON.parse(arg('switch'));
  const t0 = Date.now();
  const r = await page.evaluate((o) => window.renderMusic(o), o);
  writeFileSync(join(out, `${st}.f32`), Buffer.from(r.b64, 'base64'));
  writeFileSync(join(out, `${st}.json`), JSON.stringify({ state: st, sr: r.sr, ch: r.ch, n: r.n, seconds: sec, seed, speech: o.speech || null }));
  console.log(`${st}: ${r.n} сэмплов за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
}
await browser.close();
