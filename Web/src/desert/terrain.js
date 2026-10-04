// Рендер ландшафта: тороидальный клипмап (8 уровней), высоты — из analytic field.js через DataTexture,
// вершинный шейдер читает высоту/нормаль/маски; песок — MeshStandardMaterial + onBeforeCompile.
import * as THREE from 'three';
import { heightAt, masks } from './field.js';
import { ENV, patchMaterial } from './env.js';
import { triplanarKit } from '../core/triplanar.js';

// Размеры зависят от качества (задаются в createTerrain): low 96 / med 128 / high 160 ячеек на сторону кольца.
let CELLS = 160;                 // ячеек на сторону кольца
let TEX = 192;                   // размер текстуры уровня (> CELLS+1): запас по краям — «мягкая» зона, заливается постепенно
let HARD = CELLS / 2 + 2;        // эти клетки вокруг центра должны быть валидны к кадру (иначе дыры/ошибки)
let SOFT = TEX / 2 - 3;          // опережающая заливка: дальше HARD, но в пределах окна; делается порциями по бюджету
const SOFT_BUDGET_MS = 1.2;      // бюджет опережающей заливки на кадр (все уровни), мс

export const LEVEL_SPACING = [1, 2, 4, 8, 16, 32, 64];

const VERT_PARS = /* glsl */`
uniform sampler2D uHTex;
uniform sampler2D uCTex;
uniform vec2 uCenter;
uniform vec2 uCCenter;
uniform float uSpacing;
uniform float uCSpacing;
uniform float uTSize;
uniform float uHalfExt;
uniform float uInner;
uniform float uLower;
uniform float uMorph;
uniform sampler2D uFoot;
uniform vec4 uFootRect;
varying vec3 vWP;
varying vec3 vTN;
varying vec2 vMask;
varying float vShade;
vec4 rkFetch(sampler2D t, vec2 texel){ return texelFetch(t, ivec2(mod(texel, uTSize)), 0); }
vec3 rkNrm(vec2 nxz){ return vec3(nxz.x, sqrt(max(1.0 - dot(nxz, nxz), 0.02)), nxz.y); }
void rkTerrain(out vec3 P, out vec3 N, out vec2 M){
  vec2 gi = uCenter + position.xz;
  vec4 tx = rkFetch(uHTex, gi);
  vec2 wxz = gi * uSpacing;
  float h = tx.x;
  vec2 nxz = tx.yz;
  float rel = max(abs(wxz.x - uCamXZ.x), abs(wxz.y - uCamXZ.y)) / uHalfExt;
  if (uMorph > 0.5) {
    float m = smoothstep(0.60, 0.95, rel);
    if (m > 0.0) {
      vec2 ct = wxz / uCSpacing; vec2 f = floor(ct); vec2 fr = ct - f;
      vec4 a = rkFetch(uCTex, f), b = rkFetch(uCTex, f + vec2(1.0, 0.0));
      vec4 c = rkFetch(uCTex, f + vec2(0.0, 1.0)), d = rkFetch(uCTex, f + vec2(1.0, 1.0));
      vec4 cv = mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
      h = mix(h, cv.x, m); nxz = mix(nxz, cv.yz, m);
    }
  }
  if (uInner > 0.0) {
    float ri = max(abs(wxz.x - uCamXZ.x), abs(wxz.y - uCamXZ.y)) / uInner;
    h -= uLower * (1.0 - smoothstep(0.80, 0.99, ri));
  }
  vec3 n = rkNrm(nxz);
  if (uFootRect.w > 0.5) {
    vec2 fuv = (wxz - uFootRect.xy) / uFootRect.z + 0.5;
    if (fuv.x > 0.03 && fuv.y > 0.03 && fuv.x < 0.97 && fuv.y < 0.97) {
      vec2 f0 = textureLod(uFoot, fuv, 0.0).rg;
      float e = 1.0 / uFootRect.z;
      vec2 fx = textureLod(uFoot, fuv + vec2(e, 0.0), 0.0).rg, fz = textureLod(uFoot, fuv + vec2(0.0, e), 0.0).rg;
      float ph = f0.g - f0.r;
      h += ph;
      vec2 g = vec2((fx.g - fx.r) - ph, (fz.g - fz.r) - ph);
      n = normalize(vec3(n.x / n.y - g.x, 1.0, n.z / n.y - g.y));
    }
  }
  float A = tx.w;
  M = vec2(floor(A / 64.0) / 63.0, mod(A, 64.0) / 63.0);
  P = vec3(wxz.x, h, wxz.y);
  N = n;
}
`;

