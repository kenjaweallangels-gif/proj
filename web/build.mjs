#!/usr/bin/env node
// Builds the browser client into self-contained single HTML files (JS, WGSL, data and the WASM core are inlined),
// so the build can be opened offline, served by tools/serve.mjs, or published as one page.
//   node web/build.mjs            -> web/dist/index.html, web/dist/render-dev.html
//   node web/build.mjs --dev      -> no minification, inline sourcemaps
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const dist = path.join(here, 'dist');
const dev = process.argv.includes('--dev');
fs.mkdirSync(dist, { recursive: true });

const wasmCore = path.join(repo, 'core/build-wasm/echo_core.mjs');
const jsCore = path.join(repo, 'core/build-wasm/echo_core_js.mjs');
const coreMissing = path.join(here, 'src/core/core_missing.js');

// `import createEchoCore from 'echo-core-wasm'` resolves to the Emscripten ES module when it has been built
// (core/build-wasm/echo_core.mjs, SINGLE_FILE), otherwise to a stub that rejects with a clear message;
// 'echo-core-js' likewise resolves to core/build-wasm/echo_core_js.mjs.
const echoCorePlugin = {
  name: 'echo-core-wasm',
  setup(build) {
    build.onResolve({ filter: /^echo-core-wasm$/ }, () => ({ path: fs.existsSync(wasmCore) ? wasmCore : coreMissing }));
    // The same core compiled to plain JS (-sWASM=0): used only when the page forbids WebAssembly compilation.
    build.onResolve({ filter: /^echo-core-js$/ }, () => ({ path: fs.existsSync(jsCore) ? jsCore : coreMissing }));
  },
};

const pages = [
  { entry: 'src/main.ts', html: 'index.html', out: 'index.html' },
  { entry: 'src/render/dev_main.ts', html: 'render-dev.html', out: 'render-dev.html' },
];

// A claude.ai Artifact page is wrapped in its own document skeleton (doctype, charset and viewport metas, reset),
// so the publishable variant keeps only the head's title/styles/metas and the body content.
function toArtifactBody(html) {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const headKept = head
    .replace(/<meta\s+charset[^>]*>/gi, '')
    .replace(/<meta\s+name=["']viewport["'][^>]*>/gi, '')
    .trim();
  return `${headKept}\n${body.trim()}\n`;
}

let failed = false;
for (const p of pages) {
  const entry = path.join(here, p.entry);
  const template = path.join(here, p.html);
  if (!fs.existsSync(entry) || !fs.existsSync(template)) { console.log(`skip ${p.out}: ${p.entry} or ${p.html} missing`); continue; }
  try {
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: ['chrome120', 'firefox130', 'safari18'],
      minify: !dev,
      sourcemap: dev ? 'inline' : false,
      write: false,
      loader: { '.wgsl': 'text', '.json': 'json', '.txt': 'text' },
      plugins: [echoCorePlugin],
      // Emscripten's node branch references these; they are never reached in the browser.
      external: ['module', 'fs', 'path', 'url', 'crypto', 'worker_threads'],
      define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
      logLevel: 'warning',
    });
    const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    const html = fs.readFileSync(template, 'utf8');
    if (!html.includes('<!--APP_SCRIPT-->')) throw new Error(`${p.html} must contain <!--APP_SCRIPT-->`);
    const out = html.replace('<!--APP_SCRIPT-->', () => `<script type="module">\n${js}\n</script>`);
    fs.writeFileSync(path.join(dist, p.out), out);
    if (p.out === 'index.html') fs.writeFileSync(path.join(dist, 'artifact.html'), toArtifactBody(out));
    console.log(`built web/dist/${p.out} (${(out.length / 1024).toFixed(0)} KiB)${p.entry === 'src/main.ts' && !fs.existsSync(wasmCore) ? ' [WARNING: WASM core not built — stub linked]' : ''}`);
  } catch (e) {
    failed = true;
    console.error(`FAILED ${p.out}: ${e.message}`);
  }
}
const probe = path.join(repo, 'tools/webgpu_probe.html');
if (fs.existsSync(probe)) fs.copyFileSync(probe, path.join(dist, 'webgpu_probe.html'));
process.exit(failed ? 1 : 0);
