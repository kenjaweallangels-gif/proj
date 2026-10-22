// WGSL has no #include: shader modules are assembled from shared pieces here (one source of truth per function).
import common from '../shaders/common.wgsl';
import atmosphere from '../shaders/atmosphere.wgsl';
import sceneAtmo from '../shaders/scene_atmo.wgsl';
import bindingsMain from '../shaders/bindings_main.wgsl';
import terrainSample from '../shaders/terrain_sample.wgsl';
import lighting from '../shaders/lighting.wgsl';
import instances from '../shaders/instances.wgsl';
import bakeCommon from '../shaders/bake_common.wgsl';
import bakeSample from '../shaders/bake_sample.wgsl';
import bakePaths from '../shaders/bake_paths.wgsl';
import bakeHeight from '../shaders/bake_height.wgsl';
import bakeDerive from '../shaders/bake_derive.wgsl';
import bakeLight from '../shaders/bake_light.wgsl';
import bakeSky from '../shaders/bake_sky.wgsl';
import terrain from '../shaders/terrain.wgsl';
import sky from '../shaders/sky.wgsl';
import post from '../shaders/post.wgsl';
import mesh from '../shaders/mesh.wgsl';
import rocks from '../shaders/rocks.wgsl';
import rockScatter from '../shaders/rock_scatter.wgsl';
import rockCull from '../shaders/rock_cull.wgsl';
import shadow from '../shaders/shadow.wgsl';
import shadowRocks from '../shaders/shadow_rocks.wgsl';
import fx from '../shaders/fx.wgsl';

const join = (...parts: string[]): string => parts.join('\n');

/** Prefix shared by every main-view scene shader. */
const scene = join(common, bindingsMain, atmosphere, sceneAtmo, terrainSample, lighting);

export const SHADERS = {
  bakeHeight: join(common, bakeCommon, bakeHeight),
  bakeDerive: join(common, bakeCommon, bakeDerive),
  bakeLight: join(common, bakeCommon, bakeSample, bakePaths, bakeLight),
  bakeSky: join(common, atmosphere, bakeSky),
  rockScatter: join(common, bakeCommon, bakeSample, instances, rockScatter),
  rockCull: join(common, instances, rockCull),
  terrain: join(scene, terrain),
  sky: join(scene, sky),
  mesh: join(scene, instances, mesh),
  rocks: join(scene, instances, rocks),
  fx: join(scene, fx),
  shadowMesh: join(common, instances, shadow),
  shadowRocks: join(common, instances, shadowRocks),
  post: join(common, post),
} as const;

export type ShaderName = keyof typeof SHADERS;
