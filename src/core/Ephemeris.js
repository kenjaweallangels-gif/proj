/**
 * Solar-system ephemeris: Sun, Moon, Mercury..Neptune, Galilean moons, body orientations, phases, magnitudes.
 *
 * Pure functions of `d` = days since J2000.0 (2000-01-01 12:00) on the TT scale (use `ttFromUtcDays` to convert the
 * UTC-based `orbit.daysSinceJ2000`). They write into caller-supplied `out` objects (any {x, y, z}, e.g. THREE.Vector3)
 * and allocate nothing, so they can run every frame or inside an integrator. No three.js dependency.
 *
 * Frame: ECI = ICRF / mean equator and equinox of J2000 (x -> vernal equinox, z -> celestial north), km. This is the
 * frame of the star catalogue (RA/Dec J2000) and of `orbit.skyQuat` (ECI -> render frame).
 *
 *  - Planets: JPL "Keplerian Elements for Approximate Positions of the Major Planets" (Standish & Williams 1992,
 *    table 1, valid 1800-2050; errors ~15"-600" heliocentric), heliocentric ecliptic J2000 -> equatorial. The Earth is
 *    the Earth-Moon barycentre minus 1/82.30057 of the geocentric Moon. Geocentric positions are astrometric
 *    (one light-time iteration, no aberration), consistent with the catalogue stars.
 *  - Moon: Meeus, Astronomical Algorithms ch. 47 (truncated ELP-2000/82: 60 + 60 periodic terms, ~10" in longitude,
 *    ~4" in latitude, ~10 km in distance), mean equinox of date precessed to J2000 (rotation about the ecliptic pole).
 *  - Sun: minus the heliocentric Earth (geometric).
 *  - Orientation: IAU WGCCRE 2009 pole and prime meridian models (Archinal et al. 2011); the Moon with the full
 *    periodic series E1..E13 (physical libration; the optical libration follows from the geometry), so the body frame
 *    of the Moon is the mean-Earth / polar-axis frame of the LRO/LOLA maps (lon 0 = mean sub-Earth point).
 *  - Magnitudes: Mallama & Hilton (2018) phase curves (Astronomical Almanac); Moon: Allen (+ opposition surge).
 *  - Galilean moons: Meeus ch. 44 low-accuracy theory, placed in Jupiter's equatorial plane.
 *
 * Body-fixed frame convention (all bodies): +x = (lat 0, lon 0), +y = (lat 0, lon 90 E), +z = north pole.
 * `bodyRotation(name, d, m)` returns the 3x3 matrix (row-major array of 9) taking body-fixed vectors to ECI:
 *   v_eci = M * v_body,  M = Rz(alpha0 + 90 deg) * Rx(90 deg - delta0) * Rz(W).
 *
 * Usage (no allocations per call):
 *   const eph = new Ephemeris();              // bundles everything for one instant
 *   eph.update(d, observerEci);               // observerEci: station position in ECI km (or null = geocentre)
 *   eph.bodies.jupiter.topo / .dist / .mag / .phase / .illum / .angRadius / .ra / .dec / .rot (body->ECI)
 * or the individual functions (moonGeocentric, planetGeocentric, sunGeocentric, bodyRotation, planetMagnitude…).
 */

export const DEG = Math.PI / 180;
export const AU_KM = 149597870.7;
export const C_KM_S = 299792.458;
export const OBLIQUITY_J2000 = 23.43928 * DEG;     // Standish (ecliptic J2000 -> ICRF), IAU 1976 value 84381.448"
/** TT - UTC in seconds for the 2020s (37 leap seconds + 32.184 s). */
export const TT_MINUS_UTC = 69.184;
const COS_EPS = Math.cos(OBLIQUITY_J2000), SIN_EPS = Math.sin(OBLIQUITY_J2000);
const GM_EARTH = 398600.435507, GM_MOON = 4902.800118;
const EMB_MOON_FRACTION = GM_MOON / (GM_EARTH + GM_MOON);   // = 1 / 82.30057

/** Days since J2000 TT from days since J2000 UTC (orbit.daysSinceJ2000). */
export function ttFromUtcDays(dUtc) { return dUtc + TT_MINUS_UTC / 86400; }

/**
 * Physical data per body. radius / polarRadius km; albedo = geometric (V); bv = colour index used for the star-like
 * point; rings (Saturn): inner/outer radius km of the textured ring plane.
 */
