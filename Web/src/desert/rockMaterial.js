// Материалы скальной породы и «реквизита»: страты, эрозионные желобки, песчаные наносы на уступах, песочная пыль.
import * as THREE from 'three';
import { patchMaterial, ENV } from './env.js';
import { triplanarKit } from '../core/triplanar.js';

const VERT_PARS = /* glsl */`
varying vec3 vWP;
varying vec3 vWN;
`;
const VERT_MAIN = /* glsl */`
vec3 transformed = vec3(position);
{
  vec4 rkW = vec4(position, 1.0);
  vec3 rkN = objectNormal;
  #ifdef USE_INSTANCING
  rkW = instanceMatrix * rkW;
  rkN = mat3(instanceMatrix) * rkN;
  #endif
  vWP = (modelMatrix * rkW).xyz;
  vWN = normalize(mat3(modelMatrix) * rkN);
}
`;

// Отверстия в скале (входы сиетча): sphere {x,y,z,r}; fragment discard + затемнённая кромка. Общие для материала и теневого прохода.
export const MAX_HOLES = 8;
ENV.uniforms.uHoles = { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector4(0, -1e5, 0, 0)) };
ENV.uniforms.uHoleN = { value: 0 };
export const HOLES_GLSL = /* glsl */`
uniform vec4 uHoles[${MAX_HOLES}];
uniform int uHoleN;
// возвращает 0 внутри отверстия (discard), 0..1 — затемнение у кромки
float rkHoleRim(vec3 P){
  float rim = 1.0;
  for (int i = 0; i < ${MAX_HOLES}; i++) {
    if (i >= uHoleN) break;
    float d = distance(P, uHoles[i].xyz);
    if (d < uHoles[i].w) return -1.0;
    rim = min(rim, smoothstep(uHoles[i].w, uHoles[i].w + 1.6, d));
  }
  return rim;
}
`;

const ROCK_PARS = /* glsl */`
varying vec3 vWP;
varying vec3 vWN;
${HOLES_GLSL}
uniform float uBand;
uniform float uSandAmt;
uniform vec3 uRockA;
uniform vec3 uRockB;
uniform vec3 uRockC;
uniform vec3 uSandC;
vec3 gNW;
float gTpF = 0.0;
float gSandA = 0.0;
vec3 rkFbmD(vec2 p){
  vec3 s = vec3(0.0); float a = 0.5; float f = 1.0;
  for (int i = 0; i < 3; i++) { vec3 n = rkNoiseD(p * f); s += a * vec3(n.x, n.yz * f); a *= 0.5; f *= 2.1; p += 5.3; }
  return s;
}
`;

