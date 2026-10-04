// Лаз на восточной грани Когтя: низкий неровный проход (≈ 2.0 × 2.25 м) без рамы, арки и колонн — просто отверстие в скале.
// Облицовка-штольня вглубь скалы (овальное сечение w × h, пол — плоский MOUTH.y) закрывает стык меша сиетча с гранью; коллайдеры боковых стенок.
// Сиетч стыкуется по оси z = MOUTH.z на высоте пола MOUTH.y (см. layout.js: MOUTH, PORTAL).
import * as THREE from 'three';
import { patchMaterial } from '../desert/env.js';
import { MOUTH } from './layout.js';

const V3 = THREE.Vector3;

/** Профиль лаза (в плоскости z–y): плоский пол, слегка скошенные стенки, овальный свод; [z, y] от левого пола к правому. */
function passProfile(w, h, n = 12) {
  const hw = w / 2, spring = h * 0.38, ry = h - spring;
  const pts = [[-hw * 0.82, 0], [-hw, spring * 0.45], [-hw, spring]];
  for (let i = 1; i < n; i++) { const a = Math.PI - (i / n) * Math.PI; pts.push([Math.cos(a) * hw * (1 - 0.18 * Math.sin(a)), spring + Math.sin(a) * ry]); }
  pts.push([hw, spring], [hw, spring * 0.45], [hw * 0.82, 0]);
  return pts;
}

export function createMouth(game, { root, faceAt, quality }) {
  const shadows = quality !== 'low';
  const out = { colliders: [], group: new THREE.Group() };
  out.group.name = 'MouthPassage';
  root.add(out.group);
  const z0 = MOUTH.z, y0 = MOUTH.y, L = MOUTH.lining, xFace = faceAt(z0);
  const xIn = MOUTH.x - L, xOut = MOUTH.x + 0.9;

  // ---- облицовка-штольня: труба вдоль +x, нормали внутрь ----
  const prof = passProfile(MOUTH.w, MOUTH.h);
  const nX = 10;
  const P = [], N = [], C = [], UV = [], I = [];
  for (let i = 0; i <= nX; i++) {
    const t = i / nX, x = xIn + (xOut - xIn) * t;
    // чем глубже в скалу — тем темнее (мягко, не до чёрного): свет уходит вглубь
    const k = 0.22 + 0.78 * Math.pow(t, 0.8);
    for (let j = 0; j < prof.length; j++) {
      const [pz, py] = prof[j];
      const edge = j === 0 || j === prof.length - 1;
      const wob = edge ? 1 : 1 + 0.05 * Math.sin(x * 2.3 + j * 1.7) + 0.035 * Math.sin(x * 5.1 - j * 0.9);
      P.push(x, y0 + py * (j > 2 && j < prof.length - 3 ? wob : 1), z0 + pz * wob);
      let nz = -pz, ny = (MOUTH.h * 0.5 - py) * (py > 0.9 ? 0.6 : 0);
      const nl = Math.hypot(nz, ny) || 1; N.push(0, ny / nl, nz / nl);
      const tone = 0.4 + 0.12 * (0.5 - Math.max(0, Math.min(1, py / MOUTH.h)) * 0.5);
      C.push(tone * k, tone * 0.88 * k, tone * 0.74 * k);
      UV.push(x * 0.5, j * 0.3);
    }
  }
  const W = prof.length;
  for (let i = 0; i < nX; i++) for (let j = 0; j < W - 1; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    I.push(a, b, d, a, d, c);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  lg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  lg.setIndex(I);
  // ориентация треугольников — лицом внутрь трубы
  {
    const pos = lg.attributes.position, idx = lg.index.array;
    const ax = new V3(), bx = new V3(), cx = new V3(), nn = new V3(), cen = new V3();
    for (let t = 0; t < idx.length; t += 3) {
      ax.fromBufferAttribute(pos, idx[t]); bx.fromBufferAttribute(pos, idx[t + 1]); cx.fromBufferAttribute(pos, idx[t + 2]);
      nn.subVectors(bx, ax).cross(cx.clone().sub(ax));
      cen.copy(ax).add(bx).add(cx).multiplyScalar(1 / 3);
      const toAxis = new V3(0, y0 + MOUTH.h * 0.45 - cen.y, z0 - cen.z);
      if (nn.dot(toAxis) < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
    }
  }
  const liningMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, color: 0xb59c80, emissive: 0x1a0f07, side: THREE.DoubleSide });
  patchMaterial(liningMat, 'gd-lining', {
    vertexPars: 'varying vec3 vWP;\n',
    vertexMain: 'vec3 transformed = vec3(position);\nvWP = (modelMatrix * vec4(position, 1.0)).xyz;',
    fragPars: 'varying vec3 vWP;\n',
    fragColor: '#include <color_fragment>\ndiffuseColor.rgb *= 0.62 + 0.75 * rkFbm(vWP.zy * 1.9 + vWP.x * 0.25) * (0.8 + 0.4 * rkNoise(vec2(vWP.z * 6.0, vWP.y * 0.6)));',
  });
  const lining = new THREE.Mesh(lg, liningMat);
  lining.name = 'MouthLining'; lining.receiveShadow = shadows;
  lining.visible = false;   // меш туннеля сиетча сам доходит до грани; облицовка давала «висящий лоскут» в проёме
  out.group.add(lining);

  // ---- коллайдеры: боковые стенки лаза (в нём контур Когтя отключён проходом) ----
  const add = (shape) => { const id = game.colliders?.add({ owner: 'garden', tags: new Set(['mouth']), ...shape }); if (id) out.colliders.push(id); };
  for (const s of [-1, 1]) add({ type: 'box', c: new V3((xIn + xOut) / 2 - 0.4, y0 + 1.2, z0 + s * (MOUTH.w / 2 + 0.3)), half: new V3((xOut - xIn) / 2 + 0.2, 1.3, 0.3), yaw: 0 });
  out.info = { xIn, xOut, xFace, z: z0, y: y0 };
  return out;
}
