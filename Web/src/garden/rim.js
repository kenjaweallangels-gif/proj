// Каменная «чаша» высокой котловины: оболочка, заданная в полярных координатах вокруг центра сада C.
// Профиль каждой колонки (θ): ниже дна → отвесная стена со слоистыми полками (LEDGE_H) и вертикальной трещиноватостью →
// округлый гребень (45–105 м над дном) → крутой внешний склон до пустыни (подошва чуть утоплена в песок).
// Западная часть оболочки лежит внутри «Когтя» (там котловина доходит до самой грани), эти квадраты отбрасываются (cull).
// Материал — тот же шейдер скалы, что у Когтя (createLevelRockMaterial): страты, триплапланарные текстуры, песок на полках.
// Снаружи оболочка читается как цельный скальный массив, прислонённый к восточной грани Когтя; внутрь ни с какой стороны виден лишь край гребня.
// Чистый JS (без THREE): работает и в node (тесты).
import { noise3, fbm3, smooth, mix, clamp } from '../level/sdf.js';
import { C, FLOOR_Y, ringIn, ringH, LEDGE_H, WALL_LEAN, ledgeDepth, owlLedge, floorHeight } from './layout.js';
import { rng } from '../core/util.js';

const TAU = Math.PI * 2;

/** Ряды профиля: h — «опорная» высота при H = 110 (отрицательные — абсолютные), cum — сколько полок уже пройдено, noQuad — не соединять со следующим рядом. */
function innerRows() {
  const rows = [];
  const push = (h, cum, noQuad = false) => rows.push({ h, cum, noQuad });
  const seg = (a, b, cum) => { const n = Math.max(1, Math.round((b - a) / (0.7 + 0.05 * Math.max(a, 0)))); for (let i = 1; i <= n; i++) push(a + ((b - a) * i) / n, cum); };
  push(-3, 0);
  let prev = -3;
  for (let k = 0; k < LEDGE_H.length; k++) {
    const e = LEDGE_H[k];
    seg(prev, e - 0.001, k);                 // стена до полки (последний ряд — нижняя кромка полки)
    rows[rows.length - 1].noQuad = true;     // разрыв нормалей: низ полки не сглаживается с площадкой
    push(e, k, false);                       // начало площадки (то же положение)
    push(e + 0.12, k + 1, true);             // конец площадки (вынос наружу на глубину полки)
    push(e + 0.12, k + 1, false);            // начало стены над полкой (то же положение)
    prev = e + 0.12;
  }
  seg(prev, 110, LEDGE_H.length);
  return rows;
}