const ROCK_COLOR = /* glsl */`
#include <color_fragment>
vec3 N = normalize(vWN);
vec3 P = vWP;
float dist = length(cameraPosition - P);
float holeRim = rkHoleRim(P);
if (holeRim < 0.0) discard;
// страты
float warp = (rkFbm3(P * vec3(0.012, 0.006, 0.012) / max(uBand / 5.5, 0.05)) - 0.5) * 70.0 * (uBand / 5.5) + (rkFbm3(P * vec3(0.05, 0.02, 0.05)) - 0.5) * 8.0 * (uBand / 5.5);
float sy = (P.y + warp) / uBand;
sy += 0.45 * sin(sy * 0.55 + 1.3);
float bId = floor(sy);
float bF = fract(sy);
float bR = rkHash12(vec2(bId, 3.7));
float bR2 = rkHash12(vec2(bId, 9.1));
float ledge = smoothstep(0.0, 0.14, bF) * (1.0 - smoothstep(0.86, 1.0, bF));
float dLedge = (smoothstep(0.0, 0.14, bF) > 0.0 && bF < 0.14 ? 6.0 * (bF / 0.14) * (1.0 - bF / 0.14) / 0.14 : 0.0) - (bF > 0.86 ? 6.0 * ((bF - 0.86) / 0.14) * (1.0 - (bF - 0.86) / 0.14) / 0.14 : 0.0);
// рельеф: триплоанарный fbm с производными, вытянут по вертикали (эрозионные желоба)
vec3 tw = pow(abs(N), vec3(4.0)); tw /= (tw.x + tw.y + tw.z);
float bumpK = (1.0 - smoothstep(120.0, 900.0, dist)) * (uBand / 5.5 < 0.5 ? 0.6 : 1.0);
vec3 bg = vec3(0.0); float bh = 0.0;
if (bumpK > 0.002) {
  float sc = 0.55 * (5.5 / uBand) * 0.35 + 0.55 * (1.0 - 0.35);
  vec3 a = rkFbmD(vec2(P.z, P.y * 0.45) * sc);
  vec3 b = rkFbmD(vec2(P.x, P.y * 0.45) * sc + 17.0);
  vec3 c = rkFbmD(P.xz * sc * 0.9 + 31.0);
  bh = a.x * tw.x + b.x * tw.y + c.x * tw.z;
  bg += tw.x * vec3(0.0, a.z * sc * 0.45, a.y * sc);
  bg += tw.y * vec3(b.y * sc, b.z * sc * 0.45, 0.0);
  bg += tw.z * vec3(c.y * sc * 0.9, 0.0, c.z * sc * 0.9);
}
float bandAmp = (0.2 + 0.8 * bR) * 0.5 * min(uBand / 5.5, 1.0);
bg.y += bandAmp * dLedge / uBand;
bg *= 0.9 * min(uBand / 5.5, 1.0);
bg *= bumpK;
vec3 Np = normalize(N - (bg - N * dot(bg, N)) * 1.0);
#ifdef RK_ROCK_TEX
// фотограмметрия камня: нормаль (whiteout поверх процедурной), модуляция цвета, шероховатость
vec3 tpMul = vec3(1.0);
vec3 Npd = Np;
gTpF = (1.0 - smoothstep(50.0, 650.0, dist)) * uRTexK.x;
if (gTpF > 0.002) {
  tpREval(P, Np);
  Npd = normalize(mix(Np, tpRNW, gTpF));
  tpMul = mix(vec3(1.0), tpRMul, gTpF * uRTexK.y);
}
#endif
// цвет по слоям
vec3 base = mix(uRockB, uRockA, smoothstep(0.0, 0.55, bR));
base = mix(base, uRockC, smoothstep(0.62, 1.0, bR) * 0.85);
base *= 0.85 + 0.3 * bR2;
float fine = rkFbm(P.xz * 0.6 + P.y * 0.3);
base *= 0.8 + 0.4 * fine;
base *= 0.72 + 0.5 * smoothstep(0.0, 0.25, bF) * (1.0 - 0.35 * smoothstep(0.86, 1.0, bF)) + 0.0;
// тёмные вертикальные потёки («пустынный загар»)
float streak = rkNoise(vec2((P.x + P.z) * 0.9, P.y * 0.035) + 4.0);
base *= 1.0 - 0.28 * smoothstep(0.55, 0.85, streak);
base *= 0.8 + 0.4 * clamp(bh * 1.6 + 0.4, 0.0, 1.0);
// песок на уступах и подножии
float up = smoothstep(0.48, 0.86, Np.y + 0.18 * (rkNoise(P.xz * 0.35) - 0.5));
float sandA = clamp(up * (0.55 + 0.45 * ledge) * uSandAmt + smoothstep(0.7, 0.98, N.y) * 0.5, 0.0, 1.0);
#ifdef RK_ROCK_TEX
base *= tpMul;
gSandA = sandA;
#endif
base = mix(base, uSandC * (0.9 + 0.2 * rkNoise(P.xz * 3.0)), sandA);
// расщелина A4: тёмная, затенённая
float inCleft = (1.0 - smoothstep(2.0, 14.0, abs(P.z - 326.0))) * step(P.x, 654.0) * step(600.0, P.x) * (1.0 - smoothstep(30.0, 90.0, P.y));
base *= 1.0 - 0.55 * inCleft;
base *= mix(0.12, 1.0, holeRim);
diffuseColor.rgb = base;
#ifdef RK_ROCK_TEX
gNW = normalize(mix(Npd, Np, sandA * 0.8));
#else
gNW = Np;
#endif
`;
const ROCK_ROUGH = /* glsl */`
#ifdef RK_ROCK_TEX
roughnessFactor = mix(roughnessFactor, clamp(0.5 + tpRRgh * 0.5, 0.4, 1.0), gTpF * (1.0 - gSandA) * uRTexK.z);
#endif
`;
const ROCK_NORMAL = `normal = normalize((viewMatrix * vec4(gNW, 0.0)).xyz);`;

