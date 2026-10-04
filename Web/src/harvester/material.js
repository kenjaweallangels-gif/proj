// Материалы харвестера: основной (триплонарные панели, заклёпки, грязь, ржавчина, пыль на верхних гранях),
// свечение (окна/лампы), декали-трафареты (атлас на canvas).
import * as THREE from 'three';
import { patchMaterial } from '../desert/env.js';
import { rng } from '../core/util.js';
import { triplanarKit } from '../core/triplanar.js';

const VERT_PARS = /* glsl */`
attribute float aTag;
varying vec3 vLP;
varying vec3 vLN;
varying vec3 vWP;
varying float vTag;
varying vec3 vHR0; varying vec3 vHR1; varying vec3 vHR2;
`;
const VERT_MAIN = /* glsl */`
vec3 transformed = vec3(position);
vLP = position;
vLN = normal;
vTag = aTag;
{
  mat3 hvR = mat3(modelViewMatrix);
  #ifdef USE_INSTANCING
  hvR = hvR * mat3(instanceMatrix);
  #endif
  vHR0 = hvR[0]; vHR1 = hvR[1]; vHR2 = hvR[2];

  vec4 hvW = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  hvW = instanceMatrix * hvW;
  vLN = mat3(instanceMatrix) * normal;
  #endif
  vWP = (modelMatrix * hvW).xyz;
}
`;

const FRAG_PARS = /* glsl */`
varying vec3 vLP;
varying vec3 vLN;
varying vec3 vWP;
varying float vTag;
varying vec3 vHR0; varying vec3 vHR1; varying vec3 vHR2;
uniform float uWear;
vec3 gTpD = vec3(0.0);
float gH;
float gR;
`;

