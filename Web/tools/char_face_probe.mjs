// Отладка поверхности лица: профиль z вдоль линии глаз. node tools/char_face_probe.mjs
import { faceParams, faceSurface } from '../src/player/char_face.js';
const P = faceParams({ seed: 5, height: 1.2, build: 'c' });
const S = faceSurface(P);
console.log('eye', JSON.stringify(S.eye));
for (const y of [0.02, 0.014, 0.008]) {
  const row = [];
  for (let a = 0.2; a <= 1.2; a += 0.04) { const p = S.pt(a, y); row.push(`${p.x.toFixed(3)}:${p.z.toFixed(4)}`); }
  console.log('y', y, row.join(' '));
}
