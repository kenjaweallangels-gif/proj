// Интерьер харвестера: сборка комнат (лениво, по комнате за кадр), схема проходимости (полы/стены/мебель), анимация механизмов.
// Все запросы — в ЛОКАЛЬНЫХ координатах модели; обёртки «мир ↔ модель» — в index.js.
import * as THREE from 'three';
import { Plan, PAL } from './ibuild.js';
import { Parts } from './parts.js';
import { engineRoom, corridor, dorm, stills, mess, lab, gallery, feedHall, FACE } from './rooms_a.js';
import { hall, passage, chart, bridge } from './rooms_b.js';
import { createInteriorMaterial, createInteriorDecalTexture, createInteriorDecalMaterial, buildQuads, IATLAS, createScreenAtlas, INT_POWER } from './imaterial.js';
import { createGlowMaterial } from './material.js';
import { exteriorPlan } from './plan_ext.js';
import { createPlanQueries } from './plan_query.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const BUILDERS = [gallery, corridor, feedHall, hall, chart, bridge, passage, mess, dorm, stills, lab, engineRoom];

// ----------------------------------------------------------------------------------------------- геометрия механизмов
const G = {
  rod() { const P = new Parts(5); P.cyl(0, 0, 0, 0.17, 0.17, 1.2, '#a8a8a2', 1, { seg: 8 }); P.cyl(0, 0.62, 0, 0.3, 0.3, 0.12, '#55575a', 1, { seg: 8 }); return P.merge(); },
  wheel() {
    const P = new Parts(6);
    P.cyl(0, 0, 0, 1, 1, 0.34, '#7d807c', 1, { axis: 'x', seg: 28 });
    P.cyl(0, 0, 0, 0.9, 0.9, 0.48, '#4a4d4f', 2, { axis: 'x', seg: 28, open: false });
    P.cyl(0, 0, 0, 0.25, 0.25, 0.6, '#9a9d98', 1, { axis: 'x', seg: 12 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; P.box(0, Math.sin(a) * 0.55, Math.cos(a) * 0.55, 0.22, 0.12, 0.62, '#6d706c', 1, { rx: a - Math.PI / 2 }); }
    P.box(0.0, 0.0, 0.0, 0.1, 0.1, 0.1, '#000', 2);
    P.box(0.19, 0.0, 0.88, 0.06, 0.18, 0.2, '#c79a1c', 4);
    P.box(0.19, 0.88, 0.0, 0.06, 0.2, 0.18, '#c79a1c', 4);
    return P.merge();
  },
  fan() {
    const P = new Parts(7);
    P.cyl(0, 0, 0, 0.22, 0.22, 0.2, '#2a2c2e', 2, { seg: 10 });
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; P.box(Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62, 0.75, 0.04, 0.3, k % 2 ? '#8c8e8b' : '#c79a1c', 1, { ry: -a }); }
    return P.merge();
  },
  spin() { const P = new Parts(8); P.cyl(0, 0, 0, 1, 1, 0.08, '#b9bcb6', 1, { seg: 16 }); P.box(0, 0.05, 0, 1.6, 0.05, 0.14, '#c79a1c', 4); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; P.cyl(Math.cos(a) * 0.75, 0.12, Math.sin(a) * 0.75, 0.12, 0.12, 0.2, '#9fe6ff', 1, { seg: 6 }); } return P.merge(); },
  gear() { const P = new Parts(9); P.cyl(0, 0, 0, 1, 1, 0.26, '#8a8d88', 1, { axis: 'z', seg: 20 }); for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; P.box(Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0, 0.22, 0.22, 0.26, '#6e716d', 1, { rz: a }); } P.cyl(0, 0, 0.14, 0.2, 0.2, 0.1, '#c79a1c', 4, { axis: 'z', seg: 8 }); return P.merge(); },
  rotor() {
    const P = new Parts(10);
    P.cyl(0, 0, 0, 1, 1, 1, '#8f6a45', 3, { seg: 28 });
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; P.box(Math.cos(a) * 1.02, 0, Math.sin(a) * 1.02, 0.1, 1.0, 0.16, i % 4 === 0 ? '#c79a1c' : '#6d4a2c', i % 4 === 0 ? 4 : 3, { ry: -a }); }
    for (const y of [-0.5, 0, 0.5]) P.cyl(0, y, 0, 1.06, 1.06, 0.06, '#7d807c', 1, { seg: 28 });
    P.box(0, 0.5, 0, 2.1, 0.06, 0.2, '#c79a1c', 4);
    return P.merge();
  },
  cleat() { const P = new Parts(11); P.box(0, 0.05, 0, 0.16, 0.1, 1.0, '#4a443d', 3); return P.merge(); },
};

