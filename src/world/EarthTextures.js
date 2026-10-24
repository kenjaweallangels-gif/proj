import * as THREE from 'three';

/**
 * Earth texture helpers: the seasonal day texture (Blue Marble NG monthly imagery blended for the sim date and
 * baked once into a mipmapped sRGB render target), the 3D noise used by the weather shaders, and small CPU
 * grids (land fraction, cloud cover) read back from images for the weather placement logic.
 */

export const BASE_MONTH = 10;          // the month of the 8K base / ultra detail tiles (see tools/prepare_earth_textures.py)

/** The two monthly images bracketing `date` (month centres on the 15th) and the blend weight toward the second. */
export function seasonFor(date) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth(), t = date.getTime();
  const mid = Date.UTC(y, m, 15);
  let a, t0, t1;
  if (t >= mid) { a = m; t0 = mid; t1 = Date.UTC(y, m + 1, 15); }
  else { a = m - 1; t0 = Date.UTC(y, m - 1, 15); t1 = mid; }
  const w = (t - t0) / (t1 - t0);
  return { a: ((a % 12) + 12) % 12 + 1, b: ((a + 1) % 12 + 12) % 12 + 1, w: Math.min(1, Math.max(0, w)) };
}

export const monthPath = (m) => `textures/earth/season/earth_m${String(m).padStart(2, '0')}_4096.jpg`;

const BAKE_VERTEX = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// High/ultra: 8K base month + (blend of the two 4K months - the 4K base month): the seasonal change (snow, sea ice,
// vegetation) at 4K on top of the 8K detail; exact base imagery when the date is in the base month.
const BAKE_DELTA = /* glsl */`
uniform sampler2D tBase, tRef, tA, tB;
uniform float uW;
varying vec2 vUv;
void main() {
  vec3 base = texture2D(tBase, vUv).rgb;
  vec3 season = mix(texture2D(tA, vUv).rgb, texture2D(tB, vUv).rgb, uW) - texture2D(tRef, vUv).rgb;
  gl_FragColor = vec4(max(base + season, 0.0), 1.0);
}`;

// Medium/low: the two months blended.
const BAKE_BLEND = /* glsl */`
uniform sampler2D tA, tB;
uniform float uW;
varying vec2 vUv;
void main() { gl_FragColor = vec4(mix(texture2D(tA, vUv).rgb, texture2D(tB, vUv).rgb, uW), 1.0); }`;

/** Renders a full-target quad with `fragmentShader` into a new mipmapped sRGB RGBA8 target; returns the target. */
export function bakeToTarget(renderer, width, height, fragmentShader, uniforms, anisotropy = 1) {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    colorSpace: THREE.SRGBColorSpace, depthBuffer: false, stencilBuffer: false,
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
  });
  rt.texture.wrapS = THREE.RepeatWrapping; rt.texture.wrapT = THREE.ClampToEdgeWrapping;
  rt.texture.anisotropy = anisotropy;
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: BAKE_VERTEX, fragmentShader, depthTest: false, depthWrite: false, toneMapped: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  quad.geometry.dispose(); mat.dispose();
  return rt;
}

/**
 * Day texture for the sim date. mode 'delta' (8K base + seasonal change), 'blend' (two 4K months) or 'nearest'
 * (single month file, no GPU work: 'lite'). `load(path, srgb)` is the caller's texture loader.
 * Returns { texture, target } (target = render target to dispose later, or null).
 */
export async function loadSeasonalDay(renderer, load, date, mode, anisotropy, basePath) {
  const s = seasonFor(date);
  if (mode === 'nearest') {
    const tex = await load(monthPath(s.w < 0.5 ? s.a : s.b), true);
    return { texture: tex, target: null, season: s };
  }
  const paths = mode === 'delta' ? [basePath, monthPath(BASE_MONTH), monthPath(s.a), monthPath(s.b)] : [monthPath(s.a), monthPath(s.b)];
  const unique = [...new Set(paths)];
  const loaded = await Promise.all(unique.map((p) => load(p, true, true)));
  const byPath = new Map(unique.map((p, i) => [p, loaded[i]]));
  const tex = (p) => byPath.get(p);
  let rt;
  if (mode === 'delta') {
    const w = tex(paths[0]).image.width, h = tex(paths[0]).image.height;
    rt = bakeToTarget(renderer, w, h, BAKE_DELTA, {
      tBase: { value: tex(paths[0]) }, tRef: { value: tex(paths[1]) }, tA: { value: tex(paths[2]) }, tB: { value: tex(paths[3]) }, uW: { value: s.w },
    }, anisotropy);
  } else {
    rt = bakeToTarget(renderer, 4096, 2048, BAKE_BLEND, { tA: { value: tex(paths[0]) }, tB: { value: tex(paths[1]) }, uW: { value: s.w } }, anisotropy);
  }
  for (const t of loaded) t.dispose();
  return { texture: rt.texture, target: rt, season: s };
}

/**
 * 64^3 RG8 tileable noise for the weather shaders: R = gradient (Perlin) noise with 8 lattice cells per period,
 * G = inverted Worley F1 (one feature point per cell, 8 cells per period). Repeat-wrapped, mipmapped.
 */
export function createNoiseTexture(size = 64, cells = 8, seed = 1337) {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n3 = cells * cells * cells;
  const grad = new Float32Array(n3 * 3);
  for (let i = 0; i < n3; i++) {
    let x, y, z, l;
    do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 0.01);
    l = Math.sqrt(l); grad[i * 3] = x / l; grad[i * 3 + 1] = y / l; grad[i * 3 + 2] = z / l;
  }
  const feat = new Float32Array(n3 * 3);
  for (let i = 0; i < n3 * 3; i++) feat[i] = rnd();
  const wrap = (i) => ((i % cells) + cells) % cells;
  const gi = (x, y, z) => (wrap(z) * cells + wrap(y)) * cells + wrap(x);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const data = new Uint8Array(size * size * size * 2);
  const k = cells / size;
  let o = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + 0.5) * k, py = (y + 0.5) * k, pz = (z + 0.5) * k;
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    const fx = px - ix, fy = py - iy, fz = pz - iz;
    // gradient noise
    let v = 0;
    const u = fade(fx), w = fade(fy), t = fade(fz);
    for (let c = 0; c < 8; c++) {
      const cx = c & 1, cy = (c >> 1) & 1, cz = (c >> 2) & 1;
      const g = gi(ix + cx, iy + cy, iz + cz) * 3;
      const d = grad[g] * (fx - cx) + grad[g + 1] * (fy - cy) + grad[g + 2] * (fz - cz);
      v += d * (cx ? u : 1 - u) * (cy ? w : 1 - w) * (cz ? t : 1 - t);
    }
    // Worley F1
    let f1 = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const g = gi(ix + dx, iy + dy, iz + dz) * 3;
      const ex = dx + feat[g] - fx, ey = dy + feat[g + 1] - fy, ez = dz + feat[g + 2] - fz;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 < f1) f1 = d2;
    }
    data[o++] = Math.max(0, Math.min(255, Math.round((v * 0.9 + 0.5) * 255)));
    data[o++] = Math.max(0, Math.min(255, Math.round((1 - Math.min(1, Math.sqrt(f1) * 1.1)) * 255)));
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RGFormat; tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** Draws an image into a w x h canvas and returns one channel (0 = R) as Uint8Array (row 0 = top). */
export function imageChannel(image, w, h, channel = 0) {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = px[i * 4 + channel];
  return out;
}
