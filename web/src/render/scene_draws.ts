// Per-frame instance records for the uber mesh shader (shaders/mesh.wgsl `Instance`): the static colony batch,
// the rover, beacons, biography details and crew body parts. One storage buffer, rewritten every frame; draws reference
// contiguous instance ranges, so each mesh type is a single instanced draw.
import type { MeshRange } from './geometry.ts';
import type { Mat4 } from './math.ts';

export const INSTANCE_FLOATS = 24; // mat4 model + vec4 tint + vec4 params
const INSTANCE_BYTES = INSTANCE_FLOATS * 4;

export type DrawGroup = 'opaque' | 'character';

export interface MeshDraw {
  mesh: MeshRange;
  firstInstance: number;
  instanceCount: number;
  group: DrawGroup;
  castShadow: boolean;
}

export interface InstanceParams {
  /** Linear RGB accent colour (applied to FLAG.ACCENT vertices); a = emissive boost. */
  tint?: [number, number, number, number];
  /** Module index override (-1 = per vertex). */
  module?: number;
  phase?: number;
  dust?: number;
  /** 0..1 speaking / highlight. */
  highlight?: number;
}

export class InstanceBatch {
  readonly capacity: number;
  readonly buffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  readonly draws: MeshDraw[] = [];
  private readonly data: Float32Array<ArrayBuffer>;
  private count = 0;
  private readonly device: GPUDevice;
  /** Instances that did not fit this frame (reported in debug info, never silently ignored). */
  overflow = 0;

  constructor(device: GPUDevice, layout: GPUBindGroupLayout, capacity = 2048) {
    this.device = device;
    this.capacity = capacity;
    this.data = new Float32Array(capacity * INSTANCE_FLOATS);
    this.buffer = device.createBuffer({ label: 'mesh-instances', size: capacity * INSTANCE_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({ label: 'mesh-g1', layout, entries: [{ binding: 0, resource: { buffer: this.buffer } }] });
  }

  begin(): void {
    this.count = 0;
    this.overflow = 0;
    this.draws.length = 0;
  }

  /** Adds one draw of `mesh` with one instance per model matrix (all sharing the same parameters). */
  add(mesh: MeshRange, models: Mat4[], params: InstanceParams, group: DrawGroup = 'opaque', castShadow = true): void {
    const n = Math.min(models.length, this.capacity - this.count);
    this.overflow += models.length - n;
    if (n <= 0) return;
    const first = this.count;
    for (let i = 0; i < n; i++) this.write(first + i, models[i], params);
    this.count += n;
    this.draws.push({ mesh, firstInstance: first, instanceCount: n, group, castShadow });
  }

  /** Adds a draw whose instances have individual parameters. */
  addEach(mesh: MeshRange, items: { model: Mat4; params: InstanceParams }[], group: DrawGroup = 'opaque', castShadow = true): void {
    const n = Math.min(items.length, this.capacity - this.count);
    this.overflow += items.length - n;
    if (n <= 0) return;
    const first = this.count;
    for (let i = 0; i < n; i++) this.write(first + i, items[i].model, items[i].params);
    this.count += n;
    this.draws.push({ mesh, firstInstance: first, instanceCount: n, group, castShadow });
  }

  private write(index: number, model: Mat4, p: InstanceParams): void {
    const o = index * INSTANCE_FLOATS;
    const d = this.data;
    d.set(model, o);
    const t = p.tint ?? [1, 1, 1, 0];
    d[o + 16] = t[0]; d[o + 17] = t[1]; d[o + 18] = t[2]; d[o + 19] = t[3];
    d[o + 20] = p.module ?? -1;
    d[o + 21] = p.phase ?? 0;
    d[o + 22] = p.dust ?? 0;
    d[o + 23] = p.highlight ?? 0;
  }

  upload(): void {
    if (this.count > 0) this.device.queue.writeBuffer(this.buffer, 0, this.data, 0, this.count * INSTANCE_FLOATS);
  }

  get instanceCount(): number { return this.count; }

  /** Records draws of one group (or all) into a pass whose pipeline uses group 1 = mesh instances. */
  encode(pass: GPURenderPassEncoder, filter: (d: MeshDraw) => boolean): number {
    let n = 0;
    pass.setBindGroup(1, this.bindGroup);
    for (const d of this.draws) {
      if (!filter(d)) continue;
      pass.drawIndexed(d.mesh.indexCount, d.instanceCount, d.mesh.firstIndex, d.mesh.baseVertex, d.firstInstance);
      n++;
    }
    return n;
  }

  destroy(): void {
    this.buffer.destroy();
  }
}
