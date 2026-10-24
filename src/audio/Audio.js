import { Engine } from './Engine.js';
import { Body } from './Body.js';
import { Suit } from './Suit.js';
import { Airlock } from './Airlock.js';
import { StationLife } from './StationLife.js';
import { Radio } from './Radio.js';
import { Traffic } from './Traffic.js';
import { Music } from './Music.js';
import { roomClass } from './Zones.js';
import { FOLEY } from './foley.js';

/**
 * Sound of the station (see docs/ARCHITECTURE.md, "Audio"). Everything is procedural (src/audio/foley.js,
 * rendered in a worker) except the soundtrack (offline-rendered Opus loops in public/audio/music).
 *
 *   Engine / Mixer   buses (music, sfx, ambience, voice, ui -> master -> limiter), acoustic paths:
 *                    air (cabin atmosphere: pressure-scaled, room reverb, helmet muffling), body (structure /
 *                    own body), suit (inside the helmet), radio (headset), pa (station loudspeakers)
 *   Body             own contacts: grabs, push-offs, bumps, velcro, clothing, footsteps by surface, ladders
 *   Suit             breath / heart / fans / pump / SAFER / reel / caution tones, donning and doffing
 *   Airlock          depress, repress, hatches (from the player's sequence state)
 *   StationLife      ventilation beds per compartment, positional equipment, random life events
 *   Traffic          docking heard through the structure, station attitude jets, radio calls
 *   Radio            headset (quindar) or PA transmissions with subtitles
 *   Music            adaptive soundtrack director
 *
 * The AudioContext is created lazily on the first user gesture; every method is safe without it.
 *
 *   audio.play(name, opts)          legacy + any foley entry by name (opts: path, gain, pos, rate, at)
 *   audio.event(name, data)         scenario hooks: explosion, collision, launch, asteroid, comet, engine,
 *                                   alarm, pa, telescope, scenario
 *   audio.setMusicMood(mood|null)   force a music mood (station|eva|night|sunrise|docking|deep|flight|lunar)
 *   audio.setVolume(cat, v)         cat: master|music|sfx|ambience|voice|ui (0..1, persisted)
 *   audio.setMusicEnabled(bool), audio.muted, audio.volume, audio.setParam(name, value), audio.update(dt, ctx)
 */
const SETTINGS_KEY = 'audio.settings';
const DEFAULTS = { master: 1, music: 0.7, sfx: 0.85, ambience: 0.75, voice: 0.8, ui: 0.6, musicOn: true };
const PREWARM = [
  'bed_module', 'bed_node', 'bed_airlock', 'bed_ring', 'bed_service', 'cloth_loop', 'suitfan_loop', 'suitpump_loop', 'safer_loop', 'radio_hiss',
  'hand_rail', 'glove_rail', 'push_off', 'bump_soft', 'bump_hard', 'cloth', 'step_grate', 'step_carpet', 'step_panel', 'step_mat', 'rung_hand', 'rung_foot',
  'breath_in', 'breath_out', 'breath_in_hard', 'breath_out_hard', 'safer_valve', 'heart', 'suit_beep', 'ui_click', 'ui_tick', 'latch', 'latch_small',
  'pump_loop', 'hiss_loop', 'rush_loop', 'motor_loop', 'valve_open', 'ratchet', 'seal', 'hinge_creak', 'zipper', 'bearing_clicks', 'helmet_latch', 'suit_hiss',
  'carabiner', 'glove_tap', 'reel_loop', 'tether_twang', 'suit_impact', 'quindar_in', 'quindar_out', 'radio_babble', 'pa_chime',
  'bed_hub', 'bed_spoke', 'bed_tunnel', 'bed_cupola', 'bed_green', 'freezer_loop', 'fridge_loop', 'fridge_clunk', 'irrigation_loop', 'treadmill_loop', 'ergo_loop',
  'laptop_beep', 'keys', 'scrubber_cycle', 'water_gurgle', 'struct_creak', 'dock_contact', 'dock_latch', 'spring_thunk', 'thruster_thump', 'velcro', 'brake_rub',
  'jump', 'land_body', 'servo_loop', 'caution_tone', 'warning_tone', 'explosion_near', 'debris_rattle',
];

function loadSettings() {
  const s = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(s, JSON.parse(raw));
    else { const v = parseFloat(localStorage.getItem('hud.volume')); if (Number.isFinite(v)) s.master = Math.max(0, Math.min(1, v)); }
  } catch (_) { /* storage blocked */ }
  return s;
}

