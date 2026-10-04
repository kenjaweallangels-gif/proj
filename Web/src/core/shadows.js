// Троттлинг карты теней солнца: когда кадр тяжёлый (DRS уже снизил разрешение), тени перерисовываются не каждый кадр, а через 2–3.
// В нормальном режиме (DRS level 0) — каждый кадр, как раньше. Карта хранит матрицу последнего рендера, так что пропуск кадров
// даёт лишь небольшое запаздывание движущихся теней (≤ 2 кадров ≈ 3–6 см у ходьбы) и не ломает приёмников.
import * as THREE from 'three';

export function createShadowThrottle(game) {
  let lights = [], scanT = 0, frame = 0;
  const lastCam = new THREE.Vector3(1e9, 0, 0);
  function scan() {
    lights = [];
    game.scene.traverse((o) => { if (o.isDirectionalLight && o.castShadow && o.shadow) lights.push(o); });
    for (const L of lights) L.shadow.autoUpdate = false;
  }
  return {
    /** Вызывать перед рендером. level — текущий уровень DRS (0 — без ограничений). */
    update(level, dt) {
      if ((scanT -= dt) <= 0) { scanT = 2; scan(); }
      if (!lights.length) return;
      const N = level >= 4 ? 3 : level >= 1 ? 2 : 1;
      frame++;
      const cam = game.camera.position;
      // телепорт/резкий сдвиг камеры — обновляем сразу, иначе тени «уедут»
      const moved = cam.distanceToSquared(lastCam) > 16;
      if (N === 1 || frame % N === 0 || moved) {
        for (const L of lights) L.shadow.needsUpdate = true;
        lastCam.copy(cam);
      }
    },
  };
}
