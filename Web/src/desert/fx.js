// Атмосферные эффекты: позёмка (струи песка над гребнями), пылинки в луче, пыльные вихри, стена кориолисовой бури,
// пул пылевых клубов (puff) для других модулей.
import * as THREE from 'three';
import { ENV, GLSL_COMMON } from './env.js';
import { heightAt } from './field.js';
import { rng, smoothstep, clamp } from '../core/util.js';

const GROUND_GLSL = /* glsl */`
uniform sampler2D uGT;
float rkG(vec2 p){
  vec2 t = p / 2.0; vec2 f = floor(t); vec2 fr = t - f;
  float a = texelFetch(uGT, ivec2(mod(f, 164.0)), 0).x;
  float b = texelFetch(uGT, ivec2(mod(f + vec2(1.0, 0.0), 164.0)), 0).x;
  float c = texelFetch(uGT, ivec2(mod(f + vec2(0.0, 1.0), 164.0)), 0).x;
  float d = texelFetch(uGT, ivec2(mod(f + vec2(1.0, 1.0), 164.0)), 0).x;
  return mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
}
vec3 rkGN(vec2 p){
  vec2 t = p / 2.0; vec2 f = floor(t);
  vec4 a = texelFetch(uGT, ivec2(mod(f + 0.5, 164.0)), 0);
  return vec3(a.y, sqrt(max(1.0 - a.y * a.y - a.z * a.z, 0.02)), a.z);
}
`;

// ---------------------------------------------------------------- песок бури: полосы, летящие мимо камеры
const SAND_VERT = /* glsl */`
attribute vec4 aSeed;
attribute vec4 aSeed2;
uniform float uR;
uniform float uK;
varying vec2 vUv;
varying float vA;
varying vec3 vWP;
varying vec3 vCol;
${GLSL_COMMON}
void main(){
  vec2 w = normalize(uWind);
  float spd = (0.7 + 0.6 * aSeed.w) * (uWindSpeed * 0.95 + 2.0);
  vec3 dirW = normalize(vec3(w.x, -0.04, w.y));
  vec3 base = aSeed.xyz * 1000.0 + dirW * uTime * spd;
  base.y += sin(uTime * 0.8 + aSeed.x * 40.0) * 0.7;
  vec3 rel = mod(base - cameraPosition + uR, 2.0 * uR) - uR;
  rel.y *= 0.3;
  vec3 center = cameraPosition + rel;
  vec3 toCam = normalize(cameraPosition - center);
  vec3 up = normalize(cross(toCam, dirW));
  float len = (0.8 + 2.6 * aSeed2.x) * (0.6 + uWindSpeed * 0.04);
  float hgt = 0.05 + 0.22 * aSeed2.y;
  vec3 wp = center + dirW * position.x * len + up * position.y * hgt;
  float dist = length(rel);
  vA = uK * 0.7 * (0.2 + 0.8 * aSeed2.z) * smoothstep(0.8, 6.0, dist) * (1.0 - smoothstep(uR * 0.55, uR, dist));
  float lit = rkClawShade(center);
  vCol = vec3(0.9, 0.66, 0.4) * (uKeyColor * 0.14 * lit + uAmbient * 0.34) + uFogColor * 0.22;
  vUv = position.xy; vWP = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const SAND_FRAG = /* glsl */`
