import * as THREE from 'three';

/**
 * Streams 5-degree tiles of a global layer (tools/prepare_earth_textures.py: tiles/<layer>/rRRcCC.webp, listed in
 * tiles/manifest.json) into a toroidal N x N tile window around the sub-station point: one mipmapped render target
 * whose slot (col mod N, row mod N) holds tile (col, row). Moving the window only redraws the slots that change
 * (cleared at once, filled as the tiles arrive, at most two per frame), so there is no double buffer and no full
 * re-composite. The alpha (or green, for one-channel layers) channel is 1 where a slot holds valid data: the shader
 * multiplies its detail by it, which also fades slot borders through the mip chain.
 *
 * Shader side (TILE_GLSL in EarthShaders.js): tile coordinates t = (u * 72, (1 - v) * 36); inside the window when
 * (t.x - c0) mod 72 < N and r0 <= t.y < r0 + N; texture uv = (fract(t.x / N), 1 - fract(t.y / N)), sampled with the
 * gradients of the continuous t / N. Uniforms: tex, and vec4 (c0, r0, N, fade).
 */
const COLS = 72, ROW_MIN = 3, ROW_MAX = 33;   // rows 3..32 = 75N..75S
const TILE_DEG = 5;
const MAX_DRAWS = 12;                         // slot draws (clears + tiles) per frame, one render

const VERT = /* glsl */`
varying vec2 vUv;
uniform vec4 uRect;   // NDC x0, y0, x1, y1
void main() { vUv = uv; gl_Position = vec4(mix(uRect.xy, uRect.zw, uv), 0.0, 1.0); }`;
const FRAG = /* glsl */`
uniform sampler2D tTile;
uniform float uClear, uOneChannel;
varying vec2 vUv;
void main() {
  if (uClear > 0.5) { gl_FragColor = vec4(0.0); return; }
  vec3 c = texture2D(tTile, vUv).rgb;
  gl_FragColor = uOneChannel > 0.5 ? vec4(c.r, 1.0, 0.0, 1.0) : vec4(c, 1.0);
}`;

let _manifest = null;
/** Loads tiles/manifest.json once (shared by all layers). */
export function loadTileManifest(assetUrl) {
  if (!_manifest) {
    _manifest = fetch(assetUrl('textures/earth/tiles/manifest.json')).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  }
  return _manifest;
}