/** Рябь песка (GLSL): функция rkRippleG — тоже используется в tools/ripple_lab.mjs. */
export const RIPPLE_GLSL = /* glsl */`
// Рябь как ВОЗМУЩЕНИЕ НОРМАЛИ (цвет не трогаем). Возвращает градиент высоты (уклон) в мировых xz.
//  p — мировые xz; wl — средняя длина волны, м; S — амплитуда уклона (пик ≈ 1.3·S); fade — множитель (дистанция, склоны, фильтр по производным);
//  kH, y, sl — изгиб гребней вокруг рельефа (фаза сдвигается высотой; только для средних масштабов).
// Фаза = вдоль ветра + низкочастотное искажение (две октавы): гребни извиваются, меняют шаг и направление, изредка ветвятся (Y) и обрываются,
// где градиент искажения гасит основной. Профиль несимметричный: пологий наветренный, крутой подветренный склон; гребни и впадины скруглены.
vec2 rkRippleG(vec2 p, float wl, float seed, float S, float kH, float y, vec2 sl, float fade) {
  vec3 nA = rkNoiseD(p / (wl * 16.0) + seed);
  vec3 nB = rkNoiseD(p / (wl * 5.0) + seed * 2.3 + 7.0);
  float ph = dot(p, uWind) / wl + 2.0 * nA.x + 0.45 * nB.x + kH * y / wl;
  vec2 dph = uWind / wl + (2.0 / (wl * 16.0)) * nA.yz + (0.45 / (wl * 5.0)) * nB.yz + kH * sl / wl;
  // вторая волна с чуть другим шагом: биения дают естественные дислокации — гребни сливаются, обрываются, раздваиваются (Y)
  float ph2 = ph * 1.075 + 0.31 * nA.x;
  float c1 = cos(6.2831853 * ph), c2 = cos(6.2831853 * ph2);
  float d1 = (c1 - 0.8 * (2.0 * c1 * c1 - 1.0)) * 0.7;               // d(высота)/d(фаза): h = sin θ − 0.4 sin 2θ (пологий наветренный, крутой подветренный склон)
  float d2 = (c2 - 0.8 * (2.0 * c2 * c2 - 1.0)) * 0.7;
  float br = mix(0.25, 1.0, smoothstep(0.2, 0.65, nB.x));            // неравномерность: участки почти без ряби
  return dph * (wl * S * (d1 + 0.55 * 1.075 * d2) * 0.65 * br * fade);
}
`;
/** Блок накопления ряби в градиент g (3 масштаба + фильтрация по размеру пикселя); читает xz, uu, Ng, slope, nxzl, dist, rockM, disturb, packedM, vWP. */
export const RIPPLE_BLOCK = /* glsl */`
// Рябь (3 масштаба) + зерно. Всё — нормаль; фильтрация по размеру пикселя вдоль ветра (dFdx/dFdy) гасит гармоники, которые не разрешаются (муар).
float pxW = abs(dFdx(uu)) + abs(dFdy(uu));      // размер пикселя вдоль ветра (поперёк гребней), м: выше частоты Найквиста рябь гасится
// подветренный склон и его кромка (гребень): рябь на склоне скольжения и у гребня гаснет — там лавинные полосы
float leeW = smoothstep(0.03, 0.14, slope) * smoothstep(0.0, 0.45, dot(Ng.xz, uWind) / nxzl);
float calmR = (1.0 - smoothstep(0.0, 0.75, leeW)) * (1.0 - rockM) * (1.0 - disturb) * (1.0 - 0.6 * packedM);
vec2 g = vec2(0.0);
vec2 slp = -Ng.xz / max(Ng.y, 0.2);
float f1 = (1.0 - smoothstep(0.11, 0.33, pxW / 0.11)) * calmR;
float f2 = (1.0 - smoothstep(0.11, 0.33, pxW / 0.58)) * (1.0 - smoothstep(110.0, 190.0, dist)) * calmR;
float f3 = (1.0 - smoothstep(0.11, 0.33, pxW / 2.7)) * (1.0 - smoothstep(300.0, 560.0, dist)) * calmR;
if (f1 > 0.004 && uQual > 0.5) g += rkRippleG(xz, 0.11, 1.0, 0.042, 0.0, 0.0, slp, f1);
if (f2 > 0.004) g += rkRippleG(xz, 0.58, 5.0, 0.026, 0.35, vWP.y, slp, f2);
if (f3 > 0.004) g += rkRippleG(xz, 2.7, 9.0, 0.014, 0.6, vWP.y, slp, f3);
`;

