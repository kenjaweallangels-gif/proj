// Post-processing chain (Документ §5: AO and effects at reduced resolution, honest spatial upscale, UI at native
// resolution — the UI itself is HTML over the canvas). Entry points share this module; each pipeline uses an 'auto'
// layout so only the bindings it touches are part of its bind group. Requires common.wgsl.

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var srcTex: texture_2d<f32>;
@group(0) @binding(2) var srcSampler: sampler;
@group(0) @binding(3) var depthTex: texture_depth_2d;
@group(0) @binding(4) var aoTex: texture_2d<f32>;
@group(0) @binding(5) var bloomTex: texture_2d<f32>;
@group(0) @binding(6) var<uniform> pp: vec4f;   // per-pass parameters (texel size of the source, etc.)
@group(0) @binding(7) var<storage, read> expo: array<vec4f, 1>; // auto exposure state (shaders/exposure.wgsl)

struct FsIn {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> FsIn {
  let uv = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out: FsIn;
  out.pos = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(uv.x, 1.0 - uv.y);
  return out;
}

// ---------------------------------------------------------------- AO (half resolution, Alchemy-style)
const SKY_AO_DEPTH: f32 = 60000.0;

fn viewZFromDepth(d: f32) -> f32 {
  // Reversed-Z infinite projection: d = near / -z_view.
  return frame.camFwd.w / max(d, 1e-7);
}

fn viewPosAt(px: vec2i, fullSize: vec2f) -> vec3f {
  let d = textureLoad(depthTex, px, 0);
  let z = viewZFromDepth(d);
  let uv = (vec2f(px) + 0.5) / fullSize;
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return vec3f(ndc.x * z / frame.proj[0][0], ndc.y * z / frame.proj[1][1], -z);
}

@fragment
fn fsAo(in: FsIn) -> @location(0) vec4f {
  let fullSize = frame.viewport.xy;
  let px = vec2i(in.pos.xy) * 2;
  let d = textureLoad(depthTex, px, 0);
  // Sky: "no occlusion" at a depth that is still finite in rg16float (max 65504); 1e6 would become Inf/NaN.
  if (d <= 0.0) { return vec4f(1.0, SKY_AO_DEPTH, 0.0, 0.0); }
  let P = viewPosAt(px, fullSize);
  let maxPx = vec2i(fullSize) - 1;
  // Normal from the smaller of the forward/backward depth differences (stable at silhouettes).
  let pr = viewPosAt(min(px + vec2i(1, 0), maxPx), fullSize);
  let pl = viewPosAt(max(px - vec2i(1, 0), vec2i(0)), fullSize);
  let pu = viewPosAt(max(px - vec2i(0, 1), vec2i(0)), fullSize);
  let pd = viewPosAt(min(px + vec2i(0, 1), maxPx), fullSize);
  let dx = select(P - pl, pr - P, abs(pr.z - P.z) < abs(P.z - pl.z));
  let dy = select(P - pu, pd - P, abs(pd.z - P.z) < abs(P.z - pu.z));
  let N = normalize(cross(dy, dx));
  let radius = 1.1;
  let projScale = 0.5 * fullSize.y * frame.proj[1][1];
  let screenR = clamp(radius * projScale / max(-P.z, 0.1), 3.0, 90.0);
  let noise = rand2(vec2i(in.pos.xy), frame.counts.z % 8u);
  var sum = 0.0;
  let count = 10;
  for (var i = 0; i < count; i++) {
    let a = (f32(i) + noise) * 2.39996 + noise * TAU;
    let r = screenR * sqrt((f32(i) + 0.5) / f32(count));
    let off = vec2f(cos(a), sin(a)) * r;
    let sp = clamp(vec2i(vec2f(px) + off), vec2i(0), maxPx);
    let S = viewPosAt(sp, fullSize);
    let v = S - P;
    let vv = dot(v, v);
    let falloff = 1.0 - smoothstep(radius * radius * 0.5, radius * radius * 1.6, vv);
    sum += max(dot(v, N) - 0.02 * -P.z * 0.02, 0.0) / (vv + 0.02) * falloff;
  }
  let ao = clamp(1.0 - 1.6 * sum / f32(count), 0.0, 1.0);
  return vec4f(ao, -P.z, 0.0, 0.0);
}

// ---------------------------------------------------------------- bloom
// Downsample with the 13-tap filter (Jimenez 2014); the first level uses a Karis average against fireflies.
fn karis(c: vec3f) -> f32 {
  return 1.0 / (1.0 + luminance(c) * 0.25);
}

@fragment
fn fsBloomDown(in: FsIn) -> @location(0) vec4f {
  let t = pp.xy;
  let uv = in.uv;
  let a = textureSampleLevel(srcTex, srcSampler, uv + t * vec2f(-2.0, -2.0), 0.0).rgb;
  let b = textureSampleLevel(srcTex, srcSampler, uv + t * vec2f(0.0, -2.0), 0.0).rgb;
  let c = textureSampleLevel(srcTex, srcSampler, uv + t * vec2f(2.0, -2.0), 0.0).rgb;
  let d = textureSampleLevel(srcTex, srcSampler, uv + t * vec2f(-2.0, 0.0), 0.0).rgb;
  let e = textureSampleLevel(srcTex, srcSampler, uv, 0.0).rgb;
  let f = textureSampleLevel(srcTex, srcSampler, uv + t * vec2f(2.0, 0.0), 0.0).rgb;
  let g = textureSampleLevel(srcTex, srcSampler, uv + t * vec2f(-2.0, 2.0), 0.0).rgb;
  let h = textureSampleLevel(srcTex, srcSampler, uv + t * vec2f(0.0, 2.0), 0.0).rgb;
  let i = textureSampleLevel(srcTex, srcSampler, uv + t * vec2f(2.0, 2.0), 0.0).rgb;
  let j = textureSampleLevel(srcTex, srcSampler, uv + t * vec2f(-1.0, -1.0), 0.0).rgb;
  let k = textureSampleLevel(srcTex, srcSampler, uv + t * vec2f(1.0, -1.0), 0.0).rgb;
  let l = textureSampleLevel(srcTex, srcSampler, uv + t * vec2f(-1.0, 1.0), 0.0).rgb;
  let m = textureSampleLevel(srcTex, srcSampler, uv + t * vec2f(1.0, 1.0), 0.0).rgb;
  var col: vec3f;
  if (pp.z > 0.5) {
    let g0 = (a + b + d + e) * 0.25;
    let g1 = (b + c + e + f) * 0.25;
    let g2 = (d + e + g + h) * 0.25;
    let g3 = (e + f + h + i) * 0.25;
    let g4 = (j + k + l + m) * 0.25;
    let w0 = karis(g0); let w1 = karis(g1); let w2 = karis(g2); let w3 = karis(g3); let w4 = karis(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5)
      / (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  return vec4f(sanitize(col), 1.0);
}

// Upsample with a 3x3 tent; blended additively onto the next larger level.
@fragment
fn fsBloomUp(in: FsIn) -> @location(0) vec4f {
  let t = pp.xy * pp.z;
  let uv = in.uv;
  var c = textureSampleLevel(srcTex, srcSampler, uv, 0.0).rgb * 4.0;
  c += (textureSampleLevel(srcTex, srcSampler, uv + vec2f(-t.x, 0.0), 0.0).rgb
      + textureSampleLevel(srcTex, srcSampler, uv + vec2f(t.x, 0.0), 0.0).rgb
      + textureSampleLevel(srcTex, srcSampler, uv + vec2f(0.0, -t.y), 0.0).rgb
      + textureSampleLevel(srcTex, srcSampler, uv + vec2f(0.0, t.y), 0.0).rgb) * 2.0;
  c += textureSampleLevel(srcTex, srcSampler, uv + vec2f(-t.x, -t.y), 0.0).rgb
     + textureSampleLevel(srcTex, srcSampler, uv + vec2f(t.x, -t.y), 0.0).rgb
     + textureSampleLevel(srcTex, srcSampler, uv + vec2f(-t.x, t.y), 0.0).rgb
     + textureSampleLevel(srcTex, srcSampler, uv + vec2f(t.x, t.y), 0.0).rgb;
  return vec4f(c / 16.0 * pp.w, 1.0);
}

// ---------------------------------------------------------------- tonemap / composite
// AgX (Troy Sobotka) base transform, polynomial fit of the default contrast curve.
fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

fn agx(c: vec3f) -> vec3f {
  let inMat = mat3x3f(
    vec3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
    vec3f(0.0784335999999992, 0.878468636469772, 0.0784336),
    vec3f(0.0792237451477643, 0.0791661274605434, 0.879142973793104));
  let outMat = mat3x3f(
    vec3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438),
    vec3f(-0.0980208811401368, 1.15190312990417, -0.0980434501171241),
    vec3f(-0.0990297440797205, -0.0989611768448433, 1.15107367264116));
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var v = inMat * max(c, vec3f(1e-10));
  v = clamp(log2(v), vec3f(minEv), vec3f(maxEv));
  v = (v - minEv) / (maxEv - minEv);
  v = agxContrast(v);
  // Look: a little extra contrast and saturation ("punchy"), tuned for the Mars palette.
  let lum = luminance(v);
  v = pow(max(v, vec3f(0.0)), vec3f(1.12));
  v = vec3f(lum) + (v - vec3f(lum)) * 1.18;
  v = outMat * v;
  return clamp(v, vec3f(0.0), vec3f(1.0)); // display-encoded (~ sRGB)
}

// ACES filmic (Stephen Hill's RRT+ODT fit, sRGB output primaries); returns linear display values.
fn acesFitted(c: vec3f) -> vec3f {
  let inRows = mat3x3f(vec3f(0.59719, 0.35458, 0.04823), vec3f(0.07600, 0.90834, 0.01566), vec3f(0.02840, 0.13383, 0.83777));
  let outRows = mat3x3f(vec3f(1.60475, -0.53108, -0.07367), vec3f(-0.10208, 1.10813, -0.00605), vec3f(-0.00327, -0.07276, 1.07602));
  var v = c * inRows;   // row vector x matrix == HLSL mul(M, v) with M given by rows
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  v = a / b;
  return clamp(v * outRows, vec3f(0.0), vec3f(1.0));
}

// Depth-aware upsample of the half-resolution AO.
fn aoUpsample(px: vec2i, viewZ: f32) -> f32 {
  let halfSize = vec2i(textureDimensions(aoTex));
  let base = clamp(px / 2, vec2i(0), halfSize - 1);
  var sum = 0.0;
  var wsum = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = clamp(base + vec2i(x, y), vec2i(0), halfSize - 1);
      let s = textureLoad(aoTex, c, 0).rg;
      // Sky texels and non-finite values never contribute.
      if (!(s.g < SKY_AO_DEPTH * 0.99) || s.r != s.r) { continue; }
      let w = 1.0 / (abs(s.g - viewZ) / max(viewZ, 1.0) * 40.0 + 0.05) * select(1.0, 2.0, x == 0 && y == 0);
      sum += s.r * w;
      wsum += w;
    }
  }
  if (wsum <= 1e-5) { return 1.0; }
  return clamp(sum / wsum, 0.0, 1.0);
}

