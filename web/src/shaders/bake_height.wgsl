// Bake pass 1: procedural heightfield + raw geology masks for one level.
// Landforms (d0_layout.json terrain): a wide valley along valley_axis_deg with layered, terraced walls cut by spurs
// and side canyons; a high plateau with cap-rock mesas; isolated buttes on the valley floor; ridged mountains far
// across the valley; an impact crater with rim, slumped terraces, central peak and ejecta; a flattened colony pad with
// smooth falloff; a dark basalt lava bench whose cliff holds the lava-tube cave mouth.
// Every noise octave is faded out below the level's Nyquist wavelength, so coarse levels are band-limited copies of
// the fine ones (seamless level blending at runtime). Requires common.wgsl + bake_common.wgsl.

@group(0) @binding(0) var<uniform> P: BakeParams;
@group(0) @binding(2) var outHeight: texture_storage_2d_array<r32float, write>;
@group(0) @binding(3) var outMask: texture_storage_2d_array<rgba8unorm, write>;

// Octave weight: 1 for wavelengths well above the texel size, 0 below ~2 texels.
fn bandWeight(wavelength: f32, texel: f32) -> f32 {
  return smoothstep(2.0 * texel, 4.5 * texel, wavelength);
}

fn fbmBL(p: vec2f, wavelength: f32, octaves: i32, seed: u32, texel: f32) -> f32 {
  var a = 0.0;
  var amp = 0.5;
  var wl = wavelength;
  var q = p / wavelength;
  for (var i = 0; i < octaves; i++) {
    let bw = bandWeight(wl, texel);
    if (bw <= 0.0) { break; }
    a += amp * bw * gnoise(q, seed + u32(i) * 131u).x;
    amp *= 0.5;
    wl *= 0.5;
    q = ROT2 * q * 2.0;
  }
  return a;
}

// Derivative-damped fBm ("erosion-like": smooth valleys, sharp ridges).
fn erosionFbm(p: vec2f, wavelength: f32, octaves: i32, seed: u32, texel: f32) -> f32 {
  var a = 0.0;
  var amp = 0.5;
  var wl = wavelength;
  var q = p / wavelength;
  var d = vec2f(0.0);
  var m = mat2x2f(vec2f(1.0, 0.0), vec2f(0.0, 1.0));
  for (var i = 0; i < octaves; i++) {
    let bw = bandWeight(wl, texel);
    if (bw <= 0.0) { break; }
    let n = gnoise(q, seed + u32(i) * 71u);
    d += m * n.yz;
    a += amp * bw * n.x / (1.0 + dot(d, d) * 0.6);
    amp *= 0.5;
    wl *= 0.5;
    q = ROT2 * q * 2.0;
    m = ROT2 * m * 2.0;
  }
  return a;
}

fn ridgedBL(p: vec2f, wavelength: f32, octaves: i32, seed: u32, texel: f32) -> f32 {
  var a = 0.0;
  var amp = 0.55;
  var wl = wavelength;
  var q = p / wavelength;
  var prev = 1.0;
  var norm = 0.0;
  for (var i = 0; i < octaves; i++) {
    let bw = bandWeight(wl, texel);
    let n = 1.0 - abs(gnoise(q, seed + u32(i) * 53u).x);
    let r = n * n * prev;
    prev = clamp(r * 1.6, 0.0, 1.0);
    a += amp * r * bw;
    norm += amp;
    amp *= 0.5;
    wl *= 0.5;
    q = ROT2 * q * 2.03;
  }
  return a / norm;
}

// Geological terraces: flat benches with steeper risers, mixed by `amount`.
fn terrace(h: f32, step: f32, amount: f32) -> f32 {
  let t = h / step;
  let fl = floor(t);
  let f = t - fl;
  let stepped = (fl + smoothstep(0.42, 0.9, f)) * step;
  return mix(h, stepped, amount);
}

struct Field {
  h: f32,
  sediment: f32,  // light-toned layered deposits (wall strata, crater ejecta)
  basalt: f32,    // dark volcanic rock (lava bench, mesa caps, crater peak)
  bright: f32,    // light-toned bedrock patches on the floor
  cave: f32,      // inside the lava-tube footprint (roofed by the cave mesh)
}

