// Shared declarations for the terrain bake compute passes (run once per load, Документ §1/§4: static geology is
// prepared expensively in advance and shown cheaply at runtime). Requires common.wgsl.

struct BakeParams {
  levels: vec4f,      // half extents of bake levels 0..2 (m), w = resolution (texels)
  center: vec4f,      // xy = bake/flatten centre, z = flatten radius, w = flatten falloff
  valley: vec4f,      // xy = valley axis direction (x, z), z = valley width, w = height scale
  crater: vec4f,      // xy = crater centre, z = crater radius, w = unused
  cave: vec4f,        // xy = cave mouth (x, z), z = mouth width, w = mouth height
  caveDir: vec4f,     // xy = facing direction (x, z), z = floor height, w = bench (cliff) height
  sun: vec4f,         // xyz = direction toward the sun, w = tan(sun elevation)
  info: vec4u,        // x = seed, y = level being baked, z = path segment count, w = unused
}

struct PathSeg {
  ab: vec4f,          // a.xz, b.xz
  w: vec4f,           // x = half width (m), y = kind (0 track, 1 footpath), zw unused
}

fn levelTexel(level: i32) -> f32 {
  return 2.0 * P.levels[level] / P.levels.w;
}

fn levelWorld(level: i32, texel: vec2i) -> vec2f {
  let half = P.levels[level];
  return P.center.xy - vec2f(half) + (vec2f(texel) + 0.5) * levelTexel(level);
}
