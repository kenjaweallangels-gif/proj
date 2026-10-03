// Устье туннеля на восточной грани Когтя: каменная рамка (косяки, перемычка, порог), облицовка-штольня вглубь скалы (арочное сечение
// w × h, пол — плоский MOUTH.y), торцевая «тьма» (мягкий градиент, не чёрная заглушка), знаки на косяках, коллайдеры стенок.
// Сиетч стыкуется по оси z = MOUTH.z на высоте пола MOUTH.y (см. layout.js: MOUTH). setCap(false) — убрать торец, когда туннель сиетча доведён до устья.
import * as THREE from 'three';
import { chunkyBox } from '../desert/rock.js';
import { createLevelRockMaterial } from '../level/rockmat.js';
import { markMaterial } from '../level/marks.js';
import { patchMaterial } from '../desert/env.js';
import { MOUTH } from './layout.js';

const V3 = THREE.Vector3;

/** Профиль арки (в плоскости z–y): низ — пол, стенки до springY, потом полуэллипс. Возвращает массив [z, y] от левого пола к правому. */
function archProfile(w, h, n = 14) {
  const hw = w / 2, spring = Math.max(0.6, h - hw * 0.95);
  const pts = [[-hw, 0], [-hw, spring * 0.5], [-hw, spring]];
  const rY = h - spring;
  for (let i = 1; i < n; i++) { const a = Math.PI - (i / n) * Math.PI; pts.push([Math.cos(a) * hw, spring + Math.sin(a) * rY]); }
  pts.push([hw, spring], [hw, spring * 0.5], [hw, 0]);
  return pts;
}

