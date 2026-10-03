// Материалы фигур: один процедурный шейдер на тело (дистикомб: рёбра/швы/ремни/износ/пыль в складках; кожа: поры, морщины, веснушки,
// SSS-аппроксимация, глаза с радужкой и веками, брови, щетина; волосы-карточки) и один на ткань (MeshPhysical + sheen, плетение,
// грязь к подолу, выгорание на плечах, бахрома; вершинная вторичная анимация: отставание, ветер, трепет, отталкивание от ног).
// Тело: вершинные смещения в позе привязки — моргание (веки), саккады (глаза), открывание рта (челюсть) — до скининга.
import * as THREE from 'three';
import { getTex } from '../core/textures.js';

const NOISE = /* glsl */`
float hash31(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float hash11(float n){ return fract(sin(n*127.1)*43758.5453); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i), hash31(i+vec3(1,0,0)), f.x), mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x), mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x), f.y), f.z) * 2.0 - 1.0;
}
float G2(float x, float y, float cx, float cy, float sx, float sy){ float a = (x-cx)/sx, b = (y-cy)/sy; return exp(-a*a-b*b); }
`;

const VERT_PARS = /* glsl */`
attribute float region;
attribute vec4 aux;
attribute vec4 face;
varying float vRegion;
varying vec4 vAux;
varying vec4 vFace;
varying vec3 vBind;
varying vec3 vBindN;
varying vec3 vEyeDir;
`;

const BODY_VERT_PARS = /* glsl */`
uniform vec4 uEyeC;
uniform float uBlink, uMouth, uHs;
uniform vec2 uEyeRot;
`;

const BODY_VERT_MAIN = /* glsl */`
#include <begin_vertex>
vRegion = region; vAux = aux; vFace = face; vBind = position; vBindN = normal; vEyeDir = vec3(0.0);
{
  vec3 ec = vec3((position.x >= 0.0 ? 1.0 : -1.0) * uEyeC.x, uEyeC.y, uEyeC.z);
  if (region > 6.5 && region < 7.5) {
    // глазное яблоко: направление взгляда (саккады) — поворот вокруг центра
    vec3 d = position - ec; vEyeDir = d;
    float cy = cos(uEyeRot.x), sy = sin(uEyeRot.x), cx = cos(uEyeRot.y), sx = sin(uEyeRot.y);
    d = vec3(cy * d.x + sy * d.z, d.y, -sy * d.x + cy * d.z);
    d = vec3(d.x, cx * d.y - sx * d.z, sx * d.y + cx * d.z);
    transformed = ec + d;
  }
  if (face.x != 0.0) {
    // веко вращается вокруг центра глаза (верхнее — сильно, нижнее — слабо); верхнее следует за взглядом
    float th = (uBlink * 0.64 - uEyeRot.y * 0.55) * face.x;
    vec3 d = position - ec; float c = cos(th), s = sin(th);
    transformed = ec + vec3(d.x, d.y * c - d.z * s, d.z * c + d.y * s);
  }
  if (face.w > 0.001 && uMouth > 0.001) {
    // челюсть: поворот вокруг оси у ушей
    vec3 hg = vec3(0.0, 1.63 - 0.014 * uHs, -0.004 * uHs);
    float th = uMouth * 0.24 * face.w; vec3 d = transformed - hg; float c = cos(th), s = sin(th);
    transformed = hg + vec3(d.x, d.y * c - d.z * s, d.z * c + d.y * s);
  }
}
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
uniform vec3 uSuit, uSkin, uCloth, uCloth2, uAccent, uLeather, uHair, uEye, uIris, uLining, uSunTone;
uniform float uDust, uWear, uEyeGlow, uAge, uStubble, uFreckle, uHs, uBrowK, uHairK;
uniform vec4 uEyeC;
uniform sampler2D uFabMap, uRubMap, uLeaMap;
uniform vec3 uTexOn;     // (ткань, резина, кожа) — 1 если библиотечная текстура есть
uniform vec3 uTexM;      // метров на тайл
varying float vRegion;
varying vec4 vAux;
varying vec4 vFace;
varying vec3 vBind;
varying vec3 vBindN;
varying vec3 vEyeDir;
float gSkin = 0.0;
${NOISE}
vec3 triMap(sampler2D t, vec3 p, vec3 n, float meters){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-4);
  vec3 q = p / meters;
  return texture2D(t, q.zy).rgb * w.x + texture2D(t, q.xz).rgb * w.y + texture2D(t, q.xy).rgb * w.z;
}
float fadeAt(float freq){ return 1.0 - smoothstep(0.35, 1.0, length(fwidth(vBind)) * freq); }
`;

