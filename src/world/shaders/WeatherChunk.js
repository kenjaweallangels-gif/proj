/**
 * Shared GLSL for the evolving weather on the Earth shells (ground shadows, cloud layer, sea-surface wind).
 * All positions are in the Earth-fixed object frame of the sphere meshes (km; +Y north pole, +X lon 0, -Z lon 90E).
 *
 * Cloud cover = the NASA cloud map advected by a zonal-wind climatology (two-phase flow map with a
 * variance-preserving blend, phase desynchronised by region) + slow growth/decay noise + sub-texel erosion
 * detail + afternoon cumulus over tropical land + analytic tropical cyclones + thunderstorm cells (from
 * Weather.js). Requires ATMOSPHERE_GLSL (PI, R_GROUND) and the defines MAX_CYC, MAX_CELLS, DETAIL (0..3), CLOUD_TEX_W.
 */
export const WEATHER_GLSL = /* glsl */`
uniform sampler2D tClouds;
uniform highp sampler3D tNoise;      // 64^3, RG: R tileable gradient noise (8 cells per period), G inverted Worley (8 cells)
uniform sampler2D tAux;              // R land fraction, G sqrt(depth/8000 m), B sqrt(elevation/6400 m)
uniform vec4 uFlow;                  // x: cloud-map drift (texture u); y, z: unused; w: weather time (s, wrapped)
uniform vec4 uWx;                    // x: growth/decay amount, y: detail erosion, z: tropical cumulus amount, w: local-time offset (unused)
uniform vec3 uSunObj;                // Sun direction in the Earth-fixed frame (local solar time, day/night)
uniform vec4 uCyc[MAX_CYC * 2];      // [centre.xyz, outer radius km], [intensity, hemisphere sign, eye radius km, spin rad]
uniform vec4 uCell[MAX_CELLS * 2];   // [centre.xyz, anvil radius km], [maturity 0..1, seed, downwind sign, glow]

const float KM_TO_TEX_GROWTH = 1.0 / 5200.0;     // growth/decay noise: ~650 km cells
const float KM_TO_TEX_DETAIL = 1.0 / 56.0;       // grain: ~7 km cells (then x2.17, x4.63)
const float KM_TO_TEX_CU = 1.0 / 44.0;           // fair-weather cumulus: ~5.5 km cells

float nz(vec3 x) { return texture(tNoise, x).r; }
float wz(vec3 x) { return texture(tNoise, x).g; }
// explicit-LOD variants for taps inside non-uniform branches (no implicit derivatives there)
float nzl(vec3 x, float l) { return textureLod(tNoise, x, l).r; }
float wzl(vec3 x, float l) { return textureLod(tNoise, x, l).g; }

// Base cloud map drifting slowly eastward (rigid rotation at a few m/s: per-latitude advection either shears the
// map into streaks within a day or needs a flow-map reset that superposes or dissolves two unrelated cloud fields).
// The visible evolution comes from growth/decay, the diurnal convection, cyclones and storm cells.
// uv/derivatives of the sampled point are passed in (explicit gradients: the date-line wrap must not upset the mips).
float advectedClouds(vec3 p, vec2 uv, vec2 dx, vec2 dy, out float mean) {
  vec2 uvc = vec2(uv.x - uFlow.x, uv.y);
  mean = textureLod(tClouds, uvc, 5.5).r;
  return textureGrad(tClouds, uvc, dx, dy).r;
}

// The same with the cover gradient in uv (forward differences over 2 texels: smooth relief, no bilinear creases).
float advectedCloudsGrad(vec3 p, vec2 uv, vec2 dx, vec2 dy, out float mean, out vec2 grad) {
  vec2 uvc = vec2(uv.x - uFlow.x, uv.y);
  vec2 e = vec2(2.0 / CLOUD_TEX_W, 0.0);
  float b = textureGrad(tClouds, uvc, dx, dy).r;
  grad = vec2(textureGrad(tClouds, uvc + e.xy, dx, dy).r, textureGrad(tClouds, uvc + e.yx * 2.0, dx, dy).r) - b;
  mean = textureLod(tClouds, uvc, 5.5).r;
  return b;
}

// Slow growth / decay of cloud systems: two noise fields drifting through each other (boiling, no net drift).
float growthDecay(vec3 pKm) {
  float tw = uFlow.w;
  vec3 x = pKm * KM_TO_TEX_GROWTH;
  float a = nz(x + vec3(0.9, 0.2, 0.4) * tw * 4.0e-6);
  float b = nz(x * 1.7 + vec3(-0.3, 0.8, -0.6) * tw * 5.5e-6 + 0.37);
  return (a + 0.6 * b) / 1.6 * 2.0 - 1.0;          // ~[-1, 1]
}

// Local solar hour (0..24) of a point from the Sun's direction in the Earth-fixed frame.
float localSolarHour(vec3 p) {
  float hp = atan(-p.z, p.x), hs = atan(-uSunObj.z, uSunObj.x);
  return fract((hp - hs) / (2.0 * PI) + 0.5) * 24.0;
}

// Tangent-plane offset (km) of p from a centre c on the sphere of radius rKm, in (east, north) components.
vec2 tangentOffset(vec3 p, vec3 c, float rKm) {
  vec3 e = normalize(cross(vec3(0.0, 1.0, 0.0), c) + vec3(1.0e-6, 0.0, 0.0));
  vec3 n = cross(c, e);
  vec3 d = (p - c) * rKm;
  return vec2(dot(d, e), dot(d, n));
}

// Tropical cyclones: central dense overcast with overshooting tops, a clear eye with a bright eyewall, trailing
// log-spiral rain bands with convective texture, and a thin anticyclonic outflow cirrus with fine filaments.
// Returns density; storm = 0..1 the cyclone's area (other clouds are suppressed there); wall = eyewall weight;
// wind = sea-surface wind (m/s).
float cyclones(vec3 p, out float storm, out float wall, out float wind) {
  float c = 0.0; storm = 0.0; wall = 0.0; wind = 0.0;
  for (int i = 0; i < MAX_CYC; i++) {
    vec4 A = uCyc[i * 2], B = uCyc[i * 2 + 1];
    if (B.x <= 0.0) continue;
    float d2 = dot(p - A.xyz, p - A.xyz) * R_GROUND * R_GROUND;
    if (d2 > A.w * A.w) continue;
    vec2 q = tangentOffset(p, A.xyz, R_GROUND);
    float r = length(q);
    float R0 = A.w, re = B.z, I = B.x, hs = B.y;
    float th = atan(q.y, q.x) * hs;                       // counter-clockwise inflow in the north, clockwise in the south
    float rc = R0 * (0.16 + 0.12 * I);                    // central dense overcast radius
    float spin = B.w;
    // swirl: noise sampled in coordinates twisted by log-radius, so blobs are drawn out into a few broad trailing
    // spiral bands (pitch ~25 deg) that break up into convective clusters farther out
    float tw = th + 2.1 * log(max(r, 1.0) / rc) - spin;
    vec2 sw = vec2(cos(tw), sin(tw)) * r;
    float fi = float(i);
    float n1 = nz(vec3(sw * (1.0 / 1100.0), fi * 3.1));
    float n2 = nz(vec3(sw * (1.0 / 260.0), fi * 1.3 + 0.5));
    float n3 = nz(vec3(q * (1.0 / 45.0), fi * 0.7 + 0.2));          // convective lumps, not swirled
    float f = 0.62 * n1 + 0.25 * n2 + 0.13 * n3;
    float x = smoothstep(rc * 0.8, R0, r);
    float thr = mix(0.38, 0.6, x);                                   // overcast near the core, bands farther out
    float d = smoothstep(thr - 0.04, thr + 0.16, f) * (1.0 - smoothstep(0.7, 1.0, x));
    float cdo = smoothstep(rc * (1.2 + 1.2 * (n1 - 0.5) + 0.6 * (n2 - 0.5)), rc * 0.6, r);
    d = max(d, cdo) * (0.86 + 0.28 * n3);
    // eye: clear, a few low clouds on its floor, steep wall
    float eye = smoothstep(re * 0.8, re * 1.3, r * (1.0 + 0.25 * (n2 - 0.5)));
    d = mix(d, 0.18 * n3, (1.0 - eye) * smoothstep(0.35, 0.7, I));
    d *= smoothstep(0.03, 0.3, I) * (0.8 + 0.2 * I);
    c = max(c, d);
    storm = max(storm, smoothstep(R0, R0 * 0.4, r) * smoothstep(0.0, 0.3, I));
    wall = max(wall, exp(-pow((r - re * 1.5) / (re * 0.7), 2.0)) * smoothstep(0.4, 0.8, I));
    // Rankine-like wind profile for the sea surface (m/s)
    float rm = re * 2.0;
    float vmax = 18.0 + 52.0 * I;
    wind = max(wind, vmax * (r < rm ? r / rm : pow(rm / r, 0.6)) * smoothstep(R0 * 1.1, R0 * 0.5, r));
  }
  return c;
}

// Thunderstorm cells: lumpy cumulonimbus towers under a lobed anvil sheared downwind, fibrous anvil edges.
// Returns density; core = 0..1 convective core.
float stormCells(vec3 p, out float core) {
  float c = 0.0; core = 0.0;
  for (int i = 0; i < MAX_CELLS; i++) {
    vec4 A = uCell[i * 2], B = uCell[i * 2 + 1];
    if (B.x <= 0.0) continue;
    float d2 = dot(p - A.xyz, p - A.xyz) * R_GROUND * R_GROUND;
    float ra = A.w * (0.35 + 0.65 * sqrt(B.x));
    if (d2 > ra * ra * 9.0) continue;                          // anvil reach: 0.5 ra downwind + 1.25 ra / 0.6
    vec2 q = tangentOffset(p, A.xyz, R_GROUND);
    vec2 qa = vec2((q.x - B.z * ra * 0.5) * 0.6, q.y);           // anvil plume drifts downwind (east/west)
    float r = length(qa);
    vec2 dirA = qa / max(r, 1.0e-3);
    float lobes = nz(vec3(dirA * 0.17, B.y)) * 0.7 + nz(vec3(dirA * 0.45, B.y + 0.3)) * 0.3;   // 5-8 lobes
    float fib = nz(vec3(q * (1.0 / 12.0), B.y + 0.5));             // fibrous / lumpy texture inside
    float re = ra * (0.75 + 0.5 * lobes);
    float anvil = smoothstep(re, re * 0.45, r) * (0.75 + 0.25 * fib);
    float lump = nz(vec3(q * (1.0 / 7.0), B.y + 0.25));
    float tower = smoothstep(ra * 0.45, ra * 0.05, length(q) * (0.85 + 0.4 * lump));
    c = max(c, max(anvil, tower) * smoothstep(0.0, 0.2, B.x));
    core = max(core, tower * B.x);
  }
  return c;
}

// Afternoon fair-weather cumulus over humid tropical / subtropical land ("popcorn" fields), 0..1.
float cumulusPotential(vec3 p, vec2 uv, float meanCloud) {
  float land = textureLod(tAux, uv, 0.0).r;
  float latDeg = degrees(asin(clamp(p.y, -1.0, 1.0)));
  float lst = localSolarHour(p);
  float diurnal = smoothstep(9.5, 13.0, lst) * smoothstep(19.5, 16.0, lst);
  float humid = smoothstep(0.06, 0.3, meanCloud);
  float zone = exp(-pow((latDeg - 3.0) / 22.0, 2.0)) + 0.4 * exp(-pow((abs(latDeg) - 32.0) / 9.0, 2.0));
  return land * diurnal * humid * zone * uWx.z;
}

// Full cloud cover at p (unit, object frame). fpKm = screen footprint (km per pixel) for detail fading.
// grad = uv gradient of the advected map (relief); proc = the smooth procedural part (cyclones / storms) for bump
// shading; storm / wall / core for lighting.
float cloudCover(vec3 p, vec2 uv, vec2 dx, vec2 dy, float fpKm, out vec2 grad, out float proc, out float storm, out float wall, out float core, out float mean) {
  vec3 pKm = p * R_GROUND;
  float c = advectedCloudsGrad(p, uv, dx, dy, mean, grad);
  c = clamp(c + uWx.x * growthDecay(pKm) * (0.35 + 0.65 * smoothstep(0.05, 0.4, mean)), 0.0, 1.0);
#if DETAIL > 0
  // grain below the 5 km texels where the screen resolves it: thin and broken cloud gets a fine cellular /
  // fBm texture (multiplicative, so the real structure of the map is kept); thick cores stay smooth
  float f1 = 1.0 - smoothstep(2.0, 5.0, fpKm);
  float edge = 4.0 * c * (1.0 - c);
  if (f1 * edge > 0.0) {
    vec3 xd = pKm * KM_TO_TEX_DETAIL + vec3(0.0, 0.0, uFlow.w * 3.0e-6);
    float l0 = log2(max(fpKm * KM_TO_TEX_DETAIL * 64.0, 1.0e-3));   // 64 noise texels per period
    float n = 0.6 * nzl(xd, l0) + 0.4 * wzl(xd * 0.8 + 0.2, l0 - 0.32);
  #if DETAIL > 1
    float f2 = 1.0 - smoothstep(1.0, 2.5, fpKm);
    if (f2 > 0.0) n = mix(n, 0.55 * n + 0.45 * nzl(xd * 2.17 + 0.31, l0 + 1.12), f2);
  #endif
  #if DETAIL > 2
    float f3 = 1.0 - smoothstep(0.5, 1.4, fpKm);
    if (f3 > 0.0) n = mix(n, 0.65 * n + 0.35 * wzl(xd * 4.63 + 0.67, l0 + 2.21), f3);
  #endif
    c = clamp(c * (1.0 + uWx.y * f1 * edge * (n - 0.5) * 1.6), 0.0, 1.0);
  }
  // tropical afternoon cumulus
  float cuP = cumulusPotential(p, uv, mean);
  if (cuP > 0.01) {
    float cuFade = 1.0 - smoothstep(0.8, 2.5, fpKm);
    // puffs of a fixed size (a few km) in clusters whose extent grows with the potential
    float lc = log2(max(fpKm * KM_TO_TEX_CU * 64.0, 1.0e-3));
    float cluster = smoothstep(0.42, 0.62, nzl(pKm * (1.0 / 360.0), lc - 3.03) + 0.55 * (cuP - 0.6));
    float w = wzl(pKm * KM_TO_TEX_CU, lc) * 0.85 + 0.15 * nzl(pKm * KM_TO_TEX_CU * 0.29, lc - 1.79);
    float cu = smoothstep(0.52, 0.72, w) * cluster;
    c = max(c, mix(0.2 * cluster * cuP, cu * 0.85, cuFade));
  }
#endif
  float wind;
  float cy = cyclones(p, storm, wall, wind);
  float sc = stormCells(p, core);
  proc = max(cy, sc);
  c = max(c * (1.0 - 0.85 * storm), proc);
  return c;
}

// The analytic storms alone (cyclones + thunderstorm cells), for finite-difference relief shading.
float stormCover(vec3 p) {
  float storm, wall, wind, core;
  return max(cyclones(p, storm, wall, wind), stormCells(p, core));
}

// Cheaper cover for ground shadows (no detail, no cumulus).
float cloudCoverLite(vec3 p, vec2 uv, vec2 dx, vec2 dy) {
  float mean;
  float c = advectedClouds(p, uv, dx, dy, mean);
  c = clamp(c + uWx.x * growthDecay(p * R_GROUND) * (0.35 + 0.65 * smoothstep(0.05, 0.4, mean)), 0.0, 1.0);
  float storm, wall, wind, core;
  float proc = max(cyclones(p, storm, wall, wind), stormCells(p, core));
  return max(c * (1.0 - 0.85 * storm), proc);
}

// Sea-surface wind speed (m/s): trades, doldrums, westerlies (roaring forties), synoptic variability, cyclones.
float surfaceWind(vec3 p) {
  float latDeg = degrees(asin(clamp(p.y, -1.0, 1.0)));
  float a = abs(latDeg);
  float w = 5.5 + 2.5 * exp(-pow((a - 15.0) / 8.0, 2.0)) - 2.5 * exp(-pow((latDeg - 6.0) / 5.0, 2.0))
          + (latDeg < 0.0 ? 6.0 : 4.0) * exp(-pow((a - 50.0) / 10.0, 2.0)) - 2.0 * exp(-pow((a - 32.0) / 5.0, 2.0));
  w *= 0.55 + 0.9 * nz(p * (R_GROUND / 4200.0) + vec3(uFlow.w * 1.0e-6));
  float storm, wall, cw;
  cyclones(p, storm, wall, cw);
  return max(w, cw);
}
`;
