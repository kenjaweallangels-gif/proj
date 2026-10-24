/**
 * «Орбитальная станция Аврора» — desktop shell (Electron main process).
 *
 * Loads the built scene (dist/, or resources/app-dist in a packaged build) through the privileged
 * `app://bundle/` protocol: no localhost server, all network requests blocked. Game-tuned Chromium
 * switches (see lib/gpu.js), options from settings.json + CLI flags (lib/options.js) turned into scene URL
 * params, remembered window size, F11 fullscreen, F10 settings menu, GPU diagnostics.
 *
 *   electron . [--quality=ultra] [--fullscreen] [--vsync=off] [--angle=vulkan] [--gpu-info] ...
 *   electron . --selftest=shot.png    (CI / headless check: waits for window.__APP_READY__, prints a JSON report)
 */
import { app, BrowserWindow, protocol, session, Menu, dialog, screen, shell, ipcMain, clipboard, nativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgv, loadSettings, saveSettings, resolveOptions, settingsPath, OWN_FLAGS, QUALITY_IDS } from './lib/options.js';
import { SCHEME, ORIGIN, PRIVILEGES, createHandler } from './lib/protocol.js';
import { applySwitches, applyPrimeOffload, linuxGpuInventory, chromiumGpuInfo, formatGpuReport, PROBE_JS } from './lib/gpu.js';
import { WindowState } from './lib/window-state.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT = 'Орбитальная станция Аврора';
const QUALITY_LABELS = { auto: 'Автоматически', ultra: 'Ультра', high: 'Высокое', medium: 'Среднее', low: 'Низкое', lite: 'Lite (без видеокарты)' };

// ------------------------------------------------------------------ options (before 'ready')
// fixed ASCII folder name, the same in development and in packaged builds
app.setPath('userData', path.join(app.getPath('appData'), 'orbital-station-aurora'));
const USER_DATA = app.getPath('userData');
const cli = parseArgv(process.argv.slice(1));
if (!fs.existsSync(settingsPath(USER_DATA))) saveSettings(USER_DATA, {});   // writes a commented template
const opt = resolveOptions(loadSettings(USER_DATA), cli);
const isTest = opt.selftest !== null;
const headlessRun = isTest || opt.gpuInfo;

const LOG_FILE = path.join(USER_DATA, 'last-run.log');
try { fs.mkdirSync(USER_DATA, { recursive: true }); fs.writeFileSync(LOG_FILE, `${new Date().toISOString()} ${PRODUCT}\n`); } catch (_) { /* read-only */ }
function log(...a) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  if (!opt.gpuInfo) console.log(`[desktop] ${line}`);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) { /* ignore */ }
}

const linuxInv = process.platform === 'linux' ? linuxGpuInventory() : null;
const prime = applyPrimeOffload(opt.prime, linuxInv || {});
const switches = applySwitches(app, opt);
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: PRIVILEGES }]);
log('argv', process.argv.slice(1).join(' '));
log('switches', switches.join(' '));
if (prime && Object.keys(prime).length) log('PRIME offload env', prime);

function distRoot() {
  if (opt.dist) return path.resolve(opt.dist);
  const packed = path.join(process.resourcesPath || '', 'app-dist');
  if (app.isPackaged && fs.existsSync(path.join(packed, 'index.html'))) return packed;
  return path.join(app.getAppPath(), 'dist');
}

function iconPath() {
  const p = path.join(HERE, 'build', 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

// ------------------------------------------------------------------ security: no network, minimal permissions
const ALLOWED_PERMISSIONS = new Set(['pointerLock', 'fullscreen', 'keyboardLock', 'clipboard-sanitized-write']);
function lockdown(ses) {
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'ftp://*/*', 'file:///*'] }, (d, cb) => {
    log('blocked request', d.url.slice(0, 200));
    cb({ cancel: true });
  });
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  ses.on('will-download', (e) => e.preventDefault());
  try { ses.setSpellCheckerEnabled(false); } catch (_) { /* n/a */ }
}

app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => { if (!url.startsWith(`${ORIGIN}/`)) { log('blocked navigation', url); e.preventDefault(); } });
  wc.on('will-attach-webview', (e) => e.preventDefault());
});

