// Пространственные окна AR: панель — canvas-текстура на плоскости в слое голограмм (видна только в окне
// дисплея очков, аддитивно). Взаимодействие — лучом взгляда (прицел в центре) или курсором; щелчок, колесо,
// перетаскивание, ввод текста с клавиатуры. Закрепление: на месте (мир), по координатам стапеля (мм),
// «следовать за головой», возврат к рабочему месту по умолчанию.
import * as THREE from 'three';
import { LAYER_HOLO } from '../engine/holo.js';

export const C = {
  text: '#dcf6ff', dim: '#86b4c4', acc: '#58e6ff', ok: '#5dffa8', warn: '#ffc845', bad: '#ff7a66',
  line: 'rgba(88,230,255,0.7)', fill: 'rgba(88,230,255,0.025)', hover: 'rgba(88,230,255,0.16)', active: 'rgba(88,230,255,0.26)',
};
const FONT = '"IBM Plex Sans", "IBM Plex Sans Condensed", system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

/** Обёртка 2D-контекста с регистрацией областей нажатия. */
class UI {
  /** dry — «сухой» прогон: ничего не рисует, только собирает подпись содержимого (перерисовка лишь при изменении). */
  constructor(panel, dry = false) { this.p = panel; this.c = panel.ctx; this.dry = dry; this.sig = []; this.k = 1; }
  /** k — масштаб: координаты и размеры в логических единицах, на холсте — ×k (крупнее при той же разметке). */
  font(size, weight = 400, mono = false) { this.c.font = `${weight} ${size * this.k}px ${mono ? MONO : FONT}`; }
  text(str, x, y, { size = 22, color = C.text, weight = 600, align = 'left', max = 0, mono = false, base = 'alphabetic' } = {}) {
    const c = this.c; this.font(size, weight, mono);
    c.fillStyle = color; c.textAlign = align; c.textBaseline = base;
    let s = String(str ?? '');
    const k = this.k;
    if (max) while (s.length > 1 && c.measureText(s).width > max * k) s = `${s.slice(0, -2)}…`;
    this.sig.push(`${s}|${x | 0}|${y | 0}|${color}|${size}|${weight}|${align}`);
    if (!this.dry) c.fillText(s, x * k, y * k);
    return c.measureText(s).width / k;
  }
  /** Перенос строк по ширине; возвращает высоту. */
  wrap(str, x, y, w, { size = 20, color = C.text, lh = 1.3, weight = 600, maxLines = 99 } = {}) {
    const c = this.c; this.font(size, weight);
    const words = String(str).split(' ');
    let line = '', n = 0;
    for (const wd of words) {
      const t = line ? `${line} ${wd}` : wd;
      if (c.measureText(t).width > w * this.k && line) {
        if (n < maxLines) this.text(line, x, y + n * size * lh, { size, color, weight });
        n++; line = wd;
      } else line = t;
    }
    if (line && n < maxLines) this.text(line, x, y + n * size * lh, { size, color, weight });
    return Math.min(n + 1, maxLines) * size * lh;
  }
  rect(x, y, w, h, { fill = null, stroke = null, r = 8, lw = 2 } = {}) {
    this.sig.push(`r${x | 0},${y | 0},${w | 0},${h | 0},${fill},${stroke},${lw}`);
    if (this.dry) return;
    const k = this.k;
    const c = this.c; c.beginPath(); c.roundRect(x * k, y * k, w * k, h * k, r * k);
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw * k; c.stroke(); }
  }
  hit(x, y, w, h, action, extra = {}) {
    const k = this.k;
    this.p.hits.push({ x: x * k, y: y * k, w: w * k, h: h * k, action, ...extra });
    return this.p.hover && inside(this.p.hover, x * k, y * k, w * k, h * k);
  }
  button(x, y, w, h, label, action, { active = false, color = C.acc, size = 20, disabled = false } = {}) {
    const hov = !disabled && this.hit(x, y, w, h, disabled ? null : action);
    this.rect(x, y, w, h, { fill: active ? C.active : hov ? C.hover : C.fill, stroke: disabled ? 'rgba(120,160,170,0.3)' : color, r: 8, lw: hov ? 3 : 2 });
    this.text(label, x + w / 2, y + h / 2 + size * 0.36, { size, color: disabled ? C.dim : active ? '#ffffff' : color, align: 'center', weight: 600, max: w - 10 });
    return hov;
  }
  input(x, y, w, h, id, value, placeholder) {
    const focus = this.p.mgr.focus?.panel === this.p && this.p.mgr.focus.id === id;
    this.hit(x, y, w, h, () => this.p.mgr.setFocus(this.p, id), { cursor: 'text' });
    this.rect(x, y, w, h, { fill: focus ? 'rgba(88,230,255,0.14)' : 'rgba(88,230,255,0.05)', stroke: focus ? '#ffffff' : C.line, r: 6, lw: focus ? 3 : 2 });
    const caret = focus && Math.floor(performance.now() / 500) % 2 === 0 ? '▏' : '';
    this.text(value ? value + caret : (focus ? caret : placeholder), x + 12, y + h / 2 + 8, { size: 22, color: value ? C.text : C.dim, max: w - 20, mono: !!value });
  }
  progress(x, y, w, h, k, color = C.acc) {
    this.rect(x, y, w, h, { stroke: C.line, r: h / 2, lw: 1.5 });
    this.rect(x + 2, y + 2, Math.max(0, (w - 4) * Math.min(1, k)), h - 4, { fill: color, r: (h - 4) / 2 });
  }
}

