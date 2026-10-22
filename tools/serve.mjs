#!/usr/bin/env node
// Minimal static file server for local testing.
// Usage: node tools/serve.mjs <root> [port] [--coop-coep] [--host 127.0.0.1]
// Binds to loopback by default. --coop-coep adds the headers needed for SharedArrayBuffer / multithreaded WASM (Документ §7).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const root = path.resolve(args[0] ?? '.');
const port = Number(args.find((a, i) => i > 0 && /^\d+$/.test(a)) ?? 8080);
const coopCoep = args.includes('--coop-coep');
const hostIdx = args.indexOf('--host');
const host = hostIdx >= 0 ? args[hostIdx + 1] : '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.wgsl': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
  const headers = { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (coopCoep) { headers['Cross-Origin-Opener-Policy'] = 'same-origin'; headers['Cross-Origin-Embedder-Policy'] = 'require-corp'; }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
});
server.listen(port, host, () => console.log(`serving ${root} at http://${host}:${port}/${coopCoep ? ' (COOP/COEP)' : ''}`));