export class Audio {
  constructor(ctx) {
    this.ctx = ctx;
    this.ac = null;
    this.ready = false;
    this._muted = ctx.params?.get?.('mute') === '1';
    this.settings = loadSettings();
    if (ctx.params?.get?.('music') === '0') this.settings.musicOn = false;
    this.params = { crawl: 0, radio: 1, fan: 1 };
    this.moodOverride = null;
    this.telescope = false;
    this.time = 0;
    this._moodTimer = 0;
    this._night = null; this._sunPrev = null; this.sunriseUntil = 0; this.dockCool = 0; this.wonderUntil = 0;
    this.L = { zone: null, inside: false, x: 0, density: 0, helmet: 0, capture: false };
    this._gesture = () => this._init();
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, this._gesture, { passive: true });
    // interface sounds: buttons and sliders of the HUD / menu
    this._uiClick = (e) => { if (e.target?.closest?.('button')) this.play('ui', { kind: 'click' }); };
    this._uiInput = (e) => { if (e.target?.type === 'range') { const t = performance.now(); if (t - (this._uiT || 0) > 70) { this._uiT = t; this.play('ui', { kind: 'tick' }); } } };
    ctx.uiRoot?.addEventListener?.('click', this._uiClick, true);
    ctx.uiRoot?.addEventListener?.('input', this._uiInput, true);
  }

  // ------------------------------------------------------------------ settings
  get muted() { return this._muted; }
  set muted(v) { this._muted = !!v; this._applyVolumes(); }
  /** Master volume 0..1 (also setParam('volume', v)). */
  get volume() { return this.settings.master; }
  set volume(v) { this.setVolume('master', v); }
  get musicEnabled() { return this.settings.musicOn !== false; }
  setMusicEnabled(on) { this.settings.musicOn = !!on; this._save(); this.music?.setEnabled(!!on); }
  getVolume(cat) { return this.settings[cat]; }
  setVolume(cat, v) {
    if (!(cat in DEFAULTS) || cat === 'musicOn') return;
    this.settings[cat] = Math.max(0, Math.min(1, +v || 0));
    this._save(); this._applyVolumes();
  }
  _save() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); localStorage.setItem('hud.volume', String(this.settings.master)); } catch (_) { /* storage blocked */ } }
  _applyVolumes() { if (this.engine) this.engine.mixer.setVolumes(this.settings, this._muted); }

  // ------------------------------------------------------------------ setup
  _init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume().catch(() => {}); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.start(new AC({ latencyHint: 'interactive' }));
    } catch (e) { console.warn('[Audio] unavailable:', e?.message || e); this.ac = null; }
  }

  /** Build the engine on an AudioContext (also used with an OfflineAudioContext by tools/audio/render-engine.mjs). */
  start(ac, { music = true } = {}) {
    this.ac = ac;
    const ctx = this.ctx;
    const e = this.engine = new Engine(ac, ctx);
    this.body = new Body(e, ctx);
    this.suit = new Suit(e, ctx);
    this.airlock = new Airlock(e, ctx);
    this.life = new StationLife(e, ctx);
    this.music = music ? new Music(e, ctx) : null;
    this.radio = new Radio(e, ctx, (s) => this.music?.duck(s));
    this.traffic = new Traffic(e, ctx, this.radio);
    this._applyVolumes();
    if (this.music && !this.musicEnabled) this.music.setEnabled(false);
    e.bank.prewarm(PREWARM);
    this.ready = true;
    for (const ev of ['pointerdown', 'keydown']) window.removeEventListener(ev, this._gesture);
    // keep resuming on gestures (autoplay policies may suspend the context again)
    this._resume = () => { if (this.ac?.state === 'suspended') this.ac.resume().catch(() => {}); };
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, this._resume, { passive: true });
  }

  // ------------------------------------------------------------------ one-shots
  /** play(name, opts). Legacy names from the player module, 'ui', or any foley bank entry. Safe without a context. */
  play(name, opts = {}) {
    if (!this.ready) return;
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
    const e = this.engine, st = this.ctx.player?.state || {};
    switch (name) {
      case 'grab': this.body.contact('grab', opts.strength ?? 0.5, true); break;
      case 'release': this.body.contact('push', opts.strength ?? 0.5, true); break;
      case 'impact': this.body.contact('bump', opts.strength ?? 0.5, true); break;
      case 'step': this.body.contact('step', opts.strength ?? Math.min(1, (st.speedRelative || 1.4) / 2.8), true); break;
      case 'rung': this.body.contact('rung', opts.strength ?? 0.5, true); break;
      case 'click': this.suit.click(!!st.suited); break;
      case 'detach': e.shot('carabiner', { path: 'body', gain: 0.5, rate: 0.9 }); e.shot('suit_beep', { path: 'radio', gain: 0.3, v: 0, at: 0.15 }); e.shot('suit_beep', { path: 'radio', gain: 0.3, v: 2, at: 0.45 }); this.music?.duck(1.5, 0.6); break;
      case 'depress': case 'repress': case 'hatchMotor': break;            // driven by the sequence state (Airlock)
      case 'clunk': if (!this.airlock.busy(e.now())) e.shot('latch', { path: st.suited ? 'body' : 'air', gain: 0.4, rate: 1.2 }); break;
      case 'suit': { const kind = st.sequence?.name === 'doff' || (st.suited && st.sequence?.name !== 'don') ? 'doff' : 'don'; this.suit.sequence(kind, opts.duration || 3); break; }
      case 'radio': this.radio.say(opts.text || null, { helmet: this.suit.helmet }); break;
      case 'warn': e.shot('suit_beep', { path: 'radio', gain: opts.gain ?? 0.25, v: 0, rate: (opts.freq || 880) / 880 }); break;
      case 'ui': e.shot(opts.kind === 'tick' ? 'ui_tick' : 'ui_click', { path: 'ui', gain: opts.kind === 'tick' ? 0.25 : 0.4, jitter: 0.05 }); break;
      case 'telescopeMotor': this.event('telescope', { moving: true, duration: opts.duration || 2 }); break;
      default:
        if (FOLEY[name]) e.shot(name, opts);
        break;
    }
  }

  /**
   * Scenario hooks for upcoming events. Outside, sound does not travel through vacuum: explosions, launches and
   * flybys are silent unless felt through the structure (contact) or reported on the radio; the music answers.
   */
  event(name, d = {}) {
    if (!this.ready) return;
    const e = this.engine, st = this.ctx.player?.state || {}, L = this.L;
    switch (name) {
      case 'explosion': {
        const s = Math.max(0.1, Math.min(1, d.strength ?? 0.8));
        if (L.inside && d.inside !== false) { e.shot('explosion_near', { path: 'air', gain: 0.9 * s, pos: d.position || null, ref: 10, prio: 1 }); e.shot('debris_rattle', { path: 'air', gain: 0.5 * s, at: 0.3, pos: d.position || null, ref: 6 }); this.event('alarm', { kind: 'warning', count: 3 }); }
        else if (d.contact || st.holding || st.contact) e.shot('explosion_near', { path: 'body', gain: 0.6 * s, lp: 300, prio: 1 });
        this.music?.duck(4, 0.5);
        break;
      }
      case 'collision': {
        const s = Math.max(0.1, Math.min(1, d.strength ?? 0.5));
        if (L.inside) e.shot('bump_hard', { path: 'air', gain: 0.8 * s, pos: d.position || null, rate: 0.6, ref: 4 });
        e.shot('suit_impact', { path: 'body', gain: 0.7 * s, rate: 0.8 });
        break;
      }
      case 'launch': case 'asteroid': case 'comet':
        this.music?.sting('sting_wonder');
        if (name !== 'launch') this.wonderUntil = this.time + (d.duration || 120);
        break;
      case 'engine': {
        if (!this._engineLoop) this._engineLoop = e.loop('rush_loop', 'body', { gain: 0, rate: 0.35, lp: 400 });
        this._engineLoop.set(Math.max(0, Math.min(1, d.throttle ?? 0)) * 0.5, 0.2);
        break;
      }
      case 'alarm': {
        const tone = d.kind === 'warning' ? 'warning_tone' : 'caution_tone', n = d.count || 2, path = this.suit.helmet > 0.5 ? 'radio' : 'pa';
        for (let k = 0; k < n; k++) e.shot(tone, { path, gain: 0.35, at: k * 1.25, jitter: 0, prio: 1 });
        this.music?.duck(n * 1.25 + 0.5, 0.4);
        break;
      }
      case 'pa': this.radio.say(d.text || null, { helmet: this.suit.helmet }); break;
      case 'telescope': {
        if ('active' in d) this.telescope = !!d.active;
        if (d.moving) {
          if (!this._servo) this._servo = e.loop('servo_loop', L.inside ? 'air' : 'body', { gain: 0 });
          this._servo.set(0.12, 0.08);
          clearTimeout(this._servoT); this._servoT = setTimeout(() => this._servo?.set(0, 0.15), (d.duration || 1.5) * 1000);
        }
        break;
      }
      case 'scenario': this.setMusicMood(d.music ?? null); break;
      default: break;
    }
  }

  setMusicMood(mood) { this.moodOverride = mood || null; }

  /** setParam(name, value): 'volume' (master), 'muted', 'crawl' (0/1), 'fan' (0..1), 'radio' (0..1 chatter level). */
  setParam(name, value) {
    if (name === 'volume') { this.volume = value; return; }
    if (name === 'muted') { this.muted = !!value; return; }
    this.params[name] = +value || 0;
    if (this.suit && name === 'fan') this.suit.fanParam = this.params.fan;
    if (this.radio && name === 'radio') this.radio.level = this.params.radio;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, ctx) {
    const inp = ctx.input;
    if (inp?.wasPressed('KeyM')) this.muted = !this.muted;
    if (!this.ready) return;
    const scale = ctx.time?.scale || 1;
    const h = Math.min(Math.max(dt / scale, 0), 0.1);
    this.time += h;
    const e = this.engine, p = ctx.player, st = p?.state;
    if (!st) return;
    ctx.camera.updateMatrixWorld?.();
    e.setListener(ctx.camera.matrixWorld);
    // ---- listener context: compartment, cabin air, helmet
    const I = ctx.station?.interior, L = this.L;
    const zone = I?.enabled ? I.cameraZone : (st.inside ? p.iva?.zone : null);
    L.zone = zone || null; L.inside = !!zone;
    L.x = 0;
    if (zone && zone.frame === 'ring' && I.ringInv) { const m = I.ringInv.elements, c = e.listener; L.x = m[0] * c.x + m[4] * c.y + m[8] * c.z + m[12]; }
    L.density = !zone ? 0 : zone.id === 'airlockC' ? Math.max(0, Math.min(1, st.airlockPressure ?? 1)) : 1;
    const play = ctx.mode !== 'observer';
    L.helmet = play ? this.suit.helmet : 0;
    e.mixer.setAcoustics(L.density, L.helmet);
    if (zone) e.mixer.setRoom(roomClass(zone, L.x));
    const menu = !!ctx.hud?.menu?.visible, paused = !!ctx.app?.paused;
    e.mixer.setPause(menu ? 0.3 : paused ? 0.45 : 1);
    const active = play && !menu && !paused;
    // ---- modules
    this.body.update(active ? h : 0, this.params.crawl > 0 && active);
    this.suit.update(h, st, active);
    this.airlock.update(h, st);
    this.life.update(h, L);
    this.traffic.update(h, L);
    this.radio.update(h, st, L.helmet, active && st.mode !== 'observer');
    // ---- sunrise / sunset (thermal creaks of the hull; the sunrise piece outside)
    const sun = ctx.orbit?.sunVisible ?? 1;
    if (this._sunPrev !== null && scale <= 10) {
      if ((this._sunPrev < 0.5) !== (sun < 0.5)) this.life.thermal();
      if (this._sunPrev < 0.04 && sun >= 0.04) this.sunriseUntil = this.time + 125;
    }
    this._sunPrev = sun;
    if (this._night === null) this._night = sun < 0.25;
    else if (scale <= 10 || menu) this._night = this._night ? sun < 0.35 : sun < 0.15;
    // ---- music
    if (L.capture) { L.capture = false; if (this.music?.mood === 'docking') this.music.sting('sting_capture', 0.8); this.dockCool = this.time + 240; }
    this._moodTimer -= h;
    if (this.music && this._moodTimer <= 0) { this._moodTimer = 0.5; this.music.update(0.5, this._musicMood(ctx, L, menu)); }
    e.update();
  }

  _musicMood(ctx, L, menu) {
    if (this.moodOverride) return this.moodOverride;
    if (menu) return 'menu';
    if (this.telescope || ctx.telescope?.active || ctx.sky?.telescope?.active) return 'deep';
    if (this.time < this.wonderUntil) return 'deep';
    const outside = !L.inside, z = L.zone?.id;
    const view = outside || z === 'cupola' || z === 'hub';
    // docking nearby (and a view of it)
    if (view && this.time > this.dockCool) {
      const ships = ctx.ships?.ships;
      if (ships) for (let i = 0; i < ships.length; i++) { const s = ships[i]; if ((s.state === 'approach' || s.state === 'dock') && s.group?.position && s.group.position.distanceTo(ctx.camera.position) < 300) return 'docking'; }
    }
    if (view && this.time < this.sunriseUntil) return 'sunrise';
    if (view) return this._night ? 'night' : 'eva';
    return 'station';
  }

  dispose() {
    for (const ev of ['pointerdown', 'keydown']) { window.removeEventListener(ev, this._gesture); if (this._resume) window.removeEventListener(ev, this._resume); }
    this.ctx.uiRoot?.removeEventListener?.('click', this._uiClick, true);
    this.ctx.uiRoot?.removeEventListener?.('input', this._uiInput, true);
    this.traffic?.dispose();
    this.engine?.bank.dispose();
    if (this.ac && this.ac.close) this.ac.close().catch(() => {});
  }
}
