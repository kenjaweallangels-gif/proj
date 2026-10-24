import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AstronautBody, applyPose } from '../../src/player/suit/Body.js';
import { SuitAssets } from '../../src/player/suit/Assets.js';
import { loadCrewData } from '../../src/player/suit/CrewMH.js';
import { QUALITY_PRESETS } from '../../src/core/constants.js';

/**
 * Suit lab (dev only, http://127.0.0.1:5173/tools/suitlab/): the astronaut figures alone under a sun + fill
 * light, without the station, for fast visual checks. URL: ?outfit=orlan|crew &variant=blue|red &pose=stand|eva|
 * mount|nbp|bind &hatch=deg &upm=1 &interior=1 (door-open build) &lod=0|1|2 &quality=high|lite &cam=<preset>
 * &bg=space|grey. window.__lab.view(name) moves the camera (presets below); window.__LAB_READY__ when loaded.
 */
const p = new URLSearchParams(location.search);
const quality = p.get('quality') || 'high';
const q = { preset: quality, ...QUALITY_PRESETS[quality] };
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(p.get('bg') === 'grey' ? 0x3a3d42 : 0x020306);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = Number(p.get('env') || 0.35);
const sun = new THREE.DirectionalLight(0xfff4e5, Number(p.get('sun') || 3.2));
sun.position.set(2.5, 3.5, 4);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -1.5, right: 1.5, top: 2.2, bottom: -0.5, near: 0.5, far: 12 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0x0a0d14, 0x6f8fc2, 0.5));
const camera = new THREE.PerspectiveCamera(Number(p.get('fov') || 35), innerWidth / innerHeight, 0.02, 200);

const ctx = { renderer, quality: q, params: p, assetUrl: (x) => `/${x}`, isShot: true };
if (p.get('procedural') !== '1') await loadCrewData(ctx);
globalThis.__THREE_DETAIL = q.detail ?? 1;
const outfit = p.get('outfit') || 'orlan';
const lod = Number(p.get('lod') || 0);
const levels = [[1.0], [0.42], [0.13]][lod];
const body = new AstronautBody(ctx, { outfit, variant: p.get('variant') || 'blue', upm: p.get('upm') === '1', hatchInterior: p.get('interior') === '1', procedural: p.get('procedural') === '1', levels: q.lite ? undefined : levels, castShadow: true });
globalThis.__THREE_DETAIL = 1;
scene.add(body.group);
applyPose(body.rig, p.get('pose') || 'stand', { hatch: p.has('hatch') ? Number(p.get('hatch')) : undefined });
body.group.rotation.y = Number(p.get('yaw') || 0) * Math.PI / 180;
body.group.updateMatrixWorld(true);
if (p.get('ground') === '1') {
  const g = new THREE.Mesh(new THREE.CircleGeometry(2, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.8 }));
  g.receiveShadow = true; scene.add(g);
}

const bone = (n) => body.rig.bone(n).getWorldPosition(new THREE.Vector3());
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const presets = {
  front: () => [V(0.5, 1.25, 3.4), V(0, 0.98, 0)],
  back: () => [V(-0.7, 1.4, -3.3), V(0, 1.05, 0)],
  side: () => [V(3.3, 1.2, 0.5), V(0, 1.0, 0)],
  left: () => [V(-3.3, 1.2, 0.5), V(0, 1.0, 0)],
  q34: () => [V(2.2, 1.5, 2.6), V(0, 1.0, 0)],
  q34back: () => [V(-2.0, 1.6, -2.6), V(0, 1.1, 0)],
  helmet: () => [V(0.35, 1.8, 0.95), V(0, 1.62, 0.05)],
  chest: () => [V(0.25, 1.55, 0.85), V(0, 1.27, 0.15)],
  handR: () => { const h = bone('handR'); return [h.clone().add(V(-0.15, 0.08, 0.45)), h.clone().add(V(0, -0.07, 0.02))]; },
  handL: () => { const h = bone('handL'); return [h.clone().add(V(0.2, 0.05, 0.42)), h.clone().add(V(0, -0.07, 0.02))]; },
  palmR: () => { const h = bone('handR'); return [h.clone().add(V(0.35, -0.02, 0.25)), h.clone().add(V(0, -0.07, 0.0))]; },
  boot: () => [V(0.6, 0.45, 0.8), V(0.05, 0.1, 0.05)],
  face: () => [V(0.12, 1.69, 0.55), V(0, 1.68, 0.02)],
  head: () => [V(0.45, 1.75, 0.35), V(0, 1.68, 0.0)],
  top: () => [V(0.01, 3.6, 0.3), V(0, 1.0, 0)],
};
function view(name) {
  const f = presets[name] || presets.front;
  const [pos, tgt] = f();
  camera.position.copy(pos); camera.lookAt(tgt);
  if (name === 'face' || name === 'helmet' || name.startsWith('hand') || name === 'palmR' || name === 'chest' || name === 'boot' || name === 'head') camera.fov = 30; else camera.fov = Number(p.get('fov') || 35);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
}
window.__lab = { view, body, scene, camera, renderer, stats: body.stats };
await SuitAssets.get(ctx).ready();
view(p.get('cam') || 'front');
// let textures upload, render a few frames
for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(() => { renderer.render(scene, camera); r(); }));
window.__LAB_READY__ = true;
console.info('[suitlab]', JSON.stringify(body.stats));
