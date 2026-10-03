// Кадры входа в щель с двух сторон. node tools/level_shots.mjs --file=garden.html --scenes=approach_scenes.mjs --tag=approach2
export async function run({ hours, shot, page }) {
  await hours(9.5);
  const camAbs = async (x, y, z, lx, ly, lz, fov = 62, wait = 1200) => {
    await page.evaluate(([x, y, z, lx, ly, lz, fov]) => { const g = window.__rakis; g.camera.position.set(x, y, z); g.camera.fov = fov; g.camera.updateProjectionMatrix(); g.camera.lookAt(lx, ly, lz); }, [x, y, z, lx, ly, lz, fov]);
    await page.waitForTimeout(wait);
  };
  // по тропе к щели: глаза 1.7 м над поверхностью тропы (heightAt с подсказкой высоты)
  const trailEye = async (x, z, yHint, lx, lz, ly, fov = 62) => {
    const y = await page.evaluate(([x, z, yh]) => window.__rakis.world.heightAt(x, z, yh), [x, z, yHint]);
    await camAbs(x, y + 1.7, z, lx, ly, lz, fov);
  };
  await trailEye(640.5, 251.5, 30, 653, 251, 31.5); await shot('c0_slot_to_niche');
  await trailEye(646.4, 251.2, 30.5, 652, 251, 31.8); await shot('c1_niche');
  await camAbs(649, 31.7, 251.3, 640, 30.5, 253, 70); await shot('c2_from_niche_outward');
  await trailEye(612, 273, 22, 606, 285, 18, 70); await shot('c3_shelf_junction');
}
