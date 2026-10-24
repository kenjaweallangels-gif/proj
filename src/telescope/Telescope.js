import * as THREE from 'three';
import { TelescopePanel } from '../ui/TelescopePanel.js';
import { LAYERS } from '../core/constants.js';
import { AU_KM, PLANETS, GALILEAN, BODY_DATA } from '../core/Ephemeris.js';
import { DARK_ADAPTED } from '../world/Sky.js';

/**
 * Telescope («телескоп», key Z or the HUD button): a 300 mm instrument with a camera, usable from the observer
 * camera, the cupola and EVA. While active it owns the view direction and field of view:
 *
 *  - aim: a direction in ECI (J2000) on an equatorial mount (north up, sidereal tracking: the stars stay put while
 *    the station turns), or locked to a target (planet / Moon / Sun / star / DSO) with a small offset; slews smoothly.
 *  - field of view 60 deg .. 0.05 deg (wheel, + / -), aim by dragging (mouse) or the arrow keys.
 *  - optics: magnification M = 70 deg / fov relative to the eye; exit pupil D / M -> above M = D / 7 mm the image dims
 *    (T = (D / 7 mm / M)^2); stars gain M^2 over the background up to the aperture limit (limiting magnitude
 *    ~ 6.5 + 5 log10(D / 7 mm)); diffraction (Airy core ~ 0.42 lambda / D) sets the star image at high zoom.
 *  - camera exposure: metered from what is in the field (Moon / planet discs, the Earth through the post exposure),
 *    spot-weighted on the target, long exposures on dark fields; resolved bodies keep a local adaptation so their
 *    surface stays readable; the Sun engages a solar filter (1e-5) with a warning, the lens flare / glare are off.
 *  - readouts and the catalogue / search panel: ui/TelescopePanel.js; field labels drawn by sky/Overlays.js.
 *
 * Views for screenshots: setView('tele-<target>-<fovDeg>'), e.g. tele-M42-1, tele-jupiter-0.02, tele-moon-0.6;
 * URL ?telescope=<target>&fov=<deg>. App calls update() before the player (input is captured and masked) and
 * lateUpdate() after the camera controllers (camera orientation / fov). `whenSettled()` resolves when the lazy
 * assets of the current field (deep stars, DSO tile, Moon / planet maps) are in.
 */

const D2R = Math.PI / 180;
const APERTURE_M = 0.3;
const FOV_MIN = 0.05, FOV_MAX = 60;
const EYE_PUPIL = 0.007;
const M_PUPIL = APERTURE_M / EYE_PUPIL;            // magnification above which the image dims
const SIGMA_AIRY = 0.42 * 550e-9 / APERTURE_M;     // rad
const KEY = 0.42;                                  // display level for the metered brightness
const X_DARK = 2.2 * DARK_ADAPTED;                 // exposure of the dark-adapted eye (night tone-mapping x Sky gain)
const MASKED_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
  'KeyQ', 'KeyE', 'KeyG', 'KeyR', 'KeyV', 'KeyX', 'KeyL', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const SUN_FILTER = 1e-5;

