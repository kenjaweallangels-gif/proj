// Следы на песке: окно 64 м вокруг камеры, RT 1024² (6.25 см/тексель), R = глубина вмятины (м), G = высота вала (м).
// Штампы рисуются инстансами в RT (аддитивно), заживление и сдвиг окна — ping-pong проходом.
import * as THREE from 'three';
import { ENV } from './env.js';

const SIZE = 64, SNAP = 8;
const MAXSTAMPS = 96;

const STAMP_VERT = /* glsl */`
attribute vec4 aA;   // cx_ndc, cz_ndc, half-size (ndc), yaw
attribute vec4 aB;   // depth m, rim m, type, seed
varying vec2 vUv; varying vec4 vB;
void main(){
  float c = cos(aA.w), s = sin(aA.w);
  vec2 p = position.xy;                // квад -1..1, локальная ось +y = «вперёд»
  vec2 r = vec2(p.x * c + p.y * s, -p.x * s + p.y * c);
  float hs = aA.z * (aB.z > 0.5 && aB.z < 1.5 ? 1.0 : 1.35);
  vec2 q = aA.xy + r * hs;
  vUv = p; vB = aB;
  gl_Position = vec4(q, 0.0, 1.0);
}`;
const STAMP_FRAG = /* glsl */`
varying vec2 vUv; varying vec4 vB;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec2 p = vUv;
  float type = vB.z;
  float dent = 0.0, rim = 0.0;
  if (type < 0.5) {            // стопа: пятка + плюсна, вал у носка
    vec2 q = p / vec2(0.34, 0.8);
    q.y -= 0.0;
    float d = length(q);
    float shape = 1.0 - smoothstep(0.62, 1.0, d);
    float waist = 1.0 - 0.35 * smoothstep(-0.2, 0.25, p.y) * (1.0 - smoothstep(0.25, 0.5, p.y));
    float toe = smoothstep(-0.2, 0.7, p.y);
    dent = shape * waist * (0.75 + 0.35 * toe);
    rim = (smoothstep(0.82, 1.0, d) * (1.0 - smoothstep(1.0, 1.3, d))) * (0.4 + 0.9 * toe);
  } else if (type < 1.5) {     // колея червя: желоб с валами
    float x = abs(p.x);
    float wob = 0.9 + 0.2 * n2(vec2(p.y * 3.0 + vB.w, 1.0));
    float xx = x / wob;
    dent = (1.0 - smoothstep(0.35, 0.7, xx)) * (1.0 - smoothstep(0.7, 1.0, abs(p.y)));
    rim = smoothstep(0.55, 0.78, xx) * (1.0 - smoothstep(0.78, 1.0, xx)) * (1.0 - smoothstep(0.7, 1.0, abs(p.y)));
  } else if (type < 2.5) {     // кратер выхода
    float d = length(p) / 0.75;
    float bowl = 1.0 - smoothstep(0.0, 1.0, d);
    dent = bowl * bowl * (3.0 - 2.0 * bowl);
    rim = smoothstep(0.7, 1.0, d) * (1.0 - smoothstep(1.0, 1.33, d));
  } else {                     // тампер: лунка + кольцо
    float d = length(p);
    dent = (1.0 - smoothstep(0.0, 0.22, d)) + 0.35 * (1.0 - smoothstep(0.0, 0.7, d));
    rim = 0.5 * smoothstep(0.2, 0.36, d) * (1.0 - smoothstep(0.36, 0.6, d)) + 0.2 * smoothstep(0.62, 0.7, d) * (1.0 - smoothstep(0.7, 0.9, d));
  }
  gl_FragColor = vec4(dent * vB.x, rim * vB.y, 0.0, 0.0);
}`;

