// Cameras: orbit (drag / wheel / touch), free (WASD + mouse), route (Catmull-Rom through control_route.keys with
// fixed events), plus a dialogue close-up that smoothly frames an actor and returns to the previous camera.
import type { CameraMode, RouteKey, SceneLayout, Vec3 } from '../contracts.ts';
import { clamp, v3 } from './math.ts';

export interface CameraPose { pos: Vec3; target: Vec3; fovY: number }

/** Route state derived deterministically from route time (setRouteTime gives the same frame as a playback). */
export interface RouteState {
  t: number;
  segment: string;
  lightsDim: boolean;
  torch: boolean;
  focusMira: boolean;
  emergency: boolean;
  roverFollow: boolean;
  /** 0..1 progress of the rover_follow segment (rover drives ahead of the camera). */
  roverPhase: number;
}

export class RoutePath {
  readonly keys: RouteKey[];
  readonly duration: number;

  constructor(scene: SceneLayout) {
    this.keys = [...scene.control_route.keys].sort((a, b) => a.t - b.t);
    this.duration = scene.control_route.duration_s;
  }

  private segmentIndex(t: number): number {
    const k = this.keys;
    let i = 0;
    while (i < k.length - 2 && t >= k[i + 1].t) i++;
    return i;
  }

  private tangent(i: number, field: 'pos' | 'look'): Vec3 {
    const k = this.keys;
    const a = k[Math.max(0, i - 1)], b = k[Math.min(k.length - 1, i + 1)];
    const dt = b.t - a.t;
    if (dt <= 1e-6) return [0, 0, 0];
    const tan = v3.scale(v3.sub(b[field], a[field]), 1 / dt);
    // Limit tangents at sharp, fast transitions to avoid overshooting through the ground.
    const maxSpeed = 12;
    const l = v3.len(tan);
    return l > maxSpeed ? v3.scale(tan, maxSpeed / l) : tan;
  }

  private hermite(i: number, s: number, field: 'pos' | 'look'): Vec3 {
    const k0 = this.keys[i], k1 = this.keys[i + 1];
    const h = k1.t - k0.t;
    const m0 = v3.scale(this.tangent(i, field), h);
    const m1 = v3.scale(this.tangent(i + 1, field), h);
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    return [0, 1, 2].map((c) => h00 * k0[field][c] + h10 * m0[c] + h01 * k1[field][c] + h11 * m1[c]) as Vec3;
  }

  /**
   * Camera pose at route time t: position on a Catmull-Rom spline through the keys; the view direction turns from one
   * key's framing to the next with an eased slerp (interpolating far look *points* would swing the camera almost
   * immediately toward whichever key looks at the more distant point).
   */
  pose(tIn: number): { pos: Vec3; look: Vec3 } {
    const t = clamp(tIn, 0, this.keys[this.keys.length - 1].t);
    const i = this.segmentIndex(t);
    const k0 = this.keys[i], k1 = this.keys[i + 1];
    const s = k1.t > k0.t ? clamp((t - k0.t) / (k1.t - k0.t), 0, 1) : 0;
    const pos = this.hermite(i, s, 'pos');
    // Ease-in-out with a late turn: the camera holds the previous framing a little longer, then settles on the next.
    const u = Math.pow(s, 1.4);
    const e = u * u * (3 - 2 * u);
    const a = v3.sub(k0.look, k0.pos), b = v3.sub(k1.look, k1.pos);
    const la = Math.max(v3.len(a), 1e-3), lb = Math.max(v3.len(b), 1e-3);
    const dir = slerp(v3.scale(a, 1 / la), v3.scale(b, 1 / lb), e);
    const dist = Math.exp(Math.log(la) + (Math.log(lb) - Math.log(la)) * e);
    return { pos, look: v3.madd(pos, dir, dist) };
  }

  state(tIn: number): RouteState {
    const t = clamp(tIn, 0, this.duration);
    const k = this.keys;
    const i = this.segmentIndex(t);
    let torch = false, emergency = false;
    for (const key of k) {
      if (key.t > t) break;
      if (key.event === 'torch_on') torch = true;
      if (key.event === 'torch_off') torch = false;
      if (key.event === 'emergency_on') emergency = true;
      if (key.event === 'emergency_off') emergency = false;
    }
    const ev = k[i].event;
    const rf = k.findIndex((key) => key.event === 'rover_follow');
    const rfStart = rf >= 0 ? k[rf].t : Infinity;
    const rfEnd = rf >= 0 ? (k[rf + 1]?.t ?? rfStart + 1) : Infinity;
    return {
      t,
      segment: k[i].segment,
      lightsDim: ev === 'lights_dim',
      torch,
      focusMira: ev === 'focus_mira',
      emergency,
      roverFollow: ev === 'rover_follow',
      roverPhase: rf >= 0 ? clamp((t - rfStart) / Math.max(rfEnd - rfStart, 1e-3), 0, 1) : 0,
    };
  }

