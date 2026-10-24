import * as THREE from 'three';
import { Atlas } from './Atlas.js';
import { InteriorMaterials, INTERIOR_LAYER, carveUniforms, patchCarve, packCone, packBox, packTorus, MAX_CARVE } from './Materials.js';
import { buildCore } from './Core.js';
import { buildAirlock } from './AirlockInterior.js';
import { buildRing, RING } from './RingInterior.js';
import { volumeDistance, unionDistance } from './Volumes.js';
import { LAYERS } from '../../core/constants.js';

/**
 * Station interiors: every pressurised compartment as a "zone" (see Zone.js), built in `load()`.
 *
 * Runtime (update, after the first frame is ready):
 *  - finds the compartment that holds the camera; shows it and the compartments visible through open
 *    hatches (portal walk with a frustum test), hides all others; from outside, only zones whose windows
 *    are close to the camera (or the crew lock behind the open EVA hatch) are drawn;
 *  - inside a windowless compartment the camera stops drawing the exterior layers and the far scene, and the
 *    sun shadow map is not re-rendered; window glow discs of the hull are hidden while inside;
 *  - carves the exterior geometry that pokes into the visible compartments (GPU presets; see Materials.js);
 *  - moves two interior point lights into the current compartment and drives a fixed interior exposure.
 * Physics queries for the player: locate(), volumesFor(), solidsFor(), handrails, ladders, ringFrame.
 */

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _sph = new THREE.Sphere();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const GLOW_MATERIALS = ['windowGlow', 'cupolaGlow', 'growGlow'];

export class StationInterior {
  constructor(ctx, station) {
    this.ctx = ctx;
    this.station = station;
    this.lite = !!ctx.quality?.lite;
    this.detail = this.lite ? 0.3 : Math.min(1.3, ctx.quality?.detail ?? 1);
    this.zones = [];
    this.byId = new Map();
    this.enabled = false;
    this.ready = false;
    this.root = new THREE.Group(); this.root.name = 'interior'; this.root.visible = false;
    station.add(this.root);
    this.ringGroup = station.ring?.group || null;
    this.ringRoot = new THREE.Group(); this.ringRoot.name = 'interiorRing'; this.ringRoot.visible = false;
    this.ringGroup?.add(this.ringRoot);
    this.handrails = [];          // station frame (zero-g grabbing)
    this.ringRails = [];          // ring-local
    this.ladders = [];            // ring-local
    this.cameraZone = null;
    this.inside = false;
    this.visible = new Set();
    this.carveU = carveUniforms();
    this.ringInv = new THREE.Matrix4();
    this.ringMat = new THREE.Matrix4();
    this.omega = station.ring?.angularSpeed ?? 0.3;
    this.ringX0 = RING.X0;
    this.views = makeViews();
    // two interior lights (never toggled: intensity 0 outside)
    this.lights = [0, 1].map(() => { const l = new THREE.PointLight(0xfff2e4, 0, 7.5, 2); l.castShadow = false; station.add(l); return l; });
    ctx.camera.layers.enable(INTERIOR_LAYER);
    this._baseMask = null;
    this._exposure = 1;
    ctx.events?.on?.('ready', () => this.enable());
  }

