// Голограммы: материалы и траектории. Слой 1 — «то, что рисует дисплей очков»; слой 0 — реальность.
import * as THREE from 'three';

export const LAYER_REAL = 0;
export const LAYER_HOLO = 1;
/** Подписи ячеек (спрайты): видны глазу и со стороны, но не участвуют в расчёте затенения AO. */
export const LAYER_LABEL = 2;

export const HOLO = {
  part: new THREE.Color('#58e6ff'),
  fastener: new THREE.Color('#ffc845'),
  ok: new THREE.Color('#5dffa8'),
  marker: new THREE.Color('#7dffcf'),
};

/** Оптический дисплей только добавляет свет: аддитивное смешивание, без записи глубины. */
export function holoMaterial(color = HOLO.part, opacity = 0.42) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}

export function holoLineMaterial(color = HOLO.part, opacity = 0.95) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
}

export function setLayer(obj, layer) {
  obj.traverse((o) => o.layers.set(layer));
  return obj;
}

/** Превратить копию детали в голограмму: заливка + контур рёбер (чётче читается на прозрачном дисплее). */
export function toHologram(obj, color = HOLO.part) {
  // крупные детали (полка 1,5 м) заливкой «слепят» окно — им заливка слабее, контур тот же
  const dim = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  const big = Math.max(dim.x, dim.y, dim.z);
  const fill = holoMaterial(color, big > 0.5 ? 0.06 : big > 0.25 ? 0.18 : 0.42);
  obj.userData.holoOpacity = fill.opacity;
  const line = holoLineMaterial(color);
  const meshes = [];
  obj.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    m.material = fill;
    m.castShadow = m.receiveShadow = false;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), line);
    edges.name = 'edges';
    m.add(edges);
  }
  obj.userData.holoFill = fill;
  obj.userData.holoLine = line;
  return setLayer(obj, LAYER_HOLO);
}

/** k — множитель к базовой прозрачности детали (зависит от размера). */
export function setHoloColor(obj, color, k = 1) {
  obj.userData.holoFill?.color.copy(color);
  obj.userData.holoLine?.color.copy(color);
  if (obj.userData.holoFill) obj.userData.holoFill.opacity = (obj.userData.holoOpacity ?? 0.42) * k;
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Путь детали «тара → место»: дуга над изделием, чтобы не проходить сквозь детали. t ∈ [0,1]. */
export function arcPoint(src, dst, t, lift = 0.18, out = new THREE.Vector3()) {
  const k = easeInOut(Math.min(1, Math.max(0, t)));
  const apexY = Math.max(src.y, dst.y) + lift;
  const mid = new THREE.Vector3((src.x + dst.x) / 2, apexY, (src.z + dst.z) / 2);
  const a = 1 - k;
  return out.set(
    a * a * src.x + 2 * a * k * mid.x + k * k * dst.x,
    a * a * src.y + 2 * a * k * mid.y + k * k * dst.y,
    a * a * src.z + 2 * a * k * mid.z + k * k * dst.z,
  );
}

/** Фазы цикла анимации шага (с): перелёт детали, затем крепёж, пауза. */
export function stepPhase(time, nFasteners) {
  const fly = 2.4, perFast = 0.45, hold = 1.6;
  const cycle = fly + nFasteners * perFast + hold;
  const t = time % cycle;
  return { fly: Math.min(1, t / fly), fastIndex: t < fly ? -1 : Math.floor((t - fly) / perFast), cycle, loops: Math.floor(time / cycle) };
}

/** Рамка вокруг метки (подсветка при привязке). */
export function markerFrame(size) {
  const h = size * 0.62;
  const g = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-h, 0.002, -h), new THREE.Vector3(h, 0.002, -h), new THREE.Vector3(h, 0.002, h),
    new THREE.Vector3(-h, 0.002, h), new THREE.Vector3(-h, 0.002, -h),
  ]);
  return setLayer(new THREE.Line(g, holoLineMaterial(HOLO.marker)), LAYER_HOLO);
}
