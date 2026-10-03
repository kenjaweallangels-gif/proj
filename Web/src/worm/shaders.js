// Шейдеры червя. Материалы — MeshStandardMaterial + onBeforeCompile: получаем освещение, туман и тонмаппинг сцены,
// а геометрию тела деформируем в вершинном шейдере по текстуре-позвоночнику (гладкое непрерывное тело, а не 90 отдельных колец).
//
// ЗАЩИТА ОТ NaN/Inf (причина «чёрного экрана» на реальных GPU — см. README): HDR-буфер полу-float, а UnrealBloomPass
// размазывает ОДИН NaN-пиксель на весь кадр. Поэтому: безопасные normalize (wnrm), pow только от max(x,0) (wpow),
// никаких smoothstep с перевёрнутыми рёбрами (wss), производные — только в равномерном потоке (до discard и вне if),
// на выходе фрагмента — проверка на NaN/Inf по битам и ограничение яркости (wguard).
import * as THREE from 'three';
import { LENGTH, RADIUS, N_PTS } from './spine.js';

/** Общие uniform-ы (один объект на все материалы червя). Править можно в рантайме: game.worm.look.* */
export function createUniforms(spineTex) {
  return {
    uSpine: { value: spineTex },
    uLen: { value: LENGTH },
    uR: { value: RADIUS },
    uBump: { value: 1.25 },       // сила микрорельефа пластин
    uSandAmt: { value: 0.35 },    // 0..1 налёт песка/пыли (сверху гуще)
    uDust: { value: 1.0 },        // множитель пылевого покрытия верха
    uRim: { value: 1.0 },         // сила контровой подсветки
    uSubs: { value: 1.0 },        // подкожный красноватый оттенок в бороздах
    uCrust: { value: 1.0 },       // «ракушечные» наросты у головы
    uGlow: { value: 1.0 },        // свечение пряности в глотке/швах (очень слабое)
    uSunV: { value: new THREE.Vector3(0.3, 0.8, 0.3) }, // направление на солнце в view-space
    uOpen: { value: 0 },          // раскрытие пасти 0..1 (для зазубренных кромок)
    uTime: { value: 0 },
  };
}

const NOISE = /* glsl */`
float wh21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
vec2 wh22(vec2 p){ float n = wh21(p); return vec2(n, wh21(p+n+19.19)); }
float wvn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(wh21(i),wh21(i+vec2(1,0)),f.x), mix(wh21(i+vec2(0,1)),wh21(i+vec2(1,1)),f.x), f.y); }
float wfbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*wvn(p); p=p*2.03+17.1; a*=0.5; } return s/0.9375; }
float wvoro(vec2 p){ vec2 ip=floor(p), fp=fract(p); float d1=8.0, d2=8.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(float(i),float(j)); vec2 o=wh22(ip+g); vec2 r=g+o-fp; float d=dot(r,r);
    if(d<d1){ d2=d1; d1=d; } else if(d<d2){ d2=d; } }
  return sqrt(d2)-sqrt(d1); }
vec3 wsrgb(vec3 c){ return pow(max(c, vec3(0.0)), vec3(2.2)); }
// --- безопасные примитивы ---
vec3 wnrm(vec3 v, vec3 fb){ float l = dot(v,v); return (l > 1e-14 && l < 1e18) ? v*inversesqrt(l) : fb; }
float wpow(float x, float y){ return pow(max(x, 1e-5), y); }
float wss(float e0, float e1, float x){ float t = clamp((x-e0)/(e1-e0), 0.0, 1.0); return t*t*(3.0-2.0*t); }   // допускает e0>e1
bool wbad(vec3 v){ uvec3 b = floatBitsToUint(v) & uvec3(0x7f800000u); return any(equal(b, uvec3(0x7f800000u))); }
// Координаты чешуи: x — ячейка по окружности, y — номер кольца, z — доля внутри кольца. Швы косые, ширина пластин плывёт.
vec3 wormCell(float s, float a){
  float ring = s*0.25; float rid = floor(ring); float f = ring - rid;
  float warp = (wfbm(vec2(s*0.045 + 3.0, a*1.7)) - 0.5)*1.7;
  float slant = 0.30*(f - 0.5);
  return vec3(a*5.729578 + 0.5*rid + warp + slant, rid, f);
}
// Купольные наросты (ракушки/«барнаклы»): высота 0..1 и случайный id.
float wblob(vec2 p, out float id){
  vec2 ip = floor(p), fp = fract(p); float best = 0.0; id = 0.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = vec2(float(i),float(j)); vec2 o = wh22(ip+g);
    float rr = 0.20 + 0.24*wh21(ip+g+7.7);
    float d = length(g + o*0.62 + 0.19 - fp);
    float h = 1.0 - wss(rr*0.30, rr, d);
    if(h > best){ best = h; id = wh21(ip+g+3.3); }
  }
  return best;
}
`;