// ------------------------------------------------------------------ helpers
let win = null;
let currentQuality = opt.quality;
let lastReport = null;

function systemInfo() {
  const d = screen.getPrimaryDisplay();
  return {
    linux: linuxInv, prime, switches,
    display: { size: `${d.size.width}×${d.size.height}`, hz: d.displayFrequency, scale: d.scaleFactor },
    platform: `${process.platform} ${process.arch}`,
  };
}

async function gpuReport(wc) {
  const probe = await wc.executeJavaScript(PROBE_JS, true).catch((e) => ({ webgl2: false, webglError: String(e) }));
  const chromium = await chromiumGpuInfo(app);
  return { probe, chromium, system: systemInfo() };
}

function sceneUrl() {
  const q = opt.sceneParams.toString();
  return `${ORIGIN}/index.html${q ? '?' + q : ''}`;
}

function isOwnFlag(a) { const m = /^--([\w-]+)/.exec(a); return !!m && OWN_FLAGS.includes(m[1]); }

/** Saves `patch` to settings.json and offers a restart (switches are read only at start-up). */
function relaunchWith(patch, what) {
  saveSettings(USER_DATA, patch);
  const r = dialog.showMessageBoxSync(win, {
    type: 'question', buttons: ['Перезапустить сейчас', 'Позже'], defaultId: 0, cancelId: 1, title: PRODUCT,
    message: `${what}: изменение вступит в силу после перезапуска приложения.`,
  });
  if (r !== 0) return;
  const args = process.argv.slice(1).filter((a) => !isOwnFlag(a));
  app.relaunch({ args, execPath: process.env.APPIMAGE || process.execPath });
  app.exit(0);
}

function setQuality(q) {
  saveSettings(USER_DATA, { quality: q });
  currentQuality = q;
  const u = new URL(win.webContents.getURL() || sceneUrl());
  if (q === 'auto') u.searchParams.delete('quality'); else u.searchParams.set('quality', q);
  win.loadURL(u.toString());
}

function toggleFullscreen() {
  if (!win) return;
  if (process.platform === 'darwin' && opt.window === 'borderless') win.setSimpleFullScreen(!win.isSimpleFullScreen());
  else win.setFullScreen(!win.isFullScreen());
}

async function showGpuDialog() {
  const report = await gpuReport(win.webContents);
  lastReport = report;
  const text = formatGpuReport(report);
  log('gpu report\n' + text);
  const r = await dialog.showMessageBox(win, { type: 'info', title: 'Сведения о GPU', message: 'Видеокарта и графический бэкенд', detail: text, buttons: ['Закрыть', 'Скопировать', 'Открыть chrome://gpu'], defaultId: 0, cancelId: 0, noLink: true });
  if (r.response === 1) clipboard.writeText(text);
  if (r.response === 2) openChromeGpu();
}

function openChromeGpu() {
  const w = new BrowserWindow({ width: 1100, height: 900, title: 'chrome://gpu', autoHideMenuBar: true, webPreferences: { sandbox: true, contextIsolation: true } });
  w.setMenu(null);
  w.loadURL('chrome://gpu');
}