export const DSO_TYPES = {
  G: 'Галактика', GCl: 'Шаровое скопление', OCl: 'Рассеянное скопление', PN: 'Планетарная туманность', Neb: 'Туманность',
  HII: 'Эмиссионная туманность', 'Cl+N': 'Скопление с туманностью', RfN: 'Отражательная туманность', SNR: 'Остаток сверхновой',
  DrkN: 'Тёмная туманность', '*Ass': 'Звёздная ассоциация', '**': 'Двойная звезда', Other: 'Объект',
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _n = new THREE.Vector3(), _e = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _zero = new THREE.Vector3();
const _size = new THREE.Vector2();
const NORTH = new THREE.Vector3(0, 0, 1);

/** East / north unit vectors at an ECI direction (out vectors). */
function tangent(dir, east, north) {
  east.set(-dir.y, dir.x, 0);
  if (east.lengthSq() < 1e-12) east.set(0, 1, 0);
  east.normalize();
  north.crossVectors(dir, east).normalize();
}

export class Telescope {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.telescope = this;
    this.active = false;
    this.aim = new THREE.Vector3(1, 0, 0);       // ECI unit (current view axis)
    this.goal = new THREE.Vector3(1, 0, 0);      // where the mount is heading
    this.fov = FOV_MAX; this.fovTarget = FOV_MAX;
    this.target = null;                           // catalogue entry
    this.offset = new THREE.Vector2();            // east / north offset from the target (rad)
    this.tracking = true;
    this.slew = 0;                                // > 0 while slewing
    this.aperture = APERTURE_M;
    this.X = X_DARK;                              // camera exposure (applied to T-attenuated physical radiance)
    this.filter = false;
    this.catalog = null;
    this.readout = {};
    this._drag = null;
    this._stash = {};
    this._saved = null;
    this._pending = null;
    this.panel = new TelescopePanel(ctx, this);
    this._bindPointer();
    ctx.events?.on?.('mode', () => { if (this.active && !this._switching) this.exit(); });
    ctx.events?.on?.('view', (name) => { if (this.active && !this._switching && !String(name).startsWith('tele-')) this.exit(); });
    ctx.events?.on?.('ready', () => {
      const p = ctx.params;
      const t = p?.get?.('telescope');
      if (t) this.enterView(`tele-${t}-${p.get('fov') || '10'}`);
    });
  }

  async load() {}

  // ------------------------------------------------------------------ catalogue

  /** Builds the target list (bodies, named stars, DSOs) once the sky data is loaded. */
  buildCatalog() {
    if (this.catalog) return this.catalog;
    const ctx = this.ctx, sky = ctx.sky;
    const conRu = new Map((sky?.overlays?.constellations || []).map((c) => [c.id, c.ru]));
    const list = [];
    const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
    list.push({ id: 'sun', kind: 'body', body: 'sun', name: 'Солнце', type: 'Звезда', group: 'sol' });
    list.push({ id: 'moon', kind: 'body', body: 'moon', name: 'Луна', type: 'Спутник Земли', group: 'sol' });
    for (const p of PLANETS) list.push({ id: p, kind: 'body', body: p, name: BODY_DATA[p].ru, type: 'Планета', group: 'sol' });
    for (const g of GALILEAN) list.push({ id: g, kind: 'body', body: g, name: BODY_DATA[g].ru, type: 'Спутник Юпитера', group: 'sol' });
    for (const s of sky?.overlays?.starNames || []) {
      if (!s.dir || !(s.ru || s.name)) continue;
      const bayer = s.bayer ? `${s.bayer} ${s.con}` : (s.flam ? `${s.flam} ${s.con}` : '');
      list.push({
        id: `hip${s.hip ?? s.i}`, kind: 'star', star: s, dir: s.dir, name: s.ru || s.name, alt: [s.name, bayer].filter((x) => x && x !== s.ru).join(' · '),
        type: `Звезда${s.spect ? ' ' + s.spect.replace(/[^A-Za-z0-9.+-].*$/, '') : ''}`, con: conRu.get(s.con) || s.con, mag: s.v, group: 'star',
      });
    }
    for (const o of sky?.deepSky?.objects || []) {
      const label = o.ru || (o.name ? o.name.split(',')[0] : '') || o.ngc || o.id;
      list.push({
        id: o.id, kind: 'dso', dso: o, dir: o.dir, name: label, alt: [o.id, o.ngc, o.ru ? o.name?.split(',')[0] : ''].filter((x) => x && x !== label).join(' · '),
        type: DSO_TYPES[o.type] || o.typeName || 'Объект', con: conRu.get(o.con) || o.con, mag: o.v ?? o.b, group: 'dso',
      });
    }
    for (const e of list) e.search = norm([e.id, e.name, e.alt, e.type, e.con, e.dso?.name, e.dso?.ngc, e.star?.name].join(' '));
    this.catalog = list;
    this._byId = new Map(list.map((e) => [e.id.toLowerCase(), e]));
    return list;
  }

  /** Finds an entry by id or (partial) name: 'M42', 'moon', 'jupiter', 'Сириус', 'sirius', 'NGC 224', 'hip32349'. */
  find(q) {
    const list = this.buildCatalog();
    const s = String(q || '').toLowerCase().replace(/ё/g, 'е').replace(/_/g, ' ').trim();
    if (!s) return null;
    const exact = this._byId.get(s) || this._byId.get(s.replace(/\s+/g, ''));
    if (exact) return exact;
    return list.find((e) => e.name.toLowerCase() === s) || list.find((e) => e.search.split(' ').includes(s)) || list.find((e) => e.search.includes(s)) || null;
  }

  /** ECI unit direction of an entry (topocentric for solar-system bodies). */
  dirOf(e, out) {
    if (e.kind === 'body') { const b = this.ctx.ephemeris.bodies[e.body]; return out.set(b.topo.x, b.topo.y, b.topo.z).divideScalar(b.dist); }
    return out.copy(e.dir);
  }

  // ------------------------------------------------------------------ mode

  /** Why the telescope cannot be used here (null = it can). */
  unavailable() {
    const ctx = this.ctx;
    if (!ctx.sky || !ctx.ephemeris) return 'Телескоп недоступен';
    if (ctx.mode === 'observer') return null;
    const pl = ctx.player;
    if (!pl) return null;
    if (pl.state?.mode === 'eva') return null;
    if (pl.iva?.zone?.id === 'cupola') return null;
    return 'Телескоп доступен в куполе, в открытом космосе и в камере обзора (F)';
  }

  toggle() { if (this.active) this.exit(); else this.enter(); }

  enter(target = null) {
    const ctx = this.ctx;
    const why = this.unavailable();
    if (why) { ctx.hud?.notify?.(why, { kind: 'warn' }); return false; }
    if (!this.active) {
      this.active = true;
      const app = ctx.app;
      this._saved = {
        fov: ctx.camera.fov, quat: ctx.camera.quaternion.clone(), orbit: app?.orbitControls?.enabled,
        grade: app?.renderer?.post ? { flare: app.renderer.post.grade.flare, glareMax: app.renderer.post.grade.glareMax, dirt: app.renderer.post.grade.dirt } : null,
      };
      if (app?.orbitControls) app.orbitControls.enabled = false;
      try { ctx.input?.exitPointerLock?.(); } catch (_) { /* ignore */ }
      // start where the camera looks
      ctx.camera.updateMatrixWorld();
      _v.set(0, 0, -1).applyQuaternion(ctx.camera.getWorldQuaternion(_q));
      _qi.copy(ctx.orbit.skyQuat).invert();
      this.aim.copy(_v).applyQuaternion(_qi).normalize();
      this.goal.copy(this.aim);
      this.fov = Math.min(FOV_MAX, ctx.camera.fov); this.fovTarget = FOV_MAX;
      this.target = null; this.offset.set(0, 0);
      this._snapExposure = true;
      this.buildCatalog();
      ctx.sky?.starField?.loadDeep?.();
      this.panel.show(true);
      ctx.hud?._layers?.();
      ctx.events?.emit?.('telescope', true);
    }
    if (target) this.select(target);
    return true;
  }

  exit() {
    if (!this.active) return;
    const ctx = this.ctx, app = ctx.app, s = this._saved || {};
    this.active = false;
    ctx.camera.fov = s.fov ?? 70; ctx.camera.updateProjectionMatrix();
    if (s.quat && ctx.mode === 'observer') ctx.camera.quaternion.copy(s.quat);
    if (app?.orbitControls && s.orbit !== undefined) app.orbitControls.enabled = s.orbit;
    if (s.grade && app?.renderer?.post) Object.assign(app.renderer.post.grade, s.grade);
    ctx.camera.layers.enable(LAYERS.FIRST_PERSON);
    this._setFilter(false);
    ctx.sky?.setTelescope?.(null);
    ctx.sky?.starField?.setDeepVisible?.(false);
    this.panel.show(false);
    ctx.hud?._layers?.();
    ctx.events?.emit?.('telescope', false);
    if (ctx.mode === 'play' && !ctx.isShot) { try { ctx.input?.requestPointerLock?.(); } catch (_) { /* needs a gesture */ } }
  }

  /** Points the telescope at an entry (object or query string) and tracks it. */
  select(e) {
    if (typeof e === 'string') { const f = this.find(e); if (!f) { this.ctx.hud?.notify?.(`Объект «${e}» не найден`, { kind: 'warn' }); return false; } e = f; }
    this.target = e;
    this.offset.set(0, 0);
    this.tracking = true;
    this.slew = this.ctx.isShot ? 0 : 1;
    this._snapExposure = true;
    if (this.ctx.isShot) { this.dirOf(e, this.aim); this.goal.copy(this.aim); }
    this.panel.refreshTarget();
    return true;
  }

  setFov(deg, instant = false) {
    this.fovTarget = THREE.MathUtils.clamp(deg, FOV_MIN, FOV_MAX);
    if (instant) this.fov = this.fovTarget;
  }

  /** Screenshot / URL views: 'tele-<target>-<fov>' (target may contain '_' for spaces). Returns true if handled. */
  handlesView(name) { return typeof name === 'string' && name.startsWith('tele-'); }

  enterView(name) {
    const m = /^tele-(.+?)(?:-([\d.]+))?$/.exec(name);
    if (!m) return false;
    const ctx = this.ctx;
    this._switching = true;
    try {
      // a clear vantage point outside the hull (the observer camera may sit inside a module)
      if (this.unavailable() || (ctx.mode === 'observer' && ctx.camera.position.length() < 120)) ctx.app?.setView?.('overview');
      this.enter();
      this.select(m[1]);
      this.setFov(parseFloat(m[2] || '10'), true);
      if (this.target) { this.dirOf(this.target, this.aim); this.goal.copy(this.aim); this.slew = 0; }
      this._snapExposure = true;
    } finally { this._switching = false; }
    return true;
  }

  /** Resolves when the deep stars and the textures of the current field have loaded (screenshots). */
  async whenSettled(timeoutMs = 60000) {
    const ctx = this.ctx, t0 = performance.now();
    const deep = ctx.sky?.starField?.loadDeep?.();
    if (deep) await Promise.race([deep, new Promise((r) => setTimeout(r, timeoutMs))]);
    // a few frames to trigger the on-demand loads, then wait for them
    for (let i = 0; i < 40 && performance.now() - t0 < timeoutMs; i++) {
      await ctx.app?.renderFrames?.(2);
      const sky = ctx.sky;
      const busy = (sky.deepSky?.tiles || []).some((t) => t.loading && !t.loaded)
        || Object.values(sky.planets?.textures || {}).some((t) => t === 'loading')
        || Object.values(sky.moon?._loading || {}).some((v) => v === true) || !!sky.moon?._detailLoading;
      if (!busy && i > 3) break;
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  // ------------------------------------------------------------------ input

  _bindPointer() {
    const ctx = this.ctx;
    const el = ctx.renderer?.domElement;
    const root = el?.parentElement;
    if (!el || !root) return;
    root.addEventListener('mousedown', (e) => {
      if (!this.active || e.target !== el || e.button !== 0) return;
      this._drag = { x: e.clientX, y: e.clientY };
      e.stopPropagation(); e.preventDefault();
    }, { capture: true });
    window.addEventListener('mousemove', (e) => {
      if (!this._drag || !this.active) return;
      const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX; this._drag.y = e.clientY;
      this._nudge(dx, dy);
    });
    window.addEventListener('mouseup', () => { this._drag = null; });
    el.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault(); e.stopPropagation();
      this.setFov(this.fovTarget * Math.pow(1.18, Math.sign(e.deltaY)));
    }, { passive: false, capture: true });
  }

  /** Drag the sky by (dx, dy) CSS px: the view axis moves the other way (north up, east left). */
  _nudge(dx, dy) {
    const h = this.ctx.renderer.domElement.clientHeight || window.innerHeight || 1;
    const k = this.fov * D2R / h;
    tangent(this.target && this.tracking ? this.dirOf(this.target, _w) : this.goal, _e, _n);
    if (this.target && this.tracking) { this.offset.x += dx * k; this.offset.y += dy * k; }
    else { this.goal.addScaledVector(_e, dx * k).addScaledVector(_n, dy * k).normalize(); this.aim.copy(this.goal); }
  }

  update(dt, ctx) {
    const inp = ctx.input;
    const rdt = Math.min(0.1, dt / Math.max(1e-6, ctx.time?.scale || 1));
    if (inp?.wasPressed?.('KeyZ') && !ctx.hud?.menu?.visible) this.toggle();
    this.panel.updateButton(ctx, ctx.app?.paused ? 0.05 : rdt);
    if (!this.active) return;
    // zoom keys / aim keys
    const zin = inp.isDown('Equal') || inp.isDown('NumpadAdd') || inp.isDown('PageUp');
    const zout = inp.isDown('Minus') || inp.isDown('NumpadSubtract') || inp.isDown('PageDown');
    if (zin) this.setFov(this.fovTarget * Math.exp(-1.6 * rdt));
    if (zout) this.setFov(this.fovTarget * Math.exp(1.6 * rdt));
    const ax = inp.axis('ArrowLeft', 'ArrowRight'), ay = inp.axis('ArrowUp', 'ArrowDown');
    if (ax || ay) { const h = ctx.renderer.domElement.clientHeight || 600; this._nudge(-ax * 0.35 * h * rdt, -ay * 0.35 * h * rdt); }
    // keep the player still: hide movement keys and mouse look from it (restored in lateUpdate)
    for (const k of MASKED_KEYS) { if (inp.keys[k]) { this._stash[k] = true; inp.keys[k] = false; } delete inp.pressed[k]; }
    inp.mouse.dx = 0; inp.mouse.dy = 0; inp.mouse.wheel = 0;
  }

  lateUpdate(dt, ctx) {
    const inp = ctx.input;
    for (const k in this._stash) { inp.keys[k] = true; delete this._stash[k]; }
    if (!this.active) return;
    const rdt = Math.min(0.1, dt / Math.max(1e-6, ctx.time?.scale || 1));
    // field of view (log-space easing)
    const kf = ctx.isShot ? 1 : 1 - Math.exp(-rdt / 0.12);
    this.fov = Math.exp(Math.log(this.fov) + (Math.log(this.fovTarget) - Math.log(this.fov)) * kf);
    // mount
    if (this.target && this.tracking) {
      this.dirOf(this.target, this.goal);
      if (this.offset.lengthSq() > 0) { tangent(this.goal, _e, _n); this.goal.addScaledVector(_e, this.offset.x).addScaledVector(_n, this.offset.y).normalize(); }
    }
    if (this.slew > 0 && !ctx.isShot) {
      const ang = this.aim.angleTo(this.goal);
      const step = Math.max(ang * (1 - Math.exp(-rdt / 0.25)), Math.min(ang, 2.5 * D2R * rdt * 10));
      if (ang < 1e-6 || step >= ang) { this.aim.copy(this.goal); this.slew = 0; }
      else { _w.crossVectors(this.aim, this.goal).normalize(); this.aim.applyAxisAngle(_w, step).normalize(); }
    } else this.aim.copy(this.goal);
    // camera: look along the aim (render frame), celestial north up
    const sq = ctx.orbit.skyQuat;
    _v.copy(this.aim).applyQuaternion(sq);
    _u.copy(NORTH).applyQuaternion(sq);
    if (Math.abs(_u.dot(_v)) > 0.999) _u.set(1, 0, 0).applyQuaternion(sq);
    _m.lookAt(_zero, _v, _u);
    const cam = ctx.camera;
    cam.quaternion.setFromRotationMatrix(_m);
    if (cam.parent) { cam.parent.getWorldQuaternion(_q); cam.quaternion.premultiply(_q.invert()); }
    if (Math.abs(cam.fov - this.fov) > 1e-9) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    cam.layers.disable(LAYERS.FIRST_PERSON);
    cam.updateMatrixWorld();
    this._exposure(rdt, ctx);
    this.panel.update(rdt, ctx);
  }

  // ------------------------------------------------------------------ optics & exposure

  /** Magnification relative to the eye (70 deg field) and the exit-pupil dimming factor. */
  optics() {
    const M = Math.max(1, 70 / this.fov);
    const T = Math.min(1, (M_PUPIL / M) ** 2);
    return { M, T };
  }

  _setFilter(on) {
    if (this.filter === on) return;
    this.filter = on;
    const earth = this.ctx.earth;
    if (earth?.sunDiscMaterial) {
      if (on) { this._sunI = [earth.sunDiscMaterial.uniforms.uIntensity.value, earth.coronaMaterial.uniforms.uIntensity.value]; earth.coronaMaterial.uniforms.uIntensity.value = 0; }
      else if (this._sunI) { earth.sunDiscMaterial.uniforms.uIntensity.value = this._sunI[0]; earth.coronaMaterial.uniforms.uIntensity.value = this._sunI[1]; }
    }
    const post = this.ctx.app?.renderer?.post;
    if (post && this._saved?.grade) {
      if (on) { post.grade.flare = 0; post.grade.glareMax = 0; post.grade.dirt = 0; }
      else Object.assign(post.grade, this._saved.grade);
    }
  }

  _exposure(rdt, ctx) {
    const sky = ctx.sky, eph = ctx.ephemeris;
    if (!sky || !eph) return;
    const r = ctx.renderer;
    r.getDrawingBufferSize(_size);
    const W = Math.max(1, _size.x), H = Math.max(1, _size.y);
    const fovR = this.fov * D2R;
    const pxPerRad = H / fovR;
    const frameArea = W * H;
    const { T } = this.optics();
    const E = Math.max(0.05, r.toneMappingExposure || 1);
    // view axis in ECI
    const axis = this.aim;
    const sun = eph.bodies.sun;
    _w.set(sun.topo.x, sun.topo.y, sun.topo.z).divideScalar(sun.dist);
    const sunAng = Math.acos(Math.min(1, _w.dot(axis)));
    const sunVisible = ctx.orbit.sunVisible ?? 1;
    const halfDiag = Math.atan(Math.tan(fovR / 2) * Math.hypot(1, W / H));
    this._setFilter(sunAng < halfDiag + 0.6 * D2R && sunVisible > 0.02);
    // metering: resolved bodies (coverage x mean radiance x T), spot-weighted on the target
    let B = 0, spot = 0;
    const gains = {};
    const bodyLum = (name) => {
      const b = eph.bodies[name];
      const rAu = Math.hypot(b.helio.x, b.helio.y, b.helio.z) / AU_KM;
      const p = name === 'moon' ? 0.12 : (BODY_DATA[name].albedo || 0.3);
      return 1.45 * p * 1.5 * 0.6 / (rAu * rAu);           // mean over the lit disc (Lambert-ish)
    };
    for (const name of ['moon', ...PLANETS, ...GALILEAN]) {
      const b = eph.bodies[name];
      _v.set(b.topo.x, b.topo.y, b.topo.z).divideScalar(b.dist);
      const ang = Math.acos(Math.min(1, _v.dot(axis)));
      if (ang > halfDiag + b.angRadius) continue;
      const rPx = b.angRadius * pxPerRad;
      const L = bodyLum(name) * T;
      const cov = Math.min(1, Math.PI * rPx * rPx * b.illum / frameArea);
      B += cov * L;
      if (this.target?.body === name) spot = Math.max(spot, L * THREE.MathUtils.smoothstep(cov, 0.01, 0.2));
      // local adaptation: the resolved body is kept near KEY whatever the field exposure
      gains[name] = { L, rPx };
    }
    const ex = ctx.app?.renderer?.post?.exposure;
    let X;
    if (this.filter) {
      X = KEY / Math.max(1e-9, 6.7e4 * SUN_FILTER * T);
    } else if (ex && ex.earthFrac > 0.03) {
      X = E;                                          // the Earth in the field: follow the regular camera exposure
    } else {
      const Bm = Math.max(B, 0.6 * spot);
      const xMax = X_DARK * (1 + 2 * THREE.MathUtils.smoothstep(-Math.log10(this.fov), -1, 1));   // longer exposures on narrow dark fields
      X = KEY / (Bm + KEY / xMax);
    }
    if (this._snapExposure || ctx.isShot) { this.X = X; this._snapExposure = false; }
    else this.X = Math.exp(Math.log(this.X) + (Math.log(X) - Math.log(this.X)) * (1 - Math.exp(-rdt / (X < this.X ? 0.25 : 0.8))));
    const S = this.X * T / E;                          // gain on physical radiance for stars / DSO / Milky Way
    const discGains = {};
    for (const name in gains) {
      const g = gains[name];
      const local = KEY * 1.4 / Math.max(1e-12, (g.L / T) * E);
      discGains[name] = this.filter ? S : Math.min(S, local);
    }
    if (this.filter && ctx.earth?.sunDiscMaterial) ctx.earth.sunDiscMaterial.uniforms.uIntensity.value = 6.7e4 * SUN_FILTER * T * this.X / E / 1.0;
    sky.setTelescope({ stars: S, dso: S, moon: discGains.moon ?? S, planets: discGains, sigmaAiry: SIGMA_AIRY });
    sky.starField.setDeepVisible(this.fov < 25);
    // limiting magnitude of the current field (point source at the drawing threshold)
    const u = sky.starField.uniforms;
    const peak0 = u.uFluxScale.value * (1 - u.uWing.value) / (2 * Math.PI * u.uSigma.value ** 2);
    this.limitMag = 2.5 * Math.log10(Math.max(1e-30, peak0 / u.uThreshold.value));
    this.readout.S = S; this.readout.X = this.X; this.readout.T = T;
  }

  /** Field labels (called by sky/Overlays.js with its projector): target marker, bodies, DSOs in the field. */
  labelsFor(put, g) {
    const ctx = this.ctx, eph = ctx.ephemeris;
    const font = '600 12px system-ui, sans-serif';
    for (const name of ['moon', ...PLANETS, ...(this.fov < 2 ? GALILEAN : [])]) {
      const b = eph.bodies[name];
      if (b.occulted) continue;
      _v.set(b.topo.x / b.dist, b.topo.y / b.dist, b.topo.z / b.dist);
      if (_v.angleTo(this.aim) > this.fov * D2R) continue;
      const rPx = b.angRadius / (this.fov * D2R) * (ctx.renderer.domElement.clientHeight || 600);
      put(_v, b.ru, font, 'rgba(255,205,120,0.9)', Math.max(8, rPx * 0.75), -Math.max(6, rPx * 0.75));
    }
    const objs = ctx.sky?.deepSky?.objects || [];
    if (this.fov < 30) for (const o of objs) {
      if (o.dir.angleTo(this.aim) > this.fov * D2R * 0.8) continue;
      const size = (o.maj || 1) / 60 * D2R;
      if (size < this.fov * D2R * 0.015 && o.id !== this.target?.id) continue;
      put(o.dir, o.ru ? `${o.id} · ${o.ru}` : (o.name ? `${o.id} · ${o.name.split(',')[0]}` : o.id), '11px system-ui, sans-serif', 'rgba(150,220,255,0.8)', 8, -6);
    }
  }

  dispose() { this.panel.dispose(); }
}
