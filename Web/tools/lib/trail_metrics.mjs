// Метрики тропы к щели: визуальная высота (треугольники мешей подхода и Когтя) против heightAt, дыры, рёбра-«щели», уклон, ширина, глаза в камне.
// analyze(ctx) — самодостаточная функция (без импортов): в браузере передаётся в page.evaluate через toString(), в node вызывается напрямую.
// ctx: { trail:[{x,y,z,s}], zone, meshes:[{pos,idx,tag}], heightAt(x,z,yFeet), sampleSolid(x,y,z), baseAt(x,z), wallAt(z,y), wallIn, notchX }
//  mismatch — |видимая поверхность (самая высокая грань ≤ ступни+1.1) − heightAt| > 0.15 м;
//  hole — нет ни одной грани в [H−6, H+1.1] и это не равнина (рисует террейн);
//  openEdges — рёбра сетки подхода с одним треугольником вне швов (земля пустыни, плоскость стены, вход) вблизи тропы;
//  eyeInSolid — глаза (H+1.6) внутри твёрдого; maxGrade — макс. уклон heightAt на 1 м; width — ширина проходимой полосы (уклон бокового профиля < ~50°).
export function analyze(ctx) {
  const { trail: T, zone: Z, heightAt: heightAtF, baseAt: base } = ctx;
  const CELL = 2, gx = Math.ceil((Z.x1 - Z.x0) / CELL) + 1, gz = Math.ceil((Z.z1 - Z.z0) / CELL) + 1;
  const cells = Array.from({ length: gx * gz }, () => []);
  const tris = [];
  for (const m of ctx.meshes) {
    const P = m.pos, I = m.idx, n = I.length / 3;
    for (let t = 0; t < n; t++) {
      const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
      const x0 = P[a * 3], y0 = P[a * 3 + 1], z0 = P[a * 3 + 2], x1 = P[b * 3], y1 = P[b * 3 + 1], z1 = P[b * 3 + 2], x2 = P[c * 3], y2 = P[c * 3 + 1], z2 = P[c * 3 + 2];
      const mnx = Math.min(x0, x1, x2), mxx = Math.max(x0, x1, x2), mnz = Math.min(z0, z1, z2), mxz = Math.max(z0, z1, z2);
      if (mxx < Z.x0 || mnx > Z.x1 || mxz < Z.z0 || mnz > Z.z1) continue;
      const id = tris.length; tris.push([x0, y0, z0, x1, y1, z1, x2, y2, z2, m.tag]);
      for (let k = Math.max(0, Math.floor((mnz - Z.z0) / CELL)); k <= Math.min(gz - 1, Math.floor((mxz - Z.z0) / CELL)); k++)
        for (let i = Math.max(0, Math.floor((mnx - Z.x0) / CELL)); i <= Math.min(gx - 1, Math.floor((mxx - Z.x0) / CELL)); i++) cells[i + gx * k].push(id);
    }
  }
  const buf = [];
  const hits = (x, z) => {
    buf.length = 0;
    const ci = Math.floor((x - Z.x0) / CELL), ck = Math.floor((z - Z.z0) / CELL);
    if (ci < 0 || ck < 0 || ci >= gx || ck >= gz) return buf;
    for (const id of cells[ci + gx * ck]) {
      const t = tris[id];
      const ax = t[0], az = t[2], bx = t[3], bz = t[5], cx = t[6], cz = t[8];
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den, w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      buf.push(u * t[1] + v * t[4] + w * t[7]);
    }
    return buf;
  };
  const R = { samples: 0, mismatch: 0, hole: 0, eye: 0, maxGrade: 0, minWidth: 99, bad: [], holePts: [], big: 0, eyePts: [], steep: [], narrow: [] };
  const dAbs = [], widths = [];
  const sampleAt = (x, z, yF, s) => {
    const H = heightAtF(x, z, yF);
    if (ctx.sampleSolid(x, H + 0.35, z) < 0) { R.skipped = (R.skipped || 0) + 1; return; }   // точка внутри твёрдого (откос/плавник): не поверхность ходьбы
    hits(x, z);
    let vis = -1e9, any = false;
    for (const y of buf) { if (y >= H - 6 && y <= H + 12) any = true; if (y <= H + 1.1 && y > vis) vis = y; }
    R.samples++;
    if (!any) {                                           // в колонке нет ни одной грани: сквозная дыра (кроме равнины — её рисует террейн)
      if (!(Math.abs(H - base(x, z)) < 0.35)) { R.hole++; R.holePts.push([+x.toFixed(1), +H.toFixed(1), +z.toFixed(1), +s.toFixed(0)]); if (R.bad.length < 30) R.bad.push({ k: 'hole', x: +x.toFixed(1), z: +z.toFixed(1), H: +H.toFixed(2), s: +s.toFixed(0) }); }
      return;
    }
    if (vis < H - 6) return;                              // откос выше ступни+1.1 (стена): heightAt берёт соседнюю колонку, не дыра
    if (Math.abs(H - base(x, z)) < 0.2 && vis < H - 0.15) return;
    const d = H - vis;
    dAbs.push(Math.abs(d));
    if (Math.abs(d) > 0.35) R.big++;
    if (Math.abs(d) > 0.15) { R.mismatch++; if (R.bad.length < 30) R.bad.push({ k: 'mis', x: +x.toFixed(1), z: +z.toFixed(1), H: +H.toFixed(2), vis: +vis.toFixed(2), s: +s.toFixed(0) }); }
  };
  const gradeBySeg = [];
  for (let i = 0; i < T.length; i++) {
    const p = T[i], q = T[Math.min(T.length - 1, i + 1)], o = T[Math.max(0, i - 1)];
    let tx = q.x - o.x, tz = q.z - o.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    for (const lat of ctx.lat || [-0.7, 0, 0.7]) sampleAt(p.x + nx * lat, p.z + nz * lat, p.y, p.s);
    const H0 = heightAtF(p.x, p.z, p.y);
    if (ctx.sampleSolid(p.x, H0 + 1.6, p.z) < 0) { R.eye++; if (R.eyePts.length < 40) R.eyePts.push([+p.x.toFixed(1), +H0.toFixed(1), +p.z.toFixed(1), +p.s.toFixed(0)]); }
    const H1 = heightAtF(p.x + tx, p.z + tz, H0);
    const gr = Math.abs(Math.atan2(H1 - H0, 1)) * 180 / Math.PI;
    R.maxGrade = Math.max(R.maxGrade, gr); gradeBySeg.push(gr);
    if (gr > 30 && R.steep.length < 40) R.steep.push([+p.x.toFixed(1), +H0.toFixed(1), +p.z.toFixed(1), +p.s.toFixed(0), +gr.toFixed(0)]);
    if (i % 2 === 0) {
      const step = 0.2; let wL = 0, wR = 0;
      for (const sg of [-1, 1]) {
        let prev = H0, w = 0;
        for (let k = 1; k <= 20; k++) {
          const h = heightAtF(p.x + nx * sg * k * step, p.z + nz * sg * k * step, prev);
          if (!Number.isFinite(h) || Math.abs(h - prev) > step * 1.2) break;
          prev = h; w = k * step;
        }
        if (sg < 0) wL = w; else wR = w;
      }
      const wd = wL + wR; widths.push(wd); R.minWidth = Math.min(R.minWidth, wd);
      if (wd < 1.2 && R.narrow.length < 40) R.narrow.push([+p.x.toFixed(1), +H0.toFixed(1), +p.z.toFixed(1), +p.s.toFixed(0), +wd.toFixed(1)]);
    }
  }
  // рёбра с одним треугольником (только сетка подхода — meshes[0])
  const m0 = ctx.meshes[0], P = m0.pos, I = m0.idx;
  const ec = new Map();
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = I[t + e], b = I[t + (e + 1) % 3], k = a < b ? a * 4294967 + b : b * 4294967 + a;
    ec.set(k, (ec.get(k) || 0) + 1);
  }
  let open = 0, openNear = 0; const openPts = [];
  R.seam = 0; R.crack = 0; R.crackMax = 0; R.crackPts = [];
  const clawTris = ctx.meshes[1] ? tris.filter((t) => t[9] === 'c') : [];
  const zyMap = new Map();
  for (const t of clawTris) {
    const zmn = Math.min(t[2], t[5], t[8]), zmx = Math.max(t[2], t[5], t[8]), ymn = Math.min(t[1], t[4], t[7]), ymx = Math.max(t[1], t[4], t[7]);
    for (let a = Math.floor(zmn / 2); a <= Math.floor(zmx / 2); a++) for (let b = Math.floor(ymn / 2); b <= Math.floor(ymx / 2); b++) { const k = a * 4096 + b; let arr = zyMap.get(k); if (!arr) zyMap.set(k, arr = []); arr.push(t); }
  }
  const zyCand = (z, y) => zyMap.get(Math.floor(z / 2) * 4096 + Math.floor(y / 2)) || [];
  for (const [k, c] of ec) {
    if (c !== 1) continue;
    const b = k % 4294967, a = (k - b) / 4294967;
    const mx = (P[a * 3] + P[b * 3]) / 2, my = (P[a * 3 + 1] + P[b * 3 + 1]) / 2, mz = (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
    if (my < base(mx, mz) + 0.25) continue;                               // шов с землёй пустыни
    if (mx > ctx.notchX - 0.3) continue;                                   // вход в сиетч
    if (mz < Z.z0 + 1.2 || mz > Z.z1 - 1.2 || mx < Z.x0 + 1.2 || mx > Z.x1 - 1.2) continue; // край зоны
    const w = ctx.wallAt(mz, my) + ctx.wallIn;
    if (mx > w - 0.7) {                                                    // шов со стеной: меш подхода кончается у плоскости стены — проверяем, что она внутри Когтя
      if (mx > w + 1.2 || !ctx.meshes[1]) continue;
      let xh = null;                                                       // первый вдоль +x треугольник Когтя в (z,y)
      for (const t of zyCand(mz, my)) {
        const den = (t[4] - t[7]) * (t[2] - t[8]) + (t[8] - t[5]) * (t[1] - t[7]); if (Math.abs(den) < 1e-9) continue;
        const u = ((t[4] - t[7]) * (mz - t[8]) + (t[8] - t[5]) * (my - t[7])) / den, v = ((t[7] - t[1]) * (mz - t[8]) + (t[2] - t[8]) * (my - t[7])) / den, ww = 1 - u - v;
        if (u < 0 || v < 0 || ww < 0) continue;
        const x = u * t[0] + v * t[3] + ww * t[6];
        if (x > mx - 1.0 && (xh === null || x < xh)) xh = x;
      }
      if (xh === null) continue;
      let near2 = false;
      for (let i = 0; i < T.length; i += 4) if (Math.abs(T[i].x - mx) < 14 && Math.abs(T[i].z - mz) < 8 && Math.abs(T[i].y - my) < 14) { near2 = true; break; }
      if (!near2) continue;
      R.seam++; const gap = xh - mx; if (gap > 0.15) { R.crack++; R.crackMax = Math.max(R.crackMax, gap); if (R.crackPts.length < 10) R.crackPts.push([+mx.toFixed(1), +my.toFixed(1), +mz.toFixed(1), +gap.toFixed(2)]); }
      continue;
    }
    open++;
    let near = false;
    for (let i = 0; i < T.length; i += 4) if (Math.abs(T[i].x - mx) < 12 && Math.abs(T[i].z - mz) < 12 && Math.abs(T[i].y - my) < 12) { near = true; break; }
    if (near) { openNear++; if (openPts.length < 20) openPts.push([+mx.toFixed(1), +my.toFixed(1), +mz.toFixed(1)]); }
  }
  R.open = open; R.openNear = openNear; R.openPts = openPts;
  dAbs.sort((a, b) => a - b); widths.sort((a, b) => a - b); gradeBySeg.sort((a, b) => a - b);
  R.dMed = +(dAbs[dAbs.length >> 1] || 0).toFixed(3); R.dP95 = +(dAbs[Math.floor(dAbs.length * 0.95)] || 0).toFixed(3); R.dMax = +(dAbs[dAbs.length - 1] || 0).toFixed(3);
  R.wMed = +(widths[widths.length >> 1] || 0).toFixed(2); R.wP10 = +(widths[Math.floor(widths.length * 0.1)] || 0).toFixed(2);
  R.gradeP50 = +gradeBySeg[gradeBySeg.length >> 1].toFixed(1); R.gradeP95 = +gradeBySeg[Math.floor(gradeBySeg.length * 0.95)].toFixed(1);
  R.maxGrade = +R.maxGrade.toFixed(1); R.minWidth = +R.minWidth.toFixed(2);
  R.trailLen = +T[T.length - 1].s.toFixed(1); R.pts = T.length;
  return R;
}

