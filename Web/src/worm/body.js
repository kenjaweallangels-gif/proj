// Меш червя: тело-труба (деформация по позвоночнику на GPU), голова с тремя лепестками, глотка, кристаллические зубы, наездники.
import * as THREE from 'three';
import { makeFigure } from '../core/figures.js';
import { LENGTH, RADIUS } from './spine.js';
import { patchChitin, patchTeeth, patchSpineBack } from './shaders.js';

export const HEAD_LEN = 30;     // длина лепестков в закрытом состоянии, м
const PETAL_NU = 28, PETAL_NV = 22;

const QUALITY = {
  low: { ns: 300, na: 56, hq: false, teethRings: [40, 36, 32, 28, 24], children: false },
  med: { ns: 600, na: 108, hq: true, teethRings: [64, 58, 52, 46, 40], children: true },
  high: { ns: 800, na: 144, hq: true, teethRings: [72, 64, 58, 52, 44], children: true },
};

function tubeGeometry(ns, na) {
  const nv = (ns + 1) * (na + 1);
  const pos = new Float32Array(nv * 3);
  const uv = new Float32Array(nv * 2);
  const idx = new Uint32Array(ns * na * 6);
  let k = 0;
  for (let i = 0; i <= ns; i++) {
    for (let j = 0; j <= na; j++) {
      const v = i * (na + 1) + j;
      uv[v * 2] = i / ns; uv[v * 2 + 1] = j / na;
    }
  }
  for (let i = 0; i < ns; i++) {
    for (let j = 0; j < na; j++) {
      const a = i * (na + 1) + j, b = a + 1, c = a + (na + 1), d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e5, -1e5, -1e5), new THREE.Vector3(1e5, 1e5, 1e5));
  return g;
}

/** Профиль закрытого лепестка (бутон-огива). */
function closedProfile(L = HEAD_LEN, R = RADIUS) {
  const r = (z) => R * Math.pow(Math.max(0, 1 - Math.pow(z / L, 2.3)), 0.62);
  const seg = [];
  let prevR = r(0), prevZ = 0;
  for (let j = 1; j <= PETAL_NU; j++) {
    const z = (L * j) / PETAL_NU, rr = r(z);
    const dr = rr - prevR, dz = z - prevZ;
    seg.push({ ds: Math.hypot(dr, dz), phi0: Math.atan2(dr, dz) });
    prevR = rr; prevZ = z;
  }
  return seg;
}

