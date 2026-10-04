// Метки на камне: три зарубки (знак «путь свободен», фрименская резьба), крюк творца, неуклюжая роспись возрожденцев.
// Текстуры рисуются на canvas: тёмная канавка + светлая кромка (читается как выцарапанное).
import * as THREE from 'three';

function strokeGroove(g, path, w) {
  g.lineCap = 'round'; g.lineJoin = 'round';
  // светлая кромка снизу-справа
  g.strokeStyle = 'rgba(235,205,160,0.55)'; g.lineWidth = w * 0.9;
  g.save(); g.translate(w * 0.35, w * 0.35); path(); g.stroke(); g.restore();
  // тёмная канавка
  g.strokeStyle = 'rgba(30,18,10,0.92)'; g.lineWidth = w;
  path(); g.stroke();
  g.strokeStyle = 'rgba(8,4,2,0.9)'; g.lineWidth = w * 0.45;
  path(); g.stroke();
}

export function markTexture(kind) {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  if (kind === 'notches') {
    // три косые зарубки разной длины
    const xs = [70, 128, 186], hs = [150, 176, 140];
    xs.forEach((x, i) => strokeGroove(g, () => { g.beginPath(); g.moveTo(x - 10, 128 - hs[i] / 2); g.lineTo(x + 8, 128 + hs[i] / 2); }, 15));
  } else if (kind === 'hook') {
    // крюк творца: дуга с острым концом и засечками
    strokeGroove(g, () => { g.beginPath(); g.moveTo(104, 226); g.bezierCurveTo(100, 150, 78, 96, 130, 60); g.bezierCurveTo(172, 34, 214, 70, 198, 112); g.lineTo(178, 130); }, 15);
    strokeGroove(g, () => { for (let i = 0; i < 3; i++) { g.moveTo(84 + i * 3, 196 - i * 42); g.lineTo(118 + i * 3, 188 - i * 42); } }, 9);
  } else if (kind === 'sigil') {
    // «неумелая роспись»: охристая рука/спираль, нанесённая пальцем
    g.strokeStyle = 'rgba(150,50,30,0.8)'; g.lineWidth = 12; g.lineCap = 'round';
    g.beginPath(); for (let a = 0; a < 12; a += 0.2) { const r = 8 + a * 8; const x = 128 + Math.cos(a) * r * 0.9 + (a % 1) * 2, y = 128 + Math.sin(a) * r * 0.9; if (a === 0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke();
    g.strokeStyle = 'rgba(120,36,22,0.7)'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(56, 210); g.lineTo(210, 206); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function markMaterial(kind) {
  const m = new THREE.MeshStandardMaterial({ map: markTexture(kind), transparent: true, roughness: 1, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.fog = false;
  return m;
}
