// Кадры сада для проверки земли, устья, оврага. node tools/level_shots.mjs --file=garden.html --scenes=garden_scenes.mjs --tag=garden2 [--only=mouth,garden,ravine,perf,night]
// Высоты камеры — над землёй сада (garden.groundAt), а не над «верхом колонки» (у грани это гребень).
export async function run({ hours, shot, want, page }) {
  const camG = async (x, h, z, lx, lh, lz, fov = 62, wait = 1200) => {
    await page.evaluate(([x, h, z, lx, lh, lz, fov]) => {
      const g = window.__rakis, G = g.garden;
      g.camera.position.set(x, G.groundAt(x, z) + h, z); g.camera.fov = fov; g.camera.updateProjectionMatrix();
      g.camera.lookAt(lx, G.groundAt(lx, lz) + lh, lz);
    }, [x, h, z, lx, lh, lz, fov]);
    await page.waitForTimeout(wait);
  };
  await hours(10.5);
  if (want('mouth') || want('all')) {
    await camG(814.5, 1.7, 397, 800, 1.4, 395.8, 62, 1500); await shot('m0_mouth_from_plaza');
    await camG(806, 1.7, 395.8, 830, 0.5, 397, 66); await shot('m1_from_portal');
    await camG(796.5, 1.7, 395.8, 812, 0.4, 396.5, 66); await shot('m2_from_inside');
    await camG(803, 1.7, 400, 800, 1.2, 395.8, 70); await shot('m3_mouth_closeup');
  }
  if (want('garden') || want('all')) {
    await camG(812, 9, 372, 852, 0, 410, 62); await shot('g2_wide_high');
    await camG(836, 1.7, 380, 852, 0.6, 392, 60); await shot('g4_beds_channels');
    await camG(860, 1.7, 401, 884, 0.3, 399.5, 60); await shot('g5d_pond');
    await camG(840, 70, 440, 840, 2, 395, 56); await shot('g5c_aerial');
  }
  if (want('ravine') || want('all')) {
    await camG(870, 1.7, 404, 900, 1, 411, 62); await shot('r0_ravine_in');
    await camG(905, 1.7, 413, 880, 3, 406, 62); await shot('r1_ravine_back');
    await camG(950, 2.5, 424, 915, 3, 416, 62); await shot('r2_ravine_outside');
  }
  if (want('night') || want('all')) {
    await hours(22.5);
    await camG(806, 1.7, 392, 840, 1.0, 398, 66, 1500); await shot('n0_night');
  }
  if (want('perf') || want('all')) {
    const r = await page.evaluate(() => new Promise((res) => {
      const g = window.__rakis; g.camera.position.set(830, 6, 398); g.camera.lookAt(860, 3, 400);
      const p = g.garden.perf; p.n = 0; p.avg = 0; p.max = 0;
      setTimeout(() => res({ gardenMs: +p.avg.toFixed(3), max: +p.max.toFixed(2), first: +p.first.toFixed(2), n: p.n, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles }), 4000);
    }));
    console.log('perf', JSON.stringify(r));
  }
}
