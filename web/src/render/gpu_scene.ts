// Every GPU resource of the D0 scene for one device + quality profile, and the per-frame command encoding.
// Pass order (budget groups from data/profiles.json gpu_budget_n60_ms):
//   culling_depth_service   rock GPU cull (+ optional depth prepass)
//   shadows                 cascaded shadow map for the colony, rover, crew and near rocks (terrain shadow is baked)
//   opaque                  forward PBR: CDLOD terrain, colony, rocks
//   character               crew figures
//   atmosphere_transparency sky + sun, dust motes, glows/markers (limited transparency)
//   ao_reflections_post_ui  half-res AO, auto exposure, bloom, AgX tonemap, FXAA, spatial upscale to the canvas
import type { QualityProfile, SceneLayout, Vec3 } from '../contracts.ts';
import type { GpuTimer } from '../gpu/timing.ts';
import { bakeScene, type TerrainBake } from './bake.ts';
import { buildColony, type ColonyBuild } from './colony.ts';
import { buildCrewMeshes, type CrewMeshes } from './actors.ts';
import { FRAME_SIZE, FrameUniforms } from './frame.ts';
import { FxBuffer } from './fx.ts';
import { GeometryPool, MeshBuilder, MAT, FLAG } from './geometry.ts';
import type { Layouts } from './layouts.ts';
import { frustumPlanes, m4, type Mat4 } from './math.ts';
import type { Pipelines } from './pipelines.ts';
import { PostChain, RenderTargets, type ExposureControl } from './post.ts';
import { RockSystem } from './rocks.ts';
import { InstanceBatch } from './scene_draws.ts';
import { ShadowMaps } from './shadows.ts';
import { TerrainRenderer } from './terrain.ts';

export type ProgressFn = (fraction: number, message: string) => void;

/** Device-scoped objects shared by every GpuScene on that device. */
export interface DeviceObjects {
  device: GPUDevice;
  layouts: Layouts;
  pipelines: Pipelines;
  timer: GpuTimer;
  linearClamp: GPUSampler;
  linearRepeat: GPUSampler;
  shadowSampler: GPUSampler;
}

export interface FrameView {
  view: Mat4;
  proj: Mat4;
  viewProj: Mat4;
  invViewProj: Mat4;
  camPos: Vec3;
  camFwd: Vec3;
  fovY: number;
  aspect: number;
  near: number;
}

export interface EncodeOptions {
  frameIndex: number;
  ao: boolean;
  bloom: boolean;
  depthPrepass: boolean;
  dustCount: number;
}

export interface EncodeStats {
  terrainPatches: number;
  terrainVertices: number;
  meshDraws: number;
  instances: number;
  sprites: number;
}

export class GpuScene {
  readonly profile: QualityProfile;
  readonly scene: SceneLayout;
  readonly dev: DeviceObjects;
  readonly bake: TerrainBake;
  readonly pool: GeometryPool;
  readonly colony: ColonyBuild;
  readonly crewMeshes: CrewMeshes;
  readonly detailMeshes: Record<string, ReturnType<GeometryPool['get']>>;
  readonly terrain: TerrainRenderer;
  readonly rocks: RockSystem;
  readonly shadows: ShadowMaps;
  readonly frameBuffer: GPUBuffer;
  readonly uniforms = new FrameUniforms();
  readonly batch: InstanceBatch;
  readonly fx: FxBuffer;
  readonly post: PostChain;
  readonly mainBindGroup: GPUBindGroup;
  targets: RenderTargets | null = null;

