// Материалы интерьера: «безламповый» шейдер (свет запечён в вершинные цвета), процедурные панели/рифлёнка/ткань/полосы,
// атлас декалей (три слоя истории: имперские трафареты — резьба — росписи возрожденцев), атлас живых экранов.
import * as THREE from 'three';
import { patchMaterial } from '../desert/env.js';
import { rng } from '../core/util.js';
import { triplanarKit } from '../core/triplanar.js';

/** Общий «пульс питания» интерьера: 0 — аварийный полумрак, 1 — полный свет (uniform всех материалов интерьера). */
export const INT_POWER = { value: 1 };

const VERT_PARS = `
attribute float aTag;
varying vec3 vLP; varying vec3 vLN; varying vec3 vWP; varying float vTag;
`;
const VERT_MAIN = `
vec3 transformed = vec3(position);
vLP = position; vLN = normal; vTag = aTag;
{
  vec4 hvW = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  hvW = instanceMatrix * hvW;
  #endif
  vWP = (modelMatrix * hvW).xyz;
}
`;
const FRAG_PARS = `
varying vec3 vLP; varying vec3 vLN; varying vec3 vWP; varying float vTag;
uniform float uIPow;
`;
const FRAG_COLOR = /* glsl */`
#include <color_fragment>
{
  vec3 N = normalize(vLN);
  vec3 aN = abs(N);
  vec2 uv;
  if (aN.x > aN.y && aN.x > aN.z) uv = vec2(vLP.z, vLP.y);
  else if (aN.y > aN.z) uv = vLP.xz;
  else uv = vLP.xy;
  float dist = distance(cameraPosition, vWP);
  float near = 1.0 - smoothstep(10.0, 40.0, dist);
  int tag = int(vTag + 0.5);
  vec3 base = diffuseColor.rgb;
  float n1 = rkFbm(uv * 0.6 + vLP.y * 0.07 + vLP.x * 0.03);
  float n2 = rkNoise(uv * 3.3 + 7.0);
  vec2 psz = vec2(2.0, 1.0);
  vec2 cell = floor(uv / psz);
  vec2 f = uv - cell * psz;
  vec2 e = min(f, psz - f);
  float edge = min(e.x, e.y);
  float seam = 1.0 - smoothstep(0.0, 0.03, edge);
  if (tag == 5) {                       // рифлёный настил / решётка
    vec2 q = uv * 4.0;
    vec2 c = abs(fract(q) - 0.5);
    float d = abs(c.x - c.y);
    float tread = smoothstep(0.03, 0.14, d);
    base *= (0.8 + 0.28 * tread) * (0.9 + 0.15 * rkNoise(uv * 1.7));
    base *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.05, min(fract(uv.x * 0.5), fract(uv.y * 0.5)))) * near;
  } else if (tag == 6) {                // ткань, мешковина, ковры
    float w = sin(uv.x * 95.0) * sin(uv.y * 95.0) * 0.5 + 0.5;
    base *= (0.9 + 0.2 * w * near) * (0.9 + 0.2 * n2);
  } else if (tag == 4) {                // сигнальная полоса
    float s = step(0.5, fract((uv.x + uv.y) / 0.5));
    base = mix(vec3(0.5, 0.34, 0.03), vec3(0.03), s) * (0.9 + 0.2 * n2) * max(dot(base, vec3(0.33)) * 2.2, 0.4);
  } else {
    base *= 1.0 - 0.38 * seam * step(float(tag), 3.5);
    if (near > 0.01 && tag != 2) {
      float r1 = length(vec2(e.x - 0.14, (fract(f.y / 0.3) - 0.5) * 0.3)) * step(0.1, e.y);
      float r2 = length(vec2(e.y - 0.14, (fract(f.x / 0.3) - 0.5) * 0.3)) * step(0.1, e.x);
      float r = min(e.x < 0.3 ? r1 : 9.0, e.y < 0.3 ? r2 : 9.0);
      base += vec3(0.03) * (1.0 - smoothstep(0.025, 0.04, r)) * near;
    }
  }
  float grime = smoothstep(0.3, 0.9, n1);
  base *= 1.0 - 0.30 * grime;
  float st = rkNoise(vec2(uv.x * 2.9 + 3.0, uv.y * 0.18));
  base = mix(base, base * vec3(0.55, 0.52, 0.49), smoothstep(0.66, 0.86, st) * 0.5 * (1.0 - smoothstep(0.4, 0.8, abs(N.y))));
  if (tag == 3) base = mix(base, vec3(0.2, 0.1, 0.05) * (0.7 + 0.6 * n2), smoothstep(0.5, 0.8, n1 + n2 * 0.25) * 0.4);
  float scuff = rkNoise(uv * 14.0);
  base *= 1.0 - 0.12 * smoothstep(0.7, 0.95, scuff) * near;
#ifdef HV_ITEX
  float tk = near * (tag == 6 || tag == 4 ? 0.0 : 1.0);
  if (tk > 0.01) { tpIEval(vWP * 0.9, N); base *= mix(vec3(1.0), clamp(tpIMul, 0.8, 1.2), 0.45 * tk); }
#endif
  base *= mix(0.32, 1.0, uIPow);
  diffuseColor.rgb = base;
}
`;

