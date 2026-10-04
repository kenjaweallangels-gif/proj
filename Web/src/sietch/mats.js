// Материалы сиетча: «отполированный ладонями камень» (процедурный шейдер поверх MeshStandardMaterial),
// ткани с раскачкой, металл, глина, дерево-волокно, декали трёх слоёв истории. Запечённый свет — атрибут aGlow.
import * as THREE from 'three';
import { makeTextures } from './textures.js';
import { getTex } from '../core/textures.js';

const MAXP = 6;
export const U = {
  uTime: { value: 0 }, uGlowK: { value: 1.0 }, uBump: { value: 1.0 }, uAmbK: { value: 0.3 },
  // «толкатели» ткани: капсулы персонажей (локальные координаты сиетча): A.xyz — нижняя точка, A.w — радиус; B.xyz — верхняя точка
  uCapA: { value: Array.from({ length: MAXP }, () => new THREE.Vector4(0, -999, 0, 0)) },
  uCapB: { value: Array.from({ length: MAXP }, () => new THREE.Vector4(0, -999, 0, 0)) },
};
export const MAX_PUSHERS = MAXP;

/** Исключает направленный свет (солнце/луна пустыни) из материала: интерьер освещают только светошары и зонды. */
export function noSun(sh) {
  const chunk = THREE.ShaderChunk.lights_fragment_begin.replace('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )', '#if 0');
  sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
}

const NOISE = /* glsl */`
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm3(vec2 p){ float a=.5,s=0.; for(int i=0;i<3;i++){ s+=a*vnoise(p); p=p*2.03+17.; a*=.5;} return s; }
float fbm2(vec2 p){ return 0.62*vnoise(p) + 0.38*vnoise(p*2.03+17.); }
vec3 perturbMy(vec3 sp, vec3 sn, vec2 dH, float fd){
  vec3 sx = normalize(dFdx(sp)); vec3 sy = normalize(dFdy(sp));
  vec3 r1 = cross(sy, sn); vec3 r2 = cross(sn, sx);
  float det = dot(sx, r1) * fd;
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * sn - grad);
}`;

