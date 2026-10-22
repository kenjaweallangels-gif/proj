// CPU mirror of `struct Frame` in shaders/common.wgsl (byte offsets must match the WGSL uniform layout).
import type { Vec3 } from '../contracts.ts';
import type { Mat4 } from './math.ts';

export const MAX_LIGHTS = 24;
export const MAX_MODULES = 16;
export const FRAME_SIZE = 2480;

const OFF = {
  viewProj: 0,
  view: 64,
  proj: 128,
  invViewProj: 192,
  shadowViewProj: 256,
  cascadeFar: 512,
  camPos: 528,
  camFwd: 544,
  sunDir: 560,
  viewport: 576,
  fog: 592,
  post: 608,
  scene: 624,
  counts: 640,
  terrainLevels: 656,
  terrainInfo: 672,
  lights: 688,
  modules: 2224,
} as const;

export interface LightDesc {
  pos: Vec3;
  range: number;
  color: Vec3;       // linear intensity (scene units)
  spot?: { dir: Vec3; outerDeg: number; innerDeg: number };
  flicker?: number;  // 0..1
}

export class FrameUniforms {
  readonly data = new ArrayBuffer(FRAME_SIZE);
  readonly f32 = new Float32Array(this.data);
  readonly u32 = new Uint32Array(this.data);
  lightCount = 0;

  setMat(name: 'viewProj' | 'view' | 'proj' | 'invViewProj', m: Mat4): void {
    this.f32.set(m, OFF[name] / 4);
  }

  setShadow(i: number, m: Mat4): void {
    this.f32.set(m, OFF.shadowViewProj / 4 + i * 16);
  }

  setVec4(name: 'cascadeFar' | 'camPos' | 'camFwd' | 'sunDir' | 'viewport' | 'fog' | 'post' | 'scene' | 'terrainLevels' | 'terrainInfo', x: number, y: number, z: number, w: number): void {
    const o = OFF[name] / 4;
    this.f32[o] = x; this.f32[o + 1] = y; this.f32[o + 2] = z; this.f32[o + 3] = w;
  }

  setCounts(lights: number, modules: number, frameIndex: number, flags: number): void {
    const o = OFF.counts / 4;
    this.u32[o] = lights; this.u32[o + 1] = modules; this.u32[o + 2] = frameIndex >>> 0; this.u32[o + 3] = flags >>> 0;
  }

  setLights(lights: LightDesc[]): number {
    const n = Math.min(lights.length, MAX_LIGHTS);
    for (let i = 0; i < n; i++) {
      const L = lights[i];
      const o = OFF.lights / 4 + i * 16;
      const f = this.f32;
      f[o] = L.pos[0]; f[o + 1] = L.pos[1]; f[o + 2] = L.pos[2]; f[o + 3] = L.range;
      f[o + 4] = L.color[0]; f[o + 5] = L.color[1]; f[o + 6] = L.color[2]; f[o + 7] = L.spot ? 1 : 0;
      if (L.spot) {
        const d = L.spot.dir;
        const len = Math.hypot(d[0], d[1], d[2]) || 1;
        f[o + 8] = d[0] / len; f[o + 9] = d[1] / len; f[o + 10] = d[2] / len;
        f[o + 11] = Math.cos((L.spot.outerDeg * Math.PI) / 180);
        f[o + 12] = Math.cos((L.spot.innerDeg * Math.PI) / 180);
      } else {
        f[o + 8] = 0; f[o + 9] = -1; f[o + 10] = 0; f[o + 11] = -1; f[o + 12] = -1;
      }
      f[o + 13] = L.flicker ?? 0; f[o + 14] = 0; f[o + 15] = 0;
    }
    this.lightCount = n;
    return n;
  }

  setModule(i: number, sealed: number, windowGlow: number, alarm: number): void {
    if (i >= MAX_MODULES) return;
    const o = OFF.modules / 4 + i * 4;
    this.f32[o] = sealed; this.f32[o + 1] = windowGlow; this.f32[o + 2] = alarm; this.f32[o + 3] = 0;
  }
}
