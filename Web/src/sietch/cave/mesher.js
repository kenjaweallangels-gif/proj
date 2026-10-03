// Surface nets (разреженный, по блокам) для SDF-поля пещеры. Работает в Node при запекании.
// field(x,y,z) < 0 — воздух. Результат: позиции (с проекцией на поверхность), нормали (градиент SDF, смотрят в пустоту), индексы треугольников.

/**
 * @param {(x:number,y:number,z:number)=>number} sdf
 * @param {{min:number[], max:number[]}} bounds
 * @param {number} h размер ячейки
 * @param {(cx:number,cy:number,cz:number,half:number)=>boolean} blockActive быстрый тест блока (центр, полудиагональ)
 */
export function surfaceNets(sdf, bounds, h, blockActive, log = () => {}) {
  const ox = bounds.min[0], oy = bounds.min[1], oz = bounds.min[2];
  const nx = Math.ceil((bounds.max[0] - ox) / h), ny = Math.ceil((bounds.max[1] - oy) / h), nz = Math.ceil((bounds.max[2] - oz) / h);
  const SX = nx + 1, SY = ny + 1, SZ = nz + 1;
  const NV = SX * SY * SZ;
  const val = new Float32Array(NV).fill(NaN);
  const cid = new Int32Array(nx * ny * nz).fill(-1);
  const BS = 8;
  const bx = Math.ceil(nx / BS), by = Math.ceil(ny / BS), bz = Math.ceil(nz / BS);
  const cornerIdx = (i, j, k) => (k * SY + j) * SX + i;
  const getV = (i, j, k) => {
    const id = cornerIdx(i, j, k);
    let v = val[id];
    if (v !== v) { v = sdf(ox + i * h, oy + j * h, oz + k * h); val[id] = v; }
    return v;
  };
  const verts = []; // x,y,z
  const cellOf = []; // i,j,k
  let nActive = 0;
  const half = BS * h * 0.87;
  for (let kb = 0; kb < bz; kb++) for (let jb = 0; jb < by; jb++) for (let ib = 0; ib < bx; ib++) {
    const cx = ox + (ib + 0.5) * BS * h, cy = oy + (jb + 0.5) * BS * h, cz = oz + (kb + 0.5) * BS * h;
    if (!blockActive(cx, cy, cz, half)) continue;
    nActive++;
    const i1 = Math.min(nx, (ib + 1) * BS), j1 = Math.min(ny, (jb + 1) * BS), k1 = Math.min(nz, (kb + 1) * BS);
    for (let k = kb * BS; k < k1; k++) for (let j = jb * BS; j < j1; j++) for (let i = ib * BS; i < i1; i++) {
      // 8 углов ячейки
      let mask = 0;
      for (let c = 0; c < 8; c++) { const v = getV(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1)); if (v < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      // среднее пересечений рёбер
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (let e = 0; e < 12; e++) {
        const a = EDGE_A[e], b = EDGE_B[e];
        const va = getV(i + (a & 1), j + ((a >> 1) & 1), k + ((a >> 2) & 1)), vb = getV(i + (b & 1), j + ((b >> 1) & 1), k + ((b >> 2) & 1));
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
        cnt++;
      }
      const id = verts.length / 3;
      cid[(k * ny + j) * nx + i] = id;
      verts.push(ox + (i + sx / cnt) * h, oy + (j + sy / cnt) * h, oz + (k + sz / cnt) * h);
      cellOf.push(i, j, k);
    }
  }
  log(`mesher: grid ${nx}x${ny}x${nz}, active blocks ${nActive}, verts ${verts.length / 3}`);
  // квадры по рёбрам, где меняется знак
  const idx = [];
  const C = (i, j, k) => cid[(k * ny + j) * nx + i];
  const emit = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  };
  for (let id = 0; id < verts.length / 3; id++) {
    const i = cellOf[id * 3], j = cellOf[id * 3 + 1], k = cellOf[id * 3 + 2];
    // рёбра, выходящие из min-угла ячейки (i,j,k): по x, y, z
    const v0 = val[cornerIdx(i, j, k)];
    if (j > 0 && k > 0) { const v1 = val[cornerIdx(i + 1, j, k)]; if (v1 === v1 && (v0 < 0) !== (v1 < 0)) emit(C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j, k), C(i, j - 1, k), v0 < 0); }
    if (i > 0 && k > 0) { const v1 = val[cornerIdx(i, j + 1, k)]; if (v1 === v1 && (v0 < 0) !== (v1 < 0)) emit(C(i - 1, j, k - 1), C(i - 1, j, k), C(i, j, k), C(i, j, k - 1), v0 < 0); }
    if (i > 0 && j > 0) { const v1 = val[cornerIdx(i, j, k + 1)]; if (v1 === v1 && (v0 < 0) !== (v1 < 0)) emit(C(i - 1, j - 1, k), C(i, j - 1, k), C(i, j, k), C(i - 1, j, k), v0 < 0); }
  }
  // проекция вершин на поверхность + нормали
  const P = new Float32Array(verts), N = new Float32Array(verts.length);
  const e = 0.06;
  for (let v = 0; v < P.length / 3; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const x0 = x, y0 = y, z0 = z;
    for (let it = 0; it < 2; it++) {
      const d = sdf(x, y, z);
      const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) / (2 * e) || 1;
      const s = d / (gl * gl) / (2 * e);
      let mx = gx * s, my = gy * s, mz = gz * s;
      const ml = Math.hypot(mx, my, mz), lim = h * 0.6;
      if (ml > lim) { mx *= lim / ml; my *= lim / ml; mz *= lim / ml; }
      x -= mx; y -= my; z -= mz;
    }
    if (Math.hypot(x - x0, y - y0, z - z0) > h * 0.9) { x = x0; y = y0; z = z0; }
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    N[v * 3] = -gx / gl; N[v * 3 + 1] = -gy / gl; N[v * 3 + 2] = -gz / gl; // в сторону воздуха
  }
  // ориентация треугольников по нормали: каждый треугольник сверяем с усреднённой нормалью вершин
  const I = new Uint32Array(idx);
  let flipped = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx2 = uy * vz - uz * vy, ny2 = uz * vx - ux * vz, nz2 = ux * vy - uy * vx;
    const dot = nx2 * (N[a * 3] + N[b * 3] + N[c * 3]) + ny2 * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + nz2 * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (dot < 0) { I[t + 1] = c; I[t + 2] = b; flipped++; }
  }
  const agree = I.length / 3 - flipped, dis = flipped;
  log(`mesher: tris ${I.length / 3} (orientation agree ${agree} / disagree ${dis})`);
  return { positions: P, normals: N, indices: I, h };
}

// рёбра куба: пары индексов углов (бит0=x, бит1=y, бит2=z)
const EDGE_A = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3];
const EDGE_B = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
