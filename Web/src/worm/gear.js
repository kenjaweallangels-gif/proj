// Снаряжение укрощённого червя: крючья творца в швах колец, канаты, сёдла; фигуры наездников (makeFigure из core).
// Всё привязано к поверхности тела через spine.surfacePoint(s, a): s — метры от головы, a — угол вокруг (0 — верх).
import * as THREE from 'three';
import { makeFigure } from '../core/figures.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Канат из N цилиндрических сегментов (один InstancedMesh). */
export class RopeChain {
  constructor(maxSeg, radius = 0.045, color = '#6e5a3c') {
    const g = new THREE.CylinderGeometry(radius, radius, 1, 5, 1, true);
    this.mesh = new THREE.InstancedMesh(g, RopeChain.mat(color), maxSeg);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.max = maxSeg;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._d = new THREE.Vector3(); this._c = new THREE.Vector3(); this._s = new THREE.Vector3();
  }
  static mat(color) {
    RopeChain._cache = RopeChain._cache || {};
    return (RopeChain._cache[color] ||= new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 }));
  }
  /** points: массив Vector3 (>=2). */
  set(points) {
    const n = Math.min(points.length - 1, this.max);
    for (let i = 0; i < n; i++) {
      const a = points[i], b = points[i + 1];
      this._d.subVectors(b, a);
      const len = this._d.length();
      if (len < 1e-4) { this._s.set(0, 0, 0); this._m.compose(a, this._q.identity(), this._s); this.mesh.setMatrixAt(i, this._m); continue; }
      this._d.multiplyScalar(1 / len);
      this._q.setFromUnitVectors(UP, this._d);
      this._c.addVectors(a, b).multiplyScalar(0.5);
      this._s.set(1, len, 1);
      this._m.compose(this._c, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.count = Math.max(0, n);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = n > 0;
  }
}

function frameMatrix(P, N, T, out, yaw = 0, scale = 1) {
  const f = T.clone().addScaledVector(N, -T.dot(N)).normalize();
  if (yaw) f.applyAxisAngle(N, yaw);
  const r = new THREE.Vector3().crossVectors(N, f);
  return out.makeBasis(r.multiplyScalar(scale), N.clone().multiplyScalar(scale), f.multiplyScalar(scale)).setPosition(P);
}

export class Gear {
  constructor(spine, hookCount = 14) {
    this.spine = spine;
    this.group = new THREE.Group();
    this.group.name = 'WormGear';
    this.group.visible = false;
    const iron = new THREE.MeshStandardMaterial({ color: '#4a4640', roughness: 0.45, metalness: 0.85 });
    const wood = new THREE.MeshStandardMaterial({ color: '#4a3826', roughness: 0.85, metalness: 0 });
    const wool = new THREE.MeshStandardMaterial({ color: '#6a2f22', roughness: 1, metalness: 0 });
    const wool2 = new THREE.MeshStandardMaterial({ color: '#2f3a4a', roughness: 1, metalness: 0 });
    const leather = new THREE.MeshStandardMaterial({ color: '#5a4026', roughness: 0.9, metalness: 0 });
    this.mats = { iron, wood, wool, leather };
    this._P = new THREE.Vector3(); this._N = new THREE.Vector3(); this._T = new THREE.Vector3(); this._m = new THREE.Matrix4();
    this._A = new THREE.Vector3(); this._B = new THREE.Vector3();

    // --- крючья: кованый крюк, вбитый в шов между кольцами, шест-рукоять, проушина под канат ---
    const shaftG = new THREE.CylinderGeometry(0.05, 0.07, 2.4, 6); shaftG.translate(0, 1.2, 0);
    const hookG = new THREE.TorusGeometry(0.42, 0.07, 6, 14, Math.PI * 1.35); hookG.rotateY(Math.PI / 2); hookG.translate(0, -0.1, 0.25);
    const eyeG = new THREE.TorusGeometry(0.13, 0.025, 5, 10); eyeG.translate(0, 2.35, 0);
    this.hooks = [];
    const side0 = [-1, 1];
    for (let i = 0; i < hookCount; i++) {
      const root = new THREE.Group();
      const pole = new THREE.Group();
      pole.add(new THREE.Mesh(shaftG, wood), new THREE.Mesh(hookG, iron), new THREE.Mesh(eyeG, iron));
      pole.rotation.x = -0.32;                                   // наклон назад, к хвосту
      root.add(pole);
      root.matrixAutoUpdate = false;
      this.group.add(root);
      const k = 6 + Math.floor(i * 1.4);
      const side = side0[i % 2];
      this.hooks.push({ root, pole, s: 4 * k + 3.86, a: side * (0.16 + 0.12 * ((i * 37) % 7) / 7 + 0.1 * (i % 3)), side, popT: -1, ropeIdx: i, bolt: new THREE.Vector3() });
    }
    // --- канаты: от проушины вниз по боку вдоль шва кольца (привязаны к кольцам) ---
    this.ropes = this.hooks.map(() => { const r = new RopeChain(9, 0.05); this.group.add(r.mesh); return r; });

    // --- сёдла и поклажа (по одному на наездника; s задаётся извне) ---
    this.saddles = [];
    this.ties = new RopeChain(12, 0.04, '#7a6444'); this.group.add(this.ties.mesh);
    this.ladder = new RopeChain(16, 0.05, '#7a6444'); this.group.add(this.ladder.mesh);
    this._ladderPts = Array.from({ length: 17 }, () => new THREE.Vector3());
    this._tiePts = [];
    this.ladderOn = false;
  }

  /** Седло: плетёный мат на спине + мешки, бурдюк, свёрнутый канат. */
  addSaddle(s, a = 0, color = 0) {
    const root = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.16, 14), color ? this.mats.leather : this.mats.wool);
    pad.position.y = 0.06;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.06, 5, 20), this.mats.leather); rim.rotation.x = Math.PI / 2; rim.position.y = 0.16;
    const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 4, 8), this.mats.leather); bag.rotation.z = Math.PI / 2; bag.position.set(0.9, 0.3, -0.5); bag.rotation.y = 0.5;
    const skin = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), this.mats.wool); skin.scale.set(1, 0.7, 1.2); skin.position.set(-0.9, 0.3, 0.4);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 5, 12), RopeChain.mat('#7a6444')); coil.rotation.x = Math.PI / 2; coil.position.set(-0.5, 0.3, -0.9);
    root.add(pad, rim, bag, skin, coil);
    root.matrixAutoUpdate = false;
    this.group.add(root);
    this.saddles.push({ root, s, a });
  }

  /** Сломать (выбить) крюк i — он вылетает из шва вместе с канатом. */
  crack(i) { const h = this.hooks[i]; if (h && h.popT < 0) h.popT = 0; }
  crackAll() { this.hooks.forEach((h, i) => this.crack(i)); }
  resetHooks() { this.hooks.forEach((h) => { h.popT = -1; h.root.visible = true; }); }
  get hookCount() { return this.hooks.length; }
  allCracked() { return this.hooks.every((h) => h.popT >= 1.4); }

  /** Подвесная верёвка-лестница: якорь на (s, aTop), спуск по боку к aEnd. null — убрать. */
  setLadder(spec) { this.ladderOn = !!spec; this._ladder = spec; }

  update(dt) {
    const sp = this.spine, P = this._P, N = this._N, m = this._m;
    for (let i = 0; i < this.hooks.length; i++) {
      const h = this.hooks[i];
      if (h.popT >= 0) h.popT += dt;
      if (h.popT >= 1.4) { h.root.visible = false; this.ropes[i].set([]); continue; }
      sp.surfacePoint(h.s, h.a, P, N, 0.05);
      const T = sp._b;
      frameMatrix(P, N, T, m);
      if (h.popT >= 0) {            // вылет: вверх и вбок по параболе, кувыркаясь
        const u = h.popT;
        const out = N.clone().multiplyScalar(2.0 * u).addScaledVector(UP, 3.0 * u - 5 * u * u);
        const mm = new THREE.Matrix4().makeRotationX(u * 7).setPosition(out);
        m.multiply(mm);
        h.root.matrix.copy(m); h.root.matrixWorldNeedsUpdate = true;
        this.ropes[i].set([]);
        continue;
      }
      h.root.matrix.copy(m); h.root.matrixWorldNeedsUpdate = true;
      // проушина в мировых координатах
      h.bolt.set(0, 2.35, 0).applyEuler(h.pole.rotation).applyMatrix4(m);
      // канат: от проушины к шву, затем вдоль шва по боку
      const pts = this.ropes[i]._pts || (this.ropes[i]._pts = Array.from({ length: 9 }, () => new THREE.Vector3()));
      pts[0].copy(h.bolt);
      const aEnd = h.a + h.side * (0.9 + 0.25 * ((i * 13) % 5) / 5);
      for (let k = 1; k < 9; k++) {
        const u = k / 8;
        const a = h.a + (aEnd - h.a) * u;
        sp.surfacePoint(h.s + 0.2 * Math.sin(u * 3.14), a, pts[k], this._B, 0.22 + 0.2 * Math.sin(u * 3.14));
      }
      this.ropes[i].set(pts);
    }
    // сёдла
    const ties = this._tiePts; ties.length = 0;
    for (const sd of this.saddles) {
      sp.surfacePoint(sd.s, sd.a, P, N, 0.04);
      frameMatrix(P, N, sp._b, m, sd.yaw || 0);
      sd.root.matrix.copy(m); sd.root.matrixWorldNeedsUpdate = true;
    }
    // подвесная лестница
    if (this.ladderOn && this._ladder) {
      const L = this._ladder, pts = this._ladderPts;
      const n = 14;
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        sp.surfacePoint(L.s, L.a0 + (L.a1 - L.a0) * u, pts[k], this._B, 0.35 + 0.15 * Math.sin(u * 3.14));
      }
      this.ladder.set(pts.slice(0, n + 1));
    } else this.ladder.set([]);
  }
}

