// Финал «Глотка Бога» (~20 с): облёт зала от свода вниз по лучу к чаше (танцовщица), затем к наибу Хармату,
// который оборачивается к камере. Камера ставится в render-обёртке и lateUpdate (в обход игрока).
import * as THREE from 'three';
import { HALL } from './plan.js';
import { clamp, smoothstep, lerp } from '../core/util.js';

export function createFinale(ctx, crowd) {
  const { game, root, origin: O } = ctx;
  const out = { active: false, t: 0, dur: 20.5 };
  const cx = HALL.cx, cz = HALL.cz;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  const ptsPos = [], ptsLook = [];
  // Часть 1 (0–7 с): у свода, по дуге вокруг шахты, вниз к лучу.
  for (let i = 0; i <= 8; i++) {
    const k = i / 8, a = Math.PI * 1.02 + k * Math.PI * 0.95, r = lerp(13.5, 8.2, k);
    ptsPos.push(v(cx + Math.cos(a) * r, lerp(21.5, 13.5, k), cz + Math.sin(a) * r * 0.85));
    ptsLook.push(v(cx, lerp(23, 9, k), cz));
  }
  // Часть 2 (7–13 с): спуск вдоль луча к чаше.
  for (let i = 1; i <= 5; i++) {
    const k = i / 5, a = Math.PI * 1.97 + k * 0.55, r = lerp(7.2, 3.0, smoothstep(0, 1, k));
    ptsPos.push(v(cx + Math.cos(a) * r, lerp(11, 0.1, Math.pow(k, 0.85)), cz + Math.sin(a) * r));
    ptsLook.push(v(cx, lerp(6, -1.2, k), cz));
  }
  // Часть 3 (13–20 с): к Хармату (камера идёт через зал, цель — наиб).
  const H = () => crowd.harmat;
  const curvePos = new THREE.CatmullRomCurve3(ptsPos, false, 'centripetal');
  const curveLook = new THREE.CatmullRomCurve3(ptsLook, false, 'centripetal');
  const tmp = v(0, 0, 0), look = v(0, 0, 0), pos = v(0, 0, 0);
  const smooth = (x) => x * x * (3 - 2 * x);
  let resolve = null, promise = null, hold = false, fov0 = 62;
  const camHarmat = v(0, 0, 0), lookHarmat = v(0, 0, 0);

  function pose(t) {
    const T1 = 13.0;
    if (t < T1) {
      const u = clamp(t / T1, 0, 1);
      // неравномерная скорость: медленный вход, чуть быстрее в середине
      const e = u < 0.5 ? 0.5 * Math.pow(u * 2, 1.25) : 1 - 0.5 * Math.pow((1 - u) * 2, 1.25);
      curvePos.getPoint(e, pos); curveLook.getPoint(e, look);
      // в конце части 2 цель плавно уходит на танцовщицу
      const dn = crowd.dancer;
      const w = smoothstep(9.5, 13, t);
      look.lerp(v(dn.x, dn.y + 1.0, dn.z), w);
      return;
    }
    // Хармат: камера плывёт от чаши к тиру, затем замедляется перед лицом.
    const h = H();
    const u = clamp((t - T1) / (out.dur - T1), 0, 1);
    const e = smooth(u);
    const hx = h.x, hz = h.z, hy = h.y + h.lk.height * 0.93;
    const start = curvePos.getPoint(1, tmp).clone();
    const end = v(hx - 2.45, h.y + 1.55, hz - 0.45);
    const mid = v(lerp(start.x, end.x, 0.55), lerp(start.y, end.y, 0.5) + 0.4, lerp(start.z, end.z, 0.55) + 1.8);
    // квадратичная кривая Безье
    const a = start.clone().lerp(mid, e), b = mid.clone().lerp(end, e);
    pos.copy(a.lerp(b, e));
    const dn = crowd.dancer;
    const lw = smoothstep(0.1, 0.55, u);
    look.set(lerp(dn.x, hx, lw), lerp(dn.y + 1.0, hy, lw), lerp(dn.z, hz, lw));
  }

  const apply = () => {
    if (!out.active) return;
    const cam = game.camera;
    cam.position.set(pos.x + O.x, pos.y + O.y, pos.z + O.z);
    // лёгкое «дыхание» камеры
    const t = out.t;
    cam.position.x += Math.sin(t * 0.9) * 0.02; cam.position.y += Math.sin(t * 1.3 + 1) * 0.015;
    cam.lookAt(look.x + O.x, look.y + O.y, look.z + O.z);
    const roll = Math.sin(t * 0.35) * 0.012;
    cam.rotateZ(roll);
    const fov = lerp(74, 52, smoothstep(12, 20, t)) ;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  };
  // Подмена render, чтобы камера выставлялась после всех модулей (игрок и т. п.).
  const prevRender = game.render;
  game.render = function (dt) { apply(); return prevRender.call(this, dt); };

  out.update = (dt) => {
    if (!out.active) return;
    out.t += dt;
    const t = out.t;
    pose(t);
    // Хармат оборачивается ближе к концу.
    const h = H();
    h.faceCam = smoothstep(14.5, 19.5, t);
    const hl = ctx.lighting?.heroLight;
    if (hl) { const k = smoothstep(12, 16, t); hl.intensity = 34 * k; hl.position.set(h.x - 1.6, h.y + 2.3, h.z - 1.2); }
    if (t >= out.dur) finish();
  };
  function finish() {
    out.active = false;
    if (ctx.lighting?.heroLight) ctx.lighting.heroLight.intensity = 0;
    if (!hold) { game.cinematic = { active: false, owner: null }; game.player?.setInputLocked?.(false); game.camera.fov = fov0; game.camera.updateProjectionMatrix(); }
    game.bus.emit('cinematic', { active: false, id: 'HallFinale' });
    resolve?.(); resolve = null;
  }
  out.play = (o = {}) => {
    if (out.active && promise) return promise;
    fov0 = game.camera.fov;
    hold = !!o.hold;
    out.active = true; out.t = 0;
    game.cinematic = { active: true, owner: 'sietch' };
    game.player?.setInputLocked?.(true);
    game.bus.emit('cinematic', { active: true, id: 'HallFinale' });
    pose(0); apply();
    promise = new Promise((r) => { resolve = r; });
    return promise;
  };
  out.stop = () => { if (out.active) finish(); };
  return out;
}
