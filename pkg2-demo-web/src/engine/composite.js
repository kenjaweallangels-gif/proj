// Вид «глазами сборщика»: реальность + голограммы только в окне дисплея очков + оправа, нос, затемнение линз,
// размытие периферии, моргание. Шейдер — из эталонной страницы reference/vzglyad_sborshchika.html (упрощён).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LAYER_HOLO, LAYER_LABEL, LAYER_REAL } from './holo.js';

/**
 * Фотореалистичная цепочка: сцена (HDR, MSAA) → затенение в щелях и углах (GTAO) → ореол ярких источников (bloom)
 * → тональная компрессия и sRGB (OutputPass). quality: 'high' — всё, 'low' — без AO и bloom (слабая графика).
 * AO считается по отдельной камере-двойнику только со слоем реальности: голограммы, подписи и конусы его не портят.
 */
// Защита от NaN/Inf: битая нормаль в чужом GLB даёт NaN в одном пикселе, а bloom и размытие растаскивают его на весь кадр.
const Sanitize = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
  void main(){ vec4 c = texture2D(tDiffuse, vUv);
    if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
    gl_FragColor = vec4(min(c.rgb, vec3(64.0)), c.a); }`,
};

export class PhotoChain {
  constructor(renderer, scene, camera, { quality = 'high' } = {}) {
    this.camera = camera;
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
    this.composer.addPass(new RenderPass(scene, camera));
    this.aoCam = camera.clone();
    if (quality !== 'low') {
      this.composer.addPass(new ShaderPass(Sanitize));
      this.ao = new GTAOPass(scene, this.aoCam, 4, 4);
      this.ao.updateGtaoMaterial({ radius: 0.22, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 16, distanceFallOff: 1 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.ao.blendIntensity = 0.95;
      this.composer.addPass(this.ao);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.16, 0.55, 1.6);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
  }

  addPass(p) { this.composer.addPass(p); }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }

  render(dt) {
    if (this.ao) {
      this.aoCam.copy(this.camera);
      this.aoCam.layers.set(LAYER_REAL);
    }
    this.composer.render(dt);
  }
}

/** Окно дисплея VITURE Luma Ultra: 52° по диагонали, 16:10 → ≈44,9° × 29,0°, центр чуть ниже взгляда. */
export function glassesWindow(diagDeg = 52, aspect = 1.6, centerDeg = [0, -2]) {
  const td = Math.tan(THREE.MathUtils.degToRad(diagDeg / 2));
  const tv = td / Math.sqrt(1 + aspect * aspect);
  const v = THREE.MathUtils.radToDeg(2 * Math.atan(tv));
  const h = THREE.MathUtils.radToDeg(2 * Math.atan(tv * aspect));
  return { h, v, cx: centerDeg[0], cy: centerDeg[1] };
}

const Shader = {
  uniforms: {
    tDiffuse: { value: null }, tHolo: { value: null }, res: { value: new THREE.Vector2(1, 1) }, tanV: { value: 1 },
    aspect: { value: 1 }, gaze: { value: new THREE.Vector2() }, trans: { value: 0.4 }, glassesOn: { value: 1 },
    blink: { value: 0 }, time: { value: 0 }, uBlur: { value: 1 }, uFrame: { value: 1 }, uFull: { value: 0 },
    flash: { value: 0 }, disp: { value: new THREE.Vector4(0, -2, 22.45, 14.5) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */`
  uniform sampler2D tDiffuse; uniform sampler2D tHolo; uniform vec2 res; uniform float tanV; uniform float aspect;
  uniform vec2 gaze; uniform float trans; uniform float glassesOn; uniform float blink; uniform float time;
  uniform float uBlur; uniform float uFrame; uniform float uFull; uniform float flash; uniform vec4 disp;
  varying vec2 vUv;
  const vec2 P[12] = vec2[12](vec2(-0.326,-0.406),vec2(-0.840,-0.074),vec2(-0.696,0.457),vec2(-0.203,0.621),vec2(0.962,-0.195),vec2(0.473,-0.480),vec2(0.519,0.767),vec2(0.185,-0.893),vec2(0.507,0.064),vec2(0.896,0.412),vec2(-0.322,-0.933),vec2(-0.792,-0.598));
  float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
  void main(){
    vec2 ndc = vUv * 2.0 - 1.0;
    vec2 tn = vec2(ndc.x * tanV * aspect, ndc.y * tanV);
    vec2 a = degrees(vec2(atan(tn.x), atan(tn.y / sqrt(1.0 + tn.x * tn.x))));   // угол от оси взгляда, градусы
    float ecc = length(a - gaze);
    float r = uBlur * smoothstep(22.0, 72.0, ecc) * 3.2 * (res.y / 900.0);
    vec3 col = texture2D(tDiffuse, vUv).rgb;
    if (any(isnan(col))) col = vec3(0.0);
    if (r > 0.35) { vec3 acc = col; for (int i = 0; i < 12; i++) acc += texture2D(tDiffuse, vUv + P[i] * r / res).rgb; col = acc / 13.0; }
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(l), uBlur * 0.25 * smoothstep(34.0, 72.0, ecc));
    float lensSD = sdBox(a - vec2(0.0, -6.0), vec2(56.0, 26.0), 16.0);
    float inLens = glassesOn * (1.0 - smoothstep(-2.5, 2.5, lensSD));
    col *= mix(vec3(1.0), pow(trans, 0.45) * vec3(0.95, 1.0, 0.985), inLens);
    col += vec3(inLens * smoothstep(40.0, 0.0, length(a - vec2(-30.0, 12.0))) * 0.035);
    float housing = glassesOn * uFrame * smoothstep(16.5, 22.5, a.y) * (1.0 - smoothstep(57.0, 68.0, abs(a.x)));
    col = mix(col, vec3(0.016, 0.018, 0.021) + vec3(0.03) * (1.0 - smoothstep(19.0, 30.0, a.y)), housing * 0.97);
    float rim = glassesOn * uFrame * (1.0 - smoothstep(0.6, 6.0, abs(lensSD)));
    col = mix(col, vec3(0.018, 0.02, 0.024), rim * 0.78 * (1.0 - housing));
    float w = max(0.0, -20.0 - a.y) * 0.7 + 1.0;
    float nose = uFrame * (1.0 - smoothstep(0.0, 9.0, abs(a.x) - w)) * smoothstep(-18.0, -34.0, a.y);
    col = mix(col, vec3(0.26, 0.19, 0.16) * (0.8 + 0.2 * smoothstep(-40.0, -22.0, a.y)), nose * 0.3);
    float cheek = uFrame * smoothstep(-27.0, -42.0, a.y) * smoothstep(12.0, 34.0, abs(a.x));
    col = mix(col, vec3(0.15, 0.11, 0.10), cheek * 0.45);
    vec4 h = texture2D(tHolo, vUv);
    vec3 g = vec3(0.0); for (int i = 0; i < 12; i++) g += texture2D(tHolo, vUv + P[i] * 2.2 / res).rgb; g /= 12.0;
    float rsd = sdBox(a - disp.xy, disp.zw, 1.2);
    float dsd = mix(rsd, lensSD + 3.5, uFull);
    float dm = glassesOn * (1.0 - smoothstep(-0.3, mix(0.3, 2.5, uFull), dsd)) * (1.0 - housing * uFull);
    col += pow(max(h.rgb + g * 0.28, 0.0), vec3(1.0 / 2.2)) * dm * 0.92 + vec3(0.005) * dm;
    col += glassesOn * vec3(0.25, 0.9, 0.75) * (1.0 - smoothstep(0.0, 0.35, abs(dsd))) * 0.18;   // граница окна (еле видна)
    vec2 q = vUv - 0.5; q.x *= aspect;
    col *= 1.0 - 0.45 * smoothstep(0.6, 1.1, length(q * vec2(0.85, 1.3)));
    col = mix(col, vec3(1.0), flash * 0.45);
    float lt = mix(62.0, -3.0, blink), lb = mix(-62.0, -3.0, blink);
    float lid = max(smoothstep(lt - 5.0, lt + 1.0, a.y), smoothstep(lb + 5.0, lb - 1.0, a.y));
    col = mix(col, vec3(0.035, 0.014, 0.012), lid);
    col += (hash(vUv * res + fract(time) * 100.0) - 0.5) * 0.007;
    gl_FragColor = vec4(col, 1.0);
  }`,
};

export class EyeView {
  constructor(renderer, scene, camera, win = glassesWindow(), { quality = 'high' } = {}) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.win = win;
    const rt = () => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new PhotoChain(renderer, scene, camera, { quality });
    this.pass = new ShaderPass(Shader);
    this.composer.addPass(this.pass);
    this.rtHolo = rt();
    this.u = this.pass.uniforms;
    this.u.tHolo.value = this.rtHolo.texture;
    this.u.disp.value.set(win.cx, win.cy, win.h / 2, win.v / 2);
    this.blinkT = 3;
  }

  setSize(w, h, pr) {
    this.composer.setSize(w, h, pr);
    this.rtHolo.setSize(w * pr, h * pr);
    this.u.res.value.set(w * pr, h * pr);
    this.u.aspect.value = w / h;
    this.u.tanV.value = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
  }

  /** Прямоугольник окна дисплея в пикселях канвы — для HUD (DOM поверх). */
  windowRect(w, h) {
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const tanH = tanV * (w / h);
    const { cx, cy, h: wh, v: wv } = this.win;
    const toX = (deg) => (0.5 + Math.tan(THREE.MathUtils.degToRad(deg)) / tanH / 2) * w;
    const toY = (deg) => (0.5 - Math.tan(THREE.MathUtils.degToRad(deg)) / tanV / 2) * h;
    if (this.u.uFull.value > 0.5) return { x: w * 0.08, y: h * 0.12, w: w * 0.84, h: h * 0.6 };
    const x0 = toX(cx - wh / 2), x1 = toX(cx + wh / 2), y0 = toY(cy + wv / 2), y1 = toY(cy - wv / 2);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  render(time, dt) {
    const { renderer, scene, camera } = this;
    this.u.time.value = time;
    this.u.flash.value = Math.max(0, this.u.flash.value - dt * 2.2);
    // моргание раз в 3–6 с
    this.blinkT -= dt;
    const b = this.blinkT < 0 ? Math.max(0, 1 - Math.abs(this.blinkT + 0.09) / 0.09) : 0;
    if (this.blinkT < -0.18) this.blinkT = 3 + Math.random() * 3;
    this.u.blink.value = b;
    // проход голограмм: тот же ракурс, только слой 1, прозрачный фон
    const bg = scene.background, fog = scene.fog;
    scene.background = null; scene.fog = null;
    camera.layers.set(LAYER_HOLO);
    renderer.setRenderTarget(this.rtHolo);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    scene.background = bg; scene.fog = fog;
    camera.layers.set(LAYER_REAL);
    camera.layers.enable(LAYER_LABEL);
    this.composer.render(dt);
  }

  photoFlash() { this.u.flash.value = 1; }
}