const FRAG_PARS = /* glsl */`
uniform vec3 uSandLoose;
uniform vec3 uSandPacked;
uniform vec3 uSandDist;
uniform sampler2D uFoot;
uniform vec4 uFootRect;
uniform float uQual;
varying vec3 vWP;
varying vec3 vTN;
varying vec2 vMask;
varying float vShade;
vec3 gNW;
vec3 gSpark;

${RIPPLE_GLSL}
`;

const FRAG_COLOR = /* glsl */`
#include <color_fragment>
vec3 Ng = normalize(vTN);
vec3 Vv = cameraPosition - vWP;
float dist = length(Vv);
Vv /= dist;
vec2 xz = vWP.xz;
vec2 acr = vec2(-uWind.y, uWind.x);
float uu = dot(xz, uWind), vv = dot(xz, acr);
float slope = 1.0 - Ng.y;
float nxzl = length(Ng.xz) + 1e-4;
float lee = smoothstep(0.07, 0.24, slope) * smoothstep(0.1, 0.5, dot(Ng.xz, uWind) / nxzl);
float wnd = smoothstep(0.02, 0.14, slope) * smoothstep(0.1, 0.5, -dot(Ng.xz, uWind) / nxzl);
float rockM = vMask.x;
float packedM = vMask.y;

// следы
vec2 fuv = (xz - uFootRect.xy) / uFootRect.z + 0.5;
float disturb = 0.0;
vec2 fgrad = vec2(0.0);
float rimL = 0.0;
if (uFootRect.w > 0.5 && fuv.x > 0.02 && fuv.y > 0.02 && fuv.x < 0.98 && fuv.y < 0.98 && dist < 70.0) {
  float eU = 1.6 / float(textureSize(uFoot, 0).x);
  float dm = eU * uFootRect.z;
  vec2 f0 = texture2D(uFoot, fuv).rg;
  vec2 fx1 = texture2D(uFoot, fuv + vec2(eU, 0.0)).rg, fx0 = texture2D(uFoot, fuv - vec2(eU, 0.0)).rg;
  vec2 fz1 = texture2D(uFoot, fuv + vec2(0.0, eU)).rg, fz0 = texture2D(uFoot, fuv - vec2(0.0, eU)).rg;
  fgrad = vec2((fx1.g - fx1.r) - (fx0.g - fx0.r), (fz1.g - fz1.r) - (fz0.g - fz0.r)) / (2.0 * dm);
  disturb = clamp(f0.r * 28.0 + f0.g * 12.0, 0.0, 1.0);
  rimL = clamp(f0.g * 14.0, 0.0, 1.0);
  float edge = 1.0 - smoothstep(0.88, 0.98, max(abs(fuv.x - 0.5), abs(fuv.y - 0.5)) * 2.0);
  disturb *= edge; rimL *= edge; fgrad *= edge;
}

${RIPPLE_BLOCK}
// лавинные полосы на подветренных склонах: потоки зерна вдоль линии падения (вытянуты по склону), веер у подошвы
float avl = 0.0;
if (lee > 0.01) {
  // направление потока зерна ≈ по ветру (склон скольжения смотрит по ветру); координаты стабильны — без изломов линий
  float s1 = rkNoise(vec2(vv * 1.9, uu * 0.06 + 3.0));
  float s2 = rkNoise(vec2(vv * 7.5, uu * 0.3 + 8.0));
  avl = (s1 * 0.65 + s2 * 0.35) - 0.5;
  g += acr * ((s1 - 0.5) * 0.05 + (s2 - 0.5) * 0.035) * lee * (1.0 - disturb);
}
// зерно
float fg = 1.0 - smoothstep(1.5, 9.0, dist);
vec2 grn = vec2(0.0);
if (fg > 0.001 && uQual > 0.5) { vec3 n = rkNoiseD(xz * 95.0); grn = n.yz * 0.0016 * fg; }
g += grn * (1.0 - 0.5 * disturb);
#ifdef RK_SAND_TEX
// фотограмметрия песка: ближний слой (зерно/комочки) + средний (естественная рябь), цвет модулирует процедурную палитру
vec3 tpMulA = vec3(1.0);
float tpFn = (1.0 - smoothstep(30.0, 190.0, dist)) * (1.0 - rockM) * uTexK.x;
if (tpFn > 0.002) {
  tpSEval(vec3(xz.x, vWP.y, xz.y), vec3(0.0, 1.0, 0.0));
  g -= tpSNW.xz / max(tpSNW.y, 0.2) * tpFn * uTexK.y * (1.0 - 0.7 * disturb);
  tpMulA = tpSMul;
  tpMulA = mix(vec3(1.0), tpMulA, tpFn * uTexK.z);
}
float tpFm = (1.0 - smoothstep(18.0, 120.0, dist)) * (1.0 - rockM) * uTexK.x;
#ifdef RK_SAND_MID
if (tpFm > 0.002) {
  // естественная рябь: координаты повёрнуты по ветру, градиент возвращается в мировые оси
  tpMEval(vec3(uu, vWP.y, vv), vec3(0.0, 1.0, 0.0));
  vec2 gm = -tpMNW.xz / max(tpMNW.y, 0.2);
  g += (uWind * gm.x + acr * gm.y) * tpFm * uTexK.w * calmR;
}
#endif
#endif
// следы
g -= fgrad * 1.0;

// Рельеф камня (острова/плиты)
float crack = 1.0;
vec3 rockC = vec3(0.0);
if (rockM > 0.01) {
  vec2 q = xz / 2.6; vec2 id = floor(q); vec2 fq = fract(q);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 rp = rkHash22(id + o);
    float d = length(o + rp * 0.85 + 0.075 - fq);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  crack = smoothstep(0.0, 0.1, d2 - d1);
  vec3 nr = rkNoiseD(xz * 3.0);
  rockC = mix(vec3(0.20, 0.115, 0.07), vec3(0.34, 0.22, 0.14), rkNoise(xz * 0.7)) * (0.75 + 0.5 * rkFbm(xz * 2.4));
  rockC *= 0.45 + 0.55 * crack;
  g += rockM * (nr.yz * 0.05 + vec2(0.0));
}

// Цвет песка
float macro = rkFbm(xz / 420.0 + 3.0) - 0.5;  // 4 октавы: крупные пятна
float streak = rkNoise(vec2(uu / 170.0, vv / 14.0)) - 0.5;
float micro = rkNoise(vec2(uu / 26.0, vv / 2.2) + 5.0) - 0.5;   // вытянуто по ветру, без «пятен»
vec3 col = mix(uSandLoose, uSandPacked, packedM);
col *= 1.0 + 0.13 * macro + 0.08 * streak + 0.045 * micro;
// подветренные лавинные склоны: плотнее и темнее, краснее
col = mix(col, col * vec3(0.82, 0.71, 0.62), lee * 0.42);
col *= 1.0 + avl * 0.11 * lee;
// разнообразие дюн: крупные тёплые/светлые пятна и полосы вдоль ветра
float hv = rkFbm(xz / 900.0 + 17.0) - 0.5;
float hv2 = rkNoise(vec2(uu / 240.0, vv / 650.0) + 3.0) - 0.5;
col *= vec3(1.0 + 0.20 * hv + 0.12 * hv2, 1.0 + 0.03 * hv, 1.0 - 0.17 * hv - 0.10 * hv2);
float fgr = (1.0 - smoothstep(0.5, 6.0, dist));
col *= 1.0 + 0.05 * fgr * (rkNoise(xz * 70.0) - 0.5) * 2.0;
#ifdef RK_SAND_TEX
col *= tpMulA;
#endif
col = mix(col, rockC, rockM);
// следы: темнее и приглушённее, вал светлее
col *= 1.0 - 0.28 * disturb + 0.08 * rimL;
col = mix(col, uSandDist, 0.32 * smoothstep(250.0, 3200.0, dist));
diffuseColor.rgb = col;

// итоговая нормаль (в мировых координатах)
vec3 gw = vec3(g.x, 0.0, g.y);
gw -= Ng * dot(gw, Ng);
gNW = normalize(Ng - gw);

// искры кварца
gSpark = vec3(0.0);
float lowSunS = 1.0 - smoothstep(0.04, 0.5, uKeyDir.y);
float fs = 1.0 - smoothstep(4.0, 34.0 + 22.0 * lowSunS, dist);
if (fs > 0.001 && uQual > 0.5 && rockM < 0.5 && lowSunS > 0.06) {
  vec2 cp = xz * 46.0;
  vec2 ci = floor(cp);
  float hc = rkHash12(ci);
  if (hc > 0.985 - 0.014 * lowSunS) {
    vec2 rn = rkHash22(ci + 17.0) * 2.0 - 1.0;
    vec3 cn = normalize(gNW + vec3(rn.x, 0.6 + 0.4 * rn.y, rn.y) * 0.8);
    vec3 Hh = normalize(uKeyDir + Vv);
    float sp = pow(max(dot(cn, Hh), 0.0), 160.0);
    float shape = smoothstep(0.5, 0.12, length(fract(cp) - 0.5));
    gSpark = uKeyColor * sp * shape * (0.4 + 2.0 * lowSunS) * lowSunS * fs * (1.0 - lee * 0.6);
  }
}
`;

