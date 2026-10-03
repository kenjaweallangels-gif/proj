// Реалистичные 3D-модели AR-очков по профилям glasses.js (метры, лицевая сторона — к −Z, начало — центр
// переносицы на середине высоты линз, дужки уходят к +Z). Что есть у каждой модели:
//  • передняя рамка — выдавленный контур с вырезами под линзы и аркой переносицы, фаска по кромке;
//  • линзы с электрохромным затемнением — тонированное стекло с просветляющим покрытием (радужный отблеск);
//  • оптический модуль в надбровной части: призма «birdbath» (глубокий, с наклонным полупрозрачным зеркалом
//    за линзой) или плоская призма X-Prism (тонкий, One Pro, Aura);
//  • дужки с динамиками и шарниром, загиб за ухо, кнопки, надпись бренда; носоупоры из силикона;
//  • колёса диоптрий VITURE (на надбровной части), камеры (RGB, серые для трекинга), индикатор приватности;
//  • кабель USB-C с конца левой дужки, у Aura — вычислительный блок с тачпадом на кабеле.
// Размеры — по открытым данным (ширина рамки One Pro 165 мм, длина дужки до 240 мм в развороте), остальное —
// по фото производителей; это внешний вид для симулятора, не КД.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { deviceById } from './glasses.js';

/** Внешний вид, мм. frame: smoky | metal | black | titanium | gloss; optics: birdbath | flat. */
export const DESIGN = {
  'viture-luma-ultra': { W: 150, lw: 57, lh: 40, rim: 4.5, brow: 13, mod: 26, optics: 'birdbath', frame: 'smoky', dial: true, cams: ['rgbC', 'grayL', 'grayR'], temple: 148, rgb: true, logo: 'VITURE' },
  'viture-luma-pro': { W: 150, lw: 57, lh: 40, rim: 4.5, brow: 13, mod: 26, optics: 'birdbath', frame: 'black', dial: true, cams: ['rgbC'], temple: 148, logo: 'VITURE' },
  'viture-beast': { W: 154, lw: 59, lh: 44, rim: 4, brow: 14, mod: 27, optics: 'birdbath', frame: 'metal', dial: true, cams: ['rgbC'], temple: 150, logo: 'VITURE' },
  'xreal-air2-pro': { W: 148, lw: 56, lh: 39, rim: 4, brow: 12, mod: 24, optics: 'birdbath', frame: 'black', dial: false, cams: [], temple: 146, logo: 'XREAL' },
  'xreal-air2-ultra': { W: 150, lw: 56, lh: 40, rim: 4.5, brow: 13, mod: 25, optics: 'birdbath', frame: 'titanium', dial: false, cams: ['grayL', 'grayR'], temple: 146, logo: 'XREAL' },
  'xreal-one': { W: 150, lw: 57, lh: 41, rim: 4.5, brow: 13, mod: 25, optics: 'birdbath', frame: 'black', dial: false, cams: [], temple: 148, logo: 'XREAL', eyeCam: true },
  'xreal-one-pro': { W: 158, lw: 60, lh: 40, rim: 4, brow: 11, mod: 17, optics: 'flat', frame: 'black', dial: false, cams: [], temple: 150, logo: 'XREAL', eyeCam: true, wrap: 0.09 },
  'xreal-aura': { W: 160, lw: 60, lh: 44, rim: 6, brow: 15, mod: 22, optics: 'flat', frame: 'gloss', dial: false, cams: ['grayL', 'grayR', 'rgbC'], temple: 152, logo: 'XREAL', puck: true, privacy: true, wrap: 0.07 },
};

const mm = 0.001;
const cache = new Map();
function M(key, make) { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); }