export const BODY_DATA = {
  sun:     { ru: 'Солнце', radius: 695700, polarRadius: 695700, albedo: 0, bv: 0.65 },
  mercury: { ru: 'Меркурий', radius: 2440.53, polarRadius: 2438.26, albedo: 0.106, bv: 0.93 },
  venus:   { ru: 'Венера', radius: 6051.8, polarRadius: 6051.8, albedo: 0.65, bv: 0.82 },
  earth:   { ru: 'Земля', radius: 6378.1366, polarRadius: 6356.7519, albedo: 0.367, bv: 0.2 },
  moon:    { ru: 'Луна', radius: 1737.4, polarRadius: 1737.4, albedo: 0.12, bv: 0.92 },
  mars:    { ru: 'Марс', radius: 3396.19, polarRadius: 3376.2, albedo: 0.15, bv: 1.36 },
  jupiter: { ru: 'Юпитер', radius: 71492, polarRadius: 66854, albedo: 0.52, bv: 0.83 },
  saturn:  { ru: 'Сатурн', radius: 60268, polarRadius: 54364, albedo: 0.47, bv: 1.04, rings: { inner: 66900, outer: 140970 } },
  uranus:  { ru: 'Уран', radius: 25559, polarRadius: 24973, albedo: 0.51, bv: 0.56 },
  neptune: { ru: 'Нептун', radius: 24764, polarRadius: 24341, albedo: 0.41, bv: 0.41 },
  io:       { ru: 'Ио', radius: 1821.6, polarRadius: 1821.6, albedo: 0.63, bv: 1.17, parent: 'jupiter', V10: -1.68 },
  europa:   { ru: 'Европа', radius: 1560.8, polarRadius: 1560.8, albedo: 0.67, bv: 0.87, parent: 'jupiter', V10: -1.41 },
  ganymede: { ru: 'Ганимед', radius: 2631.2, polarRadius: 2631.2, albedo: 0.43, bv: 0.83, parent: 'jupiter', V10: -2.09 },
  callisto: { ru: 'Каллисто', radius: 2410.3, polarRadius: 2410.3, albedo: 0.22, bv: 0.86, parent: 'jupiter', V10: -1.05 },
};
export const PLANETS = ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
export const GALILEAN = ['io', 'europa', 'ganymede', 'callisto'];

/**
 * Standish & Williams table 1 (1800-2050): [a au, e, I deg, L deg, varpi deg, Omega deg] at J2000 and per century.
 * 'emb' = Earth-Moon barycentre.
 */
