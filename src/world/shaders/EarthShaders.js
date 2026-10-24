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
  float f = clamp(0.15 + 0.55 * region + 0.45 * smoothstep(0.08, 0.7, lum), 0.0, 1.0);
  return mix(mix(sodium, led, f), vec3(0.72, 1.0, 0.82), onWater);
}`;

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
 * Ground (GPU presets): seasonal day albedo (+ streamed 500 m high-pass detail near the sub-station point on ultra),
 * relief normal map, ocean colour from bathymetry, water fraction with rivers and lakes, Cox-Munk sun and moon glint
 * with a wind field (trades, westerlies, cyclones, calm slicks), shadows of the evolving cloud layer, city lights
 * with sodium/LED colour and a scattering halo, reddened direct sunlight near the terminator, aerial perspective.
 */
const GROUND_GPU = /* glsl */`
uniform sampler2D tDay, tNight, tWater, tNormal;
uniform float uGlint, uNormalStrength;
#ifdef DETAIL_WINDOW
uniform sampler2D tWin;
uniform vec4 uWin;        // x, y: window origin (equirect uv); z, w: uv -> window scale
uniform float uWinFade;
#endif
${LIGHT_COMMON_UNIFORMS}
${ATMOSPHERE_GLSL}
${WEATHER_GLSL}
${SURFACE_COMMON}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;
  vec3 T = normalize(vTangentW - N * dot(vTangentW, N));
  vec3 B = cross(N, T);
  vec3 p = normalize(vObjPos);
  vec3 pKm = p * R_GROUND;
  vec2 duvx = dFdx(vUv), duvy = dFdy(vUv);

  vec3 albedo = texture2D(tDay, vUv).rgb;
#ifdef DETAIL_WINDOW
  // 500 m imagery around the sub-station point: add its high-pass (the part the 5 km texture lacks)
  vec2 wuv = vec2(fract(vUv.x - uWin.x), vUv.y - uWin.y) * uWin.zw;
  vec2 wdx = dFdx(wuv), wdy = dFdy(wuv);
  vec2 wpx = max(abs(wdx), abs(wdy)) * vec2(textureSize(tWin, 0));
  float wlod = log2(max(max(wpx.x, wpx.y), 1.0e-4));
  float wedge = smoothstep(0.0, 0.07, min(min(wuv.x, 1.0 - wuv.x), min(wuv.y, 1.0 - wuv.y)));
  float wgt = uWinFade * wedge * (1.0 - smoothstep(0.5, 1.4, wlod));
  if (wgt > 0.0) {
    vec3 fine = textureGrad(tWin, wuv, wdx, wdy).rgb;
    vec3 coarse = textureLod(tWin, wuv, max(wlod, 1.4)).rgb;
    albedo = max(albedo + (fine - coarse) * wgt, 0.0);
  }
