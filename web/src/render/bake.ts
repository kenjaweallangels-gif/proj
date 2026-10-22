// Scene bake: runs once per load (and after device loss / profile change) with honest progress — every step is
// submitted and awaited before progress advances (Документ §7: honest progress for first-time preparation).
import type { QualityProfile, SceneLayout, Vec3 } from '../contracts.ts';
import { SHADERS } from './shaders.ts';
import { TerrainSampler } from './terrain_cpu.ts';
import { deg, dirFromLayoutAngle, sunDirection } from './math.ts';

export const SKY_LUT_SIZE: [number, number] = [256, 128];
export const ATMO_BYTES = 192;

export interface TerrainBake {
  res: number;
  levels: [number, number, number];
  center: [number, number];
  height: GPUTexture;
  normal: GPUTexture;
  light: GPUTexture;
  mat: GPUTexture;
  rawMask: GPUTexture;
  skyLut: GPUTexture;
  atmo: GPUBuffer;
  /** Sun irradiance at the ground (rgb) as computed by the GPU bake (for exposure). */
  sunColor: Vec3;
  skyAvg: Vec3;
  cpu: TerrainSampler;
  paths: PathSegment[];
  bakeParams: GPUBuffer;
  pathBuffer: GPUBuffer;
  destroy(): void;
}

export interface PathSegment { a: [number, number]; b: [number, number]; halfWidth: number; kind: 'track' | 'foot' }

export type ProgressFn = (fraction: number, message: string) => void;

/** Rover tracks and footpaths derived from the layout (rocks avoid them; the terrain shader darkens them). */
export function colonyPaths(scene: SceneLayout): PathSegment[] {
  const sp = scene.zone_stand_points;
  const polyline = (pts: [number, number][], halfWidth: number, kind: PathSegment['kind']): PathSegment[] =>
    pts.slice(1).map((b, i) => ({ a: pts[i], b, halfWidth, kind }));
  const xz = (v: Vec3 | undefined, fallback: [number, number]): [number, number] => (v ? [v[0], v[2]] : fallback);
  const rover = scene.props.find((p) => p.kind === 'rover');
  const roverXZ: [number, number] = rover ? [rover.position[0], rover.position[2]] : [34, 19];
  const cave = scene.terrain.cave_mouth;
  const caveXZ: [number, number] = [cave.position[0], cave.position[2]];
  const face = dirFromLayoutAngle(cave.facing_deg);
  const inside: [number, number] = [caveXZ[0] - face[0] * 14, caveXZ[1] - face[2] * 14];
  const front: [number, number] = [caveXZ[0] + face[0] * 16, caveXZ[1] + face[2] * 16];
  const segs: PathSegment[] = [];
  // Rover track: garage -> rover park -> along the valley floor to the cave and into the tube.
  segs.push(...polyline([xz(sp.garage, [21, 15.5]), roverXZ, [16, 36], [-30, 55], [-90, 62], front, caveXZ, inside], 1.9, 'track'));
  // Rover track out toward the valley (wide view direction).
  segs.push(...polyline([roverXZ, [62, 44], [140, 118], [260, 205]], 1.9, 'track'));
  // Footpaths between the airlock, the surface stand point, the light mast and the solar field.
  segs.push(...polyline([xz(sp.airlock_a, [16.5, 1.5]), xz(sp.surface, [24, 2]), [30, -4], [27, -13]], 0.9, 'foot'));
  segs.push(...polyline([xz(sp.hab_main, [1.5, 4.2]), xz(sp.niche_a, [-4.2, 8.4])], 0.8, 'foot'));
  segs.push(...polyline([xz(sp.hab_main, [1.5, 4.2]), xz(sp.niche_b, [4.2, 8.4])], 0.8, 'foot'));
  segs.push(...polyline([xz(sp.lab_geo, [-12, 0.5]), [-24, 16]], 0.8, 'foot'));
  segs.push(...polyline([xz(sp.surface, [24, 2]), xz(sp.garage, [21, 15.5])], 0.9, 'foot'));
  return segs;
}