const SKIN = /* glsl */`
uniform float uBump; uniform float uSandAmt; uniform float uOpen; uniform vec3 uSunV;
uniform float uDust; uniform float uSubs; uniform float uCrust; uniform float uRim; uniform float uGlow; uniform float uTime;
// pm — размер пикселя в «шагах» шаблона (fwidth считается снаружи, в равномерном потоке управления).
void wormSkin(float s, float a, vec3 wN, float pm, out vec3 alb, out float rgh, out float hgt, out float cav){
  vec3 wc = wormCell(s, a); float cell = wc.x; float rid = wc.y; float f = wc.z;
  float g = fract(cell);
  float pid = wh21(vec2(floor(cell), rid));
  float bx = 1.0 - abs(2.0*g-1.0);
  float lodMicro = 1.0 - wss(0.2, 0.55, pm);
  float lodGrowth = 1.0 - wss(0.12, 0.35, pm);
  float lodFine = 1.0 - wss(0.04, 0.13, pm);
  float lodCrack = 1.0 - wss(0.08, 0.32, pm);
  float lodGroove = 1.0 - wss(0.25, 0.9, pm);
  float brk = wss(0.25, 0.75, wvn(vec2(floor(cell)*1.3 + rid*0.7, s*0.5)));
  float groove = (1.0 - wss(0.0,0.14,bx)) * (0.45 + 0.55*brk);
  groove = mix(0.22, groove, lodGroove);
  // кольцевой шов: нависающая кромка пластины (шельф), тень под ней, глубокая борозда
  float seam  = 1.0 - wss(0.0, 0.085, min(f, 1.0 - f));
  float shelf = wss(0.55, 0.78, f) * (1.0 - wss(0.86, 0.93, f));
  float under = wss(0.88, 0.95, f) * (1.0 - wss(0.985, 1.0, f));
  seam = mix(0.35, seam, lodGroove);
  vec2 q = vec2(s, a*20.0);
  float macro = wfbm(vec2(s*0.035, a*1.6));
  float meso = wfbm(vec2(s*0.18, a*4.0)+11.0);
  float micro = mix(0.5, wfbm(q*1.1), lodMicro);
  float growth = mix(0.5, 0.5 + 0.5*sin((f*7.0 + meso*5.0)*6.2831), lodGrowth*0.6);
  float ridges = mix(0.5, 0.5 + 0.5*sin(a*5.729578*6.2831*3.0 + meso*5.0), lodFine);
  float cr = 0.0, scar = 0.0, crustH = 0.0, crustId = 0.0;
  float headD = s;                                       // расстояние от головы, м
  float crustM = uCrust * (1.0 - wss(30.0, 135.0, headD)) * wss(0.30, 0.55, wfbm(vec2(s*0.05 + 5.0, a*1.3 + 2.0)));
  #ifdef WORM_HQ
  float ve = wvoro(q*0.38 + pid*7.0);
  cr = (1.0 - wss(0.0,0.06,ve)) * wss(0.52,0.74, wfbm(q*0.1+3.0)) * lodCrack;
  // шрамы: длинные светлые царапины вдоль тела + рубцы
  float sc1 = wvn(vec2(s*0.55 + pid*5.0, a*26.0 + 3.0));
  scar = wss(0.90, 0.97, sc1) * wss(0.50, 0.75, wfbm(vec2(s*0.04+9.0, a*1.1))) * lodFine;
  float sc2 = wss(0.80, 0.93, wvn(vec2(s*0.09 + 21.0, a*2.6 + 4.0)));
  scar = max(scar, sc2*0.5);
  if (crustM > 0.02) { crustH = wblob(vec2(s*0.62, a*12.0) + 3.0, crustId) * crustM * lodCrack; }
  #endif
  vec3 rust  = wsrgb(vec3(0.45,0.34,0.25));
  vec3 grey  = wsrgb(vec3(0.41,0.38,0.34));
  vec3 ochre = wsrgb(vec3(0.55,0.45,0.32));
  vec3 base = mix(mix(rust,grey,wss(0.30,0.68,macro)), ochre, 0.15+0.4*meso*pid);
  alb = base*(0.78+0.4*micro)*(0.88+0.12*growth);
  alb = mix(alb, alb*1.30+0.012, shelf*0.55);                    // кромки светлее
  alb *= (0.82+0.3*bx)*(1.0-0.5*groove)*(1.0-0.62*seam)*(1.0-0.55*under)*(1.0-0.65*cr)*(1.0-0.05*ridges);
  // шрамы — светлая зарубцевавшаяся ткань
  alb = mix(alb, wsrgb(vec3(0.62,0.55,0.46)), scar*0.65);
  // наросты у головы: известковая корка, тёмная кайма у основания
  if (crustH > 0.01) {
    vec3 crustCol = mix(wsrgb(vec3(0.66,0.62,0.54)), wsrgb(vec3(0.52,0.47,0.40)), crustId);
    alb = mix(alb, crustCol, wss(0.05, 0.4, crustH));
    alb *= 1.0 - 0.45*(1.0 - wss(0.05, 0.25, crustH))*wss(0.01,0.05,crustH);
  }
  // песок/пыль: заполняет борозды, сверху покрывает гуще, на боках — вертикальные потёки
  float up = wss(0.10, 0.92, wN.y);
  float pat = wss(0.28,0.62, wfbm(vec2(s*0.12,a*2.5)+7.0)+0.12+uSandAmt*0.5);
  float streak = wss(0.45, 0.8, wvn(vec2(s*1.9 + pid*3.0, a*2.2)));
  float side = 1.0 - up;
  float sandM = (groove*0.95 + seam*0.95 + under*0.4)*pat*1.25
              + uDust*up*up*(0.55 + 0.45*micro)*(0.6 + 0.6*pat)
              + uDust*up*0.28
              + side*streak*0.38*pat*uSandAmt*2.0
              + uSandAmt*0.20*up;
  sandM = clamp(sandM*(1.0 - 0.8*crustH), 0.0, 1.0);
  vec3 sandCol = wsrgb(vec3(0.76,0.62,0.44))*(0.88+0.25*micro);
  alb = mix(alb, sandCol, sandM*0.82);
  alb = mix(alb, sandCol*0.8, 0.07);
  rgh = mix(0.62+0.24*micro, 0.97, sandM);
  rgh = mix(rgh, 0.9, crustH);
  hgt = 0.34*(1.0-groove) - 0.55*seam + 0.22*shelf - 0.35*under + 0.08*micro + 0.03*growth - 0.22*cr + 0.45*sandM
      + 0.10*ridges + 0.9*crustH - 0.12*scar;
  cav = clamp(seam*0.9 + groove*0.5 + under*0.5, 0.0, 1.0) * (1.0 - sandM*0.7);   // «внутренность» борозды (подкожный оттенок)
}
void wormFlesh(float s, float a, float fpm, out vec3 alb, out float rgh, out float hgt){
  vec2 q = vec2(s, a*18.0);
  float fl = 1.0 - wss(0.3, 0.9, fpm);
  float v = wvoro(q*0.35);
  float vein = (1.0 - wss(0.0,0.10,v)) * fl;
  float n = wfbm(q*0.3);
  float rib = 0.5+0.5*sin(a*40.0 + n*4.0);
  vec3 c0 = wsrgb(vec3(0.30,0.15,0.15)), c1 = wsrgb(vec3(0.52,0.31,0.28));
  alb = mix(c0,c1,n*0.8+0.2*rib)*(1.0-0.45*vein);
  vec2 tp = vec2(s*0.55, a*18.0*0.55); tp.x += 0.5*mod(floor(tp.y),2.0);
  float d = length(fract(tp)-0.5);
  float dotM = (1.0 - wss(0.10,0.20,d)) * wss(0.35,0.6,wvn(q*0.3)) * fl;
  alb = mix(alb, wsrgb(vec3(0.78,0.72,0.60)), dotM*0.55);
  rgh = mix(0.34, 0.5, dotM);
  hgt = dotM*0.4 - vein*0.3 + n*0.25;
}
`;