function settingsMenu() {
  const radio = (label, checked, click) => ({ label, type: 'radio', checked, click });
  const linux = process.platform === 'linux';
  const angles = [['default', 'По умолчанию' + (linux ? ' (OpenGL)' : '')], ['gl', 'OpenGL'], ...(linux || process.platform === 'win32' ? [['vulkan', 'Vulkan']] : []),
    ...(process.platform === 'win32' ? [['d3d11', 'Direct3D 11']] : []), ...(process.platform === 'darwin' ? [['metal', 'Metal']] : []), ['swiftshader', 'SwiftShader (процессор, для проверки)']];
  const template = [
    { label: 'Качество графики', submenu: QUALITY_IDS.map((q) => radio(QUALITY_LABELS[q], currentQuality === q, () => setQuality(q))) },
    { label: 'Окно', submenu: [
      { label: 'Полный экран (F11, Alt+Enter)', type: 'checkbox', checked: win.isFullScreen(), click: toggleFullscreen },
      { type: 'separator' },
      radio('При запуске: как в прошлый раз', opt.window === 'remember', () => relaunchWith({ window: 'remember' }, 'Режим окна')),
      radio('При запуске: в окне', opt.window === 'windowed', () => relaunchWith({ window: 'windowed' }, 'Режим окна')),
      radio('При запуске: полный экран', opt.window === 'fullscreen', () => relaunchWith({ window: 'fullscreen' }, 'Режим окна')),
      radio('При запуске: окно без рамки на весь экран', opt.window === 'borderless', () => relaunchWith({ window: 'borderless' }, 'Режим окна')),
    ] },
    { label: 'Вертикальная синхронизация (VSync)', type: 'checkbox', checked: opt.vsync, click: (i) => relaunchWith({ vsync: i.checked }, 'VSync') },
    { label: 'Графический бэкенд (ANGLE)', submenu: angles.map(([id, label]) => radio(label, opt.angle === id, () => relaunchWith({ angle: id }, 'Графический бэкенд'))) },
    { label: 'WebGPU' + (linux ? ' (через Vulkan)' : ''), type: 'checkbox', checked: opt.webgpu, click: (i) => relaunchWith({ webgpu: i.checked }, 'WebGPU') },
    ...(linux ? [{ label: 'Платформа окна (Linux)', submenu: [['auto', 'Авто (Wayland, если есть)'], ['x11', 'X11 / XWayland'], ['wayland', 'Wayland']].map(([id, label]) => radio(label, opt.platform === id, () => relaunchWith({ platform: id }, 'Платформа окна'))) },
      { label: 'NVIDIA PRIME (гибридная графика)', submenu: [['auto', 'Авто'], ['on', 'Всегда дискретная NVIDIA'], ['off', 'Не вмешиваться']].map(([id, label]) => radio(label, opt.prime === id, () => relaunchWith({ prime: id }, 'NVIDIA PRIME'))) }] : []),
    { type: 'separator' },
    { label: 'Сведения о GPU…', click: () => showGpuDialog() },
    { label: 'Диагностика Chromium (chrome://gpu)', click: openChromeGpu },
    { label: 'Инструменты разработчика (F12)', click: () => win.webContents.toggleDevTools() },
    { label: 'Перезагрузить сцену (F5)', click: () => win.webContents.reload() },
    { label: 'Открыть папку настроек', click: () => shell.openPath(USER_DATA) },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() },
  ];
  return Menu.buildFromTemplate(template);
}

function showSettingsMenu() { if (win) settingsMenu().popup({ window: win }); }

