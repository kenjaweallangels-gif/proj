// Control-route benchmark (Документ §2, §19): warm-up passes, measured passes over the fixed camera route with fixed
// events, p50/p95/p99 of the frame interval, CPU submit time and GPU time (timestamp-query only, otherwise
// "unavailable" — never CPU time), missed deadlines, pauses > 33.3 ms, the cold start and per-segment statistics.
// The report is machine-readable (contracts.ts RouteReport). A software adapter (SwiftShader) is reported as
// "blocked": its numbers are functional checks, NOT performance evidence.
import type { AdapterSummary, FrameSample, PercentileSet, RouteOptions, RouteReport } from '../contracts.ts';

export const SOFTWARE_NOTE = 'SwiftShader/CPU — не доказательство производительности';

export function percentiles(values: number[]): PercentileSet {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return { p50: 0, p95: 0, p99: 0, max: 0, mean: 0, count: 0 };
  // Nearest-rank percentiles (no interpolation: p99 is an observed frame).
  const q = (p: number) => v[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(v[n - 1]), mean: r(v.reduce((s, x) => s + x, 0) / n), count: n };
}

/** What the benchmark needs from a renderer. */
export interface RouteDriver {
  readonly adapter: AdapterSummary;
  readonly profileId: string;
  /** Frame deadline for missed-deadline counting (1000 / target_fps). */
  readonly deadlineMs: number;
  readonly pauseThresholdMs: number;
  readonly routeDurationS: number;
  readonly dynamicResolution: boolean;
  /** Time from createRenderer() to the first presented frame of the final scene (ms). */
  coldStartMs(): number;
  /**
   * Plays the route once, time-scaled so that the whole route takes passDurationS. Every frame sample of the pass is
   * delivered with the route time and segment of that frame (GPU timings may arrive a few frames late).
   * Resolves after the last frame of the pass and its late GPU samples.
   */
  playPass(passDurationS: number, onSample: (s: FrameSample, routeT: number, segment: string) => void, onTime?: (t: number, segment: string) => void): Promise<void>;
}

interface Collected { interval: number[]; cpu: number[]; gpu: number[]; gpuMissing: number }

const emptyCollected = (): Collected => ({ interval: [], cpu: [], gpu: [], gpuMissing: 0 });

export async function runRoute(driver: RouteDriver, opts: RouteOptions): Promise<RouteReport> {
  const passes = Math.max(1, Math.floor(opts.passes));
  const warmup = Math.max(0, Math.floor(opts.warmupPasses));
  const passDurationS = opts.passDurationS > 0 ? opts.passDurationS : driver.routeDurationS;
  const all = emptyCollected();
  const segments = new Map<string, Collected>();
  let missed = 0, pauses = 0, maxPause = 0, renderScaleMin = Infinity, renderScaleMax = -Infinity;

  for (let pass = 0; pass < warmup + passes; pass++) {
    const measured = pass >= warmup;
    await driver.playPass(passDurationS, (s, routeT, segment) => {
      if (!measured || s.intervalMs <= 0) return; // the first frame after a pause has no interval
      const seg = segments.get(segment) ?? emptyCollected();
      segments.set(segment, seg);
      for (const c of [all, seg]) {
        c.interval.push(s.intervalMs);
        c.cpu.push(s.cpuMs);
        if (s.gpuMs === null) c.gpuMissing++; else c.gpu.push(s.gpuMs);
      }
      if (s.intervalMs > driver.deadlineMs) missed++;
      if (s.intervalMs > driver.pauseThresholdMs) pauses++;
      maxPause = Math.max(maxPause, s.intervalMs);
      renderScaleMin = Math.min(renderScaleMin, s.renderScale);
      renderScaleMax = Math.max(renderScaleMax, s.renderScale);
      void routeT;
    }, (t, segment) => opts.onProgress?.({ pass, t, segment }));
  }

  const gpuAvailable = all.gpu.length > 0;
  const frameInterval = percentiles(all.interval);
  const gpu = gpuAvailable ? percentiles(all.gpu) : 'unavailable' as const;
  const notes: string[] = [
    'Интервал rAF — ритм вызовов/представления кадров, а не чистое GPU-время (Документ §19).',
    gpuAvailable
      ? `GPU-время — timestamp-query (кольцо readback без блокировки CPU); без замера осталось кадров: ${all.gpuMissing}.`
      : 'GPU-время: unavailable (нет timestamp-query или ни один кадр не был замерен); CPU-время им не подменяется.',
  ];
  if (driver.adapter.isSoftware) notes.unshift(SOFTWARE_NOTE);
  if (Math.abs(passDurationS - driver.routeDurationS) > 1e-6) {
    notes.push(`Маршрут ${driver.routeDurationS} с проигран за ${passDurationS} с на проход (масштаб времени ${(driver.routeDurationS / passDurationS).toFixed(2)}×); события и камера те же.`);
  }
  if (driver.dynamicResolution) notes.push(`Динамическое разрешение включено профилем: render scale ${renderScaleMin.toFixed(3)}–${renderScaleMax.toFixed(3)} (A/B-сравнение требует фиксированного масштаба).`);
  notes.push(`Пропущенный срок: интервал > ${driver.deadlineMs.toFixed(2)} мс (1000 / target_fps профиля).`);

  // Verdict. Software adapters never produce a pass/fail about performance.
  let status: RouteReport['status'];
  let reason: string | undefined;
  if (frameInterval.count === 0) {
    status = 'not_run';
    reason = 'Не получено ни одного кадра маршрута.';
  } else if (driver.adapter.isSoftware) {
    status = 'blocked';
    reason = `${SOFTWARE_NOTE}: нужен прогон на целевом GPU (RTX 3060); цифры ниже — только функциональная проверка.`;
  } else {
    const readyP99 = gpuAvailable ? Math.max((gpu as PercentileSet).p99, frameInterval.p99) : frameInterval.p99;
    const ok = readyP99 <= driver.deadlineMs && pauses === 0;
    status = ok ? 'pass' : 'fail';
    reason = ok ? undefined : `p99 готовности ${readyP99.toFixed(2)} мс (порог ${driver.deadlineMs.toFixed(2)}), пауз > ${driver.pauseThresholdMs} мс: ${pauses}`;
    if (!gpuAvailable) notes.push('Вердикт по интервалам кадров без GPU-таймера — предварительный.');
  }

  const segOut: RouteReport['segments'] = {};
  for (const [name, c] of segments) {
    segOut[name] = { frameInterval: percentiles(c.interval), gpu: c.gpu.length ? percentiles(c.gpu) : 'unavailable' };
  }
  return {
    kind: 'zero-echo.route-report.v1',
    status,
    reason,
    profile: driver.profileId,
    adapter: driver.adapter,
    passes,
    passDurationS,
    warmupPasses: warmup,
    frameInterval,
    cpu: percentiles(all.cpu),
    gpu,
    missedDeadlineRatio: all.interval.length ? Math.round((missed / all.interval.length) * 10000) / 10000 : 0,
    pausesOver33ms: pauses,
    maxPauseMs: Math.round(maxPause * 1000) / 1000,
    coldStartMs: Math.round(driver.coldStartMs()),
    segments: segOut,
    notes,
  };
}
