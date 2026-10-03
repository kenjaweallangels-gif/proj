// Материал скалы тропы: берём шейдер Когтя (createRockMaterial: страты, желобки, песок на уступах), чтобы куски стыковались
// без шва, и добавляем атрибут aMark = (протоптанность, наносы): тропа светлее и менее песчаная, в «тени» валунов песка больше.
// Если шейдер Когтя изменится так, что подстановки не найдутся — остаётся обычный материал Когтя.
import * as THREE from 'three';
import { createRockMaterial } from '../desert/rockMaterial.js';

export function createLevelRockMaterial(opts = {}) {
  const mat = createRockMaterial({ band: opts.band ?? 4.2, sand: opts.sand ?? 0.35 });
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    const okV = vs.includes('varying vec3 vWN;') && vs.includes('vWN = normalize(mat3(modelMatrix) * rkN);');
    const okF = fs.includes('varying vec3 vWN;') && fs.includes('diffuseColor.rgb = base;') && fs.includes('base = mix(base, uSandC * (0.9');
    if (!okV || !okF) return;
    vs = vs.replace('varying vec3 vWN;', 'varying vec3 vWN;\nattribute vec2 aMark;\nvarying vec2 vMark;');
    vs = vs.replace('vWN = normalize(mat3(modelMatrix) * rkN);', 'vWN = normalize(mat3(modelMatrix) * rkN);\n  vMark = aMark;');
    fs = fs.replace('varying vec3 vWN;', 'varying vec3 vWN;\nvarying vec2 vMark;');
    // протоптанная полоса: меньше песка, светлее и глаже
    fs = fs.replace('base = mix(base, uSandC * (0.9', 'sandA = clamp(sandA * 0.65 * (1.0 - 0.8 * vMark.x) + vMark.y * 0.25, 0.0, 1.0);\nbase = mix(base, uSandC * (0.9');
    fs = fs.replace('diffuseColor.rgb = base;', 'base = mix(base, base * 1.22 + vec3(0.045, 0.036, 0.022), vMark.x * 0.7);\ndiffuseColor.rgb = base;');
    shader.vertexShader = vs; shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => 'lv-rock';
  mat.userData.levelRock = true;
  return mat;
}

/** Геометрия из результата Volume.mesh(). */
export function geometryFromMesh(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  if (m.mark) g.setAttribute('aMark', new THREE.BufferAttribute(m.mark, 2));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
