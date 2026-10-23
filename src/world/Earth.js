import * as THREE from 'three';
import { EARTH_RADIUS_KM } from '../core/constants.js';
import { SPHERE_VERTEX, GROUND_FRAGMENT, CLOUD_FRAGMENT, SHELL_FRAGMENT } from './shaders/EarthShaders.js';
import { QUAD_VERTEX, SUN_DISC_FRAGMENT, SUN_CORONA_FRAGMENT, MOON_VERTEX, MOON_FRAGMENT } from './shaders/SunMoonShaders.js';

/**
 * FAR scene (kilometres): the Earth (ground / clouds / atmosphere shell with custom GLSL),
 * the Sun (HDR disc + corona, occluded by the Earth through depth) and the Moon.
 * Orientation comes from ctx.orbit every frame; the Earth centre is ctx.orbit.earthCenterFar.
 */

const SUN_DISTANCE_KM = 1.0e6;
const SUN_ANGULAR_RADIUS = (0.53 / 2) * Math.PI / 180;
const MOON_RADIUS_KM = 1737.4;
const CLOUD_ALTITUDE_KM = 6;
const ATMO_ALTITUDE_KM = 100;
/** Cloud drift relative to the surface (rad/s). Real winds are ~5e-6 rad/s; kept a bit faster so the drift is perceptible. */
const CLOUD_DRIFT_RATE = 3.0e-5;
/** Full-Moon radiance on a white Lambert surface, in the scene's HDR units (a night-adapted camera, not the physical 1/400000 of sunlight). */
const MOON_LIGHT_MAX = 0.035;

/** Ray-march sample counts per quality preset: [atmosphere shell, ground aerial perspective, clouds]. */
const SAMPLES = { ultra: [24, 8, 6], high: [16, 6, 5], medium: [12, 5, 4], low: [8, 4, 3] };

