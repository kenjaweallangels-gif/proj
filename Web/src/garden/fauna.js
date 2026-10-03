// Живность сада: тушканчик/«кенгуровая мышь» (муад'диб), пара пустынных ястребов, пустынный сыч на полке, ящерицы, жуки, кит-лисица ночью.
// Процедурные «риги»: слитые меши + несколько подвижных частей; поведение — конечные автоматы (испуг, прятки, прыжки по дуге, парение).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, clamp, lerp, damp, dampAngle, smoothstep } from '../core/util.js';
import { fogPatch } from './plants.js';
import { C, FLOOR_Y, owlLedge } from './layout.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- геометрические помощники
function paint(g, c) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
/** Эллипсоид (rx,ry,rz) в точке (x,y,z) цвета c; rot — эйлер (x,y,z). */
function ell(rx, ry, rz, x, y, z, c, rot) {
  const g = new THREE.SphereGeometry(1, 10, 8); g.scale(rx, ry, rz);
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
  g.translate(x, y, z); return paint(g, hex(c));
}
function cone(r, h, x, y, z, c, rot) {
  const g = new THREE.ConeGeometry(r, h, 7, 1); if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
  g.translate(x, y, z); return paint(g, hex(c));
}
function cyl(r0, r1, h, x, y, z, c, rot) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 6, 1); if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2])));
  g.translate(x, y, z); return paint(g, hex(c));
}
const merge = (list) => { const g = mergeGeometries(list, false); list.forEach((x) => x.dispose()); g.computeBoundingSphere(); return g; };
const mkMat = (key, o = {}) => fogPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...o }), key);

/** Тонкий хвост из N сегментов вдоль -z с изгибом вверх; пивот в начале. */
function tailGeo(len, r0, r1, curve, c, tuft) {
  const list = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const r = lerp(r0, r1, t0), h = len / n;
    const y = Math.sin(t0 * Math.PI * 0.6) * curve * len, z = -t0 * len - h / 2;
    list.push(cyl(r, lerp(r0, r1, t1), h * 1.05, 0, y, z, c, [Math.PI / 2 + curve * 0.5 * t0, 0, 0]));
  }
  if (tuft) list.push(ell(r1 * 3.2, r1 * 2.6, len * 0.14, 0, Math.sin(Math.PI * 0.6) * curve * len, -len - len * 0.06, tuft));
  return merge(list);
}

