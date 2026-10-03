import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { findDynamic, freezeStatic } from '../src/galley/perf.js';

const box = (mat, x, sx = 1) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat); m.position.set(x, 0, 0); m.scale.x = sx; return m; };
const bounds = (o) => new THREE.Box3().setFromObject(o);

describe('слияние неподвижных сеток', () => {
  it('сливает статичное по материалу, двигающееся оставляет', () => {
    const root = new THREE.Group(); root.position.set(5, 0, 1); root.rotation.y = 0.7;
    const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial();
    const s1 = box(a, 0), s2 = box(a, 0.5), s3 = box(a, 1.0, -1), s4 = box(b, 1.5), mover = box(a, 2), kept = box(a, 2.5);
    root.add(s1, s2, s3, s4, mover, kept);
    const before = bounds(root);
    const dyn = findDynamic(root, (mark) => { mover.position.y = 1; mark(); mover.position.y = 0; mark(); });
    expect(dyn.has(mover)).toBe(true);
    expect(dyn.has(s1)).toBe(false);
    const removed = freezeStatic(root, { dynamic: dyn, exclude: [kept] });
    expect(removed).toBe(3);                                       // s1, s2, s3 (материал a); s4 — один на материал b
    expect(mover.parent).toBe(root); expect(kept.parent).toBe(root); expect(s4.parent).toBe(root);
    const merged = root.children.find((o) => o.name === 'static');
    expect(merged.material).toBe(a);
    expect(merged.geometry.index.count).toBe(36 * 3);
    const after = bounds(root);
    expect(after.min.distanceTo(before.min)).toBeLessThan(1e-4);
    expect(after.max.distanceTo(before.max)).toBeLessThan(1e-4);
  });

  it('зеркальный масштаб: нормали наружу (порядок обхода исправлен)', () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial();
    root.add(box(mat, 0, -1), box(mat, 3, -1));
    freezeStatic(root);
    const g = root.children[0].geometry, p = g.attributes.position, ix = g.index.array;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < 36; i += 3) {
      A.fromBufferAttribute(p, ix[i]); B.fromBufferAttribute(p, ix[i + 1]); C.fromBufferAttribute(p, ix[i + 2]);
      n.subVectors(C, B).cross(c.subVectors(A, B));
      const mid = c.copy(A).add(B).add(C).divideScalar(3);
      expect(n.dot(mid)).toBeGreaterThan(0);                       // нормаль треугольника — от центра куба наружу
    }
  });

  it('луч по слитой сетке попадает туда же, что и по исходным', () => {
    const mk = () => {
      const root = new THREE.Group(); root.position.set(2, 0, -1);
      const mat = new THREE.MeshBasicMaterial();
      for (let i = 0; i < 6; i++) { const m = box(mat, i * 0.5); m.position.z = (i % 2) * 0.3; root.add(m); }
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat); plane.position.set(1, 0, 2); root.add(plane);
      root.updateMatrixWorld(true);
      return root;
    };
    const a = mk(), b = mk();
    freezeStatic(b);
    expect(b.children.length).toBeLessThan(7);
    expect(b.children.some((c) => c.name === 'static')).toBe(true);
    const rc = new THREE.Raycaster();
    for (const [o, d] of [[[0, 0, 5], [0.42, 0, -1]], [[3, 0.05, 5], [0, 0, -1]], [[4.5, 0, 5], [0.1, 0, -1]], [[-5, 0, 0], [1, 0, 0]], [[-5, 0, -1], [1, 0, 0]]]) {
      rc.set(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize());
      const ha = rc.intersectObject(a, true)[0], hb = rc.intersectObject(b, true)[0];
      expect(!!hb).toBe(!!ha);
      if (ha) expect(hb.distance).toBeCloseTo(ha.distance, 5);
    }
  });
});