export function bakeLevels(scene: SceneLayout): [number, number, number] {
  const half = scene.terrain.size_m / 2;
  return [half, half / 4, half / 16];
}

function writeBakeParams(scene: SceneLayout, res: number, level: number, rowOffset: number, pathCount: number): ArrayBuffer {
  const buf = new ArrayBuffer(128);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const t = scene.terrain;
  const levels = bakeLevels(scene);
  const axis = dirFromLayoutAngle(t.valley_axis_deg);
  const face = dirFromLayoutAngle(t.cave_mouth.facing_deg);
  const sun = sunDirection(scene.sun.azimuth_deg, scene.sun.elevation_deg);
  f.set([levels[0], levels[1], levels[2], res], 0);
  f.set([t.flatten_center[0], t.flatten_center[1], t.flatten_radius_m, t.flatten_falloff_m], 4);
  f.set([axis[0], axis[2], t.valley_width_m, t.height_scale_m], 8);
  f.set([t.crater.center[0], t.crater.center[1], t.crater.radius_m, 0], 12);
  f.set([t.cave_mouth.position[0], t.cave_mouth.position[2], t.cave_mouth.width_m, t.cave_mouth.height_m], 16);
  f.set([face[0], face[2], t.cave_mouth.position[1], t.cave_mouth.height_m * 2.4], 20);
  f.set([sun[0], sun[1], sun[2], Math.tan(deg(scene.sun.elevation_deg))], 24);
  u.set([scene.seed >>> 0, level, pathCount, rowOffset], 28);
  return buf;
}

/** Cave cliff (lava bench) height used by the bake, exported so the cave mesh matches it. */
export function caveBenchHeight(scene: SceneLayout): number {
  return scene.terrain.cave_mouth.height_m * 2.4;
}

