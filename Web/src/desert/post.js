// Пост-обработка: RenderPass → санитайзер (NaN/Inf) + марево по глубине + лучи света (god rays) → bloom → грейд → OutputPass.
// Защита от «чёрного экрана»: любой NaN/Inf/отрицательное значение HDR-буфера заменяется до bloom (иначе размытие размазывает его на весь кадр),
// финальный проход тоже проверяет значения; экспозиция проверяется на конечность.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { clamp, smoothstep } from '../core/util.js';
import { ENV } from './env.js';

const RAY_DEFAULT = new THREE.Color(1, 0.8, 0.55);
const ENV_NIGHT = () => ENV.uniforms.uNight.value;

const HDR_MAX = 600.0;
// Безопасное значение: NaN/Inf/отрицательное → 0, огромное → HDR_MAX (сравнения с NaN ложны → ветка «else»)
const SAFE_GLSL = /* glsl */`
vec3 rkSafe(vec3 c){
  bvec3 ok = bvec3(c.r >= 0.0 && c.r < ${HDR_MAX.toFixed(1)}, c.g >= 0.0 && c.g < ${HDR_MAX.toFixed(1)}, c.b >= 0.0 && c.b < ${HDR_MAX.toFixed(1)});
  return vec3(ok.r ? c.r : (c.r >= ${HDR_MAX.toFixed(1)} ? ${HDR_MAX.toFixed(1)} : 0.0), ok.g ? c.g : (c.g >= ${HDR_MAX.toFixed(1)} ? ${HDR_MAX.toFixed(1)} : 0.0), ok.b ? c.b : (c.b >= ${HDR_MAX.toFixed(1)} ? ${HDR_MAX.toFixed(1)} : 0.0));
}`;

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