const FRAG_NORMAL = /* glsl */`
normal = normalize((viewMatrix * vec4(gNW, 0.0)).xyz);
`;
const FRAG_ROUGH = /* glsl */`
roughnessFactor = mix(1.0, 0.86, packedM) ;
roughnessFactor = mix(roughnessFactor, 0.88, rockM);
`;
const FRAG_LIGHTS_END = /* glsl */`
reflectedLight.directDiffuse *= vShade;
reflectedLight.directSpecular *= vShade;
float gSunVis = clamp(dot(reflectedLight.directDiffuse, vec3(0.3333)) / (dot(uKeyColor, vec3(0.3333)) * max(dot(gNW, uKeyDir), 0.03) * dot(diffuseColor.rgb, vec3(0.3333)) * 0.3183 + 1e-5), 0.0, 1.0);
`;
const FRAG_BEFORE_OUT = /* glsl */`
outgoingLight += gSpark * gSunVis * step(0.0, dot(gNW, uKeyDir));
{
  // мягкий «подповерхностный» свет на терминаторе: тёплый ореол там, где свет скользит по песку
  float ndlw = dot(gNW, uKeyDir);
  float sss = smoothstep(-0.28, 0.12, ndlw) * (1.0 - smoothstep(0.12, 0.6, ndlw));
  outgoingLight += diffuseColor.rgb * uKeyColor * vec3(1.0, 0.52, 0.30) * sss * 0.085 * (1.0 - vMask.x) * (0.4 + 0.6 * vShade);
}
`;

