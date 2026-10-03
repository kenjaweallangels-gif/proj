// Виртуальные изделия для плеера сборки: изделие собирается из голограмм, а не из реальных деталей.
// Реальные детали на время виртуальной сборки скрыты (их нет — «без заготовок»), на их месте — голограмма:
// полупрозрачная заливка с ободком по краю силуэта (френель), бегущие строки развёртки и контур рёбер.
// Стиль: 'holo' — голограмма видна всем (слой мира), 'glasses' — только в окне дисплея очков (слой голограмм).
// Быстро: заливка и рёбра слиты в несколько сеток (по шагам появления), а не сотни отдельных объектов.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HOLO, LAYER_HOLO, LAYER_REAL } from '../engine/holo.js';

const VS = /* glsl */`
varying vec3 vN; varying vec3 vV; varying float vY;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vY = wp.y;
  vec4 mv = viewMatrix * wp;
  vN = normalize(mat3(viewMatrix) * mat3(modelMatrix) * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const FS = /* glsl */`
uniform vec3 color; uniform float opacity; uniform float time;
varying vec3 vN; varying vec3 vV; varying float vY;
void main(){
  float ndv = abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(1.0 - ndv, 2.2);
  float scan = 0.82 + 0.18 * sin(vY * 260.0 - time * 4.0);         // строки развёртки ≈ 2,4 см
  float a = opacity * (0.22 + 1.1 * rim) * scan;
  gl_FragColor = vec4(color * a, 1.0);
}`;

const shared = { time: { value: 0 } };
/** Материал голограммы (аддитивный, без света и теней). */
export function holoFillMaterial(color = HOLO.part, opacity = 0.32) {
  return new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS,
    uniforms: { color: { value: new THREE.Color(color).multiplyScalar(1.4) }, opacity: { value: opacity }, time: shared.time },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
export function holoEdgeMaterial(color = HOLO.part, opacity = 0.7) {
  return new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.3), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
}
/** Время для строк развёртки — раз в кадр. */
export function tickHolo(t) { shared.time.value = t; }

const MAT = {};
export const holoMats = () => (MAT.fill ??= {
  fill: holoFillMaterial(HOLO.part, 0.3), edge: holoEdgeMaterial(HOLO.part, 0.65),
  flyFill: holoFillMaterial(HOLO.fastener, 0.5), flyEdge: holoEdgeMaterial(HOLO.fastener, 0.95),
});

/** Только позиция и нормаль, всегда с индексом — чтобы любые геометрии сливались. */
function pn(geo) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position.clone());
  if (geo.attributes.normal) g.setAttribute('normal', geo.attributes.normal.clone());
  else { g.computeVertexNormals(); }
  g.setIndex(geo.index ? Array.from(geo.index.array) : [...Array(geo.attributes.position.count).keys()]);
  return g;
}
const triCount = (geo) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;

/**
 * Геометрия голограммы для набора мешей (в СК root): { fill, edge } — слитые заливка и рёбра.
 * Рёбра — только у мешей до maxEdgeTri треугольников (у крупных хватает френеля).
 */
export function holoGeometry(meshes, root, { maxEdgeTri = 6000 } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), m4 = new THREE.Matrix4();
  const fills = [], edges = [];
  for (const m of meshes) {
    m4.multiplyMatrices(inv, m.matrixWorld);
    const f = pn(m.geometry); f.applyMatrix4(m4); fills.push(f);
    if (triCount(m.geometry) <= maxEdgeTri) { const e = new THREE.EdgesGeometry(m.geometry, 30); e.applyMatrix4(m4); edges.push(e); }
  }
  const fill = fills.length ? mergeGeometries(fills, false) : null;
  const edge = edges.length ? mergeGeometries(edges, false) : null;
  fills.forEach((g) => g.dispose()); edges.forEach((g) => g.dispose());
  return { fill, edge };
}

/** Объект-голограмма из слитой геометрии. */
export function holoObject({ fill, edge }, fly = false) {
  const M = holoMats();
  const o = new THREE.Group();
  if (fill) { const m = new THREE.Mesh(fill, fly ? M.flyFill : M.fill); m.renderOrder = 5; o.add(m); }
  if (edge) { const l = new THREE.LineSegments(edge, fly ? M.flyEdge : M.edge); l.renderOrder = 6; o.add(l); }
  o.traverse((x) => { x.raycast = () => {}; });
  return o;
}

/** Слой голограммы: видна всем или только в окне дисплея очков. */
export function setHoloLayer(obj, style) {
  obj.traverse((o) => o.layers.set(style === 'glasses' ? LAYER_HOLO : LAYER_REAL));
}

/**
 * Зеркало-голограмма для участка: клоны деталей (общая геометрия — «рост» провода виден и у голограммы),
 * после каждого шага плеера копируют позу и видимость реальных деталей, а реальные скрываются.
 */
export class HoloMirror {
  constructor(sources) {
    const M = holoMats();
    this.pairs = [];
    this.roots = [];
    for (const src of sources) {
      const c = src.clone(true);
      const a = [], b = [];
      src.traverse((o) => a.push(o)); c.traverse((o) => b.push(o));
      a.forEach((o, k) => {
        const x = b[k];
        if (x.isMesh) {
          x.material = M.fill; x.castShadow = x.receiveShadow = false; x.renderOrder = 5;
          const g = o.geometry;
          if (!(g instanceof THREE.TubeGeometry) && triCount(g) <= 4000) {
            const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), M.edge); e.renderOrder = 6; e.raycast = () => {};
            x.add(e);
          }
        }
        x.raycast = () => {};
        this.pairs.push([o, x]);
      });
      c.visible = false;
      src.parent.add(c);
      this.roots.push([src, c]);
    }
  }
  /** Перенести вид реальных деталей на голограммы, реальные — скрыть. */
  sync(fly = new Set()) {
    const M = holoMats();
    for (const [o, x] of this.pairs) {
      x.position.copy(o.position); x.quaternion.copy(o.quaternion); x.scale.copy(o.scale); x.visible = o.visible;
      if (o.isMesh && x.geometry !== o.geometry) x.geometry = o.geometry;
    }
    for (const [src, c] of this.roots) {
      const f = fly.has(src);
      c.traverse((x) => { if (x.isMesh) x.material = f ? M.flyFill : M.fill; else if (x.isLineSegments) x.material = f ? M.flyEdge : M.edge; });
      src.visible = false;
    }
  }
  setStyle(style) { for (const [, c] of this.roots) setHoloLayer(c, style); }
  hide() { for (const [, c] of this.roots) c.visible = false; }
}