const STONE_FRAG = /* glsl */`
  vec3 an = abs(vLN);
  float mode = vPar.z;
  float stoneH = 0.5; float pol = vPar.x; float mortar = 0.0; float gr = 0.5; float bh = 0.5;
  vec2 suv;
  if (an.y > 0.72) suv = vLP.xz; else if (an.x > an.z) suv = vec2(vLP.z, vLP.y); else suv = vec2(vLP.x, vLP.y);
  if (mode < 0.5) {
    bool fl = an.y > 0.72;
    vec2 bs = fl ? vec2(1.0, 1.0) : vec2(1.0, 0.5);
    float row = floor(suv.y / bs.y);
    float off = h21(vec2(row, 3.1)) * bs.x;
    float colm = floor((suv.x + off) / bs.x);
    vec2 f = vec2(fract((suv.x + off) / bs.x), fract(suv.y / bs.y));
    vec2 dd = min(f, 1.0 - f) * bs;
    float edge = min(dd.x, dd.y);
    mortar = 1.0 - smoothstep(0.0, 0.028, edge);
    float bevel = smoothstep(0.0, 0.07, edge);
    bh = h21(vec2(colm, row));
    gr = fbm3(suv * 5.0 + vec2(colm, row) * 7.0);
    stoneH = bevel * 0.55 + gr * 0.45 + bh * 0.08 - mortar * 0.4;
    pol += 0.0;
  } else if (mode < 1.5) {
    vec3 w = an / (an.x + an.y + an.z);
    gr = w.x * fbm3(vLP.zy * 1.7) + w.y * fbm3(vLP.xz * 1.7) + w.z * fbm3(vLP.xy * 1.7);
    float g2 = w.x * fbm3(vLP.zy * 6.0) + w.y * fbm3(vLP.xz * 6.0) + w.z * fbm3(vLP.xy * 6.0);
    stoneH = gr * 0.6 + g2 * 0.5; bh = g2;
  } else {
    // песок: гряды-рябь + зерно
    float rp = sin(vLP.x * 7.0 + fbm3(vLP.xz * 0.8) * 9.0) * 0.5 + 0.5;
    gr = fbm3(vLP.xz * 3.0); bh = rp;
    stoneH = rp * 0.5 + gr * 0.5;
  }
  float yy = vLP.y;
  // полировка «по руке»: полоса высоты 0.6–1.5 м на стенах + поручни
  float hand = smoothstep(0.55, 0.95, yy) * (1.0 - smoothstep(1.25, 1.8, yy));
  if (an.y < 0.6 && mode < 0.5) pol += hand * 0.55 * (0.4 + gr);
  pol = clamp(pol, 0.0, 1.0);
  vec3 stoneCol = diffuseColor.rgb;
  if (mode > 1.5) {
    stoneCol *= vec3(1.0, 0.93, 0.85) * (0.85 + 0.3 * gr);
  } else {
    stoneCol *= (0.78 + 0.45 * gr) * (0.86 + 0.28 * bh);
    stoneCol *= 1.0 - mortar * 0.38;
    stoneCol *= mix(vec3(1.0), vec3(1.12, 1.0, 0.9), pol);
    // подтёки от потолка и солевые разводы
    float streak = smoothstep(0.55, 0.9, vnoise(vec2(suv.x * 3.1, suv.y * 0.22 + 4.0)));
    stoneCol *= 1.0 - 0.22 * streak * smoothstep(0.5, 3.0, yy);
    // песок у пола
    if (an.y < 0.7) stoneCol = mix(stoneCol, vec3(0.62, 0.48, 0.3) * 0.7, (1.0 - smoothstep(0.0, 0.28, yy)) * 0.35 * gr);
  }
  // копоть
  float sootN = 0.6 + 0.8 * fbm3(suv * 2.0 + 11.0);
  stoneCol *= 1.0 - clamp(vPar.y * sootN, 0.0, 1.0) * 0.72;
  diffuseColor.rgb = stoneCol;
`;

function patch(mat, o = {}) {
  const key = `siet-${o.kind || 'std'}${o.sway ? '-sw' : ''}`;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uGlowK = U.uGlowK; sh.uniforms.uBump = U.uBump; sh.uniforms.uAmbK = U.uAmbK; sh.uniforms.uCapA = U.uCapA; sh.uniforms.uCapB = U.uCapB;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aGlow; attribute vec3 aPar;
varying vec3 vGlow; varying vec3 vPar; varying vec3 vLP; varying vec3 vLN;
uniform float uTime;
uniform vec4 uCapA[${MAXP}]; uniform vec4 uCapB[${MAXP}];`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = aGlow; vPar = aPar; vLP = position; vLN = normal;
${o.sway ? `float sw = aPar.z;
transformed.x += (sin(uTime*1.25 + position.y*1.7 + position.x*0.9) + 0.4*sin(uTime*2.3+position.z*2.0)) * 0.045 * sw;
transformed.z += (sin(uTime*1.05 + position.y*1.3 + position.z*0.8) + 0.4*sin(uTime*1.9+position.x*2.0)) * 0.045 * sw;
for (int pi = 0; pi < ${MAXP}; pi++) {
  vec4 pA = uCapA[pi]; if (pA.w <= 0.0) continue;
  vec3 pB = uCapB[pi].xyz; vec3 ab = pB - pA.xyz; float tt = clamp(dot(transformed - pA.xyz, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  vec3 cc = pA.xyz + ab * tt; vec3 dd = transformed - cc; float ll = length(dd); float RR = pA.w + 0.05;
  if (ll < RR) { transformed = cc + (ll > 1e-4 ? dd / ll : vec3(0.0, 0.0, 1.0)) * RR; }
  // занавесь раздвигается: ткань скользит по горизонтали от оси тела (радиус ~1 м), чтобы не закрывать обзор и не липнуть
  vec2 dxz = transformed.xz - cc.xz; float lxz = length(dxz); float RP = 1.05;
  if (lxz < RP && sw > 0.0 && transformed.y < pB.y + 0.9) { transformed.xz += (lxz > 1e-3 ? dxz / lxz : vec2(1.0, 0.0)) * (RP - lxz) * 0.92 * smoothstep(0.0, 0.45, sw); }
}` : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vGlow; varying vec3 vPar; varying vec3 vLP; varying vec3 vLN;
uniform float uGlowK; uniform float uBump; uniform float uTime; uniform float uAmbK;
${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${o.kind === 'stone' ? STONE_FRAG : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
${o.kind === 'stone' ? 'roughnessFactor = mix(clamp(0.96 - 0.12 * gr, 0.5, 1.0), 0.28, pol * pol * 0.9 + pol * 0.1);' : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
${o.kind === 'stone' ? 'normal = perturbMy(-vViewPosition, normal, vec2(dFdx(stoneH), dFdy(stoneH)) * (mode > 1.5 ? 0.35 : 0.9) * uBump * (1.0 - 0.7 * pol), faceDirection);' : ''}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= uAmbK;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vGlow * uGlowK;`);
    noSun(sh);
  };
  return mat;
}


