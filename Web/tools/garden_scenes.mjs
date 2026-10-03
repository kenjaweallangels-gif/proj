// Кадры сада для проверки земли, устья, оврага. node tools/level_shots.mjs --file=garden.html --scenes=garden_scenes.mjs --tag=garden2 [--only=a,b]
export async function run({ hours, cam, shot, want, page }) {
  await hours(10.5);
  if (want('mouth') || want('all')) {
    await cam(814.5, 1.7, 397, 800, 3.0, 395.8, 62, 1500, true); await shot('m0_mouth_from_plaza');
    await cam(806, 1.7, 395.8, 830, 1.5, 397, 66, 1200, true); await shot('m1_from_portal');
    // из штольни наружу
    await page.evaluate(() => { const g = window.__rakis; g.camera.position.set(796.5, 6.7, 395.8); g.camera.fov = 66; g.camera.updateProjectionMatrix(); g.camera.lookAt(812, 5.4, 396.5); });
    await page.waitForTimeout(1200); await shot('m2_from_inside');
  }
  if (want('garden') || want('all')) {
    await cam(812, 9, 372, 852, 0, 410, 62, 1200, true); await shot('g2_wide_high');
    await cam(836, 1.7, 380, 852, 0.6, 392, 60, 1200, true); await shot('g4_beds_channels');
    await cam(860, 1.7, 399, 884, 0.8, 399.5, 60, 1200, true); await shot('g5d_pond');
    await cam(840, 70, 440, 840, 2, 395, 56, 1200); await shot('g5c_aerial');
  }
  if (want('ravine') || want('all')) {
    await cam(870, 1.7, 404, 900, 2, 411, 62, 1200, true); await shot('r0_ravine_in');
    await cam(905, 1.7, 413, 880, 4, 406, 62, 1200, true); await shot('r1_ravine_back');
    await cam(960, 2.5, 426, 920, 3, 417, 62, 1200, true); await shot('r2_ravine_outside');
  }
  if (want('perf') || want('all')) {
    const r = await page.evaluate(() => new Promise((res) => {
      const g = window.__rakis; g.camera.position.set(830, 6, 398); g.camera.lookAt(860, 3, 400);
      const p = g.garden.perf; p.n = 0; p.avg = 0; p.max = 0;
      setTimeout(() => res({ gardenMs: +p.avg.toFixed(3), max: +p.max.toFixed(2), n: p.n, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles }), 4000);
    }));
    console.log('perf', JSON.stringify(r));
  }
}
