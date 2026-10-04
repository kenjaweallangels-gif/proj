// Групповой LOD фигур: все «дальние» люди сцены — ОДИН draw call (THREE.BatchedMesh) вместо болванок-импостеров.
//
// Геометрия — те же процедурные LOD1/LOD2 тела и одежды (char_geometry.js), слитые в один неанимированный меш на вариант силуэта
// (figureFarVariant: построение, роба, капюшон, причёска, борода). Силуэт, одежда, капюшон/маска, пояс и цвета совпадают с полной фигурой.
// Палитра каждого человека — в float-текстуре (по строке на экземпляр), раскраска по регионам идёт в вершинном шейдере.
// Анимация не замирает: ход (качание ног/рук, подол, подпрыгивание) считается в вершинном шейдере по весам костей (атрибут gait) и фазе,
// покой — лёгкое дыхание/покачивание. Переход «скин-фигура ↔ группа» — дизер-растворение (то же правило, что uFade в char_material.js).
//
//   const crowd = createFigureCrowd({ parent, maxInstances });
//   const h = crowd.register(fig);                // по фигуре (makeFigure) — берёт палитру и вариант силуэта
//   crowd.setMatrix(h, matrix4); crowd.setWalk(h, 0..1); crowd.setGlow(h, r, g, b); crowd.setFade(h, 0..1)  // 0 — скрыт, 1 — виден
//   crowd.update(dt, t)                           // фаза шага, догрузка геометрий, обновление текстуры
import * as THREE from 'three';
import { BI } from '../player/char_geometry.js';
import { hasGeometry, geometryFor, triCount } from '../player/char_geometry.js';
import { figureFarVariant, enqueueFigureBuild, pumpFigureBuilds } from './figures.js';

const TEX_W = 8;
const GAIT = {
  legL: [BI.hipL, BI.knL, BI.footL, BI.toeL], legR: [BI.hipR, BI.knR, BI.footR, BI.toeR],
  armL: [BI.shL, BI.elL, BI.handL], armR: [BI.shR, BI.elR, BI.handR],
};

/** Слить тело и ткань варианта в один геометрию без скининга; веса костей → атрибут gait (ногаЛ, ногаП, рукаЛ, рукаП). */
function mergeFar(e) {
  const gs = [e.body, e.cloth];
  let nv = 0, ni = 0;
  for (const g of gs) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), reg = new Float32Array(nv), aux = new Float32Array(nv * 4), gait = new Float32Array(nv * 4);
  const idx = new Uint32Array(ni);
  let vo = 0, io = 0;
  const isIn = (set, i) => set.indexOf(i) >= 0;
  for (const g of gs) {
    const A = g.attributes, n = A.position.count;
    pos.set(A.position.array, vo * 3); nrm.set(A.normal.array, vo * 3); reg.set(A.region.array, vo); aux.set(A.aux.array, vo * 4);
    const si = A.skinIndex.array, sw = A.skinWeight.array;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 2; k++) {
        const b = si[i * 4 + k], w = sw[i * 4 + k];
        if (w <= 0) continue;
        if (isIn(GAIT.legL, b)) gait[(vo + i) * 4] += w; else if (isIn(GAIT.legR, b)) gait[(vo + i) * 4 + 1] += w;
        else if (isIn(GAIT.armL, b)) gait[(vo + i) * 4 + 2] += w; else if (isIn(GAIT.armR, b)) gait[(vo + i) * 4 + 3] += w;
      }
    }
    for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
    vo += n; io += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('region', new THREE.BufferAttribute(reg, 1)); out.setAttribute('aux', new THREE.BufferAttribute(aux, 4)); out.setAttribute('gait', new THREE.BufferAttribute(gait, 4));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.2);
  out.boundingBox = new THREE.Box3(new THREE.Vector3(-0.7, -0.05, -0.7), new THREE.Vector3(0.7, 2.0, 0.7));
  return out;
}

