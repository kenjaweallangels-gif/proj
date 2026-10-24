import * as THREE from 'three';
import { LAYERS } from '../core/constants.js';
import { AstronautBody } from './suit/Body.js';
import { Animator, readTargets } from './suit/Animator.js';
import { SuitAssets } from './suit/Assets.js';
import { SuitShow } from './suit/Show.js';
import { loadCrewData } from './suit/CrewMH.js';

/**
 * The player's own body, seen in first person and from the observer camera.
 *
 * Two full-body skinned figures share one skeleton layout (src/player/suit/): the Orlan-MKS spacesuit
 * (suited: airlock / EVA) and the crew member in station clothing (IVA, no suit). The active one is
 * placed every frame so its eyes are at the camera; the Animator turns the head within the neck (or
 * helmet) range, lets the torso follow, and solves IK for hands (handrails, the propulsion hand controller,
 * targets from the movement code) and feet. Everything is on LAYERS.FIRST_PERSON (drawn by the player
 * camera also inside windowless compartments, never carved by the interior patch) and casts the
 * astronaut's shadow. In first person the crew head collapses (bone scale) and the suit shows its helmet
 * liner from inside; from the observer camera the full figure is shown.
 *
 * API used by Player: setVisible(v), setLamp(on), lampOn, update(dt, s), load(), dispose().
 * Which suit is worn: `ctx.player._wornSuit` (the airlock mount object, variant 'blue' | 'red').
 */

const LAMP_INTENSITY = 9; // cd (physical light units; the Sun is 3.2 lux-equivalent in this scene)
const _v = new THREE.Vector3();
const _up = new THREE.Vector3();

export class SuitModel {
  constructor(ctx, camera, scene) {
    this.ctx = ctx;
    this.camera = camera;
    this.scene = scene;
    this.assets = SuitAssets.get(ctx);
    // camera-attached group: helmet lamp light (the lamp housings are part of the suit model)
    this.group = new THREE.Group();
    this.group.name = 'suitFirstPerson';
    this.group.userData.noCollide = true;
    camera.add(this.group);
    this.lamp = new THREE.SpotLight(0xfff1dc, 0, 40, 0.62, 0.65, 2);
    this.lamp.position.set(0.14, 0.16, -0.2);
    this.lamp.target.position.set(0, -0.8, -10);
    this.lamp.castShadow = false;
    this.group.add(this.lamp, this.lamp.target);
    this.lampOn = false;

    const FP = LAYERS.FIRST_PERSON;
    this.suits = {};
    for (const variant of ['blue', 'red']) {
      const b = new AstronautBody(ctx, { outfit: 'orlan', variant, fp: true, upm: true, layer: FP, name: `playerSuit:${variant}`, levels: [1.0] });
      b.group.visible = false;
      scene.add(b.group);
      this.suits[variant] = { body: b, anim: new Animator(b, 'suit') };
    }
    this.crew = null;             // built in load() (MakeHuman-based body data)
    this.crewAnim = null;
    this._crewLoad = loadCrewData(ctx);
    // lamp lens glow (own material instances so the airlock suits keep theirs)
    this.glowMat = this.assets.get('glow').clone();
    for (const v of Object.values(this.suits)) for (const m of v.body.lampMeshes) m.material = this.glowMat;
    this._setGlow(false);

    this.visibleFlag = true;
    this.active = null;
    this.mode = '';
    this.time = 0;
    this.show = null;
    this._apply();
  }

  async load() {
    await this._crewLoad;
    this.crew = new AstronautBody(this.ctx, { outfit: 'crew', layer: LAYERS.FIRST_PERSON, name: 'playerCrew', levels: [1.0] });
    this.crew.group.visible = false;
    this.scene.add(this.crew.group);
    this.crewAnim = new Animator(this.crew, 'crew');
    if (this.ctx.params?.get?.('suitshow')) this.show = new SuitShow(this.ctx, this.scene);
    await this.assets.ready();
    this._apply();
  }

  /** The body figure for the current state: worn suit variant or the crew outfit. */
  _current() {
    const p = this.ctx.player, st = p?.state;
    if (!st || st.suited) {
      const v = p?._wornSuit?.variant || (p?._wornSuit?.name?.includes('7') ? 'red' : 'blue');
      return this.suits[v] || this.suits.blue;
    }
    return this.crew ? { body: this.crew, anim: this.crewAnim } : this.suits.blue;
  }

  /** Player calls setVisible(active && suited); the figure itself follows the player state (see _apply). */
  setVisible(v) { this.visibleFlag = v; this._apply(); }

  _apply() {
    const p = this.ctx.player;
    const active = p ? p.active !== false : true;
    const cur = this._current();
    for (const x of [...Object.values(this.suits), { body: this.crew }]) if (x.body) x.body.group.visible = x.body === cur.body;
    const fp = active && this.ctx.mode !== 'observer';
    this.fp = fp;
    // first person: helmet liner on (suit), crew head collapsed; observer: full figure
    for (const v of Object.values(this.suits)) for (const m of v.body.helmetIn) m.visible = fp;
    this.crew?.rig.bone('head').scale.setScalar(fp ? 0.001 : 1);
    this.group.visible = !!p?.state?.suited || !p;
    this.active = cur;
  }

  setLamp(on) {
    this.lampOn = on;
    this.lamp.intensity = on ? LAMP_INTENSITY : 0;
    this._setGlow(on);
  }

  _setGlow(on) { this.glowMat.color.setScalar(on ? 1 : 0.12); }

  /**
   * dt; s = {thrustLocal, thrusting, boost, rotThrust, reach (world Vector3|null), grabbing, speed, position, quaternion}
   */
  update(dt, s) {
    this.time += dt;
    this._apply();
    const p = this.ctx.player, st = p?.state || {};
    const cur = this.active;
    // spin gravity: "up" points to the ring axis (world X axis through the hub)
    let gravityUp = null;
    const iva = p?.iva;
    if (iva && iva.frame === 'ring' && (st.gravity || 0) > 0.03 && st.mode !== 'eva') {
      _up.set(0, -s.position.y, -s.position.z);
      if (_up.lengthSq() > 1e-6) gravityUp = _up.normalize();
    }
    cur.anim.update({
      camera: this.camera, dt, gravityUp, gravity: st.gravity || 0, speed: s.speed || 0,
      thrusting: s.thrusting, boost: s.boost, rotThrust: s.rotThrust, thrustLocal: s.thrustLocal,
      reach: s.reach, grabbing: s.grabbing, targets: readTargets(p), suited: !!st.suited, fp: this.fp,
    });
    if (this.show) this.show.update(dt);
  }

  dispose() {
    for (const v of Object.values(this.suits)) { v.body.group.removeFromParent(); v.body.dispose(); }
    if (this.crew) { this.crew.group.removeFromParent(); this.crew.dispose(); }
    this.group.removeFromParent();
    void _v;
  }
}
