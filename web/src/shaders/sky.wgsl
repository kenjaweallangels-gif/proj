// Sky: sky-view LUT (Mars dust single + approximated multiple scattering), sun disc with limb darkening and a faint
// high water-ice cloud layer. Drawn as a full-screen triangle at the far plane (reversed-Z: depth 0) in the
// atmosphere/transparency pass. Requires common, bindings_main, atmosphere, scene_atmo.

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) ndc: vec2f,
}

@vertex
fn vsMain(@builtin(vertex_index) vi: u32) -> VSOut {
  let uv = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out: VSOut;
  out.ndc = uv * 2.0 - 1.0;
  out.clip = vec4f(out.ndc, 0.0, 1.0);
  return out;
}

fn viewDir(ndc: vec2f) -> vec3f {
  let w = frame.invViewProj * vec4f(ndc, 1.0, 1.0);
  return normalize(w.xyz / w.w - frame.camPos.xyz);
}

@fragment
fn fsMain(in: VSOut) -> @location(0) vec4f {
  let dir = viewDir(in.ndc);
  var col = skyRadiance(dir);
  let sun = frame.sunDir.xyz;
  let c = dot(dir, sun);

  // Thin, high water-ice clouds (Mars afternoon cirrus): very faint, lit with the forward lobe.
  if (dir.y > 0.01) {
    let t = 6000.0 / dir.y;
    let q = dir.xz * t / 9000.0 + vec2f(frame.camPos.w * 0.0015, 0.0);
    let streak = fbm(q * vec2f(1.0, 3.2), 5, 911u);
    let cloud = smoothstep(0.1, 0.55, streak) * smoothstep(0.01, 0.14, dir.y) * 0.5;
    let lit = 0.6 + 2.2 * pow(max(c, 0.0), 6.0);
    // Water-ice cirrus: slightly bluish-white, forward-scattering near the sun.
    col = mix(col, col * (1.0 + lit * 0.5) * vec3f(0.96, 1.0, 1.08) + atmo.sunColor.rgb * 0.005 * lit, cloud);
  }

  // Sun disc (angular radius from frame.sunDir.w) with limb darkening; bloom spreads the glare.
  let cosR = frame.sunDir.w;
  if (c > cosR - 0.0004) {
    let r = sqrt(max(1.0 - c * c, 0.0)) / sqrt(max(1.0 - cosR * cosR, 1e-8));
    let limb = 1.0 - 0.6 * (1.0 - sqrt(max(1.0 - min(r, 1.0) * min(r, 1.0), 0.0)));
    let edge = 1.0 - smoothstep(0.9, 1.05, r);
    let solidAngle = 2.0 * PI * (1.0 - cosR);
    col += atmo.sunColor.rgb / solidAngle * limb * edge * 0.6;
  }
  // Below the horizon (only visible past the far terrain fade) blend to the haze colour.
  if (dir.y < 0.0) {
    col = mix(col, hazeColor(dir), smoothstep(0.0, -0.05, dir.y));
  }
  return vec4f(sanitize(col), 0.0);
}
