// Общее для дополнительных участков цеха: примитивы и материалы, участок (группа в цехе, детали, переходы ТП,
// состояние «шаг i, доля f»), голограммы текущего перехода и цель для плеера виртуальной сборки.
// Координаты участка: метры, x — вправо, y — вверх, +z — к сборщику (лицевая сторона).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { HOLO, LAYER_HOLO } from '../../engine/holo.js';
import { painted } from '../../scene/materials.js';
import { ease } from '../assembly_player.js';
import { galleyMat as GM, textTexture } from '../tex.js';
import { HoloMirror } from '../virtual.js';

export { GM, painted, textTexture, ease };

export const M = {
  steelTop: () => painted('#a9aeb2', { rough: 0.35, metal: 0.8, peel: 96, coat: 0.1 }),
  frameGrey: () => painted('#4a5158', { rough: 0.45, metal: 0.5 }),
  machineGreen: () => painted('#5d7a6a', { rough: 0.42, metal: 0.35 }),
  machineBlue: () => painted('#2f5d8a', { rough: 0.4, metal: 0.4 }),
  yellow: () => painted('#e3b41c', { rough: 0.45, metal: 0.2 }),
  red: () => painted('#c0281e', { rough: 0.4, metal: 0.2 }),
  orange: () => painted('#e06a1d', { rough: 0.45, metal: 0.3 }),
  wood: () => cached('wood', () => new THREE.MeshStandardMaterial({ color: '#d8c29b', roughness: 0.75 })),
  esd: () => cached('esd', () => new THREE.MeshStandardMaterial({ color: '#3d6b5c', roughness: 0.85 })),
  rubber: () => GM.rubber(), chrome: () => GM.chrome(), steel: () => GM.steel(), alu: () => GM.alu(),
  black: () => GM.blackPlastic(), grey: () => GM.greyPlastic(), brass: () => GM.brass(),
  wire: (c) => cached(`wire${c}`, () => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.4, clearcoat: 0.5 })),
  plastic: (c, r = 0.45) => cached(`pl${c}${r}`, () => new THREE.MeshPhysicalMaterial({ color: c, roughness: r, clearcoat: 0.3 })),
  emit: (c, k = 2) => cached(`em${c}${k}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k) })),
};
const _cache = new Map();
function cached(k, f) { if (!_cache.has(k)) _cache.set(k, f()); return _cache.get(k); }

export function box(w, h, d, m, x = 0, y = 0, z = 0, r = 0.004) {
  const o = new THREE.Mesh(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)) : new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o;
}
export function cyl(r, h, m, x = 0, y = 0, z = 0, seg = 24, r2 = r) {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, h, seg), m);
  o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; return o;
}
export function rod(a, b, r, m, seg = 10) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg), m);
  o.position.copy(A).add(B).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  o.castShadow = true; return o;
}
export function tube(points, r, m, seg = 64, rs = 8) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), false, 'centripetal');
  const o = new THREE.Mesh(new THREE.TubeGeometry(c, seg, r, rs), m);
  o.castShadow = true; return o;
}
export function sign(lines, w, h, opts = {}) {
  const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: textTexture(lines, { w: 1024, h: Math.round((1024 * h) / w), size: 64, ...opts }), roughness: 0.6 }));
  return o;
}
/** Табличка на стойке над участком. */
export function hangingSign(lines, w = 1.6) {
  const g = new THREE.Group();
  const s = sign(lines, w, 0.32, { bg: '#1d2a33', fg: '#e8f3f7', border: null, size: 62 });
  s.position.y = 2.9; g.add(s);
  const s2 = s.clone(); s2.rotation.y = Math.PI; g.add(s2);
  for (const x of [-w / 2 + 0.05, w / 2 - 0.05]) g.add(rod([x, 3.06, 0], [x, 4.6, 0], 0.004, M.steel()));
  return g;
}
/** Разметка участка на полу: жёлто-чёрная полоса по периметру. */
export function floorZone(w, d) {
  const g = new THREE.Group();
  const mat = cached('zone', () => new THREE.MeshStandardMaterial({ color: '#e8c21c', roughness: 0.6 }));
  for (const [x, z, ww, dd] of [[0, -d / 2, w, 0.06], [0, d / 2, w, 0.06], [-w / 2, 0, 0.06, d], [w / 2, 0, 0.06, d]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(ww, dd), mat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.003, z); m.receiveShadow = true; g.add(m);
  }
  return g;
}

/** Анимация «прорастания» трубки (провод, жгут) по длине: f = 0…1. */
export function growTube(mesh, f) {
  const n = mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count;
  const k = Math.max(0, Math.min(1, f));
  mesh.geometry.setDrawRange(0, Math.floor((n * k) / 6) * 6);
}

const holoFill = () => cached('holoFill', () => new THREE.MeshBasicMaterial({ color: HOLO.part, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
const holoEdge = () => cached('holoEdge', () => new THREE.LineBasicMaterial({ color: HOLO.part, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));

/**
 * Участок. spec: { id, name, short, center: [x, z], yaw, build(st) → заполняет st.root и st.items, steps, apply?(st, i, f) }.
 * Переход: { id, op, title, text[], tools[], parts[] (появляются на этом переходе), remove[] (убираются в его начале),
 *            focus[] (на что указывает голограмма), check?: {name, nominal, tol, unit}, photo?, timer? }.
 */
export class Station {
  constructor(spec) {
    Object.assign(this, spec);
    this.root = new THREE.Group(); this.root.name = `station:${spec.id}`;
    this.root.position.set(spec.center[0], 0, spec.center[1]);
    this.root.rotation.y = spec.yaw || 0;
    this.center = new THREE.Vector3(spec.center[0], 0, spec.center[1]);
    this.items = new Map();
    this.anims = new Map();          // id → (f) => void — своя анимация появления (рост, сгиб, ход пуансона)
    this.home = new Map();
    this.index = 0;
    this.values = {};
    this.holos = new Map();
    spec.build(this);
    for (const [id, o] of this.items) this.home.set(id, { p: o.position.clone(), q: o.quaternion.clone() });
    this.appear = new Map(); this.removeAt = new Map();
    this.steps.forEach((s, i) => {
      for (const id of s.parts || []) if (!this.appear.has(id)) this.appear.set(id, i);
      for (const id of s.remove || []) this.removeAt.set(id, i);
    });
    this.apply(0, 0);
  }

  add(id, obj, { from = null, anim = null } = {}) {
    obj.userData.stationPart = id;
    if (from) obj.userData.from = new THREE.Vector3(...from);
    if (anim) this.anims.set(id, anim);
    this.items.set(id, obj);
    return obj;
  }

  /** Вид участка: шаги < i выполнены, шаг i — на доле f. */
  apply(i, f) {
    for (const [id, o] of this.items) {
      const a = this.appear.get(id), r = this.removeAt.get(id);
      const h = this.home.get(id);
      o.position.copy(h.p); o.quaternion.copy(h.q);
      let vis = a === undefined || a < i || (a === i && f > 0);
      if (r !== undefined && (r < i || (r === i && f > 0))) vis = false;
      o.visible = vis;
      const an = this.anims.get(id);
      if (a !== undefined && an) an(a < i ? 1 : a === i ? f : 0);
      else if (vis && a === i && f > 0 && o.userData.from) {
        const e = ease(f / 0.8);
        o.position.copy(h.p).addScaledVector(o.userData.from, 1 - e);
      }
    }
    this.custom?.(this, i, f);
    this.view = { i, f };
  }

  get step() { return this.steps[Math.min(this.index, this.steps.length - 1)]; }
  get done() { return this.index >= this.steps.length; }
  next() { const s = this.step; if (s?.check && !(s.id in this.values)) return 'value'; if (this.index < this.steps.length) this.index++; this.apply(this.index, 0); return null; }
  prev() { if (this.index > 0) this.index--; this.apply(this.index, 0); }

  /** Голограммы текущего перехода (на место детали или на оборудование), в слое дисплея очков. */
  showHolo(on) {
    for (const h of this.holos.values()) h.visible = false;
    if (!on || this.done) return;
    const s = this.step;
    for (const id of [...(s.parts || []), ...(s.focus || [])]) {
      const o = this.items.get(id) || this.machines?.get(id);
      if (!o) continue;
      let h = this.holos.get(id);
      if (!h) {
        h = o.clone(true);
        h.traverse((m) => {
          m.layers.set(LAYER_HOLO);
          if (m.isMesh) {
            m.geometry = m.geometry.clone();                     // своя геометрия: «рост» провода у детали не задевает голограмму
            m.material = holoFill(); m.castShadow = false;
            const tri = m.geometry.index ? m.geometry.index.count / 3 : m.geometry.attributes.position.count / 3;
            if (tri < 5000) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), holoEdge()); e.layers.set(LAYER_HOLO); m.add(e); }
          }
        });
        h.visible = false;
        o.parent.add(h);
        this.holos.set(id, h);
      }
      const home = this.home.get(id);
      h.position.copy(home ? home.p : o.position); h.quaternion.copy(home ? home.q : o.quaternion); h.scale.copy(o.scale);
      h.visible = true;
      h.traverse((m) => { if (m.geometry?.drawRange) m.geometry.setDrawRange(0, Infinity); });
    }
  }

  /** Что на участке виртуально в плеере: детали, заготовки (st.workpieces) и то, что монтируется по шагам. */
  virtualSources() {
    const set = new Set([...this.items.values(), ...(this.workpieces || [])]);
    for (const s of this.steps) for (const id of s.parts || []) { const o = this.machines?.get(id); if (o) set.add(o); }
    return [...set];
  }

  /** Цель для плеера виртуальной сборки: реальных деталей и заготовок нет — изделие собирается из голограмм. */
  playerTarget() {
    const st = this;
    let mirror = null, style = 'holo';
    const flyIds = (i, f) => new Set(f > 0 && i < st.steps.length ? (st.steps[i].parts || []).map((id) => st.items.get(id) || st.machines?.get(id)).filter(Boolean) : []);
    return {
      name: `${st.short} · ${st.product}`,
      steps: st.steps.map((s) => ({ id: s.id, title: s.title })),
      get style() { return style; },
      setStyle(s) { style = s === 'glasses' ? 'glasses' : 'holo'; mirror?.setStyle(style); },
      begin() {
        st.showHolo(false); st.playing = true;
        mirror ??= new HoloMirror(st.virtualSources());
        mirror.setStyle(style);
      },
      apply(i, f) {
        st.apply(i, f);
        const fly = flyIds(i, f);
        if (st.workpieces && i < st.steps.length && f > 0) st.workpieces.forEach((w) => fly.add(w));   // заготовка в работе
        mirror.sync(fly);
      },
      end() { st.playing = false; mirror?.hide(); st.apply(st.index, 0); },
    };
  }
}

/**
 * Теневая доска 5S (перфопанель): перфорация, белые контуры инструмента с подписями — видно, чего не хватает.
 * tools: [{ x, y, w, h, label, shape: 'wrench'|'screwdriver'|'file'|'hammer'|'rect' }] — в долях панели.
 */
export function shadowBoardTexture(tools, { w = 2048, h = 920, title = '' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#d8dcdf'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#6f777e';
  for (let y = 14; y < h; y += 26) for (let x = 14; x < w; x += 26) { g.beginPath(); g.arc(x, y, 3.4, 0, Math.PI * 2); g.fill(); }
  if (title) { g.fillStyle = '#1d2a33'; g.fillRect(0, 0, w, 64); g.fillStyle = '#e8f3f7'; g.font = '600 38px "IBM Plex Sans", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(title, 28, 33); }
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const t of tools) {
    const X = t.x * w, Y = t.y * h, W = t.w * w, H = t.h * h;
    g.fillStyle = '#f4f4f0'; g.strokeStyle = '#2b2f33'; g.lineWidth = 3;
    g.beginPath();
    if (t.shape === 'wrench') { g.roundRect(X - W * 0.12, Y, W * 0.24, H * 0.82, 6); g.ellipse(X, Y + H * 0.9, W * 0.4, H * 0.1, 0, 0, Math.PI * 2); }
    else if (t.shape === 'screwdriver') { g.roundRect(X - W * 0.35, Y, W * 0.7, H * 0.42, 10); g.rect(X - W * 0.08, Y + H * 0.42, W * 0.16, H * 0.56); }
    else if (t.shape === 'hammer') { g.roundRect(X - W * 0.5, Y, W, H * 0.22, 6); g.rect(X - W * 0.1, Y + H * 0.22, W * 0.2, H * 0.78); }
    else g.roundRect(X - W / 2, Y, W, H, 8);
    g.fill(); g.stroke();
    if (t.label) { g.fillStyle = '#1d2a33'; g.font = '600 22px "IBM Plex Sans", sans-serif'; g.fillText(t.label, X, Y + H + 8); }
  }
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
  return tx;
}

/** Перфорированный экран (для электромонтажного стола). */
export function perforatedTexture(color = '#d9dcde', w = 1024, h = 360) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h); g.fillStyle = '#7d858c';
  for (let y = 10; y < h; y += 20) for (let x = 10; x < w; x += 20) { g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); }
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx;
}

/** Пиктограмма СИЗ (синий круг — предписывающий знак по ГОСТ 12.4.026) с подписью. */
function ppe(g, x, y, r, kind, label) {
  g.fillStyle = '#1f5ea8'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff'; g.lineWidth = r * 0.1;
  if (kind === 'glasses') { for (const s of [-1, 1]) { g.beginPath(); g.ellipse(x + s * r * 0.33, y, r * 0.26, r * 0.2, 0, 0, Math.PI * 2); g.stroke(); } g.beginPath(); g.moveTo(x - r * 0.07, y); g.lineTo(x + r * 0.07, y); g.stroke(); }
  if (kind === 'gloves') { g.beginPath(); g.roundRect(x - r * 0.25, y - r * 0.2, r * 0.5, r * 0.55, r * 0.12); g.fill(); for (let k = 0; k < 4; k++) { g.beginPath(); g.roundRect(x - r * 0.25 + k * r * 0.13, y - r * 0.55, r * 0.1, r * 0.4, r * 0.05); g.fill(); } }
  if (kind === 'esd') { g.beginPath(); g.arc(x, y + r * 0.1, r * 0.35, Math.PI, 0); g.stroke(); g.beginPath(); g.moveTo(x, y - r * 0.5); g.lineTo(x, y + r * 0.1); g.stroke(); g.beginPath(); g.moveTo(x - r * 0.18, y - r * 0.15); g.lineTo(x + r * 0.18, y - r * 0.15); g.stroke(); }
  if (kind === 'ear') { g.beginPath(); g.arc(x, y, r * 0.42, Math.PI * 0.9, Math.PI * 2.1); g.stroke(); for (const s of [-1, 1]) { g.beginPath(); g.roundRect(x + s * r * 0.42 - r * 0.1, y - r * 0.05, r * 0.2, r * 0.35, r * 0.06); g.fill(); } }
  if (kind === 'shoes') { g.beginPath(); g.moveTo(x - r * 0.4, y + r * 0.3); g.lineTo(x - r * 0.4, y - r * 0.3); g.lineTo(x - r * 0.05, y - r * 0.3); g.lineTo(x + r * 0.05, y + r * 0.05); g.lineTo(x + r * 0.45, y + r * 0.12); g.lineTo(x + r * 0.45, y + r * 0.3); g.closePath(); g.fill(); }
  g.fillStyle = '#1d2a33'; g.font = `600 ${Math.round(r * 0.32)}px "IBM Plex Sans", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'top';
  label.split('\n').forEach((t, i) => g.fillText(t, x, y + r * 1.12 + i * r * 0.38));
}

