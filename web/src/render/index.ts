// Echo Runtime WebGPU renderer of the D0 Mars scene — the only entry point the app uses (docs/SPEC.md §8,
// web/src/contracts.ts). «Красивый мир. Устойчивый кадр.» (Документ §1, §2, §4, §5, §7, §19):
// forward PBR, baked static terrain light, cascaded shadow maps, CDLOD terrain, instanced rocks, limited transparency,
// half-resolution AO, HDR + AgX tonemapping, render scale + spatial upscale, honest GPU timing via timestamp-query.
import type {
  AdapterSummary, CameraMode, FrameSample, QualityProfile, Renderer, RendererOptions, RendererStatus, RouteOptions,
  RouteReport, SceneLayout, Vec3, WorldView,
} from '../contracts.ts';
import { acquireDevice, emptySummary, isRendererUnavailable, type GpuDeviceHandle } from '../gpu/probe.ts';
import { GpuTimer, type GpuFrameTiming } from '../gpu/timing.ts';
import { runRoute as runRouteBench, type RouteDriver } from '../bench/route.ts';
import { CameraRig, type RouteState } from './camera.ts';
import { createDeviceSamplers, GpuScene, type DeviceObjects, type FrameView } from './gpu_scene.ts';
import { createLayouts } from './layouts.ts';
import { clamp, deg, m4, sunDirection, v3 } from './math.ts';
import { createPipelines } from './pipelines.ts';
import { WorldPresenter } from './world.ts';

export type { RouteDriver };

const NEAR = 0.08;
const MAX_FRAMES_IN_FLIGHT = 2;
/** Sun disc angular radius used for shading/sky (rad). Real Mars ~0.18°, slightly enlarged for readability. */
const SUN_RADIUS = deg(0.24);

interface PendingSample { sample: FrameSample; routeT: number; segment: string; frameId: number }

interface RoutePlayback {
  startMs: number;
  scale: number; // route seconds per real second
  onSample: (s: FrameSample, routeT: number, segment: string) => void;
  onTime?: (t: number, segment: string) => void;
  done: () => void;
  /** performance.now() of the last frame of the pass (-1 while playing). */
  endMs: number;
}

/** Debug/automation surface beyond the contract (used by render-dev.html). */
export interface RendererDebugInfo {
  status: RendererStatus;
  profile: string;
  canvasSize: [number, number];
  internalSize: [number, number];
  renderScale: number;
  cameraMode: CameraMode;
  routeTime: number;
  routeSegment: string | null;
  frames: number;
  validationErrors: string[];
  timestamps: boolean;
  droppedGpuSamples: number;
  stats: Record<string, number>;
  deviceRecoveries: number;
}

export class EchoRenderer implements Renderer {
  adapter: AdapterSummary = emptySummary();
  private opts: RendererOptions;
  private profile: QualityProfile;
  private readonly scene: SceneLayout;
  private handle: GpuDeviceHandle | null = null;
  private dev: DeviceObjects | null = null;
  private gpu: GpuScene | null = null;
  private context: GPUCanvasContext | null = null;
  readonly camera: CameraRig;
  readonly presenter: WorldPresenter;
  private lastStatus: RendererStatus = { phase: 'probing' };
  private raf = 0;
  private userPaused = false;
  private hiddenPaused = false;
  private destroyed = false;
  private building = false;
  private frameIndex = 0;
  private lastFrameT = 0;
  private readonly startT = performance.now();
  private readonly createdAt = performance.now();
  private coldStart = -1;
  private framesInFlight = 0;
  private readonly pending = new Map<number, PendingSample>();
  private playback: RoutePlayback | null = null;
  private routePlaying = false;
  private cut = true;
  private renderScale: number;
  private dynScaleChangedAt = 0;
  private gpuEma = 0;
  private canvasSize: [number, number] = [1, 1];
  private internalSize: [number, number] = [1, 1];
  private readonly validationErrors: string[] = [];
  private lastStats: Record<string, number> = {};
  private recoveries = 0;
  private exposureEv = 0;
  private tonemapper: 'agx' | 'aces' = 'aces';
  private readonly onVisibility = () => this.handleVisibility();
  private readonly sunDir: Vec3;

