// Отладка: game.debug.goto(name) — быстрый переход к ключевым точкам демо (используется tools/smoke.mjs).
// Имена: start | P1..P7b | worm | A3 | mouth | sietch | gallery | hall | finale | end
import { START, GOLDEN_PATH, ELLIPSIS, SIETCH_ORIGIN, SIETCH, WORM_REVEAL } from '../core/layout.js';

export function create(game) {
  const gp = (id) => GOLDEN_PATH.find((p) => p.id === id);
  const yawTo = (a, b) => Math.atan2(b.z - a.z, b.x - a.x);

  /** Телепорт игрока; yaw — в конвенции layout (направление атан2(dz, dx)). Фоллбек для заглушки игрока. */
  function tp(x, z, yaw) {
    const y = game.heightAt(x, z);
    const p = game.player;
    if (p?.teleport) { p.teleport(x, y, z, yaw); return; }
    if (p?.position) p.position.set(x, y + 1.7, z);
    game.camera.position.set(x, y + 2, z);
    game.camera.lookAt(x + Math.cos(yaw) * 20, y + 2, z + Math.sin(yaw) * 20);
  }
  const sietchPos = (lx) => ({ x: SIETCH_ORIGIN.x + lx, z: SIETCH_ORIGIN.z });
  async function toSietch(lx) {
    if (game.space !== 'sietch') await game.sietch?.enter?.();
    if (lx !== undefined) { const s = sietchPos(lx); tp(s.x, s.z, 0); }
  }

  const api = {
    async goto(name) {
      try {
        // Название-«шорткат»: старт игры, если титул ещё не пройден.
        if (game.ui?.startGame && !game.ui.started) game.ui.startGame({ silent: true });
        const bus = game.bus;
        if (name === 'start') tp(START.x, START.z, START.yaw);
        else if (name === 'worm') {
          const p4 = gp('P4');
          tp(p4.x, p4.z, yawTo(p4, WORM_REVEAL));
          game.weather?.request?.('Worm_Reveal', 1);
          game.audio?.setMusic?.('WormReveal');
          if (game.story?.playCinematic) game.story.playCinematic('LS_WormReveal');
          else game.worm?.playReveal?.();
        } else if (name === 'A3') tp(ELLIPSIS.A3.x, ELLIPSIS.A3.z, ELLIPSIS.A3.yaw);
        else if (name === 'mouth') { const m = gp('MOUTH'); tp(m.x, m.z, yawTo(m, gp('FALSE_ROCK'))); }
        else if (name === 'sietch') await toSietch();
        else if (name === 'gallery') await toSietch((SIETCH.B2.x0 + SIETCH.B2.x1) / 2 - 20);
        else if (name === 'hall' || name === 'finale') {
          await toSietch(SIETCH.B5.x0 + 12);
          if (game.story?.startRitual) game.story.startRitual();
          else game.sietch?.startRitual?.();
          if (name === 'finale') game.story?.fire?.('Beat:SB_B5_06_Feet');
        } else if (name === 'end') { if (game.story?.endDemo) game.story.endDemo(); else game.ui?.endCard?.(); }
        else if (gp(name)) { const p = gp(name); const i = GOLDEN_PATH.indexOf(p); tp(p.x, p.z, yawTo(p, GOLDEN_PATH[Math.min(i + 1, GOLDEN_PATH.length - 1)])); }
        else console.warn(`[debug] неизвестная точка '${name}'`);
        bus.emit('debug:goto', { name });
      } catch (e) { console.error('[debug.goto]', name, e); }
    },
    names: ['start', 'P2', 'P4', 'worm', 'A3', 'mouth', 'sietch', 'gallery', 'hall', 'finale', 'end'],
    fire: (t) => game.story?.fire?.(t),
    beats: () => game.story?.list?.(),
  };
  return game.add('debug', api);
}
