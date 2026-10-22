// All pipelines are created up front with createRenderPipelineAsync / createComputePipelineAsync and reported with
// honest progress (Документ §7: prewarm known variants; no first-use compilation hitch on the route).
import { SHADERS, type ShaderName } from './shaders.ts';
import type { Layouts } from './layouts.ts';
import { VERTEX_LAYOUT } from './geometry.ts';

export const HDR_FORMAT: GPUTextureFormat = 'rgba16float';
export const DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
export const AO_FORMAT: GPUTextureFormat = 'rg16float';
export const LDR_FORMAT: GPUTextureFormat = 'rgba8unorm';

export interface Pipelines {
  terrain: GPURenderPipeline;
  terrainDepth: GPURenderPipeline;
  mesh: GPURenderPipeline;
  meshDepth: GPURenderPipeline;
  rocks: GPURenderPipeline;
  sky: GPURenderPipeline;
  dust: GPURenderPipeline;
  sprites: GPURenderPipeline;
  shadowMesh: GPURenderPipeline;
  shadowRocks: GPURenderPipeline;
  ao: GPURenderPipeline;
  bloomDown: GPURenderPipeline;
  bloomUp: GPURenderPipeline;
  tonemap: GPURenderPipeline;
  fxaa: GPURenderPipeline;
  upscale: GPURenderPipeline;
  rockCull: GPUComputePipeline;
}

export class ShaderCompileError extends Error {}

