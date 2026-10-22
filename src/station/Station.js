import * as THREE from 'three';

/** STUB — replaced by the real Station module. Implements the contract in docs/ARCHITECTURE.md. */
export class Station extends THREE.Group {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    const m = ctx.materials;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 48, 48), m.get('hullWhite'));
    core.rotation.z = Math.PI / 2; core.castShadow = core.receiveShadow = true;
    this.add(core);
    const node = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), m.get('mliGold'));
    node.position.set(0, 0, 0); node.castShadow = node.receiveShadow = true;
    this.add(node);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 30), m.get('solarCell'));
    panel.position.set(0, 10, 0); panel.castShadow = panel.receiveShadow = true;
    this.add(panel);

    this.colliders = [
      { type: 'capsule', a: new THREE.Vector3(-24, 0, 0), b: new THREE.Vector3(24, 0, 0), radius: 4.2, name: 'core' },
      { type: 'box', center: new THREE.Vector3(0, 0, 0), halfSize: new THREE.Vector3(5, 5, 5), quaternion: new THREE.Quaternion(), name: 'node' },
    ];
    this.handrails = [{ a: new THREE.Vector3(-10, 4.4, 1), b: new THREE.Vector3(10, 4.4, 1), radius: 0.03 }];
    this.dockingPorts = [
      { id: 'fwd', name: 'Forward', position: new THREE.Vector3(24, 0, 0), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)), size: 'large', occupant: null, approachAxis: new THREE.Vector3(1, 0, 0) },
      { id: 'aft', name: 'Aft', position: new THREE.Vector3(-24, 0, 0), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)), size: 'large', occupant: null, approachAxis: new THREE.Vector3(-1, 0, 0) },
    ];
    this.airlock = {
      standPosition: new THREE.Vector3(0, 0, 5.5), exitDirection: new THREE.Vector3(0, 0, 1), lookDirection: new THREE.Vector3(0, 0, 1),
      hatch: { isOpen: false, progress: 0, open: async () => { this.airlock.hatch.isOpen = true; this.airlock.hatch.progress = 1; }, close: async () => { this.airlock.hatch.isOpen = false; this.airlock.hatch.progress = 0; } },
      interiorColliders: [],
    };
    this.ring = { group: new THREE.Group(), angularSpeed: 0.3, radius: 40 };
    this.viewpoints = { docking: { position: [60, 20, 40], target: [24, 0, 0] }, ring: { position: [0, 60, 90], target: [0, 0, 0] }, airlockExt: { position: [10, 6, 25], target: [0, 0, 6] } };
  }
  update(dt, ctx) {}
}
