// Окружение (IBL): PMREM-карта из процедурного неба + тёплый «песчаный» низ. scene.environment даёт металлу/ткани/хитину
// корректный рассеянный свет и отражения неба. Обновляется при смене времени суток/погоды (не чаще раза в секунду), 'low' — выключено.
import * as THREE from 'three';
import { ENV } from './env.js';

export function createEnvMap(game, sky) {
  const q = game.settings.quality;
  if (q === 'low') return null;
  const { renderer, scene } = game;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(sky.dome.geometry, sky.dome.material);
  dome.frustumCulled = false; dome.scale.setScalar(50); dome.renderOrder = -1000;
  env.add(dome);
  // нижняя полусфера: цвет песка, освещённого ключевым светом + небом (приближение отражённого света земли)
  const gMat = new THREE.MeshBasicMaterial({ color: 0x806040, side: THREE.BackSide, fog: false });
  const ground = new THREE.Mesh(new THREE.SphereGeometry(45, 24, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), gMat);
  ground.frustumCulled = false;
  env.add(ground);
  const sand = new THREE.Color('#CFB083');          // linear sRGB автоматически (Color из hex конвертируется в рабочее пространство)
  const tmp = new THREE.Color();

  let rt = null, age = 99, lastKey = new THREE.Vector3(9, 9, 9), lastNight = -1, lastStorm = -1;
  const size = q === 'high' ? 256 : 128;
  const api = {
    intensity: 0.55,
    refresh() {
      const kd = ENV.uniforms.uKeyDir.value, kc = ENV.uniforms.uKeyColor.value, am = ENV.uniforms.uAmbient.value;
      const sinE = Math.max(kd.y, 0);
      tmp.copy(sand);
      tmp.r *= kc.r * sinE * 0.30 + am.r * 0.55; tmp.g *= kc.g * sinE * 0.30 + am.g * 0.55; tmp.b *= kc.b * sinE * 0.30 + am.b * 0.55;
      gMat.color.copy(tmp);
      const prev = rt;
      rt = pm.fromScene(env, 0, 0.1, 200, { size });
      scene.environment = rt.texture;
      if (prev) prev.dispose();
      age = 0; lastKey.copy(kd); lastNight = ENV.uniforms.uNight.value; lastStorm = ENV.uniforms.uStorm.value;
    },
    update(dt, inDesert) {
      scene.environmentIntensity = inDesert ? api.intensity : 0;
      if (!inDesert) return;
      age += dt;
      const kd = ENV.uniforms.uKeyDir.value;
      const moved = Math.abs(kd.x - lastKey.x) + Math.abs(kd.y - lastKey.y) + Math.abs(kd.z - lastKey.z)
        + Math.abs(ENV.uniforms.uNight.value - lastNight) * 2 + Math.abs(ENV.uniforms.uStorm.value - lastStorm) * 2;
      if (!rt || (age > 1.0 && moved > 0.012) || age > 8) api.refresh();
    },
  };
  return api;
}
