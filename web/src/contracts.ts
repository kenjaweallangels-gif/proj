// Shared contracts between the renderer (web/src/render/**) and the app/UI (web/src/ui/**, web/src/agent/**).
// See docs/SPEC.md §8. Keep this file dependency-free; both sides import only types from here.

export type Vec3 = [number, number, number];

// ---------- data/profiles.json ----------
export interface RenderParams {
  shadow_map_size: number;
  shadow_cascades: number;
  terrain_grid: number;
  terrain_view_distance_m: number;
  rock_instances: number;
  ao: 'off' | 'half' | 'full';
  bloom: boolean;
  depth_prepass: boolean;
  max_dpr: number;
  dust_particles: number;
  bake_resolution: number;
  msaa: number;
}

export interface QualityProfile {
  id: string;
  label_ru: string;
  platform: 'native' | 'browser';
  output: [number, number];
  render_scale: number;
  dynamic_resolution: { min_scale: number; max_scale: number } | null;
  target_fps: number;
  llm_default: string;
  render: RenderParams;
}

// ---------- data/scene/d0_layout.json ----------
export interface RouteKey {
  t: number;
  segment: string;
  pos: Vec3;
  look: Vec3;
  event: string | null;
}

export interface SceneLayout {
  format: string;
  seed: number;
  terrain: {
    size_m: number;
    height_scale_m: number;
    flatten_center: [number, number];
    flatten_radius_m: number;
    flatten_falloff_m: number;
    valley_axis_deg: number;
    valley_width_m: number;
    crater: { center: [number, number]; radius_m: number };
    cave_mouth: { position: Vec3; facing_deg: number; width_m: number; height_m: number };
  };
  sun: { azimuth_deg: number; elevation_deg: number; illuminance: number };
  modules: { zone: string; kind: string; position: Vec3; rotation_y_deg: number; size: Vec3 }[];
  props: { kind: string; id?: string; position: Vec3; rotation_y_deg?: number; size?: Vec3; rows?: number; cols?: number }[];
  anchors: Record<string, Vec3>;
  zone_stand_points: Record<string, Vec3>;
  control_route: { duration_s: number; keys: RouteKey[]; reference_shots: { id: string; t: number }[] };
}

// ---------- World view: what the game shows in 3D (derived from core Snapshot by the app) ----------
export interface ActorView {
  id: string;
  name: string;
  /** World-space position on the ground (y is ignored; renderer samples terrain/floor). */
  position: Vec3;
  /** Where the actor should walk to; renderer animates walking toward it. */
  target?: Vec3;
  /** Point the actor looks at (gaze target). */
  lookAt?: Vec3;
  /** Animation tag chosen by the game from validated intents (never generated skeleton motion). */
  gesture: 'none' | 'nod' | 'point_at_target' | 'look_at_player' | 'pause' | 'wary' | 'shrug' | 'check_device';
  activity: 'idle' | 'walking' | 'working' | 'resting' | 'talking';
  color: Vec3;
  speaking: boolean;
}

export interface MarkerView {
  id: string;
  kind: 'sensor' | 'zone' | 'item' | 'task';
  position: Vec3;
  /** 0..1, e.g. alarm pulse */
  intensity: number;
  color: Vec3;
}

export interface BiographyView {
  zone: string;
  anchor: string;
  detail_id: string;
}

export interface WorldView {
  simTimeS: number;
  emergencyLights: boolean;
  sealedZones: string[];
  actors: ActorView[];
  markers: MarkerView[];
  biography: BiographyView[];
}

// ---------- Frame metrics ----------
export interface FrameSample {
  /** performance.now() at frame start */
  t: number;
  /** rAF-to-rAF interval: presentation rhythm, NOT pure GPU time */
  intervalMs: number;
  /** CPU time spent building/submitting the frame */
  cpuMs: number;
  /** GPU time from timestamp-query, or null when unavailable (never substituted by CPU time) */
  gpuMs: number | null;
  /** optional per-pass GPU times (ms) keyed by budget group (see profiles.json gpu_budget_n60_ms) */
  passes?: Record<string, number>;
  renderScale: number;
  internalSize: [number, number];
}

export interface PercentileSet { p50: number; p95: number; p99: number; max: number; mean: number; count: number }

export interface RouteReport {
  kind: 'zero-echo.route-report.v1';
  status: 'pass' | 'fail' | 'not_run' | 'blocked';
  reason?: string;
  profile: string;
  adapter: AdapterSummary;
  passes: number;
  passDurationS: number;
  warmupPasses: number;
  frameInterval: PercentileSet;
  cpu: PercentileSet;
  gpu: PercentileSet | 'unavailable';
  missedDeadlineRatio: number;
  pausesOver33ms: number;
  maxPauseMs: number;
  coldStartMs: number;
  segments: Record<string, { frameInterval: PercentileSet; gpu: PercentileSet | 'unavailable' }>;
  notes: string[];
}

