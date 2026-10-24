/**
 * Launch options of the desktop app: defaults <- settings.json (userData) <- command-line flags.
 *
 *   settings.json lives in the user data folder (Linux: ~/.config/orbital-station-aurora/settings.json,
 *   Windows: %APPDATA%\orbital-station-aurora\settings.json). CLI flags override it for one run only.
 *
 * Flags: --quality=auto|ultra|high|medium|low|lite  --fullscreen  --windowed  --borderless
 *        --window=remember|windowed|fullscreen|borderless  --width=1920 --height=1080
 *        --vsync=on|off  --angle=default|gl|vulkan|swiftshader|d3d11|metal  --webgpu=on|off
 *        --platform=auto|x11|wayland  --prime=auto|on|off  --heap=<MB>
 *        --params="governor=0&t=2000"  plus scene URL params directly: --start= --governor= --t= ...
 *        --devtools  --gpu-info  --selftest[=shot.png]  --dist=<folder with index.html>  --no-gpu-warning
 */
import fs from 'node:fs';
import path from 'node:path';

export const QUALITY_IDS = ['auto', 'ultra', 'high', 'medium', 'low', 'lite'];
export const WINDOW_MODES = ['remember', 'windowed', 'fullscreen', 'borderless'];
export const ANGLE_BACKENDS = ['default', 'gl', 'vulkan', 'swiftshader', 'd3d11', 'metal'];
export const PLATFORMS = ['auto', 'x11', 'wayland'];
export const PRIME_MODES = ['auto', 'on', 'off'];

/** Scene URL parameters that may be given directly as flags (see README «Параметры URL»). */
export const SCENE_PARAMS = ['start', 'governor', 'minh', 'pr', 't', 'timescale', 'ao', 'nolock', 'autostart', 'observer', 'view', 'detaildist', 'menu'];

export const DEFAULTS = {
  quality: 'auto',          // 'auto' leaves the choice to App.autoQuality() (ultra on 8+ cores)
  window: 'remember',       // remember: the last windowed/fullscreen state and size
  width: 1920,
  height: 1080,
  vsync: true,              // false: --disable-gpu-vsync --disable-frame-rate-limit (uncapped, may tear)
  angle: 'default',         // Chromium default: ANGLE on OpenGL (Linux), D3D11 (Windows), Metal (macOS)
  webgpu: false,            // true: --enable-unsafe-webgpu (+ Vulkan feature on Linux)
  platform: 'auto',         // Linux: --ozone-platform-hint=auto (Wayland when available, else X11)
  prime: 'auto',            // Linux hybrid laptops: NVIDIA PRIME render offload env vars when detected
  heapMB: 4096,             // V8 old space; Electron uses pointer compression, so ~4 GB is the useful maximum
  params: '',               // extra scene URL params, e.g. "governor=0&t=2000"
  devtools: false,
  gpuWarning: true,         // warn once per run when WebGL falls back to a CPU rasteriser
};

const HELP = {
  _help: 'Настройки приложения «Орбитальная станция Аврора». Описание: desktop/README-RU.md. Флаги командной строки переопределяют их на один запуск.',
  _values: {
    quality: QUALITY_IDS.join(' | '), window: WINDOW_MODES.join(' | '), vsync: 'true | false', angle: ANGLE_BACKENDS.join(' | '),
    webgpu: 'true | false', platform: PLATFORMS.join(' | ') + ' (только Linux)', prime: PRIME_MODES.join(' | ') + ' (только Linux, ноутбуки с двумя GPU)',
    heapMB: 'МБ памяти JavaScript (до 4096)', params: 'дополнительные параметры сцены, например governor=0&t=2000',
  },
};

const bool = (v) => (v === true || v === undefined ? true : !/^(0|off|false|no)$/i.test(String(v)));

