import * as THREE from 'three';
import { STAR_VERTEX, STAR_FRAGMENT } from '../shaders/SkyShaders.js';
import { STAR_DISTANCE_KM } from './StarCatalog.js';
import { PLANETS, GALILEAN, BODY_DATA, AU_KM } from '../../core/Ephemeris.js';
import { bvToLinearRgb } from '../StarColor.js';

/**
 * Planets (Mercury..Neptune) and the Galilean moons.
 *
 *  - `points`: one star-like point per body (child of the sky's star group: same PSF / gain as the catalogue stars and
 *    drawn by the 'lite' direct path), magnitude from the ephemeris (Mallama & Hilton phase curves).
 *  - discs: lit textured ellipsoids, shown once the apparent radius exceeds ~0.7 device px (telescope zoom). Proxy
 *    placement: each body sits at PROXY_KM from the far camera along its true topocentric direction, scaled to keep
 *    its angular size (the far camera's range ends at 2.5e6 km). The Moon (384 000 km) and the Earth are nearer, so
 *    occultations draw correctly; the Sun quad sits farther (1e6 km).
 *  - Saturn's rings (Solar System Scope strip: r = 69 700 + u x 71 250 km) with the planet's shadow on the rings and
 *    the rings' shadow on the globe; correct tilt from the IAU pole.
 * Lighting comes from the true heliocentric direction (phase); radiance = 1.5 x geometric albedo (Lambert / Minnaert)
 * x 1.45 / r_au^2, so a resolved disc carries the same flux as its point (smooth cross-fade).
 * Maps (textures/planets, Solar System Scope CC BY 4.0; Jupiter: Cassini PIA07782) load on demand.
 */

const PROXY_KM = 8.0e5;
const MAPS = {
  mercury: { file: 'mercury_2048.jpg', mean: 0.228, sat: 1.0, k: 1.0 },
  venus: { file: 'venus_clouds_2048.jpg', mean: 0.556, sat: 0.35, k: 0.85 },
  mars: { file: 'mars_2048.jpg', mean: 0.182, sat: 0.85, k: 1.0 },
  jupiter: { file: 'jupiter_cassini_3600.jpg', mean: 0.364, sat: 1.0, k: 0.85 },
  saturn: { file: 'saturn_2048.jpg', mean: 0.616, sat: 0.8, k: 0.85 },
  uranus: { file: 'uranus_2048.jpg', mean: 0.564, sat: 0.7, k: 0.8 },
  neptune: { file: 'neptune_2048.jpg', mean: 0.123, sat: 0.6, k: 0.8 },
};
const RING_INNER_KM = 69700, RING_SPAN_KM = 71250;

const PLANET_VERTEX = /* glsl */`
varying vec3 vLocal;     // unit-sphere position (mesh local, y = pole)
varying vec3 vNormalV, vViewV;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);   // inverse transpose: correct for the flattened (scaled) globe
  vViewV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const PLANET_FRAGMENT = /* glsl */`
