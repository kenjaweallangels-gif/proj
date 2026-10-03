// Построитель интерьера харвестера: комнаты с запечённым освещением (по вершинам), стены с проёмами и общей схемой коллизий.
// Все координаты — локальные координаты модели (x вперёд, y вверх от подошвы гусениц, z правый борт).
import { Parts } from './parts.js';

/** Схема проходимости: полы (в т.ч. наклонные — трапы/лестницы) и твёрдые боксы (стены, мебель, перила). */
export class Plan {
  constructor() { this.floors = []; this.blockers = []; }
  /** Пол: прямоугольник; y — высота (или y→y1 вдоль оси axis 'x'|'z' от меньшей координаты к большей). */
  addFloor(x0, z0, x1, z1, y, y1 = y, axis = 'x', kind = 'metal') {
    this.floors.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), y, y1, axis, kind });
  }
  addBlock(x0, y0, z0, x1, y1, z1) {
    this.blockers.push({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
  }
}

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export const PAL = {
  WALL: '#757c72', WALL2: '#5f665f', DADO: '#454c46', CEIL: '#666a64', FLOOR: '#4a4d49', FLOOR2: '#5a5c56', STEEL: '#8c8e8b', DARK: '#2a2c2e',
  RUST: '#6d4a33', YEL: '#c79a1c', RED: '#9a3326', TEAL: '#3c7c76', CREAM: '#c8bd9f', BLUE: '#41607a', OLIVE: '#5f6650', SAND: '#b9a07a',
  FAB1: '#7a4a3c', FAB2: '#4a5d6b', FAB3: '#5f6a45', FAB4: '#8a7452', WOOD: '#6a5238', ORANGE: '#c8601c',
};

export class Room {
  /** b — {x0,x1,z0,z1,y0,y1}: габариты помещения (для затемнения углов). o: {ambient:[r,g,b], seed} */
  constructor(id, name, b, o, plan, glow) {
    this.id = id; this.name = name; this.b = b; this.plan = plan; this.glow = glow;
    this.P = new Parts(o?.seed ?? 1000);
    this.P.tess = 1.8;
    this.P.bake = (x, y, z, nx, ny, nz) => this._bake(x, y, z, nx, ny, nz);
    this.lamps = [];
    this.ambient = (o?.ambient ?? [0.33, 0.32, 0.30]).map((v) => v * 0.8);
    this.dyn = [];                 // динамические элементы (вращающиеся роторы, ленты)
    this.screens = [];             // экраны: {c:[x,y,z], n:'+x'.., w, h, k:тип}
    this.decals = [];              // декали интерьера
    this.interact = [];            // точки взаимодействия
  }
  lamp(x, y, z, i = 1, r = 7, c = [1.0, 0.9, 0.74]) { this.lamps.push({ x, y, z, i, r, c }); return this; }
  _bake(x, y, z, nx, ny, nz) {
    const A = this.ambient, hemi = 0.45 + 0.55 * (ny * 0.5 + 0.5);
    let r = A[0] * hemi, g = A[1] * hemi, bl = A[2] * hemi;
    for (const l of this.lamps) {
      const dx = l.x - x, dy = l.y - y, dz = l.z - z, d2 = dx * dx + dy * dy + dz * dz + 1e-4;
      const inv = 1 / Math.sqrt(d2);
      const ndl = Math.max(0, (nx * dx + ny * dy + nz * dz) * inv);
      const k = l.i * (0.15 + 0.85 * ndl) / (1 + d2 / (l.r * l.r)) * 0.85;
      r += l.c[0] * k; g += l.c[1] * k; bl += l.c[2] * k;
    }
    // затемнение стыков стен/пола/потолка
    const b = this.b;
    const e = 0.9;
    let near = 0;
    if (x - b.x0 < e || b.x1 - x < e) near++;
    if (z - b.z0 < e || b.z1 - z < e) near++;
    if (y - b.y0 < e || b.y1 - y < e) near++;
    const ao = near >= 2 ? 0.7 : 1;
    return [r * ao, g * ao, bl * ao];
  }
  /** Бокс; o.s — твёрдый (коллизия), o.tess — шаг деления, o.ry/rz/rx — поворот (коллизия считается по осевому бокс-описанию). */
  box(cx, cy, cz, sx, sy, sz, color, tag = 0, o = {}) {
    this.P.box(cx, cy, cz, sx, sy, sz, color, tag, o);
    if (o.s) {
      const q = Math.abs(Math.sin(o.ry || 0)) > 0.7071;
      const hx = (q ? sz : sx) / 2, hz = (q ? sx : sz) / 2;
      this.plan.addBlock(cx - hx, cy - sy / 2, cz - hz, cx + hx, cy + sy / 2, cz + hz);
    }
    return this;
  }
  /** Невидимый твёрдый объём (центр + размеры). */
  solid(cx, cy, cz, sx, sy, sz) { this.plan.addBlock(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2); return this; }
  slab(x0, y0, z0, x1, y1, z1, color, tag = 0, o = {}) {
    return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), color, tag, o);
  }
  cyl(cx, cy, cz, rTop, rBot, h, color, tag = 0, o = {}) {
    this.P.cyl(cx, cy, cz, rTop, rBot, h, color, tag, o);
    if (o.s) {
      const r = Math.max(rTop, rBot);
      const ax = o.axis || 'y';
      const hx = ax === 'x' ? h / 2 : r, hy = ax === 'y' ? h / 2 : r, hz = ax === 'z' ? h / 2 : r;
      this.plan.addBlock(cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz);
    }
    return this;
  }
  /** Светящийся бокс (лампа/панель): без запекания, отдельный меш свечения. */
  gbox(cx, cy, cz, sx, sy, sz, color, o = {}) { this.glow.box(cx, cy, cz, sx, sy, sz, color, 0, { jit: o.jit ?? 0, ...o }); return this; }
  gquad(a, b, c, d, color) { this.glow.quad(a, b, c, d, color, 0); return this; }
  /** Пол (визуальная плита + проходимость). */
  floor(x0, z0, x1, z1, y, color = PAL.FLOOR, tag = 5, kind = 'metal') {
    this.slab(x0, y - 0.3, z0, x1, y, z1, color, tag);
    this.plan.addFloor(x0, z0, x1, z1, y, y, 'x', kind);
    return this;
  }
  ceil(x0, z0, x1, z1, y, color = PAL.CEIL, tag = 0) { return this.slab(x0, y, z0, x1, y + 0.3, z1, color, tag); }
  /** Стена вдоль X на z=zc (с проёмами holes [{a0,a1,b0,b1}] по x/y; непересекающиеся по a). */
  wallX(zc, x0, x1, y0, y1, t, color, tag, holes = [], o = {}) {
    const hs = [...holes].sort((p, q) => p.a0 - q.a0);
    let cur = x0;
    const piece = (a, b, ya, yb) => { if (b - a > 1e-3 && yb - ya > 1e-3) this.box((a + b) / 2, (ya + yb) / 2, zc, b - a, yb - ya, t, color, tag, { s: !o.nosolid }); };
    for (const h of hs) { piece(cur, h.a0, y0, y1); piece(h.a0, h.a1, y0, h.b0); piece(h.a0, h.a1, h.b1, y1); cur = h.a1; this._frame('x', zc, h, t); }
    piece(cur, x1, y0, y1);
    if (o.dado) this.box((x0 + x1) / 2, y0 + 0.5, zc + (o.dado > 0 ? 0.12 : -0.12) * Math.sign(o.dado), x1 - x0, 1.0, t + 0.04, PAL.DADO, 3);
    return this;
  }
  wallZ(xc, z0, z1, y0, y1, t, color, tag, holes = [], o = {}) {
    const hs = [...holes].sort((p, q) => p.a0 - q.a0);
    let cur = z0;
    const piece = (a, b, ya, yb) => { if (b - a > 1e-3 && yb - ya > 1e-3) this.box(xc, (ya + yb) / 2, (a + b) / 2, t, yb - ya, b - a, color, tag, { s: !o.nosolid }); };
    for (const h of hs) { piece(cur, h.a0, y0, y1); piece(h.a0, h.a1, y0, h.b0); piece(h.a0, h.a1, h.b1, y1); cur = h.a1; this._frame('z', xc, h, t); }
    piece(cur, z1, y0, y1);
    if (o.dado) this.box(xc + (o.dado > 0 ? 0.12 : -0.12) * Math.sign(o.dado), y0 + 0.5, (z0 + z1) / 2, t + 0.04, 1.0, z1 - z0, PAL.DADO, 3);
    return this;
  }
  _frame(axis, c, h, t) {
    const fw = 0.16, d = t + 0.04;
    const w = h.a1 - h.a0, hh = h.b1 - h.b0;
    if (axis === 'x') {
      this.box((h.a0 + h.a1) / 2, h.b1 + fw / 2, c, w + fw * 2, fw, d, PAL.YEL, 4);
      this.box(h.a0 - fw / 2, (h.b0 + h.b1) / 2, c, fw, hh, d, PAL.YEL, 4);
      this.box(h.a1 + fw / 2, (h.b0 + h.b1) / 2, c, fw, hh, d, PAL.YEL, 4);
    } else {
      this.box(c, h.b1 + fw / 2, (h.a0 + h.a1) / 2, d, fw, w + fw * 2, PAL.YEL, 4);
      this.box(c, (h.b0 + h.b1) / 2, h.a0 - fw / 2, d, hh, fw, PAL.YEL, 4);
      this.box(c, (h.b0 + h.b1) / 2, h.a1 + fw / 2, d, hh, fw, PAL.YEL, 4);
    }
  }
  /**
   * Ограждение комнаты: четыре тонкие стены (0.2 м) СНАРУЖИ чистого объёма b, пол и потолок.
   * o: {w,e,s,n — массивы проёмов (a — вдоль стены: z для w/e, x для s/n), color, ceilColor, noCeil, ceilTag}
   * Соседние комнаты разделяет перегородка из двух стен (по одной от каждой комнаты) — освещение по сторонам свое.
   */
  enclose(o = {}) {
    const b = this.b, t = 0.2, col = o.color ?? PAL.WALL, cc = o.ceilColor ?? PAL.CEIL, top = b.y1 + 0.3;
    const zlo = b.z0 - t, zhi = b.z1 + t;
    if (o.w !== false) this.wallZ(b.x0 - t / 2, zlo, zhi, b.y0, top, t, col, 0, o.w || []);
    if (o.e !== false) this.wallZ(b.x1 + t / 2, zlo, zhi, b.y0, top, t, col, 0, o.e || []);
    if (o.s !== false) this.wallX(b.z0 - t / 2, b.x0, b.x1, b.y0, top, t, col, 0, o.s || []);
    if (o.n !== false) this.wallX(b.z1 + t / 2, b.x0, b.x1, b.y0, top, t, col, 0, o.n || []);
    // плинтус-панель
    const dz = (b.z1 - b.z0), dx = (b.x1 - b.x0);
    this.box((b.x0 + b.x1) / 2, b.y0 + 0.45, b.z0 + 0.02, dx, 0.9, 0.04, PAL.DADO, 3);
    this.box((b.x0 + b.x1) / 2, b.y0 + 0.45, b.z1 - 0.02, dx, 0.9, 0.04, PAL.DADO, 3);
    this.box(b.x0 + 0.02, b.y0 + 0.45, (b.z0 + b.z1) / 2, 0.04, 0.9, dz, PAL.DADO, 3);
    this.box(b.x1 - 0.02, b.y0 + 0.45, (b.z0 + b.z1) / 2, 0.04, 0.9, dz, PAL.DADO, 3);
    if (!o.noFloor) this.floor(b.x0, b.z0, b.x1, b.z1, b.y0, o.floorColor ?? PAL.FLOOR, 5);
    if (!o.noCeil) {
      const h = o.ceilHole;
      if (!h) this.ceil(b.x0 - t, b.z0 - t, b.x1 + t, b.z1 + t, b.y1, cc, o.ceilTag ?? 1);
      else {
        const X0 = b.x0 - t, X1 = b.x1 + t, Z0 = b.z0 - t, Z1 = b.z1 + t;
        this.ceil(X0, Z0, X1, h.z0, b.y1, cc, o.ceilTag ?? 1); this.ceil(X0, h.z1, X1, Z1, b.y1, cc, o.ceilTag ?? 1);
        this.ceil(X0, h.z0, h.x0, h.z1, b.y1, cc, o.ceilTag ?? 1); this.ceil(h.x1, h.z0, X1, h.z1, b.y1, cc, o.ceilTag ?? 1);
      }
    }
    return this;
  }
  /** Перила (низкий коллизионный барьер + визуальные поручни) вдоль отрезка. */
  rail(x0, z0, x1, z1, y, h = 1.05, color = PAL.YEL) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), ry = -Math.atan2(dz, dx);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    this.box(mx, y + h, mz, L, 0.08, 0.08, color, 1, { ry, jit: 0.04 });
    this.box(mx, y + h * 0.5, mz, L, 0.06, 0.06, color, 1, { ry, jit: 0.04 });
    const n = Math.max(1, Math.round(L / 1.8));
    for (let i = 0; i <= n; i++) this.box(x0 + dx * i / n, y + h / 2, z0 + dz * i / n, 0.07, h, 0.07, color, 1);
    const pad = 0.12;
    this.plan.addBlock(Math.min(x0, x1) - pad, y - 0.05, Math.min(z0, z1) - pad, Math.max(x0, x1) + pad, y + h + 0.1, Math.max(z0, z1) + pad);
    return this;
  }
}

export const hole = (a0, a1, b0, b1) => ({ a0, a1, b0, b1 });
export { sstep };