// ---------- GPU capability probe ----------
export interface AdapterSummary {
  available: boolean;
  reason?: string;
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
  isFallbackAdapter?: boolean;
  /** true for SwiftShader/CPU adapters: results are NOT performance evidence */
  isSoftware?: boolean;
  features: string[];
  limits: Record<string, number>;
  preferredFormat?: string;
  secureContext: boolean;
  crossOriginIsolated: boolean;
}

export interface RendererStatus {
  phase: 'probing' | 'compiling' | 'baking' | 'ready' | 'lost' | 'recovering' | 'error' | 'paused';
  progress?: number; // 0..1, honest progress for pipeline prewarm / bake
  message?: string;
}

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  profile: QualityProfile;
  scene: SceneLayout;
  onFrame?: (s: FrameSample) => void;
  onStatus?: (s: RendererStatus) => void;
}

export type CameraMode = 'orbit' | 'free' | 'route';

export interface RouteOptions {
  warmupPasses: number;
  passes: number;
  /** seconds of route time per pass; the route is time-scaled to fit when shorter than control_route.duration_s */
  passDurationS: number;
  onProgress?: (p: { pass: number; t: number; segment: string }) => void;
}

export interface Renderer {
  readonly adapter: AdapterSummary;
  setProfile(p: QualityProfile): Promise<void>;
  setWorldView(v: WorldView): void;
  setCameraMode(m: CameraMode): void;
  /** Smoothly frame an actor (dialogue close-up) or return to previous camera with null. */
  focusActor(id: string | null): void;
  runRoute(opts: RouteOptions): Promise<RouteReport>;
  /** Jump the camera to a reference shot of control_route (for screenshots). */
  setRouteTime(t: number): void;
  pause(): void;
  resume(): void;
  destroy(): void;
}

/** Thrown by createRenderer when WebGPU is absent or the adapter/device cannot be obtained. */
export interface RendererUnavailable {
  kind: 'renderer-unavailable';
  reason: 'no-webgpu' | 'no-adapter' | 'device-failed' | 'insecure-context';
  message: string;
  adapter: AdapterSummary;
}

// ---------- Core protocol (docs/SPEC.md §1) — the subset the web app relies on ----------
export type GatewayStatus = 'ok' | 'timeout' | 'refused' | 'invalid_output' | 'unavailable' | 'rate_limited' | 'budget_exceeded' | 'cancelled';

export interface GatewayResult {
  task_id: string;
  status: GatewayStatus;
  proposal_text: string | null;
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens?: number; reasoning_tokens?: number; measured: boolean };
  latency_ms: { total: number; first_token?: number | null; queue?: number };
  provider: string;
  model: string;
  provider_revision?: string | null;
  finish_reason: string;
  attempts: number;
  cost_usd?: number | null;
  cost_is_fictional?: boolean;
  error?: { code: string; message: string; retry_after_ms?: number | null } | null;
}

export interface AllowedAction {
  id: string;
  label: string;
  description?: string;
  targets: { id: string; label: string }[];
  target_required?: boolean;
  companions: { id: string; label: string }[];
  fact_ids_min: number;
  fact_ids_max: number;
}

export interface GatewayRequest {
  schema_version: 'zero-echo.intent.v1';
  task_id: string;
  actor_id: string;
  kind?: 'direct_reply' | 'initiative' | 'ambient' | 'order_response';
  capability: 'generate_intent' | 'generate_dialogue';
  world_revision: number;
  locale: 'ru-RU';
  deadline_ms: number;
  max_input_tokens: number;
  max_output_tokens: number;
  privacy_profile: 'offline' | 'hybrid' | 'online';
  persona: { name: string; role: string; values: string; style: string; boundaries: string };
  situation: string;
  allowed_actions: AllowedAction[];
  visible_facts: { id: string; text: string; source?: string }[];
  memory_excerpt: { kind: 'fact' | 'opinion' | 'promise' | 'episode'; text: string; source: string; confidence?: number }[];
  recent_events?: string[];
  player_utterance?: string | null;
  styles: string[];
  gestures?: string[];
  token_estimate?: Record<string, number>;
  prompt_version?: string;
}

export interface Speech {
  actor: string;
  text: string;
  style: string;
  gesture: string;
  fact_ids: string[];
  template_id: string;
  kind: 'immediate' | 'line' | 'fallback' | 'evidence';
}

export interface AuthorityStep { step: number; name: string; ok: boolean; detail: string }

export interface Verdict {
  task_id: string;
  actor: string;
  status: 'accepted' | 'awaiting_player' | 'rejected' | 'stale' | 'duplicate' | 'expired' | 'fallback';
  fallback_used: boolean;
  fallback_reason: string | null;
  proposal: Record<string, unknown> | null;
  steps: AuthorityStep[];
  plan_id: string | null;
  world_task_id: string | null;
  reasons: string[];
}

export interface AdmissionDecision {
  allowed: boolean;
  backend: string;
  reason: string;
  gate?: GpuGate;
}

export interface GpuGate {
  gpu_allowed: boolean;
  reasons: string[];
  p95_gpu_ms: number | null;
  p99_frame_ms: number | null;
  vram_free_gib: number | null;
  stable_s: number;
  cooldown_remaining_s: number;
}