export function createMouth(game, { root, faceAt, ground, quality }) {
  const shadows = quality !== 'low';
  const out = { colliders: [], group: new THREE.Group() };
  out.group.name = 'MouthPortal';
  root.add(out.group);
  const z0 = MOUTH.z, y0 = MOUTH.y, L = MOUTH.lining, xFace = faceAt(z0);
  const xIn = MOUTH.x - L, xOut = MOUTH.x + 0.9;
  const rockMat = createLevelRockMaterial({ band: 5.5, sand: 0.12 });

  // ---- облицовка-штольня: труба вдоль +x, нормали внутрь ----
  const prof = archProfile(MOUTH.w, MOUTH.h);
  const nX = 12;
  const P = [], N = [], C = [], UV = [], I = [];
  for (let i = 0; i <= nX; i++) {
    const t = i / nX, x = xIn + (xOut - xIn) * t;
    // чем глубже в скалу — тем темнее (мягко, не до чёрного): имитация света, уходящего вглубь
    const k = 0.2 + 0.8 * Math.pow(t, 0.8);
    for (let j = 0; j < prof.length; j++) {
      const [pz, py] = prof[j];
      const wob = 1 + 0.025 * Math.sin(x * 2.3 + j * 1.7) + 0.02 * Math.sin(x * 5.1 - j);
      P.push(x, y0 + py * (j > 2 && j < prof.length - 3 ? wob : 1), z0 + pz * wob);
      // нормаль внутрь (к оси)
      const ay = Math.max(0, Math.min(1, py / MOUTH.h));
      let nz = -pz, ny = (MOUTH.h * 0.5 - py) * (py > 1.0 ? 0.6 : 0);
      const nl = Math.hypot(nz, ny) || 1; N.push(0, ny / nl, nz / nl);
      const tone = 0.55 + 0.25 * (0.5 - ay * 0.5);
      C.push(tone * k, tone * 0.88 * k, tone * 0.74 * k);
      UV.push(x * 0.5, j * 0.3);
    }
  }
  const W = prof.length;
  for (let i = 0; i < nX; i++) for (let j = 0; j < W - 1; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    I.push(a, b, d, a, d, c);
  }
  // пол лишний (его даёт сетка пола), но замыкаем профиль: внизу ряд совпадает с полом, проверка порядка обхода — ниже
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  lg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  lg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  lg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  lg.setIndex(I);
  // ориентацию треугольников выбираем так, чтобы лицевая сторона смотрела внутрь трубы (в сторону оси)
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
    fragColor: '#include <color_fragment>\ndiffuseColor.rgb *= 0.8 + 0.4 * rkFbm(vWP.zy * 1.3 + vWP.x * 0.4);',
  });
  const lining = new THREE.Mesh(lg, liningMat);
  lining.name = 'MouthLining'; lining.receiveShadow = shadows;
  out.group.add(lining);

  // ---- торец штольни: мягкий тёмно-тёплый градиент (не чёрный) ----
  {
    const cg = new THREE.PlaneGeometry(MOUTH.w * 1.02, MOUTH.h * 1.0);
    const cm = new THREE.MeshBasicMaterial({ color: 0x1a110b, side: THREE.DoubleSide });
    cm.fog = false;
    const cap = new THREE.Mesh(cg, cm);
    cap.position.set(xIn + 0.05, y0 + MOUTH.h * 0.5, z0); cap.rotation.y = Math.PI / 2;
    out.cap = cap; out.group.add(cap);
  }

  // ---- рамка: косяки, перемычка, порог ----
  const hw = MOUTH.w / 2 + 0.55;
  const fx = (z) => faceAt(z) + 1.1;
  const jamb = (z, h, seed) => { const g = chunkyBox(1.0, h, 1.5, 4, 11 + seed, 0.1); g.translate(fx(z) + 0.8, y0 + h / 2 - 0.05, z); return g; };
  const frame = new THREE.Group(); frame.name = 'MouthFrame';
  const parts = [jamb(z0 - hw, MOUTH.h + 0.5, 0), jamb(z0 + hw, MOUTH.h + 0.5, 3)];
  const lint = chunkyBox(1.3, 0.9, MOUTH.w + 2.4, 5, 19, 0.05); lint.translate(fx(z0) + 0.8, y0 + MOUTH.h + 0.45, z0); parts.push(lint);
  // порог — плита вровень с полом (верх = y0 + 0.01, чтобы не было ступеньки и z-fighting с землёй)
  const sill = new THREE.BoxGeometry(2.6, 0.3, MOUTH.w + 0.4); sill.translate(fx(z0) + 0.2, y0 - 0.14, z0); parts.push(sill);
  for (const g of parts) { const m = new THREE.Mesh(g, rockMat); m.castShadow = shadows; m.receiveShadow = true; frame.add(m); }
  out.group.add(frame);
  // знаки на косяках: три зарубки (фрименская резьба) и роспись возрожденцев
  const decal = (kind, z, y, size, rot) => {
    const mm = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), markMaterial(kind));
    mm.scale.set(size, size, 1); mm.position.set(fx(z) + 0.3, y, z + (z < z0 ? 0.76 : -0.76));
    mm.rotation.y = z < z0 ? 0 : Math.PI; mm.rotation.z = rot; mm.renderOrder = 3; out.group.add(mm);
  };
  decal('notches', z0 - hw, y0 + 1.7, 0.7, 0.05);
  decal('sigil', z0 + hw, y0 + 1.6, 0.8, -0.1);

  // ---- коллайдеры: косяки и боковые стенки штольни (в штольне контур Когтя отключён проходом) ----
  const add = (shape) => { const id = game.colliders?.add({ owner: 'garden', tags: new Set(['mouth']), ...shape }); if (id) out.colliders.push(id); };
  for (const z of [z0 - hw, z0 + hw]) add({ type: 'box', c: new V3(fx(z) + 0.8, y0 + 2.5, z), half: new V3(0.5, 2.6, 0.75), yaw: 0 });
  for (const s of [-1, 1]) add({ type: 'box', c: new V3((xIn + xOut) / 2 - 0.4, y0 + 1.5, z0 + s * (MOUTH.w / 2 + 0.3)), half: new V3((xOut - xIn) / 2 + 0.2, 1.6, 0.3), yaw: 0 });
  // Торец штольни по умолчанию выключен (туннель сиетча продолжает облицовку; проход свободен в обе стороны).
  // setCap(true) — запасной вариант: мягкая «тьма» вместо провала, если туннель сиетча к устью не доведён (коллайдера у торца нет).
  out.cap.visible = false;
  out.setCap = (b) => { out.cap.visible = !!b; };
  out.info = { xIn, xOut, xFace, z: z0, y: y0 };
  return out;
}
