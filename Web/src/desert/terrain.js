// Рендер ландшафта: тороидальный клипмап (8 уровней), высоты — из analytic field.js через DataTexture,
// вершинный шейдер читает высоту/нормаль/маски; песок — MeshStandardMaterial + onBeforeCompile.
import * as THREE from 'three';
import { heightAt, masks } from './field.js';
import { ENV, patchMaterial } from './env.js';

const CELLS = 160;               // ячеек на сторону кольца
const TEX = 164;                 // размер текстуры уровня (> CELLS+1)
const HALF_TEX = TEX / 2;

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
float gRH;

// Ripple: (высота 0..1 * амплитуда, градиент по x,z)
vec3 rkRipple(vec2 p, float wl, float warpAmp, float seed, float asym){
  vec3 nw = rkNoiseD(p / (wl * 7.0) + seed);
  float ph = dot(p, uWind) / wl + (nw.x - 0.5) * warpAmp - uTime * uWindSpeed * 0.0004 / wl;
  float f = fract(ph);
  float h0 = f < asym ? f / asym : (1.0 - f) / (1.0 - asym);
  float dh0 = f < asym ? 1.0 / asym : -1.0 / (1.0 - asym);
  float hh = h0 * h0 * (3.0 - 2.0 * h0);
  float dh = 6.0 * h0 * (1.0 - h0) * dh0;
  float br = 0.55 + 0.45 * rkNoise(p / (wl * 6.0) + seed * 3.7);
  vec2 dph = uWind / wl + warpAmp * nw.yz / (wl * 7.0);
  float amp = wl * 0.10 * br;
  gRH = hh;
  return vec3(hh * amp, dph * dh * amp);
}
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

