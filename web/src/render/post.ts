// Render targets and the post chain: half-resolution AO, bloom (downsampled mip chain), AgX tonemapping with
// exposure, FXAA at internal resolution, spatial Lanczos upscale to the canvas (Документ §5).
import type { GpuTimer } from '../gpu/timing.ts';
import { AO_FORMAT, DEPTH_FORMAT, HDR_FORMAT, LDR_FORMAT, type Pipelines } from './pipelines.ts';

export const BLOOM_LEVELS = 5;

export class RenderTargets {
  readonly width: number;
  readonly height: number;
  readonly hdr: GPUTexture;
  readonly depth: GPUTexture;
  readonly ao: GPUTexture;
  readonly bloom: GPUTexture;
  readonly ldr: GPUTexture;
  readonly ldr2: GPUTexture;
  readonly bloomLevels: number;

  constructor(device: GPUDevice, width: number, height: number) {
    this.width = Math.max(1, width | 0);
    this.height = Math.max(1, height | 0);
    const rt = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    this.hdr = device.createTexture({ label: 'rt-hdr', size: [this.width, this.height], format: HDR_FORMAT, usage: rt });
    this.depth = device.createTexture({ label: 'rt-depth', size: [this.width, this.height], format: DEPTH_FORMAT, usage: rt });
    const hw = Math.max(1, this.width >> 1), hh = Math.max(1, this.height >> 1);
    this.ao = device.createTexture({ label: 'rt-ao', size: [hw, hh], format: AO_FORMAT, usage: rt });
    this.bloomLevels = Math.max(1, Math.min(BLOOM_LEVELS, Math.floor(Math.log2(Math.min(hw, hh))) - 1));
    this.bloom = device.createTexture({ label: 'rt-bloom', size: [hw, hh], format: HDR_FORMAT, usage: rt, mipLevelCount: this.bloomLevels });
    this.ldr = device.createTexture({ label: 'rt-ldr', size: [this.width, this.height], format: LDR_FORMAT, usage: rt });
    this.ldr2 = device.createTexture({ label: 'rt-ldr2', size: [this.width, this.height], format: LDR_FORMAT, usage: rt });
  }

  destroy(): void {
    for (const t of [this.hdr, this.depth, this.ao, this.bloom, this.ldr, this.ldr2]) t.destroy();
  }
}

export interface PostConfig { ao: boolean; bloom: boolean }

/** Owns the post pipelines' bind groups for a given set of targets. */
export class PostChain {
  private readonly device: GPUDevice;
  private readonly p: Pipelines;
  private readonly frameBuffer: GPUBuffer;
  private readonly linear: GPUSampler;
  private readonly params: GPUBuffer;
  private readonly dummyAo: GPUTexture;
  private readonly dummyBloom: GPUTexture;
  private targets: RenderTargets | null = null;
  private bgAo: GPUBindGroup | null = null;
  private bgDown: GPUBindGroup[] = [];
  private bgUp: GPUBindGroup[] = [];
  private bgTonemap: GPUBindGroup[] = [];
  private bgFxaa: GPUBindGroup | null = null;
  private bgUpscale: GPUBindGroup | null = null;

