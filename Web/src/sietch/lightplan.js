// Светошары (парят на суспензорах под сводами) и световые шахты. Позиции светошаров прижаты к потолку при запекании пещеры
// (cave/bake.js → header.globes); здесь — только копия для анимации. Колодцы — из cave/layout.js.
import { WELLS } from './cave/layout.js';

/** @typedef {{x:number,y:number,z:number,region:string,k:number,chain?:number,niche?:string}} Globe */
export function planGlobes(cave) {
  return cave.globes.map((g) => ({ ...g, wall: null, chain: 0 }));
}

/** Световые колодцы с поверхности (холодный сине-белый луч вниз): только вертикальные шахты B2. */
export function planWells() {
  return WELLS.filter((w) => !w.slit).map((w) => ({ ...w, region: 'B2', kind: 'well' }));
}
