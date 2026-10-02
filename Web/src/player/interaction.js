// Выбор цели взаимодействия среди game.interactables: ближайшая в радиусе и в поле зрения.
import { CFG } from './config.js';

export function createInteraction(game, p, rig) {
  p.focus = null;
  let acc = 0;
  function find() {
    let best = null, bestScore = Infinity;
    const fx = Math.cos(rig.yaw), fz = Math.sin(rig.yaw);
    for (const it of game.interactables) {
      if (!it || it.enabled === false || !it.position) continue;
      const dx = it.position.x - p.position.x, dz = it.position.z - p.position.z;
      const r = it.radius ?? CFG.interact.radius;
      const d = Math.hypot(dx, dz);
      if (d > r || Math.abs(it.position.y - p.position.y) > 4 + r) continue;
      const dot = d > 0.001 ? (dx * fx + dz * fz) / d : 1;
      if (d > 0.9 && dot < CFG.interact.viewCos) continue;
      const score = d - dot * 1.0;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }
  return {
    update(dt, blocked) {
      acc += dt;
      if (blocked) { p.focus = null; return; }
      if (acc >= 0.05) {
        acc = 0;
        const it = find();
        p.focus = it ? { label: game.t(it.label ?? { RU: 'Взаимодействие', EN: 'Interact' }), tag: it.tag, item: it } : null;
      }
      if (game.input.pressed('Interact') && p.focus) {
        const it = p.focus.item;
        p.focus = null;
        it.onInteract?.();
        game.bus.emit('interact', { tag: it.tag });
      }
    },
  };
}
