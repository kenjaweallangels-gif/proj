import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Renderer } from './Renderer.js';
import { Orbit } from './Orbit.js';
import { Materials } from './Materials.js';
import { Textures } from './Textures.js';
import { ParticleSystem } from './Particles.js';
import { Input } from './Input.js';
import { batchStatic, atlasDecals } from './StaticBatcher.js';
import { QUALITY_PRESETS, LAYERS, SUN_LIGHT_INTENSITY, SUN_COLOR, NEAR_TO_FAR } from './constants.js';

/**
 * Scene modules are imported dynamically with a fallback to the stub implementation in src/stubs,
 * so a broken module never takes the whole app down (and shows up as a console error instead).
 */
const MODULE_LOADERS = {
  Earth: [() => import('../world/Earth.js'), () => import('../stubs/Earth.js')],
  Sky: [() => import('../world/Sky.js'), () => import('../stubs/Sky.js')],
  Station: [() => import('../station/Station.js'), () => import('../stubs/Station.js')],
  Ships: [() => import('../ships/Ships.js'), () => import('../stubs/Ships.js')],
  Player: [() => import('../player/Player.js'), () => import('../stubs/Player.js')],
  Hud: [() => import('../ui/Hud.js'), () => import('../stubs/Hud.js')],
  Audio: [() => import('../audio/Audio.js'), () => import('../stubs/Audio.js')],
};
async function loadModuleClass(name) {
  const [real, stub] = MODULE_LOADERS[name];
  try { const m = await real(); if (!m[name]) throw new Error(`module does not export ${name}`); return m[name]; }
  catch (e) { console.error(`[App] module ${name} failed to load, using stub:`, e); window.__MODULE_ERRORS__ = (window.__MODULE_ERRORS__ || []).concat([`${name}: ${e.message}`]); return (await stub())[name]; }
}

const LITE_DETAIL_DISTANCE = 18;   // metres
const LITE_SHIP_DISTANCE = 600;    // metres
const DYN_STEPS = [0.28, 0.32, 0.36, 0.4, 0.44, 0.5, 0.6, 0.75, 1.0, 1.25, 1.5, 2.0];
const _camPos = new THREE.Vector3();
const _bsCenter = new THREE.Vector3();

class Emitter {
  constructor() { this.map = new Map(); }
  on(name, fn) { if (!this.map.has(name)) this.map.set(name, new Set()); this.map.get(name).add(fn); return () => this.map.get(name).delete(fn); }
  emit(name, data) { const s = this.map.get(name); if (s) for (const fn of s) { try { fn(data); } catch (e) { console.error(e); } } }
}

export class App {
  constructor(container, uiRoot) {
    this.container = container;
    this.uiRoot = uiRoot;
    const p = new URLSearchParams(location.search);
    this.params = p;
    const presetName = QUALITY_PRESETS[p.get('quality')] ? p.get('quality') : App.autoQuality();
    this.quality = { preset: presetName, ...QUALITY_PRESETS[presetName] };
    // ?pr=<0.2..2> overrides the internal render scale (device pixels per CSS pixel)
    const prOverride = parseFloat(p.get('pr'));
    if (prOverride > 0.1 && prOverride <= 3) this.quality.pixelRatio = prOverride;
    this.isShot = p.get('shot') === '1';
    this.autostart = p.get('autostart') === '1' || this.isShot;
    this.mode = p.get('observer') === '1' ? 'observer' : 'play';
    this.viewName = p.get('view') || null;
    this.time = { sim: parseFloat(p.get('t') || '0') || 0, dt: 0, scale: parseFloat(p.get('timescale') || '1') || 1, elapsed: 0, real: 0 };
    this.frameCount = 0;
    this._frameWaiters = [];
    this.ready = false;
    this.paused = false;
  }

