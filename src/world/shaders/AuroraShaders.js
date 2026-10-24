import { ATMOSPHERE_GLSL } from './AtmosphereChunk.js';

/**
 * Aurora ovals (both hemispheres), drawn on a proxy shell (R + 335 km, front faces, additive) and evaluated
 * analytically per pixel in the Earth-fixed frame:
 *  - each discrete arc is a thin, folded curtain on a cone around the oval axis (the dipole axis shifted toward
 *    magnetic midnight, ~67 deg magnetic latitude at midnight, ~77 at noon). The ray/cone crossings are solved
 *    exactly and only a short window around each crossing is integrated, so the sheets stay razor-thin at any
 *    distance without marching the whole layer;
 *  - vertical emission profile: sharp lower border near 100 km (with a faint N2+ purple fringe), green 557.7 nm
 *    peaking at ~110 km and fading upward, red 630 nm at 200-300 km;
 *  - rays (fine striations along the arc) and folds drift and flicker in real time; brightest around magnetic
 *    midnight; only where the emission point is in the night;
 *  - a broad, faint diffuse aurora equatorward of the arcs.
 * Defines: ARCS (1..3), AURORA_SAMPLES per crossing.
 */
export const AURORA_FRAGMENT = /* glsl */`
uniform highp sampler3D tNoise;
uniform vec3 uCamObj, uSunObj, uDipole;
uniform vec4 uAurora;        // x: north strength, y: south strength, z: real time (s, wrapped), w: oval expansion (deg)
uniform float uAuroraGain;
varying vec3 vWorldPos, vObjPos, vNormalW, vTangentW;
varying vec2 vUv;
${ATMOSPHERE_GLSL}

const float H_LO = 92.0, H_HI = 330.0;

float nz(vec3 x) { return texture(tNoise, x).r; }

vec3 emission(float h) {
  float green = smoothstep(93.0, 104.0, h) * exp(-max(h - 108.0, 0.0) / 34.0);
  float red = 0.085 * exp(-pow((h - 215.0) / 55.0, 2.0));
  float fringe = 0.15 * exp(-pow((h - 97.0) / 3.5, 2.0));
  return vec3(0.22, 1.0, 0.42) * green + vec3(1.0, 0.16, 0.22) * red + vec3(0.65, 0.25, 1.0) * fringe;
}

void main() {
  vec3 ro = uCamObj;
  vec3 rd = normalize(vObjPos - uCamObj);
  vec2 tOut = raySphere(ro, rd, R_GROUND + H_HI);
  if (tOut.y <= 0.0 || tOut.x > tOut.y) discard;
  float tA = max(tOut.x, 0.0), tB = tOut.y;
  vec2 tGr = raySphere(ro, rd, R_GROUND);
  if (tGr.x > 0.0 && tGr.x < tB) tB = tGr.x;
  vec3 mid = normalize(ro + rd * 0.5 * (tA + tB));
  float hemi = dot(mid, uDipole) >= 0.0 ? 1.0 : -1.0;
  float strength = hemi > 0.0 ? uAurora.x : uAurora.y;
  if (strength <= 0.0) discard;
  // oval axis: dipole axis tilted toward magnetic midnight
  vec3 m = uDipole * hemi;
  vec3 anti = -uSunObj + m * dot(uSunObj, m);
  anti = dot(anti, anti) > 1.0e-8 ? normalize(anti) : vec3(1.0, 0.0, 0.0);
  vec3 ax = normalize(m * cos(0.08) + anti * sin(0.08));
  vec3 e1 = normalize(anti - ax * dot(anti, ax));
  vec3 e2 = cross(ax, e1);
  float alpha0 = radians(18.0 + uAurora.w);
  // quick reject: the in-layer segment never comes near the oval
  float cMax = -1.0, cMin = 1.0;
  for (int k = 0; k <= 6; k++) {
    float ck = dot(normalize(ro + rd * mix(tA, tB, float(k) / 6.0)), ax);
    cMax = max(cMax, ck); cMin = min(cMin, ck);
  }
  float angMin = acos(clamp(cMax, -1.0, 1.0)), angMax = acos(clamp(cMin, -1.0, 1.0));
  if (angMin > alpha0 + radians(10.0) || angMax < alpha0 - radians(7.0)) discard;

  float time = uAurora.z;
  vec3 sum = vec3(0.0);
  float rr = dot(ro, ro), rdro = dot(ro, rd);
  float a0 = dot(ax, ro), a1 = dot(ax, rd);
  for (int i = 0; i < ARCS; i++) {
    float fi = float(i);
    float off = i == 0 ? 0.0 : (i == 1 ? 1.3 : -1.6);
    float alpha = alpha0 + radians(off);
    float sigma = radians(0.09 + 0.05 * fi);
    float waveAmp = radians(0.9);
    float arcGain = i == 0 ? 1.0 : (i == 1 ? 0.55 : 0.4);
    // ray / cone crossings: (ax . x)^2 = cos^2(alpha) |x|^2 on the nappe with ax . x > 0
    float k = cos(alpha) * cos(alpha);
    float qa = a1 * a1 - k, qb = 2.0 * (a0 * a1 - k * rdro), qc = a0 * a0 - k * rr;
    float disc = qb * qb - 4.0 * qa * qc;
    if (disc < 0.0 || abs(qa) < 1.0e-9) continue;
    float sq = sqrt(disc);
    for (int j = 0; j < 2; j++) {
      float ts = (-qb + (j == 0 ? -sq : sq)) / (2.0 * qa);
      if (ts < tA - 400.0 || ts > tB + 400.0 || a0 + ts * a1 < 0.0) continue;
      // follow the folded sheet: re-solve the crossing for the local fold offset (two fixed-point steps)
      float alphaF = alpha;
      for (int it = 0; it < 2; it++) {
        vec3 Xc = ro + rd * ts;
        vec3 xc = normalize(Xc);
        vec2 pcc = vec2(dot(xc, e1), dot(xc, e2));
        vec2 dc = pcc / max(length(pcc), 1.0e-6);
        float fold = (nz(vec3(dc * 1.9, fi * 0.37 + time * 0.0016)) - 0.5) * 2.0
                   + 0.45 * (nz(vec3(dc * 6.0, fi * 0.71 + time * 0.0045)) - 0.5) * 2.0;
        alphaF = alpha + waveAmp * fold;
        float kf = cos(alphaF) * cos(alphaF);
        float fa = a1 * a1 - kf, fb = 2.0 * (a0 * a1 - kf * rdro), fc = a0 * a0 - kf * rr;
        float fd = fb * fb - 4.0 * fa * fc;
        if (fd < 0.0 || abs(fa) < 1.0e-9) break;
        float fs = sqrt(fd);
        float r0 = (-fb - fs) / (2.0 * fa), r1 = (-fb + fs) / (2.0 * fa);
        ts = abs(r0 - ts) < abs(r1 - ts) ? r0 : r1;
      }
      // angular rate of the ray across the cone -> integration window around the crossing
      vec3 X = ro + rd * ts;
      float lx = length(X);
      float cth = dot(ax, X) / lx;
      float dc = a1 / lx - dot(ax, X) * dot(X, rd) / (lx * lx * lx);
      float rate = abs(dc) / max(sqrt(1.0 - cth * cth), 1.0e-4);
      float halfW = 3.0 * sigma / max(rate, 1.0e-7);
      float s0 = max(tA, ts - halfW), s1 = min(tB, ts + halfW);
      if (s1 <= s0) continue;
      float ds = (s1 - s0) / float(AURORA_SAMPLES);
      for (int s = 0; s < AURORA_SAMPLES; s++) {
        float t = s0 + (float(s) + 0.5 + 0.1 * (hash12(gl_FragCoord.xy + float(s)) - 0.5)) * ds;
        vec3 P = ro + rd * t;
        float lp = length(P);
        float h = lp - R_GROUND;
        if (h < H_LO - 6.0) continue;
        vec3 xh = P / lp;
        float th = acos(clamp(dot(xh, ax), -1.0, 1.0));
        vec2 pc = vec2(dot(xh, e1), dot(xh, e2));
        vec2 dir = pc / max(length(pc), 1.0e-6);      // along-oval position (cos, sin of magnetic local time from midnight)
        float fold = (nz(vec3(dir * 1.9, fi * 0.37 + time * 0.0016)) - 0.5) * 2.0
                   + 0.45 * (nz(vec3(dir * 6.0, fi * 0.71 + time * 0.0045)) - 0.5) * 2.0;
        float dth = th - alpha - waveAmp * fold;
        float wgt = exp(-dth * dth / (sigma * sigma));
        if (wgt < 1.0e-3) continue;
        float rays = nz(vec3(dir * 11.0, time * 0.012 + fi)) ;
        rays = 0.35 + 1.4 * rays * rays;
        float midnight = 0.2 + 0.8 * pow(0.5 + 0.5 * dir.x, 1.5);
        float dark = smoothstep(0.02, -0.22, dot(xh, uSunObj));
        vec3 em = emission(h);
        em.g *= rays;
        sum += em * (wgt * midnight * dark * arcGain * ds);
      }
    }
  }
  // diffuse aurora: broad faint band equatorward of the arcs, low in the layer
  vec2 t115 = raySphere(ro, rd, R_GROUND + 115.0);
  if (t115.x > 0.0 && t115.x < tB + 1.0) {
    vec3 xh = normalize(ro + rd * t115.x);
    float th = acos(clamp(dot(xh, ax), -1.0, 1.0));
    float band = exp(-pow((th - alpha0 - radians(2.6)) / radians(2.2), 2.0));
    float path = min(1.0 / max(abs(dot(xh, rd)), 0.08), 12.0);
    float dark = smoothstep(0.02, -0.22, dot(xh, uSunObj));
    sum += vec3(0.25, 1.0, 0.45) * band * path * dark * 1.6;
  }
  vec3 col = sum * strength * uAuroraGain;
  gl_FragColor = vec4(col, 1.0);
}`;
