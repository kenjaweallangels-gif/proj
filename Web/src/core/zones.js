// Определение зоны игрока (как URakisZoneSubsystem): событие 'zone' {from, to}.
import { bus } from './bus.js';
import { desertZoneAt } from './layout.js';

export function create(game) {
  let acc = 0;
  return {
    update(dt) {
      acc += dt;
      if (acc < 0.2 || !game.player) return;
      acc = 0;
      const p = game.player.position;
      const z = game.space === 'sietch' ? (game.sietch?.zoneAt?.(p) || 'B1_Airlock') : desertZoneAt(p.x, p.z);
      if (z !== game.zone) {
        const from = game.zone;
        game.zone = z;
        bus.emit('zone', { from, to: z });
      }
    },
  };
}
