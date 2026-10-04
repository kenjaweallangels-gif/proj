// Финал «Глотка Бога» — В РЕАЛЬНОМ ВРЕМЕНИ, без кат-сцен и захвата камеры. Игрок свободно ходит по залу:
// жрица поёт, девушка танцует в луче, а наиб Хармат оборачивается к игроку, когда тот подходит к помосту
// (или принудительно ближе к концу ~20 с после playFinale()). playFinale() по-прежнему возвращает Promise (сюжетный бит).
import * as THREE from 'three';
import { smoothstep } from '../core/util.js';

export function createFinale(ctx, crowd) {
  const { game, root } = ctx;
  const out = { active: false, t: 0, dur: 20.5, near: 0 };
  let resolve = null, promise = null;
  const pl = new THREE.Vector3();

  out.update = (dt) => {
    const h = crowd.harmat;
    if (!h) return;
    const pw = game.player?.position;
    root.worldToLocal(pl.copy(pw || game.camera.position));
    const d = Math.hypot(pl.x - h.x, pl.z - h.z);
    const onHall = pl.x > 150 && pl.x < 206 && Math.abs(pl.z) < 22;
    out.near = onHall ? smoothstep(17, 6, d) : 0;
    let face = out.near;
    if (out.active) {
      out.t += dt;
      face = Math.max(face, smoothstep(13.5, 18.5, out.t));
      const hl = ctx.lighting?.heroLight;
      if (hl) { const k = smoothstep(8, 13, out.t); hl.intensity = 34 * k; hl.position.set(h.x - 1.6, h.y + 2.3, h.z - 1.2); }
      if (out.t >= out.dur) finish();
    }
    h.faceCam = face;
  };
  function finish() {
    out.active = false;
    if (ctx.lighting?.heroLight) ctx.lighting.heroLight.intensity = 0;
    game.bus.emit('finale', { done: true });
    resolve?.(); resolve = null;
  }
  out.play = () => {
    if (out.active && promise) return promise;
    out.active = true; out.t = 0;
    game.bus.emit('finale', { done: false });
    promise = new Promise((r) => { resolve = r; });
    return promise;
  };
  out.stop = () => { if (out.active) finish(); };
  return out;
}
