// Двухзвенный IK руки (плечо–локоть–кисть) поверх анимации: жест «отодвинуть ткань/занавес».
// Рука поднимается к высоте груди, ладонь вперёд, при приближении к точке рука разворачивается в сторону (смахивает полог).
// Вызывается после anim.update: сначала берём позу анимации, затем смешиваем с IK по весу (slerp по локальным кватернионам).
import * as THREE from 'three';

const V = THREE.Vector3, Q = THREE.Quaternion;
const tS = new V(), tE = new V(), tH = new V(), tT = new V(), tD = new V(), tP = new V(), tA = new V(), tB = new V(), tL = new V();
const qa = new Q(), qb = new Q(), qc = new Q(), qd = new Q();

function worldQuat(o, out) { return o.getWorldQuaternion(out); }

/** Повернуть кость bone так, чтобы направление «кость→ребёнок» (мир) стало dirWorld; вес w смешивает с текущим вращением. */
function aimBone(bone, child, dirWorld, w) {
  bone.updateWorldMatrix(true, true);
  child.getWorldPosition(tA); bone.getWorldPosition(tB);
  tA.sub(tB).normalize();
  qa.setFromUnitVectors(tA, dirWorld);                 // дельта в мире
  worldQuat(bone, qb);
  qb.premultiply(qa);                                  // новая мировая ориентация
  bone.parent.getWorldQuaternion(qc).invert();
  qc.multiply(qb);                                     // локальная
  bone.quaternion.slerp(qc, w);
  bone.updateWorldMatrix(true, true);
}

export function createArmIK(parts, group) {
  const st = { w: 0, tw: 0, target: new V(), has: false, side: 'R', sweep: 0.22, roll: 1, prog: 0, wSide: { L: 0, R: 0 }, tgtSide: { L: null, R: null } };
  const reach = { L: { w: 0, tw: 0, p: new V(), has: false, opts: null }, R: { w: 0, tw: 0, p: new V(), has: false, opts: null } };

  return {
    /** point: THREE.Vector3 (мир) | null. weight 0..1. opts: {sweep: м, palm: bool, speed: λ}. */
    reachTo(point, side = 'R', weight = 1, opts) {
      const r = reach[side === 'L' ? 'L' : 'R'];
      if (!point) { r.tw = 0; return; }
      r.p.copy(point); r.has = true; r.tw = weight; r.opts = opts || null;
    },
    handWorld(side = 'R', out = new V()) {
      const h = parts.limbs[side === 'L' ? 'L' : 'R'].hand;
      h.updateWorldMatrix(true, false);
      return out.set(0, -0.08, 0.02).applyMatrix4(h.matrixWorld);
    },
    active() { return reach.L.w > 0.01 || reach.R.w > 0.01 || reach.L.tw > 0 || reach.R.tw > 0; },
    /** После анимации скелета. dt — шаг, для сглаживания веса. */
    apply(dt) {
      for (const k of ['L', 'R']) {
        const r = reach[k];
        r.w += (r.tw - r.w) * (1 - Math.exp(-dt * (r.opts?.speed ?? 7)));
        if (r.w < 0.004) { if (r.tw === 0) r.has = false; continue; }
        const limb = parts.limbs[k], sgn = k === 'L' ? -1 : 1;
        const sh = limb.sh, el = limb.el, hand = limb.hand;
        group.updateWorldMatrix(true, false);
        sh.updateWorldMatrix(true, true);
        sh.getWorldPosition(tS); el.getWorldPosition(tE); hand.getWorldPosition(tH);
        const L1 = tS.distanceTo(tE), L2 = tE.distanceTo(tH);
        // целевая точка + «смахивание» вбок при приближении фигуры
        tT.copy(r.p);
        const sweep = r.opts?.sweep ?? 0.22;
        if (sweep) {
          const gp = group.position;
          const dx = r.p.x - gp.x, dz = r.p.z - gp.z, dist = Math.hypot(dx, dz);
          const near = THREE.MathUtils.smoothstep(1.1 - dist, 0.2, 1.1);       // 0 далеко → 1 вплотную
          group.getWorldQuaternion(qd);
          tD.set(sgn, 0, 0).applyQuaternion(qd);                             // «наружу» для этой руки
          tT.addScaledVector(tD, sweep * near * (0.6 + 0.4 * Math.sin(r.w * 3.14)));
          tT.y += 0.05 * near;
        }
        // ограничение досягаемости
        tD.subVectors(tT, tS); let d = tD.length();
        const maxR = (L1 + L2) * 0.985, minR = Math.abs(L1 - L2) + 0.02;
        const dd = THREE.MathUtils.clamp(d, minR, maxR);
        tD.normalize();
        // полюс: локоть вниз и наружу, немного назад
        group.getWorldQuaternion(qd);
        tP.set(sgn * 0.55, -0.7, -0.45).applyQuaternion(qd).normalize();
        tP.addScaledVector(tD, -tP.dot(tD)).normalize();
        const a = Math.acos(THREE.MathUtils.clamp((L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd), -1, 1));
        tE.copy(tS).addScaledVector(tD, Math.cos(a) * L1).addScaledVector(tP, Math.sin(a) * L1);
        tH.copy(tS).addScaledVector(tD, dd);
        // плечо → локоть
        tL.subVectors(tE, tS).normalize();
        aimBone(sh, el, tL, r.w);
        // локоть → кисть
        tL.subVectors(tH, tE);
        el.getWorldPosition(tA);
        tL.subVectors(tH, tA).normalize();
        aimBone(el, hand, tL, r.w);
        // ладонь вперёд: докрутка предплечья вокруг своей оси
        if (r.opts?.palm !== false) {
          qa.setFromAxisAngle(new V(0, 1, 0), -sgn * 1.25 * r.w);
          el.quaternion.multiply(qa);
          hand.quaternion.slerp(qb.setFromEuler(new THREE.Euler(-0.5, 0, 0)), 0.5 * r.w);
        }
        el.updateWorldMatrix(true, true);
      }
    },
  };
}