/** Материал интерьера: MeshBasic (освещение запечено), uniform uIPow — «питание» ламп (0 — аварийный полумрак, 1 — полный свет). */
export function createInteriorMaterial(quality) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  const pow = INT_POWER;
  const kit = quality === 'low' ? null : triplanarKit('tpI', 'metal_painted', { scale: 1.8, sharpness: 5, quality, ao: 0, normal: 0, rough: 0, chroma: 0.0, antiTile: false });
  patchMaterial(mat, 'hv-int' + (kit ? 't' : ''), {
    uniforms: { uIPow: pow, ...(kit ? kit.uniforms : {}) },
    vertexPars: VERT_PARS, vertexMain: VERT_MAIN,
    fragPars: (kit ? '#define HV_ITEX\n' + kit.pars : '') + FRAG_PARS,
    fragColor: FRAG_COLOR,
  });
  return mat;
}

// ================================================================================== АТЛАС ДЕКАЛЕЙ ИНТЕРЬЕРА (2048 x 1536)
export const IW = 2048, IH = 1536;
const RECT = {
  mural: [0, 0, 1024, 592], carve: [1024, 0, 512, 512], eagle: [1536, 0, 512, 512],
  schedule: [0, 592, 512, 307], spicechart: [512, 592, 512, 320], hands: [1024, 512, 512, 366], eye: [1536, 512, 384, 384],
  danger: [0, 912, 384, 384], noent: [384, 912, 384, 384], hazard: [768, 912, 384, 384], water: [1152, 912, 384, 256], notice: [1536, 912, 384, 274],
  exit: [0, 1296, 768, 240], arrow: [768, 1296, 384, 192], stencil: [1152, 1296, 512, 240], tally: [1664, 1296, 384, 160],
  chevw: [1536, 1190, 512, 104], num1: [1152, 1180, 128, 54], num2: [1280, 1180, 128, 54], num3: [1408, 1180, 128, 54],
};
export const IATLAS = Object.fromEntries(Object.entries(RECT).map(([k, [x, y, w, h]]) => [k, [x / IW, y / IH, (x + w) / IW, (y + h) / IH]]));

