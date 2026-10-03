// CPU-время animate() для толпы из 60 фигур (без рендера): node tools/char_crowd_bench.mjs [--n=60] [--frames=300] [--near=6]
// Фигуры стоят кольцами на расстояниях 2..40 м; камера в начале координат. Идёт обычная смена LOD по расстоянию.
import * as THREE from 'three';
import { makeFigure, setFigureView, PALETTES, FIGURE_STATS } from '../src/core/figures.js';
import { GEO_STATS } from '../src/player/char_geometry.js';
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const N = Number(arg('n', 60)), FR = Number(arg('frames', 300));
const keys = Object.keys(PALETTES);
setFigureView(new THREE.Vector3(0, 1.6, 0));
const figs = [];
let t0 = performance.now();
for (let i = 0; i < N; i++) {
  const k = keys[i % keys.length];
  const f = makeFigure({ ...PALETTES[k], name: `NPC_${k}_${i}`, seed: 100 + i });
  const d = 3 + (i / N) * 37, a = i * 2.4;
  f.group.position.set(Math.sin(a) * d, 0, Math.cos(a) * d); f.group.rotation.y = a + 3;
  figs.push({ f, d, speed: i % 3 === 0 ? 1.3 : 0 });
}
console.log(`build ${N} figures: ${(performance.now() - t0).toFixed(0)} ms`);
if (arg("warm", "0") === "1") for (const e of figs) e.f.stats;
for (let w = 0; w < 30; w++) for (const e of figs) e.f.animate(e.speed, 1 / 60, 0);
const times = [];
for (let fr = 0; fr < FR; fr++) {
  const t = performance.now();
  for (const e of figs) {
    if (e.speed) { e.f.group.position.x += e.speed / 60 * Math.cos(e.f.group.rotation.y); e.f.group.position.z -= e.speed / 60 * Math.sin(e.f.group.rotation.y); }
    e.f.animate(e.speed, 1 / 60, 0);
  }
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
const lods = [0, 0, 0]; for (const e of figs) lods[e.f.lod()]++;
console.log(`animate() x${N}: mean ${mean.toFixed(2)} ms  p50 ${times[times.length >> 1].toFixed(2)}  p95 ${times[Math.floor(times.length * 0.95)].toFixed(2)}  max ${times[times.length - 1].toFixed(2)}   LOD counts ${lods.join('/')}`);
console.log('geometry builds per LOD: n=' + GEO_STATS.n.join('/') + ' avg ms=' + GEO_STATS.ms.map((m, i) => (m / Math.max(1, GEO_STATS.n[i])).toFixed(0)).join('/'));
