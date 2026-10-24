import * as THREE from 'three';
import { HorizonCull } from './HorizonCull.js';
import { EARTH_RADIUS_KM } from '../core/constants.js';
import { SPHERE_VERTEX, groundFragment, CLOUD_FRAGMENT, SHELL_FRAGMENT } from './shaders/EarthShaders.js';
import { AURORA_FRAGMENT } from './shaders/AuroraShaders.js';
import { QUAD_VERTEX, SUN_DISC_FRAGMENT, SUN_CORONA_FRAGMENT, MOON_VERTEX, MOON_FRAGMENT } from './shaders/SunMoonShaders.js';
import { loadSeasonalDay, createNoiseTexture, imageChannel, BASE_MONTH } from './EarthTextures.js';
import { TileWindow, loadTileManifest } from './TileWindow.js';
import { Weather, latLonToObj } from './Weather.js';

/**
 * FAR scene (kilometres): the Earth (ground / clouds / aurora / atmosphere shells with custom GLSL),
 * the Sun (HDR disc + corona, occluded by the Earth through depth) and the Moon.
 * Orientation comes from ctx.orbit every frame; the Earth centre is ctx.orbit.earthCenterFar.
 *
 * Surface: Blue Marble NG monthly imagery blended for the sim date (EarthTextures), NSIDC sea ice, water fraction
 * with rivers and lakes, bathymetry, terrain relief (slopes + horizon shadows), Cox-Munk glint, Black Marble city
 * lights; 500 m day / night imagery and 1 km relief streamed around the sub-station point (TileWindow). Weather (Weather + WeatherChunk): advected and
 * evolving cloud cover, tropical cyclones, thunderstorm cells with lightning, cloud shadows. Night: city lights
 * diffused by clouds, moonlit clouds and moon glint, aurora ovals, airglow.
 */

const SUN_DISTANCE_KM = 1.0e6;
const SUN_ANGULAR_RADIUS = (0.53 / 2) * Math.PI / 180;
const MOON_RADIUS_KM = 1737.4;
const CLOUD_ALTITUDE_KM = 6;
const ATMO_ALTITUDE_KM = 100;
const AURORA_SHELL_KM = 335;
/** 'lite' only: rigid cloud drift relative to the surface (rad/s); the GPU presets advect the clouds per latitude. */
const CLOUD_DRIFT_RATE = 3.0e-5;
/** Full-Moon radiance on a white Lambert surface, in the scene's HDR units (a night-adapted camera, not the physical 1/400000 of sunlight). */
const MOON_LIGHT_MAX = 0.05;
/** GPU presets: slow eastward drift of the cloud map (rad/s, ~6 m/s at the equator); the weather evolves in the shaders. */
const CLOUD_MAP_DRIFT = 1.0e-6;
/** Geomagnetic north pole (IGRF-13, 2025). */
const DIPOLE_LAT = 80.8, DIPOLE_LON = -72.7;

/** Ray-march sample counts per quality preset: [atmosphere shell, ground aerial perspective, clouds]. */
const SAMPLES = { ultra: [24, 8, 6], high: [16, 6, 5], medium: [12, 5, 4], low: [8, 4, 3], lite: [5, 2, 2] };

/**
 * Feature set per preset. day: 'delta' = 8K base + seasonal 4K difference, 'blend' = two 4K months, 'nearest' = one
 * month file. relief = global relief texture size (GPU presets; 'lite' uses the old normal map); tiles = toroidal
 * window sizes (in 5-degree tiles) of the 500 m day / night and 1 km relief layers (0 = off); shadows = terrain
 * horizon shadows. detail = cloud texture octaves; cyc / cells / flashes = uniform array sizes; arcs / auroraSamples
 * = aurora.
 */
