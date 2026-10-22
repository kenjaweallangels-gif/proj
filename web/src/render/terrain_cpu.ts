// CPU copy of the baked heightfield (read back once after the bake) for placing actors/props, camera ground
// clearance and CDLOD bounding boxes. Sampling mirrors shaders/terrain_sample.wgsl exactly.
import { smoothstep } from './math.ts';

export class TerrainSampler {
  readonly res: number;
  readonly levels: [number, number, number];
  readonly center: [number, number];
  readonly heights: Float32Array[];
  /** Per-level min/max pyramids for conservative node bounds: mips[level][mip] = Float32Array(2 * n * n). */
  private readonly minMax: Float32Array[][] = [];

  constructor(res: number, levels: [number, number, number], center: [number, number], heights: Float32Array[]) {
    this.res = res;
    this.levels = levels;
    this.center = center;
    this.heights = heights;
    for (const h of heights) this.minMax.push(buildMinMax(h, res));
  }

  private levelHeight(x: number, z: number, level: number): number {
    const half = this.levels[level];
    const res = this.res;
    const tx = ((x - this.center[0] + half) / (2 * half)) * res - 0.5;
    const tz = ((z - this.center[1] + half) / (2 * half)) * res - 0.5;
    const fx = Math.floor(tx), fz = Math.floor(tz);
    const ax = tx - fx, az = tz - fz;
    const h = this.heights[level];
    const cl = (v: number) => (v < 0 ? 0 : v > res - 1 ? res - 1 : v);
    const x0 = cl(fx), x1 = cl(fx + 1), z0 = cl(fz), z1 = cl(fz + 1);
    const h00 = h[z0 * res + x0], h10 = h[z0 * res + x1], h01 = h[z1 * res + x0], h11 = h[z1 * res + x1];
    return (h00 * (1 - ax) + h10 * ax) * (1 - az) + (h01 * (1 - ax) + h11 * ax) * az;
  }

  heightAt(x: number, z: number): number {
    const m = Math.max(Math.abs(x - this.center[0]), Math.abs(z - this.center[1]));
    let fine = 0, w = 1;
    for (let i = 2; i >= 1; i--) {
      const half = this.levels[i];
      if (m < half * 0.97) { fine = i; w = 1 - smoothstep(half * 0.84, half * 0.97, m); break; }
    }
    let h = this.levelHeight(x, z, fine);
    if (w < 1 && fine > 0) h = this.levelHeight(x, z, fine - 1) * (1 - w) + h * w;
    return h;
  }

  /** Conservative [min, max] height over an axis-aligned square (x0, z0, size). */
  rangeOver(x0: number, z0: number, size: number): [number, number] {
    // Use the finest level that contains the square entirely, at a mip whose cells are >= size / 2.
    const cx = x0 + size / 2 - this.center[0], cz = z0 + size / 2 - this.center[1];
    const ext = Math.max(Math.abs(cx), Math.abs(cz)) + size / 2;
    let level = 0;
    for (let i = 2; i >= 1; i--) if (ext < this.levels[i]) { level = i; break; }
    const half = this.levels[level];
    const texel = (2 * half) / this.res;
    const mips = this.minMax[level];
    let mip = 0;
    while (mip < mips.length - 1 && texel * (1 << mip) < size / 2) mip++;
    const n = this.res >> mip;
    const cell = texel * (1 << mip);
    const ix0 = Math.max(0, Math.floor((x0 - this.center[0] + half) / cell));
    const iz0 = Math.max(0, Math.floor((z0 - this.center[1] + half) / cell));
    const ix1 = Math.min(n - 1, Math.floor((x0 + size - this.center[0] + half) / cell));
    const iz1 = Math.min(n - 1, Math.floor((z0 + size - this.center[1] + half) / cell));
    let lo = Infinity, hi = -Infinity;
    const mm = mips[mip];
    for (let z = iz0; z <= iz1; z++) {
      for (let x = ix0; x <= ix1; x++) {
        const i = (z * n + x) * 2;
        if (mm[i] < lo) lo = mm[i];
        if (mm[i + 1] > hi) hi = mm[i + 1];
      }
    }
    if (!Number.isFinite(lo)) return [-50, 1200];
    // Coarser levels blend toward finer detail near their borders: pad for the difference.
    const pad = level === 2 ? 1.5 : level === 1 ? 6 : 25;
    return [lo - pad, hi + pad];
  }
}

function buildMinMax(h: Float32Array, res: number): Float32Array[] {
  const mips: Float32Array[] = [];
  let n = res;
  let cur = new Float32Array(n * n * 2);
  for (let i = 0; i < n * n; i++) { cur[i * 2] = h[i]; cur[i * 2 + 1] = h[i]; }
  // Include the bilinear neighbour so cell bounds cover interpolation to the next texel.
  const dil = new Float32Array(n * n * 2);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      let lo = Infinity, hi = -Infinity;
      for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) {
        const xx = Math.min(n - 1, x + dx), zz = Math.min(n - 1, z + dz);
        const v = h[zz * n + xx];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      dil[(z * n + x) * 2] = lo;
      dil[(z * n + x) * 2 + 1] = hi;
    }
  }
  cur = dil;
  mips.push(cur);
  while (n > 1) {
    const m = n >> 1;
    const next = new Float32Array(m * m * 2);
    for (let z = 0; z < m; z++) {
      for (let x = 0; x < m; x++) {
        let lo = Infinity, hi = -Infinity;
        for (let dz = 0; dz < 2; dz++) for (let dx = 0; dx < 2; dx++) {
          const i = ((z * 2 + dz) * n + x * 2 + dx) * 2;
          if (cur[i] < lo) lo = cur[i];
          if (cur[i + 1] > hi) hi = cur[i + 1];
        }
        next[(z * m + x) * 2] = lo;
        next[(z * m + x) * 2 + 1] = hi;
      }
    }
    mips.push(next);
    cur = next;
    n = m;
  }
  return mips;
}
