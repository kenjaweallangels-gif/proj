import * as THREE from 'three';
import { DecalAtlas } from './Decals.js';

/**
 * Shared textures and materials of the astronaut models (one instance per App: `SuitAssets.get(ctx)`).
 *
 * Tiling PBR sets (baked by tools/prepare_suit_textures.py into public/textures/suit/): albedo (sRGB),
 * OpenGL normal map, ORM (R = AO, G = roughness, B = metalness). Model UVs are in metres; each material
 * scales them to its texture tile. Vertex colours tint the (near-white) albedo: stripes, coloured cloth,
 * grime and baked cavity darkening are all vertex colours, so a whole outfit needs few materials:
 *
 *   suit:  fabric (outer layer), seam (stitched tapes), rubber (grip pads, soles), metal (anodised rings,
 *          bearings, buckles; vertex colour = anodising tint), hard (painted shells, plastic housings),
 *          visor (clear polycarbonate), gold (sun filter), decal (atlas: flags, patches, labels, panel faces),
 *          glow (lamp lenses / LEDs), helmetIn (helmet liner seen from inside, first person only)
 *   crew:  skin (wrap-lit "subsurface" diffuse), hair, knit (polo), twill (trousers), rib (socks, cuffs),
 *          plus metal / hard / decal / glow
 * 'lite' (CPU rasteriser) gets Lambert materials with the albedo only (512 px) and the same vertex colours.
 */

const SETS = {
  fabric: { tile: 0.16, big: true },
  seam: { tile: 0.06 },
  rubber: { tile: 0.05, big: true },
  metal: { tile: 0.12 },
  visor: { tile: 0.3 },
  knit: { tile: 0.12, big: true },
  twill: { tile: 0.14, big: true },
  rib: { tile: 0.05 },
  skin: { tile: 0.075, big: true },
  hair: { tile: 0.06 },
};

let _instance = null;

export class SuitAssets {
  static get(ctx) {
    if (!_instance || _instance.ctx !== ctx) _instance = new SuitAssets(ctx);
    return _instance;
  }

  constructor(ctx) {
    this.ctx = ctx;
    const q = ctx.quality || {};
    this.lite = !!q.lite;
    this.tier = this.lite ? 'lite' : (q.textureScale || 1) >= 2 ? 'high' : 'mid';
    this.anisotropy = Math.min(this.lite ? 1 : 8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() || 1);
    this.loader = new THREE.TextureLoader();
    this.pending = [];
    this.tex = {};
    this.atlas = new DecalAtlas(this.lite ? 1024 : this.tier === 'high' ? 4096 : 2048);
    this.atlasTex = this.atlas.texture(this.anisotropy);
    this.mats = {};
    this._interior = new Map();
  }

  _url(name, kind) {
    const s = SETS[name];
    let suffix = '';
    if (this.tier === 'mid' && s.big && name !== 'rubber') suffix = '_1024';
    if (this.tier === 'lite' && s.big) suffix = '_512';
    const ext = kind === 'normal' ? 'png' : 'jpg';
    const path = `textures/suit/${name}_${kind}${suffix}.${ext}`;
    return this.ctx.assetUrl ? this.ctx.assetUrl(path) : `/${path}`;
  }

  /** Tiling texture of a set (cached). kind: albedo | normal | orm */
  t(name, kind) {
    const key = `${name}:${kind}`;
    if (this.tex[key]) return this.tex[key];
    let done;
    this.pending.push(new Promise((res) => { done = res; setTimeout(res, 30000); }));
    const tex = this.loader.load(this._url(name, kind), () => done(), undefined, () => { console.warn('[suit] texture failed', key); done(); });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = kind === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = this.anisotropy;
    const r = 1 / SETS[name].tile;
    tex.repeat.set(r, r);
    tex.name = `suit:${key}`;
    this.tex[key] = tex;
    return tex;
  }

  /** Texture of the MakeHuman crew body (public/models/crew/<name>[_size].<ext>); size: the file's full size. */
  _mh(name, ext, color, full = 2048) {
    const key = `mh:${name}`;
    if (this.tex[key]) return this.tex[key];
    const size = this.lite ? (full > 1024 ? 1024 : full === 1024 ? 512 : full) : this.tier === 'high' ? full : Math.min(full, 1024);
    const file = size >= full ? `${name}.${ext}` : `${name}_${size}.${ext}`;
    let done;
    this.pending.push(new Promise((res) => { done = res; setTimeout(res, 30000); }));
    const url = this.ctx.assetUrl ? this.ctx.assetUrl(`models/crew/${file}`) : `/models/crew/${file}`;
    const tex = this.loader.load(url, () => done(), undefined, () => { console.warn('[suit] texture failed', file); done(); });
    tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = this.anisotropy;
    tex.name = `suit:${key}`;
    this.tex[key] = tex;
    return tex;
  }

