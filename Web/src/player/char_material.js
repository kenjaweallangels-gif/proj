// Материалы фигур: один процедурный шейдер на тело (дистикомб с рёбрами, швами, блеском, пылью в складках; кожа; кожа-кожа;
// склера/радужка) и один на ткань (+ вершинная вторичная анимация: отставание, ветер, трепет, отталкивание от ног).
import * as THREE from 'three';

const NOISE = /* glsl */`
float hash31(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i), hash31(i+vec3(1,0,0)), f.x), mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x), mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x), f.y), f.z) * 2.0 - 1.0;
}
`;

const VERT_PARS = /* glsl */`
attribute float region;
attribute vec4 aux;
varying float vRegion;
varying vec4 vAux;
varying vec3 vBind;
`;

const CLOTH_VERT_PARS = /* glsl */`
uniform float uTime, uPhase;
uniform vec3 uLag, uWind;
uniform vec4 uLegL, uLegR;
uniform float uHipY;
vec3 capsulePush(vec3 p, vec3 a, vec3 b, float r){
  vec3 ab = b - a; float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-5), 0.0, 1.0);
  vec3 c = a + ab * t; vec3 d = p - c; float l = length(d);
  if (l < r) p = c + d / max(l, 1e-4) * r;
  return p;
}
vec3 legPush(vec3 p, float x0, vec4 L){
  vec3 h = vec3(x0, uHipY, 0.0), k = vec3(x0, L.y, L.x), a = vec3(x0, L.w, L.z);
  p = capsulePush(p, h, k, 0.108);
  p = capsulePush(p, k, a, 0.082);
  return p;
}
`;

const CLOTH_VERT_MAIN = /* glsl */`
#include <skinning_vertex>
{
  float w = aux.x;
  vec3 p = transformed;
  float t = uTime + uPhase;
  float gust = 0.55 + 0.45 * sin(t * 0.9) * sin(t * 0.53 + 1.7);
  float wl = length(uWind);
  vec3 d = uLag * w;
  d += uWind * (0.35 + gust) * w * (0.5 + 0.5 * w);
  float fl = sin(t * (4.5 + wl * 3.0) + p.y * 8.0 + p.x * 6.0 + p.z * 5.0) * (0.006 + 0.02 * clamp(wl, 0.0, 1.5)) * w;
  float fl2 = sin(t * (8.7 + wl * 4.0) + p.y * 17.0 - p.x * 9.0) * 0.007 * clamp(wl, 0.0, 1.5) * w;
  d += normalize(objectNormal) * (fl + fl2);
  p += d;
  if (p.y < 0.98 && p.y > 0.12 && w > 0.0) { p = legPush(p, -0.09, uLegL); p = legPush(p, 0.09, uLegR); }
  transformed = p;
}
`;

const FRAG_PARS = /* glsl */`
uniform vec3 uSuit, uSkin, uCloth, uCloth2, uAccent, uLeather, uHair, uEye, uIris, uLining;
uniform float uDust, uWear, uEyeGlow;
varying float vRegion;
varying vec4 vAux;
varying vec3 vBind;
${NOISE}
`;

const FRAG_COLOR = /* glsl */`
#include <color_fragment>
int rg = int(vRegion + 0.5);
vec3 base = uCloth; float rough = 0.9; float metal = 0.0; float rh = 0.0; float dustK = 0.0; float bumpAmt = 0.0;
float nz = vnoise(vBind * 13.0), nz2 = vnoise(vBind * 52.0);
if (rg == 0) {
  float ph = vAux.x * 46.0;
  float fade = 1.0 - smoothstep(0.35, 1.1, fwidth(ph));
  float tri = abs(fract(ph) - 0.5) * 2.0;
  float hump = 1.0 - tri * tri;
  rh = hump * vAux.y * fade;
  float rs = mix(0.74, 1.05, hump);
  base = uSuit * mix(1.0, rs, vAux.y * fade);
  base *= 1.0 + (nz * 0.22 + nz2 * 0.1) * (0.4 + uWear);
  float crack = smoothstep(0.55, 0.8, nz + nz2 * 0.4) * uWear;
  base = mix(base, base * vec3(1.5, 1.4, 1.25) + 0.015, crack * 0.5);
  float cs = 1.0 - smoothstep(0.0, 0.007, abs(vBind.x));
  base *= 1.0 - 0.35 * cs * step(0.95, vBind.y) * step(vBind.y, 1.45) * step(0.5, vAux.y);
  rough = 0.42 + 0.25 * (1.0 - hump) + 0.2 * crack;
  dustK = vAux.z + (1.0 - hump) * 0.2 * vAux.y;
  bumpAmt = 0.7 * fade;
} else if (rg == 1) {
  base = uSkin * (0.93 + 0.1 * nz2 + 0.05 * nz); rough = 0.58; dustK = 0.08;
} else if (rg == 9) {
  base = uSkin * vec3(0.78, 0.5, 0.48); rough = 0.5;
} else if (rg == 2 || rg == 12) {
  float wv = sin(vBind.y * 380.0) * sin((vBind.x + vBind.z) * 380.0);
  base = (rg == 12 ? uCloth2 : uCloth) * (1.0 + 0.04 * wv + 0.1 * nz + 0.05 * nz2) * (1.0 - 0.18 * vAux.x);
  if (!gl_FrontFacing) base = mix(uLining, uCloth * 0.7, 0.2) * (0.9 + 0.1 * nz);
  rough = 0.92; dustK = 0.15 + vAux.x * 0.75 + uWear * 0.1;
} else if (rg == 3) {
  float st = step(0.5, fract((vBind.x + vBind.z * 0.7) * 45.0 + vBind.y * 3.0));
  base = uAccent * (0.8 + 0.3 * st) * (1.0 + 0.1 * nz);
  rough = 0.85; dustK = 0.1 + vAux.x * 0.5;
} else if (rg == 4) {
  base = uLeather * (0.85 + 0.2 * nz + 0.12 * nz2) * (1.0 - 0.2 * smoothstep(0.5, 0.9, nz2)); rough = 0.62; dustK = vAux.z * 0.5;
} else if (rg == 5) {
  base = vec3(0.34, 0.33, 0.33) * (0.8 + 0.3 * nz2); rough = 0.35; metal = 0.85;
} else if (rg == 6) {
  base = uHair * (0.8 + 0.3 * nz2); rough = 0.75;
} else if (rg == 7) {
  base = uEye; rough = 0.2;
} else if (rg == 8) {
  base = uIris; rough = 0.15;
} else if (rg == 10) {
  base = vec3(0.045, 0.04, 0.038); rough = 0.8;
}
diffuseColor.rgb = base;
`;

