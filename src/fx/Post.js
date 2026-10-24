import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { AutoExposure } from './Exposure.js';
import { LensFlarePass } from './LensFlare.js';
import { AOPass } from './AO.js';

/** Screen-space AO per GPU preset (src/fx/AO.js); ?ao=0 disables it, `quality.ao` (object or false) overrides. */
const AO_PRESETS = {
  ultra: { samples: 12, scale: 0.5 },
  high: { samples: 10, scale: 0.5 },
  medium: { samples: 6, scale: 0.5, radius: 0.8 },
};

/**
 * Post-processing chain (all passes in linear HDR until the OutputPass):
 *   far scene -> near scene (depth cleared) -> ambient occlusion (near-scene depth only, GPU presets)
 *   -> bloom (soft-knee threshold) -> lens flare (additive overlay)
 *   -> final grade (vignette / edge aberration / grain / lens dirt / glare veil) -> ACES + sRGB -> SMAA
 *
 * Settings live in `post.grade` (editable at runtime: window.__app.renderer.post.grade). The auto-exposure
 * (post.exposure) drives renderer.toneMappingExposure and the sky brightness; the lens flare (post.flare)
 * reads the Sun position and the station colliders. Scene context is reached lazily through window.__app.ctx.
 */

/** Final grade. Runs in linear HDR before tone mapping; display-calibrated additions are pre-divided by the exposure in JS. */
export const FinalGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.22 },
    uAberration: { value: 0.003 },  // uv offset at the extreme corners (quartic falloff toward the centre)
    uGrain: { value: 0.012 },
    uExposure: { value: 1.0 },      // extra multiplier (the auto exposure uses renderer.toneMappingExposure)
    uFlash: { value: 0.0 },         // veiling glare / white-out, display-linear units
    uDirt: { value: 0.0 },          // lens dirt strength, display-linear units (0 = off)
    uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uAspect: { value: 16 / 9 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uAberration, uGrain, uExposure, uFlash, uDirt, uAspect;
    uniform vec2 uSunUv, uResolution;
    uniform vec3 uSunColor;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 19.19)); }
    /* fixed smudges / streaks / specks on the front lens element, in aspect-corrected screen space */
    float dirtPattern(vec2 q) {
      float s = 0.0;
      for (int i = 0; i < 7; i++) {
        float fi = float(i);
        vec2 c = vec2(hash(vec2(fi, 1.7)) * uAspect, hash(vec2(fi, 9.1)));
        float ang = hash(vec2(fi, 3.3)) * 3.14159;
        vec2 d = q - c;
        vec2 e = vec2(cos(ang) * d.x + sin(ang) * d.y, -sin(ang) * d.x + cos(ang) * d.y);
        float len = 0.06 + 0.22 * hash(vec2(fi, 5.5));
        float wid = 0.004 + 0.012 * hash(vec2(fi, 7.7));
        s += exp(-(e.x * e.x) / (len * len) - (e.y * e.y) / (wid * wid)) * (0.4 + 0.6 * hash(vec2(fi, 2.2)));
      }
      vec2 cell = floor(q * 50.0);
      vec2 f = fract(q * 50.0) - hash2(cell);
      float sparse = step(0.985, hash(cell + 3.1));
      s += sparse * exp(-dot(f, f) * 60.0) * 0.5;
      return s;
    }
    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      vec2 da = vec2(d.x * uAspect, d.y);
      float r2 = dot(da, da) / (0.25 * (uAspect * uAspect + 1.0));   // 0 centre .. 1 corners
      // chromatic aberration: quartic falloff, only the extreme edges show fringing
      vec2 off = d * r2 * r2 * uAberration;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      col *= uExposure;
      // sun-relative falloff for the veil and the dirt
      vec2 ds = vec2((uv.x - uSunUv.x) * uAspect, uv.y - uSunUv.y);
      float radial = exp(-dot(ds, ds) * 3.0);
      if (uDirt > 0.0) col += uSunColor * uDirt * dirtPattern(vec2(uv.x * uAspect, uv.y)) * (0.15 + 0.85 * radial);
      if (uFlash > 0.0) col += uFlash * vec3(1.0, 0.96, 0.9) * (0.02 + 0.98 * radial);
      // vignette: subtle optical falloff
      float vig = 1.0 - uVignette * smoothstep(0.25, 1.05, r2);
      col *= vig;
      // film grain (zero-mean, stronger in the mid-tones, negligible in the highlights)
      float g = (hash(uv * uResolution + fract(uTime * 0.37) * 1000.0) - 0.5) * uGrain;
      col += g * (0.25 + min(col, vec3(1.5)));
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