// Рябь (3 масштаба) + зерно
float calmR = (1.0 - lee) * (1.0 - rockM) * (1.0 - disturb) * (1.0 - 0.6 * packedM);
vec2 g = vec2(0.0);
float f1 = 1.0 - smoothstep(6.0, 28.0, dist);
float f2 = 1.0 - smoothstep(22.0, 110.0, dist);
float f3 = 1.0 - smoothstep(90.0, 480.0, dist);
float rOcc = 0.0;
if (f1 > 0.001 && uQual > 0.5) { vec3 r = rkRipple(xz, 0.12, 1.6, 1.0, 0.7); g += r.yz * f1 * 0.7; rOcc += (1.0 - gRH) * f1 * 0.35; }
if (f2 > 0.001) { vec3 r = rkRipple(xz, 0.62, 1.8, 5.0, 0.72); g += r.yz * f2 * 0.3; rOcc += (1.0 - gRH) * f2 * 0.65; }
if (f3 > 0.001) { vec3 r = rkRipple(xz, 2.9, 2.5, 9.0, 0.75); g += r.yz * f3 * 0.1; rOcc += (1.0 - gRH) * f3 * 0.25; }
g *= calmR;
// лавинные полосы на подветренных склонах
if (lee > 0.01) {
  vec3 st = rkNoiseD(vec2(vv * 1.6, uu * 0.05));
  g += (st.yx * vec2(-1.0, 1.0)).yx * 0.0;
  vec2 dn = normalize(Ng.xz) * 0.0;
  g += acr * (st.y * 0.045 * lee);
}
// зерно
float fg = 1.0 - smoothstep(1.5, 9.0, dist);
vec2 grn = vec2(0.0);
if (fg > 0.001 && uQual > 0.5) { vec3 n = rkNoiseD(xz * 95.0); grn = n.yz * 0.0016 * fg; }
g += grn * (1.0 - 0.5 * disturb);
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
float micro = rkNoise(xz / 5.5) - 0.5;
vec3 col = mix(uSandLoose, uSandPacked, packedM);
col *= 1.0 + 0.2 * macro + 0.09 * streak + 0.05 * micro;
float dmin = smoothstep(0.6, 0.82, rkNoise(vec2(uu / 6.5, vv / 80.0) + 11.0)) * wnd;
col = mix(col, col * vec3(0.60, 0.50, 0.43), dmin * 0.55);
// подветренные лавинные склоны: плотнее и темнее, краснее
col = mix(col, col * vec3(0.80, 0.68, 0.58), lee * 0.6);
// разнообразие дюн: крупные тёплые/светлые пятна и полосы вдоль ветра
float hv = rkFbm(xz / 900.0 + 17.0) - 0.5;
float hv2 = rkNoise(vec2(uu / 240.0, vv / 650.0) + 3.0) - 0.5;
col *= vec3(1.0 + 0.20 * hv + 0.12 * hv2, 1.0 + 0.03 * hv, 1.0 - 0.17 * hv - 0.10 * hv2);
// тени гребней ряби при скользящем свете (когда солнце идёт вдоль ветра)
float grazing = 1.0 - smoothstep(0.04, 0.42, uKeyDir.y);
float along = abs(dot(normalize(uKeyDir.xz + vec2(1e-4)), uWind));
col *= 1.0 - clamp(rOcc, 0.0, 1.0) * grazing * (0.15 + 0.45 * along) * (1.0 - rockM) * (1.0 - disturb);
float fgr = (1.0 - smoothstep(0.5, 6.0, dist));
col *= 1.0 + 0.05 * fgr * (rkNoise(xz * 70.0) - 0.5) * 2.0;
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
if (fs > 0.001 && uQual > 0.5 && rockM < 0.5) {
  vec2 cp = xz * 46.0;
  vec2 ci = floor(cp);
  float hc = rkHash12(ci);
  if (hc > 0.985 - 0.014 * lowSunS) {
    vec2 rn = rkHash22(ci + 17.0) * 2.0 - 1.0;
    vec3 cn = normalize(gNW + vec3(rn.x, 0.6 + 0.4 * rn.y, rn.y) * 0.8);
    vec3 Hh = normalize(uKeyDir + Vv);
    float sp = pow(max(dot(cn, Hh), 0.0), 160.0);
    float shape = smoothstep(0.5, 0.12, length(fract(cp) - 0.5));
    gSpark = uKeyColor * sp * shape * (0.8 + 1.8 * lowSunS) * fs * (1.0 - lee * 0.6);
  }
}
`;

const FRAG_NORMAL = /* glsl */`
normal = normalize((viewMatrix * vec4(gNW, 0.0)).xyz);
`;
const FRAG_ROUGH = /* glsl */`
roughnessFactor = mix(0.94, 0.8, packedM) ;
roughnessFactor = mix(roughnessFactor, 0.88, rockM);
`;
const FRAG_LIGHTS_END = /* glsl */`
reflectedLight.directDiffuse *= vShade;
reflectedLight.directSpecular *= vShade;
float gSunVis = clamp(dot(reflectedLight.directDiffuse, vec3(0.3333)) / (dot(uKeyColor, vec3(0.3333)) * max(dot(gNW, uKeyDir), 0.03) * dot(diffuseColor.rgb, vec3(0.3333)) * 0.3183 + 1e-5), 0.0, 1.0);
`;
const FRAG_BEFORE_OUT = /* glsl */`
outgoingLight += gSpark * gSunVis * step(0.0, dot(gNW, uKeyDir));
`;

const FRAG_FAR_FADE = /* glsl */`
{
  float rr = max(abs(vWP.x - uCamXZ.x), abs(vWP.z - uCamXZ.y)) / 5000.0;
  float fe = smoothstep(0.62, 0.97, rr);
  if (fe > 0.0) gl_FragColor.rgb = mix(gl_FragColor.rgb, rkFogColorDir(normalize(vWP - cameraPosition)), fe);
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

  const sandU = {
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
      s, li, data, tex, cx: 1e9, cz: 1e9,
      colI: new Float64Array(TEX).fill(NaN), rowJ: new Float64Array(TEX).fill(NaN),
      uniforms: null, mesh: null,
    });
  });

  function fillTexel(L, a, b, i, j) {
    const x = i * L.s, z = j * L.s;
    const sp = L.li === 0 ? 0 : L.s;
    const h = heightAt(x, z, sp);
    const e = Math.max(0.5, L.s * 0.5);
    const hx = heightAt(x + e, z, sp), hz = heightAt(x, z + e, sp);
    const nx = -(hx - h) / e, nz = -(hz - h) / e;
    const il = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
    masks(x, z, tmpMask);
    const k = (b * TEX + a) * 4;
    L.data[k] = h; L.data[k + 1] = nx * il; L.data[k + 2] = nz * il;
    L.data[k + 3] = Math.round(tmpMask.rock * 63) * 64 + Math.round(tmpMask.packed * 63);
  }

  function recenter(L, cx, cz) {
    const loI = cx - HALF_TEX, loJ = cz - HALF_TEX;
    const staleC = [], staleR = [];
    for (let a = 0; a < TEX; a++) {
      const iw = loI + (((a - loI) % TEX) + TEX) % TEX;
      if (L.colI[a] !== iw) { L.colI[a] = iw; staleC.push(a); }
    }
    for (let b = 0; b < TEX; b++) {
      const jw = loJ + (((b - loJ) % TEX) + TEX) % TEX;
      if (L.rowJ[b] !== jw) { L.rowJ[b] = jw; staleR.push(b); }
    }
    const isStale = new Uint8Array(TEX);
    for (const a of staleC) { isStale[a] = 1; for (let b = 0; b < TEX; b++) fillTexel(L, a, b, L.colI[a], L.rowJ[b]); }
    for (const b of staleR) for (let a = 0; a < TEX; a++) if (!isStale[a]) fillTexel(L, a, b, L.colI[a], L.rowJ[b]);
    L.cx = cx; L.cz = cz;
    L.tex.needsUpdate = true;
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
    patchMaterial(mat, 'rk-terrain', {
      uniforms: Object.assign({}, sandU, L.uniforms, { uFootRect: L.uniforms.uFootRect }),
      vertexCommon: true, vertexPars: VERT_PARS, vertexBeginNormal: VERT_BEGIN_NORMAL, vertexMain: VERT_MAIN,
      fragPars: FRAG_PARS, fragColor: FRAG_COLOR, fragRough: FRAG_ROUGH, fragNormal: FRAG_NORMAL,
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

  // начальная заливка вокруг (0,0)->камеры
  function update(cam) {
    ENV.uniforms.uCamXZ.value.set(cam.x, cam.z);
    for (const L of levels) {
      const cx = Math.round(cam.x / L.s), cz = Math.round(cam.z / L.s);
      if (cx !== L.cx || cz !== L.cz) recenter(L, cx, cz);
    }
    for (const L of levels) {
      L.uniforms.uCenter.value.set(L.cx, L.cz);
    }
  }

  return {
    levels, update, sandU,
    setVisible(b) { for (const L of levels) L.mesh.visible = b; },
    /** принудительная первичная заливка */
    prime(x, z) { update({ x, z }); },
  };
}