const inside = (p, x, y, w, h) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;

export class Panel {
  /**
   * @param mgr менеджер; opts: id, title, w, h (м), ppm (пикселей на метр), draw(ui, panel), home: {pos, look}
   */
  constructor(mgr, { id, title, w = 0.8, h = 0.55, ppm = 1300, draw, home, chrome = true, onWheel = null, onDrag = null }) {
    this.mgr = mgr; this.id = id; this.title = title; this.w = w; this.h = h; this.drawFn = draw; this.chrome = chrome;
    this.onWheel = onWheel; this.onDrag = onDrag;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.min(2048, Math.round(w * ppm)); this.canvas.height = Math.min(2048, Math.round(h * ppm));
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 16;
    this.tex.generateMipmaps = true;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.mat);
    this.mesh.layers.set(LAYER_HOLO);
    this.mesh.renderOrder = 20;
    this.mesh.userData.panel = this;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.home = home;
    this.mode = 'world';            // world | follow | head
    this.hits = []; this.hover = null; this.dirty = true;
    this.visible = true;
    this.state = {};
    if (home) this.placeAt(new THREE.Vector3(...home.pos), new THREE.Vector3(...home.look));
  }

  get px() { return this.canvas.width; }
  get py() { return this.canvas.height; }

  /** Поставить окно в точку мира pos лицом к lookAt (с учётом системы окон: стапель или «вокруг головы» в 3DoF). */
  placeAt(pos, lookAt) {
    const par = this.group.parent;
    this.group.scale.setScalar(1);
    if (par) { par.updateMatrixWorld(); this.group.position.copy(par.worldToLocal(pos.clone())); } else this.group.position.copy(pos);
    this.group.lookAt(lookAt.x, pos.y, lookAt.z);
    this.dirty = true;
  }

  resize(w, h) {
    this.w = w; this.h = h;
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.PlaneGeometry(w, h);
  }

  /**
   * Перерисовать окно. timed — плановая перерисовка «живого» окна: сначала сухой прогон, и если содержимое
   * не изменилось, текстура не перезагружается в видеокарту (это и давало периодические рывки).
   */
  redraw(timed = false) {
    if (timed && this._sig != null && this.paint(true) === this._sig) return false;
    this._sig = this.paint(false);
    this.tex.needsUpdate = true;
    this.dirty = false;
    return true;
  }

  paint(dry) {
    const c = this.ctx, W = this.px, H = this.py;
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (!dry) c.clearRect(0, 0, W, H);
    this.hits = [];
    const ui = new UI(this, dry);
    let top = 0;
    if (this.chrome) {
      ui.rect(3, 3, W - 6, H - 6, { fill: 'rgba(30,110,140,0.018)', stroke: C.line, r: 18, lw: 3 });
      ui.text(this.title, 22, 40, { size: 26, weight: 600, color: C.acc, max: W - 470 });
      const pinned = this.mode === 'world';
      ui.button(W - 444, 12, 130, 38, pinned ? 'Закреплено' : 'Закрепить', () => this.mgr.pinHere(this), { active: pinned, size: 18 });
      ui.button(W - 306, 12, 120, 38, 'Следовать', () => { this.mode = this.mode === 'follow' ? 'world' : 'follow'; this.dirty = true; }, { active: this.mode === 'follow', size: 18 });
      ui.button(W - 178, 12, 110, 38, 'XYZ', () => { this.state.coords = !this.state.coords; this.dirty = true; }, { active: !!this.state.coords, size: 18 });
      ui.button(W - 60, 12, 44, 38, '✕', () => this.mgr.toggle(this, false), { size: 20, color: C.bad });
      top = 62;
      if (this.state.coords) top = this.drawCoords(ui, top);
    }
    this.drawFn?.(ui, this, top);
    return ui.sig.join('\n');
  }

  /** Строка координат: позиция окна в СК стапеля (мм), правка с клавиатуры. */
  drawCoords(ui, top) {
    const W = this.px;
    const p = this.mgr.toJig(this.group.position);
    ui.rect(14, top, W - 28, 52, { fill: 'rgba(255,212,90,0.08)', stroke: 'rgba(255,212,90,0.6)', r: 8 });
    ui.text('Координаты окна, мм (СК стапеля):', 26, top + 34, { size: 19, color: C.warn });
    ['x', 'y', 'z'].forEach((k, i) => {
      const id = `coord_${k}`;
      const val = this.mgr.focus?.panel === this && this.mgr.focus.id === id ? this.mgr.focus.text : String(Math.round(p[k]));
      ui.text(k.toUpperCase(), 400 + i * 190, top + 34, { size: 20, color: C.warn, weight: 600 });
      ui.input(424 + i * 190, top + 8, 150, 36, id, val, '0');
    });
    return top + 62;
  }

  /** Обработка указателя: uv (0..1) → пиксели. */
  pointer(uv, type) {
    const p = { x: uv.x * this.px, y: (1 - uv.y) * this.py };
    if (type === 'move') {
      const was = this.hover;
      this.hover = p;
      const a = this.hits.find((h) => was && inside(was, h.x, h.y, h.w, h.h));
      const b = this.hits.find((h) => inside(p, h.x, h.y, h.w, h.h));
      if (a !== b) this.dirty = true;
      return b;
    }
    if (type === 'click') {
      const h = [...this.hits].reverse().find((x) => inside(p, x.x, x.y, x.w, x.h) && x.action);
      if (h) { h.action(p, h); this.dirty = true; return true; }
      return false;
    }
    return false;
  }

  leave() { if (this.hover) { this.hover = null; this.dirty = true; } }
}