const FEATURES = {
  ultra:  { day: 'delta', clouds: 8192, night: 8192, water: 8192, relief: 8192, tiles: { day: 5, night: 5, relief: 8 }, shadows: true, detail: 3, cyc: 6, cells: 24, flashes: 8, arcs: 3, auroraSamples: 6 },
  high:   { day: 'delta', clouds: 8192, night: 8192, water: 8192, relief: 8192, tiles: { day: 0, night: 4, relief: 6 }, shadows: true, detail: 2, cyc: 6, cells: 20, flashes: 8, arcs: 2, auroraSamples: 4 },
  medium: { day: 'blend', clouds: 4096, night: 4096, water: 4096, relief: 2048, tiles: { day: 0, night: 0, relief: 0 }, shadows: true, detail: 1, cyc: 5, cells: 16, flashes: 6, arcs: 2, auroraSamples: 3 },
  low:    { day: 'blend', clouds: 4096, night: 4096, water: 4096, relief: 2048, tiles: { day: 0, night: 0, relief: 0 }, shadows: false, detail: 0, cyc: 5, cells: 12, flashes: 4, arcs: 1, auroraSamples: 2 },
  lite:   { day: 'nearest', clouds: 4096, night: 4096, water: 4096, normal: 2048, tiles: { day: 0, night: 0, relief: 0 }, shadows: false, detail: 0, cyc: 0, cells: 0, flashes: 0, arcs: 0, auroraSamples: 0 },
};

