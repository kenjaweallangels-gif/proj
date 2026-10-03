// Небо: аналитическая «пыльная» атмосфера с сумерками, звёздами и Млечным Путём, две луны с фазами и гало,
// два слоя облаков (кучевые/пылевые + перистые), солнечный диск и ореол; солнце-DirectionalLight, полусфера, тени.
import * as THREE from 'three';
import { ENV, GLSL_COMMON } from './env.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // на дальней плоскости
}`;

const SKY_FRAG = /* glsl */`
varying vec3 vDir;
uniform float uClouds;
uniform vec3 uStormDir;
uniform vec3 uHorizonSun;
uniform float uSkyNight;
uniform mat3 uStarMat;
uniform vec3 uCloudKey;
uniform vec3 uMoonDir[2];
uniform vec3 uMoonTan[2];
uniform vec4 uMoonP[2];   // sin(радиус), sin(ψ), cos(ψ), яркость
uniform vec3 uMoonCol[2];
uniform float uQ;
uniform vec4 uHz;        // x: сила горизонтных слоёв (0..1), y: яркость заката на пиках, z: виртуальный масштаб дальности, w: время для мерцания
${GLSL_COMMON}

// ---------------------------------------------------------------- 1D-шум по азимуту (дальние хребты, мезы, дюны)
float rkN1(float x, float s){ float i = floor(x), f = x - i; f = f*f*(3.0 - 2.0*f); return mix(rkHash12(vec2(i, s)), rkHash12(vec2(i + 1.0, s)), f); }
float rkF1(float x, float s){ return rkN1(x, s)*0.5 + rkN1(x*2.13, s + 3.0)*0.25 + rkN1(x*4.7, s + 7.0)*0.125 + rkN1(x*9.3, s + 11.0)*0.0625; }

// ---------------------------------------------------------------- звёзды
vec3 starLayers(vec3 s, float tw, float dens){
  vec3 acc = vec3(0.0);
  for (int L = 0; L < 3; L++) {
    float sc = L == 0 ? 55.0 : (L == 1 ? 120.0 : 260.0);
    float thr = L == 0 ? 0.972 : (L == 1 ? 0.962 : 0.962);
    thr -= dens * (L == 2 ? 0.05 : 0.02);
    vec3 p = s * sc;
    vec3 id = floor(p);
    float h = rkHash13(id + float(L) * 17.0);
    if (h < thr) continue;
    vec3 f = p - id;
    vec3 sp = vec3(rkHash13(id + 3.1), rkHash13(id + 7.7), rkHash13(id + 11.3)) * 0.6 + 0.2;
    float aa = length(fwidth(p)) + 1e-4;
    float d = length(f - sp);
    float sig = 0.42 * aa + 0.002;
    float prof = exp(-d * d / (2.0 * sig * sig));
    float mag = rkHash13(id + 29.0);
    float amp = (L == 0 ? 1.0 : (L == 1 ? 0.55 : 0.3)) * (0.08 + 0.92 * mag * mag * mag);
    float ph = rkHash13(id + 41.0);
    amp *= 1.0 + tw * sin(uTime * (2.0 + 5.0 * ph) + ph * 60.0);
    vec3 col = mix(vec3(1.0, 0.72, 0.5), vec3(0.62, 0.76, 1.0), rkHash13(id + 53.0));
    col = mix(col, vec3(1.0), 0.45);
    acc += col * amp * prof;
  }
  return acc;
}
vec3 milkyWay(vec3 s, out float band){
  vec3 G = normalize(vec3(0.30, 0.82, -0.48));
  vec3 C = normalize(cross(G, vec3(0.0, 0.0, 1.0)));
  float gl = dot(s, G);
  band = exp(-gl * gl / (2.0 * 0.13 * 0.13));
  float n = rkFbm3(s * 9.0 + 1.3);
  float n2 = rkFbm3(s * 31.0 + 7.0);
  float lane = smoothstep(0.35, 0.8, rkFbm3(s * vec3(14.0) + 9.0)) * exp(-gl * gl / (2.0 * 0.045 * 0.045));
  float core = pow(max(dot(s, C), 0.0), 2.5);
  float mw = band * (0.5 + 0.7 * n) * (0.7 + 0.6 * n2) * (1.0 - 0.6 * lane) * (0.55 + 0.9 * core);
  vec3 col = mix(vec3(0.5, 0.6, 0.95), vec3(1.0, 0.8, 0.58), clamp(core * 1.2, 0.0, 1.0));
  return col * mw * 0.3;
}