// ------------------------------------------------------------------ скала (резаный песчаник пещеры) ----
const ROCK_FRAG = /* glsl */`
  vec3 rAn = abs(vLNr);
  vec3 tw = pow(rAn, vec3(5.0)); tw /= (tw.x + tw.y + tw.z);
  float floorW = smoothstep(0.5, 0.8, vLNr.y);
  float ceilW = smoothstep(0.5, 0.8, -vLNr.y);
  float wallW = 1.0 - floorW - ceilW;
  float tf0 = tw.x * vnoise(vLPr.zy * 0.33) + tw.y * vnoise(vLPr.xz * 0.33) + tw.z * vnoise(vLPr.xy * 0.33);
  float tf1 = tw.x * fbm2(vLPr.zy * 1.5) + tw.y * fbm2(vLPr.xz * 1.5) + tw.z * fbm2(vLPr.xy * 1.5);
  float tf2 = tw.x * vnoise(vLPr.zy * 6.0) + tw.y * vnoise(vLPr.xz * 6.0) + tw.z * vnoise(vLPr.xy * 6.0);
  // слои осадочной породы: волнистые полосы по высоте
  float sy = vLPr.y * 1.45 + (tf0 - 0.5) * 2.2 + 0.5 * vnoise(vLPr.xz * 0.09);
  float band = floor(sy), bf = fract(sy);
  float kb = h21(vec2(band, 3.1));
  vec3 pA = vec3(0.80, 0.64, 0.43), pB = vec3(0.66, 0.43, 0.25), pC = vec3(0.58, 0.47, 0.41), pD = vec3(0.38, 0.28, 0.21);
  vec3 bc = mix(mix(pA, pB, smoothstep(0.15, 0.4, kb)), mix(pC, pD, smoothstep(0.62, 0.9, kb)), smoothstep(0.5, 0.66, kb));
  float seam = smoothstep(0.0, 0.07, bf) * smoothstep(0.0, 0.12, 1.0 - bf);
  // следы инструмента: короткие наклонные штрихи по стенам
  vec2 suv = rAn.x > rAn.z ? vLPr.zy : vLPr.xy;
  vec2 ruv = vec2(suv.x * 0.8 + suv.y * 0.6, -suv.x * 0.6 + suv.y * 0.8);
  float tool = vnoise(vec2(ruv.x * 1.6, ruv.y * 13.0)) * 0.6 + vnoise(vec2(ruv.x * 4.0, ruv.y * 31.0)) * 0.4;
  float rockH = tf1 * 0.55 + tf2 * 0.25 + tool * 0.22 * (wallW + ceilW * 0.6) - (1.0 - seam) * 0.35 * wallW + kb * 0.1;
  vec3 rock = bc * (0.7 + 0.55 * tf1) * (0.82 + 0.36 * tf2) * mix(0.8, 1.0, seam);
  rock = mix(rock, vec3(0.6, 0.48, 0.34) * (0.8 + 0.3 * tf2), floorW * 0.5);
  float pol = clamp(vParR.y, 0.0, 1.0);
  float wetv = vParR.z;
  float sandv = vParR.w;
  // песок: рябь и светлый тон
  float rip = sin(vLPr.x * 5.5 + vLPr.z * 1.5 + tf1 * 8.0) * 0.5 + 0.5;
  vec3 sandC = vec3(0.78, 0.6, 0.38) * (0.82 + 0.3 * tf2) * (0.9 + 0.12 * rip);
  rock = mix(rock, sandC, smoothstep(0.05, 0.9, sandv));
  rockH = mix(rockH, rip * 0.55 + tf2 * 0.2, smoothstep(0.3, 1.0, sandv));
  // копоть, полировка ладонями, влага
  float sootN = 0.55 + 0.9 * (0.62 * vnoise(suv * 2.2 + 11.0) + 0.38 * vnoise(suv * 4.5 + 3.0));
  rock *= 1.0 - clamp(vParR.x * sootN, 0.0, 1.0) * 0.74;
  rock *= mix(vec3(1.0), vec3(1.14, 1.02, 0.88), pol);
  rock *= mix(vec3(1.0), vec3(0.5, 0.56, 0.6), wetv);
  vec3 rockCol = rock;
  #ifdef ROCK_TEX
    vec3 tcW = tw.x * texture2D(uWallMap, vLPr.zy * uWallS).rgb + tw.y * texture2D(uWallMap, vLPr.xz * uWallS).rgb + tw.z * texture2D(uWallMap, vLPr.xy * uWallS).rgb;
    vec3 tcF = tw.x * texture2D(uFloorMap, vLPr.zy * uFloorS).rgb + tw.y * texture2D(uFloorMap, vLPr.xz * uFloorS).rgb + tw.z * texture2D(uFloorMap, vLPr.xy * uFloorS).rgb;
    vec3 tcol = mix(tcW, tcF, floorW);
    float tl = dot(tcol, vec3(0.333)) + 1e-3;
    // фактура даёт мелкую деталь, слои/копоть/влага — крупный цвет
    rockCol = mix(rock, rock * (tcol / tl) * 1.0 * (0.6 + 0.8 * tl), 0.85);
  #endif
  diffuseColor.rgb = rockCol * vTintR.rgb * 1.992;
`;