const _qInv = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _camKm = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export class Earth {
  constructor(ctx) {
    this.ctx = ctx;
    const o = ctx.orbit;
    const preset = ctx.quality.preset;
    const lite = !!ctx.quality.lite;
    const [nShell, nGround, nCloud] = SAMPLES[preset] || SAMPLES.high;
    const maxTex = ctx.renderer.capabilities.maxTextureSize || 4096;
    const f = { ...(FEATURES[lite ? 'lite' : preset] || FEATURES.high) };
    if (maxTex < 8192) {      // 8K textures and the 8K bake need the GPU's support
      f.clouds = Math.min(f.clouds, 4096); f.night = Math.min(f.night, 4096); f.water = Math.min(f.water, 4096);
      if (f.day === 'delta') f.day = 'blend';
      if (f.relief) f.relief = 2048;
      f.tiles = { day: 0, night: 0, relief: 0 };
    }
    this.features = f;
    this.lite = lite;
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
    this.uNightIntensity = { value: 1.4 };
    // weather
    this.weather = lite ? null : new Weather({ maxCyclones: f.cyc, maxCells: f.cells, maxFlashes: f.flashes });
    this.tNoise = { value: null };
    this.tAux = { value: null };
    this.tClouds = { value: null };
    this.uFlow = { value: new THREE.Vector4() };
    this.uWx = { value: new THREE.Vector4(0.22, 1.0, 1.0, 0) };   // growth/decay, detail erosion, tropical cumulus
    this.uCyc = { value: this.weather ? this.weather.uCyc : [] };
    this.uCell = { value: this.weather ? this.weather.uCell : [] };
    this.uFlash = { value: this.weather ? this.weather.uFlash : [] };
    // streamed tile windows (filled in load() once the manifest is known)
    const tAniso = Math.min(16, ctx.renderer.capabilities.getMaxAnisotropy());
    const mk = (name, n, tilePx, srgb, oneChannel) => (n > 0 && !lite
      ? new TileWindow(ctx.renderer, (p) => ctx.assetUrl(p), { name, n, tilePx, srgb, oneChannel, anisotropy: tAniso, lead: n * 1.2 })
      : null);
    this.tiles = { day: mk('day', f.tiles.day, 1200, true, false), night: mk('night', f.tiles.night, 1200, false, true), relief: mk('relief', f.tiles.relief, 600, false, false) };
    this._prevSub = { lat: o.subLatDeg, lon: o.subLonDeg, dLat: 0, dLon: 1 };

    const weatherDefines = { MAX_CYC: Math.max(1, f.cyc), MAX_CELLS: Math.max(1, f.cells), DETAIL: f.detail, CLOUD_TEX_W: f.clouds.toFixed(1) };
    const weatherUniforms = {
      tClouds: this.tClouds, tNoise: this.tNoise, tAux: this.tAux, uFlow: this.uFlow, uWx: this.uWx,
      uSunObj: this.uSunDirObj, uCyc: this.uCyc, uCell: this.uCell,
    };

    // --- Ground ---
    const groundDefines = lite ? { SAMPLES: nGround, MODE: 0 } : { SAMPLES: nGround, MODE: 0, ...weatherDefines };
    const tileUniforms = {};
    if (this.tiles.day) { groundDefines.TILE_DAY = 1; tileUniforms.tDayT = this.tiles.day.uTex; tileUniforms.uDayT = this.tiles.day.uWin; }
    if (this.tiles.night) { groundDefines.TILE_NIGHT = 1; tileUniforms.tNightT = this.tiles.night.uTex; tileUniforms.uNightT = this.tiles.night.uWin; }
    if (this.tiles.relief) { groundDefines.TILE_RELIEF = 1; tileUniforms.tReliefT = this.tiles.relief.uTex; tileUniforms.uReliefT = this.tiles.relief.uWin; }
    this.groundMaterial = new THREE.ShaderMaterial({
      name: 'EarthGround',
      defines: groundDefines,
      uniforms: {
        tDay: { value: null }, tNight: { value: null }, tWater: { value: null }, tNormal: { value: null }, tRelief: { value: null },
        uSunDir: this.uSunDir, uSunDirObj: this.uSunDirObj, uSunColor: this.uSunColor, uEarthCenter: this.uEarthCenter,
        uSunIntensity: this.uSunIntensity, uCloudAngle: this.uCloudAngle, uMultiScatter: this.uMultiScatter,
        uMoonDir: this.uMoonDir, uMoonLight: this.uMoonLight, uNightIntensity: this.uNightIntensity,
        uGlint: { value: lite ? 2.0 : 1.6 }, uNormalStrength: { value: 0.5 },
        // relief: slope exaggeration of the global (5 / 20 km) and the 1 km tile relief, terrain shadows on/off
        uRelief: { value: new THREE.Vector3(f.relief >= 8192 ? 2.2 : 3.5, 1.35, f.shadows ? 1 : 0) },
        ...(lite ? { tClouds: this.tClouds } : weatherUniforms),
        ...tileUniforms,
      },
      vertexShader: SPHERE_VERTEX, fragmentShader: groundFragment(lite), toneMapped: false,
    });
    // tessellation per preset: only the cap above the horizon is drawn (HorizonCull), so a finer globe is cheap
    const seg = { ultra: [512, 256, 384, 192], high: [384, 192, 288, 144] }[preset] || [256, 128, 192, 96];
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM, seg[0], seg[1]), this.groundMaterial);
    this.earth.name = 'EarthGround';
    this.earth.position.copy(o.earthCenterFar);
    this.earth.visible = false;                 // until textures are loaded (the placeholder is shown meanwhile)
    this.group.add(this.earth);
    this.earthCull = new HorizonCull(this.earth, seg[0], seg[1]);   // draw only the cap above the horizon

    // Placeholder while loading (plain dark-blue sphere, removed in load()).
    this.placeholder = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM, 64, 32), new THREE.MeshBasicMaterial({ color: 0x0a1a33 }));
    this.placeholder.position.copy(o.earthCenterFar);
    this.group.add(this.placeholder);

    // --- Clouds (GPU presets; 'lite' composites them in the ground shader) ---
    this.cloudMaterial = null; this.clouds = null; this.cloudCull = null;
    if (!lite) {
      this.cloudMaterial = new THREE.ShaderMaterial({
        name: 'EarthClouds',
        defines: { SAMPLES: nCloud, MODE: 0, MAX_FLASH: Math.max(1, f.flashes), ...weatherDefines },
        uniforms: {
          ...weatherUniforms, tNight: { value: null }, uFlash: this.uFlash,
          uSunDir: this.uSunDir, uSunColor: this.uSunColor, uEarthCenter: this.uEarthCenter,
          uSunIntensity: this.uSunIntensity, uMultiScatter: this.uMultiScatter, uCloudGain: { value: 1.15 }, uBump: { value: 1.6 },
          uMoonDir: this.uMoonDir, uMoonLight: this.uMoonLight, uNightIntensity: this.uNightIntensity,
        },
        vertexShader: SPHERE_VERTEX, fragmentShader: CLOUD_FRAGMENT,
        transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
      });
      this.clouds = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM + CLOUD_ALTITUDE_KM, seg[2], seg[3]), this.cloudMaterial);
      this.clouds.name = 'EarthClouds';
      this.clouds.position.copy(o.earthCenterFar);
      this.clouds.renderOrder = 10;
      this.clouds.visible = false;
      this.group.add(this.clouds);
      this.cloudCull = new HorizonCull(this.clouds, seg[2], seg[3]);
    }

    // --- Aurora (GPU presets): analytic curtains evaluated on a proxy shell above the layer ---
    this.aurora = null;
    if (f.arcs > 0) {
      this.uCamObj = { value: new THREE.Vector3() };
      this.uDipole = { value: latLonToObj(DIPOLE_LAT, DIPOLE_LON, new THREE.Vector3()) };
      this.auroraMaterial = new THREE.ShaderMaterial({
        name: 'EarthAurora',
        defines: { ARCS: f.arcs, AURORA_SAMPLES: f.auroraSamples, SAMPLES: 1, MODE: 0 },
        uniforms: {
          tNoise: this.tNoise, uCamObj: this.uCamObj, uSunObj: this.uSunDirObj, uDipole: this.uDipole,
          uAurora: { value: this.weather.uAurora }, uAuroraGain: { value: 0.0065 },
        },
        vertexShader: SPHERE_VERTEX, fragmentShader: AURORA_FRAGMENT,
        transparent: true, depthWrite: false, depthTest: true, toneMapped: false, blending: THREE.AdditiveBlending,
      });
      const aSeg = [192, 96];
      this.aurora = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM + AURORA_SHELL_KM, aSeg[0], aSeg[1]), this.auroraMaterial);
      this.aurora.name = 'EarthAurora';
      this.aurora.position.copy(o.earthCenterFar);
      this.aurora.renderOrder = 15;
      this.aurora.visible = false;
      this.group.add(this.aurora);
      this.auroraCull = new HorizonCull(this.aurora, aSeg[0], aSeg[1]);
    }

    // --- Atmosphere shell (limb) ---
    this.shellMaterial = new THREE.ShaderMaterial({
      name: 'EarthAtmosphere',
      defines: lite ? { SAMPLES: nShell, MODE: 1, SKIP_GROUND: 1 } : { SAMPLES: nShell, MODE: 1 },
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
    const shellSeg = lite ? [64, 32] : [128, 64];
    this.atmosphere = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM + ATMO_ALTITUDE_KM, shellSeg[0], shellSeg[1]), this.shellMaterial);
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

  /** Loads the NASA textures and bakes the seasonal day map; reports progress through ctx.hud.setProgress (optional). */
  async load() {
    const ctx = this.ctx;
    const f = this.features;
    const loader = new THREE.TextureLoader();
    const maxAniso = ctx.renderer.capabilities.getMaxAnisotropy();
    const aniso = Math.max(1, Math.min(ctx.quality.anisotropy || 4, maxAniso));
    const E = 'textures/earth/';
    const manifest = this.lite ? null : loadTileManifest((p) => ctx.assetUrl(p));
    let total = 6 + (f.day === 'nearest' ? 1 : f.day === 'blend' ? 2 : 4) + (this.lite ? 0 : 1), done = 0;
    ctx.hud?.setProgress?.(0);
    // format: 'rgb' | 'r' (grey, one byte per texel) | 'rg' (normal map xy); noMips: bake sources sampled once
    const load = async (path, srgb, noMips = false, format = 'rgb') => {
      const t = await loader.loadAsync(ctx.assetUrl(path));
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      if (format === 'r') t.format = THREE.RedFormat;
      else if (format === 'rg') t.format = THREE.RGFormat;
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.minFilter = noMips ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = !noMips; t.anisotropy = noMips ? 1 : aniso; t.needsUpdate = true;
      done++; ctx.hud?.setProgress?.(Math.min(1, done / total));
      return t;
    };
    const date = ctx.orbit.dateAt(ctx.time.sim);
    const [dayRes, night, clouds, water, normal, moon, aux] = await Promise.all([
      loadSeasonalDay(ctx.renderer, load, date, f.day, aniso, `${E}earth_base_m${BASE_MONTH}_8192.jpg`),
      load(`${E}earth_night_${f.night}.jpg`, false, false, 'r'),
      load(`${E}earth_clouds_${f.clouds}.jpg`, false, false, 'r'),
      load(`${E}earth_water_${f.water}.png`, false, false, 'r'),
      this.lite ? load(`${E}earth_normal_${f.normal}.jpg`, false, false, 'rg') : load(`${E}earth_relief_${f.relief}.webp`, false, false, 'rgb'),
      load('textures/sky/moon_1024.jpg', true),
      this.lite ? Promise.resolve(null) : load(`${E}earth_aux_2048.png`, false, false, 'rgb'),
    ]);
    this.season = dayRes.season;
    const gu = this.groundMaterial.uniforms;
    gu.tDay.value = dayRes.texture; gu.tNight.value = night; gu.tWater.value = water;
    if (this.lite) gu.tNormal.value = normal; else gu.tRelief.value = normal;
    if (manifest) {
      const m = await manifest;
      for (const k of ['day', 'night', 'relief']) if (this.tiles[k]) this.tiles[k].setIds(m[k] || []);
    }
    this.tClouds.value = clouds;
    this.moonMaterial.uniforms.tMoon.value = moon;
    this.dayTarget = dayRes.target;
    this.textures = { night, clouds, water, normal, moon };
    if (!dayRes.target) this.textures.day = dayRes.texture;
    if (!this.lite) {
      this.textures.aux = aux;
      this.tAux.value = aux;
      this.tNoise.value = this.textures.noise = createNoiseTexture();
      this.cloudMaterial.uniforms.tNight.value = night;
      // CPU copies for the weather placement (land fraction, cloud cover), 1 degree
      this.weather.setClimate(imageChannel(aux.image, 360, 180, 0), imageChannel(clouds.image, 360, 180, 0), 360, 180);
    }
    this.earth.visible = true; if (this.clouds) this.clouds.visible = true; if (this.aurora) this.aurora.visible = true;
    this.moon.visible = true;
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
    const simT = ctx.time.sim;
    ctx.camera.getWorldPosition(_camKm).multiplyScalar(0.001);
    if (this.lite) {
      // 'lite': the inline cloud layer drifts rigidly eastward (robust for t up to days)
      this.cloudAngle = (CLOUD_DRIFT_RATE * simT) % (2 * Math.PI);
      this.uCloudAngle.value = this.cloudAngle;
    } else {
      this.clouds.quaternion.copy(o.earthQuat);
      const drift = (CLOUD_MAP_DRIFT * simT) / (2 * Math.PI);
      this.uFlow.value.set(drift - Math.floor(drift), 0, 0, simT % 1048576);
      const scale = ctx.time.scale || 1;
      const dtReal = dt / scale;
      const utcH = ((((o.epochMs + simT * 1000) / 3600000) % 24) + 24) % 24;
      this.weather.update(simT, utcH, o.subLatDeg, o.subLonDeg, dt, dtReal);
      if (this.aurora) {
        // the curtains glow only in darkness: with the Sun > 30 deg above the station's horizon the whole visible
        // cap (20 deg) is sunlit, so the shell is skipped
        this.aurora.visible = !!this.textures && o.sunDir.y < 0.5;
        this.aurora.quaternion.copy(o.earthQuat);
        this.uCamObj.value.copy(_camKm).sub(o.earthCenterFar).applyQuaternion(_qInv);
      }
      if (this.textures) {
        // ground-track direction (deg/frame, longitude wrapped) for the window lead
        const p = this._prevSub;
        let dLon = o.subLonDeg - p.lon; if (dLon > 180) dLon -= 360; if (dLon < -180) dLon += 360;
        const dLat = o.subLatDeg - p.lat;
        if (Math.abs(dLat) + Math.abs(dLon) > 1e-6) { p.dLat = dLat; p.dLon = dLon; }
        p.lat = o.subLatDeg; p.lon = o.subLonDeg;
        // tiles follow up to x60 (one 5-degree tile per ~1.2 s); faster, the ground races by and the layers fade out
        const active = scale <= 60;
        for (const k of ['relief', 'day', 'night']) this.tiles[k]?.update(o.subLatDeg, o.subLonDeg, p.dLat, p.dLon, dtReal, active);
      }
    }
    // horizon culling from the viewpoint (km; the near camera sits within metres of the station)
    this.earthCull.update(_camKm);
    if (this.cloudCull) this.cloudCull.update(_camKm);
    if (this.aurora) this.auroraCull.update(_camKm);
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
    if (this.textures) for (const t of Object.values(this.textures)) t?.dispose();
    this.dayTarget?.dispose();
    for (const t of Object.values(this.tiles)) t?.dispose();
  }
}
