// Кадры: подход (вид снизу — вход скрыт, середина подъёма, обзор эрга, ниша) и сад.
export async function run({ hours, cam, shot, want, page }) {
  // камера «глазами игрока» на тропе: доля f пути, смотрим на ahead метров вперёд (или назад)
  async function trailCam(f, { eye = 1.7, ahead = 9, up = 0.3, fov = 62, wait = 900, back = false } = {}) {
    await page.evaluate(([f, eye, ahead, up, fov, back]) => {
      const g = window.__rakis, A = g.approach, T = A.trail;
      const s0 = f * A.trailLength;
      const at = (s) => { let lo = 0, hi = T.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m].s < s) lo = m; else hi = m; } return T[hi]; };
      const p = at(s0), q = at(s0 + (back ? -ahead : ahead));
      g.camera.position.set(p.x, p.y + eye, p.z);
      g.camera.fov = fov; g.camera.updateProjectionMatrix();
      g.camera.lookAt(q.x, q.y + eye * 0.8 + up * 5, q.z);
    }, [f, eye, ahead, up, fov, back]);
    await page.waitForTimeout(wait);
  }
  if (want('approach')) {
    await hours(9.5);
    await cam(560, 12, 345, 640, 22, 265, 60, 900); await shot('a1_from_below');
    await cam(590, 45, 215, 632, 22, 275, 60, 900); await shot('a0_over_nw');
    await cam(630, 100, 274, 632, 20, 274.5, 48, 900); await shot('a0_top');
    await cam(640, 38, 195, 640, 24, 262, 58, 900); await shot('a0_from_north');
    await trailCam(0.02, { ahead: 12 }); await shot('a2_trail_start');
    await trailCam(0.3, { ahead: 10 }); await shot('a3_mid_climb');
    await trailCam(0.5, { ahead: 8, up: 0.2 }); await shot('a3b_arch');
    await trailCam(0.76, { ahead: 12 }); await shot('a4_ledge');
    await cam(626, 26.2, 270.5, 540, 12, 330, 75, 900); await shot('a5_view_back');
    await cam(641.2, 28.6, 267.5, 646, 29.4, 252, 62, 900); await shot('a6_slot');
    await cam(644.5, 31.2, 253.5, 651, 31.5, 251, 62, 900); await shot('a7_cleft');
  }
}
