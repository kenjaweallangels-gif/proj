/**
 * GPU-related start-up: Chromium switches tuned for a game, ANGLE / WebGPU backend choice, Linux display
 * platform (X11 / Wayland), NVIDIA PRIME render offload on hybrid laptops, and the GPU probe used by
 * --gpu-info, the in-app «Сведения о GPU» dialog and the start-up checks (WebGL2 missing, software fallback).
 *
 * Everything here that touches app.commandLine must run before app 'ready'.
 */
import fs from 'node:fs';
import path from 'node:path';

const PCI_VENDORS = { '0x10de': 'NVIDIA', '0x8086': 'Intel', '0x1002': 'AMD', '0x1af4': 'virtio', '0x15ad': 'VMware', '0x1234': 'QEMU' };
export const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software|basic render|lavapipe/i;

/** Linux: GPUs from /sys/class/drm (vendor ids) and the proprietary NVIDIA driver version, if loaded. */
export function linuxGpuInventory() {
  const inv = { cards: [], nvidiaDriver: null, session: process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? 'wayland' : process.env.DISPLAY ? 'x11' : 'unknown') };
  try {
    for (const name of fs.readdirSync('/sys/class/drm')) {
      if (!/^card\d+$/.test(name)) continue;
      const dev = path.join('/sys/class/drm', name, 'device');
      let vendor = null, driver = null, boot = false;
      try { vendor = fs.readFileSync(path.join(dev, 'vendor'), 'utf8').trim(); } catch (_) { /* not PCI */ }
      try { driver = path.basename(fs.readlinkSync(path.join(dev, 'driver'))); } catch (_) { /* none */ }
      try { boot = fs.readFileSync(path.join(dev, 'boot_vga'), 'utf8').trim() === '1'; } catch (_) { /* n/a */ }
      inv.cards.push({ card: name, vendor, vendorName: PCI_VENDORS[vendor] || vendor, driver, bootVga: boot });
    }
  } catch (_) { /* no drm (container) */ }
  try {
    const v = fs.readFileSync('/proc/driver/nvidia/version', 'utf8');
    const m = /Kernel Module\s+(?:for\s+\S+\s+)?([\d.]+)/.exec(v) || /([\d]{3,}\.[\d.]+)/.exec(v);
    inv.nvidiaDriver = m ? m[1] : v.split('\n')[0].trim();
  } catch (_) { /* nouveau or no NVIDIA */ }
  const vendors = new Set(inv.cards.map((c) => c.vendor).filter(Boolean));
  inv.hasNvidia = vendors.has('0x10de');
  inv.hybrid = inv.hasNvidia && (vendors.has('0x8086') || vendors.has('0x1002'));
  inv.nouveau = inv.cards.some((c) => c.driver === 'nouveau');
  return inv;
}

/**
 * NVIDIA PRIME render offload: on a hybrid laptop in «On-Demand» mode (prime-select on-demand) apps run on the
 * integrated GPU unless these variables are set. Set in the main process before the GPU process is spawned
 * (child processes inherit the environment). Returns the variables that were set.
 */
export function applyPrimeOffload(mode, inv) {
  if (process.platform !== 'linux' || mode === 'off') return null;
  if (mode === 'auto' && !(inv.hybrid && inv.nvidiaDriver)) return null;
  const vars = { __NV_PRIME_RENDER_OFFLOAD: '1', __GLX_VENDOR_LIBRARY_NAME: 'nvidia', __VK_LAYER_NV_optimus: 'NVIDIA_only' };
  const egl = '/usr/share/glvnd/egl_vendor.d/10_nvidia.json';
  if (fs.existsSync(egl)) vars.__EGL_VENDOR_LIBRARY_FILENAMES = egl;
  const set = {};
  for (const [k, v] of Object.entries(vars)) if (process.env[k] === undefined) { process.env[k] = v; set[k] = v; }
  return set;
}

function mergeFeatureSwitch(app, name, list) {
  if (!list.length) return;
  const prev = app.commandLine.getSwitchValue(name);
  const all = [...new Set([...(prev ? prev.split(',') : []), ...list])].filter(Boolean);
  app.commandLine.appendSwitch(name, all.join(','));
}

