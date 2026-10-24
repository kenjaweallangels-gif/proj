import * as THREE from 'three';
import { AstronautBody } from './Body.js';
import { ORLAN_MATERIALS } from './Orlan.js';
import { SuitAssets } from './Assets.js';

/**
 * Orlan suit standing on its airlock mount (equipment lock): full figure in the 'mount' pose with the
 * backpack door swung open (rear entry, as when donning). Lit like the rest of the compartment: GPU presets
 * clone the suit materials and apply the interior lighting patch of the zone's material set (interior
 * environment map, sun only through windows); 'lite' uses unlit textured materials (vertex colours carry
 * the shading like the other interior meshes).
 *
 * build({ ctx, variant, set (interior material set), patch (interior lighting patch fn), layer, lite })
 * returns an AstronautBody (body.group positioned by the caller).
 */
export function buildMountSuit({ ctx, variant = 'blue', set, patch, layer, lite, hatch = 105 }) {
  const assets = SuitAssets.get(ctx);
  let materials;
  if (lite) {
    materials = {};
    for (const k of ORLAN_MATERIALS) {
      const base = assets.get(k);
      const m = new THREE.MeshBasicMaterial({ map: base.map || null, vertexColors: !!base.vertexColors, transparent: base.transparent, opacity: base.opacity, alphaTest: base.alphaTest || 0, depthWrite: base.depthWrite, side: base.side });
      m.color.copy(base.color || new THREE.Color(1, 1, 1)).multiplyScalar(k === 'glow' ? 0.3 : 0.86);
      if (k === 'metal') m.color.setRGB(0.62, 0.64, 0.67);
      if (k === 'gold') m.color.setRGB(0.6, 0.45, 0.15);
      m.name = `suit:${k}:intLite`; m.userData.interior = true;
      materials[k] = m;
    }
  } else {
    const env = set?.paint?.envMap || null;
    materials = assets.interiorSet(ORLAN_MATERIALS, (m) => { if (env && 'envMap' in m) m.envMap = env; if (patch && set?.U) patch(m, set.U); }, `mount:${variant}`);
    if (materials.glow) materials.glow.color.setScalar(0.12);
  }
  const body = new AstronautBody(ctx, { outfit: 'orlan', variant, hatchInterior: true, materials, layer, castShadow: false, name: `mountSuit:${variant}` });
  body.pose('mount', { hatch });
  body.group.traverse((o) => { o.userData.noBatch = true; o.castShadow = false; o.receiveShadow = false; });
  return body;
}
