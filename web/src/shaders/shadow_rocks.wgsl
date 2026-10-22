// Rock casters for the cascaded shadow map. Requires common.wgsl + instances.wgsl.

struct Cascade { index: vec4u }

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> cascade: Cascade;

@group(1) @binding(0) var<storage, read> rocks: array<RockInstance>;
@group(1) @binding(1) var<storage, read> visible: array<u32>;
@group(1) @binding(2) var<storage, read> rockVerts: array<RockVertex>;
@group(1) @binding(3) var<uniform> draw: RockDraw;

@vertex
fn vsRocks(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let r = rocks[visible[draw.listBase + ii]];
  let v = rockVerts[draw.vertexBase + u32(r.shape.x) * draw.vertexCount + vi];
  var c = frame.shadowViewProj[cascade.index.x] * vec4f(rockWorld(r, v.pos.xyz), 1.0);
  c.z = max(c.z, 0.0);
  return c;
}