/** Appends the Chromium switches for this run. Returns the list (for the log). */
export function applySwitches(app, o) {
  const added = [];
  const sw = (k, v) => { if (v === undefined) app.commandLine.appendSwitch(k); else app.commandLine.appendSwitch(k, String(v)); added.push(v === undefined ? `--${k}` : `--${k}=${v}`); };
  const enable = [], disable = [];

  sw('ignore-gpu-blocklist');                 // never fall back to software because of a driver blocklist entry
  sw('enable-gpu-rasterization');
  sw('enable-zero-copy');
  sw('force_high_performance_gpu');           // macOS / Windows dual-GPU systems: pick the discrete adapter
  sw('disable-renderer-backgrounding');
  sw('disable-background-timer-throttling');
  sw('disable-backgrounding-occluded-windows');
  sw('autoplay-policy', 'no-user-gesture-required');   // WebAudio starts without an extra click
  sw('js-flags', `--max-old-space-size=${o.heapMB}`);
  if (process.platform === 'win32') disable.push('CalculateNativeWinOcclusion');

  if (!o.vsync) { sw('disable-gpu-vsync'); sw('disable-frame-rate-limit'); }

  switch (o.angle) {
    case 'gl': sw('use-angle', 'gl'); break;
    case 'vulkan': sw('use-angle', 'vulkan'); enable.push('Vulkan', 'VulkanFromANGLE', 'DefaultANGLEVulkan'); break;
    case 'swiftshader': sw('use-angle', 'swiftshader'); sw('enable-unsafe-swiftshader'); break;
    case 'd3d11': if (process.platform === 'win32') sw('use-angle', 'd3d11'); break;
    case 'metal': if (process.platform === 'darwin') sw('use-angle', 'metal'); break;
    default: break;
  }
  if (o.webgpu) {
    sw('enable-unsafe-webgpu');
    if (process.platform === 'linux') enable.push('Vulkan');   // Dawn on Linux runs on Vulkan
  }
  if (process.platform === 'linux') {
    if (o.platform === 'x11' || o.platform === 'wayland') sw('ozone-platform', o.platform);
    else sw('ozone-platform-hint', 'auto');
  }
  mergeFeatureSwitch(app, 'enable-features', enable);
  mergeFeatureSwitch(app, 'disable-features', disable);
  if (enable.length) added.push(`--enable-features=${[...new Set(enable)].join(',')}`);
  if (disable.length) added.push(`--disable-features=${disable.join(',')}`);
  return added;
}

/** Runs in a page (executeJavaScript): WebGL2 / WebGPU renderer strings and capabilities. */
export const PROBE_JS = `(async () => {
  const out = { webgl2: false };
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { powerPreference: 'high-performance' });
    out.webgl2 = !!gl;
    if (gl) {
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      out.renderer = String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      out.vendor = String(e ? gl.getParameter(e.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
      out.version = String(gl.getParameter(gl.VERSION));
      out.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      out.maxSamples = gl.getParameter(gl.MAX_SAMPLES);
      out.gpuTimer = !!gl.getExtension('EXT_disjoint_timer_query_webgl2');
      out.s3tc = !!gl.getExtension('WEBGL_compressed_texture_s3tc');
      out.bptc = !!gl.getExtension('EXT_texture_compression_bptc');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch (e) { out.webglError = String(e && e.message || e); }
  try {
    if (!navigator.gpu) out.webgpu = null;
    else {
      const a = await Promise.race([navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }), new Promise((r) => setTimeout(() => r('timeout'), 4000))]);
      if (a === 'timeout') out.webgpu = { error: 'requestAdapter timeout' };
      else if (!a) out.webgpu = { error: 'no adapter' };
      else { const i = a.info || {}; out.webgpu = { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description, fallback: !!(i.isFallbackAdapter ?? a.isFallbackAdapter) }; }
    }
  } catch (e) { out.webgpu = { error: String(e && e.message || e) }; }
  out.software = ${SOFTWARE_RE}.test(out.renderer || '');
  out.devicePixelRatio = window.devicePixelRatio;
  out.screen = [screen.width, screen.height];
  out.crossOriginIsolated = window.crossOriginIsolated;
  return out;
})()`;

