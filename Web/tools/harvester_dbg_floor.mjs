// Отладка: цвета вершин пола в запечённой комнате (без браузера).
import { Plan } from '../src/harvester/ibuild.js';
import { Parts } from '../src/harvester/parts.js';
import { gallery, corridor } from '../src/harvester/rooms_a.js';
for (const f of [gallery, corridor]) {
  const R = f(new Plan(), new Parts(4));
  const g = R.P.merge();
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color, tag = g.attributes.aTag;
  let n = 0; const mn = [9, 9, 9], mx = [0, 0, 0], sum = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(nor.getY(i) - 1) < 0.01 && Math.abs(pos.getY(i) - 10.6) < 0.01 && tag.getX(i) === 5) {
      n++;
      for (let c = 0; c < 3; c++) { const v = col.array[i * 3 + c]; mn[c] = Math.min(mn[c], v); mx[c] = Math.max(mx[c], v); sum[c] += v; }
    }
  }
  console.log(R.id, 'floor verts', n, 'min', mn.map((v) => v.toFixed(3)), 'max', mx.map((v) => v.toFixed(3)), 'avg', sum.map((v) => (v / n).toFixed(3)));
}