export function printReport(R, label = '') {
  const f = (k) => R[k];
  console.log(`${label} samples=${f('samples')} mismatch=${f('mismatch')} (${(100 * R.mismatch / R.samples).toFixed(1)}%) hole=${f('hole')} big(>0.35m)=${R.big} eyeInSolid=${f('eye')} openEdgesNearTrail=${f('openNear')}/${f('open')} wallSeamEdges=${R.seam} cracks(>0.15m)=${R.crack} (max ${R.crackMax.toFixed(2)} m)`);
  if (R.crackPts.length) console.log(`${label} seam cracks [x,y,z,gap]:`, JSON.stringify(R.crackPts));
  console.log(`${label} |H-vis| med/p95/max = ${R.dMed}/${R.dP95}/${R.dMax} m; grade p50/p95/max = ${R.gradeP50}/${R.gradeP95}/${R.maxGrade} deg; width min/p10/med = ${R.minWidth}/${R.wP10}/${R.wMed} m; length ${R.trailLen} m`);
  if (R.bad?.length) console.log(`${label} first offenders:`, JSON.stringify(R.bad.slice(0, 12)));
  if (R.eyePts?.length) console.log(`${label} eye in solid [x,y,z,s]:`, JSON.stringify(R.eyePts.slice(0, 14)));
  if (R.steep?.length) console.log(`${label} grade>30 [x,y,z,s,deg]:`, JSON.stringify(R.steep.slice(0, 14)));
  if (R.narrow?.length) console.log(`${label} width<1.2 [x,y,z,s,w]:`, JSON.stringify(R.narrow.slice(0, 14)));
  if (R.openPts?.length) console.log(`${label} open edges:`, JSON.stringify(R.openPts.slice(0, 10)));
}
