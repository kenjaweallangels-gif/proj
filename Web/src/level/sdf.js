// SDF-кит для скульптурной скалы: 3D-шум, регулярная сетка расстояний, поверхностные сети (surface nets),
// выборка с триллинейной интерполяцией, «колонки» ходимых поверхностей (heightAt) и выталкивание тела (collide).
// Чистый JS без THREE: работает и в браузере, и в node (для тестов раскладки).

// ---------- шум ----------
function hash3(ix, iy, iz) {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
/** Значение-шум 3D в диапазоне ≈ [-1, 1]. */
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fade(fx), v = fade(fy), w = fade(fz);
  const a = hash3(ix, iy, iz), b = hash3(ix + 1, iy, iz), c = hash3(ix, iy + 1, iz), d = hash3(ix + 1, iy + 1, iz);
  const e = hash3(ix, iy, iz + 1), f = hash3(ix + 1, iy, iz + 1), g = hash3(ix, iy + 1, iz + 1), h = hash3(ix + 1, iy + 1, iz + 1);
  const x1 = a + (b - a) * u, x2 = c + (d - c) * u, x3 = e + (f - e) * u, x4 = g + (h - g) * u;
  const y1 = x1 + (x2 - x1) * v, y2 = x3 + (x4 - x3) * v;
  return y1 + (y2 - y1) * w;
}
export function fbm3(x, y, z, oct = 3) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); a *= 0.5; f *= 2.03; x += 17.1; }
  return s;
}

// ---------- примитивы (расстояния приблизительные, но с градиентом ≈ 1) ----------
export const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const smax = (a, b, k) => -smin(-a, -b, k);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;