export async function bakeScene(device: GPUDevice, profile: QualityProfile, scene: SceneLayout, progress: ProgressFn): Promise<TerrainBake> {
  const res = Math.max(128, Math.min(2048, profile.render.bake_resolution | 0));
  const levels = bakeLevels(scene);
  const center: [number, number] = [scene.terrain.flatten_center[0], scene.terrain.flatten_center[1]];
  const paths = colonyPaths(scene);
  const bands = Math.max(1, res / 128);
  const bandRows = res / bands;

  const tex = (label: string, format: GPUTextureFormat, extraUsage = 0): GPUTexture => device.createTexture({
    label, format, size: [res, res, 3], dimension: '2d',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | extraUsage,
  });
  const height = tex('terrain-height', 'r32float', GPUTextureUsage.COPY_SRC);
  const rawMask = tex('terrain-rawmask', 'rgba8unorm');
  const normal = tex('terrain-normal', 'rgba8snorm');
  const light = tex('terrain-light', 'rgba8unorm');
  const mat = tex('terrain-mat', 'rgba8unorm');
  const skyLut = device.createTexture({
    label: 'sky-lut', format: 'rgba16float', size: SKY_LUT_SIZE,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  const atmo = device.createBuffer({ label: 'atmo', size: ATMO_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

  // Path segments: vec4 ab + vec4 w.
  const pathData = new Float32Array(Math.max(1, paths.length) * 8);
  paths.forEach((p, i) => pathData.set([p.a[0], p.a[1], p.b[0], p.b[1], p.halfWidth, p.kind === 'track' ? 0 : 1, 0, 0], i * 8));
  const pathBuffer = device.createBuffer({ label: 'bake-paths', size: pathData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(pathBuffer, 0, pathData);

  // One uniform block per (level, band), 256-byte aligned in one buffer.
  const blocks = 3 * bands;
  const bakeParams = device.createBuffer({ label: 'bake-params', size: blocks * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  for (let l = 0; l < 3; l++) for (let b = 0; b < bands; b++) {
    device.queue.writeBuffer(bakeParams, (l * bands + b) * 256, writeBakeParams(scene, res, l, b * bandRows, paths.length));
  }
  const block = (l: number, b: number): GPUBufferBinding => ({ buffer: bakeParams, offset: (l * bands + b) * 256, size: 128 });

  const mk = (code: string, label: string, entryPoint = 'main') =>
    device.createComputePipelineAsync({ label, layout: 'auto', compute: { module: device.createShaderModule({ label, code }), entryPoint } });
  const skyModule = device.createShaderModule({ label: 'bake-sky', code: SHADERS.bakeSky });
  const [pHeight, pDerive, pLight, pSkyLut, pSkyInt] = await Promise.all([
    mk(patchRowOffset(SHADERS.bakeHeight), 'bake-height'),
    mk(patchRowOffset(SHADERS.bakeDerive), 'bake-derive'),
    mk(patchRowOffset(SHADERS.bakeLight), 'bake-light'),
    device.createComputePipelineAsync({ label: 'bake-sky-lut', layout: 'auto', compute: { module: skyModule, entryPoint: 'lutMain' } }),
    device.createComputePipelineAsync({ label: 'bake-sky-int', layout: 'auto', compute: { module: skyModule, entryPoint: 'integrateMain' } }),
  ]);

  const arrayView = (t: GPUTexture) => t.createView({ dimension: '2d-array' });
  const steps: { weight: number; message: string; run: (enc: GPUCommandEncoder) => void }[] = [];
  const groupsX = Math.ceil(res / 8);
  const groupsY = Math.ceil(bandRows / 8);
  for (let l = 0; l < 3; l++) for (let b = 0; b < bands; b++) {
    const bg = device.createBindGroup({
      layout: pHeight.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: block(l, b) },
        { binding: 2, resource: arrayView(height) },
        { binding: 3, resource: arrayView(rawMask) },
      ],
    });
    steps.push({ weight: 1, message: `Рельеф: уровень ${l + 1}/3`, run: (enc) => {
      const pass = enc.beginComputePass({ label: 'bake-height' });
      pass.setPipeline(pHeight); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(groupsX, groupsY); pass.end();
    } });
  }
  for (let l = 0; l < 3; l++) for (let b = 0; b < bands; b++) {
    const bg = device.createBindGroup({
      layout: pDerive.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: block(l, b) },
        { binding: 2, resource: arrayView(height) },
        { binding: 3, resource: arrayView(rawMask) },
        { binding: 4, resource: arrayView(normal) },
        { binding: 5, resource: arrayView(mat) },
      ],
    });
    steps.push({ weight: 0.3, message: `Нормали и материалы: уровень ${l + 1}/3`, run: (enc) => {
      const pass = enc.beginComputePass({ label: 'bake-derive' });
      pass.setPipeline(pDerive); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(groupsX, groupsY); pass.end();
    } });
  }
  for (let l = 0; l < 3; l++) for (let b = 0; b < bands; b++) {
    const bg = device.createBindGroup({
      layout: pLight.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: block(l, b) },
        { binding: 1, resource: { buffer: pathBuffer } },
        { binding: 2, resource: arrayView(height) },
        { binding: 3, resource: arrayView(rawMask) },
        { binding: 4, resource: arrayView(light) },
      ],
    });
    steps.push({ weight: 4, message: `Запекание солнца и AO: уровень ${l + 1}/3`, run: (enc) => {
      const pass = enc.beginComputePass({ label: 'bake-light' });
      pass.setPipeline(pLight); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(groupsX, groupsY); pass.end();
    } });
  }

  // Sky: LUT then its integrals (SH ambient, sun colour).
  const sun = sunDirection(scene.sun.azimuth_deg, scene.sun.elevation_deg);
  const skyParams = device.createBuffer({ label: 'sky-params', size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sunTop = scene.sun.illuminance / 50;
  device.queue.writeBuffer(skyParams, 0, new Float32Array([sun[0], sun[1], sun[2], sunTop, 0.24, 0.13, 0.07, SKY_LUT_SIZE[0], SKY_LUT_SIZE[0], SKY_LUT_SIZE[1], 0, 0]));
  const bgSkyLut = device.createBindGroup({
    layout: pSkyLut.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: skyParams } }, { binding: 1, resource: skyLut.createView() }],
  });
  const bgSkyInt = device.createBindGroup({
    layout: pSkyInt.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: skyParams } }, { binding: 2, resource: skyLut.createView() }, { binding: 3, resource: { buffer: atmo } }],
  });
  steps.push({ weight: 1, message: 'Небо Марса: таблица рассеяния', run: (enc) => {
    const pass = enc.beginComputePass({ label: 'bake-sky-lut' });
    pass.setPipeline(pSkyLut); pass.setBindGroup(0, bgSkyLut);
    pass.dispatchWorkgroups(Math.ceil(SKY_LUT_SIZE[0] / 8), Math.ceil(SKY_LUT_SIZE[1] / 8)); pass.end();
  } });
  steps.push({ weight: 0.3, message: 'Небо Марса: освещённость', run: (enc) => {
    const pass = enc.beginComputePass({ label: 'bake-sky-int' });
    pass.setPipeline(pSkyInt); pass.setBindGroup(0, bgSkyInt); pass.dispatchWorkgroups(1); pass.end();
  } });

  const total = steps.reduce((s, x) => s + x.weight, 0) + 1;
  let done = 0;
  for (const step of steps) {
    progress(done / total, step.message);
    const enc = device.createCommandEncoder({ label: step.message });
    step.run(enc);
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
    done += step.weight;
  }

  // Read back heights (for CPU placement and CDLOD bounds) and the atmosphere integrals.
  progress(done / total, 'Чтение карты высот');
  const bytesPerRow = res * 4;
  const readback = device.createBuffer({ label: 'height-readback', size: bytesPerRow * res * 3 + ATMO_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const enc = device.createCommandEncoder({ label: 'bake-readback' });
  for (let l = 0; l < 3; l++) {
    enc.copyTextureToBuffer({ texture: height, origin: [0, 0, l] }, { buffer: readback, offset: l * bytesPerRow * res, bytesPerRow, rowsPerImage: res }, [res, res, 1]);
  }
  enc.copyBufferToBuffer(atmo, 0, readback, bytesPerRow * res * 3, ATMO_BYTES);
  device.queue.submit([enc.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const all = new Float32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  readback.destroy();
  skyParams.destroy();
  const heights = [0, 1, 2].map((l) => all.slice(l * res * res, (l + 1) * res * res));
  const atmoF = all.subarray(res * res * 3);
  const sunColor: Vec3 = [atmoF[0], atmoF[1], atmoF[2]];
  const skyAvg: Vec3 = [atmoF[40], atmoF[41], atmoF[42]];
  progress(1, 'Запекание завершено');

  return {
    res, levels, center, height, normal, light, mat, rawMask, skyLut, atmo, sunColor, skyAvg,
    cpu: new TerrainSampler(res, levels, center, heights),
    paths, bakeParams, pathBuffer,
    destroy() {
      for (const t of [height, normal, light, mat, rawMask, skyLut]) t.destroy();
      atmo.destroy(); bakeParams.destroy(); pathBuffer.destroy();
    },
  };
}

/** Banded dispatch: the y invocation id is offset by info.w rows. */
function patchRowOffset(code: string): string {
  return code.replace(
    /@compute @workgroup_size\(8, 8\)\nfn main\(@builtin\(global_invocation_id\) gid: vec3u\) \{/,
    '@compute @workgroup_size(8, 8)\nfn main(@builtin(global_invocation_id) gid0: vec3u) {\n  let gid = vec3u(gid0.x, gid0.y + P.info.w, gid0.z);',
  );
}