/** Информационный стенд участка: номер, назначение, изделия, ответственный, обязательные СИЗ, 5S. */
export function infoStand({ code, title, lines = [], ppeList = [], color = '#1f5ea8' }) {
  const c = document.createElement('canvas'); c.width = 900; c.height = 1300;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f7f3'; g.fillRect(0, 0, 900, 1300);
  g.fillStyle = color; g.fillRect(0, 0, 900, 190);
  g.fillStyle = '#ffffff'; g.font = '700 96px "IBM Plex Sans", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(code, 40, 80);
  g.font = '600 36px "IBM Plex Sans", sans-serif'; g.fillText('цех 12 · участок сборки монументов', 40, 150);
  g.fillStyle = '#1d2a33'; g.font = '700 46px "IBM Plex Sans", sans-serif';
  const wrap = (t, x, y, w, lh) => { const words = t.split(' '); let line = '', yy = y; for (const wd of words) { const tt = line ? `${line} ${wd}` : wd; if (g.measureText(tt).width > w && line) { g.fillText(line, x, yy); line = wd; yy += lh; } else line = tt; } g.fillText(line, x, yy); return yy + lh; };
  let y = wrap(title, 40, 250, 820, 56) + 10;
  g.font = '400 32px "IBM Plex Sans", sans-serif';
  for (const l of lines) y = wrap(l, 40, y, 820, 42) + 6;
  g.fillStyle = '#1d2a33'; g.font = '700 34px "IBM Plex Sans", sans-serif'; g.fillText('Обязательные СИЗ:', 40, 930);
  ppeList.forEach(([k, label], i) => ppe(g, 120 + i * 175, 1040, 62, k, label));
  g.strokeStyle = '#1d2a33'; g.lineWidth = 4; g.strokeRect(14, 14, 872, 1272);
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
  const grp = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.9), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.55 }));
  board.position.y = 1.25; grp.add(board);
  const back = box(0.66, 0.94, 0.02, M.frameGrey(), 0, 1.25, -0.012, 0.004); grp.add(back);
  grp.add(rod([0, 0, -0.02], [0, 0.8, -0.02], 0.02, M.frameGrey()), box(0.4, 0.03, 0.3, M.frameGrey(), 0, 0.015, -0.02, 0.004));
  return grp;
}

/** Знак безопасности (жёлтый треугольник / синий круг) с подписью. */
export function safetySign(kind, label, w = 0.22) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 640;
  const g = c.getContext('2d'); g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 640);
  if (kind === 'danger') {
    g.fillStyle = '#f6c400'; g.strokeStyle = '#111'; g.lineWidth = 22; g.beginPath(); g.moveTo(256, 40); g.lineTo(476, 420); g.lineTo(36, 420); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.font = '700 220px "IBM Plex Sans", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 256, 290);
  } else ppe(g, 256, 230, 180, kind, '');
  g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const parts = label.split('\n');
  parts.forEach((t, i) => { let fs = 54; g.font = `700 ${fs}px "IBM Plex Sans", sans-serif`; const wd = g.measureText(t).width; if (wd > 480) { fs *= 480 / wd; g.font = `700 ${fs}px "IBM Plex Sans", sans-serif`; } g.fillText(t, 256, 500 + i * 62); });
  const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, w * 1.25), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.6 }));
}

/** Поставить объект: позиция и поворот вокруг вертикали. */
export function at(obj, x, y, z, ry = 0) { obj.position.set(x, y, z); obj.rotation.y = ry; return obj; }