function frameMat(kind) {
  return M(`frame:${kind}`, () => ({
    smoky: new THREE.MeshPhysicalMaterial({ color: '#2b2f36', roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.5, sheen: 0.4, sheenColor: new THREE.Color('#5a6470'), sheenRoughness: 0.6 }),
    black: new THREE.MeshPhysicalMaterial({ color: '#141518', roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.6 }),
    metal: new THREE.MeshPhysicalMaterial({ color: '#3d4046', metalness: 0.85, roughness: 0.34, clearcoat: 0.3 }),
    titanium: new THREE.MeshPhysicalMaterial({ color: '#2a2c30', metalness: 0.75, roughness: 0.4 }),
    gloss: new THREE.MeshPhysicalMaterial({ color: '#0f1012', roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 }),
  })[kind]);
}
const lensMat = (t) => M(`lens:${t.toFixed(2)}`, () => new THREE.MeshPhysicalMaterial({
  color: new THREE.Color('#1c2a33').lerp(new THREE.Color('#05080a'), 1 - t / 0.4), roughness: 0.03, metalness: 0.15,
  clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.9, iridescence: 0.55, iridescenceIOR: 1.6, iridescenceThicknessRange: [180, 420],
  envMapIntensity: 1.6,
}));
const mirrorMat = () => M('mirror', () => new THREE.MeshPhysicalMaterial({ color: '#2c3439', metalness: 0.9, roughness: 0.1, transparent: true, opacity: 0.3 }));
const darkMat = () => M('dark', () => new THREE.MeshStandardMaterial({ color: '#050607', roughness: 0.7 }));
const camGlass = () => M('camglass', () => new THREE.MeshPhysicalMaterial({ color: '#06080a', roughness: 0.02, metalness: 0.3, clearcoat: 1, iridescence: 0.4 }));
const ringMat = () => M('ring', () => new THREE.MeshPhysicalMaterial({ color: '#8a9096', metalness: 1, roughness: 0.25 }));
const siliconeMat = () => M('silicone', () => new THREE.MeshPhysicalMaterial({ color: '#cfd3d6', roughness: 0.35, transparent: true, opacity: 0.75, clearcoat: 0.5 }));
const cableMat = () => M('cable', () => new THREE.MeshStandardMaterial({ color: '#1a1b1d', roughness: 0.55 }));

function rbox(w, h, d, mat, r = 1.5) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w * mm, h * mm, d * mm, 3, Math.min(r, w / 2.2, h / 2.2, d / 2.2) * mm), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Контур линзы (мм): верх прямой, наружный низ скруглён, у переносицы — скос под нос. s = +1 правая, −1 левая. */
function lensPath(path, s, cx, lw, lh) {
  const P = (x, y) => [s * x, y];
  const x0 = cx - lw / 2, x1 = cx + lw / 2, y0 = -lh / 2, y1 = lh / 2;
  const rT = 5, rB = lh * 0.48;
  const pts = [
    ['m', P(x0 + rT, y1)], ['l', P(x1 - rT, y1)], ['q', P(x1, y1), P(x1, y1 - rT)], ['l', P(x1, y0 + rB)],
    ['q', P(x1, y0), P(x1 - rB, y0)], ['l', P(x0 + lw * 0.36, y0)], ['q', P(x0 + 3, y0 + 1), P(x0, y0 + lh * 0.38)],
    ['l', P(x0, y1 - rT)], ['q', P(x0, y1), P(x0 + rT, y1)],
  ];
  for (const [k, a, b] of pts) {
    if (k === 'm') path.moveTo(a[0] * mm, a[1] * mm);
    else if (k === 'l') path.lineTo(a[0] * mm, a[1] * mm);
    else path.quadraticCurveTo(a[0] * mm, a[1] * mm, b[0] * mm, b[1] * mm);
  }
  return path;
}

function logoTexture(text, color = '#cfd4d8') {
  return M(`logo:${text}:${color}`, () => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 48;
    const g = c.getContext('2d');
    g.fillStyle = color; g.font = '600 34px "IBM Plex Sans", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text.split('').join(' '), 128, 26);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.4, depthWrite: false });
  });
}

