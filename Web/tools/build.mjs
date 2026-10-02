// Сборка в один самодостаточный файл dist/rakis_demo.html (открывается двойным щелчком, офлайн).
// --serve: дополнительно локальный сервер http://localhost:8080 с пересборкой при изменениях.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
const serve = process.argv.includes('--serve');
const outName = (process.argv.find((a) => a.startsWith('--out=')) || '--out=rakis_demo.html').slice(6);

async function bundle() {
  const res = await esbuild.build({
    entryPoints: [join(root, 'src', 'main.js')],
    bundle: true, format: 'iife', minify: !serve, sourcemap: false, write: false,
    target: ['es2020'], legalComments: 'none', logLevel: 'warning',
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = readFileSync(join(root, 'tools', 'index.template.html'), 'utf8').replace('/*__APP__*/', () => js);
  writeFileSync(join(dist, outName), html);
  if (outName === 'rakis_demo.html') writeFileSync(join(dist, 'index.html'), html);
  console.log(`dist/${outName} — ${(html.length / 1024 / 1024).toFixed(2)} МБ`);
}

await bundle();
if (serve) {
  const { createServer } = await import('node:http');
  const { watch } = await import('node:fs');
  let t; watch(join(root, 'src'), { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => bundle().catch(console.error), 150); });
  createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(readFileSync(join(dist, 'index.html')));
  }).listen(8080, () => console.log('http://localhost:8080'));
}
