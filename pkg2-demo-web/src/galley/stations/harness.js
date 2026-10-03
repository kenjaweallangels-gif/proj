// Участок ЭМ-1 «Сборка жгутов» (электромонтажный): горизонтальный стол-макет (плаз) 2,4 × 1,2 м с чертежом жгута в
// масштабе 1:1 и вилками-гребёнками, стойка катушек провода, автомат резки и зачистки, стол с инструментом
// (кримпер, стриппер, бокорезы, термофен, паяльная станция с вытяжкой, лупа с подсветкой, мультиметр,
// прибор прозвонки, принтер маркировки, органайзер контактов), антистатический коврик и браслет.
// Изделие — жгут ЖГ-1 КМ2.800.100 модуля КМ-2: ствол из 7 проводов и три ответвления к печи, кофеварке и
// светильнику, соединители XP1–XP5, вязка, термоусадка, маркировка, прозвонка и проверка изоляции.
import * as THREE from 'three';
import { M, Station, box, cyl, floorZone, growTube, hangingSign, infoStand, at, perforatedTexture, rod, safetySign, sign, tube } from './kit.js';

// путь жгута на плоскости макета (u — вдоль, v — вверх), метры
const TRUNK = [[-1.0, 0.0], [-0.7, 0.0], [-0.4, 0.0], [-0.1, 0.012], [0.1, 0.0], [0.35, 0.012], [0.55, 0.02], [0.9, 0.05]];
const BR = {
  B1: [[-0.4, 0.0], [-0.44, 0.14], [-0.5, 0.3], [-0.55, 0.42]],
  B2: [[0.1, 0.0], [0.12, -0.15], [0.17, -0.3], [0.2, -0.44]],
  B3: [[0.55, 0.02], [0.6, 0.15], [0.68, 0.28], [0.75, 0.4]],
};
const XP = { XP1: [-1.06, 0.0, 'ШР-1 ввод 115 В', -1], XP2: [-0.56, 0.47, 'ПЕЧЬ-1', 1], XP3: [0.21, -0.49, 'КОФЕВАРКА', 1], XP4: [0.77, 0.45, 'СВЕТИЛЬНИК', 1], XP5: [0.96, 0.052, 'ЩИТОК', 1] };
const COLORS = ['#f3f3ef', '#d12e2e', '#2f5fbf', '#1d1d1d', '#e8c21c', '#3a9a52', '#8a8f94'];

