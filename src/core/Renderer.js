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
    r.shadowMap.enabled = true;
    r.shadowMap.type = quality.softShadows ? THREE.VSMShadowMap : THREE.PCFShadowMap;
    r.info.autoReset = false;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    r.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight, false);
    r.domElement.tabIndex = 0;
    container.appendChild(r.domElement);
    this.renderer = r;
    this.post = null;
    this.width = container.clientWidth || window.innerWidth;
    this.height = container.clientHeight || window.innerHeight;
  }

  setup(scenes) {
    this.post = new PostStack(this.renderer, { ...scenes, quality: this.quality });
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h);
  }

  render(dt, time) {
    if (this.post) { this.post.update(dt, time); this.post.render(); }
  }
}