/** Chromium's own view of the GPUs (which one is active), feature status and driver. */
export async function chromiumGpuInfo(app) {
  const res = { featureStatus: app.getGPUFeatureStatus() };
  try {
    const info = await app.getGPUInfo('complete');
    res.devices = (info.gpuDevice || []).map((d) => ({ active: !!d.active, vendor: PCI_VENDORS['0x' + Number(d.vendorId).toString(16).padStart(4, '0')] || d.vendorId, vendorId: d.vendorId, deviceId: d.deviceId, driverVendor: d.driverVendor, driverVersion: d.driverVersion, deviceString: d.deviceString }));
    const a = info.auxAttributes || {};
    res.glRenderer = a.glRenderer; res.glVendor = a.glVendor; res.glVersion = a.glVersion; res.glImplementationParts = a.glImplementationParts;
    res.displayType = a.displayType; res.vulkanVersion = info.vulkanInfo ? 'present' : undefined;
  } catch (e) { res.error = String(e && e.message || e); }
  return res;
}

/** Human-readable (Russian) summary for dialogs and the terminal. */
export function formatGpuReport(r) {
  const L = [];
  const p = r.probe || {};
  L.push(`WebGL2: ${p.webgl2 ? 'да' : 'НЕТ'}${p.software ? '  (ПРОГРАММНЫЙ РЕНДЕРИНГ — видеокарта не используется)' : ''}`);
  if (p.renderer) L.push(`  рендерер: ${p.renderer}`, `  вендор:   ${p.vendor}`, `  версия:   ${p.version}`);
  if (p.webgl2) L.push(`  макс. текстура ${p.maxTextureSize}, MSAA до ${p.maxSamples}×, таймер GPU: ${p.gpuTimer ? 'есть' : 'нет'}, BC7: ${p.bptc ? 'есть' : 'нет'}`);
  if (p.webglError) L.push(`  ошибка: ${p.webglError}`);
  const w = p.webgpu;
  L.push(`WebGPU: ${w == null ? 'выключен (включить: --webgpu=on)' : w.error ? 'недоступен — ' + w.error : [w.vendor, w.architecture, w.description].filter(Boolean).join(' / ') + (w.fallback ? ' (fallback-адаптер)' : '')}`);
  const c = r.chromium || {};
  for (const d of c.devices || []) L.push(`GPU ${d.active ? '[АКТИВНЫЙ]' : '[ ]'} ${d.vendor} ${d.deviceString || ('0x' + Number(d.deviceId).toString(16))}  драйвер ${d.driverVendor || ''} ${d.driverVersion || ''}`.trim());
  if (c.glImplementationParts && !/gl=none/.test(c.glImplementationParts)) L.push(`ANGLE/GL: ${c.glImplementationParts}`);
  const f = c.featureStatus;
  if (f) L.push(`Chromium: webgl ${f.webgl}, webgpu ${f.webgpu}, vulkan ${f.vulkan}, растеризация ${f.rasterization}, композитинг ${f.gpu_compositing}`);
  const s = r.system || {};
  if (s.linux) {
    const l = s.linux;
    L.push(`Linux: сессия ${l.session}; видеокарты: ${l.cards.map((x) => `${x.vendorName}${x.driver ? ' (' + x.driver + ')' : ''}`).join(', ') || '—'}`);
    L.push(`  драйвер NVIDIA: ${l.nvidiaDriver || (l.nouveau ? 'nouveau (нужен проприетарный драйвер!)' : 'не загружен')}${l.hybrid ? '; гибридная графика' : ''}`);
    if (s.prime && Object.keys(s.prime).length) L.push(`  PRIME offload: ${Object.entries(s.prime).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }
  if (s.display) L.push(`Экран: ${s.display.size} @ ${s.display.hz} Гц, масштаб ${s.display.scale}`);
  if (s.switches) L.push(`Флаги Chromium: ${s.switches.join(' ')}`);
  L.push(`Electron ${process.versions.electron}, Chromium ${process.versions.chrome}, V8 ${process.versions.v8}`);
  return L.join('\n');
}
