// Bake pass 2: normals, cavity and final material masks for one level. Requires common.wgsl + bake_common.wgsl.

@group(0) @binding(0) var<uniform> P: BakeParams;
@group(0) @binding(2) var heights: texture_2d_array<f32>;
@group(0) @binding(3) var rawMask: texture_2d_array<f32>;
@group(0) @binding(4) var outNormal: texture_storage_2d_array<rgba8snorm, write>;
@group(0) @binding(5) var outMat: texture_storage_2d_array<rgba8unorm, write>;

fn hAt(c: vec2i, level: i32) -> f32 {
  let res = i32(P.levels.w);
  return textureLoad(heights, clamp(c, vec2i(0), vec2i(res - 1)), level, 0).r;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = u32(P.levels.w);
  if (gid.x >= res || gid.y >= res) { return; }
  let level = i32(P.info.y);
  let c = vec2i(gid.xy);
  let texel = levelTexel(level);
  let h = hAt(c, level);
  let hl = hAt(c - vec2i(1, 0), level);
  let hr = hAt(c + vec2i(1, 0), level);
  let hd = hAt(c - vec2i(0, 1), level);
  let hu = hAt(c + vec2i(0, 1), level);
  let n = normalize(vec3f(hl - hr, 2.0 * texel, hd - hu));
  // Cavity: positive in hollows, negative on convex edges; scale-normalised by texel size.
  let lap = (hl + hr + hd + hu - 4.0 * h) / max(texel, 0.5);
  // Wider-radius curvature for dust accumulation in hollows.
  let lap2 = (hAt(c - vec2i(4, 0), level) + hAt(c + vec2i(4, 0), level) + hAt(c - vec2i(0, 4), level) + hAt(c + vec2i(0, 4), level) - 4.0 * h) / max(texel * 4.0, 0.5);
  let cavity = clamp(lap * 0.6 + lap2 * 0.4, -1.0, 1.0);

  let raw = textureLoad(rawMask, c, level, 0);
  let slope = 1.0 - n.y;
  let rock = smoothstep(0.22, 0.42, slope);
  let p = levelWorld(level, c);
  let noise = fbm(p / 37.0, 3, P.info.x + 400u);
  // Dust settles on flats and in hollows, is blown off steep faces and convex ridges.
  var dust = (1.0 - smoothstep(0.06, 0.24, slope + noise * 0.05)) * (0.6 + 0.4 * smoothstep(-0.3, 0.5, cavity * 1.5 + noise * 0.7));
  dust *= 1.0 - raw.g * 0.6;
  dust *= 1.0 - raw.b * 0.5;
  let sediment = max(raw.r * (0.4 + 0.6 * rock), raw.b * 0.8);
  textureStore(outNormal, c, level, vec4f(n, cavity));
  textureStore(outMat, c, level, vec4f(saturate(dust), saturate(raw.g), saturate(sediment), rock));
}