const FRAG_COLOR = /* glsl */`
#include <color_fragment>
{
  vec3 N = normalize(vLN);
  vec3 aN = abs(N);
  vec2 uv; float ax;
  if (aN.x > aN.y && aN.x > aN.z) { uv = vec2(vLP.z, vLP.y); ax = 0.0; }
  else if (aN.y > aN.z) { uv = vLP.xz; ax = 1.0; }
  else { uv = vLP.xy; ax = 2.0; }
  float dist = distance(cameraPosition, vWP);
  float lod = 1.0 - smoothstep(30.0, 150.0, dist);
  float lod2 = 1.0 - smoothstep(80.0, 400.0, dist);
  int tag = int(vTag + 0.5);
  vec3 base = diffuseColor.rgb;

  // --- панели 4x2 м со швами и заклёпками
  vec2 psz = (tag == 1) ? vec2(2.0, 2.0) : vec2(4.0, 2.0);
  vec2 cell = floor(uv / psz);
  vec2 f = uv - cell * psz;
  float ch = rkHash12(cell + ax * 13.7 + floor(vLP.x * 0.02) * 3.1);
  float ch2 = rkHash12(cell * 1.7 + 41.0 + ax);
  vec2 e = min(f, psz - f);
  float edge = min(e.x, e.y);
  float seam = (1.0 - smoothstep(0.0, 0.04, edge)) * step(float(tag), 3.5);
  if (tag == 2) seam *= 0.4;
  float riv = 0.0;
  if (lod > 0.01 && tag != 2 && tag != 7) {
    float r1 = length(vec2(e.x - 0.22, (fract(f.y / 0.45) - 0.5) * 0.45)) * step(0.15, e.y);
    float r2 = length(vec2(e.y - 0.22, (fract(f.x / 0.45) - 0.5) * 0.45)) * step(0.15, e.x);
    float r = min(e.x < 0.4 ? r1 : 9.0, e.y < 0.4 ? r2 : 9.0);
    riv = (1.0 - smoothstep(0.05, 0.075, r)) * lod;
  }
  base *= (0.95 + 0.12 * ch) * 1.12;
  // латаные листы: более светлые оливково-серые
  float patchK = step(0.9, ch2) * step(float(tag), 0.5);
  base = mix(base, vec3(0.30, 0.31, 0.26) * (0.8 + 0.4 * ch), patchK);
  base *= 1.0 - 0.45 * seam;
  base += vec3(0.045) * riv * lod * (1.0 - patchK * 0.5);

  float n1 = 0.55, n2 = 0.5, n3 = 0.5, dirt = 0.35, chip = 0.0, oil = 0.0, scour = 0.0;
  float low = smoothstep(16.0, 5.0, vLP.y);
  vec3 sand = vec3(0.62, 0.46, 0.28);
  if (dist < 170.0) {
  // --- грязь, масляные потёки, ржавчина
  n1 = rkFbm(uv * 0.45 + ax * 9.0 + vLP.x * 0.05);
  n2 = rkFbm(uv * 2.3 + 3.0 + ax * 5.0);
  n3 = rkNoise(uv * 9.0 + ax);
  dirt = smoothstep(0.30, 0.85, n1) * (0.5 + 0.5 * uWear);
  base = mix(base, base * vec3(0.62, 0.54, 0.46), dirt * 0.55);
  float rustN = rkFbm(uv * 0.9 + 11.0 + ax * 3.0) + seam * 0.22 + (1.0 - smoothstep(0.0, 9.0, vLP.y)) * 0.12;
  float rustK = (tag == 3 ? 1.5 : 0.42) * uWear;
  float rust = smoothstep(0.56, 0.78, rustN) * clamp(rustK, 0.0, 1.0);
  vec3 rustC = mix(vec3(0.30, 0.11, 0.045), vec3(0.50, 0.22, 0.07), n2);
  if (tag != 2) base = mix(base, rustC, rust * 0.85);
  // сколы краски у кромок
  chip = smoothstep(0.14, 0.0, edge) * smoothstep(0.45, 0.7, n2 + n3 * 0.3) * step(float(tag), 3.5) * uWear;
  base = mix(base, vec3(0.36, 0.33, 0.30), chip * 0.55 * lod);
    if (ax != 1.0) {
    float st = rkNoise(vec2(uv.x * 2.3 + ch * 7.0, uv.y * 0.08));
    float st2 = rkNoise(vec2(uv.x * 5.7, uv.y * 0.04 + 2.0));
    oil = smoothstep(0.64, 0.82, st) * (0.4 + 0.6 * smoothstep(0.2, 0.8, st2)) * (0.3 + 0.7 * smoothstep(20.0, 4.0, vLP.y));
    base = mix(base, vec3(0.05, 0.04, 0.03), oil * 0.7 * uWear);
  }
  // --- пескоструй: внизу краска стёрта, налёт песка
  scour = low * smoothstep(0.35, 0.75, n1 + n3 * 0.25);
  if (tag != 2) base = mix(base, vec3(0.38, 0.34, 0.30), scour * 0.5 * uWear);
  base = mix(base, sand * (0.8 + 0.4 * n2), low * (0.2 + 0.3 * n1) * uWear);
  } else {
    float nf = rkNoise(uv * 0.25 + ax * 5.0);
    n1 = nf; n2 = nf; dirt = 0.4;
    base = mix(base, base * vec3(0.62, 0.54, 0.46), 0.2 + 0.25 * nf);
    base = mix(base, sand * 0.8, low * (0.14 + 0.25 * nf));
    scour = low * 0.5;
  }
  // --- сигнальные полосы
  if (tag == 4) {
    float s = step(0.5, fract((uv.x + uv.y) / 1.3));
    base = mix(vec3(0.62, 0.42, 0.03), vec3(0.035), s) * (0.8 + 0.4 * n2);
  }
  // --- пыль на верхних гранях
  float top = smoothstep(0.55, 0.95, N.y) * (0.55 + 0.45 * rkFbm(uv * 1.7));
  vec3 spiceC = mix(sand, vec3(0.62, 0.32, 0.14), 0.35 * smoothstep(0.4, 0.8, n1));
  base = mix(base, spiceC * (0.85 + 0.3 * n3), top * 0.6 * (tag == 2 ? 0.5 : 1.0));

  gH = (-seam * 0.016 * (0.3 + 0.7 * lod) + riv * 0.011 + (n1 - 0.5) * 0.004 * lod);
  gR = mix(0.5, 0.92, clamp(dirt + top + scour, 0.0, 1.0));
  gR = mix(gR, 0.28, oil * 0.8);
  if (tag == 2) gR = 0.9;
  if (tag == 7) {   // перепонка крыльев, брезент: ткань без заклёпок
    float wv = sin(uv.x * 36.0) * sin(uv.y * 36.0) * 0.5 + 0.5;
    base = diffuseColor.rgb * (0.95 + 0.1 * rkNoise(uv * 5.0)) * (0.93 + 0.1 * wv * lod) * (1.0 - 0.18 * smoothstep(0.4, 0.9, n1));
    base = mix(base, sand * 0.8, top * 0.25);
    gR = 0.85; gH = 0.0;
  }
  if (tag == 6) {   // песчаные наносы на корпусе
    float rip = sin((uv.x * 1.3 + uv.y * 0.7) * 5.0 + n1 * 6.0) * 0.5 + 0.5;
    base = mix(sand, vec3(0.62, 0.34, 0.17), 0.18 * smoothstep(0.5, 0.9, n1)) * (0.88 + 0.2 * n2) * (0.93 + 0.1 * rip);
    gR = 0.96; gH = rip * 0.012;
  }
  base *= 1.0 - 0.25 * (1.0 - lod2) * 0.0;
#ifdef HV_TEX
  float tpK = (1.0 - smoothstep(40.0, 190.0, dist)) * uHTexK.x * (tag == 4 ? 0.3 : (tag == 6 ? 0.0 : 1.0));
  if (tpK > 0.002) {
    tpHEval(vLP, N);
    base *= mix(vec3(1.0), clamp(tpHMul, 0.8, 1.22), tpK * uHTexK.y * (tag == 2 ? 0.5 : 1.0));
    gR = mix(gR, clamp(gR * (0.35 + tpHRgh), 0.05, 1.0), tpK * uHTexK.z);
    gTpD = (tpHNW - N) * tpK * uHTexK.w;
  }
#endif
  diffuseColor.rgb = base;
}
`;
const FRAG_FILL = `reflectedLight.indirectDiffuse += diffuseColor.rgb * uAmbient * (0.4 + 0.4 * clamp(normalize(vLN).y * 0.5 + 0.5, 0.0, 1.0));`;
const FRAG_ROUGH = `roughnessFactor = gR;`;
const FRAG_NORMAL = /* glsl */`
{
  vec2 dH = vec2(dFdx(gH), dFdy(gH)) * 14.0;
  vec3 sX = dFdx(-vViewPosition), sY = dFdy(-vViewPosition);
  vec3 R1 = cross(sY, normal), R2 = cross(normal, sX);
  float det = dot(sX, R1) * faceDirection;
  vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
  normal = normalize(abs(det) * normal - grad);
  normal = normalize(normal + mat3(vHR0, vHR1, vHR2) * gTpD);
}
`;

