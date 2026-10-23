// Limited transparency (Документ §5: a separate overdraw budget): dust motes around the camera, lamp/beacon glows,
// alarm pulses at sensors, sealed-zone barriers and biography glints. CPU mirror of `FxData` in shaders/fx.wgsl.
import type { Vec3 } from '../contracts.ts';

export const SPRITE_KIND = { GLOW: 0, RING: 1, BEAM: 2, BARRIER: 3, DIAMOND: 4, GLINT: 5 } as const;
export type SpriteKind = (typeof SPRITE_KIND)[keyof typeof SPRITE_KIND];

const HEADER_FLOATS = 16;
const SPRITE_FLOATS = 12;
export const MAX_SPRITES = 256;

export interface Sprite {
  pos: Vec3;
  size: number;
  /** Linear HDR colour. */
  color: Vec3;
  intensity: number;
  kind: SpriteKind;
  phase?: number;
  /** Height for beams and barriers (m). */
  height?: number;
}

export class FxBuffer {
  readonly buffer: GPUBuffer;
  readonly bindGroup: GPUBindGroup;
  private readonly data = new Float32Array(HEADER_FLOATS + MAX_SPRITES * SPRITE_FLOATS);
  private readonly device: GPUDevice;
  readonly sprites: Sprite[] = [];
  dustCount = 0;
  /** Sprites dropped because MAX_SPRITES was exceeded this frame. */
  overflow = 0;

  constructor(device: GPUDevice, layout: GPUBindGroupLayout) {
    this.device = device;
    this.buffer = device.createBuffer({ label: 'fx-data', size: this.data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({ label: 'fx-g1', layout, entries: [{ binding: 0, resource: { buffer: this.buffer } }] });
  }

  begin(): void {
    this.sprites.length = 0;
    this.overflow = 0;
  }

  push(s: Sprite): void {
    if (this.sprites.length >= MAX_SPRITES) { this.overflow++; return; }
    this.sprites.push(s);
  }

  /** Writes header + sprites. box: half extents of the dust volume around the camera; wind in m/s. */
  upload(dustCount: number, box: Vec3, wind: Vec3, gust: number): void {
    const d = this.data;
    this.dustCount = Math.max(0, dustCount | 0);
    d.set([box[0], box[1], box[2], this.dustCount, wind[0], wind[1], wind[2], gust, 0, 0, 0, 0, this.sprites.length, 0, 0, 0], 0);
    for (let i = 0; i < this.sprites.length; i++) {
      const s = this.sprites[i];
      const o = HEADER_FLOATS + i * SPRITE_FLOATS;
      d[o] = s.pos[0]; d[o + 1] = s.pos[1]; d[o + 2] = s.pos[2]; d[o + 3] = s.size;
      d[o + 4] = s.color[0]; d[o + 5] = s.color[1]; d[o + 6] = s.color[2]; d[o + 7] = s.intensity;
      d[o + 8] = s.kind; d[o + 9] = s.phase ?? 0; d[o + 10] = s.height ?? 0; d[o + 11] = 0;
    }
    this.device.queue.writeBuffer(this.buffer, 0, d, 0, HEADER_FLOATS + this.sprites.length * SPRITE_FLOATS);
  }

  destroy(): void {
    this.buffer.destroy();
  }
}
