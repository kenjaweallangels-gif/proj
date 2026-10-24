#!/usr/bin/env node
/**
 * Smoke test of the real (non-screenshot) game flow in headless Chromium:
 *   loading -> start menu -> НАЧАТЬ (inside the station) -> glide (no SAFER) -> float lab -> node 1 -> equipment lock
 *   -> don the suit -> crew lock -> inner hatch, depress, outer hatch -> EVA (tether) -> spinning-ring contact
 *   -> back into the crew lock, repress, inner hatch opens -> doff the suit -> gravity ring: deck, gravity, walking,
 *   Coriolis, spoke ladder -> observer mode -> time controls (buttons, pause, ×3600 for a few real seconds, jumps,
 *   the astronaut on rails) -> free camera (fly > 1000 km away and back, Moon, station hidden / shown) -> orbital
 *   mechanics unit checks (tools/astro-test.mjs).
 * Key presses go through the real render loop; long stretches of physics are advanced deterministically by stepping
 * the modules directly (the software GPU renders only a few frames per second).
 *   node tools/smoke.mjs [--quality=low] [--timeout=600000] [--only=core]   (core: time controls + free camera only)
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const timeout = parseInt(args.timeout || '600000', 10);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, configFile: path.join(root, 'vite.config.js'), server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const url = `${server.resolvedUrls.local[0]}?quality=${args.quality || 'low'}&t=600&minh=0&pr=${args.pr || '0.5'}`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let failed = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); if (!ok) failed++; };
const ev = (fn, arg) => page.evaluate(fn, arg);
/** Wait until fn() is truthy in the page (the software GPU renders only a few frames per second). */
const until = (fn, ms = 120000) => page.waitForFunction(fn, null, { timeout: ms, polling: 100 }).then(() => true, () => false);
const frames = (n) => ev((k) => window.__app.renderFrames(k), n);
/** Advance the simulation deterministically by stepping modules directly (keys held in `keys` are pressed). */
const step = (seconds, keys = []) => ev(([s, k]) => {
  const a = window.__app, h = 1 / 60, inp = a.input;
  for (const c of k) inp.keys[c] = true;
  for (let t = 0; t < s; t += h) { a.time.sim += h; a.orbit.update(a.time.sim); a.station.update(h, a.ctx); a.ships.update(h, a.ctx); a.player.update(h, a.ctx); }
  for (const c of k) inp.keys[c] = false;
}, [seconds, keys]);
/** Fly the astronaut through world waypoints (as if pushing off handrails), collisions on; returns the compartments visited. */
const fly = (pts) => ev((wps) => {
  const a = window.__app, p = a.player, h = 1 / 60, seen = [];
  for (const w of wps) {
    for (let i = 0; i < 1800; i++) {
      const dx = w[0] - p.position.x, dy = w[1] - p.position.y, dz = w[2] - p.position.z, d = Math.hypot(dx, dy, dz);
      if (d < 0.2) break;
      const sp = Math.min(0.9, d * 1.5);
      p.velocity.set(dx / d * sp, dy / d * sp, dz / d * sp);
      a.time.sim += h; a.orbit.update(a.time.sim); a.station.update(h, a.ctx); a.player.update(h, a.ctx);
      const c = p.state.compartment;
      if (c && seen[seen.length - 1] !== c) seen.push(c);
    }
  }
  p.velocity.set(0, 0, 0);
  return { seen, pos: p.position.toArray() };
}, pts);
const state = () => ev(() => { const p = window.__app.player, s = p.state; return { mode: s.mode, seq: s.sequence?.name || null, comp: s.compartment, suited: s.suited, g: s.gravity, frame: s.frame, ladder: s.onLadder, inner: window.__app.station.airlock.innerHatch?.progress, outer: window.__app.station.airlock.hatch.progress, tether: s.tetherAttached }; });

