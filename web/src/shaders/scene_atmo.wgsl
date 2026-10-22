// Runtime sky / aerial-perspective lookups for scene shaders. Requires common.wgsl, atmosphere.wgsl and the main
// bindings (frame, skyLut, linearClamp).
fn skyRadiance(dir: vec3f) -> vec3f {
  let uv = skyLutUv(dir, frame.sunDir.xyz);
  return textureSampleLevel(skyLut, linearClamp, uv, 0.0).rgb;
}

// Sky colour used as in-scatter for aerial perspective: elevation clamped slightly above the horizon.
fn hazeColor(dir: vec3f) -> vec3f {
  let d = normalize(vec3f(dir.x, max(dir.y, 0.015), dir.z));
  return skyRadiance(d);
}

// Optical depth from the camera to a point at distance d along dir: uniform dust + an exponential ground haze layer.
fn hazeOpticalDepth(camY: f32, dir: vec3f, d: f32) -> f32 {
  let base = frame.fog.x * d;
  let H = frame.fog.z;
  let k = dir.y * d / H;
  var layer: f32;
  if (abs(k) < 1e-3) {
    layer = d * exp(-camY / H);
  } else {
    layer = H / dir.y * exp(-camY / H) * (1.0 - exp(-k));
  }
  return base + frame.fog.y * max(layer, 0.0);
}

// Aerial perspective: attenuate surface radiance and add in-scattered sky light; fades fully into the sky at the
// profile view distance so the terrain cut-off is invisible.
fn applyAerial(color: vec3f, worldPos: vec3f) -> vec3f {
  let ray = worldPos - frame.camPos.xyz;
  let d = max(length(ray), 1e-3);
  let dir = ray / d;
  let T = exp(-hazeOpticalDepth(frame.camPos.y, dir, d));
  let haze = hazeColor(dir);
  var c = color * T + haze * (1.0 - T);
  let farFade = smoothstep(frame.fog.w * 0.72, frame.fog.w * 0.98, d);
  c = mix(c, haze, farFade);
  return c;
}
