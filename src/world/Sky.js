import * as THREE from 'three';
import { MILKYWAY_VERTEX, MILKYWAY_FRAGMENT } from './shaders/SkyShaders.js';
import { StarField, STAR_BUDGET, STAR_K } from './sky/StarField.js';
import { Planets } from './sky/Planets.js';
import { DeepSky } from './sky/DeepSky.js';
import { SkyOverlays } from './sky/Overlays.js';
import { Moon } from './Moon.js';
import { Ephemeris, ttFromUtcDays } from '../core/Ephemeris.js';

/**
 * FAR scene sky and solar-system bodies (everything beyond the Earth):
 *   - catalogue stars (sky/StarField.js: Hipparcos + Tycho-2 with Gaia DR3 photometry, physically based PSF),
 *   - the Milky Way (NASA SVS Deep Star Maps 2020 without the catalogue stars) + zodiacal light,
 *   - Sun-lit planets and the Galilean moons (sky/Planets.js: star-like points, textured discs when resolved),
 *   - the Moon (Moon.js: chunked LOD sphere, LOLA heights, LROC colour, earthshine),
 *   - deep-sky objects (sky/DeepSky.js, telescope only) and the overlays (sky/Overlays.js, key C).
 *
 * `ctx.ephemeris` (core/Ephemeris.js) is created here and updated every frame for the station position.
 * The sky group follows the far camera (stars at 1.5e6 km never show parallax) and is oriented by orbit.skyQuat
 * (ECI -> render frame). Solar-system bodies are placed relative to orbit.earthCenterFar (works with any origin).
 *
 * Brightness: one sky gain `gain` multiplies the physical radiance of stars, Milky Way and DSOs (see SkyShaders.js).
 * Normal view: gain = DARK_ADAPTED x adaptation, adaptation = post exposure's sky meter (sunlit Earth / station / Sun
 * in view dim the stars by up to ~6 mag). The telescope sets `telescope` = { stars, moon, planets, dso } gains.
 */

/** Gain of the dark-adapted eye relative to the physical (daylight-camera) scale of the far scene. */
const DARK_ADAPTED = 1.0e5;
/** Perceptual boost of extended faint light (spatial summation of the eye) for the Milky Way / zodiacal light. */
const MW_BOOST = 5;
/** Milky Way texel value -> physical HDR radiance (0.0015 = 23.7 mag / arcsec^2). */
const MW_PHYS = 8.7e-7;
/** Zodiacal light S10 unit -> physical HDR radiance. */
const ZODI_PHYS = 3.0e-11;
const MILKYWAY_RADIUS_KM = 1.4e6;
const MW_TEXTURES = { ultra: 8192, high: 8192, medium: 4096, low: 4096, lite: 2048 };

const _v = new THREE.Vector3();
const _size = new THREE.Vector2();

export class Sky {
  constructor(ctx) {
    this.ctx = ctx;
    const q = ctx.quality || {};
    this.lite = !!q.lite;
    this.preset = q.lite ? 'lite' : (q.preset || 'high');
    this.group = new THREE.Group();
    this.group.name = 'Sky';
    this.exposure = 1.0;            // adaptation from the post exposure (setExposure)
    this.gain = DARK_ADAPTED;       // current sky gain (read-only)
    this.telescope = null;          // { stars, moon, planets, dso, sigmaAiry } while the telescope drives the gains
    this.ephemeris = ctx.ephemeris = new Ephemeris();
    this.d = 0;                     // TT days since J2000 (updated per frame)

    this.starField = new StarField(ctx, { lite: this.lite });
    this.stars = this.starField.group;          // drawn straight onto the canvas by the 'lite' path (Post.js)
    this.group.add(this.stars);

    this.milkyWayMaterial = new THREE.ShaderMaterial({
      name: 'MilkyWay',
      uniforms: { uMap: { value: null }, uMwScale: { value: 0 }, uZodiScale: { value: 0 }, uSunEci: { value: new THREE.Vector3(1, 0, 0) } },
      vertexShader: MILKYWAY_VERTEX, fragmentShader: MILKYWAY_FRAGMENT,
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false,
    });
    this.milkyWay = new THREE.Mesh(new THREE.SphereGeometry(MILKYWAY_RADIUS_KM, 48, 24), this.milkyWayMaterial);
    this.milkyWay.name = 'MilkyWay';
    this.milkyWay.renderOrder = -30;
    this.milkyWay.frustumCulled = false;
    this.milkyWay.visible = false;
    this.group.add(this.milkyWay);

    ctx.farScene.add(this.group);
    // bodies live in the far scene directly (positioned from the Earth centre, not the sky group)
    this.planets = new Planets(ctx, this);
    this.moon = ctx.moon = new Moon(ctx, this);
    this.deepSky = new DeepSky(ctx, this);
    this.overlays = new SkyOverlays(ctx, this);
    this.stars.add(this.planets.points);        // planet points share the star material and the lite path
    this.group.add(this.deepSky.group, this.overlays.group);

    this.group.quaternion.copy(ctx.orbit.skyQuat);
    this._updateEphemeris(ctx);
  }

