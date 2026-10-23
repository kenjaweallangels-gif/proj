// Limited transparency (Документ §5: transparencies have their own overdraw budget): wind-blown dust motes around
// the camera (count from the profile), lamp/beacon glows, alarm markers, sealed-zone barriers, biography glints.
// Blending keeps the HDR alpha channel (ambient fraction for SSAO) untouched.
// Requires common, bindings_main, atmosphere, scene_atmo, terrain_sample, lighting.

struct FxHeader {
  dust: vec4f,      // xyz = half extents of the dust box around the camera (m), w = particle count
  wind: vec4f,      // xyz = wind velocity (m/s), w = emergency dust boost 0..1
  focus: vec4f,     // xyz = emergency centre, w = radius
  misc: vec4f,      // x = sprite count
}

struct Sprite {
  posSize: vec4f,   // xyz = position, w = size (m)
  color: vec4f,     // rgb = HDR colour, a = intensity
  params: vec4f,    // x = kind, y = phase, z = height (beams/barriers), w = unused
}

struct FxData {
  header: FxHeader,
  sprites: array<Sprite>,
}

@group(1) @binding(0) var<storage, read> fx: FxData;

struct DustOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) alpha: f32,
}

fn corner(vi: u32) -> vec2f {
  var c = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  return c[vi % 6u];
}

fn cameraAxes() -> mat2x3f {
  let right = vec3f(frame.view[0][0], frame.view[1][0], frame.view[2][0]);
  let up = vec3f(frame.view[0][1], frame.view[1][1], frame.view[2][1]);
  return mat2x3f(right, up);
}

fn particleLights(p: vec3f) -> vec3f {
  var sum = vec3f(0.0);
  let count = min(frame.counts.x, MAX_LIGHTS);
  for (var i = 0u; i < count; i++) {
    let L = frame.lights[i];
    let d = L.posRange.xyz - p;
    let d2 = dot(d, d);
    if (d2 > L.posRange.w * L.posRange.w) { continue; }
    var atten = 1.0 / (d2 + 0.5);
    if (L.color.w > 0.5) {
      atten *= smoothstep(L.dirCone.w, L.params.x, dot(-normalize(d), L.dirCone.xyz));
    }
    sum += L.color.rgb * atten;
  }
  return sum;
}

@vertex
fn vsDust(@builtin(vertex_index) vi: u32) -> DustOut {
  let id = vi / 6u;
  var out: DustOut;
  out.uv = corner(vi);
  let count = u32(fx.header.dust.w);
  if (id >= count) { out.clip = vec4f(0.0, 0.0, -2.0, 1.0); out.alpha = 0.0; return out; }
  let box = fx.header.dust.xyz;
  let t = frame.camPos.w;
  let h = vec3f(rand1(id * 3u + 11u), rand1(id * 3u + 12u), rand1(id * 3u + 13u));
  let swirl = vec3f(sin(t * 0.7 + h.x * 40.0), sin(t * 0.43 + h.y * 31.0) * 0.4, cos(t * 0.61 + h.z * 27.0)) * 0.6;
  let gust = 1.0 + fx.header.wind.w * 2.5;
  var p = h * 2.0 * box + fx.header.wind.xyz * t * gust * (0.6 + 0.8 * h.y) + swirl;
  let origin = frame.camPos.xyz - box;
  p = origin + fract((p - origin) / (2.0 * box)) * 2.0 * box;
  // Dust hugs the ground: fade with height above the terrain.
  let ground = terrainHeightAt(p.xz);
  let above = p.y - ground;
  let camDist = distance(p, frame.camPos.xyz);
  var a = (1.0 - smoothstep(1.5, 9.0, above)) * step(0.0, above);
  a *= smoothstep(0.6, 2.5, camDist) * (1.0 - smoothstep(box.x * 0.6, box.x * 0.95, camDist));
  let size = mix(0.006, 0.02, rand1(id * 7u + 3u)) * (1.0 + camDist * 0.01);
  let ax = cameraAxes();
  let wp = p + (ax[0] * out.uv.x + ax[1] * out.uv.y) * size;
  out.clip = frame.viewProj * vec4f(wp, 1.0);
  // Lighting: strong forward scattering toward the sun (dust glints in backlight), sky ambient, local lights.
  let v = normalize(p - frame.camPos.xyz);
  let phase = hgPhase(dot(v, frame.sunDir.xyz), 0.65) * 4.0 * PI;
  let sunLit = atmo.sunColor.rgb * terrainBakedLight(p.xz).x * (0.15 + 0.5 * phase);
  let col = (sunLit + shIrradiance(vec3f(0.0, 1.0, 0.0)) * 1.2 + particleLights(p) * 0.6) * vec3f(0.55, 0.32, 0.18);
  out.color = col;
  out.alpha = a * 0.4;
  return out;
}