function patchRock(mat, ROCK_U, hasTex) {
  mat.customProgramCacheKey = () => `siet-rock-${hasTex ? 1 : 0}`;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: U.uTime, uGlowK: U.uGlowK, uBump: U.uBump, uAmbK: U.uAmbK }, ROCK_U);
    if (hasTex) sh.defines = { ...(sh.defines || {}), ROCK_TEX: '' };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aTint; attribute vec4 aPar; attribute vec4 aGlow;
varying vec4 vTintR; varying vec4 vParR; varying vec3 vGlowR; varying vec3 vLPr; varying vec3 vLNr;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vTintR = aTint; vParR = aPar; vGlowR = aGlow.rgb * aGlow.rgb * 4.0; vLPr = position; vLNr = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vTintR; varying vec4 vParR; varying vec3 vGlowR; varying vec3 vLPr; varying vec3 vLNr;
uniform float uGlowK; uniform float uBump; uniform float uTime; uniform float uAmbK; uniform mat3 normalMatrix;
uniform sampler2D uWallMap; uniform sampler2D uFloorMap; uniform sampler2D uWallN; uniform sampler2D uFloorN; uniform float uWallS; uniform float uFloorS;
${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${ROCK_FRAG}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(0.94 - pol * 0.5 - wetv * 0.5 - sandv * 0.05, 0.18, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = perturbMy(-vViewPosition, normal, vec2(dFdx(rockH), dFdy(rockH)) * (0.9 + 0.5 * wallW) * uBump * (1.0 - 0.65 * pol), faceDirection);
#ifdef ROCK_TEX
  if (length(vViewPosition) < 26.0) { vec3 nx = texture2D(uWallN, vLPr.zy * uWallS).xyz * 2.0 - 1.0, ny = texture2D(uWallN, vLPr.xz * uWallS).xyz * 2.0 - 1.0, nz = texture2D(uWallN, vLPr.xy * uWallS).xyz * 2.0 - 1.0;
    vec3 fx = texture2D(uFloorN, vLPr.zy * uFloorS).xyz * 2.0 - 1.0, fy = texture2D(uFloorN, vLPr.xz * uFloorS).xyz * 2.0 - 1.0, fz = texture2D(uFloorN, vLPr.xy * uFloorS).xyz * 2.0 - 1.0;
    nx = mix(nx, fx, floorW); ny = mix(ny, fy, floorW); nz = mix(nz, fz, floorW);
    vec3 sn = normalize(vLNr);
    nx = vec3(nx.xy + sn.zy, abs(nx.z) * sn.x); ny = vec3(ny.xy + sn.xz, abs(ny.z) * sn.y); nz = vec3(nz.xy + sn.xy, abs(nz.z) * sn.z);
    vec3 nW = normalize(nx.zyx * tw.x + ny.xzy * tw.y + nz.xyz * tw.z);
    normal = normalize(mix(normal, normalize(normalMatrix * nW), 0.55 * (1.0 - sandv)));
  }
#endif`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{ float aoR = vTintR.a; reflectedLight.indirectDiffuse *= uAmbK * aoR * aoR; reflectedLight.directDiffuse *= mix(1.0, aoR, 0.55); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vGlowR * uGlowK * mix(1.0, vTintR.a, 0.5);`);
    noSun(sh);
  };
  return mat;
}