export function createInteriorDecalTexture() {
  const c = document.createElement('canvas'); c.width = IW; c.height = IH;
  const x = c.getContext('2d');
  x.clearRect(0, 0, IW, IH);
  const R = rng(777);
  const rect = (k) => RECT[k];
  const ocher = '#b5532c', ocher2 = '#d98a3a', chalk = '#e6dcc4', ink = '#1b1a18', green = '#4fae7a', teal = '#4d9a90', yel = '#e0a820', blue = '#3f7fd6';
  x.textBaseline = 'middle'; x.textAlign = 'center'; x.lineCap = 'round'; x.lineJoin = 'round';
  const wob = (v, a) => v + (R() - 0.5) * a;

  { // роспись: червь, фигурки, солнце (рука возрожденцев) — слой 3
    const [rx, ry, rw, rh] = rect('mural');
    x.fillStyle = 'rgba(120,96,70,0.22)'; x.fillRect(rx, ry, rw, rh);
    x.strokeStyle = ocher; x.fillStyle = ocher;
    x.lineWidth = 34;
    x.beginPath(); x.moveTo(rx + 60, ry + 420);
    for (let i = 1; i <= 24; i++) { const t = i / 24; x.lineTo(wob(rx + 60 + t * (rw - 360), 6), wob(ry + 420 - Math.sin(t * Math.PI * 1.2) * 200 - t * 80, 6)); }
    x.stroke();
    x.lineWidth = 10; x.strokeStyle = chalk;
    for (let i = 0; i < 20; i++) { const t = i / 20, px = rx + 60 + t * (rw - 360), py = ry + 420 - Math.sin(t * Math.PI * 1.2) * 200 - t * 80; x.beginPath(); x.moveTo(px, py - 24); x.lineTo(px, py + 24); x.stroke(); }
    x.fillStyle = ocher; x.beginPath(); x.arc(rx + rw - 290, ry + 190, 105, 0, Math.PI * 2); x.fill();   // пасть — кольцо зубов
    x.fillStyle = '#1b1210'; x.beginPath(); x.arc(rx + rw - 290, ry + 190, 62, 0, Math.PI * 2); x.fill();
    x.strokeStyle = chalk; x.lineWidth = 10;
    for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; x.beginPath(); x.moveTo(rx + rw - 290 + Math.cos(a) * 70, ry + 190 + Math.sin(a) * 70); x.lineTo(rx + rw - 290 + Math.cos(a) * 100, ry + 190 + Math.sin(a) * 100); x.stroke(); }
    x.strokeStyle = chalk; x.lineWidth = 12;
    for (let i = 0; i < 5; i++) {     // человечки с поднятыми руками
      const px = rx + 90 + i * 70, py = ry + 500;
      x.beginPath(); x.arc(px, py - 86, 13, 0, 7); x.stroke();
      x.beginPath(); x.moveTo(px, py - 70); x.lineTo(px, py - 24); x.moveTo(px - 24, py - 100); x.lineTo(px, py - 62); x.lineTo(px + 24, py - 100); x.moveTo(px, py - 24); x.lineTo(px - 14, py); x.moveTo(px, py - 24); x.lineTo(px + 14, py); x.stroke();
    }
    x.strokeStyle = ocher2; x.lineWidth = 8;
    for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(rx + 130 + i * 60, ry + 70 + (i % 3) * 14, 6 + (i % 2) * 3, 0, 7); x.stroke(); }
    x.font = 'bold 54px "Comic Sans MS", cursive, sans-serif'; x.fillStyle = chalk;
    x.fillText('ОН ПРИДЁТ', rx + 270, ry + 560 - 16);
  }
  { // резьба: волны песка и спираль воды — слой 1 (вырезано в старой плите)
    const [rx, ry, rw, rh] = rect('carve');
    x.fillStyle = 'rgba(88,76,62,0.92)'; x.fillRect(rx + 10, ry + 10, rw - 20, rh - 20);
    const line = (dark) => { x.strokeStyle = dark ? 'rgba(20,16,12,0.9)' : 'rgba(210,190,160,0.45)'; x.lineWidth = dark ? 9 : 5; };
    for (const [dk, off] of [[true, 0], [false, 6]]) {
      line(dk);
      for (let r = 0; r < 7; r++) { x.beginPath(); for (let i = 0; i <= 60; i++) { const t = i / 60; const px = rx + 40 + t * (rw - 80), py = ry + 80 + r * 44 + Math.sin(t * 9 + r * 0.8) * 14 + off; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); }
      x.beginPath(); for (let i = 0; i < 200; i++) { const a = i * 0.11, rr = 6 + i * 0.55; const px = rx + rw / 2 + Math.cos(a) * rr + off * 0.5, py = ry + rh - 130 + Math.sin(a) * rr * 0.9 + off * 0.5; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
    }
    x.strokeStyle = 'rgba(20,16,12,0.8)'; x.lineWidth = 8; x.strokeRect(rx + 22, ry + 22, rw - 44, rh - 44);
  }
  { // имперский знак Квизарата (трафарет) — слой 2
    const [rx, ry, rw, rh] = rect('eagle'); const cx = rx + rw / 2, cy = ry + rh / 2;
    x.fillStyle = 'rgba(14,14,16,0.88)'; x.beginPath(); x.arc(cx, cy, 236, 0, 7); x.fill();
    x.strokeStyle = yel; x.lineWidth = 14; x.beginPath(); x.arc(cx, cy, 222, 0, 7); x.stroke();
    x.fillStyle = yel;
    x.beginPath();
    x.moveTo(cx, cy - 150); x.lineTo(cx + 40, cy - 90); x.lineTo(cx + 200, cy - 130); x.lineTo(cx + 120, cy - 20); x.lineTo(cx + 190, cy + 40);
    x.lineTo(cx + 60, cy + 30); x.lineTo(cx + 30, cy + 150); x.lineTo(cx, cy + 90); x.lineTo(cx - 30, cy + 150); x.lineTo(cx - 60, cy + 30);
    x.lineTo(cx - 190, cy + 40); x.lineTo(cx - 120, cy - 20); x.lineTo(cx - 200, cy - 130); x.lineTo(cx - 40, cy - 90); x.closePath(); x.fill();
    x.fillStyle = '#0e0e10'; x.beginPath(); x.arc(cx, cy - 78, 14, 0, 7); x.fill();
    x.fillStyle = chalk; x.font = 'bold 34px Arial'; x.fillText('КВИЗАРАТ', cx, cy + 190);
  }
  { // метки ладоней (красная охра)
    const [rx, ry, rw, rh] = rect('hands');
    x.fillStyle = ocher;
    for (let i = 0; i < 6; i++) {
      const px = rx + 60 + (i % 3) * 150 + (R() - 0.5) * 20, py = ry + 100 + Math.floor(i / 3) * 150, rot = (R() - 0.5) * 0.6;
      x.save(); x.translate(px, py); x.rotate(rot);
      x.beginPath(); x.ellipse(0, 0, 38, 46, 0, 0, 7); x.fill();
      for (let f = -2; f <= 2; f++) { x.beginPath(); x.ellipse(f * 18, -60 + Math.abs(f) * 7, 8, 28, f * 0.12, 0, 7); x.fill(); }
      x.beginPath(); x.ellipse(-52, -8, 8, 24, -0.9, 0, 7); x.fill();
      x.restore();
    }
  }
  { // синий глаз (Ибад) — роспись
    const [rx, ry, rw, rh] = rect('eye'); const cx = rx + rw / 2, cy = ry + rh / 2;
    x.fillStyle = 'rgba(230,222,200,0.9)'; x.beginPath(); x.ellipse(cx, cy, 160, 90, 0, 0, 7); x.fill();
    x.fillStyle = blue; x.beginPath(); x.arc(cx, cy, 82, 0, 7); x.fill();
    x.fillStyle = '#10305f'; x.beginPath(); x.arc(cx, cy, 42, 0, 7); x.fill();
    x.strokeStyle = ink; x.lineWidth = 10; x.beginPath(); x.ellipse(cx, cy, 160, 90, 0, 0, 7); x.stroke();
    for (let i = 0; i < 9; i++) { const a = -Math.PI + i * Math.PI / 8; x.beginPath(); x.moveTo(cx + Math.cos(a) * 170, cy + Math.sin(a) * 100); x.lineTo(cx + Math.cos(a) * 205, cy + Math.sin(a) * 135); x.stroke(); }
  }
  { // расписание смен
    const [rx, ry, rw, rh] = rect('schedule');
    x.fillStyle = 'rgba(224,214,188,0.95)'; x.fillRect(rx, ry, rw, rh);
    x.strokeStyle = ink; x.lineWidth = 3; x.strokeRect(rx + 2, ry + 2, rw - 4, rh - 4);
    x.fillStyle = ink; x.font = 'bold 26px Arial'; x.textAlign = 'left'; x.fillText('СМЕНЫ · ХВ-017', rx + 16, ry + 26);
    x.font = '20px "Courier New", monospace';
    ['А  0600–1400  ЛАЙ-ТО', 'Б  1400–2200  МАРИ', 'В  2200–0600  ХОРН', 'ТОПЛИВО  ····· 61%', 'ВОДА (КРУГ)  · 88%'].forEach((s, i) => x.fillText(s, rx + 16, ry + 66 + i * 40));
    x.strokeStyle = ocher; x.lineWidth = 5; x.beginPath(); x.moveTo(rx + 200, ry + 232); x.lineTo(rx + 330, ry + 232); x.stroke();
    x.textAlign = 'center';
  }
  { // карта пряности (контуры + маршрут)
    const [rx, ry, rw, rh] = rect('spicechart');
    x.fillStyle = 'rgba(200,190,160,0.95)'; x.fillRect(rx, ry, rw, rh);
    x.strokeStyle = 'rgba(100,70,40,0.7)'; x.lineWidth = 2;
    for (let k = 0; k < 9; k++) { x.beginPath(); for (let i = 0; i <= 50; i++) { const t = i / 50; const px = rx + t * rw, py = ry + 40 + k * 32 + Math.sin(t * 7 + k * 1.3) * 18; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); }
    x.fillStyle = 'rgba(210,100,30,0.55)'; x.beginPath(); x.ellipse(rx + 330, ry + 150, 80, 52, 0.4, 0, 7); x.fill();
    x.strokeStyle = ink; x.lineWidth = 4; x.setLineDash([12, 8]); x.beginPath(); x.moveTo(rx + 40, ry + 270); x.quadraticCurveTo(rx + 180, ry + 80, rx + 330, ry + 150); x.stroke(); x.setLineDash([]);
    x.fillStyle = ink; x.font = 'bold 22px Arial'; x.fillText('ЖИЛА · КВ-7', rx + 330, ry + 230);
  }
  { // опасно: вращающиеся механизмы
    const [rx, ry, rw, rh] = rect('danger');
    x.fillStyle = yel; x.beginPath(); x.moveTo(rx + rw / 2, ry + 20); x.lineTo(rx + rw - 20, ry + rh - 30); x.lineTo(rx + 20, ry + rh - 30); x.closePath(); x.fill();
    x.fillStyle = ink; x.beginPath(); x.moveTo(rx + rw / 2, ry + 62); x.lineTo(rx + rw - 62, ry + rh - 50); x.lineTo(rx + 62, ry + rh - 50); x.closePath(); x.fill();
    x.strokeStyle = yel; x.lineWidth = 14; x.beginPath(); x.arc(rx + rw / 2, ry + 250, 50, 0, 5); x.stroke();
    x.fillStyle = yel; x.fillRect(rx + rw / 2 - 5, ry + 190, 10, 40);
  }
  { // «не входить»
    const [rx, ry, rw, rh] = rect('noent');
    x.strokeStyle = '#c24a2a'; x.lineWidth = 26; x.beginPath(); x.arc(rx + rw / 2, ry + rh / 2, 150, 0, 7); x.stroke();
    x.beginPath(); x.moveTo(rx + 100, ry + rh - 100); x.lineTo(rx + rw - 100, ry + 100); x.stroke();
    x.fillStyle = chalk; x.font = 'bold 40px Arial'; x.fillText('ВХОД ЗАПРЕЩЁН', rx + rw / 2, ry + rh - 24);
  }
  { // пыль/яд (трилистник)
    const [rx, ry, rw, rh] = rect('hazard'); const cx = rx + rw / 2, cy = ry + rh / 2 - 10;
    x.fillStyle = yel; x.beginPath(); x.arc(cx, cy, 160, 0, 7); x.fill();
    x.fillStyle = ink;
    for (let i = 0; i < 3; i++) { const a = i * 2.094 - 1.57; x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, 130, a - 0.5, a + 0.5); x.closePath(); x.fill(); }
    x.beginPath(); x.arc(cx, cy, 24, 0, 7); x.fill();
    x.fillStyle = chalk; x.font = 'bold 34px Arial'; x.fillText('ПЫЛЬ ПРЯНОСТИ · РЕСПИРАТОР', cx, ry + rh - 18);
  }
  { // вода
    const [rx, ry, rw, rh] = rect('water');
    x.fillStyle = 'rgba(30,60,80,0.85)'; x.fillRect(rx, ry, rw, rh);
    x.fillStyle = '#7fd0f0'; for (let i = 0; i < 3; i++) { const px = rx + 60 + i * 60; x.beginPath(); x.moveTo(px, ry + 36); x.quadraticCurveTo(px + 26, ry + 90, px, ry + 100); x.quadraticCurveTo(px - 26, ry + 90, px, ry + 36); x.fill(); }
    x.fillStyle = chalk; x.font = 'bold 30px Arial'; x.fillText('ВОДА — ЖИЗНЬ', rx + rw / 2 + 40, ry + 56);
    x.font = '22px Arial'; x.fillText('Не бросать · не лить · вернуть', rx + rw / 2, ry + 150);
    x.font = '20px Arial'; x.fillText('(рукой: «ни капли»)', rx + rw / 2, ry + 200);
  }
  { // записки
    const [rx, ry, rw, rh] = rect('notice');
    for (let i = 0; i < 3; i++) {
      x.save(); x.translate(rx + 70 + i * 120, ry + 130); x.rotate((R() - 0.5) * 0.2);
      x.fillStyle = ['#e2d6a8', '#d6c2a0', '#cfd6bc'][i]; x.fillRect(-52, -80, 104, 150);
      x.fillStyle = '#c24a2a'; x.beginPath(); x.arc(0, -72, 5, 0, 7); x.fill();
      x.strokeStyle = ink; x.lineWidth = 2; for (let l = 0; l < 7; l++) { x.beginPath(); x.moveTo(-40, -50 + l * 18); x.lineTo(-40 + 30 + R() * 50, -50 + l * 18 + (R() - 0.5) * 3); x.stroke(); }
      x.restore();
    }
  }
  { // выход
    const [rx, ry, rw, rh] = rect('exit');
    x.fillStyle = '#1d6b3c'; x.fillRect(rx, ry, rw, rh);
    x.fillStyle = chalk; x.font = 'bold 120px Arial'; x.textAlign = 'left'; x.fillText('ВЫХОД', rx + 30, ry + rh / 2);
    x.beginPath(); x.moveTo(rx + rw - 40, ry + rh / 2); x.lineTo(rx + rw - 140, ry + 40); x.lineTo(rx + rw - 140, ry + 90); x.lineTo(rx + rw - 230, ry + 90); x.lineTo(rx + rw - 230, ry + rh - 90); x.lineTo(rx + rw - 140, ry + rh - 90); x.lineTo(rx + rw - 140, ry + rh - 40); x.closePath(); x.fill();
    x.textAlign = 'center';
  }
  { // стрелка
    const [rx, ry, rw, rh] = rect('arrow');
    x.fillStyle = yel; x.beginPath(); x.moveTo(rx + 20, ry + 70); x.lineTo(rx + rw - 120, ry + 70); x.lineTo(rx + rw - 120, ry + 20); x.lineTo(rx + rw - 20, ry + rh / 2); x.lineTo(rx + rw - 120, ry + rh - 20); x.lineTo(rx + rw - 120, ry + rh - 70); x.lineTo(rx + 20, ry + rh - 70); x.closePath(); x.fill();
  }
  { // трафарет инструкции
    const [rx, ry, rw, rh] = rect('stencil');
    x.fillStyle = chalk; x.font = 'bold 34px "Courier New", monospace'; x.textAlign = 'left';
    ['ПУСК: КЛАКСОН 10 С', 'НЕ ВХОДИТЬ В ДРОБИЛКУ', 'ТАРА: ТОЛЬКО ПЕРЕНОСЧИК', 'ПРИ ЧЕРВЕ — В КАПСУЛУ'].forEach((s, i) => x.fillText(s, rx + 8, ry + 24 + i * 56));
    x.textAlign = 'center';
  }
  { // метки счёта
    const [rx, ry, rw, rh] = rect('tally');
    x.strokeStyle = chalk; x.lineWidth = 8;
    for (let g = 0; g < 6; g++) { const bx = rx + 24 + g * 58; for (let i = 0; i < 4; i++) { x.beginPath(); x.moveTo(bx + i * 9, ry + 30); x.lineTo(bx + i * 9, ry + rh - 30); x.stroke(); } x.beginPath(); x.moveTo(bx - 8, ry + rh - 40); x.lineTo(bx + 42, ry + 40); x.stroke(); }
  }
  { // шевроны
    const [rx, ry, rw, rh] = rect('chevw');
    x.fillStyle = yel; for (let i = 0; i < 12; i++) { const px = rx + i * 44; x.beginPath(); x.moveTo(px, ry + 10); x.lineTo(px + 24, ry + 10); x.lineTo(px + 44, ry + rh / 2); x.lineTo(px + 24, ry + rh - 10); x.lineTo(px, ry + rh - 10); x.lineTo(px + 20, ry + rh / 2); x.closePath(); x.fill(); }
  }
  for (const [k, txt] of [['num1', 'К-1'], ['num2', 'К-2'], ['num3', 'К-3']]) {
    const [rx, ry, rw, rh] = rect(k);
    x.fillStyle = '#202224'; x.fillRect(rx, ry, rw, rh); x.fillStyle = chalk; x.font = 'bold 40px Arial'; x.fillText(txt, rx + rw / 2, ry + rh / 2);
  }
  // стёртость краски
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2200; i++) { x.globalAlpha = 0.15 + R() * 0.5; x.beginPath(); x.arc(R() * IW, R() * IH, 1 + R() * 4, 0, 7); x.fill(); }
  x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

