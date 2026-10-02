// Материалы сиетча: «отполированный ладонями камень» (процедурный шейдер поверх MeshStandardMaterial),
// ткани с раскачкой, металл, глина, дерево-волокно, декали трёх слоёв истории. Запечённый свет — атрибут aGlow.
import * as THREE from 'three';
import { makeTextures } from './textures.js';

export const U = { uTime: { value: 0 }, uGlowK: { value: 1.0 }, uBump: { value: 1.0 }, uAmbK: { value: 0.3 } };

const NOISE = /* glsl */`
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm3(vec2 p){ float a=.5,s=0.; for(int i=0;i<3;i++){ s+=a*vnoise(p); p=p*2.03+17.; a*=.5;} return s; }
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
    sh.uniforms.uTime = U.uTime; sh.uniforms.uGlowK = U.uGlowK; sh.uniforms.uBump = U.uBump; sh.uniforms.uAmbK = U.uAmbK;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aGlow; attribute vec3 aPar;
varying vec3 vGlow; varying vec3 vPar; varying vec3 vLP; varying vec3 vLN;
uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = aGlow; vPar = aPar; vLP = position; vLN = normal;
${o.sway ? `float sw = aPar.z;
transformed.x += (sin(uTime*1.25 + position.y*1.7 + position.x*0.9) + 0.4*sin(uTime*2.3+position.z*2.0)) * 0.045 * sw;
transformed.z += (sin(uTime*1.05 + position.y*1.3 + position.z*0.8) + 0.4*sin(uTime*1.9+position.x*2.0)) * 0.045 * sw;` : ''}`);
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
  };
  return mat;
}

export function makeMaterials() {
  const T = makeTextures();
  const M = {};
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...o });
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
  for (const name of ['carving', 'carvingB', 'sigil', 'mural', 'chalk', 'embroidery']) {
    const d = T[name];
    M[`decal:${name}`] = patch(new THREE.MeshStandardMaterial({
      map: d.map, bumpMap: d.bump, bumpScale: name === 'mural' ? 0.4 : 2.2, transparent: true, vertexColors: true, roughness: name === 'mural' ? 0.8 : 0.55,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
  }
  M.textures = T;
  return M;
}
