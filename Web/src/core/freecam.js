// Свободная зрительская камера для сцен (приезд червя, пожирание харвестера).
// Камера полностью отвязана от персонажа: WASD + мышь, Shift — быстро, Alt — медленно, Space/E — вверх, Q/Ctrl — вниз, колесо — скорость,
// в пределах ~1 км от игрока. Персонаж остаётся на месте; пока камера «прикреплена» к нему — он управляется как обычно.
// Игрок НИКОГДА не теряет управление принудительно: камера включается только клавишей F (в сценах — подсказка на экране).
//
// API (game.freecam):
//   available           — есть ли сейчас сцена, в которой камера доступна
//   active              — камера отвязана (идёт полёт)
//   setScene(key, on)   — сцена регистрирует/снимает себя (worm: 'devour' | 'encounter'); по окончании последней сцены камера возвращается сама
//   toggle() / attach() / detach()   — переключатель (F); attach() = вернуться к персонажу
//   place(pos, lookAt)  — поставить камеру (для скриптов/тестов); radius — предел от игрока, м
// Шина: 'freecam' {active}.
import * as THREE from 'three';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export function create(game) {
  const cam = game.camera;
  const scenes = new Set();
  const pos = new THREE.Vector3(), vel = new THREE.Vector3(), tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const blendFrom = new THREE.Vector3(), blendQ = new THREE.Quaternion(), tq = new THREE.Quaternion();
  const keys = new Set();
  let yaw = 0, pitch = 0, speed = 45, blend = -1, hintShown = false;
  let savedLock = false, lockedByUs = false;

  const fc = {
    active: false, radius: 1000, minAbove: 1.5,
    get available() { return scenes.size > 0 && game.space !== 'sietch'; },
    setScene(key, on) {
      const had = scenes.size > 0;
      if (on) scenes.add(key); else scenes.delete(key);
      if (!had && scenes.size > 0) offerHint();
      if (had && scenes.size === 0) { hintShown = false; if (fc.active) fc.attach(); hud(false); }
    },
    toggle() { return fc.active ? fc.attach() : fc.detach(); },
    /** Отвязать камеру от персонажа (она остаётся там, где была). Персонаж замирает, пока камера свободна. */
    detach() {
      if (fc.active || !fc.available) return false;
      fc.active = true; blend = -1;
      pos.copy(cam.position);
      cam.getWorldDirection(fwd);
      yaw = Math.atan2(fwd.z, fwd.x); pitch = Math.asin(clamp(fwd.y, -1, 1));
      vel.set(0, 0, 0);
      const p = game.player;
      if (p) { savedLock = !!p.inputLocked; if (p.setInputLocked) p.setInputLocked(true); else p.inputLocked = true; lockedByUs = true; }
      game.input.requestLock?.();
      hud(true);
      game.bus.emit('freecam', { active: true });
      return true;
    },
    /** Вернуться к персонажу (плавный перелёт камеры за плечо), управление персонажем возвращается. */
    attach() {
      if (!fc.active) return false;
      fc.active = false;
      blendFrom.copy(cam.position); blendQ.copy(cam.quaternion); blend = 0;
      const p = game.player;
      if (p && lockedByUs) { p.inputLocked = savedLock; lockedByUs = false; }
      hud(false);
      game.bus.emit('freecam', { active: false });
      return true;
    },
    place(p, lookAt) {
      pos.copy(p);
      if (lookAt) { tmp.copy(lookAt).sub(pos); yaw = Math.atan2(tmp.z, tmp.x); pitch = Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)); }
      vel.set(0, 0, 0);
      if (fc.active) apply();
    },
    get yaw() { return yaw; }, get pitch() { return pitch; }, get position() { return pos; },
    get speed() { return speed; }, set speed(v) { speed = clamp(+v || 45, 3, 600); },
  };

  // ---- ввод ----
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyF') {
      if (!fc.available && !fc.active) return;            // вне сцен F остаётся обычным «Взаимодействовать»
      if (game.paused || game.ui?.blocking) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (!e.repeat) fc.toggle();
      return;
    }
    if (fc.active && (e.code === 'Space' || e.code === 'ControlLeft' || e.code === 'KeyQ' || e.code === 'KeyE')) e.preventDefault();
    keys.add(e.code);
  }, true);
  addEventListener('keyup', (e) => keys.delete(e.code), true);
  addEventListener('blur', () => keys.clear());
  addEventListener('wheel', (e) => { if (fc.active) fc.speed = speed * (e.deltaY < 0 ? 1.25 : 0.8); }, { passive: true });

  // ---- интерфейс ----
  let box = null;
  function hud(on) {
    if (!box) {
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:30;padding:6px 14px;font:13px/1.3 system-ui,sans-serif;color:#f1e6c8;background:rgba(18,12,6,.55);border:1px solid rgba(241,230,200,.25);border-radius:4px;pointer-events:none;letter-spacing:.02em;display:none;white-space:nowrap';
      document.body.appendChild(box);
    }
    box.style.display = on ? 'block' : 'none';
    if (on) box.textContent = game.t('Свободная камера  ·  WASD + мышь, Shift — быстро, Space/Q — вверх/вниз  ·  F — вернуться к персонажу', 'Free camera  ·  WASD + mouse, Shift fast, Space/Q up/down  ·  F — back to character');
  }
  function offerHint() {
    if (hintShown) return; hintShown = true;
    game.ui?.hint?.({ RU: 'F — свободная камера: можно облететь сцену, пока персонаж стоит на месте.', EN: 'F — free camera: fly around the scene while your character stays put.' });
  }

  function apply() {
    const cp = Math.cos(pitch);
    cam.position.copy(pos);
    cam.lookAt(pos.x + cp * Math.cos(yaw), pos.y + Math.sin(pitch), pos.z + cp * Math.sin(yaw));
  }

  const mod = {
    update(dt) {
      if (!fc.active) return;
      if (!fc.available) { fc.attach(); return; }
      const p = game.player;
      if (p && !p.inputLocked) p.inputLocked = true;            // кто-то снял блокировку: держим, пока камера свободна
      // взгляд
      const l = game.input.look, D = Math.PI / 180;
      yaw += l.x * D; pitch = clamp(pitch - l.y * D, -1.5, 1.5);
      // движение
      const ax = game.input.axis();
      const up = (keys.has('Space') || keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') || keys.has('ControlLeft') ? 1 : 0) + (game.input.held('Stutter') ? 1 : 0);
      const fast = game.input.held('Sprint') ? 4.5 : 1, slow = keys.has('AltLeft') || keys.has('AltRight') ? 0.2 : 1;
      const cp = Math.cos(pitch);
      fwd.set(cp * Math.cos(yaw), Math.sin(pitch), cp * Math.sin(yaw));
      right.set(-Math.sin(yaw), 0, Math.cos(yaw));
      tmp.set(0, 0, 0).addScaledVector(fwd, ax.y).addScaledVector(right, ax.x); tmp.y += up;
      if (tmp.lengthSq() > 1) tmp.normalize();
      tmp.multiplyScalar(speed * fast * slow);
      const k = 1 - Math.exp(-7 * dt);
      vel.lerp(tmp, k);
      pos.addScaledVector(vel, dt);
      // пределы: ~1 км от персонажа, не под землёй
      if (p) {
        const dx = pos.x - p.position.x, dz = pos.z - p.position.z, d = Math.hypot(dx, dz);
        if (d > fc.radius) { pos.x = p.position.x + dx / d * fc.radius; pos.z = p.position.z + dz / d * fc.radius; }
      }
      const g = game.heightAt(pos.x, pos.z) + fc.minAbove;
      if (pos.y < g) { pos.y = g; if (vel.y < 0) vel.y = 0; }
      pos.y = Math.min(pos.y, 900);
      if (!Number.isFinite(pos.x + pos.y + pos.z)) pos.copy(cam.position);
    },
    // после камеры игрока (модуль player зарегистрирован раньше): перекрываем её позу
    lateUpdate(dt) {
      if (fc.active) {
        apply();
        const pl = game.player;
        if (pl?.figure) pl.figure.group.visible = true;          // свой персонаж виден и в режиме от первого лица
        game.figures?.setFigureView?.(cam.position);              // детализация фигур (наездники, спутники) — по положению свободной камеры
      } else if (blend >= 0) {
        blend += dt / 0.8;
        const e = blend >= 1 ? 1 : blend * blend * (3 - 2 * blend);
        tmp.copy(cam.position); tq.copy(cam.quaternion);
        cam.position.lerpVectors(blendFrom, tmp, e);
        cam.quaternion.copy(blendQ).slerp(tq, e);
        if (blend >= 1) blend = -1;
      }
    },
  };
  fc.update = mod.update; fc.lateUpdate = mod.lateUpdate;
  return fc;      // main.js: game.add('freecam', freecam.create(game))
}