/** Основной материал (используется и InstancedMesh: звенья гусениц, колёса, перила, болты). */
export function createHullMaterial(quality) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.12, vertexColors: true });
  mat.userData.wear = { value: 1 };
  const kit = triplanarKit('tpH', 'metal_rusty', { scale: 2.2, sharpness: 6, quality, ao: 0, normal: 1, chroma: 0.25 });
  patchMaterial(mat, 'hv-hull' + (quality === 'low' ? 'L' : '') + (kit ? 't' : ''), {
    uniforms: { uWear: mat.userData.wear, uHTexK: { value: new THREE.Vector4(1, 0.55, 0.6, 0.28) }, ...(kit ? kit.uniforms : {}) },
    vertexPars: VERT_PARS, vertexMain: VERT_MAIN,
    fragPars: (kit ? '#define HV_TEX\nuniform vec4 uHTexK;\n' + kit.pars : '') + FRAG_PARS, fragColor: FRAG_COLOR, fragRough: FRAG_ROUGH, fragLightsEnd: FRAG_FILL,
    fragNormal: quality === 'low' ? '' : FRAG_NORMAL,
  });
  return mat;
}

/** Светящиеся элементы (окна, лампы): MeshBasic, цвет — вершинный, яркость — material.color. */
export function createGlowMaterial(vertexColors = true) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors });
  patchMaterial(mat, 'hv-glow' + (vertexColors ? 'v' : ''), {
    vertexPars: 'varying vec3 vWP;\n',
    vertexMain: 'vec3 transformed = vec3(position); { vec4 hvW = vec4(position, 1.0);\n#ifdef USE_INSTANCING\nhvW = instanceMatrix * hvW;\n#endif\nvWP = (modelMatrix * hvW).xyz; }\n',
    fragPars: 'varying vec3 vWP;\n',
  });
  return mat;
}