// ------------------------------------------------------------------ main window
function createWindow() {
  const ws = new WindowState(USER_DATA, screen, opt);
  if ('width' in cli || 'height' in cli) { ws.state.width = opt.width; ws.state.height = opt.height; ws._clamp(); }
  const borderless = opt.window === 'borderless';
  const display = screen.getPrimaryDisplay();
  const b = borderless ? display.bounds : ws.state;
  const fullscreen = opt.window === 'fullscreen' || (opt.window === 'remember' && ws.state.fullscreen && !isTest);

  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height, minWidth: 640, minHeight: 360,
    show: false, backgroundColor: '#000000', title: PRODUCT, icon: iconPath(),
    frame: !borderless, autoHideMenuBar: true, fullscreenable: true, fullscreen,
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      backgroundThrottling: false, spellcheck: false, enableWebSQL: false, v8CacheOptions: 'bypassHeatCheck',
      devTools: true,
    },
  });
  if (!borderless) ws.track(win);
  if (ws.state.maximized && !fullscreen && !borderless) win.maximize();
  if (borderless && process.platform === 'darwin') win.setSimpleFullScreen(true);
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  win.on('closed', () => { win = null; });

  const wc = win.webContents;
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    const k = input.key;
    if (k === 'F11' || (input.alt && k === 'Enter') || (input.meta && input.control && k.toLowerCase() === 'f')) { e.preventDefault(); toggleFullscreen(); }
    else if (k === 'F10') { e.preventDefault(); showSettingsMenu(); }
    else if (k === 'F12' || (input.control && input.shift && k.toLowerCase() === 'i')) { e.preventDefault(); wc.toggleDevTools(); }
    else if (k === 'F5') { e.preventDefault(); wc.reload(); }
    else if (input.meta && k.toLowerCase() === 'q' && process.platform === 'darwin') { e.preventDefault(); app.quit(); }
  });
  // remember a quality picked in the game's own menu (it reloads the page with ?quality=)
  wc.on('did-navigate', (_e, url) => {
    let q = 'auto';
    try { q = new URL(url).searchParams.get('quality') || 'auto'; } catch (_) { /* ignore */ }
    if (QUALITY_IDS.includes(q) && q !== currentQuality) { currentQuality = q; if (!isTest) saveSettings(USER_DATA, { quality: q }); }
  });
  wc.on('console-message', (...args) => {
    const ev = args[0] || {};
    const level = ev.level ?? args[1];
    const message = ev.message ?? args[2];
    const src = ev.sourceId ?? args[4];
    if (level === 'error' || level === 3) { pageErrors.push(String(message)); log('page error:', String(message), src ? `(${src})` : ''); }
    else if (level === 'warning' || level === 2) log('page warning:', String(message).slice(0, 300));
  });
  wc.on('render-process-gone', async (_e, d) => {
    log('renderer gone', d);
    if (isTest) { finishSelftest({ error: `renderer gone: ${d.reason}` }); return; }
    if (!win) return;
    const r = await dialog.showMessageBox(win, { type: 'error', title: PRODUCT, message: 'Процесс сцены завершился аварийно', detail: `Причина: ${d.reason} (код ${d.exitCode}).\nЕсли это повторяется, попробуйте другой графический бэкенд (F10 → Графический бэкенд) или более низкое качество.`, buttons: ['Перезапустить сцену', 'Выход'], defaultId: 0 });
    if (r.response === 0) wc.reload(); else app.quit();
  });
  wc.on('unresponsive', () => log('renderer unresponsive'));
  let checked = false;
  wc.on('did-finish-load', () => { if (!checked) { checked = true; startupChecks(wc); } });
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain) log('load failed', code, desc, url); });
  if (opt.devtools) wc.openDevTools({ mode: 'detach' });
  log('loading', sceneUrl());
  win.loadURL(sceneUrl());
}

const pageErrors = [];

