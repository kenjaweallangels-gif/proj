#!/usr/bin/env node
/**
 * Smoke test of the real (non-screenshot) game flow in headless Chromium:
 *   loading -> start menu -> НАЧАТЬ (inside the station) -> glide (no SAFER) -> float lab -> node 1 -> equipment lock
 *   -> don the suit -> crew lock -> inner hatch, depress, outer hatch -> EVA (tether) -> spinning-ring contact
 *   -> back into the crew lock, repress, inner hatch opens -> doff the suit -> gravity ring: deck, gravity, walking,
 *   Coriolis, spoke ladder -> observer mode.
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
const state = () => ev(() => { const p = window.__app.player, s = p.state; return { mode: s.mode, seq: s.sequence?.name || null, comp: s.compartment, suited: s.suited, g: s.gravity, frame: s.frame, ladder: s.onLadder, inner: window.__app.station.airlock.innerHatch?.progress, outer: window.__app.station.airlock.hatch.progress, tether: s.tetherAttached }; });

try {
  await page.goto(url, { waitUntil: 'load', timeout });
  await page.waitForFunction(() => window.__APP_READY__ === true, null, { timeout });
  check('app ready, no stub fallback', await ev(() => !window.__MODULE_ERRORS__), String(await ev(() => window.__MODULE_ERRORS__ || '')));
  check('interiors built', await ev(() => window.__app.station.interior?.ready && window.__app.station.interior.zones.length > 20), String(await ev(() => window.__app.station.interior?.zones?.length)));
  await page.waitForTimeout(1500);

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

  // ---- sky and telescope
  const sky = await ev(() => { const a = window.__app, s = a.sky, m = a.ephemeris?.bodies?.moon; return { stars: s.starField.count, moonKm: m?.dist, patches: s.moon.surface.patchCount, mw: !!s.milkyWayTexture }; });
  check('sky: catalogue stars, Milky Way, ephemeris Moon, Moon LOD patches', sky.stars > 1000 && sky.mw && sky.moonKm > 350000 && sky.moonKm < 410000 && sky.patches >= 6, JSON.stringify(sky));
  await page.keyboard.press('KeyZ');
  await frames(2);
  check('telescope refused away from the cupola / EVA / observer camera', await ev(() => window.__app.telescope.active === false));
  await page.keyboard.press('KeyF');
  await until(() => window.__app.mode === 'observer');
  await page.keyboard.press('KeyZ');
  check('Z opens the telescope (observer camera)', await until(() => window.__app.telescope.active === true, 20000));
  await page.locator('.tel-search').fill('Юпитер');
  await page.locator('.tel-search').press('Enter');
  check('catalogue search selects Jupiter', await until(() => window.__app.telescope.target?.id === 'jupiter', 20000));
  const fov0 = await ev(() => window.__app.telescope.fovTarget);
  const canvasBox = await page.locator('#app canvas').first().boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.3, canvasBox.y + canvasBox.height * 0.5);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
  await frames(2);
  const fov1 = await ev(() => window.__app.telescope.fovTarget);
  check('mouse wheel zooms in', fov1 < fov0 * 0.6, `${fov0.toFixed(2)} -> ${fov1.toFixed(3)} deg`);
  await ev(() => window.__app.telescope.setFov(0.05));
  await page.keyboard.down('Equal'); await frames(4); await page.keyboard.up('Equal');
  await frames(30);
  const trk = await ev(() => {
    const a = window.__app, T = a.telescope, b = a.ephemeris.bodies.jupiter;
    const V = a.camera.position.constructor;
    const fwd = new V(0, 0, -1).applyQuaternion(a.camera.getWorldQuaternion(a.camera.quaternion.clone())).applyQuaternion(a.orbit.skyQuat.clone().invert());
    const dir = new V(b.topo.x, b.topo.y, b.topo.z).normalize();
    return { err: fwd.angleTo(dir) * 180 / Math.PI, fov: a.camera.fov, rPx: a.sky.planets.radiusPx('jupiter'), lim: T.limitMag };
  });
  check('telescope zooms to ~0.05 deg and tracks Jupiter (disc resolved)', trk.fov < 0.08 && trk.err < trk.fov * 0.1 && trk.rPx > 10, JSON.stringify(trk));
  await page.keyboard.press('Escape');
  check('Esc closes the telescope, camera fov restored', await until(() => !window.__app.telescope.active && window.__app.camera.fov > 60, 20000));
  await page.keyboard.press('KeyC');
  await frames(2);
  check('C toggles the constellation overlay', await ev(() => window.__app.sky.overlays.mode === 1 && window.__app.sky.overlays.figures.visible));
  await page.keyboard.press('KeyC'); await page.keyboard.press('KeyC');

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FAIL  exception —', e.message); failed++;
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
