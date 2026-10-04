// «Жизнь» сиетча: тени людей на стенах от светошаров, туман и капли водяного погреба, очаг с дымом, пар/аромат пряного кофе,
// музыкант (bus 'sietch:music'). Всё дёшево: небольшие пулы, обновление только вблизи камеры.
import * as THREE from 'three';
import { clamp, smoothstep, rng } from '../core/util.js';
import { wallDistLocal, heightAtLocal } from './plan.js';

function shadowTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 64, 128);
  x.fillStyle = 'rgba(0,0,0,1)'; x.shadowColor = 'rgba(0,0,0,1)'; x.shadowBlur = 8;
  x.beginPath(); x.ellipse(32, 16, 9, 11, 0, 0, Math.PI * 2); x.fill();                       // голова
  x.beginPath(); x.moveTo(20, 34); x.quadraticCurveTo(32, 26, 44, 34); x.lineTo(46, 78); x.lineTo(40, 78); x.lineTo(38, 124); x.lineTo(33, 124); x.lineTo(32, 84); x.lineTo(31, 84); x.lineTo(30, 124); x.lineTo(25, 124); x.lineTo(24, 78); x.lineTo(18, 78); x.closePath(); x.fill();   // тело и ноги
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

export function createLife(ctx, crowd) {
  const { game, root, globes } = ctx;
  const q = ctx.quality;
  const R = rng(515);
  const out = {};
  const camL = new THREE.Vector3(), tmpN = { x: 0, z: 0 };
  const lt = () => ctx.lighting;

  // ---------------------------------------------------------------- тени людей на стенах ----
  const NSH = q === 'low' ? 3 : q === 'high' ? 8 : 5;
  const shTex = shadowTexture();
  const shadows = [];
  for (let i = 0; i < NSH; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shTex, color: 0x000000, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true }));
    m.visible = false; m.renderOrder = 3; m.frustumCulled = false; root.add(m);
    shadows.push({ mesh: m, op: 0, x: 0, y: 0, z: 0, w: 1, h: 1, yaw: 0, tOp: 0 });
  }
  const bodies = [];
  let shT = 0;
  function pickShadows() {
    bodies.length = 0;
    const pw = game.player?.position;
    if (pw) { const l = root.worldToLocal(new THREE.Vector3().copy(pw)); bodies.push({ x: l.x, y: l.y, z: l.z, h: 1.75 }); }
    for (const c of game.companions?.list || []) if (c.position) { const l = root.worldToLocal(new THREE.Vector3().copy(c.position)); bodies.push({ x: l.x, y: l.y, z: l.z, h: 1.7 }); }
    for (const n of crowd.npcs) {
      if (n.lod === 'off' || n.special) continue; // и групповой LOD (дальние) отбрасывает ту же пятно-тень, что полная фигура
      const sit = n.pose === 'sitFloor' || n.pose === 'pray' || n.mode === 'seat' || n.pose === 'sleep';
      bodies.push({ x: n.x, y: n.y, z: n.z, h: n.lk.height * (n.pose === 'sleep' ? 0.3 : sit ? 0.6 : 1) });
    }
    for (const b of bodies) b.d2 = (b.x - camL.x) ** 2 + (b.z - camL.z) ** 2 + (b.y - camL.y) ** 2;
    bodies.sort((a, b) => a.d2 - b.d2);
    let si = 0;
    for (let bi = 0; bi < bodies.length && si < NSH; bi++) {
      const b = bodies[bi];
      if (b.d2 > 18 * 18) break;
      // ближайший светошар выше головы
      let L = null, bd = 1e9;
      for (let i = 0; i < globes.length; i++) {
        const g = globes[i];
        if (g.y < b.y + b.h * 0.9) continue;
        const dh = Math.hypot(g.x - b.x, g.z - b.z);
        if (dh > 7.5 || dh < 0.35 || g.y - b.y > 7) continue;
        const score = dh + (g.y - b.y) * 0.3;
        if (score < bd) { bd = score; L = g; }
      }
      if (!L) continue;
      const hx = b.x - L.x, hz = b.z - L.z, Dp = Math.hypot(hx, hz), ux = hx / Dp, uz = hz / Dp;
      let hit = -1;
      for (let t = Dp + 0.35; t < Dp + 7.5; t += 0.22) {
        const x = L.x + ux * t, z = L.z + uz * t;
        if (wallDistLocal(x, z, b.y) < 0.1) { hit = t; break; }
      }
      if (hit < 0) continue;
      const wx = L.x + ux * hit, wz = L.z + uz * hit;
      wallDistLocal(wx + ux * 0.1 * -1, wz + uz * 0.1 * -1, b.y, tmpN);
      const nl = Math.hypot(tmpN.x, tmpN.z); if (nl < 0.3) continue;
      const f = hit / Dp;
      if (f < 1.15 || f > 4.5) continue;
      const yh = L.y + (b.y + b.h * 0.98 - L.y) * f, yf = Math.max(L.y + (b.y + 0.02 - L.y) * f, heightAtLocal(wx, wz, b.y) + 0.02);
      const hh = yh - yf; if (hh < 0.35) continue;
      const S = shadows[si++];
      S.x = wx + tmpN.x * 0.03; S.z = wz + tmpN.z * 0.03; S.y = (yh + yf) / 2; S.h = Math.min(hh, 6); S.w = 0.5 * f * Math.min(1, b.h / 1.2) * 0.9 + 0.1; S.yaw = Math.atan2(tmpN.x, tmpN.z);
      S.tOp = 0.46 * clamp(1.6 - f * 0.28, 0.12, 1) * clamp(1.2 - hit / 10, 0.2, 1) * clamp(0.5 + L.k * 0.6, 0.4, 1.1);
    }
    for (; si < NSH; si++) shadows[si].tOp = 0;
  }
  function updateShadows(dt) {
    for (const S of shadows) {
      S.op += (S.tOp - S.op) * Math.min(1, dt * 7);
      const m = S.mesh;
      if (S.op < 0.012) { m.visible = false; continue; }
      m.visible = true; m.material.opacity = S.op;
      m.position.set(S.x, S.y, S.z); m.rotation.y = S.yaw; m.scale.set(S.w, S.h, 1);
    }
  }

  // ---------------------------------------------------------------- капли погреба и пар/туман ----
  const drips = ctx.drips || [];
  const NDP = Math.max(1, drips.length);
  const dpGeo = new THREE.BufferGeometry(), dpPos = new Float32Array(NDP * 3).fill(0);
  for (let i = 0; i < NDP; i++) dpPos[i * 3 + 1] = -99;
  dpGeo.setAttribute('position', new THREE.BufferAttribute(dpPos, 3));
  const dpPts = new THREE.Points(dpGeo, new THREE.PointsMaterial({ size: 0.045, color: 0xd8ecff, transparent: true, opacity: 0.85, depthWrite: false, fog: true }));
  dpPts.frustumCulled = false; root.add(dpPts);
  drips.forEach((d) => { d.t = -d.phase; d.state = 0; });
  const mist = ctx.mist || [];
  mist.forEach((m) => { m.acc = R() * 2; });

  // ---------------------------------------------------------------- очаг (кухня) ----
  const fire = ctx.fire || null;
  let fireLight = null, embers = null;
  if (fire) {
    fireLight = new THREE.PointLight(0xff8a3a, 0, 11, 2); fireLight.position.set(fire.x, fire.y + 0.6, fire.z); root.add(fireLight);
    const g = new THREE.SphereGeometry(0.07, 8, 6);
    embers = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.9, 0.25), fog: true }), 7);
    embers.frustumCulled = false; root.add(embers);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 7; i++) { m.makeTranslation(fire.x + (R() - 0.5) * 0.4, fire.y + 0.05 + R() * 0.06, fire.z + (R() - 0.5) * 0.3); embers.setMatrixAt(i, m); }
  }
  let smokeT = 0, coffeeT = 0, musicT = 0;

  // ---------------------------------------------------------------- музыка ----
  const music = ctx.music = { playing: false, level: 0, id: 'oud_gallery', position: new THREE.Vector3(), tempo: 84 };
  let musicWas = false;

  const pot = new THREE.Vector3();
  out.update = (dt, t) => {
    root.worldToLocal(camL.copy(game.camera.position));
    // тени
    shT -= dt;
    if (shT <= 0) { shT = 0.12; pickShadows(); }
    updateShadows(dt);
    // капли и туман
    const L = lt();
    for (let i = 0; i < drips.length; i++) {
      const d = drips[i];
      const near = Math.abs(d.x - camL.x) < 40 && Math.abs(d.z - camL.z) < 40 && Math.abs(d.y1 - camL.y) < 12;
      if (!near) { dpPos[i * 3 + 1] = -99; d.state = 0; d.t = -R() * 3; continue; }
      d.t += dt;
      if (d.state === 0 && d.t >= 0) { d.state = 1; d.t = 0; }
      if (d.state === 1) {
        const H0 = d.ytop - d.y0, fall = Math.sqrt(2 * Math.max(0.3, H0) / 9.8) * 1.1;
        const k = d.t / fall;
        if (k >= 1) {
          d.state = 0; d.t = -d.period * (0.7 + R() * 0.6);
          dpPos[i * 3 + 1] = -99;
          const dist = Math.hypot(d.x - camL.x, d.z - camL.z);
          if (d.pool) L?.ripple?.(d.x, d.z);
          if (dist < 26 && (d.pool || R() < 0.7)) L?.onDrip?.(i, d.x, d.z, d.y0);
          L?.steam?.(d.x, d.y0 + 0.05, d.z, 1, 0.3, 0.05, [0.7, 0.8, 0.9], 0.3, 0.08);
        } else { dpPos[i * 3] = d.x; dpPos[i * 3 + 1] = d.ytop - H0 * k * k; dpPos[i * 3 + 2] = d.z; }
      } else dpPos[i * 3 + 1] = -99;
    }
    if (drips.length) dpGeo.attributes.position.needsUpdate = true;
    if (L?.steam) for (const m of mist) {
      if (Math.abs(m.x - camL.x) > 26 || Math.abs(m.z - camL.z) > 26 || Math.abs(m.y - camL.y) > 7) continue;
      m.acc -= dt;
      if (m.acc <= 0) { m.acc = (1 / m.rate) * (0.7 + R() * 0.6); L.steam(m.x, m.y, m.z, 1, m.spread, m.up, m.col, m.life, m.amp); }
    }
    // очаг
    if (fire && L) {
      const d = Math.hypot(fire.x - camL.x, fire.z - camL.z), near = d < 24 && Math.abs(fire.y - camL.y) < 6;
      const fl = 0.78 + 0.22 * Math.sin(t * 17) * Math.sin(t * 5.3 + 1) + 0.1 * Math.sin(t * 31);
      fireLight.intensity = near ? 8.5 * fl * (1 - smoothstep(14, 24, d)) : 0;
      if (embers) { embers.visible = near; embers.material.color.setRGB(2.4 * fl, 0.85 * fl, 0.22); }
      smokeT -= dt;
      if (near && smokeT <= 0) {
        smokeT = 0.22;
        L.steam(fire.x + (R() - 0.5) * 0.2, fire.y + 0.9, fire.z + (R() - 0.5) * 0.2, 1, 0.35, 0.65, [0.32, 0.3, 0.28], 1.7, 0.16);
        if (R() < 0.35) L.steam(fire.x + 0.1, fire.y + 0.85, fire.z, 1, 0.2, 0.9, [0.85, 0.6, 0.35], 0.9, 0.07);   // пряный парок с горшка
      }
    }
    // кофе
    const pour = crowd.npcs.find((n) => n.kind === 'coffee' && n.role === 'pour');
    if (pour && L) {
      const d = Math.hypot(pour.x - camL.x, pour.z - camL.z);
      coffeeT -= dt;
      if (d < 30 && coffeeT <= 0) {
        coffeeT = 1.1 + R() * 0.6;
        pot.set(pour.x + Math.sin(pour.yaw) * 0.35, pour.y + 1.15, pour.z + Math.cos(pour.yaw) * 0.35);
        L.steam(pot.x, pot.y, pot.z, 1, 0.15, 0.4, [0.9, 0.68, 0.4], 1.1, 0.09);
        if (R() < 0.3) game.bus.emit('sietch:coffee', { position: ctx.toWorld(pour.x, pour.y + 1.0, pour.z) });
      }
    }
    // музыка
    const mu = crowd.musician;
    if (mu) {
      const dm = Math.hypot(mu.x - camL.x, mu.z - camL.z);
      const lvl = clamp(1 - (dm - 6) / 34, 0, 1) * (game.space === 'sietch' ? 1 : 0);
      const on = lvl > 0.02 && !game.paused && !(game.cinematic?.active && game.cinematic.owner === 'shots');
      ctx.toWorld(mu.x, mu.y + 1.0, mu.z, music.position);
      music.playing = on; music.level = lvl;
      musicT -= dt;
      if (on !== musicWas || (on && musicT <= 0)) {
        musicWas = on; musicT = 0.5;
        game.bus.emit('sietch:music', { on, id: music.id, level: lvl, position: music.position.clone(), tempo: music.tempo, mood: 'calm' });
      }
    }
  };
  out.shadows = shadows;
  return out;
}
