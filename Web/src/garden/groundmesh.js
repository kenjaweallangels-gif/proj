// Меш пола сада: геометрия — ровно та сетка, по которой считает физика (ground.js). Материал: земля / утоптанная тропа / влажная / наносы песка
// по карте-сплату (RGBA8, разрешение 0.4 м), мелкий шум и зерно по мировым координатам, туман пустыни.
import * as THREE from 'three';
import { patchMaterial } from '../desert/env.js';
import { buildMeshData, buildSplat } from './ground.js';

export function createGroundMesh({ grid, field, quality, shadows }) {
  const md = buildMeshData(grid);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(md.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(md.normal, 3));
  g.setAttribute('aCover', new THREE.BufferAttribute(md.cover, 1));
  g.setIndex(new THREE.BufferAttribute(md.index, 1));
  g.computeBoundingSphere(); g.computeBoundingBox();

  const G = grid.G;
  const area = { x0: G.x0, z0: G.z0, x1: G.x1, z1: G.z1 };
  const sp = buildSplat(field, area, quality === 'low' ? 0.6 : 0.4);
  const tex = new THREE.DataTexture(sp.data, sp.w, sp.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false; tex.needsUpdate = true;
  const U = {
    uGSplat: { value: tex },
    uGArea: { value: new THREE.Vector4(area.x0, area.z0, area.x1 - area.x0, area.z1 - area.z0) },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0, envMapIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 });
  patchMaterial(mat, 'gd-ground', {
    uniforms: U,
    vertexPars: 'varying vec3 vWP;\nattribute float aCover;\nvarying float vCov;\n',
    vertexMain: /* glsl */`
vec3 transformed = vec3(position);
vWP = (modelMatrix * vec4(position, 1.0)).xyz;
vCov = aCover;`,
    fragPars: /* glsl */`
varying vec3 vWP;
varying float vCov;
uniform sampler2D uGSplat;
uniform vec4 uGArea;
vec4 gSplat;
`,
    fragColor: /* glsl */`
#include <color_fragment>
{
  vec2 wp = vWP.xz;
  gSplat = texture2D(uGSplat, (wp - uGArea.xy) / uGArea.zw);
  float n1 = rkNoise(wp * 0.35), n2 = rkNoise(wp * 1.7 + 4.0), n3 = rkNoise(wp * 7.3 + 9.0), n4 = rkNoise(wp * 23.0);
  // палитра задана «на глаз» (sRGB) → в линейное пространство рендера
  vec3 soilDry = pow(vec3(0.50, 0.38, 0.27), vec3(2.2));
  vec3 soilDark = pow(vec3(0.33, 0.24, 0.17), vec3(2.2));
  vec3 packed = pow(vec3(0.66, 0.54, 0.40), vec3(2.2));
  vec3 sand = pow(vec3(0.80, 0.67, 0.48), vec3(2.2));
  vec3 col = mix(soilDry, soilDark, smoothstep(0.35, 0.8, n1) * 0.7 + (n2 - 0.5) * 0.35);
  col *= 0.86 + 0.28 * n3;
  col = mix(col, pow(vec3(0.43, 0.40, 0.25), vec3(2.2)), gSplat.a * 0.45 * smoothstep(0.3, 0.7, n2));      // сухая трава/мох по земле
  // тропа: утоптанная, светлее, с колеёй и галькой
  float pk = gSplat.r;
  vec3 pc = packed * (0.88 + 0.22 * n3) * (0.92 + 0.12 * step(0.82, n4));
  col = mix(col, pc, pk);
  col = mix(col, sand * (0.9 + 0.2 * n3), gSplat.b * (0.55 + 0.4 * n2));
  col *= 1.0 - 0.38 * gSplat.g * (1.0 - 0.3 * pk);                                         // влажная земля темнее
  col *= 0.93 + 0.14 * n4;
  diffuseColor.rgb = col;
}`,
    fragRough: /* glsl */`
roughnessFactor = clamp(0.95 - 0.35 * gSplat.g + 0.04 * pow(vCov, 0.0), 0.5, 1.0);`,
    fragNormal: /* glsl */`
{
  // микрорельеф: нормаль по градиенту шума в мировой плоскости
  vec2 q = vWP.xz;
  float e = 0.06;
  float h0 = rkNoise(q * 4.5) * 0.6 + rkNoise(q * 13.0) * 0.4;
  float hx = rkNoise((q + vec2(e, 0.0)) * 4.5) * 0.6 + rkNoise((q + vec2(e, 0.0)) * 13.0) * 0.4;
  float hz = rkNoise((q + vec2(0.0, e)) * 4.5) * 0.6 + rkNoise((q + vec2(0.0, e)) * 13.0) * 0.4;
  vec3 dn = vec3(-(hx - h0), 0.0, -(hz - h0)) * (0.55 + 0.4 * gSplat.b);
  normal = normalize(normal + (viewMatrix * vec4(dn, 0.0)).xyz);
}`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'GardenGround';
  mesh.receiveShadow = shadows; mesh.castShadow = false;
  mesh.frustumCulled = true;
  return { mesh, material: mat, splat: sp, tris: md.index.length / 3, verts: md.position.length / 3 };
}
