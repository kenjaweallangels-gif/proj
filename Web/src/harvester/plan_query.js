// Запросы к схеме проходимости борта (Plan из ibuild.js): пол, «на борту ли», стены/мебель, потолок. Чистые функции — без THREE/DOM,
// поэтому их же использует tools/harvester_collide_audit.mjs (node, без браузера). Все координаты — ЛОКАЛЬНЫЕ координаты модели.
const EPS = 0.02;
export const HEAD = 1.75;          // высота персонажа (макушка над ступнями), м
export const STEP = 0.38;          // всё ниже этого над УРОВНЕМ ПОЛА — порог, через который перешагивают

const fh = (f, x, z) => {
  if (f.y === f.y1) return f.y;
  const t = f.axis === 'x' ? (x - f.x0) / (f.x1 - f.x0) : (z - f.z0) / (f.z1 - f.z0);
  return f.y + (f.y1 - f.y) * Math.min(1, Math.max(0, t));
};

/** @param plan {floors, blockers, ceils} @param opt {legacy: старая логика (порог по y ступней) — для замера «до»} */
export function createPlanQueries(plan, opt = {}) {
  const legacy = !!opt.legacy;

  /** Высота пола под точкой (лучший пол не выше y+0.9); null — полов нет. */
  function floorAt(x, z, y) {
    let best = -Infinity, kind = null;
    const fl = plan.floors;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      if (x < f.x0 - EPS || x > f.x1 + EPS || z < f.z0 - EPS || z > f.z1 + EPS) continue;
      const fy = fh(f, x, z);
      if (fy <= y + 0.9 && fy > best) { best = fy; kind = f.kind; }
    }
    return best === -Infinity ? null : { y: best, kind };
  }
  /** Самый высокий пол под точкой не выше y+slack (любой глубины): страховка, чтобы не «проваливаться» на грунт сквозь корпус. */
  function floorBelow(x, z, y, slack = 0.9) {
    let best = -Infinity;
    const fl = plan.floors;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      if (x < f.x0 - EPS || x > f.x1 + EPS || z < f.z0 - EPS || z > f.z1 + EPS) continue;
      const fy = fh(f, x, z);
      if (fy <= y + slack && fy > best) best = fy;
    }
    return best === -Infinity ? null : best;
  }
  /** Точка (ступни) внутри/на борту: есть пол в пределах ±1.3 м по высоте (margin расширяет и по xz, и по высоте — гистерезис). */
  function contains(x, z, y, margin = 0) {
    const fl = plan.floors;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      if (x < f.x0 - EPS - margin || x > f.x1 + EPS + margin || z < f.z0 - EPS - margin || z > f.z1 + EPS + margin) continue;
      if (Math.abs(fh(f, Math.min(f.x1, Math.max(f.x0, x)), Math.min(f.z1, Math.max(f.z0, z))) - y) < 1.3 + margin) return true;
    }
    return false;
  }
  /**
   * Потолок над точкой: нижняя поверхность ближайшей плиты выше головы (потолки комнат, плиты перекрытий, полы верхних палуб).
   * y — ступни. Infinity — над головой пусто.
   */
  function ceilingAt(x, z, y, r = 0) {
    let best = Infinity;
    const cl = plan.ceils;
    if (cl) for (let i = 0; i < cl.length; i++) {
      const c = cl[i];
      if (x < c.x0 - r || x > c.x1 + r || z < c.z0 - r || z > c.z1 + r) continue;
      if (c.y > y + 1.0 && c.y < best) best = c.y;
    }
    const fl = plan.floors;
    for (let i = 0; i < fl.length; i++) {
      const f = fl[i];
      if (x < f.x0 - r || x > f.x1 + r || z < f.z0 - r || z > f.z1 + r) continue;
      const fy = fh(f, Math.min(f.x1, Math.max(f.x0, x)), Math.min(f.z1, Math.max(f.z0, z))) - 0.3;   // низ плиты пола
      if (fy > y + 1.0 && fy < best) best = fy;
    }
    return best;
  }
  // Равномерная сетка блокеров по xz (ячейка 4 м): запрос смотрит 1–4 ячейки вместо ~700 боксов. Перестраивается, если число блокеров изменилось.
  const CELL = 4, grid = new Map(), tmp = [];
  let gridN = -1;
  const gk = (ix, iz) => ix * 4096 + iz;
  function buildGrid() {
    grid.clear(); gridN = plan.blockers.length;
    for (const b of plan.blockers) {
      for (let ix = Math.floor(b.x0 / CELL); ix <= Math.floor(b.x1 / CELL); ix++) for (let iz = Math.floor(b.z0 / CELL); iz <= Math.floor(b.z1 / CELL); iz++) {
        const k = gk(ix, iz); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(b);
      }
    }
  }
  function near(x, z, r) {
    if (gridN !== plan.blockers.length) buildGrid();
    tmp.length = 0;
    const ix0 = Math.floor((x - r - 0.05) / CELL), ix1 = Math.floor((x + r + 0.05) / CELL), iz0 = Math.floor((z - r - 0.05) / CELL), iz1 = Math.floor((z + r + 0.05) / CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) { const a = grid.get(gk(ix, iz)); if (a) for (let i = 0; i < a.length; i++) tmp.push(a[i]); }
    return tmp;
  }
  /**
   * Выталкивание круга радиуса r (ступни на высоте y) из стен/мебели. Меняет out.x/out.z; true — было столкновение.
   * Порог перешагивания отсчитывается от уровня ПОЛА под ногами (а не от ступней): в прыжке нельзя перемахнуть через
   * подоконник, пульт или ящик и приземлиться внутри него.
   */
  function collide(out, y, r) {
    let hit = false;
    const bl = near(out.x, out.z, r * 2 + 0.1);   // запас: после выталкивания круг сдвигается до r
    let base = y;
    if (!legacy) { const fy = floorBelow(out.x, out.z, y, 0.9); if (fy !== null && fy < y) base = Math.max(fy, y - 1.2); }
    const top = y + HEAD, step = base + STEP;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      for (let i = 0; i < bl.length; i++) {
        const b = bl[i];
        if (b.y1 <= step || b.y0 >= top) continue;
        const cx = Math.min(b.x1, Math.max(b.x0, out.x)), cz = Math.min(b.z1, Math.max(b.z0, out.z));
        const dx = out.x - cx, dz = out.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) { const d = Math.sqrt(d2); out.x = cx + dx / d * (r + 0.005); out.z = cz + dz / d * (r + 0.005); }
        else {
          const o = [out.x - b.x0, b.x1 - out.x, out.z - b.z0, b.z1 - out.z]; const m = Math.min(o[0], o[1], o[2], o[3]);
          if (m === o[0]) out.x = b.x0 - r - 0.005; else if (m === o[1]) out.x = b.x1 + r + 0.005; else if (m === o[2]) out.z = b.z0 - r - 0.005; else out.z = b.z1 + r + 0.005;
        }
        moved = true; hit = true;
      }
      if (!moved) break;
    }
    return hit;
  }
  return { floorAt, floorBelow, contains, ceilingAt, collide };
}
