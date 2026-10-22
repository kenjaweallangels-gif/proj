// WebGPU capability probe and device creation (Документ §7: explicit feature/limit checks before requestDevice,
// request only what is needed; a clear compatibility result instead of a crash).
import type { AdapterSummary, RendererUnavailable } from '../contracts.ts';

/** Features the renderer can use when present. None of them is required. */
export const OPTIONAL_FEATURES: GPUFeatureName[] = ['timestamp-query'];

/** Limits the renderer needs above the WebGPU defaults (all within the guaranteed-default envelope today). */
const REQUIRED_LIMITS = {
  maxStorageBuffersPerShaderStage: 6,
  maxSampledTexturesPerShaderStage: 12,
  maxColorAttachmentBytesPerSample: 16,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupStorageSize: 16384,
  maxTextureArrayLayers: 4,
  maxTextureDimension2D: 2048,
} as const;

/** Limits we report in AdapterSummary (subset relevant to the renderer and to compatibility screens). */
const REPORTED_LIMITS = [
  'maxTextureDimension2D', 'maxTextureArrayLayers', 'maxBindGroups', 'maxBufferSize', 'maxStorageBufferBindingSize',
  'maxUniformBufferBindingSize', 'maxStorageBuffersPerShaderStage', 'maxSampledTexturesPerShaderStage',
  'maxColorAttachments', 'maxColorAttachmentBytesPerSample', 'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupStorageSize', 'maxComputeWorkgroupsPerDimension', 'maxVertexBuffers', 'maxVertexAttributes',
  'maxInterStageShaderVariables',
] as const;

export function emptySummary(reason?: string): AdapterSummary {
  const g = globalThis as { isSecureContext?: boolean; crossOriginIsolated?: boolean };
  return {
    available: false,
    reason,
    features: [],
    limits: {},
    secureContext: g.isSecureContext ?? false,
    crossOriginIsolated: g.crossOriginIsolated ?? false,
  };
}

/** SwiftShader / WARP / llvmpipe / fallback adapters: images are valid for review, timings are not performance evidence. */
export function isSoftwareAdapter(info: { vendor?: string; architecture?: string; description?: string; device?: string } | undefined, isFallback: boolean): boolean {
  if (isFallback) return true;
  const text = `${info?.vendor ?? ''} ${info?.architecture ?? ''} ${info?.description ?? ''} ${info?.device ?? ''}`.toLowerCase();
  return /swiftshader|llvmpipe|lavapipe|softpipe|warp|software|microsoft basic render/.test(text);
}

export function summarizeAdapter(adapter: GPUAdapter): AdapterSummary {
  const info = adapter.info as GPUAdapterInfo & { isFallbackAdapter?: boolean };
  const legacyFallback = (adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter;
  const isFallbackAdapter = Boolean(info?.isFallbackAdapter ?? legacyFallback ?? false);
  const limits: Record<string, number> = {};
  for (const k of REPORTED_LIMITS) {
    const v = (adapter.limits as unknown as Record<string, number | undefined>)[k];
    if (typeof v === 'number') limits[k] = v;
  }
  return {
    ...emptySummary(),
    available: true,
    vendor: info?.vendor || undefined,
    architecture: info?.architecture || undefined,
    device: info?.device || undefined,
    description: info?.description || undefined,
    isFallbackAdapter,
    isSoftware: isSoftwareAdapter(info, isFallbackAdapter),
    features: [...adapter.features].map(String).sort(),
    limits,
    preferredFormat: navigator.gpu.getPreferredCanvasFormat(),
  };
}

export function unavailable(reason: RendererUnavailable['reason'], message: string, adapter: AdapterSummary): RendererUnavailable {
  return { kind: 'renderer-unavailable', reason, message, adapter: { ...adapter, available: false, reason: message } };
}

export function isRendererUnavailable(e: unknown): e is RendererUnavailable {
  return typeof e === 'object' && e !== null && (e as { kind?: unknown }).kind === 'renderer-unavailable';
}

export interface GpuDeviceHandle {
  adapter: GPUAdapter;
  device: GPUDevice;
  summary: AdapterSummary;
  hasTimestamps: boolean;
  format: GPUTextureFormat;
}

/**
 * Probes navigator.gpu, requests an adapter and a device with only the needed features/limits.
 * Throws RendererUnavailable (never a raw exception) when WebGPU cannot be used.
 */
export async function acquireDevice(powerPreference: GPUPowerPreference = 'high-performance'): Promise<GpuDeviceHandle> {
  const base = emptySummary();
  if (!base.secureContext) throw unavailable('insecure-context', 'WebGPU требует безопасный контекст (HTTPS или localhost).', base);
  if (!('gpu' in navigator) || !navigator.gpu) throw unavailable('no-webgpu', 'navigator.gpu отсутствует: браузер не поддерживает WebGPU или он выключен.', base);

  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference });
  } catch (e) {
    throw unavailable('no-adapter', `requestAdapter() завершился ошибкой: ${String((e as Error)?.message ?? e)}`, base);
  }
  if (!adapter) throw unavailable('no-adapter', 'Адаптер WebGPU не получен (requestAdapter вернул null).', base);
  const summary = summarizeAdapter(adapter);

  const requiredFeatures = OPTIONAL_FEATURES.filter((f) => adapter!.features.has(f));
  const requiredLimits: Record<string, number> = {};
  for (const [k, want] of Object.entries(REQUIRED_LIMITS)) {
    const have = (adapter.limits as unknown as Record<string, number>)[k];
    if (typeof have !== 'number') continue;
    if (have < want) throw unavailable('device-failed', `Лимит адаптера ${k}=${have} ниже необходимого ${want}.`, summary);
    requiredLimits[k] = want;
  }

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice({ requiredFeatures, requiredLimits, label: 'zero-echo-render' });
  } catch (e) {
    throw unavailable('device-failed', `requestDevice() завершился ошибкой: ${String((e as Error)?.message ?? e)}`, summary);
  }
  return {
    adapter,
    device,
    summary,
    hasTimestamps: device.features.has('timestamp-query'),
    format: navigator.gpu.getPreferredCanvasFormat(),
  };
}