// Только санитайзер — для 'low' (без depthTexture).
const SanitizeShader = {
  name: 'RakisSanitize',
  uniforms: { tDiffuse: { value: null } },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; varying vec2 vUv;
    ${SAFE_GLSL}
    void main(){ vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(rkSafe(c.rgb), 1.0); }`,
};

const AtmoShader = {
  name: 'RakisAtmo',
  defines: { RAY_STEPS: 28 },
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null },
    uNear: { value: 0.1 }, uFar: { value: 12000 }, uHaze: { value: 0.3 }, uTime: { value: 0 },
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uAspect: { value: 1.78 },
    uStorm: { value: 0 },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) }, uRays: { value: 0 }, uRayCol: { value: new THREE.Color(1, 0.8, 0.55) },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform sampler2D tDepth;
    uniform float uNear, uFar, uHaze, uTime, uAspect, uStorm, uRays;
    uniform mat4 uProjInv, uCamWorld;
    uniform vec2 uSunUV; uniform vec3 uRayCol;
    varying vec2 vUv;
    ${SAFE_GLSL}
    float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / max(uFar + uNear - z * (uFar - uNear), 1e-3); }
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
    void main(){
      float d0 = texture2D(tDepth, vUv).x;
      bool sky = d0 > 0.99999;
      float dist = sky ? 20000.0 : lin(d0);
      vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 dir = normalize((uCamWorld * vec4(vp.xyz / max(abs(vp.w), 1e-5), 0.0)).xyz);
      float hz = exp(-abs(dir.y) * 16.0);
      float k = uHaze * (sky ? 0.18 * hz : (0.15 + hz) * smoothstep(40.0, 600.0, dist));
      vec2 uv = vUv;
      if (k > 0.001) {
        float t = uTime;
        vec2 q = vec2(vUv.x * 38.0 * uAspect, vUv.y * 120.0);
        float nx = vn(q + vec2(t * 0.35, -t * 1.5)) - 0.5;
        float ny = vn(q * 0.7 + vec2(-t * 0.2, -t * 1.1) + 9.0) - 0.5;
        vec2 off = vec2(nx * 1.4, ny) * k * 0.0075 * vec2(1.0 / uAspect, 1.0);
        vec2 uv2 = vUv + off;
        float d1 = texture2D(tDepth, uv2).x;
        if (!(d1 < 0.99999) || lin(d1) > dist * 0.75) uv = uv2;
        if (d1 < 0.99999 && lin(d1) < 30.0) uv = vUv;
      }
      vec3 col = rkSafe(texture2D(tDiffuse, uv).rgb);
      #ifdef RAY_STEPS
      if (uRays > 0.002) {
        // лучи: тени от геометрии (скала, червь, дюны) на светящемся небе вокруг солнца, размазанные к его экранной позиции
        vec2 sp = uSunUV;
        vec2 delta = (sp - vUv);
        float len = length(delta * vec2(uAspect, 1.0));
        vec2 stp = delta / float(RAY_STEPS) * 0.95;
        float jit = h21(gl_FragCoord.xy + fract(uTime) * 17.0);
        vec2 p = vUv + stp * jit;
        float acc = 0.0, wsum = 0.0, decay = 1.0;
        for (int i = 0; i < RAY_STEPS; i++) {
          p += stp;
          if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) { decay *= 0.94; continue; }
          float dd = texture2D(tDepth, p).x;
          float skyS = dd > 0.99999 ? 1.0 : 0.0;
          vec2 rr = (p - sp) * vec2(uAspect, 1.0);
          float glow = 1.0 / (1.0 + dot(rr, rr) / 0.035);
          acc += skyS * glow * decay;
          wsum += decay;
          decay *= 0.965;
        }
        float rays = acc / max(wsum, 1.0);
        float fall = 1.0 - smoothstep(0.35, 1.6, len);       // слабее далеко от солнца
        col += uRayCol * rays * uRays * (0.35 + 0.65 * fall);
      }
      #endif
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const GradeShader = {
  name: 'RakisGrade',
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uDust: { value: 0 }, uAspect: { value: 1.78 },
    uGrain: { value: 0.018 }, uVignette: { value: 0.32 }, uSat: { value: 0.94 }, uChroma: { value: 1 },
    uNight: { value: 0 }, uStorm: { value: 0 }, uWindDir: { value: new THREE.Vector2(1, 0) },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) }, uGlare: { value: 0 }, uGlareCol: { value: new THREE.Color(1, 0.8, 0.55) },
    uDirt: { value: 0.5 },
  },
  vertexShader: VERT,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uDust, uAspect, uGrain, uVignette, uSat, uChroma, uNight, uStorm, uGlare, uDirt;
    uniform vec2 uWindDir, uSunUV; uniform vec3 uGlareCol;
    varying vec2 vUv;
    ${SAFE_GLSL}
    float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ return vn(p) * 0.5 + vn(p * 2.03 + 5.1) * 0.25 + vn(p * 4.1 + 2.7) * 0.125; }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
      // хроматическая «дрожь» от пыли и шторма (к краям)
      vec2 sh = c * (0.0012 * uChroma + 0.0055 * uDust) * (0.4 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + sh).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - sh).b;
      col = rkSafe(col);
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // тёплые света / прохладные тени
      float sm = smoothstep(0.015, 0.9, lum);
      vec3 shadowTint = mix(vec3(0.90, 0.97, 1.12), vec3(0.80, 0.93, 1.22), uNight);
      vec3 hiTint = vec3(1.06, 1.0, 0.90);
      col *= mix(shadowTint, hiTint, sm);
      // ночь: Пуркинье — холодный сдвиг и мягкая десатурация
      col = mix(col, vec3(lum) * vec3(0.66, 0.82, 1.12) + col * 0.25, 0.4 * uNight);
      col = mix(vec3(lum), col, uSat * (1.0 - 0.1 * uNight));
      // блики на грязной линзе: пятна проступают рядом с солнцем/яркими лучами
      if (uGlare > 0.002) {
        vec2 q = vUv * vec2(uAspect, 1.0) * 5.0;
        float dirt = smoothstep(0.55, 0.9, fbm(q + 3.0)) * 0.7 + smoothstep(0.7, 0.95, vn(q * 3.7 + 1.0)) * 0.5;
        vec2 rr = (vUv - uSunUV) * vec2(uAspect, 1.0);
        float near = 1.0 / (1.0 + dot(rr, rr) * 3.5);
        col += uGlareCol * dirt * near * uGlare * uDirt * 0.5;
        // ореол/диафрагменные призраки к центру
        vec2 gh = (0.5 - uSunUV) * 0.9 + 0.5;
        vec2 gr = (vUv - gh) * vec2(uAspect, 1.0);
        col += uGlareCol * smoothstep(0.09, 0.0, length(gr)) * uGlare * 0.012;
      }
      // экранная пыль: вуаль + пятна, текущие по экрану
      if (uDust > 0.001) {
        float t = uTime * 0.25;
        float n = vn(vUv * vec2(6.0 * uAspect, 6.0) + vec2(t * 2.0, t)) * 0.6 + vn(vUv * vec2(18.0 * uAspect, 18.0) + vec2(t * 3.5, -t * 0.5)) * 0.4;
        float edge = smoothstep(0.05, 0.75, r2 * 2.2);
        float veil = uDust * (0.10 + 0.5 * n * (0.35 + edge));
        vec3 dustCol = vec3(0.62, 0.45, 0.28) * (0.35 + lum * 0.7);
        col = mix(col, dustCol, clamp(veil, 0.0, 0.7));
      }
      // песчаная буря: летящие вдоль ветра полосы песка и охристая вуаль
      if (uStorm > 0.35) {
        float sK = smoothstep(0.35, 1.0, uStorm);
        vec2 wd = normalize(uWindDir + vec2(1e-4));
        vec2 uvw = vec2(dot(vUv * vec2(uAspect, 1.0), wd), dot(vUv * vec2(uAspect, 1.0), vec2(-wd.y, wd.x)));
        float s1 = vn(vec2(uvw.x * 1.2 - uTime * 5.5, uvw.y * 55.0));
        float s2 = vn(vec2(uvw.x * 2.6 - uTime * 9.0, uvw.y * 130.0 + 7.0));
        float streak = smoothstep(0.55, 1.0, s1 * 0.6 + s2 * 0.5);
        col = mix(col, vec3(0.62, 0.38, 0.17) * (0.35 + lum * 0.8), streak * 0.2 * sK);
        col = mix(col, vec3(0.58, 0.36, 0.17) * (0.3 + 0.5 * lum), 0.12 * sK);
      }
      // виньетка
      col *= 1.0 - uVignette * smoothstep(0.08, 0.62, r2 * 1.45);
      // плёночное зерно
      float g = h21(vUv * vec2(1920.0, 1080.0) + fract(uTime * 7.31) * 100.0) - 0.5;
      col += g * uGrain * (0.35 + sqrt(lum)) * (1.0 + 0.8 * uNight);
      gl_FragColor = vec4(rkSafe(col), 1.0);
    }`,
};

