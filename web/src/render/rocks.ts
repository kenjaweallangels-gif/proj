// Instanced procedural rocks: six chipped-boulder variants at three LODs (icosphere subdivisions 3/2/1 sharing the
// same displacement so silhouettes match), scattered once on the GPU by seed, culled per frame on the GPU into
// indirect draws (main view LODs + a shadow-caster list).
import type { QualityProfile, SceneLayout, Vec3 } from '../contracts.ts';
import type { TerrainBake } from './bake.ts';
import { rng, type Plane } from './math.ts';
import { SHADERS } from './shaders.ts';

const VARIANTS = 6;
const LOD_SUBDIV = [3, 2, 1];
const INSTANCE_BYTES = 48;
const VERTEX_BYTES = 32;

interface LodMesh { vertexBase: number; vertexCount: number; firstIndex: number; indexCount: number }

export class RockSystem {
  readonly capacity: number;
  readonly instances: GPUBuffer;
  readonly counter: GPUBuffer;
  readonly visible: GPUBuffer;
  readonly args: GPUBuffer;
  readonly vertices: GPUBuffer;
  readonly indices: GPUBuffer;
  readonly drawInfo: GPUBuffer;
  readonly cullParams: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  private cullBindGroup: GPUBindGroup | null = null;
  private readonly lods: LodMesh[] = [];
  private readonly argsInit: Uint32Array;
  private readonly device: GPUDevice;
  private readonly cullData = new Float32Array(36);

