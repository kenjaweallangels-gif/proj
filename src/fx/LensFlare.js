import * as THREE from 'three';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { smoothstep } from './Exposure.js';

/**
 * Screen-space Sun lens flare. A custom post pass that renders an overlay THREE.Scene (orthographic,
 * NDC space) additively on top of the HDR frame after bloom: an anamorphic horizontal streak, a soft
 * glow, a rainbow halo and a chain of ghost discs / rings / hexagons along the line from the Sun through
 * the screen centre. All elements are procedural ShaderMaterials (no textures).
 *
 * Intensity = orbit.sunVisible x in-frustum factor (fading at the edges) x occlusion, where occlusion is
 * an analytic ray test from the camera toward the Sun against the station and ship colliders
 * (sphere / capsule / oriented box), with 5 rays spread over the Sun's disc for a soft result. The
 * visibility is smoothed over ~0.15 s (snapped on a camera cut).
 */

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _oc = new THREE.Vector3();
const _ba = new THREE.Vector3();
const _oa = new THREE.Vector3();
const _ol = new THREE.Vector3();
const _dl = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _tmp = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------------
// Ray vs collider. The Sun is at infinity, so a primitive occludes when the half-line hits it anywhere
// ahead of the origin (including when the origin is inside it).
// ---------------------------------------------------------------------------------------------------

function raySphere(o, d, c, r) {
  _oc.copy(o).sub(c);
  const b = _oc.dot(d);
  const cc = _oc.lengthSq() - r * r;
  const disc = b * b - cc;
  if (disc < 0) return false;
  return -b + Math.sqrt(disc) > 0;      // exit point ahead
}

function rayCapsule(o, d, a, b, r) {
  _ba.copy(b).sub(a);
  _oa.copy(o).sub(a);
  const baba = _ba.dot(_ba), bard = _ba.dot(d), baoa = _ba.dot(_oa), rdoa = d.dot(_oa), oaoa = _oa.dot(_oa);
  const A = baba - bard * bard;
  const B = baba * rdoa - baoa * bard;
  const Cc = baba * oaoa - baoa * baoa - r * r * baba;
  if (A > 1e-9) {
    const h = B * B - A * Cc;
    if (h >= 0) {
      const sq = Math.sqrt(h);
      const t0 = (-B - sq) / A, t1 = (-B + sq) / A;
      // a hit on the cylinder body ahead of the origin, within the segment
      const y0 = baoa + t0 * bard, y1 = baoa + t1 * bard;
      if (t0 > 0 && y0 > 0 && y0 < baba) return true;
      if (t1 > 0 && y1 > 0 && y1 < baba) return true;
    }
  }
  // spherical caps
  return raySphere(o, d, a, r) || raySphere(o, d, b, r);
}

