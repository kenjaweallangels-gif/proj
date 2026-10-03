// Детали и крепёж: геометрия из GLB по имени узла (parts[].node) или заглушка из parts[].fallback.
// Для каждой детали две копии: «реальная» (слой 0, лежит в таре или установлена) и голограмма (слой 1).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HOLO, LAYER_HOLO, holoMaterial, setLayer, toHologram } from '../engine/holo.js';
import { bevelIfBox, partMaterial } from './materials.js';

function fallbackMesh(fb) {
  const [sx, sy, sz] = fb.size;
  const g = fb.type === 'cylinder' ? new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 32) : new THREE.BoxGeometry(sx, sy, sz);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: fb.color, roughness: 0.55, metalness: 0.25 }));
  m.castShadow = m.receiveShadow = true;
  return m;
}

async function loadModels(P, onWarn) {
  const loader = new GLTFLoader();
  const out = new Map();
  await Promise.all(P.models.map(async (m) => {
    try {
      const g = await loader.loadAsync(m.url);
      g.scene.updateMatrixWorld(true);
      out.set(m.id, g.scene);
    } catch (e) {
      onWarn(`Модель ${m.url} не загрузилась — детали показаны заглушками (${e.message ?? e})`);
    }
  }));
  return out;
}

function fromModel(models, p) {
  const sc = models.get(p.model);
  if (!sc || !p.node) return null;
  const node = sc.getObjectByName(p.node) || sc.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(p.node));
  if (!node) return null;
  const c = node.clone(true);
  node.matrixWorld.decompose(c.position, c.quaternion, c.scale);     // поза узла в СК модели = СК операции
  c.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  return c;
}

export async function buildParts(scene, P, { onWarn = console.warn } = {}) {
  const models = await loadModels(P, onWarn);
  const real = new Map(), holo = new Map(), target = new Map(), src = new Map(), fromGlb = new Set();
  const group = new THREE.Group(); group.name = 'parts'; scene.add(group);
  for (const p of P.parts.values()) {
    let r = fromModel(models, p);
    if (r) fromGlb.add(p.id);
    else {
      r = fallbackMesh(p.fallback);
      r.position.set(...p.pos);
      r.quaternion.set(...p.rot);
      if (p.node) onWarn(`Деталь ${p.id}: узла «${p.node}» нет в GLB — заглушка`);
    }
    r.name = `R_${p.id}`;
    const T = { position: r.position.clone(), quaternion: r.quaternion.clone() };
    // голограмма — из исходной геометрии (острые рёбра дают чистый контур); clone() делит материалы — toHologram их заменит
    const h = toHologram(r.clone(true));
    h.name = `H_${p.id}`;
    // реальная деталь: физический материал по имени материала CAD / наименованию и скруглённые рёбра
    r.traverse((o) => {
      if (!o.isMesh) return;
      const cad = Array.isArray(o.material) ? o.material[0]?.name : o.material?.name;
      o.material = partMaterial(p, cad);
      bevelIfBox(o, 1.5);
      o.castShadow = o.receiveShadow = true;
    });
    target.set(p.id, T);
    src.set(p.id, p.src ? new THREE.Vector3(...p.src) : T.position.clone().add(new THREE.Vector3(0, 0.25, 0)));
    group.add(r, h);
    real.set(p.id, r);
    holo.set(p.id, h);
  }
  // крепёж — только голограммы (реальный крепёж мелкий, в демо не нужен)
  const fast = new Map();
  const fm = holoMaterial(HOLO.fastener, 0.85);
  const ring = holoMaterial(HOLO.fastener, 0.5);
  for (const f of P.fasteners.values()) {
    const g = new THREE.Group();
    const axis = new THREE.Vector3(...f.axis).normalize();
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    g.position.set(...f.pos);
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 12), fm);
    pin.position.y = 0.017;
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0016, 6, 24), ring);
    r.rotation.x = Math.PI / 2;
    g.add(pin, r);
    setLayer(g, LAYER_HOLO);
    g.visible = false;
    group.add(g);
    fast.set(f.id, g);
  }
  return { real, holo, target, src, fast, fromGlb, group };
}
