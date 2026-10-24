import * as THREE from 'three';
import { LAYERS } from '../../core/constants.js';
import { AstronautBody } from './Body.js';

/**
 * ?suitshow=1 — debug line-up of astronaut figures 75 m above the station, front-lit by the Sun, with
 * observer views (App.setView via station.viewpoints):
 *   suit-front, suit-back, suit-side, suit-detail (helmet + chest panel), suit-hand, suit-boot,
 *   suit-mount (the open backpack door), suit-lod1 / suit-lod2 (distance LODs),
 *   crew-front, crew-side, crew-face, crew-hand, crew-nbp (zero-g neutral posture), lineup.
 */
export class SuitShow {
  constructor(ctx, scene) {
    this.ctx = ctx;
    const sun = ctx.orbit?.sunDir?.clone() || new THREE.Vector3(1, 0.3, 0.2);
    const up = new THREE.Vector3(0, 1, 0);
    const F = sun.clone().setY(0);
    if (F.lengthSq() < 0.05) F.set(1, 0, 0);
    F.normalize();
    const side = new THREE.Vector3().crossVectors(up, F).normalize();
    const C = new THREE.Vector3(0, 75, 0);
    const P = (i) => C.clone().addScaledVector(side, (i - 1.5) * 1.9);
    const face = (g, dir) => { g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); };
    const FP = LAYERS.FIRST_PERSON;
    this.bodies = [];
    const add = (opts, i, dir, pose, params) => {
      const b = new AstronautBody(ctx, { ...opts, layer: FP });
      b.group.position.copy(P(i));
      face(b.group, dir);
      b.pose(pose, params);
      scene.add(b.group);
      this.bodies.push(b);
      return b;
    };
    const suit = add({ outfit: 'orlan', variant: 'blue', upm: true, name: 'show:orlan' }, 0, F, 'eva');
    const mount = add({ outfit: 'orlan', variant: 'red', hatchInterior: true, name: 'show:mount' }, 1, F.clone().negate(), 'mount', { hatch: 105 });
    const crew = add({ outfit: 'crew', name: 'show:crew' }, 2, F, 'stand');
    const nbp = add({ outfit: 'crew', name: 'show:nbp' }, 3, F, 'nbp');
    // viewpoints
    const vp = ctx.station.viewpoints || (ctx.station.viewpoints = {});
    const at = (b, f, s, u) => b.group.position.clone().addScaledVector(F, f).addScaledVector(side, s).addScaledVector(up, u);
    const bonePos = (b, n) => b.rig.bone(n).getWorldPosition(new THREE.Vector3());
    const v = (name, pos, target) => { vp[name] = { position: pos.toArray(), target: target.toArray() }; };
    v('lineup', at(suit, 6.5, 2.8, 1.5), C.clone().add(new THREE.Vector3(0, 1, 0)));
    v('suit-front', at(suit, 2.7, 0.4, 1.25), at(suit, 0, 0, 1.0));
    v('suit-back', at(suit, -2.7, -0.6, 1.4), at(suit, 0, 0, 1.05));
    v('suit-side', at(suit, 0.6, 2.7, 1.2), at(suit, 0, 0, 1.0));
    v('suit-detail', at(suit, 0.95, 0.35, 1.62), at(suit, 0.1, 0, 1.4));
    v('suit-hand', bonePos(suit, 'handR').addScaledVector(F, 0.45).addScaledVector(side, -0.15).addScaledVector(up, 0.12), bonePos(suit, 'handR').addScaledVector(up, -0.06));
    v('suit-boot', at(suit, 0.9, 0.5, 0.35), at(suit, 0, 0, 0.12));
    v('suit-mount', at(mount, 1.9, -1.4, 1.5), at(mount, 0, 0, 1.2));
    v('suit-mount-front', at(mount, -2.4, 0.5, 1.3), at(mount, 0, 0, 1.05));
    v('suit-lod1', at(suit, 14, 3, 2), at(suit, 0, 0, 1));
    v('suit-lod2', at(suit, 40, 8, 4), at(suit, 0, 0, 1));
    v('crew-front', at(crew, 2.5, 0.3, 1.2), at(crew, 0, 0, 1.0));
    v('crew-side', at(crew, 0.5, 2.5, 1.2), at(crew, 0, 0, 1.0));
    v('crew-face', at(crew, 0.55, 0.12, 1.7), at(crew, 0, 0, 1.68));
    v('crew-hand', bonePos(crew, 'handL').addScaledVector(F, 0.35).addScaledVector(side, 0.12).addScaledVector(up, 0.05), bonePos(crew, 'handL').addScaledVector(up, -0.07));
    v('crew-nbp', at(nbp, 2.2, 1.4, 1.4), at(nbp, 0, 0, 1.1));
    this.stats = this.bodies.map((b) => ({ name: b.group.name, levels: b.stats }));
    console.info('[suitshow]', JSON.stringify(this.stats));
    window.__suitShow = this;
  }

  update() {}
}
