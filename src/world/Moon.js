import * as THREE from 'three';
import { MoonSurface, MOON_RADIUS_KM } from './moon/MoonSurface.js';
import { applyMat3T } from '../core/Ephemeris.js';

/**
 * The Moon (far scene, km), shared by the normal view and the telescope; built to be approached (see MoonSurface).
 *
 *  - Position: orbit.earthCenterFar + skyQuat x geocentric Moon (Ephemeris, Meeus ch. 47) = topocentric for any origin.
 *  - Orientation: IAU 2009 pole / prime meridian with the libration series -> the LROC / LOLA maps (mean-Earth frame)
 *    show the correct near side, libration and position angle.
 *  - Geometry: cube-sphere quadtree (moon/MoonSurface.js), heights from LOLA (2048 x 1024, 5.3 km / px, metres above
 *    1737.4 km), chunk LOD by projected cell size, per-frame selection against the far camera (scene.onBeforeRender, so
 *    it uses this frame's camera, also in the telescope).
 *  - Shading: LROC WAC colour (Hapke-normalised -> x 0.24 = normal albedo 0.12), LOLA normal map (tangent space, true
 *    relief), lunar-Lambert photometry (McEwen) with the opposition surge; earthshine from the Earth's phase seen from
 *    the Moon (1e-4 of sunlight at full Earth, boosted for the eye); near the terminator a height-field ray march casts
 *    the long shadows of crater rims and mountains (GPU presets, when the Moon is large on screen).
 *  - Textures stream in by apparent size: colour 2K -> 4K (> 400 px) -> 8K (> 1500 px, high / ultra); normals 4K
 *    (> 120 px) -> 8K (> 1500 px).
 *
 * API: `centerFar` (Vector3, far frame), `quaternion` (body -> far), `radius`, `heightAt(latRad, lonRad)` (metres),
 * `surfacePoint(latRad, lonRad, out)` (body-fixed km), `bodyToFar(vBody, out)`, `setGain(g)`, `surface` (MoonSurface).
 */

const EARTHSHINE_FULL = 1.0e-4;     // earthshine irradiance at full Earth / sunlight
const EARTHSHINE_EYE = 25;          // perceptual boost (the eye sees the ashen light; a linear camera barely does)

const MOON_VERTEX = /* glsl */`
attribute vec3 aDir;
varying vec3 vDir;          // body-fixed unit direction
varying vec3 vNormalB;      // body-fixed geometric normal
varying vec3 vWorld;
void main() {
  vDir = aDir;
  vNormalB = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const MOON_FRAGMENT = /* glsl */`
#define PI 3.14159265359
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tHeight;
uniform float uHasNormal, uRelief, uGain, uAlbedo, uNormalStrength;
uniform vec3 uSunB;          // body frame: direction to the Sun
uniform vec3 uEarthB;        // body frame: direction to the Earth
uniform vec3 uCamB;          // camera position, body frame (km)
uniform vec3 uSunColor;
uniform vec3 uEarthshine;    // earthshine irradiance x colour (fraction of sunlight)
uniform float uPhaseDeg;
varying vec3 vDir;
varying vec3 vNormalB;
varying vec3 vWorld;

vec2 lonLatUv(vec3 d) { return vec2(atan(d.y, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.z, -1.0, 1.0)) / PI + 0.5); }

// seam-free sampling of an equirect map (the seam at lon 180 would pick the smallest mip)
vec4 sampleEq(sampler2D t, vec2 uv) {
  vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dx1 = dFdx(uv), dy1 = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  vec2 dx = vec2(abs(dx1.x) < abs(dx2.x) ? dx1.x : dx2.x, dx1.y);
  vec2 dy = vec2(abs(dy1.x) < abs(dy2.x) ? dy1.x : dy2.x, dy1.y);
  return textureGrad(t, uv, dx, dy);
}

float heightKm(vec3 d) { return textureLod(tHeight, lonLatUv(d), 0.0).r; }

// lunar-Lambert reflectance (McEwen 1991): L(phase) blends Lommel-Seeliger and Lambert
float lunarLambert(float mu0, float mu, float L) {
  if (mu0 <= 0.0) return 0.0;
  return 2.0 * L * mu0 / (mu0 + mu) + (1.0 - L) * mu0;
}