uniform sampler2D tMap;
uniform sampler2D tRing;
uniform float uHasMap, uHasRing, uRadiance, uGain, uMean, uSat, uK, uFlat, uFade;
uniform vec3 uTint;
uniform vec3 uSunW;          // far-frame direction to the Sun
uniform vec3 uSunL;          // the same in mesh-local units (y = pole)
uniform vec2 uRing;          // inner, span in equatorial radii
varying vec3 vLocal;
varying vec3 vNormalV, vViewV;
#define PI 3.14159265359
void main() {
  vec3 N = normalize(vNormalV), V = normalize(vViewV);
  vec3 L = normalize(mat3(viewMatrix) * uSunW);
  float mu0 = dot(N, L), mu = max(dot(N, V), 1.0e-3);
  vec3 alb = uTint;
  if (uHasMap > 0.5) {
    vec3 p = normalize(vLocal);
    float lon = atan(-p.z, p.x);
    vec2 uv = vec2(lon / (2.0 * PI) + 0.5, asin(clamp(p.y, -1.0, 1.0)) / PI + 0.5);
    vec3 t = texture2D(tMap, uv).rgb / uMean;
    float y = dot(t, vec3(0.2126, 0.7152, 0.0722));
    alb = mix(vec3(y), t, uSat) * dot(uTint, vec3(0.2126, 0.7152, 0.0722));
  }
  // Minnaert limb darkening (k = 1: Lambert); terminator softened over the scattering in the upper haze
  float lit = mu0 > 0.0 ? pow(mu0, uK) * pow(mu, uK - 1.0) : 0.0;
  // rings' shadow on the globe
  if (uHasRing > 0.5 && mu0 > 0.0) {
    vec3 P = vLocal * vec3(1.0, uFlat, 1.0);
    if (abs(uSunL.y) > 1.0e-4) {
      float t = -P.y / uSunL.y;
      if (t > 0.0) {
        vec3 H = P + uSunL * t;
        float r = length(H.xz);
        float u = (r - uRing.x) / uRing.y;
        if (u > 0.0 && u < 1.0) lit *= 1.0 - 0.9 * texture2D(tRing, vec2(u, 0.5)).a;
      }
    }
  }
  vec3 col = alb * uRadiance * lit * uGain * uFade;
  gl_FragColor = vec4(col, 1.0);
}`;

const RING_VERTEX = /* glsl */`
varying vec3 vLocal;
varying vec3 vPosW;
void main() {
  vLocal = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const RING_FRAGMENT = /* glsl */`
uniform sampler2D tRing;
uniform float uRadiance, uGain, uFlat, uFade;
uniform vec2 uRing;
uniform vec3 uSunL;          // mesh local (y = pole), unit
uniform vec3 uCamL;          // camera position in mesh-local units
varying vec3 vLocal;
varying vec3 vPosW;
void main() {
  float r = length(vLocal.xz);
  float u = (r - uRing.x) / uRing.y;
  if (u <= 0.0 || u >= 1.0) discard;
  vec4 t = texture2D(tRing, vec2(u, 0.5));
  // planet shadow: ray toward the Sun against the (flattened) globe
  vec3 P = vLocal, S = uSunL;
  vec3 Ps = P * vec3(1.0, 1.0 / uFlat, 1.0), Ss = S * vec3(1.0, 1.0 / uFlat, 1.0);
  float b = dot(Ps, Ss), c = dot(Ps, Ps) - 1.0, a = dot(Ss, Ss);
  float disc = b * b - a * c;
  float shadow = (disc > 0.0 && -b - sqrt(disc) > 0.0) ? 0.04 : 1.0;
  // lit face vs unlit face (light diffusing through the ring particles)
  float sunSide = sign(S.y), camSide = sign(uCamL.y - P.y);
  float mu0 = abs(S.y);
  float lit = sunSide == camSide ? (0.35 + 0.65 * sqrt(mu0)) : 0.6 * (1.0 - t.a) * t.a + 0.05;
  vec3 col = t.rgb * 1.3 * uRadiance * lit * shadow * uGain * uFade;
  gl_FragColor = vec4(col * t.a, t.a * uFade);
}`;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _qRx90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
const _sun = new THREE.Vector3();
const _size = new THREE.Vector2();

export class Planets {
  constructor(ctx, sky) {
    this.ctx = ctx;
    this.sky = sky;
    this.names = [...PLANETS, ...GALILEAN];
    this.group = new THREE.Group();
    this.group.name = 'Planets';
    // --- points (in the sky group frame: ECI x STAR_DISTANCE)
    const n = this.names.length;
    this.pointPos = new Float32Array(n * 3);
    this.pointStar = new Uint8Array(n * 4);
    const rgb = [0, 0, 0];
    this.names.forEach((name, i) => {
      bvToLinearRgb(BODY_DATA[name].bv, rgb);
      const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      for (let k = 0; k < 3; k++) this.pointStar[i * 4 + k] = Math.min(255, Math.round(rgb[k] / y * 0.5 * 255));
    });
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pointPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.starAttr = new THREE.BufferAttribute(this.pointStar, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aStar', this.starAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), STAR_DISTANCE_KM * 1.01);
    // planet magnitudes reach -4.9: their V code is offset by 4 (code = (V + 6) x 16)
    const sf = sky.starField;
    this.pointMaterial = new THREE.ShaderMaterial({
      name: 'PlanetPoints', uniforms: sf.uniforms, defines: sky.lite ? { EARTH_OCCLUSION: 1 } : {},
      vertexShader: STAR_VERTEX.replace('aStar.w / 16.0 - 2.0', 'aStar.w / 16.0 - 6.0'), fragmentShader: STAR_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false,
    });
    this.points = new THREE.Points(geo, this.pointMaterial);
    this.points.name = 'PlanetPoints';
    this.points.frustumCulled = false;
    this.points.renderOrder = -19;

    // --- discs
    this.discs = {};
    this.textures = {};
    const sphere = new THREE.SphereGeometry(1, 96, 48);
    this.sphere = sphere;
    for (const name of this.names) {
      const d = BODY_DATA[name];
      const tint = new THREE.Color();
      bvToLinearRgb(d.bv, rgb);
      const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      tint.setRGB(rgb[0] / y, rgb[1] / y, rgb[2] / y);
      const map = MAPS[name];
      const uniforms = {
        tMap: { value: null }, tRing: { value: null }, uHasMap: { value: 0 }, uHasRing: { value: 0 },
        uRadiance: { value: 0 }, uGain: { value: 1 }, uMean: { value: map ? map.mean : 1 }, uSat: { value: map ? map.sat : 1 },
        uK: { value: map ? map.k : 1 }, uFlat: { value: d.polarRadius / d.radius }, uFade: { value: 0 }, uTint: { value: tint },
        uSunW: { value: new THREE.Vector3() }, uSunL: { value: new THREE.Vector3() },
        uRing: { value: new THREE.Vector2(RING_INNER_KM / d.radius, RING_SPAN_KM / d.radius) },
      };
      const mat = new THREE.ShaderMaterial({ name: `Planet_${name}`, uniforms, vertexShader: PLANET_VERTEX, fragmentShader: PLANET_FRAGMENT, toneMapped: false });
      const mesh = new THREE.Mesh(sphere, mat);
      mesh.name = `Planet_${name}`;
      mesh.visible = false;
      mesh.frustumCulled = true;
      mesh.renderOrder = -10;
      this.group.add(mesh);
      const disc = { name, mesh, mat, data: d, albedo: d.albedo * 1.5, rPx: 0, ring: null };
      if (name === 'saturn') {
        const ringGeo = new THREE.RingGeometry(RING_INNER_KM / d.radius, (RING_INNER_KM + RING_SPAN_KM) / d.radius, 256, 1);
        ringGeo.rotateX(-Math.PI / 2);   // ring plane = mesh-local xz (y = pole)
        const ru = {
          tRing: { value: null }, uRadiance: { value: 0 }, uGain: uniforms.uGain, uFlat: uniforms.uFlat, uFade: uniforms.uFade,
          uRing: uniforms.uRing, uSunL: uniforms.uSunL, uCamL: { value: new THREE.Vector3() },
        };
        const rmat = new THREE.ShaderMaterial({
          name: 'SaturnRings', uniforms: ru, vertexShader: RING_VERTEX, fragmentShader: RING_FRAGMENT,
          transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
          blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        });
        const ring = new THREE.Mesh(ringGeo, rmat);
        ring.name = 'SaturnRings';
        ring.renderOrder = -9;
        mesh.add(ring);
        disc.ring = { mesh: ring, mat: rmat };
      }
      this.discs[name] = disc;
    }
    ctx.farScene.add(this.group);
    this.gainPoints = 1; this.gainDiscs = 1;
  }

  async load() {
    // the ring texture is tiny: load it up front (the globe maps load on demand)
    try {
      const t = await new THREE.TextureLoader().loadAsync(this.ctx.assetUrl('textures/planets/saturn_ring_2048x64.png'));
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      this.ringTexture = t;
      const s = this.discs.saturn;
      s.mat.uniforms.tRing.value = t; s.mat.uniforms.uHasRing.value = 1; s.ring.mat.uniforms.tRing.value = t;
    } catch (e) { console.warn('[Planets] ring texture', e); }
  }

  _loadMap(name) {
    if (this.textures[name] || !MAPS[name]) return;
    this.textures[name] = 'loading';
    new THREE.TextureLoader().loadAsync(this.ctx.assetUrl(`textures/planets/${MAPS[name].file}`)).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.anisotropy = Math.min(8, this.ctx.renderer.capabilities.getMaxAnisotropy());
      this.textures[name] = t;
      const u = this.discs[name].mat.uniforms; u.tMap.value = t; u.uHasMap.value = 1;
    }).catch((e) => { console.warn('[Planets] map', name, e); });
  }

  /** Gains: points share the star gain; discs get `discs` (telescope: local adaptation per body). */
  setGains(points, discs, exposure) { this.gainPoints = points; this.gainDiscs = discs; this._exposure = exposure; }

  update(dt, ctx) {
    const eph = ctx.ephemeris;
    if (!eph) return;
    const o = ctx.orbit;
    const cam = ctx.farCamera;
    ctx.renderer.getDrawingBufferSize(_size);
    const fov = (cam?.fov ?? 70) * Math.PI / 180;
    const pxPerRad = _size.y / fov;
    const camPos = cam ? cam.position : _v.set(0, 0, 0);
    this.names.forEach((name, i) => {
      const b = eph.bodies[name];
      const inv = 1 / b.dist;
      const x = b.topo.x * inv, y = b.topo.y * inv, z = b.topo.z * inv;
      this.pointPos[i * 3] = x * STAR_DISTANCE_KM; this.pointPos[i * 3 + 1] = y * STAR_DISTANCE_KM; this.pointPos[i * 3 + 2] = z * STAR_DISTANCE_KM;
      const disc = this.discs[name];
      const rPx = b.angRadius * pxPerRad;
      disc.rPx = rPx;
      // the point fades out while the disc fades in (the disc takes over the flux)
      const fadeDisc = THREE.MathUtils.smoothstep(rPx, 0.6, 1.6);
      let mag = b.mag - 2.5 * Math.log10(Math.max(1e-4, 1 - fadeDisc));
      if (b.occulted) mag = 99;
      this.pointStar[i * 4 + 3] = Math.max(0, Math.min(255, Math.round((mag + 6) * 16)));
      // disc
      const show = fadeDisc > 0.001 && !b.occulted;
      disc.mesh.visible = show;
      if (!show) return;
      if (rPx > 2.5) this._loadMap(name);
      const mesh = disc.mesh;
      // proxy distance along the true direction (ECI -> far frame)
      _v.set(x, y, z).applyQuaternion(o.skyQuat);
      mesh.position.copy(camPos).addScaledVector(_v, PROXY_KM);
      const s = disc.data.radius * PROXY_KM / b.dist;
      mesh.scale.set(s, s * disc.data.polarRadius / disc.data.radius, s);
      // orientation: mesh local (y = pole, x = lon 0, -z = lon 90E) -> body -> ECI -> far frame
      const r = b.rot;
      _m4.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
      _q.setFromRotationMatrix(_m4);
      mesh.quaternion.copy(o.skyQuat).multiply(_q).multiply(_qRx90);
      const u = disc.mat.uniforms;
      _sun.set(b.sunDir.x, b.sunDir.y, b.sunDir.z).applyQuaternion(o.skyQuat);
      u.uSunW.value.copy(_sun);
      _q.copy(mesh.quaternion).invert();
      u.uSunL.value.copy(_sun).applyQuaternion(_q);
      const rAu = Math.hypot(b.helio.x, b.helio.y, b.helio.z) / AU_KM;
      u.uRadiance.value = 1.45 * disc.albedo / (rAu * rAu);
      u.uGain.value = this.gainDiscs;
      u.uFade.value = fadeDisc;
      if (disc.ring) {
        disc.ring.mat.uniforms.uRadiance.value = u.uRadiance.value * 0.6 / disc.albedo;
        // camera in mesh-local units (unscaled: divide by the radius scale)
        _v.copy(camPos).sub(mesh.position).applyQuaternion(_q);
        disc.ring.mat.uniforms.uCamL.value.set(_v.x / s, _v.y / s, _v.z / s);
      }
    });
    this.posAttr.needsUpdate = true;
    this.starAttr.needsUpdate = true;
  }

  /** Apparent radius in device px of a body's disc (last frame). */
  radiusPx(name) { return this.discs[name]?.rPx ?? 0; }

  dispose() {
    this.ctx.farScene.remove(this.group);
    this.points.geometry.dispose(); this.pointMaterial.dispose();
    this.sphere.dispose();
    for (const d of Object.values(this.discs)) { d.mat.dispose(); if (d.ring) { d.ring.mesh.geometry.dispose(); d.ring.mat.dispose(); } }
    for (const t of Object.values(this.textures)) if (t && t.dispose) t.dispose();
    this.ringTexture?.dispose();
  }
}