@fragment
fn fsTonemap(in: FsIn) -> @location(0) vec4f {
  let px = vec2i(in.pos.xy);
  let hdr = textureLoad(srcTex, px, 0);
  var col = hdr.rgb;
  if ((frame.counts.w & 1u) != 0u) {
    let d = textureLoad(depthTex, px, 0);
    if (d > 0.0) {
      let ao = aoUpsample(px, viewZFromDepth(d));
      let k = mix(1.0, ao, frame.post.z);
      col = col * (1.0 - hdr.a * (1.0 - k));
    }
  }
  if (frame.post.y > 0.0) {
    let b = textureSampleLevel(bloomTex, srcSampler, in.uv, 0.0).rgb;
    col = mix(col, b, frame.post.y);
  }
  col *= frame.post.x * expo[0].x;
  var outc: vec3f;
  if ((frame.counts.w & 2u) != 0u) {
    outc = linearToSrgb(acesFitted(col * 1.6));
  } else {
    outc = agx(col);
  }
  // Subtle vignette.
  let q = in.uv - 0.5;
  outc *= 1.0 - dot(q, q) * 0.28;
  return vec4f(outc, luminance(outc));
}

// ---------------------------------------------------------------- FXAA (quality-lite, at internal resolution)
@fragment
fn fsFxaa(in: FsIn) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(srcTex));
  let rcp = 1.0 / size;
  let uv = in.uv;
  let rgbM = textureSampleLevel(srcTex, srcSampler, uv, 0.0);
  let lM = rgbM.a;
  let lN = textureSampleLevel(srcTex, srcSampler, uv + vec2f(0.0, -rcp.y), 0.0).a;
  let lS = textureSampleLevel(srcTex, srcSampler, uv + vec2f(0.0, rcp.y), 0.0).a;
  let lW = textureSampleLevel(srcTex, srcSampler, uv + vec2f(-rcp.x, 0.0), 0.0).a;
  let lE = textureSampleLevel(srcTex, srcSampler, uv + vec2f(rcp.x, 0.0), 0.0).a;
  let lMin = min(lM, min(min(lN, lS), min(lW, lE)));
  let lMax = max(lM, max(max(lN, lS), max(lW, lE)));
  let range = lMax - lMin;
  if (range < max(0.0312, lMax * 0.125)) { return rgbM; }
  let lNW = textureSampleLevel(srcTex, srcSampler, uv + vec2f(-rcp.x, -rcp.y), 0.0).a;
  let lNE = textureSampleLevel(srcTex, srcSampler, uv + vec2f(rcp.x, -rcp.y), 0.0).a;
  let lSW = textureSampleLevel(srcTex, srcSampler, uv + vec2f(-rcp.x, rcp.y), 0.0).a;
  let lSE = textureSampleLevel(srcTex, srcSampler, uv + vec2f(rcp.x, rcp.y), 0.0).a;
  let edgeH = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lW + lE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
  let edgeV = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lN + lS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
  let horizontal = edgeH >= edgeV;
  let l1 = select(lW, lN, horizontal);
  let l2 = select(lE, lS, horizontal);
  let g1 = abs(l1 - lM);
  let g2 = abs(l2 - lM);
  var stepLen = select(rcp.x, rcp.y, horizontal);
  var lLocal: f32;
  if (g1 >= g2) { stepLen = -stepLen; lLocal = 0.5 * (l1 + lM); } else { lLocal = 0.5 * (l2 + lM); }
  let grad = max(g1, g2) * 0.25;
  var cuv = uv;
  if (horizontal) { cuv.y += stepLen * 0.5; } else { cuv.x += stepLen * 0.5; }
  let dir = select(vec2f(0.0, rcp.y), vec2f(rcp.x, 0.0), horizontal);
  var uv1 = cuv - dir;
  var uv2 = cuv + dir;
  var e1 = textureSampleLevel(srcTex, srcSampler, uv1, 0.0).a - lLocal;
  var e2 = textureSampleLevel(srcTex, srcSampler, uv2, 0.0).a - lLocal;
  var done1 = abs(e1) >= grad;
  var done2 = abs(e2) >= grad;
  var steps = array<f32, 8>(1.0, 1.5, 2.0, 2.0, 2.0, 4.0, 8.0, 8.0);
  for (var i = 0; i < 8; i++) {
    if (done1 && done2) { break; }
    if (!done1) { uv1 -= dir * steps[i]; e1 = textureSampleLevel(srcTex, srcSampler, uv1, 0.0).a - lLocal; done1 = abs(e1) >= grad; }
    if (!done2) { uv2 += dir * steps[i]; e2 = textureSampleLevel(srcTex, srcSampler, uv2, 0.0).a - lLocal; done2 = abs(e2) >= grad; }
  }
  let d1 = select(uv.y - uv1.y, uv.x - uv1.x, horizontal);
  let d2 = select(uv2.y - uv.y, uv2.x - uv.x, horizontal);
  let dMin = min(d1, d2);
  let span = d1 + d2;
  let centreSmaller = lM < lLocal;
  let correct1 = (e1 < 0.0) != centreSmaller;
  let correct2 = (e2 < 0.0) != centreSmaller;
  let correct = select(correct2, correct1, d1 < d2);
  var offset = select(0.0, -dMin / span + 0.5, correct);
  // Sub-pixel aliasing.
  let lAvg = (2.0 * (lN + lS + lW + lE) + lNW + lNE + lSW + lSE) / 12.0;
  let sub = clamp(abs(lAvg - lM) / range, 0.0, 1.0);
  let subF = (-2.0 * sub + 3.0) * sub * sub;
  offset = max(offset, subF * subF * 0.6);
  var fuv = uv;
  if (horizontal) { fuv.y += offset * stepLen; } else { fuv.x += offset * stepLen; }
  let c = textureSampleLevel(srcTex, srcSampler, fuv, 0.0).rgb;
  return vec4f(c, luminance(c));
}

