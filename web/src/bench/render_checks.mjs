#!/usr/bin/env node
// Reproduces the renderer evidence in reports/screens/ (needs `node web/build.mjs` first):
//   * reference screenshots (render-dev.html?profile=<P>&shot=<name>&ui=0) + screens.json with HDR NaN/black checks;
//   * functional checks of the renderer contract -> render_checks.json (pass | fail | blocked | not_run).
// Headless Chromium + SwiftShader: images are for visual review, timings are NOT performance evidence (Документ §19).
//
//   node web/src/bench/render_checks.mjs [--screens] [--checks] [--profile W60] [--port 8781] [--out reports/screens]
// Without --screens/--checks both run.
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROMIUM_PATH, WEBGPU_ARGS } from '../../../tools/chromium.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const runScreens = argv.includes('--screens') || !argv.includes('--checks');
const runChecks = argv.includes('--checks') || !argv.includes('--screens');
const profile = opt('--profile', 'W60');
const port = Number(opt('--port', '8781'));
const outDir = path.resolve(repo, opt('--out', 'reports/screens'));
const base = `http://127.0.0.1:${port}/render-dev.html`;
// WebGPU canvases are not composited into screenshots with --disable-vulkan-surface; everything else as tools/chromium.mjs.
const ARGS = WEBGPU_ARGS.filter((a) => a !== '--disable-vulkan-surface');
const SHOTS = [
  ['mars_horizon', 'ref_mars_horizon.png'],
  ['surface_to_cave', 'ref_surface_to_cave.png'],
  ['mira_at_equipment', 'ref_mira_at_equipment.png'],
  ['wide_colony', 'wide_colony.png'],
  ['emergency', 'emergency.png'],
];
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const gitRev = () => { try { return execSync('git rev-parse --short HEAD', { cwd: repo }).toString().trim() + ' (+ рабочее дерево)'; } catch { return 'unknown'; } };

if (!fs.existsSync(path.join(repo, 'web/dist/render-dev.html'))) {
  console.error('web/dist/render-dev.html missing: run `node web/build.mjs` first');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, [path.join(repo, 'tools/serve.mjs'), path.join(repo, 'web/dist'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', (d) => { if (String(d).includes('serving')) resolve(srv); });
    srv.on('exit', (code) => reject(new Error(`static server exited (${code})`)));
    setTimeout(() => reject(new Error('static server did not start')), 10000);
  });
}

const waitReady = (page) => page.waitForFunction(() => window.__ready === true, null, { timeout: 900000, polling: 500 });
const waitFrames = (page, n) => page.evaluate((n) => new Promise((res) => {
  const f0 = window.__renderer.debugInfo().frames;
  const iv = setInterval(() => { if (window.__renderer.debugInfo().frames >= f0 + n) { clearInterval(iv); res(); } }, 250);
}), n);

