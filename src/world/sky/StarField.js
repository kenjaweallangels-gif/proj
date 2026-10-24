import * as THREE from 'three';
import { STAR_VERTEX, STAR_FRAGMENT } from '../shaders/SkyShaders.js';
import { fetchStars, buildStarGeometry, STAR_DISTANCE_KM, CELL_RA, CELL_DEC } from './StarCatalog.js';

/**
 * Catalogue stars (Hipparcos + Tycho-2 via HYG v4.4 / Gaia DR3; Gaia-only sources for the telescope).
 *
 * Normal view: magnitude-sorted chunks a/b/c, of which a prefix of `count` stars is drawn (preset budget).
 * Telescope (`loadDeep()`): chunk c (if not loaded), d (10.5 < V <= 12) and the Gaia-only stars are split into
 * 512 sky cells, one Points object each, so three's frustum culling draws only the cells in the narrow field.
 * All Points share one material per occlusion variant; uniforms are set by Sky (setOptics).
 *
 * `group` (Points children) is what the 'lite' direct render path draws straight onto the canvas.
 */

/** Stars drawn in the normal view per preset (prefix of the magnitude-sorted catalogue). */
export const STAR_BUDGET = { ultra: 300000, high: 200000, medium: 110000, low: 50000, lite: 9300 };
/** Physical energy of a magnitude-0 star: 2.04e-11 (V = 0 / Sun) x pi x 1.45 (white Lambert radiance). */
export const STAR_K = 2.04e-11 * Math.PI * 1.45;

