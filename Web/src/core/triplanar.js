// Трипланарные (мировые) и «детальные» (UV) текстуры для MeshStandardMaterial — общий помощник реализма.
// Использует библиотеку core/textures.js (getTex). Если текстуры нет — ничего не делает и возвращает null (останется процедурный вид).
//
// ПРИМЕНЕНИЕ (любой модуль):
//   import { applyTriplanar, applyDetail } from '../core/triplanar.js';
//   // 1) мировая проекция (скалы, стены, неровная геометрия без нормальных UV): 3 проекции, whiteout-смешивание нормалей
//   const h = applyTriplanar(material, 'rock_cave', { scale: 2.5, sharpness: 4, tint: 0xffffff, quality: game.settings.quality });
//   // 2) «детальный» режим для UV-мешей (одежда, оборудование): UV × repeat, нормаль через производные
//   applyDetail(material, 'fabric_woven', { repeat: [6, 6], normal: 0.8 });
//
// Опции (все необязательны):
//   scale      — метров на тайл (по умолчанию getTex(name).meters); число или [x] — одинаково по осям
//   sharpness  — резкость смешения проекций (степень |n|, 4 — мягко, 8 — резко), по умолчанию 4
//   tint       — THREE.Color/hex, множитель цвета (для mode 'replace')
//   mode       — 'modulate' (по умолчанию): цвет материала × (текстура / её среднее) — сохраняет палитру, добавляет детали;
//                'replace': цвет = текстура × tint (смешивается по albedo)
//   chroma     — 0..1: доля цветовой (а не только яркостной) модуляции в mode 'modulate' (по умолчанию 1)
//   albedo     — 0..1 сила влияния цвета текстуры (по умолчанию 1)
//   normal     — сила нормали (0 — выкл.; по умолчанию 1)
//   rough      — 0..1 доля карты шероховатости (0 — оставить roughness материала); по умолчанию 1
//   ao         — 0..1 сила AO-карты (если есть), по умолчанию 0.7
//   macro      — { amount, scale } низкочастотная вариация яркости в мировых координатах (амплитуда ±amount/2, период scale м)
//   antiTile   — true (по умолчанию, кроме quality 'low'): два масштаба/поворота, смешанные по шуму — нет видимого повтора
//   axes       — 'xyz' (по умолчанию) | 'y' (только сверху — для земли; в 3 раза дешевле)
//   quality    — 'low'|'med'|'high': low выключает antiTile/rough/ao и AO-карту
//   key        — доп. ключ кеша программы
// Возвращает дескриптор {uniforms, setScale(m), setNormal(k), setTint(c)} (также material.userData.triplanar) — параметры живые.
//
// Для патчей с собственным шейдером (desert/terrain, desert/rockMaterial):
//   const t = triplanarKit('tpA', name, opts);  // { uniforms, pars }  → вставить pars во фрагментный шейдер, uniforms — в shader.uniforms
//   в GLSL: tpAEval(worldPos, worldNormal);  → глобальные tpAAlb (цвет), tpAAvg (среднее), tpAMul (множитель модуляции), tpANW (мировая нормаль), tpARgh, tpAAo.
import * as THREE from 'three';
import { getTex } from './textures.js';

const NOISE = (P) => /* glsl */`
float ${P}h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ${P}n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(${P}h(i), ${P}h(i + vec2(1.0, 0.0)), f.x), mix(${P}h(i + vec2(0.0, 1.0)), ${P}h(i + vec2(1.0, 1.0)), f.x), f.y); }
`;

