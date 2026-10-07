// Сборщик для вида от третьего лица: процедурная модель человека (≈ 1,78 м, глаза на 1,68 м) в спецодежде
// участка — тёмно-синие куртка и брюки со светоотражающими полосами, бейдж, трикотажные перчатки, защитная
// обувь. Скелет: таз → корпус → шея → голова; плечо → предплечье → кисть; бедро → голень → стопа.
// Анимация: ходьба (мах рук в противофазе, сгибание колена), присед, наклон к узлу при осмотре, поворот
// головы за взглядом. На лице — модель выбранных очков; кабель USB-C с конца левой дужки идёт за ухом к блоку:
// VITURE — Pro Neckband на шее; XREAL Air/One — Beam Pro на поясе; XREAL Aura — вычислительный блок на поясе.
import * as THREE from 'three';
import { DESIGN, buildGlassesModel } from './glasses_model.js';
import { textTexture } from './tex.js';

const mats = {
  skin: new THREE.MeshPhysicalMaterial({ color: '#c99a7e', roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color('#ffb59a') }),
  hair: new THREE.MeshPhysicalMaterial({ color: '#3a2a1f', roughness: 0.7, sheen: 0.6, sheenColor: new THREE.Color('#8a6a4a') }),
  cloth: new THREE.MeshPhysicalMaterial({ color: '#23334d', roughness: 0.85, sheen: 0.5, sheenColor: new THREE.Color('#5a6e92'), sheenRoughness: 0.7 }),
  clothDark: new THREE.MeshPhysicalMaterial({ color: '#1a2436', roughness: 0.9, sheen: 0.4, sheenColor: new THREE.Color('#44516b') }),
  stripe: new THREE.MeshPhysicalMaterial({ color: '#c9cdd2', roughness: 0.25, metalness: 0.4, clearcoat: 0.6 }),
  glove: new THREE.MeshPhysicalMaterial({ color: '#d9dbd6', roughness: 0.95, sheen: 0.6, sheenColor: new THREE.Color('#ffffff') }),
  shoe: new THREE.MeshPhysicalMaterial({ color: '#141516', roughness: 0.45, clearcoat: 0.4 }),
  sole: new THREE.MeshStandardMaterial({ color: '#3a3c3e', roughness: 0.9 }),
  plastic: new THREE.MeshPhysicalMaterial({ color: '#16171a', roughness: 0.4, clearcoat: 0.6 }),
  cable: new THREE.MeshStandardMaterial({ color: '#18191b', roughness: 0.55 }),
  eye: new THREE.MeshPhysicalMaterial({ color: '#1d1a18', roughness: 0.1, clearcoat: 1 }),
  belt: new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.6 }),
};

/** Сужающийся сегмент конечности (точка вращения — верх, вдоль −Y), со скруглёнными концами. */
function limb(len, r0, r1, mat, seg = 20) {
  const pts = [];
  for (let k = 0; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.sin(a) * r1, -len + r1 - Math.cos(a) * r1)); }
  for (let k = 0; k <= 6; k++) { const a = Math.PI / 2 - (k / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.sin(a) * r0, -r0 * 0.2 + Math.cos(a) * r0 * 0.9)); }
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, seg), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function ball(r, mat, sx = 1, sy = 1, sz = 1) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 20), mat); m.scale.set(sx, sy, sz); m.castShadow = true; return m; }
function band(r, w, y, mat, sz = 1) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 24, 1, true), mat); m.position.y = y; m.scale.z = sz; return m; }