async function compile(device: GPUDevice, name: ShaderName): Promise<GPUShaderModule> {
  const code = SHADERS[name];
  const module = device.createShaderModule({ label: `shader-${name}`, code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length) {
    const lines = code.split('\n');
    const msg = errors.slice(0, 6).map((m) => `${name}:${m.lineNum}:${m.linePos} ${m.message}\n    ${lines[m.lineNum - 1]?.trim() ?? ''}`).join('\n');
    throw new ShaderCompileError(`WGSL compile error\n${msg}`);
  }
  return module;
}

const NO_ALPHA_WRITE: GPUBlendComponent = { operation: 'add', srcFactor: 'zero', dstFactor: 'one' };

export async function createPipelines(device: GPUDevice, layouts: Layouts, canvasFormat: GPUTextureFormat, onProgress: (done: number, total: number) => void): Promise<Pipelines> {
  const names: ShaderName[] = ['terrain', 'sky', 'mesh', 'rocks', 'fx', 'shadowMesh', 'shadowRocks', 'post', 'rockCull'];
  const modules = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await compile(device, n)] as const))) as Record<ShaderName, GPUShaderModule>;

  const pl = (...groups: GPUBindGroupLayout[]) => device.createPipelineLayout({ bindGroupLayouts: groups });
  const mainOnly = pl(layouts.main);
  const terrainLayout = pl(layouts.main, layouts.terrain);
  const meshLayout = pl(layouts.main, layouts.mesh);
  const rocksLayout = pl(layouts.main, layouts.rocks);
  const fxLayout = pl(layouts.main, layouts.fx);
  const shadowMeshLayout = pl(layouts.shadowFrame, layouts.mesh);
  const shadowRocksLayout = pl(layouts.shadowFrame, layouts.rocks);

  const depthOpaque: GPUDepthStencilState = { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'greater-equal' };
  const hdrTarget: GPUColorTargetState[] = [{ format: HDR_FORMAT }];
  const prim: GPUPrimitiveState = { topology: 'triangle-list', cullMode: 'back', frontFace: 'ccw' };
  const fullscreen = (fs: string, format: GPUTextureFormat, blend?: GPUBlendState): GPURenderPipelineDescriptor => ({
    label: `post-${fs}`,
    layout: 'auto',
    vertex: { module: modules.post, entryPoint: 'vsFull' },
    fragment: { module: modules.post, entryPoint: fs, targets: [{ format, blend }] },
    primitive: { topology: 'triangle-list' },
  });

  const renderDescs: Record<Exclude<keyof Pipelines, 'rockCull'>, GPURenderPipelineDescriptor> = {
    terrain: {
      label: 'terrain', layout: terrainLayout,
      vertex: { module: modules.terrain, entryPoint: 'vsMain' },
      fragment: { module: modules.terrain, entryPoint: 'fsMain', targets: hdrTarget },
      primitive: prim, depthStencil: depthOpaque,
    },
    terrainDepth: {
      label: 'terrain-depth', layout: terrainLayout,
      vertex: { module: modules.terrain, entryPoint: 'vsMain' },
      primitive: prim, depthStencil: depthOpaque,
    },
    mesh: {
      label: 'mesh', layout: meshLayout,
      vertex: { module: modules.mesh, entryPoint: 'vsMain', buffers: [VERTEX_LAYOUT] },
      fragment: { module: modules.mesh, entryPoint: 'fsMain', targets: hdrTarget },
      primitive: prim, depthStencil: depthOpaque,
    },
    meshDepth: {
      label: 'mesh-depth', layout: meshLayout,
      vertex: { module: modules.mesh, entryPoint: 'vsMain', buffers: [VERTEX_LAYOUT] },
      primitive: prim, depthStencil: depthOpaque,
    },
    rocks: {
      label: 'rocks', layout: rocksLayout,
      vertex: { module: modules.rocks, entryPoint: 'vsMain' },
      fragment: { module: modules.rocks, entryPoint: 'fsMain', targets: hdrTarget },
      primitive: prim, depthStencil: depthOpaque,
    },
    sky: {
      label: 'sky', layout: mainOnly,
      vertex: { module: modules.sky, entryPoint: 'vsMain' },
      fragment: { module: modules.sky, entryPoint: 'fsMain', targets: hdrTarget },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'greater-equal' },
    },
    dust: {
      label: 'fx-dust', layout: fxLayout,
      vertex: { module: modules.fx, entryPoint: 'vsDust' },
      fragment: {
        module: modules.fx, entryPoint: 'fsDust',
        targets: [{ format: HDR_FORMAT, blend: { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: NO_ALPHA_WRITE } }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'greater' },
    },
    sprites: {
      label: 'fx-sprites', layout: fxLayout,
      vertex: { module: modules.fx, entryPoint: 'vsSprite' },
      fragment: {
        module: modules.fx, entryPoint: 'fsSprite',
        targets: [{ format: HDR_FORMAT, blend: { color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }, alpha: NO_ALPHA_WRITE } }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'greater' },
    },
    shadowMesh: {
      label: 'shadow-mesh', layout: shadowMeshLayout,
      vertex: { module: modules.shadowMesh, entryPoint: 'vsMesh', buffers: [VERTEX_LAYOUT] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less', depthBias: 1, depthBiasSlopeScale: 1.5 },
    },
    shadowRocks: {
      label: 'shadow-rocks', layout: shadowRocksLayout,
      vertex: { module: modules.shadowRocks, entryPoint: 'vsRocks' },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less', depthBias: 1, depthBiasSlopeScale: 1.5 },
    },
    ao: fullscreen('fsAo', AO_FORMAT),
    bloomDown: fullscreen('fsBloomDown', HDR_FORMAT),
    bloomUp: fullscreen('fsBloomUp', HDR_FORMAT, { color: { operation: 'add', srcFactor: 'constant', dstFactor: 'constant' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'zero' } }),
    tonemap: fullscreen('fsTonemap', LDR_FORMAT),
    fxaa: fullscreen('fsFxaa', LDR_FORMAT),
    upscale: fullscreen('fsUpscale', canvasFormat),
  };

  const entries = Object.entries(renderDescs) as [keyof typeof renderDescs, GPURenderPipelineDescriptor][];
  const total = entries.length + 1;
  let done = 0;
  onProgress(done, total);
  const tick = <T>(p: Promise<T>): Promise<T> => p.then((v) => { done++; onProgress(done, total); return v; });
  const created = await Promise.all(entries.map(([, d]) => tick(device.createRenderPipelineAsync(d))));
  const rockCull = await tick(device.createComputePipelineAsync({ label: 'rock-cull', layout: 'auto', compute: { module: modules.rockCull, entryPoint: 'main' } }));
  const out = Object.fromEntries(entries.map(([k], i) => [k, created[i]])) as Omit<Pipelines, 'rockCull'>;
  return { ...out, rockCull };
}