void main() {
  vec3 d = normalize(vDir);
  vec2 uv = lonLatUv(d);
  vec3 alb = sampleEq(tColor, uv).rgb * uAlbedo;
  vec3 east = normalize(vec3(-d.y, d.x, 0.0) + vec3(1.0e-6, 0.0, 0.0));
  vec3 north = cross(d, east);
  vec3 N = normalize(vNormalB);
  if (uHasNormal > 0.5) {
    vec3 t = sampleEq(tNormal, uv).xyz * 2.0 - 1.0;
    t.xy *= uNormalStrength;
    N = normalize(east * t.x + north * t.y + d * t.z);
  }
  vec3 V = normalize(uCamB - d * ${MOON_RADIUS_KM.toFixed(1)});
  float mu = max(dot(N, V), 1.0e-3);
  float a = uPhaseDeg;
  float Lp = clamp(1.0 - 0.019 * a + 2.42e-4 * a * a - 1.46e-6 * a * a * a, 0.0, 1.0);
  float mu0 = dot(N, uSunB);
  float sunElev = dot(d, uSunB);
  float lit = lunarLambert(mu0, mu, Lp);
  // without the height field: the terminator of the reference sphere (half the solar disc wide)
  if (uRelief < 0.5) lit *= smoothstep(-0.0046, 0.0046, sunElev);
  // near the terminator: march the height field toward the Sun -> long shadows of rims and mountains, sunlit peaks
  // beyond the terminator (the ray from a peak clears the curvature of the sphere)
  else if (lit > 0.0 && sunElev < 0.26) {
    if (sunElev < -0.035) lit = 0.0;
    vec3 tdir = normalize(uSunB - d * sunElev);
    float h0 = heightKm(d);
    float tanE = sunElev / sqrt(max(1.0 - sunElev * sunElev, 1.0e-6));
    float shade = 1.0, x = 2.0;
    for (int i = 0; i < 14; i++) {
      vec3 q = normalize(d + tdir * (x / ${MOON_RADIUS_KM.toFixed(1)}));
      float ray = h0 + x * tanE + x * x / (2.0 * ${MOON_RADIUS_KM.toFixed(1)});
      float pen = x * 0.0047 + 0.15;             // half the solar disc
      shade = min(shade, smoothstep(-pen, pen, ray - heightKm(q)));
      x *= 1.32;
    }
    lit *= shade;
  }
  float surge = 1.0 + 0.45 * exp(-a / 5.0);
  vec3 col = alb * 1.45 * uSunColor * lit * surge;
  // earthshine (Lommel-Seeliger, no surge)
  float mu0e = dot(N, uEarthB);
  col += alb * 1.45 * uEarthshine * (mu0e > 0.0 ? 2.0 * mu0e / (mu0e + mu) : 0.0);
  gl_FragColor = vec4(col * uGain, 1.0);
}`;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _size = new THREE.Vector2();
const _frustum = new THREE.Frustum();
const _proj = new THREE.Matrix4();
const _cam = new THREE.PerspectiveCamera();
const _eci = { x: 0, y: 0, z: 0 };

/** Parses the gzip'd "MHT1" height file -> { w, h, data: Float32Array (km) }. */
async function loadHeight(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  let buf = await r.arrayBuffer();
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b) buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x3154484d) throw new Error('not an MHT1 height file');
  const w = dv.getUint32(4, true), h = dv.getUint32(8, true), step = dv.getFloat32(12, true), off = dv.getFloat32(16, true);
  const deltas = new Int16Array(buf, 20, w * h);
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    let acc = 0;
    for (let i = 0; i < w; i++) { acc += deltas[j * w + i]; data[j * w + i] = (acc * step + off) / 1000; }
  }
  return { w, h, data };
}

export class Moon {
  constructor(ctx, sky) {
    this.ctx = ctx;
    this.sky = sky;
    const q = ctx.quality || {};
    this.lite = !!q.lite;
    this.preset = q.lite ? 'lite' : (q.preset || 'high');
    this.radius = MOON_RADIUS_KM;
    this.centerFar = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.gain = 1;
    this.height = null;
    this.maxColor = { ultra: 8192, high: 8192, medium: 4096, low: 4096, lite: 2048 }[this.preset] || 4096;
    this.maxNormal = this.lite ? 0 : ({ ultra: 8192, high: 8192 }[this.preset] || 4096);
    if ((ctx.renderer.capabilities.maxTextureSize || 4096) < 8192) { this.maxColor = Math.min(this.maxColor, 4096); this.maxNormal = Math.min(this.maxNormal, 4096); }
    this.colorSize = 0; this.normalSize = 0;
    this._loading = {};

    this.uniforms = {
      tColor: { value: null }, tNormal: { value: null }, tHeight: { value: null },
      uHasNormal: { value: 0 }, uRelief: { value: 0 }, uGain: { value: 1 }, uAlbedo: { value: 0.24 }, uNormalStrength: { value: 1.0 },
      uSunB: { value: new THREE.Vector3(1, 0, 0) }, uEarthB: { value: new THREE.Vector3(1, 0, 0) }, uCamB: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color(1, 1, 1) }, uEarthshine: { value: new THREE.Color(0, 0, 0) }, uPhaseDeg: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({ name: 'Moon', uniforms: this.uniforms, vertexShader: MOON_VERTEX, fragmentShader: MOON_FRAGMENT, toneMapped: false });
    this.surface = new MoonSurface(this.material, (d) => this.heightKmDir(d), this.lite
      ? { seg: 8, maxLevel: 6, targetPx: 9, budget: 2, maxLeaves: 120 }
      : { seg: 16, maxLevel: 10, targetPx: 5, budget: 8, maxLeaves: 500 });
    this.group = this.surface.group;
    this.group.name = 'Moon';
    this.group.visible = false;
    ctx.farScene.add(this.group);
    // LOD selection with this frame's far camera (App copies the near camera after the module updates)
    const prev = ctx.farScene.onBeforeRender;
    ctx.farScene.onBeforeRender = (renderer, scene, camera, rt) => {
      if (prev && prev !== THREE.Object3D.prototype.onBeforeRender) prev(renderer, scene, camera, rt);
      if (camera === ctx.farCamera) this._select(camera);
    };
    this.update(0, ctx);
  }

  async load() {
    const ctx = this.ctx;
    try {
      this.height = await loadHeight(ctx.assetUrl('textures/moon/moon_height_2048.bin'));
      const H = this.height;
      // GPU copy (half float, km) for the terminator shadows
      const half = new Uint16Array(H.w * H.h);
      for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(H.data[i]);
      // rows from the north -> flip for the GL convention (v = 0 south)
      const flipped = new Uint16Array(half.length);
      for (let j = 0; j < H.h; j++) flipped.set(half.subarray((H.h - 1 - j) * H.w, (H.h - j) * H.w), j * H.w);
      const t = new THREE.DataTexture(flipped, H.w, H.h, THREE.RedFormat, THREE.HalfFloatType);
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
      t.needsUpdate = true;
      this.heightTexture = t;
      this.uniforms.tHeight.value = t;
    } catch (e) { console.warn('[Moon] height map', e); }
    await this._loadColor(2048);
    if (!this.lite && this.maxNormal) this._loadNormal(4096);    // background: a 30 px Moon does not need it yet
    this.surface.buildRoots();
    this.group.visible = true;
  }

  _texture(url, srgb) {
    return new THREE.TextureLoader().loadAsync(this.ctx.assetUrl(url)).then((t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
      t.anisotropy = Math.min(8, this.ctx.renderer.capabilities.getMaxAnisotropy());
      return t;
    });
  }

  async _loadColor(size) {
    if (size <= this.colorSize || this._loading['c' + size]) return;
    this._loading['c' + size] = true;
    try {
      const t = await this._texture(`textures/moon/moon_color_${size}.jpg`, true);
      if (size > this.colorSize) { const old = this.uniforms.tColor.value; this.uniforms.tColor.value = t; this.colorSize = size; old?.dispose(); }
      else t.dispose();
    } catch (e) { console.warn('[Moon] colour', size, e); }
  }

  async _loadNormal(size) {
    if (size <= this.normalSize || this._loading['n' + size]) return;
    this._loading['n' + size] = true;
    try {
      const t = await this._texture(`textures/moon/moon_normal_${size}.jpg`, false);
      if (size > this.normalSize) { const old = this.uniforms.tNormal.value; this.uniforms.tNormal.value = t; this.uniforms.uHasNormal.value = 1; this.normalSize = size; old?.dispose(); }
      else t.dispose();
    } catch (e) { console.warn('[Moon] normal', size, e); }
  }

  /** Height above the 1737.4 km sphere (km) for a unit body-fixed direction (bilinear, 2048 x 1024 LOLA). */
  heightKmDir(d) {
    const H = this.height;
    if (!H) return 0;
    const lon = Math.atan2(d.y, d.x), lat = Math.asin(Math.max(-1, Math.min(1, d.z)));
    let x = (lon / (2 * Math.PI) + 0.5) * H.w - 0.5, y = (0.5 - lat / Math.PI) * H.h - 0.5;
    y = Math.max(0, Math.min(H.h - 1.001, y));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const xa = ((x0 % H.w) + H.w) % H.w, xb = (xa + 1) % H.w;
    const r0 = y0 * H.w, r1 = r0 + H.w;
    const D = H.data;
    return (D[r0 + xa] * (1 - fx) + D[r0 + xb] * fx) * (1 - fy) + (D[r1 + xa] * (1 - fx) + D[r1 + xb] * fx) * fy;
  }

  /** Height in metres above the reference sphere at selenographic latitude / east longitude (radians). */
  heightAt(lat, lon) { return 1000 * this.heightKmDir(_v.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat))); }

  /** Body-fixed surface point (km) at latitude / east longitude (radians). */
  surfacePoint(lat, lon, out = new THREE.Vector3()) {
    out.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
    return out.multiplyScalar(MOON_RADIUS_KM + this.heightKmDir(out));
  }

  /** Body-fixed vector -> far frame position (km). */
  bodyToFar(v, out = new THREE.Vector3()) { return out.copy(v).applyQuaternion(this.quaternion).add(this.centerFar); }

  setGain(g) { this.gain = g; this.uniforms.uGain.value = g; }

  update(dt, ctx) {
    const eph = ctx.ephemeris, o = ctx.orbit;
    if (!eph) return;
    const m = eph.bodies.moon;
    // position: Earth centre + geocentric Moon in the render frame
    _v.set(m.geo.x, m.geo.y, m.geo.z).applyQuaternion(o.skyQuat);
    this.centerFar.copy(o.earthCenterFar).add(_v);
    const r = m.rot;
    _m4.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
    _q.setFromRotationMatrix(_m4);
    this.quaternion.copy(o.skyQuat).multiply(_q);
    this.group.position.copy(this.centerFar);
    this.group.quaternion.copy(this.quaternion);
    const u = this.uniforms;
    // Sun and Earth directions in the body frame (ECI -> body: transpose)
    _eci.x = m.sunDir.x; _eci.y = m.sunDir.y; _eci.z = m.sunDir.z;
    applyMat3T(r, _eci); u.uSunB.value.set(_eci.x, _eci.y, _eci.z).normalize();
    const gl = Math.hypot(m.geo.x, m.geo.y, m.geo.z);
    _eci.x = -m.geo.x / gl; _eci.y = -m.geo.y / gl; _eci.z = -m.geo.z / gl;
    applyMat3T(r, _eci); u.uEarthB.value.set(_eci.x, _eci.y, _eci.z);
    u.uPhaseDeg.value = m.phase * 180 / Math.PI;
    // Earth's phase seen from the Moon = 180 deg - lunar phase; Lambert-sphere phase law
    const aE = Math.PI - m.phase;
    const phi = (Math.sin(aE) + (Math.PI - aE) * Math.cos(aE)) / Math.PI;
    const es = EARTHSHINE_FULL * phi * EARTHSHINE_EYE;
    u.uEarthshine.value.setRGB(es * 0.82, es * 0.92, es * 1.1);
    u.uSunColor.value.setRGB(1, 1, 1);
  }

  /** LOD selection, texture streaming and the camera uniform for this frame's far camera. */
  _select(camera) {
    if (!this.group.visible) return;
    camera.updateMatrixWorld();
    _qi.copy(this.quaternion).invert();
    const camB = _w.copy(camera.position).sub(this.centerFar).applyQuaternion(_qi);
    this.uniforms.uCamB.value.copy(camB);
    this.ctx.renderer.getDrawingBufferSize(_size);
    const fov = camera.fov * Math.PI / 180;
    const pxPerRad = _size.y / fov;
    // frustum in the body frame (slightly enlarged against one-frame lag of fast slews)
    _cam.copy(camera, false);
    _cam.fov = Math.min(170, camera.fov * 1.3); _cam.near = 1; _cam.far = 3e6; _cam.updateProjectionMatrix();
    _cam.position.copy(camB); _cam.quaternion.copy(_qi).multiply(camera.quaternion); _cam.updateMatrixWorld(true);
    _proj.multiplyMatrices(_cam.projectionMatrix, _cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_proj);
    this.surface.select(camB, pxPerRad, _frustum);
    for (const mesh of this.surface.drawn) mesh.updateMatrixWorld();
    // texture streaming by apparent diameter
    const dist = camB.length();
    const diamPx = 2 * Math.asin(Math.min(1, MOON_RADIUS_KM / dist)) * pxPerRad;
    this.apparentDiameterPx = diamPx;
    if (diamPx > 400) this._loadColor(Math.min(4096, this.maxColor));
    if (diamPx > 1500) this._loadColor(this.maxColor);
    if (this.maxNormal) {
      if (diamPx > 120) this._loadNormal(4096);
      if (diamPx > 1500) this._loadNormal(this.maxNormal);
    }
    this.uniforms.uRelief.value = !this.lite && this.heightTexture && diamPx > 250 ? 1 : 0;
  }

  dispose() {
    this.ctx.farScene.remove(this.group);
    this.surface.dispose();
    this.material.dispose();
    this.uniforms.tColor.value?.dispose(); this.uniforms.tNormal.value?.dispose(); this.heightTexture?.dispose();
  }
}
