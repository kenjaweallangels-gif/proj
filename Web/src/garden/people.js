// Садовники сиетча (2–3 фигуры makeFigure): водонос у желобов, ухаживающий за грядками, ребёнок среди пальм.
// Лёгкие конечные автоматы: ходьба между точками, остановки, «тянется» к растению / смотрит на зверька.
import * as THREE from 'three';
import { makeFigure, PALETTES } from '../core/figures.js';
import { rng, damp, dampAngle, clamp } from '../core/util.js';
import { C, BEDS, SPOUT, POND, BASIN, PLAZA } from './layout.js';

const V3 = THREE.Vector3;

export function createPeople(game, { ground, root, quality, walkable, fauna }) {
  const R = rng(6060);
  const out = { list: [], colliders: [] };
  const jarGeo = new THREE.LatheGeometry([[0, 0], [0.13, 0], [0.16, 0.08], [0.16, 0.22], [0.1, 0.34], [0.07, 0.4], [0, 0.4]].map((p) => new THREE.Vector2(p[0], p[1])), 12);
  const jarMat = new THREE.MeshStandardMaterial({ color: '#8a5c3c', roughness: 0.8 });

  function spawn(arch, o, path, speed, kind) {
    const P = PALETTES[arch] || {};
    const fig = makeFigure({
      height: o.height || P.height || 1.72, cloth: o.cloth || P.cloth, accent: o.accent || P.accent, suit: o.suit || P.suit,
      skin: o.skin, hood: false, mask: false, bulk: P.bulk || 1, name: `Garden_${arch}`, robe: o.robe,
    });
    const n = { fig, kind, path, pi: 0, x: path[0].x, z: path[0].z, yaw: 0, speed, pause: 1 + R() * 3, wait: 0, spd: 0, t: R() * 10, look: null, cd: 0, sphere: null };
    fig.group.position.set(n.x, ground(n.x, n.z), n.z);
    root.add(fig.group);
    const id = game.colliders?.add({ type: 'sphere', c: new V3(n.x, ground(n.x, n.z) + 0.9, n.z), r: 0.34, owner: 'garden', tags: new Set(['npc']) });
    if (id) { n.cid = id; n.sphere = game.colliders.get(id); out.colliders.push(id); }
    out.list.push(n);
    return n;
  }
  const WP = (x, z, wait = 0, act = null) => ({ x, z, wait, act });

  // водонос: цистерна → чаша → пруд → обратно; на плече кувшин
  {
    const n = spawn('WaterCarrier', { height: 1.74, cloth: '#5d6a73', accent: '#2c5f8a' }, [
      WP(808.6, 397.3, 5), WP(818, 401.5), WP(826.5, 401.9, 3), WP(838, 401.6), WP(852, 401.7), WP(868, 401.6), WP(877, 402.6, 6),
      WP(868, 402.2), WP(852, 402.4), WP(838, 402.3), WP(828, 402.8), WP(816, 401.5),
    ], 1.0, 'water');
    const jar = new THREE.Mesh(jarGeo, jarMat); jar.position.set(0.2, 0.62, 0.02); jar.rotation.z = -0.12; n.fig.parts.spine.add(jar);
  }
  // ухаживающий за грядками
  if (BEDS.length) {
    const b0 = BEDS[0], b1 = BEDS[2];
    spawn('Artisan', { height: 1.7, cloth: '#7d6a44', accent: '#8b6b3a', suit: '#463b31' }, [
      WP(b0.x - b0.hx - 1.2, b0.z + 2, 6, { reach: [b0.x - b0.hx + 1.6, b0.z + 2] }), WP(b0.x, b0.z + b0.hz + 1.4, 7, { reach: [b0.x, b0.z + b0.hz - 1] }),
      WP(b0.x + b0.hx + 1.4, b0.z + 1, 6, { reach: [b0.x + b0.hx - 1.2, b0.z] }), WP(b1.x + b1.hx + 1.4, b1.z - 1, 7, { reach: [b1.x + b1.hx - 2, b1.z - 1] }),
      WP(b1.x, b1.z - b1.hz - 1.4, 6, { reach: [b1.x, b1.z - b1.hz + 1] }), WP(b1.x - b1.hx - 1.4, b1.z, 5),
    ], 0.8, 'tender');
  }
  // ребёнок у пальм: короткие перебежки, останавливается и смотрит на зверьков
  if (quality !== 'low') {
    const pts = [[806, 404], [811, 398], [816, 404.5], [810, 410], [804, 391], [814, 388], [820, 408]].map(([x, z]) => WP(x, z, 1.5 + R() * 2));
    spawn('Child', { height: 1.2, cloth: '#9a7b55', accent: '#b5462c', suit: '#5a4a3a' }, pts, 2.0, 'child');
  }

  out.update = (dt, t, P) => {
    for (const n of out.list) {
      const wp = n.path[n.pi % n.path.length];
      n.t += dt;
      let sp = 0;
      if (n.pause > 0) {
        n.pause -= dt;
        if (wp.act?.reach && n.pause > 0.8) {
          const y = ground(wp.act.reach[0], wp.act.reach[1]) + 0.5;
          n.fig.reachTo?.(new V3(wp.act.reach[0], y, wp.act.reach[1]), 'R', 0.8);
          n.yaw = dampAngle(n.yaw, Math.atan2(wp.act.reach[0] - n.x, wp.act.reach[1] - n.z), 3, dt);
        }
        if (n.kind === 'child') {
          // смотрит на ближайшего зверька
          let best = null, bd = 12;
          for (const m of fauna?.mice || []) { if (!m.g.visible) continue; const d = Math.hypot(m.x - n.x, m.z - n.z); if (d < bd) { bd = d; best = m; } }
          if (best) { n.yaw = dampAngle(n.yaw, Math.atan2(best.x - n.x, best.z - n.z), 4, dt); n.fig.lookAt?.(new V3(best.x, best.y + 0.1, best.z), 0.8); }
        }
      } else {
        const dx = wp.x - n.x, dz = wp.z - n.z, d = Math.hypot(dx, dz);
        if (d < 0.5) { n.pi++; n.pause = n.path[n.pi % n.path.length].wait || 0.3; if (n.kind === 'child') n.pause += 0.5 + R() * 2; }
        else { n.yaw = dampAngle(n.yaw, Math.atan2(dx, dz), 5, dt); sp = n.speed * (n.kind === 'child' ? 1 : 1); }
      }
      // игрок рядом — поворачивает голову
      const pd = Math.hypot(P.x - n.x, P.z - n.z);
      if (pd < 9 && n.kind !== 'child') n.fig.lookAt?.(new V3(P.x, P.y + 1.6, P.z), clamp((9 - pd) / 6, 0, 0.7));
      n.spd = damp(n.spd, sp, 6, dt);
      if (n.spd > 0.05) { n.x += Math.sin(n.yaw) * n.spd * dt; n.z += Math.cos(n.yaw) * n.spd * dt; }
      const y = ground(n.x, n.z);
      n.fig.group.position.set(n.x, y, n.z); n.fig.group.rotation.y = n.yaw;
      n.fig.animate(n.spd, dt, 0, { desert: false });
      if (n.sphere) n.sphere.c.set(n.x, y + 0.9, n.z);
    }
  };
  return out;
}