  constructor(opts: RendererOptions) {
    this.opts = opts;
    this.profile = opts.profile;
    this.scene = opts.scene;
    this.renderScale = this.baseRenderScale();
    this.sunDir = sunDirection(opts.scene.sun.azimuth_deg, opts.scene.sun.elevation_deg);
    this.presenter = new WorldPresenter(opts.scene);
    this.camera = new CameraRig(opts.scene, (x, z) => this.gpu?.bake.cpu.heightAt(x, z) ?? 0);
    this.camera.actorHead = (id) => this.presenter.crew.headPosition(id);
  }

  // ------------------------------------------------------------------ lifecycle
  async start(): Promise<void> {
    this.status({ phase: 'probing', message: 'Проверка WebGPU' });
    await this.initDevice();
    await this.buildScene();
    this.camera.attach(this.opts.canvas);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.hiddenPaused = document.visibilityState === 'hidden';
    this.schedule();
  }

  private async initDevice(): Promise<void> {
    const handle = await acquireDevice('high-performance');
    this.handle = handle;
    this.adapter = handle.summary;
    const device = handle.device;
    device.onuncapturederror = (e: GPUUncapturedErrorEvent) => {
      const msg = e.error.message;
      if (this.validationErrors.length < 50) this.validationErrors.push(msg);
      console.error('[webgpu]', msg);
    };
    device.lost.then((info) => {
      if (this.destroyed || this.handle?.device !== device) return;
      void this.recover(info.message || String(info.reason));
    });
    if (!this.context) {
      const ctx = this.opts.canvas.getContext('webgpu');
      if (!ctx) throw new Error('canvas.getContext("webgpu") вернул null');
      this.context = ctx;
    }
    this.context.configure({ device, format: handle.format, alphaMode: 'opaque' });
    this.status({ phase: 'compiling', progress: 0, message: 'Компиляция шейдеров и конвейеров' });
    const layouts = createLayouts(device);
    const pipelines = await createPipelines(device, layouts, handle.format, (done, total) => {
      this.status({ phase: 'compiling', progress: done / total, message: `Конвейеры: ${done}/${total}` });
    });
    const timer = new GpuTimer(device, handle.hasTimestamps);
    timer.onResult = (r) => this.onGpuTiming(r);
    this.dev = { device, layouts, pipelines, timer, ...createDeviceSamplers(device) };
  }

  private async buildScene(reuseBake?: GpuScene['bake']): Promise<void> {
    const dev = this.dev!;
    this.building = true;
    try {
      this.status({ phase: 'baking', progress: 0, message: 'Подготовка сцены' });
      const gpu = await GpuScene.create(dev, this.profile, this.scene, (f, m) => this.status({ phase: 'baking', progress: f, message: m }), reuseBake);
      this.gpu = gpu;
      this.presenter.bind(gpu.colony, (x, z) => gpu.bake.cpu.heightAt(x, z));
      this.presenter.setWorld(this.presenter.view);
      this.cut = true;
      this.lastFrameT = 0;
    } finally {
      this.building = false;
    }
  }

