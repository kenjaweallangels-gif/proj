import * as THREE from 'three';
import { LAYOUT } from './Layout.js';
import { LAYERS } from '../../core/constants.js';
import { Builder, boxAt, bevelBoxAt, tubeAt } from './Builder.js';
import { COL } from './Detail.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const CY = LAYOUT.clusterY;

/** Additive glow halos for a set of light positions (one draw call). Colors are updated per frame. */
class Halos {
  constructor(textures, parent, positions, size) {
    const n = positions.length;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    positions.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; });
    this.colors = new Float32Array(n * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.colorAttr = new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', this.colorAttr);
    geo.computeBoundingSphere();
    const mat = new THREE.PointsMaterial({ size, map: textures.glow({ size: 64, falloff: 2.2 }), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, sizeAttenuation: true });
    this.points = new THREE.Points(geo, mat);
    this.points.layers.set(LAYERS.NO_SHADOW);
    this.points.renderOrder = 40;
    this.points.frustumCulled = false;
    parent.add(this.points);
  }
  set(i, r, g, b) { this.colors[i * 3] = r; this.colors[i * 3 + 1] = g; this.colors[i * 3 + 2] = b; }
  commit() { this.colorAttr.needsUpdate = true; }
}

/**
 * Navigation lights (red -Z, green +Z, white strobes), ring strobes, floodlights (4 SpotLights) and
 * the airlock interior light. All emissive heads are merged per blink group with cloned materials.
 */
