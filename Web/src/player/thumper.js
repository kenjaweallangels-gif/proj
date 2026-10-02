// Тампер: стойка, бьющая каждые 1.6 с в течение 30 с. Подбирается (interactables).
import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp } from '../core/util.js';

const brass = new THREE.MeshStandardMaterial({ color: '#8a6a3a', roughness: 0.5, metalness: 0.6 });
const dark = new THREE.MeshStandardMaterial({ color: '#3a2f26', roughness: 0.8 });
const geo = {
  plate: new THREE.CylinderGeometry(0.16, 0.18, 0.04, 14),
  pole: new THREE.CylinderGeometry(0.022, 0.03, 0.9, 8),
  head: new THREE.CylinderGeometry(0.08, 0.06, 0.12, 10),
  spring: new THREE.TorusGeometry(0.05, 0.008, 6, 12),
};

function makeStake() {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(geo.plate, dark); plate.position.y = 0.02; g.add(plate);
  const pole = new THREE.Mesh(geo.pole, brass); pole.position.y = 0.45; g.add(pole);
  const head = new THREE.Mesh(geo.head, brass); head.position.y = 0.94; g.add(head);
  for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(geo.spring, dark); s.rotation.x = Math.PI / 2; s.position.y = 0.2 + i * 0.07; g.add(s); }
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { group: g, head, pole };
}

export function createThumpers(game, p, fx) {
  const C = CFG.thumper;
  p.thumperCharges = C.charges;
  const active = [];

  function remove(t) {
    const i = active.indexOf(t); if (i >= 0) active.splice(i, 1);
    const j = game.interactables.indexOf(t.item); if (j >= 0) game.interactables.splice(j, 1);
    game.scene.remove(t.mesh.group);
  }

  function thump(t) {
    const { x, z } = t.pos;
    t.pulse = 1;
    game.bus.emit('noise', { x, z, loudness: C.loudness, source: 'Thumper' });
    game.bus.emit('thumper', { x, z });
    game.world?.addFootprint?.(x, z, 0, { type: 'thumper' });
    const d = Math.hypot(p.position.x - x, p.position.z - z);
    game.shake = Math.max(game.shake, C.shake * clamp(1 - d / C.shakeRange, 0, 1));
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      fx.spawn(x, t.pos.y + 0.08, z, Math.cos(a) * 0.9, 0.5, Math.sin(a) * 0.9, 0.35, 1.0, 2.5);
    }
  }

  return {
    active,
    deploy() {
      if (p.thumperCharges <= 0) return false;
      if (game.space !== 'desert') return false;
      const x = p.position.x + Math.cos(p.yaw) * C.ahead, z = p.position.z + Math.sin(p.yaw) * C.ahead;
      const surf = game.surfaceAt(x, z);
      if ((CFG.noise.surface[surf] ?? 0) <= 0) { game.ui?.hint?.(game.t('Тампер нужен песок, не камень.', 'A thumper needs sand, not rock.')); return false; }
      p.thumperCharges--;
      const y = game.heightAt(x, z);
      const mesh = makeStake();
      mesh.group.position.set(x, y - 0.05, z);
      game.scene.add(mesh.group);
      const t = { pos: new THREE.Vector3(x, y, z), mesh, age: 0, next: 0.4, pulse: 0, item: null };
      t.item = {
        position: t.pos, radius: C.pickRadius, enabled: true, tag: 'Thumper',
        label: { RU: 'Забрать тампер', EN: 'Pick up thumper' },
        onInteract: () => { p.thumperCharges++; remove(t); },
      };
      game.interactables.push(t.item);
      active.push(t);
      return true;
    },
    update(dt) {
      for (const t of [...active]) {
        t.age += dt;
        t.pulse = Math.max(0, t.pulse - dt * 4);
        t.mesh.head.position.y = 0.94 - t.pulse * 0.1;
        if (t.age >= C.duration) {
          // Пружина села: стойка уходит в песок и пропадает.
          t.item.enabled = false;
          t.mesh.group.position.y -= dt * 0.25;
          if (t.age > C.duration + 2.5) remove(t);
          continue;
        }
        if (t.age >= t.next) { t.next += C.interval; thump(t); }
      }
    },
  };
}
