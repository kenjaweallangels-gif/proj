// Быстрый осмотр стадий «Встречи» без ожидания всей сцены: debugEncounter({stage}) → шаг N секунд → набор ракурсов.
// node tools/build.mjs --out=worm.html && node tools/worm_stages.mjs --stages=arrive:2,stop:3,stop:9,dismount:10,dismount:30 [--q=low --w=640 --h=360 --views=player,riders,close,aerial]
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openGame, capture, arg, root } from './lib/harness.mjs';

const tag = arg('tag', 'stages');
const outDir = join(root, 'dist', 'shots', tag);
const dt = Number(arg('dt', 1 / 30));
const views = arg('views', 'player,riders,aerial').split(',');
const stages = arg('stages', 'arrive:2,stop:3,stop:9,dismount:10').split(',').map((s) => { const [a, b] = s.split(':'); return { stage: a, sec: Number(b || 0) }; });
const { browser, page, errors } = await openGame({ file: arg('file', 'worm.html'), q: arg('q', 'low'), w: Number(arg('w', 640)), h: Number(arg('h', 360)), gl: arg('gl', 'swiftshader'), hideSubs: arg('subs', '0') === '0' });
const results = [];
let idx = 0;

for (const st of stages) {
  await page.evaluate(([stage]) => { const w = window.__rakis.worm; w.debugEncounter({ stage }); }, [st.stage]);
  if (st.sec > 0) await page.evaluate(([s, d]) => window.__step(s, d), [st.sec, dt]);
  for (const view of views) {
    const name = `${String(idx).padStart(2, '0')}_${st.stage}${st.sec}_${view}`;
    const cameraFn = (v) => {
      const g = window.__rakis, T = g.THREE, w = g.worm, cam = g.camera, d = w.director, sp = w.spine;
      const P = new T.Vector3(), N = new T.Vector3();
      if (v === 'player') {
        const p = g.player.position;
        let yaw = Math.atan2(w.headPos.z - p.z, w.headPos.x - p.x);
        const o = d.tasks?.[1];
        if (o && ['walkTo', 'talk', 'home'].includes(o.ph)) yaw = Math.atan2(o.pos.z - p.z, o.pos.x - p.x);
        g.player.teleport(p.x, p.y, p.z, yaw, false); cam.fov = 62; cam.updateProjectionMatrix(); window.__step(0.034, 1 / 30);
      } else if (v === 'riders') {
        sp.surfacePoint(48, 0, P, N, 0);
        const side = new T.Vector3().crossVectors(sp._b, N).normalize();
        const gsign = Math.sign(side.dot(new T.Vector3(d.G.x - P.x, 0, d.G.z - P.z))) || 1;
        cam.position.copy(P).addScaledVector(side, 78 * gsign); cam.position.y = Math.max(P.y + 14, g.heightAt(cam.position.x, cam.position.z) + 6);
        cam.fov = 40; cam.updateProjectionMatrix(); cam.lookAt(P.x, P.y + 1, P.z);
      } else if (v === 'close' || v === 'close2') {
        // ракурс 3/4 на наездника: сбоку от него (в системе его корпуса), чуть выше
        const it = w.riders.items[v === 'close' ? 1 : 0]; const e = it.root.matrix.elements;
        const o = new T.Vector3(e[12], e[13], e[14]), rt = new T.Vector3(e[0], e[1], e[2]).normalize(), up = new T.Vector3(e[4], e[5], e[6]).normalize(), fw = new T.Vector3(e[8], e[9], e[10]).normalize();
        const sg = it.free ? 1 : (rt.dot(new T.Vector3(d.G.x - o.x, 0, d.G.z - o.z)) >= 0 ? 1 : -1);
        cam.position.copy(o).addScaledVector(rt, 11 * sg).addScaledVector(up, 3).addScaledVector(fw, 5); cam.fov = 38; cam.updateProjectionMatrix();
        cam.lookAt(o.x + up.x * 1.1, o.y + up.y * 1.1, o.z + up.z * 1.1);
      } else if (v === 'head') {
        sp.surfacePoint(2, 0, P, N, 0);
        const side = new T.Vector3().crossVectors(sp._b, N).normalize();
        cam.position.copy(P).addScaledVector(side, 60).addScaledVector(sp._b, 24); cam.position.y = Math.max(cam.position.y, g.heightAt(cam.position.x, cam.position.z) + 4);
        cam.fov = 44; cam.updateProjectionMatrix(); cam.lookAt(P.x + sp._b.x * 14, P.y + 6, P.z + sp._b.z * 14);
      } else {
        const K = w.K; const cx = (K.pos.x + d.G.x) * 0.5, cz = (K.pos.z + d.G.z) * 0.5;
        cam.position.set(cx - d.path.f.x * 70, d.G.y + 250, cz - d.path.f.z * 70); cam.fov = 62; cam.updateProjectionMatrix(); cam.lookAt(cx, d.G.y, cz);
      }
    };
    const r = await capture(page, outDir, name, { minLum: 20, cameraFn, camArg: view });
    const info = await page.evaluate(() => ({ ph: window.__rakis.worm.encounterPhase(), oss: window.__rakis.worm.director.tasks?.[1]?.ph }));
    results.push({ ...r, ...info, view });
    console.log(name.padEnd(30), `phase=${info.ph} oss=${info.oss} lum=${r.lum} nan=${r.nan}/${r.inf}${r.bad ? '  <-- BAD' : ''}`);
  }
  idx++;
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify(results, null, 1));
await browser.close();
const uniq = [...new Set(errors)];
if (uniq.length) console.error(`КОНСОЛЬ (${uniq.length}):\n` + uniq.slice(0, 30).join('\n'));
process.exit(results.some((r) => r.bad) || uniq.length ? 1 : 0);
