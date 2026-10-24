import { ATMOSPHERE_GLSL } from './AtmosphereChunk.js';
import { WEATHER_GLSL } from './WeatherChunk.js';

/** Shared vertex shader for the Earth spheres: world position, object position, world normal, uv. */
export const SPHERE_VERTEX = /* glsl */`
varying vec3 vWorldPos, vObjPos, vNormalW, vTangentW;
varying vec2 vUv;
void main() {
  vObjPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  // tangent along +u of the equirect mapping (object space), guarded at the poles
  vec3 nObj = normalize(position);
  vec3 t = vec3(nObj.z, 0.0, -nObj.x);
  t = dot(t, t) > 1.0e-6 ? normalize(t) : vec3(0.0, 0.0, 1.0);
  vTangentW = normalize(mat3(modelMatrix) * t);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/** Lighting helpers shared by ground and clouds (twilight sky colour / ambient, water glint, city-light colour). */
const SURFACE_COMMON = /* glsl */`
// Hemispherical skylight reaching the surface: orange near the terminator, blue in daylight; fades at night.
vec3 skyAmbient(float ndl) {
  float tw = smoothstep(-0.13, 0.12, ndl);
  vec3 skyCol = mix(vec3(0.95, 0.62, 0.42), vec3(0.45, 0.62, 1.0), smoothstep(-0.04, 0.2, ndl));
  return skyCol * tw;
}

// Smith masking for a Beckmann slope distribution (rational approximation), alpha^2 = mean-square slope.
float lambdaBeckmann(float cosT, float s2) {
  float c = clamp(cosT, 1.0e-3, 1.0);
  float a = c / (sqrt(s2) * sqrt(max(1.0 - c * c, 1.0e-6)));
  return a < 1.6 ? (1.0 - 1.259 * a + 0.396 * a * a) / (3.535 * a + 2.181 * a * a) : 0.0;
}

// Specular reflection of a distant source by a wind-roughened water surface (Cox & Munk 1954: the wave slopes are
// near-Gaussian with mean-square slope s2 = 0.003 + 0.00512 W). Returns BRDF * cos(theta_l) * pi, i.e. the
// radiance for a source whose white-Lambert radiance is 1.
float waterGlint(vec3 N, vec3 V, vec3 L, float s2) {
  float nl = dot(N, L);
  if (nl <= 0.0) return 0.0;
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 1.0e-3), nv = max(dot(N, V), 1.0e-3);
  float c2 = nh * nh;
  float D = exp(-(1.0 - c2) / (c2 * s2)) / (PI * s2 * c2 * c2);
  float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
  float G = 1.0 / (1.0 + lambdaBeckmann(nv, s2) + lambdaBeckmann(nl, s2));
  return PI * F * D * G / (4.0 * nv);
}

// City-light colour: high-pressure sodium (orange) in most places, white LED in bright cores and in regions that
// have converted; lit boats on open water (squid fleets) are green-white.
vec3 cityTint(float lum, float region, float onWater) {
  vec3 sodium = vec3(1.0, 0.60, 0.26), led = vec3(0.92, 0.93, 1.0);
  float f = clamp(0.1 + 0.55 * region + 0.25 * smoothstep(0.08, 0.7, lum), 0.0, 1.0);
  return mix(mix(sodium, led, f), vec3(0.72, 1.0, 0.82), onWater);
}`;

/**
 * Night-light sampling for the GPU presets: the global Black Marble texels (~2.4 km) are magnified near nadir, where
 * bilinear filtering shows diamond blobs and a blurred mip shows blocks: Catmull-Rom (5 bilinear taps) when
 * magnified, cubic B-spline (4 taps) for the soft halo / glow through clouds. Near nadir the 500 m tiles take over.
 */
const NIGHT_GLSL = /* glsl */`
float nightCatmullRom(sampler2D tex, vec2 uv) {
  vec2 sz = vec2(textureSize(tex, 0));
  vec2 sp = uv * sz;
  vec2 t1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (t1 - 1.0) / sz, t3 = (t1 + 2.0) / sz, t12 = (t1 + w2 / w12) / sz;
  float r = textureLod(tex, vec2(t12.x, t0.y), 0.0).r * w12.x * w0.y
          + textureLod(tex, vec2(t0.x, t12.y), 0.0).r * w0.x * w12.y
          + textureLod(tex, t12, 0.0).r * w12.x * w12.y
          + textureLod(tex, vec2(t3.x, t12.y), 0.0).r * w3.x * w12.y
          + textureLod(tex, vec2(t12.x, t3.y), 0.0).r * w12.x * w3.y;
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / wsum, 0.0);
}