class Petal {
  constructor(theta, material, profile) {
    this.theta = theta;
    this.profile = profile;
    const nv = (PETAL_NU + 1) * (PETAL_NV + 1);
    this.pos = new Float32Array(nv * 3);
    this.uv = new Float32Array(nv * 2);
    this.pet = new Float32Array(nv * 2);
    const idx = [];
    for (let j = 0; j < PETAL_NU; j++) {
      for (let i = 0; i < PETAL_NV; i++) {
        const a = j * (PETAL_NV + 1) + i, b = a + 1, c = a + PETAL_NV + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    this.geo.setAttribute('aPet', new THREE.BufferAttribute(this.pet, 2));
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.rebuild(0);
    // проверить ориентацию: нормаль в середине лепестка должна смотреть от оси
    const n = this.geo.attributes.normal;
    const mid = (Math.floor(PETAL_NU / 2)) * (PETAL_NV + 1) + PETAL_NV / 2;
    const px = this.pos[mid * 3], py = this.pos[mid * 3 + 1];
    if (n.getX(mid) * px + n.getY(mid) * py < 0) {
      const ix = this.geo.index.array;
      for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
      this.geo.index.needsUpdate = true;
      this.geo.computeVertexNormals();
    }
  }
  rebuild(open) {
    const R = RADIUS, prof = this.profile;
    const ct = Math.cos(this.theta), st = Math.sin(this.theta);
    const halfW = (62 * Math.PI / 180) * (1 - 0.1 * open);
    let cx = R + 0.9, cz = -0.9, ell = 0;
    const base = 1.05, tipAdd = 0.55;
    for (let j = 0; j <= PETAL_NU; j++) {
      const u = j / PETAL_NU;
      if (j > 0) {
        const sg = prof[j - 1];
        const um = (j - 0.5) / PETAL_NU;
        const beta = open * (base + tipAdd * um + 0.25 * um * um);
        const phi = sg.phi0 + beta;
        cx += sg.ds * Math.sin(phi); cz += sg.ds * Math.cos(phi);
        ell += sg.ds;
      }
      const rho = Math.max(cx - 0.9 * u, 0.02);
      for (let i = 0; i <= PETAL_NV; i++) {
        const v = (i / PETAL_NV) * 2 - 1;
        const al = v * halfW * (1 - open * 0.45 * Math.pow(u, 2.6));
        // небольшая «лодочка»: края чуть приподняты вперёд при раскрытии
        const px = rho * Math.cos(al), py = rho * Math.sin(al), pz = cz + open * (4.5 * v * v * (0.25 + 0.75 * u) + 0.9 * Math.sin(v * 7.0 + this.theta * 3) * u * (1 - u) * 2);
        const k = j * (PETAL_NV + 1) + i;
        this.pos[k * 3] = px * ct - py * st; this.pos[k * 3 + 1] = px * st + py * ct; this.pos[k * 3 + 2] = pz;
        this.uv[k * 2] = ell; this.uv[k * 2 + 1] = this.theta + al;
        this.pet[k * 2] = u; this.pet[k * 2 + 1] = v;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.attributes.aPet.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

/** Профиль внутренней стенки глотки (z вперёд, отрицательные — вглубь). */
function cavityR(z) {
  // z: +0.5 .. -34
  const pts = [[0.6, 20.4], [-4, 19.0], [-10, 15.8], [-18, 11.5], [-26, 7], [-33, 2.6], [-36, 0.4]];
  for (let i = 0; i < pts.length - 1; i++) {
    if (z <= pts[i][0] && z >= pts[i + 1][0]) {
      const t = (pts[i][0] - z) / (pts[i][0] - pts[i + 1][0]);
      return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
    }
  }
  return pts[pts.length - 1][1];
}

function cavityGeometry() {
  const na = 72, nz = 26;
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nz; j++) {
    const z = 0.5 - (36.5 * j) / nz;
    const r = cavityR(z);
    for (let i = 0; i <= na; i++) {
      const a = (i / na) * Math.PI * 2;
      const fold = 1 + 0.05 * Math.sin(a * 18) * Math.min(1, -z / 8 + 0.2) + 0.03 * Math.sin(z * 0.9);
      pos.push(Math.cos(a) * r * fold, Math.sin(a) * r * fold, z);
      uv.push(0.5 - z, a);
    }
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++) {
    const a = j * (na + 1) + i, b = a + 1, c = a + na + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildTeeth(cfg, mat, rand) {
  const geo = new THREE.CylinderGeometry(0.0, 0.55, 1, 6, 2, true);
  geo.translate(0, 0.5, 0);
  const rings = cfg.teethRings;
  const per = cfg.children ? 3 : 1;
  const total = rings.reduce((a, b) => a + b, 0) * per;
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  const depth = new Float32Array(total);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4();
  const p = new THREE.Vector3(), d = new THREE.Vector3(), s = new THREE.Vector3();
  let n = 0;
  rings.forEach((cnt, k) => {
    const zk = -(1.6 + 4.4 * k);
    const rw = cavityR(zk) * 0.97;
    const len0 = 5.2 - 0.75 * k;
    for (let i = 0; i < cnt; i++) {
      const th = ((i + 0.5 * (k % 2)) / cnt) * Math.PI * 2 + (rand() - 0.5) * 0.04;
      const cos = Math.cos(th), sin = Math.sin(th);
      for (let c = 0; c < per; c++) {
        const main = c === 0;
        const jitterT = (rand() - 0.5) * (main ? 0.12 : 0.5);
        const tl = (main ? 1 : 0.38 + rand() * 0.2) * len0 * (0.8 + rand() * 0.4);
        const rad = main ? 0 : (c === 1 ? 1 : -1) * 0.55;
        // позиция основания; дочерние кристаллы сдвинуты по окружности
        const thc = th + rad / rw;
        p.set(Math.cos(thc) * rw, Math.sin(thc) * rw, zk + (main ? 0 : -0.2));
        // зуб смотрит в горло (назад) и к оси
        d.set(-cos * (0.62 + jitterT), -sin * (0.62 + jitterT), -(0.55 + (rand() - 0.5) * 0.2)).normalize();
        if (!main) d.x += (rand() - 0.5) * 0.4, d.y += (rand() - 0.5) * 0.4, d.normalize();
        q.setFromUnitVectors(up, d);
        const w = (main ? 1.35 : 0.8) * (0.85 + rand() * 0.3) * (tl / 4);
        s.set(w, tl, w);
        m.compose(p, q, s);
        mesh.setMatrixAt(n, m);
        depth[n] = k / (rings.length - 1) * 0.9;
        n++;
      }
    }
  });
  mesh.count = n;
  geo.setAttribute('aDepth', new THREE.InstancedBufferAttribute(depth, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

export class WormBody {
  constructor(game, U, spine, quality = 'med') {
    this.game = game; this.U = U; this.spine = spine;
    const cfg = QUALITY[quality] || QUALITY.med;
    this.cfg = cfg;
    const rand = (() => { let a = 1517; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();

    this.group = new THREE.Group();
    this.group.name = 'Worm';

    // Тело
    const bodyMat = patchChitin(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0 }), 0, U, cfg.hq);
    this.tube = new THREE.Mesh(tubeGeometry(cfg.ns, cfg.na), bodyMat);
    this.tube.frustumCulled = false;
    this.tube.name = 'WormBody';
    this.group.add(this.tube);
    const backMat = patchSpineBack(new THREE.MeshBasicMaterial({ color: '#2a2219', side: THREE.BackSide }), U);
    this.tubeBack = new THREE.Mesh(this.tube.geometry, backMat);
    this.tubeBack.frustumCulled = false;
    this.group.add(this.tubeBack);

    // Голова
    this.head = new THREE.Group();
    this.head.name = 'WormHead';
    this.head.matrixAutoUpdate = false;
    this.group.add(this.head);
    const petalMat = patchChitin(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0, side: THREE.DoubleSide }), 1, U, cfg.hq);
    const profile = closedProfile();
    this.petals = [90, 210, 330].map((deg) => new Petal(deg * Math.PI / 180, petalMat, profile));
    this.petals.forEach((p) => this.head.add(p.mesh));
    const throatMat = patchChitin(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0, side: THREE.DoubleSide }), 2, U, cfg.hq);
    this.throat = new THREE.Mesh(cavityGeometry(), throatMat);
    this.throat.frustumCulled = false;
    this.head.add(this.throat);
    const teethMat = patchTeeth(new THREE.MeshStandardMaterial({ color: '#e9dfc8', roughness: 0.28, metalness: 0.05 }), U);
    this.teeth = buildTeeth(cfg, teethMat, rand);
    this.head.add(this.teeth);

    this.open = -1;
    this.setOpen(0);
    this._P = new THREE.Vector3(); this._T = new THREE.Vector3(); this._N = new THREE.Vector3(); this._B = new THREE.Vector3();
    this._m = new THREE.Matrix4();
  }

  setOpen(v) {
    v = Math.min(1, Math.max(0, v));
    if (Math.abs(v - this.open) < 0.002) return;
    this.open = v;
    this.U.uOpen.value = v;
    for (const p of this.petals) p.rebuild(v);
  }

  /** Поставить голову по каркасу на s=0. */
  update() {
    const P = this._P, T = this._T, N = this._N, B = this._B;
    this.spine.frameAt(0, P, T, N);
    B.crossVectors(T, N);
    // локальные оси головы: x = -B, y = N, z = T
    this._m.makeBasis(B.clone().negate(), N, T).setPosition(P);
    this.head.matrix.copy(this._m);
    this.head.matrixWorldNeedsUpdate = true;
    this.head.updateMatrixWorld(true);
  }

  /** Мировая точка/направление пасти. */
  mouthWorld(outPos, outDir) {
    this.spine.frameAt(0, this._P, this._T, this._N);
    outPos.copy(this._P).addScaledVector(this._T, HEAD_LEN * 0.55);
    outDir.copy(this._T);
  }
}

/** Наездники: три крошечные фигуры в тёмных накидках с крючьями творца. */
export class Riders {
  constructor(game, spine) {
    this.spine = spine;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.items = [];
    const defs = [
      { name: 'Rider1', s: 34, da: -0.10, cloth: '#1d1a17', suit: '#14120f', accent: '#5c2a1f', bulk: 1.05 },
      { name: 'Ossana', s: 58, da: 0.0, cloth: '#2a2118', suit: '#17130f', accent: '#7a2d22', bulk: 1.0 },
      { name: 'Rider3', s: 86, da: 0.11, cloth: '#1b1c1e', suit: '#121315', accent: '#31475f', bulk: 1.08 },
    ];
    const poleMat = new THREE.MeshStandardMaterial({ color: '#3a2e22', roughness: 0.7, metalness: 0.2 });
    const metal = new THREE.MeshStandardMaterial({ color: '#6c6a66', roughness: 0.4, metalness: 0.8 });
    for (const d of defs) {
      const fig = makeFigure({ height: 1.75, cloth: d.cloth, suit: d.suit, accent: d.accent, bulk: d.bulk, name: d.name, mask: true, hood: true });
      const root = new THREE.Group();
      root.add(fig.group);
      // крюк творца: шест с изогнутым крюком, воткнут в кольцо
      const pole = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.6, 6), poleMat);
      shaft.position.y = 1.7;
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 5, 10, Math.PI * 1.3), metal);
      hook.position.set(0, 0.02, -0.18); hook.rotation.y = Math.PI / 2;
      pole.add(shaft, hook);
      pole.position.set(0.42, -0.05, 0.25);
      pole.rotation.set(-0.28, 0, -0.12);
      root.add(pole);
      // страховочный трос от пояса к шесту
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 4), poleMat);
      rope.position.set(0.22, 0.95, 0.14); rope.rotation.z = Math.PI / 2.6;
      root.add(rope);
      // материалы фигур общие (кэш figures.js) — клонируем и добавляем слабую подсветку, чтобы силуэты читались против солнца
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        const m = o.material.clone();
        m.emissive = m.color.clone().multiplyScalar(0.22);
        o.material = m;
      });
      this.group.add(root);
      this.items.push({ ...d, fig, root, sNow: d.s, a: 0, free: false, hidden: false });
    }
    this.aBase = 0;
    this._P = new THREE.Vector3(); this._N = new THREE.Vector3(); this._T = new THREE.Vector3();
    this._B = new THREE.Vector3(); this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
  }

  /** Расставить по телу. groundFn — для скрытия ушедших под песок. */
  update(dt, groundFn, time) {
    const sp = this.spine;
    for (const it of this.items) {
      if (it.free) continue;
      if (it.hidden) { it.root.visible = false; continue; }
      sp.surfacePoint(it.sNow, this.aBase + it.da + it.a, this._P, this._N, 0.05);
      // каркас: вперёд — к голове; вверх — наружная нормаль
      sp.frameAt(it.sNow, this._B, this._T, this._B.clone());
      const up = this._N, fwd = this._T.clone().addScaledVector(up, -this._T.dot(up)).normalize();
      const right = new THREE.Vector3().crossVectors(up, fwd);
      this._m.makeBasis(right, up, fwd).setPosition(this._P);
      it.root.matrix.copy(this._m);
      it.root.matrixAutoUpdate = false;
      it.root.matrixWorldNeedsUpdate = true;
      // раскачка тела
      it.fig.animate(it.moving ? 2.4 : 0, dt);
      const under = this._P.y < groundFn(this._P.x, this._P.z) + 0.5;
      it.root.visible = !under;
    }
  }
}