/** Строит GLSL-библиотеку (uniforms + функции) и объект uniform'ов для набора текстур. */
export function triplanarKit(P, texName, o = {}) {
  const T = getTex(texName);
  if (!T || !T.map) return null;
  const low = o.quality === 'low';
  const hasN = !!T.normalMap && (o.normal ?? 1) > 0;
  const hasR = !!T.roughnessMap && !low && (o.rough ?? 1) > 0;
  const hasO = !!T.aoMap && !low && (o.ao ?? 0.7) > 0;
  const anti = (o.antiTile ?? !low) !== false;
  const yOnly = o.axes === 'y';
  const uvMode = !!o.uv;
  const meters = Array.isArray(o.scale) ? o.scale[0] : (o.scale ?? T.meters ?? 2);
  const tint = new THREE.Color(o.tint ?? 0xffffff);
  const u = {
    [P + 'Map']: { value: T.map },
    [P + 'A']: { value: new THREE.Vector4(1 / meters, o.sharpness ?? 4, o.normal ?? 1, 0.63) },
    [P + 'B']: { value: new THREE.Vector4(o.albedo ?? 1, o.rough ?? 1, o.ao ?? 0.7, o.macro?.amount ?? 0) },
    [P + 'Tint']: { value: tint },
    [P + 'Chroma']: { value: o.chroma ?? 1 },
    [P + 'MacroInv']: { value: 1 / (o.macro?.scale ?? 20) },
    [P + 'Rep']: { value: new THREE.Vector2(...(Array.isArray(o.repeat) ? o.repeat : [o.repeat ?? 1, o.repeat ?? 1])) },
  };
  if (hasN) u[P + 'Nor'] = { value: T.normalMap };
  if (hasR) u[P + 'RghT'] = { value: T.roughnessMap };
  if (hasO) u[P + 'AoT'] = { value: T.aoMap };
  const uniforms = {};
  for (const k in u) uniforms[k] = u[k];

  // 1 проекция: сэмплы с градиентами (textureGrad — безопасно внутри ветвлений), antiTile: 2-й тап в повёрнутой/смасштабированной UV
  const sampler = (tex, name, srgbRaw) => /* glsl */`
vec4 ${P}s${name}(vec2 uv, vec2 gx, vec2 gy, float wB, float sd){
  vec4 a = textureGrad(${tex}, uv, gx, gy);
  ${anti ? `if (wB > 0.002) {
    mat2 R = mat2(0.8, 0.6, -0.6, 0.8) * ${P}A.w;
    vec4 b = textureGrad(${tex}, R * uv + vec2(0.37 + sd, 0.61 - sd * 0.7), R * gx, R * gy);
    a = mix(a, b, wB);
  }` : ''}
  return a;
}`;
  const proj = /* glsl */`
// одна проекция: накапливает цвет/шероховатость/AO с весом w, возвращает тангенс-нормаль (без веса)
vec3 ${P}proj(vec2 uv, vec2 gx, vec2 gy, float sd, float w, inout vec3 alb, inout float rg, inout float oc){
  float wB = ${anti ? `smoothstep(0.32, 0.68, ${P}n(uv * 0.21 + sd * 7.0))` : '0.0'};
  alb += w * ${P}sMap(uv, gx, gy, wB, sd).rgb;
  ${hasR ? `rg += w * ${P}sRghT(uv, gx, gy, wB, sd).r;` : ''}
  ${hasO ? `oc += w * ${P}sAoT(uv, gx, gy, wB, sd).r;` : ''}
  ${hasN ? `vec3 tn = ${P}sNor(uv, gx, gy, wB, sd).xyz * 2.0 - 1.0; tn.xy *= ${P}A.z; return vec3(tn.xy, max(tn.z, 0.05));` : 'return vec3(0.0, 0.0, 1.0);'}
}`;
  const common = `
vec3 ${P}Alb; vec3 ${P}Avg; vec3 ${P}Mul; vec3 ${P}NW; float ${P}Rgh; float ${P}Ao;
void ${P}post(vec3 wp){
  ${P}Avg = textureLod(${P}Map, vec2(0.5), 10.0).rgb + 1e-3;
  ${P}Alb = max(${P}Alb, vec3(0.0));
  ${P}Ao = mix(1.0, ${P}Ao, ${P}B.z);
  float mn = ${P}n(wp.xz * ${P}MacroInv + wp.y * ${P}MacroInv * vec2(0.37, 0.61)) * 0.65 + ${P}n(wp.xz * ${P}MacroInv * 3.1 + 5.0) * 0.35;
  float mv = 1.0 + ${P}B.w * (mn - 0.5);
  ${P}Alb *= mv;
  float lr = dot(${P}Alb, vec3(0.2126, 0.7152, 0.0722)) / dot(${P}Avg, vec3(0.2126, 0.7152, 0.0722));
  ${P}Mul = clamp(mix(vec3(lr), ${P}Alb / ${P}Avg, ${P}Chroma), 0.0, 3.0);
}`;
  const evalWorld = yOnly ? /* glsl */`
void ${P}Eval(vec3 wp, vec3 wn){
  vec2 uv = wp.xz * ${P}A.x;
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  vec3 alb = vec3(0.0); float rg = 0.0, oc = 0.0;
  vec3 tn = ${P}proj(uv, gx, gy, 0.0, 1.0, alb, rg, oc);
  tn.x *= sign(wn.y + 1e-5);
  ${P}Alb = alb; ${P}Rgh = ${hasR ? 'rg' : '1.0'}; ${P}Ao = ${hasO ? 'oc' : '1.0'};
  vec3 t = vec3(tn.xy + wn.xz, abs(tn.z) * wn.y);
  ${P}NW = normalize(t.xzy);
  ${P}post(wp);
}` : /* glsl */`
void ${P}Eval(vec3 wp, vec3 wn){
  vec3 aw = pow(abs(wn), vec3(${P}A.y));
  vec3 bw = aw / (aw.x + aw.y + aw.z + 1e-5);
  bw = max(bw - 0.04, 0.0); bw /= (bw.x + bw.y + bw.z + 1e-5);
  vec3 sg = sign(wn + 1e-5);
  vec3 dx = dFdx(wp), dy = dFdy(wp);
  vec3 alb = vec3(0.0); float rg = 0.0, oc = 0.0;
  vec3 nacc = vec3(0.0);
  float s = ${P}A.x;
  if (bw.y > 0.0) {
    vec2 uv = wp.xz * s;
    vec3 tn = ${P}proj(uv, dx.xz * s, dy.xz * s, 0.0, bw.y, alb, rg, oc);
    tn.x *= sg.y;
    vec3 t = vec3(tn.xy + wn.xz, abs(tn.z) * wn.y);
    nacc += t.xzy * bw.y;
  }
  if (bw.x > 0.0) {
    vec2 uv = wp.zy * s;
    vec3 tn = ${P}proj(uv, dx.zy * s, dy.zy * s, 0.31, bw.x, alb, rg, oc);
    tn.x *= sg.x;
    vec3 t = vec3(tn.xy + wn.zy, abs(tn.z) * wn.x);
    nacc += t.zyx * bw.x;
  }
  if (bw.z > 0.0) {
    vec2 uv = wp.xy * s;
    vec3 tn = ${P}proj(uv, dx.xy * s, dy.xy * s, 0.67, bw.z, alb, rg, oc);
    tn.x *= -sg.z;
    vec3 t = vec3(tn.xy + wn.xy, abs(tn.z) * wn.z);
    nacc += t.xyz * bw.z;
  }
  ${P}Alb = alb; ${P}Rgh = ${hasR ? 'rg' : '1.0'}; ${P}Ao = ${hasO ? 'oc' : '1.0'};
  ${P}NW = normalize(nacc + 1e-5 * wn);
  ${P}post(wp);
}`;
  const evalUV = /* glsl */`
void ${P}EvalUV(vec2 uv0, vec3 wp, vec3 wn){
  vec2 uv = uv0 * ${P}Rep;
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  vec3 alb = vec3(0.0); float rg = 0.0, oc = 0.0;
  vec3 tn = ${P}proj(uv, gx, gy, 0.0, 1.0, alb, rg, oc);
  ${P}Alb = alb; ${P}Rgh = ${hasR ? 'rg' : '1.0'}; ${P}Ao = ${hasO ? 'oc' : '1.0'};
  // кокасательный базис из производных (мировое пространство)
  vec3 dp1 = dFdx(wp), dp2 = dFdy(wp);
  vec2 du1 = dFdx(uv0), du2 = dFdy(uv0);
  vec3 dp2perp = cross(dp2, wn), dp1perp = cross(wn, dp1);
  vec3 T = dp2perp * du1.x + dp1perp * du2.x;
  vec3 B = dp2perp * du1.y + dp1perp * du2.y;
  float inv = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-12);
  ${P}NW = normalize(T * (tn.x * inv) + B * (tn.y * inv) * 1.0 + wn * tn.z);
  ${P}post(wp);
}`;
  const pars = /* glsl */`
uniform sampler2D ${P}Map; ${hasN ? `uniform sampler2D ${P}Nor;` : ''} ${hasR ? `uniform sampler2D ${P}RghT;` : ''} ${hasO ? `uniform sampler2D ${P}AoT;` : ''}
uniform vec4 ${P}A; uniform vec4 ${P}B; uniform vec3 ${P}Tint; uniform float ${P}MacroInv; uniform vec2 ${P}Rep; uniform float ${P}Chroma;
${NOISE(P)}
${sampler(P + 'Map', 'Map')}
${hasN ? sampler(P + 'Nor', 'Nor') : ''}
${hasR ? sampler(P + 'RghT', 'RghT') : ''}
${hasO ? sampler(P + 'AoT', 'AoT') : ''}
${proj}
${common}
${uvMode ? evalUV : evalWorld}
`;
  const kit = {
    uniforms, pars, hasN, hasR, hasO, tex: T, name: texName,
    key: `${P}|${texName}|${+hasN}${+hasR}${+hasO}${+anti}${+yOnly}${+uvMode}`,
    setScale(m) { u[P + 'A'].value.x = 1 / m; },
    setNormal(k) { u[P + 'A'].value.z = k; },
    setTint(c) { tint.set(c); },
    setAlbedo(a) { u[P + 'B'].value.x = a; },
  };
  return kit;
}

