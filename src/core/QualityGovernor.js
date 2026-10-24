/**
 * Keeps a GPU preset at its frame-rate target (default 60 fps) without ever rendering below the
 * resolution floor (default 1080 lines): when frames run long it gives up, in order,
 *   supersampling above the floor -> MSAA samples -> shadow-map size -> station detail distance ->
 *   env-map refresh rate -> ambient occlusion -> bloom,
 * and restores them (in reverse) when there is sustained headroom. Headroom is judged from GPU time
 * (EXT_disjoint_timer_query_webgl2) when the browser exposes it; otherwise a step up is tried after a
 * long stable period and reverted (and that level locked for a while) if it causes drops.
 *
 *   const gov = new QualityGovernor(app); gov.update(realDt);   // once per frame, before rendering
 *   gov.beginGpu(); ...render...; gov.endGpu();                  // around the frame's GPU work
 */
export class QualityGovernor {
  constructor(app) {
    this.app = app;
    const q = app.quality;
    this.target = q.targetFps || 60;
    this.levels = this._buildLevels();
    this.level = 0;                      // 0 = full quality
    this.window = { frames: 0, time: 0, worst: 0 };
    this.good = 0;
    this.lockUntil = 0;                  // seconds (wall clock) during which stepping up is blocked
    this.lastChange = 0;
    this.fps = 0;
    this.gpuMs = null;                   // smoothed GPU frame time when measurable
    this._initTimer();
  }

  /** Quality levels from best to cheapest; each is a full set of knob values. */
  _buildLevels() {
    const q = this.app.quality;
    const base = { pr: this.app.renderer.basePixelRatio(), msaa: q.msaa || 0, shadow: q.shadowMapSize || 2048, env: q.envUpdateInterval || 2, bloom: !!q.bloom,
      detail: 1, ao: !!this.app.renderer.post?.aoPass };
    // no resolution floor (?minh=0): never step below half the preset scale (a 0 px drawing buffer renders nothing)
    const floor = this.app.renderer.floorPixelRatio() || Math.min(base.pr, 0.5);
    const L = [{ ...base }];
    const push = (patch) => L.push({ ...L[L.length - 1], ...patch });
    // 1. supersampling above the resolution floor, in steps
    for (let pr = base.pr * 0.85; pr > floor + 0.01; pr *= 0.85) push({ pr });
    if (L[L.length - 1].pr > floor + 0.001) push({ pr: floor });
    // 2. MSAA (SMAA still runs)
    if (base.msaa > 2) push({ msaa: 2 });
    if (base.msaa > 0) push({ msaa: 0 });
    // 3. shadow map
    for (let s = base.shadow / 2; s >= 1024; s /= 2) push({ shadow: s });
    // 4. close-range station hardware drawn to 60 % of its distance (Detail.js), 5. environment reflections
    // refresh, 6. ambient occlusion, 7. bloom
    if (this.app.station?.detail) push({ detail: 0.6 });
    push({ env: Math.max(base.env, 6) });
    if (base.ao) push({ ao: false });
    if (base.bloom) push({ bloom: false });
    return L;
  }

  _initTimer() {
    const gl = this.app.renderer.renderer.getContext();
    this.gl = gl;
    this.ext = gl.getExtension && gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.queries = [];
    this.active = null;
    this.frameMs = 1000;                 // last wall-clock frame time, bounds plausible GPU samples
    this.badSamples = 0;
  }

