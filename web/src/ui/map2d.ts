// 2D colony map — the compatibility view when WebGPU is unavailable (Документ §7: «понятный экран совместимости,
// не падение при старте»). Draws the D0 layout (modules, doors, sealed zones), the crew from the same WorldView the 3D
// renderer gets, alarm and task markers. All colours come from the CSS theme tokens.
import type { Vec3, WorldView } from '../contracts.ts';
import type { Snapshot } from '../core/protocol.ts';
import { player, scene, world } from '../core/data.ts';
import { standPoint } from '../agent/world_view.ts';

interface Palette {
  bg: string; grid: string; ground: string; module: string; moduleStroke: string; doorOpen: string; doorClosed: string;
  doorSealed: string; label: string; alarm: string; task: string; player: string; fg: string; surface: string;
}

const TOKENS: Record<keyof Palette, string> = {
  bg: '--map-bg', grid: '--map-grid', ground: '--map-ground', module: '--map-module', moduleStroke: '--map-module-stroke',
  doorOpen: '--map-door-open', doorClosed: '--map-door-closed', doorSealed: '--map-door-sealed', label: '--map-label',
  alarm: '--map-alarm', task: '--map-task', player: '--map-player', fg: '--fg', surface: '--surface',
};

const zoneNames = new Map(world.zones.map((z) => [z.id, z.name_ru]));

function rgb(c: Vec3): string {
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
}

