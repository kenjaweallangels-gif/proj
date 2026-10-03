// Высота и коллизия подхода: обёртки над world.heightAt / world.collide (без THREE — тестируются в node).
import { smoothstep, lerp, clamp } from '../core/util.js';

/** heightAt(x,z[,yФ]): в зоне — поверхность сетки не выше ступней+1.1 м и не ниже настоящего рельефа; у края зоны — плавная сшивка. */
export function makeHeightAt(vol, prevHeight) {
  return (x, z, y) => {
    if (!vol.inZone(x, z, 0.5)) return prevHeight(x, z);
    const m = vol.surfaceY(x, z, y);
    const ph = prevHeight(x, z);
    if (!Number.isFinite(m)) return ph;
    const e = Math.min(x - vol.x0, vol.x1 - x, z - vol.z0, vol.z1 - z);
    const v = Math.max(m, ph);
    if (e < 3) return lerp(ph, v, smoothstep(0.5, 3, e));
    return v;
  };
}

/**
 * collide(pos, r): внешний контур Когтя (prevCollide) + сетка. passagePts — ломаная прохода (щель+ниша): если родного world.addPassage
 * нет, контур скалы внутри прохода игнорируется. xMax — дальше внутренность сиетча (коллизия его).
 */
export function makeCollide(vol, prevCollide, { passagePts, nativePassage, xMax, passageR = 2.4 }) {
  const inPassage = (x, z) => {
    for (let i = 0; i < passagePts.length - 1; i++) {
      const a = passagePts[i], b = passagePts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
      if (Math.hypot(x - a.x - dx * t, z - a.z - dz * t) < passageR) return true;
    }
    return false;
  };
  return (pos, r = 0.4) => {
    if (!vol.inZone(pos.x, pos.z, 0.5) || pos.x > xMax + 6) return prevCollide(pos, r);
    let hit = false;
    const ox = pos.x, oz = pos.z;
    if (prevCollide(pos, r)) {
      if (!nativePassage && inPassage(ox, oz)) { pos.x = ox; pos.z = oz; } else hit = true;
    }
    if (pos.x < xMax) hit = vol.collide(pos, r) || hit;
    return hit;
  };
}