@fragment
fn fsDust(in: DustOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  let a = in.alpha * saturate(1.0 - r2);
  if (a <= 0.002) { discard; }
  return vec4f(sanitize(in.color) * a, a);
}

// ---------------------------------------------------------------- sprites
struct SpriteOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) color: vec4f,
  @location(2) @interpolate(flat) params: vec4f,
  @location(3) world: vec3f,
}

const KIND_GLOW: f32 = 0.0;
const KIND_RING: f32 = 1.0;
const KIND_BEAM: f32 = 2.0;
const KIND_BARRIER: f32 = 3.0;
const KIND_DIAMOND: f32 = 4.0;
const KIND_GLINT: f32 = 5.0;

@vertex
fn vsSprite(@builtin(vertex_index) vi: u32) -> SpriteOut {
  let id = vi / 6u;
  let s = fx.sprites[id];
  var out: SpriteOut;
  let c = corner(vi);
  out.uv = c;
  out.color = s.color;
  out.params = s.params;
  let kind = s.params.x;
  let size = s.posSize.w;
  var wp = s.posSize.xyz;
  let ax = cameraAxes();
  if (kind == KIND_RING) {
    wp += vec3f(c.x, 0.0, c.y) * size;
  } else if (kind == KIND_BEAM || kind == KIND_BARRIER) {
    // Vertical quad facing the camera around the Y axis.
    let toCam = normalize(vec3f(frame.camPos.x - wp.x, 0.0, frame.camPos.z - wp.z) + vec3f(1e-4, 0.0, 0.0));
    let side = vec3f(-toCam.z, 0.0, toCam.x);
    wp += side * c.x * size + vec3f(0.0, (c.y * 0.5 + 0.5) * s.params.z, 0.0);
  } else {
    // Camera-facing; glows are pulled toward the camera so the lamp housing does not clip them.
    let toCam = normalize(frame.camPos.xyz - wp);
    if (kind == KIND_GLOW) { wp += toCam * min(size * 0.5, 0.6); }
    wp += (ax[0] * c.x + ax[1] * c.y) * size;
  }
  out.world = wp;
  out.clip = frame.viewProj * vec4f(wp, 1.0);
  return out;
}

@fragment
fn fsSprite(in: SpriteOut) -> @location(0) vec4f {
  let kind = in.params.x;
  let t = frame.camPos.w;
  let r = length(in.uv);
  var a = 0.0;
  if (kind == KIND_GLOW) {
    a = exp(-r * r * 7.0) * 0.8 + exp(-r * 18.0) * 0.6;
  } else if (kind == KIND_RING) {
    let phase = fract(t * 0.6 + in.params.y);
    let ring = 1.0 - smoothstep(0.0, 0.06, abs(r - (0.25 + phase * 0.75)));
    let core = 1.0 - smoothstep(0.08, 0.2, abs(r - 0.25));
    a = (ring * (1.0 - phase) + core * 0.6) * step(r, 1.0);
  } else if (kind == KIND_BEAM) {
    let y = in.uv.y * 0.5 + 0.5;
    a = exp(-in.uv.x * in.uv.x * 9.0) * (1.0 - y) * (0.7 + 0.3 * sin(t * 4.0 + in.params.y * 6.0));
  } else if (kind == KIND_BARRIER) {
    let y = in.uv.y * 0.5 + 0.5;
    let stripes = step(0.5, fract((in.world.x + in.world.z) * 1.5 + in.world.y * 1.5 - t * 0.6));
    a = (0.35 + 0.65 * stripes) * smoothstep(1.0, 0.85, abs(in.uv.x)) * (1.0 - y * 0.7) * 0.35 * (0.75 + 0.25 * sin(t * 3.0));
  } else if (kind == KIND_DIAMOND) {
    let d = abs(in.uv.x) + abs(in.uv.y);
    a = (1.0 - smoothstep(0.8, 0.9, d)) * (0.35 + 0.65 * smoothstep(0.55, 0.8, d));
  } else {
    let star = max(exp(-abs(in.uv.x) * 14.0) * exp(-abs(in.uv.y) * 2.5), exp(-abs(in.uv.y) * 14.0) * exp(-abs(in.uv.x) * 2.5));
    a = (star + exp(-r * r * 12.0)) * (0.6 + 0.4 * sin(t * 2.3 + in.params.y * 9.0));
  }
  let col = in.color.rgb * in.color.a * a;
  // Glows fade with the same aerial perspective as the scene (extinction only).
  let d = distance(in.world, frame.camPos.xyz);
  let T = exp(-hazeOpticalDepth(frame.camPos.y, normalize(in.world - frame.camPos.xyz), d));
  return vec4f(sanitize(col * T), 0.0);
}
