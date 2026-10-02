// Окружение для освещения по изображению (IBL): сборочный цех/ангар — высокий потолок с рядами светильников,
// светлые стены, остекление ворот. Сцена строится процедурно и запекается PMREM в карту окружения:
// именно её отражают металл и лак, поэтому детали выглядят «как в цеху», а не как в пустом 3D-редакторе.
import * as THREE from 'three';

function basic(color, k = 1) {
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.color.multiplyScalar(k);            // >1 — источник света в HDR
  return m;
}

function lamp(k) { return new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.97, 0.92).multiplyScalar(k) }); }

/** Сцена «цех»: 48 × 14 × 36 м. */
export function hangarScene() {
  const s = new THREE.Scene();
  const W = 48, H = 14, D = 36;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const add = (m, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(box, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); s.add(o); return o; };
  // стены: светло-серые панели, нижний пояс темнее (оборудование, стеллажи)
  add(basic('#7d8288', 0.55), W, H, D, 0, H / 2 - 1.2, 0);
  add(new THREE.MeshBasicMaterial({ color: new THREE.Color('#3b3d40').multiplyScalar(0.6) }), W - 0.2, 0.1, D - 0.2, 0, -1.15, 0);   // пол
  for (const z of [-D / 2 + 0.3, D / 2 - 0.3]) add(new THREE.MeshBasicMaterial({ color: new THREE.Color('#4a4f55').multiplyScalar(0.5) }), W - 1, 3, 0.4, 0, 0.3, z);
  // ворота ангара: дневной свет (холоднее ламп)
  add(new THREE.MeshBasicMaterial({ color: new THREE.Color('#cfe0f2').multiplyScalar(3.2) }), 0.2, 7, 16, W / 2 - 0.2, 3.3, -2);
  add(new THREE.MeshBasicMaterial({ color: new THREE.Color('#dbe7f5').multiplyScalar(1.6) }), 22, 2.2, 0.2, -4, 9.5, -D / 2 + 0.2);   // ленточное остекление
  // ряды линейных светильников под фермами
  for (let x = -20; x <= 20; x += 5) for (let z = -14; z <= 14; z += 7) add(lamp(9), 0.35, 0.08, 4.2, x, H - 2.6, z);
  // фермы перекрытия: тёмные балки дают «рисунок» в отражениях
  for (let x = -22.5; x <= 22.5; x += 5) add(new THREE.MeshBasicMaterial({ color: '#1e2024' }), 0.25, 1.1, D, x, H - 1.9, 0);
  // местный софтбокс над рабочим местом — мягкий блик сверху на деталях
  add(lamp(5), 3, 0.05, 1.4, 0, 4.2, 0);
  return s;
}

/** Запечь окружение. Возвращает текстуру PMREM для scene.environment и scene.background. */
export function bakeEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(hangarScene(), 0.02, 0.1, 100).texture;
  pmrem.dispose();
  return env;
}
