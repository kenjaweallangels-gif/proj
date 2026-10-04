// Эффекты харвестера: пул частиц (шлейф пряной пыли, песок из-под гусениц и ковша, дым труб, тепловое марево),
// лучи проблесковых маяков-клаксонов.
import * as THREE from 'three';
import { ENV, GLSL_COMMON } from '../desert/env.js';

export const P_SPICE = 0, P_SAND = 1, P_SMOKE = 2, P_HEAT = 3;

export function createParticles(game, N) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const aA = mk(), aV = mk(), aS = mk(), aT = mk();
  geo.setAttribute('aA', aA); geo.setAttribute('aV', aV); geo.setAttribute('aS', aS); geo.setAttribute('aT', aT);
  geo.instanceCount = N;
  for (let i = 0; i < N; i++) { aV.array[i * 4 + 3] = 1e-3; aA.array[i * 4 + 3] = -1e4; }

  const uNow = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: Object.assign({}, ENV.uniforms, { uNow }),
    vertexShader: /* glsl */`
      attribute vec4 aA; attribute vec4 aV; attribute vec4 aS; attribute vec4 aT;
      uniform float uNow;
      varying vec2 vUv; varying float vAl; varying vec3 vWP; varying float vSeed; varying float vType; varying float vK;
      ${GLSL_COMMON}
      void main(){
        float age = max(uNow - aA.w, 0.0);
        float k = clamp(age / aV.w, 0.0, 1.0);
        float drag = max(aT.w, 0.01);
        vec3 p = aA.xyz + aV.xyz * (1.0 - exp(-age * drag)) / drag;
        p.xz += uWind * (0.35 + 0.65 * uWindSpeed * 0.12) * aT.y * age;
        p.y += aT.z * age;
        float s = aS.x * (1.0 + aS.w * k);
        vec3 toCam = normalize(cameraPosition - p);
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
        vec3 up = cross(toCam, right);
        // вращение спрайта
        float ang = aS.z * 6.28 + age * (aS.z - 0.5) * 0.6;
        float ca = cos(ang), sa = sin(ang);
        vec2 q = vec2(position.x * ca - position.y * sa, position.x * sa + position.y * ca);
        vec3 wp = p + (right * q.x + up * q.y) * s;
        float fadeIn = smoothstep(0.0, 0.07, k);
        vAl = aS.y * fadeIn * pow(1.0 - k, 1.3) * step(aA.w + 0.0001, uNow) * step(age, aV.w);
        vUv = position.xy; vWP = wp; vSeed = aS.z; vType = aT.x; vK = k;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying float vAl; varying vec3 vWP; varying float vSeed; varying float vType; varying float vK;
      ${GLSL_COMMON}
      void main(){
        float r = length(vUv);
        if (r > 1.0) discard;
        float n = rkNoise(vUv * 2.2 + vSeed * 17.0 + uTime * 0.15) * 0.65 + 0.35;
        float a = smoothstep(1.0, 0.15, r) * n * vAl;
        if (a < 0.004) discard;
        vec3 lit = uSunColor * 0.3 + uAmbient * 0.95;
        vec3 col;
        if (vType < 0.5) {           // пряная пыль: оранжевый → бежевый
          col = mix(vec3(1.0, 0.38, 0.07), vec3(0.85, 0.5, 0.26), smoothstep(0.0, 0.8, vK));
          col = col * lit * 0.85 + vec3(1.0, 0.35, 0.08) * 0.03 * (1.0 - vK);
        } else if (vType < 1.5) {    // песок
          col = vec3(0.78, 0.6, 0.38) * lit;
        } else if (vType < 2.5) {    // дизельный дым
          col = mix(vec3(0.045, 0.04, 0.036), vec3(0.28, 0.25, 0.22), vK) * (lit * 0.7 + 0.1);
        } else {                     // горячий пар/марево
          col = vec3(0.95, 0.9, 0.82) * lit;
          a *= 0.5;
        }
        col = rkApplyFog(col, vWP);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.renderOrder = 9;
  let head = 0, dirty = false;
  const rnd = Math.random;
  /** emit(type, x,y,z, vx,vy,vz, life, size, alpha, grow, {wind, buoy, drag}) */
  function emit(type, x, y, z, vx, vy, vz, life, size, alpha, grow, o = {}) {
    const i = head; head = (head + 1) % N;
    aA.array.set([x, y, z, uNow.value], i * 4);
    aV.array.set([vx, vy, vz, life], i * 4);
    aS.array.set([size, alpha, rnd(), grow], i * 4);
    aT.array.set([type, o.wind ?? 1, o.buoy ?? 0, o.drag ?? 0.5], i * 4);
    dirty = true;
  }
  function flush(now) {
    uNow.value = now;
    if (dirty) { aA.needsUpdate = aV.needsUpdate = aS.needsUpdate = aT.needsUpdate = true; dirty = false; }
  }
  return { mesh, emit, flush, size: N };
}

/** Лучи маяков (инстансы-конусы, аддитивные). */
export function createBeams(positions) {
  const g = new THREE.ConeGeometry(2.4, 15, 10, 1, true);
  g.rotateZ(-Math.PI / 2); g.translate(7.5, 0, 0);   // вершина в начале, раструб вдоль +x
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uI: { value: 0 } },
    vertexShader: `varying float vU; varying vec3 vN; varying vec3 vV;
      void main(){ vU = position.x / 15.0; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uI; varying float vU; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float a = (1.0 - vU) * (1.0 - vU) * f * 0.5 * uI;
        gl_FragColor = vec4(vec3(1.0, 0.55, 0.1) * a * 2.2, a); }`,
  });
  const mesh = new THREE.InstancedMesh(g, mat, positions.length * 2);
  mesh.frustumCulled = false; mesh.renderOrder = 10;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), yAx = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  function update(angle, intensity) {
    mat.uniforms.uI.value = intensity;
    mesh.visible = intensity > 0.01;
    if (!mesh.visible) return;
    positions.forEach((pp, i) => {
      for (let k = 0; k < 2; k++) {
        q.setFromAxisAngle(yAx, angle * (i % 2 ? -1 : 1) + k * Math.PI + i * 1.3);
        m4.compose(p.set(pp[0], pp[1], pp[2]), q, one);
        mesh.setMatrixAt(i * 2 + k, m4);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, update };
}