const SPINE_VS = /* glsl */`
uniform highp sampler2D uSpine; uniform float uLen; uniform float uR;
varying vec2 vSA; varying float vShade;
vec4 wsp(int i){ return texelFetch(uSpine, ivec2(clamp(i,0,${N_PTS - 1}),0), 0); }
vec3 wspn(int i){ return texelFetch(uSpine, ivec2(clamp(i,0,${N_PTS - 1}),1), 0).xyz; }
vec3 wormSurf(float s, float a, out vec3 C){
  s = clamp(s, 0.0, uLen-0.01);
  float f = s/${(LENGTH / (N_PTS - 1)).toFixed(1)}; int i = int(floor(f)); float t = f-float(i);
  vec4 p0=wsp(i-1), p1=wsp(i), p2=wsp(i+1), p3=wsp(i+2);
  float t2=t*t, t3=t2*t;
  vec4 P = 0.5*((2.0*p1)+(-p0+p2)*t+(2.0*p0-5.0*p1+4.0*p2-p3)*t2+(-p0+3.0*p1-3.0*p2+p3)*t3);
  vec3 d = 0.5*((-p0.xyz+p2.xyz)+2.0*(2.0*p0.xyz-5.0*p1.xyz+4.0*p2.xyz-p3.xyz)*t+3.0*(-p0.xyz+3.0*p1.xyz-3.0*p2.xyz+p3.xyz)*t2);
  vec3 T = wnrm(-d, vec3(0.0,0.0,1.0));
  vec3 upv = abs(T.y) > 0.95 ? vec3(1.0,0.0,0.0) : vec3(0.0,1.0,0.0);
  vec3 N = mix(wspn(i), wspn(i+1), t);
  N = wnrm(N - T*dot(N,T), wnrm(upv - T*dot(upv,T), vec3(1.0,0.0,0.0)));
  vec3 B = cross(T,N);
  vec3 wc = wormCell(s, a); float fr = wc.z;
  // пластины: плавный подъём, нависающая кромка (шельф) и резкий обрыв в глубокую борозду
  float dseam = min(fr, 1.0 - fr);
  float stp = -1.0 + 1.9*smoothstep(0.0,0.7,fr) + 0.75*smoothstep(0.58,0.84,fr) - 2.65*smoothstep(0.88,1.0,fr)
            - 0.9*exp(-(dseam*dseam)/(0.03*0.03));
  float g = fract(wc.x);
  float dome = 1.0 - pow(abs(2.0*g-1.0), 3.0);
  float ridge = pow(dome, 7.0);
  float macro = (wfbm(vec2(s*0.04, a*1.3)) - 0.5)*1.6;
  float dent = smoothstep(0.80, 0.92, wvn(vec2(s*0.09 + 13.0, a*2.4)));          // рубцы-вмятины
  float belly = smoothstep(2.2,3.14,abs(mod(a+3.14159,6.28318)-3.14159));
  float r = (uR + stp + 0.75*dome + 0.32*ridge + macro*(1.0-0.4*belly) - 1.1*dent) * max(P.w, 0.02);
  vec3 dir = cos(a)*N + sin(a)*B;
  C = P.xyz;
  return P.xyz + dir*r;
}
`;

