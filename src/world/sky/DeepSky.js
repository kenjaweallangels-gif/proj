import * as THREE from 'three';
import { STAR_K } from './StarField.js';

/**
 * Deep-sky objects for the telescope (hidden in the normal view: the Milky Way map already holds the naked-eye
 * light of the LMC, SMC, M31 …). Catalogue: data/sky/dso.json (all Messier + bright NGC/IC, OpenNGC-based).
 *
 *  - 37 image tiles (data/sky/dso_images.json, textures/dso/*.jpg: ESO, ESA/Hubble, NOIRLab … CC BY 4.0) are gnomonic,
 *    centred exactly on (ra, dec), north up, east left: each is drawn as a tangent-plane quad with additive blending,
 *    loaded when it comes into the telescope field. Brightness: the tile's total light is scaled to the catalogue
 *    V magnitude (so surface brightness and the stars around stay physically consistent).
 *  - Every other non-stellar object gets a procedural profile on a tangent quad (one draw for all): galaxies =
 *    bulge + exponential disc (axis ratio, PA), globular clusters = King-like core, planetary nebulae = OIII ring,
 *    emission / reflection nebulae = soft Halpha / blue glow; total flux again from V. Open clusters / asterisms
 *    are left to the catalogue stars.
 *  - `fadeRegions` (up to 8 visible tiles) tell the deep star material to fade catalogue stars inside a tile.
 */

const R_DSO = 1.3e6;
const D2R = Math.PI / 180;
const TYPE_CODE = { G: 1, GCl: 2, PN: 3, Neb: 4, HII: 4, SNR: 4, 'Cl+N': 4, RfN: 5, Other: 4 };
// profile integrals over the unit ellipse (numerically, in units of a x b), see profile() in the shader
const PROFILE_NORM = { 1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0, 5: 0.0 };

const PROC_VERTEX = /* glsl */`
attribute vec2 aLocal;     // position in units of the semi-axes (-1.2 .. 1.2)
attribute vec4 aParam;     // type, radiance scale (physical, per unit profile), seed, 0
attribute vec3 aColor;
varying vec2 vLocal;
varying vec4 vParam;
varying vec3 vColor;
void main() {
  vLocal = aLocal; vParam = aParam; vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const PROC_FRAGMENT = /* glsl */`
