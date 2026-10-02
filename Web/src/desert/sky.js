// Небо (аналитическая «пыльная» атмосфера), солнечный диск и ореол, солнце-DirectionalLight, полусфера, тени.
import * as THREE from 'three';
import { ENV, GLSL_COMMON } from './env.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // на дальней плоскости
}`;

const SKY_FRAG = /* glsl */`
varying vec3 vDir;
uniform float uClouds;
uniform vec3 uStormDir;
${GLSL_COMMON}
void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 tint = uSunColor / max(max(uSunColor.r, uSunColor.g), max(uSunColor.b, 1e-3));
  float yy = max(y, 0.0);
  float t = pow(yy, 0.52);
  vec3 sky = mix(uHorizon, uZenith, t);
  // охристая пыльная полоса у горизонта
  float band = exp(-yy * 7.0);
  sky = mix(sky, uFogColor * 1.05, band * (0.45 + 0.4 * uDust + 0.3 * uStorm));
  sky = mix(sky, uFogColor, smoothstep(0.02, -0.08, y));
  // Ми-рассеяние: широкий тёплый ореол + плотное гало
  float mu = max(dot(d, uSunDir), 0.0);
  float dustK = 0.55 + 1.3 * uDust + 0.6 * uStorm;
  vec3 glow = tint * (pow(mu, 4.0) * 0.12 + pow(mu, 24.0) * 0.35 + pow(mu, 220.0) * 1.1) * dustK;
  float sunUp = smoothstep(-0.05, 0.1, uSunDir.y);
  sky += glow * sunUp * smoothstep(-0.1, 0.1, y + 0.1);
  // солнечный диск
  float disc = smoothstep(0.99986, 0.99993, dot(d, uSunDir));
  float occl = 1.0 - 0.8 * clamp(uStorm * 1.2 + uDust * 0.5, 0.0, 1.0);
  sky += tint * disc * mix(22.0, 90.0, smoothstep(0.1, 0.5, uSunDir.y)) * occl * sunUp * smoothstep(-0.02, 0.04, y);
  // перистые облака (тонкие, вытянутые по ветру)
  if (y > 0.02 && uClouds > 0.01) {
    vec2 cuv = d.xz / (y + 0.16) * 0.9;
    cuv += uWind * uTime * 0.004;
    vec2 w = vec2(dot(cuv, uWind), dot(cuv, vec2(-uWind.y, uWind.x)));
    float c = rkFbm(vec2(w.x * 1.1, w.y * 4.5) + 3.0) * 0.8 + rkFbm(w * 7.0) * 0.35;
    float cl = smoothstep(0.95 - uClouds * 0.7, 1.12 - uClouds * 0.4, c) * smoothstep(0.02, 0.3, y) * 0.55;
    vec3 cc = mix(uHorizon * 1.1, tint * (0.9 + 0.8 * pow(mu, 6.0)), 0.5);
    sky = mix(sky, cc, cl);
  }
  // зернистость от бандинга
  sky += (rkHash12(gl_FragCoord.xy) - 0.5) * 0.004;
  gl_FragColor = vec4(sky, 1.0);
}`;

export function createSky(game) {
  const { scene, renderer } = game;
  const q = game.settings.quality;
  const skyU = { uClouds: { value: 0.1 }, uStormDir: { value: new THREE.Vector3(-1, 0, 1).normalize() } };
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    uniforms: Object.assign({}, ENV.uniforms, skyU),
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), mat);
  dome.scale.setScalar(8000);
  dome.frustumCulled = false;
  dome.renderOrder = -1000;
  scene.add(dome);

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = renderer.shadowMap.enabled;
  const R = q === 'high' ? 120 : 90;
  const mapSize = q === 'high' ? 4096 : 2048;
  sun.shadow.mapSize.set(mapSize, mapSize);
  const sc = sun.shadow.camera;
  sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 900;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.35;
  sun.shadow.radius = 2.0;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0x8aa4cc, 0xb08a60, 1.0);
  scene.add(hemi);

  const right = new THREE.Vector3(), upv = new THREE.Vector3(), tmp = new THREE.Vector3(), center = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function update(cam) {
    dome.position.copy(cam);
    // тени: окно следует за камерой, привязка к текселям в пространстве света
    const L = ENV.uniforms.uSunDir.value;
    center.copy(cam);
    game.camera.getWorldDirection(fwd);
    center.x += fwd.x * R * 0.35; center.z += fwd.z * R * 0.35;
    center.y = Math.max(0, cam.y - 3);
    const f = tmp.copy(L).negate();
    right.crossVectors(f, UP).normalize();
    upv.crossVectors(right, f).normalize();
    const texel = (2 * R) / mapSize;
    const cx = center.dot(right), cy = center.dot(upv);
    const sx = Math.round(cx / texel) * texel, sy = Math.round(cy / texel) * texel;
    center.addScaledVector(right, sx - cx).addScaledVector(upv, sy - cy);
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(L, 420);
    sun.target.updateMatrixWorld();
  }

  return { dome, sun, hemi, skyU, update, mat };
}