export class StarField {
  constructor(ctx, { lite = false } = {}) {
    this.ctx = ctx;
    this.lite = lite;
    this.group = new THREE.Group();
    this.group.name = 'Stars';
    this.uniforms = {
      uFluxScale: { value: 1 }, uSigma: { value: 0.75 }, uWing: { value: 0.12 }, uSaturate: { value: 1 }, uThreshold: { value: 1e-4 },
      uMagLimit: { value: 30 }, uMaxSize: { value: 64 },
      uEarthCenter: { value: new THREE.Vector3() }, uEarthRadius: { value: 6371 + 60 }, uMoon: { value: new THREE.Vector4(0, 0, 0, 0) },
      uFade: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 1, 1)) }, uFadeAmount: { value: new Array(8).fill(0) },
    };
    const make = (defines, name) => new THREE.ShaderMaterial({
      name, uniforms: this.uniforms, defines, vertexShader: STAR_VERTEX, fragmentShader: STAR_FRAGMENT,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, toneMapped: false,
    });
    // 'lite' draws the stars straight onto the canvas after the low-resolution far scene (see fx/Post.js)
    this.material = make(lite ? { EARTH_OCCLUSION: 1 } : {}, 'Stars');
    // deep cells (telescope): DSO image tiles fade the catalogue stars they already contain
    this.deepMaterial = make(lite ? { EARTH_OCCLUSION: 1, FADE_REGIONS: 1 } : { FADE_REGIONS: 1 }, 'StarsDeep');
    this.brightMaterial = this.material;
    this.chunks = [];          // { name, cat, points, start }
    this.count = 0;            // stars drawn in the normal view
    this.deep = null;          // { cells: Points[], loading, loaded }
    this.deepVisible = false;
    this.cats = {};
  }

  async load(budget) {
    const ctx = this.ctx;
    const need = [['a', 16241], ['b', 202079], ['c', 367580]];
    let total = 0;
    const names = [];
    for (const [n, size] of need) { if (total >= budget) break; names.push(n); total += size; }
    const cats = await Promise.all(names.map((n) => fetchStars(ctx.assetUrl(`data/sky/stars_${n}.bin`))));
    let left = budget, start = 0;
    names.forEach((n, i) => {
      const cat = cats[i];
      this.cats[n] = cat;
      const take = Math.min(cat.count, left);
      left -= take;
      const geo = buildStarGeometry(cat, 0, take);
      const p = new THREE.Points(geo, this.material);
      p.name = `Stars_${n}`; p.frustumCulled = false; p.renderOrder = -20;
      this.group.add(p);
      this.chunks.push({ name: n, cat, points: p, start, count: take });
      start += cat.count;
    });
    this.count = budget - left;
    this.faintestNormal = this._faintest();
  }

  _faintest() {
    const last = this.chunks[this.chunks.length - 1];
    if (!last) return 0;
    const b = last.cat.bytes;
    return b[(last.count - 1) * last.cat.rec + 6] / 16 - 2;
  }

  /** The magnitude-sorted record set containing global index i (star_names.json `i`), or null if not loaded. */
  recordOf(i) {
    for (const c of this.chunks) if (i >= c.start && i < c.start + c.cat.count) return { cat: c.cat, index: i - c.start };
    return null;
  }

  /**
   * Telescope: load the rest of chunk c, chunk d and the Gaia-only stars into sky cells (lazily, once).
   * Resolves when the cells are built. Building yields to the frame loop between cells.
   */
  loadDeep() {
    if (this.deep) return this.deep.promise;
    const ctx = this.ctx;
    const deep = this.deep = { cells: [], loaded: false, group: new THREE.Group() };
    deep.group.name = 'StarsDeep';
    deep.group.visible = this.deepVisible;
    this.group.add(deep.group);
    const files = ['d', 'gaia'];
    const cChunk = this.chunks.find((c) => c.name === 'c');
    const needC = !cChunk || cChunk.count < cChunk.cat.count;
    deep.promise = (async () => {
      const cats = await Promise.all(files.map((n) => fetchStars(ctx.assetUrl(`data/sky/stars_${n}.bin`))));
      // the remainder of the magnitude-sorted chunks becomes extra whole-sky Points (cheap: drawn only zoomed in)
      if (needC) {
        const cat = cChunk ? cChunk.cat : await fetchStars(ctx.assetUrl('data/sky/stars_c.bin'));
        if (!cChunk) {
          // high / lower presets stop inside b: draw the rest of b too
          const bChunk = this.chunks.find((c) => c.name === 'b');
          if (bChunk && bChunk.count < bChunk.cat.count) this._addRest(deep, bChunk.cat, bChunk.count, 'b');
        }
        this._addRest(deep, cat, cChunk ? cChunk.count : 0, 'c');
        this.cats.c = cat;
      }
      for (const [k, cat] of cats.entries()) {
        const cells = cat.cells;
        for (let c = 0; c < CELL_RA * CELL_DEC; c++) {
          const s = cells[c], e = cells[c + 1];
          if (e <= s) continue;
          const p = new THREE.Points(buildStarGeometry(cat, s, e), this.deepMaterial);
          p.name = `Stars_${files[k]}_${c}`; p.frustumCulled = true; p.renderOrder = -20;
          deep.group.add(p); deep.cells.push(p);
          if ((c & 31) === 31) await new Promise((r) => setTimeout(r, 0));
        }
      }
      deep.loaded = true;
      return deep;
    })().catch((e) => { console.warn('[Sky] deep star catalogue failed', e); deep.failed = true; });
    return deep.promise;
  }

  _addRest(deep, cat, from, name) {
    if (from >= cat.count) return;
    const p = new THREE.Points(buildStarGeometry(cat, from, cat.count), this.deepMaterial);
    p.name = `Stars_${name}_rest`; p.frustumCulled = false; p.renderOrder = -20;
    deep.group.add(p);
  }

  setDeepVisible(on) {
    this.deepVisible = on;
    if (this.deep) this.deep.group.visible = on;
  }

  /** Total stars loaded (normal + deep). */
  get loadedCount() {
    let n = 0;
    this.group.traverse((o) => { if (o.isPoints) n += o.geometry.attributes.position.count; });
    return n;
  }

  dispose() {
    this.group.traverse((o) => { if (o.isPoints) o.geometry.dispose(); });
    this.material.dispose(); this.deepMaterial.dispose();
  }
}

export { STAR_DISTANCE_KM };
