// Сборщик от первого лица: ходьба (WASD/стрелки, Shift — быстрее, C — присесть), обзор мышью (захват указателя
// по щелчку; без захвата — перетаскивание правой кнопкой), столкновения с оборудованием, покачивание головы при
// шаге и дыхании, автоматический проход по маршруту (вступительный сценарий) и «наклон к точке» для осмотра узла.
import * as THREE from 'three';

const RADIUS = 0.28;
const tmp = new THREE.Vector3();

export class Player {
  constructor(camera, dom, colliders, { eye = 1.68 } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders;
    this.eyeStand = eye;
    this.eye = eye;
    this.pos = new THREE.Vector3(0, 0, 0);      // ступни
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.keys = new Set();
    this.enabled = true;                          // false — ввод перехватила панель (набор текста)
    this.mode = 'walk';                           // walk | auto | inspect
    this.path = null;
    this.phase = 0;                               // фаза шага
    this.t = 0;
    this.angVel = new THREE.Vector2();            // рад/с (рыскание, тангаж) — для размытия движения и задержки дисплея
    this.inspect = null;
    this.mouse = new THREE.Vector2();             // курсор в NDC (без захвата указателя)
    this.drag = null;
    this.crouch = false;

    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.crouch = !this.crouch;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 2) this.drag = { x: e.clientX, y: e.clientY };
    });
    addEventListener('pointerup', () => { this.drag = null; });
    addEventListener('pointermove', (e) => {
      const r = dom.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (document.pointerLockElement === dom) this.look(e.movementX, e.movementY);
      else if (this.drag) { this.look(e.clientX - this.drag.x, e.clientY - this.drag.y); this.drag = { x: e.clientX, y: e.clientY }; }
    });
  }

  get locked() { return document.pointerLockElement === this.dom; }

  look(dx, dy) {
    if (this.mode === 'auto') return;
    if (this.mode === 'inspect') { this.lookInspect(dx, dy); return; }
    const k = 0.0022;
    this.yaw -= dx * k;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k, -1.35, 1.35);
  }

  /** Поставить сборщика: x, z (м), курс (рад, 0 — смотрит на −Z). */
  place(x, z, yaw = 0, pitch = 0) { this.pos.set(x, 0, z); this.yaw = yaw; this.pitch = pitch; this.vel.set(0, 0, 0); }

  /** Пройти маршрут [[x, z], …]; lookAt — точка, на которую смотреть в конце. */
  walkPath(points, { speed = 1.25, lookAt = null, onDone = null } = {}) {
    this.mode = 'auto';
    this.path = { pts: points.map(([x, z]) => new THREE.Vector2(x, z)), i: 0, speed, lookAt, onDone, endT: 0 };
  }

  /** Осмотр узла: подойти головой к точке на расстояние dist, смотреть на неё. Выход — exitInspect(). */
  startInspect(point, normal, dist = 0.42) {
    const from = this.camera.position.clone();
    const dir = normal ? normal.clone().normalize() : from.clone().sub(point).normalize();
    if (dir.dot(from.clone().sub(point)) < 0) dir.negate();
    const target = point.clone().addScaledVector(dir, dist);
    target.y = THREE.MathUtils.clamp(target.y, 0.35, 2.3);
    this.inspect = { point: point.clone(), from, fromYaw: this.yaw, fromPitch: this.pitch, target, t: 0, dragYaw: 0, dragPitch: 0 };
    this.mode = 'inspect';
  }

  exitInspect() {
    if (!this.inspect) return;
    this.inspect.leaving = true;
    this.inspect.t = Math.min(this.inspect.t, 1);
  }

  collide(p) {
    for (const c of this.colliders) {
      const cx = THREE.MathUtils.clamp(p.x, c.x0, c.x1), cz = THREE.MathUtils.clamp(p.z, c.z0, c.z1);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < RADIUS * RADIUS) {
        if (d2 < 1e-8) { p.x += RADIUS; continue; }
        const d = Math.sqrt(d2), push = RADIUS - d;
        p.x += (dx / d) * push; p.z += (dz / d) * push;
      }
    }
  }

  update(dt) {
    this.t += dt;
    const prevYaw = this.yaw, prevPitch = this.pitch;
    let speed = 0;
    if (this.mode === 'walk') {
      const f = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      const s = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      const run = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const vmax = (run ? 2.4 : 1.35) * (this.crouch ? 0.45 : 1);
      const fw = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const rt = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const want = fw.multiplyScalar(f).add(rt.multiplyScalar(s));
      if (want.lengthSq() > 1) want.normalize();
      want.multiplyScalar(vmax);
      this.vel.lerp(want, 1 - Math.exp(-dt * 8));                    // разгон/торможение
      tmp.copy(this.pos).addScaledVector(this.vel, dt);
      this.collide(tmp);
      this.pos.copy(tmp);
      speed = Math.hypot(this.vel.x, this.vel.z);
    } else if (this.mode === 'auto' && this.path) {
      const P = this.path;
      const target = P.pts[P.i];
      const cur = new THREE.Vector2(this.pos.x, this.pos.z);
      const d = target.clone().sub(cur);
      if (d.length() < 0.15) {
        if (P.i < P.pts.length - 1) P.i++;
        else {
          this.vel.set(0, 0, 0);
          P.endT += dt;
          if (P.lookAt) this.turnTo(P.lookAt, dt, 2.5);
          if (P.endT > 0.9) { const cb = P.onDone; this.path = null; this.mode = 'walk'; cb?.(); }
        }
      } else {
        const v = Math.min(P.speed, d.length() * 1.6 + 0.3);
        d.normalize();
        this.pos.x += d.x * v * dt; this.pos.z += d.y * v * dt;
        this.vel.set(d.x * v, 0, d.y * v);
        speed = v;
        // взгляд — по ходу движения, чуть вниз; поворот головы плавный
        const yawT = Math.atan2(-d.x, -d.y);
        this.yaw += wrap(yawT - this.yaw) * (1 - Math.exp(-dt * 3));
        this.pitch += (-0.12 - this.pitch) * (1 - Math.exp(-dt * 2));
      }
    }
    // высота глаз: присед, плавно
    this.eye += ((this.crouch ? 1.12 : this.eyeStand) - this.eye) * (1 - Math.exp(-dt * 6));
    // шаг: вертикальное покачивание 2 раза за цикл, боковое — 1 раз; дыхание
    this.phase += dt * speed * 1.75;
    const amp = Math.min(1, speed / 1.4);
    const bobY = Math.sin(this.phase * Math.PI * 2) * 0.022 * amp + Math.sin(this.t * 1.6) * 0.003;
    const bobX = Math.sin(this.phase * Math.PI) * 0.018 * amp;
    const cam = this.camera;
    if (this.mode === 'inspect' && this.inspect) {
      const I = this.inspect;
      I.t = Math.min(1, I.t + dt * (I.leaving ? -1.6 : 1.4));
      const k = I.t * I.t * (3 - 2 * I.t);
      const eyeP = new THREE.Vector3(this.pos.x, this.eye, this.pos.z);
      cam.position.lerpVectors(eyeP, I.target, k);
      cam.position.y += Math.sin(this.t * 1.6) * 0.002;
      const lookDir = I.point.clone().sub(cam.position);
      const yawT = Math.atan2(-lookDir.x, -lookDir.z) + I.dragYaw;
      const pitchT = Math.atan2(lookDir.y, Math.hypot(lookDir.x, lookDir.z)) + I.dragPitch;
      cam.rotation.set(lerpAng(this.pitch, pitchT, k), lerpAng(this.yaw, yawT, k), 0, 'YXZ');
      if (I.leaving && I.t <= 0) { this.inspect = null; this.mode = 'walk'; }
    } else {
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      cam.position.set(this.pos.x, this.eye + bobY, this.pos.z).addScaledVector(right, bobX);
      cam.rotation.set(this.pitch + Math.sin(this.phase * Math.PI * 2) * 0.004 * amp, this.yaw + Math.sin(this.t * 0.7) * 0.002, Math.sin(this.phase * Math.PI) * 0.006 * amp, 'YXZ');
    }
    this.angVel.set(wrap(this.yaw - prevYaw) / Math.max(dt, 1e-3), (this.pitch - prevPitch) / Math.max(dt, 1e-3));
    this.speed = speed;
  }

  /** В режиме осмотра — обзор мышью вокруг точки. */
  lookInspect(dx, dy) {
    if (!this.inspect) return;
    this.inspect.dragYaw = THREE.MathUtils.clamp(this.inspect.dragYaw - dx * 0.003, -0.8, 0.8);
    this.inspect.dragPitch = THREE.MathUtils.clamp(this.inspect.dragPitch - dy * 0.003, -0.6, 0.6);
  }

  turnTo([x, y, z], dt, rate = 3) {
    const d = new THREE.Vector3(x - this.pos.x, y - this.eye, z - this.pos.z);
    const yawT = Math.atan2(-d.x, -d.z), pitchT = Math.atan2(d.y, Math.hypot(d.x, d.z));
    this.yaw += wrap(yawT - this.yaw) * (1 - Math.exp(-dt * rate));
    this.pitch += (pitchT - this.pitch) * (1 - Math.exp(-dt * rate));
  }
}

function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function lerpAng(a, b, k) { return a + wrap(b - a) * k; }