const FRAG_FAR_FADE = /* glsl */`
{
  float rr = max(abs(vWP.x - uCamXZ.x), abs(vWP.z - uCamXZ.y)) / 5000.0;
  float fe = smoothstep(0.62, 0.97, rr);
  if (fe > 0.0) gl_FragColor.rgb = mix(gl_FragColor.rgb, rkFogColorDir(normalize(vWP - cameraPosition)), fe);
  // мираж: на дальних плоских участках при скользящем взгляде и зное песок «отражает» небо (лужи света у горизонта)
  if (uHeat > 0.02) {
    vec3 vd = vWP - cameraPosition;
    float dd = length(vd);
    float graz = 1.0 - smoothstep(0.003, 0.028, -vd.y / dd);
    float far = smoothstep(260.0, 1500.0, dd) * (1.0 - smoothstep(4200.0, 5200.0, dd));
    if (graz * far > 0.01) {
      float flatK = 1.0 - smoothstep(0.015, 0.09, 1.0 - normalize(vTN).y);
      float cell = rkFbm(vWP.xz / 340.0 + vec2(uTime * 0.004, 3.0));
      float wob = 0.75 + 0.25 * sin(vWP.x * 0.021 + vWP.z * 0.017 + uTime * 1.3 + cell * 9.0);
      float mm = uHeat * graz * far * flatK * smoothstep(0.46, 0.68, cell) * wob;
      vec3 skyR = mix(uHorizon, uZenith, 0.28) * 1.12 + uKeyColor * 0.012;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, skyR, clamp(mm * 0.7, 0.0, 0.7));
    }
  }
}
`;

const VERT_BEGIN_NORMAL = /* glsl */`
vec3 rkP, rkN; vec2 rkM;
rkTerrain(rkP, rkN, rkM);
vec3 objectNormal = rkN;
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif
`;
const VERT_MAIN = /* glsl */`
vec3 transformed = rkP;
vWP = rkP; vTN = rkN; vMask = rkM;
vShade = rkClawShade(rkP);
`;

const DEPTH_MAIN = /* glsl */`
vec3 rkP, rkN; vec2 rkM;
rkTerrain(rkP, rkN, rkM);
vec3 transformed = rkP;
`;

