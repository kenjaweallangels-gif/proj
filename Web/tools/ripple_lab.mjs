// Быстрая лаборатория ряби (без загрузки игры): node tools/ripple_lab.mjs [--tag=ripple_lab] [--only=a,b] [--w=960 --h=540]
// Рисует песок тем же GLSL ряби, что ландшафт (desert/terrain.js: RIPPLE_GLSL + RIPPLE_BLOCK) с простым освещением; swiftshader хватает.
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const res = await esbuild.build({ entryPoints: [join(root, 'tools', 'ripple_lab_main.js')], bundle: true, format: 'iife', write: false, target: ['es2020'], logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' } });
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#222}canvas{width:100vw;height:100vh;display:block}</style></head><body><canvas id="view"></canvas><script>${js}</script></body></html>`;
const outDir = join(root, 'dist', 'shots', arg('tag', 'ripple_lab'));
mkdirSync(outDir, { recursive: true });
const labFile = join(root, 'dist', 'ripple_lab.html');
writeFileSync(labFile, html);

// имя: параметры URL
const VIEWS = {
  grazing_along: 'sun=7&az=0&cy=1.7&pitch=-28&yaw=0',        // низкое солнце вдоль ветра: рябь видна лучше всего
  grazing_across: 'sun=7&az=90&cy=1.7&pitch=-28&yaw=0',      // солнце вдоль гребней: почти не видна
  fp15: 'sun=14&az=35&cy=1.7&pitch=-52&yaw=20',              // взгляд вниз, 1.5–3 м
  tp4: 'sun=14&az=35&cy=3.0&pitch=-22&yaw=20',               // третье лицо, 4–12 м
  mid30: 'sun=12&az=30&cy=1.8&pitch=-3&yaw=15',              // 20–80 м
  mid80: 'sun=12&az=30&cy=4.5&pitch=-5&yaw=15',
  noon: 'sun=62&az=30&cy=1.7&pitch=-20&yaw=15',
  dunes_lee: 'sun=10&az=20&dunes=1&cx=0&cz=0&cy=12&pitch=-10&yaw=0',   // подветренный склон и гребни
  dunes_far: 'sun=10&az=200&dunes=1&cx=-60&cz=10&cy=9&pitch=-5&yaw=0',
};
const only = arg('only', '').split(',').filter(Boolean);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const W = Number(arg('w', 960)), H = Number(arg('h', 540));
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
for (const [name, q] of Object.entries(VIEWS)) {
  if (only.length && !only.includes(name)) continue;
  await page.goto(`file://${labFile}?${q}${arg('extra', '') ? '&' + arg('extra', '') : ''}`);
  await page.waitForFunction(() => window.__lab);
  const url = await page.evaluate(() => window.__lab.render());
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log('shot', name);
}
await browser.close();
if (errors.length) console.error('КОНСОЛЬ:\n' + [...new Set(errors)].slice(0, 12).join('\n'));
