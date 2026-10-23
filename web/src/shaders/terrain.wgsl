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
const ALB_SEDIMENT: vec3f = vec3f(0.40, 0.24, 0.135);
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
  var amps = array<f32, 3>(0.2, 0.14, 0.09);
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

// Scattered stones on a jittered grid (one candidate per cell, 3x3 search): returns (dome height 0..1, dome slope xz,
// stone id). Outside every stone, x is minus the strength of the contact-shadow ring (0..1) around the nearest one.
// Gives crisp, individually lit pebbles near the camera where the baked textures are too coarse.
fn stones(p: vec2f, cell: f32, density: f32, seed: u32) -> vec4f {
  let q = p / cell;
  let iq = vec2i(floor(q));
  var best = vec4f(0.0, 0.0, 0.0, 0.0);
  var ring = 0.0;
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let c = iq + vec2i(i, j);
      let h = hash2u(c, seed);
      if (f32(h & 1023u) / 1023.0 > density) { continue; }
      let o = vec2f(f32((h >> 10u) & 255u), f32((h >> 18u) & 255u)) / 255.0;
      let r = 0.16 + 0.3 * f32((h >> 26u) & 63u) / 63.0;
      // Slightly elongated, randomly oriented stones.
      let a = f32(h & 255u) * 0.0246;
      let rot = mat2x2f(vec2f(cos(a), sin(a)), vec2f(-sin(a), cos(a)));
      let d0 = rot * (q - (vec2f(c) + o)) / (r * vec2f(1.0, 0.72));
      // Irregular, chipped outline: the radius varies with the angle around the stone.
      let ang = atan2(d0.y, d0.x);
      let ph = f32((h >> 3u) & 63u) * 0.1;
      let rr = 1.0 + 0.16 * sin(3.0 * ang + ph) + 0.08 * sin(5.0 * ang + ph * 2.3) + 0.05 * sin(8.0 * ang + ph * 1.7);
      let d = d0 / rr;
      let dd = dot(d, d);
      if (dd < 1.0) {
        let height = sqrt(1.0 - dd);
        if (height > best.x) { best = vec4f(height, transpose(rot) * (d / vec2f(1.0, 0.72)), f32((h >> 4u) & 255u) / 255.0); }
      } else {
        ring = max(ring, 1.0 - smoothstep(1.0, 1.55, dd));
      }
    }
  }
  if (best.x <= 0.0) { best.x = -ring; }
  return best;
}

@fragment
fn fsMain(in: VSOut) -> @location(0) vec4f {
  let p = in.world;
  let ts = terrainSurfaceAt(p.xz);
  let dist = length(frame.camPos.xyz - p);
  let m = ts.mat;
  let slopeRock = m.a;
  let basalt = m.g;

  // ---- albedo from the geology masks; macro variation is broad and low-contrast (no camouflage blotches)
  let macroVar = vnoise(p.xz / 260.0, 801u) * 0.5 + vnoise(p.xz / 70.0, 802u) * 0.32 + vnoise(p.xz / 19.0, 804u) * 0.18;
  let dustK = saturate(0.33 + 0.42 * m.r + 0.12 * macroVar);
  var albedo = mix(ALB_REGOLITH, ALB_DUST, dustK);
  // Strata: alternating light/dark bands by height on rocky slopes and sediment deposits.
  // Layered deposits: beds of varying thickness (three incommensurate periods), only gently warped.
  let yb = p.y + vnoise(p.xz / 220.0, 803u) * 6.0 + vnoise(p.xz / 37.0, 805u) * 0.8;
  let band = saturate(0.5 + 0.28 * sin(yb * 0.61) + 0.16 * sin(yb * 0.233 + 1.3) + 0.12 * sin(yb * 1.71 + 0.4));
  let rockAlb = mix(ALB_ROCK * (0.8 + 0.4 * band), ALB_SEDIMENT * (0.75 + 0.35 * band), saturate(m.b));
  albedo = mix(albedo, rockAlb, saturate(slopeRock + m.b * 0.5 * (1.0 - m.r)));
  albedo = mix(albedo, ALB_BASALT * (0.85 + 0.3 * band), saturate(basalt * (0.35 + 0.65 * slopeRock) + basalt * 0.25));
  // Paths: compacted, slightly darker and less dusty.
  albedo = mix(albedo, ALB_REGOLITH * vec3f(0.8, 0.76, 0.74), ts.path * 0.7);
  albedo *= 0.95 + 0.1 * macroVar;

  // ---- detail near the camera: relief normals, gravel and grain (fades out well before it could alias)
  let fade = 1.0 - smoothstep(18.0, 110.0, dist);
  var n = ts.normal;
  var microAo = 1.0;
  if (fade > 0.0) {
    let rocky = saturate(slopeRock + basalt);
    let det = terrainDetail(p, n, fade, rocky);
    n = det.n;
    microAo = mix(1.0, det.ao, fade);
    // Grain: fine albedo noise on the regolith.
    let grains = vnoise(p.xz * 31.0, 813u) * 0.6 + vnoise(p.xz * 11.0, 814u) * 0.4;
    albedo *= 1.0 + grains * 0.1 * fade + det.grain * 0.06 * fade;
    // Stones: pebbles and cobbles of vesicular basalt, fewer on compacted paths and in deep dust; each stone is a
    // small lit dome with a contact shadow, faded out before it can alias.
    let stoneFade = 1.0 - smoothstep(9.0, 30.0, dist);
    if (stoneFade > 0.0) {
      let dens = (1.0 - ts.path * 0.8) * (0.35 + 0.65 * (1.0 - m.r * 0.7));
      let a = stones(p.xz, 0.28, 0.13 * dens, 821u);
      let b = stones(p.xz + vec2f(17.3, 4.1), 1.1, 0.035 * dens, 822u);
      var st = a;
      if (b.x > a.x) { st = b; }
      let cover = smoothstep(0.0, 0.25, max(st.x, 0.0)) * stoneFade;
      if (cover > 0.0) {
        // Flat-topped, chipped stones: steep flanks, broad tops; faceted by a little value noise.
        let facet = vnoise(p.xz * 9.0, 823u) * 0.35;
        let stoneN = normalize(vec3f(st.y * 1.3 + facet, max(pow(max(st.x, 0.0), 0.6), 0.15), st.z * 1.3 - facet));
        n = normalize(mix(n, stoneN, cover * 0.9));
        let tone = mix(vec3f(0.12, 0.085, 0.065), vec3f(0.27, 0.15, 0.09), st.w) * (0.85 + 0.3 * vnoise(p.xz * 13.0, 824u));
        let dusty = smoothstep(0.5, 0.95, stoneN.y) * (0.35 + 0.45 * m.r);
        albedo = mix(albedo, mix(tone, ALB_DUST, dusty), cover);
      }
      // Contact shadow: a faint ring on the regolith around each stone.
      microAo *= 1.0 - max(-st.x, 0.0) * 0.18 * stoneFade;
    }
  }
  let cavityAo = clamp(1.0 + ts.cavity * 0.45, 0.65, 1.0);

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