const FRAG_ROUGH = /* glsl */`
#include <metalnessmap_fragment>
roughnessFactor = rough; metalnessFactor = metal;
`;

const FRAG_NORMAL = /* glsl */`
#include <normal_fragment_maps>
if (bumpAmt > 0.0) {
  vec2 dH = vec2(dFdx(rh), dFdy(rh)) * bumpAmt * 0.0035;
  vec3 q0 = dFdx(-vViewPosition.xyz), q1 = dFdy(-vViewPosition.xyz);
  vec3 R1 = cross(q1, normal), R2 = cross(normal, q0);
  float fDet = dot(q0, R1);
  vec3 grad = sign(fDet) * (dH.x * R1 + dH.y * R2);
  normal = normalize(abs(fDet) * normal - grad);
}
{
  float upN = max(0.0, (vec4(normal, 0.0) * viewMatrix).y);
  float dk = clamp(dustK * 0.9 + upN * 0.25, 0.0, 1.0) * uDust;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.5, 0.36) * (0.85 + 0.2 * nz2), dk * 0.55);
  roughnessFactor = mix(roughnessFactor, 0.95, dk);
}
`;

const FRAG_EMISSIVE = /* glsl */`
#include <emissivemap_fragment>
if (rg == 7) totalEmissiveRadiance += uEye * uEyeGlow;
`;

function patch(mat, key, uniforms, cloth) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', '#include <common>\n' + VERT_PARS + (cloth ? CLOTH_VERT_PARS : ''));
    vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = region; vAux = aux; vBind = position;');
    if (cloth) vs = vs.replace('#include <skinning_vertex>', CLOTH_VERT_MAIN);
    fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_PARS);
    fs = fs.replace('#include <color_fragment>', FRAG_COLOR);
    fs = fs.replace('#include <metalnessmap_fragment>', FRAG_ROUGH);
    fs = fs.replace('#include <normal_fragment_maps>', FRAG_NORMAL);
    fs = fs.replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
    shader.vertexShader = vs; shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => key;
}

const C = (h) => new THREE.Color(h);
/** Униформы палитры + ткани для одной фигуры. */
export function makeUniforms(o) {
  return {
    uSuit: { value: C(o.suit || '#4a4038') }, uSkin: { value: C(o.skin || '#9c7458') }, uCloth: { value: C(o.cloth || '#8a6a48') },
    uAccent: { value: C(o.accent || '#2c3e57') }, uLeather: { value: C(o.leather || '#4a3828') }, uHair: { value: C(o.hairColor || '#241a14') },
    uEye: { value: C(o.eyesIbad ? '#2f66ff' : '#d9d3c6') }, uIris: { value: C(o.eyesIbad ? '#0a1f8a' : o.eyeColor || '#3b281a') }, uLining: { value: C(o.lining || '#6a5a44') },
    uDust: { value: o.dust ?? 0.55 }, uWear: { value: o.wear ?? 0.4 }, uEyeGlow: { value: o.eyesIbad ? 0.45 : 0 },
    uTime: { value: 0 }, uPhase: { value: Math.random() * 100 },
    uLag: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3() },
    uHipY: { value: 0.92 }, uCloth2: { value: C(o.cloth2 || o.cloth || '#8a6a48') }, uLegL: { value: new THREE.Vector4(0, 0.48, 0, 0.08) }, uLegR: { value: new THREE.Vector4(0, 0.48, 0, 0.08) },
  };
}
// clone() у three не копирует onBeforeCompile — переопределяем, чтобы клонирование (например, в модуле червя) сохраняло шейдер.
function make(U, cloth) {
  const m = cloth
    ? new THREE.MeshStandardMaterial({ color: U.uCloth.value.clone(), roughness: 0.9, metalness: 0, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ color: U.uSuit.value.clone(), roughness: 0.6, metalness: 0 });
  patch(m, cloth ? 'rk-fig-cloth' : 'rk-fig-body', U, cloth);
  m.clone = function () { const c = make(U, cloth); c.copy(this); return c; };
  return m;
}
export function makeBodyMaterial(U) { return make(U, false); }
export function makeClothMaterial(U) { return make(U, true); }