  /** Resolves when every requested texture has loaded (App awaits Player.load before compiling shaders). */
  async ready() { await Promise.all(this.pending); }

  // ------------------------------------------------------------------------------------------ materials
  /** Material by key (shared). */
  get(key) {
    if (!this.mats[key]) { const m = this._make(key); m.name = `suit:${key}`; this.mats[key] = m; }
    return this.mats[key];
  }

  /** All materials for a list of keys as an object. */
  set(keys) { const o = {}; for (const k of keys) o[k] = this.get(k); return o; }

  _pbr(name, o = {}) {
    if (this.lite) return new THREE.MeshLambertMaterial({ map: this.t(name, 'albedo'), vertexColors: true, ...pickLambert(o) });
    const orm = this.t(name, 'orm');
    const P = o.physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const m = new P({
      map: this.t(name, 'albedo'), normalMap: this.t(name, 'normal'), roughnessMap: orm, aoMap: orm, metalnessMap: o.metalness > 0 ? orm : null,
      vertexColors: true, roughness: 1, metalness: o.metalness ?? 0, aoMapIntensity: o.ao ?? 1,
      normalScale: new THREE.Vector2(o.normal ?? 1, o.normal ?? 1),
    });
    if (o.physical) Object.assign(m, o.physical);
    return m;
  }

