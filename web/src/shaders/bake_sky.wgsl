// Bake: sky-view LUT for the fixed sun (computed once per load) and its integrals: L2 SH of the sky radiance with
// ground bounce for directions below the horizon, sun colour at the ground. Requires common.wgsl + atmosphere.wgsl.

struct SkyParams {
  sunDir: vec4f,      // xyz toward sun, w = sun irradiance at the top of the atmosphere (scene units)
  ground: vec4f,      // rgb = mean ground albedo for the bounce term, w = LUT width
  lut: vec4f,         // x = LUT width, y = LUT height
}

@group(0) @binding(0) var<uniform> S: SkyParams;
@group(0) @binding(1) var outLut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var lutIn: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> atmoOut: Atmo;

@compute @workgroup_size(8, 8)
fn lutMain(@builtin(global_invocation_id) gid: vec3u) {
  let w = u32(S.lut.x);
  let h = u32(S.lut.y);
  if (gid.x >= w || gid.y >= h) { return; }
  let uv = (vec2f(gid.xy) + 0.5) / vec2f(f32(w), f32(h));
  let dir = skyLutDir(uv, S.sunDir.xyz);
  var L = integrateSky(SKY_LUT_ALT, dir, S.sunDir.xyz, S.sunDir.w);
  textureStore(outLut, vec2i(gid.xy), vec4f(L, 1.0));
}

var<workgroup> partial: array<array<vec3f, 10>, 64>;

fn shBasis(d: vec3f) -> array<f32, 9> {
  // Same axis mapping as lighting.wgsl shIrradiance: x = d.x, y = d.z, z = d.y (up).
  let x = d.x;
  let y = d.z;
  let z = d.y;
  return array<f32, 9>(
    0.282095,
    0.488603 * y, 0.488603 * z, 0.488603 * x,
    1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3.0 * z * z - 1.0), 1.092548 * x * z, 0.546274 * (x * x - y * y));
}

@compute @workgroup_size(64)
fn integrateMain(@builtin(local_invocation_index) li: u32) {
  let w = i32(S.lut.x);
  let h = i32(S.lut.y);
  let sunDir = S.sunDir.xyz;
  let sunGround = S.sunDir.w * transmittanceToTop(SKY_LUT_ALT, sunDir.y);

  // Phase 1: sky irradiance on a horizontal plane (for the ground bounce) and mean horizon radiance.
  var eSky = vec3f(0.0);
  var horizon = vec3f(0.0);
  var horizonCount = 0.0;
  for (var j = i32(li); j < w * h; j += 64) {
    let tx = j % w;
    let ty = j / w;
    let uv = (vec2f(f32(tx), f32(ty)) + 0.5) / vec2f(f32(w), f32(h));
    let vv = uv.y * 2.0 - 1.0;
    let elev = sign(vv) * vv * vv * 0.5 * PI;
    if (elev <= 0.0) { continue; }
    let dOmega = 2.0 * (PI / f32(w)) * (2.0 * PI * abs(vv) / f32(h)) * cos(elev);
    let L = textureLoad(lutIn, vec2i(tx, ty), 0).rgb;
    eSky += L * sin(elev) * dOmega;
    if (elev < 0.08) { horizon += L; horizonCount += 1.0; }
  }
  partial[li][0] = eSky;
  partial[li][1] = horizon;
  partial[li][2] = vec3f(horizonCount, 0.0, 0.0);
  workgroupBarrier();
  if (li == 0u) {
    var e = vec3f(0.0);
    var hz = vec3f(0.0);
    var hc = 0.0;
    for (var k = 0; k < 64; k++) { e += partial[k][0]; hz += partial[k][1]; hc += partial[k][2].x; }
    partial[0][3] = e;
    partial[0][4] = hz / max(hc, 1.0); // mean radiance of the band just above the horizon
  }
  workgroupBarrier();
  let eGround = partial[0][3] + sunGround * max(sunDir.y, 0.0);
  let groundL = S.ground.rgb * eGround / PI;
  let horizonL = partial[0][4];
  workgroupBarrier();

  // Phase 2: project radiance (sky above, ground bounce below) onto L2 SH; each LUT texel covers two mirrored azimuths.
  var acc: array<vec3f, 9>;
  for (var k = 0; k < 9; k++) { acc[k] = vec3f(0.0); }
  var avg = vec3f(0.0);
  for (var j = i32(li); j < w * h; j += 64) {
    let tx = j % w;
    let ty = j / w;
    let uv = (vec2f(f32(tx), f32(ty)) + 0.5) / vec2f(f32(w), f32(h));
    let vv = uv.y * 2.0 - 1.0;
    let elev = sign(vv) * vv * vv * 0.5 * PI;
    let dOmega = (PI / f32(w)) * (2.0 * PI * abs(vv) / f32(h)) * cos(elev);
    var L = textureLoad(lutIn, vec2i(tx, ty), 0).rgb;
    if (elev < 0.0) { L = mix(L, groundL, smoothstep(0.0, -0.06, elev)); } else { avg += L * dOmega; }
    let d1 = skyLutDir(uv, sunDir);
    // Mirror across the sun's vertical plane.
    let uvm = vec2f(-uv.x, uv.y);
    let d2 = skyLutDir(uvm, sunDir);
    let b1 = shBasis(d1);
    let b2 = shBasis(d2);
    for (var k = 0; k < 9; k++) { acc[k] += L * (b1[k] + b2[k]) * dOmega; }
  }
  for (var k = 0; k < 9; k++) { partial[li][k] = acc[k]; }
  partial[li][9] = avg;
  workgroupBarrier();
  if (li == 0u) {
    for (var k = 0; k < 10; k++) {
      var s = vec3f(0.0);
      for (var m = 0; m < 64; m++) { s += partial[m][k]; }
      if (k < 9) { atmoOut.sh[k] = vec4f(s, 0.0); } else { atmoOut.skyAvg = vec4f(s / (2.0 * PI), 0.0); }
    }
    atmoOut.sunColor = vec4f(sunGround, 0.0);
    atmoOut.horizon = vec4f(horizonL, 0.0);
  }
}