  async load() {
    const ctx = this.ctx;
    const size = Math.min(MW_TEXTURES[this.preset] || 4096, ctx.renderer.capabilities.maxTextureSize || 4096);
    const budget = Number(ctx.params?.get?.('stars')) || STAR_BUDGET[this.preset] || 100000;
    const [tex] = await Promise.all([
      new THREE.TextureLoader().loadAsync(ctx.assetUrl(`textures/sky/milkyway_${size}.jpg`)),
      this.starField.load(budget),
      this.planets.load(), this.moon.load(), this.overlays.load(), this.deepSky.load(),
    ]);
    tex.colorSpace = THREE.SRGBColorSpace;   // sRGB-encoded linear radiance
    tex.flipY = false;                       // v = 0 is the top row (north)
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = Math.min(4, ctx.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    this.milkyWayMaterial.uniforms.uMap.value = tex;
    this.milkyWayTexture = tex;
    this.milkyWay.visible = true;
    this.overlays.attachStars(this.starField);
  }

  /** Sky adaptation from the post exposure (1 = dark adapted, ~0.003 = sunlit Earth in view). */
  setExposure(x) {
    this.exposure = Math.max(0, x);
    this._applyGains();
  }

  /** Telescope camera gains (null = back to the eye model). */
  setTelescope(g) { this.telescope = g; this._applyGains(); }

  _updateEphemeris(ctx) {
    const o = ctx.orbit;
    this.d = ttFromUtcDays(o.daysSinceJ2000);
    this.ephemeris.update(this.d, o.positionEci);
  }

  _applyGains() {
    const ctx = this.ctx;
    const r = ctx.renderer;
    const tel = this.telescope;
    const S = tel ? tel.stars : DARK_ADAPTED * this.exposure;
    this.gain = S;
    r.getDrawingBufferSize(_size);
    const H = Math.max(1, _size.y);
    const cam = ctx.farCamera || ctx.camera;
    const fov = (cam?.fov ?? 70) * Math.PI / 180;
    const omegaPx = (fov / H) ** 2;
    const E = Math.max(0.05, r.toneMappingExposure || 1);
    const u = this.starField.uniforms;
    u.uFluxScale.value = STAR_K * S / omegaPx;
    const sigmaEye = Math.max(0.6, 0.75 * H / 1080);
    const airy = tel ? (tel.sigmaAiry || 0) / (fov / H) : 0;
    u.uSigma.value = Math.sqrt(sigmaEye * sigmaEye + airy * airy);
    u.uThreshold.value = 0.0026 / E;      // ACES maps exposed values below ~0.0022 to black
    u.uSaturate.value = 1.0 / E;           // core peak (HDR) at display white: brighter cores spread (perceived size)
    if (!this._maxPoint) { try { const gl = r.getContext(); this._maxPoint = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] || 64; } catch (_) { this._maxPoint = 64; } }
    u.uMaxSize.value = Math.min(96, this._maxPoint);
    const mw = this.milkyWayMaterial.uniforms;
    const Smw = tel ? tel.dso : S;
    mw.uMwScale.value = MW_PHYS * Smw * MW_BOOST;
    mw.uZodiScale.value = ZODI_PHYS * Smw * MW_BOOST;
    // skip the full-screen Milky Way pass (and the stars) when the exposure makes them invisible
    if (this.milkyWayTexture) this.milkyWay.visible = 0.05 * mw.uMwScale.value * E > 1.5e-3;
    this.stars.visible = STAR_K * S / omegaPx * 30 > u.uThreshold.value;   // Venus-class objects still show
    this.planets.setGains(S, tel ? tel.planets : 1, E);
    this.moon.setGain(tel ? tel.moon : 1);
    this.deepSky.setGain(tel ? tel.dso : 0, E);
  }

  update(dt, ctx) {
    const o = ctx.orbit;
    this._updateEphemeris(ctx);
    this.group.quaternion.copy(o.skyQuat);
    if (ctx.farCamera) this.group.position.copy(ctx.farCamera.position);
    // Sun direction (ECI) for the zodiacal light
    const sun = this.ephemeris.bodies.sun.topo;
    this.milkyWayMaterial.uniforms.uSunEci.value.set(sun.x, sun.y, sun.z).normalize();
    if (this.lite) {
      const u = this.starField.uniforms;
      const cam = ctx.farCamera ? ctx.farCamera.position : _v.set(0, 0, 0);
      u.uEarthCenter.value.copy(o.earthCenterFar).sub(cam);
      const m = this.moon.centerFar;
      u.uMoon.value.set(m.x - cam.x, m.y - cam.y, m.z - cam.z, this.moon.radius);
    }
    this.planets.update(dt, ctx);
    this.moon.update(dt, ctx);
    this.deepSky.update(dt, ctx);
    this.overlays.update(dt, ctx);
    this._applyGains();
  }

  dispose() {
    this.ctx.farScene.remove(this.group);
    this.starField.dispose();
    this.milkyWay.geometry.dispose();
    this.milkyWayMaterial.dispose();
    this.milkyWayTexture?.dispose();
    this.planets.dispose(); this.moon.dispose(); this.deepSky.dispose(); this.overlays.dispose();
  }
}
