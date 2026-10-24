import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Screen-space ambient occlusion for the near scene (contact shadows where station parts meet).
 *
 * Depth only: the near pass renders into a composer target that carries a DepthTexture (resolved from
 * MSAA by three). The far scene (Earth, sky) is drawn first and the depth is cleared before the station,
 * so every pixel without station geometry still holds depth 1.0 and is passed through untouched.
 *
 *   1. AO at `scale` × resolution: view-space position and normal reconstructed from depth, scalable
 *      ambient obscurance (SAO) with `samples` taps on a spiral, per-pixel rotated (interleaved gradient noise)
 *   2. separable depth-aware blur (2 passes), AO + view depth carried in the same half-float target
 *   3. composite at full resolution: joint-bilateral upsampling, colour × AO (damped on brightly lit pixels,
 *      so it reads as contact shadow without greying the sunlit hull), faded out with distance
 *
 * Cost on a GPU at 1080p: ~0.4-0.8 ms (half resolution, 8-12 samples). No allocations per frame.
 */

const AO_FRAG = /* glsl */`
#include <packing>
uniform sampler2D tDepth;
uniform vec2 uTexel;          // 1 / depth texture size
uniform vec2 uProj;           // projectionMatrix[0][0], [1][1]
uniform float uNear, uFar;
uniform float uRadius;        // world radius (m)
uniform float uMaxPx;         // max screen radius in depth-texture pixels
uniform float uIntensity;
uniform float uBias;
uniform vec2 uSize;           // depth texture size (px)
varying vec2 vUv;

float viewZAt(vec2 uv) { return perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
vec3 viewPos(vec2 uv, float z) { return vec3((uv * 2.0 - 1.0) * -z / uProj, z); }

void main() {
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.999999) { gl_FragColor = vec4(1.0, -1.0e4, 0.0, 1.0); return; }
  float z = perspectiveDepthToViewZ(d, uNear, uFar);
  vec3 P = viewPos(vUv, z);
  // normal from the depth neighbourhood: take the smaller difference on each axis (no smearing across edges)
  vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);
  vec3 pr = viewPos(vUv + dx, viewZAt(vUv + dx)), pl = viewPos(vUv - dx, viewZAt(vUv - dx));
  vec3 pu = viewPos(vUv + dy, viewZAt(vUv + dy)), pd = viewPos(vUv - dy, viewZAt(vUv - dy));
  vec3 ddx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl;
  vec3 ddy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
  vec3 n = normalize(cross(ddx, ddy));
  // screen radius of the world-space kernel
  float rPx = min(uRadius * uProj.y * 0.5 * uSize.y / -z, uMaxPx);
  float R = uRadius * (rPx / max(uRadius * uProj.y * 0.5 * uSize.y / -z, 1e-4));   // shrink R with the clamp
  float R2 = R * R;
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float occ = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(SAMPLES);
    float a = (float(i) * 2.39996323 + noise * 6.2831853);
    vec2 off = vec2(cos(a), sin(a)) * (rPx * sqrt(t) + 1.0) * uTexel;
    vec2 suv = vUv + off;
    float sz = viewZAt(suv);
    vec3 v = viewPos(suv, sz) - P;
    float vv = dot(v, v);
    float vn = dot(v, n);
    float f = max(R2 - vv, 0.0);
    occ += f * f * f * max((vn - uBias * -z * 0.01) / (0.01 * R2 + vv), 0.0);
  }
  float ao = max(0.0, 1.0 - occ * uIntensity * 5.0 / (R2 * R2 * R2 * float(SAMPLES)));
  gl_FragColor = vec4(ao, z, 0.0, 1.0);
}`;

const BLUR_FRAG = /* glsl */`
uniform sampler2D tAO;
uniform vec2 uDir;            // texel step
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tAO, vUv);
  if (c.y < -9000.0) { gl_FragColor = c; return; }
  float z = c.y, sum = c.x * 0.2270, wsum = 0.2270;
  const float W[4] = float[4](0.1946, 0.1216, 0.0541, 0.0162);
  for (int i = 1; i <= 4; i++) {
    for (int s = -1; s <= 1; s += 2) {
      vec4 t = texture2D(tAO, vUv + uDir * float(i * s));
      float w = W[i - 1] * max(0.0, 1.0 - abs(t.y - z) / (0.04 * -z + 0.05));
      sum += t.x * w; wsum += w;
    }
  }
  gl_FragColor = vec4(sum / wsum, z, 0.0, 1.0);
}`;