const _q = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export class Earth {
  constructor(ctx) {
    this.ctx = ctx;
    const o = ctx.orbit;
    const [nShell, nGround, nCloud] = SAMPLES[ctx.quality.preset] || SAMPLES.high;
    this.group = new THREE.Group();
    this.group.name = 'Earth';
    this.cloudAngle = 0;

    // Shared per-frame uniforms (the same uniform objects are referenced by several materials).
    this.uSunDir = { value: new THREE.Vector3().copy(o.sunDir) };
    this.uSunDirObj = { value: new THREE.Vector3() };
    this.uSunColor = { value: new THREE.Color(1, 1, 1) };
    this.uEarthCenter = { value: new THREE.Vector3().copy(o.earthCenterFar) };
    this.uCloudAngle = { value: 0 };
    this.uSunIntensity = { value: 1.45 };     // white Lambert surface in full sun -> ~1.45 (HDR, before bloom/ACES)
    this.uMultiScatter = { value: 0.6 };     // crude compensation for missing multiple scattering
    this.uLimbBoost = { value: 1.4 };        // limb exposure; rises in eclipse (camera-like adaptation, see update())
    this.uMoonDir = { value: new THREE.Vector3().copy(o.moonDir) };
    this.uMoonLight = { value: 0 };          // moonlight radiance on a white surface (night-adapted HDR scale), from the lunar phase

    // --- Ground ---
    this.groundMaterial = new THREE.ShaderMaterial({
      name: 'EarthGround',
      defines: { SAMPLES: nGround, MODE: 0 },
      uniforms: {
        tDay: { value: null }, tNight: { value: null }, tClouds: { value: null }, tOcean: { value: null }, tNormal: { value: null },
        uSunDir: this.uSunDir, uSunDirObj: this.uSunDirObj, uSunColor: this.uSunColor, uEarthCenter: this.uEarthCenter,
        uSunIntensity: this.uSunIntensity, uCloudAngle: this.uCloudAngle, uMultiScatter: this.uMultiScatter,
        uMoonDir: this.uMoonDir, uMoonLight: this.uMoonLight,
        uNightIntensity: { value: 2.6 }, uGlint: { value: 3.0 }, uNormalStrength: { value: 0.5 },
      },
      vertexShader: SPHERE_VERTEX, fragmentShader: GROUND_FRAGMENT, toneMapped: false,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM, 256, 128), this.groundMaterial);
    this.earth.name = 'EarthGround';
    this.earth.position.copy(o.earthCenterFar);
    this.earth.visible = false;                 // until textures are loaded (the placeholder is shown meanwhile)
    this.group.add(this.earth);

    // Placeholder while loading (plain dark-blue sphere, removed in load()).
    this.placeholder = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM, 64, 32), new THREE.MeshBasicMaterial({ color: 0x0a1a33 }));
    this.placeholder.position.copy(o.earthCenterFar);
    this.group.add(this.placeholder);

    // --- Clouds ---
    this.cloudMaterial = new THREE.ShaderMaterial({
      name: 'EarthClouds',
      defines: { SAMPLES: nCloud, MODE: 0 },
      uniforms: {
        tClouds: { value: null }, uSunDir: this.uSunDir, uSunColor: this.uSunColor, uEarthCenter: this.uEarthCenter,
        uSunIntensity: this.uSunIntensity, uMultiScatter: this.uMultiScatter, uCloudGain: { value: 1.15 },
        uMoonDir: this.uMoonDir, uMoonLight: this.uMoonLight,
      },
      vertexShader: SPHERE_VERTEX, fragmentShader: CLOUD_FRAGMENT,
      transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM + CLOUD_ALTITUDE_KM, 192, 96), this.cloudMaterial);
    this.clouds.name = 'EarthClouds';
    this.clouds.position.copy(o.earthCenterFar);
    this.clouds.renderOrder = 10;
    this.clouds.visible = false;
    this.group.add(this.clouds);

    // --- Atmosphere shell (limb) ---
    this.shellMaterial = new THREE.ShaderMaterial({
      name: 'EarthAtmosphere',
      defines: { SAMPLES: nShell, MODE: 1 },
      uniforms: {
        uSunDir: this.uSunDir, uSunColor: this.uSunColor, uEarthCenter: this.uEarthCenter,
        uSunIntensity: this.uSunIntensity, uMultiScatter: this.uMultiScatter, uAirglow: { value: 0.022 }, uLimbBoost: this.uLimbBoost,
      },
      vertexShader: SPHERE_VERTEX, fragmentShader: SHELL_FRAGMENT,
      side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM + ATMO_ALTITUDE_KM, 128, 64), this.shellMaterial);
    this.atmosphere.name = 'EarthAtmosphere';
    this.atmosphere.position.copy(o.earthCenterFar);
    this.atmosphere.renderOrder = 20;
    this.group.add(this.atmosphere);

    // --- Sun: disc + corona quads at 1e6 km, always facing the camera ---
    const sunRadius = SUN_DISTANCE_KM * Math.tan(SUN_ANGULAR_RADIUS);
    this.sunRadiusKm = sunRadius;
    const discHalf = sunRadius * 1.08, coronaHalf = sunRadius * 9.0;
    this.sunDiscMaterial = new THREE.ShaderMaterial({
      name: 'SunDisc',
      uniforms: { uColor: this.uSunColor, uIntensity: { value: 28.0 }, uDisc: { value: sunRadius / discHalf } },
      vertexShader: QUAD_VERTEX, fragmentShader: SUN_DISC_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false,
    });
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(discHalf * 2, discHalf * 2), this.sunDiscMaterial);
    this.sun.name = 'SunDisc';
    this.sun.renderOrder = -11;
    this.sun.frustumCulled = false;
    this.coronaMaterial = new THREE.ShaderMaterial({
      name: 'SunCorona',
      uniforms: { uColor: this.uSunColor, uIntensity: { value: 1.6 }, uDisc: { value: sunRadius / coronaHalf } },
      vertexShader: QUAD_VERTEX, fragmentShader: SUN_CORONA_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false,
    });
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(coronaHalf * 2, coronaHalf * 2), this.coronaMaterial);
    this.corona.name = 'SunCorona';
    this.corona.renderOrder = -12;
    this.corona.frustumCulled = false;
    this.group.add(this.sun, this.corona);

    // --- Moon ---
    this.moonMaterial = new THREE.ShaderMaterial({
      name: 'Moon',
      uniforms: { tMoon: { value: null }, uSunDir: this.uSunDir, uSunColor: this.uSunColor, uIntensity: { value: 2.2 } },
      vertexShader: MOON_VERTEX, fragmentShader: MOON_FRAGMENT, toneMapped: false,
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_RADIUS_KM, 64, 32), this.moonMaterial);
    this.moon.name = 'Moon';
    this.moon.visible = false;
    this.group.add(this.moon);

    ctx.farScene.add(this.group);
    this.update(0, ctx);
  }

  /** Loads the NASA textures; reports progress through ctx.hud.setProgress (optional). */
  async load() {
    const ctx = this.ctx;
    const loader = new THREE.TextureLoader();
    const maxAniso = ctx.renderer.capabilities.getMaxAnisotropy();
    const aniso = Math.max(1, Math.min(ctx.quality.anisotropy || 4, maxAniso));
    const items = [
      ['textures/earth/earth_day_5400.jpg', true], ['textures/earth/earth_night_4096.jpg', true],
      ['textures/earth/earth_clouds_4096.jpg', false], ['textures/earth/earth_specular_2048.jpg', false],
      ['textures/earth/earth_normal_2048.jpg', false], ['textures/sky/moon_1024.jpg', true],
    ];
    let done = 0;
    ctx.hud?.setProgress?.(0);
    const load = async ([path, srgb]) => {
      const t = await loader.loadAsync(ctx.assetUrl(path));
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true; t.anisotropy = aniso; t.needsUpdate = true;
      done++; ctx.hud?.setProgress?.(done / items.length);
      return t;
    };
    const [day, night, clouds, ocean, normal, moon] = await Promise.all(items.map(load));
    const gu = this.groundMaterial.uniforms;
    gu.tDay.value = day; gu.tNight.value = night; gu.tClouds.value = clouds; gu.tOcean.value = ocean; gu.tNormal.value = normal;
    this.cloudMaterial.uniforms.tClouds.value = clouds;
    this.moonMaterial.uniforms.tMoon.value = moon;
    this.textures = { day, night, clouds, ocean, normal, moon };
    this.earth.visible = true; this.clouds.visible = true; this.moon.visible = true;
    this.group.remove(this.placeholder);
    this.placeholder.geometry.dispose(); this.placeholder.material.dispose();
    this.placeholder = null;
  }

  update(dt, ctx) {
    const o = ctx.orbit;
    const cam = ctx.farCamera;
    // Earth orientation and lighting
    this.earth.quaternion.copy(o.earthQuat);
    this.uSunDir.value.copy(o.sunDir);
    this.uSunColor.value.copy(o.sunColor);
    this.uEarthCenter.value.copy(o.earthCenterFar);
    // In the Earth's shadow only the upper atmosphere is lit; open the limb exposure like an auto-exposing camera
    this.uLimbBoost.value = 1.4 + 1.2 * (1 - o.sunVisible);
    _qInv.copy(o.earthQuat).invert();
    this.uSunDirObj.value.copy(o.sunDir).applyQuaternion(_qInv);
    // Moonlight: illuminated fraction of the disc from the phase angle (full Moon when moonDir = -sunDir)
    this.uMoonDir.value.copy(o.moonDir);
    const litFraction = 0.5 * (1 - o.sunDir.dot(o.moonDir));
    this.uMoonLight.value = MOON_LIGHT_MAX * Math.pow(litFraction, 1.6);
    // Clouds drift slowly eastward relative to the surface (robust for t up to days)
    this.cloudAngle = (CLOUD_DRIFT_RATE * ctx.time.sim) % (2 * Math.PI);
    this.uCloudAngle.value = this.cloudAngle;
    _q.setFromAxisAngle(Y_AXIS, this.cloudAngle);
    this.clouds.quaternion.copy(o.earthQuat).multiply(_q);
    // Sun quads face the camera (the camera sits within metres of the origin, so facing it is exact for all views)
    this.sun.position.copy(o.sunDir).multiplyScalar(SUN_DISTANCE_KM);
    this.corona.position.copy(this.sun.position);
    if (cam) _v.copy(cam.position); else _v.set(0, 0, 0);
    this.sun.lookAt(_v);
    this.corona.quaternion.copy(this.sun.quaternion);
    // Moon: position from the ephemeris; near side (texture centre) faces the Earth, north pole toward celestial north
    this.moon.position.copy(o.moonPosFar);
    _x.copy(o.earthCenterFar).sub(o.moonPosFar).normalize();
    _y.copy(Z_AXIS).applyQuaternion(o.skyQuat);
    _z.crossVectors(_x, _y).normalize();
    _y.crossVectors(_z, _x);
    _m.makeBasis(_x, _y, _z);
    this.moon.quaternion.setFromRotationMatrix(_m);
  }

  dispose() {
    this.ctx.farScene.remove(this.group);
    this.group.traverse((obj) => { obj.geometry?.dispose(); obj.material?.dispose?.(); });
    if (this.textures) for (const t of Object.values(this.textures)) t.dispose();
  }
}