const ELEMENTS = {
  mercury: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593,
            0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  venus:   [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255,
            0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  emb:     [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0,
            0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  mars:    [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
            0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  jupiter: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
            -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  saturn:  [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
            -0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  uranus:  [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503,
            -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574,
            0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
};

/**
 * IAU 2009 rotation models: [alpha0, dAlpha/T, delta0, dDelta/T, W0, dW/d] (deg, T centuries, d days, TDB ~ TT).
 * Sign of dW < 0 = retrograde rotation (Venus, Uranus).
 */
const ROTATION = {
  sun:     [286.13, 0, 63.87, 0, 84.176, 14.1844000],
  mercury: [281.0097, -0.0328, 61.4143, -0.0049, 329.5469, 6.1385025],
  venus:   [272.76, 0, 67.16, 0, 160.20, -1.4813688],
  earth:   [0.0, -0.641, 90.0, -0.557, 190.147, 360.9856235],
  mars:    [317.68143, -0.1061, 52.88650, -0.0609, 176.630, 350.89198226],
  jupiter: [268.056595, -0.006499, 64.495303, 0.002413, 284.95, 870.5360000],
  saturn:  [40.589, -0.036, 83.537, -0.004, 38.90, 810.7939024],
  uranus:  [257.311, 0, -15.175, 0, 203.81, -501.1600928],
  neptune: [299.36, 0, 43.46, 0, 249.978, 541.1397757],
  // Galilean moons: synchronous, IAU mean models without the periodic terms
  io:       [268.05, -0.009, 64.50, 0.003, 200.39, 203.4889538],
  europa:   [268.08, -0.009, 64.51, 0.003, 36.022, 101.3747235],
  ganymede: [268.20, -0.009, 64.57, 0.003, 44.064, 50.3176081],
  callisto: [268.72, -0.009, 64.83, 0.003, 259.51, 21.5710715],
};

// ----------------------------------------------------------------------------------------------- helpers

function wrap360(x) { x %= 360; return x < 0 ? x + 360 : x; }

/** Ecliptic J2000 -> equatorial J2000 (in place allowed). */
export function eclipticToEquatorial(v, out = v) {
  const x = v.x, y = v.y, z = v.z;
  out.x = x; out.y = COS_EPS * y - SIN_EPS * z; out.z = SIN_EPS * y + COS_EPS * z;
  return out;
}

/** RA (rad, 0..2pi) and Dec (rad) of an ECI vector -> out {ra, dec}. */
export function raDec(v, out) {
  const r = Math.hypot(v.x, v.y, v.z) || 1;
  let ra = Math.atan2(v.y, v.x); if (ra < 0) ra += 2 * Math.PI;
  out.ra = ra; out.dec = Math.asin(Math.max(-1, Math.min(1, v.z / r)));
  return out;
}

/** Unit ECI vector from RA/Dec (rad). */
export function fromRaDec(ra, dec, out) {
  const cd = Math.cos(dec);
  out.x = cd * Math.cos(ra); out.y = cd * Math.sin(ra); out.z = Math.sin(dec);
  return out;
}

// ----------------------------------------------------------------------------------------------- planets

/**
 * Heliocentric position (km, ECLIPTIC J2000) of a planet or 'emb' from the JPL approximate elements. Returns out.
 */
export function planetHeliocentricEcliptic(name, d, out) {
  const el = ELEMENTS[name];
  const T = d / 36525;
  const a = (el[0] + el[6] * T) * AU_KM;
  const e = el[1] + el[7] * T;
  const I = (el[2] + el[8] * T) * DEG;
  const L = el[3] + el[9] * T;
  const varpi = el[4] + el[10] * T;
  const Om = el[5] + el[11] * T;
  const w = (varpi - Om) * DEG;
  let M = wrap360(L - varpi);
  if (M > 180) M -= 360;
  M *= DEG;
  // Kepler's equation (radians)
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 8; k++) {
    const dE = (M - (E - e * Math.sin(E))) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(Om * DEG), sO = Math.sin(Om * DEG), cI = Math.cos(I), sI = Math.sin(I);
  out.x = (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp;
  out.y = (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp;
  out.z = (sw * sI) * xp + (cw * sI) * yp;
  return out;
}

/** Heliocentric position (km, ECI J2000) of a planet. */
export function planetHeliocentric(name, d, out) {
  return eclipticToEquatorial(planetHeliocentricEcliptic(name, d, out));
}

const _moonTmp = { x: 0, y: 0, z: 0 };
/** Heliocentric position (km, ECI J2000) of the Earth's centre. */
export function earthHeliocentric(d, out) {
  planetHeliocentric('emb', d, out);
  moonGeocentric(d, _moonTmp);
  out.x -= _moonTmp.x * EMB_MOON_FRACTION; out.y -= _moonTmp.y * EMB_MOON_FRACTION; out.z -= _moonTmp.z * EMB_MOON_FRACTION;
  return out;
}

/** Geocentric Sun (km, ECI J2000). */
export function sunGeocentric(d, out) {
  earthHeliocentric(d, out);
  out.x = -out.x; out.y = -out.y; out.z = -out.z;
  return out;
}

const _earthH = { x: 0, y: 0, z: 0 };
/**
 * Geocentric astrometric position (km, ECI J2000) of a planet; `lightTime` (default true) evaluates the planet at
 * t - distance / c. Optional `helioOut` receives the planet's heliocentric position at the emission time.
 */
export function planetGeocentric(name, d, out, lightTime = true, helioOut = null) {
  earthHeliocentric(d, _earthH);
  const h = helioOut || out;
  planetHeliocentric(name, d, h);
  if (lightTime) {
    for (let k = 0; k < 2; k++) {
      const dist = Math.hypot(h.x - _earthH.x, h.y - _earthH.y, h.z - _earthH.z);
      planetHeliocentric(name, d - dist / C_KM_S / 86400, h);
    }
  }
  const hx = h.x, hy = h.y, hz = h.z;
  out.x = hx - _earthH.x; out.y = hy - _earthH.y; out.z = hz - _earthH.z;
  return out;
}

// ----------------------------------------------------------------------------------------------- Moon (Meeus 47)

// [D, M, M', F, sigma_l (1e-6 deg), sigma_r (1e-3 km)]
const MOON_LR = new Float64Array([
  0, 0, 1, 0, 6288774, -20905355, 2, 0, -1, 0, 1274027, -3699111, 2, 0, 0, 0, 658314, -2955968, 0, 0, 2, 0, 213618, -569925,
  0, 1, 0, 0, -185116, 48888, 0, 0, 0, 2, -114332, -3149, 2, 0, -2, 0, 58793, 246158, 2, -1, -1, 0, 57066, -152138,
  2, 0, 1, 0, 53322, -170733, 2, -1, 0, 0, 45758, -204586, 0, 1, -1, 0, -40923, -129620, 1, 0, 0, 0, -34720, 108743,
  0, 1, 1, 0, -30383, 104755, 2, 0, 0, -2, 15327, 10321, 0, 0, 1, 2, -12528, 0, 0, 0, 1, -2, 10980, 79661,
  4, 0, -1, 0, 10675, -34782, 0, 0, 3, 0, 10034, -23210, 4, 0, -2, 0, 8548, -21636, 2, 1, -1, 0, -7888, 24208,
  2, 1, 0, 0, -6766, 30824, 1, 0, -1, 0, -5163, -8379, 1, 1, 0, 0, 4987, -16675, 2, -1, 1, 0, 4036, -12831,
  2, 0, 2, 0, 3994, -10445, 4, 0, 0, 0, 3861, -11650, 2, 0, -3, 0, 3665, 14403, 0, 1, -2, 0, -2689, -7003,
  2, 0, -1, 2, -2602, 0, 2, -1, -2, 0, 2390, 10056, 1, 0, 1, 0, -2348, 6322, 2, -2, 0, 0, 2236, -9884,
  0, 1, 2, 0, -2120, 5751, 0, 2, 0, 0, -2069, 0, 2, -2, -1, 0, 2048, -4950, 2, 0, 1, -2, -1773, 4130,
  2, 0, 0, 2, -1595, 0, 4, -1, -1, 0, 1215, -3958, 0, 0, 2, 2, -1110, 0, 3, 0, -1, 0, -892, 3258,
  2, 1, 1, 0, -810, 2616, 4, -1, -2, 0, 759, -1897, 0, 2, -1, 0, -713, -2117, 2, 2, -1, 0, -700, 2354,
  2, 1, -2, 0, 691, 0, 2, -1, 0, -2, 596, 0, 4, 0, 1, 0, 549, -1423, 0, 0, 4, 0, 537, -1117,
  4, -1, 0, 0, 520, -1571, 1, 0, -2, 0, -487, -1739, 2, 1, 0, -2, -399, 0, 0, 0, 2, -2, -381, -4421,
  1, 1, 1, 0, 351, 0, 3, 0, -2, 0, -340, 0, 4, 0, -3, 0, 330, 0, 2, -1, 2, 0, 327, 0,
  0, 2, 1, 0, -323, 1165, 1, 1, -1, 0, 299, 0, 2, 0, 3, 0, 294, 0, 2, 0, -1, -2, 0, 8752,
]);
// [D, M, M', F, sigma_b (1e-6 deg)]
const MOON_B = new Float64Array([
  0, 0, 0, 1, 5128122, 0, 0, 1, 1, 280602, 0, 0, 1, -1, 277693, 2, 0, 0, -1, 173237, 2, 0, -1, 1, 55413,
  2, 0, -1, -1, 46271, 2, 0, 0, 1, 32573, 0, 0, 2, 1, 17198, 2, 0, 1, -1, 9266, 0, 0, 2, -1, 8822,
  2, -1, 0, -1, 8216, 2, 0, -2, -1, 4324, 2, 0, 1, 1, 4200, 2, 1, 0, -1, -3359, 2, -1, -1, 1, 2463,
  2, -1, 0, 1, 2211, 2, -1, -1, -1, 2065, 0, 1, -1, -1, -1870, 4, 0, -1, -1, 1828, 0, 1, 0, 1, -1794,
  0, 0, 0, 3, -1749, 0, 1, -1, 1, -1565, 1, 0, 0, 1, -1491, 0, 1, 1, 1, -1475, 0, 1, 1, -1, -1410,
  0, 1, 0, -1, -1344, 1, 0, 0, -1, -1335, 0, 0, 3, 1, 1107, 4, 0, 0, -1, 1021, 4, 0, -1, 1, 833,
  0, 0, 1, -3, 777, 4, 0, -2, 1, 671, 2, 0, 0, -3, 607, 2, 0, 2, -1, 596, 2, -1, 1, -1, 491,
  2, 0, -2, 1, -451, 0, 0, 3, -1, 439, 2, 0, 2, 1, 422, 2, 0, -3, -1, 421, 2, 1, -1, 1, -366,
  2, 1, 0, 1, -351, 4, 0, 0, 1, 331, 2, -1, 1, 1, 315, 2, -2, 0, -1, 302, 0, 0, 1, 3, -283,
  2, 1, 1, -1, -229, 1, 1, 0, -1, 223, 1, 1, 0, 1, 223, 0, 1, -2, -1, -220, 2, 1, -1, -1, -220,
  1, 0, 1, 1, -185, 2, -1, -2, -1, 181, 0, 1, 2, 1, -177, 4, 0, -2, -1, 176, 4, -1, -1, -1, 166,
  1, 0, 1, -1, -164, 4, 0, 1, -1, 132, 1, 0, -1, -1, -119, 4, -1, 0, -1, 115, 2, -2, 0, 1, 107,
]);

/**
 * Geocentric Moon (km, ECI J2000), Meeus ch. 47. Optional `eclOut` receives {lon, lat, dist} (rad, rad, km) in the
 * ecliptic of date.
 */
export function moonGeocentric(d, out, eclOut = null) {
  const T = d / 36525, T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = wrap360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000) * DEG;
  const D = wrap360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000) * DEG;
  const M = wrap360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000) * DEG;
  const Mp = wrap360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000) * DEG;
  const F = wrap360(93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000) * DEG;
  const A1 = wrap360(119.75 + 131.849 * T) * DEG, A2 = wrap360(53.09 + 479264.290 * T) * DEG, A3 = wrap360(313.45 + 481266.484 * T) * DEG;
  const E = 1 - 0.002516 * T - 0.0000074 * T2, E2 = E * E;
  let sl = 0, sr = 0, sb = 0;
  for (let i = 0; i < MOON_LR.length; i += 6) {
    const m = MOON_LR[i + 1];
    const arg = MOON_LR[i] * D + m * M + MOON_LR[i + 2] * Mp + MOON_LR[i + 3] * F;
    const f = m === 0 ? 1 : (m === 1 || m === -1 ? E : E2);
    sl += MOON_LR[i + 4] * f * Math.sin(arg);
    sr += MOON_LR[i + 5] * f * Math.cos(arg);
  }
  for (let i = 0; i < MOON_B.length; i += 5) {
    const m = MOON_B[i + 1];
    const arg = MOON_B[i] * D + m * M + MOON_B[i + 2] * Mp + MOON_B[i + 3] * F;
    const f = m === 0 ? 1 : (m === 1 || m === -1 ? E : E2);
    sb += MOON_B[i + 4] * f * Math.sin(arg);
  }
  sl += 3958 * Math.sin(A1) + 1962 * Math.sin(Lp - F) + 318 * Math.sin(A2);
  sb += -2235 * Math.sin(Lp) + 382 * Math.sin(A3) + 175 * Math.sin(A1 - F) + 175 * Math.sin(A1 + F) + 127 * Math.sin(Lp - Mp) - 115 * Math.sin(Lp + Mp);
  const lonDate = Lp + (sl / 1e6) * DEG;
  const lat = (sb / 1e6) * DEG;
  const dist = 385000.56 + sr / 1000;
  if (eclOut) { eclOut.lon = lonDate; eclOut.lat = lat; eclOut.dist = dist; }
  // precession from the mean equinox of date back to J2000 (general precession in longitude)
  const lon = lonDate - ((5029.0966 * T + 1.11113 * T2) / 3600) * DEG;
  const cb = Math.cos(lat);
  out.x = dist * cb * Math.cos(lon); out.y = dist * cb * Math.sin(lon); out.z = dist * Math.sin(lat);
  return eclipticToEquatorial(out);
}

// ----------------------------------------------------------------------------------------------- orientation

/** Fills m (array of 9, row-major) with Rz(a0 + 90) Rx(90 - d0) Rz(W): body-fixed -> ECI. Angles in degrees. */
export function rotationFromPole(alpha0, delta0, W, m) {
  const a = (alpha0 + 90) * DEG, b = (90 - delta0) * DEG, w = W * DEG;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cw = Math.cos(w), sw = Math.sin(w);
  // Rz(a) * Rx(b)
  const r00 = ca, r01 = -sa * cb, r02 = sa * sb;
  const r10 = sa, r11 = ca * cb, r12 = -ca * sb;
  const r20 = 0, r21 = sb, r22 = cb;
  // * Rz(w)
  m[0] = r00 * cw + r01 * sw; m[1] = -r00 * sw + r01 * cw; m[2] = r02;
  m[3] = r10 * cw + r11 * sw; m[4] = -r10 * sw + r11 * cw; m[5] = r12;
  m[6] = r20 * cw + r21 * sw; m[7] = -r20 * sw + r21 * cw; m[8] = r22;
  return m;
}

/** IAU 2009 Moon pole / prime meridian with the periodic terms -> out {alpha0, delta0, W} (deg). */
export function moonPole(d, out) {
  const T = d / 36525;
  const E1 = (125.045 - 0.0529921 * d) * DEG, E2 = (250.089 - 0.1059842 * d) * DEG, E3 = (260.008 + 13.0120009 * d) * DEG;
  const E4 = (176.625 + 13.3407154 * d) * DEG, E5 = (357.529 + 0.9856003 * d) * DEG, E6 = (311.589 + 26.4057084 * d) * DEG;
  const E7 = (134.963 + 13.0649930 * d) * DEG, E8 = (276.617 + 0.3287146 * d) * DEG, E9 = (34.226 + 1.7484877 * d) * DEG;
  const E10 = (15.134 - 0.1589763 * d) * DEG, E11 = (119.743 + 0.0036096 * d) * DEG, E12 = (239.961 + 0.1643573 * d) * DEG;
  const E13 = (25.053 + 12.9590088 * d) * DEG;
  const s = Math.sin, c = Math.cos;
  out.alpha0 = 269.9949 + 0.0031 * T - 3.8787 * s(E1) - 0.1204 * s(E2) + 0.0700 * s(E3) - 0.0172 * s(E4) + 0.0072 * s(E6)
    - 0.0052 * s(E10) + 0.0043 * s(E13);
  out.delta0 = 66.5392 + 0.0130 * T + 1.5419 * c(E1) + 0.0239 * c(E2) - 0.0278 * c(E3) + 0.0068 * c(E4) - 0.0029 * c(E6)
    + 0.0009 * c(E7) + 0.0008 * c(E10) - 0.0009 * c(E13);
  out.W = 38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.5610 * s(E1) + 0.1208 * s(E2) - 0.0642 * s(E3) + 0.0158 * s(E4)
    + 0.0252 * s(E5) - 0.0066 * s(E6) - 0.0047 * s(E7) - 0.0046 * s(E8) + 0.0028 * s(E9) + 0.0052 * s(E10) + 0.0040 * s(E11)
    + 0.0019 * s(E12) - 0.0044 * s(E13);
  return out;
}

const _pole = { alpha0: 0, delta0: 0, W: 0 };
/** Body-fixed -> ECI rotation (row-major 3x3 in m) for 'moon', 'sun', a planet or a Galilean moon. */
export function bodyRotation(name, d, m) {
  if (name === 'moon') { moonPole(d, _pole); return rotationFromPole(_pole.alpha0, _pole.delta0, _pole.W, m); }
  const r = ROTATION[name];
  if (!r) { m[0] = 1; m[1] = 0; m[2] = 0; m[3] = 0; m[4] = 1; m[5] = 0; m[6] = 0; m[7] = 0; m[8] = 1; return m; }
  const T = d / 36525;
  let a0 = r[0] + r[1] * T, d0 = r[2] + r[3] * T;
  if (name === 'neptune') {
    const N = (357.85 + 52.316 * T) * DEG;
    a0 += 0.70 * Math.sin(N); d0 -= 0.51 * Math.cos(N);
    return rotationFromPole(a0, d0, wrap360(r[4] + r[5] * d - 0.48 * Math.sin(N)), m);
  }
  return rotationFromPole(a0, d0, wrap360(r[4] + r[5] * d), m);
}

/** Apply a row-major 3x3 to v (in place allowed). */
export function applyMat3(m, v, out = v) {
  const x = v.x, y = v.y, z = v.z;
  out.x = m[0] * x + m[1] * y + m[2] * z; out.y = m[3] * x + m[4] * y + m[5] * z; out.z = m[6] * x + m[7] * y + m[8] * z;
  return out;
}
/** Apply the transpose (ECI -> body-fixed). */
export function applyMat3T(m, v, out = v) {
  const x = v.x, y = v.y, z = v.z;
  out.x = m[0] * x + m[3] * y + m[6] * z; out.y = m[1] * x + m[4] * y + m[7] * z; out.z = m[2] * x + m[5] * y + m[8] * z;
  return out;
}

// ----------------------------------------------------------------------------------------------- photometry

/**
 * Apparent V magnitude (Mallama & Hilton 2018). r, delta in au, phase angle in degrees. `extra.ringTilt` (rad,
 * Saturn: latitude of the observer w.r.t. the ring plane), `extra.subLat` (rad, Uranus: planetographic sub-observer
 * latitude).
 */
export function planetMagnitude(name, r, delta, phaseDeg, extra = null) {
  const a = phaseDeg, dm = 5 * Math.log10(r * delta);
  switch (name) {
    case 'mercury': return dm - 0.613 + a * (6.3280e-2 + a * (-1.6336e-3 + a * (3.3644e-5 + a * (-3.4265e-7 + a * (1.6893e-9 - 3.0334e-12 * a)))));
    case 'venus': return a < 163.7 ? dm - 4.384 + a * (-1.044e-3 + a * (3.687e-4 + a * (-2.814e-6 + 8.938e-9 * a))) : dm + 236.05828 - 2.81914 * a + 8.39034e-3 * a * a;
    case 'earth': return dm - 3.99 + a * (-1.060e-3 + 2.054e-4 * a);
    case 'mars': return a <= 50 ? dm - 1.601 + a * (2.267e-2 - 1.302e-4 * a) : dm - 0.367 - 0.02573 * a + 3.445e-4 * a * a;
    case 'jupiter': return a <= 12 ? dm - 9.395 + a * (-3.7e-4 + 6.16e-4 * a) : dm - 9.428 - 2.5 * Math.log10(1 - 1.507 * (a / 180) - 0.363 * (a / 180) ** 2 - 0.062 * (a / 180) ** 3 + 2.809 * (a / 180) ** 4 - 1.876 * (a / 180) ** 5);
    case 'saturn': {
      const sb = Math.abs(Math.sin(extra?.ringTilt ?? 0));
      return dm - 8.914 - 1.825 * sb + 0.026 * a - 0.378 * sb * Math.exp(-2.25 * a);
    }
    case 'uranus': return dm - 7.110 - 8.4e-4 * Math.abs((extra?.subLat ?? 0) / DEG) + a * (6.587e-3 + 1.045e-4 * a);
    case 'neptune': return dm - 7.00 + a * (7.944e-3 + 9.617e-5 * a);
    default: {
      const b = BODY_DATA[name];
      if (b && b.V10 !== undefined) return dm + b.V10 + 0.04 * a;     // Galilean moons: linear phase law
      return 99;
    }
  }
}

/** Apparent V magnitude of the Moon: phase angle deg, distances km (Allen; opposition surge below 7 deg). */
export function moonMagnitude(phaseDeg, distKm, sunDistKm = AU_KM) {
  const a = Math.abs(phaseDeg);
  let m = -12.73 + 0.026 * a + 4e-9 * a ** 4;
  if (a < 7) m -= 0.35 * (1 - a / 7);
  return m + 5 * Math.log10((distKm / 384400) * (sunDistKm / AU_KM));
}

/**
 * Phase angle (rad) at the body between the directions to the Sun and to the observer, from the body's position
 * relative to the observer (`rel`) and its heliocentric position (`helio`).
 */
export function phaseAngle(rel, helio) {
  // body -> Sun = -helio, body -> observer = -rel
  const dot = rel.x * helio.x + rel.y * helio.y + rel.z * helio.z;
  const n = Math.hypot(rel.x, rel.y, rel.z) * Math.hypot(helio.x, helio.y, helio.z) || 1;
  return Math.acos(Math.max(-1, Math.min(1, dot / n)));
}

// ----------------------------------------------------------------------------------------------- Galilean moons

const _jPole = new Float64Array(9);
/**
 * Jupiter-centred positions (km, ECI) of Io, Europa, Ganymede, Callisto (Meeus ch. 44, low accuracy) into
 * outs[0..3]; `jupGeo` = geocentric Jupiter (km, ECI), used for the light-time and the geocentric conjunction phase.
 */
export function galileanMoons(d, jupGeo, outs) {
  const RJ = 71492;
  const dist = Math.hypot(jupGeo.x, jupGeo.y, jupGeo.z);
  const dlt = d - dist / C_KM_S / 86400;                          // light-time
  const V = (172.74 + 0.00111588 * d) * DEG;
  const N = (20.020 + 0.0830853 * d + 0.329 * Math.sin(V)) * DEG;
  const B = (5.555 * Math.sin(N) + 0.168 * Math.sin(2 * N));      // deg
  const G = (331.18 + 50.310482 * dlt) * DEG, H = (87.45 + 21.569231 * dlt) * DEG;
  // psi (Jupiter's heliocentric-geocentric angle) is absorbed: u is measured from the geocentric superior conjunction
  // using the actual geocentric direction below, so only the mean motions and the perturbations are needed here.
  // Meeus' u is measured from the direction Earth->Jupiter (superior conjunction), shifted by (psi - B) from the
  // heliocentric one; with the geocentric direction projected on Jupiter's equator we take the heliocentric phase
  // (u_h = u - psi + B -> u from the Sun direction) and convert using the true heliocentric direction instead.
  let u1 = 163.8069 + 203.4058646 * dlt - B, u2 = 358.4140 + 101.2916335 * dlt - B;
  let u3 = 5.7176 + 50.2345180 * dlt - B, u4 = 224.8092 + 21.4879800 * dlt - B;
  const c1 = 0.473 * Math.sin(2 * (u1 - u2) * DEG), c2 = 1.065 * Math.sin(2 * (u2 - u3) * DEG);
  const c3 = 0.165 * Math.sin(G), c4 = 0.843 * Math.sin(H);
  const r1 = 5.9057 - 0.0244 * Math.cos(2 * (u1 - u2) * DEG), r2 = 9.3966 - 0.0882 * Math.cos(2 * (u2 - u3) * DEG);
  const r3 = 14.9883 - 0.0216 * Math.cos(G), r4 = 26.3627 - 0.1939 * Math.cos(H);
  u1 += c1; u2 += c2; u3 += c3; u4 += c4;
  // reference direction: the anti-Sun direction from Jupiter (heliocentric superior conjunction = moon behind
  // Jupiter as seen from the Sun), projected on Jupiter's equatorial plane
  bodyRotation('jupiter', d, _jPole);
  const px = _jPole[2], py = _jPole[5], pz = _jPole[8];        // pole (ECI)
  planetHeliocentric('jupiter', dlt, _gTmp);
  let ex = _gTmp.x, ey = _gTmp.y, ez = _gTmp.z;               // Sun -> Jupiter (= away from the Sun)
  const k = ex * px + ey * py + ez * pz;
  ex -= k * px; ey -= k * py; ez -= k * pz;
  const el = Math.hypot(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
  const fx = py * ez - pz * ey, fy = pz * ex - px * ez, fz = px * ey - py * ex;   // pole x e: prograde
  const us = [u1, u2, u3, u4], rs = [r1, r2, r3, r4];
  for (let i = 0; i < 4; i++) {
    const u = us[i] * DEG, r = rs[i] * RJ, cu = Math.cos(u), su = Math.sin(u);
    const o = outs[i];
    o.x = r * (cu * ex + su * fx); o.y = r * (cu * ey + su * fy); o.z = r * (cu * ez + su * fz);
  }
  return outs;
}
const _gTmp = { x: 0, y: 0, z: 0 };

// ----------------------------------------------------------------------------------------------- bundle

function makeBody(name) {
  return {
    name, ru: BODY_DATA[name].ru, data: BODY_DATA[name],
    geo: { x: 0, y: 0, z: 0 },        // geocentric ECI km (astrometric)
    helio: { x: 0, y: 0, z: 0 },      // heliocentric ECI km (at emission time)
    topo: { x: 0, y: 0, z: 0 },       // relative to the observer, ECI km
    dist: 0,                          // observer distance km
    ra: 0, dec: 0,                    // rad (topocentric)
    phase: 0,                         // phase angle rad (0 = full)
    illum: 1,                         // illuminated fraction of the disc
    mag: 0,                           // apparent V
    angRadius: 0,                     // apparent equatorial radius (rad)
    rot: new Float64Array(9),         // body-fixed -> ECI
    sunDir: { x: 0, y: 0, z: 0 },     // unit ECI direction body -> Sun
  };
}

/**
 * Everything for one instant: `update(d, observerEci)` with d = TT days since J2000 and the observer (station)
 * position in ECI km (null = the geocentre). Bodies: sun, moon, mercury..neptune, io..callisto.
 */
export class Ephemeris {
  constructor() {
    this.d = 0;
    this.names = ['sun', 'moon', ...PLANETS, ...GALILEAN];
    this.bodies = {};
    for (const n of this.names) this.bodies[n] = makeBody(n);
    this._obs = { x: 0, y: 0, z: 0 };
    this._rd = { ra: 0, dec: 0 };
    this._gal = [this.bodies.io.geo, this.bodies.europa.geo, this.bodies.ganymede.geo, this.bodies.callisto.geo];
  }

  update(d, observerEci = null) {
    this.d = d;
    const B = this.bodies, o = this._obs;
    if (observerEci) { o.x = observerEci.x; o.y = observerEci.y; o.z = observerEci.z; } else { o.x = 0; o.y = 0; o.z = 0; }
    // Sun
    const sun = B.sun;
    sunGeocentric(d, sun.geo);
    sun.helio.x = 0; sun.helio.y = 0; sun.helio.z = 0;
    this._finish(sun);
    sun.mag = -26.74 + 5 * Math.log10(sun.dist / AU_KM);
    sun.phase = 0; sun.illum = 1;
    // Moon
    const moon = B.moon;
    moonGeocentric(d, moon.geo);
    moon.helio.x = moon.geo.x - sun.geo.x; moon.helio.y = moon.geo.y - sun.geo.y; moon.helio.z = moon.geo.z - sun.geo.z;
    this._finish(moon);
    moon.mag = moonMagnitude(moon.phase / DEG, moon.dist, Math.hypot(moon.helio.x, moon.helio.y, moon.helio.z));
    // planets
    for (const n of PLANETS) {
      const b = B[n];
      planetGeocentric(n, d, b.geo, true, b.helio);
      this._finish(b);
      const r = Math.hypot(b.helio.x, b.helio.y, b.helio.z) / AU_KM, delta = b.dist / AU_KM;
      let extra = null;
      if (n === 'saturn' || n === 'uranus') {
        // latitude of the observer over the equator (ring plane): -topo . pole
        const lat = Math.asin(Math.max(-1, Math.min(1, -(b.topo.x * b.rot[2] + b.topo.y * b.rot[5] + b.topo.z * b.rot[8]) / b.dist)));
        extra = this._extra || (this._extra = { ringTilt: 0, subLat: 0 });
        extra.ringTilt = lat; extra.subLat = lat;
        b.ringTilt = lat;
      }
      b.mag = planetMagnitude(n, r, delta, b.phase / DEG, extra);
    }
    // Galilean moons (Jupiter-centred offsets -> geocentric)
    const jup = B.jupiter;
    galileanMoons(d, jup.geo, this._gal);
    for (const n of GALILEAN) {
      const b = B[n];
      b.geo.x += jup.geo.x; b.geo.y += jup.geo.y; b.geo.z += jup.geo.z;
      b.helio.x = b.geo.x - sun.geo.x; b.helio.y = b.geo.y - sun.geo.y; b.helio.z = b.geo.z - sun.geo.z;
      this._finish(b);
      b.mag = planetMagnitude(n, Math.hypot(b.helio.x, b.helio.y, b.helio.z) / AU_KM, b.dist / AU_KM, b.phase / DEG);
      b.occulted = this._behind(b, jup);
    }
    return this;
  }

  /** Topocentric vector, distance, RA/Dec, phase, angular radius, orientation, Sun direction. */
  _finish(b) {
    const o = this._obs;
    b.topo.x = b.geo.x - o.x; b.topo.y = b.geo.y - o.y; b.topo.z = b.geo.z - o.z;
    b.dist = Math.hypot(b.topo.x, b.topo.y, b.topo.z);
    raDec(b.topo, this._rd); b.ra = this._rd.ra; b.dec = this._rd.dec;
    b.angRadius = Math.asin(Math.min(1, b.data.radius / b.dist));
    bodyRotation(b.name, this.d, b.rot);
    const hl = Math.hypot(b.helio.x, b.helio.y, b.helio.z);
    if (hl > 0) {
      b.sunDir.x = -b.helio.x / hl; b.sunDir.y = -b.helio.y / hl; b.sunDir.z = -b.helio.z / hl;
      b.phase = phaseAngle(b.topo, b.helio);
    } else { b.sunDir.x = 0; b.sunDir.y = 0; b.sunDir.z = 1; b.phase = 0; }
    b.illum = 0.5 * (1 + Math.cos(b.phase));
  }

  /** True when `b` is hidden behind (or in transit over -> false) the disc of `p` as seen by the observer. */
  _behind(b, p) {
    if (b.dist < p.dist) return false;
    const dot = (b.topo.x * p.topo.x + b.topo.y * p.topo.y + b.topo.z * p.topo.z) / (b.dist * p.dist);
    return Math.acos(Math.min(1, dot)) < p.angRadius;
  }
}
