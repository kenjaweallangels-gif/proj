// ЗАГЛУШКА (заменяет агент «desert»).
import * as THREE from 'three';
export function create(game) {
  const { scene } = game;
  scene.background = new THREE.Color('#b8c4cf');
  scene.add(new THREE.HemisphereLight('#cfd8e0', '#a07850', 1.2));
  const sun = new THREE.DirectionalLight('#fff1dc', 3); sun.position.set(100, 80, 40); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: '#c9a878' }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  game.add('weather', { request() {}, windDir: new THREE.Vector3(1, 0, 0), windSpeed: 5, storm: 0, current: 'Dawn_Ridge' });
  return game.add('world', { heightAt: () => 0, surfaceAt: () => 'sand', isSafe: () => false, addFootprint() {} });
}