const FRAG_COLOR = /* glsl */`
#include <color_fragment>
int rg = int(vRegion + 0.5);
vec3 base = uCloth; float rough = 0.9; float metal = 0.0; float rh = 0.0; float dustK = 0.0; float bumpAmt = 0.0;
float aoK = 1.0; float sheenK = 0.0; float irisMask = 0.0;
float nz = vnoise(vBind * 13.0), nz2 = vnoise(vBind * 52.0);
vec3 hp = vec3(vBind.x, vBind.y - 1.63, vBind.z) / uHs;   // координаты головы (единичный масштаб)
float hax = abs(hp.x);
if (rg == 0) {
  // ------------------------------------------------------------------ дистикомб
  float ph = vAux.x * 46.0;
  float fade = 1.0 - smoothstep(0.35, 1.1, fwidth(ph));
  float tri = abs(fract(ph) - 0.5) * 2.0;
  float hump = 1.0 - tri * tri;
  rh = hump * vAux.y * fade * 0.7;
  float rs = mix(0.84, 1.04, hump);
  base = uSuit * mix(1.0, rs, vAux.y * fade);
  base *= 1.0 + (nz * 0.22 + nz2 * 0.1) * (0.4 + uWear);
  float crack = smoothstep(0.55, 0.8, nz + nz2 * 0.4) * uWear;
  base = mix(base, base * vec3(1.5, 1.4, 1.25) + 0.015, crack * 0.5);
  float cs = 1.0 - smoothstep(0.0, 0.007, abs(vBind.x));
  base *= 1.0 - 0.35 * cs * step(0.95, vBind.y) * step(vBind.y, 1.45) * step(0.5, vAux.y);
  // швы панелей: вертикальные по углу, горизонтальные по высоте; строчка
  float ang = vAux.w * 6.2832;
  float seamV = 1.0 - smoothstep(0.0, 0.006, abs(fract(ang * 0.6366 + 0.125) - 0.5) * 1.5707 - 0.0);
  seamV = 1.0 - smoothstep(0.0015, 0.004, abs(fract(vAux.w * 4.0 + 0.125) - 0.5) * 0.25) ;
  float seamH = 1.0 - smoothstep(0.0012, 0.0035, abs(fract(vBind.y * 3.2 + 0.2) - 0.5) * 0.3125);
  float seam = max(seamV * step(0.5, vAux.y), seamH * step(0.5, vAux.y)) * step(0.8, vBind.y) * step(vBind.y, 1.46);
  float stitch = step(0.5, fract(vBind.y * 220.0 + vBind.x * 90.0 + vBind.z * 90.0)) * seam;
  base *= 1.0 - 0.28 * seam + 0.12 * stitch;
  rh -= seam * 0.9 * fade;
  // резиновая текстура (библиотека) — модуляция цвета и бамп по яркости
  if (uTexOn.y > 0.5) { vec3 tx = triMap(uRubMap, vBind, normalize(vBindN), uTexM.y); float l = dot(tx, vec3(0.333)); base *= 0.55 + 0.9 * l; rh += (l - 0.5) * 0.6 * fade; }
  rough = 0.42 + 0.25 * (1.0 - hump) + 0.2 * crack;
  dustK = vAux.z + (1.0 - hump) * 0.2 * vAux.y;
  bumpAmt = 0.0024 * fade;
  aoK = 0.78 + 0.22 * hump;
} else if (rg == 1 || rg == 9) {
  // ------------------------------------------------------------------ кожа
  gSkin = 1.0;
  float sunK = 0.9 + 0.1 * nz2;
  vec3 sk = uSkin * (0.94 + 0.08 * nz2 + 0.06 * nz);
  float hd = step(1.495, vBind.y);                          // голова/шея
  float redness = 0.55 * G2(hax, hp.y, 0.052, -0.026, 0.042, 0.034) + 0.9 * G2(hax, hp.y, 0.008, -0.026, 0.016, 0.02) + 0.6 * G2(hax, hp.y, 0.082, -0.012, 0.012, 0.03);
  sk = mix(sk, sk * vec3(1.14, 0.88, 0.84), clamp(redness, 0.0, 1.0) * 0.5 * hd);
  // крупные пятна тона (неравномерность кожи) и жёлтый оттенок лба
  sk *= 1.0 + 0.045 * vnoise(vBind * 17.0) * hd + 0.03 * vnoise(vBind * 6.0);
  sk = mix(sk, sk * vec3(1.04, 1.01, 0.9), G2(hax, hp.y, 0.0, 0.085, 0.07, 0.035) * 0.5 * hd);
  // солнечное загрубение: тёмная кожа лба/носа/скул, светлее под подбородком/на висках
  float sunExp = G2(hax, hp.y, 0.0, 0.07, 0.07, 0.04) + G2(hax, hp.y, 0.05, -0.01, 0.03, 0.03) + G2(hax, hp.y, 0.0, -0.02, 0.014, 0.03);
  sk *= 1.0 - 0.1 * clamp(sunExp, 0.0, 1.0) * (0.4 + uWear) * hd;
  // глазницы, мешки под глазами
  float socket = G2(hax, hp.y, uEyeC.x / uHs, uEyeC.y / uHs - 1.63 / uHs * 0.0 - 0.0, 0.02, 0.014);
  float eyeY = (uEyeC.y - 1.63) / uHs;
  socket = G2(hax, hp.y, uEyeC.x / uHs, eyeY, 0.02, 0.014);
  sk = mix(sk, sk * vec3(0.72, 0.6, 0.62), socket * (0.35 + 0.5 * uAge) * hd);
  // веснушки и пигментные пятна
  float fre = smoothstep(0.64, 0.76, vnoise(vBind * 300.0) * 0.8 + vnoise(vBind * 620.0) * 0.3) * uFreckle * clamp(G2(hax, hp.y, 0.04, -0.005, 0.07, 0.045), 0.0, 1.0);
  float spot = smoothstep(0.62, 0.72, vnoise(vBind * 95.0)) * uAge * 0.8;
  sk *= 1.0 - 0.33 * fre - 0.18 * spot;
  // кромка века, ресницы
  float lash = vFace.y * smoothstep(eyeY - 0.001, eyeY + 0.003, hp.y);
  sk = mix(sk, sk * vec3(0.82, 0.55, 0.52), vFace.y * 0.6 * hd);
  sk *= 1.0 - 0.7 * lash * hd;
  // брови (штрихи)
  float yc = 0.0385 + 0.011 * min(1.0, hax / 0.055);
  float bth = 0.0042 * (1.0 - 0.45 * smoothstep(0.045, 0.068, hax)) + 0.0006;
  float bm = (1.0 - smoothstep(bth * 0.35, bth, abs(hp.y - yc))) * smoothstep(0.011, 0.02, hax) * (1.0 - smoothstep(0.05, 0.067, hax));
  float strokes = 0.5 + 0.5 * vnoise(vec3(hp.x * 500.0, hp.y * 90.0, hp.z * 100.0));
  bm *= (0.35 + 0.65 * smoothstep(0.1, 0.6, strokes)) * uBrowK * step(0.0, hp.z - 0.04) * hd;
  sk = mix(sk, uHair * 0.75 + vec3(0.01), bm * 0.88);
  // щетина
  float stub = (1.0 - smoothstep(-0.045, -0.062, hp.y) * 0.0) * smoothstep(-0.052, -0.07, hp.y) * smoothstep(-0.123, -0.11, hp.y) * smoothstep(0.075, 0.05, hax) * step(0.0, hp.z - 0.0) + 0.7 * smoothstep(-0.032, -0.042, hp.y) * smoothstep(-0.052, -0.045, hp.y) * smoothstep(0.03, 0.014, hax) * step(hp.y, -0.037);
  stub += 0.55 * smoothstep(0.0, -0.03, hp.y) * smoothstep(0.052, 0.062, hax) * smoothstep(0.085, 0.07, hax) * smoothstep(-0.06, -0.02, hp.y);
  float sdot = smoothstep(0.52, 0.72, vnoise(vBind * 850.0) * 0.6 + vnoise(vBind * 1700.0) * 0.5 + 0.1);
  sk = mix(sk, mix(sk, uHair * 0.55, 0.78), clamp(stub, 0.0, 1.0) * uStubble * sdot * hd);
  sk = mix(sk, sk * 0.88 + uHair * 0.1, clamp(stub, 0.0, 1.0) * uStubble * 0.35 * hd);
  // губы
  float lip = 1.0 - smoothstep(0.8, 1.0, length(vec2(hp.x / 0.0262, (hp.y + 0.0648) / 0.0152)));
  vec3 lipC = uSkin * mix(vec3(1.0, 0.56, 0.5), vec3(1.0, 0.64, 0.58), smoothstep(-0.06, -0.072, hp.y)) * 0.86;
  sk = mix(sk, lipC, lip * 0.9 * hd);
  // нос/рот: тёмные полости
  sk = mix(sk, vec3(0.05, 0.012, 0.012), clamp(vFace.z * 1.25, 0.0, 1.0));
  base = sk;
  // шероховатость: жирная Т-зона блестит
  float oily = clamp(G2(hax, hp.y, 0.0, 0.07, 0.05, 0.03) + 0.9 * G2(hax, hp.y, 0.0, -0.01, 0.012, 0.035) + 0.5 * G2(hax, hp.y, 0.05, -0.012, 0.025, 0.02), 0.0, 1.0);
  rough = mix(0.58, 0.36, oily * (1.0 - 0.4 * uAge)) + 0.08 * lip * -1.0 + 0.1 * (1.0 - hd);
  // поры + морщины (карта высот для бампа)
  float pf = fadeAt(700.0);
  float pore = (vnoise(vBind * 650.0) * 0.5 + vnoise(vBind * 1500.0) * 0.5) * pf;
  float wr = 0.0;
  float fa = clamp(uAge * 1.2 - 0.12, 0.0, 1.0);
  float foreh = smoothstep(0.06, 0.075, hp.y) * (1.0 - smoothstep(0.125, 0.14, hp.y)) * smoothstep(0.075, 0.04, hax);
  wr += foreh * (1.0 - smoothstep(0.0, 0.5, abs(sin(hp.y * 260.0 + vnoise(vec3(hp.x * 55.0, 0.0, 0.0)) * 2.2)))) * fa * (0.5 + 0.5 * vnoise(vec3(hp.x * 30.0, hp.y * 5.0, 1.0)));
  vec2 ec2 = vec2(hax - uEyeC.x / uHs, hp.y - eyeY);
  float agePast = smoothstep(0.45, 0.9, uAge);
  float cf = exp(-pow(length((ec2 - vec2(0.022, 0.0)) * vec2(1.0, 1.7)) / 0.018, 2.0));
  wr += cf * (1.0 - smoothstep(0.0, 0.5, abs(sin(atan(ec2.y, ec2.x) * 8.0 + vnoise(vBind * 60.0))))) * agePast * 0.7;
  wr += (1.0 - smoothstep(0.0, 0.35, abs(sin(hp.y * 330.0 + hp.x * 20.0)))) * G2(hax, hp.y, uEyeC.x / uHs, eyeY - 0.02, 0.016, 0.005) * agePast;
  rh = pore * 0.45 - wr * 1.0;
  sk = base * (1.0 - 0.35 * wr * clamp(uAge + 0.2, 0.0, 1.0));
  base = sk;
  bumpAmt = 0.00028;
  dustK = 0.05;
  aoK = 1.0 - 0.35 * socket * hd - 0.25 * wr;
} else if (rg == 2 || rg == 12) {
  // ------------------------------------------------------------------ ткань: плетение, волокна, грязь, выгорание
  vec3 cc = rg == 12 ? uCloth2 : uCloth;
  float wf = fadeAt(520.0);
  float wu = vAux.w * 150.0, wv = vBind.y * 620.0;
  if (vFace.x > 0.5 && vFace.x < 1.5) { wu = atan(vBind.x, vBind.z) * 75.0; }
  else if (vFace.x > 1.5) { wu = atan(vBind.x - sign(vBind.x) * 0.19, vBind.z) * 44.0; }
  float thr = sin(wu * 6.2832) * 0.5 + 0.5, thv = sin(wv * 6.2832) * 0.5 + 0.5;
  float chk = mix(thr, thv, step(0.5, fract((floor(wu) + floor(wv)) * 0.5)));
  float weave = chk * wf;
  base = cc * (1.0 + 0.1 * nz + 0.07 * nz2 + 0.05 * (weave - 0.5));
  base *= (1.0 - 0.12 * vAux.x);
  if (uTexOn.x > 0.5) { vec3 tx = triMap(uFabMap, vBind, normalize(vBindN), uTexM.x); float l = dot(tx, vec3(0.333)); base *= 0.55 + 0.95 * l; rh += (l - 0.5) * 0.7 * wf; }
  // тень складок (глубина складки из геометрии)
  float fold = clamp(vAux.z, 0.0, 1.0);
  aoK = mix(0.28, 1.0, pow(fold, 1.3));
  if (!gl_FrontFacing) { base = mix(uLining, cc * 0.7, 0.2) * (0.9 + 0.1 * nz); aoK *= 0.85; }
  rough = 0.9; dustK = 0.1 + vAux.x * 0.65 + uWear * 0.1;
  // грязь/песок к подолу, выгорание на плечах
  float hem = 1.0 - smoothstep(0.05, 0.75, vBind.y);
  base = mix(base, base * vec3(0.7, 0.6, 0.47) + vec3(0.05, 0.04, 0.025), hem * 0.55 * uDust);
  base = mix(base, base * (1.0 - 0.1 * uDust) + 0.05 * uDust, hem * 0.25 * (nz2 * 0.5 + 0.5));
  float shoulder = smoothstep(1.2, 1.45, vBind.y);
  float lum = dot(base, vec3(0.3, 0.59, 0.11));
  base = mix(base, vec3(lum) * 1.18 + uSunTone * 0.05, shoulder * 0.28 * uWear);
  // не даём белому «выгорать»: потолок альбедо
  float mx = max(base.r, max(base.g, base.b));
  if (mx > 0.6) base *= 0.6 / mx * 0.35 + 0.65 * (1.0 - 0.0);
  base = min(base, vec3(0.62));
  bumpAmt = 0.00022 * wf + 0.0;
  rh += (weave - 0.5) * 0.9 * wf;
  sheenK = 1.0;
} else if (rg == 15) {
  // бахрома подола: нити с разной длиной, alpha-test
  float u = vAux.w, v = vAux.y, cell = floor(u * 560.0), fu = fract(u * 560.0);
  float len = 0.35 + 0.65 * hash11(cell * 1.7 + vFace.x * 13.0);
  float a = (1.0 - smoothstep(0.28, 0.5, abs(fu - 0.5))) * step(v, len);
  diffuseColor.a = max(a, step(v, 0.05));
  base = uCloth2 * (0.6 + 0.5 * hash11(cell)) * mix(1.0, 0.72, v);
  base = mix(base, base * vec3(0.7, 0.6, 0.47), 0.5 * uDust);
  rough = 0.95; dustK = 0.4;
} else if (rg == 3) {
  float st = step(0.5, fract((vBind.x + vBind.z * 0.7) * 45.0 + vBind.y * 3.0));
  base = uAccent * (0.62 + 0.22 * st) * (1.0 + 0.1 * nz);
  base = mix(vec3(dot(base, vec3(0.3, 0.59, 0.11))), base, 0.72);
  rough = 0.92; dustK = 0.1 + vAux.x * 0.5; sheenK = 0.6;
  float wf2 = fadeAt(520.0); rh += (st - 0.5) * 0.6 * wf2; bumpAmt = 0.0002 * wf2;
} else if (rg == 4) {
  base = uLeather * (0.85 + 0.2 * nz + 0.12 * nz2) * (1.0 - 0.2 * smoothstep(0.5, 0.9, nz2));
  rough = 0.58; dustK = vAux.z * 0.5;
  float lf = fadeAt(400.0);
  float grain = vnoise(vBind * 380.0) * 0.5 + vnoise(vBind * 900.0) * 0.4;
  rh += grain * 0.6 * lf; bumpAmt = 0.00035 * lf;
  // потёртости: светлее и глаже на выступах
  float scuff = smoothstep(0.35, 0.8, vnoise(vBind * 40.0) + uWear * 0.5);
  base = mix(base, base * 1.45 + 0.02, scuff * 0.35); rough = mix(rough, 0.4, scuff * 0.5);
  if (uTexOn.z > 0.5) { vec3 tx = triMap(uLeaMap, vBind, normalize(vBindN), uTexM.z); float l = dot(tx, vec3(0.333)); base *= 0.5 + 1.0 * l; rh += (l - 0.5) * 0.7 * lf; }
} else if (rg == 5) {
  base = vec3(0.34, 0.33, 0.33) * (0.8 + 0.3 * nz2); rough = 0.35; metal = 0.85;
} else if (rg == 6) {
  // ------------------------------------------------------------------ волосы: карточки с прядями
  float u = vAux.x, v = vAux.y, id = vAux.z;
  if (id >= 0.0) {
    float ns = 13.0, uu = u * ns + id * 7.0, cell = floor(uu), fu = fract(uu);
    float lenS = 0.45 + 0.55 * hash11(cell * 3.1 + id * 17.0);
    float a = (1.0 - smoothstep(0.26, 0.5, abs(fu - 0.5))) * step(v, lenS);
    diffuseColor.a = max(a, step(v, 0.16));
    float shade = 0.7 + 0.45 * hash11(cell + id * 5.0);
    base = uHair * shade * mix(0.5, 1.0, smoothstep(0.0, 0.4, v)) * (0.9 + 0.2 * v);
    rough = 0.62;
  } else {
    base = uHair * (0.4 + 0.18 * vnoise(vBind * 300.0)); rough = 0.8;
  }
  aoK = 0.8;
} else if (rg == 7) {
  // ------------------------------------------------------------------ глаз
  vec3 dir = normalize(vEyeDir);
  float ang = acos(clamp(dir.z, -1.0, 1.0)), phi = atan(dir.y, dir.x);
  float irisR = 0.5, pupilR = 0.2;
  float r = ang / irisR;
  float fib = vnoise(vec3(cos(phi) * 7.0, sin(phi) * 7.0, r * 3.0)) * 0.5 + vnoise(vec3(cos(phi) * 17.0, sin(phi) * 17.0, r * 8.0)) * 0.3;
  // склера с прожилками
  float vein = smoothstep(0.62, 0.8, vnoise(vec3(dir.xy * 9.0, dir.z * 3.0) + 3.0)) * (0.4 + 0.6 * smoothstep(0.7, 1.4, ang));
  vec3 scl = uEye * (0.92 + 0.08 * nz2);
  scl = mix(scl, scl * vec3(1.0, 0.62, 0.6) + vec3(0.12, 0.0, 0.0) * (1.0 - uEyeGlow * 1.5), vein * 0.5);
  scl *= 1.0 - 0.45 * smoothstep(0.1, 0.6, dir.y) - 0.35 * smoothstep(0.55, 0.95, abs(dir.x));
  float innerC = -sign(vBind.x) * dir.x;
  scl = mix(scl, vec3(0.72, 0.3, 0.28) * (0.8 + 0.2 * nz2), smoothstep(0.6, 0.86, innerC) * 0.85);   // слёзное мясцо
  scl = mix(scl, scl * vec3(1.0, 0.8, 0.78), smoothstep(0.55, 0.95, -innerC) * 0.5);
  vec3 ir = uIris * (0.65 + 0.9 * fib);
  ir = mix(ir, ir * vec3(1.9, 1.7, 1.2) + 0.02, smoothstep(0.55, 0.3, r) * smoothstep(0.2, 0.4, r) * 0.7);
  ir *= mix(0.3, 1.0, smoothstep(1.0, 0.8, r));            // лимбальное затемнение
  float inIris = 1.0 - smoothstep(0.96, 1.0, r);
  float inPupil = 1.0 - smoothstep(pupilR / 1.0 * 0.95, pupilR * 1.12 + 0.02, r);
  irisMask = max(inIris, inPupil);
  base = mix(scl, ir, inIris);
  base = mix(base, vec3(0.005), inPupil);
  rough = mix(0.14, 0.08, inIris);
  aoK = 1.0;
} else if (rg == 8) {
  base = uIris; rough = 0.15;
} else if (rg == 10) {
  base = vec3(0.045, 0.04, 0.038); rough = 0.8;
  float tr = smoothstep(0.1, 0.0, abs(fract(vBind.z * 55.0) - 0.5) - 0.18) * 0.0;
  rh += (step(0.5, fract(vBind.z * 70.0)) - 0.5) * 0.8 * fadeAt(70.0); bumpAmt = 0.0012;
} else if (rg == 16) {
  // шланг: тёмная резина, гофра даёт блики
  base = vec3(0.09, 0.085, 0.078) * (0.8 + 0.4 * nz2); rough = 0.42; dustK = 0.35;
  base = mix(base, vec3(0.26, 0.21, 0.15), 0.12 * uWear);
} else if (rg == 13) {
  base = vec3(0.62, 0.58, 0.48); rough = 0.28;
} else if (rg == 14) {
  base = vec3(0.1, 0.02, 0.025); rough = 0.4;
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
  vec2 dH = vec2(dFdx(rh), dFdy(rh)) * bumpAmt;
  vec3 q0 = dFdx(-vViewPosition.xyz), q1 = dFdy(-vViewPosition.xyz);
  vec3 R1 = cross(q1, normal), R2 = cross(normal, q0);
  float fDet = dot(q0, R1);
  vec3 grad = sign(fDet) * (dH.x * R1 + dH.y * R2);
  normal = normalize(abs(fDet) * normal - grad);
}
{
  float upN = max(0.0, (vec4(normal, 0.0) * viewMatrix).y);
  float dk = clamp(dustK * 0.9 + upN * 0.25, 0.0, 1.0) * uDust;
  if (rg != 7 && rg != 6 && rg != 13 && rg != 14) {
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.4, 0.29) * (0.85 + 0.2 * nz2), dk * (rg == 1 || rg == 9 ? 0.3 : 0.5));
    roughnessFactor = mix(roughnessFactor, 0.95, dk);
  }
  diffuseColor.rgb *= aoK;
}
`;