function rayBox(o, d, center, half, quaternion) {
  _ol.copy(o).sub(center);
  _dl.copy(d);
  if (quaternion) {
    _qi.copy(quaternion).invert();
    _ol.applyQuaternion(_qi);
    _dl.applyQuaternion(_qi);
  }
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    const oi = _ol.getComponent(i), di = _dl.getComponent(i), hi = half.getComponent(i);
    if (Math.abs(di) < 1e-9) {
      if (Math.abs(oi) > hi) return false;
    } else {
      let t1 = (-hi - oi) / di, t2 = (hi - oi) / di;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  return tmax > 0;
}

/** True when the half-line (o, d) hits the collider. */
export function rayHitsCollider(o, d, c) {
  if (!c) return false;
  switch (c.type) {
    case 'sphere': return !!c.center && raySphere(o, d, c.center, c.radius || 0);
    case 'capsule': return !!(c.a && c.b) && rayCapsule(o, d, c.a, c.b, c.radius || 0);
    case 'box': return !!(c.center && c.halfSize) && rayBox(o, d, c.center, c.halfSize, c.quaternion);
    default: return false;
  }
}

// ---------------------------------------------------------------------------------------------------
// Shaders. vUv is remapped to [-1, 1] over the element quad.
// ---------------------------------------------------------------------------------------------------

const ELEMENT_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/** Ghost: soft disc or ring, round or polygonal (aperture blades), with a slight rainbow edge. */
const GHOST_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity, uRing, uSides, uChroma;
varying vec2 vUv;
float polyR(vec2 p, float n) {
  float a = atan(p.y, p.x);
  float seg = 6.28318530718 / n;
  return cos(floor(0.5 + a / seg) * seg - a) * length(p);
}
float shape(float r, float ring) {
  float disc = 1.0 - smoothstep(0.84, 1.0, r);
  float body = disc * (0.3 + 0.7 * (1.0 - r * r));
  float rim = disc * smoothstep(0.5, 0.96, r);
  return mix(body, rim, ring);
}
void main() {
  float r = uSides > 2.5 ? polyR(vUv, uSides) : length(vUv);
  vec3 c;
  c.r = shape(r * (1.0 - uChroma), uRing);
  c.g = shape(r, uRing);
  c.b = shape(r * (1.0 + uChroma), uRing);
  gl_FragColor = vec4(uColor * uIntensity * c, 1.0);
}`;

/** Anamorphic streak: wide, thin, blue-ish, with a white core. */
const STREAK_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float x = abs(vUv.x);
  float y = vUv.y;
  float wide = exp(-x * 4.0) * exp(-y * y * 4.0);
  float core = exp(-x * 16.0) * exp(-y * y * 90.0);
  float ripple = 0.88 + 0.12 * cos(x * 55.0 + 0.7);
  vec3 blue = vec3(0.45, 0.68, 1.0);
  vec3 col = blue * wide * 0.45 * ripple + mix(vec3(1.0), blue, smoothstep(0.0, 0.3, x)) * core * 0.6;
  gl_FragColor = vec4(col * uColor * uIntensity, 1.0);
}`;

/** Rainbow halo ring (red outside, blue inside) plus a faint fill. */
const HALO_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float w = 0.075;
  float rr = exp(-pow((r - 0.86) / w, 2.0));
  float gg = exp(-pow((r - 0.81) / w, 2.0));
  float bb = exp(-pow((r - 0.76) / w, 2.0));
  vec3 col = vec3(rr, gg, bb) * 0.8 + vec3(0.1) * (1.0 - smoothstep(0.0, 0.8, r));
  gl_FragColor = vec4(col * uColor * uIntensity, 1.0);
}`;

/** Soft warm glow around the Sun. */
const GLOW_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float g = exp(-r * r * 5.0) * (1.0 - smoothstep(0.6, 1.0, r));
  gl_FragColor = vec4(uColor * vec3(1.0, 0.93, 0.82) * uIntensity * g, 1.0);
}`;

/** Ghost chain: `pos` = multiple of the Sun's NDC position (negative = across the centre), `size` in half-height units. */
const GHOSTS = [
  { pos: 0.62, size: 0.03, ring: 0, sides: 6, color: [1.0, 0.85, 0.65], intensity: 0.14, chroma: 0.02 },
  { pos: 0.38, size: 0.07, ring: 1, sides: 0, color: [0.55, 0.9, 0.75], intensity: 0.05, chroma: 0.05 },
  { pos: 0.12, size: 0.045, ring: 0, sides: 6, color: [1.0, 0.7, 0.55], intensity: 0.07, chroma: 0.03 },
  { pos: -0.22, size: 0.1, ring: 1, sides: 0, color: [0.45, 0.65, 1.0], intensity: 0.035, chroma: 0.06 },
  { pos: -0.48, size: 0.035, ring: 0, sides: 6, color: [0.9, 0.95, 1.0], intensity: 0.09, chroma: 0.02 },
  { pos: -0.78, size: 0.15, ring: 1, sides: 0, color: [0.55, 0.85, 1.0], intensity: 0.022, chroma: 0.07 },
  { pos: -1.15, size: 0.055, ring: 0, sides: 8, color: [1.0, 0.6, 0.75], intensity: 0.05, chroma: 0.03 },
  { pos: -1.6, size: 0.08, ring: 0, sides: 6, color: [0.6, 1.0, 0.7], intensity: 0.025, chroma: 0.04 },
];