// Cubic B-spline (smooth, no blocks) of an integer mip level, 4 bilinear taps.
float nightBSpline(sampler2D tex, vec2 uv, int lod) {
  vec2 sz = vec2(textureSize(tex, lod));
  vec2 st = uv * sz - 0.5;
  vec2 i = floor(st), f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / sz, h1 = (i + 1.5 + w3 / g1) / sz;
  float l = float(lod);
  return g0.y * (g0.x * textureLod(tex, h0, l).r + g1.x * textureLod(tex, vec2(h1.x, h0.y), l).r)
       + g1.y * (g0.x * textureLod(tex, vec2(h0.x, h1.y), l).r + g1.x * textureLod(tex, h1, l).r);
}`;

/**
 * Toroidal 5-degree tile windows (TileWindow.js): weight (0 outside the window, fading over the outer third of a tile,
 * times the layer fade) and the texture uv / gradients of a point. duvx / duvy are the screen derivatives of vUv.
 */
const TILE_GLSL = /* glsl */`
float tileWindow(vec4 win, vec2 uv, vec2 duvx, vec2 duvy, out vec2 tuv, out vec2 tdx, out vec2 tdy) {
  vec2 t = vec2(uv.x * 72.0, (1.0 - uv.y) * 36.0);
  float N = win.z;
  float rc = mod(t.x - win.x, 72.0), rr = t.y - win.y;
  float edge = min(min(rc, N - rc), min(rr, N - rr));
  vec2 q = t / N;
  tuv = vec2(fract(q.x), 1.0 - fract(q.y));
  tdx = vec2(duvx.x * 72.0, duvx.y * 36.0) / N;
  tdy = vec2(duvy.x * 72.0, duvy.y * 36.0) / N;
  return win.w * smoothstep(0.0, 0.35, edge);
}
// uv of a point offset from (tile-space) uv in the same window (for shadow rays): no fract discontinuity issues
// because textureLod is used with the wrapped coordinate.
vec2 tileUv(vec4 win, vec2 uv) {
  vec2 q = vec2(uv.x * 72.0, (1.0 - uv.y) * 36.0) / win.z;
  return vec2(fract(q.x), 1.0 - fract(q.y));
}
// relief texel: R, G = east / north slope (0.5 + 0.5 sign(s) sqrt(|s| / 2)), B = sqrt(height / 9000 m)
vec2 decodeSlope(vec2 e) { vec2 d = e * 2.0 - 1.0; return sign(d) * d * d * 2.0; }
float decodeHeight(float b) { return b * b * 9000.0; }`;

const LIGHT_COMMON_UNIFORMS = /* glsl */`
uniform vec3 uSunDir, uSunColor, uEarthCenter, uMoonDir;
uniform float uSunIntensity, uMultiScatter, uMoonLight, uNightIntensity;
varying vec3 vWorldPos, vObjPos, vNormalW, vTangentW;
varying vec2 vUv;`;

/**
 * Ground for the 'lite' preset (CPU rasterisers): the cheap path with the cloud layer composited inline.
 * Seasonal day colour, water fraction (ocean + lakes + rivers) and grey city lights as on the GPU presets.
 */
const GROUND_LITE = /* glsl */`
uniform sampler2D tDay, tNight, tClouds, tWater, tNormal;
uniform vec3 uSunDirObj;
uniform float uCloudAngle, uGlint, uNormalStrength;
${LIGHT_COMMON_UNIFORMS}
${ATMOSPHERE_GLSL}
${SURFACE_COMMON}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;
  vec3 T = normalize(vTangentW - N * dot(vTangentW, N));
  vec3 B = cross(N, T);

  vec3 albedo = texture2D(tDay, vUv).rgb;
  float water = texture2D(tWater, vUv).r;
  water *= 1.0 - smoothstep(0.12, 0.3, dot(albedo, vec3(0.2126, 0.7152, 0.0722)));   // sea ice / ice shelves
  float lights = texture2D(tNight, vUv).r;
  vec3 nm = vec3(texture2D(tNormal, vUv).xy * 2.0 - 1.0, 0.0);      // RG texture: z from the unit length
  nm.z = sqrt(max(1.0 - dot(nm.xy, nm.xy), 0.0));
  nm.xy *= uNormalStrength * (1.0 - water);
  vec3 Np = normalize(T * nm.x + B * nm.y + N * nm.z);

  float ndl = dot(N, L);
  vec3 pE = vWorldPos - uEarthCenter;
  vec3 Tsun = sunTransmittance(pE, L);
  vec3 S = uSunColor * uSunIntensity;
  // cloud cover overhead (rigidly drifting cloud map)
  float ca = cos(uCloudAngle), sa = sin(uCloudAngle);
  vec3 Pc = vec3(ca * vObjPos.x - sa * vObjPos.z, vObjPos.y, sa * vObjPos.x + ca * vObjPos.z);
  float csUp = textureGrad(tClouds, equirectUv(Pc), dFdx(vUv), dFdy(vUv)).r;
  float shadow = 1.0 - 0.5 * smoothstep(0.1, 0.8, csUp);

  vec3 amb = skyAmbient(ndl);
  vec3 surface = albedo * S * (Tsun * max(dot(Np, L), 0.0) * shadow + amb * 0.075);
  surface += S * Tsun * waterGlint(N, V, L, 0.04) * water * shadow * uGlint;
  float ndv = max(dot(N, V), 1.0e-3);
  surface += S * amb * 0.25 * (0.02 + 0.98 * pow(1.0 - ndv, 5.0)) * water;
  vec3 moonCol = vec3(0.72, 0.82, 1.0) * uMoonLight;
  surface += moonCol * albedo * max(dot(Np, uMoonDir), 0.0);
  float nightMask = smoothstep(0.1, -0.1, ndl);
  float lin = lights * lights;
  surface += lin * cityTint(lights, 0.3, 0.0) * uNightIntensity * nightMask * (1.0 - 0.75 * smoothstep(0.1, 0.8, csUp));
  surface += albedo * vec3(0.0016, 0.0019, 0.0024);
  // inline cloud layer (6 km parallax is invisible here)
  float cA = clamp(pow(csUp, 0.85) * 1.15, 0.0, 1.0);
  float cLam = max(max(ndl, 0.0), 0.05 * smoothstep(-0.06, 0.02, ndl));
  float cThick = mix(1.0, 0.8, csUp);
  vec3 cLit = S * Tsun * cLam * cThick * 0.97 + S * amb * 0.09
            + moonCol * max(dot(N, uMoonDir), 0.0) * cThick + vec3(0.0015);
  surface = mix(surface, cLit, cA);

  vec3 ro = cameraPosition - uEarthCenter;
  vec3 rd = -V;
  float tG = length(vWorldPos - cameraPosition);
  vec2 ta = raySphere(ro, rd, R_ATMO);
  float t0 = clamp(ta.x, 0.0, tG);
  vec3 Tv;
  vec3 ins = inscatter(ro, rd, t0, tG, L, Tv);
  vec3 col = surface * Tv + ins * S * PI * (1.0 + uMultiScatter);
  col += (hash12(gl_FragCoord.xy) - 0.5) * 0.002;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

