// Процедурная фигура человека в одежде пустыни (общая для игрока, спутников, толпы, наездников).
// makeFigure(opts) → { group, animate(speed, dt), setTalking(b), parts, height }
// Ось «вперёд» фигуры — +Z локальной группы. Пивот — у ступней.
import * as THREE from 'three';

const matCache = new Map();
function mat(color, rough = 0.9, extra = {}) {
  const key = `${color}|${rough}|${JSON.stringify(extra)}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra }));
  }
  return matCache.get(key);
}

const geo = {
  head: new THREE.SphereGeometry(0.11, 14, 10),
  hood: new THREE.SphereGeometry(0.135, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
  mask: new THREE.CylinderGeometry(0.1, 0.105, 0.09, 12, 1, true, -Math.PI * 0.55, Math.PI * 1.1),
  neck: new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8),
  torso: new THREE.CylinderGeometry(0.17, 0.2, 0.55, 12),
  robe: new THREE.CylinderGeometry(0.2, 0.36, 0.95, 16, 3, true),
  arm: new THREE.CylinderGeometry(0.045, 0.055, 0.32, 8),
  forearm: new THREE.CylinderGeometry(0.04, 0.045, 0.3, 8),
  hand: new THREE.SphereGeometry(0.045, 8, 6),
  leg: new THREE.CylinderGeometry(0.065, 0.055, 0.45, 8),
  shin: new THREE.CylinderGeometry(0.055, 0.045, 0.43, 8),
  foot: new THREE.BoxGeometry(0.09, 0.06, 0.22),
  belt: new THREE.TorusGeometry(0.19, 0.022, 6, 18),
  pack: new THREE.BoxGeometry(0.26, 0.32, 0.12),
  tube: new THREE.TorusGeometry(0.12, 0.012, 6, 16, Math.PI),
};
for (const g of Object.values(geo)) g.computeBoundingSphere();
// Робу сместить так, чтобы низ был у колен.
geo.robe.translate(0, -0.475, 0);

/**
 * @param {object} o
 * @param {number} [o.height=1.75]
 * @param {string} [o.cloth='#8a6a48']   накидка/роба
 * @param {string} [o.suit='#4a4038']    дистикомб
 * @param {string} [o.accent='#2c3e57']  пояс/платок
 * @param {string} [o.skin='#9c7458']
 * @param {boolean} [o.hood=true]
 * @param {boolean} [o.mask=true]        маска дистикомба
 * @param {boolean} [o.robe=true]
 * @param {boolean} [o.pack=false]
 * @param {boolean} [o.eyesIbad=false]   синие глаза ибад (видно только вблизи)
 * @param {number} [o.bulk=1]
 */
export function makeFigure(o = {}) {
  const H = o.height ?? 1.75;
  const s = H / 1.75;
  const g = new THREE.Group();
  g.name = o.name || 'Figure';
  const root = new THREE.Group();
  root.scale.setScalar(s);
  g.add(root);
  const suit = mat(o.suit || '#4a4038', 0.75);
  const cloth = mat(o.cloth || '#8a6a48', 0.95, { side: THREE.DoubleSide });
  const accent = mat(o.accent || '#2c3e57', 0.85);
  const skin = mat(o.skin || '#9c7458', 0.6);
  const bulk = o.bulk ?? 1;

  const pelvis = new THREE.Group(); pelvis.position.y = 0.92; root.add(pelvis);
  const spine = new THREE.Group(); pelvis.add(spine);
  const torso = new THREE.Mesh(geo.torso, suit); torso.position.y = 0.3; torso.scale.set(bulk, 1, bulk * 0.8); spine.add(torso);
  const belt = new THREE.Mesh(geo.belt, accent); belt.rotation.x = Math.PI / 2; belt.position.y = 0.04; belt.scale.set(bulk, bulk * 0.8, 1); spine.add(belt);
  const neck = new THREE.Mesh(geo.neck, skin); neck.position.y = 0.62; spine.add(neck);
  const headPivot = new THREE.Group(); headPivot.position.y = 0.72; spine.add(headPivot);
  const head = new THREE.Mesh(geo.head, skin); head.scale.set(0.9, 1.05, 1); headPivot.add(head);
  if (o.eyesIbad) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), mat('#2a6cff', 0.2, { emissive: '#1846c8', emissiveIntensity: 0.6 }));
    for (const sx of [-0.035, 0.035]) { const e = eye.clone(); e.position.set(sx, 0.02, 0.095); headPivot.add(e); }
  }
  if (o.hood !== false) { const hood = new THREE.Mesh(geo.hood, cloth); hood.position.set(0, 0.015, -0.01); hood.rotation.x = -0.25; headPivot.add(hood); }
  if (o.mask !== false) { const m = new THREE.Mesh(geo.mask, suit); m.position.set(0, -0.045, 0.012); headPivot.add(m); const t = new THREE.Mesh(geo.tube, accent); t.position.set(0, -0.08, 0.02); t.rotation.set(Math.PI / 2, 0, 0); headPivot.add(t); }
  if (o.robe !== false) { const robe = new THREE.Mesh(geo.robe, cloth); robe.position.y = 0.58; robe.scale.set(bulk, 1, bulk * 0.85); spine.add(robe); }
  if (o.pack) { const p = new THREE.Mesh(geo.pack, mat('#5b4632', 0.9)); p.position.set(0, 0.35, -0.2); spine.add(p); }

  const limbs = {};
  for (const side of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(0.22 * side * bulk, 0.55, 0); spine.add(sh);
    const ua = new THREE.Mesh(geo.arm, o.robe !== false ? cloth : suit); ua.position.y = -0.16; sh.add(ua);
    const el = new THREE.Group(); el.position.y = -0.32; sh.add(el);
    const fa = new THREE.Mesh(geo.forearm, suit); fa.position.y = -0.15; el.add(fa);
    const hd = new THREE.Mesh(geo.hand, skin); hd.position.y = -0.31; el.add(hd);
    const hip = new THREE.Group(); hip.position.set(0.1 * side, 0, 0); pelvis.add(hip);
    const th = new THREE.Mesh(geo.leg, suit); th.position.y = -0.22; hip.add(th);
    const kn = new THREE.Group(); kn.position.y = -0.45; hip.add(kn);
    const sn = new THREE.Mesh(geo.shin, suit); sn.position.y = -0.21; kn.add(sn);
    const ft = new THREE.Mesh(geo.foot, mat('#3a2f26', 0.9)); ft.position.set(0, -0.44, 0.04); kn.add(ft);
    limbs[side < 0 ? 'L' : 'R'] = { sh, el, hip, kn };
  }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

  let phase = Math.random() * 10;
  let talk = false;
  let talkT = 0;
  const fig = {
    group: g,
    height: H,
    parts: { root, pelvis, spine, headPivot, limbs },
    /** Скорость в м/с; irregular>0 — «походка по песку» (рваный шаг). */
    animate(speed, dt, irregular = 0) {
      const sp = Math.min(speed, 7);
      const cadence = sp < 0.05 ? 0 : 1.6 + sp * 0.55;
      const jitter = irregular > 0 ? 1 + 0.6 * Math.sin(phase * 1.7) * irregular : 1;
      phase += dt * cadence * Math.PI * jitter;
      const amp = Math.min(1, sp / 2.2) * (sp > 3.5 ? 1.25 : 1);
      const sw = Math.sin(phase);
      limbs.L.hip.rotation.x = sw * 0.55 * amp; limbs.R.hip.rotation.x = -sw * 0.55 * amp;
      limbs.L.kn.rotation.x = Math.max(0, -Math.cos(phase)) * 0.9 * amp;
      limbs.R.kn.rotation.x = Math.max(0, Math.cos(phase)) * 0.9 * amp;
      limbs.L.sh.rotation.x = -sw * 0.45 * amp; limbs.R.sh.rotation.x = sw * 0.45 * amp;
      limbs.L.el.rotation.x = limbs.R.el.rotation.x = -0.25 - 0.3 * amp;
      pelvis.position.y = 0.92 + Math.abs(Math.cos(phase)) * 0.035 * amp - (sp > 3.5 ? 0.04 : 0);
      spine.rotation.x = sp > 3.5 ? 0.18 : 0.04 * amp;
      // Дыхание/покачивание в покое.
      const idle = 1 - Math.min(1, sp);
      spine.rotation.z = Math.sin(phase * 0.3 + 1) * 0.015 * idle;
      if (talk) { talkT += dt; fig.parts.headPivot.rotation.x = Math.sin(talkT * 7) * 0.04; limbs.R.sh.rotation.x = -0.3 + Math.sin(talkT * 2.3) * 0.25; }
      return phase;
    },
    setTalking(b) { talk = b; if (!b) fig.parts.headPivot.rotation.x = 0; },
    /** Повернуть голову к мировой точке (ограничение ±70°). */
    lookAt(worldPos, weight = 1) {
      const local = g.worldToLocal(worldPos.clone());
      const yaw = Math.atan2(local.x, local.z);
      fig.parts.headPivot.rotation.y = THREE.MathUtils.clamp(yaw, -1.2, 1.2) * weight;
    },
  };
  return fig;
}

/** Палитры архетипов толпы (совпадает по смыслу с CrowdArchetypes.csv). */
export const PALETTES = {
  Trader: { cloth: '#7a5a3a', accent: '#a0522d', suit: '#4b4035' },
  Artisan: { cloth: '#6b5844', accent: '#8b6b3a', suit: '#463b31', pack: true },
  WaterCarrier: { cloth: '#5d6a73', accent: '#2c5f8a', suit: '#3f3e3a' },
  Child: { cloth: '#9a7b55', accent: '#b5462c', suit: '#5a4a3a', height: 1.2, mask: false },
  Guard: { cloth: '#3a332c', accent: '#6e2b20', suit: '#2e2a26', bulk: 1.15 },
  Pilgrim: { cloth: '#b9a07a', accent: '#6b5a3a', suit: '#5a4d3e' },
  Elder: { cloth: '#4e4438', accent: '#2c3e57', suit: '#3b342d', height: 1.66 },
  Weaver: { cloth: '#7d4f3a', accent: '#2c3e57', suit: '#4a3d33' },
};
