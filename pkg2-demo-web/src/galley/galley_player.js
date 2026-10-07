// Виртуальная сборка модуля КМ-2 на стапеле: реальных деталей и заготовок нет — изделие собирается из
// голограмм на месте настоящих деталей, от пустого стапеля до готового модуля по всем 82 переходам ТП.
// Детали текущего перехода подлетают на место (снаружи и сверху) янтарной голограммой.
// Вид: «голограмма» — видна всем (как модель в симуляторе); «в очках» — только в окне дисплея очков.
// Быстро: голограмма слита в сетки по «расписанию видимости» (детали, появляющиеся на одном шаге, — одна
// сетка), на шаге меняется видимость десятков сеток, а не состояние сотен деталей; подлетают отдельные копии.
import * as THREE from 'three';
import { ease } from './assembly_player.js';
import { STEPS, stateFrom } from './process.js';
import * as S from './spec.js';
import { holoGeometry, holoObject, setHoloLayer } from './virtual.js';

/** Видна ли деталь в состоянии st (как в galley_build.setState). */
export function visibleIn(st, id) {
  const f = S.featureById.get(id);
  if (!f) return false;
  if (f.kind === 'screw') return st.installed.has(f.bracket);
  if (f.kind === 'clamp') return st.installed.has(f.on);
  if (f.kind === 'film') return st.film.has(id);
  return st.installed.has(id);
}

/** Расписание видимости деталей по шагам 0..N: группы деталей с одинаковым расписанием. */
export function visibilityGroups(ids, stAt, N) {
  const groups = new Map();
  for (const id of ids) {
    let v = '';
    for (let i = 0; i <= N; i++) v += visibleIn(stAt(i), id) ? '1' : '0';
    if (!v.includes('1')) continue;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v).push(id);
  }
  return groups;
}

export function galleyTarget(world, viz, { onBegin, onEnd } = {}) {
  const g = world.galley;
  const N = STEPS.length;
  const states = [];
  const stAt = (i) => (states[i] ??= stateFrom(i, new Set()));
  const center = new THREE.Vector3(0, 1000, S.G.D / 2);
  let style = 'glasses';                         // по умолчанию — только в окне дисплея очков, как в AR
  let H = null;                                  // голограмма: { root, groups: [{ vec, obj }], perItem: Map, ids }
  let lastI = -1;
  const kitWas = new Map();
  const flying = new Map();                       // id → копия, которая сейчас подлетает

  /** Откуда подлетает деталь: от центра модуля наружу и сверху, мм. */
  function offsetFor(id) {
    const f = S.featureById.get(id);
    const c = f ? S.featureCenter(f) : [0, 1000, 800];
    const d = new THREE.Vector3(c[0] - center.x, 0, c[2] - center.z);
    if (d.lengthSq() < 1) d.set(0, 0, 1);
    return d.normalize().multiplyScalar(420).add(new THREE.Vector3(0, 380, 0));
  }

  /** Меши каждой детали (без пазов с клеем, вставок, дисплеев — у голограммы их нет). */
  function meshesByItem() {
    const owner = new Map([...g.items].map(([id, o]) => [o, id]));
    const skip = new Set([...g.grooves.map((x) => x.mesh), ...g.inserts.map((x) => x.mesh), ...g.displays]);
    const by = new Map();
    g.root.traverse((m) => {
      if (!m.isMesh || skip.has(m)) return;
      let o = m; while (o && !owner.has(o)) o = o.parent;
      if (!o) return;
      const id = owner.get(o);
      if (!by.has(id)) by.set(id, []);
      by.get(id).push(m);
    });
    return by;
  }

  function build() {
    const t0 = performance.now();
    const by = meshesByItem();
    const root = new THREE.Group();
    root.name = 'virtual-galley';
    g.root.updateMatrixWorld(true);
    root.matrixAutoUpdate = false;
    root.matrix.copy(g.root.matrixWorld);
    root.matrixWorldNeedsUpdate = true;
    const groups = [];
    for (const [vec, ids] of visibilityGroups([...by.keys()], stAt, N)) {
      const obj = holoObject(holoGeometry(ids.flatMap((id) => by.get(id)), g.root));
      root.add(obj);
      groups.push({ vec, ids, obj });
    }
    g.root.parent.add(root);
    root.visible = false;
    H = { root, groups, by, perItem: new Map(), ms: Math.round(performance.now() - t0) };
  }

  /** Отдельная копия детали для подлёта (создаётся при первом подлёте). */
  function itemHolo(id) {
    if (!H.perItem.has(id)) {
      const ms = H.by.get(id);
      const o = ms ? holoObject(holoGeometry(ms, g.root), true) : null;
      if (o) { setHoloLayer(o, style); o.visible = false; H.root.add(o); }
      H.perItem.set(id, o);
    }
    return H.perItem.get(id);
  }

  function setStyle(s) {
    style = s === 'glasses' ? 'glasses' : 'holo';
    if (H) setHoloLayer(H.root, style);
  }

  return {
    name: 'Стапель СТ-3 · модуль кухонный КМ-2',
    steps: STEPS.map((s) => ({ id: s.id, title: s.title, op: s.op })),
    get style() { return style; },
    get buildMs() { return H?.ms ?? null; },
    setStyle,
    begin() {
      if (!H) build();
      setHoloLayer(H.root, style);
      H.root.visible = true;
      g.root.visible = false;                                   // реальных деталей нет
      for (const [id, k] of world.kit) { kitWas.set(id, k.visible); k.visible = false; }
      viz.root.visible = false; viz.labels.visible = false;
      lastI = -1;
      onBegin?.();
    },
    apply(i, f) {
      const fly = f > 0 && i < N;
      // видимость сеток меняется только при смене шага (и на середине шага — у снимаемых деталей)
      const half = fly && f >= 0.5;
      const key = i * 2 + (half ? 1 : 0);
      if (key !== lastI) {
        for (const gr of H.groups) {
          const now = gr.vec[i] === '1', next = gr.vec[Math.min(N, i + 1)] === '1';
          gr.obj.visible = now && !(half && !next);
        }
        lastI = key;
      }
      // подлёт деталей перехода
      const want = new Set();
      if (fly) for (const gr of H.groups) if (gr.vec[i] === '0' && gr.vec[i + 1] === '1') gr.ids.forEach((id) => want.add(id));
      for (const [id, o] of flying) if (!want.has(id)) { o.visible = false; flying.delete(id); }
      if (!fly) return;
      const e = ease(f / 0.8);
      for (const id of want) {
        const o = itemHolo(id);
        if (!o) continue;
        o.visible = true;
        o.position.copy(offsetFor(id)).multiplyScalar(1 - e);
        flying.set(id, o);
      }
    },
    end() {
      for (const o of flying.values()) o.visible = false;
      flying.clear();
      if (H) H.root.visible = false;
      g.root.visible = true;
      for (const [id, k] of world.kit) k.visible = kitWas.get(id) ?? k.visible;
      onEnd?.();
    },
  };
}