class AtmoPass extends ShaderPass {
  render(renderer, writeBuffer, readBuffer, dt, mask) {
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    super.render(renderer, writeBuffer, readBuffer, dt, mask);
  }
}

export function createPost(game, weather) {
  const { renderer, scene, camera, bus } = game;
  const q = game.settings.quality;
  const pr = renderer.getPixelRatio();
  const w = Math.max(2, Math.floor(innerWidth * pr)), h = Math.max(2, Math.floor(innerHeight * pr));
  const useDepth = q !== 'low';
  const rtOpts = { type: THREE.HalfFloatType, samples: q === 'low' ? 0 : 4, depthBuffer: true };
  if (useDepth) rtOpts.depthTexture = new THREE.DepthTexture(w, h);
  const rt = new THREE.WebGLRenderTarget(w, h, rtOpts);
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  let haze = null, bloom = null;
  if (useDepth) {
    const def = AtmoShader.defines;
    def.RAY_STEPS = q === 'high' ? 44 : 26;
    haze = new AtmoPass(AtmoShader);
    composer.addPass(haze);
  } else {
    composer.addPass(new ShaderPass(SanitizeShader));
  }
  if (q !== 'low') {
    bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), q === 'high' ? 0.22 : 0.18, 0.7, 1.05);
    composer.addPass(bloom);
  }
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  composer.setSize(innerWidth, innerHeight);

  const sunV = new THREE.Vector3(), fwd = new THREE.Vector3();
  const post = {
    composer, haze, bloom, grade, enabled: true,
    dust: 0, rays: 0,
    render(dt) {
      const t = game.realTime;
      const wp = weather;
      const threat = game.worm?.threat ?? 0;
      const targetDust = clamp(wp.storm * 0.55 + threat * 0.65 + (wp.dust > 0.6 ? (wp.dust - 0.6) * 0.8 : 0), 0, 1);
      post.dust += (targetDust - post.dust) * Math.min(1, dt * 2.0);
      if (!Number.isFinite(post.dust)) post.dust = 0;
      // защита: экспозиция должна быть конечной
      if (!Number.isFinite(renderer.toneMappingExposure) || renderer.toneMappingExposure <= 0) renderer.toneMappingExposure = 1;
      const inDesert = game.space !== 'sietch';
      // экранная позиция солнца и сила лучей
      const sd = ENV.uniforms.uSunDir.value;
      let rays = 0, sunU = 0.5, sunVv = 0.5, facing = 0;
      if (sd && inDesert) {
        sunV.copy(sd).multiplyScalar(500).add(camera.position).project(camera);
        camera.getWorldDirection(fwd);
        facing = fwd.dot(sd);
        sunU = sunV.x * 0.5 + 0.5; sunVv = sunV.y * 0.5 + 0.5;
        if (!Number.isFinite(sunU) || !Number.isFinite(sunVv)) { sunU = 0.5; sunVv = 0.5; facing = -1; }
        const el = wp.sunElev;
        const low = 1 - smoothstep(8, 48, el);                     // сильнее у горизонта
        const set = smoothstep(-5, 1.5, el);                       // исчезает под горизонтом
        const dustK = 0.55 + 0.9 * clamp(wp.dust, 0, 1);
        rays = (0.12 + 0.4 * low) * set * dustK * smoothstep(-0.05, 0.4, facing) * (1 - 0.6 * clamp(wp.storm, 0, 1));
        sunU = clamp(sunU, -3, 4); sunVv = clamp(sunVv, -3, 4);
      }
      post.rays += (rays - post.rays) * Math.min(1, dt * 4);
      grade.uniforms.uTime.value = t;
      grade.uniforms.uDust.value = post.dust;
      grade.uniforms.uAspect.value = camera.aspect;
      grade.uniforms.uChroma.value = game.space === 'sietch' ? 0.3 : 1;
      grade.uniforms.uNight.value = inDesert ? ENV_NIGHT() : 0;
      grade.uniforms.uStorm.value = inDesert ? wp.storm : 0;
      grade.uniforms.uWindDir.value.set(wp.windDir.x, wp.windDir.z);
      grade.uniforms.uSunUV.value.set(sunU, sunVv);
      grade.uniforms.uGlare.value = post.rays * (0.4 + 0.6 * smoothstep(0.55, 1.0, facing));
      if (haze) {
        const u = haze.uniforms;
        u.uTime.value = t;
        u.uHaze.value = inDesert ? wp.haze : 0;
        u.uStorm.value = wp.storm;
        u.uNear.value = camera.near; u.uFar.value = camera.far; u.uAspect.value = camera.aspect;
        u.uProjInv.value.copy(camera.projectionMatrixInverse);
        u.uCamWorld.value.copy(camera.matrixWorld);
        u.uSunUV.value.set(sunU, sunVv);
        u.uRays.value = post.rays;
        u.uRayCol.value.copy(wp.rayColor || RAY_DEFAULT);
      }
      if (bloom) bloom.threshold = clamp(0.82 / Math.max(renderer.toneMappingExposure, 0.3), 0.25, 1.1);
      composer.render(dt);
    },
    resize(wd, ht) {
      composer.setSize(wd, ht);
    },
  };
  game.render = (dt) => post.render(dt);
  bus.on('resize', ({ w: ww, h: hh }) => post.resize(ww, hh));
  return post;
}

