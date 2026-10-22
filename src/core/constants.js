// Shared constants and conventions. See docs/ARCHITECTURE.md.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/** Near scene uses meters; far scene uses kilometers. */
export const NEAR_TO_FAR = 0.001;

export const EARTH_RADIUS_KM = 6371.0;
export const STATION_ALTITUDE_KM = 410.0;
export const STATION_INCLINATION_DEG = 51.64;

/** Simulation epoch (UTC). Orbit, Sun, Moon and Earth rotation are computed from this. */
export const EPOCH_UTC_MS = Date.UTC(2026, 9, 22, 9, 30, 0);

/** Sun as a directional light: intensity in "scene units" tuned for ACES exposure = 1. */
export const SUN_LIGHT_INTENSITY = 3.2;
export const SUN_COLOR = 0xfff4e5;

/** Render layers (camera.layers / object.layers). */
export const LAYERS = {
  DEFAULT: 0,
  NO_SHADOW: 1,   // emissive bits / tiny geometry that must not cast or receive shadows
  FIRST_PERSON: 2 // suit gloves / helmet geometry rendered only by the player camera
};

export const QUALITY_PRESETS = {
  ultra:  { shadowMapSize: 4096, pixelRatio: 2.0, msaa: 4, bloom: true, anisotropy: 16, envMapSize: 256, envUpdateInterval: 1.0, particles: 6000, softShadows: true },
  high:   { shadowMapSize: 2048, pixelRatio: 1.5, msaa: 4, bloom: true, anisotropy: 8,  envMapSize: 256, envUpdateInterval: 2.0, particles: 4000, softShadows: true },
  medium: { shadowMapSize: 2048, pixelRatio: 1.0, msaa: 2, bloom: true, anisotropy: 4,  envMapSize: 128, envUpdateInterval: 4.0, particles: 2000, softShadows: false },
  low:    { shadowMapSize: 1024, pixelRatio: 1.0, msaa: 0, bloom: false, anisotropy: 2, envMapSize: 64,  envUpdateInterval: 8.0, particles: 800,  softShadows: false },
};
