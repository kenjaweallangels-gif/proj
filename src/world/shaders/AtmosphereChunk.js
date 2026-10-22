/**
 * Shared GLSL for the far-scene Earth shaders: a physically based single-scattering atmosphere
 * (Rayleigh + Mie, ozone absorption folded into the Rayleigh column) in kilometres,
 * Earth-centred coordinates. Optical depths use Schueler's approximation of the Chapman
 * grazing-incidence function, so a light-path transmittance costs one sqrt + exp per species
 * instead of a secondary ray march, and the per-segment mass of the view ray is exact for the
 * exponential density profile (difference of two Chapman evaluations).
 *
 * Materials that include this chunk must define SAMPLES (view segments) and MODE
 * (0 = samples concentrated at the far end of the path, for ground/cloud rays;
 *  1 = samples concentrated around the tangent point, for limb rays).
 */
export const ATMOSPHERE_GLSL = /* glsl */`
#define PI 3.14159265359
const float R_GROUND = 6371.0;
const float R_ATMO = 6471.0;
const float H_R = 8.0;                                   // Rayleigh scale height (km)
const float H_M = 1.2;                                   // Mie scale height (km)
const vec3 BETA_R = vec3(5.8e-3, 13.5e-3, 33.1e-3);      // Rayleigh scattering (1/km) at sea level
const vec3 BETA_M = vec3(3.0e-3);                        // Mie scattering (1/km) at sea level
const vec3 EXT_R = vec3(5.8e-3 * 1.21, 13.5e-3 * 1.26, 33.1e-3 * 1.005); // + ozone absorption (vertical column equivalent)
const vec3 EXT_M = vec3(3.0e-3 * 1.11);                  // Mie extinction (scattering + absorption)
const float MIE_G = 0.76;

// Chapman function (Schueler, GPU Pro 3): integral of exp(-h) density from altitude h (scale heights)
// along a ray with zenith cosine mu out to space, in scale heights. X = planet radius / scale height.
float chapman(float X, float h, float mu) {
  float c = sqrt(X + h);
  if (mu >= 0.0) return c / (c * mu + 1.0) * exp(-h);
  float x0 = sqrt(1.0 - mu * mu) * (X + h);
  if (x0 < X) return 1.0e4;                          // the ray runs into the ground: opaque
  return 2.0 * sqrt(x0) * exp(X - x0) - c / (1.0 - c * mu) * exp(-h);
}

// Density integrals (km) of both species from p along dir to space.
void densityToSpace(vec3 p, vec3 dir, out float dR, out float dM) {
  float r = length(p);
  float mu = clamp(dot(p, dir) / r, -1.0, 1.0);
  float alt = max(r - R_GROUND, 0.0);
  dR = H_R * chapman(R_GROUND / H_R, alt / H_R, mu);
  dM = H_M * chapman(R_GROUND / H_M, alt / H_M, mu);
}
vec3 opticalDepth(float dR, float dM) { return EXT_R * dR + EXT_M * dM; }
vec3 sunTransmittance(vec3 p, vec3 sunDir) {
  float dR, dM; densityToSpace(p, sunDir, dR, dM);
  return exp(-opticalDepth(dR, dM));
}

float phaseRayleigh(float mu) { return 3.0 / (16.0 * PI) * (1.0 + mu * mu); }
float phaseMie(float mu) {
  float g2 = MIE_G * MIE_G;
  return 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * mu, 1.5));
}

// Ray / sphere (centred at the origin). Returns (tNear, tFar); tNear > tFar on a miss.
vec2 raySphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float d = b * b - c;
  if (d < 0.0) return vec2(1.0e9, -1.0e9);
  float s = sqrt(d);
  return vec2(-b - s, -b + s);
}

// Single-scattered sunlight along the view segment [tA, tB] of the ray ro + rd * t (t grows away from the
// camera). Returns in-scattered radiance per unit sun irradiance; transm = transmittance of the segment.
vec3 inscatter(vec3 ro, vec3 rd, float tA, float tB, vec3 sunDir, out vec3 transm) {
  float mu = dot(rd, sunDir);
  float pR = phaseRayleigh(mu), pM = phaseMie(mu);
  vec3 p0 = ro + rd * tA;
  float cR0, cM0; densityToSpace(p0, -rd, cR0, cM0);
  vec3 tau = vec3(0.0);
  vec3 sum = vec3(0.0);
  for (int i = 1; i <= SAMPLES; i++) {
    float s = float(i) / float(SAMPLES);
    #if MODE == 1
      float x = 2.0 * s - 1.0; s = 0.5 + 0.5 * sign(x) * x * x;
    #else
      s = 1.0 - (1.0 - s) * (1.0 - s);
    #endif
    vec3 p1 = ro + rd * mix(tA, tB, s);
    float cR1, cM1; densityToSpace(p1, -rd, cR1, cM1);
    float mR = max(cR1 - cR0, 0.0), mM = max(cM1 - cM0, 0.0);   // mass of this segment
    vec3 tauSeg = opticalDepth(mR, mM);
    vec3 Tview = exp(-(tau + 0.5 * tauSeg));
    vec3 Tsun = sunTransmittance(0.5 * (p0 + p1), sunDir);
    sum += (BETA_R * pR * mR + BETA_M * pM * mM) * Tview * Tsun;
    tau += tauSeg; p0 = p1; cR0 = cR1; cM0 = cM1;
  }
  transm = exp(-tau);
  return sum;
}

// Equirectangular uv of an object-space direction, matching THREE.SphereGeometry (u=0 at -X, u=0.25 at +Z).
vec2 equirectUv(vec3 d) {
  d = normalize(d);
  return vec2(fract(atan(d.z, -d.x) / (2.0 * PI)), 0.5 + asin(clamp(d.y, -1.0, 1.0)) / PI);
}

// Tangent frame of the textured sphere in object space (tangent along +u).
vec3 sphereTangent(vec3 nObj) {
  vec3 t = vec3(nObj.z, 0.0, -nObj.x);
  return dot(t, t) > 1.0e-6 ? normalize(t) : vec3(0.0, 0.0, 1.0);
}

float hash12(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;
