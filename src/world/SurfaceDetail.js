import * as THREE from 'three';

/**
 * 'ultra': full-resolution (21600 x 10800, ~1.9 km/px at the equator, 500 m/px source) day imagery streamed
 * around the sub-station point. The Blue Marble image is shipped as 18-degree tiles (tools/prepare_earth_textures.py);
 * a 2048 x 2048 window (34 x 34 degrees, texel-aligned with the tiles) is composited from them into one of two
 * mipmapped sRGB render targets and swapped in when complete, so the ground shader always samples a finished
 * window. The ground shader adds only the window's high-pass (what the 8K texture lacks), with the seasonal
 * colour coming from the 8K bake, and fades it out with distance and at the window edges. At high time scales
 * (the ground races by) the layer fades out and the window stops following.
 *
 *   const sd = new SurfaceDetail(renderer, assetUrl, anisotropy);  material.uniforms: sd.uniforms
 *   sd.update(dtReal, subLatDeg, subLonDeg, trackDirLat, trackDirLon, timeScale)
 */
const FULL_W = 21600, FULL_H = 10800, TILE = 1080, COLS = 20, ROW_MIN = 1, ROW_MAX = 8;
const WIN_W = 2048, WIN_H = 2048;      // 34 x 34 degrees: the 2 km texels only matter within ~10 degrees of nadir
const PX_PER_DEG = FULL_W / 360;
const LEAD_DEG = 6;                    // window centre leads the sub-station point along the ground track
const RECENTRE_X = 560, RECENTRE_Y = 560;   // re-centre when the wanted centre drifts this far (window texels)

const SHIFTS = [0, FULL_W, -FULL_W];

const COMPOSITE_VERTEX = /* glsl */`
varying vec2 vUv;
uniform vec4 uRect;   // NDC x0, y0, x1, y1
void main() { vUv = uv; gl_Position = vec4(mix(uRect.xy, uRect.zw, uv), 0.0, 1.0); }`;
const COMPOSITE_FRAGMENT = /* glsl */`
uniform sampler2D tTile;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(tTile, vUv).rgb, 1.0); }`;

