// Per-frame GPU culling of rock instances (Документ §5: frustum culling and LOD before expensive passes).
// Writes visible index lists per LOD plus a shadow-caster list and the instance counts of the indirect draws.
// Requires common.wgsl + instances.wgsl.

struct CullParams {
  planes: array<vec4f, 6>,
  cam: vec4f,       // xyz camera position, w = LOD0 distance per metre of rock radius
  lod: vec4f,       // x = LOD1 distance per metre of radius, y = max distance per metre of radius, z = shadow distance, w = view distance
  info: vec4u,      // x = capacity
}

@group(0) @binding(0) var<uniform> C: CullParams;
@group(0) @binding(1) var<storage, read> rocks: array<RockInstance>;
@group(0) @binding(2) var<storage, read> counter: array<u32>;
@group(0) @binding(3) var<storage, read_write> visible: array<u32>;
@group(0) @binding(4) var<storage, read_write> args: array<atomic<u32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let cap = C.info.x;
  let i = gid.x;
  if (i >= min(counter[0], cap)) { return; }
  let r = rocks[i];
  let radius = r.posScale.w * 1.15;
  let center = r.posScale.xyz + vec3f(0.0, radius * 0.3, 0.0);
  let d = distance(C.cam.xyz, center);

  // Shadow casters near the camera (also off-screen ones).
  if (d < C.lod.z + radius && r.posScale.w > 0.25) {
    let s = atomicAdd(&args[3u * 5u + 1u], 1u);
    visible[3u * cap + s] = i;
  }

  if (d - radius > min(C.lod.w, radius * C.lod.y)) { return; }
  for (var k = 0; k < 6; k++) {
    let pl = C.planes[k];
    if (dot(pl.xyz, center) + pl.w < -radius) { return; }
  }
  var lod = 2u;
  if (d < radius * C.cam.w) { lod = 0u; } else if (d < radius * C.lod.x) { lod = 1u; }
  let slot = atomicAdd(&args[lod * 5u + 1u], 1u);
  visible[lod * cap + slot] = i;
}
