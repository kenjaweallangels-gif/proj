import { ATMOSPHERE_GLSL } from './AtmosphereChunk.js';

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

/** Lighting helpers shared by ground and clouds (twilight sky colour / ambient). */
const SURFACE_COMMON = /* glsl */`
// Hemispherical skylight reaching the surface: orange near the terminator, blue in daylight; fades at night.
vec3 skyAmbient(float ndl) {
  float tw = smoothstep(-0.13, 0.12, ndl);
  vec3 skyCol = mix(vec3(0.95, 0.62, 0.42), vec3(0.45, 0.62, 1.0), smoothstep(-0.04, 0.2, ndl));
  return skyCol * tw;
}`;

/**
 * Ground: day albedo + subtle terrain normal map, ocean sun glint (GGX), Fresnel sky reflection on water,
 * cloud shadows projected along the Sun direction, warm city lights on the night side, reddened direct
 * sunlight near the terminator (Chapman transmittance) and aerial perspective.
 */
export const GROUND_FRAGMENT = /* glsl */`
uniform sampler2D tDay, tNight, tClouds, tOcean, tNormal;
uniform vec3 uSunDir, uSunDirObj, uSunColor, uEarthCenter, uMoonDir;
uniform float uSunIntensity, uCloudAngle, uNightIntensity, uGlint, uMultiScatter, uNormalStrength, uMoonLight;
varying vec3 vWorldPos, vObjPos, vNormalW, vTangentW;
varying vec2 vUv;
${ATMOSPHERE_GLSL}
${SURFACE_COMMON}

// GGX specular lobe of a water surface (wave-slope roughness, Schlick Fresnel, height-correlated Smith).
float oceanSpecular(vec3 N, vec3 V, vec3 L) {
  vec3 Hv = normalize(L + V);
  float ndh = max(dot(N, Hv), 0.0), ndv = max(dot(N, V), 1.0e-3), ldh = max(dot(L, Hv), 0.0);
  float nl = max(dot(N, L), 0.0);
  float a2 = 0.045;
  float dd = ndh * ndh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float F = 0.02 + 0.98 * pow(1.0 - ldh, 5.0);
  float Vis = 0.5 / max(nl * sqrt(ndv * ndv * (1.0 - a2) + a2) + ndv * sqrt(nl * nl * (1.0 - a2) + a2), 1.0e-4);
  return PI * D * F * Vis * nl;
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;
  vec3 T = normalize(vTangentW - N * dot(vTangentW, N));
  vec3 B = cross(N, T);

  vec3 albedo = texture2D(tDay, vUv).rgb;
  float ocean = texture2D(tOcean, vUv).r;
  vec3 night = texture2D(tNight, vUv).rgb;
  vec3 nm = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
  nm.xy *= uNormalStrength * (1.0 - ocean);           // water is flat
  vec3 Np = normalize(T * nm.x + B * nm.y + N * nm.z);

  float ndl = dot(N, L);
  float ndlP = dot(Np, L);
  vec3 pE = vWorldPos - uEarthCenter;
  vec3 Tsun = sunTransmittance(pE, L);                 // direct sunlight reddens toward the terminator
  vec3 S = uSunColor * uSunIntensity;                  // sun radiance scale (white Lambert surface -> S)

  // Cloud shadow: project the ground point along the Sun direction onto the cloud layer (R + 6 km),
  // then rotate into the drifting cloud sphere's frame.
  float pl = dot(vObjPos, uSunDirObj);
  float rc = R_GROUND + 6.0;
  float tc = -pl + sqrt(max(pl * pl + rc * rc - dot(vObjPos, vObjPos), 0.0));
  vec3 Q = vObjPos + uSunDirObj * tc;
  float ca = cos(uCloudAngle), sa = sin(uCloudAngle);
  vec3 Qc = vec3(ca * Q.x - sa * Q.z, Q.y, sa * Q.x + ca * Q.z);
  vec2 duvx = dFdx(vUv), duvy = dFdy(vUv);
  float cs = textureGrad(tClouds, equirectUv(Qc), duvx, duvy).r;
  float shadow = 1.0 - 0.62 * smoothstep(0.04, 0.7, cs);
  // Clouds straight overhead (for dimming city lights)
  vec3 Pc = vec3(ca * vObjPos.x - sa * vObjPos.z, vObjPos.y, sa * vObjPos.x + ca * vObjPos.z);
  float csUp = textureGrad(tClouds, equirectUv(Pc), duvx, duvy).r;

  vec3 direct = albedo * S * Tsun * max(ndlP, 0.0) * shadow;
  vec3 amb = skyAmbient(ndl);
  vec3 ambient = albedo * S * amb * 0.075;

  // Ocean sun glint (masked by the ocean texture and the cloud shadow)
  float ndv = max(dot(N, V), 1.0e-3);
  vec3 glint = S * Tsun * oceanSpecular(N, V, L) * ocean * shadow * uGlint;
  // Sky reflected in the water at grazing angles
  float Fv = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 skyRefl = S * amb * 0.25 * Fv * ocean;

  // Moonlight (night-adapted exposure): cool Lambert + a faint moon glint on the water, scaled by the lunar phase.
  vec3 M = uMoonDir;
  vec3 moonCol = vec3(0.72, 0.82, 1.0) * uMoonLight;
  vec3 moonlit = moonCol * (albedo * max(dot(Np, M), 0.0) * (1.0 - 0.5 * (1.0 - shadow)) + oceanSpecular(N, V, M) * ocean * 0.5);

  // Night side: warm city lights (texture baseline of the land/ocean glow removed), dimmed under cloud cover;
  // faint earth-glow so the dark side is not pure black.
  float nightMask = smoothstep(0.1, -0.1, ndl);
  vec3 lights = max(night - vec3(0.004, 0.004, 0.012), 0.0);
  float lightLum = dot(lights, vec3(0.299, 0.587, 0.114));
  vec3 cityTint = mix(vec3(1.0, 0.72, 0.40), vec3(1.0, 0.93, 0.80), smoothstep(0.03, 0.5, lightLum));  // sodium outskirts, whiter cores
  vec3 city = lights * cityTint * uNightIntensity * nightMask * (1.0 - 0.75 * smoothstep(0.1, 0.8, csUp));
  vec3 surface = direct + ambient + glint + skyRefl + moonlit + city + albedo * vec3(0.0016, 0.0019, 0.0024);
#ifdef INLINE_CLOUDS
  // 'lite' (CPU rasterisers): the cloud layer is composited here instead of drawing a second sphere;
  // same alpha curve and lighting as CLOUD_FRAGMENT, without the bump normal (6 km parallax is invisible).
  float cA = clamp(pow(csUp, 0.85) * 1.15, 0.0, 1.0);
  float cLam = max(max(ndl, 0.0), 0.05 * smoothstep(-0.06, 0.02, ndl));
  float cThick = mix(1.0, 0.8, csUp);
  vec3 cLit = S * Tsun * cLam * cThick * 0.97 + S * amb * 0.09
            + vec3(0.72, 0.82, 1.0) * uMoonLight * max(dot(N, uMoonDir), 0.0) * cThick + vec3(0.0015);
  surface = mix(surface, cLit, cA);
#endif

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

/**
 * Cloud layer (R + 6 km): alpha from the cloud texture, bump-lit by the Sun (gradient of the cloud density),
 * soft terminator, skylight, aerial perspective. Alpha-blended over the ground.
 */
export const CLOUD_FRAGMENT = /* glsl */`
uniform sampler2D tClouds;
uniform vec3 uSunDir, uSunColor, uEarthCenter, uMoonDir;
uniform float uSunIntensity, uMultiScatter, uCloudGain, uMoonLight;
varying vec3 vWorldPos, vObjPos, vNormalW, vTangentW;
varying vec2 vUv;
${ATMOSPHERE_GLSL}
${SURFACE_COMMON}