function injectCommon(shader, extraVS = '', extraFS = '') {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${extraVS}`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${NOISE}\n${SKIN}\n${extraFS}`);
}

const FRAG_COLOR_BODY = /* glsl */`
  vec3 wN = wnrm(inverseTransformDirection(wnrm(vNormal, vec3(0.0,1.0,0.0)), viewMatrix), vec3(0.0,1.0,0.0));
  float wDist = length(vViewPosition);
  // производные — ДО любых ветвлений и discard (равномерный поток управления)
  vec2 wpa = vec2(cos(vSA.y), sin(vSA.y))*20.0;
  float wPm = max(fwidth(vSA.x), length(fwidth(wpa)));
  float wFpm = max(fwidth(vSA.x), length(fwidth(vec2(cos(vSA.y), sin(vSA.y))*18.0)));
  vec3 wAlb; float wRough; float wH; float wCav = 0.0; bool wKill = false;
  #if WORM_MODE == 1
    {
      float sr = abs(vPet.y);
      float saw = abs(fract(vPet.x*13.0)-0.5)*2.0;
      float ser = (0.012 + 0.07*saw*smoothstep(0.08,0.5,vPet.x)) * smoothstep(0.0,0.25,uOpen);
      if (sr > 0.992 - ser || vPet.x > 0.995 - 0.38*vPet.y*vPet.y*smoothstep(0.0,0.3,uOpen)) wKill = true;
    }
    vec3 wAlbS, wAlbF; float wRS, wRF, wHS, wHF;
    wormSkin(vSA.x, vSA.y, wN, wPm, wAlbS, wRS, wHS, wCav);
    wormFlesh(vSA.x, vSA.y, wFpm, wAlbF, wRF, wHF);
    if (gl_FrontFacing) { wAlb = wAlbS; wRough = wRS; wH = wHS; } else { wAlb = wAlbF; wRough = wRF; wH = wHF; wCav = 0.0; }
    // складки губ: гребни поперёк лепестка и валик вдоль шва
    float lipRib = pow(0.5 + 0.5*sin(vSA.x*1.9 + vPet.y*2.0), 2.0) * smoothstep(0.05, 0.35, vPet.x);
    float lipEdge = smoothstep(0.62, 0.98, abs(vPet.y)) * (1.0 - smoothstep(0.5, 1.0, vPet.x)*0.6);
    if (gl_FrontFacing) { wH += 0.22*lipRib + 0.35*lipEdge; wAlb *= 1.0 - 0.18*lipRib; wCav = max(wCav, 0.4*lipRib); }
    wAlb *= 1.0 - 0.55*smoothstep(0.82,1.0,abs(vPet.y));          // швы между лепестками темнее
  #elif WORM_MODE == 2
    wormFlesh(vSA.x, vSA.y, wFpm, wAlb, wRough, wH);
  #else
    wormSkin(vSA.x, vSA.y, wN, wPm, wAlb, wRough, wH, wCav);
  #endif
  if (wbad(wAlb)) wAlb = vec3(0.25, 0.2, 0.15);
  if (wbad(vec3(wRough, wH, wCav))) { wRough = 0.9; wH = 0.0; wCav = 0.0; }
  diffuseColor.rgb = wAlb;
  vec3 wBounce = wAlb * (0.04 + 0.22*clamp(0.5 - 0.5*wN.y, 0.0, 1.0)) * vec3(1.0, 0.84, 0.62);
`;

