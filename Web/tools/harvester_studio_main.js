// Лёгкая студия харвестера без запуска всей игры: фальшивый game (плоские дюны, солнце, туман) + модуль src/harvester.
// Сборка: node tools/harvester_studio_build.mjs → dist/harvester_studio.html. Скриншоты: node tools/harvester_studio_shots.mjs
import * as THREE from 'three';
import { bus } from '../src/core/bus.js';
import { colliders } from '../src/core/colliders.js';
import { ENV } from '../src/desert/env.js';
import { applyTriplanar } from '../src/core/triplanar.js';
import { create as createHarvester } from '../src/harvester/index.js';

const qs = new URLSearchParams(location.search);
const quality = qs.get('q') || 'med';
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(canvas.clientWidth || 1280, canvas.clientHeight || 720, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#b9a98a');
const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 4000);

const heightAt = (x, z) => 2.2 * Math.sin(x * 0.011 + 0.7) * Math.cos(z * 0.014) + 1.1 * Math.sin(x * 0.05 + z * 0.03);
const sunDir = new THREE.Vector3(0.5, 0.62, 0.35).normalize();
const sun = new THREE.DirectionalLight(0xfff0d8, 2.8); scene.add(sun, sun.target);
sun.castShadow = quality !== 'low';
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 400 });
sun.shadow.bias = -0.0004;
scene.add(new THREE.HemisphereLight(0xbcd0ff, 0xb09670, 0.7));
ENV.uniforms.uSunDir.value.copy(sunDir); ENV.uniforms.uKeyDir.value.copy(sunDir);
ENV.uniforms.uAmbient.value.setRGB(0.42, 0.4, 0.37);

// грунт
const G = 1400, SEG = 200;
const gg = new THREE.PlaneGeometry(G, G, SEG, SEG); gg.rotateX(-Math.PI / 2);
const gp = gg.attributes.position;
for (let i = 0; i < gp.count; i++) gp.setY(i, heightAt(gp.getX(i) + 330, gp.getZ(i) - 60));
gg.computeVertexNormals();
const gmat = new THREE.MeshStandardMaterial({ color: 0xd9b98a, roughness: 1 });
applyTriplanar(gmat, 'sand', { scale: 3, axes: 'y', quality });
const ground = new THREE.Mesh(gg, gmat); ground.position.set(330, 0, -60); ground.receiveShadow = true; scene.add(ground);

const modules = [];
const game = {
  THREE, scene, camera, renderer, bus, colliders, settings: { quality, lang: 'RU' }, time: 0, realTime: 0, dt: 0, timeScale: 1, paused: false,
  space: 'desert', interactables: [], shake: 0, cinematic: { active: true }, stats: { fps: 0 }, lang: 'RU',
  world: { heightAt, sunDir, addFootprint() {} }, weather: { windDir: new THREE.Vector3(1, 0, 0.4).normalize(), windSpeed: 4 },
  player: { position: new THREE.Vector3(330, 0, 0), yaw: 0 },
  add(name, mod) { game[name] = mod; modules.push(mod); return mod; },
  heightAt: (x, z) => heightAt(x, z), surfaceAt: () => 'sand',
  collide(pos, r, opt) { return colliders.push(pos, r, opt); },
};
game.ground = () => game.world;
window.__rakis = game;
createHarvester(game);

game.render = () => { renderer.render(scene, camera); };
game.live = qs.get('live') === '1';
let last = performance.now();
let frames = 0;
function tick(raw) {
  game.realTime += raw; const dt = game.paused ? 0 : raw * game.timeScale; game.dt = dt; game.time += dt;
  ENV.uniforms.uTime.value = game.time;
  ENV.uniforms.uCamXZ.value.set(camera.position.x, camera.position.z);
  camera.updateMatrixWorld(true);
  for (const m of modules) if (m.update && (dt > 0 || m.alwaysUpdate)) m.update(dt, game.time);
  const hp = game.harvester?.position; if (hp) { sun.target.position.copy(hp); sun.position.copy(hp).addScaledVector(sunDir, 200); }
}
/** Продвинуть симуляцию на n шагов по dt секунд (без рендера). */
game.step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) tick(dt); };
/** Отрисовать один кадр и вернуть PNG (dataURL). */
game.shot = () => { tick(0.016); game.render(); frames++; return canvas.toDataURL('image/png'); };
function loop(now) {
  requestAnimationFrame(loop);
  const raw = Math.min(0.1, (now - last) / 1000); last = now;
  if (game.live) { tick(raw); game.render(); frames++; game.stats.fps = Math.round(frames / Math.max(0.001, game.realTime)); }
}
requestAnimationFrame(loop);
game.frames = () => frames + 100;
