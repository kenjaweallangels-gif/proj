// Height lookups across the baked levels for bake passes that read the finished heightfield (`heights` binding).
// Requires common.wgsl + bake_common.wgsl.

fn heightLevel(xz: vec2f, level: i32) -> f32 {
  let res = i32(P.levels.w);
  let half = P.levels[level];
  let tc = (xz - P.center.xy + vec2f(half)) / (2.0 * half) * P.levels.w - 0.5;
  let fl = floor(tc);
  let f = tc - fl;
  let i = vec2i(fl);
  let hi = vec2i(res - 1);
  let h00 = textureLoad(heights, clamp(i, vec2i(0), hi), level, 0).r;
  let h10 = textureLoad(heights, clamp(i + vec2i(1, 0), vec2i(0), hi), level, 0).r;
  let h01 = textureLoad(heights, clamp(i + vec2i(0, 1), vec2i(0), hi), level, 0).r;
  let h11 = textureLoad(heights, clamp(i + vec2i(1, 1), vec2i(0), hi), level, 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}

// Finest level containing the point (finer data is always more accurate).
fn heightBest(xz: vec2f) -> f32 {
  let m = max(abs(xz.x - P.center.x), abs(xz.y - P.center.y));
  var level = 0;
  if (m < P.levels.z * 0.98) { level = 2; } else if (m < P.levels.y * 0.98) { level = 1; }
  return heightLevel(xz, level);
}