/** Модель очков устройства id. opts: cable — кабель с вилкой (и блок вычислений у Aura); dim — уровень затемнения 0..1. */
export function buildGlassesModel(id, { cable = true, dim = 0 } = {}) {
  const dev = deviceById.get(id);
  const D = DESIGN[dev.id];
  const g = new THREE.Group();
  g.name = `glasses:${dev.id}`;
  const fm = frameMat(D.frame);
  const W = D.W, lw = D.lw, lh = D.lh, rim = D.rim, bridge = 9;
  const cx = bridge + lw / 2;
  const yTop = lh / 2 + rim + D.brow * 0.35, yBot = -lh / 2 - rim;

  // ---- передняя рамка с вырезами под линзы ----
  const outer = new THREE.Shape();
  const hw = W / 2, rC = 9;
  const pt = (x, y) => [x * mm, y * mm];
  outer.moveTo(...pt(-hw + rC, yTop));
  outer.lineTo(...pt(hw - rC, yTop));
  outer.quadraticCurveTo(...pt(hw, yTop), ...pt(hw, yTop - rC));
  outer.lineTo(...pt(hw, yBot + lh * 0.45));
  outer.quadraticCurveTo(...pt(hw, yBot), ...pt(hw - lh * 0.5, yBot));
  outer.lineTo(...pt(14, yBot));
  outer.quadraticCurveTo(...pt(9, yBot), ...pt(6, yBot + 9));
  outer.quadraticCurveTo(...pt(0, yBot + 18), ...pt(-6, yBot + 9));
  outer.quadraticCurveTo(...pt(-9, yBot), ...pt(-14, yBot));
  outer.lineTo(...pt(-hw + lh * 0.5, yBot));
  outer.quadraticCurveTo(...pt(-hw, yBot), ...pt(-hw, yBot + lh * 0.45));
  outer.lineTo(...pt(-hw, yTop - rC));
  outer.quadraticCurveTo(...pt(-hw, yTop), ...pt(-hw + rC, yTop));
  for (const s of [1, -1]) outer.holes.push(lensPath(new THREE.Path(), s, cx, lw, lh));
  const frontGeo = new THREE.ExtrudeGeometry(outer, { depth: 4 * mm, bevelEnabled: true, bevelThickness: 1.2 * mm, bevelSize: 1.0 * mm, bevelSegments: 3, curveSegments: 24 });
  frontGeo.translate(0, 0, -6 * mm);
  const front = new THREE.Mesh(frontGeo, fm);
  front.castShadow = true;
  g.add(front);
  // лёгкий охват головы: края рамки отогнуты назад (wrap)
  if (D.wrap) {
    const p = frontGeo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, p.getZ(i) + D.wrap * x * x * 18); }
    frontGeo.computeVertexNormals();
  }

  // ---- линзы (электрохромное стекло) ----
  const t = dev.dimLevels ? dev.dimLevels[0] + (dev.dimLevels.at(-1) - dev.dimLevels[0]) * dim : dev.transmit;
  for (const s of [1, -1]) {
    const shp = lensPath(new THREE.Shape(), s, cx, lw - 1.2, lh - 1.2);
    const geo = new THREE.ExtrudeGeometry(shp, { depth: 1.6 * mm, bevelEnabled: false, curveSegments: 24 });
    geo.translate(0, 0, -4.4 * mm);
    if (D.wrap) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, p.getZ(i) + D.wrap * x * x * 18); } geo.computeVertexNormals(); }
    const lens = new THREE.Mesh(geo, lensMat(t));
    lens.renderOrder = 2;
    g.add(lens);
    // за линзой: полупрозрачное зеркало birdbath (наклон 45°) или пластина плоской призмы
    if (D.optics === 'birdbath') {
      const bs = new THREE.Mesh(new THREE.PlaneGeometry((lw - 8) * mm, (lh * 0.95) * mm), mirrorMat());
      bs.position.set(s * cx * mm, -2 * mm, 6 * mm); bs.rotation.x = -Math.PI / 4;
      g.add(bs);
    } else {
      const pr = rbox(lw - 10, lh - 8, 5, M('prism', () => new THREE.MeshPhysicalMaterial({ color: '#0b0f12', roughness: 0.05, transparent: true, opacity: 0.55, clearcoat: 1 })), 3);
      pr.position.set(s * cx * mm, -1 * mm, 2 * mm); pr.castShadow = false;
      g.add(pr);
    }
  }

  // ---- оптический модуль в надбровной части (дисплеи micro-OLED и оптика) ----
  const mod = rbox(W * 0.84, D.brow, D.mod, fm, 4);
  mod.position.set(0, (lh / 2 + rim - D.brow / 2 + D.brow * 0.35) * mm, (D.mod / 2 - 4) * mm);
  g.add(mod);
  const under = rbox(W * 0.7, 2, D.mod * 0.8, darkMat(), 0.8);            // щель вентиляции снизу модуля
  under.position.set(0, (lh / 2 + rim - D.brow + D.brow * 0.35 - 0.4) * mm, (D.mod / 2 - 3) * mm);
  g.add(under);

  // ---- колёса диоптрий VITURE (по одному над каждым глазом) ----
  if (D.dial) {
    for (const s of [1, -1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(4.6 * mm, 4.6 * mm, 3.2 * mm, 28, 1), M('dial', () => new THREE.MeshPhysicalMaterial({ color: '#6b7179', metalness: 0.9, roughness: 0.32, flatShading: true })));
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(s * (cx - 6) * mm, (lh / 2 + rim + D.brow * 0.35 + 1.2) * mm, (D.mod * 0.45) * mm);
      wheel.castShadow = true;
      g.add(wheel);
    }
  }

  // ---- камеры и индикатор ----
  const camAt = (x, y, r = 2.6) => {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry((r + 0.8) * mm, (r + 0.8) * mm, 1.0 * mm, 24), ringMat());
    ring.rotation.x = Math.PI / 2; ring.position.set(x * mm, y * mm, -7.3 * mm);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(r * mm, 24), camGlass());
    glass.position.set(x * mm, y * mm, -7.85 * mm); glass.rotation.y = Math.PI;
    g.add(ring, glass);
  };
  const yCam = lh / 2 + rim * 0.2 + D.brow * 0.15;
  for (const c of D.cams) {
    if (c === 'rgbC') camAt(0, yCam, 2.2);
    if (c === 'grayL') camAt(-(hw - 8), yCam - 1, 3.0);
    if (c === 'grayR') camAt(hw - 8, yCam - 1, 3.0);
  }
  if (D.privacy) {
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.8 * mm, 12), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    led.position.set(5 * mm, yCam * mm, -7.85 * mm); led.rotation.y = Math.PI; g.add(led);
  }
  if (D.eyeCam) {                                    // разъём для камеры XREAL Eye на переносице
    const port = rbox(7, 3, 2, darkMat(), 0.6); port.position.set(0, (yBot + 17) * mm, -6.5 * mm); g.add(port);
  }

  // ---- носоупоры ----
  for (const s of [1, -1]) {
    const pad = new THREE.Mesh(new THREE.SphereGeometry(5 * mm, 16, 12), siliconeMat());
    pad.scale.set(0.45, 1.25, 0.8);
    pad.position.set(s * 8.5 * mm, (yBot + 7) * mm, 2 * mm);
    pad.rotation.z = s * 0.35;
    const arm = rbox(1.2, 8, 1.2, ringMat(), 0.5); arm.position.set(s * 7 * mm, (yBot + 12) * mm, -1 * mm); arm.rotation.z = s * 0.5;
    g.add(pad, arm);
  }

  // ---- дужки: шарнир, корпус динамика, загиб за ухо ----
  for (const s of [1, -1]) {
    const tg = new THREE.Group();
    tg.position.set(s * (hw - 3) * mm, (lh / 2 - 6) * mm, -2 * mm);
    tg.rotation.y = s * 0.045;
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(2.2 * mm, 2.2 * mm, 9 * mm, 16), ringMat());
    hinge.position.set(0, 0, 2 * mm); tg.add(hinge);
    const spk = rbox(8, 15, 60, fm, 3.5);                                   // передняя часть: динамик, плата
    spk.position.set(0, -1 * mm, 32 * mm); tg.add(spk);
    const grill = rbox(1, 6, 18, darkMat(), 0.5);                           // решётка динамика (снизу-изнутри)
    grill.position.set(-s * 3.6 * mm, -6.5 * mm, 46 * mm); tg.add(grill);
    const mid = rbox(5, 9, D.temple - 85, fm, 2.5);
    mid.position.set(0, -1 * mm, (60 + (D.temple - 85) / 2) * mm); tg.add(mid);
    const tip = rbox(5, 8, 32, fm, 2.5);                                    // загиб за ухо
    tip.position.set(0, -10 * mm, (D.temple - 14) * mm); tip.rotation.x = 0.55; tg.add(tip);
    if (s === 1) {                                                          // кнопки яркости/громкости
      for (let k = 0; k < 2; k++) { const b = rbox(2, 2.4, 7, ringMat(), 0.8); b.position.set(0, 7 * mm, (24 + k * 10) * mm); tg.add(b); }
    }
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(26 * mm, 4.8 * mm), logoTexture(D.logo, D.frame === 'metal' ? '#e8eaec' : '#b8bec4'));
    logo.position.set(s * 4.05 * mm, 0, 34 * mm); logo.rotation.y = s * Math.PI / 2; tg.add(logo);
    if (D.rgb) {                                                            // RGB-подсветка Luma Ultra
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(30 * mm, 1.2 * mm), M('rgb', () => new THREE.MeshBasicMaterial({ color: new THREE.Color('#57d8ff').multiplyScalar(1.6) })));
      strip.position.set(s * 4.1 * mm, -5 * mm, 30 * mm); strip.rotation.y = s * Math.PI / 2; tg.add(strip);
    }
    if (s === -1 && cable) {                                                // USB-C с конца левой дужки
      const plug = rbox(6, 4, 16, cableMat(), 1.5);
      plug.position.set(0, -16 * mm, (D.temple + 2) * mm); plug.rotation.x = 0.55; tg.add(plug);
      // кабель ложится на стол позади очков (очки стоят на рамке и загибах дужек)
      const pts = [[0, -20, D.temple + 10], [2, -26, D.temple + 30], [10, -27, D.temple + 80], [35, -27, D.temple + 170], [80, -27, D.temple + 260]];
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x * mm, y * mm, z * mm)));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 1.8 * mm, 8), cableMat());
      tube.castShadow = true; tg.add(tube);
      if (D.puck) {                                                         // блок вычислений Aura с тачпадом
        const puck = rbox(68, 16, 112, frameMat('gloss'), 10);
        puck.position.set(110 * mm, -19 * mm, (D.temple + 320) * mm); puck.rotation.y = -0.4;
        const pad = rbox(52, 1, 70, M('pad', () => new THREE.MeshPhysicalMaterial({ color: '#202327', roughness: 0.35, clearcoat: 0.6 })), 6);
        pad.position.set(0, 8 * mm, -10 * mm); puck.add(pad);
        tg.add(puck);
      }
    }
    g.add(tg);
  }
  g.userData = { device: dev.id, design: D };
  return g;
}
