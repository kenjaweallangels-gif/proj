// Forward PBR lighting: GGX specular + Lambert diffuse, sun with cascaded shadow map x baked terrain visibility,
// sky ambient from L2 SH with baked AO, analytic environment specular from the sky LUT, a short list of local lights.
// Requires common.wgsl, bindings_main.wgsl, atmosphere.wgsl, scene_atmo.wgsl.

struct Surface {
  pos: vec3f,
  normal: vec3f,
  albedo: vec3f,
  roughness: f32,
  metallic: f32,
  emissive: vec3f,
  ao: f32,          // ambient occlusion (baked / analytic)
  sunVis: f32,      // baked sun visibility (terrain shadow), multiplied with the cascaded shadow map
  shadowBias: f32,  // extra normal offset in shadow texels
  sss: f32,         // cheap wrap/transmission for thin fabric and dust-covered edges
}

fn shIrradiance(n: vec3f) -> vec3f {
  // Cosine-convolved L2 SH (Ramamoorthi & Hanrahan); returns irradiance / PI (ambient radiance for Lambert).
  let c1 = 0.429043;
  let c2 = 0.511664;
  let c3 = 0.743125;
  let c4 = 0.886227;
  let c5 = 0.247708;
  let L00 = atmo.sh[0].rgb;
  let L1m1 = atmo.sh[1].rgb;
  let L10 = atmo.sh[2].rgb;
  let L11 = atmo.sh[3].rgb;
  let L2m2 = atmo.sh[4].rgb;
  let L2m1 = atmo.sh[5].rgb;
  let L20 = atmo.sh[6].rgb;
  let L21 = atmo.sh[7].rgb;
  let L22 = atmo.sh[8].rgb;
  // Basis order: y = up. (x, y, z) mapped as in bake_sky.wgsl.
  let x = n.x;
  let y = n.z;
  let z = n.y;
  let e = c1 * L22 * (x * x - y * y) + c3 * L20 * z * z + c4 * L00 - c5 * L20
    + 2.0 * c1 * (L2m2 * x * y + L21 * x * z + L2m1 * y * z)
    + 2.0 * c2 * (L11 * x + L1m1 * y + L10 * z);
  return max(e, vec3f(0.0)) / PI;
}

fn fresnelSchlick(f0: vec3f, vh: f32) -> vec3f {
  return f0 + (vec3f(1.0) - f0) * pow(1.0 - vh, 5.0);
}

fn ggxD(nh: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d + 1e-7);
}

fn smithG(nv: f32, nl: f32, a: f32) -> f32 {
  let k = a * 0.5;
  return (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k));
}

// Karis' analytic approximation of the split-sum environment BRDF.
fn envBrdfApprox(f0: vec3f, rough: f32, nv: f32) -> vec3f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = rough * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  let ab = vec2f(-1.04, 1.04) * a004 + r.zw;
  return f0 * ab.x + ab.y;
}

fn directBrdf(n: vec3f, v: vec3f, l: vec3f, albedo: vec3f, rough: f32, metal: f32) -> vec3f {
  let h = normalize(v + l);
  let nl = max(dot(n, l), 0.0);
  let nv = max(dot(n, v), 1e-3);
  let nh = max(dot(n, h), 0.0);
  let vh = max(dot(v, h), 0.0);
  let a = max(rough * rough, 0.002);
  let f0 = mix(vec3f(0.04), albedo, metal);
  let F = fresnelSchlick(f0, vh);
  let spec = ggxD(nh, a) * smithG(nv, nl, a) * F / (4.0 * nv * nl + 1e-4);
  let diff = (vec3f(1.0) - F) * (1.0 - metal) * albedo / PI;
  return (diff + spec) * nl;
}

// ---------------------------------------------------------------- cascaded shadow map
fn shadowCascadeSample(ci: i32, worldPos: vec3f, n: vec3f, extraBias: f32) -> f32 {
  let m = frame.shadowViewProj[ci];
  // World size of one shadow texel: the light-space x axis scale is 1 / radius (row 0 of the orthographic matrix).
  let texelWorld = 2.0 * frame.scene.w / max(length(vec3f(m[0][0], m[1][0], m[2][0])), 1e-6);
  let p = worldPos + n * texelWorld * (1.2 + extraBias);
  let c = m * vec4f(p, 1.0);
  let uv = vec2f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || c.z > 1.0) { return 1.0; }
  let refDepth = c.z - 0.0008;
  let ts = frame.scene.w;
  var sum = 0.0;
  // 3x3 bilinear-compare taps (~ 4x4 texel footprint), weighted toward the centre.
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let w = select(1.0, 2.0, x == 0 && y == 0);
      sum += w * textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2f(f32(x), f32(y)) * ts * 1.25, ci, refDepth);
    }
  }
  return sum / 10.0;
}

