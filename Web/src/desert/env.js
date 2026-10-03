// Общая «среда»: uniform-объекты, разделяемые всеми материалами пустыни, и общие куски GLSL.
import * as THREE from 'three';
import { rockStations, ROCK_NS } from './field.js';

export const NCLAW = 28;
const claw = [];
for (let i = 0; i < NCLAW; i++) {
  const st = rockStations[Math.round((i * ROCK_NS) / (NCLAW - 1))];
  claw.push(new THREE.Vector4(st.x, st.z, st.w * 1.02 + 3, st.H * 0.062 + st.H * 0.94));
}

export const ENV = {
  uniforms: {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.6, 0.5, 0.2).normalize() },
    uSunColor: { value: new THREE.Color(1, 0.9, 0.8) },       // цвет*интенсивность света солнца (линейный)
    uKeyDir: { value: new THREE.Vector3(0.6, 0.5, 0.2).normalize() },  // направление ключевого света: солнце днём, большая луна ночью
    uKeyColor: { value: new THREE.Color(1, 0.9, 0.8) },                 // цвет*интенсивность ключевого света (линейный)
    uNight: { value: 0 },                                               // 0 день … 1 глубокая ночь
    uInvExp: { value: 1 },                                              // 1 / экспозиция (для эмиссии неба в «экранных» единицах)
    uAmbient: { value: new THREE.Color(0.3, 0.3, 0.3) },
    uZenith: { value: new THREE.Color('#4F6E9A') },
    uHorizon: { value: new THREE.Color('#C8B79A') },
    uFogColor: { value: new THREE.Color('#C8B79A') },
    uFogDensity: { value: 3e-4 },
    uFogFalloff: { value: 0.006 },
    uMist: { value: 0 },
    uFogSun: { value: 1 },
    uWind: { value: new THREE.Vector2(Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)) },
    uWindSpeed: { value: 5 },
    uStorm: { value: 0 },
    uDust: { value: 0.1 },
    uCamXZ: { value: new THREE.Vector2() },
    uClaw: { value: claw },
    uWet: { value: 0 },
  },
};

export const GLSL_COMMON = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform float uNight;
uniform float uInvExp;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uMist;
uniform float uFogSun;
uniform vec2 uWind;
uniform float uWindSpeed;
uniform float uStorm;
uniform float uDust;
uniform vec2 uCamXZ;

