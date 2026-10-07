// Пакет операции (schemas/operation.schema.json) → удобная для сцены форма.
// Без three.js — чтобы тестироваться в node. Единицы: в пакете мм, на выходе метры. Ось Y вверх, кватернион [x,y,z,w].

export const MM = 0.001;
export const mm = (v) => v.map((x) => x * MM);

/** Проверка ссылок (схему целиком проверяет сервер/ядро). Возвращает список ошибок по-русски. */
export function validatePackage(pkg) {
  const errors = [];
  for (const key of ['schema_version', 'operation', 'anchors', 'parts', 'steps']) {
    if (!(key in pkg)) errors.push(`нет поля ${key}`);
  }
  if (errors.length) return errors;
  const parts = new Set(pkg.parts.map((p) => p.id));
  const fasts = new Set((pkg.fasteners || []).map((f) => f.id));
  const sheets = new Set((pkg.kd_sheets || []).map((k) => k.id));
  for (const s of pkg.steps) {
    for (const p of s.parts || []) if (!parts.has(p)) errors.push(`шаг ${s.id}: нет детали ${p}`);
    for (const f of s.fasteners || []) if (!fasts.has(f)) errors.push(`шаг ${s.id}: нет крепежа ${f}`);
    for (const k of s.kd || []) if (!sheets.has(k)) errors.push(`шаг ${s.id}: нет листа КД ${k}`);
  }
  const ns = pkg.steps.map((s) => s.n);
  if (ns.some((n, i) => i > 0 && n <= ns[i - 1])) errors.push('номера шагов должны идти по возрастанию без повторов');
  return errors;
}

/** baseUrl — адрес самого JSON: uri моделей и листов КД считаются от него. */
export function normalizePackage(pkg, baseUrl) {
  const errors = validatePackage(pkg);
  if (errors.length) throw new Error('Пакет операции с ошибками: ' + errors.join('; '));
  const url = (u) => new URL(u, baseUrl).href;
  const frame = pkg.anchors.reference_frame;

  const markers = pkg.anchors.markers.map((m) => ({
    id: m.id, dictionary: m.dictionary, size: m.size_mm * MM,
    pos: mm(m.pose.position), rot: m.pose.rotation || [0, 0, 0, 1], note: m.note || '',
  }));
  const parts = new Map(pkg.parts.map((p) => [p.id, {
    id: p.id, designation: p.designation, name: p.name, model: p.model || null, node: p.node || null,
    fallback: p.fallback ? { type: p.fallback.type, size: mm(p.fallback.size_mm), color: p.fallback.color || '#9aa3ad' }
      : { type: 'box', size: [0.05, 0.05, 0.05], color: '#9aa3ad' },
    pos: mm(p.target.position), rot: p.target.rotation || [0, 0, 0, 1],
    src: p.source?.position ? mm(p.source.position) : null,
    srcKind: p.source?.kind || null, cell: p.source?.cell || null,
    kd: p.kd || null, mass: p.mass_kg ?? null,
  }]));
  const fasteners = new Map((pkg.fasteners || []).map((f) => [f.id, {
    id: f.id, type: f.type, designation: f.designation, part: f.part || null,
    pos: mm(f.position), axis: f.axis || [0, 1, 0], torque: f.torque_nm ?? null, lock: f.lock || null,
  }]));
  const kdSheets = new Map((pkg.kd_sheets || []).map((k) => [k.id, {
    id: k.id, url: url(k.uri), title: k.title, positions: k.positions || {},
  }]));
  const steps = pkg.steps.map((s, index) => ({ ...s, index, parts: s.parts || [], fasteners: s.fasteners || [], kd: s.kd || [] }));

  // габарит: цели деталей и метки (без тары) — для камеры и окружения
  const pts = [...parts.values()].map((p) => p.pos).concat(markers.map((m) => m.pos));
  const min = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])));
  const max = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])));
  const srcY = [...parts.values()].filter((p) => p.src).map((p) => p.src[1]);
  const isFixture = frame.startsWith('fixture');
  const floorY = isFixture ? min[1] - 0.9 : Math.min(min[1], ...srcY) - 0.02;

  const cd = pkg.anchors.check_distance;
  return {
    raw: pkg,
    id: pkg.operation.id, title: pkg.operation.title, product: pkg.operation.product || '',
    revision: pkg.operation.revision || '', workplace: pkg.operation.workplace || '',
    frame, isFixture, isFuselage: frame.startsWith('fuselage'),
    models: (pkg.models || []).map((m) => ({ id: m.id, url: url(m.uri) })),
    markers, parts, fasteners, kdSheets, steps,
    checkDistance: cd ? { from: mm(cd.from), to: mm(cd.to), nominal: cd.nominal_mm * MM, tol: cd.tol_mm * MM } : null,
    bounds: { min, max, center: min.map((v, i) => (v + max[i]) / 2), size: max.map((v, i) => v - min[i]) },
    floorY,
  };
}

/** Центр целей деталей шага (м) — куда смотрит голова в демо. Для шагов без деталей — центр изделия. */
export function stepFocus(P, step) {
  const ps = step.parts.map((id) => P.parts.get(id)).filter(Boolean);
  if (!ps.length) return P.bounds.center;
  return [0, 1, 2].map((i) => ps.reduce((a, p) => a + p.pos[i], 0) / ps.length);
}

export async function loadPackage(url, fetchFn = fetch) {
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`Не загрузился пакет ${url}: ${r.status}`);
  return normalizePackage(await r.json(), new URL(url, globalThis.location?.href ?? 'http://localhost/').href);
}