  /** Time range [start, end) of the segment containing t. */
  segmentRange(t: number): [number, number] {
    const i = this.segmentIndex(t);
    return [this.keys[i].t, this.keys[i + 1]?.t ?? this.duration];
  }
}

function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const d = clamp(v3.dot(a, b), -1, 1);
  const ang = Math.acos(d);
  if (ang < 1e-4) return v3.norm(v3.lerp(a, b, t));
  if (Math.PI - ang < 1e-3) {
    // Opposite directions: turn through the horizontal perpendicular.
    const mid = v3.norm(v3.cross(a, [0, 1, 0]));
    return t < 0.5 ? slerp(a, mid, t * 2) : slerp(mid, b, t * 2 - 1);
  }
  const sa = Math.sin((1 - t) * ang) / Math.sin(ang), sb = Math.sin(t * ang) / Math.sin(ang);
  return v3.norm([a[0] * sa + b[0] * sb, a[1] * sa + b[1] * sb, a[2] * sa + b[2] * sb]);
}

export interface GroundQuery { (x: number, z: number): number }

export class CameraRig {
  mode: CameraMode = 'orbit';
  readonly route: RoutePath;
  routeTime = 46;
  fovY = (55 * Math.PI) / 180;

  // orbit
  orbitTarget: Vec3 = [8, 2, 2];
  orbitYaw = 2.35;
  orbitPitch = 0.2;
  orbitDist = 46;
  // free
  freePos: Vec3 = [30, 6, 30];
  freeYaw = -2.3;
  freePitch = -0.05;
  private keys = new Set<string>();

  // dialogue focus
  private focusId: string | null = null;
  private focusBlend = 0;
  private focusPose: CameraPose | null = null;
  /** Head position provider for focus targets. */
  actorHead: (id: string) => Vec3 | null = () => null;

  private readonly ground: GroundQuery;
  private detach: (() => void) | null = null;

  constructor(scene: SceneLayout, ground: GroundQuery) {
    this.route = new RoutePath(scene);
    this.ground = ground;
  }

  setGround(_g: GroundQuery): void { /* ground query is fixed per scene; kept for API symmetry */ }

  focus(id: string | null): void {
    this.focusId = id;
  }

  get focusedActor(): string | null { return this.focusId; }

  routeState(): RouteState { return this.route.state(this.routeTime); }

  /** Advances input-driven cameras by dt seconds and returns the current pose. */
  update(dt: number): CameraPose {
    const base = this.basePose(dt);
    // Dialogue close-up blend.
    const want = this.focusId ? 1 : 0;
    const speed = dt / 0.8;
    this.focusBlend = want > this.focusBlend ? Math.min(1, this.focusBlend + speed) : Math.max(0, this.focusBlend - speed);
    let pose = base;
    if (this.focusBlend > 0) {
      const head = this.focusId ? this.actorHead(this.focusId) : null;
      if (head) this.focusPose = this.closeUp(head, base);
      if (this.focusPose) {
        const s = this.focusBlend * this.focusBlend * (3 - 2 * this.focusBlend);
        pose = {
          pos: v3.lerp(base.pos, this.focusPose.pos, s),
          target: v3.lerp(base.target, this.focusPose.target, s),
          fovY: base.fovY + (this.focusPose.fovY - base.fovY) * s,
        };
      }
    } else {
      this.focusPose = null;
    }
    // Ground clearance for every camera.
    const g = this.ground(pose.pos[0], pose.pos[2]);
    if (pose.pos[1] < g + 0.6) pose = { ...pose, pos: [pose.pos[0], g + 0.6, pose.pos[2]] };
    return pose;
  }

  private closeUp(head: Vec3, base: CameraPose): CameraPose {
    // Keep the side the camera was on; frame the face from ~1.7 m slightly off-axis, at eye height.
    let dir = v3.sub(base.pos, head);
    dir[1] = 0;
    if (v3.len(dir) < 1e-3) dir = [1, 0, 0];
    dir = v3.norm(dir);
    const side: Vec3 = [-dir[2], 0, dir[0]];
    const pos = v3.add(v3.add(head, v3.scale(dir, 1.65)), v3.add(v3.scale(side, 0.35), [0, 0.02, 0]));
    return { pos, target: v3.add(head, [0, -0.06, 0]), fovY: (40 * Math.PI) / 180 };
  }

