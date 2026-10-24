/**
 * Shared GLSL for the evolving weather on the Earth shells (ground shadows, cloud layer, sea-surface wind).
 * All positions are in the Earth-fixed object frame of the sphere meshes (km; +Y north pole, +X lon 0, -Z lon 90E).
 *
 * Cloud cover = the NASA cloud map (slow drift) + slow growth/decay noise + sub-texel texture + afternoon cumulus
 * over tropical land + analytic tropical cyclones + thunderstorm cells (from Weather.js). The procedural parts
 * return a cloud-top "height" (density = min(height, 1)) so convective tops, eyewalls and towers can be relief-lit.
 * All fine noise goes through fbmKm (rotated, non-commensurate octaves with explicit LODs): the 64^3 texture tiles
 * every 8 cells, and a single octave sampled at a fixed scale shows that period as a regular lattice. Requires ATMOSPHERE_GLSL (PI, R_GROUND) and the defines MAX_CYC, MAX_CELLS, DETAIL (0..3), CLOUD_TEX_W.
 */
export const WEATHER_GLSL = /* glsl */`
uniform sampler2D tClouds;
uniform highp sampler3D tNoise;      // 64^3, R: tileable gradient noise, G: inverted Worley F1 (8 cells per period)
uniform sampler2D tAux;              // R land fraction, G sqrt(depth/8000 m), B sqrt(elevation/6400 m)
uniform vec4 uFlow;                  // x: cloud-map drift (texture u); y, z: unused; w: weather time (s, wrapped)
uniform vec4 uWx;                    // x: growth/decay amount, y: detail erosion, z: tropical cumulus amount, w: local-time offset (unused)
uniform vec3 uSunObj;                // Sun direction in the Earth-fixed frame (local solar time, day/night)
uniform vec4 uCyc[MAX_CYC * 2];      // [centre.xyz, outer radius km], [intensity, hemisphere sign, eye radius km, spin rad]
uniform vec4 uCell[MAX_CELLS * 2];   // [centre.xyz, anvil radius km], [maturity 0..1, seed, downwind sign, glow]

const float KM_TO_TEX_GROWTH = 1.0 / 5200.0;     // growth/decay noise: ~650 km cells

float nz(vec3 x) { return texture(tNoise, x).r; }
// explicit-LOD variant for taps inside non-uniform branches (no implicit derivatives there)
float nzl(vec3 x, float l) { return textureLod(tNoise, x, l).r; }

// Screen footprint (km per pixel) of the sample being shaded, for the explicit noise LODs below. The cloud shader
// sets it per pixel; ground-shadow lookups leave it coarse.
float gFpKm = 6.0;
const mat3 ROT_A = mat3(0.6486, 0.6821, -0.3376, -0.5740, 0.7297, 0.3715, 0.4998, -0.0472, 0.8649);
const mat3 ROT_B = mat3(0.3254, 0.0658, -0.9433, -0.8960, -0.2973, -0.3298, -0.3021, 0.9525, -0.0378);

// fBm of the gradient-noise channel with rotated, non-commensurate octaves (x2.31, x4.73): no axis-aligned
// repetition survives the sum. xKm in km, cellKm = feature size of the first octave. Contrast renormalised to ~[0, 1].
float fbmKm(vec3 xKm, float cellKm) {
  vec3 x = xKm / (8.0 * cellKm);
  float l = log2(max(8.0 * gFpKm / cellKm, 1.0e-3));
  float n = 0.5 * nzl(x, l) + 0.3 * nzl(ROT_A * x * 2.31 + 0.41, l + 1.21) + 0.2 * nzl(ROT_B * x * 4.73 + 0.83, l + 2.24);
  return clamp((n - 0.5) * 1.6 + 0.5, 0.0, 1.0);
}
// Rounded puffs: max of two Worley (inverted F1) octaves in rotated, non-commensurate frames (each alone repeats
// every 8 cells); 0 between puffs, ~1 at their centres. cellKm = puff spacing.
float puffsKm(vec3 xKm, float cellKm) {
  vec3 x = xKm / (8.0 * cellKm);
  float l = log2(max(8.0 * gFpKm / cellKm, 1.0e-3));
  float a = textureLod(tNoise, x, l).g;
  float b = textureLod(tNoise, ROT_B * x * 1.37 + 0.29, l + 0.45).g;
  return max(a, b * 0.92);
}
float fbm2Km(vec3 xKm, float cellKm) {
  vec3 x = xKm / (8.0 * cellKm);
  float l = log2(max(8.0 * gFpKm / cellKm, 1.0e-3));
  float n = 0.62 * nzl(x, l) + 0.38 * nzl(ROT_A * x * 2.31 + 0.41, l + 1.21);
  return clamp((n - 0.5) * 1.37 + 0.5, 0.0, 1.0);
}

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

// Tropical cyclones, as seen from orbit: a smooth bright central dense overcast (CDO) with subtle overshooting tops,
// a clear eye tens of km wide inside a raised eyewall ("stadium"), two trailing log-spiral rainbands made of
// convective towers with dark clear moats between them, and thin outflow cirrus streaks curving the other way
// (anticyclonic aloft) that feather the edge. Returns the cloud-top height (~1 = CDO, eyewall and towers above);
// storm = 0..1 the cyclone's area (other clouds are suppressed there); wall = eyewall weight; wind = sea wind (m/s).
float cyclones(vec3 p, out float storm, out float wall, out float wind) {
  float h = 0.0; storm = 0.0; wall = 0.0; wind = 0.0;
  for (int i = 0; i < MAX_CYC; i++) {
    vec4 A = uCyc[i * 2], B = uCyc[i * 2 + 1];
    if (B.x <= 0.0) continue;
    float d2 = dot(p - A.xyz, p - A.xyz) * R_GROUND * R_GROUND;
    if (d2 > A.w * A.w * 1.3) continue;
    vec2 q = tangentOffset(p, A.xyz, R_GROUND);
    float r = length(q);
    float R0 = A.w, re = B.z, I = B.x, hs = B.y, spin = B.w;
    float fi = float(i);
    float th = atan(q.y, q.x) * hs;                       // counter-clockwise inflow in the north, clockwise in the south
    // texture coordinates turn with the storm
    float cs = cos(spin * hs), sn = sin(spin * hs);
    vec3 X = vec3(cs * q.x + sn * q.y, -sn * q.x + cs * q.y, fi * 977.0);
    float org = smoothstep(0.3, 0.75, I);                 // organisation: clear eye, tight bands
    float rc = R0 * (0.14 + 0.1 * I);                     // CDO radius
    float lr = log(max(r, 1.0) / rc);
    float asym = fbm2Km(X, 150.0);                        // large-scale asymmetry of the whole system
    // outflow cirrus: streaks along anticyclonic spirals (noise on a circle in the spiral phase: fine across, long along)
    float psiO = th - 1.3 * lr - 0.4 * spin;
    float lS = log2(max(gFpKm * 64.0 * 2.0 / max(r, 20.0), 1.0e-3));
    vec3 S = vec3(cos(psiO) * 2.0, sin(psiO) * 2.0, lr * 0.5 + fi * 5.3);
    float streak = 0.75 * nzl(S, lS) + 0.25 * nzl(ROT_A * S * 2.31 + 0.3, lS + 1.21);
    streak = clamp((streak - 0.5) * 1.5 + 0.5, 0.0, 1.0);
    // CDO: smooth shield with a lobed, feathered edge; overshooting tops are a few percent of height (relief only)
    float lobe = fbm2Km(X + 23.0, 30.0);
    float cdoR = rc * (1.0 + 0.5 * (asym - 0.5) + 0.3 * (lobe - 0.5));
    // feathered edge: the overcast thins out along the outflow streaks
    float cdo = smoothstep(cdoR * (1.3 + 0.25 * (streak - 0.5)), cdoR * 0.85, r);
    float tops = fbmKm(X + 17.0, 7.0);
    float hCdo = cdo * (1.0 + 0.18 * (tops - 0.5));
    // rainbands: 2 trailing arms (warped), convective towers inside, clear moats between
    float psi = th + 2.4 * lr - spin + 1.6 * (asym - 0.5) + 0.9 * (fbm2Km(X + 5.0, 60.0) - 0.5);
    float towers = fbmKm(X + 31.0, 12.0);
    float dpsi = abs(mod(psi + 0.5 * PI, PI) - 0.5 * PI);      // angle to the nearer of the two arms
    float dKm = dpsi * r * 0.38;                                // across-band distance (pitch ~22 deg)
    float bw = 24.0 + 0.11 * r;                                 // band half-width (km), wider outward
    float zone = smoothstep(rc * 0.8, rc * 1.4, r) * smoothstep(R0, R0 * 0.55, r);
    // band edges are clumpy (towers bulge out), the inside stays filled; the moats between arms are clear;
    // farther out the band breaks into separate cells
    float brk = smoothstep(R0 * 0.65, R0 * 1.0, r);
    float gaps = fbm2Km(X + 47.0, 45.0);                       // the outer bands break into separate clusters
    float band = smoothstep(bw, bw * 0.4, dKm + 0.6 * bw * (towers - 0.5)) * zone * smoothstep(0.45 * brk, 0.45 * brk + 0.15, gaps);
    float hBand = band * (0.8 + 0.35 * towers);
    // outflow cirrus: fibrous streaks fanning out of the overcast (feathered CDO edge), fading outward
    float fringe = smoothstep(cdoR * 0.85, cdoR * 1.05, r) * smoothstep(cdoR * 2.2, cdoR * 1.1, r);
    float cirrus = fringe * (0.08 + 0.16 * streak) * (0.55 + 0.45 * fbm2Km(X + 61.0, 60.0));
    float hc = max(max(hCdo, hBand), cirrus);
    // eye: clear (the sea shows), a little low cloud on the floor, eyewall standing above the CDO
    float eyeR = re * (1.0 + 0.15 * (fbm2Km(X + 3.0, 7.0) - 0.5));
    float eye = smoothstep(eyeR * 0.8, eyeR * 1.2, r);
    float floorCl = 0.22 * smoothstep(0.45, 0.85, fbm2Km(X + 9.0, 6.0));
    float stadium = 0.32 * exp(-pow((r - eyeR * 1.45) / (eyeR * 0.5), 2.0));
    hc = mix(hc, mix(floorCl, hc, 1.0 - org), 1.0 - eye) + stadium * org * cdo;
    hc *= smoothstep(0.03, 0.3, I) * (0.85 + 0.15 * I);
    h = max(h, hc);
    storm = max(storm, smoothstep(R0, R0 * 0.45, r) * smoothstep(0.0, 0.3, I));
    wall = max(wall, exp(-pow((r - eyeR * 1.45) / (eyeR * 0.6), 2.0)) * org);
    float rm = re * 2.0;
    float vmax = 18.0 + 52.0 * I;
    wind = max(wind, vmax * (r < rm ? r / rm : pow(rm / r, 0.6)) * smoothstep(R0 * 1.1, R0 * 0.5, r));
  }
  return h;
}

// Sea-surface wind of the cyclones only (Rankine-like profile), without the cloud structure.
float cycloneWind(vec3 p) {
  float wind = 0.0;
  for (int i = 0; i < MAX_CYC; i++) {
    vec4 A = uCyc[i * 2], B = uCyc[i * 2 + 1];
    if (B.x <= 0.0) continue;
    float r = length(p - A.xyz) * R_GROUND;
    float R0 = A.w;
    if (r > R0 * 1.1) continue;
    float rm = B.z * 2.0, vmax = 18.0 + 52.0 * B.x;
    wind = max(wind, vmax * (r < rm ? r / rm : pow(rm / r, 0.6)) * smoothstep(R0 * 1.1, R0 * 0.5, r));
  }
  return wind;
}

// Thunderstorm cells: lumpy cumulonimbus towers under a lobed anvil sheared downwind, fibrous anvil edges.
// Returns cloud-top height (towers above 1); core = 0..1 convective core.
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
    vec3 Xc = vec3(q, B.y * 97.0);
    float fib = fbmKm(Xc, 5.0);                                    // lumpy texture of the anvil top
    float re = ra * (0.75 + 0.5 * lobes);
    float anvil = smoothstep(re, re * 0.45, r) * (0.75 + 0.25 * fib);
    float lump = fbm2Km(Xc + 13.0, 3.0);
    float tower = smoothstep(ra * 0.45, ra * 0.05, length(q) * (0.85 + 0.4 * lump));
    c = max(c, max(anvil, tower * 1.15) * smoothstep(0.0, 0.2, B.x));   // the tower stands above the anvil
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
  gFpKm = fpKm;
  float c = advectedCloudsGrad(p, uv, dx, dy, mean, grad);
  c = clamp(c + uWx.x * growthDecay(pKm) * (0.35 + 0.65 * smoothstep(0.05, 0.4, mean)), 0.0, 1.0);
#if DETAIL > 0
  // texture below the 5 km texels where the screen resolves it: thin and broken cloud gets a soft fBm modulation
  // (multiplicative, so the real structure of the map is kept); thick cores stay smooth
  float f1 = 1.0 - smoothstep(0.8, 2.5, fpKm);
  float edge = 4.0 * c * (1.0 - c);
  if (f1 * edge > 0.0) {
    vec3 xd = pKm + vec3(0.0, 0.0, uFlow.w * 2.0e-4);
  #if DETAIL > 1
    float n = mix(fbm2Km(xd, 6.0), fbmKm(xd, 6.0), 0.5);
  #else
    float n = fbm2Km(xd, 6.0);
  #endif
    c = clamp(c * (1.0 + uWx.y * f1 * edge * (n - 0.5) * 0.9), 0.0, 1.0);
  }
  // tropical afternoon cumulus: soft puffs (~3-4 km, rounded: two octaves only, soft threshold, denser centres)
  // in clusters and streets whose extent grows with the potential
  float cuP = cumulusPotential(p, uv, mean);
  if (cuP > 0.01) {
    // puffs only where resolved (>= ~4 pixels apart); farther out their mean cover (thresholding a blurred
    // noise would turn into speckle)
    float cuFade = 1.0 - smoothstep(0.5, 1.0, fpKm);
    float cluster = smoothstep(0.45, 0.65, fbm2Km(pKm, 40.0) + 0.55 * (cuP - 0.6));
    // round puffs, their size varied by a slow fBm; soft edges at least ~2 pixels wide
    float sizeVar = fbm2Km(pKm + 71.0, 12.0);
    float puff = puffsKm(pKm + 13.0, 4.0) * (0.85 + 0.3 * fbm2Km(pKm + 3.0, 1.5));   // lumpy outlines
    float thr = 0.7 - 0.25 * sizeVar - 0.08 * cuP;
    float soft = 0.15 + 0.6 * gFpKm / 4.0;
    float cu = smoothstep(thr, thr + soft, puff) * cluster;
    c = max(c, mix(0.2 * cluster * cuP, cu * 0.8, cuFade));
  }
#endif
  float wind;
  float cy = cyclones(p, storm, wall, wind);
  float sc = stormCells(p, core);
  proc = max(cy, sc);                                        // height (relief); density saturates at 1
  c = max(c * (1.0 - 0.85 * storm), min(proc, 1.0));
  return c;
}

// The analytic storms alone (cyclones + thunderstorm cells): cloud-top height for relief shading and self-shadowing.
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
  gFpKm = 6.0;
  float proc = max(cyclones(p, storm, wall, wind), stormCells(p, core));
  return max(c * (1.0 - 0.85 * storm), min(proc, 1.0));
}

// Sea-surface wind speed (m/s): trades, doldrums, westerlies (roaring forties), synoptic variability, cyclones.
float surfaceWind(vec3 p) {
  float latDeg = degrees(asin(clamp(p.y, -1.0, 1.0)));
  float a = abs(latDeg);
  float w = 5.5 + 2.5 * exp(-pow((a - 15.0) / 8.0, 2.0)) - 2.5 * exp(-pow((latDeg - 6.0) / 5.0, 2.0))
          + (latDeg < 0.0 ? 6.0 : 4.0) * exp(-pow((a - 50.0) / 10.0, 2.0)) - 2.0 * exp(-pow((a - 32.0) / 5.0, 2.0));
  w *= 0.55 + 0.9 * nz(p * (R_GROUND / 4200.0) + vec3(uFlow.w * 1.0e-6));
  return max(w, cycloneWind(p));
}
`;
