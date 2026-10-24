import * as THREE from 'three';
import { foldWings } from './Russian.js';

/**
 * Part animation driven by the traffic state machine.
 *
 * Every ship carries `anim` = { deploy, antenna, probe, nose, scs, hooks, track } channels (0..1) that move
 * toward targets derived from `ship.state` / `ship.flight` at realistic rates:
 *   deploy  – solar wings / UltraFlex fans / folding wings: stowed at spawn (fresh from orbit insertion),
 *             deployed during the first minute of the arrival, kept deployed afterwards
 *   antenna – Kurs booms and dipoles: deploy during the arrival
 *   track   – rendezvous antenna / sensor heads follow the station while arriving or approaching, park when docked
 *   probe   – probe extension: extended on approach, pushed in by contact during the last ~0.4 m, retracted
 *             (pulling the ships together) during capture, re-extended after the push-off
 *   nose    – nose cone / docking-hatch cover: opens at the hold point, closes after the departure push-off
 *   scs     – soft-capture ring extension (= traffic petalExtend); hooks close when it is retracted
 * The type's author returns `info` naming the pivots / instanced sets these channels drive (see `applyParts`).
 */

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Matrix4(), _r = new THREE.Matrix4();
const STATION_CENTER = new THREE.Vector3(0, -8, 0);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function makeAnim() {
  return { deploy: 1, antenna: 1, probe: 0, nose: 1, scs: 0, hooks: 1, tilt: 0, trackOn: 0, applied: {}, snap: true, lastState: null };
}

/** Channel targets (and rates in 1/s) for the current state. */
function targets(ship, out) {
  const f = ship.flight, st = ship.state;
  out.deploy = 1; out.antenna = 1; out.probe = 0; out.nose = 1; out.track = 0;
  out.rDeploy = 1 / 45; out.rAntenna = 1 / 20; out.rProbe = 1 / 25; out.rNose = 1 / 22;
  if (st === 'idle') { out.deploy = 0; out.antenna = 0; out.nose = 0; out.probe = 0; return out; }
  if (st === 'arrive' && f) {
    // fresh from orbit insertion: wings first, then the rendezvous antennas and the probe
    out.deploy = f.t > 4 ? 1 : 0; out.antenna = f.t > 30 ? 1 : 0; out.probe = f.t > 50 ? 1 : 0; out.nose = 0; out.track = 1;
    return out;
  }
  if (st === 'approach' && f) {
    out.track = 1; out.probe = 1;
    if (f.phase === 'hold') { out.nose = f.t > 3 ? 1 : 0; }
    if (f.phase === 'approach' && f.mover) {
      const dist = f.mover.path.length - f.mover.s;
      out.probeContact = dist;                 // the port's hatch pushes the probe in during the last few dm
    }
    return out;
  }
  if (st === 'dock' && f) { out.probe = 0; out.rProbe = 1 / 3.2; out.probeContact = 0; out.track = 1; return out; }
  if (st === 'undock' && f) {
    out.probe = f.phase === 'pushoff' && f.mover && f.mover.s > 1.5 ? 1 : 0;
    out.nose = f.phase === 'pushoff' && f.mover ? clamp01(1 - (f.mover.s - 3) / 20) : 1;
    out.rNose = 1 / 5;
    return out;
  }
  if (st === 'depart') { out.nose = 0; out.probe = 1; return out; }
  return out;   // docked / loiter
}

const T = {};
const HKEY = [];
function approach(cur, target, rate, dt) { const d = target - cur, s = rate * dt; return Math.abs(d) <= s ? target : cur + Math.sign(d) * s; }

