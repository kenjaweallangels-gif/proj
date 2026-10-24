import * as THREE from 'three';
import { SHIP_TYPES } from './ShipTypes.js';
import { Traffic, makeRng } from './Traffic.js';
import { buildTemplate, instantiate, setLevel, detach } from './Kit.js';
import { makeAnim, animateShip } from './types/Common.js';

/**
 * Ships module (contract: docs/ARCHITECTURE.md) — docked ships and live docking traffic.
 *
 *   ships.ships[]      Ship records (see below); `colliders` are world-frame and updated while moving
 *   ships.update(dt)   traffic + part animation + level of detail
 *   ships.getLog()     last 20 events as Russian strings
 *   ctx.events 'ship'  { type: 'undock'|'depart'|'gone'|'arrive'|'final'|'capture'|'dock', ship, port, message }
 *
 * Ship = { id, type, name, typeLabel, group, state: 'docked'|'approach'|'dock'|'undock'|'depart'|'arrive'|'loiter'|'idle',
 *          port, colliders[], velocity, size, noseOffset (0: docking face on the port plane), rig, anim, lod, ... }
 *
 * Every type is built once as a three-level template (Kit.js) and cloned per ship. The level is picked from the
 * camera distance each frame: L0 (full detail) only within ~25 m + 5 × bounding radius, L1 to 500 m, L2 beyond;
 * 'lite' never uses L0: L1 within the L0 range, L2 (one draw call per ship) beyond it.
 *
 * Debug: `?shipshow=1` adds a row of one ship of each type 120 m above the station (outside the traffic), with
 * observer views `ship-<type>`, `ship-<type>-dock`, `ship-<type>-aft`; `?shipanim=1` cycles their mechanisms.
 */

const _cam = new THREE.Vector3();
const MID_DISTANCE = 500;

/** Initial fleet; ~60 % of the ports are occupied at start, one ship is on final approach, one inbound. */
const FLEET = [
  ['cygnus', 1, 'H2'], ['dreamchaser', 1, 'H3'], ['htvx', 1, 'H4'], ['dragon', 1, 'H5'], ['soyuz', 1, 'N1'], ['progress', 1, 'P2'],
  ['starliner', 1, 'final:H6'], ['dragon', 2, 'inbound:H1'], ['soyuz', 2, null], ['progress', 2, null], ['cygnus', 2, null],
  ['drone', 1, 'loiter'], ['drone', 2, 'loiter'],
];

export class Ships {
  constructor(ctx) {
    this.ctx = ctx;
    this.ships = [];
    this._log = [];
    this._nextId = 1;
    this.lite = !!ctx.quality?.lite;
    this.templates = new Map();
    this.buildTimes = {};
    const t0 = performance.now();
    this.rng = makeRng(20261022);
    this.traffic = new Traffic(ctx, this, this.rng);

    for (const [type, number, where] of FLEET) if (SHIP_TYPES[type]) this._create(type, number, where);
    this._initialPlacement();
    this.showcase = [];
    if (ctx.params?.get?.('shipshow')) this._buildShowcase(ctx.params.get('shipanim') === '1', ctx.params.get('shipshow') !== 'track');
    this.buildTimeMs = performance.now() - t0;
    const tris = [...this.templates.values()].map((t) => `${t.type} ${t.lodTris.map((n) => Math.round(n / 100) / 10 + 'k').join('/')}`).join(', ');
    (this.showcase.length ? console.warn : console.info)(`[Ships] templates (L0/L1/L2 triangles): ${tris}; build ${this.buildTimeMs.toFixed(0)} ms (${JSON.stringify(this.buildTimes)})`);
    if (this.buildTimeMs > 2500) console.warn(`[Ships] build took ${this.buildTimeMs.toFixed(0)} ms`);
  }

  async load() {}

  // ------------------------------------------------------------------ construction
  _template(type) {
    let tpl = this.templates.get(type);
    if (!tpl) {
      const tb = performance.now();
      tpl = buildTemplate(this.ctx.materials, type, SHIP_TYPES[type].def.author);
      this.buildTimes[type] = Math.round(performance.now() - tb);
      this.templates.set(type, tpl);
    }
    return tpl;
  }