#endif
  float water = texture2D(tWater, vUv).r;
  vec4 aux = texture2D(tAux, vUv);
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
  vec3 nm = vec3(texture2D(tNormal, vUv).xy * 2.0 - 1.0, 0.0);      // RG texture: z from the unit length
  nm.z = sqrt(max(1.0 - dot(nm.xy, nm.xy), 0.0));
  nm.xy *= uNormalStrength * (1.0 - water);
  vec3 Np = normalize(T * nm.x + B * nm.y + N * nm.z);

  float ndl = dot(N, L);
  float ndlP = dot(Np, L);
  vec3 pE = vWorldPos - uEarthCenter;
  vec3 Tsun = sunTransmittance(pE, L);
  vec3 S = uSunColor * uSunIntensity;

  // Cloud shadow: the ground point projected along the Sun direction onto the cloud layer (R + 6 km)
  float pl = dot(vObjPos, uSunObj);
  float rc = R_GROUND + 6.0;
  float tc = -pl + sqrt(max(pl * pl + rc * rc - dot(vObjPos, vObjPos), 0.0));
  vec3 Q = normalize(vObjPos + uSunObj * tc);
  float cs = ndl > -0.15 ? cloudCoverLite(Q, equirectUv(Q), duvx, duvy) : 0.0;
  float shadow = 1.0 - 0.66 * smoothstep(0.05, 0.7, cs);

  vec3 amb = skyAmbient(ndl);
  vec3 direct = albedo * S * Tsun * max(ndlP, 0.0) * shadow;
  vec3 ambient = albedo * S * amb * 0.075 * (1.0 - 0.3 * smoothstep(0.1, 0.8, cs));

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

  // Moonlight (night-adapted exposure): cool Lambert + moon glint, scaled by the lunar phase
  vec3 moonCol = vec3(0.72, 0.82, 1.0) * uMoonLight;
  vec3 moonlit = moonCol * (albedo * max(dot(Np, uMoonDir), 0.0) * (1.0 - 0.5 * (1.0 - shadow))
               + waterGlint(N, V, uMoonDir, s2) * wOpen * 0.8);

  // City lights (Black Marble, grey): colour by region and brightness, a scattering halo from a blurred mip.
  // Clouds dim and diffuse them in the cloud layer (alpha), not here.
  float nightMask = smoothstep(0.1, -0.1, ndl);
  vec3 city = vec3(0.0);
  if (nightMask > 0.0) {
    float Ln = textureGrad(tNight, vUv, duvx, duvy).r;
    float Lh = textureGrad(tNight, vUv, duvx * 8.0, duvy * 8.0).r;      // ~3 mip levels softer: scattering halo
    float region = nz(pKm * (1.0 / 4000.0) + 0.21);
    city = (pow(Ln, 2.4) + 0.1 * Lh * Lh) * cityTint(Ln, region, smoothstep(0.5, 0.9, water) * (1.0 - inland)) * uNightIntensity * nightMask;
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

void main() {
  vec3 p = normalize(vObjPos);
  vec2 duvx = dFdx(vUv), duvy = dFdy(vUv);
  float fpKm = length(fwidth(vObjPos));
  float proc, storm, wall, core, mean;
  vec2 g;
  float c = cloudCover(p, vUv, duvx, duvy, fpKm, g, proc, storm, wall, core, mean);
  float alpha = clamp(pow(c, 0.85) * uCloudGain, 0.0, 1.0);

  // lightning: diffuse glow of the flash scattered inside the cloud
  float flash = 0.0;
  for (int i = 0; i < MAX_FLASH; i++) {
    vec4 F = uFlash[i * 2];
    if (F.w <= 0.0) continue;
    float d2 = dot(p - F.xyz, p - F.xyz) * R_GROUND * R_GROUND;
    float s = uFlash[i * 2 + 1].x;
    flash += F.w * exp(-sqrt(d2) / s);                       // bright core, wide scattered halo
  }
  // relief: uv gradient of the cloud map (smooth, texture space) + finite differences (4 km) of the analytic storms
  vec3 N = normalize(vNormalW);
  if (alpha < 0.004 && flash < 0.002) discard;
  vec3 T = normalize(vTangentW - N * dot(vTangentW, N));
  vec3 B = cross(N, T);
  vec2 sg = vec2(0.0);
  if (proc > 0.01) {
    vec3 eo = normalize(cross(vec3(0.0, 1.0, 0.0), p) + vec3(1.0e-6, 0.0, 0.0)), no = cross(p, eo);
    float dd = 4.0 / R_GROUND;
    sg = vec2(stormCover(normalize(p + eo * dd)), stormCover(normalize(p + no * dd))) - proc;
  }
  vec3 Np = normalize(N - (T * g.x + B * g.y) * uBump - (T * sg.x + B * sg.y) * 1.2);

  vec3 L = uSunDir;
  float ndl = dot(N, L);
  float ndlP = dot(Np, L);
  vec3 pE = vWorldPos - uEarthCenter;
  vec3 Tsun = sunTransmittance(pE, L);
  vec3 S = uSunColor * uSunIntensity;
  float lam = max(ndlP, 0.0);
  lam = max(lam, 0.05 * smoothstep(-0.06, 0.02, ndl));    // clouds stay lit a little past the ground terminator
  float thick = mix(1.0, 0.8, c) * (1.0 + 0.08 * proc);    // dense cores slightly darker; convective tops bright
  vec3 lit = S * Tsun * lam * thick * 0.97;
  lit += S * skyAmbient(ndl) * 0.09;
  lit += vec3(0.72, 0.82, 1.0) * uMoonLight * max(dot(Np, uMoonDir), 0.0) * thick;   // moonlit clouds
  lit += vec3(0.0015);                                      // starlight / earth-glow at night
  // city lights seen through the cloud: blurred, warm, a fraction of what clear air shows
  float nightMask = smoothstep(0.08, -0.12, ndl);
  if (nightMask > 0.0) {
    float Lb = textureGrad(tNight, vUv, duvx * 11.0, duvy * 11.0).r;      // ~3.5 mip levels softer
    lit += Lb * Lb * vec3(1.0, 0.7, 0.42) * uNightIntensity * 0.5 * nightMask;
  }
  if (flash > 0.002) {
    // the flash lights the cloud from inside: brightest where the cloud is thick, mottled by the cloud tops
    float tops = nz(p * (R_GROUND / 30.0)) * 0.6 + nz(p * (R_GROUND / 9.0)) * 0.4;
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
