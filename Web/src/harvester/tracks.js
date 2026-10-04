// Гусеничные тележки: 4 блока, звенья (InstancedMesh), ведущие/направляющие звёздочки и опорные катки (InstancedMesh).
import * as THREE from 'three';
import { Parts } from './parts.js';

export const TRK = {
  cx: 30.5,        // |x| центров блоков
  cz: 18.3,        // |z| центров блоков
  width: 8.0,
  sprocketDX: 11,  // смещение звёздочек от центра блока по x
  wheelY: 4.75,    // высота осей
  chainR: 4.25,    // радиус осевой линии цепи вокруг звёздочек
  sprocketR: 3.95,
  roadR: 1.45,
  roadX: [-7.2, -3.6, 0, 3.6, 7.2],
  links: 74,
};
// units: порядок [передний-левый(борт -z), передний-правый(+z), задний-левый, задний-правый]
export const UNITS = [
  { x: TRK.cx, z: -TRK.cz, side: -1 }, { x: TRK.cx, z: TRK.cz, side: 1 },
  { x: -TRK.cx, z: -TRK.cz, side: -1 }, { x: -TRK.cx, z: TRK.cz, side: 1 },
];

const LOOP = (() => {
  const d = TRK.sprocketDX, R = TRK.chainR;
  const bottom = 2 * d, arc = Math.PI * R;
  return { d, R, bottom, arc, total: 2 * bottom + 2 * arc };
})();

/** Позиция/угол на цепи по параметру s ∈ [0,total): низ идёт от переднего края к заднему. */
function loopPoint(s, out) {
  const { d, R, bottom, arc, total } = LOOP;
  s = ((s % total) + total) % total;
  const yc = TRK.wheelY;
  if (s < bottom) { out.x = d - s; out.y = yc - R; out.a = 0; return; }              // низ: движется к -x
  s -= bottom;
  if (s < arc) { const t = s / R; out.x = -d - Math.sin(t) * R; out.y = yc - Math.cos(t) * R; out.a = -t; return; } // задняя дуга
  s -= arc;
  if (s < bottom) { out.x = -d + s; out.y = yc + R; out.a = -Math.PI; return; }                   // верх: к +x
  s -= bottom;
  const t = s / R; out.x = d + Math.sin(t) * R; out.y = yc + Math.cos(t) * R; out.a = -Math.PI - t;    // передняя дуга
}

function linkGeometry() {
  const P = new Parts(11);
  const w = TRK.width, L = LOOP.total / TRK.links;
  P.box(0, 0, 0, L * 0.94, 0.42, w, '#2b2926', 2, { jit: 0.1 });
  // грунтозацепы (наружу = вниз по локальной -y в нижнем положении: у нас наружная сторона -y после поворота a)
  for (const zz of [-2.7, 0, 2.7]) P.box(0, -0.44, zz, L * 0.5, 0.5, 1.5, '#4a443d', 3);
  P.box(0, -0.22, 0, 0.18, 0.1, w + 0.3, '#5d554b', 1);        // пальцы-шарниры
  P.box(0.0, 0.46, 0, L * 0.35, 0.5, 1.3, '#3a352f', 1);       // внутренний направляющий гребень
  P.box(0, 0.05, -w / 2 + 0.06, L * 0.9, 0.3, 0.12, '#4a443d', 1);
  P.box(0, 0.05, w / 2 - 0.06, L * 0.9, 0.3, 0.12, '#4a443d', 1);
  return P.merge();
}

function wheelGeometry(r, wdt, lugs, seed) {
  const P = new Parts(seed);
  P.cyl(0, 0, 0, r, r, wdt, '#5e564c', 1, { axis: 'z', seg: 28 });
  for (const s of [-1, 1]) {
    P.cyl(0, 0, s * (wdt / 2 + 0.12), r * 0.9, r * 0.9, 0.3, '#6a6055', 3, { axis: 'z', seg: 28 });
    P.cyl(0, 0, s * (wdt / 2 + 0.4), r * 0.32, r * 0.32, 0.45, '#262320', 2, { axis: 'z', seg: 14 });
    for (let i = 0; i < lugs; i++) {
      const a = (i / lugs) * Math.PI * 2 + (s > 0 ? 0 : Math.PI / lugs);
      P.cyl(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, s * (wdt / 2 + 0.28), r * 0.065, r * 0.065, 0.3, '#8a7f70', 1, { axis: 'z', seg: 6 });
      P.box(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, s * (wdt / 2 + 0.2), r * 0.17, r * 0.6, 0.15, '#2a2724', 2, { rz: a - Math.PI / 2 });
    }
  }
  // зубья (для звёздочки) / обод
  if (lugs > 6) for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    P.box(Math.cos(a) * r, Math.sin(a) * r, 0, 0.8, 0.5, wdt * 0.55, '#3b352f', 1, { rz: a });
  }
  return P.merge();
}

