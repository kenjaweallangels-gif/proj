import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

/** Final grade: vignette, subtle chromatic aberration, film grain, optional helmet darkening. Runs in linear HDR before tone mapping. */
export const FinalGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    uAberration: { value: 0.0025 },
    uGrain: { value: 0.03 },
    uExposure: { value: 1.0 },
    uFlash: { value: 0.0 },           // white-out flash (sun glare / hatch opening)
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uAberration, uGrain, uExposure, uFlash; uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      // chromatic aberration grows towards the edges
      vec2 off = d * r2 * uAberration * 8.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      col *= uExposure;
      float vig = 1.0 - uVignette * smoothstep(0.15, 0.75, r2 * 2.0);
      col *= vig;
      float g = (hash(uv * uResolution + fract(uTime) * 100.0) - 0.5) * uGrain;
      col += g * (0.3 + col);
      col = mix(col, vec3(1.0), uFlash);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

/**
 * Builds the post-processing chain:
 *   far scene -> near scene (depth cleared) -> bloom -> final grade -> tone map/sRGB -> SMAA
 */
export class PostStack {
  constructor(renderer, { farScene, farCamera, nearScene, camera, quality }) {
    this.renderer = renderer;
    this.quality = quality;
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: quality.msaa || 0, depthBuffer: true, stencilBuffer: false });
    this.composer = new EffectComposer(renderer, rt);
    this.farPass = new RenderPass(farScene, farCamera);
    this.farPass.clear = true;
    this.nearPass = new RenderPass(nearScene, camera);
    this.nearPass.clear = false;
    this.nearPass.clearDepth = true;
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.42, 0.55, 1.0);
    this.bloomPass.enabled = !!quality.bloom;
    this.finalPass = new ShaderPass(FinalGradeShader);
    this.outputPass = new OutputPass();
    this.smaaPass = new SMAAPass();
    this.composer.addPass(this.farPass);
    this.composer.addPass(this.nearPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.finalPass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.smaaPass);
    this.setSize(size.x, size.y);
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
    this.finalPass.uniforms.uResolution.value.set(w * pr, h * pr);
  }

  update(dt, time) { this.finalPass.uniforms.uTime.value = time; }

  render() { this.composer.render(); }

  dispose() { this.composer.dispose?.(); }
}
