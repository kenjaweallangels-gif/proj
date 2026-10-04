// Лаборатория ряби: плоскость/дюны + ТОТ ЖЕ GLSL ряби, что в ландшафте (RIPPLE_GLSL/RIPPLE_BLOCK из desert/terrain.js), простое освещение.
// Параметры в URL: ?sun=elevDeg&az=deg&cx=..&cy=..&cz=..&yaw=deg&pitch=deg&dunes=1&old=0&wind=deg&fov=60
// Сборка/снимки: node tools/ripple_lab.mjs
import * as THREE from 'three';
import { GLSL_COMMON } from '../src/desert/env.js';
import { RIPPLE_GLSL, RIPPLE_BLOCK } from '../src/desert/terrain.js';

const qs = new URLSearchParams(location.search);
const num = (k, d) => (qs.has(k) ? Number(qs.get(k)) : d);
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(canvas.clientWidth || 960, canvas.clientHeight || 540, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(num('fov', 60), (canvas.clientWidth || 960) / (canvas.clientHeight || 540), 0.05, 3000);
const cp = new THREE.Vector3(num('cx', 0), num('cy', 1.7), num('cz', 0));
camera.position.copy(cp);
const yaw = num('yaw', 0) * Math.PI / 180, pitch = num('pitch', -10) * Math.PI / 180;
camera.lookAt(cp.x + Math.cos(yaw) * Math.cos(pitch), cp.y + Math.sin(pitch), cp.z + Math.sin(yaw) * Math.cos(pitch));
camera.updateMatrixWorld(true);
const sunE = num('sun', 10) * Math.PI / 180, sunA = num('az', 20) * Math.PI / 180;
const sun = new THREE.Vector3(Math.cos(sunE) * Math.cos(sunA), Math.sin(sunE), Math.cos(sunE) * Math.sin(sunA));
const windA = num('wind', 0) * Math.PI / 180;

const vs = /* glsl */`
varying vec3 vWP; varying vec3 vTN;
uniform float uDunes;
float dh(vec2 p){ float u = p.x / 34.0; return uDunes * (5.0 * sin(u) + 1.6 * sin(u * 2.7 + p.y / 41.0) + 0.9 * sin(p.y / 23.0 + u * 0.6)); }
void main(){
  vec3 p = position; p.y = dh(p.xz);
  float e = 0.5;
  vec3 n = normalize(vec3(-(dh(p.xz + vec2(e, 0.0)) - dh(p.xz - vec2(e, 0.0))) / (2.0 * e), 1.0, -(dh(p.xz + vec2(0.0, e)) - dh(p.xz - vec2(0.0, e))) / (2.0 * e)));
  vWP = p; vTN = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const fs = /* glsl */`
precision highp float;
${GLSL_COMMON}
varying vec3 vWP; varying vec3 vTN;
uniform vec3 uSunL; uniform float uQual; uniform float uOld;
${RIPPLE_GLSL}
void main(){
  vec3 Ng = normalize(vTN);
  vec2 xz = vWP.xz;
  vec2 acr = vec2(-uWind.y, uWind.x);
  float uu = dot(xz, uWind), vv = dot(xz, acr);
  float dist = length(cameraPosition - vWP);
  float slope = 1.0 - Ng.y;
  float nxzl = length(Ng.xz) + 1e-4;
  float rockM = 0.0, packedM = 0.0, disturb = 0.0;
  ${RIPPLE_BLOCK}
  vec3 gw = vec3(g.x, 0.0, g.y);
  gw -= Ng * dot(gw, Ng);
  vec3 N = normalize(Ng - gw);
  vec3 col = vec3(0.81, 0.69, 0.51);
  float nl = max(dot(N, uSunL), 0.0);
  float nl0 = max(dot(Ng, uSunL), 0.0);
  vec3 c = col * (vec3(0.30, 0.31, 0.34) + vec3(1.0, 0.86, 0.68) * nl * 1.7);
  float f = 1.0 - exp(-dist * 0.0009);
  c = mix(c, vec3(0.85, 0.74, 0.60), f);
  gl_FragColor = vec4(pow(c, vec3(0.8)), 1.0);
}`;
const mat = new THREE.ShaderMaterial({
  vertexShader: vs, fragmentShader: fs,
  uniforms: {
    uWind: { value: new THREE.Vector2(Math.cos(windA), Math.sin(windA)) }, uSunL: { value: sun }, uQual: { value: 1 }, uOld: { value: 0 },
    uDunes: { value: num('dunes', 0) },
    uTime: { value: 0 }, uSunDir: { value: sun }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uAmbient: { value: new THREE.Color() }, uKeyDir: { value: sun }, uKeyColor: { value: new THREE.Color() },
    uNight: { value: 0 }, uInvExp: { value: 1 }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: 0 }, uFogFalloff: { value: 0 }, uMist: { value: 0 }, uFogSun: { value: 0 }, uWindSpeed: { value: 5 }, uStorm: { value: 0 }, uDust: { value: 0 },
    uCamXZ: { value: new THREE.Vector2() }, uHeat: { value: 0 },
  },
});
const geo = new THREE.PlaneGeometry(1600, 1600, 400, 400); geo.rotateX(-Math.PI / 2);
scene.add(new THREE.Mesh(geo, mat));
scene.background = new THREE.Color(0.7, 0.62, 0.52);
window.__lab = { render() { renderer.render(scene, camera); return canvas.toDataURL('image/png'); } };
