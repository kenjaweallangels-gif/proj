// Согласование модулей после загрузки: то, что один модуль построил, не должно перекрывать проходы другого.
// Валуны пустыни (desert/dressing.js) расставлены по аналитическому рельефу ДО того, как подход (level) вырезал тропу в осыпи,
// поэтому несколько крупных валунов-сфер оказались ровно на тропе и перегородили её (невидимая/неочевидная стена, бот и игрок упираются).
// Здесь такие валуны убираются: коллайдер удаляется, а сам экземпляр в InstancedMesh схлопывается (масштаб 0).
const MARGIN = 1.2;      // запас по горизонтали от кромки сферы до оси тропы, м
const VERT = 3.0;        // по вертикали: валун на другом ярусе тропы не трогаем

export function reconcile(game) {
  const A = game.approach;
  const tr = A?.trail;
  if (!tr?.length || !game.colliders) return { removed: 0 };
  const nearTrail = (c, r) => {
    for (let i = 0; i < tr.length; i++) {
      const p = tr[i];
      const dx = p.x - c.x, dz = p.z - c.z;
      if (dx * dx + dz * dz < (r + MARGIN) * (r + MARGIN) && Math.abs((p.y ?? c.y) - c.y) < r + VERT) return true;
    }
    return false;
  };
  const gone = [];
  for (const e of [...game.colliders.all()]) {
    if (e.owner !== 'desert' || e.type !== 'sphere' || !e.tags?.has('boulder')) continue;
    if (nearTrail(e.c, e.r)) { game.colliders.remove(e.id); gone.push({ x: e.c.x, z: e.c.z }); }
  }
  if (!gone.length) return { removed: 0 };
  // схлопываем соответствующие экземпляры (позиция экземпляра = (x, ·, z) препятствия)
  const m = new game.THREE.Matrix4(), pos = new game.THREE.Vector3(), q = new game.THREE.Quaternion(), s = new game.THREE.Vector3();
  const zero = new game.THREE.Matrix4().makeScale(0, 0, 0);
  let hidden = 0;
  game.scene.traverse((o) => {
    if (!o.isInstancedMesh || o.count < 1 || o.count > 6000) return;
    let dirty = false;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m); m.decompose(pos, q, s);
      if (s.x === 0) continue;
      for (const g of gone) if (Math.abs(pos.x - g.x) < 0.35 && Math.abs(pos.z - g.z) < 0.35) { zero.setPosition(pos); o.setMatrixAt(i, zero); dirty = true; hidden++; break; }
    }
    if (dirty) o.instanceMatrix.needsUpdate = true;
  });
  console.info(`[reconcile] валунов на тропе убрано: ${gone.length} (экземпляров скрыто ${hidden})`);
  return { removed: gone.length, hidden };
}