export function createRim({ faceX, desertAt, quality = 'med' }) {
  const NT = quality === 'low' ? 360 : quality === 'high' ? 720 : 540;
  const NO = quality === 'low' ? 18 : 26;             // рядов внешнего склона
  const IR = innerRows();
  const nIn = IR.length;
  const nRows = nIn + 3 + NO + 1;                      // стена, гребень (3), склон, «юбка» под песком
  const LEAN = WALL_LEAN;                              // наклон стены наружу (м на м высоты)

  /** Шум скальной стены (м): крупные блоки, вертикальные трещины-«борозды»; у самого дна гасится. */
  const wallNoise = (x, y, z, hrel) => {
    const k = smooth(0.2, 5.5, hrel);
    return k * (0.95 * fbm3(x * 0.16, y * 0.2, z * 0.16, 3) + 0.32 * noise3(x * 0.95, y * 0.32, z * 0.95) + 0.1 * noise3(x * 2.6, y * 0.9, z * 2.6));
  };

  /** Профиль колонки θ: массивы r[], y[] по рядам (мир: расстояние от C и высота). Заполняет предоставленные буферы. */
  function column(th, rr, yy) {
    const cs = Math.cos(th), sn = Math.sin(th);
    const rin = ringIn(th), H = ringH(th);
    const fx = C.x + cs * (rin + 0.3), fz = C.z + sn * (rin + 0.3);
    const yb = floorHeight(fx, fz);                        // подножие стены (с осыпью)
    const dep = []; for (let k = 0; k < LEDGE_H.length; k++) dep.push(ledgeDepth(th, k));
    let rTop = 0, yTop = 0;
    for (let j = 0; j < nIn; j++) {
      const row = IR[j];
      const hrel = row.h > 0 ? (row.h * H) / 110 : row.h;
      let acc = 0; for (let k = 0; k < row.cum; k++) acc += dep[k];
      const r0 = rin + 0.3 + LEAN * Math.max(hrel, 0) + acc;
      const y = yb + hrel;
      const n = wallNoise(C.x + cs * r0, y, C.z + sn * r0, hrel);
      rr[j] = r0 + (n > 0 ? n : n * 0.35); yy[j] = y;     // внутрь стена «зарывается» слабо (проход игрока ограничен ringIn − 0.9)
      rTop = rr[j]; yTop = y;
    }
    // гребень: округлое плечо шириной ~5 м
    const rc = [rTop + 0.9, rTop + 2.8, rTop + 5.2], yc = [yTop + 0.5, yTop + 0.85, yTop + 0.35];
    for (let q = 0; q < 3; q++) { rr[nIn + q] = rc[q] + 0.5 * noise3(cs * 9 + q, yTop * 0.1, sn * 9); yy[nIn + q] = yc[q] + 0.4 * noise3(cs * 7, q, sn * 7); }
    // внешний склон: до пустыни (подошва утоплена на 2.5 м)
    const r5 = rr[nIn + 2], y5 = yy[nIn + 2];
    let foot = r5 + 0.28 * (y5 - 6), yF = 0;
    for (let it = 0; it < 3; it++) { yF = desertAt(C.x + cs * foot, C.z + sn * foot) - 2.5; foot = r5 + Math.max(10, 0.29 * (y5 - yF)); }
    const run = foot - r5;
    for (let m = 1; m <= NO; m++) {
      const t = m / NO;
      const e = 0.5 * t + 0.5 * Math.pow(t, 2.1);
      const px = C.x + cs * (r5 + run * e), pz = C.z + sn * (r5 + run * e), py = y5 + (yF - y5) * t;
      const bulge = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 3.2 * fbm3(px * 0.05, py * 0.06, pz * 0.05, 3) + 0.9 * Math.sin(Math.PI * t) * noise3(px * 0.35, py * 0.3, pz * 0.35);
      rr[nIn + 2 + m] = r5 + run * e + bulge; yy[nIn + 2 + m] = py;
    }
    rr[nRows - 1] = foot + 1.2; yy[nRows - 1] = yF - 3;
    return { rin, H, yb, foot };
  }

  const bufR = new Float64Array(nRows), bufY = new Float64Array(nRows);
  const feet = new Float32Array(NT);                    // радиус подошвы внешнего склона по θ_i
  /** Меш: {position, normal, mark, index}. cull(x,y,z) → true, если вершина лежит внутри Когтя. */
  function build() {
    const P = new Float32Array(nRows * NT * 3);
    const isIn = new Uint8Array(nRows * NT);
    for (let i = 0; i < NT; i++) {
      const th = (i / NT) * TAU - Math.PI, cs = Math.cos(th), sn = Math.sin(th);
      const col = column(th, bufR, bufY);
      feet[i] = col.foot;
      for (let j = 0; j < nRows; j++) {
        const o = (j * NT + i) * 3;
        const x = C.x + cs * bufR[j], z = C.z + sn * bufR[j];
        P[o] = x; P[o + 1] = bufY[j]; P[o + 2] = z;
        if (z > 324 && z < 468 && bufY[j] < 148) isIn[j * NT + i] = x < faceX(z, Math.max(bufY[j], 4)) - 1.2 ? 1 : 0;
      }
    }
    // индексы: пропускаем квады между дублирующими рядами (noQuad) и целиком внутри Когтя
    const idx = [];
    const rowNo = (j) => (j < nIn ? IR[j].noQuad : false);
    for (let j = 0; j < nRows - 1; j++) {
      if (rowNo(j)) continue;
      for (let i = 0; i < NT; i++) {
        const i1 = (i + 1) % NT;
        const a = j * NT + i, b = j * NT + i1, c = (j + 1) * NT + i1, d = (j + 1) * NT + i;
        if (isIn[a] && isIn[b] && isIn[c] && isIn[d]) continue;
        idx.push(a, b, c, a, c, d);
      }
    }
    const N = new Float32Array(nRows * NT * 3);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const o of [a, b, c]) { N[o] += nx; N[o + 1] += ny; N[o + 2] += nz; }
    }
    for (let o = 0; o < N.length; o += 3) { const l = Math.hypot(N[o], N[o + 1], N[o + 2]) || 1; N[o] /= l; N[o + 1] /= l; N[o + 2] /= l; }
    // отметки для материала скалы: x — протоптанность (0), y — наносы песка: площадки полок и пологие участки, у дна
    const mark = new Float32Array(nRows * NT * 2);
    for (let v = 0; v < nRows * NT; v++) {
      const ny = N[v * 3 + 1], yv = P[v * 3 + 1];
      mark[v * 2 + 1] = clamp(0.3 * smooth(0.72, 1, ny) + 0.18 * (1 - smooth(0, 4, yv - FLOOR_Y)), 0, 0.5);
    }
    return { position: P, normal: N, mark, index: new Uint32Array(idx), NT, nRows };
  }

  // ---------- точки на стене (лишайники, присады птиц) ----------
  const tmpR = new Float64Array(nRows), tmpY = new Float64Array(nRows);
  /** Точка на внутренней стене в направлении θ на высоте hRel над подножием (≤ H): {x,y,z,nx,nz}; нормаль — внутрь котловины. */
  function wallPoint(th, hRel) {
    const col = column(th, tmpR, tmpY);
    const y = col.yb + hRel;
    let r = tmpR[0];
    for (let j = 0; j < nIn - 1; j++) {
      if (IR[j].noQuad) continue;
      if (tmpY[j] <= y && tmpY[j + 1] >= y) { const t = (y - tmpY[j]) / Math.max(1e-6, tmpY[j + 1] - tmpY[j]); r = mix(tmpR[j], tmpR[j + 1], t); break; }
    }
    const cs = Math.cos(th), sn = Math.sin(th);
    return { x: C.x + cs * r, y, z: C.z + sn * r, nx: -cs, nz: -sn, th };
  }
  /** Площадки-полки для присад: n точек {x,y,z,th,k} на глубине полки (случайно, но детерминированно). */
  function ledgePerches(n, seed = 91) {
    const R = rng(seed), out = [];
    for (let tries = 0; out.length < n && tries < n * 30; tries++) {
      const th = R() * TAU - Math.PI, k = 1 + ((R() * 6) | 0);
      const d = ledgeDepth(th, k); if (d < 0.9) continue;
      const col = column(th, tmpR, tmpY);
      let a = -1; for (let q = 0; q < nIn - 1; q++) if (IR[q].cum === k && !IR[q].noQuad && IR[q + 1].cum === k + 1) { a = q; break; }
      if (a < 0) continue;
      const r = mix(tmpR[a], tmpR[a + 1], 0.6), cs = Math.cos(th), sn = Math.sin(th);
      out.push({ x: C.x + cs * r, y: tmpY[a] + 0.04, z: C.z + sn * r, th, k, H: col.H });
    }
    return out;
  }

  return { NT, nRows, build, wallPoint, ledgePerches, ledge: owlLedge(), footR: (th) => {
    const q = ((((th + Math.PI) / TAU) % 1) + 1) % 1 * NT; const i = Math.floor(q) % NT, i1 = (i + 1) % NT, u = q - Math.floor(q);
    return feet[i] * (1 - u) + feet[i1] * u;
  }, feet, column };
}
