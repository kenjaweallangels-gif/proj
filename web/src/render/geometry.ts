// Procedural mesh building for the colony, props, rover and crew figures. Vertex format (24 bytes) matches
// shaders/mesh.wgsl: position f32x3 | normal snorm8x4 (w = AO) | colour unorm8x4 (sRGB albedo, a = roughness) |
// material u8x4 (id, module index, metallic, flags).
import type { Vec3 } from '../contracts.ts';
import { m4, v3, type Mat4 } from './math.ts';

export const VERTEX_STRIDE = 24;

export const MAT = {
  PAINT: 0, METAL: 1, DARK: 2, WINDOW: 3, SOLAR: 4, ROCK: 5, LAMP: 6, FABRIC: 7, VISOR: 8, BEACON: 9, HAZARD: 10,
  PLATE: 11, SCREEN: 12, CAVE: 13,
} as const;

export const FLAG = { ACCENT: 1, NO_DUST: 2, INTERIOR: 4 } as const;

export interface Material {
  id: number;
  color: Vec3;       // sRGB 0..1
  roughness: number;
  metallic?: number;
  flags?: number;
}

export const VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: VERTEX_STRIDE,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'snorm8x4' },
    { shaderLocation: 2, offset: 16, format: 'unorm8x4' },
    { shaderLocation: 3, offset: 20, format: 'uint8x4' },
  ],
};

export interface MeshRange { firstIndex: number; indexCount: number; baseVertex: number; radius: number; center: Vec3 }