// ---------------------------------------------------------------- луны
vec3 moonDisc(vec3 d, int i, out float haloOut){
  vec3 M = uMoonDir[i];
  float cosA = dot(d, M);
  haloOut = 0.0;
  if (cosA <= 0.2) return vec3(0.0);
  float sinR = uMoonP[i].x;
  vec3 perp = d - M * cosA;
  vec3 t = uMoonTan[i];
  vec3 b = cross(M, t);
  vec2 p = vec2(dot(perp, t), dot(perp, b)) / (cosA * sinR);
  float rr = length(p);
  float ang = rr * sinR;
  float lit0 = 0.5 * (1.0 - uMoonP[i].z);
  float br = uMoonP[i].w;
  float vis = smoothstep(-0.12, 0.08, M.y);
  haloOut = (exp(-ang * 45.0) * 0.8 + exp(-ang * 10.0) * 0.3 + exp(-ang * 3.0) * 0.08) * (0.1 + 0.9 * lit0) * br * vis;
  vec3 col = vec3(0.0);
  if (rr < 1.0) {
    vec3 n = vec3(p, sqrt(max(1.0 - rr * rr, 0.0)));
    vec3 L = vec3(uMoonP[i].y, 0.0, -uMoonP[i].z);
    float lit = smoothstep(-0.02, 0.07, dot(n, L));
    float seed = float(i) * 9.3;
    float mar = rkFbm(p * 2.1 + seed + 3.0) * 0.8 + 0.2 * rkNoise(p * 7.0 + seed);
    float albedo = mix(0.34, 0.95, smoothstep(0.34, 0.56, mar));
    vec2 cp = p * 6.5 + seed; vec2 cid = floor(cp);
    float cd = length(fract(cp) - 0.2 - 0.6 * rkHash22(cid + seed));
    float crater = rkHash12(cid + 5.0) > 0.55 ? smoothstep(0.17, 0.05, cd) * 0.25 - smoothstep(0.24, 0.17, cd) * 0.12 * (1.0 - n.z) : 0.0;
    albedo = clamp(albedo - crater + 0.02 * (rkNoise(p * 30.0) - 0.5), 0.1, 1.0);
    float limb = mix(0.78, 1.0, pow(n.z, 0.35));
    float earthshine = 0.025;
    col = uMoonCol[i] * albedo * limb * (lit * 3.4 + earthshine) * br * vis;
    col *= smoothstep(1.0, 0.94, rr);
  }
  return col;
}

// ---------------------------------------------------------------- облака
vec2 cloudUV(vec3 d, float scale){ return d.xz / (d.y + 0.05) * scale; }

// Силуэтный слой: возвращает высоту (в единицах d.y) на азимуте a; kind: 0 — хребет, 1 — меза, 2 — дюнное море
float rkSil(float a, int kind, float seed){
  if (kind == 0) {
    float pres = smoothstep(0.40, 0.62, rkN1(a*1.1 + 3.0, seed));
    float r = 1.0 - abs(2.0*rkF1(a*5.0, seed + 1.0) - 1.0);
    return 0.004 + pres*(0.012 + 0.07*pow(r, 1.6)*(0.55 + 0.9*rkN1(a*0.7, seed + 5.0)));
  }
  if (kind == 1) {
    float n = rkF1(a*4.2, seed);
    float pres = smoothstep(0.30, 0.55, rkN1(a*0.9 + 9.0, seed + 2.0));
    float hp = 0.012 + 0.035*rkN1(a*1.7, seed + 4.0);
    float body = 0.45*smoothstep(0.42, 0.55, n) + 0.55*smoothstep(0.55, 0.585, n);
    float top = 1.0 - 0.1*rkN1(a*70.0, seed + 8.0);
    return 0.003 + pres*hp*body*top;
  }
  float w = rkF1(a*3.0, seed)*2.0;
  float sw = fract(a*(7.0 + 4.0*rkN1(a*0.6, seed)) + w);
  float prof = sw < 0.82 ? sw/0.82 : (1.0 - sw)/0.18;
  return 0.0015 + (0.004 + 0.007*rkF1(a*1.4, seed + 6.0))*pow(prof, 1.25);
}

