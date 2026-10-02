// Ядро: объект game, общий для всех модулей, и игровой цикл.
// Модуль = функция create(game) → { update?(dt, t), lateUpdate?(dt, t), alwaysUpdate?: boolean }.
// Регистрация: game.add('worm', module). Доступ: game.worm, game.player и т. д.
import * as THREE from 'three';
import { bus } from './bus.js';
import { createInput } from './input.js';

export function createGame(canvas, settings) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, settings.quality === 'high' ? 2 : 1.25) * (settings.quality === 'low' ? 0.6 : 1));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = settings.quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 12000);
  scene.add(camera);

  const modules = [];
  const game = {
    THREE, renderer, scene, camera, bus, settings,
    input: createInput(canvas),
    time: 0,            // игровое время, с (с учётом timeScale)
    realTime: 0,
    dt: 0,
    timeScale: 1,
    paused: false,
    /** Кат-сцена: пока active=true, игрок не управляет камерой и персонажем. */
    cinematic: { active: false, owner: null },
    lang: settings.lang || (navigator.language?.startsWith('ru') ? 'RU' : 'EN'),
    zone: 'A1_Ridge',
    /** Текущее пространство: 'desert' | 'sietch'. */
    space: 'desert',
    /** Переопределяемый рендер (пост-обработка подменяет). */
    render: () => renderer.render(scene, camera),
    add(name, mod) { if (!mod) return null; game[name] = mod; modules.push({ name, mod }); return mod; },
    modules,
    /** Строка на текущем языке: t('ру', 'en') или t({RU, EN}). */
    t(ru, en) { if (typeof ru === 'object') return ru[game.lang] ?? ru.EN ?? ru.RU; return game.lang === 'RU' ? ru : (en ?? ru); },
    stats: { fps: 0 },
    /** Интерактивные точки: {position: Vector3, radius, label: {RU, EN}, tag, enabled, onInteract()} */
    interactables: [],
    /** Тряска камеры 0..1 (червь/тампер выставляют max, игрок применяет и гасит). */
    shake: 0,
    /** Земля текущего пространства: пустыня (game.world) или сиетч (game.sietch). */
    ground() { return game.space === 'sietch' ? game.sietch : game.world; },
    /** y — текущая высота ступней (для многоуровневых полов сиетча); можно не передавать. */
    heightAt(x, z, y) { return game.ground()?.heightAt?.(x, z, y) ?? 0; },
    surfaceAt(x, z) { return game.ground()?.surfaceAt?.(x, z) ?? 'sand'; },
    /** Выталкивает позицию (Vector3) из препятствий радиуса r; возвращает true, если было столкновение. */
    collide(pos, r) { return game.ground()?.collide?.(pos, r) ?? false; },
  };

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
    bus.emit('resize', { w: innerWidth, h: innerHeight });
  });

  let last = performance.now();
  let fpsAcc = 0, fpsN = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = Math.min(0.1, (now - last) / 1000);
    last = now;
    game.realTime += rawDt;
    fpsAcc += rawDt; fpsN++;
    if (fpsAcc > 0.5) { game.stats.fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    game.input.poll(rawDt);
    const dt = game.paused ? 0 : rawDt * game.timeScale;
    game.dt = dt;
    game.time += dt;
    for (const { name, mod } of modules) {
      if (!mod.update) continue;
      if (dt === 0 && !mod.alwaysUpdate) continue;
      try { mod.update(mod.alwaysUpdate ? rawDt : dt, game.time); } catch (e) { reportError(name, e); }
    }
    for (const { name, mod } of modules) {
      if (!mod.lateUpdate) continue;
      if (dt === 0 && !mod.alwaysUpdate) continue;
      try { mod.lateUpdate(mod.alwaysUpdate ? rawDt : dt, game.time); } catch (e) { reportError(name, e); }
    }
    try { game.render(rawDt); } catch (e) { reportError('render', e); }
    game.input.endFrame();
  }
  const reported = new Set();
  function reportError(name, e) {
    const key = `${name}:${e?.message}`;
    if (reported.has(key)) return;
    reported.add(key);
    console.error(`[${name}]`, e);
  }
  game.start = () => { last = performance.now(); requestAnimationFrame(frame); };
  return game;
}