// ---------------------------------------------------------------- spatial upscale to the canvas
fn lanczos2(x: f32) -> f32 {
  let ax = abs(x);
  if (ax < 1e-4) { return 1.0; }
  if (ax >= 2.0) { return 0.0; }
  let px = PI * ax;
  return 2.0 * sin(px) * sin(px * 0.5) / (px * px);
}

@fragment
fn fsUpscale(in: FsIn) -> @location(0) vec4f {
  let srcSize = vec2f(textureDimensions(srcTex));
  let maxC = vec2i(srcSize) - 1;
  let sp = in.uv * srcSize - 0.5;
  let base = floor(sp);
  let f = sp - base;
  let bi = vec2i(base);
  var sum = vec3f(0.0);
  var wsum = 0.0;
  var lo = vec3f(1e9);
  var hi = vec3f(-1e9);
  for (var y = -1; y <= 2; y++) {
    let wy = lanczos2(f32(y) - f.y);
    for (var x = -1; x <= 2; x++) {
      let wx = lanczos2(f32(x) - f.x);
      let c = textureLoad(srcTex, clamp(bi + vec2i(x, y), vec2i(0), maxC), 0).rgb;
      let w = wx * wy;
      sum += c * w;
      wsum += w;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) { lo = min(lo, c); hi = max(hi, c); }
    }
  }
  // Anti-ringing: clamp to the range of the 2x2 neighbourhood (as in FSR1 EASU).
  var col = clamp(sum / max(wsum, 1e-4), lo, hi);
  // Ordered dither against 8-bit banding in the dusty gradients of the sky.
  let n = rand2(vec2i(in.pos.xy), 977u) + rand2(vec2i(in.pos.xy), 978u) - 1.0;
  col += vec3f(n / 255.0);
  return vec4f(col, 1.0);
}
