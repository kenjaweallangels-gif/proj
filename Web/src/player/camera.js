// Камера: 3-е лицо через плечо (пружинная штанга) ↔ 1-е лицо (покачивание головы), тряска, ресинк после кат-сцен.
// Углы: yaw — курс atan2(dz, dx) (как в layout.js), pitch > 0 — взгляд вверх.
import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, damp, lerp, smoothstep, noise2, DEG } from '../core/util.js';

export function createCameraRig(game, p) {
  const C = CFG.camera;
  const cam = game.camera;
  const rig = { yaw: p.yaw, pitch: C.tpPitch0, fp: false, blend: 0, frozen: false };
  const pivot = new THREE.Vector3().copy(p.position);
  const src = () => p.renderPos || p.position; // интерполированная позиция игрока
  let dipPos = 0, dipVel = 0;
  const dir = new THREE.Vector3(), right = new THREE.Vector3(), head = new THREE.Vector3(), want = new THREE.Vector3();
  const tpPos = new THREE.Vector3(), fpPos = new THREE.Vector3(), pos = new THREE.Vector3(), probe = new THREE.Vector3();
  const look = new THREE.Vector3(), wallQ = new THREE.Vector3();
  const snapPos = new THREE.Vector3(), snapQuat = new THREE.Quaternion(), tmpQ = new THREE.Quaternion();
  let armFrac = 1, fov = C.fov, bobPhase = 0, bobAmt = 0, resyncT = -1, wasFrozen = false, photo = false, breath = 0;

  game.bus.on('photo', (e) => { photo = !!e?.active; });

  const frozenNow = () => game.cinematic.active || photo;

  function snap(yaw) {
    if (yaw !== undefined) rig.yaw = yaw;
    rig.pitch = rig.fp ? 0 : C.tpPitch0;
    pivot.copy(src()); armFrac = 1; resyncT = -1; dipPos = dipVel = 0;
    rig.blend = rig.fp ? 1 : 0;
  }

  Object.assign(rig, {
    snap,
    /** Приземление: пружинная «вмятина» камеры вниз (impact — скорость удара, м/с). */
    dip(impact) { dipVel -= Math.min(2.6, 0.45 + impact * 0.13); },
    setFirstPerson(b) { rig.fp = !!b; p.firstPerson = rig.fp; },
    toggle() { rig.setFirstPerson(!rig.fp); },
    /** Применяет ввод look (вызывается в update игрока). */
    look(dt, blocked) {
      if (blocked || frozenNow()) return;
      const l = game.input.look;
      rig.yaw += l.x * DEG;
      rig.pitch -= l.y * DEG;
      const lim = rig.fp ? C.fpPitchLimit : null;
      rig.pitch = lim ? clamp(rig.pitch, -lim, lim) : clamp(rig.pitch, C.tpPitchMin, C.tpPitchMax);
    },
    /** Расчёт и применение к game.camera (lateUpdate). */
    apply(dt, t) {
      // Тряска: игрок применяет и гасит game.shake; гул червя добавляется.
      const rumble = (game.worm?.threat ?? 0) * C.rumbleScale;
      const shake = clamp(game.shake + rumble, 0, 1.2);
      game.shake = Math.max(0, game.shake * Math.exp(-dt * C.shakeDecay) - dt * 0.05);

      if (frozenNow()) { wasFrozen = true; return; }
      if (wasFrozen) {
        // Кат-сцена закончилась: запомнить текущий кадр камеры и плавно вернуться за спину игрока.
        wasFrozen = false;
        snapPos.copy(cam.position); snapQuat.copy(cam.quaternion);
        rig.yaw = p.yaw; rig.pitch = rig.fp ? 0 : C.tpPitch0;
        pivot.copy(src()); armFrac = 1; resyncT = 0;
      }
      rig.blend = damp(rig.blend, rig.fp ? 1 : 0, C.blendLambda, dt);
      const b = smoothstep(0, 1, rig.blend);
      const pp = src();
      pivot.x = damp(pivot.x, pp.x, C.followLambda, dt);
      pivot.z = damp(pivot.z, pp.z, C.followLambda, dt);
      // по вертикали — лёгкое сглаживание (ступеньки рельефа/сетки не дёргают камеру), при падении камера чуть отстаёт — ощущение скорости
      pivot.y = Math.abs(pp.y - pivot.y) > 6 ? pp.y : damp(pivot.y, pp.y, C.followLambdaY, dt);
      // пружина приземления (затухающая)
      dipVel += (-C.dipK * dipPos - C.dipC * dipVel) * dt; dipPos += dipVel * dt;
      if (Math.abs(dipPos) < 1e-4 && Math.abs(dipVel) < 1e-3) dipPos = dipVel = 0;

      const cp = Math.cos(rig.pitch), sp = Math.sin(rig.pitch);
      dir.set(cp * Math.cos(rig.yaw), sp, cp * Math.sin(rig.yaw));
      right.set(-Math.sin(rig.yaw), 0, Math.cos(rig.yaw));

      // --- 3-е лицо: штанга от головы к желаемой точке, укорачивается у земли/стен ---
      const run = smoothstep(3.5, 6, p.speed);
      const dist = lerp(C.tpDist, C.tpDistRun, run);
      head.copy(pivot); head.y += C.tpHeight;
      want.copy(head).addScaledVector(right, C.shoulder).addScaledVector(dir, -dist);
      let frac = 1;
      const NP = C.armProbes;
      for (let i = 1; i <= NP; i++) {
        const k = i / NP;
        probe.lerpVectors(head, want, k);
        let bad = probe.y < game.heightAt(probe.x, probe.z) + C.groundClearance;
        // Стены проверяем на уровне ступней игрока: многоуровневые полы (сиетч) выбирают этаж по y.
        if (!bad && i > 1) { wallQ.set(probe.x, pivot.y + 0.1, probe.z); bad = game.collide(wallQ, 0.25); }
        if (bad) { frac = Math.max(0.12, (i - 1) / NP); break; }
      }
      armFrac = frac < armFrac ? frac : damp(armFrac, frac, C.armOutLambda, dt);
      tpPos.lerpVectors(head, want, armFrac);
      tpPos.y = Math.max(tpPos.y, game.heightAt(tpPos.x, tpPos.z) + C.groundClearance);

      // --- 1-е лицо: голова + покачивание ---
      const sp2 = p.speed;
      const moving = clamp(sp2 / 3, 0, 1.3);
      bobAmt = damp(bobAmt, moving * (sp2 > 4.5 ? 1.25 : 1), 8, dt);
      bobPhase += dt * Math.PI * (sp2 > 0.4 ? 1 / Math.max(0.2, p.stepIntervalNow || 0.5) : 0);
      breath += dt * (p.parched ? 1.6 : 0.9) * Math.PI * 2 * 0.3;
      const breathAmp = p.parched ? 0.012 : 0.004;
      const bobY = -Math.abs(Math.sin(bobPhase)) * C.bobAmp * bobAmt + Math.sin(breath) * breathAmp * 0.5;
      const bobX = Math.sin(bobPhase) * C.bobSway * bobAmt;
      fpPos.set(pivot.x, pivot.y + CFG.eye + bobY, pivot.z)
        .addScaledVector(right, bobX)
        .addScaledVector(look.set(Math.cos(rig.yaw), 0, Math.sin(rig.yaw)), 0.12);

      pos.lerpVectors(tpPos, fpPos, b);
      pos.y += dipPos;

      // --- Тряска (perlin) ---
      let dyaw = 0, roll = Math.sin(bobPhase) * 0.004 * bobAmt * b;
      let dpitch = Math.sin(breath) * (p.parched ? 0.008 : 0.002) * b;
      if (shake > 0.001) {
        const s = shake;
        pos.x += noise2(t * 17, 1.7) * C.shakePos * s;
        pos.y += noise2(t * 19, 8.3) * C.shakePos * s;
        pos.z += noise2(t * 15, 4.1) * C.shakePos * s;
        dyaw += noise2(t * 13, 11.9) * C.shakeRot * s;
        dpitch += noise2(t * 14, 21.3) * C.shakeRot * s;
        roll += noise2(t * 11, 31.7) * C.shakeRoll * s;
      }

      cam.position.copy(pos);
      const y = rig.yaw + dyaw, pch = rig.pitch + dpitch, c2 = Math.cos(pch);
      look.set(pos.x + c2 * Math.cos(y), pos.y + Math.sin(pch), pos.z + c2 * Math.sin(y));
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

      // FOV: шире на бегу
      const wantFov = C.fov + C.fovRun * smoothstep(3.5, 6, p.speed) * (1 - b) + C.fovFP * b * smoothstep(3.5, 6, p.speed);
      fov = damp(fov, wantFov, 4, dt);
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    },
  });
  return rig;
}
