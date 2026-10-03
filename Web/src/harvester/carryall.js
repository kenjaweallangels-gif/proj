// Переносчик гильдии: тяжёлый орнитоптер, парящий над харвестером; четыре крыла гудят (взмахи ~1.8 Гц).
// Оригинальная конструкция: веретенообразный фюзеляж, тандемные крылья, четыре «лапы»-захвата под брюхом.
import * as THREE from 'three';
import { Parts } from './parts.js';
import { C } from './hull.js';

const _m = new THREE.Matrix4();

function fuselage() {
  const P = new Parts(1201);
  const pts = [[0.15, 17], [1.4, 16.2], [2.6, 14.4], [3.7, 11], [4.3, 6], [4.5, 0], [4.2, -6], [3.3, -11], [2.1, -14.5], [1.0, -17], [0.4, -18.5]]
    .map(([r, x]) => new THREE.Vector2(r, x));
  const lathe = new THREE.LatheGeometry(pts, 20);
  lathe.rotateZ(-Math.PI / 2);
  _m.makeScale(1, 0.88, 1.12);
  P._push(lathe, '#c4b08a', 0, 0.02, _m);
  // обшивка-пояса
  for (const x of [10, 5, 0, -5, -10]) P.cyl(x, 0, 0, 4.55 - Math.abs(x) * 0.03, 4.55 - Math.abs(x) * 0.03, 0.35, C.TEAL, 1, { axis: 'x', seg: 20, jit: 0.04 });
  // кабина: каркас
  P.box(11.5, 2.2, 0, 3.4, 0.2, 3.4, '#4b4640', 1);
  // горбатый моторный отсек
  P.box(-2, 4.4, 0, 12, 1.4, 4.6, '#a98d65', 0);
  for (let i = 0; i < 6; i++) P.box(-6.5 + i * 1.8, 5.2, 0, 0.14, 0.5, 4.8, '#4b4640', 1);
  // хвост
  P.box(-17, 3.0, 0, 5.0, 5.4, 0.3, '#a98d65', 0, { rz: 0.35 });
  P.box(-18, 0.4, 0, 4.0, 0.3, 9.0, '#a98d65', 0);
  P.box(-18, 0.4, 0, 4.0, 0.35, 0.4, C.TEAL, 0);
  // грузовые лапы-захваты (под брюхом)
  for (const [x, z] of [[4, 3.4], [4, -3.4], [-9, 3.0], [-9, -3.0]]) {
    P.cyl(x, -4.4, z, 0.45, 0.6, 3.6, '#3a3d40', 1, { seg: 8 });
    P.box(x, -6.4, z, 1.3, 0.5, 2.6, C.YEL, 4);
    for (const s of [-1, 1]) P.box(x, -7.3, z + s * 1.2, 0.5, 1.8, 0.4, '#3a3d40', 1, { rx: s * -0.3 });
  }
  // двигатели-гондолы на пилонах под крыльями
  for (const [x, z] of [[5, 7.5], [5, -7.5], [-5.5, 7.5], [-5.5, -7.5]]) {
    P.cyl(x, 0.2, z, 1.2, 1.5, 4.8, '#4b4640', 3, { axis: 'x', seg: 12 });
    P.cyl(x + 2.5, 0.2, z, 1.35, 1.2, 0.5, '#25221f', 2, { axis: 'x', seg: 12 });
    P.box(x, 1.2, z * 0.7, 0.4, 1.8, 0.4, '#4b4640', 1);
  }
  return P.merge();
}

function wingGeo() {
  const P = new Parts(1202);
  const span = 23, n = 7;
  P.cyl(0, 0.0, span / 2, 0.38, 0.28, span, '#3d3a35', 1, { axis: 'z', seg: 8, rx: 0 });   // лонжерон (передняя кромка)
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, z0 = t0 * span, z1 = t1 * span;
    const chord = 9.5 - 5.5 * (t0 + t1) / 2, zc = (z0 + z1) / 2;
    P.box(-chord / 2 - 0.2, -0.05, zc, chord, 0.22, z1 - z0 - 0.15, i % 2 ? '#b8956a' : '#a8855c', 0, { jit: 0.06 });
    P.box(-chord - 0.2, -0.05, zc, 0.3, 0.3, z1 - z0, '#3d3a35', 1);
    // нервюры
    P.box(-chord / 2 - 0.2, 0.12, z1 - 0.05, chord, 0.18, 0.18, '#3d3a35', 1);
  }
  // сигнальные полосы на законцовке
  P.box(-2.2, 0.15, span - 1.0, 4.3, 0.1, 1.6, C.YEL, 4);
  return P.merge();
}

