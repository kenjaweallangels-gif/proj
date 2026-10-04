// Руки от первого лица: предплечья в рукавах дистикомба и кисти — видны ТОЛЬКО во время взаимодействий
// (раздвинуть занавес, пульт харвестера, постановка/подбор тампера). Тела нет.
// Простая двухзвенная IK в системе камеры (камера смотрит в -Z, +X вправо, +Y вверх); руки «выезжают» снизу кадра и прячутся обратно.
import * as THREE from 'three';
import { PALETTES, PRESETS } from '../core/figures.js';
import { clamp } from '../core/util.js';

const L1 = 0.30, L2 = 0.27, HAND = 0.1;          // плечо→локоть, локоть→запястье, кисть (м)
const SHOULDER = [[-0.24, -0.27, -0.06], [0.24, -0.27, -0.06]]; // левое, правое — относительно камеры
const HIDDEN = [[-0.2, -0.62, -0.12], [0.2, -0.62, -0.12]];     // запястье «за кадром» (снизу)
const REACH_MAX = 0.56;

export function createViewHands(game, p) {
  const cam = game.camera;
  const look = PRESETS?.Kair || {};
  const skin = new THREE.MeshStandardMaterial({ color: look.skin || '#7a563a', roughness: 0.72 });
  const suit = new THREE.MeshStandardMaterial({ color: look.suit || '#4a4038', roughness: 0.92 });
  const cuff = new THREE.MeshStandardMaterial({ color: look.accent || '#2c3e57', roughness: 0.8 });
  const unit = (r0, r1) => new THREE.CylinderGeometry(r1, r0, 1, 10, 1); // ось Y, длина 1, у +Y — r1
  const g = new THREE.Group(); g.name = 'ViewHands'; g.visible = false;
  const arms = [0, 1].map((i) => {
    const upper = new THREE.Mesh(unit(0.052, 0.045), suit), fore = new THREE.Mesh(unit(0.045, 0.036), suit), cf = new THREE.Mesh(unit(0.04, 0.04), cuff);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 1, 0.034), skin), thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.05, 3, 6), skin);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.047, 10, 8), suit);
    for (const m of [upper, fore, cf, palm, thumb, elbow]) { m.frustumCulled = false; m.renderOrder = 998; g.add(m); }
    return { upper, fore, cf, palm, thumb, elbow, w: 0, target: null, kind: 'touch', t: 0, dur: 0, side: i };
  });
  game.scene.add(g);

  let reach = null;                    // постоянная цель правой руки (занавес / p.reachTarget)
  const qInv = new THREE.Quaternion(), S = new THREE.Vector3(), T = new THREE.Vector3(), W = new THREE.Vector3(), El = new THREE.Vector3();
  const ax = new THREE.Vector3(), pole = new THREE.Vector3(), fd = new THREE.Vector3(), tmp = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

  function seg(m, a, b, thick = 1) {
    tmp.subVectors(b, a); const len = tmp.length() || 1e-4;
    m.position.copy(a).addScaledVector(tmp, 0.5);
    m.quaternion.setFromUnitVectors(Y, tmp.multiplyScalar(1 / len));
    m.scale.set(thick, len, thick);
  }
  /** Поставить руку: плечо S, запястье W (камерная система). */
  function pose(a, Sv, Wv) {
    ax.subVectors(Wv, Sv); let d = ax.length(); if (d < 1e-4) { ax.set(0, 0, -1); d = 1e-4; } ax.multiplyScalar(1 / d);
    d = clamp(d, 0.18, L1 + L2 - 0.01);
    const x = (d * d + L1 * L1 - L2 * L2) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
    pole.set((a.side ? 0.55 : -0.55), -1, 0.25); pole.addScaledVector(ax, -pole.dot(ax)).normalize();
    El.copy(Sv).addScaledVector(ax, x).addScaledVector(pole, h);
    W.copy(Sv).addScaledVector(ax, d);
    seg(a.upper, Sv, El); seg(a.fore, El, W);
    a.elbow.position.copy(El);
    fd.subVectors(W, El).normalize();
    tmp.copy(W).addScaledVector(fd, -0.045); seg(a.cf, tmp, W.clone().addScaledVector(fd, 0.012));
    tmp.copy(W).addScaledVector(fd, HAND);
    seg(a.palm, W, tmp);
    a.thumb.position.copy(W).addScaledVector(fd, 0.04).add(tmp.set(a.side ? -0.05 : 0.05, 0.0, 0.0));
    a.thumb.quaternion.setFromUnitVectors(Y, fd);
  }

  return {
    group: g,
    arms,
    /** Постоянная цель правой руки (мировая точка) или null. */
    setReach(point) { reach = point || null; },
    /** Разовый жест: рука(и) тянутся к мировой точке dur секунд. kind: 'touch' (дотянуться), 'press' (нажать пульт), 'plant' (поставить тампер, обе руки). */
    gesture(point, dur = 0.9, kind = 'touch') {
      const set = (a) => { a.target = new THREE.Vector3().copy(point); a.t = 0; a.dur = dur; a.kind = kind; };
      set(arms[1]); if (kind === 'plant') set(arms[0]);
    },
    update(dt) {
      for (const a of arms) {
        let want = 0;
        if (a.target && a.t < a.dur) { a.t += dt; want = 1; } else a.target = null;
        if (a.side === 1 && reach) want = 1;
        a.w += (want - a.w) * (1 - Math.exp(-(want ? 11 : 8) * dt));
        if (a.w < 0.004) a.w = 0;
      }
    },
    /** После камеры игрока (lateUpdate): расставить руки в кадре. */
    lateUpdate() {
      const any = arms[0].w > 0 || arms[1].w > 0;
      g.visible = any && !game.freecam?.active && !game.cinematic?.active;
      if (!g.visible) return;
      g.position.copy(cam.position); g.quaternion.copy(cam.quaternion);
      qInv.copy(cam.quaternion).invert();
      for (const a of arms) {
        if (a.w <= 0) { a.upper.visible = a.fore.visible = a.cf.visible = a.palm.visible = a.thumb.visible = a.elbow.visible = false; continue; }
        a.upper.visible = a.fore.visible = a.cf.visible = a.palm.visible = a.thumb.visible = a.elbow.visible = true;
        S.fromArray(SHOULDER[a.side]);
        const pt = a.target && a.t < a.dur ? a.target : (a.side === 1 ? reach : null);
        const e = a.w * a.w * (3 - 2 * a.w);
        if (pt) {
          T.copy(pt).sub(cam.position).applyQuaternion(qInv);
          if (T.z > -0.15) T.set(a.side ? 0.18 : -0.18, -0.2, -0.6); // цель сзади/сбоку — рука вперёд-вниз
          ax.subVectors(T, S); const dist = ax.length(); ax.multiplyScalar(1 / (dist || 1));
          let len = clamp(dist * 0.85, 0.3, REACH_MAX);
          if (a.kind === 'press') { const u = clamp(a.t / a.dur, 0, 1); len = 0.40 + 0.16 * Math.sin(Math.PI * u); }
          W.copy(S).addScaledVector(ax, len);
        } else W.set(0, 0, -0.45).add(S);
        // выезд из-за кадра
        tmp.fromArray(HIDDEN[a.side]);
        W.lerpVectors(tmp, W, e);
        pose(a, S, W);
      }
    },
  };
}
