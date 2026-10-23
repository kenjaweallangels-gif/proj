import * as THREE from 'three';
import { PostStack } from '../fx/Post.js';

/** Owns the WebGLRenderer and the two-scene post-processed render path. */
export class Renderer {
  constructor(container, quality) {
    this.container = container;
    this.quality = quality;
    const r = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false, logarithmicDepthBuffer: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = quality.shadows !== false;
    r.shadowMap.type = quality.softShadows ? THREE.VSMShadowMap : THREE.PCFShadowMap;
    r.info.autoReset = false;
    r.setPixelRatio(this.basePixelRatio());
    r.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight, false);
    r.domElement.tabIndex = 0;
    container.appendChild(r.domElement);
    this.renderer = r;
    this.post = null;
    this.width = container.clientWidth || window.innerWidth;
    this.height = container.clientHeight || window.innerHeight;
  }

  /** Preset render scale (device pixels per CSS pixel), capped by the screen's own pixel density. */
  basePixelRatio() {
    const q = this.quality;
    return Math.max(Math.min(window.devicePixelRatio || 1, q.pixelRatio), this.floorPixelRatio());
  }

  /** Smallest render scale that still gives `minRenderHeight` lines (1080p floor); 0 when the preset has no floor. */
  floorPixelRatio() {
    const q = this.quality;
    if (!q.minRenderHeight) return 0;
    const h = this.container.clientHeight || window.innerHeight || 1080;
    return Math.min(q.maxPixelRatio || 3, q.minRenderHeight / h);
  }

  setup(scenes) {
    this.post = new PostStack(this.renderer, { ...scenes, quality: this.quality });
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    if (h !== this.height && this.quality.minRenderHeight) {
      // window resized: keep the resolution floor (the governor may only lower the scale down to it)
      const floor = this.floorPixelRatio();
      if (this.renderer.getPixelRatio() < floor) this.renderer.setPixelRatio(floor);
    }
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
  }

  render(dt, time) {
    if (this.post) { this.post.update(dt, time); this.post.render(); }
  }
}