/** Чертёж жгута 1:1 для макета (канва 2048 × 1024 = 2,4 × 1,2 м). */
function drawingTexture() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 1024;
  const g = c.getContext('2d');
  const X = (u) => ((u + 1.2) / 2.4) * 2048, Y = (v) => ((0.6 - v) / 1.2) * 1024;
  g.fillStyle = '#f6f4ec'; g.fillRect(0, 0, 2048, 1024);
  g.strokeStyle = '#c9c4b4'; g.lineWidth = 1;
  for (let x = 0; x < 2048; x += 2048 / 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1024); g.stroke(); }
  for (let y = 0; y < 1024; y += 1024 / 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(2048, y); g.stroke(); }
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 3; g.strokeRect(20, 20, 2008, 984);
  const path = (pts, w) => { g.lineWidth = w; g.beginPath(); pts.forEach(([u, v], i) => (i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v)))); g.stroke(); };
  g.strokeStyle = '#7d7d7d'; g.lineCap = 'round'; path(TRUNK, 22); Object.values(BR).forEach((b) => path(b, 14));
  g.strokeStyle = '#1a1a1a'; path(TRUNK, 2); Object.values(BR).forEach((b) => path(b, 2));
  // места вязки (риски через 80 мм)
  g.lineWidth = 2;
  for (let u = -0.95; u < 0.88; u += 0.08) { const x = X(u), y = Y(0.01); g.beginPath(); g.moveTo(x, y - 18); g.lineTo(x, y + 18); g.stroke(); }
  g.font = '600 26px "IBM Plex Sans", sans-serif'; g.fillStyle = '#1a1a1a';
  for (const [k, [u, v, t]] of Object.entries(XP)) {
    g.strokeRect(X(u) - 34, Y(v) - 22, 68, 44);
    g.fillText(k, X(u) - 26, Y(v) + 9);
    g.fillText(t, X(u) + (u > 0 ? -120 : 44), Y(v) + (v > 0.2 ? -34 : v < -0.2 ? 58 : -34));
  }
  // размеры ответвлений
  g.font = '400 22px "IBM Plex Mono", monospace';
  g.fillText('1900±10', X(-0.1), Y(0.0) + 52); g.fillText('450±5', X(-0.42) - 120, Y(0.25)); g.fillText('440±5', X(0.15) + 24, Y(-0.25)); g.fillText('410±5', X(0.63) + 24, Y(0.22));
  // таблица проводов
  g.font = '600 22px "IBM Plex Sans", sans-serif';
  const rows = [['Пров.', 'Марка', 'Сеч.', 'Длина', 'Откуда', 'Куда'], ['1', 'БПВЛ', '1,5', '1960', 'XP1:1', 'XP5:1'], ['2', 'БПВЛ', '1,5', '2430', 'XP1:2', 'XP2:1'], ['3', 'БПВЛ', '1,0', '2380', 'XP1:3', 'XP3:1'], ['4', 'МГТФ', '0,5', '2350', 'XP1:4', 'XP4:1'], ['5', 'БПВЛ', '1,5', '1960', 'XP1:5', 'XP5:2'], ['6', 'МГТФ', '0,35', '2300', 'XP1:6', 'XP4:2'], ['7', 'ПТЛ', '1,0', '1960', 'XP1:7 ⏚', 'XP5:⏚']];
  rows.forEach((r, i) => r.forEach((t, j) => { g.fillText(t, 50 + j * 92, 70 + i * 32); }));
  g.strokeRect(40, 42, 560, 260);
  // основная надпись
  g.strokeRect(1500, 860, 520, 136);
  g.font = '600 30px "IBM Plex Sans", sans-serif'; g.fillText('ЖГУТ ЖГ-1 · КМ2.800.100', 1520, 900);
  g.font = '400 24px "IBM Plex Sans", sans-serif'; g.fillText('Макет сборки, М 1:1 · лист 1 · вязка через 80', 1520, 940); g.fillText('ТТ: изоляция ≥ 20 МОм при 500 В', 1520, 976);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function connector(kind) {
  const g = new THREE.Group();
  if (kind === 'rect') {
    g.add(box(0.055, 0.03, 0.028, M.black(), 0, 0, 0, 0.003));
    g.add(box(0.06, 0.008, 0.032, M.alu(), 0, 0.019, 0, 0.002));
  } else {
    const shell = cyl(0.016, 0.045, M.plastic('#4a5236', 0.5), 0, 0, 0, 24); shell.rotation.z = Math.PI / 2; g.add(shell);
    const ring = cyl(0.019, 0.016, M.plastic('#2a2d24', 0.4), 0.014, 0, 0, 24); ring.rotation.z = Math.PI / 2; g.add(ring);
    const back = cyl(0.012, 0.02, M.black(), -0.03, 0, 0, 16); back.rotation.z = Math.PI / 2; g.add(back);
  }
  return g;
}

