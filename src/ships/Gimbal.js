import * as THREE from 'three';
import { ShipBuilder, V, Y_AXIS, Z_AXIS, cyl, torus, flipInside } from './ShipBuilder.js';

const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();

/**
 * Two-axis antenna gimbal: `base` (yaw about local Y) -> `pitch` (about local X) -> dish looking along +Z.
 * The static pedestal and mast are merged into the ship's own builder (`b`); only the dish itself is a
 * separate (single, shared-material) mesh. Place `base` as a direct child of the ship group.
 * Dish direction in base frame for (yaw, pitch): (cos p sin y, -sin p, cos p cos y).
 */
export class Gimbal {
  constructor(b, { radius = 0.6, mastLength = 0.5, position = V(0, 0, 0), up = Y_AXIS, maxRate = 0.08 } = {}) {
    this.base = new THREE.Group();
    this.base.position.copy(position);
    this.base.quaternion.setFromUnitVectors(Y_AXIS, up.clone().normalize());
    this.yaw = new THREE.Group();
    this.pitch = new THREE.Group();
    this.pitch.position.set(0, mastLength, 0);
    this.base.add(this.yaw); this.yaw.add(this.pitch);
    this.yawAngle = 0; this.pitchAngle = 0; this.maxRate = maxRate;
    this.radius = radius;
    this._invBase = this.base.quaternion.clone().invert();

    // static pedestal + mast in the ship frame
    const upN = up.clone().normalize();
    b.add('metalDark', cyl(position.clone().addScaledVector(upN, 0.08), upN, 0.12, 0.16, 12, { uv: false }), false);
    b.add('metalDark', cyl(position.clone().addScaledVector(upN, mastLength / 2), upN, 0.05, mastLength, 8, { uv: false }), false);

    // dish: shallow spherical cap (both faces), rim ring, hub, feed on a tripod — one shared-material mesh
    const bp = new ShipBuilder(b.materials);
    const f = radius * 0.7;
    const Rs = radius * 1.25, th = Math.asin(1 / 1.25);
    const capGeo = () => { const c = new THREE.SphereGeometry(Rs, 32, 8, 0, Math.PI * 2, 0, th); c.scale(1, 0.55, 1); c.rotateX(-Math.PI / 2); c.translate(0, 0, 0.55 * Rs * Math.cos(th)); return c; };
    bp.add('antennaWhite', capGeo(), false);                 // rim at z=0, concave side -> +Z
    bp.add('antennaWhite', flipInside(capGeo()), false, 0xc8c9c6);
    bp.add('metalDark', torus(V(0, 0, 0), Z_AXIS, radius, 0.025, 5, 40), false);
    bp.add('metalDark', cyl(V(0, 0, -0.1), Z_AXIS, 0.08, 0.2, 10, { uv: false }), false);
    bp.add('metalDark', cyl(V(0, 0, f), Z_AXIS, 0.05, 0.2, 8, { rTop: 0.1, uv: false }), false);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const p0 = V(Math.cos(a) * radius * 0.8, Math.sin(a) * radius * 0.8, -0.05), p1 = V(0, 0, f - 0.05);
      const d = p1.clone().sub(p0); const len = d.length();
      bp.add('metalDark', cyl(p0.clone().lerp(p1, 0.5), d.normalize(), 0.012, len, 5, { uv: false }), false);
    }
    bp.build(this.pitch, 'dish', { shadows: false, receive: false });
  }

  /** Slew toward a direction given in the ship's local frame. */
  trackLocal(dirLocal, dt) {
    _d.copy(dirLocal).applyQuaternion(this._invBase).normalize();
    const yaw = Math.atan2(_d.x, _d.z);
    const pitch = THREE.MathUtils.clamp(-Math.asin(THREE.MathUtils.clamp(_d.y, -1, 1)), -1.35, 1.35);
    const step = this.maxRate * dt;
    let dy = yaw - this.yawAngle; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yawAngle += THREE.MathUtils.clamp(dy, -step, step);
    this.pitchAngle += THREE.MathUtils.clamp(pitch - this.pitchAngle, -step, step);
    this.yaw.rotation.y = this.yawAngle;
    this.pitch.rotation.x = this.pitchAngle;
  }

  /** Track a world direction given the ship's world quaternion. */
  trackWorld(dirWorld, shipQuat, dt) {
    _q.copy(shipQuat).invert();
    _d.copy(dirWorld).applyQuaternion(_q);
    this.trackLocal(_d, dt);
  }

  snapWorld(dirWorld, shipQuat) { this.trackWorld(dirWorld, shipQuat, 1e6); }
}
