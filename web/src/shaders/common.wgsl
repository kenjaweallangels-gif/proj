// Shared declarations for every scene shader. Mirrored on the CPU side by web/src/render/frame.ts (keep in sync).
// Units: metres, radiance in "scene units" (sun irradiance at the top of the atmosphere = illuminance / 50).

const PI: f32 = 3.14159265359;
const TAU: f32 = 6.28318530718;
const MAX_LIGHTS: u32 = 24u;
const MAX_MODULES: u32 = 16u;

struct Light {
  posRange: vec4f,   // xyz world position, w = range (m)
  color: vec4f,      // rgb intensity (linear scene units), w = type: 0 point, 1 spot
  dirCone: vec4f,    // xyz spot direction, w = cos(outer cone angle)
  params: vec4f,     // x = cos(inner cone angle), y = flicker 0..1, zw unused
}

struct Frame {
  viewProj: mat4x4f,
  view: mat4x4f,
  proj: mat4x4f,
  invViewProj: mat4x4f,
  shadowViewProj: array<mat4x4f, 4>,
  cascadeFar: vec4f,      // view-space distance at which each cascade ends (m)
  camPos: vec4f,          // xyz camera position, w = time (s)
  camFwd: vec4f,          // xyz camera forward, w = near plane (m)
  sunDir: vec4f,          // xyz direction toward the sun, w = cos(angular radius of the sun disc)
  viewport: vec4f,        // internal width, height, 1/width, 1/height
  fog: vec4f,             // x = uniform dust extinction (1/m), y = ground haze extinction (1/m), z = haze scale height (m), w = view distance (m)
  post: vec4f,            // x = exposure, y = bloom strength, z = AO strength, w = emergency 0..1
  scene: vec4f,           // x = lights dimmed 0..1, y = torch 0/1, z = cascade count, w = 1 / shadow map size
  counts: vec4u,          // x = light count, y = module count, z = frame index, w = flags (bit0: ao enabled)
  terrainLevels: vec4f,   // half extents of the three bake levels (m), w = bake resolution (texels)
  terrainInfo: vec4f,     // xy = bake centre (m), z = shadow distance (m), w = height scale (m)
  lights: array<Light, 24>,
  modules: array<vec4f, 16>, // per colony module: x = sealed 0/1, y = window glow, z = alarm pulse 0..1, w = unused
}

struct Atmo {
  sunColor: vec4f,        // rgb: sun irradiance reaching the ground (scene units, perpendicular), a = unused
  sh: array<vec4f, 9>,    // L2 spherical harmonics of the sky radiance (rgb)
  skyAvg: vec4f,          // mean upper-hemisphere radiance
  horizon: vec4f,         // mean horizon radiance
}

// ---------------------------------------------------------------- hashing and noise
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn hash2u(p: vec2i, seed: u32) -> u32 {
  return pcg(bitcast<u32>(p.x) ^ pcg(bitcast<u32>(p.y) ^ seed));
}

fn rand2(p: vec2i, seed: u32) -> f32 {
  return f32(hash2u(p, seed) & 0xffffffu) / 16777216.0;
}

fn rand1(n: u32) -> f32 {
  return f32(pcg(n) & 0xffffffu) / 16777216.0;
}

fn grad2(p: vec2i, seed: u32) -> vec2f {
  let a = f32(hash2u(p, seed) & 0xffffu) * (TAU / 65536.0);
  return vec2f(cos(a), sin(a));
}

// Gradient noise with analytic derivatives: returns (value, d/dx, d/dy), value roughly in [-1, 1].
fn gnoise(p: vec2f, seed: u32) -> vec3f {
  let fl = floor(p);
  let i = vec2i(fl);
  let f = p - fl;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  let ga = grad2(i, seed);
  let gb = grad2(i + vec2i(1, 0), seed);
  let gc = grad2(i + vec2i(0, 1), seed);
  let gd = grad2(i + vec2i(1, 1), seed);
  let va = dot(ga, f);
  let vb = dot(gb, f - vec2f(1.0, 0.0));
  let vc = dot(gc, f - vec2f(0.0, 1.0));
  let vd = dot(gd, f - vec2f(1.0, 1.0));
  let k = va - vb - vc + vd;
  let v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  let d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd) + du * (u.yx * k + vec2f(vb - va, vc - va));
  return vec3f(v, d) * 1.41;
}

// Cheap value noise (no derivatives) for shading detail.
fn vnoise(p: vec2f, seed: u32) -> f32 {
  let fl = floor(p);
  let i = vec2i(fl);
  let f = p - fl;
  let u = f * f * (3.0 - 2.0 * f);
  let a = rand2(i, seed);
  let b = rand2(i + vec2i(1, 0), seed);
  let c = rand2(i + vec2i(0, 1), seed);
  let d = rand2(i + vec2i(1, 1), seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

const ROT2: mat2x2f = mat2x2f(vec2f(0.8, 0.6), vec2f(-0.6, 0.8));

fn fbm(p: vec2f, octaves: i32, seed: u32) -> f32 {
  var a = 0.0;
  var w = 0.5;
  var q = p;
  for (var i = 0; i < octaves; i++) {
    a += w * gnoise(q, seed + u32(i) * 101u).x;
    w *= 0.5;
    q = ROT2 * q * 2.03;
  }
  return a;
}

// 3D value noise for shading (triplanar-free rock grain).
fn hash3(p: vec3i, seed: u32) -> f32 {
  return f32(pcg(bitcast<u32>(p.x) ^ pcg(bitcast<u32>(p.y) ^ pcg(bitcast<u32>(p.z) ^ seed))) & 0xffffffu) / 16777216.0;
}

fn vnoise3(p: vec3f, seed: u32) -> f32 {
  let fl = floor(p);
  let i = vec3i(fl);
  let f = p - fl;
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i, seed);
  let n100 = hash3(i + vec3i(1, 0, 0), seed);
  let n010 = hash3(i + vec3i(0, 1, 0), seed);
  let n110 = hash3(i + vec3i(1, 1, 0), seed);
  let n001 = hash3(i + vec3i(0, 0, 1), seed);
  let n101 = hash3(i + vec3i(1, 0, 1), seed);
  let n011 = hash3(i + vec3i(0, 1, 1), seed);
  let n111 = hash3(i + vec3i(1, 1, 1), seed);
  let x0 = mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y);
  let x1 = mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y);
  return mix(x0, x1, u.z) * 2.0 - 1.0;
}

fn fbm3(p: vec3f, octaves: i32, seed: u32) -> f32 {
  var a = 0.0;
  var w = 0.5;
  var q = p;
  for (var i = 0; i < octaves; i++) {
    a += w * vnoise3(q, seed + u32(i) * 37u);
    w *= 0.5;
    q = q * 2.07 + vec3f(1.7, 9.2, 3.1);
  }
  return a;
}

// ---------------------------------------------------------------- colour helpers
fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn saturate3(c: vec3f) -> vec3f {
  return clamp(c, vec3f(0.0), vec3f(1.0));
}

fn linearToSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

fn srgbToLinear(c: vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((c + 0.055) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}

// Guards against NaN/Inf reaching the HDR target (one bad pixel would poison bloom and exposure).
fn sanitize(c: vec3f) -> vec3f {
  let ok = (c == c) & (abs(c) < vec3f(6.0e4));
  return select(vec3f(0.0), c, ok);
}
