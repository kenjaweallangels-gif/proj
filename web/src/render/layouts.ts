// Explicit bind group layouts shared across pipelines (group 0 = per-frame scene data, group 1 = per-pipeline data).
export interface Layouts {
  main: GPUBindGroupLayout;
  shadowFrame: GPUBindGroupLayout;
  terrain: GPUBindGroupLayout;
  mesh: GPUBindGroupLayout;
  rocks: GPUBindGroupLayout;
  fx: GPUBindGroupLayout;
}

const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;

export function createLayouts(device: GPUDevice): Layouts {
  const main = device.createBindGroupLayout({
    label: 'main-g0',
    entries: [
      { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
      { binding: 1, visibility: VF, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: VF, sampler: { type: 'filtering' } },
      { binding: 3, visibility: VF, sampler: { type: 'filtering' } },
      { binding: 4, visibility: VF, texture: { sampleType: 'float', viewDimension: '2d' } },
      { binding: 5, visibility: VF, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
      { binding: 6, visibility: VF, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 7, visibility: VF, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 8, visibility: VF, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      { binding: 9, visibility: VF, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
      { binding: 10, visibility: VF, sampler: { type: 'comparison' } },
    ],
  });
  const shadowFrame = device.createBindGroupLayout({
    label: 'shadow-g0',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform', hasDynamicOffset: true } },
    ],
  });
  const terrain = device.createBindGroupLayout({
    label: 'terrain-g1',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }],
  });
  const mesh = device.createBindGroupLayout({
    label: 'mesh-g1',
    entries: [{ binding: 0, visibility: VF, buffer: { type: 'read-only-storage' } }],
  });
  const rocks = device.createBindGroupLayout({
    label: 'rocks-g1',
    entries: [
      { binding: 0, visibility: VF, buffer: { type: 'read-only-storage' } },  // rock instances
      { binding: 1, visibility: VF, buffer: { type: 'read-only-storage' } },  // visible index lists
      { binding: 2, visibility: VF, buffer: { type: 'read-only-storage' } },  // variant vertices
      { binding: 3, visibility: VF, buffer: { type: 'uniform', hasDynamicOffset: true } }, // per-draw LOD info
    ],
  });
  const fx = device.createBindGroupLayout({
    label: 'fx-g1',
    entries: [{ binding: 0, visibility: VF, buffer: { type: 'read-only-storage' } }],
  });
  return { main, shadowFrame, terrain, mesh, rocks, fx };
}