/** Time controls and the free camera (also alone with --only=core). */
async function coreChecks() {
  const T = () => ev(() => { const a = window.__app, t = a.time; return { sim: t.sim, rate: t.rate, paused: t.paused, frames: a.frameCount, mode: a.mode }; });
  await ev(() => { const a = window.__app; a.setView('inside'); a.time.setPaused(false); a.time.setRate(1); });
  await frames(2);
  // keyboard: ] faster, [ slower, \ x1
  await page.keyboard.press('BracketRight'); await frames(1);
  let t = await T();
  check('] speeds the clock up (x2)', t.rate === 2, JSON.stringify(t));
  await page.keyboard.press('BracketLeft'); await page.keyboard.press('BracketLeft'); await frames(1);
  t = await T();
  check('[ slows it down (x0.5)', t.rate === 0.5, JSON.stringify(t));
  await page.keyboard.press('Backslash'); await frames(1);
  check('\\ resets to x1', (await T()).rate === 1);

  // buttons in the observer panel
  await page.keyboard.press('KeyF');
  check('observer mode for the time panel', await until(() => window.__app.mode === 'observer'));
  const obs = page.locator('.obs:not(.free)');
  await obs.locator('.tc-presets button', { hasText: /^×600$/ }).click({ timeout: 60000 });
  await frames(1);
  check('preset button sets x600', (await T()).rate === 600, JSON.stringify(await T()));
  await obs.locator('.tc-pause').click({ timeout: 60000 });
  const p0 = await T(); await frames(3); const p1 = await T();
  check('pause button stops the clock (frames keep rendering)', p0.paused && p1.paused && p1.sim === p0.sim && p1.frames > p0.frames, `${p0.sim} -> ${p1.sim}`);
  await obs.locator('.tc-pause').click({ timeout: 60000 });
  check('pause button resumes', (await T()).paused === false);
  await obs.locator('.tc-row button', { hasText: /^»$/ }).click({ timeout: 60000 });
  check('» button: next rate on the ladder', (await T()).rate === 1800);
  await obs.locator('.tc-row button', { hasText: /^×1$/ }).click({ timeout: 60000 });
  check('×1 button resets the rate', (await T()).rate === 1);

  // x3600 for a few real seconds: everything advances and stays finite
  const before = await ev(() => { const a = window.__app; return { sim: a.time.sim, traffic: a.ships.traffic.t, log: a.ships.getLog().length, frames: a.frameCount }; });
  await obs.locator('.tc-presets button', { hasText: /^×3600$/ }).click({ timeout: 60000 });
  await page.waitForTimeout(6000);
  const after = await ev(() => {
    const a = window.__app, o = a.orbit;
    const ok = (v) => Number.isFinite(v.x + v.y + v.z);
    const shipsOk = a.ships.ships.every((s) => ok(s.group.position) && ok(s.velocity) && s.colliders.every((c) => (c.center ? ok(c.center) : ok(c.a) && ok(c.b))));
    return { sim: a.time.sim, traffic: a.ships.traffic.t, frames: a.frameCount, shipsOk, states: a.ships.ships.map((s) => s.state).join(','),
      orbitOk: ok(o.sunDir) && ok(o.earthCenterFar) && Number.isFinite(o.sunVisible), playerOk: ok(a.player.position), docked: a.ships.ships.filter((s) => s.state === 'docked').length };
  });
  // each frame advances min(real dt, 1/20 s) x 3600 = up to 3 min (the software GPU renders a few frames per second)
  const nf = after.frames - before.frames;
  check('x3600: rendering continues, sim time advances up to 3 min per frame', nf >= 2 && after.sim - before.sim >= 150 && after.sim - before.sim <= 180.5 * nf, `${((after.sim - before.sim) / 3600).toFixed(2)} h in ${nf} frames`);
  check('x3600: docking traffic kept pace (fast-forward)', after.traffic - before.traffic > 0.9 * (after.sim - before.sim), `traffic +${(after.traffic - before.traffic).toFixed(0)} s`);
  check('x3600: ships / orbit / player stay finite, ships docked', after.shipsOk && after.orbitOk && after.playerOk && after.docked > 0, after.states);
  await obs.locator('.tc-row button', { hasText: /^×1$/ }).click({ timeout: 60000 });
  // jumps
  const j0 = await ev(() => ({ sim: window.__app.time.sim, traffic: window.__app.ships.traffic.t }));
  await obs.locator('.tc-jumps button', { hasText: '+1 сут' }).click({ timeout: 60000 });
  await frames(1);
  const j1 = await ev(() => ({ sim: window.__app.time.sim, traffic: window.__app.ships.traffic.t, sub: window.__app.orbit.subLatDeg }));
  check('+1 сут jumps the clock by a day, traffic catches up', j1.sim - j0.sim >= 86400 && j1.traffic - j0.traffic >= 86400 && Number.isFinite(j1.sub), `${(j1.sim - j0.sim).toFixed(0)} s`);
  // date field
  await obs.locator('.tc-date').fill('2026-12-31T23:00');
  await obs.locator('.tc-goto button').click({ timeout: 60000 });
  const d = await ev(() => window.__app.time.utc().toISOString());
  check('date field jumps to the UTC date', d.startsWith('2026-12-31T23:00'), d);
  await ev(() => window.__app.time.setUtc(Date.UTC(2026, 9, 22, 9, 40)));

  // astronaut on rails above x10
  await page.keyboard.press('KeyF');
  await until(() => window.__app.mode === 'play');
  await ev(() => { const a = window.__app; a.setView('eva'); a.player.velocity.set(0.3, 0, 0); a.time.setRate(600); });
  await frames(2);
  const r0 = await ev(() => { const p = window.__app.player; return { on: p.state.onRails, pos: p.position.toArray(), o2: p.state.o2 }; });
  await frames(4);
  const r1 = await ev(() => { const p = window.__app.player; return { on: p.state.onRails, pos: p.position.toArray(), o2: p.state.o2, v: p.velocity.length() }; });
  check('x600: astronaut on rails (frozen, consumables paused)', r0.on && r1.on && r0.pos.every((x, i) => Math.abs(x - r1.pos[i]) < 1e-9) && r1.o2 === r0.o2 && Math.abs(r1.v - 0.3) < 1e-6, JSON.stringify(r1));
  await ev(() => window.__app.time.setRate(10));
  await frames(3);
  const r2 = await ev(() => { const p = window.__app.player; return { on: p.state.onRails, pos: p.position.toArray() }; });
  check('x10: physics runs again in sim time (sub-stepped)', !r2.on && Math.abs(r2.pos[0] - r1.pos[0]) > 0.01, `dx ${(r2.pos[0] - r1.pos[0]).toFixed(3)} m`);
  await ev(() => { const a = window.__app; a.time.setRate(1); a.setView('eva'); });

  // free camera: C from the astronaut, fly > 1000 km away, Moon, back with B, exit with C
  await page.keyboard.press('KeyC');
  check('C enters the free camera', await until(() => window.__app.mode === 'free' && window.__app.freeCam.active));
  const f0 = await ev(() => ({ st: window.__app.universe.isStationFrame, d: window.__app.universe.camera.distanceToStationKm }));
  check('free camera starts at the astronaut, default frame', f0.st && f0.d < 0.2, JSON.stringify(f0));
  const fly = await ev(() => {
    const a = window.__app, f = a.freeCam, inp = a.input;
    f.speedExp = 7;   // 10 000 km/s
    inp.keys.KeyW = true;
    for (let i = 0; i < 40; i++) { f.update(0.05); a.orbit.update(a.time.sim); a.universe.update(); }
    inp.keys.KeyW = false;
    return f.info({});
  });
  await frames(2);
  const far = await ev(() => {
    const a = window.__app, u = a.universe, o = a.orbit, cam = a.camera;
    const camEci = u.cameraEci(new cam.position.constructor());
    const qd = Math.abs(o.skyQuat.dot(u.frame.quat));
    return { frame: u.frame.name, isStation: u.isStationFrame, rootVisible: u.stationRoot.visible, camAtOrigin: cam.position.length(),
      earthDist: o.earthCenterFar.length(), camR: camEci.length(), skyQ: qd, sunLen: o.sunDir.length(), alt: u.camera.altitudeKm,
      farNear: a.farCamera.near, finite: Number.isFinite(o.earthQuat.x + o.moonPosFar.x + o.sunVisible) };
  });
  check('flew > 1000 km away from the station', fly.distanceToStationKm > 1000 && fly.anchor !== 'station', `${fly.distanceToStationKm.toFixed(0)} km, anchor ${fly.anchor}, alt ${fly.altitudeKm.toFixed(0)} km`);
  check('floating origin: camera at the render origin, frame follows it', !far.isStation && far.camAtOrigin < 1e-6 && Math.abs(far.earthDist - far.camR) < 1e-3, JSON.stringify(far));
  check('Earth / sky consistent with the frame', far.skyQ > 0.999999 && Math.abs(far.sunLen - 1) < 1e-6 && far.finite && far.farNear > 20);
  check('station hidden far away', far.rootVisible === false);
  await ev(() => window.__app.freeCam.jumpTo('moon'));
  await frames(2);
  const moon = await ev(() => { const a = window.__app, u = a.universe; return { anchor: a.freeCam.anchor, dMoon: u.camera.distanceToMoonKm, split: u.farSplit?.body || null, frames: a.frameCount }; });
  check('Moon: anchored to the Moon, far scene depth split', moon.anchor === 'moon' && moon.dMoon < 20000 && moon.split === 'moon', JSON.stringify(moon));
  await page.keyboard.press('KeyB');
  await frames(2);
  const back = await ev(() => { const a = window.__app, u = a.universe; return { anchor: a.freeCam.anchor, st: u.isStationFrame, root: u.stationRoot.visible, d: u.camera.distanceToStationKm, near: a.camera.near, farNear: a.farCamera.near }; });
  check('B returns to the station: default frame, station shown', back.anchor === 'station' && back.st && back.root && back.d < 1, JSON.stringify(back));
  // collisions: flying straight at the station stops at the hull; inside, the cabin walls hold the camera
  const hull = await ev(() => {
    const a = window.__app, f = a.freeCam, inp = a.input;
    f.lookAtBody('station'); f.speedExp = Math.log10(40);
    inp.keys.KeyW = true;
    let minD = 1e9, hits = 0;
    for (let i = 0; i < 240; i++) { f.update(0.05); a.orbit.update(a.time.sim); a.universe.update(); minD = Math.min(minD, f.collider.world.distance(f.offset)); if (f.contact) hits++; }
    inp.keys.KeyW = false;
    return { minD, hits, d: f.offset.length(), zone: a.station.interior.locate(f.offset)?.name || null };
  });
  check('free camera stops at the hull and slides (never inside a collider)', hull.minD > 0.15 && hull.hits > 0 && !hull.zone, JSON.stringify(hull));
  await ev(() => { const a = window.__app; a.leaveFreeCamera('play'); a.setView('inside'); });
  await frames(1);
  await page.keyboard.press('KeyC');
  await until(() => window.__app.mode === 'free');
  const cabin = await ev(() => {
    const a = window.__app, f = a.freeCam, inp = a.input, I = a.station.interior;
    f.speedExp = Math.log10(3);
    inp.keys.KeyW = true; inp.keys.Space = true;
    let out = 0;
    for (let i = 0; i < 300; i++) { f.update(0.05); a.orbit.update(a.time.sim); a.universe.update(); if (!I.locate(f.offset, null, 0.05)) out++; }
    inp.keys.KeyW = false; inp.keys.Space = false;
    return { out, zone: I.locate(f.offset)?.name || null, pos: f.offset.toArray().map((x) => +x.toFixed(2)) };
  });
  check('free camera stays inside the compartments (walls hold it)', cabin.out === 0 && !!cabin.zone, JSON.stringify(cabin));
  await page.keyboard.press('KeyB');
  await frames(1);
  await page.keyboard.press('KeyC');
  check('C leaves the free camera (back to the astronaut)', await until(() => window.__app.mode === 'play' && !window.__app.freeCam.active));
  await frames(2);
  const restored = await ev(() => ({ near: window.__app.camera.near, far: window.__app.camera.far, fnear: window.__app.farCamera.near, ffar: window.__app.farCamera.far }));
  check('camera planes restored to the defaults', restored.near === 0.05 && restored.far === 6000 && restored.fnear === 20 && restored.ffar === 2.5e6, JSON.stringify(restored));
}