// ---------------------------------------------------------------- декали (атлас трафаретов)
export const ATLAS = {
  // имя → [u0, v0, u1, v1] в долях атласа 2048x1024
  sigil: [0, 0, 0.25, 0.5],            // круглая эмблема гильдии
  name: [0.25, 0, 1.0, 0.25],          // название гильдии (широкая надпись)
  num: [0.25, 0.25, 0.625, 0.5],       // номер борта
  warn: [0.625, 0.25, 0.75, 0.5],      // треугольник «опасно»
  stencil: [0.75, 0.25, 1.0, 0.5],     // инструкция-трафарет
  chev: [0, 0.5, 0.5, 0.75],           // шевроны
  noent: [0.5, 0.5, 0.75, 0.75],       // «не входить при пуске»
  glyphs: [0.75, 0.5, 1.0, 0.75],      // ряд глифов
  tally: [0, 0.75, 1.0, 1.0],          // чёрточки-счёт (метки смен)
};

export function createDecalTexture() {
  const W = 2048, H = 1024;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  const R = rng(4242);
  const PAINT = '#e9dcc0', TEAL = '#4d9a90', DARK = '#1b1a18', WARN = '#e0a820';
  const rect = (k) => { const a = ATLAS[k]; return [a[0] * W, a[1] * H, (a[2] - a[0]) * W, (a[3] - a[1]) * H]; };
  x.textBaseline = 'middle'; x.textAlign = 'center';

  { // эмблема: три вложенных дуги вокруг червя-кольца
    const [rx, ry, rw, rh] = rect('sigil'); const cx = rx + rw / 2, cy = ry + rh / 2;
    x.strokeStyle = PAINT; x.fillStyle = PAINT; x.lineWidth = 22;
    x.beginPath(); x.arc(cx, cy, 215, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 14; x.beginPath(); x.arc(cx, cy, 165, 0.3, Math.PI * 2 - 0.3); x.stroke();
    x.beginPath(); x.arc(cx, cy, 112, 1.0, Math.PI * 2 + 0.2); x.stroke();
    x.lineWidth = 26; x.beginPath(); x.moveTo(cx - 70, cy + 95); x.lineTo(cx, cy - 70); x.lineTo(cx + 70, cy + 95); x.stroke();
    x.beginPath(); x.arc(cx, cy - 10, 20, 0, Math.PI * 2); x.fill();
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; x.lineWidth = 10; x.beginPath(); x.moveTo(cx + Math.cos(a) * 232, cy + Math.sin(a) * 232); x.lineTo(cx + Math.cos(a) * 250, cy + Math.sin(a) * 250); x.stroke(); }
  }
  { // название
    const [rx, ry, rw, rh] = rect('name');
    x.fillStyle = PAINT; x.font = 'bold 150px "Arial Black", Impact, sans-serif';
    x.fillText('САРТ-МАКР', rx + rw / 2, ry + rh * 0.42);
    x.font = 'bold 66px Arial, sans-serif'; x.fillStyle = TEAL;
    x.fillText('ДОБЫЧНАЯ ГИЛЬДИЯ · SARTH-MAKR EXTRACTION', rx + rw / 2, ry + rh * 0.82);
  }
  { // номер
    const [rx, ry, rw, rh] = rect('num');
    x.fillStyle = PAINT; x.font = 'bold 190px "Arial Black", Impact, sans-serif';
    x.fillText('ХВ-017', rx + rw / 2, ry + rh / 2);
  }
  { // треугольник
    const [rx, ry, rw, rh] = rect('warn');
    x.fillStyle = WARN; x.beginPath(); x.moveTo(rx + rw / 2, ry + 12); x.lineTo(rx + rw - 12, ry + rh - 14); x.lineTo(rx + 12, ry + rh - 14); x.closePath(); x.fill();
    x.fillStyle = DARK; x.beginPath(); x.moveTo(rx + rw / 2, ry + 42); x.lineTo(rx + rw - 40, ry + rh - 28); x.lineTo(rx + 40, ry + rh - 28); x.closePath(); x.fill();
    x.fillStyle = WARN; x.font = 'bold 120px Arial'; x.fillText('!', rx + rw / 2, ry + rh * 0.66);
  }
  { // инструкция
    const [rx, ry, rw, rh] = rect('stencil');
    x.fillStyle = PAINT; x.font = 'bold 44px "Courier New", monospace'; x.textAlign = 'left';
    ['ПУСК: КЛАКСОН 10 С', 'ЗАГРУЗКА ≤ 4 000 ТОНН', 'ЗАПРЕТ ХОДА ПРИ БУРЕ', 'НЕ СТОЯТЬ У ЖЕРНОВА', 'ТАРА: ТОЛЬКО ПЕРЕНОСЧИК'].forEach((s, i) => x.fillText(s, rx + 18, ry + 36 + i * 46));
    x.textAlign = 'center';
  }
  { // шевроны
    const [rx, ry, rw, rh] = rect('chev');
    x.fillStyle = WARN;
    for (let i = 0; i < 6; i++) { const px = rx + 20 + i * (rw - 40) / 6; x.beginPath(); x.moveTo(px, ry + rh * 0.1); x.lineTo(px + 70, ry + rh * 0.1); x.lineTo(px + 140, ry + rh / 2); x.lineTo(px + 70, ry + rh * 0.9); x.lineTo(px, ry + rh * 0.9); x.lineTo(px + 70, ry + rh / 2); x.closePath(); x.fill(); }
  }
  { // «не входить»
    const [rx, ry, rw, rh] = rect('noent');
    x.strokeStyle = '#c24a2a'; x.lineWidth = 18; x.beginPath(); x.arc(rx + rw / 2, ry + rh / 2, rh * 0.38, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.moveTo(rx + rw * 0.28, ry + rh * 0.78); x.lineTo(rx + rw * 0.72, ry + rh * 0.22); x.stroke();
    x.fillStyle = PAINT; x.font = 'bold 42px Arial'; x.fillText('НЕ ВХОДИТЬ ПРИ ПУСКЕ', rx + rw / 2, ry + rh * 0.95);
  }
  { // глифы (выдуманная гильдейская «письменность»)
    const [rx, ry, rw, rh] = rect('glyphs');
    x.strokeStyle = TEAL; x.lineWidth = 12; x.lineCap = 'round';
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
      const cx = rx + 50 + i * 85, cy = ry + 50 + j * 78; const k = Math.floor(R() * 5);
      x.beginPath();
      if (k === 0) { x.moveTo(cx - 22, cy + 22); x.lineTo(cx, cy - 24); x.lineTo(cx + 22, cy + 22); }
      else if (k === 1) { x.arc(cx, cy, 22, 0.5, 5.4); }
      else if (k === 2) { x.moveTo(cx - 24, cy); x.lineTo(cx + 24, cy); x.moveTo(cx, cy - 24); x.lineTo(cx, cy + 24); }
      else if (k === 3) { x.moveTo(cx - 20, cy - 20); x.lineTo(cx + 20, cy + 20); x.moveTo(cx + 20, cy - 20); x.lineTo(cx - 6, cy + 6); }
      else { x.rect(cx - 18, cy - 18, 36, 36); }
      x.stroke();
    }
  }
  { // метки смен: пучки по пять
    const [rx, ry, rw, rh] = rect('tally');
    x.strokeStyle = PAINT; x.lineWidth = 9; x.lineCap = 'round';
    for (let g = 0; g < 14; g++) {
      const bx = rx + 40 + g * (rw - 80) / 14;
      for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(bx + i * 14, ry + 40); x.lineTo(bx + i * 14, ry + rh - 40); x.stroke(); }
      x.beginPath(); x.moveTo(bx - 8, ry + rh - 55); x.lineTo(bx + 54, ry + 55); x.stroke();
    }
  }
  // стёртость: выедаем краску пятнами и царапинами (пескоструй)
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i++) {
    const px = R() * W, py = R() * H, r = 1 + R() * 5;
    x.globalAlpha = 0.25 + R() * 0.6; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
  }
  for (let i = 0; i < 220; i++) {
    x.globalAlpha = 0.5; x.lineWidth = 1 + R() * 3; x.beginPath();
    const px = R() * W, py = R() * H; x.moveTo(px, py); x.lineTo(px + (R() - 0.5) * 140, py + (R() - 0.5) * 30); x.stroke();
  }
  x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

