// Distance-based mask of rover tracks / footpaths (needs the `paths` binding). Requires bake_common.wgsl.

fn pathMask(p: vec2f) -> f32 {
  var m = 0.0;
  for (var i = 0u; i < P.info.z; i++) {
    let s = paths[i];
    let a = s.ab.xy;
    let b = s.ab.zw;
    let ab = b - a;
    let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    let d = length(p - (a + ab * t));
    m = max(m, 1.0 - smoothstep(s.w.x * 0.6, s.w.x + 0.8, d));
  }
  return m;
}
