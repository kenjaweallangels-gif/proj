import * as THREE from 'three';

/**
 * Astronaut skeleton: one bone layout shared by the crew body (IVA clothing) and the spacesuit, with
 * per-outfit joint positions (the suit's shoulder bearings sit wider than a human's shoulder joints).
 *
 * Body space: +Y up, +Z forward, +X the body's left; origin on the floor between the feet. Bind pose:
 * standing, arms hanging straight down with the palms facing the thighs, thumbs forward. All bones have
 * identity rotation in the bind pose, so a limb's rest direction is -Y (feet / toes: +Z).
 *
 * Bones: root, pelvis, spine, chest, neck, head, hatch (suit backpack door), and per side (L = +X, R = -X):
 * upperArm, forearm, hand, thumb1-3, index1-3, middle1-3, ring1-3, pinky1-3, thigh, shin, foot, toes.
 */

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

export function boneList() {
  const L = [['root', null], ['pelvis', 'root'], ['spine', 'pelvis'], ['chest', 'spine'], ['neck', 'chest'], ['head', 'neck'], ['hatch', 'chest']];
  for (const s of ['L', 'R']) {
    L.push([`upperArm${s}`, 'chest'], [`forearm${s}`, `upperArm${s}`], [`hand${s}`, `forearm${s}`]);
    for (const f of FINGERS) { L.push([`${f}1${s}`, `hand${s}`], [`${f}2${s}`, `${f}1${s}`], [`${f}3${s}`, `${f}2${s}`]); }
    L.push([`thigh${s}`, 'pelvis'], [`shin${s}`, `thigh${s}`], [`foot${s}`, `shin${s}`], [`toes${s}`, `foot${s}`]);
  }
  return L;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Hand layout relative to the wrist joint for the LEFT hand in the bind pose (palm faces -X, fingers -Y,
 * thumb +Z). The right hand mirrors X. Values in metres for an adult male hand (length ~0.19 m).
 * finger: [knuckle offset (x, y, z), phalanx lengths [p1, p2, p3], radius]
 */
export const HAND = {
  index: { at: V(-0.004, -0.094, 0.031), len: [0.041, 0.025, 0.021], r: 0.0094 },
  middle: { at: V(-0.002, -0.099, 0.010), len: [0.046, 0.029, 0.022], r: 0.0097 },
  ring: { at: V(-0.003, -0.095, -0.010), len: [0.043, 0.027, 0.021], r: 0.0091 },
  pinky: { at: V(-0.006, -0.086, -0.027), len: [0.033, 0.020, 0.019], r: 0.0080 },
  // thumb: carpometacarpal joint; the metacarpal points down / forward / toward the palm
  thumb: { at: V(-0.016, -0.022, 0.022), len: [0.044, 0.033, 0.027], r: 0.0115, dir: V(-0.38, -0.62, 0.68).normalize() },
};

/**
 * Joint positions (bind pose). `kind` 'crew' = a 1.80 m adult male; 'suit' = the same person in a
 * semi-rigid suit (boot insoles 3 cm up, shoulder bearings at +-0.25 m, wider hips).
 */
export function joints(kind = 'crew') {
  const up = kind === 'suit' ? 0.03 : 0;
  const sh = kind === 'suit' ? 0.25 : 0.185;
  const hip = kind === 'suit' ? 0.105 : 0.095;
  const J = {
    root: V(0, 0, 0),
    pelvis: V(0, 0.98 + up, 0),
    spine: V(0, 1.10 + up, -0.015),
    chest: V(0, 1.30 + up, -0.025),
    neck: V(0, 1.50 + up, -0.03),
    head: V(0, 1.60 + up, -0.01),
    hatch: V(-0.27, 1.28 + up, -0.40),       // suit backpack door hinge (right side, behind the back)
  };
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    J[`upperArm${s}`] = V(sx * sh, 1.445 + up, -0.03);
    J[`forearm${s}`] = V(sx * (sh + 0.006), 1.145 + up, -0.035);
    J[`hand${s}`] = V(sx * (sh + 0.012), 0.88 + up, -0.03);
    const W = J[`hand${s}`];
    for (const f of FINGERS) {
      const h = HAND[f];
      const k0 = W.clone().add(V(sx * h.at.x, h.at.y, h.at.z));
      const d = f === 'thumb' ? V(sx * h.dir.x, h.dir.y, h.dir.z) : V(0, -1, 0);
      J[`${f}1${s}`] = k0;
      J[`${f}2${s}`] = k0.clone().addScaledVector(d, h.len[0]);
      J[`${f}3${s}`] = k0.clone().addScaledVector(d, h.len[0] + h.len[1]);
    }
    J[`thigh${s}`] = V(sx * hip, 0.93 + up, 0.0);
    J[`shin${s}`] = V(sx * (hip + 0.005), 0.50 + up, 0.01);
    J[`foot${s}`] = V(sx * (hip + 0.01), 0.085 + up, -0.01);
    J[`toes${s}`] = V(sx * (hip + 0.015), 0.025 + up, 0.145);
  }
  J.eye = V(0, 1.685 + up, 0.085);   // midpoint between the eyes (not a bone)
  return J;
}

