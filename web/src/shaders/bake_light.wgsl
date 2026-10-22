// Bake pass 3: static lighting for one level (Документ §4/§5: baked light for static geology).
//  r = soft sun visibility: march toward the sun across all levels (long mesa shadows at a low sun),
//  g = sky ambient occlusion: horizon search in 8 directions,
//  b = cave darkness (the tube is roofed by the cave mesh, which the heightfield cannot represent),
//  a = path mask (rover tracks / footpaths).
// Requires common.wgsl + bake_common.wgsl + bake_sample.wgsl + bake_paths.wgsl.

@group(0) @binding(0) var<uniform> P: BakeParams;
@group(0) @binding(1) var<storage, read> paths: array<PathSeg>;
@group(0) @binding(2) var heights: texture_2d_array<f32>;
@group(0) @binding(3) var rawMask: texture_2d_array<f32>;
@group(0) @binding(4) var outLight: texture_storage_2d_array<rgba8unorm, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = u32(P.levels.w);
  if (gid.x >= res || gid.y >= res) { return; }
  let level = i32(P.info.y);
  let c = vec2i(gid.xy);
  let texel = levelTexel(level);
  let p = levelWorld(level, c);
  let h0 = textureLoad(heights, c, level, 0).r;
  let mapHalf = P.levels.x;

  // ---- soft sun visibility
  let sunH = normalize(P.sun.xz);
  let tanE = P.sun.w;
  var vis = 1.0;
  var t = texel * 0.75;
  let start = h0 + 0.15 + texel * 0.12;
  for (var i = 0; i < 72; i++) {
    let q = p + sunH * t;
    if (max(abs(q.x - P.center.x), abs(q.y - P.center.y)) > mapHalf) { break; }
    let rayH = start + t * tanE;
    if (rayH > P.valley.w * 1.25 + 200.0) { break; }
    let th = heightBest(q);
    // Penumbra widens with distance (sun disc + dust forward scattering): ~1.2 degrees.
    let soft = t * 0.021 + texel * 0.35;
    vis = min(vis, clamp((rayH - th) / soft * 0.5 + 0.5, 0.0, 1.0));
    if (vis < 0.003) { break; }
    t = t * 1.13 + texel * 0.25;
  }

  // ---- sky AO: horizon elevation in 8 directions within ~300 m (same level, cheap)
  var ao = 0.0;
  let radius = max(300.0, texel * 24.0);
  for (var d = 0; d < 8; d++) {
    let a = (f32(d) + 0.5) * (TAU / 8.0) + 0.37;
    let dir = vec2f(cos(a), sin(a));
    var maxSin = 0.0;
    var s = texel * 1.2;
    for (var k = 0; k < 12; k++) {
      let q = p + dir * s;
      let dh = heightLevel(q, level) - h0;
      let sn = dh / sqrt(dh * dh + s * s);
      maxSin = max(maxSin, sn);
      s = s * 1.45;
      if (s > radius) { break; }
    }
    ao += 1.0 - maxSin * maxSin;
  }
  ao = ao / 8.0;

  // ---- cave: no direct sun under the roof; ambient fades with depth into the tube
  let raw = textureLoad(rawMask, c, level, 0);
  let cave = raw.a;
  let rc = p - P.cave.xy;
  let depthIn = max(-dot(rc, P.caveDir.xy), 0.0);
  vis *= 1.0 - smoothstep(0.2, 0.6, cave);
  ao *= mix(1.0, 0.35 * exp(-depthIn / 9.0) + 0.02, cave);

  textureStore(outLight, c, level, vec4f(vis, ao, cave, pathMask(p)));
}