/** Parses `--key[=value]` flags; returns a map (keys without the dashes). Chromium switches pass through untouched. */
export function parseArgv(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([a-zA-Z][\w-]*)(?:=(.*))?$/s.exec(a);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

export function settingsPath(userData) { return path.join(userData, 'settings.json'); }

export function loadSettings(userData) {
  const file = settingsPath(userData);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const s = {};
    for (const k of Object.keys(DEFAULTS)) if (k in raw) s[k] = raw[k];
    return s;
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[desktop] settings.json is unreadable (${e.message}); using defaults`);
    return {};
  }
}

export function saveSettings(userData, patch) {
  const file = settingsPath(userData);
  const merged = { ...DEFAULTS, ...loadSettings(userData), ...patch };
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...HELP, ...merged }, null, 2) + '\n');
  } catch (e) { console.warn('[desktop] cannot write settings.json:', e.message); }
  return merged;
}

const pick = (v, list, fallback) => (list.includes(String(v)) ? String(v) : fallback);

/** Effective options for this run. `cli` comes from parseArgv(). */
export function resolveOptions(settings, cli) {
  const o = { ...DEFAULTS, ...settings };
  if ('quality' in cli) o.quality = cli.quality;
  if ('window' in cli) o.window = cli.window;
  if (cli.fullscreen) o.window = 'fullscreen';
  if (cli.windowed) o.window = 'windowed';
  if (cli.borderless) o.window = 'borderless';
  if ('width' in cli) o.width = parseInt(cli.width, 10);
  if ('height' in cli) o.height = parseInt(cli.height, 10);
  if ('vsync' in cli) o.vsync = bool(cli.vsync);
  if ('angle' in cli) o.angle = cli.angle;
  if ('webgpu' in cli) o.webgpu = bool(cli.webgpu);
  if ('platform' in cli) o.platform = cli.platform;
  if ('prime' in cli) o.prime = cli.prime;
  if ('heap' in cli) o.heapMB = parseInt(cli.heap, 10);
  if ('params' in cli) o.params = String(cli.params === true ? '' : cli.params);
  if (cli.devtools) o.devtools = true;
  if (cli['no-gpu-warning']) o.gpuWarning = false;

  o.quality = pick(o.quality, QUALITY_IDS, 'auto');
  o.window = pick(o.window, WINDOW_MODES, 'remember');
  o.angle = pick(o.angle, ANGLE_BACKENDS, 'default');
  o.platform = pick(o.platform, PLATFORMS, 'auto');
  o.prime = pick(o.prime, PRIME_MODES, 'auto');
  o.vsync = o.vsync !== false;
  o.webgpu = !!o.webgpu;
  o.width = Math.max(640, Math.min(7680, o.width || DEFAULTS.width));
  o.height = Math.max(360, Math.min(4320, o.height || DEFAULTS.height));
  o.heapMB = Math.max(1024, Math.min(4096, o.heapMB || DEFAULTS.heapMB));

  // scene URL params: settings.params, then --params, then direct flags
  const sp = new URLSearchParams(String(o.params || '').replace(/^\?/, ''));
  for (const k of SCENE_PARAMS) if (k in cli) sp.set(k, cli[k] === true ? '1' : String(cli[k]));
  if (o.quality !== 'auto') sp.set('quality', o.quality);
  o.sceneParams = sp;

  o.gpuInfo = !!cli['gpu-info'];
  o.selftest = cli.selftest ? (cli.selftest === true ? '' : String(cli.selftest)) : null;
  o.selftestTimeout = (parseInt(cli['selftest-timeout'], 10) || 300) * 1000;
  o.dist = cli.dist && cli.dist !== true ? String(cli.dist) : null;
  return o;
}

/** Our own flag names (to drop them from argv on a relaunch after a settings change). */
export const OWN_FLAGS = ['quality', 'window', 'fullscreen', 'windowed', 'borderless', 'width', 'height', 'vsync', 'angle', 'webgpu',
  'platform', 'prime', 'heap', 'params', 'devtools', 'no-gpu-warning', 'gpu-info', 'selftest', 'selftest-timeout', ...SCENE_PARAMS];