const VERT_PARS = /* glsl */`
attribute float region;
attribute vec4 aux;
attribute vec4 gait;
uniform sampler2D uCrowd;
uniform float uCTime;
varying vec3 vCol;
varying vec3 vPosB;
varying vec4 vAuxB;
varying float vRegB;
varying float vWearB;
varying float vDustB;
varying float vFadeB;
varying vec3 vGlowB;
vec3 rotXb(vec3 p, vec3 c, float a){ vec3 d = p - c; float cs = cos(a), sn = sin(a); return c + vec3(d.x, d.y * cs - d.z * sn, d.y * sn + d.z * cs); }
`;
const VERT_MAIN = /* glsl */`
#include <begin_vertex>
{
  int bid = int(getIndirectIndex(gl_DrawID));
  vec4 t0 = texelFetch(uCrowd, ivec2(0, bid), 0), t1 = texelFetch(uCrowd, ivec2(1, bid), 0), t2 = texelFetch(uCrowd, ivec2(2, bid), 0), t3 = texelFetch(uCrowd, ivec2(3, bid), 0);
  vec4 t4 = texelFetch(uCrowd, ivec2(4, bid), 0), t5 = texelFetch(uCrowd, ivec2(5, bid), 0), t6 = texelFetch(uCrowd, ivec2(6, bid), 0), t7 = texelFetch(uCrowd, ivec2(7, bid), 0);
  int rg = int(region + 0.5);
  vec3 c = t0.rgb;
  if (rg == 0) c = t3.rgb;
  else if (rg == 1 || rg == 9) c = t4.rgb;
  else if (rg == 3) c = t2.rgb * 0.8;
  else if (rg == 4) c = t6.rgb;
  else if (rg == 10) c = t6.rgb * 0.45;
  else if (rg == 5) c = vec3(0.12);
  else if (rg == 6) c = t5.rgb;
  else if (rg == 7) c = mix(vec3(0.62), vec3(0.1, 0.2, 0.7), t6.a);
  else if (rg == 8) c = vec3(0.04);
  else if (rg == 12 || rg == 15) c = t1.rgb;
  else if (rg == 11) c = t1.rgb * 0.8;
  else if (rg == 13) c = vec3(0.6);
  else if (rg == 14) c = vec3(0.03);
  else if (rg == 16) c = vec3(0.05);
  vCol = c; vRegB = region; vAuxB = aux; vWearB = t0.a; vDustB = t1.a; vFadeB = t4.a; vGlowB = t7.rgb; vPosB = position;
  float ph = t2.a, g = t3.a;
  vec3 p = transformed;
  float sw = sin(ph) * 0.5 * g;
  // ноги и руки качаются вокруг бедра/плеча (веса — по костям скелета)
  p = rotXb(p, vec3(-0.09, 0.92, 0.0), -sw * gait.x);
  p = rotXb(p, vec3(0.09, 0.92, 0.0), sw * gait.y);
  p = rotXb(p, vec3(-0.185, 1.43, 0.0), sw * 0.85 * gait.z);
  p = rotXb(p, vec3(0.185, 1.43, 0.0), -sw * 0.85 * gait.w);
  // подол/плащ ниже таза расходится в такт шагу
  if ((rg == 2 || rg == 12 || rg == 15 || rg == 11) && position.y < 0.95) {
    float hw = smoothstep(0.95, 0.35, position.y), k = clamp(-position.x / 0.12, -1.0, 1.0);
    p = rotXb(p, vec3(0.0, 0.92, 0.0), -sw * k * 0.55 * hw);
  }
  p.y += abs(sin(ph)) * 0.022 * g;
  // покой: дыхание и лёгкое покачивание
  float idle = 1.0 - g;
  p.x += sin(uCTime * 0.7 + t2.a * 1.7) * 0.006 * clamp(position.y, 0.0, 1.6) * idle;
  p.y *= 1.0 + sin(uCTime * 1.6 + t2.a) * 0.0035 * smoothstep(1.0, 1.4, position.y) * idle;
  transformed = p;
}
`;
const FRAG_PARS = /* glsl */`
varying vec3 vCol;
varying vec3 vPosB;
varying vec4 vAuxB;
varying float vRegB;
varying float vWearB;
varying float vDustB;
varying float vFadeB;
varying vec3 vGlowB;
float hsh(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hsh(i), hsh(i + vec3(1,0,0)), f.x), mix(hsh(i + vec3(0,1,0)), hsh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hsh(i + vec3(0,0,1)), hsh(i + vec3(1,0,1)), f.x), mix(hsh(i + vec3(0,1,1)), hsh(i + vec3(1,1,1)), f.x), f.y), f.z) * 2.0 - 1.0; }
`;
const FRAG_COLOR = /* glsl */`
if (vFadeB < 1.0) {
  float ig = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (vFadeB > 0.0 ? ig >= vFadeB : ig < -vFadeB) discard;
}
#include <color_fragment>
{
  int rg = int(vRegB + 0.5);
  vec3 base = vCol;
  float nz = vn(vPosB * 13.0), nz2 = vn(vPosB * 47.0);
  float dk = 0.0;
  if (rg == 2 || rg == 12 || rg == 15 || rg == 11) {
    base *= 1.0 + 0.1 * nz + 0.07 * nz2;
    float fold = clamp(vAuxB.z, 0.0, 1.0);
    base *= mix(0.3, 1.0, pow(fold, 1.3)) * (1.0 - 0.12 * vAuxB.x) * 0.56; // подгонка под яркость полной фигуры (плетение, бамп, физический материал)
    if (!gl_FrontFacing) base *= 0.8;
    float hem = 1.0 - smoothstep(0.05, 0.75, vPosB.y);
    base = mix(base, base * vec3(0.7, 0.6, 0.47) + vec3(0.05, 0.04, 0.025), hem * 0.55 * vDustB);
    float shoulder = smoothstep(1.2, 1.45, vPosB.y), lum = dot(base, vec3(0.3, 0.59, 0.11));
    base = mix(base, vec3(lum) * 1.18 + vec3(0.04, 0.03, 0.02), shoulder * 0.28 * vWearB);
    float mx = max(base.r, max(base.g, base.b)); if (mx > 0.6) base *= 0.6 / mx * 0.35 + 0.65;
    base = min(base, vec3(0.62));
    dk = clamp((0.1 + vAuxB.x * 0.65 + vWearB * 0.1) * 0.9, 0.0, 1.0) * vDustB;
  } else if (rg == 0) {
    base *= 1.0 + (nz * 0.22 + nz2 * 0.1) * (0.4 + vWearB); base *= 0.92; dk = (vAuxB.z + 0.1) * 0.5 * vDustB;
  } else if (rg == 1 || rg == 9) {
    base *= 0.94 + 0.08 * nz2 + 0.06 * nz; dk = 0.05 * vDustB;
  } else if (rg == 6) {
    base *= 0.85 + 0.2 * nz2;
  } else if (rg == 4 || rg == 3) {
    base *= 0.9 + 0.2 * nz; dk = 0.1 * vDustB;
  }
  base = mix(base, vec3(0.5, 0.4, 0.29) * (0.85 + 0.2 * nz2), dk * 0.5);
  diffuseColor.rgb = base;
}
`;