  private async recover(message: string): Promise<void> {
    this.status({ phase: 'lost', message: `Устройство WebGPU потеряно: ${message}` });
    this.recoveries++;
    this.dropGpu(false);
    for (let attempt = 1; attempt <= 5 && !this.destroyed; attempt++) {
      this.status({ phase: 'recovering', message: `Восстановление устройства, попытка ${attempt}` });
      try {
        await this.initDevice();
        await this.buildScene();
        this.lastFrameT = 0;
        this.schedule();
        return;
      } catch (e) {
        console.warn('[renderer] recovery failed', e);
        this.dropGpu(false);
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    this.status({ phase: 'error', message: 'Не удалось восстановить устройство WebGPU' });
  }

  private dropGpu(destroyDevice: boolean): void {
    try { this.gpu?.destroy(); } catch { /* resources of a lost device */ }
    try { this.dev?.timer.destroy(); } catch { /* ignore */ }
    this.gpu = null;
    this.dev = null;
    const device = this.handle?.device;
    this.handle = null;
    this.pending.clear();
    this.framesInFlight = 0;
    if (destroyDevice) device?.destroy();
  }

  private status(s: RendererStatus): void {
    this.lastStatus = s;
    try { this.opts.onStatus?.(s); } catch (e) { console.error(e); }
  }

  // ------------------------------------------------------------------ contract API
  async setProfile(p: QualityProfile): Promise<void> {
    const prev = this.profile;
    this.profile = p;
    this.renderScale = this.baseRenderScale();
    if (!this.dev || !this.gpu) return;
    const sameBake = Math.min(2048, Math.max(128, p.render.bake_resolution | 0)) === this.gpu.bake.res;
    this.building = true;
    await this.dev.device.queue.onSubmittedWorkDone();
    const old = this.gpu;
    this.gpu = null;
    old.destroy(sameBake);
    try {
      await this.buildScene(sameBake ? old.bake : undefined);
    } catch (e) {
      this.profile = prev;
      this.status({ phase: 'error', message: `Смена профиля не удалась: ${String((e as Error)?.message ?? e)}` });
      throw e;
    }
    this.schedule();
  }

  setWorldView(v: WorldView): void {
    this.presenter.setWorld(v);
  }

  setCameraMode(m: CameraMode): void {
    if (m === this.camera.mode) { if (m === 'route') this.routePlaying = true; return; }
    const pose = this.camera.update(0);
    if (m === 'free') this.camera.syncFreeFrom(pose);
    if (m === 'orbit') this.camera.syncOrbitFrom(pose);
    this.camera.mode = m;
    this.routePlaying = m === 'route';
    this.cut = true;
  }

  focusActor(id: string | null): void {
    this.camera.focus(id);
  }

  setRouteTime(t: number): void {
    this.camera.mode = 'route';
    this.routePlaying = false;
    this.camera.routeTime = clamp(t, 0, this.scene.control_route.duration_s);
    this.cut = true;
  }

  pause(): void {
    this.userPaused = true;
    this.status({ phase: 'paused', message: 'Пауза' });
  }

  resume(): void {
    if (!this.userPaused) return;
    this.userPaused = false;
    this.lastFrameT = 0;
    if (!this.hiddenPaused) this.status({ phase: 'ready' });
    this.schedule();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.camera.dispose();
    this.playback?.done();
    this.playback = null;
    try { this.context?.unconfigure(); } catch { /* ignore */ }
    this.dropGpu(true);
  }

  async runRoute(opts: RouteOptions): Promise<RouteReport> {
    const driver: RouteDriver = {
      adapter: this.adapter,
      profileId: this.profile.id,
      deadlineMs: 1000 / Math.max(1, this.profile.target_fps),
      pauseThresholdMs: 33.3,
      routeDurationS: this.scene.control_route.duration_s,
      dynamicResolution: this.profile.dynamic_resolution !== null,
      coldStartMs: () => this.coldStart,
      playPass: (passDurationS, onSample, onTime) => this.playPass(passDurationS, onSample, onTime),
    };
    const prevMode = this.camera.mode;
    const prevPlaying = this.routePlaying;
    try {
      return await runRouteBench(driver, opts);
    } finally {
      this.camera.mode = prevMode;
      this.routePlaying = prevPlaying;
    }
  }

  private playPass(passDurationS: number, onSample: RoutePlayback['onSample'], onTime?: RoutePlayback['onTime']): Promise<void> {
    return new Promise((resolve) => {
      this.playback?.done();
      this.camera.mode = 'route';
      this.routePlaying = false;
      this.cut = true;
      const pb: RoutePlayback = {
        startMs: -1,
        scale: this.scene.control_route.duration_s / Math.max(passDurationS, 1e-3),
        onSample, onTime, endMs: -1,
        done: () => { if (this.playback === pb) this.playback = null; resolve(); },
      };
      this.playback = pb;
      this.schedule();
    });
  }

  // ------------------------------------------------------------------ debug surface (dev page / automation)
  debugInfo(): RendererDebugInfo {
    return {
      status: this.lastStatus,
      profile: this.profile.id,
      canvasSize: this.canvasSize,
      internalSize: this.internalSize,
      renderScale: this.renderScale,
      cameraMode: this.camera.mode,
      routeTime: this.camera.routeTime,
      routeSegment: this.camera.mode === 'route' ? this.camera.routeState().segment : null,
      frames: this.frameIndex,
      validationErrors: [...this.validationErrors],
      timestamps: this.dev?.timer.enabled ?? false,
      droppedGpuSamples: this.dev?.timer.droppedFrames ?? 0,
      stats: this.lastStats,
      deviceRecoveries: this.recoveries,
    };
  }

  /** Reads back exposure + HDR statistics of the last frame (automation / diagnostics only). */
  async debugProbe(points: [number, number][] = []): ReturnType<GpuScene['debugProbe']> {
    if (!this.gpu) throw new Error('renderer not ready');
    return this.gpu.debugProbe(points);
  }

  /** Simulates a device loss (device.destroy() without the renderer's consent) to exercise recovery. */
  simulateDeviceLoss(): void {
    this.handle?.device.destroy();
  }

  setRoutePlaying(on: boolean): void {
    if (on) this.camera.mode = 'route';
    this.routePlaying = on;
  }

  setTonemapper(t: 'agx' | 'aces'): void {
    this.tonemapper = t;
  }

  setExposureCompensation(ev: number): void {
    this.exposureEv = clamp(ev, -4, 4);
  }

  // ------------------------------------------------------------------ frame loop
  private schedule(): void {
    if (!this.raf && !this.destroyed) this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private handleVisibility(): void {
    const hidden = document.visibilityState === 'hidden';
    if (hidden === this.hiddenPaused) return;
    this.hiddenPaused = hidden;
    if (hidden) {
      this.status({ phase: 'paused', message: 'Вкладка скрыта — рендер на паузе' });
    } else {
      this.lastFrameT = 0;
      if (!this.userPaused && this.gpu) this.status({ phase: 'ready' });
      this.schedule();
    }
  }

  private tick(now: number): void {
    this.raf = 0;
    if (this.destroyed || this.userPaused || this.hiddenPaused) return;
    this.schedule();
    if (this.building || !this.gpu || !this.dev || !this.context) return;
    if (this.framesInFlight >= MAX_FRAMES_IN_FLIGHT) return; // GPU busy: never queue unbounded work
    try {
      this.renderFrame(now);
    } catch (e) {
      console.error('[renderer] frame failed', e);
      this.status({ phase: 'error', message: `Ошибка кадра: ${String((e as Error)?.message ?? e)}` });
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private baseRenderScale(): number {
    const dr = this.profile.dynamic_resolution;
    return dr ? clamp(this.profile.render_scale, dr.min_scale, dr.max_scale) : this.profile.render_scale;
  }

  /** Canvas backing size: CSS size x DPR clamped to max_dpr, and never above the profile's output area. */
  private updateCanvasSize(): boolean {
    const c = this.opts.canvas;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, this.profile.render.max_dpr);
    let w = Math.max(1, Math.round((c.clientWidth || c.width) * dpr));
    let h = Math.max(1, Math.round((c.clientHeight || c.height) * dpr));
    const [ow, oh] = this.profile.output;
    const s = Math.min(1, Math.sqrt((ow * oh) / (w * h)));
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(h * s));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.canvasSize = [w, h];
    const iw = Math.max(1, Math.round(w * this.renderScale));
    const ih = Math.max(1, Math.round(h * this.renderScale));
    const changed = iw !== this.internalSize[0] || ih !== this.internalSize[1];
    this.internalSize = [iw, ih];
    return changed;
  }

  private renderFrame(now: number): void {
    const gpu = this.gpu!;
    const dev = this.dev!;
    const t0 = performance.now();
    const interval = this.lastFrameT > 0 ? now - this.lastFrameT : 0;
    const dt = this.lastFrameT > 0 ? clamp(interval / 1000, 0, 0.25) : 1 / 60;
    this.lastFrameT = now;
    this.updateCanvasSize();
    gpu.resize(this.internalSize[0], this.internalSize[1]);

    // ---- route clock
    const pb = this.playback;
    if (pb && pb.endMs < 0) {
      if (pb.startMs < 0) { pb.startMs = now; this.cut = true; }
      const rt = ((now - pb.startMs) / 1000) * pb.scale;
      this.camera.routeTime = Math.min(rt, this.scene.control_route.duration_s);
      if (rt >= this.scene.control_route.duration_s) pb.endMs = now;
    } else if (pb) {
      // Pass finished: wait for the late GPU samples of its frames (bounded), then hand control back.
      const late = [...this.pending.values()].some((p) => p.sample.t <= pb.endMs);
      if (!late || now - pb.endMs > 600) {
        for (const [id, p] of this.pending) if (p.sample.t <= pb.endMs) { this.pending.delete(id); this.emit(p); }
        pb.done();
      }
    } else if (this.routePlaying && this.camera.mode === 'route') {
      this.camera.routeTime += dt;
      if (this.camera.routeTime >= this.scene.control_route.duration_s) { this.camera.routeTime = 0; this.cut = true; }
    }
    const route: RouteState | null = this.camera.mode === 'route' ? this.camera.routeState() : null;
    const cut = this.cut;
    this.cut = false;

    // ---- camera
    const pose = this.camera.update(cut ? 0 : dt);
    const [iw, ih] = this.internalSize;
    const aspect = iw / ih;
    const view = m4.lookAt(pose.pos, pose.target, [0, 1, 0]);
    const proj = m4.perspectiveReversedInfinite(pose.fovY, aspect, NEAR);
    const viewProj = m4.multiply(proj, view);
    const camFwd = v3.norm(v3.sub(pose.target, pose.pos));
    const fv: FrameView = { view, proj, viewProj, invViewProj: m4.invert(viewProj), camPos: pose.pos, camFwd, fovY: pose.fovY, aspect, near: NEAR };
    const time = ((now - this.startT) / 1000) % 3600;

    // ---- world
    const fx = this.presenter.update({ t: time, dt, cut, camPos: pose.pos, camFwd, route });
    const u = gpu.uniforms;
    u.setMat('viewProj', viewProj);
    u.setMat('view', view);
    u.setMat('proj', proj);
    u.setMat('invViewProj', fv.invViewProj);
    u.setVec4('camPos', pose.pos[0], pose.pos[1], pose.pos[2], time);
    u.setVec4('camFwd', camFwd[0], camFwd[1], camFwd[2], NEAR);
    u.setVec4('sunDir', this.sunDir[0], this.sunDir[1], this.sunDir[2], Math.cos(SUN_RADIUS));
    u.setVec4('viewport', iw, ih, 1 / iw, 1 / ih);
    const viewDistance = this.profile.render.terrain_view_distance_m;
    u.setVec4('fog', 2.6e-5, 1.1e-4 * (1 + fx.dustGust * 0.6), 420, viewDistance);
    const r = this.profile.render;
    u.setVec4('post', 1, r.bloom ? 0.045 : 0, r.ao === 'off' ? 0 : 0.85, fx.emergency);
    u.setVec4('scene', fx.dimmed, fx.torch ? 1 : 0, gpu.shadows.cascades, 1 / gpu.shadows.size);
    const lightCount = this.presenter.lights(gpu, { t: time, dt, cut, camPos: pose.pos, camFwd, route }, fx);
    u.setCounts(lightCount, Math.min(16, gpu.colony.modules.length), this.frameIndex, (r.ao !== 'off' ? 1 : 0) | (this.tonemapper === 'aces' ? 2 : 0));
    const b = gpu.bake;
    u.setVec4('terrainLevels', b.levels[0], b.levels[1], b.levels[2], b.res);
    u.setVec4('terrainInfo', b.center[0], b.center[1], gpu.shadows.distance, this.scene.terrain.height_scale_m);
    this.presenter.instances(gpu, route, time);
    this.presenter.sprites(gpu.fx, fx, time);
    const dust = Math.round(r.dust_particles * (1 + fx.emergency * 0.6));
    gpu.fx.upload(dust, [16, 7, 16], [2.2 + fx.dustGust * 4, 0, 0.9 + fx.dustGust * 2], fx.dustGust);
    gpu.prepare(fv, viewDistance, this.sunDir);
    gpu.setExposure({
      dt, compensationEv: this.exposureEv + (fx.dimmed ? -0.6 : 0), rate: 2.2, snap: cut,
      minLog2: -2.5, maxLog2: 5.5, keyLog2: Math.log2(0.16), adaptation: 0.72,
    });

    // ---- encode + submit
    const frameId = this.frameIndex++;
    const timed = dev.timer.beginFrame(frameId);
    const outView = this.context!.getCurrentTexture().createView();
    const { commands, stats } = gpu.encode(outView, fv, {
      frameIndex: frameId, ao: r.ao !== 'off', bloom: r.bloom, depthPrepass: r.depth_prepass, dustCount: dust,
    });
    dev.device.queue.submit([commands]);
    dev.timer.afterSubmit();
    this.framesInFlight++;
    const isFirst = this.coldStart < 0;
    dev.device.queue.onSubmittedWorkDone().then(() => {
      this.framesInFlight = Math.max(0, this.framesInFlight - 1);
      if (isFirst && this.coldStart < 0) {
        this.coldStart = performance.now() - this.createdAt;
        this.status({ phase: 'ready', message: `Первый кадр за ${(this.coldStart / 1000).toFixed(1)} с` });
      } else if (this.lastStatus.phase !== 'ready' && this.lastStatus.phase !== 'paused' && this.lastStatus.phase !== 'error' && this.gpu) {
        this.status({ phase: 'ready' });
      }
    }, () => { this.framesInFlight = Math.max(0, this.framesInFlight - 1); });

    const cpuMs = performance.now() - t0;
    this.lastStats = { ...stats, lights: lightCount, cpuMs, instanceOverflow: gpu.batch.overflow, spriteOverflow: gpu.fx.overflow, actors: this.presenter.crew.count };
    const sample: FrameSample = {
      t: now, intervalMs: interval, cpuMs, gpuMs: null, renderScale: this.renderScale, internalSize: [iw, ih],
    };
    const record: PendingSample = { sample, routeT: this.camera.routeTime, segment: route?.segment ?? 'free', frameId };
    if (timed) this.pending.set(frameId, record); else this.emit(record);
    // Frames whose timing never arrives (lost readback) are released without GPU time.
    for (const [id, p] of this.pending) if (id < frameId - 30) { this.pending.delete(id); this.emit(p); }
    if (pb && this.playback === pb && pb.endMs < 0) pb.onTime?.(this.camera.routeTime, route?.segment ?? '');
    this.updateDynamicResolution(now);
  }

  private onGpuTiming(r: GpuFrameTiming): void {
    const p = this.pending.get(r.frameId);
    if (!p) return;
    this.pending.delete(r.frameId);
    p.sample.gpuMs = r.totalMs;
    p.sample.passes = r.groups;
    this.gpuEma = this.gpuEma > 0 ? this.gpuEma * 0.9 + r.totalMs * 0.1 : r.totalMs;
    this.emit(p);
  }

  private emit(p: PendingSample): void {
    const pb = this.playback;
    if (pb && pb.startMs >= 0 && p.sample.t >= pb.startMs && (pb.endMs < 0 || p.sample.t <= pb.endMs)) pb.onSample(p.sample, p.routeT, p.segment);
    try { this.opts.onFrame?.(p.sample); } catch (e) { console.error(e); }
  }

  /** Dynamic resolution (only when the profile enables it), driven by measured GPU time; never by guesses. */
  private updateDynamicResolution(now: number): void {
    const dr = this.profile.dynamic_resolution;
    if (!dr || !this.dev?.timer.enabled || this.gpuEma <= 0) return;
    if (now - this.dynScaleChangedAt < 1500) return;
    let s = this.renderScale;
    if (this.gpuEma > 12.5) s -= 0.04; else if (this.gpuEma < 10) s += 0.02;
    s = clamp(Math.round(s * 1000) / 1000, dr.min_scale, dr.max_scale);
    if (s !== this.renderScale) {
      this.renderScale = s;
      this.dynScaleChangedAt = now;
    }
  }
}

/**
 * Creates the renderer. Throws a RendererUnavailable object (never a raw exception) when WebGPU, the adapter or the
 * device is missing; other failures (e.g. a shader compile error) are reported via onStatus('error') and rethrown.
 */
export async function createRenderer(opts: RendererOptions): Promise<Renderer> {
  const r = new EchoRenderer(opts);
  try {
    await r.start();
  } catch (e) {
    if (isRendererUnavailable(e)) {
      opts.onStatus?.({ phase: 'error', message: e.message });
      r.destroy();
      throw e;
    }
    opts.onStatus?.({ phase: 'error', message: String((e as Error)?.message ?? e) });
    r.destroy();
    throw e;
  }
  return r;
}

export { isRendererUnavailable };
