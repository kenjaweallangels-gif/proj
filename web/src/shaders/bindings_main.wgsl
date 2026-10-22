// Group 0 for every main-view scene pass (opaque, character, atmosphere/transparency). Layout: render/layouts.ts.
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> atmo: Atmo;
@group(0) @binding(2) var linearClamp: sampler;
@group(0) @binding(3) var linearRepeat: sampler;
@group(0) @binding(4) var skyLut: texture_2d<f32>;
@group(0) @binding(5) var terrainHeight: texture_2d_array<f32>;  // r32float, read with textureLoad (manual bilinear)
@group(0) @binding(6) var terrainNormal: texture_2d_array<f32>;  // rgba8snorm: xyz normal, w = cavity
@group(0) @binding(7) var terrainLight: texture_2d_array<f32>;   // rgba8unorm: r = baked sun visibility, g = sky AO, b = cave, a = path
@group(0) @binding(8) var terrainMat: texture_2d_array<f32>;     // rgba8unorm: r = dust, g = basalt, b = sediment, a = slope rock
@group(0) @binding(9) var shadowMap: texture_depth_2d_array;
@group(0) @binding(10) var shadowSampler: sampler_comparison;
