// Uber shader for colony modules, props, rover, cave mesh and crew figures (one static batch + instanced dynamic
// meshes). Materials are selected per vertex; PBR parameters stay within a small, consistent set (Документ §5:
// a limited number of shader variants). Requires common, bindings_main, atmosphere, scene_atmo, terrain_sample, lighting,
// instances.

@group(1) @binding(0) var<storage, read> instances: array<Instance>;

struct VSIn {
  @location(0) pos: vec3f,
  @location(1) normal: vec4f,     // snorm8x4: xyz normal, w = baked AO
  @location(2) color: vec4f,      // unorm8x4: sRGB albedo, a = roughness
  @location(3) mat: vec4u,        // uint8x4: x = material, y = module index (255 = none), z = metallic*255, w = flags
}

struct VSOut {
  @builtin(position) @invariant clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) @interpolate(flat) mat: vec4u,
  @location(3) color: vec4f,
  @location(4) ao: f32,
  @location(5) @interpolate(flat) inst: u32,
  @location(6) local: vec3f,
  @location(7) baked: vec2f,
}

const MAT_PAINT: u32 = 0u;
const MAT_METAL: u32 = 1u;
const MAT_DARK: u32 = 2u;
const MAT_WINDOW: u32 = 3u;
const MAT_SOLAR: u32 = 4u;
const MAT_ROCK: u32 = 5u;
const MAT_LAMP: u32 = 6u;
const MAT_FABRIC: u32 = 7u;
const MAT_VISOR: u32 = 8u;
const MAT_BEACON: u32 = 9u;
const MAT_HAZARD: u32 = 10u;
const MAT_PLATE: u32 = 11u;
const MAT_SCREEN: u32 = 12u;
const MAT_CAVE: u32 = 13u;

const FLAG_ACCENT: u32 = 1u;
const FLAG_NO_DUST: u32 = 2u;
const FLAG_INTERIOR: u32 = 4u;

@vertex
fn vsMain(v: VSIn, @builtin(instance_index) ii: u32) -> VSOut {
  let inst = instances[ii];
  let wp = inst.model * vec4f(v.pos, 1.0);
  var out: VSOut;
  out.world = wp.xyz;
  out.normal = normalize((inst.model * vec4f(v.normal.xyz, 0.0)).xyz);
  out.clip = frame.viewProj * wp;
  out.mat = v.mat;
  out.color = v.color;
  out.ao = clamp(v.normal.w, 0.0, 1.0);
  out.inst = ii;
  out.local = v.pos;
  out.baked = terrainBakedLight(wp.xz);
  return out;
}

fn hazardStripes(p: vec3f) -> f32 {
  return step(0.5, fract((p.x + p.y + p.z) * 2.2));
}

fn solarCells(local: vec3f) -> f32 {
  let g = abs(fract(local.xz * vec2f(6.0, 6.0)) - 0.5);
  return smoothstep(0.44, 0.48, max(g.x, g.y));
}

