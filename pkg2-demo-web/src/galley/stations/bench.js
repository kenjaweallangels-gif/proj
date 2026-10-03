// Участок СЛ-1 «Слесарный»: верстак со стальной столешницей, тумбой и перфопанелью инструмента, слесарные
// тиски; вертикально-сверлильный станок со станочными тисками; точильно-шлифовальный станок; ручной реечный
// пресс для запрессовки; гидравлический листогибочный пресс 40 т с V-матрицей, задним упором, педалью и
// световой завесой. Изделие — кронштейн КМ2.310.050 из листа Д16АТ 2 мм: разметка → сверление 4 отв. Ø6,4 →
// снятие заусенцев → гибка 90° → запрессовка втулок → обезжиривание → оксидирование → контроль.
// Заготовка переходит от станка к станку; шпиндель, пуансон и шток пресса движутся в такт переходу.
import * as THREE from 'three';
import { M, Station, box, cyl, ease, floorZone, hangingSign, infoStand, at, rod, safetySign, shadowBoardTexture, sign } from './kit.js';

// где лежит кронштейн на каждом переходе (СК участка) и высота опоры
const AT = { bench: [0.25, 0.912, 0.12], drill: [-2.05, 0.906, 0.12], brake: [3.55, 0.919, 0.15], arbor: [1.65, 0.987, 0.06], done: [-0.2, 0.946, 0.2] };
const WHERE = ['bench', 'drill', 'bench', 'brake', 'arbor', 'bench', 'bench', 'bench'];

function bracket() {
  const g = new THREE.Group();
  const alu = M.alu(), al = new THREE.MeshPhysicalMaterial({ color: '#c8cbcf', metalness: 0.85, roughness: 0.35 });
  const A = new THREE.Group(); g.add(A);
  A.add(box(0.06, 0.002, 0.06, al, -0.03, 0.001, 0, 0.0008));
  const B = new THREE.Group(); g.add(B);                          // вторая полка — поворачивается по линии гиба
  B.add(box(0.06, 0.002, 0.06, al, 0.03, 0.001, 0, 0.0008));
  const marks = new THREE.Group();
  const mk = new THREE.MeshBasicMaterial({ color: '#2a2d30' });
  for (const [x, z] of [[-0.045, -0.018], [-0.045, 0.018], [0.045, -0.018], [0.045, 0.018]]) {
    marks.add(box(0.012, 0.0004, 0.0006, mk, x, 0.0022, z, 0), box(0.0006, 0.0004, 0.012, mk, x, 0.0022, z, 0));
  }
  marks.add(box(0.0006, 0.0004, 0.06, mk, 0, 0.0022, 0, 0));
  g.add(marks);
  const holes = [];
  for (const [x, z, leg] of [[-0.045, -0.018, A], [-0.045, 0.018, A], [0.045, -0.018, B], [0.045, 0.018, B]]) {
    const h = cyl(0.0032, 0.0026, M.plastic('#0b0c0d', 0.6), x, 0.001, z, 16); leg.add(h); holes.push(h);
  }
  const bushings = [];
  for (const z of [-0.018, 0.018]) { const b = cyl(0.0042, 0.008, M.steel(), 0.045, 0.004, z, 16); B.add(b); bushings.push(b); }
  g.userData = { A, B, marks, holes, bushings, al, alu };
  return g;
}

