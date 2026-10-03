// Сборка лёгкой студии персонажей: node tools/char_studio_build.mjs → dist/char_studio.html
import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist'), { recursive: true });
const res = await esbuild.build({ entryPoints: [join(root, 'tools', 'char_studio_main.js')], bundle: true, format: 'iife', minify: false, write: false, target: ['es2020'], logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' } });
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
writeFileSync(join(root, 'dist', 'char_studio.html'), `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#222}canvas{width:100vw;height:100vh;display:block}</style></head><body><canvas id="view"></canvas><script>${js}</script></body></html>`);
console.log('dist/char_studio.html');
