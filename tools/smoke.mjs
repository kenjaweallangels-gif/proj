#!/usr/bin/env node
/**
 * Smoke test of the real (non-screenshot) game flow in headless Chromium:
 *   loading -> start menu -> НАЧАТЬ (inside the station) -> glide (no SAFER) -> float lab -> node 1 -> equipment lock
 *   -> don the suit -> crew lock -> inner hatch, depress, outer hatch -> EVA (tether) -> spinning-ring contact
 *   -> back into the crew lock, repress, inner hatch opens -> doff the suit -> gravity ring: deck, gravity, walking,
 *   Coriolis, spoke ladder -> observer mode.
 * Body / collisions (ctx.collision, exact render geometry): 1.68 m eye height on the ring deck, hand-over-hand along
 * the lab rails, auto-brake at a wall, no passing through a lab wall / a ring cabin partition / a module hull /
 * a docked ship at speed, the observer camera stays outside the geometry.
 * Key presses go through the real render loop; long stretches of physics are advanced deterministically by stepping
 * the modules directly (the software GPU renders only a few frames per second).
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
/**
 * Drive the body at `speed` along `dir` (world) from its current pose for `seconds` (velocity re-imposed every
 * step, as a hard thrust would) and report how far it got compared with the first surface on that line.
 */
const ram = (dir, speed, seconds, mask) => ev(([d, sp, sec, m]) => {
  const a = window.__app, p = a.player, W = a.collision, h = 1 / 60;
  const D = new p.position.constructor(...d).normalize();
  const start = p.position.clone();
  const hit = {};
  const wall = W.raycast(start, D, 30, hit, { mask: m }) ? hit.distance : null;
  let maxAlong = -1e9;
  for (let t = 0; t < sec; t += h) {
    p.velocity.copy(D).multiplyScalar(sp);
    a.time.sim += h; a.orbit.update(a.time.sim); a.station.update(h, a.ctx); a.ships.update(h, a.ctx); a.player.update(h, a.ctx);
    maxAlong = Math.max(maxAlong, p.position.clone().sub(start).dot(D));
  }
  // the gameplay colliders approximate the hulls: the eye must end outside them too (thin rails may be slid past)
  return { wall, maxAlong, clearance: W.distance(p.position, 2, { mask: m }), hull: p.collision.distance(p.position), mode: p.state.mode };
}, [dir, speed, seconds, mask]);
const bodyEvents = () => ev(() => { const e = window.__bodyEv || []; window.__bodyEv = []; return e; });
const state = () => ev(() => { const p = window.__app.player, s = p.state; return { mode: s.mode, seq: s.sequence?.name || null, comp: s.compartment, suited: s.suited, g: s.gravity, frame: s.frame, ladder: s.onLadder, inner: window.__app.station.airlock.innerHatch?.progress, outer: window.__app.station.airlock.hatch.progress, tether: s.tetherAttached }; });