/**
 * Ground (GPU presets): seasonal day albedo + streamed 500 m imagery near nadir (high-pass on ultra), relief from the
 * 1 km / 5 km terrain (slopes and heights) with horizon shadows at low sun, crisp coasts from the 500 m imagery,
 * ocean colour from bathymetry, water fraction with rivers and lakes, Cox-Munk sun and moon glint with a wind field,
 * shadows of the evolving cloud layer, city lights (500 m Black Marble near nadir), reddened direct sunlight near
 * the terminator, aerial perspective.
 */
const GROUND_GPU = /* glsl */`
uniform sampler2D tDay, tNight, tWater, tRelief;
uniform float uGlint;
uniform vec3 uRelief;     // x: slope exaggeration of the global relief, y: of the 1 km tiles, z: horizon shadows on/off
#ifdef TILE_DAY
uniform sampler2D tDayT;
uniform vec4 uDayT;
#endif
#ifdef TILE_NIGHT
uniform sampler2D tNightT;
uniform vec4 uNightT;
#endif
#ifdef TILE_RELIEF
uniform sampler2D tReliefT;
uniform vec4 uReliefT;
#endif
${LIGHT_COMMON_UNIFORMS}
${ATMOSPHERE_GLSL}
${WEATHER_GLSL}
${SURFACE_COMMON}
${NIGHT_GLSL}
${TILE_GLSL}

// terrain height (m) at uv: the 1 km tile where loaded, else the 5 km global relief; lod in tile texels
float terrainHeight(vec2 uv, float dKm, float wT) {
  float h = decodeHeight(textureLod(tRelief, uv, log2(max(dKm / 4.9, 1.0))).b);
#ifdef TILE_RELIEF
  if (wT > 0.5) {
    vec4 r = textureLod(tReliefT, tileUv(uReliefT, uv), log2(max(dKm / 0.93, 1.0)));
    h = mix(h, decodeHeight(r.b), r.a);
  }
#endif
  return h;
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;
  vec3 T = normalize(vTangentW - N * dot(vTangentW, N));
  vec3 B = cross(N, T);
  vec3 p = normalize(vObjPos);
  vec3 pKm = p * R_GROUND;
  vec2 duvx = dFdx(vUv), duvy = dFdy(vUv);
  vec4 aux = texture2D(tAux, vUv);
  float water = texture2D(tWater, vUv).r;

  vec3 albedo = texture2D(tDay, vUv).rgb;
#ifdef TILE_DAY
  {
    // 500 m imagery: add its high-pass (what the 5 km seasonal texture lacks); sharpen the coastline from it
    vec2 tuv, tdx, tdy;
    float w = tileWindow(uDayT, vUv, duvx, duvy, tuv, tdx, tdy);
    if (w > 0.0) {
      vec4 fine = textureGrad(tDayT, tuv, tdx, tdy);
      float wl = log2(max(max(length(tdx), length(tdy)) * float(textureSize(tDayT, 0).x), 1.0e-4));
      vec3 coarse = textureLod(tDayT, tuv, max(wl, 3.3)).rgb;
      float wt = w * fine.a;
      albedo = max(albedo + (fine.rgb - coarse) * wt, 0.0);
      // coast: the 500 m colour decides water / land in the coastal band of the sea (not inland rivers and lakes)
      float lumF = dot(fine.rgb, vec3(0.2126, 0.7152, 0.0722));
      float wF = smoothstep(0.003, 0.02, fine.b - fine.r) * (1.0 - smoothstep(0.25, 0.45, lumF));
      float coastal = smoothstep(0.98, 0.9, aux.r) * smoothstep(0.0, 0.03, water) * smoothstep(1.0, 0.97, water);
      water = mix(water, wF, wt * coastal);
    }
  }
#endif
  float lum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  float ice = smoothstep(0.12, 0.3, lum);                    // sea ice, frozen lakes, ice shelves: no glint
  float wOpen = water * (1.0 - ice);
  float inland = smoothstep(0.35, 0.75, aux.r);              // lakes and rivers (the land fraction counts only the sea)
  // open-ocean colour from bathymetry: deep water is a dark, clean blue in the subtropical gyres and darker /
  // greener in productive high-latitude water; the imagery keeps the real colour of shelves and coasts
  float deep = smoothstep(0.16, 0.42, aux.g) * wOpen * (1.0 - inland);
  vec3 deepCol = mix(vec3(0.0032, 0.0105, 0.031), vec3(0.0035, 0.0085, 0.017), smoothstep(0.55, 0.85, abs(p.y)));
  deepCol *= 0.8 + 0.45 * nz(pKm * (1.0 / 1100.0));        // eddies and blooms (~140 km)
  albedo = mix(albedo, deepCol, deep);
  albedo = mix(albedo, vec3(0.010, 0.016, 0.020), wOpen * inland * 0.65);   // rivers / lakes thinner than a texel

  // relief: slopes (m/m) of the 5 km global terrain, the 1 km tiles near nadir
  vec2 slope = decodeSlope(texture2D(tRelief, vUv).rg) * uRelief.x;
  float wRel = 0.0;
#ifdef TILE_RELIEF
  {
    vec2 tuv, tdx, tdy;
    float w = tileWindow(uReliefT, vUv, duvx, duvy, tuv, tdx, tdy);
    if (w > 0.0) {
      vec4 r = textureGrad(tReliefT, tuv, tdx, tdy);
      wRel = w * r.a;
      slope = mix(slope, decodeSlope(r.rg) * uRelief.y, wRel);
    }
  }
#endif
  slope *= 1.0 - water;
  vec3 Np = normalize(N - T * slope.x - B * slope.y);

  float ndl = dot(N, L);
  float ndlP = dot(Np, L);
  vec3 pE = vWorldPos - uEarthCenter;
  vec3 Tsun = sunTransmittance(pE, L);
  vec3 S = uSunColor * uSunIntensity;

  // Terrain (horizon) shadows at low sun: march the height field toward the Sun (12 steps, 0.6 .. 52 km), against
  // the sun ray rising at the sun elevation and the Earth's curvature
  float terr = 1.0;
  if (uRelief.z > 0.5 && ndl > -0.02 && ndl < 0.6 && water < 0.6) {
    float se = dot(L, T), sn = dot(L, B);
    float lh = max(length(vec2(se, sn)), 1.0e-4);
    float tanE = ndl / lh;
    float cosLat = max(cos(asin(clamp(p.y, -1.0, 1.0))), 0.05);
    vec2 duvKm = vec2(se / lh / (2.0 * PI * R_GROUND * cosLat), sn / lh / (PI * R_GROUND));
    // (heights are 8-bit sqrt-encoded and lossy: ~50 m steps at 5 km altitude; the start point is lifted and the
    // shadow ramps over 150 m + 25 m/km so the quantisation does not print as speckle)
    float h0 = terrainHeight(vUv, 1.5, wRel) + 60.0;
    float occ = 0.0;
    float d = 1.0;
    for (int k = 0; k < 11; k++) {
      float hs = terrainHeight(vUv + duvKm * d, d * 0.5, wRel);
      float hray = h0 + d * 1000.0 * tanE - d * d * 1000.0 / (2.0 * R_GROUND);
      occ = max(occ, smoothstep(0.0, 150.0 + d * 25.0, hs - hray));
      d *= 1.5;
    }
    terr = 1.0 - 0.92 * occ;
  }

  // Cloud shadow: the ground point projected along the Sun direction onto the cloud layer (R + 6 km)
  float pl = dot(vObjPos, uSunObj);
  float rc = R_GROUND + 6.0;
  float tc = -pl + sqrt(max(pl * pl + rc * rc - dot(vObjPos, vObjPos), 0.0));
  vec3 Q = normalize(vObjPos + uSunObj * tc);
  float cs = ndl > -0.15 ? cloudCoverLite(Q, equirectUv(Q), duvx, duvy) : 0.0;
  float shadow = 1.0 - 0.85 * cs;                           // cs = cloud opacity along the sun ray

  vec3 amb = skyAmbient(ndl);
  vec3 direct = albedo * S * Tsun * max(ndlP, 0.0) * shadow * terr;
  // skylight: less on slopes facing away from the open sky, a little less in valleys
  vec3 ambient = albedo * S * amb * 0.075 * (1.0 - 0.3 * smoothstep(0.1, 0.8, cs)) * (0.75 + 0.25 * dot(Np, N));

  // Sun glint (Cox-Munk): wind from the climatology + cyclones; sheltered inland water is nearly calm;
  // surfactant slicks and wind gusts streak the glint pattern
  float wind = mix(surfaceWind(p), 2.5, inland);
  float slick = nz(pKm * (1.0 / 70.0)) * 0.6 + nz(pKm * (1.0 / 260.0)) * 0.4;
  float s2 = (0.003 + 0.00512 * wind) * exp((slick - 0.5) * 2.2);
  float ndv = max(dot(N, V), 1.0e-3);
  // rivers and small lakes cover a fraction of a 5 km texel; the eye resolves them as thin lines, so their glint
  // is spread less thinly than the area average
  float wGlint = wOpen + inland * (sqrt(wOpen) - wOpen) * 0.4;
  vec3 glint = S * Tsun * waterGlint(N, V, L, s2) * wGlint * shadow * uGlint;
  float Fv = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 skyRefl = S * amb * 0.25 * Fv * wOpen;

  // Moonlight (night-adapted exposure): cool Lambert on the relief + moon glint, scaled by the lunar phase
  vec3 moonCol = vec3(0.72, 0.82, 1.0) * uMoonLight;
  vec3 moonlit = moonCol * (albedo * max(dot(Np, uMoonDir), 0.0) * (1.0 - 0.5 * (1.0 - shadow))
               + waterGlint(N, V, uMoonDir, s2) * wOpen * 0.8);

  // City lights (Black Marble, grey, display-encoded): 500 m tiles near nadir (towns, road lights), else the
  // global map (Catmull-Rom when magnified); colour by region and brightness; a faint halo.
  // Clouds dim and diffuse them in the cloud layer (alpha), not here.
  float nightMask = smoothstep(0.1, -0.1, ndl);
  vec3 city = vec3(0.0);
  if (nightMask > 0.0) {
    vec2 nsz = vec2(textureSize(tNight, 0));
    float nl = log2(max(max(length(duvx * nsz), length(duvy * nsz)), 1.0e-4));
    float Ln = nl < 0.0 ? nightCatmullRom(tNight, vUv) : textureGrad(tNight, vUv, duvx, duvy).r;
#ifdef TILE_NIGHT
    vec2 tuv, tdx, tdy;
    float w = tileWindow(uNightT, vUv, duvx, duvy, tuv, tdx, tdy);
    if (w > 0.0) {
      vec2 t = textureGrad(tNightT, tuv, tdx, tdy).rg;
      Ln = mix(Ln, t.r, w * t.g);
    }
#endif
    // ~linear radiance = Ln^2.2, scaled so the brightest cores stay below white at the night exposure
    float core = pow(Ln, 2.2) * 0.36;
    float Lh = nightBSpline(tNight, vUv, 3);
    float region = nz(pKm * (1.0 / 4000.0) + 0.21);
    city = (core + 0.006 * Lh * Lh) * cityTint(Ln, region, smoothstep(0.5, 0.9, water) * (1.0 - inland)) * uNightIntensity * nightMask;
  }
  vec3 surface = direct + ambient + glint + skyRefl + moonlit + city + albedo * vec3(0.0016, 0.0019, 0.0024);

  // Aerial perspective: in-scatter and transmittance along the view ray inside the atmosphere.
  vec3 ro = cameraPosition - uEarthCenter;
  vec3 rd = -V;
  float tG = length(vWorldPos - cameraPosition);
  vec2 ta = raySphere(ro, rd, R_ATMO);
  float t0 = clamp(ta.x, 0.0, tG);
  vec3 Tv;
  vec3 ins = inscatter(ro, rd, t0, tG, L, Tv);
  vec3 col = surface * Tv + ins * S * PI * (1.0 + uMultiScatter);
  col += (hash12(gl_FragCoord.xy) - 0.5) * 0.002;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

export const groundFragment = (lite) => (lite ? GROUND_LITE : GROUND_GPU);

/**
 * Cloud layer (R + 6 km, GPU presets): the evolving cloud cover (WeatherChunk), bump-lit by the Sun from the
 * surface gradient of the cover, soft terminator, skylight, moonlight, city lights diffused through the cloud
 * from below, lightning lighting the storm clouds from inside, aerial perspective. Alpha-blended over the ground.
 */
export const CLOUD_FRAGMENT = /* glsl */`
uniform sampler2D tNight;
uniform float uCloudGain, uBump;
uniform vec4 uFlash[MAX_FLASH * 2];   // [direction.xyz (object frame), intensity], [radius km, 0, 0, 0]
${LIGHT_COMMON_UNIFORMS}
${ATMOSPHERE_GLSL}
${WEATHER_GLSL}
${SURFACE_COMMON}
${NIGHT_GLSL}