export function makeRock() {
  const wall = getTex('rock_cave'), floor = getTex('cave_floor') || wall;
  const hasTex = !!(wall && wall.map);
  const dummy = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1); dummy.needsUpdate = true;
  const ROCK_U = {
    uWallMap: { value: wall?.map || dummy }, uFloorMap: { value: floor?.map || dummy },
    uWallN: { value: wall?.normalMap || dummy }, uFloorN: { value: floor?.normalMap || dummy },
    uWallS: { value: 1 / (wall?.meters || 2) }, uFloorS: { value: 1 / (floor?.meters || 2) },
  };
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.94, metalness: 0 });
  return patchRock(m, ROCK_U, hasTex);
}

export function makeMaterials() {
  const T = makeTextures();
  const M = {};
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...o });
  M.rock = makeRock();
  M.stone = patch(std({ color: '#a8977c' }), { kind: 'stone' });
  M.metal = patch(std({ color: '#6a5a48', metalness: 0.85, roughness: 0.48 }));
  M.brass = patch(std({ color: '#c8a050', metalness: 0.9, roughness: 0.32 }));
  M.clay = patch(std({ color: '#9a6a48', roughness: 0.82 }));
  M.wood = patch(std({ color: '#7a5c3c', roughness: 0.88 }));
  M.cloth = patch(std({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide }), { sway: true });
  M.clothStatic = patch(std({ color: '#ffffff', roughness: 1, side: THREE.DoubleSide }));
  M.sand = patch(std({ color: '#c49a62', roughness: 1 }), { kind: 'stone' });
  for (const [name, t] of Object.entries(T.cloth)) {
    M[`cloth:${name}`] = patch(std({ map: t, color: '#ffffff', roughness: 1, side: THREE.DoubleSide }), { sway: true });
    M[`carpet:${name}`] = patch(std({ map: t, color: '#ffffff', roughness: 1, side: THREE.DoubleSide }));
  }
  for (const name of ['carving', 'carvingB', 'sigil', 'mural', 'chalk', 'embroidery', 'hands', 'tally']) {
    const d = T[name];
    M[`decal:${name}`] = patch(new THREE.MeshStandardMaterial({
      map: d.map, bumpMap: d.bump, bumpScale: name === 'mural' ? 0.4 : 2.2, transparent: true, vertexColors: true, roughness: name === 'mural' ? 0.8 : 0.55,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
  }
  M.textures = T;
  return M;
}
