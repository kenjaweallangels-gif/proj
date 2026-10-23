#!/usr/bin/env node
/**
 * Smoke test of the real (non-screenshot) game flow in headless Chromium:
 *   loading -> start menu -> НАЧАТЬ -> thrusters -> airlock exit -> spinning-ring contact -> observer mode.
 * Runs with the normal render loop (real time, no ?shot=1). Exit code 1 on any failed check or page error.
 *   node tools/smoke.mjs [--quality=low] [--timeout=600000]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const timeout = parseInt(args.timeout || '600000', 10);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const url = `${server.resolvedUrls.local[0]}?quality=${args.quality || 'low'}&t=600`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let failed = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); if (!ok) failed++; };
const ev = (fn, arg) => page.evaluate(fn, arg);
/** Wait until fn() is truthy in the page (the software GPU renders only a few frames per second). */
const until = (fn, ms = 30000) => page.waitForFunction(fn, null, { timeout: ms, polling: 100 }).then(() => true, () => false);
const frames = (n) => ev((k) => window.__app.renderFrames(k), n);
/** Advance the simulation deterministically by stepping modules directly (the GPU is too slow for real-time waits). */
const step = (seconds) => ev((s) => {
  const a = window.__app, h = 1 / 60;
  for (let t = 0; t < s; t += h) { a.time.sim += h; a.orbit.update(a.time.sim); a.station.update(h, a.ctx); a.ships.update(h, a.ctx); a.player.update(h, a.ctx); }
}, seconds);

try {
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction(() => window.__APP_READY__ === true, null, { timeout });
  check('app ready, no stub fallback', await ev(() => !window.__MODULE_ERRORS__), String(await ev(() => window.__MODULE_ERRORS__ || '')));
  await page.waitForTimeout(1500);

  // menu
  check('start menu shown', await ev(() => window.__app.hud.menu.visible === true));
  check('input disabled behind the menu', await ev(() => window.__app.input.enabled === false));
  await page.getByRole('button', { name: 'НАЧАТЬ' }).click();
  await page.waitForTimeout(500);
  check('menu hidden after НАЧАТЬ', await ev(() => window.__app.hud.menu.visible === false));
  check('input enabled', await ev(() => window.__app.input.enabled !== false));
  check('play mode, player in airlock', await ev(() => window.__app.mode === 'play' && window.__app.player.state.mode === 'airlock'));

  // thrusters with real key events and the real render loop
  const f0 = await ev(() => window.__app.frameCount);
  const prop0 = await ev(() => window.__app.player.state.propellant);
  await page.keyboard.down('KeyW'); await frames(8); await page.keyboard.up('KeyW');
  const thrust = await ev(() => ({ v: window.__app.player.velocity.length(), prop: window.__app.player.state.propellant, f: window.__app.frameCount }));
  check('W thrust accelerates the player (real loop)', thrust.v > 0.01 && thrust.prop < prop0, `v ${thrust.v.toFixed(3)} m/s, propellant ${prop0.toFixed(3)} -> ${thrust.prop.toFixed(3)}, ${thrust.f - f0} frames`);

  // airlock exit sequence
  await ev(() => { const p = window.__app.player; p.setView('airlock'); });
  await frames(2);
  await page.keyboard.press('KeyE');
  check('E starts depressurisation', await until(() => window.__app.player.state.sequence?.name === 'depress'), await ev(() => JSON.stringify(window.__app.player.state.sequence)));
  for (let i = 0; i < 20 && (await ev(() => window.__app.player.state.mode)) !== 'eva'; i++) await step(1);
  check('hatch opened, mode eva', await ev(() => window.__app.player.state.mode === 'eva' && window.__app.station.airlock.hatch.progress > 0.99));
  check('tether clipped on', await ev(() => window.__app.player.state.tetherAttached === true));

  // spinning-ring contact: place the astronaut at rest just outside the rim and let the rim sweep into them
  const ring = await ev(() => {
    const a = window.__app, p = a.player, st = a.station;
    const rim = st.ringPart.colliders.find((c) => c.name === 'rim');
    p.state.tetherAttached = false; p.state.tetherStowed = true;
    const mid = rim.a.clone().add(rim.b).multiplyScalar(0.5);
    const out = mid.clone().setX(0).normalize();
    p.position.copy(mid).addScaledVector(out, rim.radius + p.radius + 0.02);
    p.velocity.set(0, 0, 0);
    return { rimSpeed: st.ring.angularSpeed * st.ring.radius };
  });
  await step(1.5);
  const after = await ev(() => { const p = window.__app.player; return { v: p.velocity.length(), finite: Number.isFinite(p.position.x + p.velocity.x) }; });
  check('spinning ring drags the astronaut along', after.finite && after.v > 0.5, `player ${after.v.toFixed(2)} m/s, rim surface ${ring.rimSpeed.toFixed(1)} m/s`);

  // observer mode toggle
  await page.keyboard.press('KeyF');
  check('F switches to observer', await until(() => window.__app.mode === 'observer'));
  await frames(2);
  await page.keyboard.press('KeyF');
  check('F returns to the suit', await until(() => window.__app.mode === 'play'));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FAIL  exception —', e.message); failed++;
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