export function createDecalMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.8, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  patchMaterial(mat, 'hv-decal', {
    vertexPars: 'varying vec3 vWP;\n',
    vertexMain: 'vec3 transformed = vec3(position); vWP = (modelMatrix * vec4(position, 1.0)).xyz;\n',
    fragPars: 'varying vec3 vWP;\n',
  });
  return mat;
}

/** Декали: spec = [{k, c:[x,y,z], n:'+z'|'-z'|'+x'|'-x'|'+y', w, h, rot?, flip?}] → одна геометрия с UV из атласа. */
export function buildDecals(specs) {
  const pos = [], uv = [], nor = [], idx = [];
  let vi = 0;
  for (const s of specs) {
    const [u0, v0, u1, v1] = ATLAS[s.k];
    const hw = s.w / 2, hh = s.h / 2;
    // локальные оси: (a — вправо по картинке, b — вверх по картинке, n — наружу)
    let a, b, n;
    switch (s.n) {
      case '+z': a = [1, 0, 0]; b = [0, 1, 0]; n = [0, 0, 1]; break;
      case '-z': a = [-1, 0, 0]; b = [0, 1, 0]; n = [0, 0, -1]; break;
      case '+x': a = [0, 0, -1]; b = [0, 1, 0]; n = [1, 0, 0]; break;
      case '-x': a = [0, 0, 1]; b = [0, 1, 0]; n = [-1, 0, 0]; break;
      case '+y': a = [1, 0, 0]; b = [0, 0, -1]; n = [0, 1, 0]; break;
      default: throw new Error('decal n');
    }
    if (s.flip) a = a.map((v) => -v);
    const rot = s.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot);
    const corners = [[-hw, -hh, u0, v1], [hw, -hh, u1, v1], [hw, hh, u1, v0], [-hw, hh, u0, v0]];
    for (const [px, py, u, v] of corners) {
      const qx = px * cr - py * sr, qy = px * sr + py * cr;
      pos.push(s.c[0] + a[0] * qx + b[0] * qy + n[0] * 0.04, s.c[1] + a[1] * qx + b[1] * qy + n[1] * 0.04, s.c[2] + a[2] * qx + b[2] * qy + n[2] * 0.04);
      uv.push(u, 1 - v); nor.push(...n);
    }
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3); vi += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Песок наносов вокруг корпуса (берма): тот же цвет/текстура, что у грунта пустыни (triplanar 'sand'), общий туман. */
export function createSandMaterial(quality) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
  const kit = triplanarKit('tpB', 'sand', { scale: 1.5, sharpness: 5, quality, ao: 0, normal: 1, chroma: 0.55, rough: 0, antiTile: false });
  patchMaterial(mat, 'hv-sand' + (quality === 'low' ? 'L' : '') + (kit ? 't' : ''), {
    uniforms: { uBA: { value: new THREE.Color('#CFB083') }, uBB: { value: new THREE.Color('#B8936A') }, ...(kit ? kit.uniforms : {}) },
    vertexPars: 'varying vec3 vWP; varying vec3 vWN;\n',
    vertexMain: 'vec3 transformed = vec3(position); vWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);\n',
    fragPars: 'varying vec3 vWP; varying vec3 vWN; uniform vec3 uBA; uniform vec3 uBB;\nvec3 gBN = vec3(0.0, 1.0, 0.0); float gBK = 0.0;\n' + (kit ? kit.pars : ''),
    fragColor: /* glsl */`
#include <color_fragment>
{
  vec3 N = normalize(vWN);
  float m = rkFbm(vWP.xz / 38.0) - 0.5, st = rkNoise(vec2(vWP.x * 0.06 + vWP.z * 0.03, vWP.z * 0.5 - vWP.x * 0.2));
  vec3 col = mix(uBA, uBB, smoothstep(0.35, 0.8, st) * 0.7) * (1.0 + 0.2 * m);
  col = mix(col, col * vec3(0.8, 0.68, 0.58), smoothstep(0.55, 0.15, N.y) * 0.5);
  ${kit ? 'tpBEval(vWP, N); col *= clamp(tpBMul, 0.7, 1.35); gBN = tpBNW; gBK = 1.0;' : ''}
  diffuseColor.rgb = col;
}`,
    fragNormal: kit ? 'normal = normalize((viewMatrix * vec4(mix(vWN, gBN, gBK * 0.85), 0.0)).xyz);' : '',
  });
  return mat;
}
