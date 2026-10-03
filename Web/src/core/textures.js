// Библиотека фотограмметрических текстур (CC0), встроенных в сборку как data URI.
// getTex(name) → { map, normalMap, roughnessMap, aoMap, meters } | null   (null — текстуры нет, используйте процедурный фолбэк)
// Имена (контракт): sand, sand_ripples, rock_desert, rock_cliff, rock_cave, cave_floor, plaster_rough,
//   fabric_woven, fabric_rough, leather, metal_rusty, metal_painted, rubber, stone_polished
// meters — сколько метров покрывает один тайл (для масштаба UV / triplanar).
import * as THREE from 'three';
import LIB from '../assets/textures.js';

const loader = new THREE.TextureLoader();
const cache = new Map();

function load(uri, srgb) {
  const t = loader.load(uri);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function getTex(name) {
  if (cache.has(name)) return cache.get(name);
  const e = LIB[name];
  const out = e ? {
    map: e.map ? load(e.map, true) : null,
    normalMap: e.normal ? load(e.normal, false) : null,
    roughnessMap: e.rough ? load(e.rough, false) : null,
    aoMap: e.ao ? load(e.ao, false) : null,
    meters: e.meters || 2,
    source: e.source || '',
  } : null;
  cache.set(name, out);
  return out;
}

export function hasTex(name) { return !!LIB[name]; }
export const TEXTURE_NAMES = Object.keys(LIB);
