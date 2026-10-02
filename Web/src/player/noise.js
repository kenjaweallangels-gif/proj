// Шаги, шум, метр, ритм и походка по песку (mechanics.md §1).
import { CFG, stepInterval } from './config.js';
import { clamp } from '../core/util.js';

export function createNoise(game, p, fx) {
  const C = CFG.noise, S = CFG.step;
  let nextAt = 0, lastAt = -1, curInterval = 0.5, wasMoving = false, side = 1, stutterAt = -9, sandPrev = false;
  p.intervals = []; p.regularity = 0.5; p.noise = 0; p.surface = 'sand'; p.stutterCount = 0; p.sandWalking = false; p.stutterPulse = 0;
  p.lastStepLoudness = 0;

  function computeRegularity() {
    const a = p.intervals;
    if (a.length < 3) return 0.5;
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length);
    return 1 - clamp(sd / mean / C.goodCV, 0, 1);
  }

  function step(now, gait) {
    const { x, z } = p.position;
    const surface = game.surfaceAt(x, z);
    p.surface = surface;
    if (lastAt >= 0 && now - lastAt < S.idleReset) {
      p.intervals.push(now - lastAt);
      while (p.intervals.length > C.window) p.intervals.shift();
    } else p.intervals.length = 0;
    lastAt = now;
    p.regularity = computeRegularity();
    const base = gait === 'run' ? C.run : gait === 'sandwalk' ? C.sandWalk : C.walk;
    const mult = C.surface[surface] ?? 0;
    const loud = clamp(base * mult * (1 + C.rhythmPenalty * p.regularity), 0, 1);
    side = -side;
    const yaw = p.yaw;
    // Курс = atan2(dz, dx); вправо = (-sin, cos). Стопа смещена вбок.
    const fx_ = x - Math.sin(yaw) * 0.12 * side, fz_ = z + Math.cos(yaw) * 0.12 * side;
    game.bus.emit('footstep', { x: fx_, z: fz_, yaw, surface, actor: 'player' });
    if (loud > 0) {
      p.noise = Math.max(p.noise, loud);
      game.bus.emit('noise', { x, z, loudness: loud, source: 'Footstep' });
      if (game.space === 'desert') game.world?.addFootprint?.(fx_, fz_, yaw, { type: 'foot' });
      if (gait === 'run') fx.spawn(x, p.position.y + 0.1, z, -Math.cos(yaw) * 0.6, 0.5, -Math.sin(yaw) * 0.6, 0.22, 0.7);
    }
    p.lastStepLoudness = loud;
  }

  return {
    stutter(now, moving) {
      if (now - stutterAt < C.stutterCooldown) return;
      stutterAt = now;
      p.stutterCount++; p.stutterPulse = C.stutterAnim;
      game.bus.emit('stutter', {});
      if (moving && lastAt >= 0) {
        const r = Math.random() < 0.5 ? C.stutterLow : C.stutterHigh;
        const mul = r[0] + Math.random() * (r[1] - r[0]);
        nextAt = Math.max(now + 0.06, lastAt + curInterval * mul);
      }
    },
    reset() { p.noise = 0; p.intervals.length = 0; p.regularity = 0.5; lastAt = -1; wasMoving = false; },
    update(dt, now, speed, gait, sandHeld) {
      if (sandHeld !== sandPrev) { sandPrev = sandHeld; p.sandWalking = sandHeld; game.bus.emit('sandwalk', { on: sandHeld }); }
      p.stutterPulse = Math.max(0, p.stutterPulse - dt);
      const moving = speed > S.minSpeed;
      if (moving) {
        if (!wasMoving) nextAt = now + S.firstDelay;
        else if (now >= nextAt) {
          step(now, gait);
          curInterval = stepInterval(speed) * (1 + (Math.random() * 2 - 1) * S.jitter);
          nextAt = now + curInterval;
        }
      }
      wasMoving = moving;
      if (lastAt >= 0 && now - lastAt > S.idleReset && p.intervals.length) { p.intervals.length = 0; p.regularity = 0.5; }
      const onSafe = (C.surface[p.surface] ?? 0) === 0;
      p.noise = Math.max(0, p.noise - (onSafe ? C.rockDecay : C.decay) * dt);
    },
  };
}