  private constructor(dev: DeviceObjects, profile: QualityProfile, scene: SceneLayout, bake: TerrainBake, parts: {
    pool: GeometryPool; colony: ColonyBuild; crew: CrewMeshes; details: Record<string, ReturnType<GeometryPool['get']>>; rocks: RockSystem;
  }) {
    const d = dev.device;
    this.dev = dev;
    this.profile = profile;
    this.scene = scene;
    this.bake = bake;
    this.pool = parts.pool;
    this.colony = parts.colony;
    this.crewMeshes = parts.crew;
    this.detailMeshes = parts.details;
    this.rocks = parts.rocks;
    this.frameBuffer = d.createBuffer({ label: 'frame-uniforms', size: FRAME_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.terrain = new TerrainRenderer(d, dev.layouts.terrain, bake, profile, scene);
    this.shadows = new ShadowMaps(d, dev.layouts.shadowFrame, this.frameBuffer, profile);
    this.batch = new InstanceBatch(d, dev.layouts.mesh);
    this.fx = new FxBuffer(d, dev.layouts.fx);
    this.post = new PostChain(d, dev.pipelines, this.frameBuffer);
    const arr = (t: GPUTexture) => t.createView({ dimension: '2d-array' });
    this.mainBindGroup = d.createBindGroup({
      label: 'main-g0', layout: dev.layouts.main,
      entries: [
        { binding: 0, resource: { buffer: this.frameBuffer } },
        { binding: 1, resource: { buffer: bake.atmo } },
        { binding: 2, resource: dev.linearClamp },
        { binding: 3, resource: dev.linearRepeat },
        { binding: 4, resource: bake.skyLut.createView() },
        { binding: 5, resource: arr(bake.height) },
        { binding: 6, resource: arr(bake.normal) },
        { binding: 7, resource: arr(bake.light) },
        { binding: 8, resource: arr(bake.mat) },
        { binding: 9, resource: this.shadows.arrayView },
        { binding: 10, resource: dev.shadowSampler },
      ],
    });
  }

  /** Bakes the terrain and sky, scatters rocks and builds the colony/crew geometry, with honest progress. */
  static async create(dev: DeviceObjects, profile: QualityProfile, scene: SceneLayout, progress: ProgressFn, reuseBake?: TerrainBake): Promise<GpuScene> {
    const d = dev.device;
    const bake = reuseBake ?? await bakeScene(d, profile, scene, (f, m) => progress(f * 0.88, m));
    progress(0.9, 'Камни: рассыпка по маскам геологии');
    const rocks = new RockSystem(d, dev.layouts.rocks, profile);
    await rocks.scatter(bake, scene);
    progress(0.95, 'Колония, ровер и экипаж: геометрия');
    const pool = new GeometryPool();
    const ground = (x: number, z: number) => bake.cpu.heightAt(x, z);
    const colony = buildColony(scene, ground, pool);
    const crew = buildCrewMeshes(pool);
    const details = buildDetailMeshes(pool);
    pool.upload(d);
    progress(1, 'Сцена готова');
    return new GpuScene(dev, profile, scene, bake, { pool, colony, crew, details, rocks });
  }

  /** Allocates internal-resolution targets (render scale applied by the caller). */
  resize(width: number, height: number): void {
    const t = this.targets;
    if (t && t.width === width && t.height === height) return;
    t?.destroy();
    this.targets = new RenderTargets(this.dev.device, width, height);
    this.post.setTargets(this.targets);
  }

  setExposure(e: ExposureControl): void {
    this.post.setExposure(e);
  }

  /** Per-frame CPU work that depends on the camera (CDLOD selection, cascades), then the GPU uploads. */
  prepare(v: FrameView, viewDistance: number, sunDir: Vec3): void {
    const planes = frustumPlanes(v.viewProj, v.camPos, v.camFwd, viewDistance);
    this.terrain.update(v.camPos, planes, viewDistance);
    this.shadows.update(v.camPos, v.camFwd, v.fovY, v.aspect, v.near, sunDir);
    const u = this.uniforms;
    for (let i = 0; i < this.shadows.matrices.length && i < 4; i++) u.setShadow(i, this.shadows.matrices[i]);
    const s = this.shadows.splits;
    u.setVec4('cascadeFar', s[0] ?? 0, s[1] ?? 0, s[2] ?? 0, s[3] ?? 0);
    this.lastPlanes = planes;
  }

  private lastPlanes: ReturnType<typeof frustumPlanes> = [];

  encode(out: GPUTextureView, v: FrameView, o: EncodeOptions): { commands: GPUCommandBuffer; stats: EncodeStats } {
    const d = this.dev.device;
    const p = this.dev.pipelines;
    const timer = this.dev.timer;
    const t = this.targets;
    if (!t) throw new Error('render targets not allocated');
    d.queue.writeBuffer(this.frameBuffer, 0, this.uniforms.data);
    this.batch.upload();
    const enc = d.createCommandEncoder({ label: `frame-${o.frameIndex}` });

    // ---- culling / service
    this.rocks.cull(enc, p.rockCull, v.camPos, this.lastPlanes, this.shadows.distance, this.profile.render.terrain_view_distance_m, timer.pass('culling_depth_service'));
    const vb = this.pool.vertexBuffer!, ib = this.pool.indexBuffer!;
    const hdrView = t.hdr.createView();
    const depthView = t.depth.createView();
    if (o.depthPrepass) {
      const pre = enc.beginRenderPass({
        label: 'depth-prepass', colorAttachments: [],
        depthStencilAttachment: { view: depthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
        timestampWrites: timer.pass('culling_depth_service'),
      });
      pre.setBindGroup(0, this.mainBindGroup);
      pre.setPipeline(p.terrainDepth);
      this.terrain.draw(pre);
      pre.setPipeline(p.meshDepth);
      pre.setVertexBuffer(0, vb);
      pre.setIndexBuffer(ib, 'uint32');
      this.batch.encode(pre, (dr) => dr.group === 'opaque');
      pre.end();
    }

    // ---- shadows
    for (let i = 0; i < this.shadows.cascades; i++) {
      const sp = enc.beginRenderPass({
        label: `csm-${i}`, colorAttachments: [],
        depthStencilAttachment: { view: this.shadows.layerViews[i], depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        timestampWrites: timer.pass('shadows'),
      });
      sp.setPipeline(p.shadowMesh);
      sp.setBindGroup(0, this.shadows.frameBindGroup, [this.shadows.offset(i)]);
      sp.setVertexBuffer(0, vb);
      sp.setIndexBuffer(ib, 'uint32');
      this.batch.encode(sp, (dr) => dr.castShadow);
      sp.setPipeline(p.shadowRocks);
      sp.setBindGroup(0, this.shadows.frameBindGroup, [this.shadows.offset(i)]);
      this.rocks.drawShadow(sp);
      sp.end();
    }

    // ---- opaque
    const main = enc.beginRenderPass({
      label: 'opaque',
      colorAttachments: [{ view: hdrView, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      depthStencilAttachment: { view: depthView, depthClearValue: 0, depthLoadOp: o.depthPrepass ? 'load' : 'clear', depthStoreOp: 'store' },
      timestampWrites: timer.pass('opaque'),
    });
    main.setBindGroup(0, this.mainBindGroup);
    main.setPipeline(p.terrain);
    this.terrain.draw(main);
    main.setPipeline(p.mesh);
    main.setVertexBuffer(0, vb);
    main.setIndexBuffer(ib, 'uint32');
    let meshDraws = this.batch.encode(main, (dr) => dr.group === 'opaque');
    main.setPipeline(p.rocks);
    this.rocks.draw(main);
    main.end();

    // ---- characters
    const ch = enc.beginRenderPass({
      label: 'character',
      colorAttachments: [{ view: hdrView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
      timestampWrites: timer.pass('character'),
    });
    ch.setBindGroup(0, this.mainBindGroup);
    ch.setPipeline(p.mesh);
    ch.setVertexBuffer(0, vb);
    ch.setIndexBuffer(ib, 'uint32');
    meshDraws += this.batch.encode(ch, (dr) => dr.group === 'character');
    ch.end();

    // ---- atmosphere and limited transparency
    const at = enc.beginRenderPass({
      label: 'atmosphere',
      colorAttachments: [{ view: hdrView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: depthView, depthLoadOp: 'load', depthStoreOp: 'store' },
      timestampWrites: timer.pass('atmosphere_transparency'),
    });
    at.setBindGroup(0, this.mainBindGroup);
    at.setPipeline(p.sky);
    at.draw(3);
    at.setBindGroup(1, this.fx.bindGroup);
    if (o.dustCount > 0) {
      at.setPipeline(p.dust);
      at.draw(6 * o.dustCount);
    }
    if (this.fx.sprites.length > 0) {
      at.setPipeline(p.sprites);
      at.draw(6 * this.fx.sprites.length);
    }
    at.end();

    // ---- post
    this.post.encode(enc, timer, out, { ao: o.ao, bloom: o.bloom });
    timer.endFrame(enc);
    return {
      commands: enc.finish(),
      stats: {
        terrainPatches: this.terrain.stats.patches,
        terrainVertices: this.terrain.stats.vertices,
        meshDraws,
        instances: this.batch.instanceCount,
        sprites: this.fx.sprites.length,
      },
    };
  }

  /**
   * Debug readback (automation only, never per frame): auto-exposure state and HDR statistics of the last frame —
   * NaN/Inf counts, luminance range, fraction of black pixels.
   */
  async debugProbe(points: [number, number][] = []): Promise<{ exposure: number[]; sun: Vec3; skyAvg: Vec3; ambient: Record<string, number[]>; samples: number[][]; hdr: { pixels: number; nan: number; inf: number; black: number; minLum: number; maxLum: number; meanLum: number } }> {
    const d = this.dev.device;
    const t = this.targets;
    if (!t) throw new Error('no targets');
    const w = t.width, h = t.height;
    const bytesPerRow = Math.ceil((w * 8) / 256) * 256;
    const buf = d.createBuffer({ size: bytesPerRow * h + 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = d.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: t.hdr }, { buffer: buf, bytesPerRow, rowsPerImage: h }, [w, h]);
    enc.copyBufferToBuffer(this.post.exposureState, 0, buf, bytesPerRow * h, 16);
    const atmoRead = d.createBuffer({ size: 192, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyBufferToBuffer(this.bake.atmo, 0, atmoRead, 0, 192);
    d.queue.submit([enc.finish()]);
    await Promise.all([buf.mapAsync(GPUMapMode.READ), atmoRead.mapAsync(GPUMapMode.READ)]);
    const atmo = new Float32Array(atmoRead.getMappedRange().slice(0));
    atmoRead.unmap();
    atmoRead.destroy();
    // Cosine-convolved SH irradiance / PI (same as lighting.wgsl shIrradiance) for a few probe normals.
    const sh = (n: Vec3): number[] => {
      const L = (k: number, c: number) => atmo[4 + k * 4 + c];
      const x = n[0], y = n[2], z = n[1];
      return [0, 1, 2].map((c) => {
        const e = 0.429043 * L(8, c) * (x * x - y * y) + 0.743125 * L(6, c) * z * z + 0.886227 * L(0, c) - 0.247708 * L(6, c)
          + 2 * 0.429043 * (L(4, c) * x * y + L(7, c) * x * z + L(5, c) * y * z) + 2 * 0.511664 * (L(3, c) * x + L(1, c) * y + L(2, c) * z);
        return Math.round(Math.max(e, 0) / Math.PI * 10000) / 10000;
      });
    };
    const raw = buf.getMappedRange();
    const u16 = new Uint16Array(raw, 0, (bytesPerRow * h) / 2);
    const exposure = [...new Float32Array(raw, bytesPerRow * h, 4)];
    const half = (x: number) => {
      const e = (x >> 10) & 31, m = x & 1023, sgn = x >> 15 ? -1 : 1;
      if (e === 31) return m ? NaN : sgn * Infinity;
      return sgn * (e ? Math.pow(2, e - 15) * (1 + m / 1024) : Math.pow(2, -14) * (m / 1024));
    };
    let nan = 0, inf = 0, black = 0, minL = Infinity, maxL = 0, sum = 0, n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * bytesPerRow) / 2 + x * 4;
        const r = half(u16[o]), g = half(u16[o + 1]), b = half(u16[o + 2]);
        if (Number.isNaN(r + g + b)) { nan++; continue; }
        if (!Number.isFinite(r + g + b)) { inf++; continue; }
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (l <= 1e-6) black++;
        minL = Math.min(minL, l); maxL = Math.max(maxL, l); sum += l; n++;
      }
    }
    const samples = points.map(([u, v]) => {
      const x = Math.min(w - 1, Math.max(0, Math.round(u * (w - 1)))), y = Math.min(h - 1, Math.max(0, Math.round(v * (h - 1))));
      const o = (y * bytesPerRow) / 2 + x * 4;
      return [half(u16[o]), half(u16[o + 1]), half(u16[o + 2])].map((c) => Math.round(c * 10000) / 10000);
    });
    buf.unmap();
    buf.destroy();
    const sd = this.scene.sun;
    const az = (sd.azimuth_deg * Math.PI) / 180;
    const ambient = {
      up: sh([0, 1, 0]), down: sh([0, -1, 0]), towardSun: sh([Math.sin(az), 0, Math.cos(az)]), awayFromSun: sh([-Math.sin(az), 0, -Math.cos(az)]),
      side: sh([Math.cos(az), 0, -Math.sin(az)]),
    };
    return { exposure, sun: this.bake.sunColor, skyAvg: this.bake.skyAvg, ambient, samples, hdr: { pixels: w * h, nan, inf, black, minLum: minL, maxLum: maxL, meanLum: n ? sum / n : 0 } };
  }

  /** Destroys profile-scoped resources. The bake is kept when `keepBake` (same bake resolution). */
  destroy(keepBake = false): void {
    this.targets?.destroy();
    this.post.destroy();
    this.fx.destroy();
    this.batch.destroy();
    this.shadows.destroy();
    this.terrain.destroy();
    this.rocks.destroy();
    this.pool.destroy();
    this.frameBuffer.destroy();
    if (!keepBake) this.bake.destroy();
  }
}

export function createDeviceSamplers(device: GPUDevice): Pick<DeviceObjects, 'linearClamp' | 'linearRepeat' | 'shadowSampler'> {
  return {
    linearClamp: device.createSampler({ label: 'linear-clamp', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }),
    linearRepeat: device.createSampler({ label: 'linear-repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' }),
    shadowSampler: device.createSampler({ label: 'csm-compare', compare: 'less', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }),
  };
}

// ---------------------------------------------------------------- biography detail props (Документ §13)
/** Small prepared props for biography details; placed at validated anchors by the app/core. */
function buildDetailMeshes(pool: GeometryPool): Record<string, ReturnType<GeometryPool['get']>> {
  const tape = new MeshBuilder();
  tape.set({ id: MAT.HAZARD, color: [0.95, 0.75, 0.1], roughness: 0.6, flags: FLAG.NO_DUST });
  tape.box([0, 0.0, 0], [0.32, 0.06, 0.012]);
  tape.box([0, 0.0, 0], [0.06, 0.3, 0.013]);
  const note = new MeshBuilder();
  note.set({ id: MAT.PAINT, color: [0.92, 0.9, 0.78], roughness: 0.8, flags: FLAG.NO_DUST });
  note.box([0, 0, 0], [0.16, 0.2, 0.006]);
  note.set({ id: MAT.DARK, color: [0.15, 0.15, 0.4], roughness: 0.6 });
  for (let i = 0; i < 4; i++) note.box([-0.01, 0.06 - i * 0.035, 0.004], [0.11, 0.008, 0.002]);
  const sealant = new MeshBuilder();
  sealant.set({ id: MAT.PAINT, color: [0.85, 0.85, 0.82], roughness: 0.5 });
  sealant.push(m4.rotationZ(Math.PI / 2));
  sealant.cylinder(0.035, -0.12, 0.12, 10);
  sealant.set({ id: MAT.PAINT, color: [0.9, 0.35, 0.1], roughness: 0.5 });
  sealant.cylinder(0.012, 0.12, 0.2, 8);
  sealant.pop();
  const tool = new MeshBuilder();
  tool.set({ id: MAT.PAINT, color: [0.85, 0.3, 0.1], roughness: 0.45 });
  tool.box([0, 0.06, 0], [0.36, 0.12, 0.22]);
  tool.set({ id: MAT.DARK, color: [0.1, 0.1, 0.1], roughness: 0.6 });
  tool.box([0, 0.13, 0], [0.16, 0.02, 0.04]);
  const mug = new MeshBuilder();
  mug.set({ id: MAT.PAINT, color: [0.2, 0.45, 0.8], roughness: 0.35, flags: FLAG.NO_DUST });
  mug.lathe([[0.045, 0], [0.047, 0.1], [0.04, 0.1], [0.038, 0.012]], 14, { capBottom: true });
  mug.push(m4.translation(0.055, 0.05, 0));
  mug.push(m4.rotationX(Math.PI / 2));
  mug.torus(0.025, 0.007, 10, 4);
  mug.pop();
  mug.pop();
  const board = new MeshBuilder();
  board.set({ id: MAT.PLATE, color: [0.3, 0.3, 0.32], roughness: 0.6, metallic: 0.5 });
  board.box([0, 0, 0], [0.7, 0.45, 0.02]);
  const toolColors: [number, number, number][] = [[0.85, 0.3, 0.1], [0.8, 0.35, 0.7], [0.85, 0.42, 0.25], [0.6, 0.6, 0.62]];
  for (let i = 0; i < 4; i++) {
    board.set({ id: MAT.PAINT, color: toolColors[i], roughness: 0.5 });
    board.box([-0.24 + i * 0.16, 0, 0.02], [0.04, 0.3, 0.02]);
  }
  const stand = new MeshBuilder();
  stand.set({ id: MAT.METAL, color: [0.55, 0.56, 0.58], roughness: 0.45, metallic: 1 });
  stand.box([0, 0.58, -0.03], [0.05, 1.16, 0.05]);
  stand.box([0, 0.02, -0.03], [0.35, 0.04, 0.3]);
  stand.set({ id: MAT.PLATE, color: [0.32, 0.32, 0.34], roughness: 0.6, metallic: 0.5 });
  stand.box([0, 1.25, -0.02], [0.42, 0.36, 0.02]);
  return {
    stand: pool.add('detail_stand', stand),
    repair_tape: pool.add('detail_repair_tape', tape),
    note: pool.add('detail_note', note),
    old_sealant: pool.add('detail_old_sealant', sealant),
    moved_tool: pool.add('detail_moved_tool', tool),
    personal_item: pool.add('detail_personal_item', mug),
    shared_tool_layout: pool.add('detail_shared_tool_layout', board),
  };
}