  // ------------------------------------------------------------------------------------------ build
  async load() {
    const ctx = this.ctx, t0 = performance.now();
    if (ctx.params?.get('interior') === '0') return;   // A/B switch for performance comparisons (no interiors at all)
    const yieldNow = () => new Promise((r) => setTimeout(r, 0));
    const size = this.lite ? 1024 : (ctx.quality?.textureScale || 1) >= 2 ? 2048 : 1024;
    const atlas = this.atlas = new Atlas(size);
    const I = { atlas, lite: this.lite, detail: this.detail };
    const builders = [];
    builders.push(...buildCore(I, this.station));
    await yieldNow();
    if (this.station.airlockPart) builders.push(...buildAirlock(I, this.station.airlockPart));
    const ring = buildRing(I);
    builders.push(ring.hub);
    await yieldNow();
    const records = builders.map((b) => { const r = b.finish(); r.suits = b.suits; r.ringGeos = b.ringGeos; r.ringRails = b.ringRails; r.collar = b.collar; r.outside = b.outside; r.statusLamps = b.statusLamps; r.commonName = b.commonName; r.tint = b.tint; return r; });
    records.push(...ring.records);
    await yieldNow();
    atlas.textures(Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy()));
    this.mats = new InteriorMaterials(ctx, atlas, this.lite);
    const setCache = new Map();
    let tris = 0;
    for (const rec of records) {
      const z = this._makeZone(rec, setCache);
      tris += z.tris || 0;
    }
    // portals -> zone references (+ make the graph symmetric)
    for (const z of this.zones) for (const p of z.portals) p.zone = this.byId.get(p.to) || null;
    for (const z of this.zones) for (const p of z.portals) {
      if (!p.zone) continue;
      if (!p.zone.portals.some((q) => q.zone === z)) p.zone.portals.push({ to: z.id, zone: z, center: p.center.clone(), radius: p.radius, gate: p.gate, frame: z.frame });
    }
    for (const z of this.zones) z.neighbours = [...new Set(z.portals.map((p) => p.zone).filter(Boolean))];
    // airlock inner door + suits
    const al = this.station.airlockPart;
    const eZone = this.byId.get('airlockE');
    if (al && al.innerDoorGeos && eZone) {
      const meshes = this._meshes(al.innerDoorGeos, eZone.set, new THREE.Matrix4());
      for (const m of meshes) m.matrixAutoUpdate = true;
      al.setInnerDoor(meshes);
      this.innerDoor = meshes;
    }
    this.buildTimeMs = performance.now() - t0;
    this.triangles = tris;
    this.ready = true;
    console.info(`[interior] ${this.zones.length} zones, ${(tris / 1e6).toFixed(2)} M triangles, built in ${this.buildTimeMs.toFixed(0)} ms`);
  }

  _meshes(geos, set, M, prefixSets = null) {
    const out = [];
    for (const [name, g] of geos) {
      const i = name.indexOf(':');
      const prefix = i >= 0 ? name.slice(0, i + 1) : '', kind = i >= 0 ? name.slice(i + 1) : name;
      const S = (prefixSets && prefixSets[prefix]) || set;
      const mat = S[kind] || S.paint;
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `int:${kind}`;
      // via TRS (not mesh.matrix directly): static passes may call updateMatrix() on every object
      M.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      mesh.userData.noBatch = true;     // lite StaticBatcher: interiors keep their own meshes (visibility per zone)
      mesh.layers.set(INTERIOR_LAYER);
      mesh.castShadow = false; mesh.receiveShadow = false;
      if (kind === 'glass') mesh.renderOrder = 12;
      out.push(mesh);
    }
    return out;
  }

  _makeZone(rec, setCache) {
    const z = rec;
    z.group = new THREE.Group();
    z.group.name = `zone:${rec.id}`;
    z.group.visible = false;
    (rec.frame === 'ring' ? this.ringRoot : this.root).add(z.group);
    // material sets per prefix ('' and e.g. 'c:'), shared between sectors of the same variant
    const key = (prefix) => `${rec.shared ? rec.geos.size + ':' + [...rec.geos.keys()].join(',') : rec.id}|${prefix}`;
    const sets = {};
    for (const prefix of Object.keys(rec.sets || { '': [] })) {
      const k = key(prefix);
      if (!setCache.has(k)) setCache.set(k, this.mats.makeSet(rec.sets[prefix] || []));
      sets[prefix] = setCache.get(k);
    }
    if (!sets['']) { const k = key(''); if (!setCache.has(k)) setCache.set(k, this.mats.makeSet([])); sets[''] = setCache.get(k); }
    z.set = sets[''];
    z.sets = sets;
    for (const m of this._meshes(rec.geos, z.set, rec.M, sets)) z.group.add(m);
    // rotating parts of the hub (collar) live in the ring group
    if (rec.ringGeos) {
      z.ringGroup = new THREE.Group(); z.ringGroup.name = `zone:${rec.id}:ring`; z.ringGroup.visible = false;
      for (const m of this._meshes(rec.ringGeos, z.set, new THREE.Matrix4())) z.ringGroup.add(m);
      this.ringRoot.add(z.ringGroup);
      this.ringRails.push(...(rec.ringRails || []));
    }
    // docking-port status lamps: green = a ship is docked behind the hatch
    if (rec.statusLamps) {
      if (!this._lampGeo) {
        this._lampGeo = new THREE.BoxGeometry(0.07, 0.07, 0.012);
        this._lampMats = [new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 0.15) }), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 3.2, 0.45) })];
        for (const m of this._lampMats) m.userData.interior = true;
        this.lamps = [];
      }
      for (const L of rec.statusLamps) {
        const mesh = new THREE.Mesh(this._lampGeo, this._lampMats[0]);
        _m.multiplyMatrices(rec.M, L.M).decompose(mesh.position, mesh.quaternion, mesh.scale); mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
        mesh.layers.set(INTERIOR_LAYER);
        z.group.add(mesh);
        this.lamps.push({ mesh, port: L.port, on: false });
      }
    }
    // spacesuits (individually hideable)
    if (rec.suits) {
      z.suitObjects = rec.suits.map((s) => {
        const g = new THREE.Group(); g.name = `suit:${s.name}`;
        for (const m of this._meshes(s.geos, z.set, rec.M)) g.add(m);
        z.group.add(g);
        return { group: g, side: s.side, name: s.name, position: s.position };
      });
    }
    // physics data
    if (rec.frame === 'ring') { this.ringRails.push(...rec.rails); this.ladders.push(...rec.ladders.map((l) => ({ ...l, zone: z }))); }
    else this.handrails.push(...rec.rails);
    z.tris = 0;
    for (const g of rec.geos.values()) z.tris += g.index ? g.index.count / 3 : 0;
    if (rec.id === 'ringHub') {
      // the hub drum seen from the rotating frame (ring-local, symmetric about the spin axis)
      z.ringVolumes = rec.volumes.map((v) => (v.type === 'cyl' ? { ...v, a: v.a.clone().setX(v.a.x - RING.X0), b: v.b.clone().setX(v.b.x - RING.X0) } : v));
    }
    this.zones.push(z);
    this.byId.set(z.id, z);
    return z;
  }

  /** App hook (after applyLite / splitMaterialVariants, before shader compilation): carve-patch exterior materials. */
  afterMaterials() {
    if (this.lite || !this.ready) return;
    const done = new Set();
    let n = 0;
    const scene = this.ctx.nearScene;
    scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || o.layers.isEnabled(INTERIOR_LAYER) || o.layers.mask === (1 << LAYERS.FIRST_PERSON)) return;
      for (const m of [].concat(o.material || [])) { if (!done.has(m)) { done.add(m); if (patchCarve(m, this.carveU)) n++; } }
    });
    this._carvedMaterials = n;
  }

  enable() {
    if (!this.ready) return;
    this.enabled = true;
    this.root.visible = true; this.ringRoot.visible = true;
    // exterior glow meshes (window glow discs, cupola / greenhouse glow) to hide while inside
    this.glowMeshes = [];
    const scan = (root) => root.traverse((o) => { if (o.isMesh && !o.layers.isEnabled(INTERIOR_LAYER) && GLOW_MATERIALS.includes([].concat(o.material)[0]?.name)) this.glowMeshes.push(o); });
    for (const c of this.station.children) if (c !== this.root) scan(c);
    this._baseMask = this.ctx.camera.layers.mask | (1 << INTERIOR_LAYER);
    this._farMask = this.ctx.farCamera.layers.mask;
  }

  // ------------------------------------------------------------------------------------------ queries
  _ringUpdate() {
    if (!this.ringGroup) return;
    this.ringGroup.updateMatrixWorld();
    this.ringMat.copy(this.ringGroup.matrixWorld);
    this.ringInv.copy(this.ringMat).invert();
  }
  /** World point -> ring-local (into out). */
  toRing(p, out) { return out.copy(p).applyMatrix4(this.ringInv); }
  toWorldFromRing(p, out) { return out.copy(p).applyMatrix4(this.ringMat); }

  /** Zone that contains the world point p (hint: zone to test first). margin: allowed distance outside. */
  locate(p, hint = null, margin = 0.05) {
    // the compartment in which the point lies deepest (passages overlap their neighbours a little)
    this.toRing(p, _q);
    // Passage volumes (hatch vestibules reaching into the neighbours) only count when the point is in
    // no compartment proper, so a camera just past a hatch belongs to the compartment it looks into.
    const best0 = this._locate(p, hint, 0, true);
    return best0 || this._locate(p, hint, margin, false);
  }

  _locate(p, hint, margin, skipPassages) {
    let best = null, bd = margin;
    // (the hint only breaks ties: a stale hint must not shadow the compartment the point really is in)
    if (hint) { const d0 = unionDistance(hint.frame === 'ring' ? _q : p, hint.volumes, true, skipPassages); if (d0 <= bd) { best = hint; bd = d0 - 1e-4; } }
    // broad phase: bounding spheres
    for (const z of this.zones) {
      if (z === hint) continue;
      const c = z.frame === 'ring' ? _q : p;
      if (c.distanceToSquared(z.sphere.center) > (z.sphere.radius + 1) ** 2) continue;
      const d = unionDistance(c, z.volumes, true, skipPassages);
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }

  /** Physics frame for a world point in zone z: 'ring' inside the ring zones and the hub's rotating collar. */
  frameFor(z, pWorld) {
    if (!z) return 'station';
    if (z.frame === 'ring') return 'ring';
    if (z.collar && pWorld.x > z.collar.x0 && pWorld.x < z.collar.x1) return 'ring';
    return 'station';
  }

  /** Containment volumes around zone z (z + neighbours) in the given physics frame. Cached. */
  volumesFor(z, frame) {
    if (!z) return EMPTY;
    const key = `_vols_${frame}`;
    if (z[key]) return z[key];
    const list = [];
    for (const zz of [z, ...z.neighbours]) {
      if (frame === 'ring') { if (zz.frame === 'ring') list.push(...zz.volumes); else if (zz.ringVolumes) list.push(...zz.ringVolumes); }
      else if (zz.frame !== 'ring') list.push(...zz.volumes);
    }
    z[key] = list;
    return list;
  }
  solidsFor(z, frame) {
    if (!z) return EMPTY;
    const key = `_sol_${frame}`;
    if (z[key]) return z[key];
    const list = [];
    for (const zz of [z, ...z.neighbours]) if ((zz.frame === 'ring') === (frame === 'ring')) list.push(...zz.solids);
    z[key] = list;
    return list;
  }

  /** Viewpoint by name (see makeViews), or null. */
  view(name) { return this.views[name] || null; }

  /** The spacesuit object nearest to a world point (for don/doff), with its distance. */
  nearestSuit(p) {
    const z = this.byId.get('airlockE');
    let best = null, bd = Infinity;
    for (const s of z?.suitObjects || []) { const d = s.position.distanceTo(p); if (d < bd) { bd = d; best = s; } }
    return best ? { suit: best, distance: bd } : null;
  }

  // ------------------------------------------------------------------------------------------ per frame
  update(dt, ctx) {
    if (!this.enabled) return;
    const cam = ctx.camera;
    this._ringUpdate();
    cam.updateMatrixWorld();
    // camera in the station frame (the render frame may be elsewhere: free camera far from the station)
    const u = ctx.universe, remote = !!u && !u.isStationFrame;
    const cp = remote ? u.cameraInStation(_p, cam) : _p.setFromMatrixPosition(cam.matrixWorld);
    const zone = this.locate(cp, this.cameraZone, 0.25);
    this.cameraZone = zone;
    this.inside = !!zone;
    const vis = this.visible;
    vis.clear();
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    if (remote) { u.stationRoot.updateMatrixWorld(); _pm.multiply(u.stationRoot.matrixWorld); }
    _frustum.setFromProjectionMatrix(_pm);
    if (zone) {
      // portal walk (depth 4) with frustum tests
      vis.add(zone);
      const qz = this._qz || (this._qz = []), qd = this._qd || (this._qd = []);   // reused BFS queue
      qz.length = 0; qd.length = 0;
      qz.push(zone); qd.push(0);
      for (let qi = 0; qi < qz.length; qi++) {
        const z = qz[qi], d = qd[qi];
        if (d >= (this.lite ? 1 : 4)) continue;
        for (const p of z.portals) {
          const nz = p.zone;
          if (!nz || vis.has(nz)) continue;
          if (p.gate && p.gate.progress < 0.02) continue;
          const c = (p.frame || z.frame) === 'ring' ? this.toWorldFromRing(p.center, _a) : _a.copy(p.center);
          _sph.center.copy(c); _sph.radius = p.radius + 0.3;
          if (d > 0 && !_frustum.intersectsSphere(_sph)) continue;
          if (d === 0 && c.distanceTo(cp) > 1.2 && !_frustum.intersectsSphere(_sph)) continue;
          vis.add(nz);
          qz.push(nz); qd.push(d + 1);
        }
      }
    } else if (!this.lite) {
      // outside: compartments whose windows are close, and the crew lock behind the open EVA hatch
      const al = this.station.airlock;
      for (const z of this.zones) {
        if (z.outside && (al?.hatch?.progress ?? 0) > 0.01 && cp.distanceTo(z.outside.center) < z.outside.radius) { vis.add(z); continue; }
        if (!z.hasWindows || z.frame === 'ring') continue;
        for (const w of z.windows) {
          const c = w.c || w.a;
          if (!c) continue;
          const d = _a.subVectors(cp, c);
          if (d.length() < 9 && d.dot(w.n) > 0) { vis.add(z); break; }
        }
      }
    } else {
      const al = this.station.airlock;
      const z = this.byId.get('airlockC');
      if (z && (al?.hatch?.progress ?? 0) > 0.01 && cp.distanceTo(z.outside.center) < 12) vis.add(z);
    }
    let windows = false, anyRing = false;
    for (const z of this.zones) {
      const on = vis.has(z);
      if (z.group.visible !== on) z.group.visible = on;
      if (z.ringGroup && z.ringGroup.visible !== on) z.ringGroup.visible = on;
      if (on) { if (z.hasWindows) windows = true; if (z.frame === 'ring') anyRing = true; }
    }
    if (this.lamps && (this._lampTimer = (this._lampTimer || 0) - dt) <= 0) {
      this._lampTimer = 1;
      const ports = this.station.dockingPorts || [];
      for (const l of this.lamps) {
        const on = !!ports.find((pp) => pp.id === l.port)?.occupant;
        if (on !== l.on) { l.on = on; l.mesh.material = this._lampMats[on ? 1 : 0]; }
      }
    }
    if (this.innerDoor) { const on = vis.has(this.byId.get('airlockE')) || vis.has(this.byId.get('airlockC')); for (const m of this.innerDoor) m.visible = on; }
    // ---- exterior: layers, far scene, shadow map, glow discs
    const showExterior = !zone || (windows && !this.lite);
    const mask = showExterior ? this._baseMask : ((1 << INTERIOR_LAYER) | (1 << LAYERS.FIRST_PERSON));
    if (cam.layers.mask !== mask) cam.layers.mask = mask;
    // 'lite': Earth / sky through the windows only in the cupola (the far scene costs ~30 % of a lite frame)
    const farOn = showExterior || (zone && windows && (!this.lite || zone.id === 'cupola'));
    if (this.lite) this.mats.setLiteHaze(!!zone && !farOn);
    const farMask = farOn ? this._farMask : 0;
    if (ctx.farCamera.layers.mask !== farMask) ctx.farCamera.layers.mask = farMask;
    if (ctx.sunLight) ctx.sunLight.shadow.autoUpdate = showExterior;
    if (this.station.detail) this.station.detail.interiorView = !!zone;
    const glowOn = !zone;
    if (this.glowMeshes) for (const m of this.glowMeshes) if (m.visible !== glowOn) m.visible = glowOn;
    // ---- carving
    if (!this.lite) this._carve(zone, vis, anyRing);
    // ---- lights (in the camera's compartment) and sun direction for the window masks
    const L = zone?.lights || EMPTY;
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      if (zone && L.length) {
        const src = L[Math.min(i, L.length - 1)];
        if (zone.frame === 'ring') this.toWorldFromRing(src, l.position); else l.position.copy(src);
        l.intensity = (L.length === 1 && i === 1) ? 0 : 3.2;
      } else l.intensity = 0;
    }
    this.mats.update(ctx.orbit.local.sunDir);
    // ---- exposure: fixed interior exposure (the automatic one meters the Earth / Sun)
    const post = ctx.app?.renderer?.post;
    if (post?.grade) {
      const g = post.grade;
      // AO is tuned for hull joints seen from metres away; at cabin scale its kernel smears dark halos
      if (zone && !this._aoSaved) { this._aoSaved = [g.aoRadius, g.aoStrength]; g.aoRadius = 0.22; g.aoStrength = 0.5; }
      else if (!zone && this._aoSaved) { [g.aoRadius, g.aoStrength] = this._aoSaved; this._aoSaved = null; }
      if (zone) {
        const target = (this.lite ? 0.95 : 0.78) * (zone.exposure ?? 1);
        if (g.autoExposure) { g.autoExposure = false; this._exposure = post.exposure?.value ?? target; this._restoreAuto = true; }
        this._exposure += (target - this._exposure) * (1 - Math.exp(-dt * 2.5));
        g.exposure = this._exposure;
      } else if (this._restoreAuto) { g.autoExposure = true; this._restoreAuto = false; }
    }
  }

  _carve(zone, vis, anyRing) {
    const U = this.carveU;
    this._nCarve = 0;
    if (anyRing) packTorus(U, this._nCarve++, _a.set(RING.X0, 0, 0), RING.R, RING.TUBE + 0.02);
    // camera zone first (with its window holes: shield panels over the windows), then the other visible zones
    if (zone) this._carveZone(zone, true);
    for (const z of this.visible) if (z !== zone) this._carveZone(z, !zone);
    // remaining slots: window holes of the other visible zones
    if (zone) for (const z of this.visible) if (z !== zone && z.frame !== 'ring') for (const c of z.carve) if (c.kind === 'window') this._pushCarve(c);
    U.uCarveCount.value = this._nCarve;
  }
  _pushCarve(c) {
    if (this._nCarve >= MAX_CARVE) return;
    if (c.type === 'cone') packCone(this.carveU, this._nCarve++, c.a, c.b, c.ra, c.rb);
    else packBox(this.carveU, this._nCarve++, c.c, c.ax, c.ay, c.hx, c.hy, c.hz);
  }
  _carveZone(z, windows) {
    const U = this.carveU;
    if (z.frame === 'ring') {
      // rotating volumes: pod drum / spoke shaft in world coordinates
      const phi = z.phi ?? 0;
      if (z.podCarve && this._nCarve < MAX_CARVE) {
        _b.set(0, Math.cos(phi) * RING.R, Math.sin(phi) * RING.R);
        this.toWorldFromRing(_q.copy(_b).setX(-4.25), _a); this.toWorldFromRing(_n.copy(_b).setX(4.25), _q);
        packCone(U, this._nCarve++, _a, _q, RING.POD_R + 0.05, RING.POD_R + 0.05);
      }
      if (z.carveSpoke && this._nCarve < MAX_CARVE) {
        this.toWorldFromRing(_b.set(0, Math.cos(phi) * 4.2, Math.sin(phi) * 4.2), _a);
        this.toWorldFromRing(_n.set(0, Math.cos(phi) * 37.2, Math.sin(phi) * 37.2), _q);
        packCone(U, this._nCarve++, _a, _q, 0.82, 0.82);
      }
      return;
    }
    for (const c of z.carve) if (windows || c.kind !== 'window') this._pushCarve(c);
  }

  dispose() {
    for (const z of this.zones) if (!z.shared) for (const g of z.geos.values()) g.dispose();
  }
}
const EMPTY = [];