export class TileWindow {
  /**
   * @param opts { name, tilePx, n (window size in tiles), srgb, oneChannel, ids (tile ids r*100+c), anisotropy, lead (deg) }
   */
  constructor(renderer, assetUrl, opts) {
    this.renderer = renderer;
    this.assetUrl = assetUrl;
    this.name = opts.name;
    this.n = opts.n;
    this.tilePx = opts.tilePx;
    this.oneChannel = !!opts.oneChannel;
    this.ids = new Set(opts.ids || []);
    this.lead = opts.lead ?? 3;
    const size = this.n * this.tilePx;
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      format: this.oneChannel ? THREE.RGFormat : THREE.RGBAFormat,
      colorSpace: opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
      depthBuffer: false, stencilBuffer: false,
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
    });
    this.rt.texture.anisotropy = opts.anisotropy || 1;
    this.uTex = { value: this.rt.texture };
    this.uWin = { value: new THREE.Vector4(0, ROW_MIN, this.n, 0) };   // c0, r0, N, fade
    this.slots = new Array(this.n * this.n).fill(-1);     // tile id held by each slot (-1 empty)
    this.pending = new Map();                             // tile id -> { slot, tex | null, failed }
    this.c0 = -999; this.r0 = -999;
    this.cleared = false;
    this.loader = new THREE.ImageBitmapLoader();
    this.loader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    // a pool of quads: all slot draws of a frame go into one render (one mip-chain rebuild of the window)
    this.geo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    this.scene = new THREE.Scene();
    this.quads = [];
    for (let i = 0; i < MAX_DRAWS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { tTile: { value: null }, uRect: { value: new THREE.Vector4() }, uClear: { value: 0 }, uOneChannel: { value: this.oneChannel ? 1 : 0 } },
        vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, toneMapped: false,
      });
      const q = new THREE.Mesh(this.geo, mat);
      q.frustumCulled = false; q.visible = false; q.renderOrder = i;
      this.quads.push(q);
      this.scene.add(q);
    }
    this.nDraw = 0;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._clearColor = new THREE.Color();
    this._order = [];
    this.disposed = false;
    this.bytes = size * size * (this.oneChannel ? 2 : 4) * 4 / 3;
  }

  /** Tiles present for this layer (manifest); forces the window to be recomputed. */
  setIds(ids) { this.ids = new Set(ids); this.c0 = -999; }

  slotRect(id, out) {
    const r = Math.floor(id / 100), c = id % 100, n = this.n;
    const sx = ((c % n) + n) % n, sy = ((r % n) + n) % n;
    // texture v = 1 - fract(row / N): row slot sy spans v in [1 - (sy + 1) / N, 1 - sy / N]
    return out.set((sx / n) * 2 - 1, (1 - (sy + 1) / n) * 2 - 1, ((sx + 1) / n) * 2 - 1, (1 - sy / n) * 2 - 1);
  }

  /** Queues a slot draw (tex = null clears the slot); false when this frame's batch is full. */
  draw(id, tex) {
    if (this.nDraw >= MAX_DRAWS) return false;
    const q = this.quads[this.nDraw++];
    const u = q.material.uniforms;
    this.slotRect(id, u.uRect.value);
    u.tTile.value = tex; u.uClear.value = tex ? 0 : 1;
    q.visible = true;
    return true;
  }

  /** Window origin for a centre (deg). */
  setCentre(lat, lon) {
    const n = this.n;
    const tx = (lon + 180) / TILE_DEG, ty = (90 - lat) / TILE_DEG;
    let c0 = Math.round(tx - n / 2);
    c0 = ((c0 % COLS) + COLS) % COLS;
    const r0 = Math.min(ROW_MAX - n, Math.max(ROW_MIN, Math.round(ty - n / 2)));
    if (c0 === this.c0 && r0 === this.r0) return;
    this.c0 = c0; this.r0 = r0;
    // wanted tiles, nearest the centre first
    const want = this._order;
    want.length = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const r = r0 + j, c = (c0 + i) % COLS, id = r * 100 + c;
      const d = Math.abs(c0 + i + 0.5 - tx) + Math.abs(r + 0.5 - ty);
      want.push({ id, d, slot: (((r % n) + n) % n) * n + (((c % n) + n) % n) });
    }
    want.sort((a, b) => a.d - b.d);
    this._changes = [];
    for (const w of want) {
      const has = this.slots[w.slot];
      if (has === w.id) continue;
      if (has >= 0 || !this.cleared) this._changes.push({ slot: w.slot, id: -1, clearId: has >= 0 ? has : w.id });
      this.slots[w.slot] = -1;
      if (!this.ids.has(w.id)) continue;               // no data (open ocean / no lights): stays cleared
      if (this.pending.has(w.id)) continue;
      const job = { id: w.id, slot: w.slot, tex: null, failed: false };
      this.pending.set(w.id, job);
      const r = Math.floor(w.id / 100), c = w.id % 100;
      const name = `r${String(r).padStart(2, '0')}c${String(c).padStart(2, '0')}.webp`;
      this.loader.loadAsync(this.assetUrl(`textures/earth/tiles/${this.name}/${name}`)).then((bmp) => {
        if (this.disposed || this.pending.get(w.id) !== job) { bmp.close?.(); return; }
        const t = new THREE.Texture(bmp);
        t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
        job.tex = t;
      }).catch(() => { job.failed = true; });
    }
  }

  /** Per frame: clears / draws at most `budget` slots (texture upload + mip regeneration). */
  update(lat, lon, dirLat, dirLon, dtReal, active = true) {
    const u = this.uWin.value;
    if (active) {
      const k = Math.hypot(dirLat, dirLon) || 1;
      this.setCentre(lat + (this.lead * dirLat) / k, lon + (this.lead * dirLon) / k);
    }
    u.x = this.c0; u.y = this.r0;
    u.w = Math.max(0, Math.min(1, u.w + (active ? dtReal : -dtReal) / 1.5));
    const changes = this._changes;
    let ready = null;
    for (const [id, job] of this.pending) {
      if (job.failed) { this.pending.delete(id); continue; }
      // dropped from the window meanwhile?
      const r = Math.floor(id / 100), c = id % 100, n = this.n;
      const inWin = r >= this.r0 && r < this.r0 + n && ((c - this.c0 + COLS) % COLS) < n;
      if (!inWin) { this.pending.delete(id); job.tex?.dispose(); job.tex?.image?.close?.(); continue; }
      if (job.tex) { (ready || (ready = [])).push(job); if (ready.length >= 2) break; }
    }
    if (!(changes && changes.length) && !ready) return;
    const gl = this.renderer;
    const prev = gl.getRenderTarget(), prevAuto = gl.autoClear, prevAlpha = gl.getClearAlpha();
    gl.getClearColor(this._clearColor);
    gl.autoClear = false;
    gl.setRenderTarget(this.rt);
    if (!this.cleared) { gl.setClearColor(0x000000, 0); gl.clear(true, false, false); this.cleared = true; changes && (changes.length = 0); }
    this.nDraw = 0;
    if (changes) {
      let k = 0;
      while (k < changes.length && this.draw(changes[k].clearId, null)) k++;
      changes.splice(0, k);
    }
    const drawn = [];
    if (ready) for (const job of ready) {
      if (!this.draw(job.id, job.tex)) break;
      this.slots[job.slot] = job.id;
      this.pending.delete(job.id);
      drawn.push(job);
    }
    if (this.nDraw > 0) gl.render(this.scene, this.cam);
    for (const q of this.quads) { q.visible = false; q.material.uniforms.tTile.value = null; }
    for (const job of drawn) { job.tex.image?.close?.(); job.tex.dispose(); }
    gl.setRenderTarget(prev);
    gl.setClearColor(this._clearColor, prevAlpha);
    gl.autoClear = prevAuto;
  }

  dispose() {
    this.disposed = true;
    this.rt.dispose(); this.geo.dispose();
    for (const q of this.quads) q.material.dispose();
    for (const job of this.pending.values()) job.tex?.dispose();
  }
}