// Горизонтные слои (без геометрии): три полосы с параллаксом и воздушной перспективой; сверху в «небесном» пространстве.
vec3 rkHorizon(vec3 d, vec3 sky, vec3 sunLit){
  float y = d.y;
  vec2 dxz = normalize(d.xz + vec2(1e-5));
  vec2 tg = vec2(-dxz.y, dxz.x);
  float az = atan(d.z, d.x);
  float aa = max(fwidth(y), 1e-4);
  vec2 sxz = normalize(uSunDir.xz + vec2(1e-5));
  float sunT = dot(tg, sxz), sunN = max(dot(-dxz, sxz), 0.0);
  float sunEl = max(uSunDir.y, 0.0);
  float vis = uHz.x;
  vec3 fogHere = rkFogColorDir(d);
  vec3 outc = sky;
  for (int i = 0; i < 3; i++) {
    float D = i == 0 ? 26000.0 : (i == 1 ? 11000.0 : 4200.0);            // для тумана
    float Dp = D*3.2*uHz.z;                                                  // для параллакса (камера ходит сотни метров)
    float seed = 7.0 + float(i)*13.7;
    float a0 = az + dot(uCamXZ, tg)/Dp;
    float h = rkSil(a0, i, seed);
    float m = 1.0 - smoothstep(h - aa, h + aa, y);
    if (m < 0.002) continue;
    // освещение склона: наклон силуэта по азимуту + солнце
    float e = 0.0016;
    float dh = (rkSil(a0 + e, i, seed) - rkSil(a0 - e, i, seed)) / (2.0*e);
    float slope = clamp(-dh*7.0, -1.0, 1.0);
    float ndl = clamp(0.30 + 0.55*sunN*sunEl + 0.65*sunN*(1.0 - sunEl)*0.55 + slope*sunT*0.45, 0.0, 1.0);
    // высота над основанием: нижняя часть (ближе к земле) утопает в дымке
    float k = clamp(y / max(h, 1e-4), 0.0, 1.0);
    vec3 alb = i == 0 ? vec3(0.34, 0.26, 0.24) : (i == 1 ? vec3(0.42, 0.29, 0.20) : vec3(0.58, 0.44, 0.29));
    alb *= 0.82 + 0.3*rkN1(a0*180.0 + y*700.0, seed + 3.0);                  // страты/эрозия
    alb *= 0.78 + 0.35*smoothstep(0.0, 0.9, k);                               // светлее к вершинам
    vec3 lit = alb*(uKeyColor*0.30*ndl + uAmbient*0.95);
    // воздушная перспектива: плотность тумана и пыли + дальность слоя
    float T = exp(-uFogDensity*D*0.45*(1.0 + 1.6*uDust));
    float haze = i == 0 ? 0.80 : (i == 1 ? 0.66 : 0.46);
    haze = 1.0 - (1.0 - haze)*T;
    haze = mix(haze, 1.0, clamp(uStorm*1.4, 0.0, 1.0));
    haze = clamp(haze + (1.0 - k)*0.25, 0.0, 1.0);
    vec3 col = mix(lit, fogHere, haze);
    // рассвет/закат: пики ловят свет (контровой край), ночью — силуэт с лунной подсветкой
    col += sunLit*uHz.y*pow(max(dot(d, uSunDir), 0.0), 3.0)*(1.0 - haze)*smoothstep(0.0, 0.7, k)*0.9;
    outc = mix(outc, col, m*vis);
  }
  return outc;
}

