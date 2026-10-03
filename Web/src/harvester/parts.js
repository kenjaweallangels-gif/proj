// Сборщик геометрии: набор примитивов с вершинными цветами и тегом материала → одна склеенная BufferGeometry.
// Теги (aTag): 0 — окрашенная обшивка, 1 — сталь/металл, 2 — резина/тёмные узлы, 3 — ржавый/битый металл, 4 — сигнальная полоса.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../core/util.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const AXIS = {
  y: new THREE.Matrix4(),
  x: new THREE.Matrix4().makeRotationZ(-Math.PI / 2),
  z: new THREE.Matrix4().makeRotationX(Math.PI / 2),
};
const BOX = new THREE.BoxGeometry(1, 1, 1);

export class Parts {
  constructor(seed = 1) { this.list = []; this.R = rng(seed); this.count = 0; }

  _push(geo, color, tag, jit, mat) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (mat) g.applyMatrix4(mat);
    g.deleteAttribute('uv');
    const n = g.getAttribute('position').count;
    _c.set(color);
    const k = 1 + (this.R() - 0.5) * 2 * jit;
    const col = new Float32Array(n * 3), tg = new Float32Array(n);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r * k; col[i * 3 + 1] = _c.g * k; col[i * 3 + 2] = _c.b * k; tg[i] = tag; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aTag', new THREE.BufferAttribute(tg, 1));
    this.list.push(g); this.count++;
  }

  /** Бокс с центром (cx,cy,cz), размерами (sx,sy,sz); o: {rx,ry,rz,jit} — вращение, разброс тона. */
  box(cx, cy, cz, sx, sy, sz, color, tag = 0, o = {}) {
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ'); _q.setFromEuler(_e);
    _m.compose(_p.set(cx, cy, cz), _q, _s.set(sx, sy, sz));
    this._push(BOX, color, tag, o.jit ?? 0.07, _m);
    return this;
  }
  /** Бокс по двум углам (x0..x1, y0..y1, z0..z1). */
  slab(x0, y0, z0, x1, y1, z1, color, tag = 0, o = {}) {
    return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), color, tag, o);
  }
  /** Цилиндр/конус: axis 'x'|'y'|'z'. */
  cyl(cx, cy, cz, rTop, rBot, h, color, tag = 0, o = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, o.seg || 16, 1, !!o.open);
    g.applyMatrix4(AXIS[o.axis || 'y']);
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ'); _q.setFromEuler(_e);
    _m.compose(_p.set(cx, cy, cz), _q, _s.set(1, 1, 1));
    this._push(g, color, tag, o.jit ?? 0.07, _m);
    g.dispose();
    return this;
  }
  /** Призма: контур pts [[x,y],...] в плоскости XY, выдавлен по Z на depth, центр по z=cz. */
  prism(pts, cz, depth, color, tag = 0, o = {}) {
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, steps: 1 });
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ'); _q.setFromEuler(_e);
    _m.compose(_p.set(o.ox || 0, o.oy || 0, cz - depth / 2 + (o.oz || 0)), _q, _s.set(1, 1, 1));
    this._push(g, color, tag, o.jit ?? 0.07, _m);
    g.dispose();
    return this;
  }
  torus(cx, cy, cz, R, r, arc, color, tag = 2, o = {}) {
    const g = new THREE.TorusGeometry(R, r, 6, 14, arc);
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'XYZ'); _q.setFromEuler(_e);
    _m.compose(_p.set(cx, cy, cz), _q, _s.set(1, 1, 1));
    this._push(g, color, tag, o.jit ?? 0.05, _m);
    g.dispose();
    return this;
  }
  merge(tx = 0, ty = 0, tz = 0) {
    if (!this.list.length) return new THREE.BufferGeometry();
    const g = mergeGeometries(this.list, false);
    if (tx || ty || tz) g.translate(tx, ty, tz);
    this.list.forEach((x) => x.dispose()); this.list = [];
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