  _make(key) {
    const lite = this.lite;
    const high = this.tier === 'high';
    switch (key) {
      case 'fabric': return this._pbr('fabric', { normal: 1.0, physical: high ? { sheen: 0.35, sheenRoughness: 0.75, sheenColor: new THREE.Color(1, 1, 1) } : null });
      case 'seam': return this._pbr('seam', { normal: 1.2 });
      case 'rubber': return this._pbr('rubber', { normal: 0.8 });
      case 'metal': return lite ? new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xb8bcc2 })
        : this._pbr('metal', { metalness: 1, normal: 0.35, physical: high ? { clearcoat: 0.25, clearcoatRoughness: 0.2 } : null });
      case 'hard': return lite ? new THREE.MeshLambertMaterial({ vertexColors: true })
        : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.0, normalMap: this.t('visor', 'normal'), normalScale: new THREE.Vector2(0.25, 0.25), roughnessMap: null });
      case 'visor': {
        if (lite) return new THREE.MeshLambertMaterial({ color: 0x9fb4c4, transparent: true, opacity: 0.18, depthWrite: false });
        const m = new THREE.MeshPhysicalMaterial({ color: 0xc8d6e0, metalness: 0, roughness: 1, roughnessMap: this.t('visor', 'orm'), transparent: true, opacity: 0.16,
          clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8, depthWrite: false, specularIntensity: 1 });
        return m;
      }
      case 'gold': return lite ? new THREE.MeshLambertMaterial({ color: 0x9a7020 })
        : new THREE.MeshPhysicalMaterial({ color: 0xf2c25a, metalness: 1, roughness: 1, roughnessMap: this.t('visor', 'orm'), envMapIntensity: 1.6, clearcoat: high ? 1 : 0, clearcoatRoughness: 0.03 });
      case 'decal': {
        const o = { map: this.atlasTex, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
        return lite ? new THREE.MeshLambertMaterial(o) : new THREE.MeshStandardMaterial({ ...o, roughness: 0.68, metalness: 0.0 });
      }
      case 'glow': return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
      case 'helmetIn': return new THREE.MeshBasicMaterial({ color: 0x15171a, side: THREE.BackSide });
      case 'skin': {
        if (lite) return new THREE.MeshLambertMaterial({ map: this.t('skin', 'albedo'), vertexColors: true });
        const orm = this.t('skin', 'orm');
        const m = new THREE.MeshPhysicalMaterial({ map: this.t('skin', 'albedo'), normalMap: this.t('skin', 'normal'), normalScale: new THREE.Vector2(0.55, 0.55),
          roughnessMap: orm, aoMap: orm, aoMapIntensity: 0.6, roughness: 1.0, metalness: 0, vertexColors: true,
          sheen: high ? 0.25 : 0, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.9, 0.75, 0.7), specularIntensity: 0.55 });
        patchSkin(m);
        return m;
      }
      case 'hair': return this._pbr('hair', { normal: 1.0, physical: high ? { sheen: 0.5, sheenRoughness: 0.35, sheenColor: new THREE.Color(0.35, 0.28, 0.2) } : null });
      case 'knit': return this._pbr('knit', { normal: 1.0, physical: high ? { sheen: 0.4, sheenRoughness: 0.8, sheenColor: new THREE.Color(0.6, 0.65, 0.8) } : null });
      case 'twill': return this._pbr('twill', { normal: 1.0 });
      case 'rib': return this._pbr('rib', { normal: 1.0, physical: high ? { sheen: 0.4, sheenRoughness: 0.8, sheenColor: new THREE.Color(0.7, 0.7, 0.7) } : null });
      case 'eye': return lite ? new THREE.MeshLambertMaterial({ vertexColors: true })
        : new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.02, metalness: 0 });
      // MakeHuman-based crew body (public/models/crew, see CrewMH.js)
      case 'mhSkin': {
        const orm = this._mh('skin_orm', 'jpg', false);
        if (lite) return new THREE.MeshLambertMaterial({ map: this._mh('skin_albedo', 'jpg', true) });
        const m = new THREE.MeshPhysicalMaterial({ map: this._mh('skin_albedo', 'jpg', true), normalMap: this._mh('skin_normal', 'png', false), normalScale: new THREE.Vector2(0.6, 0.6),
          roughnessMap: orm, roughness: 1, metalness: 0, sheen: high ? 0.2 : 0, sheenRoughness: 0.5, sheenColor: new THREE.Color(0.9, 0.75, 0.7), specularIntensity: 0.5 });
        patchSkin(m);
        return m;
      }
      case 'mhClothes': {
        if (lite) return new THREE.MeshLambertMaterial({ map: this._mh('clothes_albedo', 'jpg', true) });
        const orm = this._mh('clothes_orm', 'jpg', false);
        return new (high ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({ map: this._mh('clothes_albedo', 'jpg', true), normalMap: this._mh('clothes_normal', 'png', false),
          aoMap: orm, roughnessMap: orm, roughness: 1, metalness: 0, ...(high ? { sheen: 0.3, sheenRoughness: 0.8, sheenColor: new THREE.Color(0.55, 0.6, 0.75) } : {}) });
      }
      case 'mhShoes': return lite ? new THREE.MeshLambertMaterial({ map: this._mh('shoes_albedo', 'png', true, 1024) })
        : new THREE.MeshStandardMaterial({ map: this._mh('shoes_albedo', 'png', true, 1024), roughness: 0.75, metalness: 0 });
      case 'mhHair': {
        const o = { map: this._mh('hair_albedo', 'png', true, 1024), alphaTest: 0.45, side: THREE.DoubleSide };
        if (lite) return new THREE.MeshLambertMaterial(o);
        return new THREE.MeshStandardMaterial({ ...o, normalMap: this._mh('hair_normal', 'png', false, 1024), roughness: 0.55, metalness: 0, alphaToCoverage: true });
      }
      case 'mhBrows': case 'mhLashes': {
        const o = { map: this._mh(key === 'mhBrows' ? 'brows' : 'lashes', 'png', true, 512), alphaTest: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 };
        return lite ? new THREE.MeshLambertMaterial(o) : new THREE.MeshStandardMaterial({ ...o, roughness: 0.7, alphaToCoverage: true });
      }
      case 'mhEyes': return lite ? new THREE.MeshLambertMaterial({ map: this._mh('eye', 'jpg', true, 1024) })
        : new THREE.MeshPhysicalMaterial({ map: this._mh('eye', 'jpg', true, 1024), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, metalness: 0 });
      case 'mhLod2': return lite ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
      default: throw new Error(`SuitAssets: unknown material ${key}`);
    }
  }

  /**
   * Interior variant of a material set (suits on the airlock mounts): clones patched with the interior
   * lighting of a compartment (`patch(mat)` from the interior material set; null on 'lite').
   */
  interiorSet(keys, patch, tag) {
    const o = {};
    for (const k of keys) {
      const id = `${tag}:${k}`;
      if (!this._interior.has(id)) {
        const base = this.get(k);
        const m = base.clone();
        m.name = `suit:${k}:int`;
        if (patch && !(m.isMeshBasicMaterial)) patch(m);
        m.userData.interior = true;
        this._interior.set(id, m);
      }
      o[k] = this._interior.get(id);
    }
    return o;
  }
}

function pickLambert(o) { const r = {}; if (o.color) r.color = o.color; return r; }

/**
 * Skin: wrapped diffuse with a wider wrap in red (light scattered under the skin reaches past the
 * terminator, shadows edges turn warm) — a cheap stand-in for subsurface scattering.
 */
export function patchSkin(mat) {
  mat.onBeforeCompile = (sh) => {
    // the diffuse term of RE_Direct_Physical, in a locally modified copy of the chunk
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
      'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );',
      `{
        float ndlS = dot( geometryNormal, directLight.direction );
        vec3 wrapS = clamp( ( vec3( ndlS ) + vec3( 0.42, 0.22, 0.16 ) ) / vec3( 1.42, 1.22, 1.16 ), 0.0, 1.0 );
        wrapS *= wrapS * ( 3.0 - 2.0 * wrapS ) * 0.35 + wrapS * 0.65;
        reflectedLight.directDiffuse += wrapS * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
      }`));
  };
  mat.customProgramCacheKey = () => 'skinWrap1';
}