const FRAG_BUMP = /* glsl */`
  {
    vec2 dH = vec2(dFdx(wH), dFdy(wH)) * uBump * faceDirection;
    vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
    vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (dH.x*r1 + dH.y*r2);
    normal = wnrm(abs(det)*normal - grad, normal);
  }
`;

// Эмиссия: отскок песка, контровая подсветка кромок, подкожный оттенок в бороздах, очень слабое свечение пряности в швах.
const FRAG_EMISSIVE_BODY = /* glsl */`
  {
    vec3 wVv = wnrm(vViewPosition, vec3(0.0,0.0,1.0));
    float wNV = clamp(dot(normal, wVv), 0.0, 1.0);
    float wFres = wpow(1.0 - wNV, 3.0);
    float wSun = clamp(dot(normal, uSunV)*0.5 + 0.5, 0.0, 1.0);
    vec3 rimCol = mix(vec3(0.55,0.62,0.78), vec3(1.0,0.74,0.46), wSun);
    totalEmissiveRadiance += wAlb * rimCol * wFres * (0.10 + 0.55*wSun) * uRim * vShade;
    totalEmissiveRadiance += vec3(0.50,0.17,0.08) * wCav * (0.045 + 0.05*wSun) * uSubs * vShade;
    #if WORM_MODE == 1
      float seamGlow = smoothstep(0.90, 1.0, abs(vPet.y)) * (0.7 + 0.3*sin(uTime*0.9));
      totalEmissiveRadiance += vec3(0.95,0.48,0.16) * seamGlow * 0.045 * uGlow * (gl_FrontFacing ? 1.0 : 0.0);
    #endif
    #if WORM_MODE == 2
      float depthG = 1.0 - exp(-vSA.x*0.07);
      float pulse = 0.75 + 0.25*sin(uTime*0.9 + vSA.x*0.12);
      totalEmissiveRadiance += mix(vec3(0.95,0.46,0.14), vec3(0.28,0.46,0.95), 0.25) * depthG * pulse * 0.10 * uGlow;
    #endif
  }
`;