/** Наездники: фигуры (makeFigure) стоят на спине; Оссана умеет спускаться по боку и ходить по песку (управляет encounter.js). */
export class Riders {
  constructor(game, spine) {
    this.spine = spine;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.items = [];
    const defs = [
      { name: 'Rider1', s: 36, da: -0.14, face: 0.35, cloth: '#1d1a17', suit: '#14120f', accent: '#5c2a1f', bulk: 1.05, pole: true },
      { name: 'Ossana', s: 60, da: 0.0, face: 0.0, cloth: '#4a3b2c', suit: '#3b302a', accent: '#2c3e57', skin: '#5a3e28', bulk: 1.05, height: 1.72, pole: true },
      { name: 'Rider3', s: 84, da: 0.15, face: -0.5, cloth: '#1b1c1e', suit: '#121315', accent: '#31475f', bulk: 1.08, pole: true },
    ];
    const poleMat = new THREE.MeshStandardMaterial({ color: '#3a2e22', roughness: 0.7, metalness: 0.2 });
    const metal = new THREE.MeshStandardMaterial({ color: '#6c6a66', roughness: 0.4, metalness: 0.8 });
    for (const d of defs) {
      const fig = makeFigure({ height: d.height ?? 1.75, cloth: d.cloth, suit: d.suit, accent: d.accent, skin: d.skin, bulk: d.bulk, name: d.name, mask: true, hood: true });
      const root = new THREE.Group();
      root.add(fig.group);
      // шест с крюком в руке (на спине) — прячется, когда фигура на песке/на канате
      const pole = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.2, 6), poleMat);
      shaft.position.y = 1.5;
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 5, 10, Math.PI * 1.3), metal);
      hook.position.set(0, 0.02, -0.18); hook.rotation.y = Math.PI / 2;
      pole.add(shaft, hook);
      pole.position.set(0.42, -0.05, 0.25);
      pole.rotation.set(-0.28, 0, -0.12);
      root.add(pole);
      // материалы фигур общие (кэш figures.js) — клонируем и добавляем слабую подсветку, чтобы силуэты читались против солнца
      root.traverse((o) => {
        if (!o.isMesh || o === shaft || o === hook) return;
        o.castShadow = false;
        const m = o.material.clone();
        if (m.color) m.emissive = m.color.clone().multiplyScalar(0.22);
        o.material = m;
      });
      this.group.add(root);
      this.items.push({ ...d, fig, root, pole, sNow: d.s, a: 0, free: false, hidden: false, moving: false, wantPole: true });
    }
    this.aBase = 0;
    this._P = new THREE.Vector3(); this._N = new THREE.Vector3(); this._T = new THREE.Vector3();
    this._B = new THREE.Vector3(); this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._r = new THREE.Vector3(); this._f = new THREE.Vector3(); this._u = new THREE.Vector3();
  }

  get ossana() { return this.items[1]; }

  /** Поставить фигуру: pos — ступни; up — «верх» тела; fwd — куда смотрит (проецируется на плоскость ⟂ up). */
  placeFree(it, pos, up, fwd, scaleY = 1) {
    const u = this._u.copy(up).normalize();
    const f = this._f.copy(fwd).addScaledVector(u, -fwd.dot(u));
    if (f.lengthSq() < 1e-6) f.set(0, 0, 1).addScaledVector(u, -u.z);
    f.normalize();
    const r = this._r.crossVectors(u, f);
    this._m.makeBasis(r, u.clone().multiplyScalar(scaleY), f).setPosition(pos);
    it.root.matrixAutoUpdate = false;
    it.root.matrix.copy(this._m);
    it.root.matrixWorldNeedsUpdate = true;
    it.root.visible = true;
  }

  /** Поза «спуск/подъём по канату»: руки вверх на канат, ноги шагают по борту (phase — радианы цикла). */
  poseClimb(it, phase, amount = 1) {
    const L = it.fig.parts?.limbs; if (!L) return;
    const sw = Math.sin(phase);
    L.L.sh.rotation.x = -2.55 + 0.25 * sw * amount; L.R.sh.rotation.x = -2.55 - 0.25 * sw * amount;
    L.L.el.rotation.x = -0.5 - 0.3 * Math.max(0, sw); L.R.el.rotation.x = -0.5 - 0.3 * Math.max(0, -sw);
    L.L.hip.rotation.x = -0.35 + 0.55 * sw * amount; L.R.hip.rotation.x = -0.35 - 0.55 * sw * amount;
    L.L.kn.rotation.x = 0.7 + 0.5 * Math.max(0, -sw); L.R.kn.rotation.x = 0.7 + 0.5 * Math.max(0, sw);
  }

  /** Расставить стоящих на спине. groundFn — для скрытия ушедших под песок. */
  update(dt, groundFn, time) {
    const sp = this.spine;
    for (const it of this.items) {
      it.pole.visible = it.wantPole && !it.free;
      if (it.free) continue;
      if (it.hidden) { it.root.visible = false; continue; }
      sp.surfacePoint(it.sNow, this.aBase + it.da + it.a, this._P, this._N, 0.2);
      const T = sp._b;
      const up = this._N;
      const fwd = this._f.copy(T).addScaledVector(up, -T.dot(up)).normalize().applyAxisAngle(up, it.face || 0);
      const right = this._r.crossVectors(up, fwd);
      this._m.makeBasis(right, up, fwd).setPosition(this._P);
      it.root.matrixAutoUpdate = false;
      it.root.matrix.copy(this._m);
      it.root.matrixWorldNeedsUpdate = true;
      it.fig.animate(it.moving ? 2.4 : 0, dt);
      const under = this._P.y < groundFn(this._P.x, this._P.z) + 0.5;
      it.root.visible = !under;
    }
  }
}
