#!/usr/bin/env node
// Headless Chromium with WebGPU for automated checks in environments without a GPU.
// In this container WebGPU runs on SwiftShader (CPU): images are valid for visual review,
// timings are NOT performance evidence (Документ §19).
//
// Library:  import { launchWebGPU } from './chromium.mjs'
// CLI:      node tools/chromium.mjs screenshot <url> <out.png> [--wait "<js expr>"] [--timeout 120000] [--size 1280x720]
//           node tools/chromium.mjs eval <url> "<js expr returning JSON-able value>" [--timeout ms]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

export const CHROMIUM_PATH = process.env.CHROMIUM_PATH
  ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find((p) => fs.existsSync(p));

export const WEBGPU_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader',
  '--use-angle=swiftshader',
  '--disable-vulkan-surface',
  '--ignore-gpu-blocklist',
];

export async function launchWebGPU({ headless = true, extraArgs = [] } = {}) {
  if (!CHROMIUM_PATH) throw new Error('Chromium not found; set CHROMIUM_PATH');
  return chromium.launch({ executablePath: CHROMIUM_PATH, headless, args: [...WEBGPU_ARGS, ...extraArgs] });
}

function opt(args, name, def) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; }

async function main() {
  const [cmd, url, third, ...rest] = process.argv.slice(2);
  if (!cmd || !url) { console.error('usage: chromium.mjs screenshot|eval <url> ...'); process.exit(2); }
  const all = [third, ...rest].filter((x) => x !== undefined);
  const timeout = Number(opt(all, '--timeout', '120000'));
  const [w, h] = opt(all, '--size', '1280x720').split('x').map(Number);
  const browser = await launchWebGPU();
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  try {
    await page.goto(url, { waitUntil: 'load', timeout });
    if (cmd === 'screenshot') {
      const wait = opt(all, '--wait', null);
      if (wait) await page.waitForFunction(wait, null, { timeout, polling: 500 });
      await page.screenshot({ path: third, timeout });
      console.log(JSON.stringify({ ok: true, out: third }));
    } else if (cmd === 'eval') {
      const v = await page.evaluate(`(async () => (${third}))()`);
      console.log(JSON.stringify(v, null, 2));
    }
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
    process.exitCode = 1;
  } finally {
    if (logs.length) console.error(logs.slice(-60).join('\n'));
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
