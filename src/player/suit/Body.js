import * as THREE from 'three';
import { Rig, joints, FINGERS } from './Rig.js';
import { SkinBuilder } from './Geo.js';
import { SuitAssets } from './Assets.js';
import { buildOrlan, ORLAN_MATERIALS, ORLAN_VARIANTS } from './Orlan.js';
import { buildCrew, CREW_MATERIALS } from './Crew.js';
import { crewData, crewGeometries, CREW_MH_MATERIALS } from './CrewMH.js';
import { LAYERS } from '../../core/constants.js';

/**
 * A complete astronaut figure: skeleton + skinned meshes in up to three levels of detail, for one outfit
 * ('orlan' spacesuit or 'crew' IVA clothing). Used for the player's own body (first person and observer
 * camera), the suits on the airlock mounts and the ?suitshow debug line-up.
 *
 * LOD (camera distance): LOD0 full detail (convolutes, straps, fingers, decals), LOD1 ~40 % tessellation,
 * LOD2 a ~10k-triangle silhouette. 'lite' builds LOD1/LOD2-class geometry only.
 */

export const LOD_DETAIL = [1.0, 0.42, 0.13];
export const LOD_DIST = [7, 30, Infinity];

const _v = new THREE.Vector3();

export class AstronautBody {
  /**
   * opts: { outfit: 'orlan'|'crew', variant: 'blue'|'red', fp: bool (first-person extras, LOD0 only), upm: bool,
   *   hatchInterior: bool, levels: [detail...], dists: [...], materials: key->Material (override, e.g. interior),
   *   castShadow, layer (render layer), name }
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.opts = opts;
    this.outfit = opts.outfit || 'orlan';
    this.assets = SuitAssets.get(ctx);
    const lite = this.assets.lite;
    // crew: the MakeHuman-based body when its data is loaded (SuitAssets.ready), else the procedural one
    const mh = this.outfit === 'crew' && !opts.procedural ? crewData() : null;
    this.mh = !!mh;
    this.rig = mh ? new Rig(mh.J, mh.rest) : new Rig(joints(this.outfit === 'orlan' ? 'suit' : 'crew'));
    this.group = this.rig.group;
    this.group.name = opts.name || `astronaut:${this.outfit}`;
    this.group.userData.noCollide = true;
    const keys = this.outfit === 'orlan' ? ORLAN_MATERIALS : mh ? CREW_MH_MATERIALS : CREW_MATERIALS;
    const mats = opts.materials || this.assets.set(keys);
    let levels = opts.levels || (opts.fp ? [1.0] : LOD_DETAIL);
    if (lite) levels = opts.fp ? [0.3] : [0.3, 0.13];
    const dists = opts.dists || (levels.length === 1 ? [Infinity] : lite ? [10, Infinity] : LOD_DIST);
    this.stats = [];
    levels.forEach((detail, i) => {
      let geos;
      if (mh) geos = crewGeometries(mh, detail >= 0.9 ? 0 : detail >= 0.25 ? 1 : 2);
      else {
        const B = new SkinBuilder(this.rig.index, detail);
        B.atlas = this.assets.atlas;
        if (this.outfit === 'orlan') buildOrlan(B, this.rig.J, { variant: ORLAN_VARIANTS[opts.variant || 'blue'], fp: !!opts.fp, upm: !!opts.upm, hatchInterior: !!opts.hatchInterior });
        else buildCrew(B, this.rig.J, { fp: !!opts.fp });
        geos = B.build();
      }
      const L = this.rig.addLevel(geos, mats, dists[i] ?? Infinity, { castShadow: opts.castShadow ?? !lite, receiveShadow: !lite, name: this.group.name });
      this.stats.push({ detail, tris: L.tris, draws: L.meshes.length });
    });
    if (opts.layer !== undefined) this.group.traverse((o) => o.layers.set(opts.layer));
    this.helmetIn = this.rig.levels.flatMap((L) => L.meshes).filter((m) => m.userData.key === 'helmetIn');
    this.lampMeshes = this.rig.levels.flatMap((L) => L.meshes).filter((m) => m.userData.key === 'glow');
    this.time = 0;
    // distance LOD: the visible level's first mesh picks the level for the next frame from the rendering camera
    if (this.rig.levels.length > 1) for (const L of this.rig.levels) if (L.meshes[0]) L.meshes[0].onBeforeRender = (r, sc, cam) => this.updateLod(cam);
  }

  /** Bind-pose joint table (body space). */
  get J() { return this.rig.J; }

  /** Choose the LOD for the given camera (world). */
  updateLod(camera) {
    if (this.rig.levels.length < 2) return;
    this.group.getWorldPosition(_v);
    _v.y += 0; // origin at the feet; distance to the figure's centre is close enough
    this.rig.updateLevel(_v.distanceTo(camera.getWorldPosition(_tmp)));
  }

  /** Static pose by name (see Poses). */
  pose(name, params = {}) { applyPose(this.rig, name, params); this.group.updateMatrixWorld(true); }

  dispose() { this.rig.dispose(); }
}
const _tmp = new THREE.Vector3();

// ------------------------------------------------------------------------------------------ static poses
const D = THREE.MathUtils.degToRad;
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

