// Производительность сцены: неподвижные детали окружения сливаются в несколько больших сеток по материалу
// и клетке пространства (тысячи вызовов отрисовки → десятки). Что двигается, определяется прогоном
// состояний (шаги участка): всё, у чего за прогон менялись поза, видимость, геометрия или материал, —
// остаётся отдельным объектом, как было.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CELL = 4;
const _inv = new THREE.Matrix4(), _ray = new THREE.Ray();

/** Луч по слитой сетке: треугольники проверяются только у кусков, чей габарит луч пересекает. */
function raycastPieces(raycaster, hits) {
  const g = this.geometry;
  if (!g.boundingSphere) g.computeBoundingSphere();
  _inv.copy(this.matrixWorld).invert();
  _ray.copy(raycaster.ray).applyMatrix4(_inv);
  const dr = { start: g.drawRange.start, count: g.drawRange.count };
  for (const pc of this.userData.pieces) {
    if (pc.box.isBox3 && !_ray.intersectsBox(pc.box)) continue;
    g.drawRange.start = pc.start; g.drawRange.count = pc.count;
    THREE.Mesh.prototype.raycast.call(this, raycaster, hits);
  }
  g.drawRange.start = dr.start; g.drawRange.count = dr.count;
}                                    // м — клетка: слитые сетки всё ещё отсекаются по полю зрения

function sigOf(o) {
  const p = o.position, q = o.quaternion, s = o.scale;
  const g = o.geometry, m = o.material;
  return [p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z].map((v) => v.toFixed(5)).join(',')
    + `|${o.visible}|${g ? `${g.uuid}:${g.drawRange.start}:${g.drawRange.count}` : ''}|${m ? [].concat(m).map((x) => x.uuid).join(',') : ''}`;
}

/**
 * Прогнать состояния и вернуть множество объектов, которые в них меняются.
 * @param root корень; states(mark) — переключает состояния и после каждого вызывает mark()
 */
export function findDynamic(root, states) {
  const base = new Map(), dyn = new Set();
  root.traverse((o) => base.set(o, sigOf(o)));
  const mark = () => root.traverse((o) => { if (!base.has(o) || base.get(o) !== sigOf(o)) dyn.add(o); });
  states?.(mark);
  return dyn;
}

/** Мешает ли объект или его предки слиянию (меняется, исключён, особая логика выбора лучом). */
function blocked(o, root, stop) {
  for (let x = o; x && x !== root; x = x.parent) if (stop.has(x) || x.userData.noMerge || !x.visible) return true;
  return false;
}

/**
 * Слить неподвижные сетки под root. exclude — объекты (с потомками), которые трогать нельзя
 * (детали участка, их голограммы строятся клонированием, сменные таблички). Возвращает число убранных сеток.
 */
export function freezeStatic(root, { exclude = [], dynamic = null } = {}) {
  const stop = new Set([...exclude, ...(dynamic || [])]);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const wp = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.children.length) return;
    if (Array.isArray(o.material) || o.geometry.morphAttributes?.position || !o.geometry.attributes.position) return;
    if (o.raycast !== THREE.Mesh.prototype.raycast || o.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
    if (blocked(o, root, stop)) return;
    const g = o.geometry;
    if (Object.values(g.attributes).some((a) => a.isInterleavedBufferAttribute)) return;
    const attrs = Object.keys(g.attributes).sort().map((k) => { const a = g.attributes[k]; return `${k}${a.itemSize}${a.normalized ? 'n' : ''}${a.array.constructor.name}`; }).join();
    o.getWorldPosition(wp);
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.layers.mask}|${o.renderOrder}|${o.frustumCulled}|${attrs}|${Math.floor(wp.x / CELL)},${Math.floor(wp.z / CELL)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  let removed = 0;
  const mtx = new THREE.Matrix4();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => {
      let g = o.geometry.clone();
      if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
      const dr = o.geometry.drawRange;
      if (dr.start > 0 || dr.count < g.index.count) {             // частично видимая геометрия — только видимая часть
        const idx = g.index.array.slice(dr.start, Math.min(g.index.count, dr.start + dr.count));
        g.setIndex(Array.from(idx));
      }
      g.clearGroups();
      mtx.multiplyMatrices(inv, o.matrixWorld);
      g.applyMatrix4(mtx);
      if (mtx.determinant() < 0) {                                  // зеркальный масштаб — вернуть порядок обхода треугольников
        const ix = g.index.array;
        for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
        g.index.needsUpdate = true;
      }
      return g;
    });
    // куски внутри слитой сетки: габарит и диапазон индексов — для быстрого выбора лучом
    let start = 0;
    const pieces = geos.map((g) => { g.computeBoundingBox(); const pc = { box: g.boundingBox.clone().expandByScalar(1e-4), start, count: g.index.count }; start += g.index.count; return pc; });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    const a = list[0];
    const m = new THREE.Mesh(merged, a.material);
    m.name = 'static';
    m.castShadow = a.castShadow; m.receiveShadow = a.receiveShadow; m.layers.mask = a.layers.mask;
    m.renderOrder = a.renderOrder; m.frustumCulled = a.frustumCulled;
    m.userData.pieces = pieces;
    m.raycast = raycastPieces;
    root.add(m);
    for (const o of list) { o.parent.remove(o); removed++; }
  }
  root.updateMatrixWorld(true);
  return removed;
}

/** Участок: детали шагов (и всё, что меняется по шагам) остаются, остальное — сливается. */
export function freezeStation(st) {
  const dynamic = findDynamic(st.root, (mark) => {
    for (let i = 0; i <= st.steps.length; i++) for (const f of [0, 0.5, 1]) { st.apply(i, f); mark(); }
    st.apply(st.index, 0); mark();
  });
  const exclude = [...st.items.values(), ...(st.machines ? st.machines.values() : [])];
  // станки и детали остаются отдельными объектами (с них снимаются голограммы), а их неподвижные части
  // сливаются внутри каждого — тогда и голограмма-клон получает слитую сетку
  let n = 0;
  for (const g of new Set(exclude)) if (g.children.length) n += freezeStatic(g, { dynamic, exclude: exclude.filter((x) => x !== g) });
  return n + freezeStatic(st.root, { exclude, dynamic });
}