export class ColonyMap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private palette!: Palette;
  private raf = 0;
  private view: WorldView | null = null;
  private snap: Snapshot | null = null;
  private readonly reduceMotion: MediaQueryList;
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas недоступен');
    this.ctx = ctx;
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.readPalette();
    const pts: [number, number][] = [];
    for (const m of scene.modules) {
      const r = Math.max(m.size[0], m.size[2]) / 2;
      pts.push([m.position[0] - r, m.position[2] - r], [m.position[0] + r, m.position[2] + r]);
    }
    for (const p of Object.values(scene.zone_stand_points)) pts.push([p[0], p[2]]);
    this.bounds = {
      minX: Math.min(...pts.map((p) => p[0])) - 4, maxX: Math.max(...pts.map((p) => p[0])) + 4,
      minZ: Math.min(...pts.map((p) => p[1])) - 4, maxZ: Math.max(...pts.map((p) => p[1])) + 4,
    };
  }

  /** Re-reads the theme tokens (call after a theme switch). */
  readPalette(): void {
    const cs = getComputedStyle(document.documentElement);
    const p = {} as Palette;
    for (const [k, token] of Object.entries(TOKENS) as [keyof Palette, string][]) p[k] = cs.getPropertyValue(token).trim() || 'gray';
    this.palette = p;
  }

  update(view: WorldView, snap: Snapshot): void {
    this.view = view;
    this.snap = snap;
  }

  start(): void {
    if (this.raf) return;
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.draw(t / 1000);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Screen rectangles already taken in the current frame (dots and labels), for label placement. */
  private placed: Rect[] = [];

  /**
   * Places a label at the first candidate position that does not overlap anything placed this frame
   * (or the least overlapping one), keeping it inside the canvas.
   */
  private placeLabel(text: string, candidates: Array<(tw: number, th: number) => [number, number]>, color: string, dpr: number): void {
    const ctx = this.ctx;
    const tw = ctx.measureText(text).width;
    const th = 12 * dpr;
    const W = this.canvas.width, H = this.canvas.height;
    let best: [number, number] = candidates[0](tw, th);
    let bestCost = Infinity;
    for (const cand of candidates) {
      const [lx, ly] = cand(tw, th);
      const r = { x: lx - 2 * dpr, y: ly - dpr, w: tw + 4 * dpr, h: th + 2 * dpr };
      let cost = 0;
      for (const q of this.placed) cost += overlapArea(r, q);
      if (r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H) cost += r.w * r.h;
      if (cost < bestCost) { best = [lx, ly]; bestCost = cost; if (cost === 0) break; }
    }
    this.placed.push({ x: best[0] - 2 * dpr, y: best[1] - dpr, w: tw + 4 * dpr, h: th + 2 * dpr });
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    this.label(text, best[0], best[1], color, dpr);
    ctx.restore();
  }

  /** Text with a halo in the background colour so labels stay legible over lines and modules. */
  private label(text: string, x: number, y: number, color: string, dpr: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5 * dpr;
    ctx.strokeStyle = this.palette.bg;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  private draw(time: number): void {
    const c = this.canvas;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const hgt = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== hgt) { c.width = w; c.height = hgt; }
    const ctx = this.ctx;
    const P = this.palette;
    const b = this.bounds;
    const pad = 18 * dpr;
    const top = 44 * dpr; // keep clear of the HUD chips
    const scale = Math.min((w - 2 * pad) / (b.maxX - b.minX), (hgt - top - pad - 40 * dpr) / (b.maxZ - b.minZ));
    const ox = (w - (b.maxX - b.minX) * scale) / 2 - b.minX * scale;
    const oz = top + ((hgt - top - 40 * dpr) - (b.maxZ - b.minZ) * scale) / 2 - b.minZ * scale;
    const X = (x: number) => ox + x * scale;
    const Z = (z: number) => oz + z * scale;
    const pulse = this.reduceMotion.matches ? 0.75 : 0.5 + 0.5 * Math.sin(time * 4);

    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, w, hgt);
    // grid every 5 m
    ctx.strokeStyle = P.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(b.minX / 5) * 5; x <= b.maxX; x += 5) { ctx.moveTo(X(x), Z(b.minZ)); ctx.lineTo(X(x), Z(b.maxZ)); }
    for (let z = Math.ceil(b.minZ / 5) * 5; z <= b.maxZ; z += 5) { ctx.moveTo(X(b.minX), Z(z)); ctx.lineTo(X(b.maxX), Z(z)); }
    ctx.stroke();

    const snap = this.snap;
    const view = this.view;
    this.placed = [];
    const sealed = new Set(view?.sealedZones ?? []);

    // doors (passages between zone stand points)
    for (const d of snap?.doors ?? world.doors) {
      const a = standPoint(d.a), bb = standPoint(d.b);
      ctx.save();
      ctx.lineWidth = (d.state === 'sealed' ? 4 : 2.5) * dpr;
      ctx.strokeStyle = d.state === 'sealed' ? P.doorSealed : d.state === 'closed' ? P.doorClosed : P.doorOpen;
      if (d.state === 'closed') ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(X(a[0]), Z(a[2]));
      ctx.lineTo(X(bb[0]), Z(bb[2]));
      ctx.stroke();
      ctx.restore();
    }

    // modules
    ctx.font = `${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const m of scene.modules) {
      const isSealed = sealed.has(m.zone);
      ctx.save();
      ctx.translate(X(m.position[0]), Z(m.position[2]));
      ctx.rotate((-m.rotation_y_deg * Math.PI) / 180);
      const sw = (m.size[0] * scale) / 2, sd = (m.size[2] * scale) / 2;
      ctx.beginPath();
      if (m.kind === 'dome' || m.kind === 'cylinder') ctx.ellipse(0, 0, sw, sd, 0, 0, Math.PI * 2);
      else ctx.rect(-sw, -sd, sw * 2, sd * 2);
      ctx.fillStyle = P.module;
      ctx.fill();
      ctx.lineWidth = (isSealed ? 3 : 1.5) * dpr;
      ctx.strokeStyle = isSealed ? P.doorSealed : P.moduleStroke;
      ctx.stroke();
      if (isSealed) {
        ctx.clip();
        ctx.strokeStyle = P.doorSealed;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 2 * dpr;
        for (let k = -sw - sd; k < sw + sd; k += 7 * dpr) { ctx.beginPath(); ctx.moveTo(k, -sd); ctx.lineTo(k + 2 * sd, sd); ctx.stroke(); }
      }
      ctx.restore();
    }

    // markers
    for (const mk of view?.markers ?? []) {
      const x = X(mk.position[0]), z = Z(mk.position[2]);
      if (mk.kind === 'sensor' || mk.kind === 'zone') {
        ctx.save();
        ctx.strokeStyle = P.alarm;
        ctx.fillStyle = P.alarm;
        ctx.globalAlpha = 0.25 + 0.5 * pulse * mk.intensity;
        ctx.beginPath();
        ctx.arc(x, z, (8 + 10 * pulse) * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2 * dpr;
        ctx.beginPath();
        ctx.arc(x, z, 6 * dpr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = P.task;
        ctx.translate(x, z);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-4 * dpr, -4 * dpr, 8 * dpr, 8 * dpr);
        ctx.restore();
      }
    }

    // player
    const pp = standPoint(player.zone);
    ctx.save();
    ctx.strokeStyle = P.player;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(X(pp[0] - 1.6), Z(pp[2] - 1.2), 6 * dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const playerXY: [number, number] = [X(pp[0] - 1.6), Z(pp[2] - 1.2)];
    this.placed.push({ x: playerXY[0] - 7 * dpr, y: playerXY[1] - 7 * dpr, w: 14 * dpr, h: 14 * dpr });

    // crew
    ctx.font = `600 ${11.5 * dpr}px ui-sans-serif, system-ui, sans-serif`;
    for (const a of view?.actors ?? []) {
      const x = X(a.position[0]), z = Z(a.position[2]);
      ctx.save();
      if (a.speaking) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = rgb(a.color);
        ctx.beginPath();
        ctx.arc(x, z, 12 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = rgb(a.color);
      ctx.strokeStyle = P.surface;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(x, z, 6.5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      this.placed.push({ x: x - 7 * dpr, y: z - 7 * dpr, w: 14 * dpr, h: 14 * dpr });
    }

    // labels last, crew first: each takes the first free spot around its anchor
    const around = (x: number, z: number, r: number) => [
      (_tw: number, th: number): [number, number] => [x + r, z - th / 2],
      (tw: number, th: number): [number, number] => [x - r - tw, z - th / 2],
      (_tw: number, th: number): [number, number] => [x + r, z - th - r / 2],
      (_tw: number, _th: number): [number, number] => [x + r, z + r / 2],
      (tw: number, th: number): [number, number] => [x - tw / 2, z - r - th],
      (tw: number, _th: number): [number, number] => [x - tw / 2, z + r],
      (tw: number, th: number): [number, number] => [x - r - tw, z - th - r / 2],
      (tw: number, _th: number): [number, number] => [x - r - tw, z + r / 2],
    ];
    ctx.font = `600 ${11.5 * dpr}px ui-sans-serif, system-ui, sans-serif`;
    for (const a of view?.actors ?? []) this.placeLabel(a.name, around(X(a.position[0]), Z(a.position[2]), 9 * dpr), P.fg, dpr);
    ctx.font = `${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
    this.placeLabel(player.name_ru, around(playerXY[0], playerXY[1], 9 * dpr), P.label, dpr);
    for (const m of scene.modules) {
      const cx = X(m.position[0]), cz = Z(m.position[2]);
      const r = (Math.max(m.size[0], m.size[2]) * scale) / 2 + 3 * dpr;
      this.placeLabel(zoneNames.get(m.zone) ?? m.zone, [
        (tw: number, _th: number): [number, number] => [cx - tw / 2, cz + r],
        (tw: number, th: number): [number, number] => [cx - tw / 2, cz - r - th],
        ...around(cx, cz, r),
      ], P.label, dpr);
    }
    const surf = standPoint('surface');
    this.placeLabel(zoneNames.get('surface') ?? 'поверхность', around(X(surf[0]), Z(surf[2]), 8 * dpr), P.label, dpr);

    if (view?.emergencyLights) {
      ctx.save();
      ctx.strokeStyle = P.alarm;
      ctx.globalAlpha = 0.35 + 0.4 * pulse;
      ctx.lineWidth = 6 * dpr;
      ctx.strokeRect(3 * dpr, 3 * dpr, w - 6 * dpr, hgt - 6 * dpr);
      ctx.restore();
    }
  }
}

interface Rect { x: number; y: number; w: number; h: number }

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
