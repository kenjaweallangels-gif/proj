import * as THREE from 'three';
import { LINE_VERTEX, LINE_FRAGMENT } from '../shaders/SkyShaders.js';
import { starRecord } from './StarCatalog.js';

/**
 * Sky overlays (off by default; key N cycles: off -> constellation figures + names -> + IAU boundaries + star and
 * planet names -> off). Figures / boundaries are line segments on the celestial sphere (d3-celestial data, J2000),
 * names are drawn on a 2D canvas over the view (Russian), hidden behind the Earth (analytic test). The telescope
 * also uses `labels` for its field (DSO names).
 */

const R_LINES = 1.45e6;
const D2R = Math.PI / 180;
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _rec = { ra: 0, dec: 0, v: 0, bv: 0 };

function dirFromRaDec(raDeg, decDeg, out) {
  const a = raDeg * D2R, d = decDeg * D2R;
  return out.set(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d));
}

export class SkyOverlays {
  constructor(ctx, sky) {
    this.ctx = ctx;
    this.sky = sky;
    this.mode = 0;
    const p = ctx.params?.get?.('overlay');
    if (p) this.mode = Math.max(0, Math.min(2, parseInt(p, 10) || 0));
    this.group = new THREE.Group();
    this.group.name = 'SkyOverlays';
    this.figureMat = this._lineMat(new THREE.Color(0.30, 0.52, 0.95), 0.5);
    this.borderMat = this._lineMat(new THREE.Color(0.55, 0.38, 0.75), 0.28);
    this.figures = null; this.borders = null;
    this.labels = [];          // { text, dir (ECI unit), kind: 'con' | 'star' | 'planet' | 'dso', mag }
    this.canvas = null;
    this._acc = 1;
  }

  _lineMat(color, alpha) {
    return new THREE.ShaderMaterial({
      name: 'SkyLines', uniforms: { uColor: { value: color }, uAlpha: { value: alpha } }, vertexShader: LINE_VERTEX, fragmentShader: LINE_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false,
    });
  }

