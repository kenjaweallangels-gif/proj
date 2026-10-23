import * as THREE from 'three';
import { LAYOUT } from './parts/Layout.js';
import { Builder, LABELS } from './parts/Builder.js';
import { buildGreebles } from './parts/Greebles.js';
import { Handrails } from './parts/Handrails.js';
import { buildTruss } from './parts/Truss.js';
import { buildModules } from './parts/Modules.js';
import { buildDocking } from './parts/Docking.js';
import { HabitatRing } from './parts/Ring.js';
import { SolarArrays, Radiators } from './parts/Arrays.js';
import { Antennas } from './parts/Antennas.js';
import { AirlockModule } from './parts/Airlock.js';
import { StationLights } from './parts/Lights.js';

/**
 * Orbital station «Аврора» — near scene, meters, fixed at the origin.
 * Implements the Station contract (docs/ARCHITECTURE.md): colliders, handrails, dockingPorts,
 * airlock, ring, viewpoints, update(dt, ctx).
 *
 * Layout (see parts/Layout.js): 176 m truss spine along X; pressurised cluster hanging 8 m below the
 * spine (x -30..43); gravity ring (R 40 m) at x = -42; radiators aft of it; four solar wings on rotary
 * joints at x = ±76; antennas forward of the docking hub.
 */
export class Station extends THREE.Group {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.name = LAYOUT.stationName;
    this.colliders = [];
    this.handrails = [];
    this.dockingPorts = [];
    const t0 = performance.now();

    // docking / EVA work lights share one material so Lights can dim them in daylight
    if (!ctx.materials.factories.dockLight) ctx.materials.register('dockLight', () => { const m = ctx.materials.get('floodLight').clone(); m.emissiveIntensity = 2; return m; });
    const b = new Builder(ctx.materials);
    const rails = new Handrails(ctx.materials, this.handrails);

    const truss = buildTruss(ctx, this, b, rails);
    const mods = buildModules(ctx, this, b, rails);
    const dock = buildDocking(ctx, this, b, rails, mods);
    const greebles = buildGreebles(ctx, this, b, rails, mods);
    this.ringPart = new HabitatRing(ctx, this, b);
    this.arrays = new SolarArrays(ctx, this, b);
    this.radiators = new Radiators(ctx, this, b);
    this.antennas = new Antennas(ctx, this, b);
    this.airlockPart = new AirlockModule(ctx, this, b, rails);
    this.lights = new StationLights(ctx, this, this.ringPart, this.airlockPart.info);

    this.staticMeshes = b.build(this, { name: 'station' });
    rails.build(this);

    // contract fields
    this.dockingPorts = dock.ports;
    this.airlock = this.airlockPart.info;
    this.ring = { group: this.ringPart.group, angularSpeed: this.ringPart.angularSpeed, radius: this.ringPart.radius };
    this.colliders.push(...truss.colliders, ...mods.colliders, ...dock.colliders, ...greebles.colliders, ...this.ringPart.staticColliders, ...this.ringPart.colliders,
      ...this.arrays.colliders, ...this.radiators.colliders, ...this.antennas.colliders, ...this.airlockPart.colliders);
    this.modules = mods;
    /** Text decals in the station frame: { text, position, width } (HUD / debugging). */
    this.labels = LABELS.splice(0, LABELS.length);

    const CY = LAYOUT.clusterY, AX = LAYOUT.airlock.x, HZ = this.airlockPart.hatchZ, HX = LAYOUT.hubX, RX = LAYOUT.ringX;
    this.viewpoints = {
      ships: { position: [50, 2, 24], target: [40, -12, 9] },
      docking: { position: [HX + 26, CY - 9, 24], target: [HX + 2, CY, 0] },
      ring: { position: [RX + 46, 32, 78], target: [RX, 0, 0] },
      airlockExt: { position: [AX + 3.2, CY + 1.8, HZ + 6.5], target: [AX, CY, HZ] },
      solar: { position: [52, 22, 58], target: [76, 0, 18] },
      closeup: { position: [-16.2, CY + 1.6, -5.4], target: [-7.5, CY + 0.6, -2.4] },
      arm: { position: [36, 9, -11], target: [30, 3.6, -1] },
      hub: { position: [RX + 14, 7, 15], target: [RX, 0, 0] },
      cupola: { position: [AX + 4, CY - 9, 6], target: [AX, CY - 3.5, 0] },
      aft: { position: [-150, 30, 90], target: [-50, 0, 0] },
    };

    this.ringPart.update(0);
    this.lights.update(0, ctx);
    const ms = performance.now() - t0;
    this.buildTimeMs = ms;
    if (ms > 2000) console.warn(`[Station] build took ${ms.toFixed(0)} ms`);
  }

  async load() {}

  update(dt, ctx) {
    this.ringPart.update(dt);
    this.arrays.update(dt, ctx);
    this.radiators.update(dt, ctx);
    this.antennas.update(dt, ctx);
    this.airlockPart.update(dt);
    this.lights.update(dt, ctx);
  }

  dispose() {
    this.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}