export class Rig {
  /**
   * @param {Object<string, THREE.Vector3>} J joint positions (bind pose, body space)
   * @param {Object<string, THREE.Quaternion>|null} rest optional bind orientation of each bone (rig space) for meshes
   *   whose bind pose is not the canonical one (the MakeHuman crew body is modelled in an A-pose): local -Y along
   *   the limb, +Z to the front. Posing always works in canonical frames — identity rotations = standing with the
   *   arms hanging, palms toward the thighs — whatever the bind pose of the mesh.
   */
  constructor(J, rest = null) {
    this.J = J;
    this.group = new THREE.Group();
    this.group.name = 'astronautRig';
    this.bones = new Map();
    this.index = new Map();
    const list = boneList();
    const arr = [];
    const R = (n) => (rest && rest[n]) || IDENT;
    for (const [name, parent] of list) {
      const b = new THREE.Bone(); b.name = name;
      const p = J[name].clone(); if (parent) p.sub(J[parent]).applyQuaternion(R(parent).clone().invert());
      b.position.copy(p);
      b.userData.bind = p.clone();
      // bind orientation relative to the parent (identity for the procedural outfits)
      b.quaternion.copy(parent ? R(parent).clone().invert().multiply(R(name)) : R(name));
      this.bones.set(name, b); this.index.set(name, arr.length); arr.push(b);
      if (parent) this.bones.get(parent).add(b); else this.group.add(b);
    }
    this.root = this.bones.get('root');
    this.group.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(arr);
    for (const b of arr) b.quaternion.identity();     // canonical pose
    this.group.updateMatrixWorld(true);
    this.levels = [];        // [{ group, dist, meshes }]
    this.lod = new THREE.Group(); this.lod.name = 'lod';
    this.group.add(this.lod);
    this.level = -1;
    // limb lengths for the IK
    const d = (a, b) => J[a].distanceTo(J[b]);
    this.len = { upperArm: d('upperArmL', 'forearmL'), forearm: d('forearmL', 'handL'), thigh: d('thighL', 'shinL'), shin: d('shinL', 'footL') };
    this.eyeLocal = J.eye.clone().sub(J.head);   // eye point in the head bone frame
  }

  /**
   * Add a detail level. geos: Map<key, BufferGeometry> (from SkinBuilder.build), mats: key -> Material,
   * dist: switch distance (the level is used up to this camera distance). Returns the created meshes.
   */
  addLevel(geos, mats, dist, opts = {}) {
    const g = new THREE.Group(); g.name = `lod${this.levels.length}`;
    const meshes = [];
    const id = new THREE.Matrix4();
    for (const [key, geo] of geos) {
      const m = mats[key];
      if (!m) { console.warn('[suit] no material for', key); continue; }
      const mesh = new THREE.SkinnedMesh(geo, m);
      mesh.name = `${opts.name || 'body'}:${key}`;
      mesh.bind(this.skeleton, id);
      // generous fixed bounds (the pose changes; recomputing skinned bounds per frame is costly)
      mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 1.45);
      mesh.boundingBox = new THREE.Box3(new THREE.Vector3(-1.3, -0.5, -1.3), new THREE.Vector3(1.3, 2.4, 1.3));
      mesh.castShadow = !!opts.castShadow && !m.transparent;
      mesh.receiveShadow = !!opts.receiveShadow;
      mesh.userData.key = key;
      mesh.userData.noCollide = true;
      g.add(mesh); meshes.push(mesh);
    }
    g.visible = false;
    this.lod.add(g);
    const L = { group: g, dist, meshes, tris: [...geos.values()].reduce((s, x) => s + (x.userData.tris || 0), 0) };
    this.levels.push(L);
    if (this.level < 0) this.setLevel(0);
    return L;
  }

  setLevel(i) {
    i = Math.max(0, Math.min(this.levels.length - 1, i));
    if (i === this.level) return;
    this.level = i;
    this.levels.forEach((L, k) => { L.group.visible = k === i; });
  }

  /** Pick the level for a camera distance (hysteresis 8 %). */
  updateLevel(distance) {
    let i = this.levels.findIndex((L) => distance < L.dist * (this.level >= 0 && this.levels.indexOf(L) < this.level ? 0.92 : 1));
    if (i < 0) i = this.levels.length - 1;
    this.setLevel(i);
  }

  /** All bones back to the bind pose (identity rotations). */
  resetPose() {
    for (const b of this.bones.values()) { b.quaternion.identity(); b.position.copy(b.userData.bind); }
  }

  bone(name) { return this.bones.get(name); }

  dispose() {
    for (const L of this.levels) for (const m of L.meshes) if (!m.geometry.userData.shared) m.geometry.dispose();
    this.skeleton.dispose();
  }
}