void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  // под горизонтом небо = цвет тумана (закрыто ландшафтом): тяжёлые слои не считаем
  if (y < -0.085) { gl_FragColor = vec4(uFogColor, 1.0); return; }
  vec3 tint = uSunColor / max(max(uSunColor.r, uSunColor.g), max(uSunColor.b, 1e-3));
  float yy = max(y, 0.0);
  float t = pow(yy, 0.5);
  // градиент неба + сторона солнца (закатная арка)
  vec2 dxz = normalize(d.xz + vec2(1e-5));
  vec2 sxz = normalize(uSunDir.xz + vec2(1e-5));
  float side = max(dot(dxz, sxz), 0.0);
  float sideW = side * side * (0.35 + 0.65 * side);
  vec3 sky = mix(uHorizon, uZenith, t);
  float lowSun = 1.0 - smoothstep(0.1, 0.55, uSunDir.y);
  float arc = exp(-yy * mix(5.0, 3.0, lowSun)) * (0.25 + 0.75 * sideW * mix(0.5, 1.0, lowSun));
  sky = mix(sky, uHorizonSun, clamp(arc, 0.0, 1.0));
  // охристая пыльная полоса у горизонта
  float band = exp(-yy * 7.0);
  sky = mix(sky, uFogColor * 1.05, band * (0.35 + 0.4 * uDust + 0.3 * uStorm));
  sky = mix(sky, uFogColor, smoothstep(0.02, -0.08, y));
  sky = mix(sky, uFogColor * 1.0, 0.92 * smoothstep(0.45, 1.0, uStorm));
  #ifndef SKY_LITE
  // рассеяние: зенит темнеет и синеет против солнца, у горизонта — молочная белизна (Рэлей + Ми)
  {
    float anti = 1.0 - side;
    sky *= 1.0 - 0.10*anti*smoothstep(0.15, 0.9, yy)*(1.0 - 0.8*uStorm);
    sky += uHorizon*0.10*exp(-yy*14.0)*(1.0 - uStorm)*(0.5 + 0.5*side);
  }
  // сумеречный пояс (пояс Венеры) и тень Земли напротив солнца
  {
    float twE = uSunDir.y;
    float tw = smoothstep(-9.0*0.01745, -0.5*0.01745, twE)*(1.0 - smoothstep(1.0*0.01745, 7.0*0.01745, twE));
    if (tw > 0.01) {
      float anti2 = pow(max(-dot(dxz, sxz), 0.0), 1.5);
      float pinkB = smoothstep(0.012, 0.05, y)*(1.0 - smoothstep(0.08, 0.28, y));
      float shadowB = 1.0 - smoothstep(0.0, 0.05, y);
      vec3 pink = uHorizonSun*vec3(1.1, 0.78, 0.85);
      sky = mix(sky, sky*vec3(0.62, 0.66, 0.86), shadowB*anti2*tw*0.65*(1.0 - uStorm));
      sky = mix(sky, pink, pinkB*anti2*tw*0.5*(1.0 - uStorm));
    }
  }
  #endif

  float vis = smoothstep(-0.02, 0.06, y);
  // ---- ночь: звёзды, Млечный Путь, луны
  if (uSkyNight > 0.003 && y > -0.1) {
    // слабое свечение ночного неба (airglow) и дальнего света: ночь читается, а не чёрная
    sky += vec3(0.020, 0.034, 0.075) * uSkyNight * uInvExp * (0.35 + 0.65 * exp(-yy * 2.2));
    vec3 s = uStarMat * d;
    float hz = 1.0 - smoothstep(0.0, 0.45, y);
    float fadeH = smoothstep(0.06, 0.4, y);
    float mwBand = 0.0;
    vec3 mw = milkyWay(s, mwBand);
    vec3 st = starLayers(s, 0.2 + 0.5 * hz, mwBand);
    float moonGlare = 0.0;
    vec3 mAcc = vec3(0.0);
    vec3 halo = vec3(0.0);
    for (int i = 0; i < 2; i++) {
      float hl;
      mAcc += moonDisc(d, i, hl);
      halo += uMoonCol[i] * hl;
      moonGlare = max(moonGlare, hl);
    }
    float starVis = 1.0 - clamp(moonGlare * 1.6, 0.0, 0.85);
    vec3 night = (st * 0.9 + mw) * starVis * fadeH;
    sky += (night + halo * vec3(0.5, 0.62, 0.9) * 0.9) * uSkyNight * uInvExp * (1.0 - 0.7 * clamp(uDust, 0.0, 1.0));
    sky += mAcc * uInvExp * 0.62 * min(1.0, uSkyNight * 2.0) * smoothstep(-0.02, 0.05, y);
  }

  // ---- Ми-рассеяние: широкий тёплый ореол + плотное гало
  float mu = max(dot(d, uSunDir), 0.0);
  float dustK = 0.55 + 1.3 * uDust + 0.6 * uStorm;
  float sunUp = smoothstep(-0.12, 0.08, uSunDir.y);
  vec3 glow = tint * (pow(mu, 4.0) * 0.14 + pow(mu, 24.0) * 0.4 + pow(mu, 220.0) * 1.1 + pow(mu, 900.0) * 3.0) * dustK;
  glow *= mix(0.8, 1.4, lowSun);
  sky += glow * sunUp * smoothstep(-0.1, 0.1, y + 0.1) * (0.35 + 0.65 * length(uSunColor) / (length(uSunColor) + 0.5));
  // солнечный диск: потемнение к краю + корона в пыли
  float cosS = dot(d, uSunDir);
  float th = sqrt(max(2.0*(1.0 - cosS), 0.0));
  float rr = th / 0.0135;
  float limb = 1.0 - 0.6*(1.0 - sqrt(max(1.0 - rr*rr, 0.0)));
  float disc = (1.0 - smoothstep(0.93, 1.02, rr))*limb;
  float occl = 1.0 - 0.8*clamp(uStorm*1.2 + uDust*0.5, 0.0, 1.0);
  float vSun = smoothstep(-0.04, 0.02, uSunDir.y)*smoothstep(-0.02, 0.03, y);
  vec3 discCol = tint*disc*mix(22.0, 90.0, smoothstep(0.1, 0.5, uSunDir.y))*occl*vSun;
  float corona = (0.5*exp(-th/0.022) + 0.17*exp(-th/0.075) + 0.05*exp(-th/0.28))*(0.35 + 1.3*uDust + 0.9*uStorm);
  discCol += tint*corona*1.6*sunUp*vSun*occl*(0.5 + 0.5*lowSun);
  sky += discCol;
  #ifndef SKY_LITE
  // лучи сумеречного неба (crepuscular): радиальные полосы вокруг солнца, видны в пыли и у горизонта
  if (cosS > 0.8 && uSunDir.y > -0.05 && uQ > 0.5) {
    vec3 T1 = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 B1 = cross(uSunDir, T1);
    float phi = atan(dot(d, B1), dot(d, T1));
    float rays = rkN1(phi*9.0 + uTime*0.01, 41.0)*0.6 + rkN1(phi*23.0 - uTime*0.017, 43.0)*0.4;
    rays = smoothstep(0.35, 0.95, rays);
    float fall = smoothstep(0.8, 0.985, cosS)*(1.0 - smoothstep(0.9993, 1.0, cosS));
    sky += tint*rays*fall*fall*(0.05 + 0.25*uDust + 0.25*lowSun)*sunUp*smoothstep(-0.03, 0.08, y)*occl;
  }
  #endif

  // ---- облака
  if (y > 0.012) {
    float up = smoothstep(0.012, 0.3, y);
    vec2 w = uWind;
    vec2 wp = vec2(-w.y, w.x);
    vec3 keyL = uCloudKey;
    float mup = max(dot(d, uKeyDir), 0.0);
    vec3 cAmb = uAmbient * 0.55 + uZenith * 0.25;
    vec3 dustTone = uFogColor * vec3(1.0, 0.82, 0.62);
    float dustMix = clamp(uDust * 0.75 + uStorm * 0.5, 0.0, 0.95);
    // подсветка снизу закатным/рассветным светом (облака горят у солнца и розовеют по всему небу)
    float cNight = 1.0 - 0.62 * uSkyNight;      // ночью облака тусклее (иначе «белые пятна» на тёмном небе)
    vec3 sunsetC = uHorizonSun * (0.25 + 1.1 * sideW) * lowSun * (1.0 - 0.7 * uStorm);
    // перистые (тонкие, вытянутые по ветру): всегда есть немного, гуще при облачности
    {
      vec2 cuv = cloudUV(d, 0.75) + w * uTime * 0.003;
      vec2 q = vec2(dot(cuv, w), dot(cuv, wp));
      float c = rkFbm(vec2(q.x * 0.9, q.y * 4.2) + 3.0) * 0.8 + rkFbm(q * vec2(2.0, 8.0) + 11.0) * 0.4;
      float cov = 0.22 + 0.7 * uClouds;
      float cl = smoothstep(0.92 - cov * 0.6, 1.3 - cov * 0.25, c) * up * 0.5;
      vec3 cc = (keyL * (0.30 + 0.9 * pow(mup, 5.0)) + cAmb * 0.8) * 0.85;
      cc += sunsetC * 0.55 * (0.5 + 0.5 * pow(mup, 2.0));
      cc = mix(cc, dustTone * (cAmb + keyL * 0.15) , dustMix * 0.6);
      sky = mix(sky, cc * cNight, cl);
    }
    // кучевой/пылевой слой
    if (uQ > 0.5 && (uClouds > 0.04 || uStorm > 0.02)) {
      vec2 uv = cloudUV(d, 1.35) + w * uTime * 0.006;
      vec2 wuv = uv + 0.35 * vec2(rkNoise(uv * 1.7 + 4.0), rkNoise(uv * 1.7 + 9.0)) - 0.17;
      float n = rkFbm(wuv * 1.0 + 2.0) * 0.86 + 0.14 * rkNoise(wuv * 7.0);
      float thr = 0.74 - 0.5 * clamp(uClouds, 0.0, 1.0) - 0.16 * uStorm;
      float dn = smoothstep(thr, thr + 0.5, n);
      vec2 sl = normalize(uKeyDir.xz + vec2(1e-5)) * 0.09;
      float n2 = rkFbm((wuv + sl) + 2.0) * 0.86 + 0.14 * rkNoise((wuv + sl) * 7.0);
      float sh = clamp(0.62 + (n - n2) * 5.0, 0.0, 1.0);
      float thin = dn * (1.0 - dn) * 4.0;
      vec3 lit = keyL * 0.30 * (0.3 + 0.7 * sh) + cAmb * 0.9;
      lit *= mix(0.5, 1.0, sh);
      lit += keyL * 0.30 * thin * (0.3 + 2.2 * pow(mup, 6.0)) + tint * thin * sunUp * 0.12 * pow(mup, 3.0) * (0.5 + lowSun);   // серебряная кайма
      lit += sunsetC * 0.5 * (0.35 + 0.65 * sh);
      lit = mix(lit, dustTone * (cAmb * 0.9 + keyL * 0.22 * (0.4 + 0.6 * sh)), dustMix);
      float a = dn * dn * (3.0 - 2.0 * dn) * smoothstep(0.012, 0.22, y) * (0.8 - 0.2 * uStorm);
      sky = mix(sky, lit * cNight, a);
    }
    // альтокумулюс («барашки»): мелкие ячеистые гряды выше кучевых, подсвеченные с солнечной стороны
    #ifndef SKY_LITE
    if (uQ > 0.5 && uClouds > 0.16 && uStorm < 0.9) {
      vec2 uv = cloudUV(d, 3.3) + w * uTime * 0.008;
      uv = vec2(dot(uv, w) * 0.8, dot(uv, wp) * 1.5);
      float cov = smoothstep(0.16, 0.85, uClouds);
      float n = rkNoise(uv * 0.9 + 17.0) * 0.55 + rkNoise(uv * 2.6 + 3.0) * 0.3 + rkNoise(uv * 7.0) * 0.15;
      float band = smoothstep(0.30, 0.65, rkNoise(uv * vec2(0.22, 0.7) + 5.0));
      float dn = smoothstep(0.62 - 0.2 * cov, 0.86 - 0.12 * cov, n + (band - 0.5) * 0.3);
      vec2 sl = normalize(uKeyDir.xz + vec2(1e-5)) * 0.12;
      float n2 = rkNoise((uv + sl) * 2.6 + 3.0) * 0.55 + rkNoise((uv + sl) * 0.9 + 17.0) * 0.3 + rkNoise((uv + sl) * 7.0) * 0.15;
      float sh = clamp(0.65 + (n - n2) * 6.0, 0.0, 1.0);
      float edge = dn * (1.0 - dn) * 4.0;
      float a = dn * dn * smoothstep(0.04, 0.3, y) * (1.0 - smoothstep(0.7, 0.95, y) * 0.5) * 0.65;
      vec3 lit = keyL * 0.26 * (0.3 + 0.7 * sh) + cAmb * 0.85;
      lit += keyL * 0.2 * edge * (0.3 + 1.6 * pow(mup, 5.0)) + sunsetC * 0.65 * (0.4 + 0.6 * sh);
      lit = mix(lit, dustTone * (cAmb * 0.9 + keyL * 0.2), dustMix);
      sky = mix(sky, lit * cNight, a);
    }
    #endif
  }
  #ifndef SKY_LITE
  // дальние хребты, мезы и дюнные моря — слои-импосторы у горизонта (после облаков и солнца: перекрывают их)
  if (y < 0.16 && uHz.x > 0.002) sky = rkHorizon(d, sky, uHorizonSun);
  #endif
  // зернистость от бандинга
  sky += (rkHash12(gl_FragCoord.xy) - 0.5) * 0.004;
  gl_FragColor = vec4(max(sky, 0.0), 1.0);
}`;

export function createSky(game) {
  const { scene, renderer } = game;
  const q = game.settings.quality;
  const mv = () => [new THREE.Vector3(), new THREE.Vector3()];
  const skyU = {
    uClouds: { value: 0.1 }, uStormDir: { value: new THREE.Vector3(-1, 0, 1).normalize() },
    uHorizonSun: { value: new THREE.Color('#e2c79b') }, uSkyNight: { value: 0 }, uStarMat: { value: new THREE.Matrix3() },
    uCloudKey: { value: new THREE.Color(1, 1, 1) },
    uMoonDir: { value: mv() }, uMoonTan: { value: mv() },
    uMoonP: { value: [new THREE.Vector4(0.04, 0, 1, 1), new THREE.Vector4(0.02, 0, 1, 0.7)] },
    uMoonCol: { value: [new THREE.Color(1, 0.95, 0.86), new THREE.Color(0.84, 0.9, 1)] },
    uQ: { value: q === 'low' ? 0 : q === 'med' ? 1 : 2 },
    uHz: { value: new THREE.Vector4(1, 0.5, 1, 0) },
  };
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    uniforms: Object.assign({}, ENV.uniforms, skyU),
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  /** Упрощённый материал неба для PMREM (без звёзд/облаков/хребтов): те же uniform-объекты, но без тяжёлых слоёв. */
  function makeLite() {
    return new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, defines: { SKY_LITE: 1 },
      uniforms: mat.uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), mat);
  dome.scale.setScalar(8000);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  scene.add(dome);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = renderer.shadowMap.enabled;
  const R = q === 'high' ? 120 : 90;
  const mapSize = q === 'high' ? 4096 : 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  const sc = sun.shadow.camera;
  sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 900;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.35;
  sun.shadow.radius = 2.0;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0x8aa4cc, 0xb08a60, 1.0);
  scene.add(hemi);

  const right = new THREE.Vector3(), upv = new THREE.Vector3(), tmp = new THREE.Vector3(), center = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  let Rcur = R;
  function update(cam) {
    dome.position.copy(cam);
    skyU.uHz.value.set(1, 1 - Math.min(1, Math.max(0, (ENV.uniforms.uSunDir.value.y - 0.05) / 0.3)), 1, 0);
    // при низком солнце тени длинные — расширяем окно теней (дальше видно тени дюн)
    const keyY = ENV.uniforms.uKeyDir.value.y;
    const lowK = 1 - Math.min(1, Math.max(0, (keyY - 0.1) / 0.45));
    const Rt = Math.round((R * (1 + 0.85 * lowK)) / 5) * 5;
    sun.shadow.normalBias = 0.35 + 1.1 * lowK;
    sun.shadow.bias = -0.0004 - 0.0014 * lowK;
    if (Rt !== Rcur) { Rcur = Rt; sc.left = -Rt; sc.right = Rt; sc.top = Rt; sc.bottom = -Rt; sc.updateProjectionMatrix(); }
    // тени: окно следует за камерой, привязка к текселям в пространстве света (ключ — солнце или луна)
    const L = ENV.uniforms.uKeyDir.value;
    center.copy(cam);
    game.camera.getWorldDirection(fwd);
    center.x += fwd.x * Rcur * 0.35; center.z += fwd.z * Rcur * 0.35;
    center.y = Math.max(0, cam.y - 3);
    const f = tmp.copy(L).negate();
    right.crossVectors(f, UP).normalize();
    upv.crossVectors(right, f).normalize();
    const texel = (2 * Rcur) / mapSize;
    const cx = center.dot(right), cy = center.dot(upv);
    const sx = Math.round(cx / texel) * texel, sy = Math.round(cy / texel) * texel;
    center.addScaledVector(right, sx - cx).addScaledVector(upv, sy - cy);
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(L, 420);
    sun.target.updateMatrixWorld();
  }

  return { dome, sun, hemi, skyU, update, mat, makeLite };
}
