// Instanced procedural rocks: displaced, chipped icosphere variants (several LODs) pulled from storage buffers by
// the GPU-culled index lists. They receive the baked terrain shadow/AO at their footprint and the cascaded shadow
// map; dust collects on upward faces. Requires common, bindings_main, atmosphere, scene_atmo, terrain_sample,
// lighting, instances.

@group(1) @binding(0) var<storage, read> rocks: array<RockInstance>;
@group(1) @binding(1) var<storage, read> visible: array<u32>;
@group(1) @binding(2) var<storage, read> rockVerts: array<RockVertex>;
@group(1) @binding(3) var<uniform> draw: RockDraw;

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) cavity: f32,
  @location(3) @interpolate(flat) shape: vec4f,
  @location(4) baked: vec2f,
  @location(5) local: vec3f,
  @location(6) @interpolate(flat) base: vec4f,
}

@vertex
fn vsMain(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let r = rocks[visible[draw.listBase + ii]];
  let v = rockVerts[draw.vertexBase + u32(r.shape.x) * draw.vertexCount + vi];
  var out: VSOut;
  out.world = rockWorld(r, v.pos.xyz);
  out.normal = rockNormal(r, v.nrm.xyz);
  out.clip = frame.viewProj * vec4f(out.world, 1.0);
  out.cavity = v.pos.w;
  out.shape = r.shape;
  out.baked = terrainBakedLight(r.posScale.xz);
  out.local = v.pos.xyz * r.posScale.w;
  out.base = r.posScale;
  return out;
}

@fragment
fn fsMain(in: VSOut) -> @location(0) vec4f {
  var n = normalize(in.normal);
  let p = in.world;
  let dist = length(frame.camPos.xyz - p);
  // Rock colour: dark basalt to rusty brown, with grain and weathering bands.
  let grain = fbm3(in.local * 3.1 + vec3f(in.shape.z * 37.0), 3, 61u);
  let base = mix(vec3f(0.07, 0.056, 0.047), vec3f(0.23, 0.12, 0.07), in.shape.z);
  var albedo = base * (0.8 + 0.5 * grain);
  // Fine bump near the camera.
  if (dist < 60.0) {
    let k = (1.0 - dist / 60.0) * 0.45;
    let q = in.local * 6.0;
    let b = vec3f(vnoise3(q, 71u), vnoise3(q + 4.1, 72u), vnoise3(q + 8.3, 73u));
    n = normalize(n + (b - n * dot(b, n)) * k);
  }
  // Dust on top, more for rocks in dusty areas; a dusty skirt where the rock meets the ground.
  let up = smoothstep(0.25, 0.9, n.y);
  let skirt = 1.0 - smoothstep(0.0, 0.25 * in.base.w + 0.05, p.y - (in.base.y));
  let dust = saturate(up * (0.35 + 0.6 * in.shape.w) * (0.7 + 0.3 * grain) + skirt * 0.5);
  albedo = mix(albedo, vec3f(0.38, 0.18, 0.085), dust);

  var s: Surface;
  s.pos = p;
  s.normal = n;
  s.albedo = albedo;
  s.roughness = mix(0.72, 0.92, dust);
  s.metallic = 0.0;
  s.emissive = vec3f(0.0);
  s.ao = in.cavity * mix(1.0, in.baked.y, 0.8) * (0.75 + 0.25 * smoothstep(0.0, 0.5 * in.base.w, p.y - in.base.y));
  s.sunVis = in.baked.x;
  s.shadowBias = 0.6;
  s.sss = 0.0;
  let lit = shadeSurface(s);
  return vec4f(sanitize(applyAerial(lit.rgb, p)), lit.a);
}