void main() {
  vec3 p = normalize(vObjPos);
  vec2 duvx = dFdx(vUv), duvy = dFdy(vUv);
  float fpKm = max(length(dFdx(vObjPos)), length(dFdy(vObjPos)));      // km per pixel (longer axis)
  float proc, storm, wall, core, mean;
  vec2 g;
  float c = cloudCover(p, vUv, duvx, duvy, fpKm, g, proc, storm, wall, core, mean);
  // opacity: element coverage x optical thickness (thin and broken cloud translucent); procedural storms opaque
  float alpha = clamp(c * max(cloudOpacity(gCloudMap), smoothstep(0.3, 0.7, proc)) * uCloudGain, 0.0, 1.0);

  // lightning: diffuse glow of the flash scattered inside the cloud
  float flash = 0.0;
  for (int i = 0; i < MAX_FLASH; i++) {
    vec4 F = uFlash[i * 2];
    if (F.w <= 0.0) continue;
    float d2 = dot(p - F.xyz, p - F.xyz) * R_GROUND * R_GROUND;
    float s = uFlash[i * 2 + 1].x;
    flash += F.w * exp(-sqrt(d2) / s);                       // bright core, wide scattered halo
  }
  // relief: uv gradient of the cloud map (smooth, texture space) + finite differences (3 km) of the storm-top
  // height; storm tops also cast shadows (eye floor in the lee of the eyewall, towers at low sun)
  vec3 N = normalize(vNormalW);
  if (alpha < 0.004 && flash < 0.002) discard;
  vec3 T = normalize(vTangentW - N * dot(vTangentW, N));
  vec3 B = cross(N, T);
  vec2 sg = vec2(0.0);
  float selfShadow = 0.0;
  if (proc > 0.01) {
    vec3 eo = normalize(cross(vec3(0.0, 1.0, 0.0), p) + vec3(1.0e-6, 0.0, 0.0)), no = cross(p, eo);
    float dd = 3.0 / R_GROUND;
    sg = vec2(stormCover(normalize(p + eo * dd)), stormCover(normalize(p + no * dd))) - proc;
    // height 1 ~ 12 km cloud top; one probe 10 km toward the Sun
    vec3 st = uSunObj - p * dot(uSunObj, p);
    float stl = length(st);
    if (stl > 1.0e-3 && dot(uSunObj, p) > -0.05) {
      float tanE = dot(uSunObj, p) / stl;
      float hS = stormCover(normalize(p + st / stl * (10.0 / R_GROUND)));
      selfShadow = smoothstep(0.0, 2.5, (hS - proc) * 12.0 - 10.0 * max(tanE, 0.0));
    }
  }
  // (the cloud map's own relief is hidden under a cyclone: its texels would print through the overcast)
  // thin cirrus (height < ~0.5) is flat: no relief from its edges
  vec3 Np = normalize(N - (T * g.x + B * g.y) * (uBump * (1.0 - storm)) - (T * sg.x + B * sg.y) * (0.8 * smoothstep(0.6, 0.9, proc)));

  vec3 L = uSunDir;
  float ndl = dot(N, L);
  float ndlP = dot(Np, L);
  vec3 pE = vWorldPos - uEarthCenter;
  vec3 Tsun = sunTransmittance(pE, L);
  vec3 S = uSunColor * uSunIntensity;
  float lam = max(ndlP, 0.0);
  lam = max(lam, 0.05 * smoothstep(-0.06, 0.02, ndl));    // clouds stay lit a little past the ground terminator
  float thick = mix(1.0, 0.8, c) * (1.0 + 0.08 * proc);    // dense cores slightly darker; convective tops bright
  vec3 lit = S * Tsun * lam * thick * 0.97 * (1.0 - 0.6 * selfShadow);
  lit += S * skyAmbient(ndl) * 0.09;
  lit += vec3(0.72, 0.82, 1.0) * uMoonLight * max(dot(Np, uMoonDir), 0.0) * thick;   // moonlit clouds
  lit += vec3(0.0015);                                      // starlight / earth-glow at night
  // city lights seen through the cloud: blurred, warm, a fraction of what clear air shows
  float nightMask = smoothstep(0.08, -0.12, ndl);
  if (nightMask > 0.0) {
    float Lb = nightBSpline(tNight, vUv, 4);                              // ~80 km soft glow, no texel blocks
    lit += Lb * Lb * vec3(1.0, 0.7, 0.42) * uNightIntensity * 0.5 * nightMask;
  }
  if (flash > 0.002) {
    // the flash lights the cloud from inside: brightest where the cloud is thick, mottled by the cloud tops
    float tops = fbmKm(p * R_GROUND, 4.0);
    lit += flash * vec3(0.74, 0.82, 1.0) * (0.12 + 0.88 * c * c) * (0.45 + 1.1 * tops);
    alpha = max(alpha, min(flash * 0.08, 0.3));
  }

  vec3 ro = cameraPosition - uEarthCenter;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  float tC = length(vWorldPos - cameraPosition);
  vec2 ta = raySphere(ro, rd, R_ATMO);
  float t0 = clamp(ta.x, 0.0, tC);
  vec3 Tv;
  vec3 ins = inscatter(ro, rd, t0, tC, L, Tv);
  vec3 col = lit * Tv + ins * S * PI * (1.0 + uMultiScatter);
  gl_FragColor = vec4(max(col, 0.0), alpha);
}`;

/**
 * Atmosphere shell (R + 100 km, back faces): ray-marched single scattering through the limb, plus the
 * night-side airglow layer (~87 km). Output = in-scatter, alpha = 1 - transmittance (custom blend:
 * dst * (1 - alpha) + src), so the Sun, Moon and stars dim and redden behind the limb.
 */
export const SHELL_FRAGMENT = /* glsl */`
uniform vec3 uSunDir, uSunColor, uEarthCenter;
uniform float uSunIntensity, uMultiScatter, uAirglow, uLimbBoost;
varying vec3 vWorldPos, vObjPos, vNormalW, vTangentW;
varying vec2 vUv;
${ATMOSPHERE_GLSL}