fn terrainField(p: vec2f, texel: f32) -> Field {
  let seed = P.info.x;
  let hs = P.valley.w;
  let axis = P.valley.xy;
  let across = vec2f(axis.y, -axis.x);
  let rel = p - P.center.xy;
  let along = dot(rel, axis);
  let u = dot(rel, across);
  var out: Field;
  out.sediment = 0.0;
  out.basalt = 0.0;
  out.bright = 0.0;
  out.cave = 0.0;

  // ---- large-scale domain warp
  let warp = vec2f(fbmBL(p, 2600.0, 4, seed + 1u, texel), fbmBL(p + vec2f(5211.0, 1307.0), 2600.0, 4, seed + 2u, texel));
  let pw = p + warp * 420.0;

  // ---- valley geometry: meander and width vary along the axis, straight near the colony
  let meander = fbmBL(vec2f(along, 31.0), 3200.0, 3, seed + 3u, texel) * 520.0 * smoothstep(500.0, 2500.0, abs(along));
  let halfW = P.valley.z * 0.5 * (1.0 + 0.2 * fbmBL(vec2f(along, 977.0), 2400.0, 3, seed + 4u, texel));
  let du = abs(u - meander);

  // ---- walls: spurs and side canyons perturb the wall line, a high-frequency part roughens it
  let spur = fbmBL(pw, 760.0, 6, seed + 5u, texel);
  let canyon = ridgedBL(pw + vec2f(400.0, 0.0), 1500.0, 3, seed + 6u, texel);
  let wallX = (du - halfW * 0.60 + spur * 300.0 - canyon * 260.0) / (halfW * 0.62);
  let wall = smoothstep(0.0, 1.0, clamp(wallX, 0.0, 1.0));

  // ---- plateau: eroded high table with cap-rock mesas
  let plat = hs * (0.50 + 0.17 * erosionFbm(pw, 3600.0, 7, seed + 7u, texel));
  let mesaN = fbmBL(pw + vec2f(-900.0, 2100.0), 1500.0, 5, seed + 8u, texel);
  let mesa = smoothstep(0.10, 0.16, mesaN) * hs * 0.10 + smoothstep(0.24, 0.29, mesaN) * hs * 0.07;
  var h = (plat + mesa) * wall;
  out.basalt = max(out.basalt, smoothstep(0.1, 0.16, mesaN) * wall * 0.7);

  // ---- layered strata on the walls (terraces + light/dark bands)
  let layerH = hs * 0.032;
  let wallMid = smoothstep(0.03, 0.25, wall) * (1.0 - smoothstep(0.9, 1.0, wall));
  h = terrace(h, layerH, 0.7 * wallMid);
  out.sediment = wallMid * (0.55 + 0.45 * sin(h / layerH * TAU * 0.5 + spur * 3.0));

  // ---- valley floor: gentle along-axis slope, hummocks, transverse aeolian ridges, light-toned bedrock
  let floorW = 1.0 - wall;
  var floorH = along * 0.0045 + fbmBL(p, 420.0, 6, seed + 9u, texel) * 7.0;
  let rippleDir = normalize(vec2f(0.86, 0.51));
  let rp = dot(p, rippleDir) / 26.0 + fbmBL(p, 220.0, 3, seed + 10u, texel) * 4.0;
  let rippleMask = smoothstep(0.05, 0.35, fbmBL(p + vec2f(77.0, 13.0), 500.0, 3, seed + 11u, texel));
  let rippleWave = 1.0 - abs(sin(rp * PI));
  floorH += rippleWave * rippleWave * 0.8 * rippleMask * bandWeight(26.0, texel);
  floorH += fbmBL(p, 18.0, 4, seed + 12u, texel) * 0.3;
  let brightN = fbmBL(p + vec2f(-300.0, 500.0), 650.0, 4, seed + 13u, texel);
  out.bright = smoothstep(0.12, 0.3, brightN) * floorW;

  // ---- isolated buttes on the floor away from the colony (foreground interest along the valley)
  let butteN = fbmBL(pw + vec2f(1700.0, -400.0), 900.0, 5, seed + 14u, texel);
  let butteMask = smoothstep(0.24, 0.32, butteN) * smoothstep(1100.0, 1800.0, length(rel)) * floorW;
  let butte = terrace(butteMask * (90.0 + 60.0 * butteN), 18.0, 0.8);
  out.basalt = max(out.basalt, smoothstep(0.28, 0.34, butteN) * floorW * 0.6);
  out.sediment = max(out.sediment, butteMask * 0.6);

  h += floorH * floorW + butte;

  // ---- far mountains across the valley and an enclosing ring near the map border
  let ridge = ridgedBL(pw, 2600.0, 7, seed + 15u, texel);
  h += ridge * hs * 0.62 * smoothstep(2400.0, 4800.0, du);
  let edge = max(abs(rel.x), abs(rel.y));
  h += (0.55 + 0.45 * ridge) * hs * 0.45 * smoothstep(4700.0, 5900.0, edge);

  // ---- impact crater (rim, slumped terraces, flat sediment floor, central peak, ejecta blanket)
  let cr = length(p - P.crater.xy) / P.crater.z;
  if (cr < 2.6) {
    let R = P.crater.z;
    let rimH = 0.075 * R;
    let depth = 0.17 * R;
    let craterN = fbmBL(p, 300.0, 4, seed + 16u, texel);
    let r = cr * (1.0 + 0.05 * craterN);
    let inner = 1.0 - smoothstep(0.85, 1.12, r);
    // Inside: replace terrain with the bowl, keep a fraction of outer relief on the rim.
    let bowl = mix(-depth, rimH, pow(smoothstep(0.32, 1.0, r), 2.2));
    let peak = depth * 0.55 * exp(-pow(r / 0.13, 2.0)) * (0.8 + 0.4 * craterN);
    let slump = terrace(bowl + depth, depth * 0.11, 0.6 * smoothstep(0.55, 0.95, r)) - depth;
    let ejecta = rimH * exp(-(max(r, 1.0) - 1.0) * 3.2) * (1.0 + 0.3 * craterN);
    let base = plat * wall;
    let craterH = base * 0.35 + slump + peak;
    h = mix(h + ejecta * smoothstep(0.95, 1.05, r), craterH, inner);
    out.sediment = max(out.sediment, (1.0 - smoothstep(1.0, 2.2, r)) * 0.55 * (1.0 - inner * 0.6));
    out.basalt = max(out.basalt, exp(-pow(r / 0.16, 2.0)));
  }

  // ---- colony pad: flatten to y = 0 with smooth falloff; tiny relief only away from the modules
  let pd = length(rel);
  let flat = smoothstep(P.center.z, P.center.z + P.center.w, pd);
  let padRelief = fbmBL(p, 30.0, 4, seed + 17u, texel) * 0.35 * smoothstep(45.0, 130.0, pd);
  h = mix(padRelief, h, flat * flat * (3.0 - 2.0 * flat));

  // ---- lava bench with the cave cliff (data: terrain.cave_mouth). The cliff face passes exactly through the cave
  // mouth with the given facing; it wiggles further away from the cave.
  let f = P.caveDir.xy;
  let rc = p - P.cave.xy;
  let s = dot(rc, f);
  let t = dot(rc, vec2f(-f.y, f.x));
  // Smooth, low-frequency wiggle of the cliff line (no comb of spikes from afar).
  let wig = fbmBL(vec2f(t, 3.0), 230.0, 3, seed + 20u, texel) * 24.0 * smoothstep(26.0, 160.0, abs(t));
  let sb = s - wig;
  let lateral = 1.0 - smoothstep(170.0, 400.0, abs(t) + fbmBL(vec2f(t, 9.0), 300.0, 3, seed + 21u, texel) * 90.0);
  // The lava flow front is tallest at the cave and thins out along the face.
  let benchScale = mix(1.0, 0.3, smoothstep(50.0, 420.0, abs(t)));
  let benchTop = (P.caveDir.w + fbmBL(p, 140.0, 4, seed + 22u, texel) * 3.5 + smoothstep(-30.0, -400.0, sb) * 8.0) * benchScale;
  // Vertical cliff at the cave, a steep but climbable escarpment further along the face.
  let ramp = mix(6.0, 26.0, smoothstep(40.0, 260.0, abs(t)));
  let face = smoothstep(1.5, -ramp, sb);
  // Talus apron of fallen blocks at the foot of the cliff.
  let talus = exp(-max(sb, 0.0) / 11.0) * 4.5 * (1.0 - face) * smoothstep(-2.0, 3.0, sb);
  var bench = terrace(benchTop * face, 6.5, 0.35 * face) * lateral + talus * lateral;
  // Cave notch: the heightfield is cut down to the tube floor; the cave mesh supplies walls and roof.
  let notchHalf = P.cave.z * 0.5 + 1.5;
  let inCave = (1.0 - smoothstep(notchHalf - 0.5, notchHalf + 1.5, abs(t))) * (1.0 - smoothstep(44.0, 47.0, -sb)) * smoothstep(3.0, -1.0, sb);
  let tubeFloor = P.caveDir.z - max(-sb, 0.0) * 0.07 + fbmBL(p, 4.0, 3, seed + 23u, texel) * 0.25;
  out.cave = inCave * smoothstep(1.0, -2.0, sb);
  let benchH = bench + P.caveDir.z;
  out.basalt = max(out.basalt, smoothstep(0.5, 6.0, bench) * lateral);
  h = max(h, benchH);
  h = mix(h, tubeFloor, inCave);
  out.h = h;
  return out;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let res = u32(P.levels.w);
  if (gid.x >= res || gid.y >= res) { return; }
  let level = i32(P.info.y);
  let p = levelWorld(level, vec2i(gid.xy));
  let fld = terrainField(p, levelTexel(level));
  textureStore(outHeight, vec2i(gid.xy), level, vec4f(fld.h, 0.0, 0.0, 1.0));
  textureStore(outMask, vec2i(gid.xy), level, vec4f(saturate(fld.sediment), saturate(fld.basalt), saturate(fld.bright), saturate(fld.cave)));
}
