// Пул пылевых клубов (скольжение по склону, шаги бегом, удар тампера).
import * as THREE from 'three';

export function createPuffs(game, count = 28) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const pool = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, color: '#d9bd8e', transparent: true, depthWrite: false, opacity: 0 });
    const s = new THREE.Sprite(mat); s.visible = false; s.renderOrder = 5;
    game.scene.add(s);
    pool.push({ s, mat, life: 0, max: 1, vel: new THREE.Vector3(), size: 0.3, grow: 1 });
  }
  let cursor = 0;
  return {
    spawn(x, y, z, vx = 0, vy = 0.6, vz = 0, size = 0.3, life = 0.9, grow = 2.2) {
      const p = pool[cursor++ % pool.length];
      p.s.position.set(x, y, z); p.vel.set(vx, vy, vz); p.size = size; p.life = p.max = life; p.grow = grow;
      p.s.visible = true;
    },
    update(dt) {
      for (const p of pool) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { p.s.visible = false; continue; }
        const k = 1 - p.life / p.max;
        p.s.position.addScaledVector(p.vel, dt);
        p.vel.multiplyScalar(Math.exp(-dt * 1.5));
        p.s.scale.setScalar(p.size * (1 + k * p.grow));
        p.mat.opacity = 0.55 * (1 - k) * Math.min(1, k * 8);
      }
    },
  };
}
