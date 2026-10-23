/** Star field (Points) and Milky Way (equirect sphere) shaders. */

/**
 * Stars: the point size grows slowly with flux; the Gaussian footprint is normalised so the integrated
 * brightness follows the magnitude exactly, so faint stars become dim sub-pixel dots instead of vanishing.
 * Sizes are in CSS pixels (scaled by the device pixel ratio for gl_PointSize).
 */
export const STAR_VERTEX = /* glsl */`
attribute float aMag;
attribute vec3 aColor;
uniform float uPixelRatio, uExposure, uSizeScale;
#ifdef EARTH_OCCLUSION
uniform vec3 uEarthCenter;   // relative to the camera (km)
uniform float uEarthRadius;  // ground + atmosphere (km)
#endif
varying vec3 vColor;
varying float vSize;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
#ifdef EARTH_OCCLUSION
  // drawn without a depth buffer ('lite' renders stars straight to the canvas): hide stars behind the Earth
  vec3 dir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  float b = dot(dir, uEarthCenter);
  if (b > 0.0 && dot(uEarthCenter, uEarthCenter) - b * b < uEarthRadius * uEarthRadius) { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec3(0.0); vSize = 0.0; return; }
#endif
  float flux = pow(10.0, -0.4 * aMag);                       // mag 0 -> 1
  float sizeCss = (1.6 + 0.9 * log2(1.0 + flux * 8.0)) * uSizeScale;
  float size = sizeCss * uPixelRatio;
  vSize = size;
  gl_PointSize = size;
  float peak = flux * 3.6 / (0.2036 * sizeCss * sizeCss);     // integral of the Gaussian footprint = flux * 3.6
  vColor = aColor * peak * uExposure;
}`;

export const STAR_FRAGMENT = /* glsl */`
varying vec3 vColor;
varying float vSize;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * vSize;
  float sigma = max(vSize * 0.18, 0.45);
  float g = exp(-dot(d, d) / (2.0 * sigma * sigma));
  gl_FragColor = vec4(vColor * g, 1.0);
}`;

export const MILKYWAY_VERTEX = /* glsl */`
varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/**
 * Milky Way: samples the equirect brightness map by RA/Dec of the ECI direction (u = ra/360,
 * v = (90 - dec)/180 with the texture not flipped), tinted blue-white, with fbm granulation and a
 * warmer dense core so the band is not a flat smear. Additive.
 */
export const MILKYWAY_FRAGMENT = /* glsl */`
uniform sampler2D uMap;
uniform float uIntensity, uExposure;
varying vec3 vDir;
#define PI 3.14159265359
float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i), n100 = hash3(i + vec3(1, 0, 0)), n010 = hash3(i + vec3(0, 1, 0)), n110 = hash3(i + vec3(1, 1, 0));
  float n001 = hash3(i + vec3(0, 0, 1)), n101 = hash3(i + vec3(1, 0, 1)), n011 = hash3(i + vec3(0, 1, 1)), n111 = hash3(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 7.1) + 0.125 * vnoise(p * 4.07 + 3.3) + 0.0625 * vnoise(p * 8.11 + 1.7); }
void main() {
  vec3 d = normalize(vDir);
  float ra = atan(d.y, d.x);
  if (ra < 0.0) ra += 2.0 * PI;
  float dec = asin(clamp(d.z, -1.0, 1.0));
  vec2 uv = vec2(ra / (2.0 * PI), (0.5 * PI - dec) / PI);
  float m = texture2D(uMap, uv).r;
  if (m <= 0.0005) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }   // outside the band: skip the noise
#ifdef LITE
  m *= 0.55 + 0.6 * vnoise(d * 60.0);                // one octave on CPU rasterisers
#else
  float n = fbm(d * 60.0);
  float n2 = fbm(d * 220.0 + 11.0);
  m *= 0.55 + 0.6 * n + 0.25 * n2;                   // granulation / dust lanes
#endif
  m = pow(max(m, 0.0), 1.25);
  vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.9, 0.78), smoothstep(0.25, 0.9, m));
  vec3 col = tint * m * uIntensity * uExposure;
  gl_FragColor = vec4(col, 1.0);
}`;
