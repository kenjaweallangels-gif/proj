/**
 * Sky shaders: catalogue stars (physically based point spread function), Milky Way + zodiacal light, overlays.
 *
 * Radiometry (shared by everything in the far scene): a white Lambert surface in full sunlight at 1 au has radiance
 * 1.45 (scene HDR units). A star of magnitude m delivers 10^(-0.4 m) x 2.04e-11 of the solar irradiance (V = -26.74),
 * so its image holds  E = 10^(-0.4 m) x 2.04e-11 x pi x 1.45 / Omega_px  HDR x pixel  (Omega_px = solid angle of a
 * device pixel). An extended source of surface brightness mu (mag / arcsec^2) has radiance 3.95 x 10^(-0.4 mu).
 * The sky gain (Sky.gain: dark adaptation of the eye, or the telescope camera's exposure) multiplies both.
 */

/** Shared GLSL: angular helpers. */
const COMMON = /* glsl */`
#define PI 3.14159265359
`;

/**
 * Stars as points. aStar = (r, g, b, V code): colour stored as rgb / luminance / 2 (0..255), V = code / 16 - 2.
 * PSF = (1 - w) Gaussian(sigma) + w Moffat(beta 2.5, 3 sigma): the core carries the flux, the faint wing (scatter
 * in the eye / optics) makes bright stars look larger. The sprite is cut where the PSF falls below uThreshold, so
 * faint stars are 1-3 px dots and their integrated brightness is exact at any size (no aliasing, no twinkle: the
 * PSF is evaluated about the true sub-pixel centre).
 *
 * EARTH_OCCLUSION ('lite': stars drawn straight onto the canvas without depth): analytic Earth / Moon test.
 * FADE_REGIONS (telescope): stars inside up to 8 DSO image tiles fade out (the tiles contain them already).
 */
export const STAR_VERTEX = /* glsl */`
${COMMON}
attribute vec4 aStar;
uniform float uFluxScale;   // HDR energy of a magnitude-0 star (physical x gain / pixel solid angle)
uniform float uSigma;       // core sigma, device px
uniform float uWing;        // wing fraction of the flux
uniform float uThreshold;   // smallest HDR value worth drawing
uniform float uMagLimit;    // hard limit of this draw (stars fade over the last 0.5 mag)
uniform float uMaxSize;     // device px
uniform float uSaturate;    // core peak (HDR) that displays as white
#ifdef EARTH_OCCLUSION
uniform vec3 uEarthCenter;  // relative to the camera (km)
uniform float uEarthRadius; // ground + atmosphere (km)
uniform vec4 uMoon;         // Moon centre relative to the camera (km), radius
#endif
#ifdef FADE_REGIONS
uniform vec4 uFade[8];      // ECI direction, cos(radius)
uniform float uFadeAmount[8];
#endif
varying vec3 vColor;
varying float vSize, vE, vSigma;
void cull() { gl_PointSize = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vColor = vec3(0.0); vSize = 0.0; vE = 0.0; vSigma = 1.0; }
void main() {
  float mag = aStar.w / 16.0 - 2.0;
  float lim = 1.0 - smoothstep(uMagLimit - 0.5, uMagLimit, mag);
  float E = exp2(-1.32877 * mag) * uFluxScale * lim;        // 10^(-0.4 m) = 2^(-1.32877 m)
#ifdef FADE_REGIONS
  vec3 dirE = normalize(position);
  for (int i = 0; i < 8; i++) {
    if (uFadeAmount[i] > 0.0) {
      float c = dot(dirE, uFade[i].xyz);
      E *= 1.0 - uFadeAmount[i] * smoothstep(uFade[i].w - (1.0 - uFade[i].w) * 0.3, uFade[i].w + (1.0 - uFade[i].w) * 0.2, c);
    }
  }
#endif
  float s = uSigma, sw = 3.0 * uSigma;
  float pc = E * (1.0 - uWing) / (2.0 * PI * s * s);
  if (pc < uThreshold) { cull(); return; }
  // a display cannot show a core brighter than white: spread saturated cores (energy kept) so that brighter stars
  // look larger, as the eye perceives them (perceived size ~ peak^0.35 beyond saturation)
  float sat = pc / uSaturate;
  if (sat > 1.0) { s *= pow(sat, 0.175); sw = 3.0 * s; pc = E * (1.0 - uWing) / (2.0 * PI * s * s); }
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
#ifdef EARTH_OCCLUSION
  vec3 dir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  float b = dot(dir, uEarthCenter);
  if (b > 0.0 && dot(uEarthCenter, uEarthCenter) - b * b < uEarthRadius * uEarthRadius) { cull(); return; }
  float bm = dot(dir, uMoon.xyz);
  if (bm > 0.0 && dot(uMoon.xyz, uMoon.xyz) - bm * bm < uMoon.w * uMoon.w) { cull(); return; }
#endif
  float pw = E * uWing * 1.5 / (PI * sw * sw);
  float rc = s * sqrt(2.0 * log(pc / uThreshold));
  float rw = pw > uThreshold ? sw * sqrt(pow(pw / uThreshold, 0.4) - 1.0) : 0.0;
  float size = clamp(2.0 * max(max(rc, rw), 0.75) + 1.0, 1.0, uMaxSize);
  gl_PointSize = size;
  vSize = size;
  vE = E;
  vSigma = s;
  vColor = aStar.rgb * (2.0 / 255.0);
}`;

