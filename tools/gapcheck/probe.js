/**
 * In-page half of tools/gapcheck.mjs (served by Vite, imported by the page): renders the NEAR scene only from a
 * given camera with id / depth materials and finds
 *   holes    — background pixels enclosed by geometry (missing caps, see-through shells, cracks closed on all sides)
 *   cracks   — thin background slits (≤ 3 px) whose two sides lie at the same depth (seams between parts that
 *              should touch: a few cm in 3D)
 *   backface — pixels where the nearest surface is the back face of a single-sided (FrontSide) material: an open
 *              shell / single-sided plane seen from behind (back-face culled, so the real render shows what lies
 *              behind it)
 *   zfight   — pixels whose visible surface changes when only the depth mapping changes (near/far): coplanar
 *              surfaces fighting for the depth test
 * Glass counts as geometry (a window must be closed by its pane); glows and other depth-write-free transparent
 * parts, sprites, points, lines and meshes flagged `userData.noCollide` are ignored.
 */
import * as THREE from 'three';
import { patchCarve } from '/src/station/interior/Materials.js';

export { THREE };

const RAD = 3;          // crack: max slit width in pixels
const _v = new THREE.Vector3();

export class GapProbe {
  constructor(app, { w = 640, h = 360 } = {}) {
    this.app = app;
    this.w = w; this.h = h;
    this.gl = app.renderer.renderer;
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.rtBeauty = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: true, samples: 0 });
    this.rtBeauty.texture.colorSpace = THREE.SRGBColorSpace;
    this.buf = new Float32Array(w * h * 4);
    this.ids = [null];               // id -> { name, mat, side, glass }
    this.matCache = new Map();       // `${mesh.uuid}` -> { id, mats: { normal, double } }
    this.passes = [];
    // stop the app's own rendering: modules keep updating (LOD, interior visibility, carving), nothing is drawn
    this._render = app.renderer.render.bind(app.renderer);
    app.renderer.render = () => {};
    app.paused = true;
  }

  restore() { this.app.renderer.render = this._render; this.app.paused = false; }

  /** Id material for one mesh (side: 'orig' | 'double'). */
  _idMat(o, src, side) {
    const key = o.uuid + '|' + src.uuid + '|' + side;
    let e = this.matCache.get(key);
    if (e) return e;
    const id = this.ids.length;
    const glass = /glass|visor|pane|window(?!Glow)/i.test(src.name || '') || (src.transparent && src.transmission > 0);
    this.ids.push({ name: o.name || o.parent?.name || o.type, mat: src.name || '(unnamed)', side: src.side, glass, mesh: o });
    const m = new THREE.MeshBasicMaterial({ side: side === 'double' ? THREE.DoubleSide : src.side, map: src.alphaTest > 0 ? src.map : null, alphaMap: src.alphaTest > 0 ? src.alphaMap : null, alphaTest: src.alphaTest || 0 });
    m.polygonOffset = src.polygonOffset; m.polygonOffsetFactor = src.polygonOffsetFactor; m.polygonOffsetUnits = src.polygonOffsetUnits;
    m.vertexColors = false;
    const uId = { value: id };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uGapId = uId;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGapP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvGapP = mvPosition.xyz;');
      // r: mesh id, g: view depth, b: facing (|cos| between the geometric normal and the view ray, signed by the
      // face side), a: 1
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGapId;\nvarying vec3 vGapP;')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        vec3 gN = normalize( cross( dFdx( vGapP ), dFdy( vGapP ) ) );
        float gFace = max( 0.02, abs( dot( gN, normalize( vGapP ) ) ) );
        gl_FragColor = vec4( uGapId, -vGapP.z, gl_FrontFacing ? gFace : -gFace, 1.0 );`);
    };
    m.customProgramCacheKey = () => 'gapid';
    // interior carving (exterior hull that pokes into the cabins is discarded like in the real render)
    if (src.userData?.carved && this.app.station.interior?.carveU) patchCarve(m, this.app.station.interior.carveU);
    e = m;
    this.matCache.set(key, e);
    return e;
  }

  _solid(o) {
    if (!(o.isMesh || o.isInstancedMesh) || o.isSprite || o.isPoints || o.isLine) return false;
    if (o.userData?.noCollide) return false;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m) return false;
    if (m.transparent && m.depthWrite === false && !/glass|visor|pane|window(?!Glow)/i.test(m.name || '')) return false;
    if (m.blending === THREE.AdditiveBlending) return false;
    if (m.colorWrite === false) return false;
    return true;
  }

  /** Swap every near-scene mesh to its id material (side 'orig' | 'double'); returns an undo list. */
  _swap(side) {
    const undo = [];
    this.app.nearScene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine || o.isSprite)) return;
      if (!this._solid(o)) { if (o.visible) { undo.push([o, 'v', true]); o.visible = false; } return; }
      const src = Array.isArray(o.material) ? o.material[0] : o.material;
      undo.push([o, 'm', o.material]);
      o.material = this._idMat(o, src, side);
    });
    return undo;
  }
  _unswap(undo) { for (const [o, k, v] of undo) { if (k === 'm') o.material = v; else o.visible = v; } }

  _pass(side, near, far) {
    const app = this.app, gl = this.gl, cam = app.camera;
    const undo = this._swap(side);
    const scene = app.nearScene;
    const bg = scene.background, env = scene.environment, fog = scene.fog;
    scene.background = null; scene.environment = null; scene.fog = null;
    const n0 = cam.near, f0 = cam.far, a0 = cam.aspect;
    cam.near = near; cam.far = far; cam.aspect = this.w / this.h; cam.updateProjectionMatrix();
    const mask = cam.layers.mask;
    cam.layers.disable(2);   // first-person suit parts
    const prevTM = gl.toneMapping; gl.toneMapping = THREE.NoToneMapping;
    const sm = gl.shadowMap.enabled; gl.shadowMap.enabled = false;
    gl.setRenderTarget(this.rt);
    gl.setClearColor(0x000000, 0); gl.clear(true, true, true);
    gl.render(scene, cam);
    gl.readRenderTargetPixels(this.rt, 0, 0, this.w, this.h, this.buf);
    gl.setRenderTarget(null);
    gl.toneMapping = prevTM; gl.shadowMap.enabled = sm;
    cam.layers.mask = mask;
    cam.near = n0; cam.far = f0; cam.aspect = a0; cam.updateProjectionMatrix();
    scene.background = bg; scene.environment = env; scene.fog = fog;
    this._unswap(undo);
    const n = this.w * this.h, id = new Int32Array(n), z = new Float32Array(n), front = new Int8Array(n), face = new Float32Array(n);
    // flip rows: GL origin bottom-left
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const s = ((this.h - 1 - y) * this.w + x) * 4, d = y * this.w + x;
      id[d] = Math.round(this.buf[s]); z[d] = this.buf[s + 1]; front[d] = this.buf[s + 2] > 0 ? 1 : -1; face[d] = Math.abs(this.buf[s + 2]);
    }
    return { id, z, front, face };
  }

  /** Real render (near scene, original materials, magenta background) for review crops: RGBA8 rows top-down. */
  beauty() {
    const app = this.app, gl = this.gl, cam = app.camera, scene = app.nearScene;
    const bg = scene.background; scene.background = new THREE.Color(0xff00ff);
    const a0 = cam.aspect; cam.aspect = this.w / this.h; cam.updateProjectionMatrix();
    const mask = cam.layers.mask; cam.layers.disable(2);
    gl.setRenderTarget(this.rtBeauty); gl.clear(true, true, true);
    gl.render(scene, cam);
    const px = new Uint8Array(this.w * this.h * 4);
    gl.readRenderTargetPixels(this.rtBeauty, 0, 0, this.w, this.h, px);
    gl.setRenderTarget(null);
    cam.layers.mask = mask; cam.aspect = a0; cam.updateProjectionMatrix();
    scene.background = bg;
    const out = new Uint8ClampedArray(px.length);
    for (let y = 0; y < this.h; y++) out.set(px.subarray((this.h - 1 - y) * this.w * 4, (this.h - y) * this.w * 4), y * this.w * 4);
    return out;
  }

  /** Place the camera and let the app update one frame (LOD, detail cells, interior visibility, carving). */
  async place(pos, target, up = null) {
    const app = this.app, cam = app.camera;
    if (app.mode !== 'observer') app.setMode('observer');
    cam.up.copy(up || THREE.Object3D.DEFAULT_UP);
    cam.position.copy(pos);
    app.orbitControls.target.copy(target);
    cam.lookAt(target);
    await app.renderFrames(1);
    cam.position.copy(pos); cam.up.copy(up || THREE.Object3D.DEFAULT_UP); cam.lookAt(target); cam.updateMatrixWorld();
    await app.renderFrames(1);   // interior visibility / LOD see the final pose
    cam.position.copy(pos); cam.lookAt(target); cam.updateMatrixWorld();
  }

  /** Analyse the current camera. Returns { issues: [...], counts, beauty? } */
  analyse({ minPx = 4, beauty = false } = {}) {
    const W = this.w, H = this.h, N = W * H;
    const cam = this.app.camera;
    const P1 = this._pass('orig', cam.near, cam.far);
    const P2 = this._pass('orig', cam.near * 1.7, cam.far * 0.6);
    const P3 = this._pass('double', cam.near, cam.far);
    const pixAng = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / H;   // radians per pixel (approx.)
    const cls = new Uint8Array(N);   // 0 none, 1 hole, 2 crack, 3 backface, 4 zfight, 5 opening (big enclosed)
    const id = P1.id, z = P1.z;
    // --- enclosed background components (4-connected, not touching the border)
    const comp = new Int32Array(N).fill(-1);
    const comps = [];
    const stack = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (id[s] !== 0 || comp[s] >= 0) continue;
      const ci = comps.length; let sp = 0, area = 0, border = false, x0 = W, y0 = H, x1 = 0, y1 = 0;
      stack[sp++] = s; comp[s] = ci;
      while (sp) {
        const p = stack[--sp]; area++;
        const x = p % W, y = (p / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && id[p - 1] === 0 && comp[p - 1] < 0) { comp[p - 1] = ci; stack[sp++] = p - 1; }
        if (x < W - 1 && id[p + 1] === 0 && comp[p + 1] < 0) { comp[p + 1] = ci; stack[sp++] = p + 1; }
        if (y > 0 && id[p - W] === 0 && comp[p - W] < 0) { comp[p - W] = ci; stack[sp++] = p - W; }
        if (y < H - 1 && id[p + W] === 0 && comp[p + W] < 0) { comp[p + W] = ci; stack[sp++] = p + W; }
      }
      comps.push({ area, border, x0, y0, x1, y1 });
    }
    // --- enclosed components: inscribed width (chamfer distance to geometry) and the depth around them, so only
    //     enclosed holes narrower than ~5 cm count as defects (wider ones are openings between parts: handrail
    //     standoffs, truss bays; an open shell shows its back faces and is caught by the back-face test)
    const dist = new Float32Array(N);
    for (let p = 0; p < N; p++) dist[p] = id[p] ? 0 : 1e6;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x; if (!dist[p]) continue;
      let d = dist[p];
      if (x > 0) d = Math.min(d, dist[p - 1] + 1);
      if (y > 0) { d = Math.min(d, dist[p - W] + 1); if (x > 0) d = Math.min(d, dist[p - W - 1] + 1.414); if (x < W - 1) d = Math.min(d, dist[p - W + 1] + 1.414); }
      dist[p] = d;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const p = y * W + x; if (!dist[p]) continue;
      let d = dist[p];
      if (x < W - 1) d = Math.min(d, dist[p + 1] + 1);
      if (y < H - 1) { d = Math.min(d, dist[p + W] + 1); if (x < W - 1) d = Math.min(d, dist[p + W + 1] + 1.414); if (x > 0) d = Math.min(d, dist[p + W - 1] + 1.414); }
      dist[p] = d;
    }
    const face = P1.face;
    for (const c of comps) { c.maxD = 0; c.zMin = 1e9; c.nb = 0; c.nf = 0; }
    for (let p = 0; p < N; p++) {
      if (id[p] !== 0) {
        // depth of geometry bordering an enclosed component
        const x = p % W;
        for (const q of [p - 1, p + 1, p - W, p + W]) { if (q < 0 || q >= N || id[q] !== 0 || (q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue; const c = comps[comp[q]]; if (z[p] < c.zMin) c.zMin = z[p]; c.nb++; if (face[p] > 0.3) c.nf++; }
        continue;
      }
      const c = comps[comp[p]]; if (dist[p] > c.maxD) c.maxD = dist[p];
    }
    // a hole IN a surface is bordered by surfaces facing the camera; a gap BETWEEN objects (parallel cables, a
    // rail and the hull) by silhouettes (grazing faces)
    for (const c of comps) { c.widthM = 2 * c.maxD * pixAng * (c.zMin < 1e8 ? c.zMin : 1e3); c.inSurface = c.nb > 0 && c.nf / c.nb > 0.6; }
    // --- thin slits: background pixel with geometry on both sides (within RAD) at matching depth
    const sideHit = (p, dx, dy) => {
      let x = p % W, y = (p / W) | 0;
      for (let k = 1; k <= RAD; k++) { x += dx; y += dy; if (x < 0 || y < 0 || x >= W || y >= H) return -1; const q = y * W + x; if (id[q] !== 0) return q; }
      return -1;
    };
    for (let p = 0; p < N; p++) {
      if (id[p] !== 0) continue;
      const c = comps[comp[p]];
      if (!c.border) { cls[p] = c.widthM <= 0.05 && c.inSurface ? 1 : 5; }
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const a = sideHit(p, dx, dy), b = a >= 0 ? sideHit(p, -dx, -dy) : -1;
        if (a < 0 || b < 0) continue;
        const za = z[a], zb = z[b], zm = Math.min(za, zb);
        // gap width in metres (slit pixels × pixel footprint) and depth agreement of the two sides
        const wpx = Math.abs((a % W) - (b % W)) + Math.abs(((a / W) | 0) - ((b / W) | 0)) - 1;
        const wm = wpx * zm * pixAng;
        if (Math.abs(za - zb) < 0.04 * zm + 0.03 && wm < 0.06 && face[a] > 0.3 && face[b] > 0.3) { cls[p] = cls[p] === 1 ? 1 : 2; break; }
      }
    }
    // --- back faces of single-sided materials nearest to the camera (open shells / planes seen from behind)
    for (let p = 0; p < N; p++) {
      const i3 = P3.id[p];
      if (!i3 || P3.front[p] > 0) continue;
      const info = this.ids[i3];
      if (!info || info.side !== THREE.FrontSide) continue;
      // nearer than whatever the real render shows there (or the real render shows nothing)
      if (id[p] === 0 || P3.z[p] < z[p] - 0.002 * z[p] - 0.002) cls[p] = cls[p] || 3;
    }
    // --- z-fighting: visible surface changes with the depth mapping only
    for (let p = 0; p < N; p++) {
      if (cls[p] || !id[p] || !P2.id[p] || id[p] === P2.id[p]) continue;
      const a = this.ids[id[p]], b = this.ids[P2.id[p]];
      if (a.mesh === b.mesh) continue;
      cls[p] = 4;
    }
    // --- cluster flagged pixels (8-connected, per class)
    const seen = new Uint8Array(N);
    const issues = [];
    const counts = { hole: 0, crack: 0, backface: 0, zfight: 0, opening: 0 };
    const NAMES = [null, 'hole', 'crack', 'backface', 'zfight', 'opening'];
    for (let s = 0; s < N; s++) {
      if (!cls[s] || seen[s]) continue;
      const k = cls[s]; let sp = 0, area = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      const around = new Map();
      stack[sp++] = s; seen[s] = 1;
      while (sp) {
        const p = stack[--sp]; area++;
        const x = p % W, y = (p / W) | 0; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (cls[q] === k && !seen[q]) { seen[q] = 1; stack[sp++] = q; }
          else if (cls[q] !== k) { const ii = k === 3 ? P3.id[q] : id[q]; if (ii) around.set(ii, (around.get(ii) || 0) + 1); }
        }
        if (k === 3 || k === 4) { const ii = k === 3 ? P3.id[p] : id[p]; around.set(ii, (around.get(ii) || 0) + 4); if (k === 4) around.set(P2.id[p], (around.get(P2.id[p]) || 0) + 4); }
      }
      if (area < minPx && k !== 1) continue;
      if (k === 1 && area < 2) continue;
      // world position: depth of the nearest geometry pixel to the centroid
      const cx = Math.round(sx / area), cy = Math.round(sy / area);
      let best = -1, bd = 1e9;
      for (let r = 0; r < 24 && best < 0; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx, zz = k === 3 ? P3.z[q] : z[q];
        if ((k === 3 ? P3.id[q] : id[q]) && dx * dx + dy * dy < bd) { bd = dx * dx + dy * dy; best = q; }
      }
      let world = null;
      if (best >= 0) {
        const zz = k === 3 ? P3.z[best] : z[best];
        _v.set(((best % W) + 0.5) / W * 2 - 1, -(((best / W) | 0) + 0.5) / H * 2 + 1, 0.5).unproject(cam);
        _v.sub(cam.position).normalize();
        const fwd = cam.getWorldDirection(new THREE.Vector3());
        const t = zz / Math.max(1e-4, _v.dot(fwd));
        world = cam.position.clone().addScaledVector(_v, t).toArray().map((q) => +q.toFixed(2));
      }
      const parts = [...around.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([i]) => `${this.ids[i]?.name}[${this.ids[i]?.mat}]`);
      counts[NAMES[k]] += area;
      issues.push({ kind: NAMES[k], px: area, bbox: [x0, y0, x1, y1], center: [cx, cy], world, dist: best >= 0 ? +(k === 3 ? P3.z[best] : z[best]).toFixed(2) : null, parts });
    }
    issues.sort((a, b) => b.px - a.px);
    const res = { issues, counts };
    // false-colour visualisation (RGBA8, rows top-down): mesh colour × depth shading, flags painted on top
    if (beauty || issues.some((i) => i.kind !== 'opening')) {
      const vis = new Uint8ClampedArray(N * 4);
      const FLAG = [null, [255, 0, 0], [255, 220, 0], [255, 120, 0], [0, 230, 255], [60, 60, 200]];
      for (let p = 0; p < N; p++) {
        let r = 255, g = 0, b = 255;
        if (cls[p]) [r, g, b] = FLAG[cls[p]];
        else if (id[p]) {
          const hsh = Math.imul(id[p], 2654435761) >>> 0;
          const x = p % W;
          const dzx = x < W - 1 && id[p + 1] ? z[p + 1] - z[p] : 0;
          const dzy = p + W < N && id[p + W] ? z[p + W] - z[p] : 0;
          const shade = 0.55 + 0.45 * Math.max(0, Math.min(1, 1 - 8 * Math.hypot(dzx, dzy) / Math.max(0.05, z[p] * pixAng * 4)));
          r = (80 + (hsh & 127)) * shade; g = (80 + ((hsh >> 8) & 127)) * shade; b = (80 + ((hsh >> 16) & 127)) * shade;
        } else { r = 40; g = 0; b = 40; }
        vis[p * 4] = r; vis[p * 4 + 1] = g; vis[p * 4 + 2] = b; vis[p * 4 + 3] = 255;
      }
      res.vis = vis;
      res.beauty = this.beauty();
    }
    return res;
  }
}

/** RGBA8 rows -> PNG data URL (via a 2D canvas), optionally a crop scaled ×s. */
export function toPng(px, w, h, crop = null, s = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
  if (!crop) return c.toDataURL('image/png');
  const [x0, y0, cw, ch] = crop;
  const o = document.createElement('canvas'); o.width = cw * s; o.height = ch * s;
  const g = o.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(c, x0, y0, cw, ch, 0, 0, cw * s, ch * s);
  return o.toDataURL('image/png');
}

/** Side-by-side review image: beauty | false colour, with the issue boxes drawn on both halves. */
export function reviewPng(res, w, h, issues) {
  const c = document.createElement('canvas'); c.width = w * 2; c.height = h;
  const g = c.getContext('2d');
  g.putImageData(new ImageData(res.beauty, w, h), 0, 0);
  g.putImageData(new ImageData(res.vis, w, h), w, 0);
  g.lineWidth = 1;
  const COL = { hole: '#ff2020', crack: '#ffdd00', backface: '#ff8800', zfight: '#00e6ff', opening: '#6060ff' };
  issues.forEach((i, n) => {
    if (i.kind === 'opening') return;
    g.strokeStyle = COL[i.kind];
    for (const off of [0, w]) g.strokeRect(i.bbox[0] - 3 + off + 0.5, i.bbox[1] - 3 + 0.5, i.bbox[2] - i.bbox[0] + 6, i.bbox[3] - i.bbox[1] + 6);
    g.fillStyle = COL[i.kind]; g.font = '10px monospace'; g.fillText(String(n), i.bbox[0] + w, Math.max(9, i.bbox[1] - 4));
  });
  return c.toDataURL('image/png');
}

/* ------------------------------------------------------------------------------------------ viewpoints */

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Exterior: colliders (static, non-dynamic) are split into pieces of at most ~5 m (long capsules / boxes become
 * several), clustered by name within 3 m, and each cluster gets `per` cameras on a Fibonacci sphere at a close
 * and a medium distance (positions inside solids or compartments are skipped).
 */
export function exteriorViews(app, { areas = null, per = 10, ring = false } = {}) {
  const st = app.station, views = [];
  const inSolid = (p) => {
    for (const c of st.colliders) {
      if (c.dynamic && !ring) continue;
      if (c.type === 'sphere' && p.distanceTo(c.center) < c.radius + 0.3) return true;
      if (c.type === 'capsule') { const l = new THREE.Line3(c.a, c.b); const q = l.closestPointToPoint(p, true, new THREE.Vector3()); if (q.distanceTo(p) < c.radius + 0.3) return true; }
      if (c.type === 'box') { const l = p.clone().sub(c.center).applyQuaternion(c.quaternion.clone().invert()); if (Math.abs(l.x) < c.halfSize.x + 0.3 && Math.abs(l.y) < c.halfSize.y + 0.3 && Math.abs(l.z) < c.halfSize.z + 0.3) return true; }
    }
    return !!st.interior?.locate?.(p, null, 0.0);
  };
  const pieces = [];
  for (const c of st.colliders) {
    if (c.dynamic && !ring) continue;
    const name = c.name || 'collider';
    if (areas && !areas.some((a) => name.toLowerCase().includes(a))) continue;
    if (c.type === 'capsule') {
      const L = c.a.distanceTo(c.b), n = Math.max(1, Math.ceil(L / 5));
      for (let i = 0; i < n; i++) pieces.push({ name, c: c.a.clone().lerp(c.b, (i + 0.5) / n), r: Math.max(c.radius, L / n / 2) });
    } else if (c.type === 'sphere') pieces.push({ name, c: c.center.clone(), r: c.radius });
    else if (c.type === 'box') {
      const hs = c.halfSize, axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((v) => v.applyQuaternion(c.quaternion));
      const big = [0, 1, 2].sort((a, b) => hs.getComponent(b) - hs.getComponent(a))[0], L = hs.getComponent(big) * 2, n = Math.max(1, Math.ceil(L / 5));
      for (let i = 0; i < n; i++) pieces.push({ name, c: c.center.clone().addScaledVector(axes[big], -L / 2 + (i + 0.5) * L / n), r: Math.min(5, Math.hypot(hs.x, hs.y, hs.z, 0) ) });
    }
  }
  const clusters = [];
  for (const p of pieces) {
    const k = clusters.find((q) => q.name === p.name && q.c.distanceTo(p.c) < 3);
    if (k) { k.n++; k.c.lerp(p.c, 1 / k.n); k.r = Math.max(k.r, p.r); } else clusters.push({ name: p.name, c: p.c.clone(), r: Math.min(p.r, 4), n: 1 });
  }
  const ga = Math.PI * (3 - Math.sqrt(5));
  clusters.forEach((cl, ci) => {
    for (const [f, add] of [[1.25, 1.2], [2.6, 3]]) {
      for (let i = 0; i < per; i++) {
        const y = 1 - (i + 0.5) / per * 2, rr = Math.sqrt(1 - y * y), th = ga * i + ci;
        const dir = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
        const pos = cl.c.clone().addScaledVector(dir, cl.r * f + add);
        if (inSolid(pos)) continue;
        views.push({ name: `${cl.name}@${cl.c.toArray().map((q) => q.toFixed(0)).join(',')}#${views.length}`, area: cl.name, pos: pos.toArray(), target: cl.c.toArray() });
      }
    }
  });
  return views;
}

