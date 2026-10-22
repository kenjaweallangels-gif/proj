// CDLOD terrain (Strugar 2010): a quadtree over the whole map selects patches by distance-based LOD ranges; the
// vertex shader morphs every patch continuously toward the next coarser grid, so there are no cracks and no popping.
// Node bounds come from the CPU min/max pyramid of the baked heightfield; patches are frustum-culled on the CPU and
// drawn as two instanced draws (full patches and quarter patches) with no vertex buffers.
import type { QualityProfile, SceneLayout, Vec3 } from '../contracts.ts';
import type { TerrainBake } from './bake.ts';
import { aabbInFrustum, type Plane } from './math.ts';

const MAX_PATCHES = 4096;
const LEVELS = 10;
const MORPH_START = 0.62;

export interface TerrainStats { patches: number; full: number; quarter: number; vertices: number }

export class TerrainRenderer {
  readonly gridQuads: number;
  readonly leafSize: number;
  readonly ranges: number[] = [];
  readonly morphStart: number[] = [];
  private readonly device: GPUDevice;
  private readonly bake: TerrainBake;
  private readonly rootOrigin: [number, number];
  private readonly rootSize: number;
  private readonly instanceData = new Float32Array(MAX_PATCHES * 8);
  readonly instanceBuffer: GPUBuffer;
  readonly fullIndex: GPUBuffer;
  readonly halfIndex: GPUBuffer;
  readonly fullIndexCount: number;
  readonly halfIndexCount: number;
  readonly bindGroup: GPUBindGroup;
  private fullCount = 0;
  private quarterCount = 0;
  private full: number[] = [];
  private quarter: number[] = [];
  stats: TerrainStats = { patches: 0, full: 0, quarter: 0, vertices: 0 };