uniform float uGain;
varying vec2 vLocal;
varying vec4 vParam;
varying vec3 vColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float profile(float type, vec2 q, float seed) {
  float r = length(q);
  if (type < 1.5) return exp(-r / 0.2) + 2.5 * exp(-r / 0.035);                                     // galaxy
  if (type < 2.5) return max(1.0 / (1.0 + r * r / 0.012) - 1.0 / (1.0 + 1.0 / 0.012), 0.0);           // globular
  if (type < 3.5) return exp(-pow((r - 0.62) / 0.22, 2.0)) + 0.25 * exp(-r * r / 0.15);               // planetary
  float n = vnoise(q * 3.0 + seed) * 0.6 + vnoise(q * 7.0 - seed) * 0.4;
  return exp(-r * r / 0.28) * (0.45 + 0.9 * n);                                                     // nebula
}
void main() {
  float p = profile(vParam.x, vLocal, vParam.z);
  float edge = 1.0 - smoothstep(0.85, 1.2, length(vLocal));
  gl_FragColor = vec4(vColor * p * edge * vParam.y * uGain, 1.0);
}`;

const TILE_VERTEX = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TILE_FRAGMENT = /* glsl */`
uniform sampler2D tMap;
uniform float uScale;
varying vec2 vUv;
void main() {
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.0, 0.04, min(e.x, e.y));
  gl_FragColor = vec4(texture2D(tMap, vUv).rgb * uScale * edge, 1.0);
}`;

const _c = new THREE.Vector3(), _e = new THREE.Vector3(), _n = new THREE.Vector3();

/** Tangent basis at (ra, dec): centre c, east e, north n (unit, ECI). */
function basis(raDeg, decDeg) {
  const a = raDeg * D2R, d = decDeg * D2R;
  _c.set(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
  _e.set(-Math.sin(a), Math.cos(a), 0);
  _n.set(-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d));
}

function profileNorm(type) {
  // integral of profile over the unit disc of the (scaled) ellipse, by sampling (matches the GLSL)
  if (PROFILE_NORM[type]) return PROFILE_NORM[type];
  let s = 0; const N = 160;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N * 2.4 - 1.2, y = (j + 0.5) / N * 2.4 - 1.2, r = Math.hypot(x, y);
    let p;
    if (type === 1) p = Math.exp(-r / 0.2) + 2.5 * Math.exp(-r / 0.035);
    else if (type === 2) p = Math.max(1 / (1 + r * r / 0.012) - 1 / (1 + 1 / 0.012), 0);
    else if (type === 3) p = Math.exp(-(((r - 0.62) / 0.22) ** 2)) + 0.25 * Math.exp(-r * r / 0.15);
    else p = Math.exp(-r * r / 0.28) * 0.9;
    const edge = 1 - THREE.MathUtils.smoothstep(r, 0.85, 1.2);
    s += p * edge;
  }
  return (PROFILE_NORM[type] = s * (2.4 / N) ** 2);
}

export class DeepSky {
  constructor(ctx, sky) {
    this.ctx = ctx;
    this.sky = sky;
    this.group = new THREE.Group();
    this.group.name = 'DeepSky';
    this.group.visible = false;
    this.objects = [];        // dso.json entries (+ dir: unit ECI vector)
    this.tiles = [];          // { info, obj, mesh, mat, loaded, scale, dir, radius }
    this.gain = 0;
    this.procMaterial = new THREE.ShaderMaterial({
      name: 'DsoProcedural', uniforms: { uGain: { value: 0 } }, vertexShader: PROC_VERTEX, fragmentShader: PROC_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false,
    });
    this.fadeRegions = [];
  }

  async load() {
    const ctx = this.ctx;
    try {
      const [objs, imgs] = await Promise.all([
        fetch(ctx.assetUrl('data/sky/dso.json')).then((r) => r.json()),
        fetch(ctx.assetUrl('data/sky/dso_images.json')).then((r) => r.json()),
      ]);
      this.objects = objs;
      for (const o of objs) {
        const a = o.ra * D2R, d = o.dec * D2R;
        o.dir = new THREE.Vector3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
      }
      const byId = new Map(objs.map((o) => [o.id, o]));
      for (const info of imgs) this._addTile(info, byId.get(info.id));
      this._buildProcedural(objs.filter((o) => TYPE_CODE[o.type] && !imgs.some((i) => i.id === o.id)));
    } catch (e) { console.warn('[DeepSky] catalogue', e); }
  }

  _buildProcedural(list) {
    const pos = [], loc = [], par = [], col = [], idx = [];
    for (const o of list) {
      const type = TYPE_CODE[o.type];
      const maj = Math.max(o.maj || 1, 0.3) / 60 * D2R / 2;         // semi-major (rad)
      const min = Math.max(o.min || o.maj || 1, 0.2) / 60 * D2R / 2;
      const pa = (o.pa ?? 0) * D2R;
      const v = o.v ?? o.b ?? 12;
      const flux = Math.pow(10, -0.4 * v);
      // mean physical radiance: flux x STAR_K over the profile integral (solid angle a x b x norm)
      const norm = profileNorm(type) * maj * min;
      const scale = flux * STAR_K / norm;
      basis(o.ra, o.dec);
      // major axis at PA (from north through east)
      const ax = _n.clone().multiplyScalar(Math.cos(pa)).addScaledVector(_e, Math.sin(pa));
      const ay = _n.clone().multiplyScalar(-Math.sin(pa)).addScaledVector(_e, Math.cos(pa));
      const base = pos.length / 3;
      for (const [sx, sy] of [[-1.2, -1.2], [1.2, -1.2], [1.2, 1.2], [-1.2, 1.2]]) {
        const p = _c.clone().addScaledVector(ax, Math.tan(maj) * sx).addScaledVector(ay, Math.tan(min) * sy).multiplyScalar(R_DSO);
        pos.push(p.x, p.y, p.z); loc.push(sx, sy);
        par.push(type, scale, (o.ra * 7.31) % 17, 0);
        const c = type === 1 ? [1.0, 0.92, 0.8] : type === 2 ? [1.0, 0.95, 0.85] : type === 3 ? [0.55, 1.0, 0.9] : type === 5 ? [0.6, 0.75, 1.0] : [1.0, 0.55, 0.6];
        col.push(...c);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aLocal', new THREE.Float32BufferAttribute(loc, 2));
    geo.setAttribute('aParam', new THREE.Float32BufferAttribute(par, 4));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R_DSO * 1.01);
    this.procedural = new THREE.Mesh(geo, this.procMaterial);
    this.procedural.name = 'DsoProcedural';
    this.procedural.frustumCulled = false;
    this.procedural.renderOrder = -25;
    this.group.add(this.procedural);
  }

  _addTile(info, obj) {
    basis(info.ra, info.dec);
    const half = Math.tan(info.size_arcmin / 60 * D2R / 2);
    const pa = (info.pa_deg || 0) * D2R;
    const e = _e.clone().multiplyScalar(Math.cos(pa)).addScaledVector(_n, -Math.sin(pa));
    const n = _n.clone().multiplyScalar(Math.cos(pa)).addScaledVector(_e, Math.sin(pa));
    const pos = [], uv = [];
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      // u = 0 on the east side (east left), v = 1 north
      const p = _c.clone().addScaledVector(e, half * (1 - 2 * u)).addScaledVector(n, half * (2 * v - 1)).multiplyScalar(R_DSO * 0.999);
      pos.push(p.x, p.y, p.z); uv.push(u, v);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      name: 'DsoTile', uniforms: { tMap: { value: null }, uScale: { value: 0 } }, vertexShader: TILE_VERTEX, fragmentShader: TILE_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `DsoTile_${info.id}`;
    mesh.visible = false;
    mesh.renderOrder = -24;
    this.group.add(mesh);
    const dir = _c.clone();
    const v = obj?.v ?? obj?.b ?? 6;
    this.tiles.push({ info, obj, mesh, mat, loaded: false, loading: false, sum: 0, flux: Math.pow(10, -0.4 * v), dir, radius: Math.atan(half * Math.SQRT2) });
  }

  _loadTile(t) {
    if (t.loading) return;
    t.loading = true;
    new THREE.TextureLoader().loadAsync(this.ctx.assetUrl(`textures/dso/${t.info.file}`)).then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      // total linear light of the tile (64 x 64 reduction)
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(tex.image, 0, 0, 64, 64);
      const px = g.getImageData(0, 0, 64, 64).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) {
        for (let k = 0; k < 3; k++) { const s = px[i + k] / 255; sum += (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][k]; }
      }
      const tileOmega = (t.info.size_arcmin / 60 * D2R) ** 2;
      // mean linear value = sum / 4096; radiance = scale x value; total light = scale x mean x tileOmega = flux x STAR_K
      t.scale = t.flux * STAR_K / Math.max(1e-6, (sum / 4096) * tileOmega);
      t.mat.uniforms.tMap.value = tex;
      t.loaded = true;
    }).catch((e) => console.warn('[DeepSky] tile', t.info.file, e));
  }

  setGain(g) { this.gain = g; this.procMaterial.uniforms.uGain.value = g; this.group.visible = g > 0; }

  /** Nearest objects / tiles to a direction (ECI unit) — used by the telescope readouts. */
  find(id) { return this.objects.find((o) => o.id === id); }

  update(dt, ctx) {
    const fade = this.fadeRegions; fade.length = 0;
    const deepU = this.sky.starField.uniforms;
    for (let i = 0; i < 8; i++) deepU.uFadeAmount.value[i] = 0;
    if (!this.group.visible) return;
    const cam = ctx.farCamera;
    if (!cam) return;
    // view direction in ECI
    const fwd = _e.set(0, 0, -1).applyQuaternion(cam.quaternion).applyQuaternion(this._invSky(ctx));
    const fovRad = cam.fov * D2R * Math.max(1, cam.aspect);
    let k = 0;
    for (const t of this.tiles) {
      const ang = Math.acos(Math.max(-1, Math.min(1, t.dir.dot(fwd))));
      const inView = ang < fovRad * 0.75 + t.radius;
      // show tiles from ~6x their size downward (the catalogue stars carry the wide view)
      const vis = inView ? 1 - THREE.MathUtils.smoothstep(fovRad, t.radius * 5, t.radius * 14) : 0;
      if (vis > 0 && !t.loaded) this._loadTile(t);
      if (vis > 0) t.last = performance.now();
      t.mesh.visible = vis > 0 && t.loaded;
      t.mat.uniforms.uScale.value = t.loaded ? (t.scale || 0) * this.gain * vis : 0;
      if (t.mesh.visible && k < 8) {
        deepU.uFade.value[k].set(t.dir.x, t.dir.y, t.dir.z, Math.cos(t.radius * 0.72));
        deepU.uFadeAmount.value[k] = vis * 0.85;
        k++;
      }
    }
    // VRAM: keep at most 10 tiles (5.6 MB each with mips), drop the least recently seen
    const loaded = this.tiles.filter((t) => t.loaded && !t.mesh.visible);
    if (loaded.length > 10) {
      loaded.sort((a, b) => (a.last || 0) - (b.last || 0));
      for (const t of loaded.slice(0, loaded.length - 10)) { t.mat.uniforms.tMap.value?.dispose(); t.mat.uniforms.tMap.value = null; t.loaded = false; t.loading = false; }
    }
  }

  _invSky(ctx) { if (!this._qi) this._qi = new THREE.Quaternion(); return this._qi.copy(ctx.orbit.skyQuat).invert(); }

  dispose() {
    this.procedural?.geometry.dispose(); this.procMaterial.dispose();
    for (const t of this.tiles) { t.mesh.geometry.dispose(); t.mat.uniforms.tMap.value?.dispose(); t.mat.dispose(); }
  }
}