export const STAR_FRAGMENT = /* glsl */`
${COMMON}
uniform float uWing;
varying vec3 vColor;
varying float vSize, vE, vSigma;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * vSize;
  float r2 = dot(d, d);
  float s = vSigma, sw = 3.0 * vSigma;
  float core = exp(-r2 / (2.0 * s * s)) * (1.0 - uWing) / (2.0 * PI * s * s);
  float q = 1.0 + r2 / (sw * sw);
  float wing = uWing * 1.5 / (PI * sw * sw) / (q * q * sqrt(q));
  gl_FragColor = vec4(vColor * vE * (core + wing), 1.0);
}`;

export const MILKYWAY_VERTEX = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/**
 * Milky Way: NASA SVS Deep Star Maps 2020 (Gaia DR2 sky without the Hipparcos / Tycho-2 stars, which are drawn as
 * points) in the equirect convention u = RA / 360, v = (90 - Dec) / 180, sRGB-encoded linear radiance. Calibration:
 * texel value 0.0015 (galactic poles) = 23.7 mag / arcsec^2 -> radiance = uMwScale x value.
 * Zodiacal light + gegenschein (rough fit to Leinert et al. 1998, S10 units -> mag / arcsec^2), solar colour.
 * Seam-free mip selection across RA 0h with textureGrad.
 */
export const MILKYWAY_FRAGMENT = /* glsl */`
${COMMON}
uniform sampler2D uMap;
uniform float uMwScale;     // texel value -> HDR radiance (physical) x gain x perceptual boost
uniform float uZodiScale;   // S10 -> HDR radiance x gain (0 = off)
uniform vec3 uSunEci;       // unit
varying vec3 vDir;
const vec3 ECL_POLE = vec3(0.0, -0.397777, 0.917482);
void main() {
  vec3 d = normalize(vDir);
  float ra = atan(d.y, d.x);
  float dec = asin(clamp(d.z, -1.0, 1.0));
  vec2 uv = vec2(ra / (2.0 * PI) + 0.5, (0.5 * PI - dec) / PI);
  // u in [0, 1) with the seam at RA 0: uv1 wraps at RA 0h, uv2 at RA 12h; take the smaller derivative
  vec2 uv1 = vec2(fract(uv.x + 0.5), uv.y);
  vec2 uv2 = vec2(uv.x, uv.y);
  vec2 dx1 = dFdx(uv1), dy1 = dFdy(uv1), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  vec2 dx = vec2(abs(dx1.x) < abs(dx2.x) ? dx1.x : dx2.x, dx1.y);
  vec2 dy = vec2(abs(dy1.x) < abs(dy2.x) ? dy1.x : dy2.x, dy1.y);
  vec3 col = textureGrad(uMap, uv1, dx, dy).rgb * uMwScale;
  if (uZodiScale > 0.0) {
    float ce = clamp(dot(d, uSunEci), -1.0, 1.0);
    float eps = acos(ce) * (180.0 / PI);
    float beta = abs(asin(clamp(dot(d, ECL_POLE), -1.0, 1.0))) * (180.0 / PI);
    float iEcl = eps < 90.0 ? 180.0 * pow(90.0 / max(eps, 12.0), 1.7) : 130.0 + 50.0 * max(0.0, (120.0 - eps) / 30.0);
    iEcl += 55.0 * exp(-pow((180.0 - eps) / 11.0, 2.0));            // gegenschein
    float w = 14.0 + 16.0 * (1.0 - eps / 180.0);
    float s10 = 60.0 + (iEcl - 60.0) * exp(-beta / w);
    col += vec3(1.0, 0.93, 0.83) * s10 * uZodiScale;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

/** Constellation figures / boundaries / grid: plain coloured lines, additive. */
export const LINE_VERTEX = /* glsl */`
uniform float uAlpha;
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
export const LINE_FRAGMENT = /* glsl */`
uniform vec3 uColor;
uniform float uAlpha;
void main() { gl_FragColor = vec4(uColor * uAlpha, 1.0); }`;