try {
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction(() => window.__APP_READY__ === true, null, { timeout });
  check('app ready, no stub fallback', await ev(() => !window.__MODULE_ERRORS__), String(await ev(() => window.__MODULE_ERRORS__ || '')));
  check('interiors built', await ev(() => window.__app.station.interior?.ready && window.__app.station.interior.zones.length > 20), String(await ev(() => window.__app.station.interior?.zones?.length)));
  await page.waitForTimeout(1500);
  if (args.only === 'core') {
    await page.getByRole('button', { name: 'НАЧАТЬ' }).click({ noWaitAfter: true, timeout });
    await page.waitForTimeout(500);
    await coreChecks();
    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    throw Object.assign(new Error('core only'), { done: true });
  }

  // menu
  check('start menu shown', await ev(() => window.__app.hud.menu.visible === true));
  check('input disabled behind the menu', await ev(() => window.__app.input.enabled === false));
  await page.getByRole('button', { name: 'НАЧАТЬ' }).click({ noWaitAfter: true, timeout });
  await page.waitForTimeout(500);
  check('menu hidden after НАЧАТЬ', await ev(() => window.__app.hud.menu.visible === false));
  check('input enabled', await ev(() => window.__app.input.enabled !== false));
  await frames(3);
  let s = await state();
  check('play mode, player inside the station without the suit', s.mode === 'iva' && !s.suited && !!s.comp, JSON.stringify(s));

  // glide with real key events and the real render loop (no SAFER propellant inside)
  const prop0 = await ev(() => window.__app.player.state.propellant);
  await page.keyboard.down('KeyW'); await frames(8); await page.keyboard.up('KeyW');
  const glide = await ev(() => ({ v: window.__app.player.velocity.length(), prop: window.__app.player.state.propellant }));
  check('W glides inside (real loop), no propellant used', glide.v > 0.01 && glide.prop === prop0, `v ${glide.v.toFixed(3)} m/s, propellant ${glide.prop}`);

  // float from the lab through node 1 into the equipment lock
  await ev(() => window.__app.player.setView('inside'));
  const route = await fly([[-15.6, -8, 0], [-17.2, -8, 0], [-18.5, -8, 0.4], [-18.5, -8, 2.2], [-18.5, -8, 3.5], [-18.5, -8, 4.4]]);
  check('floated lab -> node 1 -> equipment lock', route.seen.some((c) => c.includes('ИСТОК')) && route.seen.some((c) => c.includes('УЗЕЛ-1')) && route.seen.some((c) => c.includes('оборудования')), route.seen.join(' → '));

  // don the suit (E at the suit mount)
  await frames(1);
  check('suit within reach', await ev(() => window.__app.player.state.nearSuit === true));
  await page.keyboard.press('KeyE');
  check('E starts donning the suit', await until(() => window.__app.player.state.sequence?.name === 'don'), JSON.stringify(await state()));
  await step(4.5);
  s = await state();
  check('suit on: mode airlock', s.mode === 'airlock' && s.suited, JSON.stringify(s));

  // into the crew lock, close the inner hatch, depress, open the outer hatch
  const r2 = await fly([[-18.5, -8, 5.6], [-18.5, -8, 6.5], [-18.5, -8, 7.6], [-18.5, -8, 8.05]]);
  check('crew lock reached', r2.seen.some((c) => c.includes('шлюзовая')), r2.seen.join(' → '));
  await frames(1);
  await page.keyboard.press('KeyE');
  check('E closes the inner hatch', await until(() => ['innerClose', 'depress'].includes(window.__app.player.state.sequence?.name)), JSON.stringify(await state()));
  for (let i = 0; i < 30 && (await state()).mode !== 'eva'; i++) await step(1);
  s = await state();
  check('inner hatch closed, outer hatch open, mode eva', s.mode === 'eva' && s.inner < 0.01 && s.outer > 0.99, JSON.stringify(s));
  check('tether clipped on', s.tether === true);

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

  // back into the crew lock: close the outer hatch, repress, the inner hatch opens
  await ev(() => { const a = window.__app, p = a.player; p.position.copy(a.station.airlock.standPosition); p.velocity.set(0, 0, 0); p.state.tetherAttached = true; p.state.tetherStowed = false; });
  await step(0.2);
  await frames(1);
  await page.keyboard.press('KeyE');
  check('E at the crew lock closes the outer hatch', await until(() => window.__app.player.state.sequence?.name === 'close'), JSON.stringify(await state()));
  for (let i = 0; i < 25 && !((await state()).mode === 'airlock' && (await state()).inner > 0.99); i++) await step(1);
  s = await state();
  check('repressurised, inner hatch open, back inside in the suit', s.mode === 'airlock' && s.outer < 0.01 && s.inner > 0.99, JSON.stringify(s));

  // doff the suit at its mount
  await fly([[-18.5, -8, 7.0], [-18.5, -8, 6.0], [-18.5, -8, 4.5]]);
  await frames(1);
  await page.keyboard.press('KeyE');
  check('E at the mount starts doffing', await until(() => window.__app.player.state.sequence?.name === 'doff'), JSON.stringify(await state()));
  await step(4);
  s = await state();
  check('suit off: mode iva', s.mode === 'iva' && !s.suited, JSON.stringify(s));

  // gravity ring: deck contact, ~0.37 g, walking, Coriolis
  await ev(() => window.__app.setView('interior-ring'));
  await step(2.0);
  const g = await ev(() => { const p = window.__app.player, iv = p.iva; return { frame: iv.frame, g: p.state.gravity, grounded: iv.grounded, rho: Math.hypot(iv.pL.y, iv.pL.z), x: iv.pL.x, comp: p.state.compartment }; });
  check('standing on the curved deck of the ring', g.frame === 'ring' && g.grounded && Math.abs(g.rho - (42 - 0.3)) < 0.15, JSON.stringify(g));
  check('spin gravity ~0.37 g at the deck', g.g > 0.3 && g.g < 0.45, `${g.g.toFixed(3)} g`);
  const phi0 = await ev(() => { const iv = window.__app.player.iva; return Math.atan2(iv.pL.z, iv.pL.y); });
  await step(2.5, ['KeyW']);
  const walk = await ev(() => { const iv = window.__app.player.iva; return { phi: Math.atan2(iv.pL.z, iv.pL.y), rho: Math.hypot(iv.pL.y, iv.pL.z), grounded: iv.grounded, cor: iv.coriolis }; });
  const walked = (walk.phi - phi0) * 42;
  check('walking along the corridor (spinward)', walked > 2 && walk.grounded, `${walked.toFixed(2)} m, rho ${walk.rho.toFixed(2)}`);
  // Coriolis: a dropped (released) body drifts anti-spinward relative to the deck
  const drop = await ev(() => {
    const a = window.__app, iv = a.player.iva, h = 1 / 60;
    iv.pL.set(0.1, (42 - 2.0) * Math.cos(0.35), (42 - 2.0) * Math.sin(0.35)); iv.vL.set(0, 0, 0); iv.grounded = false;
    for (let t = 0; t < 1.2 && !iv.grounded; t += h) { a.time.sim += h; a.station.update(h, a.ctx); a.player.update(h, a.ctx); }
    return { dphi: Math.atan2(iv.pL.z, iv.pL.y) - 0.35, grounded: iv.grounded };
  });
  check('Coriolis: a falling body lands anti-spinward', drop.dphi < -0.0005 && drop.grounded, `dphi ${drop.dphi.toFixed(5)} rad`);
  // spoke ladder: W climbs the way the camera looks (the view looks down the shaft); apparent gravity ~ radius
  await ev(() => window.__app.setView('interior-spoke'));
  await step(0.1);
  const ladState = () => ev(() => { const p = window.__app.player, iv = p.iva; return { ladder: p.state.onLadder, g: p.state.gravity, rho: Math.hypot(iv.pL.y, iv.pL.z) }; });
  const lad0 = await ladState();
  await step(3.0, ['KeyW']);
  const lad1 = await ladState();
  await step(3.0, ['KeyS']);
  const lad2 = await ladState();
  const dg = lad1.g - lad0.g, dr = lad1.rho - lad0.rho;
  check('spoke ladder: climbing moves along the spoke, gravity follows the radius', lad0.ladder && lad2.ladder && Math.abs(dr) > 1 && Math.abs(dg) > 0.01 && dg * dr > 0 && (lad2.g - lad1.g) * dg < 0,
    `${lad0.g.toFixed(3)} g (rho ${lad0.rho.toFixed(1)}) -> ${lad1.g.toFixed(3)} g (rho ${lad1.rho.toFixed(1)}) -> ${lad2.g.toFixed(3)} g`);

  // observer mode toggle
  await page.keyboard.press('KeyF');
  check('F switches to observer', await until(() => window.__app.mode === 'observer'));
  await frames(2);
  await page.keyboard.press('KeyF');
  check('F returns to the astronaut', await until(() => window.__app.mode === 'play'));

  await coreChecks();
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  if (!e.done) { console.log('FAIL  exception —', e.message); failed++; }
} finally {
  await browser.close();
  await server.close();
}
// orbital mechanics / clock unit checks (plain Node)
try { process.stdout.write(execFileSync(process.execPath, [path.join(root, 'tools/astro-test.mjs')], { encoding: 'utf8' })); }
catch (e) { process.stdout.write(String(e.stdout || '')); console.log('FAIL  tools/astro-test.mjs'); failed++; }
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
