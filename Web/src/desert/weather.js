// Погода и время суток: пресеты WeatherPresets.csv → солнце, небо, туман, ветер, экспозиция.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, DEG, damp } from '../core/util.js';
import { ENV } from './env.js';

// Азимут «на солнце» (градусы от +X к +Z) по часам — художественная схема (см. отчёт):
// рассвет — с северо-востока (бок/против вида со старта, длинные тени дюн), Morning_Erg — 20° (SUN_AZIMUTH_DEG: червь затмевает солнце с P4).
const AZ_KEYS = [[4.5, -62], [6.667, -47], [8.5, 20], [11.5, 56], [12, 60], [15, 118], [17.5, 188], [19.5, 205]];
function azimuthAt(h) {
  if (h <= AZ_KEYS[0][0]) return AZ_KEYS[0][1];
  for (let i = 0; i < AZ_KEYS.length - 1; i++) {
    const [h0, a0] = AZ_KEYS[i], [h1, a1] = AZ_KEYS[i + 1];
    if (h <= h1) return lerp(a0, a1, (h - h0) / (h1 - h0));
  }
  return AZ_KEYS[AZ_KEYS.length - 1][1];
}
/** Высота солнца по формуле docs/tech-art/lighting_weather.md §3 (φ = 23°, δ = +12°), градусы. */
export function sunElevation(hours) {
  const phi = 23 * DEG, dec = 12 * DEG, H = 15 * (hours - 12) * DEG;
  const up = Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(H) * Math.cos(phi);
  return Math.asin(clamp(up, -1, 1)) / DEG;
}

const NUM_KEYS = ['hours', 'sunLux', 'sky', 'fogDensity', 'fogFalloff', 'volFog', 'dust', 'wind', 'windYaw', 'storm', 'haze', 'exposure', 'clouds'];

