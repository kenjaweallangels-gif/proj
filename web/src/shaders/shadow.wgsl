// Cascaded shadow map passes (Документ §5: sun via cascaded shadow maps, not ray tracing). Depth only.
// Requires common.wgsl + instances.wgsl.

struct Cascade { index: vec4u }

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> cascade: Cascade;

@group(1) @binding(0) var<storage, read> instances: array<Instance>;

@vertex
fn vsMesh(@location(0) pos: vec3f, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let wp = instances[ii].model * vec4f(pos, 1.0);
  var c = frame.shadowViewProj[cascade.index.x] * wp;
  c.z = max(c.z, 0.0); // pancake: casters behind the near plane still cast
  return c;
}