const BASE_MATERIAL = { vertexShader: ELEMENT_VERT, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false };

export class LensFlarePass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.aspect = 16 / 9;

    /** User scale for the whole effect. */
    this.intensity = 1.0;
    /** Smoothing time of the visibility (seconds). */
    this.tau = 0.15;
    /** Angular radius (radians) of the soft occlusion ray spread (~ the Sun's disc). */
    this.spread = 0.3 * Math.PI / 180;

    // state
    this.visibility = 0;       // smoothed, 0..1
    this.targetVisibility = 0;
    this.sunUnoccluded = 1;    // instantaneous fraction of rays that reach the Sun
    this.inView = 0;
    this.sunNdc = new THREE.Vector2();
    this.sunAhead = false;
    this.sunColor = new THREE.Color(1, 1, 1);
    this._first = true;

    const geo = new THREE.PlaneGeometry(2, 2);
    this.geometry = geo;
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ ...BASE_MATERIAL, fragmentShader: frag, uniforms });
    const col = () => ({ value: new THREE.Color(1, 1, 1) });

    this.streak = new THREE.Mesh(geo, mk(STREAK_FRAG, { uColor: col(), uIntensity: { value: 0 } }));
    this.glow = new THREE.Mesh(geo, mk(GLOW_FRAG, { uColor: col(), uIntensity: { value: 0 } }));
    this.halo = new THREE.Mesh(geo, mk(HALO_FRAG, { uColor: col(), uIntensity: { value: 0 } }));
    this.ghosts = GHOSTS.map((g) => {
      const m = new THREE.Mesh(geo, mk(GHOST_FRAG, {
        uColor: { value: new THREE.Color(g.color[0], g.color[1], g.color[2]) }, uIntensity: { value: 0 },
        uRing: { value: g.ring }, uSides: { value: g.sides }, uChroma: { value: g.chroma },
      }));
      m.userData.cfg = g;
      return m;
    });
    this.elements = [this.streak, this.glow, this.halo, ...this.ghosts];
    for (const e of this.elements) { e.frustumCulled = false; e.renderOrder = 0; this.scene.add(e); }
    this.streakLength = 2.4;   // NDC half-width of the streak quad
    this.streakHeight = 0.11;  // NDC half-height
    this.haloRadius = 0.42;    // half-height units
    this.glowRadius = 0.2;
  }

  setSize(w, h) { this.aspect = h > 0 ? w / h : 1; }

  /**
   * Fraction (0..1) of the Sun visible from the camera through the station / ship colliders.
   * Cheap analytic ray tests; call every frame before update().
   */
  computeOcclusion(ctx) {
    const camera = ctx.camera, o = ctx.orbit;
    if (!camera || !o) return 1;
    // colliders live in the station frame: test from the camera position / Sun direction in that frame
    const u = ctx.universe;
    if (u && !u.station.visible) { this.sunUnoccluded = 1; return 1; }
    let sun = o.sunDir;
    if (u && !u.isStationFrame) { u.cameraInStation(_o, camera); sun = o.local.sunDir; }
    else camera.getWorldPosition(_o);
    // basis perpendicular to the Sun direction for the ray spread
    _tmp.set(0, 1, 0);
    if (Math.abs(sun.dot(_tmp)) > 0.9) _tmp.set(1, 0, 0);
    _u.crossVectors(sun, _tmp).normalize();
    _v.crossVectors(sun, _u).normalize();
    const lists = [];
    if (ctx.station?.colliders?.length) lists.push(ctx.station.colliders);
    if (ctx.station?.airlock?.interiorColliders?.length) lists.push(ctx.station.airlock.interiorColliders);
    const ships = ctx.ships?.ships;
    if (ships) for (const s of ships) if (s?.colliders?.length) lists.push(s.colliders);
    if (!lists.length) return 1;
    const N = 5;
    let clear = 0;
    for (let k = 0; k < N; k++) {
      if (k === 0) _d.copy(sun);
      else {
        const ang = (k - 1) * Math.PI * 0.5 + 0.4;
        _d.copy(sun).addScaledVector(_u, Math.cos(ang) * this.spread).addScaledVector(_v, Math.sin(ang) * this.spread).normalize();
      }
      let hit = false;
      for (let li = 0; li < lists.length && !hit; li++) {
        const list = lists[li];
        for (let i = 0; i < list.length; i++) { if (rayHitsCollider(_o, _d, list[i])) { hit = true; break; } }
      }
      if (!hit) clear++;
    }
    this.sunUnoccluded = clear / N;
    return this.sunUnoccluded;
  }

  /**
   * Places the elements for this frame.
   * `sunNdc` / `sunAhead` from projectDirection(); `sunVisible` = orbit.sunVisible; `cut` snaps the smoothing.
   */
  update(dt, { sunNdc, sunAhead, sunVisible = 1, sunColor = null, cut = false }) {
    this.sunNdc.copy(sunNdc);
    this.sunAhead = sunAhead;
    if (sunColor) this.sunColor.copy(sunColor);
    let inView = 0;
    if (sunAhead) {
      const e = Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y));
      inView = 1 - smoothstep(1.0, 1.45, e);
    }
    this.inView = inView;
    this.targetVisibility = sunVisible * inView * this.sunUnoccluded;
    if (cut || this._first) this.visibility = this.targetVisibility;
    else this.visibility += (this.targetVisibility - this.visibility) * (1 - Math.exp(-Math.max(dt, 0) / this.tau));
    this._first = false;

    const vis = this.visibility * this.intensity;
    this.enabled = vis > 0.002;
    if (!this.enabled) return;
    const a = this.aspect || 1;
    const sx = sunNdc.x, sy = sunNdc.y;
    const c = this.sunColor;
    // ghosts are strongest with the Sun near the centre of the frame
    const centred = 0.55 + 0.45 * (1 - Math.min(1, Math.hypot(sx, sy)));

    this.streak.position.set(sx, sy, 0);
    this.streak.scale.set(this.streakLength, this.streakHeight, 1);
    this.streak.material.uniforms.uIntensity.value = 0.9 * vis;
    this.streak.material.uniforms.uColor.value.copy(c);

    this.glow.position.set(sx, sy, 0);
    this.glow.scale.set(this.glowRadius / a, this.glowRadius, 1);
    this.glow.material.uniforms.uIntensity.value = 0.45 * vis;
    this.glow.material.uniforms.uColor.value.copy(c);

    this.halo.position.set(sx, sy, 0);
    this.halo.scale.set(this.haloRadius / a, this.haloRadius, 1);
    this.halo.material.uniforms.uIntensity.value = 0.07 * vis;
    this.halo.material.uniforms.uColor.value.copy(c);

    for (const g of this.ghosts) {
      const cfg = g.userData.cfg;
      g.position.set(sx * cfg.pos, sy * cfg.pos, 0);
      g.scale.set(cfg.size / a, cfg.size, 1);
      g.material.uniforms.uIntensity.value = cfg.intensity * vis * centred;
      g.material.uniforms.uColor.value.setRGB(cfg.color[0], cfg.color[1], cfg.color[2]).multiply(c);
    }
  }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    if (!this.enabled) return;
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = oldAutoClear;
  }

  dispose() {
    this.geometry.dispose();
    for (const e of this.elements) e.material.dispose();
  }
}
