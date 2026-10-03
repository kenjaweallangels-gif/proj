// Физика сада: высота, поверхность и коллизия. Чистый JS (без THREE). Земля — та же сетка, что рисуется (ground.js).
// heightAt(x,z[,yФ]):
//   • клетка пола есть → G(сетка) + низкие стенки; выше берётся скала (SDF-колонки гребней), если она лежит заметно выше пола
//     и не выше ступней + 1.1 м (ступени, карнизы, подъём по осыпи наружного склона гребня);
//   • клетки пола нет → как у подхода: max(колонка скалы ≤ ступни+1.1, пустыня).
import { clamp, lerp, smoothstep } from '../core/util.js';

export function makeGardenHeight({ grid, field, vol, prevHeight }) {
  return (x, z, y) => {
    const hasY = y !== undefined && y !== null && Number.isFinite(y);
    const gm = grid.sample(x, z);
    if (Number.isFinite(gm)) {
      const g = gm + field.bump(x, z);
      if (!hasY || !vol.inZone(x, z, 0.5)) return g;
      const m = vol.surfaceY(x, z, y);
      // скала заметно выше пола (карниз, ступень, склон) и достижима — идём по ней
      if (Number.isFinite(m) && m > g + 0.35) return m;
      return g;
    }
    const ph = prevHeight(x, z, y);
    if (!vol.inZone(x, z, 0.5)) return ph;
    const m = vol.surfaceY(x, z, hasY ? y : undefined);
    if (!Number.isFinite(m)) return ph;
    if (!hasY) return ph;
    const e = Math.min(x - vol.x0, vol.x1 - x, z - vol.z0, vol.z1 - z);
    const v = Math.max(m, ph);
    return e < 3 ? lerp(ph, v, smoothstep(0.5, 3, e)) : v;
  };
}

/** Вид поверхности: 'soil' | 'stone' | 'water' в котловине/овраге; иначе null (спросить пустыню). */
export function makeGardenSurface({ grid, field, prevSurface, prevHeight, vol }) {
  return (x, z) => {
    if (Number.isFinite(grid.sample(x, z))) {
      const k = field.kind(x, z);
      if (k === 'water') return 'soil';
      if (k) return k;
    }
    if (vol.inZone(x, z, 1)) {
      const y = vol.surfaceY(x, z);
      if (Number.isFinite(y) && y > prevHeight(x, z) + 0.6) return 'rock';
    }
    return prevSurface ? prevSurface(x, z) : 'sand';
  };
}
