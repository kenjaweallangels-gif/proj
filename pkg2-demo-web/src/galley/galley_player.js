// Виртуальная сборка модуля КМ-2 на стапеле: без реальных деталей и заготовок — модель собирается на месте
// настоящих деталей от пустого стапеля до готового модуля по всем 82 переходам ТП. Детали текущего перехода
// подлетают на место (снаружи и сверху), клей, крепёж, окраска, плёнка и питание включаются по ходу.
// Вид: «модель» — реалистичные материалы; «голограмма» — модель в слое дисплея очков (видна только в окне
// дисплея, полупрозрачная, текущие детали — янтарные), как это выглядело бы в настоящих AR-очках.
import * as THREE from 'three';
import { HOLO, LAYER_HOLO } from '../engine/holo.js';
import { ease } from './assembly_player.js';
import { STEPS, stateFrom } from './process.js';
import * as S from './spec.js';

export function galleyTarget(world, viz, { onBegin, onEnd } = {}) {
  const g = world.galley;
  const N = STEPS.length;
  const p0 = new Map();
  const moved = new Set();
  const states = [];
  const stAt = (i) => (states[i] ??= stateFrom(i, new Set()));
  const poweredAt = STEPS.findIndex((s) => s.id === '170.03') + 1;
  const center = new THREE.Vector3(0, 1000, S.G.D / 2);
  const mat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const holoMat = mat(HOLO.part, 0.05), flyMat = mat(HOLO.fastener, 0.22);
  const edgeMat = new THREE.LineBasicMaterial({ color: HOLO.part, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const edges = new Map();                 // сетка → контур рёбер (создаётся один раз)
  const saved = new Map();                 // объект → {material, layers}
  let style = 'model';
  const kitWas = new Map();

  /** Откуда подлетает деталь: от центра модуля наружу и сверху, мм. */
  function offsetFor(id) {
    const f = S.featureById.get(id);
    const c = f ? S.featureCenter(f) : [0, 1000, 800];
    const d = new THREE.Vector3(c[0] - center.x, 0, c[2] - center.z);
    if (d.lengthSq() < 1) d.set(0, 0, 1);
    return d.normalize().multiplyScalar(420).add(new THREE.Vector3(0, 380, 0));
  }

  function each(fn) {
    g.root.traverse((o) => { if (o === viz.root || isUnder(o, viz.root) || o === viz.overlay) return; fn(o); });
  }
  function isUnder(o, root) { while (o) { if (o === root) return true; o = o.parent; } return false; }

  function setStyle(s) {
    if (s === style) return;
    if (s === 'holo') {
      const meshes = [];
      each((o) => { saved.set(o, { mask: o.layers.mask, material: o.material }); o.layers.set(LAYER_HOLO); if (o.isMesh) { o.material = holoMat; meshes.push(o); } });
      // контур рёбер: голограмма читается по граням, а не по заливке (как у голограмм перехода)
      for (const m of meshes) {
        if (!edges.has(m)) {
          const tri = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
          const e = tri < 6000 ? new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), edgeMat) : null;
          if (e) { e.layers.set(LAYER_HOLO); e.raycast = () => {}; }
          edges.set(m, e);
        }
        const e = edges.get(m);
        if (e) m.add(e);
      }
    } else {
      for (const [m, e] of edges) if (e) m.remove(e);
      for (const [o, v] of saved) { o.layers.mask = v.mask; if (o.isMesh) o.material = v.material; }
      saved.clear();
    }
    style = s;
  }

  return {
    name: 'Стапель СТ-3 · модуль кухонный КМ-2',
    steps: STEPS.map((s) => ({ id: s.id, title: s.title, op: s.op })),
    get style() { return style; },
    setStyle,
    begin() {
      for (const o of g.items.values()) p0.set(o, o.position.clone());
      for (const [id, k] of world.kit) { kitWas.set(id, k.visible); k.visible = false; }   // заготовок нет
      viz.root.visible = false; viz.labels.visible = false;
      onBegin?.();
    },
    apply(i, f) {
      for (const o of moved) { o.position.copy(p0.get(o)); if (style === 'holo') o.traverse((m) => { if (m.isMesh) m.material = holoMat; }); }
      moved.clear();
      const A = stAt(i), fly = f > 0 && i < N, B = fly ? stAt(i + 1) : A;
      const st = fly && f >= 0.5 ? B : A;
      g.setState(st, { powered: (st === B && fly ? i + 1 : i) >= poweredAt });
      if (style === 'holo') { for (const m of g.panelMeshes) m.material = holoMat; for (const gr of g.grooves) gr.mesh.material = holoMat; }
      if (!fly) return;
      const e = ease(f / 0.8);
      for (const id of B.installed) {
        if (A.installed.has(id)) continue;
        const o = g.items.get(id);
        if (!o) continue;
        o.visible = true;
        o.position.copy(p0.get(o)).addScaledVector(offsetFor(id), 1 - e);
        if (style === 'holo') o.traverse((m) => { if (m.isMesh) m.material = flyMat; });
        moved.add(o);
      }
    },
    end() {
      for (const o of moved) o.position.copy(p0.get(o));
      moved.clear();
      setStyle('model');
      for (const [id, k] of world.kit) k.visible = kitWas.get(id) ?? k.visible;
      onEnd?.();
    },
  };
}
