// Быстрая проверка компиляции шейдеров песка БЕЗ загрузки игры: клипмап ландшафта + материал наносов (terrain.makeSurfaceMaterial) рисуются одним кадром,
// ошибки компиляции GLSL падают в консоль. node tools/surface_compile_test.mjs [--q=med]
import * as esbuild from 'esbuild';
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { root, arg, findChromium, GL } from './lib/harness.mjs';

const entry = `
import * as THREE from 'three';
import { createTerrain } from '../src/desert/terrain.js';
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setSize(640, 360, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 640 / 360, 0.1, 6000);
const tex = new THREE.DataTexture(new Uint8Array(4 * 4), 2, 2); tex.needsUpdate = true;
const foot = { uFoot: { value: tex }, rect: { value: new THREE.Vector4(0, 0, 64, 0) } };
const game = { scene, settings: { quality: '${arg('q', 'med')}' }, renderer, camera };
const terrain = createTerrain(game, foot);
camera.position.set(100, 3, 50); terrain.prime(100, 50);
camera.lookAt(110, 1, 56);
// наносы: маленькая сетка с атрибутом aMask и материалом ландшафта
const g = new THREE.PlaneGeometry(20, 20, 4, 4); g.rotateX(-Math.PI / 2);
g.setAttribute('aMask', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2).fill(0.4), 2));
const m = new THREE.Mesh(g, terrain.makeSurfaceMaterial()); m.position.set(105, 2, 55); scene.add(m);
terrain.update({ x: 100, z: 50 });
const errs = [];
const gl = renderer.getContext();
renderer.debug.checkShaderErrors = true;
const orig = console.error; console.error = (...a) => { errs.push(a.join(' ').slice(0, 1500)); orig(...a); };
renderer.render(scene, camera);
window.__done = { errs, programs: renderer.info.programs.length, calls: renderer.info.render.calls, glerr: gl.getError() };
`;
const tmp = join(root, 'tools', '_surface_entry.js');
writeFileSync(tmp, entry);
const res = await esbuild.build({ entryPoints: [tmp], bundle: true, format: 'iife', write: false, target: ['es2020'], logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' } });
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
mkdirSync(join(root, 'dist'), { recursive: true });
const file = join(root, 'dist', 'surface_compile.html');
writeFileSync(file, `<!doctype html><html><body><canvas id="view" width="640" height="360"></canvas><script>${js}</script></body></html>`);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || findChromium(), args: GL.swiftshader });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 1500)}`));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 1500)));
await page.goto(`file://${file}`);
await page.waitForFunction(() => window.__done, null, { timeout: 600000 }).catch(() => {});
const done = await page.evaluate(() => window.__done);
console.log('результат:', JSON.stringify(done));
const bad = logs.filter((l) => /error|ERROR|pageerror/.test(l) && !/AudioContext|GPU stall/.test(l));
if (bad.length) console.log('КОНСОЛЬ:\n' + [...new Set(bad)].slice(0, 8).join('\n'));
await browser.close();
console.log(done && !bad.length ? 'SURFACE-COMPILE: OK' : 'SURFACE-COMPILE: ОШИБКИ');
process.exit(done && !bad.length ? 0 : 1);
