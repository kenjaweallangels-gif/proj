import * as THREE from 'three';
import { EvaPhysics, BODY_RADIUS, NOZZLES } from './EvaPhysics.js';
import { CollisionWorld, closestOnSegment } from './Collision.js';
import { SuitModel } from './SuitModel.js';
import { Tether } from './Tether.js';

/**
 * First-person EVA astronaut (see docs/ARCHITECTURE.md, "Player contract").
 *  - zero-g 6-DOF rigid body with SAFER thrusters (EvaPhysics)
 *  - sphere-vs-collider collision with station, airlock interior and ships (Collision)
 *  - handrail grabbing / crawling / push-off, safety tether with reel, airlock exit/entry sequence
 *  - suit telemetry in `state` (read by the HUD and the audio module)
 *  - first-person suit model, shadow proxy, tether rope (SuitModel, Tether)
 * Physics runs in real time (dt / timescale) so time-lapse does not fling the astronaut.
 */

const RESTITUTION = 0.25;
const FRICTION = 0.4;
const HANDRAIL_RANGE = 1.0;
const CRAWL_SPEED = 0.5;
const PUSH_OFF_SPEED = 0.6;
const TETHER_MAX = 25;
const TETHER_REEL_SPEED = 1.0;
const DEPRESS_TIME = 8;
const REPRESS_TIME = 6;
const O2_DURATION = 6 * 3600;
const POWER_DURATION = 8 * 3600;
const HIP_OFFSET = new THREE.Vector3(0.16, -0.72, 0.12);

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _local = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  /** Controls summary for the HUD. */
  static CONTROLS = [
    { key: 'W / S', ru: 'тяга вперёд / назад' },
    { key: 'A / D', ru: 'тяга влево / вправо' },
    { key: 'Space / Ctrl', ru: 'тяга вверх / вниз' },
    { key: 'Shift', ru: 'форсаж ×3' },
    { key: 'Мышь', ru: 'обзор (рыскание / тангаж)' },
    { key: 'Q / E', ru: 'крен' },
    { key: 'X', ru: 'режим ориентации: стабилизация / свободный' },
    { key: 'V', ru: 'гашение вращения и скорости' },
    { key: 'G', ru: 'схватить / отпустить поручень' },
    { key: 'A/D, W/S (на поручне)', ru: 'перемещение вдоль поручня' },
    { key: 'Space (на поручне)', ru: 'оттолкнуться' },
    { key: 'R', ru: 'подтянуть трос (вкл/выкл)' },
    { key: 'Shift + R', ru: 'отцепить трос (опасно!)' },
    { key: 'E', ru: 'шлюз: выход / вход' },
    { key: 'L', ru: 'фонари шлема' },
    { key: 'M', ru: 'звук вкл/выкл' },
    { key: 'F', ru: 'режим наблюдателя' },
    { key: 'T', ru: 'ускорение времени' },
    { key: 'P', ru: 'пауза' },
  ];

  constructor(ctx) {
    this.ctx = ctx;
    this.camera = ctx.camera;
    this.body = new EvaPhysics();
    this.position = this.body.position;
    this.velocity = this.body.velocity;
    this.quaternion = this.body.quaternion;
    this.radius = BODY_RADIUS;
    this.active = true;
    this.collision = new CollisionWorld();
    this._colliderSig = -1;
    this._colliderTimer = 0;

    this.state = {
      mode: 'airlock', tetherLength: TETHER_MAX, tetherMax: TETHER_MAX, tetherAttached: true, tetherTaut: false, tetherDistance: 0, reeling: false,
      propellant: 1, o2: 1, power: 1, suitPressure: 1, airlockPressure: 1, heartRate: 64, suitTemp: 21.5,
      holding: null, nearHandrail: null, handrailDistance: Infinity,
      speedRelative: 0, angularSpeed: 0, distanceToStation: 0, distanceToAirlock: 0,
      rotationMode: 'aah', thrusting: false, boost: false, killing: false, lampOn: false,
      sequence: null, prompt: '', canEnterAirlock: false, impact: 0, contact: false,
    };

    // hatch / airlock refs (station exists before the player)
    const al = ctx.station?.airlock;
    this.airlock = al || null;
    this.tetherAnchor = al?.tetherAnchor || al?.standPosition || new THREE.Vector3(0, 0, 10);
    this.hatchCenter = al?.hatchCenter || al?.standPosition?.clone().addScaledVector(al.exitDirection, 3.3) || new THREE.Vector3(0, 0, 13);

    // visuals
    this.suit = new SuitModel(ctx, this.camera, ctx.nearScene);
    this.tether = new Tether(ctx, ctx.nearScene);
    this.tether.radius = 0.012;
    this.camQuat = new THREE.Quaternion();     // lagged view orientation
    this.camShake = new THREE.Vector3();
    this.hip = new THREE.Vector3();
    this.handrailPoint = new THREE.Vector3();   // grab point on the near / held rail
    this.holdOffset = new THREE.Vector3();      // player centre relative to the rail point while holding
    this.holdT = 0;
    this._seqTimer = 0;
    this._seqPromise = null;
    this._impactFlash = 0;
    this._exertion = 0;
    this._hrTarget = 64;
    this._reattachBlock = 0;
    this.lampAuto = true;

    this.setView('airlock');
    ctx.renderer.domElement.addEventListener('mousedown', () => { if (this.active && !ctx.isShot && ctx.mode === 'play') ctx.input.requestPointerLock(); });
    ctx.events?.on?.('mode', (m) => { if (m === 'play' && this.state.mode === 'observer') this.state.mode = this._modeBeforeObserver || 'eva'; });
  }

  async load() {}

  // ---------------------------------------------------------------- activation / views
  setActive(a) {
    if (a === this.active) return;
    this.active = a;
    this.suit.setVisible(a);
    if (!a) { this._modeBeforeObserver = this.state.mode; this.state.mode = 'observer'; }
    else { if (this.state.mode === 'observer') this.state.mode = this._modeBeforeObserver || 'eva'; this.camQuat.copy(this.quaternion); this.applyCamera(0); }
  }

  /** Poses for screenshots and the menu: 'airlock' | 'eva' | 'eva-far'. */
  setView(name) {
    const al = this.airlock;
    const st = this.state;
    const stand = al?.standPosition || new THREE.Vector3(0, 0, 10);
    this.body.velocity.set(0, 0, 0); this.body.omega.set(0, 0, 0);
    this._release();
    this._endSequence();
    this._killRequested = false;
    if (name === 'airlock') {
      _v.copy(stand);
      this.lookAlong(_v, al?.lookDirection || new THREE.Vector3(0, 0, 1));
      al?.hatch?.close?.();
      st.mode = 'airlock'; st.airlockPressure = 1;
      st.tetherAttached = true; st.tetherLength = TETHER_MAX; st.reeling = false;
    } else if (name === 'eva-far') {
      // ~60 m above/beside the station core, looking down at the hub and the ring
      _v.set(-16, 54, 36);
      this.lookAt(_v, _v2.set(-4, -2, 2));
      st.mode = 'eva'; st.airlockPressure = 0;
      // 60 m out is beyond the 25 m tether: this pose is an untethered free flight
      st.tetherAttached = false; st.reeling = false; this._reattachBlock = 2;
      this._openHatchNow();
    } else {
      // 'eva' (default): 12 m outside the hatch, looking back at the open hatch
      const exit = al?.exitDirection || new THREE.Vector3(0, 0, 1);
      _v.copy(this.hatchCenter).addScaledVector(exit, 12).add(_v2.set(1.8, 1.1, 0));
      this.lookAt(_v, _v2.copy(this.hatchCenter).add(_v3.set(0.3, 0.2, 0)));
      st.mode = 'eva'; st.airlockPressure = 0;
      st.tetherAttached = true; st.tetherLength = TETHER_MAX; st.reeling = false;
      this._openHatchNow();
    }
    this.body.reset(_v, _q);
    this.camQuat.copy(this.quaternion);
    this._refreshColliders(true);
    this.collision.resolve(this.position, this.velocity, this.radius, 0, 0);
    this.applyCamera(0);
    this._updateTether(0);
  }

  _openHatchNow() {
    const al = this.airlock;
    if (!al?.hatch) return;
    al.hatch.open();
    // screenshots cannot wait 4 s for the motor: fast-forward the hatch animation when driven by the tool
    if (this.ctx.isShot) { try { this.ctx.station.airlockPart?.update?.(10); } catch (_) { /* optional */ } }
  }

  /** Orientation (into _q) looking along dir from pos; roll-free w.r.t. world up. */
  lookAlong(pos, dir) {
    _v2.copy(dir).normalize();
    // Matrix4.lookAt(eye, target, up): the camera looks down its -Z toward target
    _m.lookAt(_v3.set(0, 0, 0), _v2, Math.abs(_v2.y) > 0.98 ? _v3.set(0, 0, 1) : UP);
    _q.setFromRotationMatrix(_m);
    return _q;
  }
  lookAt(pos, target) { return this.lookAlong(pos, _v3.subVectors(target, pos)); }

  // ---------------------------------------------------------------- main loop
  update(dt, ctx) {
    if (!this.active) { this._updateSuitConsumables(dt, false); return; }
    const inp = ctx.input;
    const st = this.state;
    const body = this.body;
    // real-time physics step (time-lapse must not fling the astronaut); clamp for robustness
    const scale = ctx.time?.scale || 1;
    let h = dt / scale;
    if (!(h > 0)) h = 0;
    h = Math.min(h, 1 / 20);

    this._colliderTimer += h;
    if (this._colliderTimer > 0.5) { this._colliderTimer = 0; this._refreshColliders(false); }

    // ----- hotkeys -----
    if (inp.wasPressed('KeyX')) { body.rotationMode = body.rotationMode === 'aah' ? 'free' : 'aah'; st.rotationMode = body.rotationMode; ctx.audio?.play?.('click'); }
    if (inp.wasPressed('KeyL')) { this.lampAuto = false; this.suit.setLamp(!this.suit.lampOn); ctx.audio?.play?.('click'); }
    if (inp.wasPressed('KeyE')) this._onInteract();
    if (inp.wasPressed('KeyR')) {
      if (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight')) {
        if (st.tetherAttached && st.mode === 'eva') { st.tetherAttached = false; st.reeling = false; this._reattachBlock = 2; ctx.audio?.play?.('detach'); }
      } else if (st.tetherAttached) { st.reeling = !st.reeling; ctx.audio?.play?.('click'); }
    }
    if (inp.wasPressed('KeyV') && !st.holding) { this._killRequested = !this._killRequested; }

    const allowMouse = inp.pointerLocked || ctx.isShot || !inp.wantPointerLock;
    const mdx = allowMouse ? inp.mouse.dx : 0, mdy = allowMouse ? inp.mouse.dy : 0;
    // Q/E roll; E doubles as the airlock interaction key when an airlock action is available
    const interactAvailable = st.mode === 'airlock' || st.canEnterAirlock || !!st.sequence;
    const rollAxis = -(inp.isDown('KeyQ') ? 1 : 0) + (inp.isDown('KeyE') && !interactAvailable ? 1 : 0);

    // ----- sequence (airlock) -----
    this._updateSequence(h);

    // ----- handrail proximity -----
    this._findHandrail();

    body.thrusting = false; body.rotThrust = 0; body.killing = false;
    if (st.holding) {
      this._updateHolding(h, inp, mdx, mdy, rollAxis, allowMouse);
    } else {
      // translation thrusters in the body frame: W/S -> -Z/+Z, A/D -> -X/+X, Space/Ctrl -> +Y/-Y
      _local.set(inp.axis('KeyA', 'KeyD'), (inp.isDown('Space') ? 1 : 0) - (inp.isDown('ControlLeft') || inp.isDown('ControlRight') ? 1 : 0), -inp.axis('KeyS', 'KeyW'));
      const boost = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
      const thrustInput = _local.lengthSq() > 0;
      if (thrustInput) this._killRequested = false;
      body.thrust(_local, boost, h, ctx.particles);
      body.rotate(mdx, mdy, rollAxis, h, allowMouse);
      if (this._killRequested) { if (!body.kill(h, ctx.particles)) this._killRequested = false; }
      // grab
      if (inp.wasPressed('KeyG') && st.nearHandrail) this._grab(st.nearHandrail);
      // tether
      this._tetherPhysics(h);
      body.integrate(h);
    }

    // ----- collision -----
    const c = this.collision.resolve(this.position, this.velocity, this.radius, RESTITUTION, FRICTION);
    st.contact = c.count > 0;
    st.distanceToStation = Math.max(0, c.minDistance);          // suit surface -> nearest collider surface
    st.colliderDistance = c.minDistance + this.radius;          // body centre -> nearest collider surface
    st.nearestCollider = c.nearest ? c.nearest.name || c.nearest.type : '';
    if (c.impact > 0.05) {
      // angular kick from an off-centre hit: tangential velocity x normal
      _v.crossVectors(c.normal, c.tangent).applyQuaternion(_q.copy(this.quaternion).invert());
      body.omega.addScaledVector(_v, 0.35);
      body.omega.x += (Math.random() - 0.5) * 0.1 * c.impact; body.omega.y += (Math.random() - 0.5) * 0.1 * c.impact;
      this._impactFlash = Math.min(1, c.impact * 0.6);
      ctx.audio?.play?.('impact', { strength: Math.min(1, c.impact / 2.5) });
      this._exertion = Math.min(1, this._exertion + c.impact * 0.2);
      if (st.holding && c.impact > 1.0) this._release();
    }
    if (st.contact && body.omega.lengthSq() > 1e-4) body.omega.multiplyScalar(Math.exp(-h * 2.5)); // scraping along the hull bleeds spin
    // while gripping a rail the hull may push the body: let the grip offset follow instead of fighting it
    if (st.holding && c.count > 0) {
      this.holdOffset.subVectors(this.position, this.handrailPoint);
      const d = this.holdOffset.length();
      if (d > 0.95) this.holdOffset.multiplyScalar(0.95 / d);
    }

    // ----- telemetry -----
    st.propellant = body.propellant;
    st.thrusting = body.thrusting; st.boost = body.boost && body.thrusting; st.killing = body.killing;
    st.rotationThrust = body.rotThrust;
    st.speedRelative = this.velocity.length();
    st.angularSpeed = body.omega.length();
    st.distanceToAirlock = this.position.distanceTo(this.airlock?.standPosition || this.hatchCenter);
    st.canEnterAirlock = st.mode === 'eva' && !st.sequence && st.distanceToAirlock < 1.5;
    st.impact = this._impactFlash; this._impactFlash *= Math.exp(-h * 4);
    this._updateSuitConsumables(dt, true);
    this._updatePrompt();
    this._autoLamp();

    // ----- visuals -----
    this.applyCamera(h);
    this.suit.update(h, {
      thrustLocal: body.thrustLocal, thrusting: body.thrusting, boost: body.boost, rotThrust: body.rotThrust,
      reach: st.holding || st.nearHandrail ? this.handrailPoint : null, grabbing: !!st.holding,
      speed: st.speedRelative, position: this.position, quaternion: this.quaternion,
    });
    this._updateTether(h);
  }

  // ---------------------------------------------------------------- camera
  applyCamera(h) {
    // slight inertia lag of the view (~0.07 s) + tiny thruster vibration; no head bob
    if (h > 0) this.camQuat.slerp(this.quaternion, 1 - Math.exp(-h / 0.07)); else this.camQuat.copy(this.quaternion);
    this.camera.position.copy(this.position);
    const vib = this.body.thrusting ? (this.body.boost ? 0.0022 : 0.0012) : (this.body.rotThrust > 0.3 ? 0.0006 : 0);
    if (vib > 0) {
      _e.set((Math.random() - 0.5) * vib, (Math.random() - 0.5) * vib, (Math.random() - 0.5) * vib * 0.5);
      _q.setFromEuler(_e);
      this.camera.quaternion.copy(this.camQuat).multiply(_q);
    } else this.camera.quaternion.copy(this.camQuat);
    if (this.camera.fov !== 70) { this.camera.fov = 70; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld(); // the suit IK converts world targets into camera space this frame
  }

  // ---------------------------------------------------------------- colliders
  /** Collect station + airlock + ship collider arrays; rebuilt (at ~1 Hz) only when a source array changes. */
  _refreshColliders(force) {
    const st = this.ctx.station, ships = this.ctx.ships?.ships;
    this._colliderSources = this._colliderSources || [];
    const prev = this._colliderSources;
    let changed = force || prev.length !== 2 + (ships ? ships.length : 0);
    if (!changed) {
      changed = prev[0] !== st?.colliders || prev[1] !== st?.airlock?.interiorColliders || prev[0]?.length !== this._colliderCount0;
      if (!changed && ships) for (let i = 0; i < ships.length; i++) { const c = ships[i].colliders; if (prev[2 + i] !== c || (c ? c.length : 0) !== (this._shipCounts?.[i] ?? -1)) { changed = true; break; } }
    }
    if (!changed) return;
    prev.length = 0;
    prev.push(st?.colliders, st?.airlock?.interiorColliders);
    this._colliderCount0 = st?.colliders?.length;
    this._shipCounts = this._shipCounts || [];
    this._shipCounts.length = 0;
    if (ships) for (const s of ships) { prev.push(s.colliders); this._shipCounts.push(s.colliders ? s.colliders.length : 0); }
    this.collision.setColliders(...prev);
  }

  // ---------------------------------------------------------------- handrails
  _findHandrail() {
    const st = this.state;
    if (st.holding) { st.nearHandrail = st.holding; st.handrailDistance = 0; return; }
    const rails = this.ctx.station?.handrails;
    st.nearHandrail = null; st.handrailDistance = Infinity;
    if (!rails) return;
    let best = HANDRAIL_RANGE + this.radius, bestRail = null;
    for (let i = 0, n = rails.length; i < n; i++) {
      const r = rails[i];
      // cheap reject on the segment midpoint (bounding sphere of the rail + grab range)
      const mx = (r.a.x + r.b.x) * 0.5 - this.position.x, my = (r.a.y + r.b.y) * 0.5 - this.position.y, mz = (r.a.z + r.b.z) * 0.5 - this.position.z;
      const hx = (r.b.x - r.a.x) * 0.5, hy = (r.b.y - r.a.y) * 0.5, hz = (r.b.z - r.a.z) * 0.5;
      const reach = Math.sqrt(hx * hx + hy * hy + hz * hz) + best + 0.2;
      if (mx * mx + my * my + mz * mz > reach * reach) continue;
      closestOnSegment(r.a, r.b, this.position, _v);
      const d = _v.distanceTo(this.position) - r.radius;
      if (d < best) { best = d; bestRail = r; _v2.copy(_v); }
    }
    if (bestRail) { st.nearHandrail = bestRail; st.handrailDistance = Math.max(0, best - this.radius); this.handrailPoint.copy(_v2); }
  }

  _grab(rail) {
    const st = this.state;
    st.holding = rail;
    this.holdT = closestOnSegment(rail.a, rail.b, this.position, this.handrailPoint);
    this.holdOffset.subVectors(this.position, this.handrailPoint);
    // keep the body within arm's reach of the rail
    const d = this.holdOffset.length();
    if (d > 0.95) this.holdOffset.multiplyScalar(0.95 / d);
    if (d < 0.5) this.holdOffset.setLength(0.5);
    this.velocity.set(0, 0, 0);
    this.body.omega.set(0, 0, 0);
    this._killRequested = false;
    this.ctx.audio?.play?.('grab');
    this._exertion = Math.min(1, this._exertion + 0.15);
  }

  _release(impulseDir = null, speed = 0) {
    const st = this.state;
    if (!st.holding) return;
    st.holding = null;
    if (impulseDir) { this.velocity.addScaledVector(impulseDir, speed); this.ctx.audio?.play?.('release'); }
  }

  _updateHolding(h, inp, mdx, mdy, rollAxis, allowMouse) {
    const st = this.state, rail = st.holding;
    // crawl along the rail: A/D (or W/S) move the grab point; stop at the ends
    const along = inp.axis('KeyA', 'KeyD') + inp.axis('KeyS', 'KeyW');
    const len = rail.a.distanceTo(rail.b);
    if (along !== 0 && len > 1e-4) {
      // crawl direction relative to the view: moving "right" means toward the rail end that is on the right
      _v.subVectors(rail.b, rail.a).multiplyScalar(1 / len);
      _v2.set(1, 0, 0).applyQuaternion(this.quaternion);
      const sign = _v.dot(_v2) >= 0 ? 1 : -1;
      this.holdT = THREE.MathUtils.clamp(this.holdT + (along * sign * CRAWL_SPEED * h) / len, 0, 1);
      this._exertion = Math.min(1, this._exertion + 0.3 * h);
      this.ctx.audio?.setParam?.('crawl', 1);
    } else this.ctx.audio?.setParam?.('crawl', 0);
    this.handrailPoint.copy(rail.a).lerp(rail.b, this.holdT);
    this.position.copy(this.handrailPoint).add(this.holdOffset);
    this.velocity.set(0, 0, 0);
    // look around freely (attitude hold while gripping; the hand keeps the body in place)
    this.body.rotationMode === 'aah' ? this.body.rotate(mdx, mdy, rollAxis, h, allowMouse) : this.body.rotate(mdx, mdy, rollAxis, h, allowMouse);
    this.body.omega.multiplyScalar(Math.exp(-h / 0.12));
    this.body.integrate(h);
    // keep the arm reachable: the body may rotate but stays at the hold offset (rotation about the body centre)
    if (inp.wasPressed('Space')) {
      _v.set(0, 0, -1).applyQuaternion(this.quaternion);
      this._release(_v, PUSH_OFF_SPEED);
      this._exertion = Math.min(1, this._exertion + 0.2);
    } else if (inp.wasPressed('KeyG')) this._release();
    this.state.tetherLength = Math.max(this.state.tetherLength, 0);
    this._tetherPhysics(h, true);
  }

  // ---------------------------------------------------------------- tether
  _tetherPhysics(h, holding = false) {
    const st = this.state;
    this.hip.copy(HIP_OFFSET).applyQuaternion(this.quaternion).add(this.position);
    const d = this.hip.distanceTo(this.tetherAnchor);
    st.tetherDistance = d;
    if (!st.tetherAttached) {
      st.tetherTaut = false;
      if (this._reattachBlock > 0) this._reattachBlock -= h;
      else if (d < 3) { st.tetherAttached = true; st.tetherLength = TETHER_MAX; this.ctx.audio?.play?.('grab'); }
      return;
    }
    if (st.reeling) {
      st.tetherLength = Math.max(1.2, st.tetherLength - TETHER_REEL_SPEED * h);
      if (st.tetherLength <= 1.2 && d < 2.5) st.reeling = false;
    } else if (st.tetherLength < TETHER_MAX && !st.sequence) {
      // the reel pays out freely when the astronaut moves away
      st.tetherLength = Math.min(TETHER_MAX, Math.max(st.tetherLength, Math.min(d, TETHER_MAX)));
    }
    if (holding) { st.tetherTaut = false; return; }
    this.body.tether(this.tetherAnchor, st.tetherLength, HIP_OFFSET, h);
    st.tetherTaut = this.body.tetherTaut;
    if (st.tetherTaut) this._exertion = Math.min(1, this._exertion + 0.4 * h);
  }

  _updateTether(h) {
    const st = this.state;
    const show = st.tetherAttached && this.active;
    this.tether.setVisible(show);
    if (!show) return;
    this.hip.copy(HIP_OFFSET).applyQuaternion(this.quaternion).add(this.position);
    this.tether.update(this.tetherAnchor, this.hip, st.tetherLength, h);
  }

  // ---------------------------------------------------------------- airlock sequence
  _onInteract() {
    const st = this.state, al = this.airlock;
    if (!al || st.sequence) return;
    if (st.mode === 'airlock') this._startSequence('depress');
    else if (st.mode === 'eva' && st.distanceToAirlock < 1.5) this._startSequence('close');
  }

  _startSequence(name) {
    const st = this.state, al = this.airlock;
    this._seqTimer = 0;
    st.sequence = { name, progress: 0 };
    const audio = this.ctx.audio;
    if (name === 'depress') { audio?.play?.('depress', { duration: DEPRESS_TIME }); }
    else if (name === 'hatchOpen') { audio?.play?.('hatchMotor', { duration: 4 }); this._seqPromise = al.hatch.open().then(() => { if (st.sequence?.name === 'hatchOpen') { audio?.play?.('clunk'); st.mode = 'eva'; this._endSequence(); } }); }
    else if (name === 'close') { audio?.play?.('hatchMotor', { duration: 4 }); this._release(); this._seqPromise = al.hatch.close().then(() => { if (st.sequence?.name === 'close') { audio?.play?.('clunk'); this._startSequence('repress'); } }); }
    else if (name === 'repress') { audio?.play?.('repress', { duration: REPRESS_TIME }); }
  }

  _endSequence() { this.state.sequence = null; this._seqPromise = null; }

  _updateSequence(h) {
    const st = this.state, seq = st.sequence, al = this.airlock;
    if (!seq) return;
    this._seqTimer += h;
    if (seq.name === 'depress') {
      seq.progress = Math.min(1, this._seqTimer / DEPRESS_TIME);
      st.airlockPressure = 1 - seq.progress;
      if (seq.progress >= 1) { st.airlockPressure = 0; this._startSequence('hatchOpen'); }
    } else if (seq.name === 'hatchOpen' || seq.name === 'close') {
      const p = al?.hatch?.progress ?? 0;
      seq.progress = seq.name === 'hatchOpen' ? p : 1 - p;
      // failsafe if the promise never resolves
      if (this._seqTimer > 12) { if (seq.name === 'hatchOpen') { st.mode = 'eva'; this._endSequence(); } else this._startSequence('repress'); }
    } else if (seq.name === 'repress') {
      seq.progress = Math.min(1, this._seqTimer / REPRESS_TIME);
      st.airlockPressure = seq.progress;
      if (seq.progress >= 1) {
        st.airlockPressure = 1; st.mode = 'airlock';
        st.propellant = this.body.propellant = 1; st.o2 = 1; st.power = Math.max(st.power, 0.95);
        st.tetherLength = TETHER_MAX; st.reeling = false; st.tetherAttached = true;
        this._endSequence();
        this.ctx.audio?.play?.('click');
      }
    }
  }

  // ---------------------------------------------------------------- suit
  _updateSuitConsumables(dt, active) {
    const st = this.state;
    const simDt = Math.min(Math.max(dt, 0), 30);
    const body = this.body;
    const effort = this._exertion;
    st.o2 = Math.max(0, st.o2 - (simDt / O2_DURATION) * (1 + 1.5 * effort));
    st.power = Math.max(0, st.power - (simDt / POWER_DURATION) * (this.suit.lampOn ? 1.6 : 1));
    // heart rate: exertion from thrust use, speed, taut tether, contacts
    const hrTarget = 62 + 35 * effort + 8 * Math.min(st.speedRelative, 3) + (st.tetherTaut ? 22 : 0) + (st.killing ? 6 : 0) + (st.o2 < 0.1 ? 25 : 0);
    const k = 1 - Math.exp(-Math.min(simDt, 1) / 6);
    st.heartRate = THREE.MathUtils.clamp(st.heartRate + (hrTarget - st.heartRate) * k, 60, 140);
    if (active) {
      const use = (body.thrusting ? (body.boost ? 0.9 : 0.5) : 0) + body.rotThrust * 0.3;
      this._exertion = THREE.MathUtils.clamp(this._exertion + (use * 0.25 - 0.08) * Math.min(dt / (this.ctx.time?.scale || 1), 0.1), 0, 1);
    } else this._exertion = Math.max(0, this._exertion - 0.05 * Math.min(simDt, 1));
    // suit skin temperature follows sun exposure slowly; the cooling loop keeps the inside near 21 C
    const sun = this.ctx.orbit?.sunVisible ?? 1;
    const tTarget = st.mode === 'airlock' ? 21.5 : 20.5 + 4.5 * sun - 1.5 * (1 - sun);
    st.suitTemp += (tTarget - st.suitTemp) * (1 - Math.exp(-Math.min(simDt, 5) / 90));
    st.suitPressure = 1;
  }

  _autoLamp() {
    if (!this.lampAuto) return;
    const sun = this.ctx.orbit?.sunVisible ?? 1;
    const want = this.state.mode === 'eva' && sun < 0.25;
    if (want !== this.suit.lampOn) this.suit.setLamp(want);
    this.state.lampOn = this.suit.lampOn;
  }

  _updatePrompt() {
    const st = this.state;
    let p = '';
    if (st.sequence) {
      const n = st.sequence.name, pct = Math.round(st.sequence.progress * 100);
      p = n === 'depress' ? `Сброс давления шлюза… ${pct}%` : n === 'hatchOpen' ? `Открытие люка… ${pct}%` : n === 'close' ? `Закрытие люка… ${pct}%` : `Наддув шлюза… ${pct}%`;
    } else if (st.mode === 'airlock') p = 'E — начать выход в открытый космос';
    else if (st.holding) p = 'A/D — вдоль поручня · Space — оттолкнуться · G — отпустить';
    else if (st.canEnterAirlock) p = 'E — войти в шлюз и закрыть люк';
    else if (st.nearHandrail) p = 'G — схватить поручень';
    else if (!st.tetherAttached) p = 'ТРОС ОТЦЕПЛЕН — вернитесь к шлюзу (3 м) для зацепа';
    else if (st.tetherTaut) p = 'Трос натянут — R: подтянуться';
    st.prompt = p;
  }

  dispose() {
    this.suit.dispose();
  }
}
