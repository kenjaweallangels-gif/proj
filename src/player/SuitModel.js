import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LAYERS } from '../core/constants.js';

/**
 * First-person spacesuit: two procedural arms (shoulder, upper arm, bellows elbow, forearm with
 * cuff rings, glove with five curling fingers, wrist mirror and cuff checklist on the left arm),
 * chest display/control module, helmet neck ring and visor frame, a helmet lamp and an invisible
 * shadow-casting body proxy. Everything camera-parented lives on LAYERS.FIRST_PERSON.
 *
 * Arms are driven by analytic two-bone IK in camera space; targets are smoothed so reaching for a
 * handrail or the SAFER hand controller reads as a motion, not a snap.
 */

const L1 = 0.31;        // upper arm
const L2 = 0.29;        // forearm
const HAND_LEN = 0.17;  // wrist to fingertips

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function fp(obj) { obj.traverse((o) => o.layers.set(LAYERS.FIRST_PERSON)); return obj; }
function scaleUV(g, s) { const uv = g.attributes.uv; if (uv) { for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s, uv.getY(i) * s); } return g; }
function cyl(rTop, rBot, h, seg = 14) { return scaleUV(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false), 2); }
function torus(r, tube, seg = 6, rad = 20) { return new THREE.TorusGeometry(r, tube, seg, rad); }
function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

