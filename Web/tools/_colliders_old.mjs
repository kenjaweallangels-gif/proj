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
  add(shape) { const id = nextId++; entries.set(id, { solid: true, ...shape, id }); return id; },
  remove(id) { entries.delete(id); },
  update(id, patch) { const e = entries.get(id); if (e) Object.assign(e, patch); },
  get(id) { return entries.get(id); },
  get size() { return entries.size; },
  all() { return entries.values(); },

  /**
   * Вытолкнуть персонажа (вертикальный цилиндр радиуса r от ступней до ступни+height) из тел.
   * Изменяет pos.x/pos.z (и pos.y, если персонаж «стоит» на теле сверху — не трогаем: только горизонталь).
   */
  push(pos, r, opt = {}) {
    const h = opt.height ?? 1.8;
    let hit = false;
    for (const e of entries.values()) {
      if (!e.solid || ignored(e, opt)) continue;
      // Проверяем 3 высоты вдоль тела персонажа.
      for (const k of [0.3, h * 0.5, h - 0.2]) {
        _w.set(pos.x, pos.y + k, pos.z);
        closestPoint(e, _w, _q);
        const dx = _w.x - _q.x, dz = _w.z - _q.z, dy = _w.y - _q.y;
        const d2 = dx * dx + dz * dz;
        if (Math.abs(dy) > 0.05 && d2 + dy * dy > r * r) continue;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2);
        if (d < 1e-4) {
          // Центр внутри тела: выталкиваем от центра формы.
          const cx = e.c ? e.c.x : (e.a.x + e.b.x) / 2, cz = e.c ? e.c.z : (e.a.z + e.b.z) / 2;
          const ox = pos.x - cx, oz = pos.z - cz, ol = Math.hypot(ox, oz) || 1;
          pos.x += (ox / ol) * r; pos.z += (oz / ol) * r;
        } else {
          pos.x += (dx / d) * (r - d); pos.z += (dz / d) * (r - d);
        }
        hit = true;
        break;
      }
    }
    return hit;
  },

  /** Пересечения сферы/капсулы-зонда с телами: [{entry, depth, normal}]. */
  overlaps(probe, opt = {}) {
    const out = [];
    const center = probe.c || probe.a;
    for (const e of entries.values()) {
      if (!e.solid || ignored(e, opt)) continue;
      let pr;
      if (probe.type === 'capsule') { closestPoint(e, closestOnSegment(e.c || e.a, probe.a, probe.b, _w), _q); closestOnSegment(_q, probe.a, probe.b, _w); pr = _w; }
      else { closestPoint(e, center, _q); pr = center; }
      const n = new THREE.Vector3().subVectors(pr, _q);
      const d = n.length();
      const depth = probe.r - d;
      if (depth > 0) out.push({ entry: e, depth, normal: d > 1e-6 ? n.divideScalar(d) : new THREE.Vector3(0, 1, 0) });
    }
    return out;
  },

  /** Первое тело, пересекающее «толстый» отрезок a→b радиуса r (шаговая проверка). */
  segmentBlocked(a, b, r = 0.3, opt = {}) {
    const len = a.distanceTo(b), steps = Math.max(2, Math.ceil(len / Math.max(0.5, r)));
    for (let i = 0; i <= steps; i++) {
      _w.lerpVectors(a, b, i / steps);
      for (const e of entries.values()) {
        if (!e.solid || ignored(e, opt)) continue;
        closestPoint(e, _w, _q);
        if (_q.distanceToSquared(_w) < r * r) return e;
      }
    }
    return null;
  },

  near(center, radius, opt = {}) {
    const res = [];
    for (const e of entries.values()) {
      if (opt.owner && e.owner !== opt.owner) continue;
      closestPoint(e, center, _q);
      if (_q.distanceToSquared(center) <= radius * radius) res.push(e);
    }
    return res;
  },
  closestPoint,
};