let uid = 0;

function chainCompile(material, fn, key) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    fn(shader);
  };
  material.customProgramCacheKey = () => prevKey + '|' + key;
  material.needsUpdate = true;
}

function installTriplanar(material, texName, o, uvMode) {
  const P = 'tp' + (uid++).toString(36);
  const kit = triplanarKit(P, texName, { ...o, uv: uvMode });
  if (!kit) return null;
  const mode = o.mode ?? 'modulate';
  material.userData.triplanar = kit;
  chainCompile(material, (shader) => {
    Object.assign(shader.uniforms, kit.uniforms);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', `#include <common>
varying vec3 vTpWP; varying vec3 vTpWN; ${uvMode ? 'varying vec2 vTpUv;' : ''}`);
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 tpW = vec4(transformed, 1.0); vec3 tpN = objectNormal;
  #ifdef USE_INSTANCING
  tpW = instanceMatrix * tpW; tpN = mat3(instanceMatrix) * tpN;
  #endif
  vTpWP = (modelMatrix * tpW).xyz; vTpWN = normalize(mat3(modelMatrix) * tpN);
  ${uvMode ? 'vTpUv = uv;' : ''}
}`);
    fs = fs.replace('#include <common>', `#include <common>
varying vec3 vTpWP; varying vec3 vTpWN; ${uvMode ? 'varying vec2 vTpUv;' : ''}
${kit.pars}`);
    const albedo = mode === 'replace'
      ? `diffuseColor.rgb = mix(diffuseColor.rgb, ${P}Alb * ${P}Tint, ${P}B.x);`
      : `diffuseColor.rgb *= mix(vec3(1.0), ${P}Mul, ${P}B.x) * ${P}Tint;`;
    fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 tpWN = normalize(vTpWN);
  ${uvMode ? `${P}EvalUV(vTpUv, vTpWP, tpWN);` : `${P}Eval(vTpWP, tpWN);`}
  ${albedo}
}`);
    if (kit.hasR) fs = fs.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, clamp(roughnessFactor * (0.35 + ${P}Rgh * 1.0), 0.04, 1.0), ${P}B.y);`);
    if (kit.hasN) fs = fs.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize((viewMatrix * vec4(${P}NW, 0.0)).xyz);`);
    if (kit.hasO) fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
reflectedLight.indirectDiffuse *= ${P}Ao; reflectedLight.indirectSpecular *= mix(1.0, ${P}Ao, 0.6);
reflectedLight.directDiffuse *= mix(1.0, ${P}Ao, 0.35);`);
    shader.vertexShader = vs; shader.fragmentShader = fs;
  }, kit.key + '|' + mode);
  return kit;
}

/** Трипланарная (мировая) проекция текстурного набора на материал. */
export function applyTriplanar(material, texName, opts = {}) {
  return installTriplanar(material, texName, opts, false);
}
/** Детальный режим для UV-мешей: UV × repeat, нормаль через производные. */
export function applyDetail(material, texName, opts = {}) {
  return installTriplanar(material, texName, opts, true);
}
