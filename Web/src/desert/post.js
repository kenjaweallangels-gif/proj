// Пост-обработка: RenderPass → марево (по глубине/высоте) → bloom → кинематографичный грейд → OutputPass.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { clamp } from '../core/util.js';

const HazeShader = {
  name: 'RakisHaze',
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null },
    uNear: { value: 0.1 }, uFar: { value: 12000 }, uHaze: { value: 0.3 }, uTime: { value: 0 },
    uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uAspect: { value: 1.78 },
    uStorm: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform sampler2D tDepth;
    uniform float uNear, uFar, uHaze, uTime, uAspect, uStorm;
    uniform mat4 uProjInv, uCamWorld;
    varying vec2 vUv;
    float lin(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
    void main(){
      float d0 = texture2D(tDepth, vUv).x;
      bool sky = d0 > 0.99999;
      float dist = sky ? 20000.0 : lin(d0);
      vec4 vp = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 dir = normalize((uCamWorld * vec4(vp.xyz / vp.w, 0.0)).xyz);
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
      gl_FragColor = texture2D(tDiffuse, uv);
    }`,
};

const GradeShader = {
  name: 'RakisGrade',
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uDust: { value: 0 }, uAspect: { value: 1.78 },
    uGrain: { value: 0.018 }, uVignette: { value: 0.32 }, uSat: { value: 0.94 }, uChroma: { value: 1 },
    uSunScreen: { value: new THREE.Vector3(0.5, 0.5, 0) }, uExposureFlash: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uDust, uAspect, uGrain, uVignette, uSat, uChroma;
    uniform vec3 uSunScreen;
    varying vec2 vUv;
    float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
      // хроматическая «дрожь» от пыли и шторма (к краям)
      vec2 sh = c * (0.0012 * uChroma + 0.0055 * uDust) * (0.4 + r2 * 3.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + sh).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - sh).b;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // тёплые света / прохладные тени
      float sm = smoothstep(0.015, 0.9, lum);
      vec3 shadowTint = vec3(0.90, 0.97, 1.12);
      vec3 hiTint = vec3(1.06, 1.0, 0.90);
      col *= mix(shadowTint, hiTint, sm);
      col = mix(vec3(lum), col, uSat);
      // экранная пыль: вуаль + пятна, текущие по экрану
      if (uDust > 0.001) {
        float t = uTime * 0.25;
        float n = vn(vUv * vec2(6.0 * uAspect, 6.0) + vec2(t * 2.0, t)) * 0.6 + vn(vUv * vec2(18.0 * uAspect, 18.0) + vec2(t * 3.5, -t * 0.5)) * 0.4;
        float edge = smoothstep(0.05, 0.75, r2 * 2.2);
        float veil = uDust * (0.10 + 0.5 * n * (0.35 + edge));
        vec3 dustCol = vec3(0.62, 0.45, 0.28) * (0.35 + lum * 0.7);
        col = mix(col, dustCol, clamp(veil, 0.0, 0.7));
      }
      // виньетка
      col *= 1.0 - uVignette * smoothstep(0.08, 0.62, r2 * 1.45);
      // плёночное зерно
      float g = h21(vUv * vec2(1920.0, 1080.0) + fract(uTime * 7.31) * 100.0) - 0.5;
      col += g * uGrain * (0.35 + sqrt(lum));
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

class HazePass extends ShaderPass {
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
    haze = new HazePass(HazeShader);
    composer.addPass(haze);
  }
  if (q !== 'low') {
    bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), q === 'high' ? 0.22 : 0.18, 0.7, 1.05);
    composer.addPass(bloom);
  }
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  composer.setSize(innerWidth, innerHeight);

  const post = {
    composer, haze, bloom, grade, enabled: true,
    dust: 0,
    render(dt) {
      const t = game.realTime;
      const wp = weather;
      const threat = game.worm?.threat ?? 0;
      const targetDust = clamp(wp.storm * 0.55 + threat * 0.65 + (wp.dust > 0.6 ? (wp.dust - 0.6) * 0.8 : 0), 0, 1);
      post.dust += (targetDust - post.dust) * Math.min(1, dt * 2.0);
      grade.uniforms.uTime.value = t;
      grade.uniforms.uDust.value = post.dust;
      grade.uniforms.uAspect.value = camera.aspect;
      grade.uniforms.uChroma.value = game.space === 'sietch' ? 0.3 : 1;
      if (haze) {
        const u = haze.uniforms;
        u.uTime.value = t;
        u.uHaze.value = game.space === 'sietch' ? 0 : wp.haze;
        u.uStorm.value = wp.storm;
        u.uNear.value = camera.near; u.uFar.value = camera.far; u.uAspect.value = camera.aspect;
        u.uProjInv.value.copy(camera.projectionMatrixInverse);
        u.uCamWorld.value.copy(camera.matrixWorld);
      }
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
