import * as THREE from 'three';

/**
 * Procedural canvas textures. Everything is generated at startup (no image assets needed).
 * All generators cache by key. Color textures are sRGB; data textures (normal/roughness) are linear.
 */
export class Textures {
  constructor(renderer, maxAnisotropy = 16) {
    this.renderer = renderer;
    this.cache = new Map();
    // capped by the quality preset: anisotropic filtering is very expensive on CPU rasterisers
    this.anisotropy = renderer ? Math.max(1, Math.min(maxAnisotropy, renderer.capabilities.getMaxAnisotropy())) : 1;
  }

  _canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }

  _tex(canvas, { color = true, repeat = [1, 1], wrap = THREE.RepeatWrapping } = {}) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = wrap;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = this.anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }

  _cached(key, make) { if (!this.cache.has(key)) this.cache.set(key, make()); return this.cache.get(key); }

  /** Deterministic value noise helper (0..1). */
  static noise2(x, y, seed = 0) {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  }

  /** Smooth value noise (0..1) with `oct` octaves. */
  static fbm(x, y, oct = 4, seed = 0) {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) {
      const xi = Math.floor(x * f), yi = Math.floor(y * f);
      const fx = x * f - xi, fy = y * f - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const n00 = Textures.noise2(xi, yi, seed + i), n10 = Textures.noise2(xi + 1, yi, seed + i);
      const n01 = Textures.noise2(xi, yi + 1, seed + i), n11 = Textures.noise2(xi + 1, yi + 1, seed + i);
      v += a * ((n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy);
      a *= 0.5; f *= 2;
    }
    return v;
  }

  /**
   * Painted hull panels: base colour with subtle grime, panel seams, rivets and occasional
   * markings. Returns { map, roughnessMap, normalMap }.
   */
  hullPanels({ size = 1024, cells = 6, base = '#e9ebee', seam = '#8e949b', grime = 0.18, rivets = true, seed = 1, aged = 0.0 } = {}) {
    return this._cached(`hull:${size}:${cells}:${base}:${seam}:${grime}:${rivets}:${seed}:${aged}`, () => {
      const [c, g] = this._canvas(size, size);
      g.fillStyle = base; g.fillRect(0, 0, size, size);
      // grime / weathering noise: computed at low resolution and upscaled (bilinear) — the
      // per-pixel fbm at full resolution dominated startup time (~0.6 s per 1024² texture).
      const ns = 256;
      const [nc, ng] = this._canvas(ns, ns);
      const img = ng.createImageData(ns, ns), d = img.data;
      for (let y = 0; y < ns; y++) for (let x = 0; x < ns; x++) {
        const n = Textures.fbm(x / ns * 8, y / ns * 8, 4, seed);
        const n2 = Textures.fbm(x / ns * 40, y / ns * 40, 2, seed + 7);
        const k = 1 - grime * (n * 0.7 + n2 * 0.3) - aged * 0.25 * Math.pow(n2, 2);
        const i = (y * ns + x) * 4;
        d[i] = 255 * k; d[i + 1] = 255 * k; d[i + 2] = 255 * k * (1 - aged * 0.05); d[i + 3] = 255;
      }
      ng.putImageData(img, 0, 0);
      g.save(); g.globalCompositeOperation = 'multiply'; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(nc, 0, 0, size, size); g.restore();
      // panel seams
      const cs = size / cells;
      g.strokeStyle = seam; g.lineWidth = Math.max(1, size / 512);
      for (let i = 0; i <= cells; i++) {
        g.beginPath(); g.moveTo(i * cs, 0); g.lineTo(i * cs, size); g.stroke();
        g.beginPath(); g.moveTo(0, i * cs); g.lineTo(size, i * cs); g.stroke();
      }
      // sub-panels and rivets
      g.strokeStyle = 'rgba(80,86,94,0.45)'; g.lineWidth = 1;
      for (let i = 0; i < cells; i++) for (let j = 0; j < cells; j++) {
        if (Textures.noise2(i, j, seed) > 0.55) {
          const x0 = i * cs + cs * 0.15, y0 = j * cs + cs * 0.15, w = cs * 0.7, h = cs * 0.7;
          g.strokeRect(x0, y0, w, h);
        }
        if (rivets) {
          g.fillStyle = 'rgba(60,64,70,0.55)';
          const n = 6;
          for (let k = 0; k < n; k++) {
            const t = (k + 0.5) / n;
            g.beginPath(); g.arc(i * cs + t * cs, j * cs + cs * 0.04, size / 700, 0, Math.PI * 2); g.fill();
            g.beginPath(); g.arc(i * cs + cs * 0.04, j * cs + t * cs, size / 700, 0, Math.PI * 2); g.fill();
          }
        }
      }
      const map = this._tex(c);
      // roughness: seams rougher, grime rougher
      const [rc, rg] = this._canvas(size / 2, size / 2);
      rg.drawImage(c, 0, 0, size / 2, size / 2);
      const rimg = rg.getImageData(0, 0, size / 2, size / 2), rd = rimg.data;
      for (let i = 0; i < rd.length; i += 4) { const l = rd[i] / 255; const r = 255 * (0.75 - 0.3 * l + 0.2 * (1 - l)); rd[i] = rd[i + 1] = rd[i + 2] = Math.max(0, Math.min(255, r)); }
      rg.putImageData(rimg, 0, 0);
      const roughnessMap = this._tex(rc, { color: false });
      const normalMap = this.seamNormal({ size: Math.min(256, size / 2), cells, depth: 1.0, seed });
      return { map, roughnessMap, normalMap };
    });
  }

  /** Normal map with grooves along a grid (panel seams) and slight surface waviness. */
  seamNormal({ size = 512, cells = 6, depth = 1.0, seed = 3 } = {}) {
    return this._cached(`seamN:${size}:${cells}:${depth}:${seed}`, () => {
      const h = new Float32Array(size * size);
      const cs = size / cells, gw = Math.max(1.5, size / 256);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = Math.min(x % cs, cs - (x % cs)), dy = Math.min(y % cs, cs - (y % cs));
        const dm = Math.min(dx, dy);
        const groove = dm < gw ? -depth * (1 - dm / gw) : 0;
        h[y * size + x] = groove + 0.08 * Textures.fbm(x / size * 6, y / size * 6, 3, seed);
      }
      return this._heightToNormal(h, size, 3.0);
    });
  }

  /** Crinkled MLI (multi-layer insulation) foil: normal + roughness maps. */
  mli({ size = 512, scale = 14, seed = 11, strength = 2.2 } = {}) {
    return this._cached(`mli:${size}:${scale}:${seed}`, () => {
      const h = new Float32Array(size * size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        // creases: ridged multi-fractal
        let r = 0, a = 1, f = scale;
        for (let o = 0; o < 5; o++) { const n = Textures.fbm(u * f, v * f, 1, seed + o); r += a * (1 - Math.abs(n * 2 - 1)); a *= 0.55; f *= 2.1; }
        // quilted stitching lines every 1/4
        const sx = Math.abs(((u * 4) % 1) - 0.5), sy = Math.abs(((v * 4) % 1) - 0.5);
        const stitch = (sx > 0.47 || sy > 0.47) ? -0.6 : 0;
        h[y * size + x] = r * 0.5 + stitch;
      }
      const normalMap = this._heightToNormal(h, size, strength);
      const [rc, rg] = this._canvas(size, size);
      const rimg = rg.createImageData(size, size), rd = rimg.data;
      for (let i = 0; i < size * size; i++) { const v = 255 * (0.3 + 0.35 * Math.min(1, Math.max(0, h[i]))); rd[i * 4] = rd[i * 4 + 1] = rd[i * 4 + 2] = v; rd[i * 4 + 3] = 255; }
      rg.putImageData(rimg, 0, 0);
      return { normalMap, roughnessMap: this._tex(rc, { color: false }) };
    });
  }

  /** Solar cell grid colour texture (+ matching roughness). */
  solarCells({ size = 512, cols = 8, rows = 16, cell = '#1a2a5e', edge = '#9aa7c7', busbar = '#c8ccd6' } = {}) {
    return this._cached(`solar:${size}:${cols}:${rows}:${cell}`, () => {
      const [c, g] = this._canvas(size, size);
      g.fillStyle = edge; g.fillRect(0, 0, size, size);
      const cw = size / cols, ch = size / rows, gap = Math.max(1, size / 256);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        const n = Textures.noise2(i, j, 5);
        const col = new THREE.Color(cell).offsetHSL(0, 0, (n - 0.5) * 0.06);
        g.fillStyle = '#' + col.getHexString();
        g.fillRect(i * cw + gap, j * ch + gap, cw - 2 * gap, ch - 2 * gap);
        // fingers
        g.strokeStyle = 'rgba(200,205,215,0.35)'; g.lineWidth = 1;
        for (let k = 1; k < 6; k++) { const y = j * ch + (k / 6) * ch; g.beginPath(); g.moveTo(i * cw + gap, y); g.lineTo(i * cw + cw - gap, y); g.stroke(); }
        g.fillStyle = busbar; g.fillRect(i * cw + cw * 0.5 - gap, j * ch + gap, gap * 1.5, ch - 2 * gap);
      }
      const map = this._tex(c);
      const [rc, rg] = this._canvas(size, size);
      rg.fillStyle = '#5a5a5a'; rg.fillRect(0, 0, size, size);
      rg.fillStyle = '#9a9a9a';
      for (let i = 0; i <= cols; i++) rg.fillRect(i * cw - gap, 0, 2 * gap, size);
      for (let j = 0; j <= rows; j++) rg.fillRect(0, j * ch - gap, size, 2 * gap);
      return { map, roughnessMap: this._tex(rc, { color: false }) };
    });
  }

  /** Radiator panel: white with thin tube lines. */
  radiator({ size = 512, lines = 24 } = {}) {
    return this._cached(`radiator:${size}:${lines}`, () => {
      const [c, g] = this._canvas(size, size);
      g.fillStyle = '#f2f3f4'; g.fillRect(0, 0, size, size);
      g.strokeStyle = '#c3c6ca'; g.lineWidth = Math.max(1, size / 400);
      for (let i = 0; i < lines; i++) { const x = (i + 0.5) * size / lines; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, size); g.stroke(); }
      g.strokeStyle = '#9ea2a7'; g.lineWidth = Math.max(2, size / 200);
      g.strokeRect(1, 1, size - 2, size - 2);
      return { map: this._tex(c) };
    });
  }

  /** Text decal (transparent). `color` CSS, `font` CSS font. Returns texture (not repeated). */
  text(text, { width = 512, height = 128, color = '#1b1f24', bg = null, font = 'bold 72px "Segoe UI", Arial, sans-serif', align = 'center', padding = 8 } = {}) {
    return this._cached(`text:${text}:${width}:${height}:${color}:${bg}:${font}:${align}`, () => {
      const [c, g] = this._canvas(width, height);
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, width, height); }
      g.fillStyle = color; g.font = font; g.textAlign = align; g.textBaseline = 'middle';
      const x = align === 'center' ? width / 2 : align === 'left' ? padding : width - padding;
      g.fillText(text, x, height / 2);
      const t = this._tex(c, { wrap: THREE.ClampToEdgeWrapping });
      return t;
    });
  }

  /** Hazard stripes (yellow/black or custom). */
  stripes({ size = 256, a = '#f0c020', b = '#1a1a1a', count = 8, angle = 45 } = {}) {
    return this._cached(`stripes:${size}:${a}:${b}:${count}:${angle}`, () => {
      const [c, g] = this._canvas(size, size);
      g.fillStyle = a; g.fillRect(0, 0, size, size);
      g.save(); g.translate(size / 2, size / 2); g.rotate(angle * Math.PI / 180); g.translate(-size, -size);
      g.fillStyle = b;
      const w = (size * 2) / count;
      for (let i = 0; i < count * 2; i += 2) g.fillRect(i * w, 0, w, size * 3);
      g.restore();
      return this._tex(c);
    });
  }

  /** Soft circular glow sprite texture. */
  glow({ size = 128, inner = 0.0, falloff = 1.0 } = {}) {
    return this._cached(`glow:${size}:${inner}:${falloff}`, () => {
      const [c, g] = this._canvas(size, size);
      const img = g.createImageData(size, size), d = img.data;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const v = Math.pow(Math.max(0, 1 - Math.max(0, r - inner) / (1 - inner)), falloff);
        const i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = 255 * v;
      }
      g.putImageData(img, 0, 0);
      const t = this._tex(c, { color: false, wrap: THREE.ClampToEdgeWrapping });
      return t;
    });
  }

  /** Grey-scale fbm noise texture (linear). */
  noise({ size = 256, scale = 6, oct = 4, seed = 2 } = {}) {
    return this._cached(`noise:${size}:${scale}:${oct}:${seed}`, () => {
      const [c, g] = this._canvas(size, size);
      const img = g.createImageData(size, size), d = img.data;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const v = 255 * Textures.fbm(x / size * scale, y / size * scale, oct, seed);
        const i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      return this._tex(c, { color: false });
    });
  }

  _heightToNormal(h, size, strength) {
    const [c, g] = this._canvas(size, size);
    const img = g.createImageData(size, size), d = img.data;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const xl = h[y * size + ((x - 1 + size) % size)], xr = h[y * size + ((x + 1) % size)];
      const yu = h[((y - 1 + size) % size) * size + x], yd = h[((y + 1) % size) * size + x];
      const nx = -(xr - xl) * strength, ny = -(yd - yu) * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      d[i] = 255 * (nx / l * 0.5 + 0.5); d[i + 1] = 255 * (ny / l * 0.5 + 0.5); d[i + 2] = 255 * (nz / l * 0.5 + 0.5); d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return this._tex(c, { color: false });
  }
}
