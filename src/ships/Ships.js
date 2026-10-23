import * as THREE from 'three';
import { SHIP_TYPES, animateCommon } from './ShipTypes.js';
import { Traffic, makeRng } from './Traffic.js';

/**
 * Ships module (contract: docs/ARCHITECTURE.md) — docked ships and live docking traffic.
 *
 *   ships.ships[]      Ship records (see below); `colliders` are world-frame and updated while moving
 *   ships.update(dt)   traffic + animations
 *   ships.getLog()     last 20 events as Russian strings
 *   ctx.events 'ship'  { type: 'undock'|'depart'|'gone'|'arrive'|'final'|'capture'|'dock', ship, port, message }
 *
 * Ship = { id, type, name, typeLabel, group, state: 'docked'|'approach'|'dock'|'undock'|'depart'|'arrive'|'loiter'|'idle',
 *          port, colliders[], velocity, size, noseOffset (0: docking face on the port plane), parts, ... }
 *
 * Draw calls: every ship is a handful of merged meshes (see ShipBuilder.js); the whole fleet stays < 120 calls.
 */

const _d = new THREE.Vector3();
const STATION_CENTER = new THREE.Vector3(0, -8, 0);
const NADIR = new THREE.Vector3(0, -1, 0);

/** Initial fleet; ~60 % of the ports are occupied at start, one capsule is on final approach, one freighter inbound. */
const FLEET = [
  ['freighter', 1, 'H2'], ['shuttle', 1, 'H3'], ['tanker', 1, 'H4'], ['capsule', 1, 'H5'], ['capsule', 2, 'N1'], ['capsule', 3, 'P2'],
  ['capsule', 4, 'final:H6'], ['freighter', 2, 'inbound:H1'], ['tanker', 2, null], ['drone', 1, 'loiter'], ['drone', 2, 'loiter'],
];

export class Ships {
  constructor(ctx) {
    this.ctx = ctx;
    this.ships = [];
    this._log = [];
    this._nextId = 1;
    const t0 = performance.now();
    this.rng = makeRng(20261022);
    this.traffic = new Traffic(ctx, this, this.rng);

    for (const [type, number, where] of FLEET) this._create(type, number, where);
    this._initialPlacement();
    this.buildTimeMs = performance.now() - t0;
    if (this.buildTimeMs > 2000) console.warn(`[Ships] build took ${this.buildTimeMs.toFixed(0)} ms`);
  }

  async load() {}

  // ------------------------------------------------------------------ construction
  _create(type, number, where) {
    const T = SHIP_TYPES[type];
    const tb = performance.now();
    const def = T.build(this.ctx, { number });
    (this.buildTimes || (this.buildTimes = {}))[`${type}-${number}`] = Math.round(performance.now() - tb);
    const g = def.group;
    g.visible = false;
    g.position.set(0, -20000, 0);
    this.ctx.nearScene.add(g);
    const ship = {
      id: this._nextId++, type, name: def.shipName, typeLabel: def.label, group: g, def, dyn: T.dyn, docks: T.docks, upAxis: def.upAxis || new THREE.Vector3(0, 1, 0),
      state: 'idle', port: null, roll: 0,
      colliders: def.colliders.map((c) => this._cloneCollider(c)), localColliders: def.colliders,
      nozzles: def.nozzles, mainNozzles: def.mainNozzles, mainAxis: def.mainAxis, noseOffset: def.noseOffset, size: def.size,
      velocity: new THREE.Vector3(), parts: def.parts,
      engineGlow: 0, burning: false, dockLightsOn: false, dockLightLevel: 0, petalOpen: 1, petalExtend: 1, panelDeploy: 1, doorOpen: 1, strobePhase: this.rng(),
      dishMode: 'earth', dockedSince: -1e9, flight: null, att: null, where,
    };
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
    const docked = this.ships.filter((s) => s.state === 'docked').length;
    console.info(`[Ships] ${this.ships.length} ships built, ${docked} docked of ${tr.ports.length} ports, ${this.traffic.flying.length} in flight`);
  }

  // ------------------------------------------------------------------ runtime
  update(dt, ctx) {
    const t = ctx.time.sim;
    this.traffic.update(dt);
    for (let i = 0; i < this.ships.length; i++) {
      const ship = this.ships[i];
      if (!ship.group.visible) continue;
      animateCommon(dt, ship, t);
      if (ship.def.animate) ship.def.animate(dt, ship, ctx);
      const dish = ship.parts.dish;
      if (dish) {
        if (ship.dishMode === 'earth') dish.trackWorld(NADIR, ship.group.quaternion, dt);
        else dish.trackWorld(_d.copy(STATION_CENTER).sub(ship.group.position).normalize(), ship.group.quaternion, dt);
      }
    }
  }

  /** Transform the ship's local colliders into world space (in place, same objects). */
  updateColliders(ship) {
    const q = ship.group.quaternion, p = ship.group.position;
    const L = ship.localColliders, W = ship.colliders;
    for (let i = 0; i < L.length; i++) {
      const l = L[i], w = W[i];
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
    for (const s of this.ships) { s.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); s.parts.lights?.dispose(); this.ctx.nearScene.remove(s.group); }
    this.ships.length = 0;
  }
}