  constructor(device: GPUDevice, layout: GPUBindGroupLayout, bake: TerrainBake, profile: QualityProfile, scene: SceneLayout) {
    this.device = device;
    this.bake = bake;
    // terrain_grid in profiles.json -> quads per patch side (rounded to a multiple of 8): W60 40, W-low 24, N60 64.
    this.gridQuads = Math.max(16, Math.min(64, Math.round(profile.render.terrain_grid / 4 / 8) * 8));
    this.rootSize = scene.terrain.size_m;
    this.rootOrigin = [bake.center[0] - this.rootSize / 2, bake.center[1] - this.rootSize / 2];
    this.leafSize = this.rootSize / (1 << (LEVELS - 1));
    for (let i = 0; i < LEVELS; i++) this.ranges.push(this.leafSize * 2.4 * (1 << i));
    for (let i = 0; i < LEVELS; i++) {
      const prev = i === 0 ? 0 : this.ranges[i - 1];
      this.morphStart.push(prev + (this.ranges[i] - prev) * MORPH_START);
    }
    this.instanceBuffer = device.createBuffer({ label: 'terrain-patches', size: this.instanceData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const full = gridIndices(this.gridQuads);
    const half = gridIndices(this.gridQuads / 2);
    this.fullIndexCount = full.length;
    this.halfIndexCount = half.length;
    this.fullIndex = device.createBuffer({ label: 'terrain-idx-full', size: align4(full.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.halfIndex = device.createBuffer({ label: 'terrain-idx-half', size: align4(half.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.fullIndex, 0, padTo4(full));
    device.queue.writeBuffer(this.halfIndex, 0, padTo4(half));
    this.bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.instanceBuffer } }] });
  }

  /** Selects visible patches for this camera and uploads them. */
  update(cam: Vec3, planes: Plane[], viewDistance: number): void {
    this.full = [];
    this.quarter = [];
    this.select(this.rootOrigin[0], this.rootOrigin[1], this.rootSize, LEVELS - 1, cam, planes, viewDistance);
    const total = Math.min(MAX_PATCHES, this.full.length / 8 + this.quarter.length / 8);
    this.fullCount = Math.min(this.full.length / 8, MAX_PATCHES);
    this.quarterCount = total - this.fullCount;
    this.instanceData.set(this.full.slice(0, this.fullCount * 8), 0);
    this.instanceData.set(this.quarter.slice(0, this.quarterCount * 8), this.fullCount * 8);
    if (total > 0) this.device.queue.writeBuffer(this.instanceBuffer, 0, this.instanceData, 0, total * 8);
    const vf = (this.gridQuads + 1) ** 2, vh = (this.gridQuads / 2 + 1) ** 2;
    this.stats = { patches: total, full: this.fullCount, quarter: this.quarterCount, vertices: this.fullCount * vf + this.quarterCount * vh };
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setBindGroup(1, this.bindGroup);
    if (this.fullCount > 0) {
      pass.setIndexBuffer(this.fullIndex, 'uint16');
      pass.drawIndexed(this.fullIndexCount, this.fullCount, 0, 0, 0);
    }
    if (this.quarterCount > 0) {
      pass.setIndexBuffer(this.halfIndex, 'uint16');
      pass.drawIndexed(this.halfIndexCount, this.quarterCount, 0, 0, this.fullCount);
    }
  }

  private push(list: number[], x: number, z: number, size: number, lod: number, quads: number): void {
    list.push(x, z, size, quads, this.morphStart[lod], this.ranges[lod], lod, 0);
  }

  private select(x: number, z: number, size: number, lod: number, cam: Vec3, planes: Plane[], viewDistance: number): boolean {
    const [y0, y1] = this.bake.cpu.rangeOver(x, z, size);
    const min: Vec3 = [x, y0, z];
    const max: Vec3 = [x + size, y1, z + size];
    const d = distToAabb(cam, min, max);
    if (d > this.ranges[lod]) return false;
    if (d > viewDistance) return true;
    if (!aabbInFrustum(planes, min, max)) return true;
    if (lod === 0 || d > this.ranges[lod - 1]) {
      this.push(this.full, x, z, size, lod, this.gridQuads);
      return true;
    }
    const h = size / 2;
    for (const [cx, cz] of [[x, z], [x + h, z], [x, z + h], [x + h, z + h]] as const) {
      if (!this.select(cx, cz, h, lod - 1, cam, planes, viewDistance)) {
        // The child is outside its own range: cover its area at this LOD with the half-resolution grid.
        const [qy0, qy1] = this.bake.cpu.rangeOver(cx, cz, h);
        if (aabbInFrustum(planes, [cx, qy0, cz], [cx + h, qy1, cz + h])) this.push(this.quarter, cx, cz, h, lod, this.gridQuads / 2);
      }
    }
    return true;
  }

  destroy(): void {
    this.instanceBuffer.destroy();
    this.fullIndex.destroy();
    this.halfIndex.destroy();
  }
}

function distToAabb(p: Vec3, min: Vec3, max: Vec3): number {
  const dx = Math.max(min[0] - p[0], 0, p[0] - max[0]);
  const dy = Math.max(min[1] - p[1], 0, p[1] - max[1]);
  const dz = Math.max(min[2] - p[2], 0, p[2] - max[2]);
  return Math.hypot(dx, dy, dz);
}

function gridIndices(quads: number): Uint16Array {
  const row = quads + 1;
  const out = new Uint16Array(quads * quads * 6);
  let k = 0;
  for (let y = 0; y < quads; y++) {
    for (let x = 0; x < quads; x++) {
      const a = y * row + x, b = a + 1, c = a + row, d = c + 1;
      // Alternate the diagonal for a symmetric (less directional) triangulation.
      if ((x + y) % 2 === 0) { out.set([a, c, b, b, c, d], k); } else { out.set([a, c, d, a, d, b], k); }
      k += 6;
    }
  }
  return out;
}

const align4 = (n: number): number => (n + 3) & ~3;

function padTo4(a: Uint16Array): Uint16Array {
  if (a.length % 2 === 0) return a;
  const out = new Uint16Array(a.length + 1);
  out.set(a);
  return out;
}
