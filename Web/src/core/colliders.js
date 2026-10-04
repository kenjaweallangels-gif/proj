// Реестр твёрдых тел: всё, что не должно проходить сквозь друг друга (червь, харвестер, люди, валуны, пропсы).
// Формы (мировые координаты, метры):
//   { type: 'sphere',  c: Vector3, r }
//   { type: 'capsule', a: Vector3, b: Vector3, r }        — отрезок a–b с радиусом r (тело червя — цепочка капсул)
//   { type: 'box',     c: Vector3, half: Vector3, yaw }   — бокс, повёрнутый вокруг Y (харвестер, валуны, прилавки)
// Поля записи: owner (строка, напр. 'worm'), solid=true, tags (Set), y0/y1 — вертикальные границы для box (по умолчанию из c±half).
// Динамические тела просто мутируют свои Vector3 каждый кадр — реестр хранит ссылки.
//
// API:
//   const id = colliders.add(shape)          → id;  colliders.remove(id);  colliders.update(id, patch)
//   colliders.push(pos, r, {height=1.8, ignore=owner|Set}) → bool   выталкивает «цилиндр» персонажа (pos — ступни) из всех тел
//   colliders.overlaps(shapeLike, {ignore}) → [{entry, depth, normal}]   (для обхода/реакций: червь ↔ харвестер)
//   colliders.segmentBlocked(a, b, r, {ignore}) → entry|null            (планирование пути, видимость)
//   colliders.near(center, radius, {owner}) → entries
import * as THREE from 'three';

const entries = new Map();
let nextId = 1;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Vector3();

// ---- Широкая фаза: равномерная сетка по XZ ----
// Запись лежит во всех ячейках, пересекаемых её «покрытием» (AABB + запас MARGIN). Динамические тела мутируют свои Vector3,
// поэтому раз в кадр (colliders.tick(), его зовёт игровой цикл) AABB пересчитывается, и запись перекладывается только если тело
// вышло за своё покрытие. Запрос берёт ячейки под своим AABB и точно проверяет живую форму — результаты те же, что при полном переборе.
const CELL = 12, MARGIN = 2.0, MAX_CELLS = 64;
const grid = new Map();      // ключ ячейки → массив записей
const big = [];              // слишком большие тела (длинные капсулы червя) — проверяются всегда
let stamp = 1;
const cand = [];             // буфер кандидатов (без аллокаций)
const ck = (ix, iz) => ((ix + 32768) << 16) | ((iz + 32768) & 0xffff);

function aabb(e, out) {
  let x0, x1, z0, z1;
  switch (e.type) {
    case 'sphere': x0 = e.c.x - e.r; x1 = e.c.x + e.r; z0 = e.c.z - e.r; z1 = e.c.z + e.r; break;
    case 'capsule': x0 = Math.min(e.a.x, e.b.x) - e.r; x1 = Math.max(e.a.x, e.b.x) + e.r; z0 = Math.min(e.a.z, e.b.z) - e.r; z1 = Math.max(e.a.z, e.b.z) + e.r; break;
    case 'box': { const h = Math.sqrt(e.half.x * e.half.x + e.half.z * e.half.z); x0 = e.c.x - h; x1 = e.c.x + h; z0 = e.c.z - h; z1 = e.c.z + h; break; }
    default: x0 = z0 = -1e9; x1 = z1 = 1e9;
  }
  out.x0 = x0; out.x1 = x1; out.z0 = z0; out.z1 = z1;
  return out;
}
const _bb = { x0: 0, x1: 0, z0: 0, z1: 0 };
function unlink(e) {
  if (e._big) { const i = big.indexOf(e); if (i >= 0) big.splice(i, 1); e._big = false; }
  if (e._cells) {
    for (const k of e._cells) { const a = grid.get(k); if (!a) continue; const i = a.indexOf(e); if (i >= 0) { a[i] = a[a.length - 1]; a.pop(); } if (!a.length) grid.delete(k); }
    e._cells = null;
  }
  e._cov = null;
}
function link(e) {
  aabb(e, _bb);
  if (!Number.isFinite(_bb.x0 + _bb.x1 + _bb.z0 + _bb.z1)) { e._cov = null; e._big = true; big.push(e); return; }
  const cov = e._cov || (e._cov = { x0: 0, x1: 0, z0: 0, z1: 0 });
  cov.x0 = _bb.x0 - MARGIN; cov.x1 = _bb.x1 + MARGIN; cov.z0 = _bb.z0 - MARGIN; cov.z1 = _bb.z1 + MARGIN;
  const ix0 = Math.floor(cov.x0 / CELL), ix1 = Math.floor(cov.x1 / CELL), iz0 = Math.floor(cov.z0 / CELL), iz1 = Math.floor(cov.z1 / CELL);
  if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > MAX_CELLS) { e._big = true; big.push(e); return; }
  const cells = [];
  for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
    const k = ck(ix, iz); let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(e); cells.push(k);
  }
  e._cells = cells;
}
function refresh(e) {
  // тело ушло из своего покрытия (или ещё не размещено) → переложить
  if (e._cov && !e._dirty) {
    aabb(e, _bb); const c = e._cov;
    if (_bb.x0 >= c.x0 && _bb.x1 <= c.x1 && _bb.z0 >= c.z0 && _bb.z1 <= c.z1) return;
  } else if (e._big && !e._cov && !e._dirty) return; // бесконечные границы — всегда в big
  unlink(e);
  e._dirty = false;
  link(e);
}
/** Кандидаты в прямоугольнике [x0,x1]×[z0,z1] → cand[] (дубликаты исключены), возвращает число. */
function gather(x0, z0, x1, z1, opt) {
  const st = ++stamp; let n = 0;
  const ix0 = Math.floor(x0 / CELL), ix1 = Math.floor(x1 / CELL), iz0 = Math.floor(z0 / CELL), iz1 = Math.floor(z1 / CELL);
  for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
    const a = grid.get(ck(ix, iz)); if (!a) continue;
    for (let i = 0; i < a.length; i++) { const e = a[i]; if (e._st !== st) { e._st = st; cand[n++] = e; } }
  }
  for (let i = 0; i < big.length; i++) { const e = big[i]; if (e._st !== st) { e._st = st; cand[n++] = e; } }
  return n;
}