const FRAG_EMISSIVE = /* glsl */`
#include <emissivemap_fragment>
if (rg == 7) totalEmissiveRadiance += uEye * uEyeGlow * (1.0 - irisMask);
`;

/** Модифицированный RE_Direct_Physical: «обёрнутое» освещение и красноватая кромка терминатора для кожи (аппроксимация SSS). */
function skinLighting() {
  let c = THREE.ShaderChunk.lights_physical_pars_fragment;
  const a = /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);\s*vec3 irradiance = dotNL \* directLight\.color;/;
  if (!a.test(c)) return c;
  return c.replace(a, `float dotNLr = dot( geometryNormal, directLight.direction );
	float dotNL = saturate( dotNLr );
	float wrapK = gSkin * 0.5;
	float dotNLw = saturate( ( dotNLr + wrapK ) / ( 1.0 + wrapK ) );
	vec3 irradiance = dotNLw * directLight.color;
	float term = smoothstep( -0.45, 0.02, dotNLr ) * ( 1.0 - smoothstep( 0.02, 0.55, dotNLr ) );
	irradiance += gSkin * term * directLight.color * vec3( 0.55, 0.1, 0.03 ) * 0.55;`);
}

function patch(mat, key, uniforms, cloth) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', '#include <common>\n' + VERT_PARS + (cloth ? CLOTH_VERT_PARS : BODY_VERT_PARS));
    vs = vs.replace('#include <begin_vertex>', cloth ? '#include <begin_vertex>\nvRegion = region; vAux = aux; vFace = face; vBind = position; vBindN = normal; vEyeDir = vec3(0.0);' : BODY_VERT_MAIN);
    if (cloth) vs = vs.replace('#include <skinning_vertex>', CLOTH_VERT_MAIN);
    fs = fs.replace('#include <common>', '#include <common>\n' + FRAG_PARS);
    fs = fs.replace('#include <lights_physical_pars_fragment>', skinLighting());
    fs = fs.replace('#include <color_fragment>', FRAG_COLOR);
    fs = fs.replace('#include <metalnessmap_fragment>', FRAG_ROUGH);
    fs = fs.replace('#include <normal_fragment_maps>', FRAG_NORMAL);
    fs = fs.replace('#include <emissivemap_fragment>', FRAG_EMISSIVE);
    shader.vertexShader = vs; shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => key;
}

