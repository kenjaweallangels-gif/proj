// Пустыня Ракиса: ландшафт, песок, скала «Коготь Шайтана», небо, погода, атмосфера, пост-обработка.
// Регистрирует game.world, game.weather, game.post.
import * as THREE from 'three';
import { heightAt, normalAt, surfaceAt, solidSdf, masks } from './field.js';
import { ENV } from './env.js';
import { createFootprints } from './footprints.js';
import { createTerrain } from './terrain.js';
import { createSky } from './sky.js';
import { createWeather } from './weather.js';
import { createPost } from './post.js';
import { createClaw } from './rock.js';
import { createDressing } from './dressing.js';
import { createFx } from './fx.js';
import { SAFE_ISLANDS } from '../core/layout.js';

export function create(game) {
  const { scene, camera, bus } = game;
  game.desertCreated = true;

  const foot = createFootprints(game);
  const terrain = createTerrain(game, foot);
  const sky = createSky(game);

  const obstacles = [];   // круглые препятствия {x,z,r} (валуны, обломки)
  const world = {
    visible: true,
    exposureTrim: 1,
    sunDir: new THREE.Vector3(0.5, 0.5, 0.2).normalize(),
    heightAt: (x, z) => heightAt(x, z),
    normalAt(x, z, out) {
      const a = normalAt(x, z, [0, 1, 0]);
      if (out && out.set) return out.set(a[0], a[1], a[2]);
      return new THREE.Vector3(a[0], a[1], a[2]);
    },
    surfaceAt: (x, z) => surfaceAt(x, z),
    isSafe(x, z) { return surfaceAt(x, z) === 'rock'; },
    collide(pos, r = 0.4) { return collide(pos, r); },
    shadeAt(x, z) { return shadeAt(x, z); },
    addFootprint(x, z, yaw = 0, opts = {}) { foot.add(x, z, yaw, opts); },
    addObstacle(x, z, r) { obstacles.push({ x, z, r }); },
    setVisible(b) { setVisible(b); },
    _field: { masks, solidSdf },
  };

  const parts = [];
  const weather = createWeather(game, sky, world);
  const claw = createClaw(game, world);
  parts.push({ setVisible(b) { claw.group.visible = b; } });
  const dressing = createDressing(game, world);
  parts.push(dressing);
  const fx = createFx(game, world, terrain, weather);
  parts.push(fx);
  world.fx = fx;
  world.puff = fx.puff;

  // ---- коллизии ----
  const g2 = [0, 0];
  function collide(pos, r) {
    let hit = false;
    if (pos.x > 540 && pos.x < 880 && pos.z > -90 && pos.z < 650) {
      for (let it = 0; it < 3; it++) {
        const d = solidSdf(pos.x, pos.z);
        if (d >= r) break;
        const e = 0.25;
        let gx = solidSdf(pos.x + e, pos.z) - solidSdf(pos.x - e, pos.z);
        let gz = solidSdf(pos.x, pos.z + e) - solidSdf(pos.x, pos.z - e);
        const gl = Math.hypot(gx, gz) || 1;
        gx /= gl; gz /= gl;
        pos.x += gx * (r - d + 0.01); pos.z += gz * (r - d + 0.01);
        hit = true;
      }
    }
    for (const o of obstacles) {
      const dx = pos.x - o.x, dz = pos.z - o.z;
      const rr = o.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-3;
        pos.x = o.x + (dx / d) * rr; pos.z = o.z + (dz / d) * rr;
        hit = true;
      }
    }
    return hit;
  }

  // ---- тень (аналитически: Коготь + расщелина) ----
  function shadeAt(x, z) {
    const L = world.sunDir;
    if (L.y <= 0.02) return 0;
    const hl = Math.hypot(L.x, L.z) || 1e-4;
    const sx = L.x / hl, sz = L.z / hl, te = L.y / hl;
    const y0 = heightAt(x, z);
    let vis = 1;
    // Коготь
    const rel = [715 - x, 270 - z];
    const al = rel[0] * sx + rel[1] * sz;
    const dp = Math.abs(rel[0] * sz - rel[1] * sx);
    if (al > -320 && dp < 340) {
      const st = clawStations;
      for (let i = 0; i < st.length; i++) {
        const c = st[i];
        const rx = c.x - x, rz = c.z - z;
        const a = rx * sx + rz * sz;
        if (a < 0) continue;
        const d = Math.abs(rx * sz - rz * sx);
        if (d > c.r) continue;
        const s = a - Math.sqrt(c.r * c.r - d * d);
        const ry = y0 + te * Math.max(s, 0);
        const q = d / c.r;
        const top = c.top * (1 - 0.45 * q * q * q);
        const pen = 3 + 0.012 * s;
        const k = Math.min(1, Math.max(0, (ry - top + pen) / (2 * pen)));
        vis = Math.min(vis, k * k * (3 - 2 * k));
      }
    }
    // расщелина A4: всегда в тени
    if (x > 606 && x < 652 && Math.abs(z - 326) < 4.5) vis = Math.min(vis, 0.12);
    return vis;
  }
  const clawStations = ENV.uniforms.uClaw.value.map((v) => ({ x: v.x, z: v.y, r: v.z, top: v.w }));

  function setVisible(b) {
    world.visible = b;
    terrain.setVisible(b);
    sky.dome.visible = b; sky.sun.visible = b; sky.hemi.visible = b;
    for (const m of parts) m.setVisible?.(b);
    if (b) { game.renderer.toneMappingExposure = weather.exposure; if (savedFog !== undefined) scene.fog = savedFog; }
    else { savedFog = scene.fog; scene.fog = null; }
  }
  let savedFog;

  game.add('world', world);
  game.add('weather', weather);
  game.add('post', createPost(game, weather));

  scene.fog = new THREE.FogExp2(0xc8b79a, 0.0002);
  scene.background = null;

  // Подготовка: заливка клипмапа вокруг стартовой позиции камеры
  terrain.prime(camera.position.x, camera.position.z);

  const root = {
    update(dt, t) {
      ENV.uniforms.uTime.value = t;
      if (!world.visible) return;
      const cp = camera.position;
      terrain.update(cp);
      sky.update(cp);
      foot.update(dt, cp);
      fx.update(dt, t);
    },
    alwaysUpdate: false,
  };
  game.add('desertRoot', root);

  bus.on('space', ({ space }) => setVisible(space !== 'sietch'));
  // следы от шагов: событие footstep {x,z,yaw,surface,actor}; дубли с явными вызовами addFootprint отсекаются
  bus.on('footstep', (e) => {
    if (!e || !world.visible || e.surface === 'rock') return;
    foot.add(e.x, e.z, e.yaw || 0, { type: 'foot', depth: e.surface === 'packed' ? 0.45 : 1 });
  });
  world.parts = parts;
  world.terrain = terrain;
  world.sky = sky;
  world.foot = foot;
  world.addPart = (p) => { parts.push(p); return p; };

  return world;
}