/** Корпус в куртке: профиль вращения (таз → талия → грудь → плечи), сплющен спереди-назад. */
function torso() {
  const prof = [[0.0, 0.0], [0.16, 0.0], [0.175, 0.06], [0.165, 0.16], [0.155, 0.24], [0.17, 0.33], [0.185, 0.42], [0.18, 0.48], [0.15, 0.53], [0.07, 0.56], [0.0, 0.565]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 32);
  const m = new THREE.Mesh(g, mats.cloth);
  m.scale.z = 0.62; m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function buildWorker(deviceId) {
  const root = new THREE.Group(); root.name = 'worker';
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  // брюки (таз), ремень
  const pelvis = ball(0.17, mats.clothDark, 1, 0.62, 0.68); pelvis.position.y = -0.02; hips.add(pelvis);
  const belt = band(0.172, 0.04, 0.06, mats.belt, 0.66); hips.add(belt);
  const spine = new THREE.Group(); spine.position.y = 0.04; hips.add(spine);
  const chest = new THREE.Group(); spine.add(chest);
  const body = torso(); chest.add(body);
  for (const y of [0.3, 0.36]) chest.add(band(0.181, 0.022, y, mats.stripe, 0.63));        // светоотражающие полосы
  const collar = band(0.075, 0.05, 0.57, mats.cloth, 1); chest.add(collar);
  // бейдж и карман с ручкой
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.045), new THREE.MeshStandardMaterial({ map: textTexture(['Сборщик', 'Таб. № 1047'], { w: 256, h: 160, size: 44, bg: '#f4f4f0' }) }));
  badge.position.set(0.08, 0.44, -0.11); badge.rotation.y = Math.PI + 0.25; chest.add(badge);
  const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 8), mats.plastic); pen.position.set(-0.07, 0.45, -0.108); chest.add(pen);
  const patch = new THREE.Mesh(new THREE.CircleGeometry(0.025, 24), new THREE.MeshStandardMaterial({ map: textTexture(['КМ'], { w: 128, h: 128, size: 70, bg: '#58e6ff', border: null }) }));
  patch.position.set(-0.13, 0.42, -0.07); patch.rotation.y = Math.PI + 0.9; chest.add(patch);
  // шея и голова
  const neck = new THREE.Group(); neck.position.y = 0.53; chest.add(neck);
  const neckMesh = limb(0.09, 0.052, 0.055, mats.skin); neckMesh.rotation.x = Math.PI; neck.add(neckMesh);
  const head = new THREE.Group(); head.position.y = 0.07; neck.add(head);     // глаза ≈ 1,68 м
  const skull = ball(0.098, mats.skin, 0.92, 1.12, 1.02); skull.position.set(0, 0.08, 0.005); head.add(skull);
  const jaw = ball(0.075, mats.skin, 0.95, 0.8, 1.0); jaw.position.set(0, 0.01, -0.025); head.add(jaw);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.104, 28, 16, 0, Math.PI * 2, 0, 1.75), mats.hair);
  hair.scale.set(0.93, 1.1, 1.05); hair.position.set(0, 0.09, 0.012); head.add(hair);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.04, 12), mats.skin); nose.position.set(0, 0.06, -0.1); nose.rotation.x = -Math.PI / 2 - 0.35; head.add(nose);
  for (const s of [-1, 1]) {
    const ear = ball(0.022, mats.skin, 0.45, 1, 0.75); ear.position.set(s * 0.09, 0.075, 0.01); head.add(ear);
    const eye = ball(0.011, mats.eye); eye.position.set(s * 0.032, 0.088, -0.088); head.add(eye);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.008), mats.hair); brow.position.set(s * 0.032, 0.107, -0.093); head.add(brow);
  }
  // руки: плечо → предплечье → кисть в перчатке
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.2, 0.5, 0); chest.add(sh);
    const ua = limb(0.3, 0.058, 0.046, mats.cloth); sh.add(ua);
    ua.add(band(0.054, 0.022, -0.2, mats.stripe));
    const el = new THREE.Group(); el.position.y = -0.3; sh.add(el);
    const fa = limb(0.26, 0.046, 0.038, mats.cloth); el.add(fa);
    const wr = new THREE.Group(); wr.position.y = -0.26; el.add(wr);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.09, 0.08), mats.glove); palm.position.set(0, -0.05, -0.005); palm.castShadow = true; wr.add(palm);
    const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.075), mats.glove); fingers.position.set(0, -0.12, -0.01); fingers.rotation.x = 0.25; wr.add(fingers);
    const thumb = limb(0.05, 0.012, 0.01, mats.glove, 10); thumb.position.set(s * 0.012, -0.03, -0.04); thumb.rotation.set(0.6, 0, s * 0.5); wr.add(thumb);
    arms.push({ s, sh, el, wr });
  }
  // ноги: бедро → голень → ботинок
  const legs = [];
  for (const s of [-1, 1]) {
    const th = new THREE.Group(); th.position.set(s * 0.095, -0.05, 0); hips.add(th);
    th.add(limb(0.44, 0.085, 0.062, mats.clothDark));
    const kn = new THREE.Group(); kn.position.y = -0.44; th.add(kn);
    const sh = limb(0.42, 0.062, 0.05, mats.clothDark); kn.add(sh);
    sh.add(band(0.058, 0.025, -0.3, mats.stripe));
    const an = new THREE.Group(); an.position.y = -0.42; kn.add(an);
    // защитный ботинок: голенище, союзка с усиленным носком, протектор
    const upper = limb(0.1, 0.055, 0.058, mats.shoe, 16); upper.position.y = 0.02; an.add(upper);
    const vamp = ball(0.06, mats.shoe, 0.95, 0.72, 1.85); vamp.position.set(0, -0.045, -0.075); an.add(vamp);
    const heel = ball(0.052, mats.shoe, 1, 0.8, 0.9); heel.position.set(0, -0.05, 0.025); an.add(heel);
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.022, 0.29), mats.sole); sole.position.set(0, -0.087, -0.06); an.add(sole);
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.07), mats.sole); lace.position.set(0, -0.005, -0.06); lace.rotation.x = 0.5; an.add(lace);
    legs.push({ s, th, kn, an });
  }
  // очки и блок вычислений
  const W = { root, hips, spine, chest, neck, head, arms, legs, glasses: null, unit: null, cable: null, deviceId: null };
  W.setDevice = (id) => setDevice(W, id);
  W.setDevice(deviceId);
  W.setPose = (p) => setPose(W, p);
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return W;
}

function unitKind(id) { return id.startsWith('viture') ? 'neckband' : id === 'xreal-aura' ? 'puck' : 'beampro'; }

