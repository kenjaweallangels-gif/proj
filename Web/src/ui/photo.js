// Фоторежим: свободная камера в радиусе 30 м от игрока, время заморожено (timeScale = 0), HUD скрыт.
// Управление (docs/ui/ui_design.md §5.11): WASD, Q/E вниз/вверх, Shift ×3, ЛКМ/ПКМ + мышь — обзор, колесо — FOV, Z/C — крен, H — легенда, Esc/P — выход.
import { el } from './util.js';

const RADIUS = 30, SPEED = 6, FOV_MIN = 20, FOV_MAX = 110;

export function createPhoto(game, root, ctx) {
  const THREE = game.THREE;
  const cam = game.camera;
  const legend = el('div', 'photo-legend', root);
  const vals = el('div', 'vals', legend), keysEl = el('div', 'keys', legend);
  legend.style.display = 'none';

  let active = false, prevScale = 1, legendHidden = false;
  const keys = new Set();
  const saved = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 60 };
  const center = new THREE.Vector3(), pos = new THREE.Vector3();
  let yaw = 0, pitch = 0, roll = 0, fov = 60, drag = false;
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const fwd = new THREE.Vector3(), right = new THREE.Vector3();

  function enter() {
    if (active) return;
    active = true;
    saved.pos.copy(cam.position); saved.quat.copy(cam.quaternion); saved.fov = cam.fov;
    eul.setFromQuaternion(cam.quaternion, 'YXZ');
    yaw = eul.y; pitch = eul.x; roll = 0; fov = cam.fov;
    pos.copy(cam.position);
    center.copy(game.player?.position ?? cam.position); center.y = cam.position.y;
    prevScale = game.timeScale; game.timeScale = 0;
    keys.clear();
    legend.style.display = ''; legend.classList.toggle('hide', legendHidden);
    renderLegend();
    game.audio?.event?.('UI.PhotoShutter');
    game.bus.emit('photo', { active: true });
  }
  function exit() {
    if (!active) return;
    active = false;
    cam.position.copy(saved.pos); cam.quaternion.copy(saved.quat); cam.fov = saved.fov; cam.updateProjectionMatrix();
    game.timeScale = prevScale || 1;
    legend.style.display = 'none';
    game.bus.emit('photo', { active: false });
  }
  function reset() { pos.copy(saved.pos); eul.setFromQuaternion(saved.quat, 'YXZ'); yaw = eul.y; pitch = eul.x; roll = 0; fov = saved.fov; }

  function renderLegend() {
    const d = pos.distanceTo(center);
    vals.textContent = `FOV ${Math.round(fov)} · ${game.t('до игрока', 'from player')} ${d.toFixed(1)} ${game.t('м', 'm')} · ${game.t('крен', 'roll')} ${Math.round(roll * 180 / Math.PI)}°`;
    keysEl.textContent = game.t(
      'WASD движение · Shift быстрее · Q/E вниз/вверх · зажать ЛКМ/ПКМ — обзор · колесо — FOV · Z/C крен · H скрыть · Esc выход',
      'WASD move · Shift faster · Q/E down/up · hold LMB/RMB to look · wheel — FOV · Z/C roll · H hide · Esc exit');
  }

  addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.code === 'KeyH' && !e.repeat) { legendHidden = !legendHidden; legend.classList.toggle('hide', legendHidden); }
    else if (e.code === 'Backspace') reset();
    keys.add(e.code);
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  addEventListener('mousedown', (e) => { if (active && (e.button === 0 || e.button === 2)) drag = true; });
  addEventListener('mouseup', () => { drag = false; });
  addEventListener('mousemove', (e) => {
    if (!active || !drag) return;
    yaw -= e.movementX * 0.0035 * (fov / 60);
    pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0035 * (fov / 60)));
  });
  addEventListener('wheel', (e) => {
    if (!active) return;
    e.preventDefault();
    fov = Math.max(FOV_MIN, Math.min(FOV_MAX, fov + Math.sign(e.deltaY) * 3));
  }, { passive: false });

  function update(dt) {
    if (!active) return;
    // геймпад: левый стик — движение, правый — обзор, триггеры — вниз/вверх
    const gp = navigator.getGamepads?.()[0];
    let mx = 0, mz = 0, my = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    if (keys.has('KeyE')) my += 1;
    if (keys.has('KeyQ')) my -= 1;
    if (keys.has('KeyZ')) roll -= dt * 0.6;
    if (keys.has('KeyC')) roll += dt * 0.6;
    let fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
      mx += dz(gp.axes[0] || 0); mz -= dz(gp.axes[1] || 0);
      yaw -= dz(gp.axes[2] || 0) * dt * 1.8; pitch = Math.max(-1.5, Math.min(1.5, pitch - dz(gp.axes[3] || 0) * dt * 1.4));
      my += (gp.buttons[7]?.value || 0) - (gp.buttons[6]?.value || 0);
      if (gp.buttons[10]?.pressed) fast = true;
    }
    const sp = SPEED * (fast ? 3 : 1) * dt;
    fwd.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    pos.addScaledVector(fwd, mz * sp).addScaledVector(right, mx * sp);
    pos.y += my * sp;
    // сфера 30 м вокруг точки входа
    const off = pos.clone().sub(center);
    if (off.length() > RADIUS) pos.copy(center).addScaledVector(off.normalize(), RADIUS);
    const gh = game.heightAt?.(pos.x, pos.z);
    if (Number.isFinite(gh)) pos.y = Math.max(pos.y, gh + 0.4);
    cam.position.copy(pos);
    eul.set(pitch, yaw, roll, 'YXZ'); cam.quaternion.setFromEuler(eul);
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    renderLegend();
  }
  return { enter, exit, update, get active() { return active; } };
}