  constructor(device: GPUDevice, layout: GPUBindGroupLayout, profile: QualityProfile) {
    this.device = device;
    this.capacity = Math.max(64, profile.render.rock_instances | 0);
    // ---- variant meshes
    const verts: number[] = [];
    const idx: number[] = [];
    for (let l = 0; l < LOD_SUBDIV.length; l++) {
      const ico = icosphere(LOD_SUBDIV[l]);
      const lod: LodMesh = { vertexBase: verts.length / 8, vertexCount: ico.positions.length / 3, firstIndex: idx.length, indexCount: ico.indices.length };
      for (let v = 0; v < VARIANTS; v++) verts.push(...displaceVariant(ico, v));
      idx.push(...ico.indices);
      this.lods.push(lod);
    }
    this.vertices = device.createBuffer({ label: 'rock-verts', size: verts.length * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.vertices, 0, new Float32Array(verts));
    const ib = new Uint32Array(idx);
    this.indices = device.createBuffer({ label: 'rock-idx', size: ib.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.indices, 0, ib);

    // ---- instance + culling buffers
    this.instances = device.createBuffer({ label: 'rock-instances', size: this.capacity * INSTANCE_BYTES, usage: GPUBufferUsage.STORAGE });
    this.counter = device.createBuffer({ label: 'rock-counter', size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.visible = device.createBuffer({ label: 'rock-visible', size: this.capacity * 4 * 4, usage: GPUBufferUsage.STORAGE });
    this.args = device.createBuffer({ label: 'rock-args', size: 4 * 5 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST });
    this.argsInit = new Uint32Array(20);
    for (let d = 0; d < 4; d++) {
      const lod = this.lods[d === 3 ? 1 : d];
      this.argsInit.set([lod.indexCount, 0, lod.firstIndex, 0, 0], d * 5);
    }
    this.drawInfo = device.createBuffer({ label: 'rock-draw', size: 256 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const info = new Uint32Array(64 * 4);
    for (let d = 0; d < 4; d++) {
      const lod = this.lods[d === 3 ? 1 : d];
      info.set([d * this.capacity, lod.vertexBase, lod.vertexCount, d === 3 ? 1 : d], d * 64);
    }
    device.queue.writeBuffer(this.drawInfo, 0, info);
    this.cullParams = device.createBuffer({ label: 'rock-cull-params', size: this.cullData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({
      label: 'rocks-g1', layout,
      entries: [
        { binding: 0, resource: { buffer: this.instances } },
        { binding: 1, resource: { buffer: this.visible } },
        { binding: 2, resource: { buffer: this.vertices } },
        { binding: 3, resource: { buffer: this.drawInfo, offset: 0, size: 16 } },
      ],
    });
  }

  /** Scatter (once, part of the bake). */
  async scatter(bake: TerrainBake, scene: SceneLayout): Promise<void> {
    const d = this.device;
    const pipeline = await d.createComputePipelineAsync({
      label: 'rock-scatter', layout: 'auto',
      compute: { module: d.createShaderModule({ label: 'rock-scatter', code: SHADERS.rockScatter }), entryPoint: 'main' },
    });
    const candidates = this.capacity * 8;
    const sp = new ArrayBuffer(16);
    new Uint32Array(sp, 0, 3).set([this.capacity, candidates, (scene.seed ^ 0x9e3779b9) >>> 0]);
    new Float32Array(sp, 12, 1)[0] = Math.max(48, scene.terrain.flatten_radius_m * 0.42);
    const sbuf = d.createBuffer({ label: 'scatter-params', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    d.queue.writeBuffer(sbuf, 0, sp);
    d.queue.writeBuffer(this.counter, 0, new Uint32Array(4));
    const arr = (t: GPUTexture) => t.createView({ dimension: '2d-array' });
    const bg = d.createBindGroup({
      label: 'rock-scatter', layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bake.bakeParams, offset: 0, size: 128 } },
        { binding: 2, resource: arr(bake.height) },
        { binding: 3, resource: arr(bake.rawMask) },
        { binding: 5, resource: arr(bake.light) },
        { binding: 6, resource: arr(bake.mat) },
        { binding: 7, resource: arr(bake.normal) },
        { binding: 8, resource: { buffer: sbuf } },
        { binding: 9, resource: { buffer: this.instances } },
        { binding: 10, resource: { buffer: this.counter } },
      ],
    });
    const enc = d.createCommandEncoder({ label: 'rock-scatter' });
    const pass = enc.beginComputePass({ label: 'rock-scatter' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(candidates / 64));
    pass.end();
    d.queue.submit([enc.finish()]);
    await d.queue.onSubmittedWorkDone();
    sbuf.destroy();
  }

  /** Records the per-frame GPU cull. */
  cull(enc: GPUCommandEncoder, pipeline: GPUComputePipeline, cam: Vec3, planes: Plane[], shadowDistance: number, viewDistance: number, timestampWrites?: GPUComputePassTimestampWrites): void {
    if (!this.cullBindGroup) {
      this.cullBindGroup = this.device.createBindGroup({
        label: 'rock-cull', layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.cullParams } },
          { binding: 1, resource: { buffer: this.instances } },
          { binding: 2, resource: { buffer: this.counter } },
          { binding: 3, resource: { buffer: this.visible } },
          { binding: 4, resource: { buffer: this.args } },
        ],
      });
    }
    const c = this.cullData;
    for (let i = 0; i < 6; i++) c.set(planes[i] ?? [0, 0, 0, 1], i * 4);
    c.set([cam[0], cam[1], cam[2], 40], 24);          // LOD0 within 40 x radius
    c.set([140, 900, shadowDistance, viewDistance], 28); // LOD1 within 140 x radius, culled beyond 900 x radius
    new Uint32Array(c.buffer, 32 * 4, 4).set([this.capacity, 0, 0, 0]);
    this.device.queue.writeBuffer(this.cullParams, 0, c);
    this.device.queue.writeBuffer(this.args, 0, this.argsInit);
    const pass = enc.beginComputePass({ label: 'rock-cull', timestampWrites });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.cullBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.capacity / 64));
    pass.end();
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setIndexBuffer(this.indices, 'uint32');
    for (let d = 0; d < 3; d++) {
      pass.setBindGroup(1, this.bindGroup, [d * 256]);
      pass.drawIndexedIndirect(this.args, d * 20);
    }
  }

  drawShadow(pass: GPURenderPassEncoder): void {
    pass.setIndexBuffer(this.indices, 'uint32');
    pass.setBindGroup(1, this.bindGroup, [3 * 256]);
    pass.drawIndexedIndirect(this.args, 3 * 20);
  }

  destroy(): void {
    for (const b of [this.instances, this.counter, this.visible, this.args, this.vertices, this.indices, this.drawInfo, this.cullParams]) b.destroy();
  }
}

// ---------------------------------------------------------------- procedural meshes
interface Ico { positions: number[]; indices: number[] }

function icosphere(subdiv: number): Ico {
  const t = (1 + Math.sqrt(5)) / 2;
  const pos: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((p) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map<string, number>();
    const mid = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const p = [(pos[a][0] + pos[b][0]) / 2, (pos[a][1] + pos[b][1]) / 2, (pos[a][2] + pos[b][2]) / 2];
      const l = Math.hypot(p[0], p[1], p[2]);
      pos.push([p[0] / l, p[1] / l, p[2] / l]);
      cache.set(key, pos.length - 1);
      return pos.length - 1;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return { positions: pos.flat(), indices: faces.flat() };
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const n = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const x00 = n(0, 0, 0) + (n(1, 0, 0) - n(0, 0, 0)) * u;
  const x10 = n(0, 1, 0) + (n(1, 1, 0) - n(0, 1, 0)) * u;
  const x01 = n(0, 0, 1) + (n(1, 0, 1) - n(0, 0, 1)) * u;
  const x11 = n(0, 1, 1) + (n(1, 1, 1) - n(0, 1, 1)) * u;
  return ((x00 + (x10 - x00) * v) + ((x01 + (x11 - x01) * v) - (x00 + (x10 - x00) * v)) * w) * 2 - 1;
}

/** Chipped boulder: noisy sphere intersected with random planes (flat fracture facets). Returns RockVertex data. */
function displaceVariant(ico: Ico, variant: number): number[] {
  const r = rng(9173 + variant * 7919);
  const planes: { n: [number, number, number]; o: number }[] = [];
  const cuts = 5 + Math.floor(r() * 4);
  for (let i = 0; i < cuts; i++) {
    const th = r() * Math.PI * 2, ph = Math.acos(r() * 2 - 1);
    planes.push({ n: [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)], o: 0.62 + r() * 0.3 });
  }
  planes.push({ n: [0, -1, 0], o: 0.45 + r() * 0.2 }); // flat base
  const stretch: [number, number, number] = [0.85 + r() * 0.5, 1, 0.85 + r() * 0.5];
  const n = ico.positions.length / 3;
  const p: number[] = new Array(n * 3);
  const rad: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const d: [number, number, number] = [ico.positions[i * 3], ico.positions[i * 3 + 1], ico.positions[i * 3 + 2]];
    let rr = 1 + 0.16 * noise3(d[0] * 1.6 + variant * 3.1, d[1] * 1.6, d[2] * 1.6, 11) + 0.07 * noise3(d[0] * 4.3, d[1] * 4.3 + variant, d[2] * 4.3, 12);
    for (const pl of planes) {
      const c = d[0] * pl.n[0] + d[1] * pl.n[1] + d[2] * pl.n[2];
      if (c > 1e-3) rr = Math.min(rr, pl.o / c);
    }
    rad[i] = rr;
    p[i * 3] = d[0] * rr * stretch[0];
    p[i * 3 + 1] = d[1] * rr * stretch[1];
    p[i * 3 + 2] = d[2] * rr * stretch[2];
  }
  // Smooth normals from faces.
  const nrm = new Float64Array(n * 3);
  for (let f = 0; f < ico.indices.length; f += 3) {
    const a = ico.indices[f], b = ico.indices[f + 1], c = ico.indices[f + 2];
    const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
    const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const k of [a, b, c]) { nrm[k * 3] += fn[0]; nrm[k * 3 + 1] += fn[1]; nrm[k * 3 + 2] += fn[2]; }
  }
  const mean = rad.reduce((s, x) => s + x, 0) / n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    // Cavity: recessed vertices and the underside are darker.
    const cav = Math.min(1, Math.max(0.35, 1 - (mean - rad[i]) * 1.6)) * (0.75 + 0.25 * Math.min(1, Math.max(0, ny + 0.6)));
    // Ico winding faces outward for this face list; keep the normal outward.
    out.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], cav, nx, ny, nz, 0);
  }
  return out;
}
