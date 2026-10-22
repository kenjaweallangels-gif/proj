import * as THREE from 'three';

/**
 * Shared PBR material library. Modules call `materials.get(name)`; materials are created lazily
 * and shared (do not mutate a shared material; clone it if you need per-object changes).
 */
export class Materials {
  constructor(textures) {
    this.textures = textures;
    this.cache = new Map();
    this.factories = {
      hullWhite: () => {
        const t = this.textures.hullPanels({ base: '#eef0f2', seam: '#9ba1a8', grime: 0.16 });
        return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.62, metalness: 0.08, color: 0xffffff });
      },
      hullWhiteAged: () => {
        const t = this.textures.hullPanels({ base: '#e2e4e4', seam: '#8a9096', grime: 0.3, seed: 4, aged: 0.6 });
        return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.7, metalness: 0.06 });
      },
      hullGray: () => {
        const t = this.textures.hullPanels({ base: '#b9bec4', seam: '#6f757c', grime: 0.22, seed: 9, cells: 5 });
        return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.6, metalness: 0.2 });
      },
      mliGold: () => {
        const t = this.textures.mli({ seed: 11 });
        return new THREE.MeshPhysicalMaterial({ color: 0xd9a63a, metalness: 1.0, roughness: 0.38, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.0, 1.0), clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 1.2 });
      },
      mliSilver: () => {
        const t = this.textures.mli({ seed: 23, scale: 12 });
        return new THREE.MeshPhysicalMaterial({ color: 0xcfd3d8, metalness: 1.0, roughness: 0.32, roughnessMap: t.roughnessMap, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.0, 1.0), clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: 1.2 });
      },
      mliBlack: () => {
        const t = this.textures.mli({ seed: 31, scale: 10 });
        return new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.6, roughness: 0.55, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.8, 0.8) });
      },
      truss: () => new THREE.MeshStandardMaterial({ color: 0xe8e8e6, roughness: 0.55, metalness: 0.35, map: this.textures.hullPanels({ base: '#e8e8e6', seam: '#b4b4b0', grime: 0.25, cells: 12, rivets: false, seed: 17 }).map }),
      metalBare: () => new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.42, metalness: 0.95, roughnessMap: this.textures.noise({ scale: 8, seed: 5 }) }),
      metalDark: () => new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.85 }),
      metalTitanium: () => new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.45, metalness: 0.9 }),
      solarCell: () => {
        const t = this.textures.solarCells();
        return new THREE.MeshPhysicalMaterial({ map: t.map, roughnessMap: t.roughnessMap, roughness: 0.35, metalness: 0.55, color: 0xffffff, clearcoat: 0.8, clearcoatRoughness: 0.15, envMapIntensity: 1.4, side: THREE.FrontSide });
      },
      solarBack: () => new THREE.MeshStandardMaterial({ color: 0xc7c2b5, roughness: 0.85, metalness: 0.1, map: this.textures.hullPanels({ base: '#cdc8bb', seam: '#8f8a7f', grime: 0.2, cells: 10, rivets: false, seed: 21 }).map }),
      radiator: () => { const t = this.textures.radiator(); return new THREE.MeshStandardMaterial({ map: t.map, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide }); },
      glass: () => new THREE.MeshPhysicalMaterial({ color: 0x9fb8cc, metalness: 0.0, roughness: 0.05, transmission: 0.0, transparent: true, opacity: 0.35, envMapIntensity: 1.5, reflectivity: 0.9, clearcoat: 1.0, clearcoatRoughness: 0.02, side: THREE.DoubleSide, depthWrite: false }),
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
      antennaWhite: () => new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.5, metalness: 0.2 }),
      hazard: () => new THREE.MeshStandardMaterial({ map: this.textures.stripes(), roughness: 0.6, metalness: 0.1 }),
      suitWhite: () => { const t = this.textures.hullPanels({ base: '#f2f2ee', seam: '#d8d8d2', grime: 0.12, cells: 3, rivets: false, seed: 41 }); return new THREE.MeshStandardMaterial({ map: t.map, roughness: 0.85, metalness: 0.0, normalMap: this.textures.mli({ seed: 51, scale: 20, strength: 1.2 }).normalMap, normalScale: new THREE.Vector2(0.5, 0.5) }); },
      dockRing: () => new THREE.MeshStandardMaterial({ color: 0x9a9ea3, roughness: 0.4, metalness: 0.9, map: this.textures.hullPanels({ base: '#a8acb1', seam: '#50545a', grime: 0.3, cells: 16, rivets: false, seed: 61 }).map }),
      cable: () => new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.8, metalness: 0.1 }),
      copper: () => new THREE.MeshStandardMaterial({ color: 0xb87333, roughness: 0.35, metalness: 1.0 }),
    };
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