/** Local rotation of a bone from Euler angles in degrees (bone axes = body axes in the bind pose). */
export function rot(rig, name, x = 0, y = 0, z = 0, order = 'XYZ') {
  const b = rig.bone(name); if (!b) return;
  b.quaternion.setFromEuler(_e.set(D(x), D(y), D(z), order));
}

/**
 * Finger curl for one hand: c 0 (relaxed open) .. 1 (fist / grip), spread 0..1, thumb opposition 0..1.
 * Flexion turns each phalanx toward the palm about the bone's Z axis.
 */
export function curlHand(rig, side, c, spread = 0.2, thumb = null) {
  const s = side === 'L' ? 1 : -1;
  const base = [0.12, 0.1, 0.08];
  for (const f of FINGERS) {
    if (f === 'thumb') continue;
    const sp = { index: 1, middle: 0.2, ring: -0.6, pinky: -1.3 }[f] * spread * 6;
    const k = { index: 0.92, middle: 1, ring: 1.04, pinky: 1.08 }[f];
    const a = [D(8 + 82 * c * k), D(10 + 95 * c * k), D(6 + 62 * c * k)].map((x, i) => x + base[i] * 0);
    for (let i = 0; i < 3; i++) {
      const b = rig.bone(`${f}${i + 1}${side}`);
      _q.setFromAxisAngle(_ax.set(0, 0, 1), -s * a[i]);
      if (i === 0) b.quaternion.setFromAxisAngle(_ax2.set(1, 0, 0), D(sp)).multiply(_q);
      else b.quaternion.copy(_q);
    }
  }
  // thumb: opposition swings the metacarpal across the palm, then the phalanges flex
  const o = thumb ?? c;
  const t1 = rig.bone(`thumb1${side}`), t2 = rig.bone(`thumb2${side}`), t3 = rig.bone(`thumb3${side}`);
  t1.quaternion.setFromEuler(_e.set(D(-10 * o), D(s * (-25 * o)), D(-s * (8 + 22 * o)), 'XYZ'));
  t2.quaternion.setFromAxisAngle(_ax.set(0.3 * s, 0.2, 1).normalize(), -s * D(10 + 45 * c));
  t3.quaternion.setFromAxisAngle(_ax.set(0.3 * s, 0.2, 1).normalize(), -s * D(8 + 60 * c));
}
const _ax = new THREE.Vector3(), _ax2 = new THREE.Vector3();

export function applyPose(rig, name, p = {}) {
  rig.resetPose();
  const both = (fn) => { fn('L', 1); fn('R', -1); };
  switch (name) {
    case 'bind': break;
    case 'stand':     // relaxed standing (A-pose-ish, slight elbow flexion)
      both((S, s) => {
        rot(rig, `upperArm${S}`, -4, 0, s * 12);
        rot(rig, `forearm${S}`, -18, 0, 0);
        rot(rig, `hand${S}`, 0, s * -10, s * 4);
        curlHand(rig, S, 0.25, 0.15, 0.2);
      });
      break;
    case 'mount':     // suit hanging on its mount: arms slightly out and forward, legs straight
      both((S, s) => {
        rot(rig, `upperArm${S}`, -10, 0, s * 18);
        rot(rig, `forearm${S}`, -25, 0, 0);
        rot(rig, `hand${S}`, 0, 0, s * 6);
        curlHand(rig, S, 0.3, 0.1, 0.3);
        rot(rig, `thigh${S}`, -3, 0, s * 2);
        rot(rig, `shin${S}`, 5, 0, 0);
        rot(rig, `foot${S}`, -2, 0, 0);
      });
      if (p.hatch !== undefined) rot(rig, 'hatch', 0, p.hatch, 0);
      break;
    case 'nbp':       // zero-g neutral body posture (NASA STD-3000)
      rot(rig, 'spine', 6, 0, 0); rot(rig, 'chest', 4, 0, 0); rot(rig, 'neck', 12, 0, 0); rot(rig, 'head', 10, 0, 0);
      both((S, s) => {
        rot(rig, `upperArm${S}`, -38, s * 10, s * 28, 'YXZ');
        rot(rig, `forearm${S}`, -55, 0, 0);
        rot(rig, `hand${S}`, 0, s * -20, 0);
        curlHand(rig, S, 0.35, 0.2, 0.35);
        rot(rig, `thigh${S}`, -48, 0, s * 8);
        rot(rig, `shin${S}`, 52, 0, 0);
        rot(rig, `foot${S}`, 12, 0, 0);
      });
      break;
    case 'eva':       // suited zero-g working posture: arms forward, slight crouch (suit stiffness)
      both((S, s) => {
        rot(rig, `upperArm${S}`, -28, 0, s * 20);
        rot(rig, `forearm${S}`, -50, 0, 0);
        rot(rig, `hand${S}`, 0, s * -15, 0);
        curlHand(rig, S, 0.45, 0.1, 0.4);
        rot(rig, `thigh${S}`, -18, 0, s * 4);
        rot(rig, `shin${S}`, 24, 0, 0);
        rot(rig, `foot${S}`, 2, 0, 0);
      });
      break;
    default: break;
  }
  if (p.hatch !== undefined && name !== 'mount') rot(rig, 'hatch', 0, p.hatch, 0);
  rig.group.updateMatrixWorld(true);
}

export { LAYERS };