void main() {
  vec3 ro = cameraPosition - uEarthCenter;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  vec2 ta = raySphere(ro, rd, R_ATMO);
  if (ta.y <= 0.0) discard;
  float t0 = max(ta.x, 0.0), t1 = ta.y;
  vec2 tg = raySphere(ro, rd, R_GROUND);
  bool hitGround = tg.x > 0.0 && tg.x < t1;
#ifdef SKIP_GROUND
  if (hitGround) discard;      // 'lite': the ground shader already applies aerial perspective; keep only the limb
#endif
  if (hitGround) t1 = tg.x;
  vec3 T;
  vec3 ins = inscatter(ro, rd, t0, t1, uSunDir, T);
  vec3 col = ins * uSunColor * uSunIntensity * PI * (1.0 + uMultiScatter) * uLimbBoost;

  // Airglow: thin emission layer between 80 and 95 km (chord length through the layer), night limb only.
  float b = length(cross(ro, rd));
  float rin = R_GROUND + 80.0, rout = R_GROUND + 95.0;
  float chord = 2.0 * (sqrt(max(rout * rout - b * b, 0.0)) - sqrt(max(rin * rin - b * b, 0.0)));
  if (hitGround) chord *= 0.5;
  vec3 tangentPt = ro - rd * dot(ro, rd);
  float sunElev = dot(normalize(tangentPt), uSunDir);
  float nightLimb = smoothstep(-0.03, -0.16, sunElev);
  col += vec3(0.45, 1.0, 0.5) * (uAirglow * nightLimb * chord / 650.0);

  float alpha = clamp(1.0 - dot(T, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  col += (hash12(gl_FragCoord.xy) - 0.5) * 0.003;
  gl_FragColor = vec4(max(col, 0.0), alpha);
}`;
