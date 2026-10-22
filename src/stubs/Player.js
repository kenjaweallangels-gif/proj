import * as THREE from 'three';

/** STUB — simple pointer-lock fly camera standing in for the real EVA player. */
export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.camera = ctx.camera;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.state = { mode: 'airlock', tetherLength: 0, tetherAttached: true, propellant: 1, o2: 1, power: 1, suitPressure: 1, heartRate: 70, holding: null, speedRelative: 0, distanceToStation: 0 };
    this.active = true;
    this.yaw = 0; this.pitch = 0;
    this.setView('airlock');
    ctx.renderer.domElement.addEventListener('mousedown', () => { if (this.active && !ctx.isShot) ctx.input.requestPointerLock(); });
  }
  setActive(a) { this.active = a; }
  setView(name) {
    const al = this.ctx.station.airlock;
    if (name === 'airlock') { this.position.copy(al.standPosition); this.lookAlong(al.lookDirection); }
    else if (name === 'eva') { this.position.copy(al.standPosition).addScaledVector(al.exitDirection, 14).add(new THREE.Vector3(6, 3, 0)); this.lookAt(new THREE.Vector3(0, 0, 0)); }
    else if (name === 'eva-far') { this.position.set(60, 25, 90); this.lookAt(new THREE.Vector3(0, 0, 0)); }
    this.velocity.set(0, 0, 0);
    this.applyPose();
  }
  lookAt(target) { const d = target.clone().sub(this.position).normalize(); this.lookAlong(d); }
  lookAlong(d) { this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)); }
  applyPose() {
    this.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.camera.position.copy(this.position);
    this.camera.quaternion.copy(this.quaternion);
  }
  update(dt, ctx) {
    if (!this.active) return;
    const inp = ctx.input;
    if (inp.pointerLocked || ctx.isShot) { this.yaw -= inp.mouse.dx * 0.0022; this.pitch = THREE.MathUtils.clamp(this.pitch - inp.mouse.dy * 0.0022, -1.5, 1.5); }
    const f = inp.axis('KeyS', 'KeyW'), r = inp.axis('KeyA', 'KeyD'), u = inp.axis('ControlLeft', 'Space');
    const dir = new THREE.Vector3(r, u, -f);
    if (dir.lengthSq() > 0) { dir.normalize().applyQuaternion(this.quaternion).multiplyScalar(6 * dt); this.velocity.add(dir); }
    this.velocity.multiplyScalar(Math.exp(-dt * 1.5));
    this.position.addScaledVector(this.velocity, dt);
    this.state.speedRelative = this.velocity.length();
    this.state.distanceToStation = this.position.length();
    this.applyPose();
  }
}
