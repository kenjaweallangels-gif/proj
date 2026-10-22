// Instance and vertex records shared by the main and shadow passes (CPU mirrors: render/scene_draws.ts, render/rocks.ts).

struct Instance {
  model: mat4x4f,
  tint: vec4f,    // rgb accent colour (applied to accent vertices), a = emissive boost
  params: vec4f,  // x = module index override (-1 = per vertex), y = phase/time offset, z = dust amount, w = speaking/highlight
}

struct RockInstance {
  posScale: vec4f,  // xyz = world position (already sunk into the ground), w = uniform scale (m)
  quat: vec4f,      // rotation quaternion
  shape: vec4f,     // x = variant, y = vertical squash, z = colour variation 0..1, w = dust amount
}

struct RockVertex {
  pos: vec4f,       // xyz = unit-size position, w = cavity AO
  nrm: vec4f,       // xyz = normal
}

struct RockDraw {
  listBase: u32,    // offset into the visible index list for this LOD
  vertexBase: u32,  // first vertex of variant 0 for this LOD
  vertexCount: u32, // vertices per variant at this LOD
  lod: u32,
}

fn quatRotate(q: vec4f, v: vec3f) -> vec3f {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

fn rockWorld(r: RockInstance, p: vec3f) -> vec3f {
  let s = r.posScale.w;
  return r.posScale.xyz + quatRotate(r.quat, vec3f(p.x, p.y * r.shape.y, p.z) * s);
}

fn rockNormal(r: RockInstance, n: vec3f) -> vec3f {
  return normalize(quatRotate(r.quat, vec3f(n.x, n.y / max(r.shape.y, 0.05), n.z)));
}