export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private mat: number[] = [];
  private idx: number[] = [];
  private stack: Mat4[] = [];
  private cur: Mat4 = m4.identity();
  private curN: Mat4 = m4.identity();
  material: Material = { id: MAT.PAINT, color: [0.8, 0.8, 0.8], roughness: 0.5 };
  module = 255;
  ao = 1;
  /** When true, generated surfaces face inward (reversed winding and normals) — for interiors. */
  flip = false;

  get vertexCount(): number { return this.pos.length / 3; }
  get indexCount(): number { return this.idx.length; }

  set(m: Material): this { this.material = m; return this; }

  push(m: Mat4): this {
    this.stack.push(this.cur);
    this.cur = m4.multiply(this.cur, m);
    this.curN = normalMatrix(this.cur);
    return this;
  }

  pop(): this {
    this.cur = this.stack.pop() ?? m4.identity();
    this.curN = normalMatrix(this.cur);
    return this;
  }

  /** Adds a vertex in the current local frame; returns its index. */
  vertex(p: Vec3, n: Vec3, ao = this.ao): number {
    const wp = m4.transformPoint(this.cur, p);
    const wn0 = v3.norm(m4.transformDir(this.curN, n));
    const wn: Vec3 = this.flip ? [-wn0[0], -wn0[1], -wn0[2]] : wn0;
    this.pos.push(wp[0], wp[1], wp[2]);
    this.nrm.push(wn[0], wn[1], wn[2], ao);
    const m = this.material;
    this.col.push(m.color[0], m.color[1], m.color[2], m.roughness);
    this.mat.push(m.id, this.module, Math.round((m.metallic ?? 0) * 255), m.flags ?? 0);
    return this.vertexCount - 1;
  }

  tri(a: number, b: number, c: number): void {
    if (this.flip) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    if (this.flip) this.idx.push(a, c, b, a, d, c); else this.idx.push(a, b, c, a, c, d);
  }

  /** Flat-shaded quad from 4 corner points (counter-clockwise seen from the front). */
  quadP(a: Vec3, b: Vec3, c: Vec3, d: Vec3, ao = this.ao): void {
    const n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(d, a)));
    const i = [a, b, c, d].map((p) => this.vertex(p, n, ao));
    this.quad(i[0], i[1], i[2], i[3]);
  }

  /** Axis-aligned box (in the current frame) centred at c with full size s. Optional bevel-free, flat normals. */
  box(c: Vec3, s: Vec3, opts: { skip?: ('px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz')[]; aoBottom?: number; inward?: boolean } = {}): void {
    const [hx, hy, hz] = [s[0] / 2, s[1] / 2, s[2] / 2];
    const P = (x: number, y: number, z: number): Vec3 => [c[0] + x * hx, c[1] + y * hy, c[2] + z * hz];
    const skip = new Set(opts.skip ?? []);
    const aoB = opts.aoBottom ?? this.ao;
    const face = (key: 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz', n: Vec3, pts: Vec3[]) => {
      if (skip.has(key)) return;
      const nn: Vec3 = opts.inward ? [-n[0], -n[1], -n[2]] : n;
      const ids = pts.map((p) => this.vertex(p, nn, p[1] < c[1] ? aoB : this.ao));
      if (opts.inward) this.quad(ids[3], ids[2], ids[1], ids[0]); else this.quad(ids[0], ids[1], ids[2], ids[3]);
    };
    face('px', [1, 0, 0], [P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1)]);
    face('nx', [-1, 0, 0], [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)]);
    face('py', [0, 1, 0], [P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)]);
    face('ny', [0, -1, 0], [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)]);
    face('pz', [0, 0, 1], [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)]);
    face('nz', [0, 0, -1], [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)]);
  }

  /**
   * Surface of revolution around the local +Y axis. profile: [radius, y] from bottom to top. Smooth normals.
   * arc: angular range in radians (default full circle). aoFn: per-ring AO.
   */
  lathe(profile: [number, number][], segments: number, opts: { arc?: [number, number]; aoFn?: (i: number) => number; capTop?: boolean; capBottom?: boolean } = {}): void {
    const [a0, a1] = opts.arc ?? [0, Math.PI * 2];
    const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
    const cols = full ? segments : segments + 1;
    const rings: number[][] = [];
    for (let i = 0; i < profile.length; i++) {
      const [r, y] = profile[i];
      const prev = profile[Math.max(0, i - 1)], next = profile[Math.min(profile.length - 1, i + 1)];
      // Profile tangent -> normal in the (r, y) plane.
      const dr = next[0] - prev[0], dy = next[1] - prev[1];
      const len = Math.hypot(dr, dy) || 1;
      const nr = dy / len, ny = -dr / len;
      const ring: number[] = [];
      const ao = opts.aoFn ? opts.aoFn(i) : this.ao;
      for (let j = 0; j < cols; j++) {
        const a = a0 + ((a1 - a0) * j) / segments;
        const ca = Math.cos(a), sa = Math.sin(a);
        ring.push(this.vertex([r * ca, y, r * sa], [nr * ca, ny, nr * sa], ao));
      }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < segments; j++) {
        const j1 = full ? (j + 1) % segments : j + 1;
        this.quad(rings[i][j], rings[i + 1][j], rings[i + 1][j1], rings[i][j1]);
      }
    }
    const cap = (i: number, up: boolean) => {
      const [r, y] = profile[i];
      if (r <= 1e-4) return;
      const c = this.vertex([0, y, 0], [0, up ? 1 : -1, 0]);
      const ids: number[] = [];
      for (let j = 0; j < cols; j++) {
        const a = a0 + ((a1 - a0) * j) / segments;
        ids.push(this.vertex([r * Math.cos(a), y, r * Math.sin(a)], [0, up ? 1 : -1, 0]));
      }
      for (let j = 0; j < segments; j++) {
        const j1 = full ? (j + 1) % segments : j + 1;
        if (up) this.tri(c, ids[j1], ids[j]); else this.tri(c, ids[j], ids[j1]);
      }
    };
    if (opts.capTop) cap(profile.length - 1, true);
    if (opts.capBottom) cap(0, false);
  }

  /** Cylinder along local +Y from y0 to y1. */
  cylinder(r: number, y0: number, y1: number, segments: number, caps = true): void {
    this.lathe([[r, y0], [r, y1]], segments, { capTop: caps, capBottom: caps });
  }

  /** Sphere (or partial sphere via latitude range lat0..lat1 in radians, -PI/2..PI/2). */
  sphere(r: number, segments: number, rings: number, lat0 = -Math.PI / 2, lat1 = Math.PI / 2): void {
    const profile: [number, number][] = [];
    for (let i = 0; i <= rings; i++) {
      const lat = lat0 + ((lat1 - lat0) * i) / rings;
      profile.push([Math.max(r * Math.cos(lat), 1e-5), r * Math.sin(lat)]);
    }
    this.lathe(profile, segments);
  }

  /** Torus around local +Y. */
  torus(R: number, r: number, segments: number, sides: number): void {
    const grid: number[][] = [];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const row: number[] = [];
      for (let j = 0; j <= sides; j++) {
        const b = (j / sides) * Math.PI * 2;
        const n: Vec3 = [Math.cos(b) * Math.cos(a), Math.sin(b), Math.cos(b) * Math.sin(a)];
        row.push(this.vertex([(R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a)], n));
      }
      grid.push(row);
    }
    for (let i = 0; i < segments; i++) for (let j = 0; j < sides; j++) {
      this.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
    }
  }

  /** Capsule along +Y between y0 and y1 (radius r), used for limbs. */
  capsule(r: number, y0: number, y1: number, segments = 10, rings = 4): void {
    const profile: [number, number][] = [];
    for (let i = 0; i <= rings; i++) {
      const a = -Math.PI / 2 + (i / rings) * (Math.PI / 2);
      profile.push([Math.max(r * Math.cos(a), 1e-5), y0 + r * Math.sin(a)]);
    }
    for (let i = 0; i <= rings; i++) {
      const a = (i / rings) * (Math.PI / 2);
      profile.push([Math.max(r * Math.cos(a), 1e-5), y1 + r * Math.sin(a)]);
    }
    this.lathe(profile, segments);
  }

  /**
   * Displaced grid surface P[i][j] with smooth normals from the grid itself; the front face is the side of
   * cross(dP/di, dP/dj) (quads a=[i][j], b=[i+1][j], c=[i+1][j+1], d=[i][j+1] are counter-clockwise from there).
   */
  grid(P: Vec3[][], ao: (i: number, j: number) => number = () => this.ao): void {
    const ni = P.length, nj = P[0].length;
    const ids: number[][] = [];
    for (let i = 0; i < ni; i++) {
      const row: number[] = [];
      for (let j = 0; j < nj; j++) {
        const di = v3.sub(P[Math.min(ni - 1, i + 1)][j], P[Math.max(0, i - 1)][j]);
        const dj = v3.sub(P[i][Math.min(nj - 1, j + 1)], P[i][Math.max(0, j - 1)]);
        row.push(this.vertex(P[i][j], v3.norm(v3.cross(di, dj)), ao(i, j)));
      }
      ids.push(row);
    }
    const flip = this.flip;
    this.flip = false; // winding is already defined by the grid orientation
    for (let i = 0; i < ni - 1; i++) for (let j = 0; j < nj - 1; j++) this.quad(ids[i][j], ids[i + 1][j], ids[i + 1][j + 1], ids[i][j + 1]);
    this.flip = flip;
  }

  /** Thin beam between two points (square section) — struts, rails, cables. */
  beam(a: Vec3, b: Vec3, w: number): void {
    const d = v3.sub(b, a);
    const len = v3.len(d);
    if (len < 1e-5) return;
    const y = v3.scale(d, 1 / len);
    const ref: Vec3 = Math.abs(y[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const x = v3.norm(v3.cross(ref, y));
    const z = v3.cross(x, y);
    const m = new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, a[0], a[1], a[2], 1]);
    this.push(m);
    this.box([0, len / 2, 0], [w, len, w]);
    this.pop();
  }

  build(): { vertices: ArrayBuffer; indices: Uint32Array } {
    const n = this.vertexCount;
    const buf = new ArrayBuffer(n * VERTEX_STRIDE);
    const f = new Float32Array(buf);
    const i8 = new Int8Array(buf);
    const u8 = new Uint8Array(buf);
    for (let i = 0; i < n; i++) {
      const o = i * VERTEX_STRIDE;
      f[o / 4] = this.pos[i * 3]; f[o / 4 + 1] = this.pos[i * 3 + 1]; f[o / 4 + 2] = this.pos[i * 3 + 2];
      for (let k = 0; k < 4; k++) i8[o + 12 + k] = Math.round(Math.max(-1, Math.min(1, this.nrm[i * 4 + k])) * 127);
      for (let k = 0; k < 4; k++) u8[o + 16 + k] = Math.round(Math.max(0, Math.min(1, this.col[i * 4 + k])) * 255);
      for (let k = 0; k < 4; k++) u8[o + 20 + k] = this.mat[i * 4 + k] & 255;
    }
    return { vertices: buf, indices: new Uint32Array(this.idx) };
  }

  bounds(): { center: Vec3; radius: number } {
    let min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pos.length; i += 3) {
      min = [Math.min(min[0], this.pos[i]), Math.min(min[1], this.pos[i + 1]), Math.min(min[2], this.pos[i + 2])];
      max = [Math.max(max[0], this.pos[i]), Math.max(max[1], this.pos[i + 1]), Math.max(max[2], this.pos[i + 2])];
    }
    const center = v3.scale(v3.add(min, max), 0.5);
    return { center, radius: v3.len(v3.sub(max, center)) };
  }
}