  _instance(type, number) {
    const T = SHIP_TYPES[type], D = T.def;
    const tpl = this._template(type);
    const rig = instantiate(tpl, { name: D.name.toUpperCase(), num: String(number) });
    const g = rig.group;
    g.name = `${type}:${D.name}-${number}`;
    setLevel(rig, 2);
    return {
      type, name: `${D.name}-${number}`, typeLabel: D.label, group: g, rig, lights: rig.lights, lod: 2, tpl,
      info: { ...tpl.info, hooks: tpl.hookBase || null },
      def: { shipName: `${D.name}-${number}`, label: D.label, parts: {} },
      dyn: T.dyn, docks: T.docks, upAxis: D.upAxis.clone(), mainAxis: D.mainAxis.clone(),
      nozzles: tpl.nozzles, mainNozzles: tpl.mainNozzles.length ? tpl.mainNozzles : tpl.nozzles.filter((n) => n.direction.dot(D.mainAxis) < -0.9),
      noseOffset: 0, size: D.size, length: D.length, boundRadius: D.boundRadius,
      nearDistance: 25 + 5 * D.boundRadius,
      engineGlow: 0, burning: false, dockLightsOn: false, dockLightLevel: 0, petalOpen: 1, petalExtend: 1, panelDeploy: 1, doorOpen: 1,
      anim: makeAnim(),
    };
  }

  _create(type, number, where) {
    const ship = this._instance(type, number);
    const g = ship.group;
    g.visible = false;
    g.position.set(0, -20000, 0);
    this.ctx.nearScene.add(g);
    const localColliders = ship.tpl.colliders;
    Object.assign(ship, {
      id: this._nextId++, state: 'idle', port: null, roll: 0,
      colliders: localColliders.map((c) => this._cloneCollider(c)), localColliders,
      velocity: new THREE.Vector3(), parts: {}, strobePhase: this.rng(),
      dockedSince: -1e9, flight: null, att: null, where,
    });
    this.ships.push(ship);
    return ship;
  }

  _cloneCollider(c) {
    const w = { type: c.type, name: c.name, radius: c.radius, dynamic: true };
    if (c.type === 'sphere') w.center = c.center.clone();
    else if (c.type === 'capsule') { w.a = c.a.clone(); w.b = c.b.clone(); }
    else { w.center = c.center.clone(); w.halfSize = c.halfSize.clone(); w.quaternion = c.quaternion.clone(); }
    return w;
  }

  _initialPlacement() {
    const tr = this.traffic;
    const byId = new Map(tr.ports.map((p) => [p.id, p]));
    const pending = [];
    for (const ship of this.ships) {
      const where = ship.where;
      if (where === 'loiter') { tr.startLoiter(ship, (ship.def.shipName.endsWith('1') ? 0 : 1)); continue; }
      if (!where) continue;
      const [mode, id] = where.includes(':') ? where.split(':') : ['dock', where];
      const port = byId.get(id);
      if (mode === 'dock') {
        let placed = false;
        if (port && !port.occupant && (ship.size === 'small' || port.size === 'large')) {
          const roll = tr.chooseRoll(ship, port);
          if (roll !== null) { tr.placeDocked(ship, port, roll); placed = true; }
          else (this.ctx.params?.get?.('shipshow') ? console.warn : console.info)(`[Ships] ${ship.name} does not fit ${id}: ${tr.lastFitFail}`);
        }
        if (!placed) pending.push(ship);
      } else pending.push([mode, ship, port]);
    }
    // fallbacks and in-flight starters
    for (const item of pending) {
      if (!Array.isArray(item)) { const slot = tr.freePortFor(item); if (slot) tr.placeDocked(item, slot.port, slot.roll); continue; }
      const [mode, ship, port0] = item;
      let port = port0 && !port0.occupant && !port0.reserved && (ship.size === 'small' || port0.size === 'large') ? port0 : null;
      let roll = port ? tr.chooseRoll(ship, port) : null;
      if (roll === null) { const slot = tr.freePortFor(ship); if (!slot) continue; port = slot.port; roll = slot.roll; }
      if (mode === 'final') { const corr = tr.corridor(port); tr.startFinalApproach(ship, port, roll, Math.max(0, corr.length - 60)); }
      else if (mode === 'inbound') tr.startArrival(ship, port, roll, -1600);   // 1.6 km out: braking burn within minutes
    }
    const docked = this.ships.filter((s) => s.state === 'docked');
    (this.ctx.params?.get?.('shipshow') ? console.warn : console.info)(`[Ships] ${this.ships.length} ships built, ${docked.length} docked of ${tr.ports.length} ports (${docked.map((s) => `${s.name}@${s.port.id}`).join(', ')}), ${this.traffic.flying.length} in flight`);
  }

