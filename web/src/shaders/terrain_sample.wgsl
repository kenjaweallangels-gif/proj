// Sampling of the baked terrain levels. Three square levels share one centre (the colony pad) and halve in extent:
// level 0 covers the whole 12 km map, level 2 the neighbourhood of the colony. Every level stores the same terrain
// function band-limited to its own resolution, so blending between levels near a level border is seamless.
// Requires common.wgsl + bindings_main.wgsl.

struct LevelBlend {
  fine: i32,     // finest level that contains the point
  w: f32,        // weight of `fine` (1 - w goes to fine - 1)
}

fn terrainLevelBlend(xz: vec2f) -> LevelBlend {
  let m = max(abs(xz.x - frame.terrainInfo.x), abs(xz.y - frame.terrainInfo.y));
  var lb: LevelBlend;
  lb.fine = 0;
  lb.w = 1.0;
  for (var i = 2; i >= 1; i--) {
    let half = frame.terrainLevels[i];
    if (m < half * 0.97) {
      lb.fine = i;
      lb.w = 1.0 - smoothstep(half * 0.84, half * 0.97, m);
      break;
    }
  }
  return lb;
}

fn terrainUv(xz: vec2f, level: i32) -> vec2f {
  let half = frame.terrainLevels[level];
  return (xz - frame.terrainInfo.xy + vec2f(half)) / (2.0 * half);
}

fn terrainHeightLevel(xz: vec2f, level: i32) -> f32 {
  let res = i32(frame.terrainLevels.w);
  let tc = terrainUv(xz, level) * f32(res) - 0.5;
  let fl = floor(tc);
  let f = tc - fl;
  let i = vec2i(fl);
  let hi = vec2i(res - 1);
  let h00 = textureLoad(terrainHeight, clamp(i, vec2i(0), hi), level, 0).r;
  let h10 = textureLoad(terrainHeight, clamp(i + vec2i(1, 0), vec2i(0), hi), level, 0).r;
  let h01 = textureLoad(terrainHeight, clamp(i + vec2i(0, 1), vec2i(0), hi), level, 0).r;
  let h11 = textureLoad(terrainHeight, clamp(i + vec2i(1, 1), vec2i(0), hi), level, 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

fn terrainHeightAt(xz: vec2f) -> f32 {
  let lb = terrainLevelBlend(xz);
  var h = terrainHeightLevel(xz, lb.fine);
  if (lb.w < 1.0 && lb.fine > 0) {
    h = mix(terrainHeightLevel(xz, lb.fine - 1), h, lb.w);
  }
  return h;
}

struct TerrainSurface {
  normal: vec3f,
  cavity: f32,
  sunVis: f32,
  ao: f32,
  cave: f32,
  path: f32,
  mat: vec4f,
}

fn sampleSurfaceLevel(xz: vec2f, level: i32) -> TerrainSurface {
  let uv = terrainUv(xz, level);
  let n = textureSampleLevel(terrainNormal, linearClamp, uv, level, 0.0);
  let l = textureSampleLevel(terrainLight, linearClamp, uv, level, 0.0);
  var s: TerrainSurface;
  s.normal = n.xyz;
  s.cavity = n.w;
  s.sunVis = l.r;
  s.ao = l.g;
  s.cave = l.b;
  s.path = l.a;
  s.mat = textureSampleLevel(terrainMat, linearClamp, uv, level, 0.0);
  return s;
}

fn terrainSurfaceAt(xz: vec2f) -> TerrainSurface {
  let lb = terrainLevelBlend(xz);
  var s = sampleSurfaceLevel(xz, lb.fine);
  if (lb.w < 1.0 && lb.fine > 0) {
    let c = sampleSurfaceLevel(xz, lb.fine - 1);
    s.normal = mix(c.normal, s.normal, lb.w);
    s.cavity = mix(c.cavity, s.cavity, lb.w);
    s.sunVis = mix(c.sunVis, s.sunVis, lb.w);
    s.ao = mix(c.ao, s.ao, lb.w);
    s.cave = mix(c.cave, s.cave, lb.w);
    s.path = mix(c.path, s.path, lb.w);
    s.mat = mix(c.mat, s.mat, lb.w);
  }
  s.normal = normalize(s.normal);
  return s;
}

// Baked terrain sun visibility + sky AO at a world point (used by objects standing on the terrain).
fn terrainBakedLight(xz: vec2f) -> vec2f {
  let lb = terrainLevelBlend(xz);
  var l = textureSampleLevel(terrainLight, linearClamp, terrainUv(xz, lb.fine), lb.fine, 0.0).rg;
  if (lb.w < 1.0 && lb.fine > 0) {
    let c = textureSampleLevel(terrainLight, linearClamp, terrainUv(xz, lb.fine - 1), lb.fine - 1, 0.0).rg;
    l = mix(c, l, lb.w);
  }
  return l;
}