/** Ships (any state): orbit cameras around each ship group at L0 / L1 distances. */
export function shipViews(app, { perShip = 16, types = null } = {}) {
  const views = [];
  for (const s of app.ships?.ships || []) {
    if (!s.group.visible && s.state === 'idle') continue;
    if (types && !types.includes(s.type)) continue;
    const box = new THREE.Box3().setFromObject(s.group);
    if (box.isEmpty()) continue;
    const c = box.getCenter(new THREE.Vector3()), R = box.getSize(new THREE.Vector3()).length() / 2;
    const q = s.group.getWorldQuaternion(new THREE.Quaternion());
    const ax = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    for (const [d, tag] of [[1.25, 'L0'], [2.2, 'L0'], [6, 'L1']]) {
      const n = tag === 'L1' ? 6 : perShip / 2;
      for (let i = 0; i < n; i++) {
        const th = (i / n) * Math.PI * 2;
        const el = [-0.5, 0.15, 0.6][i % 3];
        const side = Math.abs(ax.y) < 0.9 ? new THREE.Vector3().crossVectors(ax, UP).normalize() : new THREE.Vector3(1, 0, 0);
        const up2 = new THREE.Vector3().crossVectors(side, ax).normalize();
        const dir = side.clone().multiplyScalar(Math.cos(th)).addScaledVector(up2, Math.sin(th)).addScaledVector(ax, el * 1.4).normalize();
        const pos = c.clone().addScaledVector(dir, R * d + 0.8);
        const tgt = c.clone().addScaledVector(ax, (i % 2 ? 0.3 : -0.3) * R);
        views.push({ name: `${s.type}:${s.name || ''}#${tag}${views.length}`, area: `ship-${s.type}`, pos: pos.toArray(), target: tgt.toArray() });
      }
    }
  }
  return views;
}