async function startupChecks(wc) {
  const report = await gpuReport(wc);
  lastReport = report;
  log('gpu\n' + formatGpuReport(report));
  if (isTest) return;
  const p = report.probe;
  if (!p.webgl2) {
    const r = await dialog.showMessageBox(win, {
      type: 'error', title: PRODUCT, message: 'WebGL 2 недоступен — сцена не может запуститься',
      detail: 'Chromium не смог создать контекст WebGL 2 на этой видеокарте.\n\n' +
        (process.platform === 'linux' ? 'Проверьте драйвер NVIDIA: в терминале «nvidia-smi» должен показать видеокарту (нужен проприетарный драйвер, не nouveau).\n' : 'Обновите драйвер видеокарты.\n') +
        'Попробуйте другой графический бэкенд: F10 → «Графический бэкенд» (OpenGL / Vulkan) или флаг --angle=gl.\n\n' + formatGpuReport(report),
      buttons: ['Открыть chrome://gpu', 'Выход'], defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) openChromeGpu(); else app.quit();
    return;
  }
  if (p.software && opt.gpuWarning && opt.angle !== 'swiftshader') {
    const r = await dialog.showMessageBox(win, {
      type: 'warning', title: PRODUCT, message: 'Видеокарта не используется: WebGL работает на процессоре',
      detail: `Рендерер: ${p.renderer}\nСцена включит упрощённый пресет «lite».\n\n` +
        (process.platform === 'linux' ? 'Ubuntu: установите проприетарный драйвер NVIDIA (Программы и обновления → Дополнительные драйверы), проверьте «nvidia-smi». На ноутбуке с двумя GPU: «prime-select query» (нужен nvidia или on-demand).\n' : '') +
        'Также можно попробовать F10 → «Графический бэкенд» → Vulkan или OpenGL.',
      buttons: ['Продолжить', 'Сведения о GPU', 'Больше не показывать'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (r.response === 1) showGpuDialog();
    if (r.response === 2) saveSettings(USER_DATA, { gpuWarning: false });
  }
}

// ------------------------------------------------------------------ --selftest (headless verification)
let selftestDone = false;
function finishSelftest(result) {
  if (selftestDone) return;
  selftestDone = true;
  const ok = !result.error && result.ready && pageErrors.length === 0 && !(result.moduleErrors || []).length && (result.checks || []).every((c) => c.ok);
  const out = { ok, ...result, pageErrors, gpu: lastReport ? { renderer: lastReport.probe.renderer, webgl2: lastReport.probe.webgl2, webgpu: lastReport.probe.webgpu, devices: lastReport.chromium.devices } : null };
  process.stdout.write('SELFTEST ' + JSON.stringify(out, null, 2) + '\n');
  app.exit(ok ? 0 : 1);
}

async function selftest() {
  const wc = win.webContents;
  const t0 = Date.now();
  const ev = (js) => wc.executeJavaScript(js, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const timer = setTimeout(() => finishSelftest({ error: `timeout after ${opt.selftestTimeout / 1000}s`, ready: false }), opt.selftestTimeout);
  let ready = false;
  while (!ready && Date.now() - t0 < opt.selftestTimeout) {
    await sleep(500);
    ready = await ev('!!window.__APP_READY__').catch(() => false);
  }
  const readyMs = Date.now() - t0;
  await sleep(1500);
  const checks = [];
  // protocol: range request, MIME type, 404, network blocked
  const errorsBefore = pageErrors.length;
  const proto = await ev(`(async () => {
    const r = await fetch('./index.html', { headers: { Range: 'bytes=0-14' } });
    const t = await r.text();
    const m = await fetch('./index.html').then((x) => x.headers.get('content-type'));
    const nf = await fetch('./no-such-file.bin').then((x) => x.status);
    const net = await fetch('https://example.com/').then(() => 'reachable', () => 'blocked');
    return { rangeStatus: r.status, rangeLen: t.length, contentRange: r.headers.get('content-range'), mime: m, notFound: nf, network: net, isolated: window.crossOriginIsolated };
  })()`).catch((e) => ({ error: String(e) }));
  // the blocked fetch above logs CSP errors on purpose: drop them from the error list
  pageErrors.splice(errorsBefore, pageErrors.length - errorsBefore, ...pageErrors.slice(errorsBefore).filter((m) => !/example\.com/.test(m)));
  checks.push({ name: 'range request 206', ok: proto.rangeStatus === 206 && proto.rangeLen === 15, info: proto });
  checks.push({ name: 'html mime', ok: /text\/html/.test(proto.mime || '') });
  checks.push({ name: '404 for missing file', ok: proto.notFound === 404 });
  checks.push({ name: 'network blocked', ok: proto.network === 'blocked' });
  const fps = await ev(`new Promise((r) => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t < 3000) requestAnimationFrame(f); else r(Math.round(n * 10000 / (performance.now() - t)) / 10); }; requestAnimationFrame(f); })`).catch(() => null);
  const state = await ev(`(() => { const a = window.__app; return { url: location.href, quality: a?.quality?.preset, mode: a?.mode, governor: a?.governor ? { level: a.governor.level, levels: a.governor.levels.length } : null,
    menuVisible: !!a?.hud?.menu?.visible, canvas: a ? [a.renderer.renderer.domElement.width, a.renderer.renderer.domElement.height] : null, viewport: [innerWidth, innerHeight],
    moduleErrors: window.__MODULE_ERRORS__ || [], bridge: !!window.orbitalDesktop?.isDesktop, nodeIntegration: typeof require !== 'undefined' }; })()`).catch((e) => ({ error: String(e) }));
  checks.push({ name: 'context isolation (no require in page)', ok: state.nodeIntegration === false });
  checks.push({ name: 'preload bridge', ok: state.bridge === true });
  // pointer lock through a real (synthetic) mouse click on the canvas, as the player does
  let pointerLock = state.menuVisible ? 'skipped (menu visible)' : 'skipped (not in play mode)';
  if (ready && !state.menuVisible && state.mode === 'play') {
    pointerLock = null;
    win.focus(); wc.focus();
    const [w, h] = state.viewport;
    wc.sendInputEvent({ type: 'mouseDown', x: Math.round(w / 2), y: Math.round(h / 2), button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: Math.round(w / 2), y: Math.round(h / 2), button: 'left', clickCount: 1 });
    for (let i = 0; i < 40 && !pointerLock; i++) {   // software rendering can take seconds per frame
      await sleep(250);
      pointerLock = await ev('document.pointerLockElement ? document.pointerLockElement.tagName : null').catch(() => null);
    }
    checks.push({ name: 'pointer lock on click', ok: pointerLock === 'CANVAS', info: pointerLock });
    await ev('document.exitPointerLock()').catch(() => {});
    await sleep(300);
  }
  let shot = null;
  try {
    const img = await wc.capturePage();
    const bmp = img.toBitmap();
    let sum = 0, n = 0;
    for (let i = 0; i < bmp.length; i += 4 * 97) { sum += bmp[i] + bmp[i + 1] + bmp[i + 2]; n++; }
    const size = img.getSize();
    shot = { size: `${size.width}×${size.height}`, meanBrightness: Math.round(sum / Math.max(1, n) / 3) };
    if (opt.selftest) { fs.mkdirSync(path.dirname(path.resolve(opt.selftest)), { recursive: true }); fs.writeFileSync(path.resolve(opt.selftest), img.toPNG()); shot.file = path.resolve(opt.selftest); }
    checks.push({ name: 'screenshot not blank', ok: shot.meanBrightness > 2, info: shot.meanBrightness });
  } catch (e) { checks.push({ name: 'screenshot', ok: false, info: String(e) }); }
  clearTimeout(timer);
  finishSelftest({ ready, readyMs, fps, state, moduleErrors: state.moduleErrors, pointerLock, shot, checks });
}

// ------------------------------------------------------------------ --gpu-info (terminal diagnostics)
async function gpuInfoAndExit() {
  const w = new BrowserWindow({ show: false, width: 320, height: 240, webPreferences: { sandbox: true, contextIsolation: true } });
  await w.loadURL(`${ORIGIN}/__desktop/blank.html`);
  const report = await gpuReport(w.webContents);
  const text = formatGpuReport(report);
  const asJson = cli['gpu-info'] === 'json';
  process.stdout.write((asJson ? JSON.stringify(report, null, 2) : text) + '\n');
  try { fs.writeFileSync(path.join(USER_DATA, 'gpu-info.txt'), text + '\n\n' + JSON.stringify(report, null, 2) + '\n'); } catch (_) { /* ignore */ }
  app.exit(report.probe.webgl2 ? 0 : 3);
}

// ------------------------------------------------------------------ start-up
if (!headlessRun && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('child-process-gone', (_e, d) => { if (d.type === 'GPU') log('GPU process gone', d); });
  ipcMain.on('desktop:toggle-fullscreen', () => toggleFullscreen());
  ipcMain.on('desktop:open-menu', () => showSettingsMenu());
  ipcMain.handle('desktop:gpu-info', async () => (win ? formatGpuReport(lastReport || await gpuReport(win.webContents)) : ''));

  app.whenReady().then(async () => {
    const root = distRoot();
    log('dist', root);
    const serve = createHandler(root, { log: (m) => log(m) });
    protocol.handle(SCHEME, (req) => {
      if (new URL(req.url).pathname === '/__desktop/blank.html') return new Response('<!doctype html><meta charset="utf-8"><title>probe</title>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return serve(req);
    });
    lockdown(session.defaultSession);
    if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    else Menu.setApplicationMenu(null);
    if (process.platform === 'darwin' && iconPath()) app.dock?.setIcon(nativeImage.createFromPath(iconPath()));

    if (opt.gpuInfo) { await gpuInfoAndExit(); return; }
    if (!fs.existsSync(path.join(root, 'index.html'))) {
      const msg = `Не найдена собранная сцена: ${path.join(root, 'index.html')}\nВыполните «npm run build» (или «npm run desktop», он собирает сам).`;
      if (isTest) { process.stdout.write('SELFTEST ' + JSON.stringify({ ok: false, error: msg }) + '\n'); app.exit(2); return; }
      dialog.showErrorBox(PRODUCT, msg);
      app.quit();
      return;
    }
    createWindow();
    if (isTest) selftest().catch((e) => finishSelftest({ error: String(e && e.stack || e) }));
  });
}