  private basePose(dt: number): CameraPose {
    if (this.mode === 'route') {
      const { pos, look } = this.route.pose(this.routeTime);
      const st = this.route.state(this.routeTime);
      let target = look;
      if (st.focusMira) {
        const head = this.actorHead('mira');
        if (head) target = head;
      }
      return { pos, target, fovY: this.fovY };
    }
    if (this.mode === 'free') {
      const fwd: Vec3 = [Math.cos(this.freePitch) * Math.sin(this.freeYaw), Math.sin(this.freePitch), Math.cos(this.freePitch) * Math.cos(this.freeYaw)];
      const right: Vec3 = v3.norm([-fwd[2], 0, fwd[0]]);
      const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const speed = (fast ? 60 : 9) * dt;
      let move: Vec3 = [0, 0, 0];
      if (this.keys.has('KeyW')) move = v3.add(move, fwd);
      if (this.keys.has('KeyS')) move = v3.sub(move, fwd);
      if (this.keys.has('KeyD')) move = v3.add(move, right);
      if (this.keys.has('KeyA')) move = v3.sub(move, right);
      if (this.keys.has('KeyE') || this.keys.has('Space')) move = v3.add(move, [0, 1, 0]);
      if (this.keys.has('KeyQ') || this.keys.has('KeyC')) move = v3.sub(move, [0, 1, 0]);
      if (v3.len(move) > 0) this.freePos = v3.madd(this.freePos, v3.norm(move), speed);
      return { pos: this.freePos, target: v3.add(this.freePos, fwd), fovY: this.fovY };
    }
    const cp = Math.cos(this.orbitPitch);
    const offset: Vec3 = [cp * Math.sin(this.orbitYaw) * this.orbitDist, Math.sin(this.orbitPitch) * this.orbitDist, cp * Math.cos(this.orbitYaw) * this.orbitDist];
    return { pos: v3.add(this.orbitTarget, offset), target: this.orbitTarget, fovY: this.fovY };
  }

  /** Copies the current pose into the free camera (switching modes keeps the view). */
  syncFreeFrom(pose: CameraPose): void {
    this.freePos = [...pose.pos];
    const d = v3.norm(v3.sub(pose.target, pose.pos));
    this.freeYaw = Math.atan2(d[0], d[2]);
    this.freePitch = Math.asin(clamp(d[1], -0.99, 0.99));
  }

  syncOrbitFrom(pose: CameraPose): void {
    const d = v3.sub(pose.pos, pose.target);
    const dist = v3.len(d);
    if (dist < 1e-3) return;
    this.orbitTarget = [...pose.target];
    this.orbitDist = clamp(dist, 3, 3000);
    this.orbitPitch = Math.asin(clamp(d[1] / dist, -0.2, 1.45));
    this.orbitYaw = Math.atan2(d[0], d[2]);
  }

  attach(el: HTMLElement): void {
    this.detach?.();
    let dragging: { x: number; y: number; button: number } | null = null;
    const touches = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
      }
      dragging = { x: e.clientX, y: e.clientY, button: e.shiftKey ? 2 : e.button };
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size >= 2) {
          const [a, b] = [...touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch > 0 && this.mode === 'orbit') this.orbitDist = clamp(this.orbitDist * (pinch / Math.max(d, 1)), 3, 3000);
          pinch = d;
          dragging = { x: e.clientX, y: e.clientY, button: dragging.button };
          return;
        }
      }
      dragging = { x: e.clientX, y: e.clientY, button: dragging.button };
      if (this.mode === 'orbit') {
        if (dragging.button === 0) {
          this.orbitYaw -= dx * 0.006;
          this.orbitPitch = clamp(this.orbitPitch + dy * 0.005, -0.15, 1.45);
        } else {
          const right: Vec3 = [Math.cos(this.orbitYaw), 0, -Math.sin(this.orbitYaw)];
          const fwd: Vec3 = [-Math.sin(this.orbitYaw), 0, -Math.cos(this.orbitYaw)];
          const k = this.orbitDist * 0.0015;
          this.orbitTarget = v3.add(this.orbitTarget, v3.add(v3.scale(right, -dx * k), v3.scale(fwd, dy * k)));
        }
      } else if (this.mode === 'free') {
        this.freeYaw -= dx * 0.004;
        this.freePitch = clamp(this.freePitch - dy * 0.004, -1.5, 1.5);
      }
    };
    const onUp = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = 0;
      if (touches.size === 0) dragging = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (this.mode === 'orbit') this.orbitDist = clamp(this.orbitDist * Math.exp(e.deltaY * 0.0012), 3, 3000);
      else if (this.mode === 'free') this.fovY = clamp(this.fovY * Math.exp(e.deltaY * 0.0008), 0.35, 1.5);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, select, textarea')) return;
      this.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
    const onBlur = () => this.keys.clear();
    const onContext = (e: Event) => e.preventDefault();
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    el.style.touchAction = 'none';
    this.detach = () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
  }
}
