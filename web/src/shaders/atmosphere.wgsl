// Physically-inspired Mars atmosphere: thin CO2 (weak Rayleigh) + suspended dust (strong, forward-scattering, absorbing
// in blue). Daytime sky comes out butterscotch; the forward-scattering lobe is bluer, which gives the blue-ish glow
// around a low sun. Requires common.wgsl.

const MARS_R: f32 = 3389500.0;
const ATMO_TOP: f32 = 3449500.0;           // 60 km
const RAY_H: f32 = 11100.0;
const DUST_H: f32 = 11000.0;
const RAY_BETA: vec3f = vec3f(2.2e-7, 5.1e-7, 1.24e-6);   // CO2 Rayleigh, scaled from Earth by density and cross-section
const DUST_TAU: f32 = 0.32;                // zenith optical depth of dust (clear afternoon, northern summer)
const DUST_ALBEDO: vec3f = vec3f(0.972, 0.8, 0.56);       // single-scattering albedo (red, green, blue): iron oxides absorb green/blue
const DUST_G: vec3f = vec3f(0.62, 0.68, 0.79);             // forward asymmetry per channel
const SKY_LUT_ALT: f32 = 60.0;             // camera altitude the sky-view LUT is computed for (m)

fn dustExtinction(h: f32) -> f32 {
  return (DUST_TAU / DUST_H) * exp(-max(h, 0.0) / DUST_H);
}

fn rayleighPhase(c: f32) -> f32 {
  return 3.0 / (16.0 * PI) * (1.0 + c * c);
}

fn hgPhase(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// Dust phase: per-channel forward HG lobe + a weak back-scatter lobe.
fn dustPhase(c: f32) -> vec3f {
  let fwd = vec3f(hgPhase(c, DUST_G.x), hgPhase(c, DUST_G.y), hgPhase(c, DUST_G.z));
  return fwd * 0.93 + vec3f(hgPhase(c, -0.25)) * 0.07;
}

// Distance from point at radius r (direction cosine mu w.r.t. local up) to a sphere of radius R; negative if missed.
fn raySphere(r: f32, mu: f32, R: f32) -> f32 {
  let b = r * mu;
  let c = r * r - R * R;
  let disc = b * b - c;
  if (disc < 0.0) { return -1.0; }
  let s = sqrt(disc);
  let t1 = -b - s;
  let t2 = -b + s;
  if (t1 > 0.0) { return t1; }
  if (t2 > 0.0) { return t2; }
  return -1.0;
}

// Transmittance from altitude h along direction cosine mu to the top of the atmosphere (0 if the ray hits the ground).
fn transmittanceToTop(h: f32, mu: f32) -> vec3f {
  let r = MARS_R + h;
  if (raySphere(r, mu, MARS_R) > 0.0 && mu < 0.0) { return vec3f(0.0); }
  let len = raySphere(r, mu, ATMO_TOP);
  let n = 24;
  let dt = len / f32(n);
  var ray = 0.0;
  var dust = 0.0;
  for (var i = 0; i < n; i++) {
    let t = (f32(i) + 0.5) * dt;
    let hh = sqrt(r * r + t * t + 2.0 * r * t * mu) - MARS_R;
    ray += exp(-hh / RAY_H) * dt;
    dust += dustExtinction(hh) * dt;
  }
  return exp(-(RAY_BETA * ray + vec3f(dust)));
}

// ---------------------------------------------------------------- sky-view LUT mapping
// u: azimuth relative to the sun (0 = toward the sun, 1 = away), v: elevation with extra resolution near the horizon.
fn skyLutUv(dir: vec3f, sunDir: vec3f) -> vec2f {
  let elev = asin(clamp(dir.y, -1.0, 1.0));
  let v = 0.5 + 0.5 * sign(elev) * sqrt(abs(elev) / (0.5 * PI));
  let h = normalize(vec2f(dir.x, dir.z) + vec2f(1e-6, 0.0));
  let s = normalize(vec2f(sunDir.x, sunDir.z) + vec2f(1e-6, 0.0));
  let az = acos(clamp(dot(h, s), -1.0, 1.0));
  return vec2f(az / PI, v);
}

fn skyLutDir(uv: vec2f, sunDir: vec3f) -> vec3f {
  let vv = uv.y * 2.0 - 1.0;
  let elev = sign(vv) * vv * vv * 0.5 * PI;
  let az = uv.x * PI;
  let s = normalize(vec2f(sunDir.x, sunDir.z) + vec2f(1e-6, 0.0));
  let c = cos(az);
  let sn = sin(az);
  let h = vec2f(s.x * c - s.y * sn, s.x * sn + s.y * c);
  return vec3f(h.x * cos(elev), sin(elev), h.y * cos(elev));
}

// Single + approximated multiple scattering along a view ray from altitude h0 (used by the bake to fill the LUT).
fn integrateSky(h0: f32, dir: vec3f, sunDir: vec3f, sunE: f32) -> vec3f {
  let r0 = MARS_R + h0;
  let mu = dir.y;
  var len = raySphere(r0, mu, ATMO_TOP);
  let ground = raySphere(r0, mu, MARS_R);
  let hitsGround = ground > 0.0;
  if (hitsGround) { len = ground; }
  let n = 40;
  let cosT = dot(dir, sunDir);
  let phR = rayleighPhase(cosT);
  let phD = dustPhase(cosT);
  var trans = vec3f(1.0);
  var sum = vec3f(0.0);
  var t0 = 0.0;
  for (var i = 0; i < n; i++) {
    // Quadratic step distribution: dense near the camera where density is highest.
    let a = f32(i + 1) / f32(n);
    let t1 = a * a * len;
    let dt = t1 - t0;
    let t = 0.5 * (t0 + t1);
    t0 = t1;
    let p = vec3f(0.0, r0, 0.0) + dir * t;
    let rr = length(p);
    let hh = rr - MARS_R;
    let up = p / rr;
    let sunMu = dot(up, sunDir);
    let ray = RAY_BETA * exp(-hh / RAY_H);
    let dustE = dustExtinction(hh);
    let dustS = DUST_ALBEDO * dustE;
    let ext = ray + vec3f(dustE);
    let tSun = transmittanceToTop(hh, sunMu);
    // Multiple scattering: isotropic source proportional to the locally available (attenuated) sunlight;
    // energy per order scales with albedo, so blue is suppressed further (butterscotch).
    let ms = DUST_ALBEDO / (1.0 - 0.72 * DUST_ALBEDO) * 0.22 * max(sunMu + 0.12, 0.0) * transmittanceToTop(hh, 1.0);
    let src = (ray * phR + dustS * phD) * tSun + (dustS + ray) * ms / (4.0 * PI);
    let stepT = exp(-ext * dt);
    // Energy-conserving integration of in-scattering over the step.
    sum += trans * src * (1.0 - stepT) / max(ext, vec3f(1e-12));
    trans *= stepT;
  }
  return sum * sunE;
}
