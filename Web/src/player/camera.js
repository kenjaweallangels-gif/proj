// Камера от первого лица: «живая» голова (покачивание от шагов, лёгкая инерция поворота, вмятина при приземлении, рваный ритм
// походки по песку, расширение FOV на рывке) и столкновение головы — сфера радиуса C.headRadius не должна оказываться
// внутри камня, потолка, корпуса харвестера и вне пространства игрока (сиетч / борт харвестера / пустыня).
// Углы: yaw — курс atan2(dz, dx) (как в layout.js), pitch > 0 — взгляд вверх. Вида от третьего лица больше нет.
import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, damp, dampAngle, smoothstep, noise2 } from '../core/util.js';
import { DEG } from '../core/util.js';

/** Критически демпфированная пружина (точное решение), s = [x, v]. */
function spring(s, target, omega, dt) {
  const d = s[0] - target, e = Math.exp(-omega * dt), t = s[1] + omega * d;
  s[0] = target + (d + t * dt) * e;
  s[1] = (s[1] - omega * t * dt) * e;
  return s[0];
}
const E = Math.E;

export function createCameraRig(game, p) {
  const C = CFG.camera;
  const cam = game.camera;
  const rig = { yaw: p.yaw, pitch: 0, fp: true, blend: 1, frozen: false, stats: { blocked: 0, frames: 0 } };
  const pivot = new THREE.Vector3().copy(p.position);
  const src = () => p.renderPos || p.position; // интерполированная позиция игрока
  let dipPos = 0, dipVel = 0;
  const right = new THREE.Vector3(), fwd = new THREE.Vector3(), eye = new THREE.Vector3(), anchor = new THREE.Vector3(), tst = new THREE.Vector3(), look = new THREE.Vector3(), feet = new THREE.Vector3(), fbuf = new THREE.Vector3();
  const probe = { type: 'sphere', c: tst, r: C.headRadius };
  const IGN = new Set(['player', 'companion:Ilva', 'companion:Rayn', 'companion:Ossana', 'worm']);
  const IGN_ON_BOARD = new Set([...IGN, 'harvester']);
  const snapPos = new THREE.Vector3(), snapQuat = new THREE.Quaternion(), tmpQ = new THREE.Quaternion();
  let vyaw = p.yaw, vpitch = 0, yawRate = 0, lastVyaw = p.yaw;
  let fov = C.fov, resyncT = -1, wasFrozen = false, photo = false, breath = 0, fracNow = 1;
  // пружины покачивания: [значение, скорость]
  const bob = { y: [0, 0], x: [0, 0], roll: [0, 0], pitch: [0, 0], surge: [0, 0], swayT: 0, rollT: 0, amp: 0 };
  let pIn = false, pOn = false; // игрок в сиетче / на борту харвестера (считаем раз в кадр)

  game.bus.on('photo', (e) => { photo = !!e?.active; });
  const frozenNow = () => game.cinematic.active || photo;

  function snap(yaw) {
    if (yaw !== undefined) rig.yaw = yaw;
    rig.pitch = 0; vyaw = rig.yaw; vpitch = 0; lastVyaw = vyaw; yawRate = 0;
    pivot.copy(src()); resyncT = -1; dipPos = dipVel = 0; fracNow = 1;
    for (const k of ['y', 'x', 'roll', 'pitch', 'surge']) { bob[k][0] = bob[k][1] = 0; }
  }

  // ------------------------------------------------------------------ столкновение головы ----
  /** Точка pt (центр сферы головы) внутри твёрдого или вне пространства игрока? */
  function blockedAt(pt) {
    const r = C.headRadius;
    const sietch = game.sietch, hv = game.harvester, ap = game.approach, vol = ap?.volume;
    // земля (с учётом этажа по высоте ступней игрока)
    if (pt.y < game.heightAt(pt.x, pt.z, p.position.y + 0.5) + C.groundClearance) return true;
    // сиетч: пещера — SDF, из которого запечён меш (стены, потолок, пол); снаружи пещеры допустима лишь ниша подхода (меш уровня)
    if (sietch?.contains) {
      const ptIn = sietch.contains(pt);
      if (pIn) {
        if (ptIn) { if (sietch.airDist(pt) > -r) return true; }
        else if (!(vol && vol.inZone(pt.x, pt.z, 0) && vol.sample(pt.x, pt.y, pt.z) >= r)) return true;
      } else if (ptIn && sietch.airDist(pt) < 0.1) return true; // игрок снаружи, а камера в пустоте пещеры — «вид изнутри через стену»
    }
    // скала подхода и Коготь (3D SDF) — для игрока вне сиетча
    if (!pIn && vol && vol.inside(pt.x, pt.y, pt.z) && vol.sample(pt.x, pt.y, pt.z) < r) return true;
    // харвестер: борт (комнаты/перегородки/перекрытия — его API) и корпус снаружи (тела реестра)
    if (hv?.contains) {
      feet.set(pt.x, pt.y - CFG.eye, pt.z);
      const ptOn = hv.contains(feet);
      if (pOn !== ptOn) return true;
      if (pOn && hv.collide) { fbuf.set(pt.x, pt.y - 1.0, pt.z); if (hv.collide(fbuf, r)) return true; }
    }
    // прочие твёрдые тела (валуны, прилавки, постройки сада); люди (npc) камеру не загораживают
    tst.copy(pt);
    const hits = game.colliders.overlaps(probe, { ignore: pOn ? IGN_ON_BOARD : IGN });
    for (let i = 0; i < hits.length; i++) if (!hits[i].entry.tags?.has?.('npc')) return true;
    return false;
  }
  /** Доля пути anchor→eye, до которой голова свободна (1 — вся). Бисекция по первой «плохой» точке. */
  function freeFrac() {
    if (!blockedAt(eye)) return 1;
    let lo = 0, hi = 1;
    for (let it = 0; it < 6; it++) {
      const mid = (lo + hi) / 2;
      tst.lerpVectors(anchor, eye, mid);
      if (blockedAt(tst)) hi = mid; else lo = mid;
    }
    return lo;
  }

  Object.assign(rig, {
    snap,
    /** Приземление: пружинная «вмятина» камеры вниз (impact — скорость удара, м/с). */
    dip(impact) { dipVel -= Math.min(5, 0.8 + impact * 0.2); },
    /** Шаг (из анимации скрытой фигуры): e = {side 0|1, intensity 0..1, mode 'walk'|'run'|'desert'}. Бьёт по пружинам головы. */
    step(e) {
      if (game.settings?.headBob === false) return;
      const sand = e.mode === 'desert', run = e.mode === 'run';
      // песок: глубже и медленнее, с «проваливанием» — ритм ощущается в камере
      const k = (run ? 1.35 : sand ? 1.7 : 1) * clamp(0.6 + (e.intensity ?? 0.5) * 0.8, 0.6, 1.5);
      const om = sand ? 9 : run ? 20 : 16;
      bob.y[1] -= C.bobAmp * k * om * E;
      bob.pitch[1] -= C.bobPitch * k * om * E;
      const sg = e.side ? 1 : -1;
      bob.swayT = sg * C.bobSway * k; bob.rollT = -sg * C.bobRoll * k;
      bob.om = om;
    },
    /** Применяет ввод look (вызывается в update игрока). */
    look(dt, blocked) {
      if (blocked || frozenNow()) return;
      const l = game.input.look;
      rig.yaw += l.x * DEG;
      rig.pitch = clamp(rig.pitch - l.y * DEG, -C.fpPitchLimit, C.fpPitchLimit);
    },
    /** Расчёт и применение к game.camera (lateUpdate). */
    apply(dt, t) {
      const rumble = game.space === 'desert' ? (game.worm?.threat ?? 0) * (game.worm?.threat ?? 0) * C.rumbleScale : 0;
      const shake = clamp(game.shake + rumble, 0, 1.2);
      game.shake = Math.max(0, game.shake * Math.exp(-dt * C.shakeDecay) - dt * 0.05);

      if (frozenNow()) { wasFrozen = true; return; }
      if (wasFrozen) {
        // Кат-сцена закончилась: запомнить текущий кадр камеры и плавно вернуться в голову игрока.
        wasFrozen = false;
        snapPos.copy(cam.position); snapQuat.copy(cam.quaternion);
        rig.yaw = p.yaw; rig.pitch = 0; vyaw = rig.yaw; vpitch = 0; lastVyaw = vyaw;
        pivot.copy(src()); resyncT = 0; fracNow = 1;
      }
      const pp = src();
      pivot.x = pp.x; pivot.z = pp.z;
      // по вертикали — лёгкое сглаживание (ступеньки лестниц/рельефа не дёргают голову)
      pivot.y = Math.abs(pp.y - pivot.y) > 6 ? pp.y : damp(pivot.y, pp.y, C.followLambdaY, dt);
      // пружина приземления (затухающая)
      dipVel += (-C.dipK * dipPos - C.dipC * dipVel) * dt; dipPos += dipVel * dt;
      if (Math.abs(dipPos) < 1e-4 && Math.abs(dipVel) < 1e-3) dipPos = dipVel = 0;

      // --- инерция поворота: видимый курс/тангаж чуть отстают от «прицела» ---
      vyaw = dampAngle(vyaw, rig.yaw, C.turnLambda, dt);
      vpitch = damp(vpitch, rig.pitch, C.turnLambda, dt);
      let dy = vyaw - lastVyaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); lastVyaw = vyaw;
      yawRate += (dy / dt - yawRate) * (1 - Math.exp(-12 * dt));

      // --- покачивание ---
      const sp2 = p.speed, moving = clamp(sp2 / 2.5, 0, 1) * (p.grounded ? 1 : 0.2);
      const bobOn = game.settings?.headBob !== false;
      const om = bob.om || 16;
      spring(bob.y, 0, om, dt); spring(bob.pitch, 0, om, dt);
      spring(bob.x, bob.swayT * moving, 10, dt); spring(bob.roll, bob.rollT * moving, 10, dt);
      // песок: «рваный» ритм — кабина подаётся вперёд/назад вместе с огибающей шага
      let surgeT = 0, lurchPitch = 0;
      if (bobOn && p.moveMode === 'desert' && sp2 > 0.3) {
        const env = clamp((p.figure?.gait?.env ?? 0.7) - 0.7, -0.6, 0.8);
        surgeT = env * C.sandSurge; lurchPitch = env * C.sandLurch;
      }
      spring(bob.surge, surgeT, 7, dt);
      breath += dt * (p.parched ? 1.6 : 0.9) * Math.PI * 2 * 0.3;
      const breathAmp = p.parched ? 0.012 : 0.004;

      right.set(-Math.sin(vyaw), 0, Math.cos(vyaw));
      fwd.set(Math.cos(vyaw), 0, Math.sin(vyaw));
      const pitchV = vpitch + (bobOn ? bob.pitch[0] : 0) + lurchPitch + Math.sin(breath) * (p.parched ? 0.008 : 0.002);

      // --- положение головы: желаемая точка → проверка столкновений (сфера головы) ---
      const hy = pivot.y + CFG.eye + (bobOn ? bob.y[0] : 0) + Math.sin(breath) * breathAmp * 0.5 + dipPos;
      eye.set(pivot.x, hy, pivot.z)
        .addScaledVector(right, bobOn ? bob.x[0] : 0)
        .addScaledVector(fwd, 0.1 + (bobOn ? bob.surge[0] : 0));
      pIn = !!game.sietch?.contains?.(p.position);
      pOn = !!game.harvester?.contains?.(p.position);
      anchor.set(pp.x, pivot.y + 0.9, pp.z);
      const fr = freeFrac();
      // сжатие — мгновенно (безопасность), возврат — плавно (без рывка)
      fracNow = fr < fracNow ? fr : damp(fracNow, fr, C.armOutLambda, dt);
      rig.stats.frames++; if (fracNow < 0.999) rig.stats.blocked++;
      cam.position.lerpVectors(anchor, eye, fracNow);

      // --- тряска (perlin) ---
      let dyaw = 0, dpitch = 0, roll = (bobOn ? bob.roll[0] : 0) - clamp(yawRate * C.turnRoll, -0.03, 0.03);
      if (shake > 0.001) {
        const s = shake;
        cam.position.x += noise2(t * 3.1, 1.7) * C.shakePos * s;
        cam.position.y += noise2(t * 3.7, 8.3) * C.shakePos * s;
        cam.position.z += noise2(t * 2.9, 4.1) * C.shakePos * s;
        dyaw += noise2(t * 2.3, 11.9) * C.shakeRot * s;
        dpitch += noise2(t * 2.6, 21.3) * C.shakeRot * s;
        roll += noise2(t * 1.9, 31.7) * C.shakeRoll * s;
      }
      const y = vyaw + dyaw, pch = pitchV + dpitch, c2 = Math.cos(pch);
      look.set(cam.position.x + c2 * Math.cos(y), cam.position.y + Math.sin(pch), cam.position.z + c2 * Math.sin(y));
      cam.lookAt(look);
      if (roll) cam.rotateZ(roll);

      if (resyncT >= 0) {
        resyncT += dt;
        const e = smoothstep(0, 1, resyncT / C.resyncSec);
        cam.position.lerpVectors(snapPos, cam.position, e);
        tmpQ.copy(cam.quaternion);
        cam.quaternion.copy(snapQuat).slerp(tmpQ, e);
        if (resyncT >= C.resyncSec) resyncT = -1;
      }

      // FOV: шире на рывке
      const wantFov = C.fov + C.fovRun * smoothstep(3.5, 6, p.speed);
      fov = damp(fov, wantFov, 4, dt);
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    },
  });
  return rig;
}