// ------------------------------------------------------------------------------------------ viewpoints
function makeViews() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // station-frame views: position + look direction; ring views: ring-local position + phi/yaw
  return {
    inside: { pos: V(-14.4, -8.05, 0.25), look: V(1, -0.04, -0.03) },
    'interior-lab': { pos: V(-3.4, -7.85, -0.35), look: V(-1, -0.05, 0.08) },
    'interior-logistics': { pos: V(-21.9, -7.9, 0.2), look: V(-1, -0.05, -0.05) },
    'interior-node1': { pos: V(-17.3, -8.25, -0.95), look: V(-0.55, 0.05, 1) },
    'interior-node2': { pos: V(1.5, -8.0, -0.4), look: V(-0.45, 0.15, 1) },
    'interior-hab2': { pos: V(4.0, -7.75, 0.3), look: V(1, -0.06, -0.05) },
    'interior-hab1': { pos: V(0.4, -7.8, 3.5), look: V(0.03, -0.12, 1) },
    'interior-greenhouse': { pos: V(0.6, -7.95, -3.4), look: V(-0.02, 0.05, -1) },
    'interior-medical': { pos: V(17.3, -7.8, 3.3), look: V(0.04, -0.1, 1) },
    'interior-service': { pos: V(21.5, -7.95, 0.2), look: V(1, -0.04, -0.04) },
    'interior-node3': { pos: V(18.4, -7.7, 0.8), look: V(-0.6, -0.4, -0.7) },
    'interior-dock': { pos: V(36.9, -7.8, 0.4), look: V(1, -0.05, -0.1) },
    'interior-stowage': { pos: V(17.5, -10.95, 0.15), look: V(0.02, -1, 0.1) },
    'cupola-inside': { pos: V(-18.45, -10.2, 0.45), look: V(0.15, -1, -0.35) },
    'airlock-inside': { pos: V(-18.5, -7.85, 3.1), look: V(0.0, -0.05, 1) },
    'interior-tunnel': { pos: V(-3.0, -1.0, 0.05), look: V(-1, 0, 0) },
    'interior-ringhub': { pos: V(-37.6, -0.6, 0.6), look: V(-1, -0.1, -0.1) },
    'interior-spoke': { ring: true, phi: 0.0, rho: 18, x: 0.05, yaw: 0, pitch: -1.2, ladder: true },
    'interior-ring': { ring: true, phi: 0.42, rho: RING.FLOOR - 1.68, x: 0.1, yaw: 0, pitch: -0.05 },
    'interior-pod': { ring: true, phi: Math.PI * 2 / 3 + 0.075, rho: RING.FLOOR - 1.68, x: 0.3, yaw: Math.PI, pitch: 0.12 },
    'interior-cabin': { ring: true, phi: 0.226, rho: RING.FLOOR - 1.68, x: 1.3, yaw: 0.85, pitch: -0.28 },
  };
}
