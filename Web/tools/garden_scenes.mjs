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
    // что за «парящая плита» в кадре: луч через пиксель (445,100) из 960×540
    const hit = await page.evaluate(() => {
      const g = window.__rakis, T = g.THREE; const rc = new T.Raycaster(); rc.setFromCamera(new T.Vector2(-0.07, 0.63), g.camera);
      const hs = rc.intersectObjects(g.scene.children, true).slice(0, 3);
      return hs.map((h) => ({ name: h.object.name || h.object.type, parent: h.object.parent?.name, d: +h.distance.toFixed(1), p: h.point.toArray().map((v) => +v.toFixed(1)) }));
    });
    console.log('pick', JSON.stringify(hit));
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
  if (want('diag')) {
    const rows = await page.evaluate(() => {
      const g = window.__rakis, T = g.THREE, out = [];
      const sp0 = g.space; g.space = 'sietch';
      for (let x = 800; x >= 789.9; x -= 0.5) {
        const y0 = g.world.heightAt(x, 395.8, 6);
        const p = new T.Vector3(x, y0, 395.8); const o = p.clone();
        const inS = !!g.sietch?.contains?.(p);
        const gh = g.groundAt(x, 395.8, y0)?.heightAt?.(x, 395.8, y0);
        const hit = g.collide(p, 0.35);
        const cols = []; for (const e of g.colliders.near(new T.Vector3(x, y0 + 1, 395.8), 1.2)) cols.push(`${e.owner}:${[...(e.tags || [])].join('/')}`);
        out.push({ x, wh: +y0.toFixed(2), sietch: inS, groundH: +(gh ?? NaN).toFixed(2), push: hit ? [+(p.x - o.x).toFixed(2), +(p.z - o.z).toFixed(2)] : 0, cols });
      }
      g.space = sp0; return out;
    });
    for (const r of rows) console.log('diag', JSON.stringify(r));
  }
  if (want('cdiag')) {
    // стык тропы с нишей/сиетчем: высота/коллизия/пространство вдоль последних метров щели
    const rows = await page.evaluate(() => {
      const g = window.__rakis, T = g.THREE, out = [];
      for (const sp of ['desert', 'sietch']) {
        const sp0 = g.space; g.space = sp;
        for (let x = 640; x <= 656; x += 0.75) {
          const z = 251.2, y0 = g.heightAt(x, z, 30.3);
          const p = new T.Vector3(x, y0, z); const o = p.clone();
          const inS = !!g.sietch?.contains?.(p);
          const hit = g.collide(p, 0.35);
          const cols = []; for (const e of g.colliders.near(new T.Vector3(x, y0 + 1, z), 1.0)) cols.push(`${e.owner}:${[...(e.tags || [])].join('/')}`);
          out.push({ sp, x, h: +y0.toFixed(2), contains: inS, push: hit ? [+(p.x - o.x).toFixed(2), +(p.z - o.z).toFixed(2)] : 0, cols });
        }
        g.space = sp0;
      }
      return out;
    });
    for (const r of rows) console.log('cdiag', JSON.stringify(r));
  }
  if (want('trailclear')) {
    const clear = await page.evaluate(() => {
      const g = window.__rakis, A = g.approach, T = g.THREE; const bad = [];
      for (let i = 0; i < A.trail.length; i += 2) {
        const p = A.trail[i]; const pos = new T.Vector3(p.x, g.world.heightAt(p.x, p.z, p.y), p.z); const o = pos.clone();
        g.collide(pos, 0.35); if (Math.hypot(pos.x - o.x, pos.z - o.z) > 0.02) bad.push([+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1), +Math.hypot(pos.x - o.x, pos.z - o.z).toFixed(2)]);
      }
      let desertCols = 0; for (const e of g.colliders.all()) if (e.owner === 'desert' && e.c && e.c.x > 575 && e.c.x < 670 && e.c.z > 225 && e.c.z < 325) desertCols++;
      return { n: A.trail.length / 2 | 0, blocked: bad.length, bad: bad.slice(0, 10), desertColliders: desertCols };
    });
    console.log('trailclear', JSON.stringify(clear));
  }
  if (want('cleft')) {
    await hours(9.5);
    const camAbs = async (x, y, z, lx, ly, lz, fov = 62, wait = 1200) => {
      await page.evaluate(([x, y, z, lx, ly, lz, fov]) => { const g = window.__rakis; g.camera.position.set(x, y, z); g.camera.fov = fov; g.camera.updateProjectionMatrix(); g.camera.lookAt(lx, ly, lz); }, [x, y, z, lx, ly, lz, fov]);
      await page.waitForTimeout(wait);
    };
    const trailEye = async (x, z, yHint, lx, lz, ly, fov = 62) => {
      const y = await page.evaluate(([x, z, yh]) => window.__rakis.world.heightAt(x, z, yh), [x, z, yHint]);
      await camAbs(x, y + 1.7, z, lx, ly, lz, fov);
    };
    await trailEye(640.5, 251.5, 30, 653, 251, 31.5); await shot('c0_slot_to_niche');
    await trailEye(646.4, 251.2, 30.5, 652, 251, 31.8); await shot('c1_niche');
    await camAbs(649, 31.7, 251.3, 640, 30.5, 253, 70); await shot('c2_from_niche_outward');
    await trailEye(612, 273, 22, 606, 285, 18, 70); await shot('c3_shelf_junction');
    await hours(10.5);
  }
  if (want('tunnelview')) {
    // игрок реально стоит в устье/штольне: смотрим наружу и внутрь (пространство и видимость выставляют сами модули)
    for (const [px, name] of [[797.5, 't0_stub_out'], [792.5, 't1_tunnel_end_out']]) {
      await page.evaluate(([px]) => { const g = window.__rakis; g.player.teleport(px, g.world.heightAt(px, 395.8, 6), 395.8, 0, false); }, [px]);
      await page.waitForTimeout(2500);
      await page.evaluate(([px]) => { const g = window.__rakis; g.camera.position.set(px, g.world.heightAt(px, 395.8, 6) + 1.62, 395.8); g.camera.fov = 70; g.camera.updateProjectionMatrix(); g.camera.lookAt(830, 3.5, 397); }, [px]);
      await page.waitForTimeout(1500);
      console.log('state', name, JSON.stringify(await page.evaluate(() => ({ space: window.__rakis.space, worldVisible: window.__rakis.world.visible, gardenVisible: window.__rakis.garden.root.visible }))));
      await shot(name);
    }
    await page.evaluate(() => { const g = window.__rakis; g.player.teleport(812, g.world.heightAt(812, 396, 6), 396, 0, false); });
    await page.waitForTimeout(1500);
  }
  if (want('fauna')) {
    const follow = async (expr, { dist = 1.2, h = 0.5, side = 0.6, fov = 50, wait = 1100 } = {}) => {
      await page.evaluate(([expr, dist, h, side, fov]) => {
        const g = window.__rakis;
        if (!g.__shotcam) g.add('__shotcam', { alwaysUpdate: true, update() { window.__follow?.(); } }), g.__shotcam = true;
        const ent = new Function('g', `return (${expr});`);
        g.camera.fov = fov; g.camera.updateProjectionMatrix();
        window.__follow = () => { const p = ent(g); if (!p) return; g.camera.position.set(p.x + side, p.y + h, p.z + dist); g.camera.lookAt(p.x, p.y + 0.04, p.z); };
        window.__follow();
      }, [expr, dist, h, side, fov]);
      await page.waitForTimeout(wait);
    };
    await page.evaluate(() => { const g = window.__rakis; g.garden.fauna.mice.forEach((m) => { m.state = 'idle'; m.vis = 1; m.hiddenFor = 0; m.t = 3; }); });
    await follow('g.garden.fauna.mice[0]', { dist: 1.3, h: 0.45, side: 0.3, fov: 40 }); await shot('f0_mouse');
    await follow('g.garden.fauna.lizards[0].g.position', { dist: 0.9, h: 0.35, side: 0.5, fov: 40 }); await shot('f1_lizard');
    await follow('({x:g.garden.life.birds[0].x, y:g.garden.life.birds[0].y, z:g.garden.life.birds[0].z})', { dist: 1.6, h: 0.2, side: 0.4, fov: 40 }); await shot('f2_songbird');
    await page.evaluate(() => { window.__follow = null; });
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
