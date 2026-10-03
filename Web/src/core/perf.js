// Профайлер (opt-in): ?perf=1 или F3. Замеры CPU-времени update/lateUpdate по модулям, render, renderer.info, куча JS, график кадра.
// Без включения стоит ~0: игровой цикл не вызывает perf, пока perf.on === false.
// API: game.perf.enable(b), game.perf.snapshot(), game.perf.reset(), game.perf.countScene().
const EMA = 0.08;

export function createPerf(game, enabled0) {
  const mods = new Map(); // name → {u, l, uMax, lMax, uSum, lSum}
  const st = {
    on: !!enabled0,
    frame: 0, cpu: 0, render: 0, gpu: 0, // ms (EMA)
    info: { calls: 0, triangles: 0, lines: 0, points: 0, programs: 0, geometries: 0, textures: 0 },
    scene: { objects: 0, visible: 0, shadowCasters: 0, lights: 0, shadowLights: 0 },
    res: 1,
    acc: { n: 0, frame: 0, cpu: 0, render: 0, frameMax: 0, long: 0 },
    ring: new Float32Array(120), ri: 0,
  };
  const rec = (name) => { let m = mods.get(name); if (!m) { m = { u: 0, l: 0, uMax: 0, lMax: 0, uSum: 0, lSum: 0 }; mods.set(name, m); } return m; };

  // GPU-таймер (только если браузер даёт EXT_disjoint_timer_query_webgl2; в SwiftShader обычно нет)
  let gl2 = null, ext = null, q = null; const pend = [];
  function gpuInit() {
    try { gl2 = game.renderer.getContext(); ext = gl2.getExtension('EXT_disjoint_timer_query_webgl2'); } catch { ext = null; }
  }
  function gpuBegin() { if (!ext || q) return; q = gl2.createQuery(); gl2.beginQuery(ext.TIME_ELAPSED_EXT, q); }
  function gpuEnd() {
    if (!ext || !q) return;
    gl2.endQuery(ext.TIME_ELAPSED_EXT); pend.push(q); q = null;
    const f = pend[0];
    if (f && gl2.getQueryParameter(f, gl2.QUERY_RESULT_AVAILABLE)) {
      if (!gl2.getParameter(ext.GPU_DISJOINT_EXT)) st.gpu += (gl2.getQueryParameter(f, gl2.QUERY_RESULT) / 1e6 - st.gpu) * EMA;
      gl2.deleteQuery(f); pend.shift();
    }
    if (pend.length > 6) gl2.deleteQuery(pend.shift());
  }

  /** Обход сцены: сколько объектов видимо, сколько отбрасывают тени, сколько источников света. Дорого — звать редко. */
  function countScene() {
    const s = st.scene; s.objects = s.visible = s.shadowCasters = s.lights = s.shadowLights = 0;
    const walk = (o) => {
      if (!o.visible) return;
      s.objects++;
      if (o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isPoints || o.isLine) { s.visible++; if (o.castShadow) s.shadowCasters++; }
      if (o.isLight) { s.lights++; if (o.castShadow) s.shadowLights++; }
      for (const c of o.children) walk(c);
    };
    walk(game.scene);
    return s;
  }

  // ---- overlay ----
  let el = null, cv = null, cx = null, txtEl = null, shown = false, uiT = 0;
  function build() {
    el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:6px;top:6px;z-index:99999;pointer-events:none;font:11px/1.25 ui-monospace,Consolas,monospace;color:#cfe;background:rgba(0,0,0,.62);padding:6px 8px;border-radius:4px;white-space:pre;min-width:260px';
    txtEl = document.createElement('div');
    cv = document.createElement('canvas'); cv.width = 240; cv.height = 48; cv.style.cssText = 'display:block;margin-top:4px;width:240px;height:48px';
    cx = cv.getContext('2d');
    el.append(txtEl, cv); document.body.appendChild(el);
  }
  function draw() {
    if (!shown) return;
    const rows = [...mods.entries()].map(([n, m]) => [n, m.u + m.l]).sort((a, b) => b[1] - a[1]).slice(0, 9);
    const mem = performance.memory ? `${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : 'n/a';
    const i = st.info, s = st.scene;
    txtEl.textContent =
      `fps ${(1000 / Math.max(0.1, st.frame)).toFixed(0)}  frame ${st.frame.toFixed(1)} ms  cpu ${st.cpu.toFixed(1)}  render(cpu) ${st.render.toFixed(1)}` + (st.gpu ? `  gpu ${st.gpu.toFixed(1)}` : '') + '\n' +
      `res ${(st.res * 100).toFixed(0)}%  q=${game.settings.quality}  heap ${mem}\n` +
      `draw ${i.calls}  tri ${(i.triangles / 1000).toFixed(0)}k  prog ${i.programs}  geo ${i.geometries}  tex ${i.textures}\n` +
      `meshes ${s.visible}  shadowCasters ${s.shadowCasters}  lights ${s.lights}(${s.shadowLights} sh)\n` +
      rows.map(([n, v]) => `${n.padEnd(12)} ${v.toFixed(2)} ms ${'#'.repeat(Math.min(30, Math.round(v * 4)))}`).join('\n');
    cx.clearRect(0, 0, cv.width, cv.height);
    cx.fillStyle = 'rgba(255,255,255,.2)'; cx.fillRect(0, 48 - 16.7 * 0.75, 240, 1); cx.fillRect(0, 48 - 33.3 * 0.75, 240, 1);
    for (let k = 0; k < 120; k++) {
      const v = st.ring[(st.ri + k) % 120];
      cx.fillStyle = v > 33 ? '#f55' : v > 20 ? '#fd5' : '#5f9';
      const h = Math.min(48, v * 0.75); cx.fillRect(k * 2, 48 - h, 2, h);
    }
  }
  function setShown(b) { shown = !!b; if (shown && !el) build(); if (el) el.style.display = shown ? 'block' : 'none'; }
  addEventListener('keydown', (e) => { if (e.code === 'F3') { e.preventDefault(); st.enable(!st.on); } });

  const now = () => performance.now();
  let t0 = 0, tm = 0, tr = 0;
  Object.assign(st, {
    mods, countScene,
    overlay: true,
    enable(b) { st.on = !!b; if (st.on && !gl2) gpuInit(); setShown(st.on && st.overlay); },
    reset() { mods.clear(); st.acc = { n: 0, frame: 0, cpu: 0, render: 0, frameMax: 0, long: 0 }; },
    /** Среднее с последнего reset(): CPU мс/кадр по модулям + render info + состав сцены. */
    snapshot() {
      const a = st.acc, n = Math.max(1, a.n);
      const per = {};
      for (const [k, m] of mods) per[k] = +((m.uSum + m.lSum) / n).toFixed(3);
      return {
        frames: a.n, frameMs: +(a.frame / n).toFixed(2), frameMaxMs: +a.frameMax.toFixed(1), longFrames: a.long,
        cpuMs: +(a.cpu / n).toFixed(2), renderCpuMs: +(a.render / n).toFixed(2), modulesMs: per,
        ...st.info, scene: { ...countScene() }, res: st.res, gpuMs: +st.gpu.toFixed(2),
        heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null,
      };
    },
    // --- вызывается игровым циклом, только когда st.on ---
    beginFrame(rawMs) {
      st.frame += (rawMs - st.frame) * EMA;
      st.ring[st.ri] = rawMs; st.ri = (st.ri + 1) % 120;
      const a = st.acc; a.n++; a.frame += rawMs; if (rawMs > a.frameMax) a.frameMax = rawMs; if (rawMs > 33) a.long++;
      t0 = now();
    },
    modStart() { tm = now(); },
    modEnd(name, late) {
      const d = now() - tm, m = rec(name);
      if (late) { m.l += (d - m.l) * EMA; m.lSum += d; if (d > m.lMax) m.lMax = d; } else { m.u += (d - m.u) * EMA; m.uSum += d; if (d > m.uMax) m.uMax = d; }
    },
    renderStart() { tr = now(); gpuBegin(); },
    renderEnd() {
      gpuEnd();
      const t = now(), r = t - tr; st.render += (r - st.render) * EMA; st.acc.render += r;
      const c = t - t0; st.cpu += (c - st.cpu) * EMA; st.acc.cpu += c;
      const inf = game.renderer.info;
      st.info.calls = inf.render.calls; st.info.triangles = inf.render.triangles; st.info.lines = inf.render.lines; st.info.points = inf.render.points;
      st.info.programs = inf.programs?.length ?? 0; st.info.geometries = inf.memory.geometries; st.info.textures = inf.memory.textures;
      if (shown && ++uiT % 20 === 0) { countScene(); draw(); }
    },
  });
  if (st.on) { gpuInit(); setShown(true); }
  return st;
}
