#!/usr/bin/env node
// Echo Runtime core — the WASM module inside a real browser engine (headless Chromium).
// Bundles a tiny page with the same esbuild settings as web/build.mjs (platform browser, same externals),
// serves it on loopback, runs the D0 scenario through echo_call in the page and compares the final state
// hash with the native echo_cli. This proves the browser path of the module, not any rendering/FPS claim.
//
//   node core/test_wasm_browser.mjs [--port 18751] [--seconds 300]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { launchWebGPU } from '../tools/chromium.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const argv = process.argv.slice(2);
const opt = (name, def) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : def);
const port = Number(opt('--port', '18751'));
const seconds = Number(opt('--seconds', '300'));
const wasmCore = path.join(here, 'build-wasm', 'echo_core.mjs');
if (!fs.existsSync(wasmCore)) {
  console.error('нет core/build-wasm/echo_core.mjs: сначала core/build_wasm.sh');
  process.exit(1);
}

const pageSource = `
import createEchoCore from 'echo-core-wasm';
async function run() {
  const M = await createEchoCore();
  const h = M._echo_create();
  const call = (o) => { const p = M.stringToNewUTF8(JSON.stringify(o)); try { return JSON.parse(M.UTF8ToString(M._echo_call(h, p))); } finally { M._free(p); } };
  const get = async (f) => (await fetch('/data/' + f)).json();
  const layout = await get('scene/d0_layout.json');
  const data = { world: await get('world/zero_echo_d0.json'), npcs: await get('npcs.json'), actions: await get('actions.json'),
    profiles: await get('profiles.json'), speech: await get('speech_ru.json'), director: await get('director_events.json'),
    biography: await get('biography_details.json'), layout: { anchors: layout.anchors, zone_stand_points: layout.zone_stand_points } };
  const init = call({ cmd: 'init', data });
  const plans = []; let now = 0; const texts = [];
  const absorb = (r) => { for (const e of r.events ?? []) { if (e.type === 'plan_created') plans.push(e.payload.plan_id); if (e.type === 'speech') texts.push(e.payload.text); } };
  const accept = () => { while (plans.length) { const r = call({ cmd: 'player_decide', plan_id: plans.shift(), decision: 'accept', now_ms: now }); if (r.ok) absorb(r); } };
  const t0 = performance.now();
  for (let i = 0; i < Math.round(${seconds} / 0.5); i++) {
    now += 500; absorb(call({ cmd: 'tick', dt_s: 0.5, now_ms: now })); accept();
    for (let g = 0; g < 16; g++) {
      const d = call({ cmd: 'dispatch', now_ms: now, backend: 'rules' }); absorb(d);
      if (!d.request) break;
      const p = call({ cmd: 'rules_propose', task_id: d.request.task_id });
      absorb(call({ cmd: 'submit_result', now_ms: now, result: { task_id: d.request.task_id, status: 'ok', proposal_text: p.proposal_text,
        usage: { input_tokens: 0, output_tokens: 0, measured: false }, latency_ms: { total: 0, first_token: null },
        provider: 'rules', model: 'utility-policy', finish_reason: 'stop', attempts: 1 } }));
      accept();
    }
  }
  const state = call({ cmd: 'state', now_ms: now });
  return { init_ok: init.ok, data_hash: init.data_hash, hash: state.hash, emergency_lights: state.emergency_lights,
    biography: state.biography.length, speeches: texts.length, ms: Math.round(performance.now() - t0), user_agent: navigator.userAgent };
}
window.__result = run().catch((e) => ({ error: String(e) }));
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-browser-'));
const entry = path.join(tmp, 'entry.js');
fs.writeFileSync(entry, pageSource);
const bundle = await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', target: ['chrome120', 'firefox130', 'safari18'],
  minify: true, write: false, logLevel: 'warning',
  external: ['module', 'fs', 'path', 'url', 'crypto', 'worker_threads'],
  plugins: [{ name: 'echo-core-wasm', setup(b) { b.onResolve({ filter: /^echo-core-wasm$/ }, () => ({ path: wasmCore })); } }],
});
const html = `<!doctype html><meta charset="utf-8"><title>echo core · browser smoke</title>
<script type="module">${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    return;
  }
  const file = path.join(repo, decodeURIComponent(url.pathname));
  if (!file.startsWith(path.join(repo, 'data')) || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

let result;
const browser = await launchWebGPU();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 120000 });
  result = await page.evaluate('window.__result');
  if (errors.length) result.page_errors = errors;
} finally {
  await browser.close();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

const out = execFileSync(path.join(here, 'build', 'echo_cli'),
  ['scenario', '--provider', 'rules', '--seconds', String(seconds), '--json', '--data-dir', path.join(repo, 'data')],
  { encoding: 'utf8', maxBuffer: 64 << 20 });
const native = JSON.parse(out).hash;
const ok = result && !result.error && result.init_ok && result.hash === native && result.emergency_lights === false;
console.log(JSON.stringify({ status: ok ? 'pass' : 'fail', bundle_bytes: html.length, browser: result, native_hash: native,
  note_ru: 'Проверка логики ядра в движке браузера (headless Chromium). Время прогона — CPU этой машины, не FPS.' }, null, 2));
process.exit(ok ? 0 : 1);