try {
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction(() => window.__APP_READY__ === true, null, { timeout });
  check('app ready, no stub fallback', await ev(() => !window.__MODULE_ERRORS__), String(await ev(() => window.__MODULE_ERRORS__ || '')));
  check('interiors built', await ev(() => window.__app.station.interior?.ready && window.__app.station.interior.zones.length > 20), String(await ev(() => window.__app.station.interior?.zones?.length)));
  await page.waitForTimeout(1500);
  await ev(() => { window.__bodyEv = []; window.__app.events.on('body', (e) => window.__bodyEv.push(e.type)); });
  check('collision world built', await ev(() => !!window.__app.collision?.ready && window.__app.collision.bodies.length > 50), JSON.stringify(await ev(() => window.__app.collision?.stats)));

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

  // hand over hand: W along the lab -> the hands grip the rails / walls ahead and pull (grab + push events)
  await ev(() => window.__app.player.setView('inside'));
  await bodyEvents();
  await step(3.0, ['KeyW']);
  const hoh = await ev(() => ({ v: window.__app.player.velocity.length(), hands: Object.values(window.__app.player.body.handTargets).map((t) => t.phase) }));
  const hev = await bodyEvents();
  check('hand over hand along the lab (auto grab + push)', hev.includes('grab') && hev.includes('push') && hoh.v > 0.6, `v ${hoh.v.toFixed(2)} m/s, events ${[...new Set(hev)].join(',')}, hands ${hoh.hands.join('/')}`);
  // auto-brake: glide (no input) toward the lab end wall at 1 m/s -> the hands brake, no hard bump, no penetration
  const brake = await ev(() => {
    const a = window.__app, p = a.player, W = a.collision, h = 1 / 60;
    p.setView('interior-lab');
    const D = new p.position.constructor(0, 0, -1).applyQuaternion(p.quaternion);
    const hit = {}; const wall = W.raycast(p.position, D, 20, hit, { mask: 10 }) ? hit.distance : null;
    if (wall) p.position.addScaledVector(D, wall - 1.7);
    p.velocity.copy(D).multiplyScalar(1.0);
    let vmin = 9, imp = 0;
    for (let t = 0; t < 4; t += h) { a.time.sim += h; a.station.update(h, a.ctx); a.player.update(h, a.ctx); imp = Math.max(imp, p.mech.impact); }
    return { wall, v: p.velocity.length(), imp, clearance: W.distance(p.position, 2, { mask: 10 }) };
  });
  const bev = await bodyEvents();
  check('auto-brake at a wall with the hands', bev.includes('brake') && brake.v < 0.25 && brake.clearance > 0.1, JSON.stringify(brake) + ' ' + [...new Set(bev)].join(','));
  // thrusting hard into the lab wall: no passing through
  await ev(() => window.__app.player.setView('interior-lab'));
  const labWall = await ram(await ev(() => new (window.__app.player.position.constructor)(0, 0, -1).applyQuaternion(window.__app.player.quaternion).toArray()), 4.0, 3.0, 10);
  check('cannot pass through the lab wall at 4 m/s', labWall.wall !== null && labWall.maxAlong < labWall.wall - 0.1 && labWall.clearance > 0.1, JSON.stringify(labWall));

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

  // EVA: ram a module hull and a docked ship at 3 m/s (untethered): stopped at the surface
  const hullRam = await ev(() => {
    const a = window.__app, p = a.player;
    p.state.tetherAttached = false; p.state.tetherStowed = true; p._reattachBlock = 99;
    p.position.set(-6, -8, 7); p.velocity.set(0, 0, 0); p.quaternion.set(0, 0, 0, 1);
    return true;
  });
  void hullRam;
  const hull = await ram([0, 0, -1], 3.0, 3.0, 15);
  check('EVA: cannot pass through a module hull', hull.wall !== null && (hull.maxAlong < hull.wall - 0.1 || hull.hull > -0.1) && hull.clearance > 0.1 && hull.mode === 'eva', JSON.stringify(hull));
  const shipPose = await ev(() => {
    const a = window.__app, p = a.player, W = a.collision;
    const s = a.ships.ships.find((x) => x.state === 'docked' && x.group.visible);
    if (!s) return null;
    const ax = s.port.approachAxis.clone();
    const c = s.port.position.clone().addScaledVector(ax, Math.min(4, s.length * 0.35));
    let perp = new p.position.constructor(0, 1, 0).cross(ax); if (perp.lengthSq() < 0.1) perp.set(1, 0, 0).cross(ax); perp.normalize();
    // pick the side with a clear approach
    for (const sg of [1, -1]) {
      const st = c.clone().addScaledVector(perp, sg * 9);
      const hit = {};
      if (W.raycast(st, perp.clone().multiplyScalar(-sg), 12, hit, { mask: 15 }) && hit.body.layer === 4) { p.position.copy(st); p.velocity.set(0, 0, 0); return { ship: s.name, dir: perp.clone().multiplyScalar(-sg).toArray() }; }
    }
    return { ship: s.name, dir: null };
  });
  if (shipPose?.dir) {
    const shipRam = await ram(shipPose.dir, 3.0, 4.0, 15);
    check('EVA: cannot pass through a docked ship', shipRam.wall !== null && (shipRam.maxAlong < shipRam.wall - 0.1 || shipRam.hull > -0.1) && shipRam.clearance > 0.1, shipPose.ship + ' ' + JSON.stringify(shipRam));
  } else check('EVA: docked ship found for the ram test', false, JSON.stringify(shipPose));

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
  const back = await fly([[-18.5, -8, 7.0], [-18.5, -8, 6.0], [-18.5, -8, 4.5]]);
  await frames(1);
  await page.keyboard.press('KeyE');
  check('E at the mount starts doffing', await until(() => window.__app.player.state.sequence?.name === 'doff'), JSON.stringify(await state()) + ' ' + JSON.stringify(back));
  await step(4);
  s = await state();
  check('suit off: mode iva', s.mode === 'iva' && !s.suited, JSON.stringify(s));

  // gravity ring: deck contact, ~0.37 g, walking, Coriolis
  await ev(() => window.__app.setView('interior-ring'));
  await step(2.0);
  const g = await ev(() => { const p = window.__app.player, iv = p.iva; return { frame: iv.frame, g: p.state.gravity, grounded: iv.grounded, rho: Math.hypot(iv.pL.y, iv.pL.z), x: iv.pL.x, comp: p.state.compartment }; });
  check('standing on the curved deck of the ring', g.frame === 'ring' && g.grounded && Math.abs(g.rho - (42 - 1.68)) < 0.08, JSON.stringify(g));
  const eye = await ev(() => {
    const a = window.__app, iv = a.player.iva, W = a.collision, hit = {};
    const down = iv.pL.clone().setX(0).normalize();
    return W.raycast(iv.pL, down, 4, hit, { mask: 10, frame: a.station.ring.group }) ? hit.distance : null;
  });
  check('eye height above the ring deck ~1.68 m (1.8 m body)', eye !== null && Math.abs(eye - 1.68) < 0.05, `${eye?.toFixed(3)} m`);
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
  // walk into a closed cabin partition (corridor side wall, x = +-1 m): blocked by the wall
  const cab = await ev(() => {
    const a = window.__app, p = a.player, iv = p.iva, h = 1 / 60, inp = a.input;
    p.setView('interior-ring');
    iv.placeRing(0, 42 - 1.68, 0.19, Math.PI / 2, 0);   // sector 1 corridor beside closed cabin 1-01, facing +x (its partition)
    for (let t = 0; t < 0.5; t += h) { a.time.sim += h; a.station.update(h, a.ctx); a.player.update(h, a.ctx); }
    inp.keys.KeyW = true; inp.keys.ShiftLeft = true;
    let xmax = -9;
    for (let t = 0; t < 4; t += h) { a.time.sim += h; a.station.update(h, a.ctx); a.player.update(h, a.ctx); xmax = Math.max(xmax, iv.pL.x); }
    inp.keys.KeyW = false; inp.keys.ShiftLeft = false;
    return { xmax, grounded: iv.grounded, comp: p.state.compartment };
  });
  check('cannot walk through a ring cabin wall', cab.xmax < 1.0 - 0.15 && cab.grounded, JSON.stringify(cab));

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

  // observer camera: zooming / flying into a module hull stops outside it
  const obs = await ev(() => {
    const a = window.__app, W = a.collision, cam = a.camera;
    a.setView('overview');
    const V = cam.position.constructor;
    const out = new V(-6, -8, 6), D = new V(0, 0, -1), hit = {};
    const wall = W.raycast(out, D, 20, hit, { mask: 15 }) ? hit.distance : null;
    a._obsPrev = out.clone(); cam.position.copy(out);
    a.constrainObserver();
    let maxAlong = 0;
    for (let k = 1; k <= 40; k++) { cam.position.copy(a._obsPrev).addScaledVector(D, 0.25); a.constrainObserver(); maxAlong = Math.max(maxAlong, cam.position.clone().sub(out).dot(D)); }
    // a jump straight into the hull (teleport inside the wall) is pushed out too
    a._obsPrev = null; cam.position.copy(out).addScaledVector(D, wall ?? 0); a.constrainObserver();
    return { wall, maxAlong, clearance: W.distance(cam.position, 2, { mask: 15 }) };
  });
  check('observer camera stays outside the geometry', obs.wall !== null && obs.maxAlong < obs.wall - 0.2 && obs.clearance > 0.2, JSON.stringify(obs));

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FAIL  exception —', e.message); failed++;
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