float rkHash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 rkHash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float rkHash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float rkNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  float a = rkHash12(i), b = rkHash12(i+vec2(1,0)), c = rkHash12(i+vec2(0,1)), d = rkHash12(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
// значение + производные (iq)
vec3 rkNoiseD(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  vec2 du = 30.0*f*f*(f*(f-2.0)+1.0);
  float a = rkHash12(i), b = rkHash12(i+vec2(1,0)), c = rkHash12(i+vec2(0,1)), d = rkHash12(i+vec2(1,1));
  float k0 = a, k1 = b-a, k2 = c-a, k4 = a-b-c+d;
  return vec3(k0 + k1*u.x + k2*u.y + k4*u.x*u.y, du*vec2(k1 + k4*u.y, k2 + k4*u.x));
}
float rkNoise3(vec3 x){
  vec3 i = floor(x), f = fract(x);
  f = f*f*(3.0-2.0*f);
  return mix(mix(mix(rkHash13(i), rkHash13(i+vec3(1,0,0)), f.x), mix(rkHash13(i+vec3(0,1,0)), rkHash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(rkHash13(i+vec3(0,0,1)), rkHash13(i+vec3(1,0,1)), f.x), mix(rkHash13(i+vec3(0,1,1)), rkHash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float rkFbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a*rkNoise(p); p = p*2.03 + 7.1; a *= 0.5; } return s; }
float rkFbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a*rkNoise3(p); p = p*2.07 + 3.7; a *= 0.5; } return s; }

float rkHG(float mu, float g){ float g2 = g*g; return (1.0 - g2) / (4.0*3.14159*pow(1.0 + g2 - 2.0*g*mu, 1.5)); }

// экспоненциальный туман с убыванием по высоте + приземная дымка; цвет — «небесный» + блик к солнцу
vec3 rkFogColorDir(vec3 v){
  float mu = max(dot(v, uKeyDir), 0.0);
  return uFogColor + uKeyColor * (0.05 * uFogSun) * (pow(mu, 5.0) * 0.8 + pow(mu, 28.0) * 1.6) * (0.4 + uDust);
}
float rkFogAmount(vec3 wp, out vec3 v){
  vec3 d = wp - cameraPosition;
  float L = length(d);
  v = d / max(L, 1e-3);
  float k = uFogFalloff;
  float a = k * d.y;
  float integ = L * exp(-k * cameraPosition.y) * (abs(a) > 1e-4 ? (1.0 - exp(-a)) / a : 1.0);
  float tau = uFogDensity * integ;
  // приземная дымка (масштаб высоты ~5 м)
  float km = 0.2, am = km * d.y;
  float integM = L * exp(-km * max(cameraPosition.y, 0.0)) * (abs(am) > 1e-4 ? (1.0 - exp(-am)) / am : 1.0);
  tau += uMist * integM;
  return 1.0 - exp(-tau);
}
vec3 rkApplyFog(vec3 col, vec3 wp){
  vec3 v; float f = rkFogAmount(wp, v);
  return mix(col, rkFogColorDir(v), f);
}

// тень «Когтя» (приближение цилиндрами вдоль оси) — луч к солнцу
uniform vec4 uClaw[${NCLAW}];
float rkClawShade(vec3 p){
  vec3 L = uKeyDir;
  float hl = length(L.xz);
  if (L.y < 0.02) return 0.0;
  vec2 sh = L.xz / max(hl, 1e-4);
  float te = L.y / max(hl, 1e-4);
  vec2 rel = vec2(715.0, 270.0) - p.xz;
  float al = dot(rel, sh);
  float dp = abs(rel.x*sh.y - rel.y*sh.x);
  if (al < -320.0 || dp > 340.0) return 1.0;
  if (p.y + te*(al + 320.0) > 330.0) return 1.0;
  float vis = 1.0;
  for (int i = 0; i < ${NCLAW}; i++){
    vec4 c = uClaw[i];
    vec2 r = c.xy - p.xz;
    float a = dot(r, sh);
    if (a < 0.0) continue;
    float d = abs(r.x*sh.y - r.y*sh.x);
    float R = c.z;
    if (d > R) continue;
    float s = a - sqrt(R*R - d*d);
    float ry = p.y + te*max(s, 0.0);
    float q = d / R;
    float top = c.w * (1.0 - 0.45*q*q*q);
    float pen = 3.0 + 0.012*s;
    vis = min(vis, smoothstep(-pen, pen, ry - top));
  }
  return vis;
}
`;

/** Присоединяет к материалу общие uniform-объекты и патчи шейдера. */
export function patchMaterial(mat, key, p) {
  mat.fog = false; // свой туман в шейдере
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, ENV.uniforms);
    if (p.uniforms) Object.assign(shader.uniforms, p.uniforms);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    if (p.vertexPars || p.vertexMain) {
      vs = vs.replace('#include <common>', '#include <common>\n' + (p.vertexCommon ? GLSL_COMMON + '\n' : '') + (p.vertexPars || ''));
    }
    if (p.vertexBeginNormal) vs = vs.replace('#include <beginnormal_vertex>', p.vertexBeginNormal);
    if (p.vertexMain) vs = vs.replace('#include <begin_vertex>', p.vertexMain);
    fs = fs.replace('#include <common>', '#include <common>\n' + GLSL_COMMON + '\n' + (p.fragPars || ''));
    if (p.fragColor) fs = fs.replace('#include <color_fragment>', p.fragColor);
    if (p.fragRough) fs = fs.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + p.fragRough);
    if (p.fragNormal) fs = fs.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + p.fragNormal);
    if (p.fragLightsEnd) fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + p.fragLightsEnd);
    fs = fs.replace('#include <opaque_fragment>', (p.fragBeforeOut || '') + '\n#include <opaque_fragment>\n' + (p.fragNoFog ? '' : 'gl_FragColor.rgb = rkApplyFog(gl_FragColor.rgb, vWP);') + (p.fragAfterFog || ''));
    shader.vertexShader = vs; shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