/** Orientation from a Y axis (unit) and a hint for the Z axis. */
function basisQuat(yAxis, zHint, out) {
  _y.copy(yAxis);
  _z.copy(zHint).addScaledVector(_y, -zHint.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

export class SuitModel {
  constructor(ctx, camera, scene) {
    this.ctx = ctx;
    this.camera = camera;
    const m = ctx.materials;
    this.mats = {
      suit: m.get('suitWhite'), rubber: m.get('rubberBlack'), metal: m.get('metalBare'), dark: m.get('metalDark'),
      visor: m.get('visorGold'), gray: m.get('paintGray'), green: m.get('navGreen'), red: m.get('navRed'), white: m.get('hullWhite'),
    };
    this.mirrorMat = this.mats.metal.clone(); this.mirrorMat.roughness = 0.04; this.mirrorMat.roughnessMap = null; this.mirrorMat.envMapIntensity = 1.6; this.mirrorMat.name = 'wristMirror';
    this.screenMat = new THREE.MeshStandardMaterial({ color: 0x0a1a10, emissive: 0x30c070, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1 });

    this.group = new THREE.Group();
    this.group.name = 'suitFirstPerson';
    camera.add(this.group);

    this.time = 0;
    this.arms = [this._buildArm(-1), this._buildArm(1)];
    this._buildTorso();
    this._buildHelmet();
    this._buildLamp();
    fp(this.group);
    this._buildShadowProxy(scene);

    // animation state
    this.curl = [0.15, 0.15];
    this.curlTarget = [0.15, 0.15];
    this.reach = null;       // world Vector3 the hand reaches for (handrail grab point)
    this.reachArm = 1;
    this.vibration = 0;
  }

  // ---------------------------------------------------------------- building
  _buildArm(side) {
    const S = this.mats;
    const root = new THREE.Group(); root.name = side < 0 ? 'armL' : 'armR';
    this.group.add(root);

    // upper arm: shoulder ball + tapered sleeve + bellows rings near the elbow
    const upperParts = [new THREE.SphereGeometry(0.078, 16, 12), cyl(0.062, 0.072, L1).translate(0, L1 / 2, 0)];
    for (let i = 0; i < 3; i++) upperParts.push(torus(0.064 - i * 0.002, 0.007, 6, 18).rotateX(Math.PI / 2).translate(0, L1 - 0.03 - i * 0.022, 0));
    const upper = new THREE.Mesh(mergeGeometries(upperParts, false), S.suit);
    upper.name = 'upperArm'; root.add(upper);

    // forearm: elbow ball + sleeve, cuff rings (metal bearing + rubber seal) at the wrist
    const fore = new THREE.Group(); fore.name = 'forearm'; root.add(fore);
    const foreWhite = mergeGeometries([new THREE.SphereGeometry(0.066, 16, 12), cyl(0.054, 0.062, L2 - 0.06).translate(0, (L2 - 0.06) / 2, 0),
      torus(0.058, 0.006, 6, 18).rotateX(Math.PI / 2).translate(0, 0.05, 0)], false);
    fore.add(new THREE.Mesh(foreWhite, S.suit));
    const cuffMetal = mergeGeometries([torus(0.058, 0.012, 8, 20).rotateX(Math.PI / 2).translate(0, L2 - 0.012, 0),
      cyl(0.052, 0.054, 0.035).translate(0, L2 - 0.04, 0)], false);
    fore.add(new THREE.Mesh(cuffMetal, S.metal));
    fore.add(new THREE.Mesh(torus(0.057, 0.009, 6, 20).rotateX(Math.PI / 2).translate(0, L2 - 0.06, 0), S.rubber));
    if (side < 0) {
      // wrist mirror (reads the chest display backwards) and cuff checklist on the left forearm
      const mirrorBack = new THREE.Mesh(box(0.056, 0.04, 0.006).translate(0, L2 - 0.1, 0.057), S.dark);
      const mirror = new THREE.Mesh(box(0.05, 0.034, 0.002).translate(0, L2 - 0.1, 0.061), this.mirrorMat);
      const listBack = new THREE.Mesh(box(0.082, 0.062, 0.008).translate(0, L2 - 0.17, 0.055), S.white);
      const list1 = new THREE.Mesh(new THREE.PlaneGeometry(0.076, 0.026).translate(0, L2 - 0.155, 0.0595), this.ctx.materials.label('EVA-1 · ЧЕКЛИСТ', { width: 256, height: 88, font: 'bold 40px Arial', color: '#1b1f24', bg: '#f4f4ef' }));
      const list2 = new THREE.Mesh(new THREE.PlaneGeometry(0.076, 0.026).translate(0, L2 - 0.185, 0.0595), this.ctx.materials.label('ШЛЮЗ · ТРОС · SAFER · O2', { width: 256, height: 88, font: 'bold 30px Arial', color: '#8a1b1b', bg: '#f4f4ef' }));
      fore.add(mirrorBack, mirror, listBack, list1, list2);
    } else {
      // right cuff: small gauge/pressure indicator
      fore.add(new THREE.Mesh(box(0.04, 0.03, 0.006).translate(0, L2 - 0.1, 0.057), S.dark));
      fore.add(new THREE.Mesh(box(0.03, 0.02, 0.002).translate(0, L2 - 0.1, 0.061), this.screenMat));
    }

    // glove (hand frame: origin at wrist, +Y fingers, +Z back of hand, thumb at -X for right hand)
    const hand = new THREE.Group(); hand.name = 'hand'; root.add(hand);
    const thumbSide = -side;
    const palm = mergeGeometries([
      new THREE.SphereGeometry(0.046, 14, 10).scale(1, 0.85, 0.72),               // wrist bulb
      box(0.088, 0.095, 0.032).translate(0, 0.055, 0.002),                         // palm
      box(0.08, 0.03, 0.028).translate(0, 0.1, 0.0),                               // knuckle line
    ], false);
    hand.add(new THREE.Mesh(palm, S.suit));
    hand.add(new THREE.Mesh(box(0.082, 0.085, 0.005).translate(0, 0.055, -0.016), S.rubber));          // palm pad
    const fingers = [];
    const fx = [-0.033, -0.011, 0.011, 0.033], fl = [0.068, 0.078, 0.073, 0.06];
    for (let i = 0; i < 4; i++) {
      const x = fx[i] * thumbSide * -1; // index finger next to the thumb
      const f = this._finger(fl[i], 0.011);
      f.position.set(x, 0.1, 0.004);
      hand.add(f); fingers.push(f);
    }
    const thumb = this._finger(0.055, 0.0125);
    thumb.position.set(thumbSide * 0.046, 0.035, -0.006);
    _v.set(thumbSide * 0.75, 0.6, -0.3).normalize();
    thumb.quaternion.setFromUnitVectors(UP, _v);
    thumb.userData.base = thumb.quaternion.clone();
    hand.add(thumb); fingers.push(thumb);

    return {
      side, root, upper, fore, hand, fingers,
      shoulder: new THREE.Vector3(side * 0.215, -0.275, 0.06),
      pole: new THREE.Vector3(side * 1.0, -0.55, 0.15).normalize(),
      rest: new THREE.Vector3(side * 0.31, -0.30, -0.50),
      target: new THREE.Vector3(side * 0.31, -0.30, -0.50),
      fingerDir: new THREE.Vector3(side * 0.1, 0.25, -1).normalize(),
      backHint: new THREE.Vector3(side * 0.5, 1, 0).normalize(),
      backHintTarget: new THREE.Vector3(side * 0.5, 1, 0).normalize(),
      phase: side * 1.7,
    };
  }

  /** One finger: proximal + bent distal segment (white) with a rubber fingertip (second material group). */
  _finger(len, r) {
    const l1 = len * 0.55, l2 = len * 0.45;
    const white = mergeGeometries([
      new THREE.SphereGeometry(r * 1.05, 10, 8),
      cyl(r * 0.95, r, l1, 10).translate(0, l1 / 2, 0),
      new THREE.SphereGeometry(r, 10, 8).translate(0, l1, 0),
      cyl(r * 0.85, r * 0.95, l2 * 0.7, 10).translate(0, l2 * 0.35, 0).rotateX(0.45).translate(0, l1, 0),
    ], false);
    const tip = new THREE.SphereGeometry(r * 0.9, 10, 8).scale(1, 1.3, 1).translate(0, l2 * 0.75, 0).rotateX(0.45).translate(0, l1, 0);
    const g = mergeGeometries([white, tip], true);
    const mesh = new THREE.Mesh(g, [this.mats.suit, this.mats.rubber]);
    const pivot = new THREE.Group(); pivot.add(mesh);
    pivot.userData.base = pivot.quaternion.clone();
    return pivot;
  }

  _buildTorso() {
    const S = this.mats;
    // upper torso (hard shell) and the display & control module on the chest, visible when looking down
    const torso = new THREE.Mesh(mergeGeometries([
      new THREE.CapsuleGeometry(0.25, 0.28, 6, 16).scale(1, 1, 0.78).translate(0, -0.62, 0.02),
      new THREE.SphereGeometry(0.11, 12, 10).scale(1.3, 0.5, 1).translate(-0.17, -0.35, 0.03),
      new THREE.SphereGeometry(0.11, 12, 10).scale(1.3, 0.5, 1).translate(0.17, -0.35, 0.03),
    ], false), S.suit);
    torso.name = 'torso';
    const dcm = new THREE.Group(); dcm.name = 'dcm'; dcm.position.set(0, -0.45, -0.17); dcm.rotation.x = 0.55;
    dcm.add(new THREE.Mesh(box(0.30, 0.13, 0.10), S.gray));
    dcm.add(new THREE.Mesh(box(0.11, 0.06, 0.004).translate(-0.07, 0.015, 0.052), this.screenMat));
    dcm.add(new THREE.Mesh(box(0.03, 0.03, 0.004).translate(0.06, 0.02, 0.052), S.green));
    dcm.add(new THREE.Mesh(box(0.03, 0.03, 0.004).translate(0.1, 0.02, 0.052), S.red));
    for (let i = 0; i < 4; i++) dcm.add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8).rotateX(Math.PI / 2).translate(-0.1 + i * 0.05, -0.035, 0.055), S.dark));
    dcm.add(new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.03).translate(0.08, -0.035, 0.0525), this.ctx.materials.label('DCM · СКАФ-9', { width: 256, height: 64, font: 'bold 30px Arial' })));
    // SAFER hand controller stowed at the lower right of the chest
    const hcm = new THREE.Mesh(mergeGeometries([box(0.08, 0.06, 0.07), new THREE.CylinderGeometry(0.014, 0.012, 0.09, 8).translate(0.0, 0.07, 0)], false), S.dark);
    hcm.position.set(0.16, -0.41, -0.3); hcm.rotation.x = 0.4;
    this.hcm = hcm;
    this.group.add(torso, dcm, hcm);
  }

  _buildHelmet() {
    const S = this.mats;
    // visor frame: a ring just outside the view cone, visible in the corners; neck ring lower down
    // ring angle ~54 deg from the view axis: only the extreme corners of a 16:9 frame catch it
    const frame = new THREE.Mesh(torus(0.19, 0.014, 8, 48).translate(0, 0, -0.138), S.metal);
    const seal = new THREE.Mesh(torus(0.178, 0.007, 6, 48).translate(0, 0, -0.133), S.rubber);
    const neck = new THREE.Mesh(mergeGeometries([
      torus(0.2, 0.03, 8, 40).rotateX(Math.PI / 2).translate(0, -0.3, 0.02),
      new THREE.CylinderGeometry(0.2, 0.21, 0.04, 40, 1, true).translate(0, -0.33, 0.02),
    ], false), S.metal);
    const neckSeal = new THREE.Mesh(torus(0.2, 0.012, 6, 40).rotateX(Math.PI / 2).translate(0, -0.27, 0.02), S.rubber);
    // helmet shell bits at the corners (white hard upper visor housing)
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 16, 0, Math.PI * 2, 0, 0.9).translate(0, 0.02, 0.0), S.white);
    shell.material = S.white;
    this.helmet = new THREE.Group(); this.helmet.add(frame, seal, neck, neckSeal, shell);
    this.helmet.name = 'helmet';
    this.group.add(this.helmet);
  }

  _buildLamp() {
    // helmet-mounted lamps (two, on the sides of the visor housing); intensity toggled, never `visible` (avoids shader recompiles)
    this.lamp = new THREE.SpotLight(0xfff1dc, 0, 32, 0.6, 0.65, 1.6);
    this.lamp.position.set(0.14, 0.14, -0.05);
    this.lamp.target.position.set(0, -0.3, -10);
    this.lamp.castShadow = false;
    this.group.add(this.lamp, this.lamp.target);
    this.lampHousing = new THREE.Mesh(mergeGeometries([box(0.05, 0.04, 0.06).translate(0.14, 0.14, -0.04), box(0.05, 0.04, 0.06).translate(-0.14, 0.14, -0.04)], false), this.mats.dark);
    this.lampLens = new THREE.Mesh(mergeGeometries([box(0.04, 0.03, 0.004).translate(0.14, 0.14, -0.072), box(0.04, 0.03, 0.004).translate(-0.14, 0.14, -0.072)], false),
      new THREE.MeshStandardMaterial({ color: 0x202020, emissive: 0xfff1dc, emissiveIntensity: 0, roughness: 0.2 }));
    this.group.add(this.lampHousing, this.lampLens);
    this.lampOn = false;
  }

  _buildShadowProxy(scene) {
    // invisible to the camera, but casts the astronaut's shadow on the hull
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    mat.name = 'shadowProxy';
    const geo = mergeGeometries([
      new THREE.SphereGeometry(0.19, 12, 8),                                                 // helmet
      new THREE.CapsuleGeometry(0.27, 1.05, 4, 10).translate(0, -0.78, 0.04),                // torso + legs
      new THREE.BoxGeometry(0.6, 0.72, 0.3).translate(0, -0.3, 0.42),                        // PLSS backpack
      new THREE.CapsuleGeometry(0.07, 0.5, 3, 8).rotateZ(0.5).translate(-0.33, -0.52, -0.12),   // arms
      new THREE.CapsuleGeometry(0.07, 0.5, 3, 8).rotateZ(-0.5).translate(0.33, -0.52, -0.12),
    ], false);
    this.proxy = new THREE.Mesh(geo, mat);
    this.proxy.castShadow = true; this.proxy.receiveShadow = false;
    this.proxy.name = 'astronautShadowProxy';
    this.proxy.frustumCulled = false;
    scene.add(this.proxy);
  }

  // ---------------------------------------------------------------- runtime
  setVisible(v) { this.group.visible = v; }

  setLamp(on) {
    this.lampOn = on;
    this.lamp.intensity = on ? 90 : 0;
    this.lampLens.material.emissiveIntensity = on ? 6 : 0;
  }

  /**
   * dt; s = {thrustLocal, thrusting, boost, rotThrust, reach (world Vector3|null), grabbing, speed, position, quaternion}
   */
  update(dt, s) {
    this.time += dt;
    const t = this.time;
    // body proxy follows the (unlagged) body pose
    this.proxy.position.copy(s.position);
    this.proxy.quaternion.copy(s.quaternion);
    this.vibration = THREE.MathUtils.lerp(this.vibration, s.thrusting ? (s.boost ? 1 : 0.5) : 0, 1 - Math.exp(-dt / 0.08));

    // which arm reaches for the handrail (the one on its side)
    let reachArm = -1;
    if (s.reach) {
      _v.copy(s.reach); this.camera.worldToLocal(_v);
      reachArm = _v.x < 0 ? 0 : 1;
      this.reachArm = reachArm;
    }
    const k = 1 - Math.exp(-dt / 0.13);
    for (let i = 0; i < 2; i++) {
      const arm = this.arms[i];
      const side = arm.side;
      // desired wrist target
      _v2.copy(arm.rest);
      _v2.x += Math.sin(t * 0.9 + arm.phase) * 0.006; _v2.y += Math.sin(t * 1.3 + arm.phase * 0.5) * 0.008; _v2.z += Math.sin(t * 0.7 + arm.phase) * 0.006;
      _v3.copy(arm.backHint);
      let curl = 0.15;
      if (i === reachArm) {
        // reach: wrist sits HAND_LEN short of the grab point, along the shoulder->point line; clamp to arm length
        _v.copy(s.reach); this.camera.worldToLocal(_v);
        _v2.subVectors(_v, arm.shoulder);
        const d = _v2.length();
        const reach = Math.min(Math.max(d - HAND_LEN * 0.8, 0.12), L1 + L2 - 0.01);
        _v2.multiplyScalar(reach / Math.max(d, 1e-6)).add(arm.shoulder);
        if (_v2.z > -0.05) _v2.z = -0.05; // keep the hand in front of the visor
        curl = s.grabbing ? 1.0 : 0.3;
        _v3.set(side * 0.3, 0.6, -0.6).normalize();
      } else if (i === 1 && (s.thrusting || s.rotThrust > 0.25)) {
        // right hand on the SAFER hand controller
        _v2.set(0.15, -0.31, -0.33);
        _v3.set(0.9, 0.3, -0.2).normalize();
        curl = 0.8;
      } else {
        // inertia: hands lag behind acceleration
        if (s.thrusting) _v2.addScaledVector(s.thrustLocal, -0.03);
        if (s.speed > 0.01) _v2.y -= Math.min(s.speed, 2) * 0.004;
      }
      if (this.vibration > 0.01) { _v2.x += (Math.random() - 0.5) * 0.004 * this.vibration; _v2.y += (Math.random() - 0.5) * 0.004 * this.vibration; }
      arm.target.lerp(_v2, k);
      arm.backHintTarget.lerp(_v3, k).normalize();
      this.curlTarget[i] = curl;
      this.curl[i] += (curl - this.curl[i]) * (1 - Math.exp(-dt / 0.1));
      this._solveArm(arm, this.curl[i]);
    }
    // hand controller unit floats where the right hand grips it
    this.hcm.visible = true;
    // subtle helmet sway with angular motion is handled by the camera lag in Player
  }

  _solveArm(arm, curl) {
    const S = arm.shoulder, T = arm.target;
    const dir = _dir.subVectors(T, S);
    let d = dir.length();
    const dMax = L1 + L2 - 0.004, dMin = 0.1;
    if (d < 1e-6) { dir.set(0, 0, -1); d = 1e-6; }
    dir.multiplyScalar(1 / d);
    d = THREE.MathUtils.clamp(d, dMin, dMax);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    _v2.copy(arm.pole).addScaledVector(dir, -arm.pole.dot(dir));
    if (_v2.lengthSq() < 1e-8) _v2.set(arm.side, -1, 0).addScaledVector(dir, -dir.dot(_v2));
    _v2.normalize();
    // elbow
    _v3.copy(S).addScaledVector(dir, a).addScaledVector(_v2, h);
    // upper arm
    arm.upper.position.copy(S);
    _y.subVectors(_v3, S).normalize();
    basisQuat(_y, UP, arm.upper.quaternion);
    // forearm (Z hint = up so the mirror/checklist face the eyes)
    arm.fore.position.copy(_v3);
    const wrist = _v.copy(S).addScaledVector(dir, d);       // clamped wrist
    _y.subVectors(wrist, _v3).normalize();
    basisQuat(_y, UP, arm.fore.quaternion);
    // hand: fingers continue the forearm, bent slightly toward the palm side
    arm.hand.position.copy(wrist);
    _z.copy(arm.backHintTarget);
    _v2.copy(_y).addScaledVector(_z, -0.35 * (0.3 + curl)).normalize();
    basisQuat(_v2, _z, arm.hand.quaternion);
    // finger curl about the hand X axis (toward the palm, -Z)
    const f = arm.fingers;
    const angle = curl * 1.35;
    for (let i = 0; i < 4; i++) { _q.setFromAxisAngle(_x.set(1, 0, 0), -angle * (0.85 + i * 0.05)); f[i].quaternion.copy(f[i].userData.base).multiply(_q); }
    _q.setFromAxisAngle(_x.set(1, 0, 0), -angle * 0.6);
    f[4].quaternion.copy(f[4].userData.base).multiply(_q);
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.proxy.geometry.dispose();
  }
}
