// 3D-визуализация перехода ТП голограммами (слой дисплея очков): деталь летит со стеллажа на место, клей
// в пазы, уголки и винты «вкручиваются», жгут «прорастает» по трассе, окраска и плёнка — траекторией инструмента,
// контроль — размерной линией с допуском, выдержка — таймером у узла. Локальный режим — только элементы
// в выбранной точке узла, с выносками обозначений.
import * as THREE from 'three';
import { HOLO, LAYER_HOLO, setLayer } from '../engine/holo.js';
import * as S from './spec.js';

const AMBER = new THREE.Color('#ffc845'), CYAN = HOLO.part, GREEN = HOLO.ok;

function holoLine(pts, color = CYAN, opacity = 0.95) {
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  return setLayer(l, LAYER_HOLO);
}

function holoMat(color, opacity = 0.25) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
}

/** Подпись-выноска (спрайт в слое голограмм). Размер — по высоте строки, м. */
export function holoLabel(lines, { color = '#dcf6ff', accent = '#58e6ff', h = 0.05 } = {}) {
  const L = [].concat(lines);
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = '600 44px "IBM Plex Sans Condensed", "IBM Plex Sans", sans-serif';
  const w = Math.ceil(Math.max(...L.map((t) => g.measureText(t).width)) + 40);
  c.width = w; c.height = 58 * L.length + 16;
  g.strokeStyle = accent; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, c.height - 4);
  g.fillStyle = 'rgba(88,230,255,0.10)'; g.fillRect(2, 2, w - 4, c.height - 4);
  L.forEach((t, i) => { g.font = `${i ? 400 : 600} ${i ? 36 : 44}px "IBM Plex Sans Condensed", "IBM Plex Sans", sans-serif`; g.fillStyle = i ? color : accent; g.fillText(t, 20, 50 + i * 58); });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false }));
  const hh = h * L.length * 1.15;
  s.scale.set((hh * c.width) / c.height, hh, 1);
  s.center.set(0, 0);
  s.renderOrder = 30;
  return setLayer(s, LAYER_HOLO);
}

export class StepViz {
  constructor(world, scene) {
    this.world = world; this.scene = scene;
    this.galley = world.galley;
    this.root = new THREE.Group(); this.root.name = 'viz';
    this.galley.root.add(this.root);          // мм, СК модуля
    this.labels = new THREE.Group(); scene.add(this.labels);   // м, мир
    this.items = [];                          // анимируемые элементы
    this.step = null; this.mode = 'step';
    this.t = 0;
    this.overlay = null;
  }

  m2w(p) { return this.galley.root.localToWorld(new THREE.Vector3(...p)); }
  w2m(v) { return this.galley.root.worldToLocal(v.clone()); }

  clear() {
    for (const o of [...this.root.children]) { this.root.remove(o); }
    for (const o of [...this.labels.children]) this.labels.remove(o);
    this.items = [];
  }

  /** Источник детали (мир): панель на стеллаже или лоток на тележке комплектации. */
  sourceOf(id) {
    const k = this.world.kit.get(id);
    if (k && k.visible) return k.getWorldPosition(new THREE.Vector3());
    return this.world.cart.localToWorld(new THREE.Vector3(0, 1.0, 0));
  }

  label(id, at, extra = [], i = 0) {
    const f = S.featureById.get(id);
    if (!f) return;
    const pw = this.m2w(at);
    const k = this.mode === 'local' ? 0.32 : 1;          // вблизи (осмотр узла) — мелкие выноски веером
    const lab = holoLabel([f.designation || id, f.name || '', ...extra].filter(Boolean).slice(0, 3), { h: 0.042 * k });
    const off = new THREE.Vector3((0.12 + 0.03 * (i % 3)) * k, (0.1 + 0.075 * i) * k, 0.18 * k);
    lab.position.copy(pw).add(off);
    this.labels.add(lab, holoLine([pw, lab.position.clone()], CYAN, 0.8));
  }

