// Кадры тропы к щели (диагностика и приёмка): node tools/level_shots.mjs --file=X.html --scenes=trail_scenes.mjs --tag=trail_before
// Камеры: «от первого лица» (глаза 1.7 м на тропе) и «от третьего» (за спиной/сверху на 3.2 м).
export async function run({ hours, cam, shot, page }) {
  await hours(9.5);
  const fr = (process.env.TRAIL_F || '0.55,0.7,0.8,0.88,0.94,0.98,1.0').split(',').map(Number);
  const cl = (f, o) => page.evaluate(([f, o]) => {
    const g = window.__rakis, A = g.approach, T = A.trail;
    const at = (s) => { s = Math.max(0, Math.min(A.trailLength, s)); let lo = 0, hi = T.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m].s < s) lo = m; else hi = m; } return T[hi]; };
    const s0 = f * A.trailLength, p = at(s0), q = at(s0 + o.ahead), b = at(s0 - o.back);
    const W = g.world;
    if (o.third) {
      const dx = p.x - b.x, dz = p.z - b.z, l = Math.hypot(dx, dz) || 1;
      g.camera.position.set(b.x - dx / l * 1.5, W.heightAt(b.x, b.z, b.y + 1) + 3.2, b.z - dz / l * 1.5);
      g.camera.lookAt(p.x, p.y + 1.0, p.z);
    } else {
      g.camera.position.set(p.x, p.y + 1.7, p.z);
      g.camera.lookAt(q.x, q.y + 1.3, q.z);
    }
    g.camera.fov = o.fov || 62; g.camera.updateProjectionMatrix();
  }, [f, o]);
  for (const f of fr) {
    await cl(f, { ahead: 8, back: 6 }); await page.waitForTimeout(900); await shot(`fp_${Math.round(f * 100)}`);
    await cl(f, { ahead: 8, back: 6, third: true }); await page.waitForTimeout(900); await shot(`tp_${Math.round(f * 100)}`);
  }
  await cam(560, 12, 345, 640, 22, 265, 60, 900); await shot('from_below');
}