/** Per-frame update: lights, channels, parts. */
export function animateShip(dt, ship, t) {
  const L = ship.lights;
  // engine glow saturates while burning, decays with a ~6 s time constant
  ship.engineGlow = THREE.MathUtils.clamp(ship.engineGlow + (ship.burning ? dt * 0.8 : -dt * 0.16), 0, 1);
  L.set('hot', Math.round(7 * ship.engineGlow * ship.engineGlow * 20) / 20);
  // anti-collision strobe: double flash every 1.6 s
  const ph = (t * 0.625 + ship.strobePhase) % 1;
  L.set('strobe', (ph < 0.045) || (ph > 0.12 && ph < 0.165) ? 14 : 0);
  // docking lights fade in / out (quantised so the texture is only re-uploaded while it actually changes)
  const target = ship.dockLightsOn ? 10 : 0;
  ship.dockLightLevel += (target - ship.dockLightLevel) * Math.min(1, dt * 2);
  if (Math.abs(ship.dockLightLevel - target) < 0.02) ship.dockLightLevel = target;
  L.set('dockLight', Math.round(ship.dockLightLevel * 10) / 10);
  // rendezvous LED targets blink at 1 Hz while flying near the station; red beacon slow flash
  const flying = ship.state === 'approach' || ship.state === 'dock' || ship.state === 'undock' || ship.state === 'arrive';
  L.set('ledWhite', flying && ((t + ship.strobePhase) % 1) < 0.5 ? 5 : 0);
  L.set('portLight', ((t * 0.5 + ship.strobePhase) % 1) < 0.12 ? 8 : 0);
  L.set('beacon', ship.type === 'drone' ? (((t * 0.8 + ship.strobePhase) % 1) < 0.5 ? 6 : 0.4) : 0);
  L.commit();

  const a = ship.anim;
  if (a.lastState !== ship.state) { if (a.lastState === null || a.lastState === 'idle' || ship.state === 'docked' && !ship.flight) a.snap = true; a.lastState = ship.state; }
  targets(ship, T);
  if (ship.demoT) { const d = ship.demoT; a.deploy = d.deploy; a.antenna = d.antenna; a.nose = d.nose; a.probe = d.probe; a.snap = false; T.track = 1; }
  else if (a.snap) { a.deploy = T.deploy; a.antenna = T.antenna; a.probe = T.probe; a.nose = T.nose; a.snap = false; }
  else {
    a.deploy = approach(a.deploy, T.deploy, T.rDeploy, dt);
    a.antenna = approach(a.antenna, T.antenna, T.rAntenna, dt);
    a.probe = approach(a.probe, T.probe, T.rProbe, dt);
    a.nose = approach(a.nose, T.nose, T.rNose, dt);
  }
  a.trackOn = approach(a.trackOn, T.track, 0.5, dt);
  // probe contact: the hatch pushes the probe in (position-driven, not rate limited)
  let probe = a.probe;
  const info = ship.info;
  if (info.probe && T.probeContact !== undefined) {
    const p = info.probe, e = clamp01((T.probeContact + 0.1) / p.travel);
    if (e < probe) { probe = e; a.probe = e; }
  }
  a.scs = ship.petalExtend; a.tilt = ship.petalOpen;
  a.hooks = 1 - clamp01(ship.state === 'docked' ? 0 : Math.max(ship.petalExtend, ship.petalOpen));
  applyParts(ship, a, probe, dt);
}

const _wd = new THREE.Vector3(), _pq = new THREE.Quaternion();
function changed(a, key, v) { if (Math.abs((a.applied[key] ?? -9) - v) < 1e-4) return false; a.applied[key] = v; return true; }

/** Drive the pivots / instanced sets named by the type's info. */
function applyParts(ship, a, probe, dt) {
  const info = ship.info, rig = ship.rig;
  if (info.wings && changed(a, 'deploy', a.deploy)) foldWings(rig, info.wings, a.deploy);
  if (info.custom && changed(a, 'custom', a.deploy * 7 + a.nose * 3 + a.antenna)) info.custom(rig, a, ship);
  if (info.hinges) for (let i = 0; i < info.hinges.length; i++) {
    const h = info.hinges[i], v = a[h.channel];
    const k = smooth(clamp01((v - (h.range ? h.range[0] : 0)) / ((h.range ? h.range[1] - h.range[0] : 1))));
    const p = rig.pivots[h.pivot];
    if (p && changed(a, HKEY[i] || (HKEY[i] = `h${i}`), k)) p.rotation[h.axis] = h.from + (h.to - h.from) * k;
  }
  if (info.probe && changed(a, 'probe', probe)) rig.pivots[info.probe.pivot || 'probe'].position.z = info.probe.travel * probe;
  if (info.scs && changed(a, 'scs', a.scs + a.tilt * 0.01)) {
    const p = rig.pivots[info.scs.pivot || 'scs'];
    p.position.z = info.scs.retracted + (info.scs.travel) * smooth(a.scs);
    p.rotation.x = 0.035 * a.tilt * Math.sin(ship.strobePhase * 20); p.rotation.y = 0.025 * a.tilt;
  }
  if (info.hooks && rig.inst.hooks && changed(a, 'hooks', a.hooks)) {
    const base = info.hooks, ang = -0.75 * (1 - a.hooks);
    _r.makeRotationX(ang);
    for (const m of rig.inst.hooks) { for (let i = 0; i < base.length; i++) m.setMatrixAt(i, _m.multiplyMatrices(base[i], _r)); m.instanceMatrix.needsUpdate = true; }
  }
  // tracking heads (yaw / pitch pivots) follow the station, or park
  if (info.track) for (const tr of info.track) {
    const yaw = rig.pivots[tr.yaw], pitch = tr.pitch ? rig.pivots[tr.pitch] : null;
    if (!yaw) continue;
    let ty = tr.park ? tr.park[0] : 0, tp = tr.park ? tr.park[1] : 0;
    if (a.trackOn > 0.5 && ship.group.visible) {
      yaw.parent.getWorldQuaternion(_pq).invert();
      yaw.parent.getWorldPosition(_wd);
      _v.copy(STATION_CENTER).sub(_wd).applyQuaternion(_pq).normalize();
      // pitch frame looks along its local +Z; yaw about local Y
      ty = Math.atan2(_v.x, _v.z);
      tp = pitch ? -Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1)) : 0;
      if (tr.limit) tp = THREE.MathUtils.clamp(tp, -tr.limit, tr.limit);
    }
    const s = (tr.rate || 0.35) * dt;
    let dy = ty - yaw.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    if (Math.abs(dy) > 1e-4) yaw.rotation.y += THREE.MathUtils.clamp(dy, -s, s);
    if (pitch && Math.abs(tp - pitch.rotation.x) > 1e-4) pitch.rotation.x += THREE.MathUtils.clamp(tp - pitch.rotation.x, -s, s);
  }
}