function setDevice(W, id) {
  if (W.deviceId === id) return;
  W.deviceId = id;
  if (W.glasses) W.head.remove(W.glasses);
  if (W.unit) W.unit.parent.remove(W.unit);
  const g = buildGlassesModel(id, { cable: false });
  g.position.set(0, 0.088, -0.112);                 // переносица — на уровне глаз, перед лицом
  W.head.add(g);
  W.glasses = g;
  const kind = unitKind(id);
  let u;
  if (kind === 'neckband') {                          // VITURE Pro Neckband: дуга на шее, концы у ключиц
    u = new THREE.Group();
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.017, 14, 40, Math.PI * 1.35), mats.plastic);
    arc.rotation.x = Math.PI / 2; arc.rotation.z = Math.PI * 0.82;
    u.add(arc);
    for (const s of [-1, 1]) { const tip = ball(0.022, mats.plastic, 1, 0.8, 1.5); tip.position.set(s * 0.088, 0, -0.075); u.add(tip); }
    u.position.set(0, 0.56, 0.01);
    W.chest.add(u);
    W.unitAnchor = new THREE.Vector3(-0.088, 0.56, -0.07);
  } else {                                            // Beam Pro / блок Aura — на поясе справа
    u = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(kind === 'puck' ? 0.07 : 0.078, kind === 'puck' ? 0.11 : 0.155, 0.02), mats.plastic);
    u.add(body);
    if (kind === 'puck') { const pad = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.07, 0.002), new THREE.MeshPhysicalMaterial({ color: '#202327', roughness: 0.3, clearcoat: 0.7 })); pad.position.z = -0.011; u.add(pad); }
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.006), mats.belt); clip.position.set(0, 0.03, 0.013); u.add(clip);
    u.position.set(0.15, 0.0, -0.09); u.rotation.y = 0.6;
    W.hips.add(u);
    W.unitAnchor = null;
  }
  u.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  W.unit = u;
  W.design = DESIGN[id];
}

const tmpM = new THREE.Matrix4();
function setPose(W, { pos, yaw, pitch = 0, phase = 0, speed = 0, crouch = 0, lean = 0, worn = true, t = 0 }) {
  W.root.position.set(pos.x, 0, pos.z);
  W.root.rotation.y = yaw;
  const amp = Math.min(1, speed / 1.4);
  const sw = Math.sin(phase * Math.PI * 2);
  W.hips.position.y = 0.95 - crouch * 0.45 + Math.abs(Math.cos(phase * Math.PI * 2)) * 0.02 * amp + Math.sin(t * 1.6) * 0.002;
  W.spine.rotation.x = -(lean * 0.5 + crouch * 0.25) - 0.03 * amp;
  W.chest.rotation.x = -lean * 0.2;
  W.chest.scale.y = 1 + Math.sin(t * 1.6) * 0.006;                  // дыхание
  W.neck.rotation.x = Math.max(-0.7, Math.min(0.6, pitch * 0.75 + lean * 0.3));
  for (const L of W.legs) {
    const k = L.s * sw;
    // +X — нога вперёд; колено сгибается назад (−X)
    L.th.rotation.x = 0.45 * amp * k + crouch * 1.25;
    L.kn.rotation.x = -Math.max(0, 0.75 * amp * Math.sin(phase * Math.PI * 2 + (L.s > 0 ? 0 : Math.PI) - 0.6)) - crouch * 2.2;
    L.an.rotation.x = crouch * 0.95;
  }
  for (const A of W.arms) {
    A.sh.rotation.x = -0.35 * amp * A.s * sw + lean * 0.9;            // рука — в противофазе ноге
    A.sh.rotation.z = A.s * 0.08;
    A.el.rotation.x = 0.25 + 0.2 * amp + lean * 0.6;
  }
  W.glasses.visible = worn;
  W.unit.visible = true;
  updateCable(W, worn);
}

/** Кабель: конец левой дужки → за ухом → по шее → к блоку (провисает, пересчитывается каждый кадр). */
function updateCable(W, worn) {
  if (W.cable) { W.root.parent?.remove(W.cable); W.cable.geometry.dispose(); W.cable = null; }
  if (!worn || !W.root.parent) return;
  W.root.updateMatrixWorld(true);
  const D = W.design, mm = 0.001;
  const P = (obj, x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(obj.matrixWorld);
  const tipL = P(W.glasses, -(D.W / 2 - 3) * mm, (D.lh / 2 - 20) * mm, (D.temple + 6) * mm);
  const pts = [tipL, P(W.head, -0.085, -0.0, 0.07), P(W.neck, -0.06, -0.02, 0.04)];
  if (W.unitAnchor) pts.push(P(W.chest, -0.1, 0.55, 0.0), P(W.chest, W.unitAnchor.x, W.unitAnchor.y, W.unitAnchor.z));
  else pts.push(P(W.chest, -0.15, 0.45, -0.02), P(W.chest, -0.02, 0.25, -0.12), P(W.hips, 0.12, 0.06, -0.12), P(W.unit, 0, 0.08, 0));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  W.cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.0022, 6), mats.cable);
  W.cable.castShadow = true;
  W.root.parent.add(W.cable);
  tmpM.identity();
}
