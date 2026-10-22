import * as THREE from 'three';

/** STUB — replaced by the real Sky module (star catalogue + Milky Way). */
export class Sky {
  constructor(ctx) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    const n = 3000, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(a) * 1.5e6; pos[i * 3 + 1] = r * Math.sin(a) * 1.5e6; pos[i * 3 + 2] = u * 1.5e6;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false }));
    this.group.add(this.points);
    ctx.farScene.add(this.group);
  }
  update(dt, ctx) { this.group.quaternion.copy(ctx.orbit.skyQuat); }
}
