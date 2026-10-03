// Кадры: подход (вид снизу — вход скрыт, середина подъёма, обзор эрга, ниша) и сад (общий вид, детали, звери, сумерки/ночь).
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
  // слежение за сущностью: камера держится на расстоянии dist позади/сбоку и смотрит на неё
  async function follow(expr, { dist = 1.2, h = 0.5, side = 0.6, fov = 50, wait = 1100, up = 0 } = {}) {
    await page.evaluate(([expr, dist, h, side, fov, up]) => {
      const g = window.__rakis;
      if (!g.__shotcam) g.add('__shotcam', { alwaysUpdate: true, update() { window.__follow?.(); } }), g.__shotcam = true;
      const ent = new Function('g', `return (${expr});`);
      g.camera.fov = fov; g.camera.updateProjectionMatrix();
      window.__follow = () => {
        const p = ent(g); if (!p) return;
        g.camera.position.set(p.x + side, p.y + h + up, p.z + dist);
        g.camera.lookAt(p.x, p.y + (up ? up * 0.2 : 0.04), p.z);
      };
      window.__follow();
    }, [expr, dist, h, side, fov, up]);
    await page.waitForTimeout(wait);
  }
  // слежение с камерой «со стороны котловины» (для зверя у стены/на полке)
  async function followToward(expr, { dist = 3, h = 0.6, fov = 40, wait = 900 } = {}) {
    await page.evaluate(([expr, dist, h, fov]) => {
      const g = window.__rakis;
      if (!g.__shotcam) g.add('__shotcam', { alwaysUpdate: true, update() { window.__follow?.(); } }), g.__shotcam = true;
      const ent = new Function('g', `return (${expr});`);
      g.camera.fov = fov; g.camera.updateProjectionMatrix();
      window.__follow = () => {
        const p = ent(g); if (!p) return;
        const C = g.garden.center; let dx = C.x - p.x, dz = C.z - p.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        g.camera.position.set(p.x + dx * dist - dz * 0.6, p.y + h, p.z + dz * dist + dx * 0.6);
        g.camera.lookAt(p.x, p.y + 0.15, p.z);
      };
      window.__follow();
    }, [expr, dist, h, fov]);
    await page.waitForTimeout(wait);
  }
  async function unfollow() { await page.evaluate(() => { window.__follow = null; }); }

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
    await trailCam(0.85, { ahead: 16, back: true, fov: 75, up: 0 }); await shot('a5_view_back');
    await trailCam(0.9, { ahead: 8 }); await shot('a6_slot');
    await trailCam(0.97, { ahead: 8 }); await shot('a6b_slot_end');
    await page.evaluate(() => { const g = window.__rakis, A = g.approach; const y = g.world.heightAt(646.6, 251, 31) + 1.7; g.camera.position.set(646.4, y, 251.5); g.camera.fov = 60; g.camera.updateProjectionMatrix(); g.camera.lookAt(653, y - 0.2, 251); });
    await page.waitForTimeout(800); await shot('a7_cleft');
  }

  if (want('garden')) {
    await hours(10.5);
    await cam(814.5, 1.7, 397, 800, 3.0, 392, 62, 1100, true); await shot('g0_mouth');
    await cam(806, 1.7, 392, 862, 1.2, 397, 66, 1100, true); await shot('g1_from_portal');
    await cam(812, 9, 372, 852, 0, 410, 62, 1100, true); await shot('g2_wide_high');
    await cam(815, 1.7, 393, 807, 1.0, 400, 62, 1100, true); await shot('g3_spout_palms');
    await cam(836, 1.7, 380, 852, 0.6, 392, 60, 1100, true); await shot('g4_beds_channels');
    await cam(822, 1.7, 362, 816, 24, 338, 62, 1100, true); await shot('g5_windtrap');
    await cam(878, 3, 428, 840, 3, 395, 70, 1100, true); await shot('g5b_east_view');
    await cam(840, 70, 440, 840, 2, 395, 56, 1100); await shot('g5c_aerial');
    await cam(860, 1.7, 399, 884, 0.8, 399.5, 60, 1100, true); await shot('g5d_pond');
    // звери
    await page.evaluate(() => { const g = window.__rakis, F = g.garden.fauna; F.mice.forEach((m) => { m.state = 'idle'; m.vis = 1; m.hiddenFor = 0; m.t = 3; }); });
    await follow('g.garden.fauna.mice[0]', { dist: 1.3, h: 0.45, side: 0.3, fov: 40 }); await shot('g6_mouse');
    await follow('g.garden.fauna.mice[3]', { dist: 1.8, h: 0.6, side: -0.5, fov: 40 }); await shot('g6b_mouse2');
    await follow('({x:g.garden.fauna.hawks[0].g.position.x, y:g.garden.fauna.hawks[0].g.position.y, z:g.garden.fauna.hawks[0].g.position.z})', { dist: 11, h: -2, side: 4, fov: 36, wait: 700 }); await shot('g7_hawk');
    await follow('g.garden.fauna.lizards[0].g.position', { dist: 0.9, h: 0.35, side: 0.5, fov: 40 }); await shot('g8_lizard');
    await followToward('g.garden.fauna.owl.g.position', { dist: 3.6, h: 0.5, fov: 40, wait: 800 }); await shot('g8b_owl_day');
    await unfollow();
    await hours(18.7);
    await cam(812, 9, 372, 852, 0, 410, 62, 1500, true); await shot('g9_dusk_wide');
    await followToward('g.garden.fauna.owl.g.position', { dist: 3.2, h: 0.5, fov: 40, wait: 1500 }); await shot('g9b_owl_dusk');
    await unfollow();
    await hours(20.2);
    await page.evaluate(() => { const g = window.__rakis; const f = g.garden.fauna.fox; f.vis = 1; f.pause = 5; });
    await follow('g.garden.fauna.fox.g.position', { dist: 3.2, h: 1.0, side: 1.0, fov: 45, wait: 1500 }); await shot('g10b_fox');
    await unfollow();
    await hours(22.5);
    await cam(806, 1.7, 392, 862, 1.2, 397, 66, 1500, true); await shot('g10_night');
  }
}