export function createWeather(game, sky, world) {
  const { bus } = game;
  const presets = game.data?.WeatherPresets || {};
  const sunColor = new THREE.Color(1, 0.9, 0.8), fogColor = new THREE.Color();
  const st = {
    hours: 6.667, sunLux: 75000, sky: 1.2, fogDensity: 0.012, fogFalloff: 0.15, volFog: 0.6, dust: 0.1, wind: 3.5,
    windYaw: 55, storm: 0, haze: 0.1, exposure: 1, clouds: 0.08,
    sunColor: new THREE.Color(1, 0.86, 0.72), fogColor: new THREE.Color(0.55, 0.45, 0.42),
  };
  let from = null, to = null, t = 1, dur = 1;

  const weather = {
    current: 'Dawn_Ridge',
    hours: st.hours, windDir: new THREE.Vector3(), windSpeed: 3.5, windBase: 3.5, gust: 0,
    storm: 0, dust: 0.1, haze: 0.1, clouds: 0.08, exposure: 1, sunElev: 13,
    state: st,
    alwaysUpdate: false,
    request(id, blendSec = 6) {
      const p = presets[id];
      if (!p) { console.warn('[weather] нет пресета', id); return; }
      from = {}; for (const k of NUM_KEYS) from[k] = st[k];
      from.sunColor = st.sunColor.clone(); from.fogColor = st.fogColor.clone();
      to = {}; for (const k of NUM_KEYS) to[k] = p[k];
      if (!(p.hours >= 0)) to.hours = st.hours;
      to.sunColor = new THREE.Color(p.sunColor.r ?? p.sunColor[0], p.sunColor.g ?? p.sunColor[1], p.sunColor.b ?? p.sunColor[2]);
      to.fogColor = new THREE.Color(p.fogColor.r ?? p.fogColor[0], p.fogColor.g ?? p.fogColor[1], p.fogColor.b ?? p.fogColor[2]);
      dur = Math.max(0.001, blendSec); t = 0;
      weather.current = id;
      if (blendSec <= 0) step(dur);
      bus.emit('weather', { id });
    },
  };

  // «сырые» цвета пресетов в CSV — sRGB-значения (R,G,B 0..1); конвертируем в линейные при применении
  function srgbToLin(c, out) { out.r = Math.pow(c.r, 2.2); out.g = Math.pow(c.g, 2.2); out.b = Math.pow(c.b, 2.2); return out; }

  const zenithNoon = new THREE.Color('#3F68A8'), zenithDawn = new THREE.Color('#2A4580');
  const zenithDust = new THREE.Color('#A58A5E'), zenithStorm = new THREE.Color('#9A7440');
  const horNoon = new THREE.Color('#C8B79A'), horDawn = new THREE.Color('#E69A62');
  const tmpC = new THREE.Color(), tmpL = new THREE.Color(), tmpF = new THREE.Color(), tmpS = new THREE.Color(), tmpG = new THREE.Color();

  function step(dt) {
    if (to && t < 1) {
      t = Math.min(1, t + dt / dur);
      const k = t * t * (3 - 2 * t);
      for (const key of NUM_KEYS) st[key] = lerp(from[key], to[key], k);
      st.sunColor.lerpColors(from.sunColor, to.sunColor, k);
      st.fogColor.lerpColors(from.fogColor, to.fogColor, k);
    }
    const time = game.time;
    // ветер с порывами
    const g1 = Math.sin(time * 0.37) * 0.5 + Math.sin(time * 0.91 + 1.7) * 0.3 + Math.sin(time * 0.17 + 4) * 0.4;
    weather.gust = 0.5 + 0.5 * g1 / 1.2; // 0..1
    const gustAmp = 0.18 + 0.5 * st.storm;
    weather.windBase = st.wind;
    weather.windSpeed = st.wind * (1 + gustAmp * (weather.gust * 2 - 1)) + st.storm * 2 * weather.gust;
    const yaw = (st.windYaw + 6 * Math.sin(time * 0.05)) * DEG;
    weather.windDir.set(Math.cos(yaw), 0, Math.sin(yaw));
    weather.storm = st.storm; weather.dust = st.dust; weather.haze = st.haze; weather.clouds = st.clouds;
    weather.hours = st.hours;

    // --- солнце ---
    const el = sunElevation(st.hours);
    const az = azimuthAt(st.hours) * DEG;
    const e = el * DEG;
    const sd = ENV.uniforms.uSunDir.value;
    sd.set(Math.cos(e) * Math.cos(az), Math.sin(e), Math.cos(e) * Math.sin(az)).normalize();
    world.sunDir.copy(sd);
    weather.sunElev = el;
    const sinE = Math.max(Math.sin(e), 0);
    const am = 1 / (sinE + 0.035);
    const dustK = 1 + 2.2 * st.dust + 1.4 * st.storm;
    const tr = (tau) => Math.exp(-tau * am * dustK * 0.62);
    const sc = srgbToLin(st.sunColor, tmpS);
    const sunI = st.sunLux / 30000;
    const dayK = smoothstep(-1.5, 3, el);
    ENV.uniforms.uSunColor.value.setRGB(sc.r * tr(0.045) * sunI * dayK, sc.g * tr(0.08) * sunI * dayK, sc.b * tr(0.16) * sunI * dayK);

    // --- небо ---
    const kd = smoothstep(-2, 42, el);
    tmpC.lerpColors(zenithDawn, zenithNoon, kd);
    tmpC.lerp(zenithDust, clamp(st.dust * 0.55, 0, 0.6));
    tmpC.lerp(zenithStorm, clamp(st.storm * 0.8, 0, 0.8));
    const skyLevel = (0.22 + 0.78 * kd) * 2.0;
    ENV.uniforms.uZenith.value.copy(tmpC).multiplyScalar(skyLevel);
    // цвет тумана = FogInscatterColor пресета (sRGB) × яркость неба
    srgbToLin(st.fogColor, tmpF);
    tmpL.lerpColors(horDawn, horNoon, kd); // информативный цвет горизонта в sRGB
    const fogLevel = (0.35 + 0.65 * kd) * 1.9 * (0.55 + 0.45 * clamp(sinE * 2.4, 0, 1));
    ENV.uniforms.uFogColor.value.setRGB(tmpF.r * fogLevel, tmpF.g * fogLevel, tmpF.b * fogLevel);
    ENV.uniforms.uHorizon.value.copy(tmpL).multiplyScalar(skyLevel * 1.25).lerp(ENV.uniforms.uFogColor.value, clamp(st.dust * 0.6 + st.storm * 0.6, 0, 0.8));
    // плотность тумана: CSV (единицы UE) → экстинкция, 1/м
    ENV.uniforms.uFogDensity.value = st.fogDensity * 0.026;
    ENV.uniforms.uFogFalloff.value = Math.max(0.0008, st.fogFalloff * 0.06);
    ENV.uniforms.uMist.value = (0.0045 * smoothstep(0.02, 0.15, st.fogFalloff - 0.0) * (1 - kd * 0.7)) * (st.fogFalloff > 0.12 ? 1 : 0.35) + 0.0006;
    ENV.uniforms.uFogSun.value = 1.0 + 1.5 * st.volFog * st.dust;
    ENV.uniforms.uWind.value.set(weather.windDir.x, weather.windDir.z);
    ENV.uniforms.uWindSpeed.value = weather.windSpeed;
    ENV.uniforms.uStorm.value = st.storm;
    ENV.uniforms.uDust.value = st.dust;
    sky.skyU.uClouds.value = st.clouds;

    // --- свет ---
    sky.sun.color.set(1, 1, 1);
    const sc3 = ENV.uniforms.uSunColor.value;
    const sMax = Math.max(sc3.r, sc3.g, sc3.b, 1e-4);
    sky.sun.color.setRGB(sc3.r / sMax, sc3.g / sMax, sc3.b / sMax);
    sky.sun.intensity = sMax;
    sky.sun.visible = world.visible !== false && el > -2;
    // полусфера: цвет неба сверху, отражённый песок снизу
    const zen = ENV.uniforms.uZenith.value, hor = ENV.uniforms.uHorizon.value;
    const skyE = (0.18 + 0.82 * kd) * st.sky * 0.55 * (1 + st.dust * 0.5);
    sky.hemi.color.setRGB(lerp(zen.r, hor.r, 0.45), lerp(zen.g, hor.g, 0.45), lerp(zen.b, hor.b, 0.45));
    const cm = Math.max(sky.hemi.color.r, sky.hemi.color.g, sky.hemi.color.b, 1e-4);
    sky.hemi.color.multiplyScalar(1 / cm);
    sky.hemi.intensity = skyE * cm * 2.4;
    const gcol = tmpG.setRGB(0.62, 0.42, 0.24).multiplyScalar(1);
    sky.hemi.groundColor.copy(gcol);
    sky.hemi.groundColor.multiplyScalar(0.18 + 1.3 * sinE * Math.min(1, sunI / 3));
    ENV.uniforms.uAmbient.value.copy(sky.hemi.color).multiplyScalar(sky.hemi.intensity);

    // --- экспозиция (имитация адаптации глаза + ExposureBias) ---
    const Ecur = sunI * Math.max(sinE, 0.1) * dayK + sky.hemi.intensity;
    const Eref = 4 * 0.97 + 0.8;
    const base = 0.74 * Math.pow(Eref / Math.max(Ecur, 0.4), 0.55);
    const target = base * Math.pow(2, (st.exposure - 1) * 0.42);
    weather.exposure = dt > 0 ? damp(weather.exposure, target, 1.5, dt) : target;
    if (world.visible !== false) game.renderer.toneMappingExposure = weather.exposure * (world.exposureTrim ?? 1);
    else game.renderer.toneMappingExposure = 0.95 * Math.pow(2, (st.exposure - 0.3) * 0.7); // интерьер: янтарные светошары
    // scene.fog для объектов других модулей (червь, фигуры): совпадает с приземным туманом
    if (game.scene.fog) {
      game.scene.fog.color.copy(ENV.uniforms.uFogColor.value);
      game.scene.fog.density = Math.sqrt(ENV.uniforms.uFogDensity.value * 700) / 700; // exp² ≈ экспоненциальному на 700 м
    }
  }

  weather.update = (dt) => step(dt);
  weather.alwaysUpdate = false;
  // стартовый пресет
  weather.request('Dawn_Ridge', 0);
  return weather;
}