export function createTerrain(game, foot) {
  const { scene } = game;
  const q = game.settings.quality;
  const qual = q === 'low' ? 0 : q === 'med' ? 1 : 2;
  CELLS = q === 'low' ? 96 : q === 'med' ? 128 : 160;
  TEX = CELLS + 32;
  HARD = CELLS / 2 + 2;
  SOFT = TEX / 2 - 3;

  const kS = q === 'low' ? null : triplanarKit('tpS', 'sand', { axes: 'y', scale: 1.45, quality: q, rough: 0, ao: 0, normal: 1, chroma: 0.55, antiTile: q === 'high' });
  const kM = q === 'low' ? null : triplanarKit('tpM', 'sand_ripples', { axes: 'y', scale: 2.6, quality: q, rough: 0, ao: 0, normal: 1, chroma: 0, antiTile: q === 'high' });
  const sandU = {
    uTexK: { value: new THREE.Vector4(1, 0.4, 0.4, 0.6) },     // x: включено, y: сила нормали, z: сила цвета, w: сила среднего слоя
    ...(kS ? kS.uniforms : {}), ...(kM ? kM.uniforms : {}),
    uSandLoose: { value: new THREE.Color('#CFB083') },
    uSandPacked: { value: new THREE.Color('#B8936A') },
    uSandDist: { value: new THREE.Color('#DCC7A3') },
    uFoot: foot.uFoot,
    uFootRect: foot.rect,
    uQual: { value: qual },
    uTSize: { value: TEX },
  };

  // --- геометрия кольца (общая для всех уровней) ---
  const verts = CELLS + 1;
  const pos = new Float32Array(verts * verts * 3);
  for (let j = 0; j < verts; j++) for (let i = 0; i < verts; i++) {
    const k = (j * verts + i) * 3;
    pos[k] = i - CELLS / 2; pos[k + 1] = 0; pos[k + 2] = j - CELLS / 2;
  }
  const idx = new Uint32Array(CELLS * CELLS * 6);
  let n = 0;
  for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
    const a = j * verts + i, b = a + 1, c = a + verts, d = c + 1;
    // CCW при взгляде сверху (+Y): ось X — вправо, Z — к зрителю
    if ((i + j) & 1) { idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = d; }
    else { idx[n++] = a; idx[n++] = c; idx[n++] = d; idx[n++] = a; idx[n++] = d; idx[n++] = b; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const levels = [];
  const tmpMask = { rock: 0, packed: 0 };
  LEVEL_SPACING.forEach((s, li) => {
    const data = new Float32Array(TEX * TEX * 4);
    const tex = new THREE.DataTexture(data, TEX, TEX, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.needsUpdate = true;
    levels.push({
      s, li, data, tex, cx: 1e9, cz: 1e9, dirty: false, softDone: false,
      colI: new Float64Array(TEX).fill(NaN), rowJ: new Float64Array(TEX).fill(NaN),
      uniforms: null, mesh: null,
    });
  });

  const wrapT = (i) => ((i % TEX) + TEX) % TEX;
  /** Высота + маски в одном texel (без нормали: её считаем из соседних texel — один heightAt вместо трёх). */
  function fillH(L, a, b, i, j) {
    const x = i * L.s, z = j * L.s;
    const k = (b * TEX + a) * 4;
    L.data[k] = heightAt(x, z, L.li === 0 ? 0 : L.s);
    masks(x, z, tmpMask);
    L.data[k + 3] = Math.round(tmpMask.rock * 63) * 64 + Math.round(tmpMask.packed * 63);
  }
  /** Нормаль texel (a,b) разностями по соседним texel (если сосед валиден по индексу мира), иначе односторонне. */
  function fillN(L, a, b) {
    const A = L.colI, B = L.rowJ, D = L.data, s = L.s;
    const ia = A[a], jb = B[b];
    if (ia !== ia || jb !== jb) return;
    const a1 = a + 1 === TEX ? 0 : a + 1, a0 = a === 0 ? TEX - 1 : a - 1;
    const b1 = b + 1 === TEX ? 0 : b + 1, b0 = b === 0 ? TEX - 1 : b - 1;
    const k = (b * TEX + a) * 4, h = D[k];
    const okXp = A[a1] === ia + 1, okXm = A[a0] === ia - 1, okZp = B[b1] === jb + 1, okZm = B[b0] === jb - 1;
    const hxp = okXp ? D[(b * TEX + a1) * 4] : h, hxm = okXm ? D[(b * TEX + a0) * 4] : h;
    const hzp = okZp ? D[(b1 * TEX + a) * 4] : h, hzm = okZm ? D[(b0 * TEX + a) * 4] : h;
    const dx = (hxp - hxm) / (((okXp ? 1 : 0) + (okXm ? 1 : 0) || 1) * s), dz = (hzp - hzm) / (((okZp ? 1 : 0) + (okZm ? 1 : 0) || 1) * s);
    const nx = -dx, nz = -dz;
    const il = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    D[k + 1] = nx * il; D[k + 2] = nz * il;
  }
  function fillCol(L, a, iw) {
    L.colI[a] = iw;
    for (let b = 0; b < TEX; b++) { const j = L.rowJ[b]; if (j === j) fillH(L, a, b, iw, j); }
    const a1 = a + 1 === TEX ? 0 : a + 1, a0 = a === 0 ? TEX - 1 : a - 1;
    for (let b = 0; b < TEX; b++) { fillN(L, a0, b); fillN(L, a, b); fillN(L, a1, b); }
    L.dirty = true;
  }
  function fillRow(L, b, jw) {
    L.rowJ[b] = jw;
    for (let a = 0; a < TEX; a++) { const i = L.colI[a]; if (i === i) fillH(L, a, b, i, jw); }
    const b1 = b + 1 === TEX ? 0 : b + 1, b0 = b === 0 ? TEX - 1 : b - 1;
    for (let a = 0; a < TEX; a++) { fillN(L, a, b0); fillN(L, a, b); fillN(L, a, b1); }
    L.dirty = true;
  }
  /** Обязательная заливка: все клетки в пределах HARD валидны. */
  function syncHard(L, cx, cz) {
    for (let iw = cx - HARD; iw <= cx + HARD; iw++) { const a = wrapT(iw); if (L.colI[a] !== iw) fillCol(L, a, iw); }
    for (let jw = cz - HARD; jw <= cz + HARD; jw++) { const b = wrapT(jw); if (L.rowJ[b] !== jw) fillRow(L, b, jw); }
  }
  /** Опережающая заливка запаса (HARD..SOFT) одной колонкой/строкой за вызов; true — что-то сделано. */
  function syncSoft(L, cx, cz) {
    for (let d = HARD + 1; d <= SOFT; d++) {
      for (const sg of [1, -1]) {
        const iw = cx + sg * d, a = wrapT(iw);
        if (L.colI[a] !== iw) { fillCol(L, a, iw); return true; }
        const jw = cz + sg * d, b = wrapT(jw);
        if (L.rowJ[b] !== jw) { fillRow(L, b, jw); return true; }
      }
    }
    L.softDone = true;
    return false;
  }

  /** Локальная перезаливка круга (заплатка рельефа): только texel внутри окна каждого уровня. */
  function invalidateRect(x, z, r) {
    for (const L of levels) {
      const i0 = Math.floor((x - r) / L.s) - 1, i1 = Math.ceil((x + r) / L.s) + 1;
      const j0 = Math.floor((z - r) / L.s) - 1, j1 = Math.ceil((z + r) / L.s) + 1;
      if (i1 - i0 > TEX || j1 - j0 > TEX) { L.cx = 1e9; L.cz = 1e9; L.softDone = false; L.colI.fill(NaN); L.rowJ.fill(NaN); continue; }
      for (let j = j0; j <= j1; j++) {
        const b = wrapT(j); if (L.rowJ[b] !== j) continue;
        for (let i = i0; i <= i1; i++) { const a = wrapT(i); if (L.colI[a] === i) fillH(L, a, b, i, j); }
      }
      for (let j = j0 - 1; j <= j1 + 1; j++) {
        const b = wrapT(j); if (L.rowJ[b] !== j) continue;
        for (let i = i0 - 1; i <= i1 + 1; i++) { const a = wrapT(i); if (L.colI[a] === i) fillN(L, a, b); }
      }
      L.dirty = true;
    }
  }

  function recenter(L, cx, cz) {
    syncHard(L, cx, cz);
    L.cx = cx; L.cz = cz; L.softDone = false;
    if (L.uniforms) L.uniforms.uCenter.value.set(cx, cz);
  }

  // --- материалы ---
  const depthCommon = {};
  levels.forEach((L, li) => {
    const coarse = levels[li + 1];
    L.uniforms = {
      uHTex: { value: L.tex }, uCTex: { value: (coarse || L).tex },
      uCenter: { value: new THREE.Vector2() }, uCCenter: { value: new THREE.Vector2() },
      uSpacing: { value: L.s }, uCSpacing: { value: coarse ? coarse.s : L.s },
      uHalfExt: { value: (CELLS / 2) * L.s },
      uInner: { value: li > 0 ? (CELLS / 2) * levels[li - 1].s : 0 },
      uLower: { value: li > 0 ? 0.3 * L.s + 0.02 * L.s * L.s : 0 },
      uMorph: { value: coarse ? 1 : 0 },
      uFootRect: li === 0 ? foot.rect : { value: new THREE.Vector4(0, 0, 64, 0) },
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    if (li > 0) { mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 2 * li; }
    const ckey = 'rk-terrain' + (kS && li < 4 ? (kM ? 'tm' : 't') : '');
    patchMaterial(mat, ckey, {
      uniforms: Object.assign({}, sandU, L.uniforms, { uFootRect: L.uniforms.uFootRect }),
      vertexCommon: true, vertexPars: VERT_PARS, vertexBeginNormal: VERT_BEGIN_NORMAL, vertexMain: VERT_MAIN,
      fragPars: (kS && li < 4 ? (kM ? '#define RK_SAND_MID\n' : '') + '#define RK_SAND_TEX\nuniform vec4 uTexK;\n' + kS.pars + (kM ? kM.pars : '') : '') + FRAG_PARS, fragColor: FRAG_COLOR, fragRough: FRAG_ROUGH, fragNormal: FRAG_NORMAL,
      fragLightsEnd: FRAG_LIGHTS_END, fragBeforeOut: FRAG_BEFORE_OUT, fragAfterFog: FRAG_FAR_FADE,
    });
    // вершинный шейдер видит ENV; uCamXZ — общий
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10 + li;
    mesh.receiveShadow = li < 3 && qual > 0;
    if (li < 2 && qual > 0) {
      mesh.castShadow = true;
      const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      dm.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, ENV.uniforms, L.uniforms, { uTSize: sandU.uTSize, uFoot: sandU.uFoot });
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n' + 'uniform vec2 uCamXZ;\n' + VERT_PARS.replace(/varying [^\n]*\n/g, ''))
          .replace('#include <begin_vertex>', DEPTH_MAIN);
      };
      dm.customProgramCacheKey = () => 'rk-terrain-depth';
      mesh.customDepthMaterial = dm;
    }
    L.mesh = mesh;
    scene.add(mesh);
  });

  // обновление: обязательная заливка сразу, запас вперёд — порциями в пределах бюджета времени
  let rr = 0;
  function update(cam) {
    ENV.uniforms.uCamXZ.value.set(cam.x, cam.z);
    for (const L of levels) {
      const cx = Math.round(cam.x / L.s), cz = Math.round(cam.z / L.s);
      if (cx !== L.cx || cz !== L.cz) recenter(L, cx, cz);
    }
    const t0 = performance.now();
    const n = levels.length;
    for (let k = 0; k < n; k++) {
      const L = levels[(rr + k) % n];
      if (L.softDone) continue;
      syncSoft(L, L.cx, L.cz);
      if (performance.now() - t0 > SOFT_BUDGET_MS) break;
    }
    rr = (rr + 1) % n;
    for (const L of levels) {
      if (L.dirty) { L.tex.needsUpdate = true; L.dirty = false; }
      L.uniforms.uCenter.value.set(L.cx, L.cz);
    }
  }

  /**
   * Материал «песок ландшафта» для произвольной сетки (наносы у харвестера и т.п.): тот же фрагментный шейдер, что у клипмапа
   * (палитра, макровариация, рябь, зерно, следы, искры, туман), поэтому шва по цвету/материалу нет.
   * Вершины сетки должны давать: position (локально), normal, атрибут aMask (vec2: камень, плотность) — как terrain masks().
   */
  function makeSurfaceMaterial() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
    mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;   // там, где наносы лежат вровень с ландшафтом, выигрывает сетка (шейдер тот же)
    patchMaterial(mat, 'rk-surface' + (kS ? (kM ? 'tm' : 't') : ''), {
      uniforms: Object.assign({}, sandU),
      vertexCommon: true,
      vertexPars: 'attribute vec2 aMask;\nvarying vec3 vWP;\nvarying vec3 vTN;\nvarying vec2 vMask;\nvarying float vShade;\n',
      vertexBeginNormal: 'vec3 objectNormal = vec3(normal);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif\n',
      vertexMain: 'vec3 transformed = position;\nvWP = (modelMatrix * vec4(position, 1.0)).xyz; vTN = normalize(mat3(modelMatrix) * normal); vMask = aMask; vShade = rkClawShade(vWP);\n',
      fragPars: (kS ? (kM ? '#define RK_SAND_MID\n' : '') + '#define RK_SAND_TEX\nuniform vec4 uTexK;\n' + kS.pars + (kM ? kM.pars : '') : '') + FRAG_PARS, fragColor: FRAG_COLOR, fragRough: FRAG_ROUGH, fragNormal: FRAG_NORMAL,
      fragLightsEnd: FRAG_LIGHTS_END, fragBeforeOut: FRAG_BEFORE_OUT, fragAfterFog: FRAG_FAR_FADE,
    });
    return mat;
  }

  return {
    levels, update, sandU, texSize: TEX, cells: CELLS, makeSurfaceMaterial,
    setVisible(b) { for (const L of levels) L.mesh.visible = b; },
    /** Сбросить кэш высот (после изменения field.groundPatches) — кольца перезаливаются при следующем update. */
    invalidate(rect) {
      if (rect && Number.isFinite(rect.x)) return invalidateRect(rect.x, rect.z, rect.radius ?? rect.r ?? 0);
      for (const L of levels) { L.cx = 1e9; L.cz = 1e9; L.softDone = false; L.colI.fill(NaN); L.rowJ.fill(NaN); }
    },
    /** принудительная первичная заливка */
    prime(x, z) { update({ x, z }); },
  };
}
