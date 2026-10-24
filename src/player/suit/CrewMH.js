import * as THREE from 'three';

/**
 * The crew member's body from MakeHuman CC0 assets (built offline by tools/prepare_human.py into
 * public/models/crew/): skin (hm08 base mesh, young male, 1.80 m) with the areas under the clothes removed,
 * t-shirt + trousers, shoes with socks, short hair, eyebrows, eyelashes, eyes, and the 741-vertex proxy as LOD2.
 * Skin weights are mapped onto the astronaut skeleton; joints and bone rest frames come with the data
 * (the mesh is modelled in an A-pose; Rig poses it from canonical frames).
 *
 * loadCrewData(ctx) -> Promise<data|null> (cached); crewGeometries(data, level) -> Map<materialKey, BufferGeometry>
 */

export const CREW_MH_MATERIALS = ['mhSkin', 'mhClothes', 'mhShoes', 'mhHair', 'mhBrows', 'mhLashes', 'mhEyes', 'mhLod2'];
const KEY = { skin: 'mhSkin', clothes: 'mhClothes', shoes: 'mhShoes', hair: 'mhHair', brows: 'mhBrows', lashes: 'mhLashes', eyes: 'mhEyes', lod2: 'mhLod2' };
const LEVEL_PARTS = [
  ['skin', 'clothes', 'shoes', 'hair', 'brows', 'lashes', 'eyes'],
  ['skin', 'clothes', 'shoes', 'hair', 'eyes'],
  ['lod2'],
];

let _promise = null;
let _data = null;

export function crewData() { return _data; }

export function loadCrewData(ctx) {
  if (_promise) return _promise;
  const url = (p) => (ctx.assetUrl ? ctx.assetUrl(p) : `/${p}`);
  _promise = (async () => {
    try {
      const [meta, bin] = await Promise.all([
        fetch(url('models/crew/crew.json')).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch(url('models/crew/crew.bin')).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
      ]);
      const geos = {};
      for (const p of meta.parts) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bin, p.pos, p.count * 3), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(bin, p.nrm, p.count * 3), 3));
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(bin, p.uv, p.count * 2), 2));
        g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint8Array(bin, p.si, p.count * 4), 4));
        g.setAttribute('skinWeight', new THREE.BufferAttribute(new Uint8Array(bin, p.sw, p.count * 4), 4, true));
        if (p.col !== undefined) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(bin, p.col, p.count * 3), 3));
        g.setIndex(new THREE.BufferAttribute(new Uint32Array(bin, p.idx, p.indices), 1));
        g.computeBoundingSphere();
        g.userData.tris = p.indices / 3;
        g.userData.shared = true;
        geos[p.key] = g;
      }
      const J = {};
      for (const [k, v] of Object.entries(meta.joints)) J[k] = new THREE.Vector3(...v);
      J.eye = new THREE.Vector3(...meta.eye);
      const rest = {};
      for (const [k, q] of Object.entries(meta.rest)) rest[k] = new THREE.Quaternion(...q);
      _data = { meta, geos, J, rest };
      return _data;
    } catch (e) {
      console.warn('[suit] crew model not available, using the procedural crew body', e);
      return null;
    }
  })();
  return _promise;
}

/** Geometries of one LOD level, keyed by material. */
export function crewGeometries(data, level) {
  const out = new Map();
  for (const k of LEVEL_PARTS[Math.min(level, 2)]) if (data.geos[k]) out.set(KEY[k], data.geos[k]);
  return out;
}
