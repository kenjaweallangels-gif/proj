import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Renderer } from './Renderer.js';
import { Orbit } from './Orbit.js';
import { Materials } from './Materials.js';
import { Textures } from './Textures.js';
import { ParticleSystem } from './Particles.js';
import { Input } from './Input.js';
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

  static autoQuality() {
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
    this.textures = new Textures(gl);
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
    this.input = new Input(gl.domElement, { pointerLock: !this.isShot });
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
    this.station = ctx.station = new Station(ctx);
    this.nearScene.add(this.station);
    this.ships = ctx.ships = new Ships(ctx);
    this.player = ctx.player = new Player(ctx);
    this.hud = ctx.hud = new Hud(ctx);
    this.audio = ctx.audio = new Audio(ctx);
    this.modules = [this.earth, this.sky, this.station, this.ships, this.player, this.hud, this.audio];

    this.hud.showLoading?.('Загрузка…');
    await Promise.all(this.modules.map((m) => m.load ? m.load().catch((e) => console.error(`load failed in ${m.constructor.name}`, e)) : null));
    this.renderer.setup({ farScene: this.farScene, farCamera: this.farCamera, nearScene: this.nearScene, camera: this.camera });

    // Observer camera controls
    this.orbitControls = new OrbitControls(this.camera, gl.domElement);
    this.orbitControls.enableDamping = true; this.orbitControls.dampingFactor = 0.06;
    this.orbitControls.minDistance = 2; this.orbitControls.maxDistance = 1500;
    this.orbitControls.enabled = false;

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    this.updateEnvironment(true);

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

  onResize() {
    this.renderer.resize();
    const a = this.renderer.width / this.renderer.height;
    this.camera.aspect = a; this.camera.updateProjectionMatrix();
    this.farCamera.aspect = a; this.farCamera.updateProjectionMatrix();
  }

  setMode(mode) {
    this.mode = mode;
    const observer = mode === 'observer';
    this.orbitControls.enabled = observer;
    if (observer) { this.input.exitPointerLock(); }
    this.player.setActive?.(!observer);
    this.events.emit('mode', mode);
  }

  toggleMode() { this.setMode(this.mode === 'observer' ? 'play' : 'observer'); }

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
    this.events.emit('view', name);
  }

  /** Resolves after `n` more frames have been rendered. */
  renderFrames(n = 1) { return new Promise((res) => this._frameWaiters.push({ until: this.frameCount + n, res })); }

  updateEnvironment(force = false) {
    const q = this.quality;
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
    this.sunLight.visible = o.sunVisible > 0.002;
    this.farSunLight.position.copy(o.sunDir).multiplyScalar(1e5);
    this.farSunLight.target.position.set(0, 0, 0);
    // Earthshine: blue-white light from below, proportional to the sunlit fraction of the Earth under us
    this.hemiLight.intensity = 0.55 * o.earthLit;
    this.hemiLight.groundColor.setRGB(0.42, 0.56, 0.78).multiplyScalar(0.7 + 0.3 * o.earthLit);

    for (const m of this.modules) { try { m.update?.(t.dt, this.ctx); } catch (e) { if (!m._errored) { console.error(`update failed in ${m.constructor.name}`, e); m._errored = true; } } }
    if (this.mode === 'observer') this.orbitControls.update();
    this.particles.update(t.dt, this.renderer.renderer, this.camera);

    // far camera mirrors the near camera
    this.camera.updateMatrixWorld();
    this.farCamera.position.copy(this.camera.getWorldPosition(new THREE.Vector3())).multiplyScalar(NEAR_TO_FAR);
    this.farCamera.quaternion.copy(this.camera.getWorldQuaternion(new THREE.Quaternion()));
    if (this.farCamera.fov !== this.camera.fov) { this.farCamera.fov = this.camera.fov; this.farCamera.updateProjectionMatrix(); }

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