/**
 * Far-scene depth slices. In the default frame the far scene (km) is one pass with near = 20 km. When the universe
 * reports a split (`universe.farSplit`: a nearby body in front of a distant multi-shell body, e.g. the Moon from
 * lunar orbit with the Earth behind it), the far scene is drawn twice: everything but the near body with a near
 * plane fitted to the distant bodies, then (depth cleared) the near body alone with its own planes. The near body's
 * objects are moved to a spare layer for the duration of the call (layers are not part of any program key).
 */
export function renderFarSliced(renderer, scene, camera, split, renderOnce) {
  const objs = split.objects, L = split.layer;
  const saved = split._saved || (split._saved = []);
  for (let i = 0; i < objs.length; i++) { saved[i] = objs[i].layers.mask; objs[i].layers.set(L); }
  const mask = camera.layers.mask, n0 = camera.near, f0 = camera.far, bg = scene.background;
  try {
    renderOnce(false);                                  // slice 1: the rest (camera planes as set by the universe)
    camera.near = split.near; camera.far = split.far; camera.updateProjectionMatrix();
    camera.layers.set(L);
    scene.background = null;                            // a colour background would clear the first slice
    renderer.clearDepth();
    renderOnce(true);                                   // slice 2: the near body
  } finally {
    scene.background = bg;
    camera.layers.mask = mask;
    camera.near = n0; camera.far = f0; camera.updateProjectionMatrix();
    for (let i = 0; i < objs.length; i++) objs[i].layers.mask = saved[i];
  }
}

/** RenderPass for the far scene with optional depth slices (see renderFarSliced). */
class FarScenePass extends RenderPass {
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const split = window.__app?.universe?.farSplit;
    if (!split || this.camera.layers.mask === 0) { super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive); return; }
    const clear = this.clear;
    renderFarSliced(renderer, this.scene, this.camera, split, (second) => {
      this.clear = second ? false : clear;
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    });
    this.clear = clear;
  }
}

