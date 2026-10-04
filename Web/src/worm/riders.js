// Наездники червя: 5 фигур (makeFigure). На ходу цепляются крючьями творца за швы колец: шест у рук, страховочный канат туго идёт к крюку
// впереди, корпус откинут назад, покачивание в такт волне тела; передний наездник «рулит» — вскрывает кольцо крюком-рычагом.
// Оссана и остальные умеют спускаться по канату, ходить и сидеть на песке (ими управляет encounter.js).
import * as THREE from 'three';
import { makeFigure } from '../core/figures.js';
import { RopeChain } from './gear.js';

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

export const RIDER_DEFS = [
  { name: 'Rider1', role: 'steer', s: 9, da: 0.02, cloth: '#1d1a17', suit: '#14120f', accent: '#5c2a1f', bulk: 1.05 },
  { name: 'Ossana', role: 'cling', s: 36, da: -0.16, cloth: '#4a3b2c', suit: '#3b302a', accent: '#2c3e57', skin: '#5a3e28', bulk: 1.05, height: 1.72 },
  { name: 'Rider3', role: 'cling', s: 62, da: 0.15, cloth: '#1b1c1e', suit: '#121315', accent: '#31475f', bulk: 1.08 },
  { name: 'Rider4', role: 'cling', s: 86, da: -0.12, cloth: '#3a2f24', suit: '#241d17', accent: '#6a4a22', bulk: 1.0 },
  { name: 'Rider5', role: 'cling', s: 110, da: 0.18, cloth: '#22262b', suit: '#15181c', accent: '#2c5a58', bulk: 1.02 },
];