// ------------------------------------------------------------------------------------------ pose helpers
const IDENT = new THREE.Quaternion();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Vector3();
const _s = new THREE.Vector3();
const _pole = new THREE.Vector3();

/**
 * World rotation (into out) whose local -Y maps to `dir` and local +Z to `zHint` (made orthogonal).
 */
export function aimQuat(dir, zHint, out) {
  _y.copy(dir).normalize().negate();
  _z.copy(zHint).addScaledVector(_y, -zHint.dot(_y));
  if (_z.lengthSq() < 1e-10) { _z.set(0, 0, 1).addScaledVector(_y, -_y.z); if (_z.lengthSq() < 1e-10) _z.set(1, 0, 0); }
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** Set a bone's local rotation from a desired world rotation (parent world matrix must be current). */
export function setWorldQuat(bone, qWorld) {
  bone.parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(qWorld));
  bone.updateMatrixWorld(true);
}

/** World rotation from the basis columns (x, y, z unit, orthonormal). */
export function basisQuat(x, y, z, out) { _m.makeBasis(x, y, z); return out.setFromRotationMatrix(_m); }

/**
 * Two-bone IK in world space. upper/lower/end bones (end = wrist / ankle bone), target world position of
 * the end joint, pole = world direction the middle joint (elbow / knee) should point toward.
 * bendSign: +1 if the lower limb bends toward local +Z of the upper bone (elbow: forearm forward; knee: -1).
 * Returns the reach ratio (|target - root| / (L1 + L2)).
 */
export function twoBoneIK(upper, lower, end, target, pole, L1, L2, bendSign = 1) {
  upper.updateMatrixWorld(true);
  upper.getWorldPosition(_s);
  const dir = _v.subVectors(target, _s);
  let d = dir.length();
  const ratio = d / (L1 + L2);
  if (d < 1e-6) { dir.set(0, -1, 0); d = 1e-6; }
  dir.multiplyScalar(1 / d);
  d = THREE.MathUtils.clamp(d, Math.abs(L1 - L2) + 0.02, L1 + L2 - 0.002);
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _pole.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (_pole.lengthSq() < 1e-8) perp(dir, _pole);
  _pole.normalize();
  _e.copy(_s).addScaledVector(dir, a).addScaledVector(_pole, h);             // middle joint
  _w.copy(_s).addScaledVector(dir, d);                                         // end joint (clamped)
  // upper: -Y toward the middle joint; +Z toward the side the lower limb bends to (away from the pole for elbows)
  const toEnd = _x.subVectors(_w, _e).normalize();
  const upDir = new THREE.Vector3().subVectors(_e, _s).normalize();
  const zU = new THREE.Vector3().copy(toEnd).addScaledVector(upDir, -toEnd.dot(upDir));
  if (zU.lengthSq() < 1e-8) zU.copy(_pole).negate(); else zU.normalize();
  if (bendSign < 0) zU.negate();
  setWorldQuat(upper, aimQuat(upDir, zU, _q));
  // lower: -Y toward the end joint; +Z continues the bend plane (back toward the upper segment's root)
  const zL = new THREE.Vector3().copy(upDir).negate().addScaledVector(toEnd, upDir.dot(toEnd));
  if (zL.lengthSq() < 1e-8) zL.copy(zU); else zL.normalize();
  if (bendSign < 0) zL.negate();
  setWorldQuat(lower, aimQuat(toEnd, zL, _q));
  end.updateMatrixWorld(true);
  return ratio;
}

function perp(v, out) { if (Math.abs(v.y) < 0.9) out.set(0, 1, 0); else out.set(1, 0, 0); return out.addScaledVector(v, -out.dot(v)).normalize(); }