  constructor(device: GPUDevice, pipelines: Pipelines, frameBuffer: GPUBuffer) {
    this.device = device;
    this.p = pipelines;
    this.frameBuffer = frameBuffer;
    this.linear = device.createSampler({ label: 'post-linear', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.params = device.createBuffer({ label: 'post-params', size: 256 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.dummyAo = device.createTexture({ label: 'dummy-ao', size: [1, 1], format: AO_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.dummyBloom = device.createTexture({ label: 'dummy-bloom', size: [1, 1], format: HDR_FORMAT, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    // rg16float (1.0, 1e4): "no occlusion" at any depth.
    device.queue.writeTexture({ texture: this.dummyAo }, new Uint16Array([0x3c00, 0x70e2]), { bytesPerRow: 4 }, [1, 1]);
    device.queue.writeTexture({ texture: this.dummyBloom }, new Uint16Array(4), { bytesPerRow: 8 }, [1, 1]);
  }

  setTargets(t: RenderTargets): void {
    this.targets = t;
    const d = this.device;
    const depthView = t.depth.createView({ aspect: 'depth-only' });
    const hw = t.ao.width, hh = t.ao.height;
    this.bgAo = d.createBindGroup({
      label: 'bg-ao', layout: this.p.ao.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.frameBuffer } }, { binding: 3, resource: depthView }],
    });
    // Bloom: params block i (down), 8 + i (up).
    const blocks = new Float32Array(16 * 64);
    this.bgDown = [];
    this.bgUp = [];
    for (let i = 0; i < t.bloomLevels; i++) {
      const srcW = i === 0 ? t.width : Math.max(1, hw >> (i - 1));
      const srcH = i === 0 ? t.height : Math.max(1, hh >> (i - 1));
      blocks.set([1 / srcW, 1 / srcH, i === 0 ? 1 : 0, 0], i * 64);
      const src = i === 0 ? t.hdr.createView() : t.bloom.createView({ baseMipLevel: i - 1, mipLevelCount: 1 });
      this.bgDown.push(d.createBindGroup({
        label: `bg-bloom-down-${i}`, layout: this.p.bloomDown.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: src },
          { binding: 2, resource: this.linear },
          { binding: 6, resource: { buffer: this.params, offset: i * 256, size: 16 } },
        ],
      }));
    }
    for (let i = t.bloomLevels - 1; i >= 1; i--) {
      const w = Math.max(1, hw >> i), h = Math.max(1, hh >> i);
      blocks.set([1 / w, 1 / h, 1.0, 1.0], (8 + i) * 64);
      this.bgUp[i] = d.createBindGroup({
        label: `bg-bloom-up-${i}`, layout: this.p.bloomUp.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: t.bloom.createView({ baseMipLevel: i, mipLevelCount: 1 }) },
          { binding: 2, resource: this.linear },
          { binding: 6, resource: { buffer: this.params, offset: (8 + i) * 256, size: 16 } },
        ],
      }));
    }
    d.queue.writeBuffer(this.params, 0, blocks);
    // Tonemap variants: [ao off/bloom off, ao on/bloom off, ao off/bloom on, ao on/bloom on]
    this.bgTonemap = [];
    for (let k = 0; k < 4; k++) {
      const useAo = (k & 1) !== 0, useBloom = (k & 2) !== 0;
      this.bgTonemap.push(d.createBindGroup({
        label: `bg-tonemap-${k}`, layout: this.p.tonemap.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.frameBuffer } },
          { binding: 1, resource: t.hdr.createView() },
          { binding: 2, resource: this.linear },
          { binding: 3, resource: depthView },
          { binding: 4, resource: useAo ? t.ao.createView() : this.dummyAo.createView() },
          { binding: 5, resource: useBloom ? t.bloom.createView({ baseMipLevel: 0, mipLevelCount: 1 }) : this.dummyBloom.createView() },
        ],
      }));
    }
    this.bgFxaa = d.createBindGroup({
      label: 'bg-fxaa', layout: this.p.fxaa.getBindGroupLayout(0),
      entries: [{ binding: 1, resource: t.ldr.createView() }, { binding: 2, resource: this.linear }],
    });
    this.bgUpscale = d.createBindGroup({
      label: 'bg-upscale', layout: this.p.upscale.getBindGroupLayout(0),
      entries: [{ binding: 1, resource: t.ldr2.createView() }],
    });
  }

  private fullscreen(enc: GPUCommandEncoder, label: string, view: GPUTextureView, pipeline: GPURenderPipeline, bg: GPUBindGroup, timer: GpuTimer, load = false, blendConstant?: number): void {
    const pass = enc.beginRenderPass({
      label,
      colorAttachments: [{ view, loadOp: load ? 'load' : 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
      timestampWrites: timer.pass('ao_reflections_post_ui'),
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    if (blendConstant !== undefined) pass.setBlendConstant([blendConstant, blendConstant, blendConstant, blendConstant]);
    pass.draw(3);
    pass.end();
  }

  encode(enc: GPUCommandEncoder, timer: GpuTimer, out: GPUTextureView, cfg: PostConfig): void {
    const t = this.targets;
    if (!t || !this.bgFxaa || !this.bgUpscale || !this.bgAo) return;
    if (cfg.ao) this.fullscreen(enc, 'ao-half', t.ao.createView(), this.p.ao, this.bgAo, timer);
    if (cfg.bloom) {
      for (let i = 0; i < t.bloomLevels; i++) {
        this.fullscreen(enc, `bloom-down-${i}`, t.bloom.createView({ baseMipLevel: i, mipLevelCount: 1 }), this.p.bloomDown, this.bgDown[i], timer);
      }
      for (let i = t.bloomLevels - 1; i >= 1; i--) {
        // The last pass also normalises the accumulated sum of all levels (blend constant 1 / levels).
        this.fullscreen(enc, `bloom-up-${i}`, t.bloom.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }), this.p.bloomUp, this.bgUp[i], timer, true, i === 1 ? 1 / t.bloomLevels : 1);
      }
    }
    const k = (cfg.ao ? 1 : 0) | (cfg.bloom ? 2 : 0);
    this.fullscreen(enc, 'tonemap', t.ldr.createView(), this.p.tonemap, this.bgTonemap[k], timer);
    this.fullscreen(enc, 'fxaa', t.ldr2.createView(), this.p.fxaa, this.bgFxaa, timer);
    this.fullscreen(enc, 'upscale', out, this.p.upscale, this.bgUpscale, timer);
  }

  destroy(): void {
    this.params.destroy();
    this.dummyAo.destroy();
    this.dummyBloom.destroy();
  }
}