varying vec2 vUv; varying float vA; varying vec3 vWP; varying vec3 vCol;
void main(){
  float a = (1.0 - smoothstep(0.0, 1.0, abs(vUv.x))) * (1.0 - smoothstep(0.0, 1.0, abs(vUv.y)));
  a = a * a * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vCol, a);
}`;

// ---------------------------------------------------------------- позёмка
const DRIFT_VERT = /* glsl */`
attribute vec4 aSeed;
attribute vec4 aSeed2;
uniform float uR;
uniform float uIntensity;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vWP;
varying vec3 vCol;
${GLSL_COMMON}
${GROUND_GLSL}
void main(){
  vec2 w = normalize(uWind);
  float spd = (0.35 + 0.65 * aSeed.z) * (uWindSpeed * 0.55 + 0.8);
  vec2 base = aSeed.xy * 2000.0 + w * uTime * spd;
  vec2 rel = mod(base - uCamXZ + uR, 2.0 * uR) - uR;
  vec2 p = uCamXZ + rel;
  float g = rkG(p);
  vec3 gn = rkGN(p);
  float wind = dot(gn.xz, w);            // < 0 — наветренный склон
  float crest = smoothstep(0.02, 0.18, length(gn.xz)) * (0.35 + 0.65 * smoothstep(0.15, -0.35, wind / (length(gn.xz) + 1e-3)));
  float hover = (0.05 + aSeed.w * aSeed.w * 1.4) * (0.6 + 0.8 * crest);
  float y = g + hover;
  vec3 center = vec3(p.x, y, p.y);
  vec3 toCam = normalize(cameraPosition - center);
  vec3 right = normalize(vec3(w.x, 0.0, w.y));
  vec3 up = normalize(cross(toCam, right));
  float len = (1.0 + 2.6 * aSeed2.x) * (0.8 + uWindSpeed * 0.06);
  float hgt = (0.09 + 0.3 * aSeed2.y) * (0.7 + 0.8 * crest);
  vec3 wp = center + right * position.x * len + up * position.y * hgt;
  float dist = length(cameraPosition - center);
  float gust = 0.55 + 0.45 * sin(uTime * 0.7 + aSeed.x * 30.0);
  float vis = smoothstep(1.0, 6.5, uWindSpeed + 3.0 * uStorm);
  vAlpha = uIntensity * vis * (0.14 + 0.86 * crest) * gust * (0.5 + aSeed2.z * 0.6) * 1.05
         * smoothstep(1.5, 8.0, dist) * (1.0 - smoothstep(uR * 0.6, uR * 0.98, length(rel)));
  float lit = rkClawShade(center);
  vCol = vec3(0.86, 0.66, 0.42) * (uKeyColor * (0.28 + 0.72 * smoothstep(0.0, 0.35, uKeyDir.y)) * lit * 0.14 + uAmbient * 0.26);
  // подсветка против солнца: струи горят на гребнях
  vCol += uKeyColor * lit * 0.05 * pow(max(dot(-toCam, uKeyDir), 0.0), 3.0) * vec3(1.0, 0.8, 0.55);
  vUv = position.xy; vWP = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const DRIFT_FRAG = /* glsl */`
varying vec2 vUv; varying float vAlpha; varying vec3 vWP; varying vec3 vCol;
${GLSL_COMMON}
void main(){
  float a = (1.0 - smoothstep(0.0, 1.0, abs(vUv.x))) * (1.0 - smoothstep(0.0, 1.0, abs(vUv.y)));
  a = a * a;
  float n = 0.6 + 0.4 * rkNoise(vUv * vec2(3.0, 5.0) + vWP.xz * 0.2);
  float al = a * n * vAlpha;
  if (al < 0.004) discard;
  vec3 col = rkApplyFog(vCol, vWP);
  gl_FragColor = vec4(col, al);
}`;

// ---------------------------------------------------------------- пылинки
const MOTE_VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uR;
uniform float uPx;
varying float vA;
${GLSL_COMMON}
void main(){
  vec3 drift = vec3(uWind.x, 0.12 * sin(uTime * 0.4 + aSeed.w * 20.0), uWind.y) * (0.25 + uWindSpeed * 0.12) * uTime;
  vec3 base = aSeed.xyz * 1000.0 + drift + vec3(sin(uTime * 0.3 + aSeed.w * 40.0), cos(uTime * 0.27 + aSeed.w * 30.0), 0.0) * 0.6;
  vec3 rel = mod(base - cameraPosition + uR, 2.0 * uR) - uR;
  vec3 wp = cameraPosition + rel * vec3(1.0, 0.45, 1.0);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vec3 v = normalize(wp - cameraPosition);
  float mu = max(dot(v, uKeyDir), 0.0);
  float sunUp = smoothstep(0.0, 0.2, uKeyDir.y);
  sunUp = max(sunUp, 0.55 * uNight);
  float d = length(rel);
  vA = (0.1 + 0.9 * (pow(mu, 3.0) * 0.8 + pow(mu, 30.0) * 2.0)) * sunUp * (0.35 + uDust * 1.6) * (1.0 - smoothstep(uR * 0.7, uR, d)) * smoothstep(0.6, 3.0, d);
  gl_PointSize = uPx * (0.6 + aSeed.w * 1.2) * clamp(7.0 / max(d, 1.0), 0.35, 1.6);
}`;
const MOTE_FRAG = /* glsl */`
varying float vA;
uniform vec3 uCol;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  gl_FragColor = vec4(uCol * 1.4, a * a * vA);
}`;

// ---------------------------------------------------------------- пыльный вихрь
const DEVIL_VERT = /* glsl */`
uniform float uH;
varying vec2 vUv;
varying vec3 vWP;
varying vec3 vN;
void main(){
  vUv = uv;
  float y = uv.y;
  float r = mix(1.0, 7.0, pow(y, 1.6));
  vec3 p = vec3(position.x * r, y * uH, position.z * r);
  // изгиб по ветру и колебания
  p.x += uWindX * y * y * uH * 0.12 + sin(y * 6.0 + uTimeD * 1.3) * y * 3.0;
  p.z += uWindZ * y * y * uH * 0.12 + cos(y * 5.0 + uTimeD * 1.1) * y * 3.0;
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWP = w.xyz;
  vN = normalize(vec3(position.x, 0.0, position.z));
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const DEVIL_FRAG = /* glsl */`
varying vec2 vUv; varying vec3 vWP; varying vec3 vN;
uniform float uFade;
uniform float uSeed;
${GLSL_COMMON}
void main(){
  float y = vUv.y;
  float ang = vUv.x * 6.2831;
  float sw = ang * 2.0 + y * 9.0 - uTime * 2.4 + uSeed;
  float n = rkFbm(vec2(sw * 0.9, y * 5.0 - uTime * 0.9 + uSeed));
  n = n * 0.7 + 0.3 * rkNoise(vec2(sw * 2.4, y * 14.0 - uTime * 1.6));
  float prof = smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.45, 1.0, y));
  float core = 0.35 + 0.65 * smoothstep(0.35, 0.8, n);
  float rim = abs(dot(normalize(cameraPosition - vWP), vN));
  float al = prof * core * (0.24 + 0.6 * pow(rim, 0.7)) * uFade * (0.5 + 0.5 * (1.0 - y));
  if (al < 0.004) discard;
  vec3 lit = uKeyColor * (0.1 + 0.22 * max(dot(vN, uKeyDir), 0.0)) + uAmbient * 0.55;
  vec3 col = vec3(0.7, 0.5, 0.3) * lit * (0.65 + 0.7 * n);
  col = rkApplyFog(col, vWP);
  gl_FragColor = vec4(col, al);
}`;

// ---------------------------------------------------------------- стена бури
const STORM_VERT = /* glsl */`
varying vec3 vWP;
varying vec3 vP;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWP = w.xyz; vP = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const STORM_FRAG = /* glsl */`
varying vec3 vWP; varying vec3 vP;
uniform float uLayer;
uniform float uHmax;
uniform float uBase;
uniform vec2 uCenter;
uniform float uR;
uniform float uAlpha;
${GLSL_COMMON}
void main(){
  vec2 d = vWP.xz - uCenter;
  float a = atan(d.y, d.x);
  float da = mod(a - 2.3562 + 3.14159, 6.28318) - 3.14159;
  float arcF = 1.0 - smoothstep(0.62, 1.38, abs(da));
  arcF = max(arcF, smoothstep(0.55, 0.95, uStorm));
  float h = vWP.y - uBase;
  float t = uTime;
  float s = uStorm;
  float k = smoothstep(0.02, 0.2, s + 0.03);
  float Hm = uHmax * (0.06 + 0.94 * pow(clamp(s / 0.75, 0.0, 1.0), 0.8));
  float u = da * uR;
  float v = h;
  float T = Hm * (0.5 + 0.5 * rkFbm(vec2(u / 1500.0 + uLayer * 7.0, 1.7)));
  T *= 0.86 + 0.28 * rkFbm(vec2(u / 430.0 + uLayer * 3.0, 4.1));
  float lump = rkFbm(vec2(u / 330.0 + uLayer * 5.0, v / 300.0 - t * 0.004));
  float y = v / max(T, 1.0);
  float body = 1.0 - smoothstep(0.6, 1.02, y + (lump - 0.5) * 0.6);
  float bands = rkFbm(vec2(u / 950.0 + uLayer, v / 95.0 - t * 0.006));
  float wisp = rkFbm(vec2(u / 170.0, v / 75.0 + t * 0.01));
  float dens = lump * 0.6 + bands * 0.5;
  float small = wisp;
  float low = smoothstep(-0.01, 0.05, y);
  float al = body * low * (0.8 + 0.4 * (bands - 0.5) + 0.14 * (wisp - 0.5)) * k * arcF * uAlpha;
  al = clamp(al, 0.0, 0.95);
  vec3 L = uKeyDir;
  vec3 N = normalize(vec3(-d.x, 0.0, -d.y));
  float lit = 0.35 + 0.65 * max(dot(N, normalize(vec3(L.x, 0.2, L.z))), 0.0) + 0.5 * pow(max(dot(normalize(vWP - cameraPosition), L), 0.0), 3.0);
  vec3 dark = vec3(0.06, 0.032, 0.015);
  vec3 bright = vec3(0.6, 0.38, 0.2);
  vec3 col = mix(dark, bright, clamp(0.08 + 0.85 * pow(clamp(y, 0.0, 1.2), 1.4) + 0.5 * (bands - 0.45) + 0.25 * (small - 0.45), 0.0, 1.0));
  col *= (uKeyColor * 0.2 + uAmbient * 0.9 + 0.1) * lit * (0.5 + 0.7 * dens);
  col = mix(col, uFogColor, clamp(0.04 + 0.14 * (1.0 - y) + 0.9 * smoothstep(0.4, 0.95, uStorm), 0.0, 1.0));
  if (al < 0.005) discard;
  gl_FragColor = vec4(col, al);
}`;

export function createFx(game, world, terrain, weather) {
  const { scene, camera } = game;
  const q = game.settings.quality;
  const R = rng(4242);
  const group = new THREE.Group();
  scene.add(group);
  const L1 = terrain.levels[1];
  const gt = { value: L1.tex };

  // ---------- позёмка ----------
  const nDrift = q === 'low' ? 350 : q === 'med' ? 2600 : 6500;
  const driftGeo = new THREE.InstancedBufferGeometry();
  driftGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  driftGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const s1 = new Float32Array(nDrift * 4), s2 = new Float32Array(nDrift * 4);
  for (let i = 0; i < nDrift * 4; i++) { s1[i] = R(); s2[i] = R(); }
  driftGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(s1, 4));
  driftGeo.setAttribute('aSeed2', new THREE.InstancedBufferAttribute(s2, 4));
  driftGeo.instanceCount = nDrift;
  const driftMat = new THREE.ShaderMaterial({
    vertexShader: DRIFT_VERT, fragmentShader: DRIFT_FRAG, transparent: true, depthWrite: false,
    uniforms: Object.assign({}, ENV.uniforms, { uR: { value: 120 }, uIntensity: { value: 1 }, uGT: gt }),
  });
  const drift = new THREE.Mesh(driftGeo, driftMat);
  drift.frustumCulled = false; drift.renderOrder = 5;
  group.add(drift);

  // ---------- песок бури ----------
  const nSand = q === 'low' ? 500 : q === 'med' ? 2400 : 4200;
  const sandGeo = new THREE.InstancedBufferGeometry();
  sandGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  sandGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const q1 = new Float32Array(nSand * 4), q2 = new Float32Array(nSand * 4);
  for (let i = 0; i < nSand * 4; i++) { q1[i] = R(); q2[i] = R(); }
  sandGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(q1, 4));
  sandGeo.setAttribute('aSeed2', new THREE.InstancedBufferAttribute(q2, 4));
  sandGeo.instanceCount = nSand;
  const sandMat = new THREE.ShaderMaterial({
    vertexShader: SAND_VERT, fragmentShader: SAND_FRAG, transparent: true, depthWrite: false,
    uniforms: Object.assign({}, ENV.uniforms, { uR: { value: 42 }, uK: { value: 0 } }),
  });
  const sandFly = new THREE.Mesh(sandGeo, sandMat);
  sandFly.frustumCulled = false; sandFly.renderOrder = 9;
  group.add(sandFly);

  // ---------- пылинки ----------
  const nMote = q === 'low' ? 150 : q === 'med' ? 700 : 1400;
  const mg = new THREE.BufferGeometry();
  const ms = new Float32Array(nMote * 4);
  for (let i = 0; i < nMote * 4; i++) ms[i] = R();
  mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 4));
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nMote * 3), 3));
  const moteMat = new THREE.ShaderMaterial({
    vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: Object.assign({}, ENV.uniforms, { uR: { value: 22 }, uPx: { value: 5 * Math.min(2, game.renderer.getPixelRatio()) }, uCol: { value: new THREE.Color(1, 0.85, 0.6) } }),
  });
  const motes = new THREE.Points(mg, moteMat);
  motes.frustumCulled = false; motes.renderOrder = 6;
  group.add(motes);

  // ---------- пыльные вихри ----------
  const nDevil = q === 'low' ? 1 : q === 'med' ? 2 : 3;
  const devils = [];
  const devilGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 14, true);
  devilGeo.translate(0, 0.5, 0);
  for (let i = 0; i < nDevil; i++) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: `uniform float uWindX; uniform float uWindZ; uniform float uTimeD;\n` + DEVIL_VERT,
      fragmentShader: DEVIL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: Object.assign({}, ENV.uniforms, { uH: { value: 100 }, uFade: { value: 0 }, uSeed: { value: R() * 20 }, uWindX: { value: 0 }, uWindZ: { value: 0 }, uTimeD: { value: 0 } }),
    });
    const m = new THREE.Mesh(devilGeo, mat);
    m.frustumCulled = false; m.renderOrder = 7;
    group.add(m);
    devils.push({ m, mat, x: 0, z: 0, vx: 0, vz: 0, life: 0, age: 0, h: 100, wanderSeed: R() * 100 });
  }
  function respawn(d, first) {
    const a = R() * Math.PI * 2, r = (first ? 120 : 250) + R() * 450;
    d.x = camera.position.x + Math.cos(a) * r; d.z = camera.position.z + Math.sin(a) * r;
    d.h = 60 + R() * 90; d.life = 40 + R() * 50; d.age = first ? R() * d.life * 0.5 : 0;
    d.m.scale.set(1.5 + R() * 2, 1, 1.5 + R() * 2);
    d.mat.uniforms.uH.value = d.h;
  }
  devils.forEach((d) => respawn(d, true));

  // ---------- стена бури ----------
  const stormMeshes = [];
  const arcA0 = 135 * Math.PI / 180;
  const layers = [{ r: 4500, h: 2300, base: -150, seed: 1, alpha: 1 }, { r: 3900, h: 1500, base: -120, seed: 2.3, alpha: 0.55 }];
  layers.forEach((ly, i) => {
    const arc = Math.PI * 2;
    const g = new THREE.CylinderGeometry(ly.r, ly.r, ly.h, 144, 1, true, 0, arc);
    // CylinderGeometry: угол theta от +z к +x по часовой; центрируем на SW (-x, +z)
    g.translate(0, ly.h / 2 + ly.base, 0);
    const mat = new THREE.ShaderMaterial({
      vertexShader: STORM_VERT, fragmentShader: STORM_FRAG, transparent: true, depthWrite: false, side: THREE.BackSide,
      uniforms: Object.assign({}, ENV.uniforms, { uLayer: { value: ly.seed }, uHmax: { value: ly.h }, uBase: { value: ly.base }, uCenter: { value: new THREE.Vector2() }, uR: { value: ly.r }, uAlpha: { value: ly.alpha } }),
    });
    const m = new THREE.Mesh(g, mat);
    // theta=0 → +z; θ растёт к +x. Центр дуги (θ=arc/2) нужно повернуть на направление SW: (-1,0,+1)
    // направление центра в плоскости XZ при θ: (sin θ, cos θ) → хотим (-0.707, 0.707) → θc = -45° ... поворот вокруг Y
    const thetaC = Math.atan2(-0.7071, 0.7071); // = -45°
    m.rotation.y = 0;
    m.frustumCulled = false; m.renderOrder = -500 + i;
    group.add(m);
    stormMeshes.push(m);
  });

  // ---------- пул клубов пыли ----------
  const NP = 160;
  const pg = new THREE.InstancedBufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  pg.setIndex([0, 1, 2, 0, 2, 3]);
  const pA = new THREE.InstancedBufferAttribute(new Float32Array(NP * 4), 4); // x,y,z,t0
  const pV = new THREE.InstancedBufferAttribute(new Float32Array(NP * 4), 4); // vx,vy,vz,life
  const pS = new THREE.InstancedBufferAttribute(new Float32Array(NP * 4), 4); // size, alpha, seed, grow
  pA.setUsage(THREE.DynamicDrawUsage); pV.setUsage(THREE.DynamicDrawUsage); pS.setUsage(THREE.DynamicDrawUsage);
  pg.setAttribute('aA', pA); pg.setAttribute('aV', pV); pg.setAttribute('aS', pS);
  pg.instanceCount = NP;
  for (let i = 0; i < NP; i++) { pV.array[i * 4 + 3] = 0.0001; pA.array[i * 4 + 3] = -1000; }
  const puffMat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      attribute vec4 aA; attribute vec4 aV; attribute vec4 aS;
      varying vec2 vUv; varying float vAl; varying vec3 vWP; varying float vSeed;
      ${GLSL_COMMON}
      void main(){
        float age = uTime - aA.w;
        float k = clamp(age / aV.w, 0.0, 1.0);
        vec3 p = aA.xyz + aV.xyz * (1.0 - exp(-age * 0.9)) / 0.9 + vec3(uWind.x, 0.0, uWind.y) * age * 0.6;
        p.y += 0.3 * age;
        float s = aS.x * (1.0 + aS.w * k);
        vec3 toCam = normalize(cameraPosition - p);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        vec3 up = cross(toCam, right);
        vec3 wp = p + (right * position.x + up * position.y) * s;
        vAl = aS.y * (1.0 - k) * smoothstep(0.0, 0.08, k + 0.001) * step(0.0, age) * step(age, aV.w);
        vUv = position.xy; vWP = wp; vSeed = aS.z;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying float vAl; varying vec3 vWP; varying float vSeed;
      ${GLSL_COMMON}
      void main(){
        float r = length(vUv);
        float n = rkNoise(vUv * 2.0 + vSeed * 10.0 + uTime * 0.2) * 0.6 + 0.4;
        float a = smoothstep(1.0, 0.1, r) * n * vAl;
        if (a < 0.004) discard;
        vec3 col = vec3(0.78, 0.6, 0.38) * (uKeyColor * 0.32 + uAmbient * 0.95);
        col = rkApplyFog(col, vWP);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true, depthWrite: false, uniforms: Object.assign({}, ENV.uniforms),
  });
  const puffs = new THREE.Mesh(pg, puffMat);
  puffs.frustumCulled = false; puffs.renderOrder = 8;
  group.add(puffs);
  let pHead = 0;
  function puff(x, y, z, o = {}) {
    const n = o.count ?? 6;
    const now = ENV.uniforms.uTime.value;
    for (let k = 0; k < n; k++) {
      const i = pHead; pHead = (pHead + 1) % NP;
      const sp = o.speed ?? 1.5, sp2 = o.spread ?? 0.8;
      pA.array.set([x + (R() - 0.5) * sp2, y + R() * 0.2, z + (R() - 0.5) * sp2, now], i * 4);
      pV.array.set([(R() - 0.5) * sp, (R() * 0.6 + 0.2) * (o.up ?? 1) * sp, (R() - 0.5) * sp, (o.life ?? 2.2) * (0.7 + R() * 0.6)], i * 4);
      pS.array.set([(o.size ?? 0.8) * (0.7 + R() * 0.6), o.alpha ?? 0.35, R(), o.grow ?? 2.2], i * 4);
    }
    pA.needsUpdate = true; pV.needsUpdate = true; pS.needsUpdate = true;
  }
  game.bus.on('footstep', (e) => {
    if (!e || e.surface === 'rock') return;
    if (game.space === 'sietch') return;
    const n = (e.actor === 'player') ? 2 : 1;
    puff(e.x, heightAt(e.x, e.z) + 0.05, e.z, { count: n, size: 0.28, life: 1.1, speed: 0.7, spread: 0.3, alpha: 0.25, grow: 1.6 });
  });
  game.bus.on('thumper', (e) => { if (e) puff(e.x, heightAt(e.x, e.z), e.z, { count: 14, size: 1.6, life: 3, speed: 3, spread: 1.5, alpha: 0.4 }); });
  game.bus.on('worm:breach', (e) => { if (e) puff(e.x, heightAt(e.x, e.z), e.z, { count: 60, size: 12, life: 7, speed: 18, spread: 20, alpha: 0.5, up: 2.5, grow: 3 }); });

  const fx = {
    group, puff, drift, motes, devils, stormMeshes,
    setVisible(b) { group.visible = b; },
    update(dt, t) {
      const cp = camera.position;
      const w = weather;
      const wspd = w.windSpeed;
      driftMat.uniforms.uGT.value = L1.tex;
      driftMat.uniforms.uIntensity.value = 1;
      { const kc = ENV.uniforms.uKeyColor.value, am = ENV.uniforms.uAmbient.value, nk = 0.5 * ENV.uniforms.uNight.value;
        moteMat.uniforms.uCol.value.setRGB(kc.r * 0.35 + am.r * nk, kc.g * 0.35 + am.g * nk, kc.b * 0.35 + am.b * nk); }
      // вихри
      for (const d of devils) {
        d.age += dt;
        const wob = Math.sin(t * 0.13 + d.wanderSeed) * 2.5;
        d.vx = w.windDir.x * (1.2 + wspd * 0.35) + wob * 0.2; d.vz = w.windDir.z * (1.2 + wspd * 0.35) - wob * 0.2;
        d.x += d.vx * dt; d.z += d.vz * dt;
        const y = heightAt(d.x, d.z);
        d.m.position.set(d.x, y - 1, d.z);
        const fadeIn = smoothstep(0, 6, d.age), fadeOut = 1 - smoothstep(d.life - 8, d.life, d.age);
        const distFade = 1 - smoothstep(900, 1400, Math.hypot(d.x - cp.x, d.z - cp.z));
        d.mat.uniforms.uFade.value = fadeIn * fadeOut * distFade * (0.35 + 0.65 * smoothstep(1, 8, wspd + w.storm * 8));
        d.mat.uniforms.uWindX.value = w.windDir.x; d.mat.uniforms.uWindZ.value = w.windDir.z;
        d.mat.uniforms.uTimeD.value = t;
        if (d.age > d.life || Math.hypot(d.x - cp.x, d.z - cp.z) > 1500) respawn(d, false);
      }
      // стена бури следует за камерой по XZ
      const wallK = 1 - 0.78 * smoothstep(0.4, 1.0, w.storm);   // стена надвигается: радиус кольца уменьшается
      for (const m of stormMeshes) { m.position.x = cp.x; m.position.z = cp.z; m.scale.set(wallK, 1, wallK); m.material.uniforms.uCenter.value.set(cp.x, cp.z); }
      // песок, летящий мимо камеры: буря и сильный ветер
      const kStorm = smoothstep(0.12, 0.9, w.storm) * 0.75, kWind = smoothstep(7, 15, wspd) * 0.28;
      sandMat.uniforms.uK.value = Math.max(kStorm, kWind) * (game.space === 'sietch' ? 0 : 1);
      sandFly.visible = sandMat.uniforms.uK.value > 0.004;
    },
  };
  return fx;
}