async function screens(browser) {
  const meta = {
    kind: 'zero-echo.render-screens.v1',
    created_at: new Date().toISOString(),
    git_revision: gitRev(),
    note_ru: 'Скриншоты headless Chromium на SwiftShader (CPU): для визуальной оценки картинки. Это не замер производительности и не доказательство 60 FPS.',
    chromium_args: ARGS,
    viewport: [1280, 720],
    shots: [],
  };
  for (const [shot, file] of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    const url = `${base}?profile=${profile}&shot=${shot}&ui=0`;
    const start = Date.now();
    await page.goto(url, { waitUntil: 'load' });
    await waitReady(page);
    await waitFrames(page, 4); // crew settles, exposure adapts after the cut
    await page.screenshot({ path: path.join(outDir, file) });
    const info = await page.evaluate(async () => {
      const r = window.__renderer;
      const p = await r.debugProbe();
      return { adapter: { vendor: r.adapter.vendor, architecture: r.adapter.architecture, isSoftware: r.adapter.isSoftware }, d: r.debugInfo(), hdr: p.hdr, exposure: p.exposure[0] };
    });
    const rec = {
      shot, file, url: `render-dev.html?profile=${profile}&shot=${shot}&ui=0`, profile: info.d.profile, adapter: info.adapter,
      route_time_s: info.d.cameraMode === 'route' ? info.d.routeTime : null, route_segment: info.d.routeSegment,
      canvas: info.d.canvasSize, internal: info.d.internalSize, render_scale: info.d.renderScale,
      validation_errors: info.d.validationErrors.length, console_errors: errors.length,
      hdr_check: { pixels: info.hdr.pixels, nan: info.hdr.nan, inf: info.hdr.inf, black: info.hdr.black, mean_luminance: Math.round(info.hdr.meanLum * 1000) / 1000 },
      auto_exposure: Math.round(info.exposure * 1000) / 1000,
      capture_s_not_performance: Math.round((Date.now() - start) / 100) / 10,
    };
    meta.shots.push(rec);
    log('screen', file, `nan=${rec.hdr_check.nan} black=${rec.hdr_check.black} validation=${rec.validation_errors}`);
    await page.close();
  }
  fs.writeFileSync(path.join(outDir, 'screens.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta.shots.every((s) => s.validation_errors === 0 && s.console_errors === 0 && s.hdr_check.nan === 0 && s.hdr_check.inf === 0);
}

async function checks(browser) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror ' + e.message));
  await page.goto(`${base}?profile=W_low&ui=0`, { waitUntil: 'load' });
  await waitReady(page);
  const sleep = (ms) => page.waitForTimeout(ms);
  const adapter = await page.evaluate(() => window.__renderer.adapter);
  const timestamps = await page.evaluate(() => window.__renderer.debugInfo().timestamps);
  const st = (ok) => (ok ? 'pass' : 'fail');
  const out = [];

  out.push({ id: 'adapter_software_flag', status: st(adapter.isSoftware === Boolean(/swiftshader|llvmpipe|warp/i.test(`${adapter.vendor} ${adapter.architecture} ${adapter.description}`) || adapter.isFallbackAdapter)), detail: `${adapter.vendor} ${adapter.architecture}, isSoftware=${adapter.isSoftware}` });
  out.push({ id: 'timestamp_query', status: timestamps ? 'pass' : 'blocked', detail: timestamps ? 'timestamp-query: GPU-время пишется кольцом readback' : 'адаптер без timestamp-query: gpuMs = null' });

  await page.evaluate(async () => {
    const r = window.__renderer; const w = (ms) => new Promise((res) => setTimeout(res, ms));
    r.setCameraMode('free'); await w(1500); r.setCameraMode('orbit'); r.focusActor('mira'); await w(2500); r.focusActor(null); r.setCameraMode('route'); await w(1500);
  });
  out.push({ id: 'camera_modes_focus', status: 'pass', detail: 'orbit/free/route + focusActor без исключений' });

  const route = await page.evaluate(() => window.__renderer.runRoute({ warmupPasses: 1, passes: 1, passDurationS: 12 }));
  out.push({ id: 'route_bench_report', status: st(route.kind === 'zero-echo.route-report.v1' && route.frameInterval.count > 0 && (!adapter.isSoftware || route.status === 'blocked')), detail: `status=${route.status}, кадров ${route.frameInterval.count}, GPU ${route.gpu === 'unavailable' ? 'unavailable' : route.gpu.count}` });

  const vis = await page.evaluate(async () => {
    const r = window.__renderer; const w = (ms) => new Promise((res) => setTimeout(res, ms));
    const f0 = r.debugInfo().frames;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await w(2500);
    const f1 = r.debugInfo().frames; const phase = r.debugInfo().status.phase;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await w(3000);
    return { pausedPhase: phase, framesWhileHidden: f1 - f0, resumedFrames: r.debugInfo().frames - f1, phaseAfter: r.debugInfo().status.phase };
  });
  out.push({ id: 'visibility_pause', status: st(vis.framesWhileHidden === 0 && vis.resumedFrames > 0 && vis.pausedPhase === 'paused'), detail: vis });

  const pause = await page.evaluate(async () => {
    const r = window.__renderer; const w = (ms) => new Promise((res) => setTimeout(res, ms));
    r.pause(); const f0 = r.debugInfo().frames; await w(2000); const f1 = r.debugInfo().frames; r.resume(); await w(2500);
    return { framesWhilePaused: f1 - f0, resumed: r.debugInfo().frames > f1 };
  });
  out.push({ id: 'user_pause_resume', status: st(pause.framesWhilePaused === 0 && pause.resumed), detail: pause });

  const phases = [];
  const poll = setInterval(async () => { try { const p = await page.evaluate(() => window.__renderer.debugInfo().status.phase); if (phases[phases.length - 1] !== p) phases.push(p); } catch { /* navigation */ } }, 100);
  await page.evaluate(() => { window.__ready = false; window.__renderer.simulateDeviceLoss(); });
  await waitReady(page);
  clearInterval(poll);
  const recoveries = await page.evaluate(() => window.__renderer.debugInfo().deviceRecoveries);
  out.push({ id: 'device_loss_recovery', status: st(recoveries === 1 && phases.includes('ready') && (phases.includes('lost') || phases.includes('recovering'))), detail: { phases, recoveries } });

  const sw = await page.evaluate(async () => {
    const r = window.__renderer; const seen = [];
    const sel = document.getElementById('profile'); sel.value = 'W60'; sel.dispatchEvent(new Event('change'));
    const t = performance.now(); let phase = '';
    while (performance.now() - t < 600000) {
      const p = r.debugInfo().status.phase;
      if (p !== phase) { seen.push(p); phase = p; }
      if (seen.includes('baking') && p === 'ready') break;
      await new Promise((res) => setTimeout(res, 250));
    }
    const f0 = r.debugInfo().frames;
    while (r.debugInfo().frames < f0 + 2 && performance.now() - t < 600000) await new Promise((res) => setTimeout(res, 250));
    const d = r.debugInfo();
    return { phases: seen, profile: d.profile, internal: d.internalSize, canvas: d.canvasSize, renderScale: d.renderScale, phase: d.status.phase };
  });
  out.push({ id: 'profile_switch', status: st(sw.profile === 'W60' && sw.phase === 'ready' && sw.internal[0] === Math.round(sw.canvas[0] * sw.renderScale)), detail: sw });

  const validation = await page.evaluate(() => window.__renderer.debugInfo().validationErrors);
  out.push({ id: 'webgpu_validation_errors_zero', status: st(validation.length === 0 && consoleErrors.length === 0), detail: { validationErrors: validation.slice(0, 5), consoleErrors: consoleErrors.slice(0, 5) } });
  await page.close();

  // A browser without WebGPU must show the compatibility message instead of crashing.
  const b2 = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--disable-gpu', '--disable-features=WebGPU,Vulkan'] });
  const p2 = await b2.newPage();
  const errs2 = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto(`${base}?profile=W_low`, { waitUntil: 'load' });
  await p2.waitForFunction(() => /WebGPU недоступен|Ошибка/.test(document.getElementById('statusText')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
  const msg = await p2.evaluate(() => document.getElementById('statusText')?.textContent ?? '');
  await b2.close();
  out.push({ id: 'no_webgpu_compat_message', status: st(/WebGPU недоступен/.test(msg) && errs2.length === 0), detail: msg });
  out.push({ id: 'performance_60fps_rtx3060', status: 'not_run', detail: 'Нужен прогон контрольного маршрута на целевом ПК (RTX 3060); в этой среде нет GPU.' });

  const report = {
    kind: 'zero-echo.render-checks.v1',
    created_at: new Date().toISOString(),
    git_revision: gitRev(),
    environment_ru: 'Headless Chromium + WebGPU на SwiftShader (CPU), без GPU. Функциональные проверки контракта рендера; это НЕ замер производительности.',
    adapter: { vendor: adapter.vendor, architecture: adapter.architecture, isSoftware: adapter.isSoftware, features: adapter.features, preferredFormat: adapter.preferredFormat },
    checks: out,
    route_report_swiftshader: route,
  };
  fs.writeFileSync(path.join(outDir, 'render_checks.json'), JSON.stringify(report, null, 2) + '\n');
  for (const c of out) log(`check ${c.id}: ${c.status}`);
  return out.every((c) => c.status !== 'fail');
}

let server;
let ok = true;
try {
  server = await startServer();
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ARGS });
  try {
    if (runScreens) ok = (await screens(browser)) && ok;
    if (runChecks) ok = (await checks(browser)) && ok;
  } finally {
    await browser.close();
  }
} catch (e) {
  console.error('render checks failed:', e?.message ?? e);
  ok = false;
} finally {
  server?.kill();
}
log(ok ? 'OK' : 'FAILED');
process.exit(ok ? 0 : 1);