  /** True when WebGL runs on a CPU rasteriser (no GPU): SwiftShader, llvmpipe, Microsoft Basic Render… */
  static isSoftwareRenderer() {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
    } catch (_) { return false; }
  }

  static autoQuality() {
    if (App.isSoftwareRenderer()) return 'lite';
    const dpr = window.devicePixelRatio || 1;
    const cores = navigator.hardwareConcurrency || 4;
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    if (mobile) return 'medium';
    if (cores >= 8 && dpr <= 2) return 'ultra';
    return 'high';
  }

  assetUrl(path) { return `${import.meta.env.BASE_URL}${path}`.replace(/\/\//g, '/'); }

  async start() {
    const q = this.quality;
    this.renderer = new Renderer(this.container, q);
    const gl = this.renderer.renderer;
    this.textures = new Textures(gl, q.anisotropy);
    this.materials = new Materials(this.textures);

    // Scenes & cameras
    this.nearScene = new THREE.Scene();
    this.farScene = new THREE.Scene();
    this.farScene.background = new THREE.Color(0x000000);
    const aspect = this.renderer.width / this.renderer.height;
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.05, 6000);
    this.camera.layers.enable(LAYERS.NO_SHADOW);
    this.camera.layers.enable(LAYERS.FIRST_PERSON);
    this.farCamera = new THREE.PerspectiveCamera(70, aspect, 20, 2.5e6);
    this.nearScene.add(this.camera);

    // Lights (near scene)
    this.sunLight = new THREE.DirectionalLight(SUN_COLOR, SUN_LIGHT_INTENSITY);
    this.sunLight.castShadow = true;
    const sh = this.sunLight.shadow;
    sh.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    sh.camera.left = -150; sh.camera.right = 150; sh.camera.top = 150; sh.camera.bottom = -150;
    sh.camera.near = 1; sh.camera.far = 700;
    sh.bias = -0.00035; sh.normalBias = 0.6; sh.radius = 2;
    this.sunLight.target = new THREE.Object3D();
    this.nearScene.add(this.sunLight, this.sunLight.target);
    this.hemiLight = new THREE.HemisphereLight(0x070a12, 0x6f8fc2, 0.0);
    this.hemiLight.position.set(0, 1, 0);
    this.nearScene.add(this.hemiLight);
    this.ambientLight = new THREE.AmbientLight(0x1a2030, 0.12);
    this.nearScene.add(this.ambientLight);
    // Far-scene light for stub geometry (real Earth shader uses orbit.sunDir directly)
    this.farSunLight = new THREE.DirectionalLight(0xffffff, 2.5);
    this.farScene.add(this.farSunLight, this.farSunLight.target);

    this.orbit = new Orbit();
    this.orbit.update(this.time.sim);
    this.particles = new ParticleSystem(this.nearScene, { max: q.particles });
    // ?nolock=1: mouse look without pointer lock (kiosk / remote / headless sessions, where the lock is unavailable or slow)
    this.input = new Input(gl.domElement, { pointerLock: !this.isShot && this.params.get('nolock') !== '1' });
    this.events = new Emitter();

    // Environment map (reflections of Earth/Sun/stars on the station) from the far scene
    this.cubeRT = new THREE.WebGLCubeRenderTarget(q.envMapSize, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cubeCamera = new THREE.CubeCamera(20, 2.5e6, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(gl);
    this._envTimer = 1e9;

    const ctx = this.ctx = {
      app: this, renderer: gl, nearScene: this.nearScene, farScene: this.farScene, camera: this.camera, farCamera: this.farCamera,
      orbit: this.orbit, materials: this.materials, textures: this.textures, particles: this.particles, input: this.input,
      quality: q, time: this.time, sunLight: this.sunLight, hemiLight: this.hemiLight, farSunLight: this.farSunLight, events: this.events,
      assetUrl: (p) => this.assetUrl(p), isShot: this.isShot, get mode() { return this.app.mode; }, uiRoot: this.uiRoot, params: this.params,
    };

    // Modules (order matters: later modules may use earlier ones through ctx)
    const [Earth, Sky, Station, Ships, Player, Hud, Audio] = await Promise.all(['Earth', 'Sky', 'Station', 'Ships', 'Player', 'Hud', 'Audio'].map(loadModuleClass));
    this.earth = ctx.earth = new Earth(ctx);
    this.sky = ctx.sky = new Sky(ctx);
    // geometry detail factor for everything built from here on (see src/core/three-lod.js);
    // the Earth and sky above keep full tessellation (smooth limb)
    globalThis.__THREE_DETAIL = q.detail ?? 1;
    this.station = ctx.station = new Station(ctx);
    this.nearScene.add(this.station);
    this.ships = ctx.ships = new Ships(ctx);
    this.player = ctx.player = new Player(ctx);
    this.hud = ctx.hud = new Hud(ctx);
    this.audio = ctx.audio = new Audio(ctx);
    this.modules = [this.earth, this.sky, this.station, this.ships, this.player, this.hud, this.audio];
    globalThis.__THREE_DETAIL = 1;

    this.hud.showLoading?.('Загрузка…');
    await Promise.all(this.modules.map((m) => m.load ? m.load().catch((e) => console.error(`load failed in ${m.constructor.name}`, e)) : null));
    if (q.lite) this.applyLite();
    this.renderer.setup({ farScene: this.farScene, farCamera: this.farCamera, nearScene: this.nearScene, camera: this.camera });

    // Observer camera controls
    this.orbitControls = new OrbitControls(this.camera, gl.domElement);
    this.orbitControls.enableDamping = true; this.orbitControls.dampingFactor = 0.06;
    this.orbitControls.minDistance = 2; this.orbitControls.maxDistance = 1500;
    this.orbitControls.enabled = false;

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    this.updateEnvironment(true);
    // compile every material up front (also those outside the first view), so no shader compile
    // stalls happen later when ships, the ring or the airlock first come into view
    this.hud.showLoading?.('Подготовка шейдеров…');
    try {
      await this.compileAll(this.farScene, this.farCamera);
      await this.compileAll(this.nearScene, this.camera);
    } catch (e) { console.warn('shader precompile failed', e); }

    if (this.viewName) this.setView(this.viewName);
    else if (this.mode === 'observer') this.setView('overview');
    this.setMode(this.mode);

    this.hud.hideLoading?.();
    if (this.autostart) this.hud.hideMenu?.(); else this.hud.showMenu?.();
    this.ready = true;
    window.__APP_READY__ = true;
    this.events.emit('ready');
    this.timer = new THREE.Timer();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /**
   * 'lite' preset for CPU rasterisers: keep only the Sun and earthshine (spotlights, helmet lamp off),
   * no shadows or environment map, and swap PBR materials for per-pixel Lambert with the same maps.
   * Runs once, before the first frame compiles any shader.
   */
  applyLite() {
    const keep = new Set([this.sunLight, this.hemiLight, this.ambientLight]);
    this.nearScene.traverse((o) => { if (o.isLight && !keep.has(o)) o.visible = false; });
    this.sunLight.castShadow = false;
    this.ambientLight.intensity = 0.22;   // spotlights are gone: lift the night side a little
    this.nearScene.environment = null;
    const swapped = new Map();
    const toLambert = (m) => {
      if (!m || !m.isMeshStandardMaterial || m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return m;
      if (swapped.has(m)) return swapped.get(m);
      const L = new THREE.MeshLambertMaterial({
        name: m.name, color: m.color, map: m.map, emissive: m.emissive, emissiveMap: m.emissiveMap, emissiveIntensity: m.emissiveIntensity,
        transparent: m.transparent, opacity: m.opacity, side: m.side, alphaTest: m.alphaTest, depthWrite: m.depthWrite, depthTest: m.depthTest,
        vertexColors: m.vertexColors, polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits,
        blending: m.blending, toneMapped: m.toneMapped, colorWrite: m.colorWrite, fog: false,
      });
      // transparent double-sided: one pass (three otherwise draws back and front faces separately)
      if (L.transparent && L.side === THREE.DoubleSide) L.forceSinglePass = true;
      // metals have no diffuse term in PBR: darken them a bit so gold/steel do not read as matte paint
      if (m.metalness > 0.5) L.color.multiplyScalar(0.75);
      swapped.set(m, L);
      return L;
    };
    this.nearScene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(toLambert) : toLambert(o.material);
      o.castShadow = false;
    });
    this._liteSwap = toLambert;
    // fine greebles cost more triangles than they add at lite resolution
    for (const name of ['handrailPosts', 'studs', 'cableClamps', 'ringLattice']) this.station.getObjectByName(name)?.removeFromParent();
    // text decals -> one atlas; then merge the station's static geometry (instanced parts are slow on
    // CPU rasterisers) across plain materials (colour baked into vertex colours), in 60 m cells so
    // frustum culling still drops what is off-screen
    const decals = atlasDecals(this.station);
    const t0 = this.time.sim;
    const res = batchStatic(this.station, () => {
      for (let i = 0; i < 160; i++) { this.orbit.update(t0 + i * 0.5); this.station.update(0.05, this.ctx); }
      this.orbit.update(t0);
    }, { cell: 60, mergeMaterials: true, detailRadius: 2.0, detailCell: 12, splitIslands: true });
    // small parts are drawn only near the camera (they are sub-pixel further away at lite resolution)
    this._detailBatches = [];
    this.station.traverse((o) => { if (o.userData.detail) this._detailBatches.push(o); });
    console.info(`[lite] station draw calls ${res.before} -> ${res.after} (${res.batches} batches, ${decals} decals in the atlas)`);
  }

  /** compileAsync() only covers visible objects: make everything visible for the compile (hidden ships,
   *  the suit in observer mode…), so nothing compiles mid-game. Lights keep their visibility (it is part
   *  of every program's key). */
  async compileAll(scene, camera) {
    const gl = this.renderer.renderer;
    const hidden = [], culled = [];
    scene.traverse((o) => {
      if (!o.visible && !o.isLight) { hidden.push(o); o.visible = true; }
      if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
    });
    try {
      await gl.compileAsync(scene, camera);
      // one throw-away frame into a tiny target uploads every geometry buffer and texture now, instead
      // of the first time each object comes into view (a visible hitch on CPU rasterisers)
      const rt = new THREE.WebGLRenderTarget(4, 4);
      const prevRT = gl.getRenderTarget(), prevAuto = gl.autoClear;
      gl.setRenderTarget(rt); gl.autoClear = true; gl.render(scene, camera);
      gl.setRenderTarget(prevRT); gl.autoClear = prevAuto; rt.dispose();
    } finally {
      for (const o of hidden) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
    }
  }

  /**
   * Dynamic resolution: keep the frame rate at or above `targetFps` by scaling the internal render
   * resolution between `minPixelRatio` and the preset's pixel ratio (checked once a second, with
   * hysteresis so it does not oscillate).
   */
  updateDynamicResolution(dt) {
    const q = this.quality;
    const d = this._dyn || (this._dyn = { frames: 0, time: 0, good: 0, pr: this.renderer.renderer.getPixelRatio(), max: this.renderer.renderer.getPixelRatio() });
    d.frames++; d.time += dt;
    if (d.time < 0.5) return;
    const fps = d.frames / d.time;
    d.frames = 0; d.time = 0;
    if (d.skip) { d.skip = false; return; }
    const target = q.targetFps || 25;
    // discrete scale steps: every change re-allocates the canvas, so change rarely and decisively.
    // Cost ~ pixels ~ scale^2: jump straight down to the step that should reach the target; go one step
    // up only after two consecutive windows with plenty of headroom.
    if (fps < target + 1) {
      d.good = 0;
      this.setRenderScale(d.pr * Math.sqrt(fps / (target + 3)), 'down');
    } else if (fps > target * 1.4) {
      if (++d.good >= 3) { d.good = 0; this.setRenderScale(d.pr, 'up'); }
    } else d.good = 0;
    this.fps = fps;
  }

  /** Apply an internal render scale, snapped to the dynamic-resolution steps ('down' / 'up' / nearest). */
  setRenderScale(pr, dir = 'down') {
    const d = this._dyn; if (!d) return;
    const steps = DYN_STEPS.filter((x) => x >= (this.quality.minPixelRatio || 0.28) - 1e-6 && x <= d.max + 1e-6);
    if (!steps.length) return;
    let next;
    if (dir === 'up') next = steps.find((x) => x > d.pr + 1e-6) ?? steps[steps.length - 1];
    else next = [...steps].reverse().find((x) => x <= pr + 1e-6) ?? steps[0];
    if (Math.abs(next - d.pr) < 1e-6) return;
    d.pr = next;
    this.renderer.renderer.setPixelRatio(next);
    this.onResize();
  }

  /** 'lite': hide small-part batches farther than LITE_DETAIL_DISTANCE from the camera. */
  cullDetails() {
    const cam = this.camera.getWorldPosition(_camPos);
    for (const m of this._detailBatches) {
      const bs = m.geometry.boundingSphere;
      _bsCenter.copy(bs.center).applyMatrix4(m.matrixWorld);
      m.visible = _bsCenter.distanceTo(cam) - bs.radius < LITE_DETAIL_DISTANCE;
    }
    // ships far out on approach / departure are sub-pixel: skip them. Visibility belongs to the ship
    // code (plumes, panels…), so the render layers are masked instead and restored when they return.
    for (const s of this.ships.ships || []) {
      const near = s.group.position.distanceTo(cam) < LITE_SHIP_DISTANCE;
      if (s._liteNear === near) continue;
      s._liteNear = near;
      s.group.traverse((o) => {
        if (!near) { o.userData._liteLayers = o.layers.mask; o.layers.mask = 0; }
        else if (o.userData._liteLayers !== undefined) { o.layers.mask = o.userData._liteLayers; delete o.userData._liteLayers; }
      });
    }
  }

  onResize() {
    this.renderer.resize();
    const a = this.renderer.width / this.renderer.height;
    this.camera.aspect = a; this.camera.updateProjectionMatrix();
    this.farCamera.aspect = a; this.farCamera.updateProjectionMatrix();
  }

  setMode(mode) {
    if (this._dyn && mode !== this.mode) this._dyn.skip = true;   // ignore the switch hitch in the next fps window
    this.mode = mode;
    const observer = mode === 'observer';
    this.orbitControls.enabled = observer;
    if (observer) { this.input.exitPointerLock(); }
    this.player.setActive?.(!observer);
    this.events.emit('mode', mode);
  }

  toggleMode() {
    const toObserver = this.mode !== 'observer';
    if (toObserver) {
      // free camera starts exactly where the astronaut looks: orbit pivot 15 m ahead (no swing toward the origin)
      this.camera.updateMatrixWorld();
      this.orbitControls.target.copy(this.camera.position).add(this.camera.getWorldDirection(_camPos).multiplyScalar(15));
    }
    this.setMode(toObserver ? 'observer' : 'play');
    if (toObserver) this.orbitControls.update();
  }

  /** Named camera views (observer) or player poses (play). Used by tools/screenshot.mjs and the menu. */
  setView(name) {
    const vp = this.station.viewpoints?.[name];
    // Sun-facing views: look along orbit.sunDir so the Sun/limb is in frame (sunrise ~t=3200, sunset ~t=1165)
    const s = this.orbit.sunDir;
    const sunView = (pos) => ({ position: pos, target: [pos[0] + s.x * 500, pos[1] + s.y * 500, pos[2] + s.z * 500] });
    const observerViews = {
      overview: { position: [150, 70, 185], target: [-10, 0, 0] },
      front: { position: [320, 40, 30], target: [0, 0, 0] },
      top: { position: [10, 330, 10], target: [0, 0, 0] },
      earth: { position: [40, 110, 70], target: [0, -60, 0] },
      sunrise: sunView([-60, 40, 120]),
      sunset: sunView([60, 40, -120]),
      limb: { position: [0, 30, 160], target: [0, -140, -400] },
    };
    const playerViews = ['airlock', 'eva', 'eva-far'];
    if (vp || observerViews[name]) {
      const v = vp || observerViews[name];
      this.mode = 'observer';
      this.camera.position.fromArray(v.position instanceof THREE.Vector3 ? v.position.toArray() : v.position);
      this.orbitControls.target.fromArray(v.target instanceof THREE.Vector3 ? v.target.toArray() : v.target);
      this.camera.lookAt(this.orbitControls.target);
      this.orbitControls.update();
      this.setMode('observer');
    } else if (playerViews.includes(name) || name.startsWith('player')) {
      this.setMode('play');
      this.player.setView?.(name);
    } else {
      console.warn('unknown view', name);
    }
    this.viewName = name;
    if (this._dyn) this._dyn.skip = true;
    this.events.emit('view', name);
  }

  /** Resolves after `n` more frames have been rendered. */
  renderFrames(n = 1) { return new Promise((res) => this._frameWaiters.push({ until: this.frameCount + n, res })); }

  updateEnvironment(force = false) {
    const q = this.quality;
    if (q.lite) return;
    if (!force && this._envTimer < q.envUpdateInterval) return;
    this._envTimer = 0;
    const gl = this.renderer.renderer;
    // render far scene (Earth, Sun, stars) into the cube map from the station position
    this.cubeCamera.position.copy(this.camera.position).multiplyScalar(NEAR_TO_FAR);
    const prevTM = gl.toneMapping; gl.toneMapping = THREE.NoToneMapping;
    this.cubeCamera.update(gl, this.farScene);
    gl.toneMapping = prevTM;
    const env = this.pmrem.fromCubemap(this.cubeRT.texture);
    if (this._envRT) this._envRT.dispose();
    this._envRT = env;
    this.nearScene.environment = env.texture;
    this.nearScene.environmentIntensity = 1.0;
  }

  _loop() {
    requestAnimationFrame(this._loop);
    const gl = this.renderer.renderer;
    this.timer.update();
    const realDt = this.timer.getDelta();
    if (this.quality.dynamicResolution && !this.isShot) this.updateDynamicResolution(realDt);
    let dt = this.isShot ? 1 / 60 : Math.min(realDt, 1 / 20);
    if (this.paused) dt = 0;
    const t = this.time;
    t.real += realDt;
    t.dt = dt * t.scale;
    t.sim += t.dt;
    t.elapsed += dt;
    this._envTimer += dt;

    // hotkeys handled centrally
    const inp = this.input;
    if (inp.wasPressed('KeyF')) this.toggleMode();
    if (inp.wasPressed('KeyT')) { const steps = [1, 10, 60, 300]; t.scale = steps[(steps.indexOf(t.scale) + 1) % steps.length]; this.events.emit('timescale', t.scale); }
    if (inp.wasPressed('KeyP')) this.paused = !this.paused;

    this.orbit.update(t.sim);
    const o = this.orbit;
    // Sun light follows the orbit; dims in the penumbra and reddens through the limb
    this.sunLight.position.copy(o.sunDir).multiplyScalar(400);
    this.sunLight.target.position.set(0, 0, 0);
    this.sunLight.intensity = SUN_LIGHT_INTENSITY * o.sunVisible;
    this.sunLight.color.set(SUN_COLOR).multiply(o.sunColor);
    // (never toggle a light's `visible`: it changes every material's program key and recompiles them all
    //  at sunset/sunrise; zero intensity in the umbra costs nothing)
    this.farSunLight.position.copy(o.sunDir).multiplyScalar(1e5);
    this.farSunLight.target.position.set(0, 0, 0);
    // Earthshine: blue-white light from below, proportional to the sunlit fraction of the Earth under us
    this.hemiLight.intensity = 0.55 * o.earthLit;
    this.hemiLight.groundColor.setRGB(0.42, 0.56, 0.78).multiplyScalar(0.7 + 0.3 * o.earthLit);
    // 'lite' has no floodlights or helmet lamp: stand in for them with ambient light in the eclipse
    if (this.quality.lite) {
      const night = 1 - o.sunVisible;
      this.ambientLight.color.setRGB(0.10 + 0.45 * night, 0.13 + 0.47 * night, 0.19 + 0.47 * night);
      this.ambientLight.intensity = 0.22 + 0.6 * night;
    }

    for (const m of this.modules) { try { m.update?.(t.dt, this.ctx); } catch (e) { if (!m._errored) { console.error(`update failed in ${m.constructor.name}`, e); m._errored = true; } } }
    if (this.mode === 'observer') this.orbitControls.update();
    this.particles.update(t.dt, this.renderer.renderer, this.camera);

    // far camera mirrors the near camera
    this.camera.updateMatrixWorld();
    this.farCamera.position.copy(this.camera.getWorldPosition(new THREE.Vector3())).multiplyScalar(NEAR_TO_FAR);
    this.farCamera.quaternion.copy(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    if (this.farCamera.fov !== this.camera.fov) { this.farCamera.fov = this.camera.fov; this.farCamera.updateProjectionMatrix(); }

    if (this._detailBatches) this.cullDetails();
    this.updateEnvironment();
    gl.info.reset();
    this.renderer.render(dt, t.elapsed);
    this.input.endFrame();
    this.frameCount++;
    if (this._frameWaiters.length) {
      const keep = [];
      for (const w of this._frameWaiters) (this.frameCount >= w.until ? w.res() : keep.push(w));
      this._frameWaiters = keep;
    }
  }
}