  /** Показать переход (или локальный набор элементов). */
  show(step, { features = null, focus = null } = {}) {
    this.clear();
    this.step = step; this.t = 0;
    this.mode = features ? 'local' : 'step';
    const ids = features || step?.parts || [];
    const kind = features ? 'local' : step?.kind;
    let nLabels = 0;
    const lab = (id, at, extra) => { if (nLabels < (features ? 6 : 5)) this.label(id, at, extra, nLabels++); };

    for (const id of ids) {
      const f = S.featureById.get(id);
      if (!f) continue;
      const center = S.featureCenter(f);
      if (f.kind === 'joint') { this.addGlue([id], true); lab(id, center); continue; }
      if (f.kind === 'insert' || f.kind === 'screw') { this.addScrew(f, 0); lab(id, f.pos, f.torqueNm ? [`момент ${String(f.torqueNm).replace('.', ',')} Н·м`] : []); continue; }
      if (f.kind === 'paint') continue;
      const h = this.galley.makeHolo(id, kind === 'fasten' || f.kind === 'bracket' ? AMBER : CYAN);
      if (!h) continue;
      this.root.add(h);
      const it = { h, id, kind: f.kind, center };
      if (kind === 'install') {
        const src = this.w2m(this.sourceOf(id));
        it.fly = { off: new THREE.Vector3(src.x - center[0], src.y - center[1], src.z - center[2]) };
      }
      if (f.kind === 'harness' || f.kind === 'water') it.grow = true;
      if (f.kind === 'bracket') { it.bracket = f; for (const sid of f.screws) this.addScrew(S.featureById.get(sid), 0.5); }
      if (f.kind === 'door') it.door = f;
      this.items.push(it);
      lab(id, center);
    }
    if (step && !features) {
      if (step.kind === 'glue') this.addGlue(step.joints);
      if (step.kind === 'fasten') for (const s of step.fasteners) { const f = S.featureById.get(s); if (f?.kind === 'screw' && !step.parts.includes(f.bracket)) this.addScrew(f, 0); }
      if (step.measure) this.addMeasure(step);
      if (step.kind === 'paint') this.addSprayPath();
      if (step.kind === 'film') for (const id of step.parts) this.addFilmSweep(id);
      if (step.timer && step.kind === 'wait') this.addTimer(step);
      if (!ids.length && step.joints.length) this.addGlue(step.joints);
    }
    if (focus) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(30, 34, 48), holoMat(GREEN, 0.8));
      ring.position.set(...focus);
      setLayer(ring, LAYER_HOLO);
      this.root.add(ring);
      this.items.push({ ring });
    }
  }

  addGlue(joints, local = false) {
    for (const jid of joints) {
      for (const g of S.GROOVES.filter((x) => x.joint === jid)) {
        const size = g.max.map((v, i) => v - g.min[i] + 4);
        const m = new THREE.Mesh(new THREE.BoxGeometry(...size), holoMat(AMBER, 0.45));
        m.position.set(...g.min.map((v, i) => (v + g.max[i]) / 2));
        setLayer(m, LAYER_HOLO);
        m.add(setLayer(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: AMBER, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })), LAYER_HOLO));
        this.root.add(m);
        this.items.push({ glue: m, phase: Math.random() * 6 });
      }
      if (local) {
        // шип панели a: голограмма «входит» в паз и выходит
        const j = S.jointById.get(jid);
        const h = this.galley.makeHolo(j.a, CYAN);
        if (h) {
          const sb = S.slab(S.panelById.get(j.b));
          const ab = S.panelBox(S.panelById.get(j.a));
          const dir = new THREE.Vector3(); dir.setComponent(sb.axis, (ab.min[sb.axis] + ab.max[sb.axis]) / 2 > sb.hi ? 1 : -1);
          this.root.add(h);
          this.items.push({ h, slide: dir.multiplyScalar(60) });
        }
      }
    }
  }

  addScrew(f, delay) {
    if (!f) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 2, 12, 12), holoMat(AMBER, 0.6));
    setLayer(m, LAYER_HOLO);
    const [ax, s] = f.into;
    const dir = new THREE.Vector3(); dir.setComponent(ax, s);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    this.root.add(m);
    this.items.push({ screw: m, pos: new THREE.Vector3(...f.pos), dir, delay });
  }

  addMeasure(step) {
    const a = new THREE.Vector3(...step.measure.from), b = new THREE.Vector3(...step.measure.to);
    const l = holoLine([a, b], GREEN);
    this.root.add(l);
    for (const p of [a, b]) { const t = new THREE.Mesh(new THREE.SphereGeometry(8, 12, 8), holoMat(GREEN, 0.9)); t.position.copy(p); setLayer(t, LAYER_HOLO); this.root.add(t); }
    const c = step.check;
    const lab = holoLabel([`${c.name}`, `${String(c.nominal).replace('.', ',')}${c.tol ? ` ± ${String(c.tol).replace('.', ',')}` : ''} ${c.unit}`], { h: 0.03, accent: '#5dffa8' });
    lab.position.copy(this.m2w(a.clone().add(b).multiplyScalar(0.5).toArray()));
    this.labels.add(lab);
    this.items.push({ measure: l });
  }

  addSprayPath() {
    // змейка распыления по внутренним отсекам: 250 мм перед проёмом, шаг по высоте 120 мм
    const pts = [];
    for (let y = 1980, k = 0; y > 60; y -= 120, k++) {
      const z = y > 1500 ? 820 : y > 1105 ? 820 : 1080;
      pts.push(new THREE.Vector3(k % 2 ? 800 : -800, y, z), new THREE.Vector3(k % 2 ? -800 : 800, y, z));
    }
    const l = holoLine(pts, AMBER, 0.5);
    this.root.add(l);
    const gun = new THREE.Mesh(new THREE.ConeGeometry(70, 220, 24, 1, true), holoMat(AMBER, 0.25));
    gun.rotation.x = -Math.PI / 2;
    setLayer(gun, LAYER_HOLO);
    this.root.add(gun);
    this.items.push({ spray: gun, path: pts });
  }

  addFilmSweep(id) {
    const f = S.featureById.get(id);
    const p = S.panelById.get(f.panel);
    if (!p || p.plane !== 'ZY') return;
    const x = p.outerFace === 'lo' ? p.offset - p.t - 6 : p.offset + 6;
    const pts = S.sideProfile().map(([z, y]) => new THREE.Vector3(x, y, z));
    pts.push(pts[0].clone());
    this.root.add(holoLine(pts, CYAN));
    const bar = new THREE.Mesh(new THREE.BoxGeometry(4, 2000, 30), holoMat(GREEN, 0.5));
    bar.position.set(x, 1025, 0);
    setLayer(bar, LAYER_HOLO);
    this.root.add(bar);
    this.items.push({ sweep: bar });
  }

  addTimer(step) {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false }));
    s.scale.set(0.32, 0.32, 1);
    s.position.copy(this.m2w([0, 1300, 900]));
    setLayer(s, LAYER_HOLO);
    this.labels.add(s);
    this.items.push({ timer: { c, tex, stepId: step.id } });
  }

  /** Контур главного вида 1:1 на изделии (из КД): линии на передней плоскости модуля. */
  setOverlay(on) {
    if (this.overlay) { this.galley.root.remove(this.overlay); this.overlay = null; }
    if (!on) return;
    const z = S.G.D + 40;
    const seg = [];
    const R = (x0, y0, x1, y1) => { seg.push([x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]); };
    R(-850, 0, 850, 2050); R(-825, 1080, 825, 1105); R(-825, 1500, 825, 1519); R(-825, 2031, 825, 2050);
    for (const b of S.BAYS) R(b.x0, 25, b.x1, 1080);
    for (const d of S.DOORS) R(d.x0, d.y0, d.x1, d.y1);
    const pts = seg.flatMap(([a, b, c, d]) => [new THREE.Vector3(a, b, z), new THREE.Vector3(c, d, z)]);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    this.overlay = setLayer(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#ffd45a', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })), LAYER_HOLO);
    this.galley.root.add(this.overlay);
  }

  /** Привязка голограмм к изделию: только у очков с 6DoF и камерами (3DoF не знает, где стапель). */
  setAnchored(on) {
    this.anchored = on;
    this.root.visible = on; this.labels.visible = on;
    if (this.overlay) this.overlay.visible = on;
  }

  update(dt, run) {
    this.t += dt;
    const t = this.t;
    const cyc = 3.6, k = (t % cyc) / 2.4, fly = Math.min(1, k), ease = fly * fly * (3 - 2 * fly);
    for (const it of this.items) {
      if (it.h && it.fly) {
        const lift = Math.sin(Math.PI * ease) * 250;
        it.h.position.copy(it.fly.off).multiplyScalar(1 - ease);
        it.h.position.y += lift;
        const done = fly >= 1;
        it.h.userData.holoFill.color.copy(done ? GREEN : CYAN);
        it.h.userData.holoLine.color.copy(done ? GREEN : CYAN);
        it.h.userData.holoFill.opacity = done ? 0.18 + 0.1 * Math.sin(t * 6) : 0.24;
      } else if (it.h && it.slide) {
        const s = 0.5 + 0.5 * Math.cos(t * 2.2);
        it.h.position.copy(it.slide).multiplyScalar(s);
      } else if (it.h && it.grow) {
        it.h.traverse((o) => { if (o.isMesh && o.geometry.index) o.geometry.setDrawRange(0, Math.floor(o.geometry.index.count * Math.min(1, (t % 4) / 3))); });
      } else if (it.h && it.door) {
        it.h.rotation.y = (it.door.hinge === 'L' ? -1 : 1) * Math.max(0, Math.sin(t * 1.2)) * 1.2;
      } else if (it.h) {
        it.h.userData.holoFill.opacity = 0.1 + 0.08 * Math.sin(t * 4);
      }
      if (it.glue) it.glue.material.opacity = 0.25 + 0.25 * Math.sin(t * 5 + it.phase);
      if (it.screw) {
        const s = Math.min(1, Math.max(0, ((t - it.delay) % 3) / 1.6));
        it.screw.position.copy(it.pos).addScaledVector(it.dir, -(1 - s) * 40);
        it.screw.rotateY(dt * 14 * (s < 1 ? 1 : 0));
        it.screw.material.opacity = s >= 1 ? 0.25 : 0.6;
      }
      if (it.spray) {
        const P = it.path, u = (t * 0.08) % 1, n = P.length - 1, i = Math.floor(u * n), f = u * n - i;
        it.spray.position.lerpVectors(P[i], P[Math.min(n, i + 1)], f).add(new THREE.Vector3(0, 0, 160));
      }
      if (it.sweep) it.sweep.position.z = ((t * 160) % 860);
      if (it.ring) { it.ring.scale.setScalar(1 + 0.25 * Math.sin(t * 4)); it.ring.quaternion.copy(this.galley.root.quaternion); }
      if (it.timer && run) {
        const tm = run.timers.find((x) => x.step === it.timer.stepId && !x.done);
        const g = it.timer.c.getContext('2d');
        g.clearRect(0, 0, 256, 256);
        g.lineWidth = 14; g.strokeStyle = 'rgba(88,230,255,0.35)'; g.beginPath(); g.arc(128, 128, 100, 0, Math.PI * 2); g.stroke();
        if (tm) {
          const left = run.remaining(tm), tot = tm.endMin - tm.startMin, kk = 1 - left / tot;
          g.strokeStyle = '#ffc845'; g.beginPath(); g.arc(128, 128, 100, -Math.PI / 2, -Math.PI / 2 + kk * Math.PI * 2); g.stroke();
          g.fillStyle = '#dcf6ff'; g.font = '600 46px "IBM Plex Mono", monospace'; g.textAlign = 'center';
          g.fillText(`${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`, 128, 140);
          g.font = '400 22px "IBM Plex Sans", sans-serif'; g.fillText('ч:мин', 128, 172);
        } else { g.fillStyle = '#5dffa8'; g.font = '600 40px "IBM Plex Sans", sans-serif'; g.textAlign = 'center'; g.fillText('готово', 128, 140); }
        it.timer.tex.needsUpdate = true;
      }
    }
  }
}
