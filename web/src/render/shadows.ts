// Cascaded shadow maps for dynamic and near objects (colony, rover, crew, rocks). Static terrain-on-terrain shadow is
// baked (Документ §5). Cascades are fitted to bounding spheres of the view-frustum slices and snapped to shadow-map
// texels so they do not shimmer while the camera moves.
import type { QualityProfile, Vec3 } from '../contracts.ts';
import { m4, v3, type Mat4 } from './math.ts';
import { DEPTH_FORMAT } from './pipelines.ts';

export function shadowDistanceFor(profile: QualityProfile): number {
  const c = profile.render.shadow_cascades;
  return c <= 1 ? 70 : c === 2 ? 130 : 180;
}

export class ShadowMaps {
  readonly size: number;
  readonly cascades: number;
  readonly distance: number;
  readonly texture: GPUTexture;
  readonly arrayView: GPUTextureView;
  readonly layerViews: GPUTextureView[] = [];
  readonly matrices: Mat4[] = [];
  readonly splits: number[] = [];
  readonly cascadeBuffer: GPUBuffer;
  readonly frameBindGroup: GPUBindGroup;

  constructor(device: GPUDevice, layout: GPUBindGroupLayout, frameBuffer: GPUBuffer, profile: QualityProfile) {
    this.size = Math.max(256, Math.min(4096, profile.render.shadow_map_size | 0));
    this.cascades = Math.max(1, Math.min(4, profile.render.shadow_cascades | 0));
    this.distance = shadowDistanceFor(profile);
    // At least 2 layers so the array view is a real array on every implementation.
    const layers = Math.max(2, this.cascades);
    this.texture = device.createTexture({
      label: 'csm', size: [this.size, this.size, layers], format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.arrayView = this.texture.createView({ dimension: '2d-array' });
    for (let i = 0; i < layers; i++) {
      this.layerViews.push(this.texture.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
      this.matrices.push(m4.identity());
    }
    this.cascadeBuffer = device.createBuffer({ label: 'csm-index', size: 256 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const idx = new Uint32Array(64 * 4);
    for (let i = 0; i < 4; i++) idx[i * 64] = i;
    device.queue.writeBuffer(this.cascadeBuffer, 0, idx);
    this.frameBindGroup = device.createBindGroup({
      label: 'csm-frame', layout,
      entries: [
        { binding: 0, resource: { buffer: frameBuffer } },
        { binding: 1, resource: { buffer: this.cascadeBuffer, offset: 0, size: 16 } },
      ],
    });
  }

  /** Fits the cascades to the camera frustum. */
  update(camPos: Vec3, camFwd: Vec3, fovY: number, aspect: number, near: number, sunDir: Vec3): void {
    const n = this.cascades;
    this.splits.length = 0;
    const lambda = 0.78;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const log = near * Math.pow(this.distance / near, f);
      const uni = near + (this.distance - near) * f;
      this.splits.push(lambda * log + (1 - lambda) * uni);
    }
    const th = Math.tan(fovY / 2);
    let prev = near;
    for (let i = 0; i < n; i++) {
      const far = this.splits[i];
      // Bounding sphere of the slice [prev, far]: centre on the view axis minimising the radius.
      const hn = prev * th, hf = far * th;
      const wn = hn * aspect, wf = hf * aspect;
      const dn2 = hn * hn + wn * wn, df2 = hf * hf + wf * wf;
      let z = (far * far - prev * prev + df2 - dn2) / (2 * (far - prev));
      z = Math.min(Math.max(z, prev), far);
      const radius0 = Math.sqrt(Math.max((far - z) ** 2 + df2, (z - prev) ** 2 + dn2));
      // Quantise the radius so the projection scale only changes in discrete steps.
      const radius = Math.ceil(radius0 / 2) * 2;
      const center = v3.madd(camPos, camFwd, z);
      const back = radius * 2.5;
      const eye = v3.madd(center, sunDir, back);
      const view = m4.lookAt(eye, center, [0, 1, 0]);
      // Snap the centre to the shadow-map texel grid in light space.
      const texel = (2 * radius) / this.size;
      const lc = m4.transformPoint(view, center);
      const sx = Math.round(lc[0] / texel) * texel - lc[0];
      const sy = Math.round(lc[1] / texel) * texel - lc[1];
      const proj = m4.ortho(-radius + sx, radius + sx, -radius + sy, radius + sy, 0.1, back + radius * 2);
      this.matrices[i] = m4.multiply(proj, view);
      prev = far;
    }
  }

  /** Dynamic offset of the cascade index uniform for cascade i. */
  offset(i: number): number { return i * 256; }

  destroy(): void {
    this.texture.destroy();
    this.cascadeBuffer.destroy();
  }
}