/**
 * @param {number} mode 0 — тело (вершины по текстуре), 1 — лепесток (хитин снаружи, плоть внутри), 2 — глотка (плоть, темнеет вглубь)
 */
export function patchChitin(material, mode, U, hq = true) {
  material.defines = { ...(material.defines || {}), WORM_MODE: mode };
  if (hq) material.defines.WORM_HQ = 1; else delete material.defines.WORM_HQ;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    if (mode === 0) {
      injectCommon(shader, NOISE + SPINE_VS, 'varying vec2 vSA; varying float vShade;');
      shader.vertexShader = shader.vertexShader
        .replace('#include <beginnormal_vertex>', /* glsl */`
          float wAA = uv.y * 6.2831853; float wSS = uv.x * uLen;
          // конечная разность строго внутри тела (у кончика хвоста идём назад — иначе нулевая нормаль → NaN)
          float wDs = wSS > uLen - 0.7 ? -0.45 : 0.45;
          vec3 wC, wC2;
          vec3 wWp = wormSurf(wSS, wAA, wC);
          vec3 wWs = wormSurf(wSS + wDs, wAA, wC2);
          vec3 wWa = wormSurf(wSS, wAA + 0.02, wC2);
          vec3 wWn = wnrm(cross(wWs - wWp, wWa - wWp) * sign(wDs), vec3(0.0,1.0,0.0));
          vec3 objectNormal = wWn;
          #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
          #endif
        `)
        .replace('#include <begin_vertex>', `vec3 transformed = wWp; vSA = vec2(wSS, wAA); vShade = 1.0;`);
    } else {
      injectCommon(shader,
        `varying vec2 vSA; varying float vShade;${mode === 1 ? 'attribute vec2 aPet; varying vec2 vPet;' : ''}`,
        `varying vec2 vSA; varying float vShade;${mode === 1 ? 'varying vec2 vPet;' : ''}`);
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>\n vSA = uv; ${mode === 1 ? 'vPet = aPet; vShade = 1.0;' : 'vShade = mix(0.03, 1.0, exp(-uv.x*0.085));'}`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR_BODY}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = wRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_BUMP}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += wBounce * vShade;\n${FRAG_EMISSIVE_BODY}`)
      .replace('#include <opaque_fragment>', /* glsl */`
        outgoingLight *= vShade;
        if (wbad(outgoingLight)) outgoingLight = wAlb * 0.3;            // NaN/Inf → нейтральный цвет, а не чёрный кадр
        outgoingLight = min(outgoingLight, vec3(48.0));
        #if WORM_MODE == 1
        if (wKill) discard;                                             // discard — в самом конце, после всех производных
        #endif
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `worm${mode}${hq ? 'h' : 'l'}2`;
  return material;
}

/** Кристаллические зубы: молочный кварц, Френель, подсветка «на просвет» против солнца. */
export function patchTeeth(material, U) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDepth; varying float vDepth; varying float vTip;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = aDepth; vTip = uv.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vDepth; varying float vTip; uniform vec3 uSunV;\n${NOISE}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= mix(vec3(1.0,0.93,0.80), vec3(0.82,0.92,1.0), smoothstep(0.3,1.0,vTip));')
      .replace('#include <emissivemap_fragment>', /* glsl */`
        #include <emissivemap_fragment>
        {
          vec3 Vv = wnrm(vViewPosition, vec3(0.0,0.0,1.0));
          // КОРЕНЬ БАГА «ЧЁРНЫЙ ЭКРАН»: 1.0-abs(dot) на реальном GPU бывает -1e-7 → pow(отрицательное) = NaN → bloom → весь кадр
          float fres = wpow(1.0 - abs(dot(normal, Vv)), 2.2);
          float back = wpow(max(dot(-Vv, uSunV), 0.0), 2.0);
          float thin = 0.35 + 0.65*vTip;
          totalEmissiveRadiance += vec3(1.0,0.86,0.62) * back * thin * 0.9 * (1.0 - 0.6*vDepth);
          totalEmissiveRadiance += vec3(0.42,0.58,0.80) * fres * 0.22 * (1.0 - 0.7*vDepth);
          totalEmissiveRadiance += vec3(0.30,0.40,0.62) * 0.05 * vTip;
        }`)
      .replace('#include <opaque_fragment>', /* glsl */`
        outgoingLight *= mix(1.0, 0.18, vDepth);
        if (wbad(outgoingLight)) outgoingLight = vec3(0.2);
        outgoingLight = min(outgoingLight, vec3(48.0));
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'wormteeth2';
  return material;
}

/** Подкладка под тело: те же вершины, только задние грани, тёмный цвет — закрывает «дырки» между кольцами на силуэте. */
export function patchSpineBack(material, U) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${NOISE}\n${SPINE_VS}`)
      .replace('#include <begin_vertex>', 'vec3 wC; vec3 transformed = wormSurf(uv.x * uLen, uv.y * 6.2831853, wC);');
  };
  material.customProgramCacheKey = () => 'wormback2';
  return material;
}

/**
 * Страховка HDR-буфера: подменяет финальную строку шейдера марева (desert/post.js), чтобы NaN/Inf из ЛЮБОГО источника
 * не доходили до bloom (один NaN-пиксель = чёрный кадр). Возвращает true, если патч применён. Идемпотентно.
 */
export function guardPostHaze(post) {
  const m = post?.haze?.material;
  if (!m || m.userData.wormGuard) return !!m;
  const needle = 'gl_FragColor = texture2D(tDiffuse, uv);';
  if (!m.fragmentShader.includes(needle)) return false;
  m.fragmentShader = m.fragmentShader.replace(needle, /* glsl */`
      vec4 wc = texture2D(tDiffuse, uv);
      uvec3 wb = floatBitsToUint(wc.rgb) & uvec3(0x7f800000u);
      if (any(equal(wb, uvec3(0x7f800000u))) || wc.a != wc.a) wc = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(min(wc.rgb, vec3(6e4)), wc.a);`);
  m.userData.wormGuard = true;
  m.needsUpdate = true;
  return true;
}
