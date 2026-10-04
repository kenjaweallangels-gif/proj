// Физика сада: высота, поверхность и стены. Чистый JS (без THREE). Земля — та же сетка, что рисуется (ground.js).
// heightAt(x,z[,yФ]): клетка пола есть → высота сетки (без стенок и ступеней); нет клетки — как у подхода (пустыня/Коготь).
// Стены котловины — вертикальные (collideBasin): пока игрок внутри чаши, он не может выйти ни пешком, ни прыжком (граница не зависит от высоты).
import { solidSdf } from '../desert/field.js';
import { C, FLOOR_Y, MOUTH, ringIn, ang, radius } from './layout.js';

export function makeGardenHeight({ grid, prevHeight }) {
  return (x, z, y) => {
    const g = grid.sample(x, z);
    return Number.isFinite(g) ? g : prevHeight(x, z, y);
  };
}

/** Вид поверхности: 'soil' | 'sand' | 'stone' внутри котловины; иначе null (спросить пустыню). */
export function makeGardenSurface({ grid, field, prevSurface }) {
  return (x, z) => {
    if (Number.isFinite(grid.sample(x, z))) {
      const k = field.kind(x, z);
      if (k) return k;
    }
    return prevSurface ? prevSurface(x, z) : 'sand';
  };
}

/** Зазор между капсулой игрока и подножием стены, м (стена шума уходит внутрь не более чем на ~0.2 м). */
export const WALL_GAP = 0.9;
/**
 * Вертикальная стена котловины: выталкивает pos (x,z) внутрь, если радиус больше ringIn(θ) − WALL_GAP − r.
 * Работает на любой высоте (граница — цилиндр), поэтому из чаши нельзя ни выйти, ни вылезти по склону, ни выпрыгнуть.
 * inside(x,z) — «этот участок чаши открыт» (на западе чаша доходит до грани Когтя — там держит контур Когтя).
 */
export function collideBasin(pos, r) {
  const th = ang(pos.x, pos.z), lim = ringIn(th) - WALL_GAP - r, d = radius(pos.x, pos.z);
  if (d <= lim) return false;
  pos.x = C.x + ((pos.x - C.x) / d) * lim; pos.z = C.z + ((pos.z - C.z) / d) * lim;
  return true;
}

/** Контур Когтя (2D SDF) — как в desert/index.js: на уровне сада это западная стена чаши (вертикальная грань). */
export function clawPush(pos, r) {
  let hit = false;
  for (let it = 0; it < 3; it++) {
    const d = solidSdf(pos.x, pos.z); if (d >= r) break;
    const e = 0.25;
    let gx = solidSdf(pos.x + e, pos.z) - solidSdf(pos.x - e, pos.z), gz = solidSdf(pos.x, pos.z + e) - solidSdf(pos.x, pos.z - e);
    const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
    pos.x += gx * (r - d + 0.01); pos.z += gz * (r - d + 0.01); hit = true;
  }
  return hit;
}
/** Коридор лаза: контур Когтя там не выталкивает (стенки держат коллайдеры mouth.js). */
export const inMouthCorridor = (x, z) => x > MOUTH.x - MOUTH.lining - 3 && x < MOUTH.x + 4 && Math.abs(z - MOUTH.z) < MOUTH.w / 2 + 0.3;
/** Ноги выше этой отметки — игрок «на уровне сада» (дно 36 м, пустыня внизу ≈ 5–13 м). */
export const HIGH_Y = FLOOR_Y - 7;

/**
 * collide(pos, r) для мира с садом (общий код игры и тестов).
 *  • на уровне сада (внутри основания массива): контур Когтя + вертикальная кольцевая стена чаши (на любой высоте — не выйти и не выпрыгнуть);
 *    препятствия пустыни не применяются (под основанием их нет);
 *  • внизу, в пустыне: обычные препятствия, плюс основание массива — сплошной склон (радиальная стенка у подошвы footR(θ)).
 * opts: {prevCollide, faceAt, footR(θ), inExitPassage(pos), Zr}.
 */
export function makeGardenCollide({ prevCollide, faceAt, footR, inExitPassage = () => false, Zr }) {
  return (pos, r = 0.4) => {
    if (pos.x < Zr.x0 || pos.x > Zr.x1 || pos.z < Zr.z0 || pos.z > Zr.z1) return prevCollide(pos, r);
    const th = ang(pos.x, pos.z), d = radius(pos.x, pos.z), fr = footR(th);
    let hit = false;
    if (pos.y !== undefined && pos.y > HIGH_Y && d < fr + 2 && pos.x > faceAt(pos.z) - 12) {
      const corr = inMouthCorridor(pos.x, pos.z);
      if (!corr && !inExitPassage(pos)) hit = clawPush(pos, r);
      if (!corr) hit = collideBasin(pos, r) || hit;
    } else {
      hit = prevCollide(pos, r);
      if (d < fr + r && pos.x > faceAt(pos.z) + 1 && solidSdf(pos.x, pos.z) > 1.5) {
        const k = (fr + r + 0.05) / Math.max(d, 1e-6);
        pos.x = C.x + (pos.x - C.x) * k; pos.z = C.z + (pos.z - C.z) * k; hit = true;
      }
    }
    return hit;
  };
}