export function createInterior(game, root, quality) {
  const group = new THREE.Group();
  group.name = 'HarvesterInterior';
  group.visible = false;
  root.add(group);

  const plan = new Plan();
  const glowParts = new Parts(4);
  const rooms = [];
  const meshes = [];
  let intMat = null, glowMat = null, decalMat = null, scrAtlas = null, scrMat = null;   // создаются при первом шаге сборки
  const S = { built: false, step: 0, ready: false, assets: false, dyn: null, interactions: [] };
  exteriorPlan(plan);

  const addMesh = (geo, mat, name, shadow = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name; m.castShadow = false; m.receiveShadow = false; m.frustumCulled = true;
    group.add(m); meshes.push(m); return m;
  };

  // ----------------------------------------------------------------------------------- пошаговая сборка
  const decalGeos = [], screenGeos = [];
  const dynList = [];
  function buildNext() {
    if (!S.assets) {
      intMat = createInteriorMaterial(quality);
      glowMat = createGlowMaterial(true);
      decalMat = createInteriorDecalMaterial(createInteriorDecalTexture());
      scrAtlas = createScreenAtlas();
      scrMat = new THREE.MeshBasicMaterial({ map: scrAtlas.tex, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      S.assets = true;
      return;
    }
    if (S.step < BUILDERS.length) {
      const R = BUILDERS[S.step](plan, glowParts);
      rooms.push(R);
      const geo = R.P.merge();
      addMesh(geo, intMat, 'room_' + R.id);
      if (R.decals.length) decalGeos.push(buildQuads(R.decals, IATLAS, FACE, (c, n) => R._bake(c[0], c[1], c[2], n.x, n.y, n.z)));
      if (R.screens.length) {
        const list = R.screens.map((s) => ({ ...s, k: 'k' + s.k }));
        const atl = {}; for (let i = 0; i < 8; i++) atl['k' + i] = scrAtlas.cellUV(i);
        screenGeos.push(buildQuads(list, atl, FACE, () => [1, 1, 1], 0.02));
      }
      for (const d of R.dyn) { dynList.push({ ...d, room: R }); }
      for (const it of R.interact) S.interactions.push(it);
      S.step++;
      return;
    }
    // финал: свечение, декали, экраны, механизмы
    if (!S.built) {
      const ge = glowParts.merge();
      if (ge.attributes.position) addMesh(ge, glowMat, 'glow');
      const dg = decalGeos.filter((g) => g.attributes.position.count > 0);
      if (dg.length) addMesh(mergeGeometries(dg, false), decalMat, 'decals').renderOrder = 3;
      const sg = screenGeos.filter((g) => g.attributes.position.count > 0);
      if (sg.length) addMesh(mergeGeometries(sg, false), scrMat, 'screens').renderOrder = 3;
      S.dyn = buildDynamics(dynList);
      S.built = true; S.ready = true;
    }
  }

  // ----------------------------------------------------------------------------------- механизмы
  function buildDynamics(list) {
    const out = { groups: [] };
    const kinds = {};
    for (const d of list) (kinds[d.kind] ||= []).push(d);
    const lit = (R, c) => { const b = R._bake(c[0], c[1] - 0.3, c[2], 0, 0.6, 0.6); return new THREE.Color(Math.min(1.2, b[0]), Math.min(1.2, b[1]), Math.min(1.2, b[2])); };
    const mk = (kind, geo, list2, update) => {
      if (!list2?.length) return;
      const m = new THREE.InstancedMesh(geo, intMat, list2.length);
      m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      list2.forEach((d, i) => m.setColorAt(i, lit(d.room, d.c || d.a)));
      m.instanceColor.needsUpdate = true;
      group.add(m); meshes.push(m); m.name = 'dyn_' + kind;
      out.groups.push({ kind, mesh: m, list: list2, update });
    };
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), e = new THREE.Euler();
    const A = { piston: 0, wheel: 0, fan: 0, spin: 0, gear: 0, rotor: 0, belt: 0 };
    mk('piston', G.rod(), kinds.piston, (g, dt, st) => {
      A.piston += dt * (2 + 13 * st.eng);
      g.list.forEach((d, i) => { p.set(d.c[0], d.c[1] + 0.32 * Math.sin(A.piston + d.ph * 2.0) * (0.15 + 0.85 * st.eng), d.c[2]); m4.compose(p, q.identity(), sc.set(1, 1, 1)); g.mesh.setMatrixAt(i, m4); });
    });
    mk('wheel', G.wheel(), kinds.wheel, (g, dt, st) => {
      A.wheel += dt * 11 * st.eng;
      g.list.forEach((d, i) => { q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), A.wheel * (d.c[2] > 0 ? 1 : -1)); m4.compose(p.set(d.c[0], d.c[1], d.c[2]), q, sc.set(d.r, d.r, d.r)); g.mesh.setMatrixAt(i, m4); });
    });
    mk('fan', G.fan(), kinds.fan, (g, dt, st) => {
      A.fan += dt * (1 + 16 * st.eng);
      g.list.forEach((d, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), A.fan); m4.compose(p.set(d.c[0], d.c[1], d.c[2]), q, sc.set(d.r, 1, d.r)); g.mesh.setMatrixAt(i, m4); });
    });
    mk('spin', G.spin(), kinds.spin, (g, dt, st) => {
      A.spin += dt * (st.eng > 0.05 ? 24 : 1.5);
      g.list.forEach((d, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), A.spin); m4.compose(p.set(d.c[0], d.c[1], d.c[2]), q, sc.set(d.r, 1, d.r)); g.mesh.setMatrixAt(i, m4); });
    });
    mk('spinz', G.gear(), kinds.spinz, (g, dt, st) => {
      A.gear += dt * 2.4 * st.belt;
      g.list.forEach((d, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), A.gear * (i % 2 ? -1 : 1)); m4.compose(p.set(d.c[0], d.c[1], d.c[2]), q, sc.set(d.r, d.r, 1)); g.mesh.setMatrixAt(i, m4); });
    });
    mk('rotor', G.rotor(), kinds.rotor, (g, dt, st) => {
      A.rotor += dt * 3.8 * st.belt * (0.4 + 0.6 * st.eng);
      g.list.forEach((d, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), A.rotor * d.dir); m4.compose(p.set(d.c[0], d.c[1], d.c[2]), q, sc.set(d.r, d.h, d.r)); g.mesh.setMatrixAt(i, m4); });
    });
    // ленты: каждая лента — свой набор планок (общая геометрия)
    const belts = kinds.belt || [];
    if (belts.length) {
      const total = belts.reduce((s2, b) => s2 + b.n, 0);
      const fake = belts.flatMap((b) => Array.from({ length: b.n }, (_, i) => ({ room: b.room, a: b.a, belt: b, i })));
      const mesh = new THREE.InstancedMesh(G.cleat(), intMat, total);
      mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      fake.forEach((d, i) => mesh.setColorAt(i, lit(d.room, d.a)));
      mesh.instanceColor.needsUpdate = true;
      group.add(mesh); meshes.push(mesh); mesh.name = 'dyn_belt';
      out.groups.push({ kind: 'belt', mesh, list: fake, update: (g, dt, st) => {
        A.belt += dt * 1.1 * st.belt;
        const zA = new THREE.Vector3(0, 0, 1);
        g.list.forEach((d, i) => {
          const b = d.belt, L = Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]);
          const u = (((d.i / b.n + A.belt * (1.0 / Math.max(2, L / 6))) % 1) + 1) % 1;
          const ang = Math.atan2(b.b[1] - b.a[1], b.b[0] - b.a[0]);
          q.setFromAxisAngle(zA, ang);
          m4.compose(p.set(b.a[0] + (b.b[0] - b.a[0]) * u, b.a[1] + (b.b[1] - b.a[1]) * u, b.a[2]), q, sc.set(1, 1, b.hw * 2));
          g.mesh.setMatrixAt(i, m4);
        });
      } });
    }
    return out;
  }

  // ----------------------------------------------------------------------------------- запросы (локальные координаты)
  const Q = createPlanQueries(plan);
  const { floorAt, floorBelow, contains, ceilingAt, collide } = Q;
  function roomAt(x, z, y) {
    for (const R of rooms) { const b = R.b; if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 - 1 && y <= b.y1 + 1) return R; }
    return null;
  }

  // ----------------------------------------------------------------------------------- обновление
  const _c = new THREE.Color();
  function update(dt, time, st, opts = {}) {
    if (opts.build && !S.ready) buildNext();
    group.visible = !!opts.visible && S.ready;
    if (!group.visible) return;
    // питание: полный свет при работающих двигателях; на стоянке — «дежурный» свет; при запуске мерцание
    const running = st.eng;
    let pw = 0.78 + 0.22 * running;
    if (st.state === 'starting') pw *= 0.8 + 0.2 * Math.sin(time * 37) * Math.sin(time * 11 + 1.0);
    if (opts.alarm > 0.05) pw *= 0.85 + 0.15 * Math.sin(time * 6);
    INT_POWER.value = Math.max(0.2, pw);
    glowMat.color.setScalar(0.55 + 0.45 * Math.min(1, pw));
    scrMat.color.setScalar(0.6 + 0.4 * Math.min(1, pw));
    scrAtlas.draw(time, st);
    if (S.dyn) for (const g of S.dyn.groups) { g.update(g, dt, st); g.mesh.instanceMatrix.needsUpdate = true; }
  }

  return {
    group, plan, rooms, update, floorAt, floorBelow, contains, ceilingAt, collide, roomAt,
    get ready() { return S.ready; }, get progress() { return S.built ? 1 : (S.step + (S.assets ? 1 : 0)) / (BUILDERS.length + 2); },
    interactions: S.interactions,
    stats() { let tris = 0, draws = 0; for (const m of meshes) { draws++; const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1); } return { draws, tris: Math.round(tris), blockers: plan.blockers.length, floors: plan.floors.length }; },
  };
}
