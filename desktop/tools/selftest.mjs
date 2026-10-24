#!/usr/bin/env node
/**
 * Runs the desktop app in self-test mode and prints its JSON report (exit code 0 = pass):
 * waits for window.__APP_READY__, checks the app:// protocol (range request, MIME, 404, network blocked),
 * context isolation, pointer lock on a click, measures fps and saves a screenshot via capturePage().
 *
 *   node desktop/tools/selftest.mjs [--exe=<packaged executable or AppImage>] [--out=release/selftest/desktop-selftest.png]
 *                                   [--gpu]  (use the real GPU; default on machines without one: SwiftShader)
 *                                   [any app flags, e.g. --quality=ultra --params="t=2000"]
 *
 * Without a display (CI, containers) the app is started through xvfb-run when it is installed.
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const own = Object.fromEntries(argv.filter((a) => /^--(exe|out|gpu)(=|$)/.test(a)).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return [m[1], m[2] ?? '1']; }));
const pass = argv.filter((a) => !/^--(exe|out|gpu)(=|$)/.test(a));
const out = path.resolve(own.out || path.join(root, 'release', 'selftest', 'desktop-selftest.png'));

const flags = [`--selftest=${out}`, '--width=960', '--height=540', '--window=windowed', '--no-gpu-warning'];
// quality: auto (a CPU rasteriser gets the 'lite' preset, a real GPU its normal preset)
if (!pass.some((a) => a.startsWith('--params'))) flags.push('--params=t=600&autostart=1');
if (!own.gpu && !pass.some((a) => a.startsWith('--angle'))) flags.push('--angle=swiftshader');
if (process.getuid?.() === 0) flags.push('--no-sandbox');   // Chromium refuses to run its sandbox as root (containers)
flags.push('--disable-dev-shm-usage');

let cmd, args;
if (own.exe) { cmd = path.resolve(own.exe); args = [...flags, ...pass]; }
else { cmd = electronPath; args = [root, ...flags, ...pass]; }

const needXvfb = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
if (needXvfb) {
  if (spawnSync('sh', ['-c', 'command -v xvfb-run']).status !== 0) { console.error('No display and no xvfb-run: install xvfb (sudo apt install xvfb)'); process.exit(2); }
  args = ['-a', '-s', '-screen 0 1920x1080x24', cmd, ...args];
  cmd = 'xvfb-run';
}
if (own.exe && /\.AppImage$/i.test(own.exe)) process.env.APPIMAGE_EXTRACT_AND_RUN = '1';   // works without FUSE / libfuse2 (containers, CI)
console.log(`> ${cmd} ${args.join(' ')}`);
const child = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_ENABLE_LOGGING')) });
let stdout = '';
child.stdout.on('data', (d) => { stdout += d; process.stdout.write(d); });
child.stderr.on('data', (d) => { const s = String(d); if (!/dbus|Fontconfig|libva|DevTools listening|ALSA|pulse/i.test(s)) process.stderr.write(s); });
child.on('exit', (code) => {
  const m = /SELFTEST (\{[\s\S]*?\n\})/.exec(stdout);
  if (!m) { console.error(`self-test produced no report (exit ${code})`); process.exit(code || 1); }
  const r = JSON.parse(m[1]);
  console.log('\n' + (r.checks || []).map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}`).join('\n'));
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  app ready in ${(r.readyMs / 1000).toFixed(1)} s, ${r.fps} fps, quality ${r.state?.quality}, renderer: ${r.gpu?.renderer}`);
  if (r.shot?.file && fs.existsSync(r.shot.file)) console.log(`screenshot: ${r.shot.file}`);
  process.exit(code ?? (r.ok ? 0 : 1));
});