/** Interior: cameras inside every zone's containment volumes looking along the six axes and at each portal. */
export function interiorViews(app, { zones = null, perVolume = 3 } = {}) {
  const I = app.station.interior, views = [];
  if (!I?.zones) return views;
  const w = (z, p) => z.frame === 'ring' ? I.toWorldFromRing(p, new THREE.Vector3()) : p.clone();
  for (const z of I.zones) {
    if (zones && !zones.some((n) => z.id.toLowerCase().startsWith(n))) continue;
    let vi = 0;
    for (const v of z.volumes) {
      if (v.passage) continue;
      const pts = [], axes = [];
      if (v.type === 'cyl') {
        const d = v.b.clone().sub(v.a), L = d.length(); d.normalize();
        const s = Math.abs(d.y) < 0.9 ? new THREE.Vector3().crossVectors(d, UP).normalize() : new THREE.Vector3(1, 0, 0);
        const u = new THREE.Vector3().crossVectors(s, d);
        const n = L > 3 ? perVolume : 1;
        for (let i = 0; i < n; i++) pts.push(v.a.clone().addScaledVector(d, L * (n === 1 ? 0.5 : 0.12 + 0.76 * i / (n - 1))).addScaledVector(s, (i % 2 ? 0.25 : -0.25) * v.r));
        axes.push(d, d.clone().negate(), s, s.clone().negate(), u, u.clone().negate());
      } else if (v.type === 'box') {
        const ex = new THREE.Vector3(1, 0, 0).applyQuaternion(v.quat), ey = new THREE.Vector3(0, 1, 0).applyQuaternion(v.quat), ez = new THREE.Vector3(0, 0, 1).applyQuaternion(v.quat);
        const big = [[ex, v.half.x], [ey, v.half.y], [ez, v.half.z]].sort((a, b) => b[1] - a[1])[0];
        const n = big[1] > 1.5 ? perVolume : 1;
        for (let i = 0; i < n; i++) pts.push(v.center.clone().addScaledVector(big[0], n === 1 ? 0 : big[1] * (-0.75 + 1.5 * i / (n - 1))));
        axes.push(ex, ex.clone().negate(), ey, ey.clone().negate(), ez, ez.clone().negate());
      } else if (v.type === 'polar') {
        const pc = (v.p0 + v.p1) / 2, rc = v.r0 + (v.r1 - v.r0) * 0.45;
        const n = (v.p1 - v.p0) * rc > 3 ? perVolume : 1;
        for (let i = 0; i < n; i++) { const p = n === 1 ? pc : v.p0 + (v.p1 - v.p0) * (0.15 + 0.7 * i / (n - 1)); pts.push(new THREE.Vector3((v.x0 + v.x1) / 2, rc * Math.cos(p), rc * Math.sin(p))); }
        axes.push(new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), null, null, 'out', 'in');
      }
      for (const p of pts) {
        const wp = w(z, p);
        const dirs = [];
        for (const a of axes) {
          if (a === null) continue;
          if (a === 'out' || a === 'in') { const r = new THREE.Vector3(0, p.y, p.z).normalize(); const dl = a === 'out' ? r : r.negate(); dirs.push(w(z, p.clone().add(dl)).sub(wp).normalize()); continue; }
          dirs.push(z.frame === 'ring' ? w(z, p.clone().add(a)).sub(wp).normalize() : a.clone());
        }
        if (v.type === 'polar') {   // tangential both ways
          const t = new THREE.Vector3(0, -p.z, p.y).normalize();
          dirs.push(w(z, p.clone().add(t)).sub(wp).normalize(), w(z, p.clone().sub(t)).sub(wp).normalize());
        }
        const zUp = z.frame === 'ring' ? w(z, p.clone().addScaledVector(new THREE.Vector3(0, p.y, p.z).normalize(), -1)).sub(wp).normalize() : UP;
        for (const d of dirs) {
          const upv = Math.abs(d.dot(zUp)) > 0.95 ? (Math.abs(d.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1)) : zUp;
          views.push({ name: `${z.id}#v${vi}`, area: z.id, pos: wp.toArray(), target: wp.clone().add(d).toArray(), up: upv.toArray(), interior: true });
          vi++;
        }
      }
    }
    for (const pt of z.portals || []) {
      const c = (pt.frame || z.frame) === 'ring' ? I.toWorldFromRing(pt.center, new THREE.Vector3()) : pt.center.clone();
      // stand 1.4 m inside this zone from the portal centre (toward the zone's first volume centre)
      const v0 = z.volumes.find((q) => !q.passage);
      if (!v0) continue;
      const vc = v0.type === 'cyl' ? v0.a.clone().lerp(v0.b, 0.5) : v0.type === 'box' ? v0.center.clone() : new THREE.Vector3((v0.x0 + v0.x1) / 2, (v0.r0 + v0.r1) / 2 * Math.cos((v0.p0 + v0.p1) / 2), (v0.r0 + v0.r1) / 2 * Math.sin((v0.p0 + v0.p1) / 2));
      const wc = w(z, vc);
      const dir = c.clone().sub(wc); const L = dir.length(); if (L < 0.5) continue; dir.normalize();
      const pos = c.clone().addScaledVector(dir, -Math.min(1.6, L * 0.7));
      if (I.locate(pos, null, 0) !== z) continue;
      views.push({ name: `${z.id}#portal-${pt.zone?.id || pt.to}`, area: z.id, pos: pos.toArray(), target: c.toArray(), interior: true });
    }
  }
  return views;
}