function closestOnSegment(p, a, b, out) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 1e-9 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
}

/** Ближайшая точка формы к p (мир). */
function closestPoint(e, p, out) {
  switch (e.type) {
    case 'sphere': {
      _v.subVectors(p, e.c); const d = _v.length() || 1e-6;
      return out.copy(e.c).addScaledVector(_v, Math.min(1, e.r / d));
    }
    case 'capsule': {
      closestOnSegment(p, e.a, e.b, _q);
      _v.subVectors(p, _q); const d = _v.length() || 1e-6;
      return out.copy(_q).addScaledVector(_v, Math.min(1, e.r / d));
    }
    case 'box': {
      const cy = Math.cos(e.yaw || 0), sy = Math.sin(e.yaw || 0);
      const dx = p.x - e.c.x, dz = p.z - e.c.z;
      let lx = dx * cy + dz * sy, lz = -dx * sy + dz * cy, ly = p.y - e.c.y;
      lx = Math.max(-e.half.x, Math.min(e.half.x, lx));
      ly = Math.max(-e.half.y, Math.min(e.half.y, ly));
      lz = Math.max(-e.half.z, Math.min(e.half.z, lz));
      return out.set(e.c.x + lx * cy - lz * sy, e.c.y + ly, e.c.z + lx * sy + lz * cy);
    }
  }
  return out.copy(p);
}

function ignored(e, opt) {
  if (!opt?.ignore) return false;
  return opt.ignore instanceof Set ? opt.ignore.has(e.owner) : e.owner === opt.ignore;
}