export class PanelManager {
  constructor(scene, camera, { toJig, fromJig }) {
    this.scene = scene; this.camera = camera;
    this.toJig = toJig; this.fromJig = fromJig;
    this.panels = [];
    this.root = new THREE.Group(); this.root.name = 'panels';
    scene.add(this.root);
    this.ray = new THREE.Raycaster();
    this.ray.layers.set(LAYER_HOLO);
    this.hoverPanel = null;
    this.focus = null;          // {panel, id, text, onEnter}
    this.enabled = false;       // окна видны после включения очков
    this.dragging = null;
    // трекинг очков: 6DoF — окна закреплены в цеху (СК стапеля); 3DoF — только повороты головы: вся система окон
    // переносится вместе с сборщиком, ориентация медленно «уплывает» (дрейф гироскопа), R — пересадка по центру
    this.tracking = '6dof';
    this.rig = { origin: new THREE.Vector3(), yaw0: 0, theta: 0, drift: 0, driftRate: 0 };
  }

  camYaw() { const d = new THREE.Vector3(); this.camera.getWorldDirection(d); return Math.atan2(-d.x, -d.z); }

  /** origin, yaw0 — точка и курс взгляда, для которых раскладка окон задана (место сборщика у стапеля). */
  setTracking(mode, driftDegMin = 0, origin = this.camera.position, yaw0 = this.camYaw()) {
    this.tracking = mode;
    this.rig.driftRate = driftDegMin;
    if (mode === '3dof') {
      Object.assign(this.rig, { theta: 0, drift: 0, yaw0 });
      this.rig.origin.copy(origin);
    } else if (mode === 'head') {
      // штатное ПО (очки — просто внешний экран): окна «приклеены» к голове, поворачиваются вместе с ней
      // раскладка окон задана для места origin и курса yaw0 — поворачиваем её вместе с головой
      this.rig.origin.copy(origin);
      this.rig.q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw0).invert();
    } else { this.root.position.set(0, 0, 0); this.root.quaternion.identity(); }
    this.root.updateMatrixWorld(true);
  }

  /** 3DoF: развернуть систему окон к текущему направлению взгляда (кнопка/жест «по центру»). */
  recenter() {
    if (this.tracking === 'head') return false;
    if (this.tracking !== '3dof') return false;
    this.rig.theta = this.camYaw() - this.rig.yaw0; this.rig.drift = 0;
    return true;
  }

  add(panel) { this.panels.push(panel); this.root.add(panel.group); return panel; }
  get(id) { return this.panels.find((p) => p.id === id); }

  toggle(panel, on = !panel.visible) {
    panel.visible = on; panel.group.visible = on && this.enabled;
    if (!on && this.focus?.panel === panel) this.focus = null;
  }

  setEnabled(on) { this.enabled = on; for (const p of this.panels) p.group.visible = on && p.visible; }

  /** Поставить окно в 1,1 м перед глазами, лицом к сборщику. */
  pinHere(panel) {
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    const pos = this.camera.position.clone().addScaledVector(dir, 1.1);
    panel.placeAt(pos, this.camera.position);
    panel.mode = 'world';
    panel.group.visible = this.enabled && panel.visible;
  }

  /** Притянуть окно для чтения (0,75–1 м перед глазами) или вернуть на место. */
  pull(panel) {
    if (!panel) return false;
    if (panel._home) {
      panel.group.position.copy(panel._home.p); panel.group.quaternion.copy(panel._home.q); panel.mode = panel._home.mode; panel._home = null;
      return false;
    }
    panel._home = { p: panel.group.position.clone(), q: panel.group.quaternion.clone(), mode: panel.mode };
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir);
    const d = Math.max(0.75, Math.min(1.0, panel.h * 1.3));
    panel.placeAt(this.camera.position.clone().addScaledVector(dir, d).add(new THREE.Vector3(0, -0.03, 0)), this.camera.position);
    panel.mode = 'world';
    return true;
  }

  setFocus(panel, id, opts = {}) {
    const cur = id.startsWith('coord_') ? String(Math.round(this.toJig(panel.group.position)[id.slice(6)])) : (panel.state[id] ?? '');
    this.focus = { panel, id, text: cur, ...opts };
    panel.dirty = true;
  }

  /** Клавиатура для активного поля ввода. Возвращает true, если клавиша съедена. */
  key(e) {
    const f = this.focus;
    if (!f) return false;
    if (e.key === 'Escape') { this.focus = null; f.panel.dirty = true; return true; }
    if (e.key === 'Enter') {
      if (f.id.startsWith('coord_')) {
        const p = this.toJig(f.panel.group.position);
        const v = parseFloat(f.text.replace(',', '.'));
        if (Number.isFinite(v)) { p[f.id.slice(6)] = v; f.panel.group.position.copy(this.fromJig(p)); }
        f.panel.mode = 'world';
      } else { f.panel.state[f.id] = f.text; f.panel.onEnter?.(f.id, f.text); }
      this.focus = null; f.panel.dirty = true; return true;
    }
    if (e.key === 'Backspace') f.text = f.text.slice(0, -1);
    else if (e.key.length === 1) f.text += e.key;
    else return true;
    if (!f.id.startsWith('coord_')) f.panel.state[f.id] = f.text;
    f.panel.dirty = true;
    return true;
  }

  /** Луч: из центра (прицел) или из курсора (ndc). Возвращает {panel, uv, point, distance} или null. */
  pick(ndc) {
    this.ray.setFromCamera(ndc, this.camera);
    const meshes = this.panels.filter((p) => p.group.visible).map((p) => p.mesh);
    const h = this.ray.intersectObjects(meshes, false)[0];
    return h ? { panel: h.object.userData.panel, uv: h.uv, point: h.point, distance: h.distance } : null;
  }

  pointer(ndc, type) {
    const h = this.enabled ? this.pick(ndc) : null;
    if (this.hoverPanel && (!h || h.panel !== this.hoverPanel)) this.hoverPanel.leave();
    this.hoverPanel = h?.panel || null;
    if (!h) return null;
    if (type === 'move' && this.dragging?.panel === h.panel) {
      const d = { x: (h.uv.x - this.dragging.uv.x) * h.panel.px, y: -(h.uv.y - this.dragging.uv.y) * h.panel.py };
      h.panel.onDrag?.(d, h.panel); this.dragging.uv = h.uv.clone(); h.panel.dirty = true;
    }
    const r = h.panel.pointer(h.uv, type);
    return { ...h, used: !!r };
  }

  startDrag(ndc) { const h = this.enabled ? this.pick(ndc) : null; if (h?.panel.onDrag) this.dragging = { panel: h.panel, uv: h.uv.clone() }; return !!this.dragging; }
  endDrag() { this.dragging = null; }

  wheel(ndc, dy) {
    const h = this.enabled ? this.pick(ndc) : null;
    if (!h?.panel.onWheel) return false;
    h.panel.onWheel(dy, { x: h.uv.x * h.panel.px, y: (1 - h.uv.y) * h.panel.py }, h.panel);
    h.panel.dirty = true;
    return true;
  }

  inView(p) {
    const m = p.mesh;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    this._sph.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
    return this._frustum.intersectsSphere(this._sph);
  }

  update(dt, now) {
    const cam = this.camera;
    this._frustum ??= new THREE.Frustum(); this._pm ??= new THREE.Matrix4(); this._sph ??= new THREE.Sphere();
    if (this.tracking === '3dof') {
      const r = this.rig;
      r.drift += dt * THREE.MathUtils.degToRad(r.driftRate / 60) * (0.6 + 0.4 * Math.sin(now * 0.05));
      const th = r.theta + r.drift;
      this.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), th);
      this.root.position.copy(cam.position).sub(r.origin.clone().applyQuaternion(this.root.quaternion));
      this.root.updateMatrixWorld(true);
    } else if (this.tracking === 'head') {
      this.root.quaternion.copy(cam.quaternion).multiply(this.rig.q0);
      this.root.position.copy(cam.position).sub(this.rig.origin.clone().applyQuaternion(this.root.quaternion));
      this.root.updateMatrixWorld(true);
    }
    let timedDone = false;
    this._frustum.setFromProjectionMatrix(this._pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const p of this.panels) {
      if (!p.group.visible) continue;
      if (p.mode === 'follow') {
        const dir = new THREE.Vector3(); cam.getWorldDirection(dir); dir.y = Math.max(-0.4, Math.min(0.2, dir.y)); dir.normalize();
        const target = this.root.worldToLocal(cam.position.clone().addScaledVector(dir, 1.0).add(new THREE.Vector3(0, -0.12, 0)));
        if (p.group.position.distanceTo(target) > 0.35 || p._following) {
          p._following = p.group.position.distanceTo(target) > 0.05;
          p.group.position.lerp(target, 1 - Math.exp(-dt * 3));
        }
        const wp = p.group.getWorldPosition(new THREE.Vector3());
        p.group.lookAt(cam.position.x, wp.y, cam.position.z);
      }
      if (p.dirty) { p.redraw(); p._lastDraw = now; }
      else if (!timedDone && (p.animated || this.focus?.panel === p) && now - (p._lastDraw || 0) > 0.25) {
        // плановые перерисовки — не больше одной за кадр и только у окон в поле зрения
        p._lastDraw = now;
        if (this.inView(p)) { p.redraw(true); timedDone = true; }
      }
    }
  }
}
