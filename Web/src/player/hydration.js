// Жара и влага (mechanics.md §3). Никогда не убивает: пол MinMoisture.
import { CFG } from './config.js';
import { clamp, damp } from '../core/util.js';

export function createHydration(game, p) {
  const H = CFG.hydration;
  p.moisture = H.start; p.inShade = false; p.maskSealed = true; p.heat = 0; p.parched = false; p.shade = 0;
  let acc = 0;
  game.bus.on('cinematic', (e) => { if (e && !e.active) p.noise = 0; });
  return {
    toggleMask() { p.maskSealed = !p.maskSealed; game.bus.emit('mask', { sealed: p.maskSealed }); },
    update(dt, running) {
      acc += dt;
      if (acc >= H.shadeInterval) {
        acc = 0;
        p.shade = game.world?.shadeAt?.(p.position.x, p.position.z) ?? 0;
      }
      const indoors = game.space === 'sietch';
      p.inShade = indoors || p.shade > H.shadeThreshold;
      let rate; // в минуту
      if (indoors) rate = H.interiorRecover;
      else if (p.inShade) rate = H.shadeRecover;
      else rate = -H.sunDrain * (running ? H.runMul : 1) * (p.maskSealed ? H.maskFactor : 1);
      p.moisture = clamp(p.moisture + (rate / 60) * dt, H.min, 1);
      p.heat = damp(p.heat, p.inShade ? 0 : 1, 1 / H.heatTau, dt);
      p.parched = p.moisture < H.lowThreshold;
    },
  };
}