export const colliders = {
  add(shape) { const id = nextId++; const e = { solid: true, ...shape, id, _dirty: true }; entries.set(id, e); refresh(e); return id; },
  remove(id) { const e = entries.get(id); if (e) unlink(e); entries.delete(id); },
  update(id, patch) { const e = entries.get(id); if (e) { Object.assign(e, patch); e._dirty = true; refresh(e); } },
  /** Раз в кадр (игровой цикл): пересчитать покрытие динамических тел в сетке. */
  tick() { for (const e of entries.values()) refresh(e); },
  get cells() { return grid.size; },
  get(id) { return entries.get(id); },
  get size() { return entries.size; },
  all() { return entries.values(); },

  /**
   * Вытолкнуть персонажа (вертикальный цилиндр радиуса r от ступней до ступни+height) из тел.
   * Изменяет pos.x/pos.z (и pos.y, если персонаж «стоит» на теле сверху — не трогаем: только горизонталь).
   * До 2 проходов: два соседних тела не гоняют персонажа туда-сюда (второй проход добивает остаточное проникновение).
   */
  push(pos, r, opt = {}) {
    const h = opt.height ?? 1.8;
    const k0 = 0.3, k1 = h * 0.5, k2 = h - 0.2;
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      const n = gather(pos.x - r - 0.05, pos.z - r - 0.05, pos.x + r + 0.05, pos.z + r + 0.05, opt);
      let moved = false;
      for (let i = 0; i < n; i++) {
        const e = cand[i];
        if (!e.solid || ignored(e, opt)) continue;
        // Проверяем 3 высоты вдоль тела персонажа.
        for (let kk = 0; kk < 3; kk++) {
          _w.set(pos.x, pos.y + (kk === 0 ? k0 : kk === 1 ? k1 : k2), pos.z);
          closestPoint(e, _w, _q);
          const dx = _w.x - _q.x, dz = _w.z - _q.z, dy = _w.y - _q.y;
          const d2 = dx * dx + dz * dz;
          if (Math.abs(dy) > 0.05 && d2 + dy * dy > r * r) continue;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2);
          if (d < 1e-4) {
            // Центр внутри тела: выталкиваем от центра формы.
            const cx = e.c ? e.c.x : (e.a.x + e.b.x) / 2, cz = e.c ? e.c.z : (e.a.z + e.b.z) / 2;
            const ox = pos.x - cx, oz = pos.z - cz, ol = Math.sqrt(ox * ox + oz * oz) || 1;
            pos.x += (ox / ol) * r; pos.z += (oz / ol) * r;
          } else {
            pos.x += (dx / d) * (r - d); pos.z += (dz / d) * (r - d);
          }
          hit = moved = true;
          break;
        }
      }
      if (!moved) break;
    }
    return hit;
  },

  /** Пересечения сферы/капсулы-зонда с телами: [{entry, depth, normal}]. */
  overlaps(probe, opt = {}) {
    const out = [];
    const center = probe.c || probe.a;
    const p2 = probe.type === 'capsule' ? probe.b : center;
    const n = gather(Math.min(center.x, p2.x) - probe.r, Math.min(center.z, p2.z) - probe.r, Math.max(center.x, p2.x) + probe.r, Math.max(center.z, p2.z) + probe.r, opt);
    for (let i = 0; i < n; i++) {
      const e = cand[i];
      if (!e.solid || ignored(e, opt)) continue;
      let pr;
      if (probe.type === 'capsule') { closestPoint(e, closestOnSegment(e.c || e.a, probe.a, probe.b, _w), _q); closestOnSegment(_q, probe.a, probe.b, _w); pr = _w; }
      else { closestPoint(e, center, _q); pr = center; }
      const nv = new THREE.Vector3().subVectors(pr, _q);
      const d = nv.length();
      const depth = probe.r - d;
      if (depth > 0) out.push({ entry: e, depth, normal: d > 1e-6 ? nv.divideScalar(d) : new THREE.Vector3(0, 1, 0) });
    }
    return out;
  },

  /** Первое тело, пересекающее «толстый» отрезок a→b радиуса r (шаговая проверка). */
  segmentBlocked(a, b, r = 0.3, opt = {}) {
    const len = a.distanceTo(b), steps = Math.max(2, Math.ceil(len / Math.max(0.5, r)));
    const n = gather(Math.min(a.x, b.x) - r, Math.min(a.z, b.z) - r, Math.max(a.x, b.x) + r, Math.max(a.z, b.z) + r, opt);
    if (!n) return null;
    for (let i = 0; i <= steps; i++) {
      _w.lerpVectors(a, b, i / steps);
      for (let j = 0; j < n; j++) {
        const e = cand[j];
        if (!e.solid || ignored(e, opt)) continue;
        closestPoint(e, _w, _q);
        if (_q.distanceToSquared(_w) < r * r) return e;
      }
    }
    return null;
  },

  near(center, radius, opt = {}) {
    const res = [];
    const n = gather(center.x - radius, center.z - radius, center.x + radius, center.z + radius, opt);
    for (let i = 0; i < n; i++) {
      const e = cand[i];
      if (opt.owner && e.owner !== opt.owner) continue;
      closestPoint(e, center, _q);
      if (_q.distanceToSquared(center) <= radius * radius) res.push(e);
    }
    return res;
  },
  closestPoint,
};