/** Спасательная капсула экипажа: веретено 8 м с иллюминатором; в сценарии «пожирание» взлетает с крыши к переносчику. */
function podGeo() {
  const P = new Parts(1210);
  P.cyl(0, 0, 0, 2.2, 2.2, 6.4, '#c4b08a', 0, { axis: 'x', seg: 14, jit: 0.03 });
  P.cyl(3.6, 0, 0, 0.9, 2.2, 1.6, '#c4b08a', 0, { axis: 'x', seg: 14, jit: 0.03 });
  P.cyl(-3.6, 0, 0, 2.0, 1.6, 0.9, '#4b4640', 1, { axis: 'x', seg: 14 });
  P.cyl(1.0, 0, 0, 2.28, 2.28, 0.5, C.TEAL, 1, { axis: 'x', seg: 14 });
  P.box(0.2, 2.35, 0, 1.6, 0.35, 0.6, C.YEL, 4);
  P.cyl(0, 2.6, 0, 0.16, 0.16, 1.5, '#7a2e1e', 2, { seg: 6 });
  return P.merge();
}

export function createCarryall(game, hullMat, glowMat, lampMat, quality) {
  const group = new THREE.Group();
  group.name = 'Carryall';
  const body = new THREE.Group();
  group.add(body);
  const fus = new THREE.Mesh(fuselage(), hullMat);
  fus.frustumCulled = false; fus.castShadow = false;
  body.add(fus);
  // стекло кабины (свечение)
  const G = new Parts(1203);
  G.box(14.0, 2.0, 0, 1.2, 1.2, 3.0, '#ffcf7a', 0, { rz: -0.5, jit: 0.1 });
  G.box(12.5, 2.7, 0, 3.0, 1.0, 3.4, '#ffcf7a', 0, { rz: -0.2, jit: 0.1 });
  for (const z of [-1, 1]) G.box(-1, 3.2, z * 4.15, 8, 0.3, 0.1, '#ffd9a0', 0);
  const glass = new THREE.Mesh(G.merge(), glowMat); glass.frustumCulled = false; body.add(glass);

  const wings = new THREE.InstancedMesh(wingGeo(), hullMat, 4);
  wings.frustumCulled = false; wings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.add(wings);

  const WROOT = [[5, 2.4, 3.6, 0], [5, 2.4, -3.6, 1], [-5.5, 2.4, 3.6, 0], [-5.5, 2.4, -3.6, 1]];
  const q = new THREE.Quaternion(), qy = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const xAx = new THREE.Vector3(1, 0, 0), yAx = new THREE.Vector3(0, 1, 0);
  const state = { a: Math.random() * 6.28, hd: 0, x: 0, z: 0 };
  // Сценарный режим (пожирание харвестера): позу задаёт червь/сцена. on=false — штатная орбита над харвестером.
  const script = { on: false, pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, flap: 12, strain: 0, hidden: false };

  // Подъёмные тросы: 4 стальных каната от лап-захватов переносчика к крышевым захватам харвестера
  const CAB_N = 4, CAB_SEG = 10;
  const cabMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 1, 6, 1, true), new THREE.MeshStandardMaterial({ color: '#34322e', roughness: 0.5, metalness: 0.8 }), CAB_N * CAB_SEG);
  cabMesh.frustumCulled = false; cabMesh.count = 0; cabMesh.castShadow = false;
  const LUG_LOCAL = [[4, -7.8, 3.4], [4, -7.8, -3.4], [-9, -7.8, 3.0], [-9, -7.8, -3.0]];
  const lugWorld = LUG_LOCAL.map(() => new THREE.Vector3());
  const cabQ = new THREE.Quaternion(), cabM = new THREE.Matrix4(), cabP = Array.from({ length: CAB_SEG + 1 }, () => new THREE.Vector3()), cabD = new THREE.Vector3(), cabC = new THREE.Vector3(), cabS = new THREE.Vector3();
  const UPV = new THREE.Vector3(0, 1, 0);
  /** targets: 4 мировых точки на харвестере; tension 0 (провис) … 1 (струна); vib — амплитуда дрожи, м. */
  function setCables(targets, tension = 1, vib = 0, time = 0) {
    if (!targets) { cabMesh.count = 0; return; }
    let n = 0;
    for (let i = 0; i < CAB_N; i++) {
      const A = lugWorld[i], B = targets[i];
      const len = A.distanceTo(B);
      const sag = (1 - tension) * len * 0.16;
      for (let k = 0; k <= CAB_SEG; k++) {
        const u = k / CAB_SEG, w = u * (1 - u) * 4;
        cabP[k].lerpVectors(A, B, u);
        cabP[k].y -= sag * w;
        const wig = vib * w * Math.sin(u * 9 + time * 19 + i * 1.7);
        cabP[k].x += wig; cabP[k].z += wig * 0.6;
      }
      for (let k = 0; k < CAB_SEG; k++) {
        const a = cabP[k], b = cabP[k + 1];
        cabD.subVectors(b, a); const l = cabD.length();
        if (!(l > 1e-4)) { cabS.set(0, 0, 0); cabM.compose(a, cabQ.identity(), cabS); cabMesh.setMatrixAt(n++, cabM); continue; }
        cabD.multiplyScalar(1 / l);
        cabQ.setFromUnitVectors(UPV, cabD);
        cabC.addVectors(a, b).multiplyScalar(0.5);
        cabM.compose(cabC, cabQ, cabS.set(1, l, 1));
        cabMesh.setMatrixAt(n++, cabM);
      }
    }
    cabMesh.count = n;
    cabMesh.instanceMatrix.needsUpdate = true;
  }
  // капсула экипажа
  const pod = new THREE.Mesh(podGeo(), hullMat);
  pod.frustumCulled = false; pod.visible = false;
  const podGlow = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), glowMat); podGlow.position.set(2.2, 0.5, 1.9); pod.add(podGlow);
  const podGlow2 = podGlow.clone(); podGlow2.position.z = -1.9; pod.add(podGlow2);

  const hover = { orbit: 0, flap: 0 };
  const _p = new THREE.Vector3();

  function update(dt, time, H) {
    if (!group.visible) return;
    if (script.on) {
      group.position.copy(script.pos);
      body.rotation.set(script.roll, -script.yaw, script.pitch, 'YZX');
      hover.flap += dt * script.flap;
      flapWings();
      body.updateMatrixWorld(true);
      for (let i = 0; i < 4; i++) lugWorld[i].set(LUG_LOCAL[i][0], LUG_LOCAL[i][1], LUG_LOCAL[i][2]).applyMatrix4(body.matrixWorld);
      return;
    }
    hover.orbit += dt * 0.045;
    const R = 34;
    const cx = H.x - 4 + Math.cos(hover.orbit) * R, cz = H.z + Math.sin(hover.orbit) * R * 0.75;
    const wy = Math.max(H.y, 0) + 62 + Math.sin(time * 0.35) * 2.2;
    const tx = -Math.sin(hover.orbit) * R, tz = Math.cos(hover.orbit) * R * 0.75;
    const hd = Math.atan2(tz, tx);
    group.position.set(cx, wy, cz);
    // фюзеляж смотрит по касательной к орбите; лёгкий крен в вираже и покачивание
    body.rotation.set(0.04 * Math.sin(time * 0.6) + 0.07, -hd, 0.03 * Math.sin(time * 0.43), 'YZX');
    // взмахи: частота выше при работающем комбайне (пилоты «на связи»)
    const w = 9 + (H.running ? 3 : 0);
    hover.flap += dt * w;
    flapWings();
    group.visible = true;
  }
  function flapWings() {
    const amp = 1 + 0.5 * script.strain;
    for (let i = 0; i < 4; i++) {
      const [x, y, z, left] = WROOT[i];
      const ph = hover.flap + (x < 0 ? 0.9 : 0);
      const ang = -(0.12 + 0.38 * amp * Math.sin(ph)) * (1 + 0.15 * Math.sin(ph * 0.5));
      q.setFromAxisAngle(xAx, ang);
      if (left) { qy.setFromAxisAngle(yAx, Math.PI); q.premultiply(qy); }
      _p.set(x, y, z);
      _m.compose(_p, q, one);
      wings.setMatrixAt(i, _m);
    }
    wings.instanceMatrix.needsUpdate = true;
  }
  /** Поставить капсулу: pos — центр (мир), yaw — курс. */
  function setPod(pos, yaw, visible = true, pitch = 0) {
    pod.visible = visible;
    if (visible) { pod.position.copy(pos); pod.rotation.set(0, -yaw, pitch, 'YZX'); }
  }
  return { group, update, script, setCables, setPod, pod, cabMesh, lugWorld, body, get lugLocal() { return LUG_LOCAL; } };
}