  // ------------------------------------------------------------------ debug showcase
  _buildShowcase(demo, row = true) {
    const types = Object.keys(SHIP_TYPES).filter((t) => SHIP_TYPES[t].docks);
    const vps = this.ctx.station?.viewpoints;
    if (row) types.forEach((type, i) => {
      const s = this._instance(type, 9);
      s.state = 'docked'; s.velocity = new THREE.Vector3(); s.strobePhase = i * 0.37; s.petalExtend = 0; s.petalOpen = 0; s.demo = demo;
      s.group.position.set(-80 + i * 27, 120, 40);
      s.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);   // docking axis toward +X
      s.group.visible = true;
      this.ctx.nearScene.add(s.group);
      this.showcase.push(s);
      if (!vps) return;
      const self = this;
      const view = (back, side, up) => ({
        get position() {
          const sun = self.ctx.orbit?.sunDir || new THREE.Vector3(0, 1, 0);
          const c = s.group.position;
          const d = new THREE.Vector3(back, up, side).normalize().multiplyScalar(s.length * 0.8 + 3.5).addScaledVector(sun, 1.5);
          return [c.x + d.x - s.length * 0.45, c.y + d.y, c.z + d.z];
        },
        get target() { const c = s.group.position; return [c.x - s.length * 0.45, c.y, c.z]; },
      });
      vps[`ship-${type}`] = view(0.35, 1, 0.35);
      vps[`ship-${type}-dock`] = { get position() { const c = s.group.position; return [c.x + 4.5, c.y + 1.6, c.z + 2.8]; }, get target() { const c = s.group.position; return [c.x - 0.6, c.y, c.z]; } };
      vps[`ship-${type}-aft`] = view(-0.9, 0.8, -0.3);
      vps[`ship-${type}-top`] = view(0.05, 0.35, 1);
      vps[`ship-${type}-side`] = view(0.0, 1, -0.12);
    });
    vps && (vps['ship-row'] = { position: [0, 135, 140], target: [0, 120, 40] });
    // views that follow the first flying / docked traffic ship of each type: track-<type>
    if (vps) for (const type of types) {
      const self = this;
      const pick = () => self.ships.find((s) => s.type === type && s.group.visible && s.state !== 'docked') || self.ships.find((s) => s.type === type && s.group.visible);
      const cam = (s) => {   // broadside, on the side away from the station centre, a little above
        const p = s.group.position, ax = new THREE.Vector3(0, 0, 1).applyQuaternion(s.group.quaternion);
        // the ship's local Y is perpendicular to its wings / arrays: look along it, from the side away from the station
        const side = new THREE.Vector3(0, 1, 0).applyQuaternion(s.group.quaternion);
        if (side.dot(new THREE.Vector3().subVectors(p, new THREE.Vector3(0, -8, 0))) < 0) side.negate();
        const up = new THREE.Vector3().crossVectors(ax, side).normalize();
        const c = p.clone().addScaledVector(ax, -s.length * 0.45);
        return { c, pos: c.clone().addScaledVector(side, s.length * 1.1 + 5).addScaledVector(up, 2.5).addScaledVector(ax, 2) };
      };
      vps[`track-${type}`] = {
        get position() { const s = pick(); return s ? cam(s).pos.toArray() : [0, 0, 60]; },
        get target() { const s = pick(); return s ? cam(s).c.toArray() : [0, 0, 0]; },
      };
    }
    // debug views: no HUD panels over the ships
    if (typeof document !== 'undefined' && ['clean', 'track'].includes(this.ctx.params.get('shipshow'))) document.getElementById('ui')?.style.setProperty('display', 'none');
  }

  // ------------------------------------------------------------------ runtime
  update(dt, ctx) {
    const t = ctx.time.sim;
    if (!this._detached) {   // first frame: the App's start-up passes have seen every level; detach the hidden ones now
      this._detached = true;
      for (const s of this.ships) detach(s.rig);
      for (const s of this.showcase) detach(s.rig);
      // debug: ?shipff=<s> fast-forwards the traffic (and the part animation) before the first frame
      const ff = parseFloat(ctx.params?.get?.('shipff') || '0');
      for (let k = 0; k < ff; k++) { this.traffic.update(1); for (const s of this.ships) if (s.group.visible) animateShip(1, s, t - ff + k); }
      if (ff) console.warn(`[Ships] after ${ff} s: ${this.ships.map((s) => `${s.name}:${s.state}${s.flight ? '/' + s.flight.phase : ''}`).join(' ')}`);
    }
    this.traffic.update(dt);
    _cam.setFromMatrixPosition(ctx.camera.matrixWorld);
    for (let i = 0; i < this.ships.length; i++) this._animate(this.ships[i], dt, t);
    for (let i = 0; i < this.showcase.length; i++) this._animate(this.showcase[i], dt, t);
  }

  _animate(ship, dt, t) {
    if (!ship.group.visible) return;
    // level of detail with 10 % hysteresis
    const d = ship.group.position.distanceTo(_cam) - ship.boundRadius;
    const n0 = ship.lod === 0 ? ship.nearDistance : ship.nearDistance * 0.9;
    const n1 = ship.lod <= 1 ? MID_DISTANCE : MID_DISTANCE * 0.9;
    // 'lite' (CPU rasteriser, ~0.3 px per CSS px): L1 only where L0 would be used, silhouettes elsewhere
    const lvl = this.lite ? (d < n0 * 0.6 ? 1 : 2) : d < n0 ? 0 : d < n1 ? 1 : 2;
    if (lvl !== ship.lod) { ship.lod = lvl; setLevel(ship.rig, lvl); }
    if (ship.demo) demoChannels(ship, t);
    animateShip(dt, ship, t);
  }

  /** Transform the ship's local colliders into world space (in place, same objects). */
  updateColliders(ship) {
    const q = ship.group.quaternion, p = ship.group.position;
    const L = ship.localColliders, W = ship.colliders;
    for (let i = 0; i < L.length; i++) {
      const l = L[i], w = W[i];
      w.velocity = ship.velocity;   // surface motion for player contacts (shared reference, no allocation)
      if (l.type === 'sphere') w.center.copy(l.center).applyQuaternion(q).add(p);
      else if (l.type === 'capsule') { w.a.copy(l.a).applyQuaternion(q).add(p); w.b.copy(l.b).applyQuaternion(q).add(p); }
      else { w.center.copy(l.center).applyQuaternion(q).add(p); w.quaternion.copy(q).multiply(l.quaternion); }
    }
  }

  setDishTarget(ship, mode) { ship.dishMode = mode; }

  // ------------------------------------------------------------------ log / events
  log(type, ship, port) {
    const pn = port ? port.name : '—';
    const who = `${ship.typeLabel} «${ship.name}»`;
    const text = {
      undock: `${who} отстыковался от порта ${pn}`,
      depart: `${who} выполнил разгонный импульс и уходит от станции`,
      gone: `${who} покинул зону станции`,
      arrive: `${who} вышел на траекторию сближения, порт назначения — ${pn}`,
      final: `${who} начал финальное сближение с портом ${pn}`,
      capture: `${who}: касание, мягкий захват на порту ${pn}`,
      dock: `${who} пристыковался к порту ${pn}`,
    }[type] || `${who}: ${type}`;
    const s = Math.max(0, Math.floor(this.ctx.time.sim));
    const hh = String(Math.floor(s / 3600)).padStart(2, '0'), mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
    const message = `T+${hh}:${mm}:${ss} ${text}`;
    this._log.push(message);
    if (this._log.length > 20) this._log.shift();
    this.ctx.events.emit('ship', { type, ship, port, message });
  }

  /** Last 20 events (oldest first). */
  getLog() { return this._log.slice(); }

  /** Ship docked at a port (or null). */
  shipAt(port) { return port && port.occupant && port.occupant.group ? port.occupant : null; }

  dispose() {
    for (const s of [...this.ships, ...this.showcase]) { s.lights?.dispose(); this.ctx.nearScene.remove(s.group); }
    for (const tpl of this.templates.values()) tpl.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.ships.length = 0;
  }
}

/** ?shipanim=1: cycle the showcase mechanisms (period 80 s): stow / deploy, nose, probe, soft capture. */
function demoChannels(ship, t) {
  const ph = (t % 80) / 80;
  const tri = (x) => (x < 0.5 ? x * 2 : 2 - x * 2);
  const a = ship.anim;
  ship.state = 'docked';
  a.snap = false;
  ship.petalExtend = tri((ph * 2) % 1); ship.petalOpen = 0;
  ship.dockLightsOn = ph > 0.5;
  ship.demoT = { deploy: Math.min(1, tri(ph) * 1.6), antenna: Math.min(1, tri(ph) * 1.6), nose: Math.min(1, tri(ph) * 1.6), probe: tri((ph * 2) % 1) };
}