const COMPOSITE_FRAG = /* glsl */`
#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D tAO;
uniform vec2 uAOSize;         // AO target size (px)
uniform float uNear, uFar;
uniform float uStrength;
uniform float uLitDamp;       // 0..1: how much less AO the brightest pixels get
uniform float uExposure;
uniform vec2 uFade;           // view distance fade start / end (m)
varying vec2 vUv;
void main() {
  vec4 col = texture2D(tDiffuse, vUv);
  float d = texture2D(tDepth, vUv).x;
  if (d >= 0.999999 || uStrength <= 0.0) { gl_FragColor = col; return; }
  float z = perspectiveDepthToViewZ(d, uNear, uFar);
  // joint bilateral upsampling from the low-resolution AO
  vec2 p = vUv * uAOSize - 0.5;
  vec2 f = fract(p), b = (floor(p) + 0.5) / uAOSize, t = 1.0 / uAOSize;
  vec4 a00 = texture2D(tAO, b), a10 = texture2D(tAO, b + vec2(t.x, 0.0)), a01 = texture2D(tAO, b + vec2(0.0, t.y)), a11 = texture2D(tAO, b + t);
  float tol = 0.03 * -z + 0.05;
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  w *= vec4(max(1e-3, 1.0 - abs(a00.y - z) / tol), max(1e-3, 1.0 - abs(a10.y - z) / tol), max(1e-3, 1.0 - abs(a01.y - z) / tol), max(1e-3, 1.0 - abs(a11.y - z) / tol));
  float ao = dot(w, vec4(a00.x, a10.x, a01.x, a11.x)) / dot(w, vec4(1.0));
  float lum = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722)) * uExposure;
  float k = uStrength * (1.0 - uLitDamp * smoothstep(0.35, 2.5, lum)) * (1.0 - smoothstep(uFade.x, uFade.y, -z));
  gl_FragColor = vec4(col.rgb * mix(1.0, ao, k), col.a);
}`;

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class AOPass extends Pass {
  /**
   * @param camera near-scene camera
   * @param opts { samples, scale (AO resolution factor), radius (m), intensity, strength, maxPx }
   */
  constructor(camera, { samples = 10, scale = 0.5, radius = 0.9, intensity = 1.9, strength = 0.9, maxPx = 90 } = {}) {
    super();
    this.camera = camera;
    this.needsSwap = true;
    this.scale = scale;
    this.radius = radius; this.intensity = intensity; this.strength = strength; this.maxPx = maxPx;
    this.litDamp = 0.3;
    this.exposure = 1.0;
    this.fade = new THREE.Vector2(160, 320);
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
    this.rtA = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.aoMat = new THREE.ShaderMaterial({
      defines: { SAMPLES: samples },
      uniforms: { tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uSize: { value: new THREE.Vector2() }, uProj: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 1000 },
        uRadius: { value: radius }, uMaxPx: { value: maxPx }, uIntensity: { value: intensity }, uBias: { value: 0.6 } },
      vertexShader: VERT, fragmentShader: AO_FRAG, depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({ uniforms: { tAO: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, tAO: { value: this.rtA.texture }, uAOSize: { value: new THREE.Vector2() }, uNear: { value: 0.1 }, uFar: { value: 1000 },
        uStrength: { value: strength }, uLitDamp: { value: this.litDamp }, uExposure: { value: 1 }, uFade: { value: this.fade } },
      vertexShader: VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.aoMat);
  }

  setSize(w, h) {
    // w, h: drawing-buffer size of the composer targets
    const aw = Math.max(2, Math.round(w * this.scale)), ah = Math.max(2, Math.round(h * this.scale));
    this.rtA.setSize(aw, ah); this.rtB.setSize(aw, ah);
    this.compMat.uniforms.uAOSize.value.set(aw, ah);
  }

  render(renderer, writeBuffer, readBuffer) {
    const depth = readBuffer.depthTexture;
    const cam = this.camera;
    const comp = this.compMat.uniforms;
    if (!depth || this.strength <= 0) {
      // pass-through copy (keeps the ping-pong order the same whether or not AO is active)
      comp.tDiffuse.value = readBuffer.texture; comp.tDepth.value = depth; comp.uStrength.value = 0;
      this.quad.material = this.compMat;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this.quad.render(renderer);
      return;
    }
    const pe = cam.projectionMatrix.elements;
    const u = this.aoMat.uniforms;
    u.tDepth.value = depth;
    u.uSize.value.set(depth.image.width, depth.image.height);
    u.uTexel.value.set(1 / depth.image.width, 1 / depth.image.height);
    u.uProj.value.set(pe[0], pe[5]);
    u.uNear.value = cam.near; u.uFar.value = cam.far;
    u.uRadius.value = this.radius; u.uIntensity.value = this.intensity;
    u.uMaxPx.value = this.maxPx * depth.image.height / 1080;
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    // 1. AO
    this.quad.material = this.aoMat;
    renderer.setRenderTarget(this.rtA); this.quad.render(renderer);
    // 2. blur H -> B, V -> A
    const b = this.blurMat.uniforms;
    this.quad.material = this.blurMat;
    b.tAO.value = this.rtA.texture; b.uDir.value.set(1 / this.rtA.width, 0);
    renderer.setRenderTarget(this.rtB); this.quad.render(renderer);
    b.tAO.value = this.rtB.texture; b.uDir.value.set(0, 1 / this.rtA.height);
    renderer.setRenderTarget(this.rtA); this.quad.render(renderer);
    // 3. composite
    comp.tDiffuse.value = readBuffer.texture; comp.tDepth.value = depth;
    comp.uNear.value = cam.near; comp.uFar.value = cam.far;
    comp.uStrength.value = this.strength; comp.uLitDamp.value = this.litDamp; comp.uExposure.value = this.exposure;
    this.quad.material = this.compMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    renderer.autoClear = prevAuto;
  }

  dispose() {
    this.rtA.dispose(); this.rtB.dispose();
    this.aoMat.dispose(); this.blurMat.dispose(); this.compMat.dispose();
    this.quad.dispose();
  }
}