  async load() {
    try {
      const data = await fetch(this.ctx.assetUrl('data/sky/constellations.json')).then((r) => r.json());
      const fig = [], bor = [];
      const seg = (arr, a, b) => {
        dirFromRaDec(a[0], a[1], _v).multiplyScalar(R_LINES); arr.push(_v.x, _v.y, _v.z);
        dirFromRaDec(b[0], b[1], _v).multiplyScalar(R_LINES); arr.push(_v.x, _v.y, _v.z);
      };
      for (const c of data.constellations) {
        for (const line of c.lines || []) for (let i = 1; i < line.length; i++) seg(fig, line[i - 1], line[i]);
        if (c.label) this.labels.push({ text: (c.ru || c.la).toUpperCase(), dir: dirFromRaDec(c.label[0], c.label[1], new THREE.Vector3()), kind: 'con', rank: c.rank || 3 });
      }
      for (const b of data.borders || []) for (let i = 1; i < b.length; i++) seg(bor, b[i - 1], b[i]);
      const mk = (arr, mat, name) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R_LINES * 1.01);
        const l = new THREE.LineSegments(g, mat); l.name = name; l.frustumCulled = false; l.renderOrder = -15; l.visible = false;
        this.group.add(l);
        return l;
      };
      this.figures = mk(fig, this.figureMat, 'ConstellationLines');
      this.borders = mk(bor, this.borderMat, 'ConstellationBorders');
      this.constellations = data.constellations;
    } catch (e) { console.warn('[Sky] constellations', e); }
    try {
      this.starNames = await fetch(this.ctx.assetUrl('data/sky/star_names.json')).then((r) => r.json());
    } catch (e) { console.warn('[Sky] star names', e); this.starNames = []; }
  }

  /** Resolve star name labels against the loaded catalogue (positions come from the binary records). */
  attachStars(field) {
    for (const s of this.starNames || []) {
      const rec = field.recordOf(s.i);
      if (!rec) continue;
      starRecord(rec.cat, rec.index, _rec);
      s.dir = new THREE.Vector3(Math.cos(_rec.dec) * Math.cos(_rec.ra), Math.cos(_rec.dec) * Math.sin(_rec.ra), Math.sin(_rec.dec));
      s.ra = _rec.ra; s.dec = _rec.dec;
      if ((s.ru || s.name) && s.v <= 3.2) this.labels.push({ text: s.ru || s.name, dir: s.dir, kind: 'star', mag: s.v });
    }
  }

  cycle() {
    this.mode = (this.mode + 1) % 3;
    const names = ['Подсказки неба выключены', 'Созвездия', 'Созвездия, границы, названия звёзд'];
    this.ctx.hud?.notify?.(`${names[this.mode]} (N)`, { kind: 'info' });
  }

  _ensureCanvas() {
    if (this.canvas) return;
    const c = document.createElement('canvas');
    c.className = 'sky-labels';
    c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:1';
    (this.ctx.uiRoot || document.body).prepend(c);
    this.canvas = c;
    this.g = c.getContext('2d');
  }

  update(dt, ctx) {
    if (ctx.input?.wasPressed?.('KeyN')) this.cycle();
    const on = this.mode > 0;
    if (this.figures) { this.figures.visible = on; this.borders.visible = this.mode >= 2; }
    const tel = ctx.telescope?.active;
    const wantLabels = on || tel;
    if (!wantLabels) { if (this.canvas && this._drawn) { this.g.clearRect(0, 0, this.canvas.width, this.canvas.height); this._drawn = false; } return; }
    this._acc += dt / Math.max(1e-3, ctx.time?.scale || 1);
    if (this._acc < (ctx.quality?.lite ? 0.25 : 1 / 30) && !ctx.isShot) return;
    this._acc = 0;
    this._draw(ctx, on, tel);
  }

  /** Labels: project each direction with the far camera; skip what is behind the Earth or off-screen. */
  _draw(ctx, on, tel) {
    this._ensureCanvas();
    const c = this.canvas, g = this.g;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    this._drawn = true;
    const cam = ctx.farCamera, o = ctx.orbit;
    if (!cam || ctx.hud?.menu?.visible) return;
    cam.updateMatrixWorld();
    const ec = (this._ec || (this._ec = new THREE.Vector3())).copy(o.earthCenterFar).sub(cam.position);
    const er = 6371 + 40, ec2 = ec.lengthSq();
    const sq = o.skyQuat;
    const fovScale = cam.fov;
    const put = (dirEci, text, font, color, dx = 6, dy = -4) => {
      _v.copy(dirEci).applyQuaternion(sq);
      const b = _v.dot(ec);
      if (b > 0 && ec2 - b * b < er * er) return false;
      _v.multiplyScalar(1e6).add(cam.position).project(cam);
      if (_v.z > 1 || _v.x < -1.05 || _v.x > 1.05 || _v.y < -1.05 || _v.y > 1.05) return false;
      const x = (_v.x * 0.5 + 0.5) * w, y = (0.5 - _v.y * 0.5) * h;
      g.font = font; g.fillStyle = color;
      g.fillText(text, x + dx, y + dy);
      return true;
    };
    g.textBaseline = 'alphabetic';
    if (on) {
      for (const l of this.labels) {
        if (l.kind === 'con') { if (fovScale < 4) continue; put(l.dir, l.text, '600 11px system-ui, sans-serif', 'rgba(120,160,255,0.75)', -20, 0); }
        else if (l.kind === 'star' && this.mode >= 2) put(l.dir, l.text, '11px system-ui, sans-serif', 'rgba(230,220,190,0.8)');
      }
      if (this.mode >= 2) {
        const eph = ctx.ephemeris;
        for (const n of ['moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
          const b = eph.bodies[n];
          _p.set(b.topo.x / b.dist, b.topo.y / b.dist, b.topo.z / b.dist);
          put(_p, b.ru, '600 12px system-ui, sans-serif', 'rgba(255,205,120,0.9)', 8, -6);
        }
      }
    }
    if (tel && ctx.telescope.labelsFor) ctx.telescope.labelsFor(put, g);
  }

  dispose() {
    for (const l of [this.figures, this.borders]) l?.geometry.dispose();
    this.figureMat.dispose(); this.borderMat.dispose();
    this.canvas?.remove();
  }
}
