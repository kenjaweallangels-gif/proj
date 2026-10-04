// 3D-просмотрщик для виртуальной сборки на three.js.
// Детали модели сопоставляются с шагами по обозначению в имени узла; по мере «прогресса»
// (0 … N шагов) детали прилетают из разнесённого состояния на место. Несопоставленные узлы — статичны.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export const normCode = (s: string) => s.toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, "");

interface Props { url: string; codes: string[]; progress: number; highlight: number; explode?: number; onMatched?: (n: number, total: number) => void; className?: string }

export default function Viewer3D({ url, codes, progress, highlight, explode = 1, onMatched, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const st = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; groups: { obj: THREE.Object3D; base: THREE.Vector3; dir: THREE.Vector3; step: number; mats: THREE.MeshStandardMaterial[] }[]; diag: number; raf: number } | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [err, setErr] = useState("");

  // --- инициализация сцены и загрузка модели
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth || 300, el.clientHeight || 300);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
    const dl = new THREE.DirectionalLight(0xffffff, 1.2); dl.position.set(1, 2, 1.5); scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0xffffff, 0.5); dl2.position.set(-2, -1, -1); scene.add(dl2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const state = { renderer, scene, camera, controls, groups: [] as NonNullable<typeof st.current>["groups"], diag: 1, raf: 0 };
    st.current = state;
    const loop = () => { state.raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
    loop();
    const ro = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); });
    ro.observe(el);

    const loader = new GLTFLoader();
    const tok = localStorage.getItem("plm.access");
    if (tok) loader.setRequestHeader({ Authorization: `Bearer ${tok}` });
    setStatus("loading");
    loader.load(url, (gltf) => {
      const root = gltf.scene;
      scene.add(root);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const center = box.getCenter(new THREE.Vector3());
      const diag = Math.max(box.getSize(new THREE.Vector3()).length(), 1e-3);
      state.diag = diag;
      // камера
      camera.position.copy(center).add(new THREE.Vector3(diag * 0.9, diag * 0.6, diag * 0.9));
      camera.near = diag / 1000; camera.far = diag * 100; camera.updateProjectionMatrix();
      controls.target.copy(center); controls.update();
      // сопоставление узлов с шагами
      const normCodes = codes.map(normCode);
      const taken = new Set<THREE.Object3D>();
      const groups: typeof state.groups = [];
      const tryMatch = (name: string) => { const n = normCode(name); if (!n) return -1; let best = -1, bestLen = 0; normCodes.forEach((c, i) => { if (c.length >= 3 && n.includes(c) && c.length > bestLen) { best = i; bestLen = c.length; } }); return best; };
      root.traverse((o) => {
        if (taken.has(o)) return;
        const idx = tryMatch(o.name);
        if (idx < 0) return;
        // не брать потомков уже взятого узла
        let p: THREE.Object3D | null = o.parent; while (p) { if (taken.has(p)) return; p = p.parent; }
        taken.add(o);
        const b = new THREE.Box3().setFromObject(o);
        if (b.isEmpty()) return;
        const c = b.getCenter(new THREE.Vector3());
        const dir = c.clone().sub(center); if (dir.length() < 1e-6) dir.set(0, 1, 0); dir.normalize();
        const mats: THREE.MeshStandardMaterial[] = [];
        o.traverse((m) => { const mesh = m as THREE.Mesh; if (mesh.isMesh) { const arr = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; mesh.material = arr.length === 1 ? (arr[0] as THREE.Material).clone() : arr.map((x) => x.clone()); const mm = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; mm.forEach((x) => { if ((x as THREE.MeshStandardMaterial).isMeshStandardMaterial) mats.push(x as THREE.MeshStandardMaterial); }); } });
        groups.push({ obj: o, base: o.position.clone(), dir, step: idx, mats });
      });
      state.groups = groups;
      onMatched?.(new Set(groups.map((g) => g.step)).size, codes.length);
      setStatus("ok");
      apply();
    }, undefined, (e) => { setErr(String((e as Error).message ?? e)); setStatus("error"); });

    return () => { cancelAnimationFrame(state.raf); ro.disconnect(); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); st.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // --- применение прогресса / подсветки
  const apply = () => {
    const s = st.current; if (!s) return;
    for (const g of s.groups) {
      const t = THREE.MathUtils.clamp(progress - g.step, 0, 1); // 0 — ещё не поставлена, 1 — на месте
      const ease = 1 - Math.pow(1 - t, 3);
      const off = s.diag * 0.6 * explode * (1 - ease);
      // локальное смещение: переводим мировой вектор в систему родителя
      const parent = g.obj.parent;
      const world = g.dir.clone().multiplyScalar(off);
      if (parent) { const q = new THREE.Quaternion(); parent.getWorldQuaternion(q); world.applyQuaternion(q.invert()); }
      g.obj.position.copy(g.base).add(world);
      const isCur = g.step === highlight;
      const visibleAlpha = t < 0.02 ? 0.12 : 1;
      for (const m of g.mats) { m.transparent = visibleAlpha < 1 || isCur; m.opacity = isCur ? 1 : visibleAlpha; m.emissive = new THREE.Color(isCur ? 0x2457d6 : 0x000000); m.emissiveIntensity = isCur ? 0.6 : 0; }
    }
  };
  useEffect(apply, [progress, highlight, explode]);

  return (
    <div className={`v3d ${className ?? ""}`} ref={host}>
      {status === "loading" && <div className="v3d-msg">Загрузка 3D-модели…</div>}
      {status === "error" && <div className="v3d-msg err">Не удалось загрузить модель: {err}</div>}
    </div>
  );
}
