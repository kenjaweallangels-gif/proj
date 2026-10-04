// Отладка: game.debug.goto(name) — быстрый переход к ключевым точкам демо (используется tools/smoke.mjs).
// Имена: start | erg | P1..P7b | worm | A3 | trail | cleft | sietch | market(gallery) | hall | finale | garden
// (mouth — устаревший синоним trail). Новые точки берутся из layout (ENTRY/GARDEN) и, если есть, из game.approach / game.garden.
import { START, GOLDEN_PATH, SIETCH_ORIGIN, SIETCH, WORM_REVEAL, ENTRY, GARDEN } from '../core/layout.js';

export function create(game) {
  const gp = (id) => GOLDEN_PATH.find((p) => p.id === id);
  const yawTo = (a, b) => Math.atan2(b.z - a.z, b.x - a.x);

  /** Телепорт игрока; yaw — в конвенции layout (направление атан2(dz, dx)). Фоллбек для заглушки игрока. */
  function tp(x, z, yaw, yAbs) {
    const y = yAbs ?? game.heightAt(x, z);
    const p = game.player;
    if (p?.teleport) { p.teleport(x, y, z, yaw); return; }
    if (p?.position) p.position.set(x, y + 1.7, z);
    game.camera.position.set(x, y + 2, z);
    game.camera.lookAt(x + Math.cos(yaw) * 20, y + 2, z + Math.sin(yaw) * 20);
  }
  // Сиетч бесшовный и повёрнут в мире: отладочные точки — через game.sietch.enter(point) (внутренний телепорт без затемнения).
  async function toSietch(point = 'B1') { await game.sietch?.enter?.(point); }
  const gardenSpot = () => {
    const c = game.garden?.spawn ?? game.garden?.center ?? GARDEN.center;
    const y = game.garden?.heightAt?.(c.x, c.z) ?? GARDEN.floorY;
    return { x: c.x, z: c.z, y };
  };

  let devourBusy = false;
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
        } else if (name === 'A3') { const a = gp('P7'); tp(a.x, a.z, yawTo(a, ENTRY.trailStart)); }
        else if (name === 'erg') { const a = gp('P3'); tp(a.x, a.z, yawTo(a, gp('P4'))); }
        else if (name === 'trail' || name === 'mouth') {
          const a = game.approach?.trailStart ?? ENTRY.trailStart;
          tp(a.x, a.z, yawTo(a, ENTRY.cleft));
        } else if (name === 'cleft') {
          // у входной щели, лицом внутрь (щель смотрит на запад — идём с запада на восток)
          tp(ENTRY.cleft.x - 7, ENTRY.cleft.z, 0, ENTRY.cleft.y);
        } else if (name === 'garden') {
          const g = gardenSpot();
          tp(g.x, g.z, Math.PI, g.y);
        }
        else if (name === 'sietch') await toSietch();
        else if (name === 'gallery' || name === 'market') await toSietch('B2');
        else if (name === 'hall' || name === 'finale') {
          await toSietch('B5');
          if (game.story?.startRitual) game.story.startRitual();
          else game.sietch?.startRitual?.();
          if (name === 'finale') game.story?.fire?.('Beat:SB_B5_06_Feet');
        }
        else if (gp(name)) { const p = gp(name); const i = GOLDEN_PATH.indexOf(p); tp(p.x, p.z, yawTo(p, GOLDEN_PATH[Math.min(i + 1, GOLDEN_PATH.length - 1)])); }
        else console.warn(`[debug] неизвестная точка '${name}'`);
        bus.emit('debug:goto', { name });
      } catch (e) { console.error('[debug.goto]', name, e); }
    },
    /**
     * Сценарий «Червь пожирает харвестер»: завести харвестер (если не работает), подвести игрока на обзорную точку (если далеко)
     * и вызвать game.worm.playDevour() → Promise. Идемпотентно: повторный вызов во время сцены игнорируется.
     */
    async devour() {
      if (devourBusy) return null;
      devourBusy = true;
      try {
        if (game.ui?.startGame && !game.ui.started) game.ui.startGame({ silent: true });
        const h = game.harvester;
        if (h?.position && game.player?.position) {
          const d = Math.hypot(game.player.position.x - h.position.x, game.player.position.z - h.position.z);
          if (d > 260 || game.space !== 'desert') tp(h.position.x, h.position.z + 120, -Math.PI / 2);
        }
        if (h && h.state !== 'running') {
          if (h.state === 'off' || h.state === 'stopping') { if (!h.start?.()) h.toggle?.(); }
          const t0 = performance.now();
          // ждём прогрев (~10 с игрового времени), но не дольше 20 с реального
          while (h.state !== 'running' && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 250));
        }
        if (!game.worm?.playDevour) { console.warn('[debug] game.worm.playDevour отсутствует'); return null; }
        game.bus.emit('scenario', { id: 'devour' });
        return await game.worm.playDevour({ teleport: true });
      } catch (e) { console.error('[debug.devour]', e); return null; }
      finally { devourBusy = false; }
    },
    names: ['start', 'erg', 'P4', 'worm', 'A3', 'trail', 'cleft', 'sietch', 'market', 'hall', 'garden', 'finale'],
    fire: (t) => game.story?.fire?.(t),
    beats: () => game.story?.list?.(),
  };
  return game.add('debug', api);
}