const HEAL_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tOld; uniform vec2 uOffset; uniform float uDecay; uniform float uSub;
varying vec2 vUv;
void main(){
  vec2 uv = vUv + uOffset;
  vec4 v = texture2D(tOld, uv);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) v = vec4(0.0);
  v.rg = max(v.rg * uDecay - uSub, 0.0);
  gl_FragColor = vec4(v.rg, 0.0, 0.0);
}`;

const _clr = new THREE.Color();
export function createFootprints(game) {
  const { renderer } = game;
  const q = game.settings.quality;
  const RES = q === 'low' ? 512 : 1024;
  const mk = () => new THREE.WebGLRenderTarget(RES, RES, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  let rtA = mk(), rtB = mk();
  const rect = { value: new THREE.Vector4(0, 0, SIZE, 1) };
  const uFoot = { value: rtA.texture };
  // «следы» сначала невидимы
  let enabled = true;

  // сцена штампов
  const quad = new THREE.PlaneGeometry(2, 2);
  const ig = new THREE.InstancedBufferGeometry();
  ig.index = quad.index; ig.setAttribute('position', quad.getAttribute('position'));
  const aA = new THREE.InstancedBufferAttribute(new Float32Array(MAXSTAMPS * 4), 4);
  const aB = new THREE.InstancedBufferAttribute(new Float32Array(MAXSTAMPS * 4), 4);
  aA.setUsage(THREE.DynamicDrawUsage); aB.setUsage(THREE.DynamicDrawUsage);
  ig.setAttribute('aA', aA); ig.setAttribute('aB', aB);
  ig.instanceCount = 0;
  const stampMat = new THREE.ShaderMaterial({
    vertexShader: STAMP_VERT, fragmentShader: STAMP_FRAG, depthTest: false, depthWrite: false, transparent: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  });
  const stampMesh = new THREE.Mesh(ig, stampMat); stampMesh.frustumCulled = false;
  const stampScene = new THREE.Scene(); stampScene.add(stampMesh);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const healMat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: HEAL_FRAG, depthTest: false, depthWrite: false,
    uniforms: { tOld: { value: null }, uOffset: { value: new THREE.Vector2() }, uDecay: { value: 1 }, uSub: { value: 0 } },
  });
  const healScene = new THREE.Scene();
  const healMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), healMat); healMesh.frustumCulled = false; healScene.add(healMesh);

  const queue = [];
  let healAcc = 0;
  let cx = 1e9, cz = 1e9;

  const DEFAULT = {
    foot: { size: 0.17, depth: 0.05, rim: 0.016, type: 0 },
    worm: { size: 15, depth: 0.9, rim: 0.5, type: 1 },
    crater: { size: 26, depth: 1.6, rim: 0.55, type: 2 },
    thumper: { size: 4, depth: 0.12, rim: 0.05, type: 3 },
  };
  const recent = [];
  function add(x, z, yaw = 0, opts = {}) {
    const type = opts.type || 'foot';
    const d = DEFAULT[type] || DEFAULT.foot;
    {
      // защита от дублей (игрок вызывает addFootprint сам + мы слушаем bus 'footstep')
      const now = game.realTime;
      const win = type === 'foot' ? 0.4 : 1.5, rad = type === 'foot' ? 0.35 : 3;
      for (const r of recent) if (r.type === type && now - r.t < win && Math.hypot(r.x - x, r.z - z) < rad) return;
      recent.push({ type, x, z, t: now }); if (recent.length > 24) recent.shift();
    }
    const size = opts.size ?? d.size;
    const depthScale = opts.depth ?? 1;
    if (queue.length < 400) queue.push({ x, z, yaw, size, depth: d.depth * depthScale, rim: d.rim * depthScale, type: d.type, seed: Math.random() * 100 });
  }

  function pass(scene, camera, target) {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  }

  function shiftWindow(nx, nz) {
    const dx = (nx - cx) / SIZE, dz = (nz - cz) / SIZE;
    if (Math.abs(dx) > 1 || Math.abs(dz) > 1 || cx > 1e8) {
      renderer.setRenderTarget(rtA); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.setRenderTarget(rtB); renderer.clear();
    } else {
      healMat.uniforms.tOld.value = rtA.texture;
      healMat.uniforms.uOffset.value.set(dx, dz);
      healMat.uniforms.uDecay.value = 1; healMat.uniforms.uSub.value = 0;
      pass(healScene, cam, rtB);
      [rtA, rtB] = [rtB, rtA];
    }
    cx = nx; cz = nz;
    rect.value.x = cx; rect.value.y = cz;
    uFoot.value = rtA.texture;
  }

  function update(dt, camPos) {
    if (!enabled) return;
    const nx = Math.round(camPos.x / SNAP) * SNAP, nz = Math.round(camPos.z / SNAP) * SNAP;
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(_clr); const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    const dist = Math.max(Math.abs(camPos.x - cx), Math.abs(camPos.z - cz));
    if (dist > 14 || cx > 1e8) shiftWindow(nx, nz);

    // заживление: полураспад 120 с в штиль, быстрее с ветром и бурей
    healAcc += dt;
    if (healAcc > 0.25) {
      const w = game.weather?.windSpeed ?? 3;
      const storm = game.weather?.storm ?? 0;
      const rate = (Math.LN2 / 120) * (1 + w / 6) + storm * Math.LN2 / 8;
      healMat.uniforms.tOld.value = rtA.texture;
      healMat.uniforms.uOffset.value.set(0, 0);
      healMat.uniforms.uDecay.value = Math.exp(-rate * healAcc);
      healMat.uniforms.uSub.value = 0.00002 * healAcc;
      pass(healScene, cam, rtB);
      [rtA, rtB] = [rtB, rtA];
      healAcc = 0;
    }
    // штампы
    if (queue.length) {
      const n = Math.min(queue.length, MAXSTAMPS);
      const batch = queue.splice(0, n);
      let k = 0;
      for (const s of batch) {
        const u = ((s.x - cx) / SIZE) * 2, v = ((s.z - cz) / SIZE) * 2;
        if (Math.abs(u) > 1.2 || Math.abs(v) > 1.2) continue;
        aA.array.set([u, v, (s.size / SIZE) * 2 * (s.type === 1 ? 1 : 1), s.yaw], k * 4);
        aB.array.set([s.depth, s.rim, s.type, s.seed], k * 4);
        k++;
      }
      if (k) {
        aA.needsUpdate = true; aB.needsUpdate = true; ig.instanceCount = k;
        renderer.setRenderTarget(rtA);
        renderer.render(stampScene, cam);
      }
    }
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    renderer.setClearColor(prevClear, prevAlpha);
  }

  return {
    rect, uFoot, get texture() { return rtA.texture; }, update, add,
    setEnabled(b) { enabled = b; rect.value.w = b ? 1 : 0; },
  };
}