export function harnessStation() {
  return new Station({
    id: 'em1', short: 'Участок ЭМ-1 · сборка жгутов', name: 'Электромонтажный участок ЭМ-1 — сборка жгутов на макете', product: 'жгут ЖГ-1 КМ2.800.100',
    center: [6.4, 9.3], yaw: Math.PI,
    build(st) {
      const R = st.root;
      R.add(floorZone(6.4, 3.4));
      const hs = hangingSign(['ЭЛЕКТРОМОНТАЖНЫЙ УЧАСТОК ЭМ-1 · СБОРКА ЖГУТОВ'], 2.6); R.add(hs);
      // антистатический пол у макета, точка заземления браслета
      const mat = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.2), M.esd()); mat.rotation.x = -Math.PI / 2; mat.position.set(0, 0.004, 0.75); mat.receiveShadow = true; R.add(mat);
      // ---- макет-плаз на горизонтальном столе (высота столешницы 0,92 м, подход с трёх сторон) ----
      const frame = M.frameGrey();
      const TZ = -0.25, TH = 0.9;                                    // центр стола по глубине, высота подстолья
      for (const x of [-1.12, 1.12]) for (const z of [TZ - 0.52, TZ + 0.52]) {
        R.add(box(0.05, TH, 0.05, frame, x, TH / 2, z, 0.006));
        R.add(box(0.09, 0.02, 0.09, M.frameGrey(), x, 0.01, z, 0.004));                         // регулируемая опора
      }
      for (const z of [TZ - 0.52, TZ + 0.52]) R.add(box(2.28, 0.06, 0.03, frame, 0, TH - 0.05, z, 0.006));   // царги
      for (const x of [-1.12, 1.12]) R.add(box(0.03, 0.06, 1.04, frame, x, TH - 0.05, TZ, 0.006));
      R.add(box(2.2, 0.02, 0.96, M.frameGrey(), 0, 0.22, TZ, 0.004));                        // нижняя полка
      const board = new THREE.Group();
      board.position.set(0, TH + 0.012, TZ); board.rotation.x = -Math.PI / 2;           // лицом вверх, верх чертежа — дальний край
      R.add(board);
      st.board = board;
      board.add(box(2.42, 1.22, 0.024, M.wood(), 0, 0, -0.012, 0.004));
      const draw = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: drawingTexture(), roughness: 0.85 }));
      draw.position.z = 0.0015; draw.receiveShadow = true; board.add(draw);
      board.add(box(2.46, 0.04, 0.05, frame, 0, -0.63, 0.0, 0.004));                    // полка-упор снизу
      // вилки-гребёнки по пути жгута
      const pegM = M.steel(), forkM = M.plastic('#2f6fb0', 0.4);
      const pegAt = (u, v) => { const p = new THREE.Group(); p.position.set(u, v, 0); p.add(cyl(0.004, 0.05, pegM, 0, 0, 0.025, 10)); p.children[0].rotation.x = Math.PI / 2;
        for (const s of [-1, 1]) { const f = cyl(0.003, 0.03, forkM, 0, s * 0.012, 0.052, 8); f.rotation.x = Math.PI / 2; p.add(f); }
        p.add(box(0.008, 0.03, 0.006, forkM, 0, 0, 0.038, 0.002)); board.add(p); };
      const along = (pts, step) => { for (let k = 0; k < pts.length - 1; k++) { const [a, b] = [pts[k], pts[k + 1]]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let s = 0; s < L; s += step) pegAt(a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L); } };
      along(TRUNK, 0.16); Object.values(BR).forEach((b) => along(b.slice(1), 0.14));
      // ---- жгут на макете: ствол, ответвления, вязка, соединители, термоусадка, бирки ----
      const Z = 0.045;
      const bundle = (pts, n, r = 0.0026) => {
        const g = new THREE.Group();
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * r * 2.05;
          const w = tube(pts.map(([u, v], j) => new THREE.Vector3(u, v + off * 0.7, Z + (k % 2) * r * 1.6 + Math.sin(j * 1.7 + k) * 0.0008)), r, M.wire(COLORS[k % COLORS.length]), 120, 6);
          g.add(w);
        }
        return g;
      };
      const grow = (grp) => (f) => grp.children.forEach((w) => growTube(w, f));
      const trunk = bundle(TRUNK, 7); board.add(st.add('H-TRUNK', trunk, { anim: grow(trunk) }));
      for (const [k, pts] of Object.entries(BR)) { const b = bundle(pts, k === 'B3' ? 2 : 3); board.add(st.add(`H-${k}`, b, { anim: grow(b) })); }
      const ties = new THREE.Group();
      const tieM = M.plastic('#f1efe6', 0.6);
      const addTie = (u, v, ang) => { const t = new THREE.Mesh(new THREE.TorusGeometry(0.0105, 0.0016, 6, 18), tieM); t.position.set(u, v, Z + 0.003); t.rotation.set(0, Math.PI / 2, ang); ties.add(t); };
      for (let u = -0.95; u < 0.88; u += 0.08) addTie(u, 0.01 + Math.max(0, u - 0.55) * 0.09, 0);
      for (const pts of Object.values(BR)) for (let k = 1; k < pts.length; k++) { const [a, b] = [pts[k - 1], pts[k]]; addTie((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[1] - a[1], b[0] - a[0])); }
      board.add(st.add('H-TIES', ties, { from: [0, 0, 0.12] }));
      for (const [k, [u, v, , dir]] of Object.entries(XP)) {
        const cn = connector(k === 'XP5' ? 'rect' : 'circ');
        cn.position.set(u, v, Z);
        if (k !== 'XP1' && k !== 'XP5') cn.rotation.z = v > 0 ? Math.PI / 2 : -Math.PI / 2; else cn.rotation.z = dir < 0 ? Math.PI : 0;
        board.add(st.add(`H-${k}`, cn, { from: [0, 0, 0.25] }));
      }
      const shrink = new THREE.Group();
      for (const [u, v, a] of [[-0.42, 0.06, 1.35], [0.11, -0.06, -1.45], [0.57, 0.08, 1.25]]) {
        const sl = cyl(0.011, 0.06, M.plastic('#151515', 0.35), u, v, Z, 16); sl.rotation.z = a - Math.PI / 2; shrink.add(sl);
      }
      board.add(st.add('H-SHRINK', shrink, { anim: (f) => shrink.children.forEach((s) => s.scale.set(1.6 - 0.6 * f, 1, 1.6 - 0.6 * f)) }));
      const tags = new THREE.Group();
      for (const [, [u, v]] of Object.entries(XP)) { const tg = cyl(0.0095, 0.03, M.plastic('#f6f6f2', 0.5), u * 0.93, v * 0.88, Z, 14); tg.rotation.z = Math.abs(v) > 0.2 ? 0 : Math.PI / 2; tags.add(tg); }
      board.add(st.add('H-TAGS', tags, { from: [0, 0, 0.1] }));
      // ---- стойка катушек провода и автомат резки ----
      const rack = new THREE.Group(); rack.position.set(-2.35, 0, -0.2); R.add(rack);
      for (const x of [-0.42, 0.42]) rack.add(box(0.05, 1.7, 0.4, frame, x, 0.85, 0, 0.004));
      for (let r = 0; r < 3; r++) {
        const y = 0.45 + r * 0.5;
        rack.add(rod([-0.42, y, 0], [0.42, y, 0], 0.012, M.steel()));
        for (let k = 0; k < 4; k++) {
          const sp = new THREE.Group(); sp.position.set(-0.3 + k * 0.2, y, 0);
          for (const s of [-1, 1]) { const fl = cyl(0.11, 0.008, M.plastic('#222', 0.5), s * 0.06, 0, 0, 28); fl.rotation.z = Math.PI / 2; sp.add(fl); }
          const body = cyl(0.085, 0.11, M.wire(COLORS[(r * 4 + k) % COLORS.length]), 0, 0, 0, 28); body.rotation.z = Math.PI / 2; sp.add(body);
          rack.add(sp);
        }
      }
      const cutter = new THREE.Group(); cutter.position.set(-1.55, 0, 0.35); R.add(cutter);
      cutter.add(box(0.7, 0.8, 0.5, frame, 0, 0.4, 0, 0.01));
      cutter.add(box(0.5, 0.22, 0.32, M.plastic('#d8dadc', 0.4), 0, 0.92, 0, 0.02));
      cutter.add(box(0.16, 0.08, 0.005, M.emit('#4fd8f5', 1.2), 0.1, 0.97, 0.162, 0.002));
      for (const x of [-0.18, -0.12]) { const rl = cyl(0.02, 0.06, M.plastic('#333', 0.4), x, 0.95, 0.14, 16); rl.rotation.x = Math.PI / 2; cutter.add(rl); }
      cutter.add(rod([-0.3, 0.95, 0.12], [-0.85, 1.4, 0.2], 0.0015, M.wire('#d12e2e')));
      const cs = sign(['Автомат резки и зачистки', 'длина ±1 мм'], 0.36, 0.08, { bg: '#ffffff', size: 54 }); cs.position.set(0, 0.6, 0.252); cutter.add(cs);
      // ---- стол с инструментом ----
      const bench = new THREE.Group(); bench.position.set(2.15, 0, 0.25); R.add(bench);
      bench.add(box(1.5, 0.04, 0.75, M.frameGrey(), 0, 0.88, 0, 0.004));
      const top = new THREE.Mesh(new THREE.PlaneGeometry(1.46, 0.71), M.esd()); top.rotation.x = -Math.PI / 2; top.position.y = 0.902; bench.add(top);
      for (const x of [-0.7, 0.7]) for (const z of [-0.33, 0.33]) bench.add(box(0.04, 0.86, 0.04, frame, x, 0.43, z, 0.004));
      bench.add(box(1.48, 0.52, 0.02, M.frameGrey(), 0, 1.15, -0.37, 0.004));
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.46, 0.5), new THREE.MeshStandardMaterial({ map: perforatedTexture('#dfe3e6', 1460, 500), roughness: 0.7 }));
      scr.position.set(0, 1.15, -0.358); bench.add(scr);                                       // экран с перфорацией
      const bp = sign(['Стол монтажный ЭМ-1-02 · ESD', 'заземление стола и браслета проверять в начале смены'], 0.62, 0.09, { bg: '#ffffff', size: 50 }); bp.position.set(0, 0.8, 0.377); bench.add(bp);
      const esd = safetySign('esd', 'ESD-зона:\nбраслет обязателен', 0.2); esd.position.set(0.55, 1.15, -0.355); bench.add(esd);
      // паяльная станция, термофен, вытяжка, лупа
      bench.add(box(0.18, 0.1, 0.16, M.plastic('#2a62a8', 0.4), -0.5, 0.95, -0.15, 0.01));
      bench.add(box(0.07, 0.03, 0.004, M.emit('#ff6a3a', 1.4), -0.5, 0.97, -0.068, 0.001));
      bench.add(rod([-0.36, 0.91, -0.15], [-0.28, 1.02, -0.05], 0.007, M.plastic('#d8d8d8')));
      bench.add(rod([-0.28, 1.02, -0.05], [-0.25, 1.06, -0.02], 0.0018, M.steel()));
      bench.add(box(0.14, 0.06, 0.11, M.plastic('#222', 0.5), 0.0, 0.93, -0.2, 0.01));
      bench.add(rod([0.0, 0.96, -0.2], [0.06, 1.1, -0.05], 0.022, M.plastic('#c43a2a', 0.4)));
      bench.add(cyl(0.02, 0.06, M.steel(), 0.07, 1.13, -0.03, 16));
      bench.add(box(0.22, 0.25, 0.18, M.plastic('#d0d3d6', 0.5), 0.45, 1.02, -0.2, 0.02));
      bench.add(rod([0.45, 1.15, -0.2], [0.3, 1.35, 0.05], 0.018, M.plastic('#9aa0a6', 0.4)));
      bench.add(cyl(0.06, 0.04, M.plastic('#9aa0a6'), 0.28, 1.36, 0.08, 20));
      bench.add(rod([0.62, 0.9, -0.3], [0.6, 1.4, -0.1], 0.012, M.steel()), rod([0.6, 1.4, -0.1], [0.55, 1.35, 0.15], 0.012, M.steel()));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 10, 28), M.plastic('#e6e7e8')); ring.position.set(0.55, 1.32, 0.17); ring.rotation.x = Math.PI / 2 - 0.4; bench.add(ring);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.068, 28), GM_glass()); lens.position.copy(ring.position); lens.rotation.x = -Math.PI / 2 - 0.4 + Math.PI; bench.add(lens);
      // ручной инструмент на коврике: кримпер, стриппер, бокорезы, мультиметр, прибор прозвонки, принтер бирок, органайзер
      const tool = (x, z, a, col) => { const t = new THREE.Group(); t.position.set(x, 0.91, z); t.rotation.y = a;
        t.add(box(0.03, 0.012, 0.12, M.plastic(col, 0.5), -0.012, 0, 0.06, 0.004), box(0.03, 0.012, 0.12, M.plastic(col, 0.5), 0.012, 0, 0.06, 0.004), box(0.03, 0.014, 0.06, M.steel(), 0, 0, -0.03, 0.004)); bench.add(t); };
      tool(-0.2, 0.15, 0.3, '#c43a2a'); tool(-0.08, 0.2, -0.2, '#e3b41c'); tool(0.05, 0.12, 0.6, '#2f6fb0');
      bench.add(box(0.09, 0.03, 0.17, M.plastic('#e3b41c', 0.5), 0.25, 0.92, 0.12, 0.01));
      bench.add(box(0.06, 0.004, 0.05, M.emit('#9ad6a8', 0.8), 0.25, 0.937, 0.09, 0.001));
      bench.add(box(0.22, 0.09, 0.16, M.plastic('#2b2f35', 0.4), 0.52, 0.95, 0.16, 0.01));
      const ts = sign(['ПРОЗВОНКА / 500 В'], 0.18, 0.04, { bg: '#2b2f35', fg: '#e8f3f7', border: null, size: 60 }); ts.position.set(0.52, 0.98, 0.241); bench.add(ts);
      bench.add(box(0.14, 0.07, 0.12, M.plastic('#f0f0f0', 0.4), -0.6, 0.94, 0.15, 0.01));
      const org = new THREE.Group(); org.position.set(-0.25, 0.91, -0.25);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) org.add(box(0.07, 0.04, 0.05, M.plastic(['#2f6fb0', '#e3b41c', '#c43a2a', '#3a9a52'][i], 0.5), i * 0.075, 0.02, j * 0.055, 0.003));
      bench.add(org);
      // нарезанные и маркированные провода, опрессованные контакты (на столе), готовый жгут в таре
      const cut = new THREE.Group();
      for (let k = 0; k < 7; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.09 + k * 0.004, 0.0028, 6, 40), M.wire(COLORS[k])); t.rotation.x = Math.PI / 2; t.position.set(0, k * 0.004, 0); cut.add(t); }
      cut.position.set(-0.05, 0.915, 0.0); bench.add(st.add('H-CUT', cut, { from: [-0.6, 0.3, 0] }));
      const cutTags = new THREE.Group();
      for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; const tg = cyl(0.006, 0.02, M.plastic('#f6f6f2'), -0.05 + Math.cos(a) * 0.1, 0.94, Math.sin(a) * 0.1, 10); tg.rotation.z = Math.PI / 2; tg.rotation.y = a; cutTags.add(tg); }
      bench.add(st.add('H-CUTTAGS', cutTags, { from: [0, 0.15, 0] }));
      const pins = new THREE.Group();
      for (let k = 0; k < 14; k++) { const p = cyl(0.0025, 0.022, M.brass(), 0.25 + (k % 7) * 0.012, 0.915, -0.05 + Math.floor(k / 7) * 0.03, 8); p.rotation.x = Math.PI / 2; pins.add(p); }
      bench.add(st.add('H-PINS', pins, { from: [0, 0.12, 0] }));
      const testLeads = new THREE.Group();
      testLeads.add(tube([[0.52, 0.96, 0.08], [0.2, 0.7, -0.1], [-1.0, 1.05, -0.1], [-3.0, 1.16, -0.32]], 0.003, M.wire('#d12e2e'), 60));
      testLeads.add(tube([[0.55, 0.96, 0.08], [0.0, 0.65, -0.05], [-1.2, 1.2, -0.2], [-3.05, 1.22, -0.35]], 0.003, M.wire('#1d1d1d'), 60));
      bench.add(st.add('H-TEST', testLeads, { anim: (f) => testLeads.children.forEach((w) => growTube(w, f)) }));
      R.add(at(infoStand({ code: 'ЭМ-1', title: 'Электромонтажный участок: сборка жгутов на макетах', color: '#1f5ea8',
        lines: ['Резка, маркировка, опрессовка, раскладка на макете 1:1, вязка, контроль цепей.', 'Изделия: жгуты ЖГ-1…ЖГ-5 модуля КМ-2.', 'Ответственный: мастер Петрова Е. Н.', 'ESD-зона: браслет, халат, коврик.'],
        ppeList: [['esd', 'Браслет'], ['glasses', 'Очки'], ['shoes', 'Обувь ESD']] }), 2.9, 0, 1.3, -0.5));
      const tote = new THREE.Group(); tote.position.set(-2.15 - 0.0, 0, 1.0);
      tote.add(box(0.6, 0.25, 0.4, M.plastic('#2f6fb0', 0.5), 0, 0.125, 0, 0.01));
      for (let k = 0; k < 5; k++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.16 - k * 0.008, 0.012, 8, 40), M.plastic('#3d3f42', 0.6)); t.rotation.x = Math.PI / 2; t.position.y = 0.2 + k * 0.012; tote.add(t); }
      const tl = sign(['ЖГ-1 · КМ2.800.100 · ОТК'], 0.3, 0.06, { bg: '#ffffff', size: 54 }); tl.position.set(0, 0.17, 0.202); tote.add(tl);
      R.add(st.add('H-DONE', tote, { from: [0, 0.6, -0.8] }));
    },
    steps: [
      { id: '010.01', op: '010', title: 'Подготовка макета и комплекта', kind: 'prep', parts: [], focus: [], tools: ['макет ЖГ-1 М 1:1', 'ведомость проводов'],
        text: ['Проверить макет: лист 1, вилки по разметке, нет повреждений чертежа.', 'Сверить катушки проводов с ведомостью (марка, сечение, цвет).', 'Надеть антистатический браслет, проверить заземление стола.'] },
      { id: '020.01', op: '020', title: 'Резка проводов по таблице длин', kind: 'install', parts: ['H-CUT'], tools: ['автомат резки и зачистки'],
        text: ['Нарезать 7 проводов по таблице на макете: длина ±5 мм.', 'Зачистить концы на 5 мм автоматом.'], check: { name: 'Длина провода 1', nominal: 1960, tol: 5, unit: 'мм' } },
      { id: '030.01', op: '030', title: 'Маркировка проводов', kind: 'install', parts: ['H-CUTTAGS'], tools: ['принтер термоусадочных бирок', 'термофен'],
        text: ['Напечатать бирки «номер провода — XP:контакт» по таблице.', 'Надеть бирки на оба конца, усадить термофеном 120 °C.'] },
      { id: '040.01', op: '040', title: 'Опрессовка контактов', kind: 'install', parts: ['H-PINS'], tools: ['кримпер с позиционером', 'динамометр вырыва'],
        text: ['Опрессовать контакты кримпером по сечению провода.', 'Контрольный образец: усилие вырыва ≥ 100 Н (1,5 мм²).'], check: { name: 'Усилие вырыва, образец', nominal: 120, tol: 20, unit: 'Н' } },
      { id: '050.01', op: '050', title: 'Раскладка ствола жгута по макету', kind: 'install', parts: ['H-TRUNK'], remove: ['H-CUT'], tools: ['вилки макета'],
        text: ['Разложить 7 проводов ствола от XP1 до XP5 по вилкам.', 'Порядок проводов — по сечению: толстые внутри.'] },
      { id: '060.01', op: '060', title: 'Раскладка ответвлений к печи, кофеварке, светильнику', kind: 'install', parts: ['H-B1', 'H-B2', 'H-B3'], tools: ['вилки макета'],
        text: ['Отвести провода 2, 3 — к XP2, XP3; 4, 6 — к XP4.', 'Длины ответвлений — по чертежу ±5 мм.'] },
      { id: '070.01', op: '070', title: 'Вязка жгута', kind: 'install', parts: ['H-TIES'], remove: ['H-CUTTAGS'], tools: ['стяжки 2,5 × 100', 'кусачки стяжек'],
        text: ['Стяжки через 80 мм по рискам макета, у ответвлений — по две.', 'Хвосты стяжек срезать вровень, без острых кромок.'] },
      { id: '080.01', op: '080', title: 'Установка контактов в соединители XP1–XP5', kind: 'install', parts: ['H-XP1', 'H-XP2', 'H-XP3', 'H-XP4', 'H-XP5'], remove: ['H-PINS'], tools: ['инструмент вставки контактов'],
        text: ['Вставить контакты по таблице до щелчка фиксатора.', 'Проверить фиксацию усилием 20 Н на каждый контакт.', 'Свободные гнёзда закрыть заглушками.'] },
      { id: '090.01', op: '090', title: 'Термоусадка на ответвлениях', kind: 'install', parts: ['H-SHRINK'], tools: ['термофен', 'трубка ТУТ 3:1'],
        text: ['Надеть трубку 3:1 на развилки, усадить термофеном 150 °C до плотного обжатия.', 'Не перегревать изоляцию МГТФ.'] },
      { id: '100.01', op: '100', title: 'Маркировка жгута', kind: 'install', parts: ['H-TAGS'], tools: ['принтер маркировки'],
        text: ['Бирки «ЖГ-1 / XPn — назначение» у каждого соединителя, 50 мм от корпуса.'] },
      { id: '110.01', op: '110', title: 'Прозвонка и проверка сопротивления изоляции', kind: 'check', parts: ['H-TEST'], tools: ['прибор прозвонки', 'мегаомметр 500 В'], photo: true,
        text: ['Прозвонить все 7 цепей по таблице: нет обрывов и перепутанных контактов.', 'Сопротивление изоляции между цепями и на экран ≥ 20 МОм при 500 В.'],
        check: { name: 'Сопротивление изоляции', nominal: 200, tol: 180, unit: 'МОм' } },
      { id: '120.01', op: '120', title: 'Снятие жгута с макета, укладка в тару', kind: 'install', parts: ['H-DONE'], remove: ['H-TEST', 'H-TRUNK', 'H-B1', 'H-B2', 'H-B3', 'H-TIES', 'H-XP1', 'H-XP2', 'H-XP3', 'H-XP4', 'H-XP5', 'H-SHRINK', 'H-TAGS'], tools: ['тара ЖГ'],
        text: ['Снять жгут с вилок, свернуть бухтой ⌀ ≥ 300 мм.', 'Уложить в тару, бирка ОТК, передать на участок монтажа МЭ-1.'] },
    ],
  });
}

function GM_glass() { return new THREE.MeshPhysicalMaterial({ color: '#cfe3ea', roughness: 0.02, transparent: true, opacity: 0.25, clearcoat: 1 }); }