function patchMat(mat, tex, uTime) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCrowd = { value: tex }; sh.uniforms.uCTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <begin_vertex>', VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', FRAG_COLOR)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlowB;');
  };
  mat.customProgramCacheKey = () => 'rk-fig-crowd-1';
}

export function createFigureCrowd({ parent, maxInstances = 128, maxVertices = 320000, maxIndices = 1300000 } = {}) {
  const tex = new THREE.DataTexture(new Float32Array(TEX_W * maxInstances * 4), TEX_W, maxInstances, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  const D = tex.image.data;
  const uTime = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  patchMat(mat, tex, uTime);
  const mesh = new THREE.BatchedMesh(maxInstances, maxVertices, maxIndices, mat);
  mesh.frustumCulled = false; mesh.perObjectFrustumCulled = true; mesh.sortObjects = true; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.name = 'FigureCrowdBatch';
  parent?.add(mesh);
  const variants = new Map(); // key → { o, geo: [gidMid, gidFar] | null, ready }
  const items = [];
  const out = { mesh, items, stats: { instances: 0, variants: 0, tris: [0, 0] }, variants };
  const col = new THREE.Color();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const put = (i, k, r, g, b, a) => { const o = (i * TEX_W + k) * 4; D[o] = r; D[o + 1] = g; D[o + 2] = b; D[o + 3] = a; };
  const putCol = (i, k, hex, a = 0) => { col.set(hex); put(i, k, col.r, col.g, col.b, a); };
  let dirty = true;

  function ensureVariant(src) {
    const v = figureFarVariant(src);
    let e = variants.get(v.key);
    if (!e) { e = { o: v.o, key: v.key, gid: [-1, -1], tris: [0, 0], failed: false }; variants.set(v.key, e); out.stats.variants = variants.size; }
    return e;
  }
  /** Загрузить геометрию варианта: дальний LOD2 — сразу (нужен всем), средний LOD1 — по требованию (lod1:true), собирается фоновой очередью. */
  function tryUpload(e, lod1 = false) {
    if (e.failed) return false;
    for (const l of lod1 ? [1] : [2]) {
      if (e.gid[l - 1] >= 0) continue;
      if (!hasGeometry(e.key, l)) { enqueueFigureBuild(e.o, l, e.key); return false; }
      try {
        const mg = mergeFar(geometryFor(e.o, l, e.key));
        e.tris[l - 1] = triCount(mg);
        e.gid[l - 1] = mesh.addGeometry(mg);
      } catch (err) { e.failed = true; console.warn('[figure_crowd] geometry batch full', err?.message); return false; }
    }
    return true;
  }

  function writeRow(h) {
    const i = h.row, o = h.o;
    putCol(i, 0, o.cloth || '#8a6a48', o.wear ?? 0.4); putCol(i, 1, o.cloth2 || o.cloth || '#8a6a48', o.dust ?? 0.55);
    putCol(i, 2, o.accent || '#2c3e57', h.ph); putCol(i, 3, o.suit || '#4a4038', h.walk);
    putCol(i, 4, o.skin || '#9c7458', h.fade >= 0.999 ? 1 : Math.max(0.001, h.fade));
    putCol(i, 5, o.hairColor || '#241a14', 0); putCol(i, 6, o.leather || '#4a3828', o.eyesIbad ? 1 : 0);
    put(i, 7, h.glow[0], h.glow[1], h.glow[2], 0);
    dirty = true;
  }
  /** Зарегистрировать фигуру: возвращает дескриптор h (экземпляр создаётся, когда готовы геометрии варианта). */
  out.register = (fig) => {
    if (items.length >= maxInstances) return null;
    const o = fig.options, v = ensureVariant(o);
    const h = { v, lod: 2, shown: 2, inst: -1, row: -1, fade: 0, walk: 0, walkT: 0, ph: Math.random() * 6.28, mat: new THREE.Matrix4().copy(zero), vx: 0, vz: 0, tT: 0, hasT: false, dr: 0, vis: false, o, glow: [0.05, 0.03, 0.015] };
    items.push(h);
    return h;
  };
  const ensureInst = (h) => {
    if (h.inst >= 0) return true;
    if (!tryUpload(h.v)) return false;
    h.inst = mesh.addInstance(h.v.gid[1]); h.row = h.inst; h.shown = 2;
    mesh.setMatrixAt(h.inst, h.mat); mesh.setVisibleAt(h.inst, h.vis);
    writeRow(h);
    return true;
  };
  // дальние ходят редкими шагами симуляции: между ними положение экстраполируется по скорости (без «ступенек»)
  out.setMatrix = (h, m) => {
    const e = m.elements, tn = out.time;
    if (h.hasT && tn > h.tT + 1e-3) {
      const dtv = tn - h.tT, k = Math.min(1, dtv / 0.12);
      const vx = (e[12] - h.mat.elements[12]) / dtv, vz = (e[14] - h.mat.elements[14]) / dtv, sp = Math.hypot(vx, vz);
      const f = sp > 3 ? 3 / sp : 1;
      h.vx += (vx * f - h.vx) * k; h.vz += (vz * f - h.vz) * k;
    }
    h.hasT = true; h.tT = tn; h.mat.copy(m); h.dr = 0;
    if (h.inst >= 0) mesh.setMatrixAt(h.inst, m);
  };
  out.setLod = (h, l) => { h.lod = l >= 2 ? 2 : 1; };
  out.setWalk = (h, w) => { h.walkT = w; };
  out.setGlow = (h, r, g, b) => { h.glow[0] = r; h.glow[1] = g; h.glow[2] = b; if (h.inst >= 0) { put(h.row, 7, r, g, b, 0); dirty = true; } };
  /** 0 — скрыт, 1 — виден, между — дизер-доля пикселей (комплементарна uFade<0 у полной фигуры). Возвращает false, пока геометрия варианта не готова. */
  out.setFade = (h, f) => {
    h.fade = f;
    const vis = f > 0.001;
    if (vis && h.inst < 0 && !ensureInst(h)) return false;
    if (h.inst >= 0) {
      if (vis !== h.vis) mesh.setVisibleAt(h.inst, vis);
      D[(h.row * TEX_W + 4) * 4 + 3] = f >= 0.999 ? 1 : Math.max(0.001, f); dirty = true;
    }
    h.vis = vis;
    return true;
  };
  /** Фаза шага/дыхания, догрузка геометрий; вызывать раз в кадр. */
  out.time = 0;
  const _dm = new THREE.Matrix4();
  out.update = (dt, t) => {
    uTime.value = t; out.time = t;
    pumpFigureBuilds(2.5);
    for (const h of items) {
      if (h.inst < 0 && h.vis) ensureInst(h);
      if (h.inst < 0) continue;
      if (h.shown !== h.lod) {
        // смена детализации внутри группы: LOD1 строится по требованию, пока не готов — остаётся LOD2
        if (h.v.gid[h.lod - 1] >= 0 || tryUpload(h.v, h.lod === 1)) { if (h.v.gid[h.lod - 1] >= 0) { mesh.setGeometryIdAt(h.inst, h.v.gid[h.lod - 1]); h.shown = h.lod; } }
      }
      h.walk += (h.walkT - h.walk) * Math.min(1, dt * 5);
      if (h.walk > 0.01) h.ph += dt * 5.6 * (0.55 + 0.45 * h.walk);
      if (h.vis && h.walkT > 0 && (h.vx || h.vz) && t - h.tT < 0.9) {
        _dm.copy(h.mat); const e = _dm.elements, a = t - h.tT; e[12] += h.vx * a; e[14] += h.vz * a; mesh.setMatrixAt(h.inst, _dm);
      }
      D[(h.row * TEX_W + 2) * 4 + 3] = h.ph; D[(h.row * TEX_W + 3) * 4 + 3] = h.walk;
    }
    tex.needsUpdate = true;
  };
  /** Построить геометрии всех зарегистрированных вариантов сразу (при загрузке) и создать экземпляры. */
  out.prewarm = () => { for (const e of variants.values()) { geometryFor(e.o, 2, e.key); tryUpload(e); } };
  out.dispose = () => { mesh.dispose(); mat.dispose(); tex.dispose(); parent?.remove(mesh); };
  return out;
}