export class SurfaceDetail {
  constructor(renderer, assetUrl, anisotropy = 8) {
    this.renderer = renderer;
    this.assetUrl = assetUrl;
    this.uniforms = {
      tWin: { value: null },
      uWin: { value: new THREE.Vector4(0, 0, FULL_W / WIN_W, FULL_H / WIN_H) },
      uWinFade: { value: 0 },
    };
    this.targets = [0, 1].map(() => {
      const rt = new THREE.WebGLRenderTarget(WIN_W, WIN_H, {
        colorSpace: THREE.SRGBColorSpace, depthBuffer: false, stencilBuffer: false,
        generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      });
      rt.texture.anisotropy = anisotropy;
      return rt;
    });
    this.front = -1;                     // index of the displayed target
    this.win = { x0: 0, y0: 0 };         // displayed window origin (full-res texels; y from the top)
    this.job = null;                     // { target, x0, y0, pending: [{r, c, tex | null, failed}], drawn }
    this.loader = new THREE.ImageBitmapLoader();
    this.loader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tTile: { value: null }, uRect: { value: new THREE.Vector4() } },
      vertexShader: COMPOSITE_VERTEX, fragmentShader: COMPOSITE_FRAGMENT, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._clear = new THREE.Color();
    this.disposed = false;
  }

  /** Window origin (texels) for a wanted centre. */
  originFor(lat, lon) {
    const cx = (lon + 180) * PX_PER_DEG, cy = (90 - lat) * PX_PER_DEG;
    const x0 = ((Math.round(cx - WIN_W / 2) % FULL_W) + FULL_W) % FULL_W;
    const y0 = Math.min(ROW_MAX * TILE + TILE - WIN_H, Math.max(ROW_MIN * TILE, Math.round(cy - WIN_H / 2)));
    return { x0, y0 };
  }

  startJob(x0, y0) {
    const target = this.targets[this.front === 0 ? 1 : 0];
    const pending = [];
    const r0 = Math.max(ROW_MIN, Math.floor(y0 / TILE)), r1 = Math.min(ROW_MAX, Math.floor((y0 + WIN_H - 1) / TILE));
    const c0 = Math.floor(x0 / TILE), c1 = Math.floor((x0 + WIN_W - 1) / TILE);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) pending.push({ r, c: c % COLS, tex: null, failed: false });
    const job = { target, x0, y0, pending, drawn: 0, cleared: false };
    for (const t of pending) {
      this.loader.loadAsync(this.assetUrl(`textures/earth/tiles/m10/r${t.r}c${t.c}.jpg`)).then((bmp) => {
        if (this.disposed || this.job !== job) { bmp.close?.(); return; }
        const tex = new THREE.Texture(bmp);
        tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
        t.tex = tex;
      }).catch(() => { t.failed = true; });
    }
    this.job = job;
  }

  drawTile(job, t) {
    // tile texels [c*TILE, ..) x [r*TILE, ..) (from the top) -> window texels, wrapping across the date line
    const gl = this.renderer;
    let wx = t.c * TILE - job.x0;
    if (wx < -TILE) wx += FULL_W;
    if (wx > WIN_W) wx -= FULL_W;
    const wyTop = t.r * TILE - job.y0;
    const y0 = WIN_H - (wyTop + TILE), y1 = WIN_H - wyTop;          // render-target rows (bottom-up)
    this.mat.uniforms.tTile.value = t.tex;
    for (const shift of SHIFTS) {
      const x = wx + shift;
      if (x + TILE <= 0 || x >= WIN_W) continue;
      this.mat.uniforms.uRect.value.set((x / WIN_W) * 2 - 1, (y0 / WIN_H) * 2 - 1, ((x + TILE) / WIN_W) * 2 - 1, (y1 / WIN_H) * 2 - 1);
      gl.render(this.scene, this.cam);
    }
  }

  /**
   * @param dtReal real seconds since the last frame
   * @param lat/lon sub-station point (deg); dirLat/dirLon ground-track direction (any scale, for the lead)
   */
  update(dtReal, lat, lon, dirLat, dirLon, timeScale = 1) {
    const u = this.uniforms;
    const fast = timeScale > 10;
    // the wanted window: centred a little ahead of the station along the ground track
    const n = Math.hypot(dirLat, dirLon) || 1;
    const want = this.originFor(lat + (LEAD_DEG * dirLat) / n, lon + (LEAD_DEG * dirLon) / n);
    if (!this.job && !fast) {
      let dx = Math.abs(want.x0 - this.win.x0); dx = Math.min(dx, FULL_W - dx);
      if (this.front < 0 || dx > RECENTRE_X || Math.abs(want.y0 - this.win.y0) > RECENTRE_Y) this.startJob(want.x0, want.y0);
    }
    const job = this.job;
    if (job) {
      const gl = this.renderer;
      const prev = gl.getRenderTarget();
      const prevAlpha = gl.getClearAlpha(), prevAuto = gl.autoClear;
      gl.getClearColor(this._clear);
      gl.autoClear = false;
      gl.setRenderTarget(job.target);
      if (!job.cleared) { gl.setClearColor(0x000000, 1); gl.clear(true, false, false); job.cleared = true; }
      // composite at most two decoded tiles per frame (texture upload + quad)
      let budget = 2;
      for (const t of job.pending) {
        if (budget <= 0) break;
        if (!t.tex || t.done) continue;
        this.drawTile(job, t);
        t.done = true; budget--; job.drawn++;
        t.tex.image?.close?.(); t.tex.dispose(); t.tex = null;
      }
      gl.setRenderTarget(prev);
      gl.setClearColor(this._clear, prevAlpha);
      gl.autoClear = prevAuto;
      let finished = true;
      for (const t of job.pending) if (!t.done && !t.failed) { finished = false; break; }
      if (finished) {
        this.front = this.targets.indexOf(job.target);
        this.win.x0 = job.x0; this.win.y0 = job.y0;
        u.tWin.value = job.target.texture;
        u.uWin.value.x = job.x0 / FULL_W;
        u.uWin.value.y = 1 - (job.y0 + WIN_H) / FULL_H;
        this.job = null;           // same imagery, texel-aligned: the swap is seamless where both windows overlap
      }
    }
    if (this.front >= 0) u.uWinFade.value = Math.min(fast ? 0 : 1, Math.max(0, u.uWinFade.value + (fast ? -dtReal : dtReal) / 1.5));
    else u.uWinFade.value = 0;
  }

  dispose() {
    this.disposed = true;
    for (const rt of this.targets) rt.dispose();
    this.quad.geometry.dispose(); this.mat.dispose();
  }
}
