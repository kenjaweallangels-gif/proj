// Кадры высокой котловины-сада: туннель → лаз → дно с нескольких точек, стены, мелкие растения, вид снаружи (пустыня, массив стен).
// node tools/build.mjs --out=garden.html && node tools/level_shots.mjs --file=garden.html --scenes=garden_scenes.mjs --tag=garden3 [--only=tunnel,mouth,garden,walls,plants,desert,night,perf] [--w=960 --h=540]
// Камеры — по абсолютным координатам; высота над землёй сада считается через garden.groundAt.
export async function run({ hours, shot, want, page }) {
  const camG = async (x, h, z, lx, lh, lz, fov = 62, wait = 1200) => {
    await page.evaluate(([x, h, z, lx, lh, lz, fov]) => {
      const g = window.__rakis, G = g.garden;
      g.camera.position.set(x, G.groundAt(x, z) + h, z); g.camera.fov = fov; g.camera.updateProjectionMatrix();
      g.camera.lookAt(lx, G.groundAt(lx, lz) + lh, lz);
    }, [x, h, z, lx, lh, lz, fov]);
    await page.waitForTimeout(wait);
  };
  const camAbs = async (x, y, z, lx, ly, lz, fov = 62, wait = 1200) => {
    await page.evaluate(([x, y, z, lx, ly, lz, fov]) => { const g = window.__rakis; g.camera.position.set(x, y, z); g.camera.fov = fov; g.camera.updateProjectionMatrix(); g.camera.lookAt(lx, ly, lz); }, [x, y, z, lx, ly, lz, fov]);
    await page.waitForTimeout(wait);
  };
  await hours(10.5);
  if (want('tunnel') || want('all')) {
    // игрок реально стоит в туннеле: смотрим к лазу (пространство и видимость выставляют сами модули)
    for (const [px, name] of [[786, 't0_tunnel_far'], [792.5, 't1_tunnel_near'], [797.2, 't2_at_mouth']]) {
      await page.evaluate(([px]) => { const g = window.__rakis; g.player.teleport(px, g.heightAt(px, 395, 36), 395, 0, false); }, [px]);
      await page.waitForTimeout(2500);
      await page.evaluate(([px]) => { const g = window.__rakis; g.camera.position.set(px, g.heightAt(px, 395, 36) + 1.62, 395); g.camera.fov = 70; g.camera.updateProjectionMatrix(); g.camera.lookAt(830, 37.5, 397); }, [px]);
      await page.waitForTimeout(1500);
      console.log('state', name, JSON.stringify(await page.evaluate(() => ({ space: window.__rakis.space, worldVisible: window.__rakis.world.visible, gardenVisible: window.__rakis.garden.root.visible }))));
      await shot(name);
    }
  }
  if (want('mouth') || want('all')) {
    await camG(808, 1.7, 396.5, 797, 1.2, 395, 66, 1500); await shot('m0_mouth_from_floor');
    await camG(802, 1.7, 399, 797, 1.2, 395, 70); await shot('m1_mouth_closeup');
    await camG(803, 1.7, 395, 830, 0.5, 397, 70); await shot('m2_from_mouth_in');
    await camG(812, 1.7, 388, 820, 1.4, 405, 70); await shot('m3_floor_near_mouth');
  }
  if (want('garden') || want('all')) {
    await camG(812, 1.7, 398, 850, 4, 398, 66, 1500); await shot('g0_east_from_mouth');
    await camG(832, 1.7, 398, 832, 14, 366, 66); await shot('g1_north_wall');
    await camG(832, 1.7, 398, 832, 14, 432, 66); await shot('g2_south_wall');
    await camG(850, 1.7, 398, 800, 22, 398, 66); await shot('g3_west_claw_face');
    await camG(820, 1.7, 415, 850, 3, 380, 60); await shot('g4_diag');
    await camG(832, 1.7, 398, 832, 60, 398, 74); await shot('g5_up');
    await camG(855, 6, 420, 815, 10, 380, 62); await shot('g6_high_view');
  }
  if (want('walls') || want('all')) {
    await camG(860, 1.7, 398, 874, 18, 398, 60); await shot('w0_east_wall');
    await camG(840, 1.7, 372, 842, 8, 362, 50); await shot('w1_ledges');
    await camG(826, 1.7, 428, 828, 9, 436, 40); await shot('w2_owl_ledge');
  }
  if (want('plants') || want('all')) {
    await page.evaluate(() => { const f = window.__rakis.garden.flora; const c = f.clusters[0]; window.__c = c; });
    const cl = await page.evaluate(() => window.__rakis.garden.flora.clusters.slice(0, 6).map((c) => [c.x, c.z]));
    let i = 0;
    for (const [x, z] of cl.slice(0, 4)) { await camG(x - 2.2, 0.9, z - 2.2, x, 0.15, z, 55); await shot(`p${i++}_cluster`); }
    const wp = await page.evaluate(() => { const G = window.__rakis.garden; const p = G.rimApi.wallPoint(Math.PI / 2 + 0.5, 1.5); return [p.x, p.z]; });
    await camG(wp[0] + (832 - wp[0]) * 0.07, 1.5, wp[1] + (398 - wp[1]) * 0.07, wp[0], 1.5, wp[1], 55); await shot('p9_lichen_wall');
  }
  if (want('desert') || want('all')) {
    // вид снаружи: с песка у восточного основания массива, с севера и юга; котловина не должна быть видна
    await camAbs(940, 12, 398, 832, 80, 398, 60, 1800); await shot('d0_east_foot');
    await camAbs(860, 14, 300, 832, 70, 398, 60, 1800); await shot('d1_north');
    await camAbs(860, 14, 500, 832, 70, 398, 60, 1800); await shot('d2_south');
    await camAbs(700, 60, 398, 832, 90, 398, 60, 1800); await shot('d3_from_west_over_claw');
    await camAbs(1010, 40, 450, 832, 60, 398, 45, 1800); await shot('d4_far_east');
  }
  if (want('night') || want('all')) {
    await hours(22.5);
    await camG(806, 1.7, 392, 840, 1.0, 398, 66, 1500); await shot('n0_night');
    await hours(10.5);
  }
  if (want('perf') || want('all')) {
    const r = await page.evaluate(() => new Promise((res) => {
      const g = window.__rakis; g.camera.position.set(820, 38, 398); g.camera.lookAt(850, 37, 400);
      const p = g.garden.perf; p.n = 0; p.avg = 0; p.max = 0;
      setTimeout(() => res({ gardenMs: +p.avg.toFixed(3), max: +p.max.toFixed(2), first: +p.first.toFixed(2), n: p.n, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles }), 4000);
    }));
    console.log('perf', JSON.stringify(r));
  }
}