void main() {
  float c = texture2D(tClouds, vUv).r;
  float alpha = clamp(pow(c, 0.85) * uCloudGain, 0.0, 1.0);
  if (alpha < 0.004) discard;
  vec3 N = normalize(vNormalW);
  vec3 L = uSunDir;
  vec3 T = normalize(vTangentW - N * dot(vTangentW, N));
  vec3 B = cross(N, T);
  // Bump normal from the density gradient: thick cloud cores bulge toward the viewer.
  float e = 1.0 / 2048.0;
  float cx = texture2D(tClouds, vUv + vec2(e, 0.0)).r - texture2D(tClouds, vUv - vec2(e, 0.0)).r;
  float cy = texture2D(tClouds, vUv + vec2(0.0, e)).r - texture2D(tClouds, vUv - vec2(0.0, e)).r;
  vec3 Np = normalize(N - (T * cx + B * cy) * 2.2);

  float ndl = dot(N, L);
  float ndlP = dot(Np, L);
  vec3 pE = vWorldPos - uEarthCenter;
  vec3 Tsun = sunTransmittance(pE, L);
  vec3 S = uSunColor * uSunIntensity;
  float lam = max(ndlP, 0.0);
  lam = max(lam, 0.05 * smoothstep(-0.06, 0.02, ndl));    // clouds stay lit a little past the ground terminator
  float thick = mix(1.0, 0.8, c);                           // dense cores are slightly darker (self-shadowing)
  vec3 lit = S * Tsun * lam * thick * 0.97;
  lit += S * skyAmbient(ndl) * 0.09;
  lit += vec3(0.72, 0.82, 1.0) * uMoonLight * max(dot(Np, uMoonDir), 0.0) * thick;   // moonlit clouds
  lit += vec3(0.0015);                                      // starlight / earth-glow at night

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