export function benchStation() {
  const st = new Station({
    id: 'sl1', short: 'Участок СЛ-1 · слесарный', name: 'Слесарный участок СЛ-1 — мелкие узлы, сверление, гибка, запрессовка', product: 'кронштейн КМ2.310.050',
    center: [14.6, 9.2], yaw: Math.PI,
    build(st) {
      const R = st.root;
      st.machines = new Map();
      R.add(floorZone(8.2, 3.6));
      R.add(hangingSign(['СЛЕСАРНЫЙ УЧАСТОК СЛ-1'], 2.2));
      const frame = M.frameGrey();
      // ---- верстак: столешница, тумба с ящиками, перфопанель с инструментом, тиски ----
      const bench = new THREE.Group(); R.add(bench);
      bench.add(box(2.0, 0.05, 0.8, M.steelTop(), 0, 0.885, 0.05, 0.006));
      bench.add(box(0.55, 0.8, 0.7, M.machineBlue(), 0.68, 0.43, 0.05, 0.01));
      for (let k = 0; k < 4; k++) { bench.add(box(0.5, 0.17, 0.01, M.machineBlue(), 0.68, 0.16 + k * 0.19, 0.405, 0.004)); bench.add(box(0.2, 0.015, 0.02, M.chrome(), 0.68, 0.2 + k * 0.19, 0.415, 0.004)); }
      for (const x of [-0.95]) for (const z of [-0.3, 0.4]) bench.add(box(0.05, 0.86, 0.05, frame, x, 0.43, z, 0.004));
      bench.add(box(2.04, 0.94, 0.03, M.frameGrey(), 0, 1.36, -0.35, 0.006));
      // теневая доска 5S: контуры инструмента в тех же местах, где он висит (u, v — от левого верхнего угла)
      const U = (x) => (x + 1.0) / 2.0, Vt = (y) => (1.81 - y) / 0.9;
      const outlines = [
        ...Array.from({ length: 8 }, (_, k) => ({ x: U(-0.85 + k * 0.035), y: Vt(1.55 - k * 0.006 + (0.1 + k * 0.012) / 2) - 0.01, w: 0.024, h: (0.1 + k * 0.012) / 0.9 + 0.02, shape: 'wrench', label: k === 0 ? '' : '' })),
        ...Array.from({ length: 6 }, (_, k) => ({ x: U(-0.45 + k * 0.05), y: Vt(1.545) , w: 0.018, h: 0.25, shape: 'screwdriver' })),
        ...Array.from({ length: 4 }, (_, k) => ({ x: U(-0.05 + k * 0.035), y: Vt(1.44), w: 0.012, h: 0.32, shape: 'rect' })),
        { x: U(0.2), y: Vt(1.445), w: 0.06, h: 0.3, shape: 'hammer' },
        { x: U(0.48), y: Vt(1.59), w: 0.19, h: 0.1, shape: 'rect' },
        { x: U(0.78), y: Vt(1.468), w: 0.11, h: 0.05, shape: 'rect' },
        { x: U(0.72), y: Vt(1.39), w: 0.11, h: 0.17, shape: 'rect' },
      ];
      const labels = [[U(-0.73), Vt(1.33), 'КЛЮЧИ 8–19'], [U(-0.33), Vt(1.3), 'ОТВЁРТКИ'], [U(0.0), Vt(1.12), 'НАПИЛЬНИКИ'], [U(0.2), Vt(1.12), 'МОЛОТОК 300 г'], [U(0.48), Vt(1.47), 'НОЖОВКА'], [U(0.78), Vt(1.2), 'ШЦ-I · УГОЛЬНИК']];
      const sbTex = shadowBoardTexture([...outlines, ...labels.map(([x, y, label]) => ({ x, y, w: 0, h: 0, shape: 'rect', label }))], { title: 'ТЕНЕВАЯ ДОСКА 5S · ВЕРСТАК СЛ-1-01 · ВЕРНИ ИНСТРУМЕНТ НА МЕСТО' });
      const sb = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.9), new THREE.MeshStandardMaterial({ map: sbTex, roughness: 0.7 })); sb.position.set(0, 1.36, -0.333); bench.add(sb);
      const plate = sign(['Верстак слесарный СЛ-1-01', 'ответственный: мастер участка Козлов А. В.'], 0.5, 0.09, { bg: '#ffffff', size: 50 }); plate.position.set(-0.45, 0.82, 0.452); bench.add(plate);
      // инструмент на перфопанели: ключи, отвёртки, напильники, молоток, ножовка, угольник, штангенциркуль
      for (let k = 0; k < 8; k++) bench.add(box(0.016, 0.1 + k * 0.012, 0.006, M.chrome(), -0.85 + k * 0.035, 1.55 - k * 0.006, -0.32, 0.002));
      for (let k = 0; k < 6; k++) { bench.add(cyl(0.011, 0.09, M.plastic(['#c43a2a', '#e3b41c', '#2f6fb0'][k % 3]), -0.45 + k * 0.05, 1.5, -0.31, 12)); bench.add(rod([-0.45 + k * 0.05, 1.45, -0.31], [-0.45 + k * 0.05, 1.33, -0.31], 0.003, M.steel())); }
      for (let k = 0; k < 4; k++) bench.add(box(0.014, 0.28, 0.004, M.steel(), -0.05 + k * 0.035, 1.3, -0.32, 0.001));
      bench.add(box(0.03, 0.25, 0.02, M.plastic('#5a3a22', 0.6), 0.2, 1.3, -0.31, 0.006), box(0.1, 0.035, 0.035, M.steel(), 0.2, 1.43, -0.31, 0.006));
      bench.add(box(0.36, 0.08, 0.006, M.orange(), 0.48, 1.55, -0.32, 0.004), box(0.3, 0.012, 0.002, M.steel(), 0.48, 1.5, -0.32, 0.001));
      bench.add(box(0.2, 0.012, 0.004, M.steel(), 0.75, 1.25, -0.32, 0.001), box(0.012, 0.15, 0.004, M.steel(), 0.66, 1.31, -0.32, 0.001));
      bench.add(box(0.2, 0.035, 0.006, M.steel(), 0.78, 1.45, -0.32, 0.002));
      // слесарные тиски
      const vise = new THREE.Group(); vise.position.set(-0.75, 0.91, 0.32); bench.add(vise);
      vise.add(box(0.14, 0.03, 0.2, M.machineGreen(), 0, 0.015, 0, 0.006), box(0.16, 0.09, 0.05, M.machineGreen(), 0, 0.075, -0.06, 0.008), box(0.16, 0.09, 0.05, M.machineGreen(), 0, 0.075, 0.03, 0.008));
      vise.add(box(0.15, 0.03, 0.008, M.steel(), 0, 0.105, -0.034, 0.001), box(0.15, 0.03, 0.008, M.steel(), 0, 0.105, 0.004, 0.001));
      vise.add(rod([0, 0.06, 0.06], [0, 0.06, 0.16], 0.008, M.steel()), rod([-0.08, 0.06, 0.16], [0.08, 0.06, 0.16], 0.005, M.steel()));
      // разметочный инструмент, кернер, штангенциркуль, шабер, лоток деталей
      bench.add(box(0.15, 0.004, 0.01, M.steel(), 0.0, 0.915, 0.3, 0.001), box(0.012, 0.004, 0.12, M.steel(), -0.07, 0.915, 0.25, 0.001));
      bench.add(rod([0.45, 0.915, 0.3], [0.55, 0.915, 0.33], 0.004, M.steel()));
      const tray = new THREE.Group(); tray.position.set(-0.35, 0.91, 0.2); tray.add(box(0.3, 0.03, 0.2, M.plastic('#2f6fb0', 0.5), 0, 0.015, 0, 0.004)); bench.add(tray);
      st.machines.set('bench', bench);
      // ---- вертикально-сверлильный станок ----
      const dp = new THREE.Group(); dp.position.set(-2.05, 0, 0.0); R.add(dp);
      dp.add(box(0.5, 0.06, 0.4, M.machineGreen(), 0, 0.03, 0, 0.01));
      dp.add(cyl(0.045, 1.75, M.chrome(), 0, 0.9, -0.12, 24));
      dp.add(box(0.36, 0.05, 0.36, M.machineGreen(), 0, 0.86, 0.06, 0.01));                                  // стол
      dp.add(box(0.12, 0.08, 0.14, M.machineGreen(), 0, 0.81, -0.08, 0.01));
      const mv = new THREE.Group(); mv.position.set(0, 0.885, 0.12); dp.add(mv);                             // станочные тиски
      mv.add(box(0.16, 0.02, 0.12, M.machineBlue(), 0, 0.0, 0, 0.004), box(0.16, 0.04, 0.02, M.machineBlue(), 0, 0.03, -0.05, 0.004), box(0.16, 0.04, 0.02, M.machineBlue(), 0, 0.03, 0.05, 0.004));
      const head = new THREE.Group(); head.position.set(0, 1.45, 0); dp.add(head);
      head.add(box(0.32, 0.26, 0.48, M.machineGreen(), 0, 0, -0.05, 0.02));
      head.add(box(0.34, 0.12, 0.3, M.machineGreen(), 0, 0.2, -0.05, 0.02));                                  // кожух ремня
      const motor = cyl(0.085, 0.24, M.machineGreen(), 0, 0.02, -0.38, 24); motor.rotation.x = Math.PI / 2; head.add(motor);
      const spindle = new THREE.Group(); spindle.position.set(0, -0.13, 0.12); head.add(spindle);
      spindle.add(cyl(0.022, 0.12, M.chrome(), 0, -0.06, 0, 20), cyl(0.026, 0.06, M.steel(), 0, -0.15, 0, 20), cyl(0.0032, 0.08, M.plastic('#2a2a2a', 0.3), 0, -0.22, 0, 10));
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; head.add(rod([0.17, -0.02, 0.05], [0.17 + Math.cos(a) * 0.002, -0.02 + Math.sin(a) * 0.18, 0.05 + Math.cos(a) * 0.18], 0.007, M.chrome())); }
      head.add(box(0.05, 0.05, 0.02, M.red(), -0.1, 0.0, 0.2, 0.01));
      const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 20, 1, true, 0, Math.PI), new THREE.MeshPhysicalMaterial({ color: '#d9e4e8', transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      guard.position.set(0, -0.28, 0.12); guard.rotation.y = Math.PI / 2; head.add(guard);
      const dps = sign(['Станок вертикально-сверлильный 2Н112'], 0.4, 0.06, { bg: '#ffffff', size: 54 }); dps.position.set(0, 0.2, 0.21); dps.rotation.x = -0.2; dp.add(dps);
      st.spindle = spindle; st.machines.set('drill', dp);
      const sg1 = safetySign('glasses', 'Работать\nв защитных очках', 0.2); sg1.position.set(0, 1.2, -0.105); dp.add(sg1);
      const sg2 = safetySign('danger', 'Не работать в перчатках\nу вращающихся частей', 0.2); sg2.position.set(0.22, 1.2, -0.105); dp.add(sg2);
      // ---- точильно-шлифовальный станок на тумбе ----
      const gr = new THREE.Group(); gr.position.set(-3.35, 0, 0.0); R.add(gr);
      gr.add(cyl(0.12, 0.9, frame, 0, 0.45, 0, 20), box(0.4, 0.04, 0.4, frame, 0, 0.02, 0, 0.006));
      gr.add(box(0.2, 0.16, 0.18, M.machineGreen(), 0, 0.98, 0, 0.02));
      for (const s of [-1, 1]) { const w = cyl(0.09, 0.03, M.plastic(s < 0 ? '#9a9da0' : '#6a5a4a', 0.9), s * 0.16, 1.0, 0, 28); w.rotation.z = Math.PI / 2; gr.add(w);
        const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.045, 24, 1, false, 0, Math.PI * 1.3), M.machineGreen()); cover.rotation.z = Math.PI / 2; cover.position.set(s * 0.16, 1.0, 0); gr.add(cover); }
      const gs = sign(['Станок точильно-шлифовальный', 'круги 175 × 20 · экраны опустить'], 0.36, 0.08, { bg: '#ffffff', size: 50 }); gs.position.set(0, 0.7, 0.122); gr.add(gs);
      const gsg = safetySign('glasses', 'Работать\nв защитных очках', 0.18); gsg.position.set(0, 1.35, -0.05); gr.add(gsg);
      gr.add(rod([0, 0.9, -0.05], [0, 1.22, -0.05], 0.01, M.frameGrey()));
      // ---- ручной реечный пресс для запрессовки ----
      const ap = new THREE.Group(); ap.position.set(1.65, 0, 0.0); R.add(ap);
      ap.add(box(0.45, 0.8, 0.4, frame, 0, 0.4, 0, 0.01));                                                // тумба
      ap.add(box(0.26, 0.05, 0.26, M.machineBlue(), 0, 0.83, 0, 0.006));
      ap.add(box(0.12, 0.42, 0.14, M.machineBlue(), 0, 1.06, -0.1, 0.01), box(0.16, 0.14, 0.24, M.machineBlue(), 0, 1.3, 0.0, 0.01));
      ap.add(box(0.1, 0.03, 0.1, M.steel(), 0, 0.97, 0.06, 0.004));                                       // наковальня
      const ram = new THREE.Group(); ram.position.set(0, 1.18, 0.06); ap.add(ram);
      ram.add(box(0.035, 0.32, 0.035, M.chrome(), 0, 0.0, 0, 0.003));
      const lever = new THREE.Group(); lever.position.set(0.09, 1.3, 0.02); ap.add(lever);
      lever.add(rod([0, 0, 0], [0.36, 0.3, 0], 0.01, M.chrome())); lever.add(cyl(0.025, 0.05, M.plastic('#1d1d1d'), 0.36, 0.3, 0, 16));
      st.arborRam = ram; st.arborLever = lever; st.machines.set('arbor', ap);
      const aps = sign(['Пресс реечный ручной · 1 т', 'запрессовка втулок, штифтов'], 0.4, 0.09, { bg: '#ffffff', size: 50 }); aps.position.set(0, 0.55, 0.203); ap.add(aps);
      // ---- гидравлический листогибочный пресс 40 т ----
      const pb = new THREE.Group(); pb.position.set(3.55, 0, -0.1); R.add(pb);
      for (const x of [-0.75, 0.75]) {
        const side = new THREE.Shape(); side.moveTo(-0.5, 0); side.lineTo(0.3, 0); side.lineTo(0.3, 0.85); side.lineTo(-0.05, 0.85); side.lineTo(-0.05, 1.25); side.lineTo(0.3, 1.25); side.lineTo(0.3, 2.1); side.lineTo(-0.5, 2.1); side.lineTo(-0.5, 0);
        const sg = new THREE.ExtrudeGeometry(side, { depth: 0.08, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008 });
        const sm = new THREE.Mesh(sg, M.yellow()); sm.rotation.y = -Math.PI / 2; sm.position.set(x + 0.04, 0, 0.1); sm.castShadow = sm.receiveShadow = true; pb.add(sm);
      }
      pb.add(box(1.7, 0.85, 0.32, M.yellow(), 0, 0.425, 0.25, 0.01));                                     // нижняя траверса
      pb.add(box(1.6, 0.06, 0.07, M.steel(), 0, 0.88, 0.25, 0.004));                                      // V-матрица
      const vd = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.012, 0.012), M.plastic('#202020')); vd.position.set(0, 0.912, 0.25); pb.add(vd);
      const beam = new THREE.Group(); beam.position.set(0, 1.42, 0.25); pb.add(beam);
      beam.add(box(1.65, 0.5, 0.25, M.yellow(), 0, 0.2, 0, 0.01));
      beam.add(box(1.55, 0.09, 0.04, M.steel(), 0, -0.1, 0.0, 0.004));                                    // пуансон
      const punchTip = new THREE.Mesh(new THREE.CylinderGeometry(0.0, 0.03, 0.05, 4), M.steel()); punchTip.rotation.y = Math.PI / 4; punchTip.scale.set(1, 1, 0.3); punchTip.position.set(0, -0.17, 0); beam.add(punchTip);
      for (const x of [-0.55, 0.55]) { pb.add(cyl(0.09, 0.45, M.machineBlue(), x, 2.15, 0.18, 24)); pb.add(cyl(0.035, 0.3, M.chrome(), x, 1.85, 0.18, 16)); }
      pb.add(box(0.45, 0.35, 0.3, M.machineBlue(), 0, 2.25, -0.25, 0.01));                                // маслобак, насос
      const cp = new THREE.Group(); cp.position.set(1.05, 1.35, 0.55); pb.add(cp);                        // пульт с экраном ЧПУ
      cp.add(rod([0, -0.4, -0.2], [0, 0, 0], 0.02, frame), box(0.3, 0.24, 0.08, M.plastic('#2b2f35'), 0, 0.1, 0.02, 0.01));
      cp.add(box(0.2, 0.12, 0.004, M.emit('#4fd8f5', 0.9), 0, 0.13, 0.062, 0.002), cyl(0.012, 0.01, M.red(), 0.1, 0.02, 0.064, 12));
      const ped = new THREE.Group(); ped.position.set(0.3, 0, 0.9); pb.add(ped);                          // педаль
      ped.add(box(0.3, 0.12, 0.25, M.machineBlue(), 0, 0.06, 0, 0.01), box(0.2, 0.02, 0.15, M.rubber(), 0, 0.13, 0.03, 0.004));
      ped.add(rod([0, 0.06, -0.12], [0, 0.02, -0.6], 0.006, M.plastic('#1d1d1d')));
      for (const x of [-0.85, 0.85]) {                                                                      // световая завеса
        pb.add(box(0.05, 1.3, 0.05, M.yellow(), x, 1.25, 0.65, 0.004));
        for (let k = 0; k < 6; k++) pb.add(box(0.012, 0.012, 0.004, M.emit('#ff3030', 1.2), x - Math.sign(x) * 0.026, 0.8 + k * 0.18, 0.65, 0.001));
      }
      for (const x of [-0.3, 0.3]) pb.add(box(0.03, 0.08, 0.06, M.steel(), x, 0.95, 0.05, 0.004));          // задний упор
      const pbs = sign(['ПРЕСС ГИДРАВЛИЧЕСКИЙ ЛИСТОГИБОЧНЫЙ 40 т'], 0.9, 0.12, { bg: '#ffffff', size: 54 }); pbs.position.set(0, 1.62, 0.378); pb.add(pbs);
      st.brakeBeam = beam; st.machines.set('brake', pb);
      const dz = safetySign('danger', 'Опасная зона\nсветовая завеса', 0.26); dz.position.set(-0.6, 1.62, 0.385); pb.add(dz);
      R.add(at(infoStand({ code: 'СЛ-1', title: 'Слесарный участок: изготовление мелких узлов', color: '#2f6a4f',
        lines: ['Разметка, сверление, гибка, запрессовка, обработка поверхностей.', 'Изделия: кронштейны, планки, втулки модулей КМ-2.', 'Ответственный: мастер Козлов А. В.', 'Смена: 1 · 07:30–16:00'],
        ppeList: [['glasses', 'Очки'], ['ear', 'Наушники'], ['gloves', 'Перчатки\n(не у станка)'], ['shoes', 'Обувь']] }), -4.0, 0, 1.0, 0.4));
      // ---- кронштейн (переходит от станка к станку), готовые кронштейны в лотке, штангенциркуль, кисть ----
      const br = bracket(); br.rotation.y = Math.PI / 2; R.add(br); st.bracket = br; st.workpieces = [br];     // линия гиба — вдоль матрицы пресса
      const doneTray = new THREE.Group(); doneTray.position.set(-0.35, 0.94, 0.2); R.add(doneTray);
      for (let k = 0; k < 3; k++) { const b = bracket(); b.userData.B.rotation.z = Math.PI / 2; b.userData.marks.visible = false; b.position.set(-0.08 + k * 0.08, 0, -0.03); b.userData.bushings.forEach((x) => (x.visible = true)); b.traverse((m) => { if (m.material === b.userData.al) m.material = new THREE.MeshPhysicalMaterial({ color: '#cdb46a', metalness: 0.8, roughness: 0.4 }); }); doneTray.add(b); }
      st.add('SL-CAL', (() => { const c = new THREE.Group(); c.position.set(0.0, 0.915, 0.32); c.add(box(0.2, 0.004, 0.018, M.steel(), 0, 0, 0, 0.001), box(0.012, 0.004, 0.05, M.steel(), -0.09, 0, -0.02, 0.001), box(0.012, 0.004, 0.05, M.steel(), -0.05, 0, -0.02, 0.001)); R.add(c); return c; })(), { from: [0, 0.2, 0.2] });
      st.add('SL-BRUSH', (() => { const c = new THREE.Group(); c.position.set(0.55, 0.915, 0.25); c.add(cyl(0.025, 0.05, M.plastic('#cdb46a', 0.3), 0, 0.025, 0, 16), rod([0.0, 0.05, 0], [0.03, 0.18, 0.02], 0.004, M.plastic('#8a5a2a'))); R.add(c); return c; })(), { from: [0, 0.25, 0.2] });
    },
    steps: [
      { id: '010.01', op: '010', title: 'Получение заготовки, разметка', kind: 'prep', focus: ['bench'], tools: ['чертилка', 'угольник', 'кернер', 'штангенциркуль'],
        text: ['Заготовка 120 × 60 × 2 Д16АТ: проверить сертификат, отсутствие царапин.', 'Разметить центры 4 отверстий (15 / 18 мм от кромок) и линию гиба по середине.', 'Накернить центры.'] },
      { id: '020.01', op: '020', title: 'Сверление 4 отверстий Ø6,4', kind: 'install', focus: ['drill'], tools: ['станок 2Н112', 'сверло Ø6,4 Р6М5', 'станочные тиски'],
        text: ['Зажать заготовку в станочных тисках на подкладке.', 'Сверлить на 1400 об/мин с СОЖ, подача вручную плавно.', 'Работать в очках, без перчаток у вращающегося шпинделя.'], check: { name: 'Диаметр отверстия', nominal: 6.4, tol: 0.1, unit: 'мм' } },
      { id: '030.01', op: '030', title: 'Снятие заусенцев, притупление кромок', kind: 'install', focus: ['bench'], tools: ['зенковка 90°', 'шабер', 'напильник личной'],
        text: ['Снять заусенцы с обеих сторон отверстий зенковкой 0,3 × 45°.', 'Притупить кромки R0,3, зачистить торцы.'] },
      { id: '040.01', op: '040', title: 'Гибка 90° на гидравлическом прессе', kind: 'install', focus: ['brake'], tools: ['пресс 40 т', 'матрица V16', 'пуансон R2'],
        text: ['Установить задний упор на 60 мм, линию гиба — по разметке.', 'Гибка педалью двумя руками вне световой завесы, R = 2 мм.', 'Проверить угол угломером.'], check: { name: 'Угол гиба', nominal: 90, tol: 0.5, unit: '°' } },
      { id: '050.01', op: '050', title: 'Запрессовка втулок на ручном прессе', kind: 'install', focus: ['arbor'], tools: ['реечный пресс 1 т', 'оправка', 'втулки КМ2.310.051 (2)'],
        text: ['Смазать втулки, установить в отверстия полки Б.', 'Запрессовать оправкой до упора буртика, без перекоса.', 'Проверить: втулка не проворачивается от руки.'] },
      { id: '060.01', op: '060', title: 'Зачистка и обезжиривание', kind: 'install', focus: ['bench'], tools: ['абразивная губка', 'нефрас С2-80/120'],
        text: ['Зачистить поверхность под покрытие абразивной губкой.', 'Обезжирить нефрасом, сушка 10 мин.'] },
      { id: '070.01', op: '070', title: 'Химическое оксидирование кистью', kind: 'install', parts: ['SL-BRUSH'], focus: ['bench'], tools: ['состав Алодин 1132', 'кисть'],
        text: ['Нанести состав кистью равномерно до золотистого цвета.', 'Выдержка 2–5 мин, промывка, сушка 30 мин.'] },
      { id: '080.01', op: '080', title: 'Контроль размеров, маркировка', kind: 'check', parts: ['SL-CAL'], remove: ['SL-BRUSH'], focus: ['bench'], tools: ['штангенциркуль ШЦ-I', 'угломер', 'маркер'], photo: true,
        text: ['Проверить: межосевые 90 ± 0,2 мм, угол 90 ± 0,5°, втулки на месте.', 'Маркировать «КМ2.310.050» и номер партии, уложить в лоток.'], check: { name: 'Межосевое расстояние', nominal: 90, tol: 0.2, unit: 'мм' } },
    ],
  });
  st.custom = bracketState;
  st.apply(0, 0);
  return st;
}

