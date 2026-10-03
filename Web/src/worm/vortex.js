// Песчаная воронка под харвестером: накладка на рельеф (полярная сетка), спиральные гребни крутятся к центру, в центре — тёмный «зев».
// Рельеф пустыни не деформируется, поэтому воронка — накладка чуть выше земли: вал по краю (выброшенный песок), спиральные борозды, градиент
// к тёмному центру. Объекты, опущенные ниже земли (харвестер, тонущий в песке), скрываются самим рельефом и накладкой.
// После сцены остаётся кратером: низкий вал и тёмное пятно (fade → crater).
import * as THREE from 'three';

const GRID = { low: [26, 64], med: [40, 96], high: [52, 128] };

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export class Vortex {
  constructor(groundFn, color = '#c8a672', quality = 'med') {
    this.ground = groundFn;
    const [NR, NA] = GRID[quality] || GRID.med;
    this.NR = NR; this.NA = NA;
    this.cx = 0; this.cz = 0;
    const nv = (NR + 1) * NA;
    this.pos = new Float32Array(nv * 3);
    this.col = new Float32Array(nv * 4);
    const idx = [];
    for (let r = 0; r < NR; r++) for (let a = 0; a < NA; a++) {
      const a0 = r * NA + a, a1 = r * NA + (a + 1) % NA, b0 = (r + 1) * NA + a, b1 = (r + 1) * NA + (a + 1) % NA;
      idx.push(a0, a1, b0, a1, b1, b0);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), roughness: 1, metalness: 0, vertexColors: true, transparent: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 3; this.mesh.receiveShadow = true;
    // радиусы колец: плотнее у центра и у вала
    this.gy = new Float32Array(nv);          // кэш высот рельефа (зависят от центра и радиуса, не от вращения)
    this.keyC = [NaN, NaN, NaN];
    this.R = 110;
    this.phase = 0;
  }

  /**
   * k — интенсивность 0..1 (проявление воронки), spin — угол вращения, рад, hole — радиус зева (м), rimH — высота вала, m,
   * crater — 0..1: доля «остывшего» кратера (вращение выключено, ямки сглажены).
   */
  update(cx, cz, { k = 1, spin = 0, hole = 28, rimH = 3.2, R = 110, crater = 0, cut = 0 } = {}) {
    this.cx = cx; this.cz = cz; this.R = R;
    const pos = this.pos, col = this.col, g = this.ground, NR = this.NR, NA = this.NA;
    const rimR = R * 0.72;
    const fresh = cx !== this.keyC[0] || cz !== this.keyC[1] || Math.abs(R - this.keyC[2]) > 0.25;
    if (fresh) { this.keyC[0] = cx; this.keyC[1] = cz; this.keyC[2] = R; }
    const gy = this.gy;
    for (let r = 0; r <= NR; r++) {
      const u = r / NR;
      const rr = R * (u * u * 0.55 + u * 0.45);
      for (let a = 0; a < NA; a++) {
        const th = (a / NA) * Math.PI * 2;
        const wob = 1 + 0.05 * Math.sin(th * 3 + 1.1) + 0.03 * Math.sin(th * 7 + 0.9);
        const rw = rr * wob;
        const x = cx + Math.cos(th) * rw, z = cz + Math.sin(th) * rw;
        // вал
        const rim = rimH * k * Math.exp(-(((rw - rimR) / (R * 0.12)) ** 2)) * (0.8 + 0.2 * Math.sin(th * 5 + 0.7));
        // спиральные гребни: логарифмическая спираль, вращение в сторону центра
        const spiral = th * 3 + 5.5 * Math.log(Math.max(rw, 1) / hole) - spin;
        const band = smoothstep(hole * 1.05, hole * 1.9, rw) * (1 - smoothstep(rimR * 0.92, rimR * 1.15, rw));
        const ridge = Math.sin(spiral) * (1 - crater * 0.8);
        const h = rim + band * k * (0.9 * ridge + 0.35 * Math.sin(spiral * 2.3 + 1)) * (1 - 0.4 * crater);
        const o = r * NA + a;
        if (fresh) gy[o] = g(x, z);
        pos[o * 3] = x; pos[o * 3 + 1] = gy[o] + 0.45 + Math.max(h, -0.1) + (rw < hole ? 0.1 : 0); pos[o * 3 + 2] = z;
        // цвет: к центру темнее, по гребням светлее; край растворяется
        const toHole = 1 - smoothstep(hole * 0.9, rimR * 0.95, rw);
        const dark = 1 - (0.78 - 0.35 * crater) * Math.pow(toHole, 0.8) * k;
        const lit = 1 + 0.12 * ridge * band * k;
        const spice = 0.5 * crater * (1 - smoothstep(hole * 0.4, hole * 2.2, rw));
        col[o * 4] = Math.min(1.4, dark * lit * (1 + 0.18 * spice)); col[o * 4 + 1] = dark * lit * (1 - 0.12 * spice); col[o * 4 + 2] = dark * lit * (1 - 0.35 * spice - (rw < hole ? 0.25 * k : 0));
        col[o * 4 + 3] = k * (1 - smoothstep(R * 0.8, R * 1.0, rw)) * smoothstep(0.0, 6, rw + 6) * (cut > 0 ? smoothstep(cut, cut + 5, rw) : 1);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.mesh.visible = k > 0.01;
  }
}