fn sunShadow(worldPos: vec3f, n: vec3f, extraBias: f32) -> f32 {
  let count = i32(frame.scene.z);
  if (count == 0) { return 1.0; }
  let viewDepth = dot(worldPos - frame.camPos.xyz, frame.camFwd.xyz);
  var ci = -1;
  for (var i = 0; i < count; i++) {
    if (viewDepth < frame.cascadeFar[i]) { ci = i; break; }
  }
  if (ci < 0) { return 1.0; }
  var s = shadowCascadeSample(ci, worldPos, n, extraBias);
  let far = frame.cascadeFar[ci];
  let near = select(0.0, frame.cascadeFar[max(ci - 1, 0)], ci > 0);
  let edge = smoothstep(far - (far - near) * 0.15, far, viewDepth);
  if (edge > 0.0) {
    var next = 1.0;
    if (ci + 1 < count) { next = shadowCascadeSample(ci + 1, worldPos, n, extraBias); }
    s = mix(s, next, edge);
  }
  return s;
}

// ---------------------------------------------------------------- local lights
fn localLights(s: Surface, v: vec3f) -> vec3f {
  var sum = vec3f(0.0);
  let count = min(frame.counts.x, MAX_LIGHTS);
  for (var i = 0u; i < count; i++) {
    let L = frame.lights[i];
    let toL = L.posRange.xyz - s.pos;
    let d2 = dot(toL, toL);
    let range = L.posRange.w;
    if (d2 > range * range) { continue; }
    let d = sqrt(d2);
    let l = toL / max(d, 1e-4);
    let x = d / range;
    let window = saturate((1.0 - x * x * x * x));
    var atten = window * window / (d2 + 0.3);
    if (L.color.w > 0.5) {
      let cd = dot(-l, normalize(L.dirCone.xyz));
      atten *= smoothstep(L.dirCone.w, L.params.x, cd);
    }
    if (atten <= 0.0) { continue; }
    var col = L.color.rgb;
    if (L.params.y > 0.0) {
      let t = frame.camPos.w * 17.0 + f32(i) * 13.1;
      let flick = 0.75 + 0.25 * sin(t) * sin(t * 2.31 + 1.0);
      col *= mix(1.0, flick, L.params.y);
    }
    var b = directBrdf(s.normal, v, l, s.albedo, s.roughness, s.metallic);
    b += s.albedo * s.sss * max(-dot(s.normal, l) * 0.5 + 0.25, 0.0) / PI;
    sum += b * col * atten;
  }
  return sum;
}

// Full surface shading; returns (radiance, ambient fraction) — the fraction lets half-res SSAO darken only ambient.
fn shadeSurface(s: Surface) -> vec4f {
  let v = normalize(frame.camPos.xyz - s.pos);
  let n = s.normal;
  let l = frame.sunDir.xyz;
  let nv = max(dot(n, v), 1e-3);
  // Sun
  var sunVis = s.sunVis;
  let dist = length(frame.camPos.xyz - s.pos);
  if (sunVis > 0.001 && dist < frame.terrainInfo.z * 1.2 && dot(n, l) > -0.2) {
    sunVis *= sunShadow(s.pos, n, s.shadowBias);
  }
  let sunCol = atmo.sunColor.rgb;
  var direct = directBrdf(n, v, l, s.albedo, s.roughness, s.metallic) * sunCol * sunVis;
  direct += s.albedo * s.sss * max(dot(-n, l) * 0.6 + 0.3, 0.0) * sunCol * sunVis / PI;
  // Ambient (sky SH + ground bounce baked into SH)
  let f0 = mix(vec3f(0.04), s.albedo, s.metallic);
  let diffAmb = shIrradiance(n) * s.albedo * (1.0 - s.metallic);
  let r = reflect(-v, n);
  let envDir = normalize(mix(r, n, s.roughness * s.roughness));
  let envSky = mix(skyRadianceRaw(normalize(vec3f(envDir.x, max(envDir.y, 0.02), envDir.z))), shIrradiance(envDir), s.roughness);
  // Reflections toward the ground see the (darker) ground.
  let groundFade = smoothstep(-0.25, 0.1, envDir.y);
  let env = mix(shIrradiance(vec3f(0.0, -1.0, 0.0)), envSky, groundFade);
  let specOcc = saturate(pow(nv + s.ao, exp2(-16.0 * s.roughness - 1.0)) - 1.0 + s.ao);
  let specAmb = env * envBrdfApprox(f0, s.roughness, nv) * specOcc;
  let ambient = (diffAmb * s.ao + specAmb);
  let lights = localLights(s, v);
  let total = direct + ambient + lights + s.emissive;
  let frac = saturate(luminance(ambient) / max(luminance(total), 1e-5));
  return vec4f(total, frac);
}
