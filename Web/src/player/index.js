// ЗАГЛУШКА (заменяет агент «player»).
import * as THREE from 'three';
export function create(game) {
  const position = new THREE.Vector3(0, 1.7, 0);
  game.camera.position.set(0, 3, 8); game.camera.lookAt(0, 1.5, 0);
  return game.add('player', { position, noise: 0, moisture: 1, update() {} });
}