/** Статичная рама гусеничных блоков (в общий меш корпуса): щёки, верхние ролики, кожухи, полурамы. */
export function trackFrameParts(P) {
  const d = TRK.sprocketDX, yc = TRK.wheelY, w = TRK.width;
  for (const u of UNITS) {
    const inner = -u.side; // внутрь (к оси)
    // внутренняя щека, закрывающая блок со стороны корпуса
    P.box(u.x, yc, u.z + inner * (w / 2 - 0.15), 2 * d + 4.2, 5.4, 0.35, '#34322f', 3);
    // нижняя рама-балка и верхние ролики
    P.box(u.x, yc + 1.2, u.z + inner * (w / 2 - 0.9), 2 * d - 2, 0.7, 1.2, '#3f3b36', 1);
    for (const rx of [-6, 0, 6]) P.cyl(u.x + rx, yc + LOOP.R - 1.1, u.z, 0.9, 0.9, w - 1.2, '#51493f', 1, { axis: 'z', seg: 12 });
    // кожух над блоком (крыло) с наклонными носами
    P.box(u.x, 9.55, u.z, 2 * d + 5.2, 1.4, w + 0.8, '#7d5030', 0);
    P.box(u.x + (2 * d + 5) / 2 + 1.2, 9.2, u.z, 3.4, 1.0, w + 0.6, '#7d5030', 0, { rz: 0.45 });
    P.box(u.x - (2 * d + 5) / 2 - 1.2, 9.2, u.z, 3.4, 1.0, w + 0.6, '#7d5030', 0, { rz: -0.45 });
    // внешний щиток (с вырезами-«окнами» — планки), защита от песка
    P.box(u.x, 8.2, u.z - inner * (w / 2 + 0.05), 2 * d + 6, 0.8, 0.22, '#3a3835', 3);
    for (let i = -4; i <= 4; i++) P.box(u.x + i * 3.1, 7.2, u.z - inner * (w / 2 + 0.05), 0.5, 3.1, 0.2, '#3a3835', 3);
    // ступицы привода (редукторы) над звёздочками — большие колпаки
    for (const sx of [-d, d]) {
      P.cyl(u.x + sx, yc, u.z + inner * (w / 2 + 0.55), 1.9, 2.1, 1.0, '#6b4a2c', 0, { axis: 'z', seg: 18 });
      P.cyl(u.x + sx, yc, u.z + inner * (w / 2 + 1.3), 1.1, 1.1, 0.7, '#2b2926', 2, { axis: 'z', seg: 12 });
    }
  }
}

export function createTracks(game, material, quality) {
  const group = new THREE.Group();
  const total = TRK.links * UNITS.length;
  const linkMesh = new THREE.InstancedMesh(linkGeometry(), material, total);
  linkMesh.frustumCulled = false;
  linkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const col = new THREE.Color();
  const rr = (i) => { const x = Math.sin(i * 91.7) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < total; i++) { const k = 0.7 + rr(i) * 0.6; linkMesh.setColorAt(i, col.setRGB(k, k * (0.95 + rr(i + 7) * 0.1), k * 0.95)); }
  linkMesh.instanceColor.needsUpdate = true;
  group.add(linkMesh);

  const sprocketGeo = wheelGeometry(TRK.sprocketR, 5.6, 8, 21);
  const roadGeo = wheelGeometry(TRK.roadR, 5.4, 6, 22);
  const sprockets = new THREE.InstancedMesh(sprocketGeo, material, UNITS.length * 2);
  const roads = new THREE.InstancedMesh(roadGeo, material, UNITS.length * TRK.roadX.length);
  for (const m of [sprockets, roads]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(m); }

  const phase = new Float32Array(UNITS.length);      // путь цепи, м
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const pt = { x: 0, y: 0, a: 0 };
  const pitch = LOOP.total / TRK.links;

  function setWheel(mesh, idx, x, y, z, ang) {
    q.setFromAxisAngle(zAxis, ang);
    m4.compose(pos.set(x, y, z), q, one);
    mesh.setMatrixAt(idx, m4);
  }

  /** speeds[i] — линейная скорость цепи i-го блока (м/с, + = вперёд). */
  function update(dt, speeds, force) {
    for (let u = 0; u < UNITS.length; u++) {
      const U = UNITS[u];
      phase[u] += speeds[u] * dt;
      if (Math.abs(speeds[u]) < 1e-4 && !force) continue;
      // ВНИМАНИЕ: нижняя ветка бежит НАЗАД относительно корпуса при движении вперёд → s растёт при скорости > 0
      for (let i = 0; i < TRK.links; i++) {
        loopPoint(i * pitch + phase[u], pt);
        q.setFromAxisAngle(zAxis, pt.a);
        m4.compose(pos.set(U.x + pt.x, pt.y, U.z), q, one);
        linkMesh.setMatrixAt(u * TRK.links + i, m4);
      }
      // колёса: окружная скорость = скорость цепи; верх цепи едет вперёд → колесо вращается по часовой, если смотреть с +z
      const ang = -phase[u] / TRK.sprocketR;
      setWheel(sprockets, u * 2, U.x - LOOP.d, TRK.wheelY, U.z, ang);
      setWheel(sprockets, u * 2 + 1, U.x + LOOP.d, TRK.wheelY, U.z, ang);
      for (let k = 0; k < TRK.roadX.length; k++) setWheel(roads, u * TRK.roadX.length + k, U.x + TRK.roadX[k], TRK.roadR + 0.5, U.z, -phase[u] / TRK.roadR);
    }
    linkMesh.instanceMatrix.needsUpdate = true;
    sprockets.instanceMatrix.needsUpdate = true;
    roads.instanceMatrix.needsUpdate = true;
  }
  update(0, [0, 0, 0, 0], true);
  return { group, update, meshes: [linkMesh, sprockets, roads], loop: LOOP };
}