export function createRockMaterial(opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0 });
  const kit = triplanarKit('tpR', opts.tex ?? 'rock_cliff', { scale: opts.texScale, quality: opts.quality, sharpness: 5, normal: opts.texNormal ?? 1, ao: 0.6, rough: 1, chroma: 0.5 });
  patchMaterial(mat, 'rk-rock' + (kit ? 't' + (opts.tex ?? '') : ''), {
    uniforms: {
      uRTexK: { value: new THREE.Vector4(1, 0.85, 0.8, 0) },
      ...(kit ? kit.uniforms : {}),
      uBand: { value: opts.band ?? 5.5 },
      uSandAmt: { value: opts.sand ?? 1 },
      uRockA: { value: new THREE.Color('#8A6A50') },
      uRockB: { value: new THREE.Color('#6B5241') },
      uRockC: { value: new THREE.Color('#B58F69') },
      uSandC: { value: new THREE.Color('#CFB083') },
    },
    vertexPars: VERT_PARS, vertexMain: VERT_MAIN,
    fragPars: (kit ? '#define RK_ROCK_TEX\nuniform vec4 uRTexK;\n' + kit.pars : '') + ROCK_PARS, fragColor: ROCK_COLOR, fragNormal: ROCK_NORMAL, fragRough: ROCK_ROUGH,
  });
  return mat;
}

// ---- реквизит (ржавый металл, кость): без страт, но с пылью и вариацией ----
const PROP_PARS = /* glsl */`
varying vec3 vWP;
varying vec3 vWN;
uniform vec3 uSandC;
uniform float uBaseY;
uniform float uPropSand;
vec3 gNW;
`;
const PROP_COLOR = /* glsl */`
#include <color_fragment>
vec3 N = normalize(vWN);
float pn = rkFbm(vWP.xz * 0.9 + vWP.y * 0.6);
diffuseColor.rgb *= 0.65 + 0.7 * pn;
float up = smoothstep(0.35, 0.85, N.y + 0.2 * (rkNoise(vWP.xz * 0.7) - 0.5));
float lowSand = 1.0 - smoothstep(0.0, 2.2, vWP.y - uBaseY);
diffuseColor.rgb = mix(diffuseColor.rgb, uSandC * (0.85 + 0.3 * pn), clamp(up * 0.75 + lowSand * 0.6, 0.0, 0.95) * uPropSand);
`;
export function createPropMaterial(opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: opts.color ?? 0xffffff, roughness: opts.roughness ?? 0.7, metalness: opts.metalness ?? 0.0, vertexColors: !!opts.vertexColors });
  const baseYU = { value: 0 };
  mat.userData.baseYU = baseYU;
  patchMaterial(mat, 'rk-prop' + (opts.vertexColors ? 'v' : ''), {
    uniforms: { uSandC: { value: new THREE.Color('#CFB083') }, uBaseY: baseYU, uPropSand: { value: opts.sand ?? 1 } },
    vertexPars: VERT_PARS, vertexMain: VERT_MAIN,
    fragPars: PROP_PARS, fragColor: PROP_COLOR,
  });
  return mat;
}
