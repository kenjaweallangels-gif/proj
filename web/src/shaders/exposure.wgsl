// Auto exposure without CPU readback: a single workgroup measures the centre-weighted log-average luminance of the HDR
// target on a 64x64 grid and adapts the exposure stored in a tiny storage buffer that the tonemap pass reads.
// Partial adaptation (exponent < 1) keeps dark places dark and bright places bright — the eye adapts, not fully.
// Requires common.wgsl.

struct ExposureParams {
  a: vec4f,  // x = dt (s), y = compensation (EV), z = adaptation rate (1/s), w = 1 to snap (camera cut)
  b: vec4f,  // x = min log2 exposure, y = max log2 exposure, z = log2 key, w = adaptation fraction 0..1
}

@group(0) @binding(0) var<uniform> E: ExposureParams;
@group(0) @binding(1) var hdr: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> state: array<vec4f, 1>; // x = exposure (linear), y = log2 avg luminance, z = log2 exposure

var<workgroup> sums: array<vec2f, 256>;

@compute @workgroup_size(16, 16)
fn main(@builtin(local_invocation_id) lid: vec3u, @builtin(local_invocation_index) li: u32) {
  let size = vec2f(textureDimensions(hdr));
  var s = 0.0;
  var wsum = 0.0;
  for (var j = 0u; j < 4u; j++) {
    for (var i = 0u; i < 4u; i++) {
      let uv = (vec2f(lid.xy * 4u + vec2u(i, j)) + 0.5) / 64.0;
      let c = textureLoad(hdr, vec2i(uv * size), 0).rgb;
      let l = clamp(luminance(sanitize(c)), 1e-4, 1e4);
      // Centre- and ground-weighted metering (landscape practice): the bright sky does not darken the scene.
      let q = (uv - vec2f(0.5, 0.6)) * vec2f(1.0, 1.4);
      let w = exp(-dot(q, q) * 3.0) * mix(0.55, 1.0, smoothstep(0.25, 0.55, uv.y));
      s += w * log2(l);
      wsum += w;
    }
  }
  sums[li] = vec2f(s, wsum);
  workgroupBarrier();
  for (var stride = 128u; stride > 0u; stride = stride >> 1u) {
    if (li < stride) { sums[li] = sums[li] + sums[li + stride]; }
    workgroupBarrier();
  }
  if (li == 0u) {
    let avg = sums[0].x / max(sums[0].y, 1e-6);
    let targetEv = clamp(E.b.z - E.b.w * avg + E.a.y, E.b.x, E.b.y);
    var cur = state[0].z;
    if (E.a.w > 0.5 || cur != cur || state[0].x <= 0.0) {
      cur = targetEv;
    } else {
      cur = mix(cur, targetEv, 1.0 - exp(-E.a.z * E.a.x));
    }
    state[0] = vec4f(exp2(cur), avg, cur, 0.0);
  }
}