  beginGpu() {
    if (!this.ext || this.active) return;
    const gl = this.gl, q = gl.createQuery();
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  endGpu() {
    if (!this.ext || !this.active) return;
    const gl = this.gl;
    gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.queries.push(this.active); this.active = null;
    // poll finished queries (results arrive a few frames later)
    while (this.queries.length) {
      const q = this.queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      gl.deleteQuery(q); this.queries.shift();
      if (disjoint) continue;
      const ms = ns / 1e6;
      // GPU time cannot exceed the wall-clock frame time; some drivers (and software rasterisers) report
      // queue latency instead. Drop such samples, and stop trusting the timer if it keeps doing it.
      if (ms > this.frameMs * 1.5 + 2) {
        if (++this.badSamples <= 20) continue;
        this.ext = null; this.gpuMs = null;
        for (const r of this.queries) gl.deleteQuery(r);
        this.queries.length = 0;
        return;
      }
      this.badSamples = Math.max(0, this.badSamples - 1);
      this.gpuMs = this.gpuMs == null ? ms : this.gpuMs * 0.9 + ms * 0.1;
    }
    if (this.queries.length > 8) { gl.deleteQuery(this.queries.shift()); }
  }

  /** Call once per frame with the real (wall-clock) frame time in seconds. */
  update(dt) {
    const w = this.window;
    w.frames++; w.time += dt; w.worst = Math.max(w.worst, dt);
    this.frameMs = dt * 1000;
    if (w.time < 0.5) return;
    const fps = w.frames / w.time;
    this.fps = fps;
    w.frames = 0; w.time = 0; w.worst = 0;
    if (this.skip) { this.skip = false; return; }
    const now = performance.now() / 1000;
    const budget = 1000 / this.target;
    if (fps < this.target - 3) {
      // too slow: go down one level (two if far off)
      this.good = 0;
      const steps = fps < this.target * 0.75 ? 2 : 1;
      if (this.level < this.levels.length - 1) {
        if (now - this.lastChange < 2 && this._justRaised) this.lockUntil = now + 30;   // the last step up did not hold
        this._apply(Math.min(this.levels.length - 1, this.level + steps), now);
      }
    } else if (fps >= this.target - 1) {
      // at target: step up only with evidence of headroom (GPU time) or after a long stable period
      this.good++;
      const headroom = this.gpuMs != null ? this.gpuMs < budget * 0.7 : this.good >= 20;
      if (this.level > 0 && now > this.lockUntil && this.good >= 6 && headroom) { this.good = 0; this._apply(this.level - 1, now, true); }
    } else this.good = 0;
  }

  /** Ignore the next measurement window (e.g. after a view or mode switch). */
  skipWindow() { this.skip = true; this.window.frames = 0; this.window.time = 0; }

  _apply(level, now, raised = false) {
    const prev = this.levels[this.level], next = this.levels[level];
    this.level = level; this.lastChange = now; this._justRaised = raised;
    const app = this.app, gl = app.renderer.renderer, post = app.renderer.post;
    if (Math.abs(prev.pr - next.pr) > 1e-3) { gl.setPixelRatio(next.pr); app.onResize(); }
    if (prev.msaa !== next.msaa) post?.setSamples?.(next.msaa);
    if (prev.shadow !== next.shadow) {
      const sh = app.sunLight.shadow;
      sh.mapSize.set(next.shadow, next.shadow);
      if (sh.map) { sh.map.dispose(); sh.map = null; }
      if (sh.mapPass) { sh.mapPass.dispose(); sh.mapPass = null; }
    }
    if (prev.env !== next.env) app.quality.envUpdateInterval = next.env;
    if (prev.bloom !== next.bloom && post?.grade) post.grade.bloom = next.bloom;
    if (prev.detail !== next.detail) app.quality.detailScale = next.detail;
    if (prev.ao !== next.ao && post?.grade) post.grade.ao = next.ao;
    app.events?.emit('quality-level', { level, of: this.levels.length - 1, knobs: next });
  }

  /** Human-readable state for the HUD / debugging. */
  describe() {
    const k = this.levels[this.level];
    const gl = this.app.renderer.renderer.getContext();
    return `${gl.drawingBufferWidth}×${gl.drawingBufferHeight} · MSAA ${k.msaa}× · тени ${k.shadow}${k.detail < 1 ? ' · детали ×' + k.detail : ''}${k.ao ? ' · AO' : ''} · ${k.bloom ? 'bloom' : 'без bloom'} · ур. ${this.level}/${this.levels.length - 1}${this.gpuMs != null ? ` · GPU ${this.gpuMs.toFixed(1)} мс` : ''}`;
  }
}
