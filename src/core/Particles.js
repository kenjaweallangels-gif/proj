import * as THREE from 'three';
import { LAYERS } from './constants.js';

/**
 * GPU-animated sprite particle pool. Particles move ballistically (vacuum: no drag) and are
 * fully evaluated in the vertex shader from (birth, life, velocity), so emitting is the only
 * CPU cost. Used for RCS thruster puffs, vents, ice crystals, debris glints.
 *
 *   particles.emit({ position, velocity, life, size0, size1, color, alpha })
 *   particles.emitCone({ position, direction, speed, spread, count, life, size0, size1, color, alpha, spin })
 */
const _color = new THREE.Color();

export class ParticleSystem {
  constructor(scene, { max = 4000, texture = null } = {}) {
    this.max = max;
    this.cursor = 0;
    this.time = 0;
    const geo = new THREE.BufferGeometry();
    this.aPos = new Float32Array(max * 3);
    this.aVel = new Float32Array(max * 3);
    this.aParams = new Float32Array(max * 4);   // birth, life, size0, size1
    this.aColor = new Float32Array(max * 4);    // r g b alpha
    for (let i = 0; i < max; i++) { this.aParams[i * 4 + 0] = -1e9; this.aParams[i * 4 + 1] = 1; }
    geo.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aVel', new THREE.BufferAttribute(this.aVel, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aParams', new THREE.BufferAttribute(this.aParams, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 4).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1000 }, uMaxSize: { value: 512 }, uMap: { value: texture || ParticleSystem.defaultTexture() } },
      vertexShader: /* glsl */`
        attribute vec3 aVel; attribute vec4 aParams; attribute vec4 aColor;
        uniform float uTime; uniform float uScale; uniform float uMaxSize;
        varying vec4 vColor; varying float vAge;
        void main() {
          float age = (uTime - aParams.x) / max(aParams.y, 1e-4);
          vAge = age;
          float alive = step(0.0, age) * step(age, 1.0);
          vec3 p = position + aVel * (uTime - aParams.x);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float size = mix(aParams.z, aParams.w, age);
          gl_PointSize = alive * clamp(size * uScale / max(-mv.z, 0.05), 0.0, uMaxSize);
          gl_Position = alive > 0.5 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
          float fade = pow(1.0 - clamp(age, 0.0, 1.0), 1.6);
          vColor = vec4(aColor.rgb, aColor.a * fade);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap; varying vec4 vColor; varying float vAge;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor.rgb * t.a, vColor.a * t.a);
        }`,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 50;
    this.points.layers.set(LAYERS.NO_SHADOW);
    this.points.name = 'ParticleSystem';
    this._dirty = false;
    scene.add(this.points);
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._tmp3 = new THREE.Vector3();
    this._tmp4 = new THREE.Vector3();
  }

  static defaultTexture() {
    if (ParticleSystem._tex) return ParticleSystem._tex;
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace;
    ParticleSystem._tex = t; return t;
  }

  emit({ position, velocity, life = 1, size0 = 0.2, size1 = 1.0, color = 0xffffff, alpha = 1 }) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    const c = color instanceof THREE.Color ? color : _color.set(color);   // no per-particle allocation
    this.aPos[i * 3] = position.x; this.aPos[i * 3 + 1] = position.y; this.aPos[i * 3 + 2] = position.z;
    this.aVel[i * 3] = velocity.x; this.aVel[i * 3 + 1] = velocity.y; this.aVel[i * 3 + 2] = velocity.z;
    this.aParams[i * 4] = this.time; this.aParams[i * 4 + 1] = life; this.aParams[i * 4 + 2] = size0; this.aParams[i * 4 + 3] = size1;
    this.aColor[i * 4] = c.r; this.aColor[i * 4 + 1] = c.g; this.aColor[i * 4 + 2] = c.b; this.aColor[i * 4 + 3] = alpha;
    this._dirty = true;
  }

  /** Cone burst: `direction` unit vector, `spread` half-angle in radians. */
  emitCone({ position, direction, speed = 6, spread = 0.25, count = 8, life = 0.8, size0 = 0.08, size1 = 0.9, color = 0xffffff, alpha = 0.8, baseVelocity = null, speedJitter = 0.4, lifeJitter = 0.4 }) {
    const d = this._tmp.copy(direction).normalize();
    // orthonormal basis
    const t1 = this._tmp2.set(0, 1, 0); if (Math.abs(d.y) > 0.9) t1.set(1, 0, 0);
    t1.cross(d).normalize();
    const t2 = this._tmp3.crossVectors(d, t1);
    const v = this._tmp4;
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.tan(spread) * Math.sqrt(Math.random());
      v.copy(d).addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
      v.multiplyScalar(speed * (1 + (Math.random() - 0.5) * 2 * speedJitter));
      if (baseVelocity) v.add(baseVelocity);
      this.emit({ position, velocity: v, life: life * (1 + (Math.random() - 0.5) * 2 * lifeJitter), size0, size1, color, alpha });
    }
  }

  update(dt, renderer, camera) {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
    if (renderer && camera) {
      // perspective point-size scale: pixels per meter at distance 1
      const h = renderer.getSize(this._size || (this._size = new THREE.Vector2())).y * renderer.getPixelRatio();
      this.material.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      // a puff right in front of the visor must not cover the whole screen (fill rate)
      this.material.uniforms.uMaxSize.value = Math.max(16, Math.min(512, h * 0.35));
    }
    if (this._dirty) {
      for (const name of ['position', 'aVel', 'aParams', 'aColor']) this.geometry.attributes[name].needsUpdate = true;
      this._dirty = false;
    }
  }
}
