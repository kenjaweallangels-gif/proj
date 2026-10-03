// Библиотека физических (PBR) материалов для фотореалистичного вида. Выбор материала детали — src/engine/material_rules.js.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { materialKeyFor } from '../engine/material_rules.js';
import { brushedSet, grimeMap, orangePeelSet, withRepeat } from './textures.js';

const lib = new Map();

function make(key) {
  switch (key) {
    case 'aluminium': return new THREE.MeshPhysicalMaterial({
      color: '#c9ccd0', metalness: 1, roughness: 0.42, ...withRepeat(brushedSet(), 2, 2),
    });
    case 'anodized': return new THREE.MeshPhysicalMaterial({
      color: '#4f5b66', metalness: 0.85, roughness: 0.5, ...withRepeat(brushedSet(), 6, 6), normalScale: new THREE.Vector2(0.25, 0.25),
      clearcoat: 0.3, clearcoatRoughness: 0.4,
    });
    case 'steel': return new THREE.MeshPhysicalMaterial({
      color: '#a9adb1', metalness: 1, roughness: 0.32, ...withRepeat(brushedSet(), 1, 4),
    });
    case 'chrome': return new THREE.MeshPhysicalMaterial({ color: '#e8eaec', metalness: 1, roughness: 0.08 });
    case 'plastic_black': return new THREE.MeshPhysicalMaterial({
      color: '#1d1f22', metalness: 0, roughness: 0.55, ...withRepeat(orangePeelSet(64, 1.2), 3, 3), clearcoat: 0.15, clearcoatRoughness: 0.6,
    });
    case 'composite_panel': return new THREE.MeshPhysicalMaterial({
      // интерьерная панель с плёнкой «под кожу»: светлая, тёплая, полуматовая
      color: '#e4e0d6', metalness: 0, roughness: 0.62, ...withRepeat(orangePeelSet(96, 1.4, 'leather'), 2, 2),
      sheen: 0.25, sheenRoughness: 0.8, sheenColor: new THREE.Color('#ffffff'),
    });
    case 'decor_panel': return new THREE.MeshPhysicalMaterial({
      color: '#ebe7de', metalness: 0, roughness: 0.7, ...withRepeat(orangePeelSet(128, 1.0, 'decor'), 2, 2),
    });
    case 'rubber': return new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.92, metalness: 0 });
    case 'painted':
    default: return new THREE.MeshPhysicalMaterial({
      color: '#7d8790', metalness: 0.1, roughness: 0.48, ...withRepeat(orangePeelSet(48, 1.6), 2, 2), clearcoat: 0.2, clearcoatRoughness: 0.35,
    });
  }
}

/** Общий экземпляр материала по ключу (см. MATERIAL_KEYS). */
export function material(key) {
  if (!lib.has(key)) lib.set(key, make(key));
  return lib.get(key);
}

/** Окрашенный металл / пластик заданного цвета (тара, тележки, оснастка). */
export function painted(color, { rough = 0.5, metal = 0.15, peel = 48, coat = 0.25 } = {}) {
  const key = `painted_${color}_${rough}_${metal}_${peel}_${coat}`;
  if (!lib.has(key)) {
    lib.set(key, new THREE.MeshPhysicalMaterial({
      color, roughness: rough, metalness: metal, ...withRepeat(orangePeelSet(peel, 1.5), 2, 2),
      clearcoat: coat, clearcoatRoughness: 0.4, map: grimeMap(),
    }));
  }
  return lib.get(key);
}

/** Материал детали операции: по имени материала CAD (если есть в GLB), наименованию, типу заглушки и цвету. */
export function partMaterial(p, cadMaterial) {
  const key = materialKeyFor({
    name: p.name, designation: p.designation, cadMaterial, fallbackType: p.fallback?.type, color: p.fallback?.color,
  });
  // светлые окрашенные детали сохраняют свой цвет из CAD
  if (key === 'painted' && p.fallback?.color) return painted(p.fallback.color);
  return material(key);
}

/**
 * Скруглить острые рёбра у коробок (у реальных деталей нет идеально острых граней — блик по фаске «продаёт» реализм).
 * Заменяет геометрию, если меш — прямоугольный параллелепипед (BoxGeometry или экспорт CAD из 24 вершин).
 */
export function bevelIfBox(mesh, radiusMm = 2) {
  const g = mesh.geometry;
  if (!g || !g.attributes.position) return false;
  // экспорт STEP → GLB кладёт простые тела как 8 вершин без нормалей (extras.shape = box) — их тоже скругляем
  const n = g.attributes.position.count;
  const isBox = g.type === 'BoxGeometry' || mesh.userData?.shape === 'box' || ((n === 8 || n === 24) && !g.morphAttributes?.position);
  if (!isBox) {
    if (!g.attributes.normal) g.computeVertexNormals();      // без нормалей освещение даёт NaN (чёрные пятна, «взрыв» bloom)
    return false;
  }
  g.computeBoundingBox();
  const s = g.boundingBox.getSize(new THREE.Vector3());
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  const r = Math.min(radiusMm * 0.001, Math.min(s.x, s.y, s.z) * 0.45);
  if (r < 0.0003) return false;
  const rb = new RoundedBoxGeometry(s.x, s.y, s.z, 3, r);
  rb.translate(c.x, c.y, c.z);
  mesh.geometry = rb;
  return true;
}
