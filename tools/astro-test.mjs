#!/usr/bin/env node
/**
 * Unit checks of the orbital mechanics helpers (src/core/Astro.js) and the time ladder (src/core/Time.js),
 * plain Node (no browser):   node tools/astro-test.mjs
 */
import * as THREE from 'three';
import { kepler, stateToElements, elementsToState, Propagator, GravityModel, OrbitEphemeris, MU_MOON } from '../src/core/Astro.js';
import { MU_EARTH, Orbit } from '../src/core/Orbit.js';
import { SimClock, TIME_RATES } from '../src/core/Time.js';

let failed = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); if (!ok) failed++; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// circular LEO: Kepler after one period returns to the start, a quarter period rotates by 90 degrees
{
  const a = 6781, v = Math.sqrt(MU_EARTH / a), T = 2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH);
  const r1 = V(), v1 = V();
  kepler(V(a, 0, 0), V(0, v, 0), T, MU_EARTH, r1, v1);
  check('kepler: circular orbit closes after one period', r1.distanceTo(V(a, 0, 0)) < 1e-6, `${r1.distanceTo(V(a, 0, 0)).toExponential(2)} km`);
  kepler(V(a, 0, 0), V(0, v, 0), T / 4, MU_EARTH, r1, v1);
  check('kepler: quarter period', r1.distanceTo(V(0, a, 0)) < 1e-6 && v1.distanceTo(V(-v, 0, 0)) < 1e-9);
  kepler(V(a, 0, 0), V(0, v, 0), 1e6 * 3600, MU_EARTH, r1, v1);
  check('kepler: huge dt stays on the orbit', Math.abs(r1.length() - a) < 1e-4, `${(r1.length() - a).toExponential(2)} km`);
}
// elliptic / hyperbolic round trips against the elements
{
  const el = { a: 26600, e: 0.74, i: 63.4 * Math.PI / 180, raan: 1.2, argp: 4.71, nu: 0.3 };
  const r = V(), v = V();
  elementsToState(el, MU_EARTH, r, v);
  const back = stateToElements(r, v, MU_EARTH, {});
  check('elements -> state -> elements (Molniya)', Math.abs(back.a - el.a) < 1e-6 && Math.abs(back.e - el.e) < 1e-10 && Math.abs(back.i - el.i) < 1e-10 && Math.abs(back.raan - el.raan) < 1e-10 && Math.abs(back.argp - el.argp) < 1e-9 && Math.abs(back.nu - el.nu) < 1e-9,
    `a ${back.a.toFixed(3)} e ${back.e.toFixed(6)} perigee alt ${back.periapsisAlt.toFixed(1)} km apogee alt ${back.apoapsisAlt.toFixed(1)} km, T ${(back.period / 3600).toFixed(3)} h`);
  // kepler vs mean-anomaly propagation
  const dt = 5000, r2 = V(), v2 = V();
  kepler(r, v, dt, MU_EARTH, r2, v2);
  const n = Math.sqrt(MU_EARTH / el.a ** 3);
  const M2 = (back.M + n * dt) % (2 * Math.PI);
  let E = M2; for (let k = 0; k < 50; k++) E -= (E - el.e * Math.sin(E) - M2) / (1 - el.e * Math.cos(E));
  const nu2 = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
  const r3 = V(), v3 = V();
  elementsToState({ ...el, nu: nu2 }, MU_EARTH, r3, v3);
  check('kepler (universal variables) = Kepler equation (elliptic)', r2.distanceTo(r3) < 1e-5, `${r2.distanceTo(r3).toExponential(2)} km`);
  const hr = V(), hv = V();
  elementsToState({ a: -20000, e: 1.4, i: 0.3, raan: 0.1, argp: 0.2, nu: -0.5 }, MU_EARTH, hr, hv);
  const e0 = hv.lengthSq() / 2 - MU_EARTH / hr.length();
  kepler(hr, hv, 20000, MU_EARTH, r2, v2);
  const e1 = v2.lengthSq() / 2 - MU_EARTH / r2.length();
  check('kepler: hyperbolic energy conserved', Math.abs(e1 - e0) < 1e-9 * Math.abs(e0) + 1e-9, `${e0.toFixed(6)} -> ${e1.toFixed(6)}`);
}
// numerical integrators vs Kepler (point mass)
{
  const p = new Propagator((r, v, t, out) => out.copy(r).multiplyScalar(-MU_EARTH / r.length() ** 3));
  const r0 = V(7000, 300, -200), v0 = V(0.4, 7.2, 1.1);
  const s = { r: r0.clone(), v: v0.clone() };
  p.rk4Span(s, 0, 6000, 5);
  const rk = V(), vk = V();
  kepler(r0, v0, 6000, MU_EARTH, rk, vk);
  check('RK4 (5 s steps) matches Kepler over 6000 s', s.r.distanceTo(rk) < 1e-3, `${(s.r.distanceTo(rk) * 1000).toFixed(3)} m`);
  const s2 = { r: r0.clone(), v: v0.clone() };
  const steps = p.rk45(s2, 0, 6000, { tol: 1e-7 });
  check('RK45 (adaptive) matches Kepler over 6000 s', s2.r.distanceTo(rk) < 5e-3, `${(s2.r.distanceTo(rk) * 1000).toFixed(3)} m in ${steps} steps`);
  const s3 = { r: s2.r.clone(), v: s2.v.clone() };
  p.rk45(s3, 6000, -6000, { tol: 1e-7 });
  check('RK45 backwards returns to the start', s3.r.distanceTo(r0) < 1e-2, `${(s3.r.distanceTo(r0) * 1000).toFixed(3)} m`);
}
// gravity model: J2 node regression of the station orbit matches Orbit.js' analytic rate
{
  const orbit = new Orbit();
  const eph = new OrbitEphemeris(orbit.epochMs);
  const g = new GravityModel(eph);
  const st = orbit.computeState(0, {});
  const s = { r: st.r.clone(), v: st.v.clone() };
  const p = new Propagator((r, v, t, out) => g.accelerationEci(r, t, out, { moon: false, sun: false }));
  // osculating node: fit a line through samples (short-period J2 terms average out)
  const el0 = stateToElements(st.r, st.v, MU_EARTH, {}), el = {};
  let t = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let k = 0; k < 300; k++) {
    p.rk4Span(s, t, 300, 10); t += 300;
    stateToElements(s.r, s.v, MU_EARTH, el);
    let dO = el.raan - el0.raan; if (dO > Math.PI) dO -= 2 * Math.PI; if (dO < -Math.PI) dO += 2 * Math.PI;
    sx += t; sy += dO; sxx += t * t; sxy += t * dO; n++;
  }
  const rate = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  check('J2: node regression = analytic rate (fit over 16 orbits)', Math.abs(rate - orbit.raanRate) < 0.02 * Math.abs(orbit.raanRate), `${(rate * 86400 * 180 / Math.PI).toFixed(3)} vs ${(orbit.raanRate * 86400 * 180 / Math.PI).toFixed(3)} °/day`);
  const a = V(); g.accelerationEci(st.r, 0, a);
  const a0 = V(); g.accelerationEci(st.r, 0, a0, { j2: false, moon: false, sun: false });
  const third = V(); g.accelerationEci(st.r, 0, third, { j2: false }); third.sub(a0);
  check('third-body accelerations are small (~1e-9 km/s^2)', third.length() > 1e-10 && third.length() < 1e-8, `${third.length().toExponential(2)} km/s^2`);
  const moon = V(); eph.moonPositionEci(0, moon);
  check('Moon distance plausible', moon.length() > 356000 && moon.length() < 407000, `${moon.length().toFixed(0)} km`);
  const vm = V(); eph.moonVelocityEci(0, vm);
  check('Moon speed ~1 km/s', vm.length() > 0.9 && vm.length() < 1.1, `${vm.length().toFixed(3)} km/s`);
  void MU_MOON;
}
// time ladder
{
  const ev = []; const c = new SimClock({ events: { emit: (n, d) => ev.push([n, d]) } });
  c.advance(0.02); check('×1 advances by real dt', Math.abs(c.sim - 0.02) < 1e-12);
  c.setRate(3600); c.advance(0.02); check('×3600 advances 72 s per 20 ms', Math.abs(c.sim - 72.02) < 1e-9);
  c.faster(); check('faster() steps the ladder', c.rate === TIME_RATES[TIME_RATES.indexOf(3600) + 1], String(c.rate));
  c.slower(); c.slower(); check('slower() steps back', c.rate === 1800, String(c.rate));
  c.setPaused(true); const s0 = c.sim; c.advance(0.02); check('pause stops the clock', c.sim === s0 && c.dt === 0);
  c.jump(86400); check('jump +1 day', c.sim === s0 + 86400 && ev.some((e) => e[0] === 'time:jump'));
  check('rate / pause events', ev.some((e) => e[0] === 'time:rate') && ev.some((e) => e[0] === 'time:pause'));
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
