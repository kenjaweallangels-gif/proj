// Лёгкая студия персонажей без запуска игры: только figures.js + three. Собирается tools/char_studio_build.mjs → dist/char_studio.html.
// Совместима по API с window.__rakis, который использует tools/char_portraits.mjs (renderer, scene, camera, figures, render).
import * as THREE from 'three';
import { makeFigure, PRESETS, PALETTES, crowdLook, setFigureWind, setFigureView, pumpFigureBuilds } from '../src/core/figures.js';
import { createFigureCrowd } from '../src/core/figure_crowd.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(canvas.clientWidth || 720, canvas.clientHeight || 720, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.03, 200);
const g = { renderer, scene, camera, figures: { makeFigure, PRESETS, PALETTES, setFigureWind, setFigureView, createFigureCrowd, crowdLook, pumpFigureBuilds, THREE }, realTime: 0, cinematic: {}, stats: { fps: 60 }, world: null };
g.render = () => { renderer.render(scene, camera); };
window.__rakis = g;
let last = performance.now();
function loop(now) { g.realTime += (now - last) / 1000; last = now; g.render(0.016); requestAnimationFrame(loop); }
requestAnimationFrame(loop);
