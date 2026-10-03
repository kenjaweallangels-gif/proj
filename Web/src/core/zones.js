// Определение зоны и пространства игрока (как URakisZoneSubsystem) — БЕСШОВНО, по положению:
//  • game.space = 'sietch', если game.sietch.contains(pos) (внутри пещер, включая входную расщелину и выходной туннель);
//    иначе 'desert'. Смена шлёт bus 'space' {space, from}.
//  • game.zone: в сиетче — game.sietch.zoneAt(pos); в котловине — game.garden.zoneAt(pos) ('C1_Garden');
//    иначе пустынная зона по layout. Смена шлёт bus 'zone' {from, to}.
import { bus } from './bus.js';
import { desertZoneAt } from './layout.js';

export function create(game) {
  let acc = 0;
  return {
    update(dt) {
      acc += dt;
      if (acc < 0.15 || !game.player) return;
      acc = 0;
      const p = game.player.position;
      const inSietch = !!game.sietch?.contains?.(p);
      const space = inSietch ? 'sietch' : 'desert';
      if (space !== game.space) {
        const from = game.space;
        game.space = space;
        bus.emit('space', { space, from });
      }
      const z = inSietch ? (game.sietch.zoneAt?.(p) || 'B1_Airlock')
        : (game.garden?.zoneAt?.(p) || desertZoneAt(p.x, p.z));
      if (z !== game.zone) {
        const from = game.zone;
        game.zone = z;
        bus.emit('zone', { from, to: z });
      }
    },
  };
}