/** Soft-knee, subtractive bright pass for UnrealBloomPass (replaces its hard luminance step; smoothWidth = knee fraction). */
const SOFT_KNEE_HIGHPASS_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform float luminosityThreshold, smoothWidth;
varying vec2 vUv;
void main() {
  vec4 texel = texture2D(tDiffuse, vUv);
  float v = max(texel.r, max(texel.g, texel.b));
  float knee = luminosityThreshold * smoothWidth + 1.0e-4;
  float soft = clamp(v - luminosityThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contrib = max(soft, v - luminosityThreshold) / max(v, 1.0e-4);
  gl_FragColor = vec4(texel.rgb * contrib, 1.0);
}`;

export class PostStack {
  constructor(renderer, { farScene, farCamera, nearScene, camera, quality }) {
    this.renderer = renderer;
    this.quality = quality;
    this.camera = camera;
    const low = quality.preset === 'low' || !!quality.lite;

    /** Runtime settings. */
    this.grade = {
      autoExposure: true,
      exposure: 1.0,           // used when autoExposure is false
      exposureBias: 1.0,       // multiplier on the automatic value
      exposureMin: 0.55,
      exposureMax: 2.2,
      vignette: 0.22,
      aberration: low ? 0 : 0.003,
      grain: 0.012,
      dirt: low ? 0 : 0.06,    // max lens-dirt brightness (display units), lit only by the Sun in view
      flash: 0.0,              // external white-out (hatch etc.), 0..1 display units; the Sun glare is added on top
      glareMax: 0.25,
      bloom: !!quality.bloom,
      bloomStrength: 0.32,
      bloomRadius: 0.4,
      bloomThreshold: 1.5,     // in exposed (display-linear) units: only emitters / the Sun / specular hot spots bloom
      bloomKnee: 0.5,
      flare: 1.0,
      skyExposure: 1.0,        // multiplier on the automatic star / Milky Way exposure
      ao: true,                // screen-space ambient occlusion (when the preset has it; the quality governor may turn it off)
      aoStrength: 0.9,
      aoRadius: 0.9,           // metres
    };

    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    this.scenes = { farScene, farCamera, nearScene, camera };
    // CPU rasteriser ('lite'): an HDR target plus a full-screen pass more than halves the frame rate,
    // so draw both scenes straight into the canvas; tone mapping and sRGB run inside the materials.
    this.direct = !!quality.lite;
    if (this.direct) {
      for (const scene of [farScene, nearScene]) scene.traverse((o) => { for (const m of [].concat(o.material || [])) patchDirectOutput(m); });
      // the far scene (Earth, sky) is smooth and fill-rate bound: render it at a lower resolution into an
      // HDR target, then stretch it to the canvas with tone mapping; the station is drawn sharp on top
      this.farScale = quality.farScale ?? 1;
      if (this.farScale < 1) {
        this.farRT = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false });
        this.farRT.texture.minFilter = this.farRT.texture.magFilter = THREE.LinearFilter;
        this.farRT.texture.generateMipmaps = false;
        const blitMat = new THREE.ShaderMaterial({
          uniforms: { tFar: { value: this.farRT.texture } },
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: 'uniform sampler2D tFar; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tFar, vUv).rgb, 1.0); }',
          depthTest: false, depthWrite: false,
        });
        patchDirectOutput(blitMat);
        this.blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat);
        this.blit.frustumCulled = false;
        this.blitScene = new THREE.Scene(); this.blitScene.add(this.blit);
        this.blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this._sizeFar(size.x, size.y);
      }
      this.flarePass = new LensFlarePass();
      this.flarePass.setSize(size.x, size.y);   // the exposure estimate uses its Sun-occlusion test
      this.flare = this.flarePass;
      this.exposure = new AutoExposure({ min: this.grade.exposureMin, max: this.grade.exposureMax });
      this.finalPass = { uniforms: Object.fromEntries(Object.keys(FinalGradeShader.uniforms).map((k) => [k, { value: FinalGradeShader.uniforms[k].value?.clone ? FinalGradeShader.uniforms[k].value.clone() : FinalGradeShader.uniforms[k].value }])) };
      this.bloomPass = { enabled: false };
      this._time = 0;
      return;
    }
    const pa = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    const aoCfg = quality.ao === false || pa.get('ao') === '0' ? null : (quality.ao || AO_PRESETS[quality.preset] || null);
    const w0 = Math.max(1, Math.round(size.x * pr)), h0 = Math.max(1, Math.round(size.y * pr));
    const rt = new THREE.WebGLRenderTarget(w0, h0, {
      type: THREE.HalfFloatType, samples: quality.msaa || 0, depthBuffer: true, stencilBuffer: false,
      // AO reads the near scene's depth (resolved from MSAA); 32-bit float keeps precision out to the far hull
      depthTexture: aoCfg ? new THREE.DepthTexture(w0, h0, THREE.FloatType) : null,
    });
    this.composer = new EffectComposer(renderer, rt);

    this.farPass = new FarScenePass(farScene, farCamera);
    this.farPass.clear = true;
    this.nearPass = new RenderPass(nearScene, camera);
    this.nearPass.clear = false;
    this.nearPass.clearDepth = true;

    this.aoPass = aoCfg ? new AOPass(camera, { radius: this.grade.aoRadius, strength: this.grade.aoStrength, ...aoCfg }) : null;
    if (aoCfg?.radius) this.grade.aoRadius = aoCfg.radius;

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.grade.bloomStrength, this.grade.bloomRadius, this.grade.bloomThreshold);
    this.bloomPass.enabled = this.grade.bloom;
    const hp = this.bloomPass.materialHighPassFilter;
    if (hp && this.bloomPass.highPassUniforms) {
      hp.fragmentShader = SOFT_KNEE_HIGHPASS_FRAG;
      hp.needsUpdate = true;
      this.bloomPass.highPassUniforms.smoothWidth.value = this.grade.bloomKnee;
    }

    this.flarePass = new LensFlarePass();
    this.flare = this.flarePass;
    this.exposure = new AutoExposure({ min: this.grade.exposureMin, max: this.grade.exposureMax });

    this.finalPass = new ShaderPass(FinalGradeShader);
    this.outputPass = new OutputPass();
    this.smaaPass = new SMAAPass();

    this.composer.addPass(this.farPass);
    this.composer.addPass(this.nearPass);
    if (quality.lite) {
      // CPU rasteriser: only tone mapping + sRGB (exposure, sky exposure and occlusion still run in update())
      this.composer.addPass(this.outputPass);
    } else {
      if (this.aoPass) this.composer.addPass(this.aoPass);
      this.composer.addPass(this.bloomPass);
      this.composer.addPass(this.flarePass);
      this.composer.addPass(this.finalPass);
      this.composer.addPass(this.outputPass);
      this.composer.addPass(this.smaaPass);
    }

    this._time = 0;
    this.setSize(size.x, size.y);
  }

  /** Change the HDR targets' MSAA sample count (quality governor). */
  setSamples(n) {
    if (this.direct || !this.composer) return;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) { if (rt.samples !== n) { rt.samples = n; rt.dispose(); } }
  }

  _sizeFar(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.farRT.setSize(Math.max(2, Math.round(w * pr * this.farScale)), Math.max(2, Math.round(h * pr * this.farScale)));
  }

  setSize(w, h) {
    if (this.direct) { if (this.farRT) this._sizeFar(w, h); this.flarePass.setSize(w, h); return; }
    const pr = this.renderer.getPixelRatio();
    this.composer.setSize(w, h);            // sizes the HDR targets and every pass at w*pr x h*pr
    this.flarePass.setSize(w, h);
    const u = this.finalPass.uniforms;
    u.uResolution.value.set(w * pr, h * pr);
    u.uAspect.value = h > 0 ? w / h : 1;
  }

  update(dt, time) {
    this._time = time;
    const g = this.grade;
    const u = this.finalPass.uniforms;
    u.uTime.value = time;
    u.uVignette.value = g.vignette;
    u.uAberration.value = g.aberration;
    u.uGrain.value = g.grain;
    this.bloomPass.enabled = !!g.bloom && !!this.quality.bloom;
    this.bloomPass.strength = g.bloomStrength;
    this.bloomPass.radius = g.bloomRadius;
    if (this.bloomPass.highPassUniforms) this.bloomPass.highPassUniforms.smoothWidth.value = g.bloomKnee;
    this.flarePass.intensity = g.flare;
    this.exposure.min = g.exposureMin;
    this.exposure.max = g.exposureMax;

    const ctx = window.__app?.ctx;
    const renderer = this.renderer;
    if (!ctx || !ctx.orbit || !ctx.camera) {
      // no scene context yet: static defaults
      renderer.toneMappingExposure = g.autoExposure ? 1.0 : g.exposure;
      this.bloomPass.threshold = g.bloomThreshold / renderer.toneMappingExposure;
      u.uFlash.value = g.flash;
      u.uDirt.value = 0;
      this.flarePass.enabled = false;
      return;
    }

    // 1. Sun occlusion by the station / ships (cheap ray test), then the exposure estimate
    const unoccluded = this.flarePass.computeOcclusion(ctx);
    const ex = this.exposure;
    ex.update(dt, ctx, unoccluded);
    let E = g.autoExposure ? ex.value * g.exposureBias : g.exposure;
    E = Number.isFinite(E) ? Math.max(0.05, E) : 1.0;
    renderer.toneMappingExposure = E;

    // 2. stars / Milky Way: nearly invisible in daylight exposures, full at night
    ctx.sky?.setExposure?.(ex.skyExposure * g.skyExposure);

    // 3. lens flare placement + visibility smoothing
    this.flarePass.update(dt, { sunNdc: ex.sunNdc, sunAhead: ex.sunAhead, sunVisible: ctx.orbit.sunVisible ?? 1, sunColor: ctx.orbit.sunColor, cut: ex.cut });

    // 4. bloom threshold is defined in exposed units
    this.bloomPass.threshold = g.bloomThreshold / E;
    if (this.aoPass) {
      this.aoPass.enabled = !!g.ao;
      this.aoPass.strength = g.aoStrength; this.aoPass.radius = g.aoRadius; this.aoPass.exposure = E;
    }

    // 5. grade: Sun glare veil, lens dirt lit by the Sun (display-calibrated -> divide by the exposure)
    const glare = g.glareMax * ex.glare;
    u.uFlash.value = (g.flash + glare) / E;
    const flareVis = this.flarePass.visibility * g.flare;
    u.uDirt.value = (g.dirt * flareVis) / E;
    u.uSunUv.value.set(ex.sunNdc.x * 0.5 + 0.5, ex.sunNdc.y * 0.5 + 0.5);
    u.uSunColor.value.copy(ctx.orbit.sunColor || u.uSunColor.value);
  }

  render() {
    if (!this.direct) { this.composer.render(); return; }
    const r = this.renderer, sc = this.scenes;
    r.autoClear = false;
    const split = window.__app?.universe?.farSplit;
    const drawFar = split && sc.farCamera.layers.mask !== 0
      ? () => renderFarSliced(r, sc.farScene, sc.farCamera, split, () => r.render(sc.farScene, sc.farCamera))
      : () => r.render(sc.farScene, sc.farCamera);
    if (this.farRT) {
      // stars are points: in the low-resolution target they would blow up into blocks after the stretch,
      // so they are drawn straight onto the canvas (Earth occlusion is analytic in their shader)
      const stars = window.__app?.ctx?.sky?.stars;
      const starsOn = !!stars && stars.visible;
      if (starsOn) stars.visible = false;
      r.setRenderTarget(this.farRT); r.clear(); drawFar();
      if (starsOn) stars.visible = true;
      r.setRenderTarget(null); r.clear(); r.render(this.blitScene, this.blitCamera);
      if (starsOn) r.render(stars, sc.farCamera);
    } else {
      r.setRenderTarget(null); r.clear(); drawFar();
    }
    r.clearDepth();
    r.render(sc.nearScene, sc.camera);
    r.autoClear = true;
  }

  dispose() {
    if (this.direct) return;
    this.composer.dispose?.();
    this.flarePass.dispose();
    this.aoPass?.dispose();
  }
}

/**
 * Make a custom ShaderMaterial write display-ready colour when it renders straight to the canvas:
 * append three's tone-mapping and colour-space chunks to the end of main(). (Rendering into a render
 * target, three disables both, so this is harmless elsewhere.) Built-in materials already do this.
 */
export function patchDirectOutput(m) {
  if (!m || !m.isShaderMaterial || m.userData.directOutput) return;
  const src = m.fragmentShader;
  if (/tonemapping_fragment|colorspace_fragment/.test(src)) return;
  const end = src.lastIndexOf('}');
  if (end < 0) return;
  m.fragmentShader = src.slice(0, end) + '\n  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n' + src.slice(end);
  m.userData.directOutput = true;
  m.needsUpdate = true;
}
