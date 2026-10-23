// Bake: procedural rock scattering (Документ §13: procedural world by seed and biome parameters, validated placement).
// Candidates are drawn by seed in three distance bands; density follows geology masks (more boulders near basalt
// cliffs and on rocky slopes, fewer on dust); no rocks on the colony pad, on paths or inside the cave tube.
// Requires common.wgsl + bake_common.wgsl + bake_sample.wgsl + instances.wgsl.

struct ScatterParams {
  capacity: u32,
  candidates: u32,
  seed: u32,
  padRadius: f32,
}

@group(0) @binding(0) var<uniform> P: BakeParams;
@group(0) @binding(2) var heights: texture_2d_array<f32>;
@group(0) @binding(3) var rawMask: texture_2d_array<f32>;
@group(0) @binding(5) var terrainLight: texture_2d_array<f32>;
@group(0) @binding(6) var terrainMat: texture_2d_array<f32>;
@group(0) @binding(7) var terrainNormal: texture_2d_array<f32>;
@group(0) @binding(8) var<uniform> S: ScatterParams;
@group(0) @binding(9) var<storage, read_write> rocksOut: array<RockInstance>;
@group(0) @binding(10) var<storage, read_write> counter: array<atomic<u32>>;

fn bestLevel(xz: vec2f) -> i32 {
  let m = max(abs(xz.x - P.center.x), abs(xz.y - P.center.y));
  if (m < P.levels.z * 0.95) { return 2; }
  if (m < P.levels.y * 0.95) { return 1; }
  return 0;
}

fn texelOf(xz: vec2f, level: i32) -> vec2i {
  let half = P.levels[level];
  let uv = (xz - P.center.xy + vec2f(half)) / (2.0 * half);
  return clamp(vec2i(uv * P.levels.w), vec2i(0), vec2i(i32(P.levels.w) - 1));
}

fn randomQuat(a: f32, b: f32, c: f32) -> vec4f {
  let s1 = sqrt(1.0 - a);
  let s2 = sqrt(a);
  return vec4f(s1 * sin(TAU * b), s1 * cos(TAU * b), s2 * sin(TAU * c), s2 * cos(TAU * c));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= S.candidates) { return; }
  let h0 = pcg(i * 9781u + S.seed);
  let r0 = rand1(h0);
  let r1 = rand1(h0 + 1u);
  let r2 = rand1(h0 + 2u);
  let r3 = rand1(h0 + 3u);
  let r4 = rand1(h0 + 4u);
  let r5 = rand1(h0 + 5u);
  let r6 = rand1(h0 + 6u);
  let r7 = rand1(h0 + 7u);

  // Distance bands (uniform by area inside each band) and size ranges per band.
  var rMin = 40.0;
  var rMax = 380.0;
  var sMin = 0.12;
  var sMax = 1.8;
  var centre = P.center.xy;
  if (r0 < 0.16) {
    // Boulder field below the lava-bench cliff around the cave mouth (blocks fallen from the face).
    centre = P.cave.xy + P.caveDir.xy * 26.0;
    rMin = 6.0; rMax = 150.0; sMin = 0.2; sMax = 2.8;
  } else if (r0 > 0.88) {
    rMin = 1400.0; rMax = 3400.0; sMin = 2.0; sMax = 11.0;
  } else if (r0 > 0.62) {
    rMin = 380.0; rMax = 1400.0; sMin = 0.45; sMax = 4.5;
  }
  let rad = sqrt(mix(rMin * rMin, rMax * rMax, r1));
  let ang = r2 * TAU;
  let p = centre + vec2f(cos(ang), sin(ang)) * rad;
  if (length(p - P.center.xy) < S.padRadius) { return; }
  // Keep the cave mouth itself clear.
  if (length(p - P.cave.xy) < P.cave.z * 0.8) { return; }

  let level = bestLevel(p);
  let tc = texelOf(p, level);
  let light = textureLoad(terrainLight, tc, level, 0);
  let mat = textureLoad(terrainMat, tc, level, 0);
  let n = textureLoad(terrainNormal, tc, level, 0).xyz;
  let raw = textureLoad(rawMask, tc, level, 0);
  if (light.a > 0.03 || raw.a > 0.05) { return; }  // paths, cave tube
  let slope = 1.0 - n.y;
  if (slope > 0.55) { return; }                    // nothing rests on cliffs
  // Density from geology: boulder fields below basalt faces and on rocky ground, sparse on dust.
  let density = 0.18 + mat.g * 1.1 + mat.a * 0.9 + (1.0 - mat.r) * 0.35 + smoothstep(0.08, 0.3, slope) * 0.6;
  if (r3 * 2.4 > density) { return; }

  // Power-law sizes: many small stones, few boulders.
  let s = clamp(sMin * pow(1.0 - r4 * 0.985, -0.85), sMin, sMax);
  let squash = mix(0.5, 0.9, r5);
  let h = heightBest(p);
  let sink = s * squash * mix(0.2, 0.4, r6);
  let idx = atomicAdd(&counter[0], 1u);
  if (idx >= S.capacity) { return; }
  var inst: RockInstance;
  inst.posScale = vec4f(p.x, h - sink, p.y, s);
  // Mostly upright rotations (yaw dominant) with some tilt.
  let yaw = r7 * TAU;
  let tilt = (r6 - 0.5) * 0.5;
  let qy = vec4f(0.0, sin(yaw * 0.5), 0.0, cos(yaw * 0.5));
  let qx = vec4f(sin(tilt * 0.5), 0.0, 0.0, cos(tilt * 0.5));
  inst.quat = normalize(vec4f(qy.w * qx.xyz + qx.w * qy.xyz + cross(qy.xyz, qx.xyz), qy.w * qx.w - dot(qy.xyz, qx.xyz)));
  inst.shape = vec4f(f32(h0 % 6u), squash, rand1(h0 + 8u), mat.r);
  rocksOut[idx] = inst;
}
