import * as THREE from 'three';
import { EARTH_RADIUS_KM } from '../core/constants.js';

/** STUB — replaced by the real Earth module (shaders, atmosphere, clouds, night lights, Sun, Moon). */
export class Earth {
  constructor(ctx) {
    this.ctx = ctx;
    const o = ctx.orbit;
    this.group = new THREE.Group();
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS_KM, 96, 64), new THREE.MeshStandardMaterial({ color: 0x2a5fb0, roughness: 0.9 }));
    this.earth.position.copy(o.earthCenterFar);
    this.group.add(this.earth);
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctx.textures.glow({ size: 128, inner: 0.2, falloff: 2 }), color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.sun.scale.setScalar(60000);
    this.group.add(this.sun);
    ctx.farScene.add(this.group);
  }
  update(dt, ctx) {
    const o = ctx.orbit;
    this.earth.quaternion.copy(o.earthQuat);
    this.sun.position.copy(o.sunDir).multiplyScalar(1.0e6);
  }
}