export function createFauna(game, { ground, flora, walkable, root, quality, player }) {
  const R = rng(8888);
  const qf = quality === 'low' ? 0.5 : quality === 'high' ? 1.3 : 1;
  const hours = () => game.weather?.hours ?? 12;
  const isNight = () => { const h = hours(); return h >= 19.6 || h < 4.9; };
  const isDusk = () => { const h = hours(); return (h >= 17.2 && h < 19.6) || (h >= 4.9 && h < 6.6); };
  const isDay = () => !isNight() && !isDusk();
  const playerPos = () => game.player?.position || new V3(0, -100, 0);
  const emit = (kind, ev, x, y, z) => game.bus.emit('garden:animal', { kind, event: ev, x, y, z });
  const out = { mice: [], hawks: [], owl: null, lizards: [], beetles: null, fox: null };
  const items = [];                                           // всё с update(dt, t, ctx)

  // ============================================================ кенгуровая мышь (муад'диб)
  const mouseMat = mkMat('gd-mouse');
  const fur = [0.72, 0.6, 0.42], furD = [0.55, 0.42, 0.28], belly = [0.93, 0.88, 0.78];
  const mouseBody = merge([
    ell(0.043, 0.04, 0.062, 0, 0.078, 0, fur), ell(0.036, 0.026, 0.05, 0, 0.062, 0.006, belly),
    ell(0.031, 0.029, 0.04, 0, 0.108, 0.062, fur), cone(0.013, 0.03, 0, 0.1, 0.108, furD, [Math.PI / 2, 0, 0]),
    ell(0.012, 0.028, 0.006, 0.02, 0.145, 0.05, [0.82, 0.62, 0.55], [0.2, 0, -0.2]), ell(0.012, 0.028, 0.006, -0.02, 0.145, 0.05, [0.82, 0.62, 0.55], [0.2, 0, 0.2]),
    ell(0.007, 0.007, 0.004, 0.022, 0.116, 0.087, [0.04, 0.03, 0.03]), ell(0.007, 0.007, 0.004, -0.022, 0.116, 0.087, [0.04, 0.03, 0.03]),
    ell(0.018, 0.04, 0.026, 0.036, 0.056, -0.018, furD), ell(0.018, 0.04, 0.026, -0.036, 0.056, -0.018, furD),
    ell(0.008, 0.006, 0.055, 0.036, 0.012, 0.016, furD), ell(0.008, 0.006, 0.055, -0.036, 0.012, 0.016, furD),
    ell(0.006, 0.02, 0.006, 0.026, 0.06, 0.05, fur, [0.5, 0, 0]), ell(0.006, 0.02, 0.006, -0.026, 0.06, 0.05, fur, [0.5, 0, 0]),
  ]);
  const mouseTail = tailGeo(0.2, 0.007, 0.004, 0.18, [0.62, 0.5, 0.36], [0.12, 0.1, 0.09]);
  const MS = 1.55;
  class Mouse {
    constructor(x, z, home) {
      this.g = new THREE.Group(); this.body = new THREE.Mesh(mouseBody, mouseMat); this.tail = new THREE.Mesh(mouseTail, mouseMat);
      this.tail.position.set(0, 0.07, -0.055); this.g.add(this.body, this.tail); this.g.scale.setScalar(MS);
      this.body.castShadow = quality !== 'low'; this.g.name = 'KangarooMouse';
      root.add(this.g);
      this.x = x; this.z = z; this.y = ground(x, z); this.yaw = R() * TAU; this.home = home || { x, z };
      this.state = 'idle'; this.t = R() * 3; this.hop = null; this.vis = 1; this.hiddenFor = 0; this.pitch = 0; this.tw = R() * 10;
    }
    startHop(tx, tz, dur, H) {
      this.hop = { x0: this.x, z0: this.z, x1: tx, z1: tz, t: 0, dur, H };
      this.yaw = Math.atan2(tx - this.x, tz - this.z);
    }
    update(dt, t, P) {
      const dx = this.x - P.x, dz = this.z - P.z, d = Math.hypot(dx, dz);
      const awake = isNight() ? 1 : isDusk() ? 0.8 : 0.45;
      if (this.state === 'hidden') {
        this.hiddenFor -= dt;
        this.vis = damp(this.vis, 0, 14, dt);
        if (this.hiddenFor <= 0 && d > 9 && R() < awake * 0.4) { this.state = 'idle'; this.t = 0.6; this.x = this.home.x + (R() - 0.5) * 0.8; this.z = this.home.z + (R() - 0.5) * 0.8; }
      } else {
        this.vis = damp(this.vis, 1, 10, dt);
      }
      this.g.visible = this.vis > 0.05;
      this.g.scale.setScalar(MS * Math.max(0.01, this.vis));
      if (this.state === 'hidden') { this.g.position.set(this.x, this.y, this.z); return; }
      const fleeR = (P.speed > 4.2 ? 11 : 6.5);
      const threatened = d < fleeR;
      if (this.hop) {
        const h = this.hop; h.t += dt / h.dur;
        const k = Math.min(1, h.t);
        this.x = lerp(h.x0, h.x1, k); this.z = lerp(h.z0, h.z1, k);
        const arc = 4 * k * (1 - k);
        this.y = ground(this.x, this.z) + arc * h.H;
        this.pitch = damp(this.pitch, -0.5 * (k < 0.5 ? 1 : -1) * 0.8 * Math.min(1, h.H * 4), 18, dt);
        if (h.t >= 1) { this.hop = null; this.t = this.state === 'flee' ? 0.02 : 0.1 + R() * 0.3; this.y = ground(this.x, this.z); }
      } else {
        this.y = ground(this.x, this.z);
        this.t -= dt;
        // стойка столбиком, когда игрок близко, но не пугает
        const alert = d < 15 && !threatened;
        this.pitch = damp(this.pitch, alert || this.state === 'groom' ? 0.75 : 0, 8, dt);
        if (threatened && this.state !== 'flee') { this.state = 'flee'; this.t = 0; emit('mouse', 'alarm', this.x, this.y, this.z); }
        if (this.state === 'flee' && !threatened && d > fleeR + 2.5) { this.state = 'idle'; this.t = 1 + R(); }
        if (this.t <= 0) {
          if (this.state === 'flee') {
            // к норе под ближайшим кустом, иначе прочь от игрока
            const hx = this.home.x - this.x, hz = this.home.z - this.z, hd = Math.hypot(hx, hz);
            if (hd < 0.9) { this.state = 'hidden'; this.hiddenFor = 6 + R() * 8; this.t = 0; return; }
            let ax = dx / (d || 1), az = dz / (d || 1);
            const bias = hd < 14 ? 0.7 : 0.15;
            ax = ax * (1 - bias) + (hx / hd) * bias; az = az * (1 - bias) + (hz / hd) * bias;
            const a = Math.atan2(ax, az) + (R() - 0.5) * 0.8, len = 0.9 + R() * 0.5;
            let tx = this.x + Math.sin(a) * Math.min(len, hd > 0.9 ? Math.max(hd, 0.5) : len), tz = this.z + Math.cos(a) * Math.min(len, hd > 0.9 ? Math.max(hd, 0.5) : len);
            if (!walkable(tx, tz)) { tx = this.home.x; tz = this.home.z; }
            this.startHop(tx, tz, 0.26, 0.22);
          } else {
            const r = R();
            if (r < 0.34) { this.state = 'groom'; this.t = 0.8 + R() * 1.4; }
            else if (r < 0.58) { this.state = 'idle'; this.t = 0.6 + R() * 2.2; this.yaw += (R() - 0.5) * 1.8; }
            else {
              const a = R() * TAU, len = 0.35 + R() * 0.9;
              let tx = this.x + Math.sin(a) * len, tz = this.z + Math.cos(a) * len;
              if (Math.hypot(tx - this.home.x, tz - this.home.z) > 7) { tx = this.home.x + (R() - 0.5) * 4; tz = this.home.z + (R() - 0.5) * 4; }
              if (walkable(tx, tz)) { this.state = 'idle'; this.startHop(tx, tz, 0.2 + len * 0.08, 0.05 + len * 0.08); }
            }
          }
        }
      }
      this.tw += dt * (this.hop ? 12 : 2.6);
      this.g.position.set(this.x, this.y, this.z);
      this.g.rotation.set(0, this.yaw, 0);
      this.body.rotation.x = this.pitch;
      this.tail.rotation.set(-this.pitch * 0.5 + 0.12 * Math.sin(this.tw), 0.3 * Math.sin(this.tw * 0.7), 0);
      this.body.scale.y = this.hop ? 1.08 : 0.98 + 0.02 * Math.sin(t * 2 + this.tw);
    }
  }
  {
    const shr = flora.shrubs.filter((s) => walkable(s.x, s.z));
    const n = Math.round(11 * qf);
    for (let i = 0; i < n && shr.length; i++) {
      const s = shr[(R() * shr.length) | 0];
      const m = new Mouse(s.x + (R() - 0.5), s.z + (R() - 0.5), { x: s.x, z: s.z });
      if (isDay() && R() < 0.55) { m.state = 'hidden'; m.hiddenFor = R() * 6; m.vis = 0; }
      out.mice.push(m); items.push(m);
    }
  }

  // ============================================================ ястреб
  const hawkMat = mkMat('gd-hawk', { side: THREE.DoubleSide, roughness: 0.8 });
  const hb = [0.38, 0.27, 0.17], hl = [0.82, 0.72, 0.56], hd = [0.16, 0.12, 0.09];
  const hawkBody = merge([
    ell(0.085, 0.075, 0.26, 0, 0, 0, hb), ell(0.07, 0.05, 0.2, 0, -0.04, 0.02, hl),
    ell(0.058, 0.056, 0.07, 0, 0.02, 0.28, hb), cone(0.02, 0.07, 0, 0.0, 0.35, [0.85, 0.7, 0.2], [Math.PI / 2, 0, 0]),
    ell(0.007, 0.007, 0.007, 0.034, 0.04, 0.31, [0.05, 0.04, 0.02]), ell(0.007, 0.007, 0.007, -0.034, 0.04, 0.31, [0.05, 0.04, 0.02]),
    ell(0.1, 0.008, 0.17, 0, 0.0, -0.42, hb), ell(0.07, 0.007, 0.1, 0, 0.001, -0.5, hd),
  ]);
  const wingGeo = (sign) => {
    // плоское крыло: корень в (0,0,0), размах вдоль +x (sign), передняя кромка +z. Пальцы на конце.
    const P = [], I = [], Cc = [];
    const pt = (x, z, col) => { P.push(x * sign, 0, z); Cc.push(...col); return P.length / 3 - 1; };
    const root = [pt(0, 0.2, hb), pt(0, -0.22, hb)];
    const mid = [pt(0.42, 0.21, hb), pt(0.42, -0.2, hl)];
    const out2 = [pt(0.85, 0.12, hb), pt(0.85, -0.2, hl)];
    const tip = [pt(1.12, 0.05, hd), pt(1.08, -0.1, hd)];
    const rows = [root, mid, out2, tip];
    for (let i = 0; i < 3; i++) { const a = rows[i], b = rows[i + 1]; I.push(a[0], b[0], b[1], a[0], b[1], a[1]); }
    // пальцы (маховые у конца)
    const fingers = [[0.9, -0.2, 1.17, -0.3], [0.95, -0.16, 1.22, -0.18], [0.98, -0.1, 1.24, -0.06], [1.0, -0.02, 1.2, 0.04]];
    for (const f of fingers) { const a = pt(f[0] - 0.05, f[1] + 0.06, hd), b = pt(f[0] + 0.05, f[1] - 0.04, hd), c = pt(f[2], f[3], hd); I.push(a, b, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setIndex(I); g.computeVertexNormals();
    return g;
  };
  const wingL = wingGeo(1), wingR = wingGeo(-1);
  class Hawk {
    constructor(i) {
      this.g = new THREE.Group(); this.g.name = 'DesertHawk';
      this.body = new THREE.Mesh(hawkBody, hawkMat); this.wL = new THREE.Mesh(wingL, hawkMat); this.wR = new THREE.Mesh(wingR, hawkMat);
      this.wL.position.set(0.05, 0.02, 0.02); this.wR.position.set(-0.05, 0.02, 0.02);
      this.g.add(this.body, this.wL, this.wR); this.g.scale.setScalar(1.7);
      this.body.castShadow = this.wL.castShadow = this.wR.castShadow = quality !== 'low';
      root.add(this.g);
      this.cx = C.x + (i ? 12 : -9); this.cz = C.z + (i ? -7 : 10); this.r = i ? 36 : 27; this.dir = i ? -1 : 1; this.phi = i * 2.4; this.alt = FLOOR_Y + (i ? 60 : 46);
      this.v = 8.5; this.flap = 0; this.nextFlap = 4 + R() * 6; this.bank = 0; this.call = 6 + R() * 10; this.fade = 1;
    }
    update(dt, t) {
      const day = hours() > 6.4 && hours() < 18.6;
      this.fade = damp(this.fade, day ? 1 : 0, 3, dt);
      this.g.visible = this.fade > 0.05;
      if (!this.g.visible) return;
      this.phi += (this.v / this.r) * this.dir * dt;
      const wob = Math.sin(t * 0.13 + this.dir) * 8;
      const x = this.cx + Math.cos(this.phi) * (this.r + wob), z = this.cz + Math.sin(this.phi) * (this.r + wob);
      const y = this.alt + Math.sin(t * 0.21 + this.phi) * 4.5 + (1 - this.fade) * 40;
      const tx = -Math.sin(this.phi) * this.dir, tz = Math.cos(this.phi) * this.dir;
      this.g.position.set(x, y, z);
      const yaw = Math.atan2(tx, tz);
      const climb = Math.cos(t * 0.21 + this.phi) * 0.04;
      this.bank = damp(this.bank, -this.dir * 0.42, 1.5, dt);
      this.g.rotation.set(-climb, yaw, this.bank, 'YXZ');
      // взмахи крыльев: короткие серии, в остальное время — парение со слабой вибрацией
      this.nextFlap -= dt;
      if (this.nextFlap <= 0) { this.flap = 1.3; this.nextFlap = 6 + R() * 10; }
      let fl = 0;
      if (this.flap > 0) { this.flap -= dt; fl = Math.sin(t * 11) * 0.45 * Math.min(1, this.flap); }
      const dih = 0.12 + Math.sin(t * 0.7 + this.phi) * 0.025;
      this.wL.rotation.z = dih + fl; this.wR.rotation.z = -dih - fl;
      this.wL.rotation.y = -0.1; this.wR.rotation.y = 0.1;
      this.call -= dt;
      if (this.call <= 0) { this.call = 14 + R() * 20; emit('hawk', 'call', x, y, z); }
    }
  }
  for (let i = 0; i < 2; i++) { const h = new Hawk(i); out.hawks.push(h); items.push(h); }

  // ============================================================ пустынный сыч
  const owlMat = mkMat('gd-owl');
  const ob = [0.55, 0.45, 0.33], ol = [0.88, 0.8, 0.66], od = [0.3, 0.23, 0.17];
  const owlBody = merge([
    ell(0.115, 0.17, 0.1, 0, 0.18, 0, ob), ell(0.09, 0.13, 0.05, 0, 0.17, 0.065, ol),
    ell(0.04, 0.15, 0.085, 0.1, 0.17, -0.005, od), ell(0.04, 0.15, 0.085, -0.1, 0.17, -0.005, od),
    ell(0.06, 0.012, 0.15, 0, 0.04, -0.12, od, [0.4, 0, 0]),
    cyl(0.012, 0.012, 0.07, 0.04, 0.03, 0.04, [0.8, 0.7, 0.5]), cyl(0.012, 0.012, 0.07, -0.04, 0.03, 0.04, [0.8, 0.7, 0.5]),
  ]);
  const owlHeadGeo = merge([
    ell(0.088, 0.078, 0.08, 0, 0, 0, ob), ell(0.062, 0.062, 0.016, 0.034, -0.002, 0.07, ol), ell(0.062, 0.062, 0.016, -0.034, -0.002, 0.07, ol),
    cone(0.012, 0.03, 0, -0.012, 0.092, [0.85, 0.75, 0.4], [Math.PI / 2, 0, 0]),
    cone(0.018, 0.06, 0.058, 0.082, 0.0, od, [0, 0, -0.35]), cone(0.018, 0.06, -0.058, 0.082, 0.0, od, [0, 0, 0.35]),
  ]);
  const eyeGeo = paint(new THREE.SphereGeometry(0.02, 8, 6), [0.95, 0.78, 0.15]);
  const eyeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: 0xffc030, emissiveIntensity: 0.0 }); fogPatch(eyeMat, 'gd-owleye');
  const owlWingG = (() => {
    const s = hawkGeoScale(wingGeo(1), 0.58); return s;
  })();
  function hawkGeoScale(g, k) { g.scale(k, 1, k * 1.2); return g; }
  class Owl {
    constructor() {
      const L = owlLedge();
      this.perch = new V3(L.x, L.y, L.z); this.g = new THREE.Group(); this.g.name = 'DesertOwl';
      this.body = new THREE.Mesh(owlBody, owlMat); this.head = new THREE.Group(); this.headM = new THREE.Mesh(owlHeadGeo, owlMat);
      this.eyeL = new THREE.Mesh(eyeGeo, eyeMat); this.eyeR = new THREE.Mesh(eyeGeo, eyeMat);
      this.eyeL.position.set(0.04, 0.008, 0.07); this.eyeR.position.set(-0.04, 0.008, 0.07);
      this.head.add(this.headM, this.eyeL, this.eyeR); this.head.position.set(0, 0.36, 0.01);
      this.wL = new THREE.Mesh(owlWingG, owlMat); this.wR = new THREE.Mesh(wingR.clone().scale(0.58, 1, 0.7), owlMat);
      this.wL.position.set(0.06, 0.25, 0); this.wR.position.set(-0.06, 0.25, 0); this.wL.visible = this.wR.visible = false;
      this.g.add(this.body, this.head, this.wL, this.wR); this.g.scale.setScalar(1.45);
      this.body.castShadow = quality !== 'low';
      root.add(this.g);
      this.g.position.copy(this.perch); this.g.rotation.y = L.th + Math.PI;     // лицом к котловине
      this.faceYaw = this.g.rotation.y; this.headYaw = 0; this.open = 0; this.blink = 0; this.mode = 'perch'; this.fl = null; this.nextHoot = 8; this.alt = null;
      this.t0 = R() * 10;
    }
    perchAlt() { // запасная жердь: ближайшая акация/тамариск у гребня
      const tr = flora.trees.filter((q) => q.kind === 'acacia');
      return tr.length ? new V3(tr[0].x, tr[0].y + 3.2 * tr[0].s, tr[0].z) : this.perch.clone().add(new V3(6, -2, 0));
    }
    update(dt, t, P) {
      const night = isNight() || isDusk();
      this.open = damp(this.open, night ? 1 : 0.02, 3, dt);
      eyeMat.emissiveIntensity = this.open * (isNight() ? 0.8 : 0.35);
      this.blink -= dt; if (this.blink < -3 - R() * 3) this.blink = 0.14;
      const eyeS = Math.max(0.08, this.open * (this.blink > 0 ? 0.1 : 1));
      this.eyeL.scale.set(1, eyeS, 1); this.eyeR.scale.set(1, eyeS, 1);
      const dx = P.x - this.g.position.x, dz = P.z - this.g.position.z, d = Math.hypot(dx, dz);
      if (this.mode === 'perch') {
        // голова поворачивается за игроком (ночью — активно)
        const want = night && d < 40 ? clamp(Math.atan2(dx, dz) - this.faceYaw, -2.2, 2.2) : 0.2 * Math.sin(t * 0.2 + this.t0);
        let w = want; while (w > Math.PI) w -= TAU; while (w < -Math.PI) w += TAU;
        this.headYaw = damp(this.headYaw, clamp(w, -2.3, 2.3), night ? 5 : 1.2, dt);
        this.head.rotation.set(night ? 0.04 * Math.sin(t * 0.9) : 0.28, this.headYaw, 0);
        this.g.rotation.z = 0; this.g.position.copy(this.perch);
        this.body.scale.y = 1 + 0.015 * Math.sin(t * 1.4 + this.t0) + (night ? 0 : -0.06);
        this.nextHoot -= dt;
        if (night && this.nextHoot <= 0) { this.nextHoot = 18 + R() * 24; emit('owl', 'hoot', this.perch.x, this.perch.y, this.perch.z); }
        // вспугнутый ночью — перелетает на другую жердь
        if (night && d < 4.5 && this.fl === null) this.fly(this.perchAlt());
      } else if (this.mode === 'fly') {
        const f = this.fl; f.t += dt / f.dur; const k = Math.min(1, f.t);
        const arc = Math.sin(k * Math.PI) * 2.2;
        this.g.position.set(lerp(f.a.x, f.b.x, k), lerp(f.a.y, f.b.y, k) + arc, lerp(f.a.z, f.b.z, k));
        this.g.rotation.y = Math.atan2(f.b.x - f.a.x, f.b.z - f.a.z); this.g.rotation.x = -0.25 * Math.cos(k * Math.PI);
        const flap = Math.sin(t * 16) * 0.8;
        this.wL.rotation.z = 0.2 + flap; this.wR.rotation.z = -0.2 - flap;
        this.head.rotation.set(0, 0, 0);
        if (k >= 1) { this.mode = 'perch'; this.perch.copy(f.b); this.wL.visible = this.wR.visible = false; this.g.rotation.x = 0; this.faceYaw = this.g.rotation.y; this.fl = null; this.back = f.back ? null : 28 + R() * 20; }
      }
      if (this.back != null) { this.back -= dt; if (this.back <= 0 && this.mode === 'perch' && this.fl === null) { this.back = null; this.fly(new V3(this.home().x, this.home().y, this.home().z), true); } }
    }
    home() { const L = owlLedge(); return { x: L.x, y: L.y, z: L.z }; }
    fly(to, back = false) {
      this.mode = 'fly'; this.wL.visible = this.wR.visible = true;
      this.fl = { a: this.g.position.clone(), b: to, t: 0, dur: Math.max(1.6, this.g.position.distanceTo(to) / 6), back };
      emit('owl', 'wings', this.g.position.x, this.g.position.y, this.g.position.z);
    }
  }
  out.owl = new Owl(); items.push(out.owl);

  // ============================================================ ящерицы
  const lizMat = mkMat('gd-lizard', { roughness: 0.7 });
  const lc = [0.62, 0.55, 0.36], ld = [0.34, 0.3, 0.2], ll = [0.82, 0.76, 0.58];
  const lizBody = merge([
    ell(0.03, 0.017, 0.07, 0, 0.022, 0, lc), ell(0.012, 0.006, 0.065, 0, 0.034, 0, ld), ell(0.022, 0.014, 0.034, 0, 0.026, 0.092, lc), ell(0.016, 0.008, 0.02, 0, 0.022, 0.12, ll),
    ell(0.005, 0.005, 0.004, 0.014, 0.034, 0.1, [0.05, 0.05, 0.03]), ell(0.005, 0.005, 0.004, -0.014, 0.034, 0.1, [0.05, 0.05, 0.03]),
    ...[[0.034, 0.045], [-0.034, 0.045], [0.034, -0.045], [-0.034, -0.045]].map(([x, z]) => cyl(0.006, 0.005, 0.04, x, 0.012, z, ld, [0, 0, x > 0 ? 1.0 : -1.0])),
  ]);
  const lizTail = tailGeo(0.2, 0.011, 0.003, 0.0, [0.55, 0.5, 0.33], null);
  class Lizard {
    constructor(rock) {
      this.rock = rock;
      this.g = new THREE.Group(); this.body = new THREE.Mesh(lizBody, lizMat); this.tail = new THREE.Mesh(lizTail, lizMat); this.tail.position.set(0, 0.022, -0.065);
      this.g.add(this.body, this.tail); this.g.scale.setScalar(1.7); this.g.name = 'Lizard'; this.body.castShadow = quality !== 'low';
      root.add(this.g);
      this.x = rock.x; this.y = rock.y; this.z = rock.z; this.yaw = R() * TAU; this.state = 'bask'; this.t = 1 + R() * 4; this.vis = 1; this.dash = null; this.push = 0; this.hid = 0;
    }
    update(dt, t, P) {
      const d = Math.hypot(P.x - this.x, P.z - this.z);
      if (this.state === 'bask') {
        this.t -= dt;
        // греется: поза с поднятой головой, редкие «отжимания»
        this.push = Math.max(0, this.push - dt);
        if (this.t <= 0) { this.t = 2 + R() * 5; if (R() < 0.5) this.push = 0.9; else this.yaw += (R() - 0.5) * 1.2; }
        if (d < 4.2) { this.state = 'dash'; const a = Math.atan2(this.x - P.x, this.z - P.z) + (R() - 0.5) * 0.6; const len = 3.2 + R() * 2; this.dash = { x1: this.x + Math.sin(a) * len, z1: this.z + Math.cos(a) * len, t: 0 }; this.yaw = a; emit('lizard', 'scurry', this.x, this.y, this.z); }
      } else if (this.state === 'dash') {
        const k = this.dash; k.t += dt;
        const sp = 3.6; const dx = k.x1 - this.x, dz = k.z1 - this.z, dd = Math.hypot(dx, dz);
        if (dd < 0.2 || k.t > 2.2 || !walkable(this.x + dx / dd * 0.2, this.z + dz / dd * 0.2)) { this.state = 'hide'; this.hid = 7 + R() * 7; }
        else { this.x += dx / dd * sp * dt; this.z += dz / dd * sp * dt; this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 12, dt); }
        this.y = ground(this.x, this.z) + 0.01;
      } else if (this.state === 'hide') {
        this.vis = damp(this.vis, 0, 12, dt); this.hid -= dt;
        if (this.hid <= 0 && d > 8) { this.x = this.rock.x; this.y = this.rock.y; this.z = this.rock.z; this.state = 'bask'; this.t = 2; }
      }
      if (this.state !== 'hide') this.vis = damp(this.vis, 1, 8, dt);
      this.g.visible = this.vis > 0.04 && !isNight();
      const run = this.state === 'dash';
      const w = run ? Math.sin(t * 26) * 0.28 : Math.sin(t * 1.3 + this.t) * 0.02;
      this.g.position.set(this.x, this.y, this.z); this.g.rotation.set(0, this.yaw + w, 0);
      this.g.scale.setScalar(1.7 * Math.max(0.01, this.vis));
      this.body.rotation.x = run ? 0 : -0.1 - (this.push > 0 ? 0.18 * Math.sin(this.push * 10) : 0);
      this.body.position.y = this.push > 0 ? 0.012 + 0.006 * Math.sin(this.push * 10) : 0;
      this.tail.rotation.y = run ? -w * 2.2 : Math.sin(t * 0.9) * 0.1;
    }
  }
  flora.lizardRocks.slice(0, Math.round(5 * qf) + 1).forEach((r) => { const l = new Lizard(r); out.lizards.push(l); items.push(l); });

  // ============================================================ жуки (инстансы)
  {
    const bg = merge([ell(0.011, 0.0085, 0.016, 0, 0.008, 0, [0.07, 0.07, 0.09]), ell(0.007, 0.006, 0.006, 0, 0.007, 0.016, [0.04, 0.04, 0.05])]);
    const bm = mkMat('gd-beetle', { roughness: 0.25, metalness: 0.4 });
    const N = Math.round(28 * qf);
    const mesh = new THREE.InstancedMesh(bg, bm, N); mesh.frustumCulled = false; mesh.castShadow = false; root.add(mesh);
    const B = Array.from({ length: N }, () => {
      const rk = flora.rocks.length ? flora.rocks[(R() * flora.rocks.length) | 0] : { x: C.x + 8, z: C.z };
      return { x: rk.x + (R() - 0.5) * 7, z: rk.z + (R() - 0.5) * 7, yaw: R() * TAU, t: R() * 4, sp: 0, stand: 0 };
    });
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new V3(), s = new V3();
    const beetles = {
      update(dt, t, P) {
        const dawn = hours() > 4.9 && hours() < 7.4;
        let k = 0;
        for (const b of B) {
          b.t -= dt;
          if (b.t <= 0) { b.t = 1 + R() * 3; b.sp = R() < 0.55 ? 0 : 0.03 + R() * 0.05; b.yaw += (R() - 0.5) * 2; }
          const dx = b.x - P.x, dz = b.z - P.z, d = Math.hypot(dx, dz);
          if (d < 1.5) { b.sp = 0.2; b.yaw = Math.atan2(dx, dz); b.t = 0.6; }
          const nx = b.x + Math.sin(b.yaw) * b.sp * dt, nz = b.z + Math.cos(b.yaw) * b.sp * dt;
          if (walkable(nx, nz)) { b.x = nx; b.z = nz; } else b.yaw += 2;
          // жуки-чернотелки на рассвете встают «на голову» — собирают росу
          b.stand = damp(b.stand, dawn && b.sp === 0 ? 1 : 0, 1.5, dt);
          e.set(-b.stand * 0.95, b.yaw, 0, 'YXZ'); q.setFromEuler(e);
          m4.compose(p.set(b.x, ground(b.x, b.z), b.z), q, s.set(1.8, 1.8, 1.8)); mesh.setMatrixAt(k++, m4);
        }
        mesh.instanceMatrix.needsUpdate = true;
      },
    };
    out.beetles = beetles; items.push(beetles);
  }

  // ============================================================ кит-лисица (ночью)
  {
    const fm = mkMat('gd-fox');
    const fc = [0.78, 0.64, 0.46], fw = [0.94, 0.9, 0.82], fd = [0.2, 0.16, 0.12];
    const torso = merge([ell(0.065, 0.07, 0.2, 0, 0.2, 0, fc), ell(0.055, 0.04, 0.13, 0, 0.17, 0.05, fw), ell(0.052, 0.05, 0.07, 0, 0.255, 0.22, fc), cone(0.025, 0.09, 0, 0.235, 0.3, fd, [Math.PI / 2, 0, 0]),
      ell(0.026, 0.1, 0.014, 0.04, 0.34, 0.2, fc, [0.1, 0, -0.25]), ell(0.026, 0.1, 0.014, -0.04, 0.34, 0.2, fc, [0.1, 0, 0.25]),
      ell(0.026, 0.07, 0.008, 0.04, 0.33, 0.215, [0.85, 0.65, 0.6], [0.1, 0, -0.25]), ell(0.026, 0.07, 0.008, -0.04, 0.33, 0.215, [0.85, 0.65, 0.6], [0.1, 0, 0.25]),
      ell(0.007, 0.007, 0.007, 0.026, 0.268, 0.275, [0.03, 0.03, 0.02]), ell(0.007, 0.007, 0.007, -0.026, 0.268, 0.275, [0.03, 0.03, 0.02])]);
    const tail = merge([ell(0.04, 0.043, 0.17, 0, 0, -0.14, fc), ell(0.034, 0.036, 0.06, 0, 0, -0.3, fd)]);
    const legG = merge([cyl(0.017, 0.012, 0.2, 0, -0.1, 0, fd)]);
    class Fox {
      constructor() {
        this.g = new THREE.Group(); this.g.name = 'KitFox'; this.t = new THREE.Mesh(torso, fm); this.tl = new THREE.Mesh(tail, fm); this.tl.position.set(0, 0.2, -0.17);
        this.legs = [[0.045, 0.14], [-0.045, 0.14], [0.045, -0.12], [-0.045, -0.12]].map(([x, z]) => { const l = new THREE.Mesh(legG, fm); l.position.set(x, 0.2, z); this.g.add(l); return l; });
        this.g.add(this.t, this.tl); this.g.scale.setScalar(1.3); root.add(this.g);
        this.x = C.x + 30; this.z = C.z + 20; this.yaw = 0; this.goal = null; this.pause = 3; this.sit = 0; this.vis = 0; this.phase = 0; this.spd = 0;
        this.t.castShadow = quality !== 'low';
      }
      pickGoal() {
        for (let i = 0; i < 20; i++) { const a = R() * TAU, r = 14 + R() * 30; const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r; if (walkable(x, z)) return { x, z }; }
        return { x: C.x + 20, z: C.z };
      }
      update(dt, t, P) {
        const on = isNight() || (hours() > 19 && hours() < 22);
        this.vis = damp(this.vis, on ? 1 : 0, 2, dt); this.g.visible = this.vis > 0.05;
        if (!this.g.visible) return;
        const d = Math.hypot(this.x - P.x, this.z - P.z);
        let sp = 0;
        if (d < 8 && this.state !== 'flee') { this.state = 'flee'; this.goal = this.pickGoalAway(P); emit('fox', 'bark', this.x, ground(this.x, this.z), this.z); }
        if (this.state === 'flee' && d > 22) this.state = 'walk';
        if (this.pause > 0) { this.pause -= dt; this.sit = damp(this.sit, 1, 4, dt); if (this.pause <= 0) { this.goal = this.pickGoal(); this.sit = 0; } }
        else if (this.goal) {
          const dx = this.goal.x - this.x, dz = this.goal.z - this.z, dd = Math.hypot(dx, dz);
          sp = this.state === 'flee' ? 3.6 : 1.15;
          if (dd < 0.6) { this.goal = null; this.pause = 3 + R() * 6; this.state = 'walk'; sp = 0; }
          else { this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 5, dt); this.x += Math.sin(this.yaw) * sp * dt; this.z += Math.cos(this.yaw) * sp * dt; }
        } else this.goal = this.pickGoal();
        this.spd = damp(this.spd, sp, 6, dt); this.phase += dt * this.spd * 7.5;
        this.g.position.set(this.x, ground(this.x, this.z), this.z); this.g.rotation.y = this.yaw;
        this.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? 1.2 : 0)) * 0.7 * Math.min(1, this.spd / 1.2); });
        this.t.rotation.x = -0.25 * this.sit; this.t.position.y = -0.07 * this.sit; this.tl.rotation.x = 0.15 * this.sit + 0.05 * Math.sin(t * 2);
        this.g.scale.setScalar(1.3 * (0.4 + 0.6 * this.vis));
      }
      pickGoalAway(P) { const a = Math.atan2(this.x - P.x, this.z - P.z); return { x: this.x + Math.sin(a) * 14, z: this.z + Math.cos(a) * 14 }; }
    }
    out.fox = new Fox(); items.push(out.fox);
  }

  out.update = (dt, t) => {
    const p = playerPos();
    const P = { x: p.x, y: p.y, z: p.z, speed: game.player?.speed || 0 };
    for (const it of items) it.update(dt, t, P);
  };
  out.setVisible = (b) => { root.visible = b; };
  return out;
}