@fragment
fn fsMain(in: VSOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let inst = instances[in.inst];
  let matId = in.mat.x;
  var n = normalize(in.normal);
  if (!front) { n = -n; }
  let flags = in.mat.w;
  var albedo = srgbToLinear(in.color.rgb);
  if ((flags & FLAG_ACCENT) != 0u) { albedo = inst.tint.rgb; }
  var rough = in.color.a;
  var metal = f32(in.mat.z) / 255.0;
  var emissive = vec3f(0.0);
  var sss = 0.0;
  var ao = in.ao;
  var modIdx = i32(in.mat.y);
  if (inst.params.x >= 0.0) { modIdx = i32(inst.params.x); }
  var modState = vec4f(0.0, 1.0, 0.0, 0.0);
  if (modIdx >= 0 && modIdx < 255 && u32(modIdx) < frame.counts.y) { modState = frame.modules[modIdx]; }
  let t = frame.camPos.w;
  let emergency = frame.post.w;
  let dimmed = frame.scene.x;

  switch (matId) {
    case MAT_WINDOW: {
      // Interior glow behind glass: warm, flickers slightly; sealed modules pulse red; reflections from lighting below.
      // The alarm colour does not depend on the normal window glow: a dark, sealed module still pulses red.
      let warm = vec3f(1.0, 0.72, 0.42) * 2.6 * modState.y;
      let alarm = vec3f(1.0, 0.08, 0.04) * 3.0 * (0.55 + 0.45 * sin(t * 5.0));
      var glow = mix(warm, alarm, max(max(modState.x, emergency * 0.6), modState.z * 0.8));
      glow *= 0.6 + 0.4 * vnoise(in.world.xy * 1.7 + in.world.zz * 0.9, 5u);
      emissive = glow * (1.0 - dimmed * 0.85);
      albedo = vec3f(0.02);
      rough = 0.08;
      metal = 0.0;
    }
    case MAT_SOLAR: {
      let cell = solarCells(in.local);
      albedo = mix(vec3f(0.012, 0.018, 0.045), vec3f(0.55), cell);
      rough = mix(0.18, 0.5, cell);
      metal = mix(0.0, 0.8, cell);
    }
    case MAT_LAMP: {
      emissive = albedo * (6.0 + inst.tint.a) * (1.0 - dimmed * 0.7);
      albedo = vec3f(0.8);
      rough = 0.3;
    }
    case MAT_BEACON: {
      // Rotating emergency beacon: bright lobe sweeping around the local Y axis.
      let ang = atan2(in.local.z, in.local.x);
      let sweep = pow(max(cos(ang - t * 5.2 - inst.params.y), 0.0), 6.0);
      let on = max(emergency, modState.x);
      emissive = vec3f(1.0, 0.06, 0.02) * (0.4 + 9.0 * sweep) * on;
      albedo = vec3f(0.35, 0.03, 0.02);
      rough = 0.25;
    }
    case MAT_HAZARD: {
      albedo = mix(vec3f(0.02), srgbToLinear(vec3f(0.95, 0.72, 0.08)), hazardStripes(in.world));
      rough = 0.6;
    }
    case MAT_SCREEN: {
      let scan = 0.75 + 0.25 * sin(in.world.y * 140.0 + t * 3.0);
      emissive = albedo * 1.8 * scan * (1.0 + inst.tint.a);
      albedo = vec3f(0.02);
      rough = 0.15;
    }
    case MAT_FABRIC: {
      sss = 0.25;
      albedo *= 0.9 + 0.1 * vnoise(in.local.xy * 40.0, 9u);
    }
    case MAT_VISOR: {
      albedo = vec3f(0.85, 0.62, 0.25);
      rough = 0.06;
      metal = 1.0;
      // Faint helmet interior light when the character is speaking.
      emissive = vec3f(0.9, 0.75, 0.5) * 0.12 * inst.params.w;
    }
    case MAT_ROCK, MAT_CAVE: {
      // Same basalt as the terrain cliffs (terrain.wgsl ALB_BASALT and bed banding), plus vesicular grain, rust
      // stains and wind-blown dust on ledges.
      let grain = fbm3(in.world * 0.9, 3, 13u);
      let yb = in.world.y + vnoise(in.world.xz / 220.0, 803u) * 6.0 + vnoise(in.world.xz / 37.0, 805u) * 0.8;
      let band = clamp(0.5 + 0.28 * sin(yb * 0.61) + 0.16 * sin(yb * 0.233 + 1.3) + 0.12 * sin(yb * 1.71 + 0.4), 0.0, 1.0);
      albedo = vec3f(0.065, 0.052, 0.044) * (0.85 + 0.3 * band) * (0.8 + 0.45 * grain);
      let rust = smoothstep(0.1, 0.5, fbm3(in.world * 0.23 + 4.0, 3, 17u));
      albedo = mix(albedo, vec3f(0.17, 0.075, 0.035), rust * 0.45);
      rough = 0.9;
      metal = 0.0;
      let bump = vec3f(fbm3(in.world * 1.7, 2, 21u), fbm3(in.world * 1.7 + 7.3, 2, 22u), fbm3(in.world * 1.7 + 3.1, 2, 23u));
      let bump2 = vec3f(vnoise3(in.world * 6.0, 24u), vnoise3(in.world * 6.0 + 2.1, 25u), vnoise3(in.world * 6.0 + 5.7, 26u));
      n = normalize(n + (bump - n * dot(bump, n)) * 0.55 + (bump2 - n * dot(bump2, n)) * 0.15);
      // Dust on ledges and on the tube floor near the mouth.
      let ledge = smoothstep(0.35, 0.85, n.y) * (0.6 + 0.4 * grain);
      albedo = mix(albedo, vec3f(0.34, 0.16, 0.075), ledge * 0.75);
    }
    default: {}
  }

  // Weathering of painted exterior panels: broad tonal variation and dust run-off streaks on vertical faces.
  if ((matId == MAT_PAINT || matId == MAT_PLATE) && (flags & FLAG_INTERIOR) == 0u && (flags & FLAG_ACCENT) == 0u) {
    let broad = fbm3(in.world * 0.6, 2, 41u);
    let streak = vnoise(vec2f((in.world.x + in.world.z) * 9.0, in.world.y * 0.7), 42u);
    let vertical = 1.0 - smoothstep(0.3, 0.7, abs(n.y));
    albedo *= 0.93 + 0.1 * broad - vertical * smoothstep(0.2, 0.9, streak) * 0.07;
    rough = clamp(rough + broad * 0.08, 0.05, 1.0);
  }

  // Dust settles on up-facing exterior surfaces.
  if ((flags & FLAG_NO_DUST) == 0u && matId != MAT_WINDOW && matId != MAT_LAMP && matId != MAT_SCREEN && matId != MAT_ROCK && matId != MAT_CAVE) {
    let up = smoothstep(0.15, 0.85, n.y);
    let patchy = 0.5 + 0.5 * vnoise(in.world.xz * 2.3 + in.world.yy * 1.3, 31u);
    let lowEdge = 1.0 - smoothstep(0.0, 0.9, in.world.y);
    let dust = saturate((up * 0.75 * patchy + lowEdge * 0.35) * (0.6 + inst.params.z));
    albedo = mix(albedo, vec3f(0.36, 0.17, 0.08), dust * select(0.85, 0.45, matId == MAT_SOLAR));
    rough = mix(rough, 0.9, dust);
    metal = mix(metal, 0.0, dust);
  }

  var s: Surface;
  s.pos = in.world;
  s.normal = n;
  s.albedo = albedo;
  s.roughness = clamp(rough, 0.04, 1.0);
  s.metallic = metal;
  s.emissive = emissive * (1.0 + inst.tint.a * select(0.0, 1.0, matId == MAT_LAMP));
  var bakedAo = in.baked.y;
  var sunVis = in.baked.x;
  if ((flags & FLAG_INTERIOR) != 0u) { sunVis = 0.0; bakedAo = 0.15; }
  if (matId == MAT_CAVE) {
    // Inside the lava tube: sky light falls off with depth (vertex AO carries the tube depth term).
    bakedAo = 1.0;
  }
  s.ao = ao * mix(1.0, bakedAo, 0.85);
  s.sunVis = sunVis;
  s.shadowBias = 0.5;
  s.sss = sss;
  let lit = shadeSurface(s);
  return vec4f(sanitize(applyAerial(lit.rgb, in.world)), lit.a);
}