export function createInteriorDecalMaterial(tex) {
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  patchMaterial(mat, 'hv-intdec', { vertexPars: 'varying vec3 vWP;\n', vertexMain: 'vec3 transformed = vec3(position); vWP = (modelMatrix * vec4(position, 1.0)).xyz;\n', uniforms: { uIPow: INT_POWER }, fragPars: 'varying vec3 vWP;\nuniform float uIPow;\n', fragColor: '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.32, 1.0, uIPow);\n' });
  return mat;
}

/** Квады из списка {k,c,n,w,h,rot,tilt}: атлас — карта ключ→[u0,v0,u1,v1]; colorFn(c, n) → [r,g,b] (запечённый свет комнаты). */
export function buildQuads(list, atlas, FACE, colorFn, offset = 0.012) {
  const pos = [], uv = [], nor = [], col = [], idx = [];
  let vi = 0;
  for (const s of list) {
    const r = atlas[s.k]; if (!r || !(s.w > 0)) continue;
    const [u0, v0, u1, v1] = r;
    const F = FACE[s.n]; if (!F) continue;
    let a = new THREE.Vector3(...F.a), b = new THREE.Vector3(...F.b), n = new THREE.Vector3().crossVectors(a, b);
    if (s.tilt) { const t = s.tilt, n2 = n.clone().multiplyScalar(Math.cos(t)).addScaledVector(b, Math.sin(t)), b2 = b.clone().multiplyScalar(Math.cos(t)).addScaledVector(n, -Math.sin(t)); n = n2; b = b2; }
    const rot = s.rot || 0, cr = Math.cos(rot), sr = Math.sin(rot);
    const hw = s.w / 2, hh = s.h / 2;
    const cc = colorFn ? colorFn(s.c, n) : [1, 1, 1];
    for (const [px, py, u, v] of [[-hw, -hh, u0, v1], [hw, -hh, u1, v1], [hw, hh, u1, v0], [-hw, hh, u0, v0]]) {
      const qx = px * cr - py * sr, qy = px * sr + py * cr;
      pos.push(s.c[0] + a.x * qx + b.x * qy + n.x * offset, s.c[1] + a.y * qx + b.y * qy + n.y * offset, s.c[2] + a.z * qx + b.z * qy + n.z * offset);
      uv.push(u, 1 - v); nor.push(n.x, n.y, n.z); col.push(cc[0], cc[1], cc[2]);
    }
    idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3); vi += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ================================================================================== АТЛАС ЖИВЫХ ЭКРАНОВ (8 ячеек 256x256)
export function createScreenAtlas() {
  const W = 1024, H = 512, C = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const R = rng(99);
  const bars = Array.from({ length: 8 }, () => R());
  const cellUV = (k) => { const i = k % 4, j = Math.floor(k / 4); return [i * C / W, j * C / H, (i + 1) * C / W, (j + 1) * C / H]; };
  const G = '#7fe0a0', A = '#ffb347', Bl = '#6fd0ff', Rr = '#ff5a3c';
  const cell = (k, fn) => { const i = k % 4, j = Math.floor(k / 4); x.save(); x.translate(i * C, j * C); x.beginPath(); x.rect(0, 0, C, C); x.clip(); fn(); x.restore(); };
  const frame = (col) => { x.fillStyle = '#04100c'; x.fillRect(0, 0, C, C); x.strokeStyle = col; x.lineWidth = 3; x.strokeRect(4, 4, C - 8, C - 8); };
  let lastT = -1;
  function draw(t, S) {
    if (t - lastT < 0.2) return false;
    lastT = t;
    const run = S.eng || 0, belt = S.belt || 0;
    for (let i = 0; i < 8; i++) bars[i] += (R() - 0.5) * 0.12 * (0.2 + run);
    cell(0, () => {      // радар
      frame(G); x.strokeStyle = 'rgba(127,224,160,0.5)'; x.lineWidth = 1;
      for (let r = 1; r <= 4; r++) { x.beginPath(); x.arc(128, 128, r * 28, 0, 7); x.stroke(); }
      x.beginPath(); x.moveTo(128, 20); x.lineTo(128, 236); x.moveTo(20, 128); x.lineTo(236, 128); x.stroke();
      const a = t * 2.2;
      for (let k = 0; k < 20; k++) { x.strokeStyle = `rgba(127,224,160,${(1 - k / 20) * 0.5})`; x.lineWidth = 4; x.beginPath(); x.moveTo(128, 128); x.lineTo(128 + Math.cos(a - k * 0.04) * 108, 128 + Math.sin(a - k * 0.04) * 108); x.stroke(); }
      x.fillStyle = A; x.fillRect(150, 90, 6, 6); x.fillRect(86, 150, 6, 6);
      x.fillStyle = Rr; const w = (t * 0.1) % 1; x.fillRect(60 + w * 100, 70 + Math.sin(w * 6) * 20, 7, 7);
    });
    cell(1, () => {      // обороты и давление
      frame(A); x.strokeStyle = A; x.lineWidth = 8; x.beginPath(); x.arc(128, 150, 70, Math.PI * 0.8, Math.PI * 2.2); x.stroke();
      const v = 0.15 + 0.8 * run * (0.92 + 0.08 * Math.sin(t * 5)); const ang = Math.PI * 0.8 + v * Math.PI * 1.4;
      x.strokeStyle = Rr; x.lineWidth = 5; x.beginPath(); x.moveTo(128, 150); x.lineTo(128 + Math.cos(ang) * 62, 150 + Math.sin(ang) * 62); x.stroke();
      x.fillStyle = A; x.font = 'bold 22px "Courier New"'; x.textAlign = 'center'; x.fillText('ОБ/МИН', 128, 34); x.fillText(String(Math.round(v * 3200)), 128, 224);
    });
    cell(2, () => {      // выход пряности
      frame(A);
      for (let i = 0; i < 8; i++) { const h = (0.2 + 0.7 * Math.min(1, Math.max(0, bars[i] * 0.6 + 0.3 * belt))) * 150 * (0.3 + 0.7 * belt); x.fillStyle = i % 2 ? A : '#e07020'; x.fillRect(24 + i * 28, 210 - h, 20, h); }
      x.fillStyle = A; x.font = 'bold 20px "Courier New"'; x.textAlign = 'left'; x.fillText('ВЫХОД, т/ч', 18, 32); x.fillText((belt * 180).toFixed(0), 18, 56);
    });
    cell(3, () => {      // схема ленты
      frame(Bl); x.strokeStyle = Bl; x.lineWidth = 6; x.beginPath(); x.moveTo(24, 200); x.lineTo(110, 110); x.lineTo(232, 110); x.stroke();
      x.fillStyle = A; for (let i = 0; i < 8; i++) { const p = ((i / 8 + t * 0.2 * belt) % 1); const px = p < 0.4 ? 24 + p / 0.4 * 86 : 110 + (p - 0.4) / 0.6 * 122, py = p < 0.4 ? 200 - p / 0.4 * 90 : 110; x.fillRect(px - 5, py - 8, 10, 10); }
      x.font = 'bold 20px "Courier New"'; x.textAlign = 'left'; x.fillStyle = Bl; x.fillText('ЛЕНТА-1', 18, 36);
    });
    cell(4, () => {      // журнал
      frame(G); x.fillStyle = G; x.font = '18px "Courier New"'; x.textAlign = 'left';
      const L = ['> СИСТЕМА ГОТОВА', '> ДРОБИЛКА ' + (belt > 0.1 ? 'РАБОТАЕТ' : 'СТОИТ'), '> КЛАПАН 3: ОК', '> ВОДА: 88%', '> ГРУЗ: ' + Math.round(belt * 61) + '%', '> ' + (run > 0.1 ? 'ТЯГА НОРМА' : 'ДВИГАТЕЛЬ ВЫКЛ'), '> ' + Math.floor(t * 10 % 99) + ' СИГНАЛ'];
      L.forEach((s, i) => x.fillText(s, 14, 40 + i * 28));
    });
    cell(5, () => {      // температуры двигателей
      frame(Rr);
      for (let i = 0; i < 6; i++) { const hh = (0.25 + 0.55 * run) * (0.7 + 0.3 * bars[i]) * 170; x.fillStyle = hh > 130 ? Rr : A; x.fillRect(22 + i * 36, 215 - hh, 26, hh); }
      x.fillStyle = Rr; x.font = 'bold 20px "Courier New"'; x.textAlign = 'left'; x.fillText('ТЕМП. ЦИЛ.', 18, 30);
    });
    cell(6, () => {      // карта
      frame(G); x.strokeStyle = 'rgba(127,224,160,0.5)'; x.lineWidth = 1;
      for (let k = 0; k < 8; k++) { x.beginPath(); for (let i = 0; i <= 30; i++) { const tt = i / 30; const px = 12 + tt * 232, py = 30 + k * 26 + Math.sin(tt * 6 + k + t * 0.05) * 12; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); }
      x.strokeStyle = A; x.lineWidth = 2; x.setLineDash([6, 5]); x.beginPath(); x.arc(128, 128, 54, 0, 7); x.stroke(); x.setLineDash([]);
      x.fillStyle = Rr; x.beginPath(); x.arc(128 + Math.cos(t * 0.3) * 54, 128 + Math.sin(t * 0.3) * 54, 6, 0, 7); x.fill();
      x.fillStyle = G; x.fillRect(122, 122, 12, 12);
    });
    cell(7, () => {      // «окно»: дюны на закате (для ложных световых панелей)
      const g = x.createLinearGradient(0, 0, 0, C); g.addColorStop(0, '#6c84a8'); g.addColorStop(0.55, '#e8b27a'); g.addColorStop(0.56, '#c88a50'); g.addColorStop(1, '#8a5a30');
      x.fillStyle = g; x.fillRect(0, 0, C, C);
      x.fillStyle = '#b87a44'; x.beginPath(); x.moveTo(0, 180); for (let i = 0; i <= 16; i++) x.lineTo(i * 16, 150 + Math.sin(i * 0.7) * 22 + (i % 3) * 6); x.lineTo(C, C); x.lineTo(0, C); x.fill();
      x.fillStyle = '#fff3d0'; x.beginPath(); x.arc(190, 110, 22, 0, 7); x.fill();
    });
    tex.needsUpdate = true;
    return true;
  }
  draw(1e9 * 0 + 0.3, { eng: 0, belt: 0 });
  return { tex, cellUV, draw };
}