function normalMatrix(m: Mat4): Mat4 {
  // Inverse-transpose of the upper 3x3 (as a mat4 for transformDir).
  const inv = m4.invert(m);
  const out = new Float32Array(16);
  out[0] = inv[0]; out[1] = inv[4]; out[2] = inv[8];
  out[4] = inv[1]; out[5] = inv[5]; out[6] = inv[9];
  out[8] = inv[2]; out[9] = inv[6]; out[10] = inv[10];
  out[15] = 1;
  return out;
}

/**
 * Geometry pool: many meshes in one vertex + index buffer (one bind, many draws with baseVertex/firstIndex).
 */
export class GeometryPool {
  private parts: { vertices: ArrayBuffer; indices: Uint32Array }[] = [];
  private vCount = 0;
  private iCount = 0;
  readonly meshes = new Map<string, MeshRange>();
  vertexBuffer: GPUBuffer | null = null;
  indexBuffer: GPUBuffer | null = null;

  add(name: string, b: MeshBuilder): MeshRange {
    const built = b.build();
    const bounds = b.bounds();
    const range: MeshRange = { firstIndex: this.iCount, indexCount: built.indices.length, baseVertex: this.vCount, radius: bounds.radius, center: bounds.center };
    this.parts.push(built);
    this.vCount += b.vertexCount;
    this.iCount += built.indices.length;
    this.meshes.set(name, range);
    return range;
  }

  get(name: string): MeshRange {
    const m = this.meshes.get(name);
    if (!m) throw new Error(`mesh ${name} missing`);
    return m;
  }

  upload(device: GPUDevice): void {
    const vb = new Uint8Array(Math.max(4, this.vCount * VERTEX_STRIDE));
    const ib = new Uint32Array(Math.max(1, this.iCount));
    let vo = 0, io = 0;
    for (const p of this.parts) {
      vb.set(new Uint8Array(p.vertices), vo);
      ib.set(p.indices, io);
      vo += p.vertices.byteLength;
      io += p.indices.length;
    }
    this.vertexBuffer = device.createBuffer({ label: 'geometry-vb', size: vb.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.indexBuffer = device.createBuffer({ label: 'geometry-ib', size: ib.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.vertexBuffer, 0, vb);
    device.queue.writeBuffer(this.indexBuffer, 0, ib);
    this.parts = [];
  }

  get stats(): { vertices: number; triangles: number } { return { vertices: this.vCount, triangles: this.iCount / 3 }; }

  destroy(): void {
    this.vertexBuffer?.destroy();
    this.indexBuffer?.destroy();
  }
}
