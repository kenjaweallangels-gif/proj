// Terrain: CDLOD patches (continuous morph between LOD levels: no cracks, no popping) over the baked levels.
// Shading: baked normals + procedural triplanar detail near the camera, material masks (dust, regolith, basalt,
// layered sediments, slope rock, paths), baked sun visibility x cascaded shadows, SH sky ambient x baked AO,
// aerial perspective. Requires common, bindings_main, atmosphere, scene_atmo, terrain_sample, lighting.

struct Patch {
  a: vec4f,   // xy = origin (x, z), z = size (m), w = grid quads per side
  b: vec4f,   // x = morph start (m), y = morph end (m), z = LOD level, w = unused
}

@group(1) @binding(0) var<storage, read> patches: array<Patch>;

struct VSOut {
  @builtin(position) @invariant clip: vec4f,
  @location(0) world: vec3f,
  @location(1) lod: f32,
}

@vertex
fn vsMain(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let pt = patches[ii];
  let dim = pt.a.w;
  let row = u32(dim) + 1u;
  let gi = vec2f(f32(vi % row), f32(vi / row));
  var g = gi / dim;
  var xz = pt.a.xy + g * pt.a.z;
  let h0 = terrainHeightAt(xz);
  let d = distance(vec3f(xz.x, h0, xz.y), frame.camPos.xyz);
  let k = clamp((d - pt.b.x) / max(pt.b.y - pt.b.x, 1e-3), 0.0, 1.0);
  // Odd grid vertices slide onto the coarser grid as k -> 1.
  let fracPart = fract(gi * 0.5) * 2.0;
  g = g - fracPart / dim * k;
  xz = pt.a.xy + g * pt.a.z;
  let h = terrainHeightAt(xz);
  var out: VSOut;
  out.world = vec3f(xz.x, h, xz.y);
  out.clip = frame.viewProj * vec4f(out.world, 1.0);
  out.lod = pt.b.z + k;
  return out;
}

// ---------------------------------------------------------------- material palette (linear albedo)
const ALB_DUST: vec3f = vec3f(0.40, 0.19, 0.085);
const ALB_REGOLITH: vec3f = vec3f(0.27, 0.125, 0.06);
const ALB_BASALT: vec3f = vec3f(0.065, 0.052, 0.044);
const ALB_SEDIMENT: vec3f = vec3f(0.46, 0.30, 0.18);
const ALB_ROCK: vec3f = vec3f(0.21, 0.105, 0.06);

struct Detail {
  n: vec3f,     // perturbed normal
  ao: f32,      // micro occlusion from detail relief
  grain: f32,   // albedo grain -1..1
}

// Triplanar detail from gradient-noise derivatives at three scales (pebbles, clods, outcrops).
fn terrainDetail(p: vec3f, n: vec3f, fade: f32, rockiness: f32) -> Detail {
  var w = pow(abs(n), vec3f(6.0));
  w = w / (w.x + w.y + w.z);
  var grad = vec3f(0.0);
  var height = 0.0;
  var grain = 0.0;
  var scales = array<f32, 3>(3.2, 0.9, 0.22);
  var amps = array<f32, 3>(0.55, 0.32, 0.16);
  for (var i = 0; i < 3; i++) {
    let s = scales[i];
    let a = amps[i] * fade * mix(0.7, 1.4, rockiness);
    if (w.y > 0.01) {
      let nz = gnoise(p.xz / s, 700u + u32(i));
      grad += w.y * a * vec3f(nz.y, 0.0, nz.z);
      height += w.y * a * nz.x;
    }
    if (w.x > 0.01) {
      let nx = gnoise(p.zy / s, 710u + u32(i));
      grad += w.x * a * vec3f(0.0, nx.z, nx.y);
      height += w.x * a * nx.x;
    }
    if (w.z > 0.01) {
      let nzz = gnoise(p.xy / s, 720u + u32(i));
      grad += w.z * a * vec3f(nzz.y, nzz.z, 0.0);
      height += w.z * a * nzz.x;
    }
  }
  grain = vnoise(p.xz * 3.1, 731u) * 0.5 + vnoise(p.xz * 0.47, 732u) * 0.5;
  var d: Detail;
  // Remove the component along n so the gradient only tilts the normal.
  let g = grad - n * dot(grad, n);
  d.n = normalize(n - g * 0.9);
  d.ao = clamp(0.82 + height * 0.35, 0.55, 1.0);
  d.grain = grain;
  return d;
}

@fragment
fn fsMain(in: VSOut) -> @location(0) vec4f {
  let p = in.world;
  let ts = terrainSurfaceAt(p.xz);
  let dist = length(frame.camPos.xyz - p);
  let m = ts.mat;
  let slopeRock = m.a;
  let basalt = m.g;

  // ---- albedo from masks + layering and macro variation
  let macro = vnoise(p.xz / 55.0, 801u) * 0.6 + vnoise(p.xz / 9.0, 802u) * 0.4;
  var albedo = mix(ALB_REGOLITH, ALB_DUST, saturate(m.r * (0.85 + 0.3 * macro)));
  // Strata: alternating light/dark bands by height on rocky slopes and sediment deposits.
  let band = 0.5 + 0.5 * sin(p.y * 0.55 + vnoise(p.xz / 40.0, 803u) * 2.5) * sin(p.y * 0.17 + 1.3);
  let rockAlb = mix(ALB_ROCK * (0.8 + 0.4 * band), ALB_SEDIMENT * (0.75 + 0.35 * band), saturate(m.b));
  albedo = mix(albedo, rockAlb, saturate(slopeRock + m.b * 0.5 * (1.0 - m.r)));
  albedo = mix(albedo, ALB_BASALT * (0.85 + 0.3 * band), saturate(basalt * (0.35 + 0.65 * slopeRock) + basalt * 0.25));
  // Paths: compacted, slightly darker and less dusty.
  albedo = mix(albedo, ALB_REGOLITH * vec3f(0.78, 0.74, 0.72), ts.path * 0.75);
  albedo *= 0.9 + 0.2 * macro;

  // ---- detail relief near the camera
  let fade = 1.0 - smoothstep(25.0, 140.0, dist);
  var n = ts.normal;
  var microAo = 1.0;
  var grain = 0.0;
  if (fade > 0.0) {
    let det = terrainDetail(p, n, fade, saturate(slopeRock + basalt));
    n = det.n;
    microAo = mix(1.0, det.ao, fade);
    grain = det.grain * fade;
  }
  albedo *= 1.0 + grain * 0.18;
  let cavityAo = clamp(1.0 + ts.cavity * 0.6, 0.6, 1.0);

  var s: Surface;
  s.pos = p;
  s.normal = n;
  s.albedo = saturate3(albedo);
  s.roughness = mix(0.93, 0.78, basalt * slopeRock) - ts.path * 0.08;
  s.metallic = 0.0;
  s.emissive = vec3f(0.0);
  s.ao = ts.ao * microAo * cavityAo;
  s.sunVis = ts.sunVis;
  s.shadowBias = 1.0;
  s.sss = 0.0;
  let lit = shadeSurface(s);
  let col = applyAerial(lit.rgb, p);
  return vec4f(sanitize(col), lit.a);
}
