import * as THREE from 'three';

/**
 * Optically clear thin glass (GPU presets). The pane adds only its specular reflection (environment + lights,
 * Schlick Fresnel: ~4 % head-on, rising toward grazing angles) and attenuates what lies behind by `absorb`
 * (+ the Fresnel reflectance): blending ONE / ONE_MINUS_SRC_ALPHA with a black diffuse term, so there is no grey
 * haze over the Earth. A faint scratch / dust roughness map widens the Sun's highlight only where it hits.
 * `tint` is a very dark diffuse colour (edge-on greenish cast of thick glass).
 */
export function clearGlass({ roughnessMap = null, absorb = 0.035, tint = 0x0b1310, envMap = null, envMapIntensity = 1.0, name = 'glass' } = {}) {
  const m = new THREE.MeshStandardMaterial({ name, color: tint, metalness: 0.0, roughness: roughnessMap ? 1.0 : 0.035, roughnessMap, envMap, envMapIntensity, transparent: true, opacity: absorb, side: THREE.DoubleSide, depthWrite: false });
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
	{ float gNv = clamp( abs( dot( normalize( vViewPosition ), normal ) ), 0.0, 1.0 );
	  float gF = pow( 1.0 - gNv, 5.0 );
	  gl_FragColor.a = clamp( opacity + ( 1.0 - opacity ) * gF * 0.9, 0.0, 1.0 ); }`);
  };
  m.customProgramCacheKey = () => 'clearGlass1';
  m.userData.glass = true;
  return m;
}

/**
 * Shared PBR material library. Modules call `materials.get(name)`; materials are created lazily
 * and shared (do not mutate a shared material; clone it if you need per-object changes).
 */
export class Materials {
  constructor(textures) {
    this.textures = textures;
    this.lite = false;   // set by the Station before anything is built ('lite' preset: cheaper variants)
    this.cache = new Map();
    this.factories = {
      // painted hull panels: baked 4K/2K PBR sets (scanned micro detail + procedural layout, ~0.73 albedo white
      // paint, wear, grime); procedural canvas maps on 'lite' or when the baked set is not available
      hullWhite: () => this._pbr('hull_white', 1, { metalness: 1, envMapIntensity: 1.0 }) || (() => {
        const t = this.textures.hullPanels({ base: '#eef0f2', seam: '#9ba1a8', grime: 0.16 });
        return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.62, metalness: 0.08, color: 0xffffff });
      })(),
      hullWhiteAged: () => this._pbr('hull_aged', 1, { metalness: 1 }) || (() => {
        const t = this.textures.hullPanels({ base: '#e2e4e4', seam: '#8a9096', grime: 0.3, seed: 4, aged: 0.6 });
        return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.7, metalness: 0.06 });
      })(),
      hullGray: () => this._pbr('hull_gray', 1, { metalness: 1 }) || (() => {
        const t = this.textures.hullPanels({ base: '#b9bec4', seam: '#6f757c', grime: 0.22, seed: 9, cells: 5 });
        return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.6, metalness: 0.2 });
      })(),
      // MLI blankets: scanned crinkled foil (ambientCG Foil002 / Foil001) with quilting; 1.6 m tiles
      mliGold: () => this._pbr('mli_gold', 4, { color: 0xc9953a, envMapIntensity: 1.15 }) || (() => {
        const t = this.textures.mli({ seed: 11 });
        return new THREE.MeshPhysicalMaterial({ color: 0xd9a63a, metalness: 1.0, roughness: 0.38, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.0, 1.0), clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 1.2 });
      })(),
      mliSilver: () => this._pbr('mli_silver', 4, { color: 0xc4c8cc, envMapIntensity: 1.15 }) || (() => {
        const t = this.textures.mli({ seed: 23, scale: 12 });
        return new THREE.MeshPhysicalMaterial({ color: 0xcfd3d8, metalness: 1.0, roughness: 0.32, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.0, 1.0), clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 1.2 });
      })(),
      // beta cloth (teflon-coated glass-fibre outer blanket layer): matte off-white weave
      betaCloth: () => this._pbr('beta_cloth', 4, {}) || new THREE.MeshStandardMaterial({ color: 0xcfcdc5, roughness: 0.85, metalness: 0.0 }),
      // bare brushed / machined aluminium (fittings, rings, brackets)
      metalBrushed: () => this._pbr('metal_brushed', 4, { color: 0xffffff }) || new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.95 }),
      metalMachined: () => this._pbr('metal_machined', 4, { color: 0xffffff }) || new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.4, metalness: 0.9 }),
      mliBlack: () => {
        const t = this.textures.mli({ seed: 31, scale: 10 });
        return new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.6, roughness: 0.55, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8) });
      },
      // white paint never exceeds ~0.75 linear albedo (sRGB ~0xe0)
      truss: () => this._pbr('hull_white', 2, { color: 0xf2f2ee }) || new THREE.MeshStandardMaterial({ color: 0xe0e0dc, roughness: 0.55, metalness: 0.35, map: this.textures.hullPanels({ base: '#e8e8e6', seam: '#b4b4b0', grime: 0.25, cells: 12, rivets: false, seed: 17 }).map }),
      metalBare: () => this._pbr('metal_brushed', 4, { color: 0xf2f4f6 }) || new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.42, metalness: 0.95, roughnessMap: this.textures.noise({ scale: 8, seed: 5 }) }),
      metalDark: () => new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.85 }),
      metalTitanium: () => new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.45, metalness: 0.9 }),
      solarCell: () => {
        const t = this.textures.solarCells();
        return new THREE.MeshPhysicalMaterial({ map: t.map, roughnessMap: t.roughnessMap, roughness: 0.35, metalness: 0.55, color: 0xffffff, clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 1.4, side: THREE.FrontSide });
      },
      solarBack: () => new THREE.MeshStandardMaterial({ color: 0xc7c2b5, roughness: 0.85, metalness: 0.1, map: this.textures.hullPanels({ base: '#cdc8bb', seam: '#8f8a7f', grime: 0.2, cells: 10, rivets: false, seed: 21 }).map }),
      radiator: () => { const t = this.textures.radiator(); return new THREE.MeshStandardMaterial({ map: t.map, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide }); },
      // optically clear window pane: reflection only (Fresnel), background attenuated a few per cent (see clearGlass)
      glass: () => this.lite
        ? new THREE.MeshStandardMaterial({ color: 0x9fb8cc, metalness: 0.0, roughness: 0.05, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
        : clearGlass({ roughnessMap: this.textures.glassScratches(), absorb: 0.025, tint: 0x0b1310 }),
      visorGold: () => new THREE.MeshPhysicalMaterial({ color: 0xe0b040, metalness: 1.0, roughness: 0.04, envMapIntensity: 2.0, clearcoat: 1.0, transparent: true, opacity: 0.85 }),
      windowGlow: () => new THREE.MeshStandardMaterial({ color: 0x202428, emissive: 0xffd9a0, emissiveIntensity: 2.5, roughness: 0.3, metalness: 0.0 }),
      navRed: () => new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2010, emissiveIntensity: 6, roughness: 0.4 }),
      navGreen: () => new THREE.MeshStandardMaterial({ color: 0x003000, emissive: 0x20ff40, emissiveIntensity: 6, roughness: 0.4 }),
      navWhite: () => new THREE.MeshStandardMaterial({ color: 0x303030, emissive: 0xffffff, emissiveIntensity: 8, roughness: 0.4 }),
      floodLight: () => new THREE.MeshStandardMaterial({ color: 0x404040, emissive: 0xfff2dc, emissiveIntensity: 12, roughness: 0.3 }),
      nozzle: () => new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.6, metalness: 0.9, map: this.textures.hullPanels({ base: '#5a5148', seam: '#2a2622', grime: 0.5, cells: 3, rivets: false, seed: 33 }).map }),
      nozzleHot: () => new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0xff5a1a, emissiveIntensity: 0.0, roughness: 0.6, metalness: 0.8 }),
      rubberBlack: () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9, metalness: 0.0 }),
      paintOrange: () => new THREE.MeshStandardMaterial({ color: 0xe8661b, roughness: 0.6, metalness: 0.1 }),
      paintGray: () => new THREE.MeshStandardMaterial({ color: 0x7c8187, roughness: 0.65, metalness: 0.2 }),
      paintBlue: () => new THREE.MeshStandardMaterial({ color: 0x1f3f7a, roughness: 0.55, metalness: 0.15 }),
      paintYellow: () => new THREE.MeshStandardMaterial({ color: 0xe0b418, roughness: 0.55, metalness: 0.2 }),
      antennaWhite: () => new THREE.MeshStandardMaterial({ color: 0xe0e0dc, roughness: 0.5, metalness: 0.15 }),
      hazard: () => new THREE.MeshStandardMaterial({ map: this.textures.stripes(), roughness: 0.6, metalness: 0.1 }),
      suitWhite: () => { const t = this.textures.hullPanels({ base: '#f2f2ee', seam: '#d8d8d2', grime: 0.12, cells: 3, rivets: false, seed: 41 }); return new THREE.MeshStandardMaterial({ map: t.map, roughness: 0.85, metalness: 0.0, normalMap: this.textures.mli({ seed: 51, scale: 20, strength: 1.2 }).normalMap, normalScale: new THREE.Vector2(0.5, 0.5) }); },
      dockRing: () => new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.4, metalness: 0.9, map: this.textures.hullPanels({ base: '#a8acb1', seam: '#50545a', grime: 0.3, cells: 16, rivets: false, seed: 61 }).map }),
      cable: () => new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.8, metalness: 0.1 }),
      copper: () => new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.35, metalness: 1.0 }),
    };
  }

  /** MeshStandardMaterial on a baked PBR set (Textures.pbr), or null ('lite' / no baked sets). */
  _pbr(set, repeat, opts = {}) {
    const t = this.lite ? null : this.textures.pbr?.(set, { repeat, ormHalf: set.startsWith('hull') });
    if (!t) return null;
    return new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.ormMap, metalnessMap: t.ormMap, aoMap: t.ormMap, aoMapIntensity: 0.8, roughness: 1, metalness: 1, color: 0xffffff, ...opts });
  }

  get(name) {
    if (!this.cache.has(name)) {
      const f = this.factories[name];
      if (!f) throw new Error(`Materials: unknown material "${name}"`);
      const m = f(); m.name = name; this.cache.set(name, m);
    }
    return this.cache.get(name);
  }

  /** Decal material with text (transparent, polygon-offset so it sits on hull surfaces). */
  label(text, opts = {}) {
    const key = `label:${text}:${JSON.stringify(opts)}`;
    if (!this.cache.has(key)) {
      const tex = this.textures.text(text, opts);
      this.cache.set(key, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false, side: THREE.DoubleSide }));
    }
    return this.cache.get(key);
  }

  /** Register an extra factory from a module. */
  register(name, factory) { this.factories[name] = factory; }
}
