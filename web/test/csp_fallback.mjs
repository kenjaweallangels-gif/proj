#!/usr/bin/env node
// Serves web/dist/index.html under a Content-Security-Policy WITHOUT 'wasm-unsafe-eval' (as a strict host page might)
// and checks that the app still starts on the JavaScript build of the same core and runs the D0 pressure alarm.
//   node web/test/csp_fallback.mjs [--port 8796]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchWebGPU } from '../../tools/chromium.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const port = Number(argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : 8796);
const page = fs.readFileSync(path.join(repo, 'web/dist/index.html'));
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; worker-src blob:";

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' });
  res.end(page);
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await launchWebGPU();
try {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = [];
  p.on('console', (m) => logs.push(m.text()));
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });
  const wasmBlocked = await p.evaluate(async () => {
    try { await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); return false; } catch { return true; }
  });
  check('политика страницы запрещает компиляцию WebAssembly', wasmBlocked);
  await p.waitForFunction(() => window.__echo?.simStarted === true, null, { timeout: 120000, polling: 250 });
  const engine = await p.evaluate(() => window.__echo.host.core.engine);
  check('ядро запущено из JavaScript-сборки', engine === 'js', engine);
  check('предупреждение о переходе на JS-сборку в консоли', logs.some((l) => l.includes('WebAssembly unavailable')));
  await p.click('#btn-speed-4');
  await p.waitForFunction(() => window.__echo.host.events.some((e) => e.type === 'sensor_fault' || /ТРЕВОГА/.test(e.text_ru ?? '')),
    null, { timeout: 120000, polling: 250 });
  check('сценарий D0 идёт: тревога датчика давления', true);
  check('нет ошибок страницы', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  check('прогон без исключений', false, String(e?.message ?? e));
} finally {
  await browser.close();
  server.close();
}
const failed = checks.filter((c) => !c.ok);
console.log(`Итого: ${checks.length} проверок, провалено ${failed.length}`);
process.exit(failed.length ? 1 : 0);
