// Мелкая жизнь сада: певчие птички (садятся на кроны пальм, фонари, башни; короткие перелёты; пугаются игрока) и стрекозы над водой.
// Всё инстансами (птицы: тела + крылья, стрекозы: тела + крылья), обновление только вблизи камеры.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng, lerp, clamp } from '../core/util.js';
import { fogPatch } from './plants.js';
import { POND, CHANNELS } from './layout.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;

function paint(g, c) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  const r = Math.pow(c[0], 2.2), gg = Math.pow(c[1], 2.2), b = Math.pow(c[2], 2.2);
  for (let i = 0; i < n; i++) { a[i * 3] = r; a[i * 3 + 1] = gg; a[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function ell(rx, ry, rz, x, y, z, c) { const g = new THREE.SphereGeometry(1, 8, 6); g.scale(rx, ry, rz); g.translate(x, y, z); return paint(g, c); }
function cone(r, h, x, y, z, c) { const g = new THREE.ConeGeometry(r, h, 5, 1); g.rotateX(Math.PI / 2); g.translate(x, y, z); return paint(g, c); }
const merge = (list) => { const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false); list.forEach((x) => x.dispose()); g.computeBoundingSphere(); return g; };

export function createLife(game, { root, flora, structures, quality }) {
  const R = rng(4242);
  const nBirds = quality === 'low' ? 6 : 11, nFly = quality === 'low' ? 3 : 6;
  const out = { birds: [], flies: [] };

  // ---------------- птички (воробьи): красно-бурая шапочка, светлое брюшко, тёмный горловой «галстук» ----------------
  const bodyG = merge([
    ell(0.034, 0.032, 0.07, 0, 0, 0, [0.56, 0.4, 0.26]),
    ell(0.03, 0.022, 0.055, 0, -0.014, 0.004, [0.9, 0.86, 0.76]),
    ell(0.026, 0.026, 0.028, 0, 0.022, 0.06, [0.66, 0.3, 0.16]),
    ell(0.017, 0.012, 0.016, 0, 0.008, 0.078, [0.08, 0.06, 0.05]),
    cone(0.007, 0.022, 0, 0.018, 0.092, [0.85, 0.7, 0.3]),
    ell(0.014, 0.006, 0.05, 0, 0.0, -0.095, [0.38, 0.28, 0.2]),
  ]);
  const wingG = (() => { const g = new THREE.PlaneGeometry(0.11, 0.06, 1, 1); g.rotateX(-Math.PI / 2); g.translate(0.055, 0, 0); return paint(g, [0.48, 0.34, 0.22]); })();
  const birdMat = fogPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), 'gd-bird');
  const bodies = new THREE.InstancedMesh(bodyG, birdMat, nBirds);
  const wings = new THREE.InstancedMesh(wingG, birdMat, nBirds * 2);
  for (const m of [bodies, wings]) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; root.add(m); m.count = 0; }
  bodies.name = 'Songbirds'; wings.name = 'SongbirdWings';

  // присады: кроны пальм, верхушки тамариска, фонари, башни
  const perches = [];
  for (const p of flora.palms) perches.push({ x: p.top.x, y: p.top.y + 0.1, z: p.top.z, kind: 'palm' });
  for (const t of flora.trees) perches.push({ x: t.x, y: t.y + 2.0 * t.s, z: t.z, kind: 'tree' });
  if (structures.lamps) for (const q of structures.lamps.pos) perches.push({ x: q[0], y: q[1] + 0.3, z: q[2], kind: 'lamp' });
  if (structures.towers) for (const t of structures.towers) perches.push({ x: t.x, y: t.y + 11.6, z: t.z, kind: 'tower' });
  const pick = () => perches[(R() * perches.length) | 0];

  class Bird {
    constructor(i) {
      this.i = i; const p = pick();
      this.x = p.x; this.y = p.y; this.z = p.z; this.yaw = R() * TAU; this.state = 'perch'; this.t = R() * 5; this.ph = R() * TAU;
      this.from = null; this.to = null; this.k = 0; this.dur = 1; this.arc = 0.5; this.pitch = 0;
    }
    flyTo(p, fast = false) {
      this.from = { x: this.x, y: this.y, z: this.z }; this.to = p;
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      this.dur = clamp(d / (fast ? 11 : 7), 0.6, 4); this.k = 0; this.state = 'fly'; this.arc = 0.5 + d * 0.06;
      this.yaw = Math.atan2(p.x - this.x, p.z - this.z);
    }
    update(dt, t, P) {
      const dx = this.x - P.x, dz = this.z - P.z, dy = this.y - P.y, d = Math.hypot(dx, dz, dy * 0.5);
      if (this.state === 'perch') {
        this.t -= dt;
        this.pitch = 0.1 * Math.sin(t * 3 + this.ph) * (Math.sin(t * 0.7 + this.ph) > 0.6 ? 1 : 0.15);
        if (d < 5.5 || this.t <= 0) {
          let p = pick(), n = 0;
          while (n++ < 8 && (Math.hypot(p.x - this.x, p.z - this.z) < 3 || (d < 5.5 && Math.hypot(p.x - P.x, p.z - P.z) < 9))) p = pick();
          this.flyTo(p, d < 5.5);
        }
      } else {
        this.k += dt / this.dur;
        const k = Math.min(1, this.k), e = k * k * (3 - 2 * k);
        this.x = lerp(this.from.x, this.to.x, e); this.z = lerp(this.from.z, this.to.z, e);
        this.y = lerp(this.from.y, this.to.y, e) + Math.sin(Math.PI * k) * this.arc;
        this.pitch = -0.3 * Math.cos(Math.PI * k);
        if (this.k >= 1) { this.state = 'perch'; this.t = 2 + R() * 9; this.x = this.to.x; this.y = this.to.y; this.z = this.to.z; }
      }
    }
  }
  for (let i = 0; i < nBirds && perches.length; i++) out.birds.push(new Bird(i));

  // ---------------- стрекозы над водой ----------------
  const dBodyG = merge([ell(0.004, 0.004, 0.035, 0, 0, 0, [0.12, 0.45, 0.62]), ell(0.007, 0.007, 0.008, 0, 0, 0.038, [0.1, 0.35, 0.5])]);
  const dWingG = (() => { const g = new THREE.PlaneGeometry(0.05, 0.012, 1, 1); g.rotateX(-Math.PI / 2); g.translate(0.025, 0, 0); return paint(g, [0.85, 0.9, 0.95]); })();
  const dMat = fogPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.9, emissive: 0x0a2030, emissiveIntensity: 0.4 }), 'gd-dragonfly');
  const dBodies = new THREE.InstancedMesh(dBodyG, dMat, nFly), dWings = new THREE.InstancedMesh(dWingG, dMat, nFly * 4);
  for (const m of [dBodies, dWings]) { m.frustumCulled = false; m.count = 0; root.add(m); }
  dBodies.name = 'Dragonflies'; dWings.name = 'DragonflyWings';
  const sources = [{ x: POND.x, z: POND.z, r: 3.6 }, { x: 829, z: 399.5, r: 2.4 }, { x: POND.x - 8, z: POND.z + 1, r: 3 }];
  for (const ch of CHANNELS) if (ch.id === 'east') sources.push({ x: 860, z: 399.5, r: 3 });
  for (let i = 0; i < nFly; i++) {
    const s = sources[i % sources.length];
    out.flies.push({ s, ph: R() * TAU, sp: 0.6 + R() * 0.5, h: 0.55 + R() * 0.6, rr: s.r * (0.5 + R() * 0.6), x: s.x, y: 0, z: s.z, yaw: 0, dart: 0 });
  }

  const m4 = new THREE.Matrix4(), mw = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pp = new V3(), sc = new V3(1, 1, 1), qw = new THREE.Quaternion(), pw = new V3();
  const P = new V3();
  out.update = (dt, t, cam, playerPos, ground) => {
    const dC = Math.hypot(cam.x - POND.x, cam.z - 395);
    const on = dC < 110;
    bodies.visible = wings.visible = dBodies.visible = dWings.visible = on;
    if (!on) return;
    P.copy(playerPos || cam);
    // птицы
    let n = 0;
    for (const b of out.birds) {
      b.update(dt, t, P);
      if ((b.x - cam.x) ** 2 + (b.z - cam.z) ** 2 > 140 * 140) continue;
      e.set(b.pitch, b.yaw, 0, 'YXZ'); q.setFromEuler(e);
      m4.compose(pp.set(b.x, b.y + 0.035, b.z), q, sc); bodies.setMatrixAt(n, m4);
      const flap = b.state === 'fly' ? Math.sin(t * 42 + b.ph) * 0.9 : (Math.sin(t * 0.9 + b.ph) > 0.97 ? 0.5 : -0.12);
      for (let s = 0; s < 2; s++) {
        const sg = s ? -1 : 1;
        qw.setFromEuler(e.set(0, 0, sg * flap + (sg > 0 ? 0.0 : Math.PI) * 0)); // крыло: поворот вокруг оси тела (локальная z)
        mw.makeRotationFromQuaternion(qw); if (!s) mw.scale(sc.set(1, 1, 1)); else mw.scale(sc.set(-1, 1, 1));
        mw.setPosition(sg * 0.025, 0.02, 0.01);
        mw.premultiply(m4);
        wings.setMatrixAt(n * 2 + s, mw);
      }
      sc.set(1, 1, 1);
      n++;
    }
    bodies.count = n; wings.count = n * 2; bodies.instanceMatrix.needsUpdate = true; wings.instanceMatrix.needsUpdate = true;
    // стрекозы
    let k = 0;
    for (const f of out.flies) {
      f.ph += dt * f.sp;
      f.dart = Math.max(0, f.dart - dt); if (f.dart <= 0 && R() < dt * 0.5) f.dart = 0.25;
      const a = f.ph + (f.dart > 0 ? 1.4 : 0) * Math.sin(f.ph * 3), r = f.rr * (1 + 0.25 * Math.sin(f.ph * 0.7));
      const nx = f.s.x + Math.cos(a) * r, nz = f.s.z + Math.sin(a * 1.3) * r * 0.8;
      f.yaw = Math.atan2(nx - f.x, nz - f.z); f.x = nx; f.z = nz;
      f.y = ground(f.x, f.z) + f.h + 0.15 * Math.sin(f.ph * 4.1);
      if ((f.x - cam.x) ** 2 + (f.z - cam.z) ** 2 > 90 * 90) continue;
      e.set(0, f.yaw, 0, 'YXZ'); q.setFromEuler(e);
      m4.compose(pp.set(f.x, f.y, f.z), q, sc); dBodies.setMatrixAt(k, m4);
      for (let w = 0; w < 4; w++) {
        const sg = w % 2 ? -1 : 1, off = (w >> 1) * 0.012 - 0.002;
        qw.setFromEuler(e.set(0, 0, sg * (0.15 + 0.5 * Math.sin(t * 90 + w * 1.7)), 'XYZ'));
        mw.makeRotationFromQuaternion(qw); mw.scale(sc.set(sg, 1, 1)); mw.setPosition(sg * 0.004, 0.003, 0.012 + off);
        mw.premultiply(m4); dWings.setMatrixAt(k * 4 + w, mw);
      }
      sc.set(1, 1, 1);
      k++;
    }
    dBodies.count = k; dWings.count = k * 4; dBodies.instanceMatrix.needsUpdate = true; dWings.instanceMatrix.needsUpdate = true;
  };
  return out;
}
