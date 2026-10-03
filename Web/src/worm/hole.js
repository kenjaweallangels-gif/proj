// «Окно» в рельефе: круглый вырез в материалах ландшафта (клипмап), чтобы харвестер уходил ВНИЗ в глотку червя, а не пропадал под плоским
// песком (рельеф — плоская поверхность, глотка под ним иначе не видна). Вырез включается только внутри ствола головы (радиус меньше внутренней
// стенки воронки), так что снаружи через него ничего не просвечивает.
// Подключается к материалам рельефа (customProgramCacheKey 'rk-terrain*') ДО первого рендера: wrap onBeforeCompile, без пересборки шейдеров позже.
// Uniform uWHole: xy — центр (x, z), z — радиус выреза, м (0 — выключено), w — высота плоскости: вырез только над уровнем w - 200.
import * as THREE from 'three';

export function installTerrainHole(scene) {
  const U = { value: new THREE.Vector4(0, 0, 0, 0) };
  let n = 0;
  scene.traverse((o) => {
    const m = o.isMesh ? o.material : null;
    if (!m || Array.isArray(m) || !m.customProgramCacheKey || m.userData.wormHole) return;
    let key = '';
    try { key = m.customProgramCacheKey(); } catch { return; }
    if (!String(key).startsWith('rk-terrain')) return;
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      prev?.call(m, shader, renderer);
      shader.uniforms.uWHole = U;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uWHole;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n if (uWHole.z > 0.0 && length(vWP.xz - uWHole.xy) < uWHole.z) discard;');
    };
    const prevKey = m.customProgramCacheKey.bind(m);
    m.customProgramCacheKey = () => prevKey() + 'H';
    m.userData.wormHole = true;
    m.needsUpdate = true;
    n++;
  });
  return {
    count: n,
    set(x, z, r) { U.value.set(x, z, r, 0); },
    clear() { U.value.z = 0; },
    get radius() { return U.value.z; },
  };
}