const C = (h) => new THREE.Color(h);
const DUMMY = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
DUMMY.needsUpdate = true;
// Библиотечные текстуры (если уже заполнены): цвет берётся как карта детализации (яркость), без жёсткой зависимости.
function libTex(name) { try { const t = getTex(name); return t && t.map ? t : null; } catch (e) { return null; } }

/** Униформы палитры + ткани для одной фигуры. */
export function makeUniforms(o) {
  const fab = libTex('fabric_woven') || libTex('fabric_rough'), rub = libTex('rubber'), lea = libTex('leather');
  const fs = o.faceSpec || { eye: [0.033, 1.644, 0.075, 0.0123] };
  const age = o.age ?? o.faceP?.age ?? 0.3;
  return {
    uSuit: { value: C(o.suit || '#4a4038') }, uSkin: { value: C(o.skin || '#9c7458') }, uCloth: { value: C(o.cloth || '#8a6a48') },
    uAccent: { value: C(o.accent || '#2c3e57') }, uLeather: { value: C(o.leather || '#4a3828') }, uHair: { value: C(o.hairColor || '#241a14') },
    uEye: { value: C(o.eyesIbad ? '#2650d8' : '#d6d0c4') }, uIris: { value: C(o.eyesIbad ? '#0a1650' : o.eyeColor || '#4a3020') }, uLining: { value: C(o.lining || '#6a5a44') },
    uDust: { value: o.dust ?? 0.55 }, uWear: { value: o.wear ?? 0.4 }, uEyeGlow: { value: o.eyesIbad ? 0.38 : 0 },
    uAge: { value: age }, uStubble: { value: o.stubble ?? 0 }, uFreckle: { value: o.freckles ?? 0.35 }, uBrowK: { value: o.brows ?? 1 }, uHs: { value: o.hs ?? 1 }, uSunTone: { value: C('#d8b07a') },
    uEyeC: { value: new THREE.Vector4(...fs.eye) }, uBlink: { value: 0 }, uEyeRot: { value: new THREE.Vector2() }, uMouth: { value: 0 },
    uTime: { value: 0 }, uPhase: { value: Math.random() * 100 },
    uLag: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3() },
    uHipY: { value: 0.92 }, uCloth2: { value: C(o.cloth2 || o.cloth || '#8a6a48') }, uLegL: { value: new THREE.Vector4(0, 0.48, 0, 0.08) }, uLegR: { value: new THREE.Vector4(0, 0.48, 0, 0.08) },
    uFabMap: { value: fab ? fab.map : DUMMY }, uRubMap: { value: rub ? rub.map : DUMMY }, uLeaMap: { value: lea ? lea.map : DUMMY },
    uTexOn: { value: new THREE.Vector3(fab ? 1 : 0, rub ? 1 : 0, lea ? 1 : 0) },
    uTexM: { value: new THREE.Vector3(fab?.meters || 0.5, rub?.meters || 0.5, lea?.meters || 0.5) },
    uHairK: { value: 1 },
  };
}
// clone() у three не копирует onBeforeCompile — переопределяем, чтобы клонирование (например, в модуле червя) сохраняло шейдер.
function make(U, cloth) {
  const m = cloth
    ? new THREE.MeshPhysicalMaterial({ color: U.uCloth.value.clone(), roughness: 0.9, metalness: 0, side: THREE.DoubleSide, sheen: 1, sheenRoughness: 0.55, sheenColor: U.uCloth.value.clone().lerp(new THREE.Color(1, 0.95, 0.85), 0.45), alphaTest: 0.5 })
    : new THREE.MeshStandardMaterial({ color: U.uSuit.value.clone(), roughness: 0.6, metalness: 0, alphaTest: 0.5 });
  patch(m, cloth ? 'rk-fig-cloth2' : 'rk-fig-body2', U, cloth);
  m.clone = function () { const c = make(U, cloth); c.copy(this); return c; };
  return m;
}
export function makeBodyMaterial(U) { return make(U, false); }
export function makeClothMaterial(U) { return make(U, true); }