/** Эллипсоид (приближённая метрика). */
export function sdEllipsoid(px, py, pz, rx, ry, rz) {
  const k0 = Math.hypot(px / rx, py / ry, pz / rz);
  const k1 = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
/** Бокс с полуразмерами (hx,hy,hz) и скруглением r. */
export function sdBox(px, py, pz, hx, hy, hz, r = 0) {
  const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r, qz = Math.abs(pz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
/** Расстояние до отрезка в 2D (xz); возвращает {d, t}. */
export function segDist2(px, pz, ax, az, bx, bz, out) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t, cz = az + dz * t;
  out.d = Math.hypot(px - cx, pz - cz); out.t = t;
  return out;
}

// ---------- сетка ----------
export class Volume {
  /** min — мировой угол, n — число узлов по осям, h — шаг (м). */
  constructor(min, n, h) {
    this.x0 = min[0]; this.y0 = min[1]; this.z0 = min[2];
    this.nx = n[0]; this.ny = n[1]; this.nz = n[2]; this.h = h;
    this.d = new Float32Array(this.nx * this.ny * this.nz);
    this.sy = this.nx; this.sz = this.nx * this.ny; // шаги индекса: i + nx*(j + ny*k)
    this.cols = null;
  }
  idx(i, j, k) { return i + this.nx * (j + this.ny * k); }
  inside(x, y, z, m = 0) {
    return x >= this.x0 + m && x <= this.x0 + (this.nx - 1) * this.h - m && y >= this.y0 + m && y <= this.y0 + (this.ny - 1) * this.h - m && z >= this.z0 + m && z <= this.z0 + (this.nz - 1) * this.h - m;
  }
  inZone(x, z, m = 0) {
    return x >= this.x0 + m && x <= this.x0 + (this.nx - 1) * this.h - m && z >= this.z0 + m && z <= this.z0 + (this.nz - 1) * this.h - m;
  }
  /**
   * Заполнение: cheap(x,y,z) — дешёвая оценка, full — полная (с шумом). Блоки B³ вдали от поверхности (|cheap| > радиус блока + margin)
   * заполняются константой.
   */
  fill(cheap, full, B = 8, margin = 2.2) {
    const { nx, ny, nz, h, d } = this;
    const R = B * h * 0.87 + margin;
    for (let bk = 0; bk < nz; bk += B) for (let bj = 0; bj < ny; bj += B) for (let bi = 0; bi < nx; bi += B) {
      const ci = Math.min(bi + B / 2, nx - 1), cj = Math.min(bj + B / 2, ny - 1), ck = Math.min(bk + B / 2, nz - 1);
      const c = cheap(this.x0 + ci * h, this.y0 + cj * h, this.z0 + ck * h);
      const ei = Math.min(bi + B, nx), ej = Math.min(bj + B, ny), ek = Math.min(bk + B, nz);
      if (Math.abs(c) > R) {
        const v = c > 0 ? R : -R;
        for (let k = bk; k < ek; k++) for (let j = bj; j < ej; j++) { let o = this.idx(bi, j, k); for (let i = bi; i < ei; i++) d[o++] = v; }
      } else {
        for (let k = bk; k < ek; k++) for (let j = bj; j < ej; j++) {
          let o = this.idx(bi, j, k);
          const z = this.z0 + k * h, y = this.y0 + j * h;
          for (let i = bi; i < ei; i++) d[o++] = full(this.x0 + i * h, y, z);
        }
      }
    }
  }
  /** Триллинейная выборка. За пределами — большое положительное значение (воздух). */
  sample(x, y, z) {
    const h = this.h;
    let fx = (x - this.x0) / h, fy = (y - this.y0) / h, fz = (z - this.z0) / h;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= this.nx - 1 || fy >= this.ny - 1 || fz >= this.nz - 1) return 8;
    const i = fx | 0, j = fy | 0, k = fz | 0;
    fx -= i; fy -= j; fz -= k;
    const d = this.d, o = i + this.nx * (j + this.ny * k), sy = this.sy, sz = this.sz;
    const c00 = d[o] + (d[o + 1] - d[o]) * fx, c10 = d[o + sy] + (d[o + sy + 1] - d[o + sy]) * fx;
    const c01 = d[o + sz] + (d[o + sz + 1] - d[o + sz]) * fx, c11 = d[o + sz + sy] + (d[o + sz + sy + 1] - d[o + sz + sy]) * fx;
    const a = c00 + (c10 - c00) * fy, b = c01 + (c11 - c01) * fy;
    return a + (b - a) * fz;
  }
  /** Градиент (в out[0..2]). */
  grad(x, y, z, out, e = this.h * 0.75) {
    out[0] = this.sample(x + e, y, z) - this.sample(x - e, y, z);
    out[1] = this.sample(x, y + e, z) - this.sample(x, y - e, z);
    out[2] = this.sample(x, y, z + e) - this.sample(x, y, z - e);
    const l = Math.hypot(out[0], out[1], out[2]) || 1;
    out[0] /= l; out[1] /= l; out[2] /= l;
    return out;
  }

  // ---------- колонки ходимых поверхностей ----------
  buildColumns(maxPer = 4) {
    const { nx, ny, nz, h, d } = this;
    this.maxPer = maxPer;
    this.colN = new Uint8Array(nx * nz);
    this.colY = new Float32Array(nx * nz * maxPer);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const ci = i + nx * k;
      let n = 0;
      for (let j = ny - 2; j >= 0; j--) {
        const a = d[i + nx * (j + ny * k)], b = d[i + nx * (j + 1 + ny * k)];
        if (a < 0 && b >= 0) {
          const y = this.y0 + (j + a / (a - b)) * h;
          if (n < maxPer) this.colY[ci * maxPer + n++] = y;
        }
      }
      this.colN[ci] = n;
    }
    this.cols = true;
  }
  /** Лучшая поверхность колонки (i,k) не выше yMax (или самая верхняя). -Infinity, если нет. */
  colPick(i, k, yMax) {
    const ci = i + this.nx * k, n = this.colN[ci];
    for (let q = 0; q < n; q++) {
      const y = this.colY[ci * this.maxPer + q];
      if (y <= yMax) return y;
    }
    return n ? (yMax === Infinity ? this.colY[ci * this.maxPer] : -Infinity) : -Infinity;
  }
  /**
   * Высота ходимой поверхности в (x,z): выше всех ≤ yFeet+stepUp; если yFeet не задан — самая верхняя.
   * Возвращает NaN, если в колонке нет поверхности.
   */
  surfaceY(x, z, yFeet, stepUp = 1.1) {
    const h = this.h;
    const fx = (x - this.x0) / h, fz = (z - this.z0) / h;
    if (fx < 0 || fz < 0 || fx >= this.nx - 1 || fz >= this.nz - 1) return NaN;
    const i = fx | 0, k = fz | 0, u = fx - i, v = fz - k;
    const yMax = yFeet === undefined || yFeet === null ? Infinity : yFeet + stepUp;
    const p00 = this.colPick(i, k, yMax), p10 = this.colPick(i + 1, k, yMax), p01 = this.colPick(i, k + 1, yMax), p11 = this.colPick(i + 1, k + 1, yMax);
    const lo = Math.min(p00, p10, p01, p11), hi = Math.max(p00, p10, p01, p11);
    if (lo === -Infinity) {
      // хотя бы в одной колонке нет поверхности: берём ближайшую
      const near = [[p00, 0, 0], [p10, 1, 0], [p01, 0, 1], [p11, 1, 1]].filter((q) => q[0] > -Infinity).sort((a, b) => Math.hypot(a[1] - u, a[2] - v) - Math.hypot(b[1] - u, b[2] - v))[0];
      return near ? near[0] : NaN;
    }
    if (hi - lo > 0.9) {
      const e = [[p00, 0, 0], [p10, 1, 0], [p01, 0, 1], [p11, 1, 1]].sort((a, b) => Math.hypot(a[1] - u, a[2] - v) - Math.hypot(b[1] - u, b[2] - v))[0];
      return e[0];
    }
    return (p00 * (1 - u) + p10 * u) * (1 - v) + (p01 * (1 - u) + p11 * u) * v;
  }

  /**
   * Вытолкнуть цилиндр (pos — ступни, r) из твёрдого. Проверка на высотах hs над ступнями. Возвращает true при контакте.
   */
  collide(pos, r, hs = [0.75, 1.25, 1.75]) {
    let hit = false;
    const g = [0, 0, 0];
    for (let it = 0; it < 2; it++) {
      let any = false;
      for (const k of hs) {
        const d = this.sample(pos.x, pos.y + k, pos.z);
        if (d >= r) continue;
        this.grad(pos.x, pos.y + k, pos.z, g);
        const gh = Math.hypot(g[0], g[2]);
        if (gh < 0.25) continue; // потолок/пол — горизонтально не выталкиваем
        const push = (r - d) / gh;
        const pm = Math.min(push, 0.6);
        pos.x += (g[0] / gh) * pm * gh; pos.z += (g[2] / gh) * pm * gh;
        any = true; hit = true;
      }
      if (!any) break;
    }
    return hit;
  }

  // ---------- поверхностные сети ----------
  /**
   * opts.cull(x0,y0,z0,x1,y1,z1,x2,y2,z2, nx,ny,nz) → true — пропустить треугольник.
   * opts.mark(x,y,z,nx,ny,nz,out) → записать два числа в out (атрибут aMark).
   */
  mesh(opts = {}) {
    const { nx, ny, nz, h, d } = this;
    const cvert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
    const pos = [], nor = [];
    const sy = this.sy, sz = this.sz;
    const cx = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
    const corner = new Float32Array(8);
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const offs = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const g = [0, 0, 0];
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const o = i + nx * j + sz * k;
      let mask = 0;
      corner[0] = d[o]; corner[1] = d[o + 1]; corner[2] = d[o + sy]; corner[3] = d[o + sy + 1];
      corner[4] = d[o + sz]; corner[5] = d[o + sz + 1]; corner[6] = d[o + sz + sy]; corner[7] = d[o + sz + sy + 1];
      for (let c = 0; c < 8; c++) if (corner[c] < 0) mask |= 1 << c;
      if (mask === 0 || mask === 255) continue;
      let sx = 0, syy = 0, szz = 0, cnt = 0;
      for (let e = 0; e < 12; e++) {
        const a = E[e][0], b = E[e][1];
        const va = corner[a], vb = corner[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        sx += offs[a][0] + (offs[b][0] - offs[a][0]) * t;
        syy += offs[a][1] + (offs[b][1] - offs[a][1]) * t;
        szz += offs[a][2] + (offs[b][2] - offs[a][2]) * t;
        cnt++;
      }
      const px = this.x0 + (i + sx / cnt) * h, py = this.y0 + (j + syy / cnt) * h, pz = this.z0 + (k + szz / cnt) * h;
      cvert[cx(i, j, k)] = pos.length / 3;
      pos.push(px, py, pz);
      this.grad(px, py, pz, g);
      nor.push(g[0], g[1], g[2]);
    }
    const idx = [];
    const P = pos;
    const emit = (a, b, c, d2, flip) => {
      // два треугольника, при flip меняем порядок
      const tri = (p, q, r) => {
        if (opts.cull && opts.cull(P[p * 3], P[p * 3 + 1], P[p * 3 + 2], P[q * 3], P[q * 3 + 1], P[q * 3 + 2], P[r * 3], P[r * 3 + 1], P[r * 3 + 2], nor[p * 3], nor[p * 3 + 1], nor[p * 3 + 2])) return;
        // ориентация по градиенту SDF: геометрическая нормаль должна смотреть в воздух
        const ux = P[q * 3] - P[p * 3], uy = P[q * 3 + 1] - P[p * 3 + 1], uz = P[q * 3 + 2] - P[p * 3 + 2];
        const vx = P[r * 3] - P[p * 3], vy = P[r * 3 + 1] - P[p * 3 + 1], vz = P[r * 3 + 2] - P[p * 3 + 2];
        const nxg = uy * vz - uz * vy, nyg = uz * vx - ux * vz, nzg = ux * vy - uy * vx;
        const dt = nxg * (nor[p * 3] + nor[q * 3] + nor[r * 3]) + nyg * (nor[p * 3 + 1] + nor[q * 3 + 1] + nor[r * 3 + 1]) + nzg * (nor[p * 3 + 2] + nor[q * 3 + 2] + nor[r * 3 + 2]);
        if (dt >= 0) idx.push(p, q, r); else idx.push(p, r, q);
      };
      // диагональ — по более короткой
      const dx1 = P[a * 3] - P[d2 * 3], dy1 = P[a * 3 + 1] - P[d2 * 3 + 1], dz1 = P[a * 3 + 2] - P[d2 * 3 + 2];
      const dx2 = P[b * 3] - P[c * 3], dy2 = P[b * 3 + 1] - P[c * 3 + 1], dz2 = P[b * 3 + 2] - P[c * 3 + 2];
      if (dx1 * dx1 + dy1 * dy1 + dz1 * dz1 <= dx2 * dx2 + dy2 * dy2 + dz2 * dz2) {
        if (flip) { tri(a, c, b); tri(a, d2, c); } else { tri(a, b, c); tri(a, c, d2); }
      } else if (flip) { tri(a, d2, b); tri(b, d2, c); } else { tri(a, b, d2); tri(b, c, d2); }
    };
    // квады на рёбрах сетки
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const o = i + nx * j + sz * k;
      const s0 = d[o] < 0;
      // ребро вдоль +x: (i,j,k)-(i+1,j,k)
      if (i < nx - 1) {
        const s1 = d[o + 1] < 0;
        if (s0 !== s1) {
          const a = cvert[cx(i, j - 1, k - 1)], b = cvert[cx(i, j, k - 1)], c = cvert[cx(i, j - 1, k)], dd = cvert[cx(i, j, k)];
          if (a >= 0 && b >= 0 && c >= 0 && dd >= 0) emit(a, b, dd, c, !s0 ? false : true);
        }
      }
      if (j < ny - 1) {
        const s1 = d[o + sy] < 0;
        if (s0 !== s1) {
          const a = cvert[cx(i - 1, j, k - 1)], b = cvert[cx(i, j, k - 1)], c = cvert[cx(i - 1, j, k)], dd = cvert[cx(i, j, k)];
          if (a >= 0 && b >= 0 && c >= 0 && dd >= 0) emit(a, c, dd, b, !s0 ? false : true);
        }
      }
      if (k < nz - 1) {
        const s1 = d[o + sz] < 0;
        if (s0 !== s1) {
          const a = cvert[cx(i - 1, j - 1, k)], b = cvert[cx(i, j - 1, k)], c = cvert[cx(i - 1, j, k)], dd = cvert[cx(i, j, k)];
          if (a >= 0 && b >= 0 && c >= 0 && dd >= 0) emit(a, b, dd, c, !s0 ? false : true);
        }
      }
    }
    // сжать неиспользуемые вершины
    const remap = new Int32Array(pos.length / 3).fill(-1);
    const outP = [], outN = [], outM = [];
    const mk = [0, 0];
    const outI = new Uint32Array(idx.length);
    let nv = 0;
    for (let q = 0; q < idx.length; q++) {
      const v = idx[q];
      if (remap[v] < 0) {
        remap[v] = nv++;
        outP.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        outN.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
        if (opts.mark) { opts.mark(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2], mk); outM.push(mk[0], mk[1]); }
      }
      outI[q] = remap[v];
    }
    return { position: new Float32Array(outP), normal: new Float32Array(outN), mark: opts.mark ? new Float32Array(outM) : null, index: outI };
  }
}