export class Riders {
  constructor(game, spine, defs = RIDER_DEFS) {
    this.spine = spine;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.items = [];
    const poleMat = new THREE.MeshStandardMaterial({ color: '#3a2e22', roughness: 0.7, metalness: 0.2 });
    const metal = new THREE.MeshStandardMaterial({ color: '#7c7a74', roughness: 0.4, metalness: 0.8 });
    // шест-крюк: рукоять 2.6 м, на конце кованый крюк (входит в шов кольца), проушина под канат
    const shaftG = new THREE.CylinderGeometry(0.035, 0.05, 2.6, 6); shaftG.translate(0, 1.3, 0);
    const hookG = new THREE.TorusGeometry(0.26, 0.05, 6, 12, Math.PI * 1.3); hookG.rotateY(Math.PI / 2); hookG.translate(0, 0.02, 0.2);
    const eyeG = new THREE.TorusGeometry(0.1, 0.02, 5, 8); eyeG.translate(0, 2.5, 0);
    const stubG = new THREE.CylinderGeometry(0.03, 0.05, 0.9, 5); stubG.translate(0, 0.45, 0);
    const stubHook = new THREE.TorusGeometry(0.2, 0.05, 6, 10, Math.PI * 1.25); stubHook.rotateY(Math.PI / 2); stubHook.translate(0, 0.02, 0.16);
    const stubEye = new THREE.TorusGeometry(0.09, 0.02, 5, 8); stubEye.translate(0, 0.9, 0);
    for (const d of defs) {
      const fig = makeFigure({ height: d.height ?? 1.75, cloth: d.cloth, suit: d.suit, accent: d.accent, skin: d.skin, bulk: d.bulk, name: d.name, mask: true, hood: true });
      const root = new THREE.Group();
      root.add(fig.group);
      // переносной шест (за спиной) — виден, когда фигура свободна
      const carry = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.0, 6), poleMat);
      shaft.position.y = 1.4;
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 5, 10, Math.PI * 1.3), metal);
      hook.position.set(0, 0.02, -0.18); hook.rotation.y = Math.PI / 2;
      carry.add(shaft, hook);
      carry.position.set(0.42, -0.05, 0.25); carry.rotation.set(-0.28, 0, -0.12);
      carry.visible = false;
      root.add(carry);
      root.traverse((o) => {
        if (!o.isMesh || o === shaft || o === hook) return;
        o.castShadow = false;
        const m = o.material.clone();
        if (m.color) m.emissive = m.color.clone().multiplyScalar(0.22);
        o.material = m;
      });
      this.group.add(root);
      const pole = new THREE.Group();
      pole.add(new THREE.Mesh(shaftG, poleMat), new THREE.Mesh(hookG, metal), new THREE.Mesh(eyeG, metal));
      pole.matrixAutoUpdate = false; pole.visible = false;
      const stub = new THREE.Group();
      stub.add(new THREE.Mesh(stubG, poleMat), new THREE.Mesh(stubHook, metal), new THREE.Mesh(stubEye, metal));
      stub.matrixAutoUpdate = false; stub.visible = false;
      const rope = new RopeChain(3, 0.034, '#7a6444');
      const ladder = new RopeChain(16, 0.05, '#7a6444');
      this.group.add(pole, stub, rope.mesh, ladder.mesh);
      this.items.push({
        ...d, face: 0, fig, root, pole: carry, hookPole: pole, stub, rope, ladder, ladderPts: Array.from({ length: 15 }, () => new THREE.Vector3()),
        sNow: d.s, a: 0, free: false, hidden: false, moving: false, sitting: false,
        mode: d.role === 'steer' ? 'steer' : 'cling', clingW: d.role ? 1 : 0, ph: Math.random() * 6.28, hookOn: true, sitW: 0, ladderOn: false,
      });
    }
    this.aBase = 0;
    this.sway = 1;                 // 0..1: размах покачивания (скорость червя)
    this.lean = 0.34;              // рад, откидывание назад
    this.v = {
      P: new THREE.Vector3(), N: new THREE.Vector3(), T: new THREE.Vector3(), fwd: new THREE.Vector3(), right: new THREE.Vector3(),
      up2: new THREE.Vector3(), fw2: new THREE.Vector3(), rt2: new THREE.Vector3(), pos: new THREE.Vector3(), waist: new THREE.Vector3(),
      A: new THREE.Vector3(), B: new THREE.Vector3(), E: new THREE.Vector3(), hands: new THREE.Vector3(), D: new THREE.Vector3(), eye: new THREE.Vector3(),
    };
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    this._pts = [new THREE.Vector3(), new THREE.Vector3()];
    this._u = new THREE.Vector3(); this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._uS = new THREE.Vector3();
  }

  get ossana() { return this.items[1]; }
  byName(n) { return this.items.find((i) => i.name === n); }

  /** Поставить фигуру: pos — ступни; up — «верх» тела; fwd — куда смотрит (проецируется на плоскость ⟂ up). */
  placeFree(it, pos, up, fwd, scaleY = 1) {
    const u = this._u.copy(up).normalize();
    const f = this._f.copy(fwd).addScaledVector(u, -fwd.dot(u));
    if (f.lengthSq() < 1e-6) f.set(0, 0, 1).addScaledVector(u, -u.z);
    f.normalize();
    const r = this._r.crossVectors(u, f);
    this._m.makeBasis(r, this._uS.copy(u).multiplyScalar(scaleY), f).setPosition(pos);
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

  /** Поза «цепляется за шест»: колени согнуты, спина откинута, обе руки вперёд на шесте. w — вес 0..1, t — время, k — усилие, pry — рычаг. */
  poseCling(it, w, t, k = 1, pry = 0) {
    const f = it.fig.parts; if (!f?.limbs || w <= 0.001) return;
    const L = f.limbs, lerp = (a, b, x) => a + (b - a) * x;
    const sw = Math.sin(t * 1.7 + it.ph) * 0.06 * k;
    const set = (b, ax, v) => { b.rotation[ax] = lerp(b.rotation[ax], v, w); };
    set(L.L.sh, 'x', -1.28 + sw + pry * 0.25); set(L.R.sh, 'x', -1.22 - sw + pry * 0.25);
    set(L.L.sh, 'z', 0.2); set(L.R.sh, 'z', -0.2);
    set(L.L.el, 'x', -0.85 - pry * 0.3); set(L.R.el, 'x', -0.95 - pry * 0.3);
    set(L.L.hip, 'x', -0.85 + sw * 0.5); set(L.R.hip, 'x', -0.68 - sw * 0.5);
    set(L.L.kn, 'x', 1.25 + sw); set(L.R.kn, 'x', 1.05 - sw);
    set(L.L.foot, 'x', -0.45); set(L.R.foot, 'x', -0.35);
    set(f.spine, 'x', 0.12 + pry * 0.1); set(f.chest, 'x', 0.1);
    set(f.neck, 'x', -0.1);
    f.pelvis.position.y = lerp(f.pelvis.position.y, 0.92 - 0.36 - 0.1 * pry, w);
  }

  /** Поза «сидит на песке», руки на коленях (touch>0.5 — рука на теле червя). */
  poseSit(it, w, t, touch = 0) {
    const f = it.fig.parts; if (!f?.limbs || w <= 0.001) return;
    const L = f.limbs, lerp = (a, b, x) => a + (b - a) * x;
    const set = (b, ax, v) => { b.rotation[ax] = lerp(b.rotation[ax], v, w); };
    const br = Math.sin(t * 0.7 + it.ph) * 0.02;
    set(L.L.hip, 'x', -1.5); set(L.R.hip, 'x', -1.35); set(L.L.hip, 'z', -0.12); set(L.R.hip, 'z', 0.12);
    set(L.L.kn, 'x', 1.55); set(L.R.kn, 'x', 1.7);
    set(L.L.foot, 'x', -0.1); set(L.R.foot, 'x', -0.1);
    set(L.L.sh, 'x', -0.55); set(L.R.sh, 'x', touch > 0.5 ? -1.45 : -0.5 + br);
    set(L.R.sh, 'z', touch > 0.5 ? -0.25 : -0.12); set(L.L.sh, 'z', 0.12);
    set(L.L.el, 'x', -0.9); set(L.R.el, 'x', touch > 0.5 ? -0.25 : -0.85);
    set(f.spine, 'x', 0.18 + br); set(f.chest, 'x', 0.1); set(f.neck, 'x', 0.12);
    f.pelvis.position.y = lerp(f.pelvis.position.y, 0.2, w);
  }

  /** Верёвочная лестница наездника: якорь (s, a0) → к углу a1 по боку червя. null — убрать. */
  setLadder(it, spec) { it.ladderOn = !!spec; it.ladderSpec = spec; }

  _updateLadder(it) {
    if (!it.ladderOn || !it.ladderSpec) { it.ladder.set([]); return; }
    const L = it.ladderSpec, pts = it.ladderPts, n = 14, v = this.v;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      this.spine.surfacePoint(L.s, L.a0 + (L.a1 - L.a0) * u, pts[k], v.E, 0.35 + 0.15 * Math.sin(u * 3.14));
    }
    it.ladder.set(pts.slice(0, n + 1));
  }

  /** Крюки цепляния: шест у рук (воткнут в шов 1.2 м впереди), страховочный крюк 5.5 м впереди, канат туго от пояса. */
  _placeHooks(it, P, N, T, waist) {
    const sp = this.spine, v = this.v;
    const a = this.aBase + it.da + it.a;
    sp.surfacePoint(Math.max(0, it.sNow - 1.2), a + 0.05, v.A, v.E, -0.12);
    v.hands.copy(P).addScaledVector(N, 1.25).addScaledVector(T, 0.35);
    v.D.subVectors(v.hands, v.A).normalize();
    this._q.setFromUnitVectors(UP, v.D);
    it.hookPole.matrix.compose(v.A, this._q, ONE);
    it.hookPole.matrixWorldNeedsUpdate = true;
    sp.surfacePoint(Math.max(0, it.sNow - 5.5), a - 0.03, v.B, v.E, -0.1);
    this._q.setFromUnitVectors(UP, v.E);
    it.stub.matrix.compose(v.B, this._q, ONE);
    it.stub.matrixWorldNeedsUpdate = true;
    v.eye.copy(v.B).addScaledVector(v.E, 0.88);
    this._pts[0].copy(waist); this._pts[1].copy(v.eye);
    it.rope.set(this._pts);
  }

  /** Расставить стоящих/цепляющихся на спине. groundFn — для скрытия ушедших под песок. */
  update(dt, groundFn, time) {
    const sp = this.spine, v = this.v;
    for (const it of this.items) {
      it.pole.visible = it.free && !it.sitting && !it.hidden;
      this._updateLadder(it);
      const rigged = !it.free && !it.hidden && it.hookOn && it.root.visible !== false;
      it.hookPole.visible = rigged; it.stub.visible = rigged; it.rope.mesh.visible = rigged;
      if (it.free) continue;
      if (it.hidden) { it.root.visible = false; it.rope.set([]); continue; }
      const cl = it.mode === 'cling' || it.mode === 'steer';
      it.clingW += ((cl ? 1 : 0) - it.clingW) * (1 - Math.exp(-3 * dt));
      const k = this.sway;
      const ph = time * 1.15 + it.s * 0.07 + it.ph * 0.2;
      const lean = this.lean * it.clingW * (0.85 + 0.25 * Math.sin(ph) * k) + 0.02;
      const pry = it.mode === 'steer' ? 0.5 + 0.5 * Math.sin(time * 0.9 + it.ph) : 0;
      sp.surfacePoint(it.sNow, this.aBase + it.da + it.a, v.P, v.N, 0.14);
      v.T.copy(sp._b);
      const { P, N, T } = v;
      v.fwd.copy(T).addScaledVector(N, -T.dot(N)).normalize();
      if (it.face) v.fwd.applyAxisAngle(N, it.face);
      v.right.crossVectors(N, v.fwd);
      const cL = Math.cos(lean), sL = Math.sin(lean);
      const roll = 0.045 * k * Math.sin(ph * 0.8 + 1.3) * it.clingW;
      v.up2.copy(N).multiplyScalar(cL).addScaledVector(v.fwd, -sL).addScaledVector(v.right, roll).normalize();
      v.fw2.copy(v.fwd).multiplyScalar(cL).addScaledVector(N, sL);
      v.fw2.addScaledVector(v.up2, -v.fw2.dot(v.up2)).normalize();
      v.rt2.crossVectors(v.up2, v.fw2);
      v.pos.copy(P).addScaledVector(v.fwd, -0.38 * it.clingW);
      this._m.makeBasis(v.rt2, v.up2, v.fw2).setPosition(v.pos);
      it.root.matrixAutoUpdate = false;
      it.root.matrix.copy(this._m);
      it.root.matrixWorldNeedsUpdate = true;
      it.fig.animate(it.moving ? 2.4 : 0, dt);
      this.poseCling(it, it.clingW, time, 0.6 + 0.6 * k, pry);
      const under = P.y < groundFn(P.x, P.z) + 0.5;
      it.root.visible = !under;
      if (rigged) {
        v.waist.copy(P).addScaledVector(v.up2, 0.85).addScaledVector(v.fw2, 0.1);
        this._placeHooks(it, P, N, T, v.waist);
        it.hookPole.visible = it.stub.visible = it.rope.mesh.visible = !under;
      }
    }
  }
}
