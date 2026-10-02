// Двери-уплотнители B1: две пары створок, скользящих в раму с шипением и паром.
// Открываются при приближении (внутренняя — после проверки стражи); bus 'interact' {tag:'Rakis.SealDoor'}.
import * as THREE from 'three';
import { DOORS, doorLeafParts } from './arch.js';
import { bakeGlow, refine } from './builder.js';
import { addBlock, registerDoor } from './plan.js';
import { clamp, smoothstep } from '../core/util.js';

export function createDoors(ctx, crowd) {
  const { game, root, M, origin: O } = ctx;
  const doors = [];
  for (const d of DOORS) {
    const grp = new THREE.Group(); grp.name = `SealDoor_${d.id}`; root.add(grp);
    const leaves = [];
    for (const side of [-1, 1]) {
      const mesh = new THREE.Group(); grp.add(mesh);
      for (const { mat, geo } of doorLeafParts(d.x, side)) {
        const g = refine(geo, 1.2);
        bakeGlow(g, ctx.sources, () => 'B1', { ambient: 0.05 });
        const m = new THREE.Mesh(g, M[mat]); m.frustumCulled = true; mesh.add(m);
      }
      leaves.push({ g: mesh, side });
    }
    // рама: сплошная часть — коллизия
    addBlock({ x0: d.x - 0.62, x1: d.x + 0.62, z0: -2.1, z1: -1.3 }, 0);
    addBlock({ x0: d.x - 0.62, x1: d.x + 0.62, z0: 1.3, z1: 2.1 }, 0);
    const st = { id: d.id, x: d.x, open: 0, target: 0, closeT: 0, grp, leaves, locked: false, hiss: 0 };
    registerDoor(st);
    doors.push(st);
  }
  const burst = (d, n = 10) => {
    if (!ctx.lighting?.steam) return;
    for (const zs of [-1.3, 1.3]) ctx.lighting.steam(d.x, 0.35, zs, n, 1.4, 0.35);
    ctx.lighting.steam(d.x, 3.0, 0, Math.round(n * 0.6), 1.0, 0.1);
  };
  const out = { doors };
  out.update = (dt, plL) => {
    for (const d of doors) {
      const near = Math.abs(plL.x - d.x) < 3.6 && Math.abs(plL.z) < 2.6 && plL.y < 1.5;
      const allowed = d.id !== 'inner' || crowd?.guardReleased || plL.x > d.x + 0.3;
      if (near && allowed && d.target === 0) {
        d.target = 1; d.closeT = 0;
        game.bus.emit('interact', { tag: 'Rakis.SealDoor', id: d.id });
        game.audio?.event?.('Door.SealHiss', new THREE.Vector3(d.x + O.x, 1.6, O.z));
        burst(d, 10);
      }
      if (d.target === 1) {
        if (Math.abs(plL.x - d.x) > 5.5) { d.closeT += dt; if (d.closeT > 2.0) { d.target = 0; burst(d, 6); game.audio?.event?.('Door.SealHiss', new THREE.Vector3(d.x + O.x, 1.6, O.z)); } } else d.closeT = 0;
      }
      const rate = 1 / 1.7;
      d.open = clamp(d.open + Math.sign(d.target - d.open) * rate * dt, 0, 1);
      const e = smoothstep(0, 1, d.open);
      for (const L of d.leaves) L.g.position.z = L.side * e * 1.3;
    }
  };
  return out;
}