export class StationLights {
  constructor(ctx, station, ring, airlockInfo) {
    const m = ctx.materials;
    const h = LAYOUT.spineSize / 2;
    this.time = 0;
    this.groups = [];
    const headGeo = (p, r = 0.13) => new THREE.SphereGeometry(r, 10, 8).translate(p.x, p.y, p.z);

    const defs = [
      { name: 'red', mat: 'navRed', color: new THREE.Color(1, 0.12, 0.06), pos: [V(-87, 0, -(h + 0.4)), V(-40, 1.0, -(h + 0.4)), V(30, 1.0, -(h + 0.4)), V(87, 0, -(h + 0.4)), V(LAYOUT.hubX, CY - 3.9, -2.5)], pattern: 'red' },
      { name: 'green', mat: 'navGreen', color: new THREE.Color(0.12, 1, 0.25), pos: [V(-87, 0, h + 0.4), V(-40, 1.0, h + 0.4), V(30, 1.0, h + 0.4), V(87, 0, h + 0.4), V(LAYOUT.hubX, CY - 3.9, 2.5)], pattern: 'green' },
      { name: 'white', mat: 'navWhite', color: new THREE.Color(1, 1, 1), pos: [V(-88.6, 0, 0), V(88.6, 0, 0), V(50, h + 9.4, 0), V(LAYOUT.hubX + 4.2, CY - 3.6, 0), V(-18.5, -2.5, 11.2)], pattern: 'strobe' },
    ];
    const bs = new Builder(m);
    const staticPositions = [];
    this.staticIdx = [];
    for (const d of defs) {
      const mat = m.get(d.mat).clone(); mat.name = `${d.mat}Blink`;
      for (const p of d.pos) {
        bs.add(d.mat, headGeo(p), false, mat);
        bs.add('metalDark', new THREE.CylinderGeometry(0.16, 0.18, 0.08, 10).translate(p.x, p.y - 0.14, p.z), false);
      }
      const start = staticPositions.length;
      staticPositions.push(...d.pos);
      this.groups.push({ mat, color: d.color, pattern: d.pattern, start, count: d.pos.length, halo: null });
    }
    bs.build(station, { name: 'navLights' });
    this.halos = new Halos(ctx.textures, station, staticPositions, 1.1);
    for (const g of this.groups) g.halo = this.halos;

    // ring strobes (rotate with the ring)
    const br = new Builder(m);
    const ringMat = m.get('navWhite').clone(); ringMat.name = 'ringStrobe';
    for (const p of ring.strobePositions) { br.add('navWhite', headGeo(p, 0.2), false, ringMat); br.add('metalDark', bevelBoxAt(p.clone().addScaledVector(p.clone().normalize(), -0.25), 0.4, 0.3, 0.4, null), false); }
    br.build(ring.group, { name: 'ringLights' });
    this.ringHalos = new Halos(ctx.textures, ring.group, ring.strobePositions, 2.4);
    this.ringMat = ringMat;
    this.ringCount = ring.strobePositions.length;

    // floodlights: 2 on the docking hub, 2 on the airlock
    const HX = LAYOUT.hubX;
    const al = airlockInfo;
    const floodDefs = [
      { pos: V(HX - 3.0, CY + 3.6, 2.6), target: V(HX + 1.5, CY - 2.5, 1.5) },
      { pos: V(HX + 3.0, CY + 3.6, -2.6), target: V(HX + 4.0, CY - 2.0, -1.0) },
      { pos: V(al.x + 1.0, -h - 0.3, 5.5), target: V(al.x, CY + 0.5, al.hatchZ + 1.5) },
      { pos: V(al.x - 4.5, CY + 2.9, 3.0), target: V(al.x, CY - 0.5, al.hatchZ + 0.5) },
    ];
    this.floodMat = m.get('floodLight').clone(); this.floodMat.name = 'floodHead';
    this.dockMat = m.factories.dockLight ? m.get('dockLight') : null;   // port / EVA work lights (registered by Station)
    this.spots = [];
    const bf = new Builder(m);
    const floodPositions = [];
    for (const f of floodDefs) {
      const dir = f.target.clone().sub(f.pos).normalize();
      const spot = new THREE.SpotLight(0xfff1dc, 0, 60, 0.6, 0.5, 2);
      spot.position.copy(f.pos); spot.target.position.copy(f.target); spot.castShadow = false;
      station.add(spot); station.add(spot.target);
      this.spots.push(spot);
      // head: hood box + emissive face, on a short bracket
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir);
      bf.add('metalDark', bevelBoxAt(f.pos.clone().addScaledVector(dir, -0.12), 0.5, 0.42, 0.34, q), false);
      bf.add('floodLight', bevelBoxAt(f.pos.clone().addScaledVector(dir, 0.06), 0.4, 0.32, 0.03, q), false, this.floodMat);
      bf.add('metalDark', tubeAt(f.pos.clone().addScaledVector(dir, -0.45), dir, 0.05, 0.4, 6, { uv: false }), false);
      const D = station.detail;
      if (D) {
        // heat-sink fins on the back, yoke with pivot pins, bezel bolts
        const M = new THREE.Matrix4().compose(f.pos, q, V(1, 1, 1));
        for (let i = 0; i < 6; i++) D.part('mid', 'metal', COL.dark, 'box', M, -0.2 + i * 0.08, 0, -0.33, 0.012, 0.36, 0.12);
        for (const sx of [-1, 1]) {
          D.part('mid', 'metal', COL.steel, 'bbox', M, sx * 0.28, 0, -0.12, 0.03, 0.12, 0.3);
          D.part('mid', 'metal', COL.bare, 'cyl8', M.clone().multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)), 0, -sx * 0.3, -0.12, 0.03, 0.06, 0.03);
        }
        for (const [x, y] of [[-0.21, -0.17], [0.21, -0.17], [-0.21, 0.17], [0.21, 0.17]]) D.bolt(M.clone().multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(x, y, 0.05)), 0.012, 0.008);
      }
      floodPositions.push(f.pos.clone().addScaledVector(dir, 0.15));
    }
    bf.build(station, { name: 'floodHeads' });
    this.floodHalos = new Halos(ctx.textures, station, floodPositions, 2.4);
    this.floodLevel = 0;

    // airlock interior point light (warm)
    this.interior = new THREE.PointLight(0xfff0d8, 14, 9, 2);
    this.interior.position.copy(al.interiorLight);
    station.add(this.interior);
  }

  update(dt, ctx) {
    this.time += dt;
    const t = this.time;
    // blink patterns
    for (const g of this.groups) {
      let k;
      const ph = t % 1.2;
      if (g.pattern === 'red') k = ph < 0.12 ? 1 : 0.22;
      else if (g.pattern === 'green') k = (ph > 0.6 && ph < 0.72) ? 1 : 0.22;
      else { const s = t % 2.0; k = (s < 0.06 || (s > 0.16 && s < 0.22)) ? 1 : 0.0; }
      g.mat.emissiveIntensity = (g.pattern === 'strobe' ? 10 : 6) * k;
      const a = (g.pattern === 'strobe' ? 1.2 : 0.8) * k;
      for (let i = 0; i < g.count; i++) g.halo.set(g.start + i, g.color.r * a, g.color.g * a, g.color.b * a);
    }
    this.halos.commit();
    // ring strobes: sequential flashes around the rim
    let anyRing = 0;
    for (let i = 0; i < this.ringCount; i++) {
      const s = (t + i * 0.375) % 1.5;
      const k = s < 0.08 ? 1 : 0;
      anyRing = Math.max(anyRing, k);
      this.ringHalos.set(i, 1.4 * k, 1.4 * k, 1.4 * k);
    }
    this.ringMat.emissiveIntensity = 2 + 8 * anyRing;
    this.ringHalos.commit();
    // floodlights: dim in daylight, full in eclipse (smooth)
    const sv = ctx.orbit.local.sunVisible;
    const want = 0.08 + 0.92 * THREE.MathUtils.smoothstep(1 - sv, 0.7, 0.95);
    this.floodLevel += (want - this.floodLevel) * Math.min(1, dt * 1.5);
    for (const s of this.spots) s.intensity = 900 * this.floodLevel;
    this.floodMat.emissiveIntensity = 1.5 + 12 * this.floodLevel;
    if (this.dockMat) this.dockMat.emissiveIntensity = 0.6 + 9 * this.floodLevel;
    const fh = this.floodLevel * this.floodLevel * 1.3;
    for (let i = 0; i < this.spots.length; i++) this.floodHalos.set(i, fh, fh * 0.95, fh * 0.85);
    this.floodHalos.commit();
  }
}