/** Где и в каком виде кронштейн, как стоят шпиндель, пуансон и шток пресса — на шаге i, доле f. */
function bracketState(st, i, f) {
  const br = st.bracket, U = br.userData;
  const N = st.steps.length;
  const lerp3 = (a, b, k) => a.map((v, j) => v + (b[j] - v) * k);
  // место: в начале шага — перенос от прежнего места (первые 25 % шага)
  const curKey = i >= N ? 'done' : WHERE[i], prevKey = i === 0 ? 'bench' : i >= N ? 'done' : WHERE[i - 1];
  const travel = i < N ? ease(f / 0.25) : 1;
  const p = lerp3(AT[prevKey], AT[curKey], travel);
  br.position.set(p[0], p[1] + Math.sin(Math.PI * travel) * 0.12 * (prevKey !== curKey ? 1 : 0), p[2]);
  br.visible = i > 0 || f > 0;
  if (i === 0) br.position.y += (1 - ease(f / 0.3)) * 0.3;               // заготовку кладут на верстак
  const doneK = (k) => (i > k ? 1 : i === k ? f : 0);
  // разметка → сверление (4 отверстия по очереди) → гиб → втулки → оксидирование
  U.marks.visible = i > 0 || f > 0.4;
  U.marks.scale.setScalar(1);
  const dk = doneK(1);
  U.holes.forEach((h, k) => { h.visible = dk > 0.3 + k * 0.15; });
  if (i >= 4) U.marks.visible = false;
  const bend = doneK(3);
  const bendK = i === 3 ? ease((f - 0.35) / 0.45) : bend >= 1 ? 1 : 0;
  U.B.rotation.z = bendK * (Math.PI / 2);
  const bush = doneK(4);
  U.bushings.forEach((b, k) => { b.visible = bush > 0.45 + k * 0.25; });
  const coat = doneK(6);
  const c = new THREE.Color('#c8cbcf').lerp(new THREE.Color('#cdb46a'), ease(i === 6 ? (f - 0.2) / 0.6 : coat >= 1 ? 1 : 0));
  U.al.color.copy(c);
  // шпиндель станка: опускается на каждое отверстие
  const drillPhase = i === 1 && f > 0.25 ? ((f - 0.25) / 0.75) * 4 : 0;
  st.spindle.position.y = -0.13 - (i === 1 ? Math.max(0, Math.sin(Math.PI * (drillPhase % 1))) * 0.06 : 0);
  st.spindle.rotation.y = i === 1 ? f * 400 : 0;
  // листогиб: пуансон вниз — вверх
  const pb = i === 3 ? Math.sin(Math.PI * Math.min(1, Math.max(0, (f - 0.3) / 0.6))) : 0;
  st.brakeBeam.position.y = 1.42 - pb * 0.38;
  // реечный пресс: два хода штока (две втулки), рычаг поворачивается
  const ap = i === 4 && f > 0.3 ? Math.abs(Math.sin(Math.PI * 2 * ((f - 0.3) / 0.7))) : 0;
  st.arborRam.position.y = 1.18 - ap * 0.17;
  st.arborLever.rotation.z = -ap * 0.9;
}
