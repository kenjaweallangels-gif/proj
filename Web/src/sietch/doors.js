// Двери-уплотнители (doorseals): изогнутые полупрозрачные пластиковые мембраны, которые сворачиваются в рулон к краям проёма
// (рулоны уходят в вертикальные карманы, вырезанные в скале). Автооткрытие с шипением и конденсатом; bus 'interact' {tag:'Rakis.SealDoor'}.
// Третий уплотнитель (цистерна) сдвинут навсегда, проход закрыт кованой решёткой.
import * as THREE from 'three';
import { SEALS } from './cave/layout.js';
import { registerDoor, addBlock, heightAtLocal } from './plan.js';
import { clamp, smoothstep } from '../core/util.js';
import { U } from './mats.js';

const ROLL_T = 0.02; // толщина мембраны в навитом виде
function sealMaterial(glow) {
  const m = new THREE.MeshStandardMaterial({
    color: '#cdbd98', roughness: 0.22, metalness: 0.05, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, flatShading: true,
    emissive: new THREE.Color(glow[0] * 0.9, glow[1] * 0.75, glow[2] * 0.5).multiplyScalar(0.55),
  });
  const uOpen = { value: 0 };
  m.userData.uOpen = uOpen;
  m.customProgramCacheKey = () => 'siet-seal';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uOpen = uOpen; sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aS; attribute float aL; attribute float aSide; uniform float uOpen; uniform float uTime;
varying float vRoll; varying float vYw; varying float vEdge;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float L = aL; float Lw = clamp(uOpen, 0.0, 1.0) * L; float roll = 0.0;
  vYw = position.y; vEdge = 1.0 - smoothstep(0.0, 0.1, aS);
  float flex = 0.014 * sin(position.y * 4.5 + uTime * 1.3 + aS * 3.0) * (1.0 - clamp(uOpen * 3.0, 0.0, 1.0) * 0.0);
  transformed.x += flex;
  if (aS < Lw) {
    float r0 = 0.03; float T = ${ROLL_T.toFixed(3)};
    float th = (-r0 + sqrt(r0 * r0 + T * aS / 3.14159265)) / (T / 6.2831853);
    float thM = (-r0 + sqrt(r0 * r0 + T * Lw / 3.14159265)) / (T / 6.2831853);
    float rr = r0 + T * th / 6.2831853; float R = r0 + T * thM / 6.2831853;
    float phi = -1.5707963 - (thM - th);
    float sRoll = Lw + R * cos(phi) + rr * 0.0;
    float xRoll = R + rr * sin(phi);
    transformed.z = aSide * (Lw + (rr * cos(phi)) );
    transformed.x = position.x + xRoll + flex;
    roll = 1.0;
  }
  vRoll = roll;
}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vRoll; varying float vYw; varying float vEdge;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float rib = smoothstep(0.82, 1.0, abs(sin(vYw * 17.0)));
  diffuseColor.rgb *= (1.0 - 0.28 * rib) * (1.0 - 0.45 * vEdge);
  diffuseColor.a = clamp(diffuseColor.a * (1.0 + 0.7 * rib + 0.9 * vEdge + vRoll * 0.9), 0.0, 0.95);
}`);
  };
  return m;
}

function leafGeometry(d, side, fy) {
  const NU = 26, NV = 44;
  const pos = [], aS = [], aL = [], aSd = [], uv = [], idx = [];
  const top = d.yc + d.rh + 0.04, y0 = fy - 0.05;
  const widthAt = (y) => { const k = (y - (fy + d.yc)) / (d.rh * 1.05); return d.hw * 1.1 * Math.sqrt(Math.max(0.03, 1 - k * k)) + 0.14; };
  for (let j = 0; j <= NV; j++) {
    const y = y0 + ((top - y0) * j) / NV;
    const W = widthAt(y);
    for (let i = 0; i <= NU; i++) {
      const s = -0.02 + ((W + 0.02) * i) / NU;
      const bow = 0.1 * (1 - Math.min(1, (s / W) ** 2)) * (0.6 + 0.4 * Math.sin(Math.min(1, (y - y0) / (top - y0)) * Math.PI));
      pos.push(bow, y, side * s); aS.push(Math.max(0, s)); aL.push(W); aSd.push(side); uv.push(i / NU, j / NV);
    }
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, e = c + 1; idx.push(a, b, e, a, e, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
  g.setAttribute('aL', new THREE.Float32BufferAttribute(aL, 1)); g.setAttribute('aSide', new THREE.Float32BufferAttribute(aSd, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, fy + 1.3, 0), 3.5);
  return g;
}

export function createDoors(ctx, crowd) {
  const { game, root, origin: O, probes } = ctx;
  const doors = [];
  const rubber = new THREE.MeshStandardMaterial({ color: '#2b2824', roughness: 0.55, metalness: 0.2 });
  const brass = new THREE.MeshStandardMaterial({ color: '#b08a48', roughness: 0.4, metalness: 0.85 });
  const lampMat = (c) => new THREE.MeshBasicMaterial({ color: c, fog: true });
  for (const d of SEALS) {
    const fy = heightAtLocal(d.x, d.z, 0);
    const grp = new THREE.Group(); grp.name = `SealDoor_${d.id}`;
    grp.position.set(d.x, 0, d.z);
    if (d.axis === 'z') grp.rotation.y = Math.PI / 2;
    root.add(grp);
    const gl = probes.sample(d.x, fy + 1.4, d.z);
    const glow = [gl.r, gl.g, gl.b];
    const mat = sealMaterial(glow);
    const leaves = [];
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(leafGeometry(d, side, fy), mat);
      m.renderOrder = 4; m.frustumCulled = false;
      grp.add(m); leaves.push(m);
    }
    // обод-прокладка (эластомер + клёпки): эллипс вокруг проёма
    const pts = [];
    const rx = d.hw * 1.12 + 0.05, ry = d.rh * 1.08;
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2; pts.push(new THREE.Vector3(0.0, fy + d.yc + Math.sin(a) * ry, Math.cos(a) * rx)); }
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, 0.075, 8, true), rubber);
    grp.add(tube);
    const ring2 = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(0.1, p.y, p.z * 1.0)), true), 96, 0.025, 6, true), rubber);
    grp.add(ring2);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + 0.1;
      const y = fy + d.yc + Math.sin(a) * ry;
      if (y < fy + 0.15) continue;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 4), brass);
      b.position.set(-0.07, y, Math.cos(a) * rx); grp.add(b);
    }
    // пульт: пластина с сигнальной лампой на стене у проёма
    for (const sg of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.16), new THREE.MeshStandardMaterial({ color: '#4a4036', roughness: 0.6, metalness: 0.5 }));
      plate.position.set(-0.18, fy + 1.15, sg * (d.hw + 0.55)); grp.add(plate);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), lampMat(0xffa23c));
      lamp.position.set(-0.215, fy + 1.2, sg * (d.hw + 0.55)); grp.add(lamp);
      leaves.push(lamp);
    }
    const st = { id: d.id, axis: d.axis, x: d.x, z: d.z, hw: d.hw, open: d.fixedOpen ? 1 : 0, target: d.fixedOpen ? 1 : 0, closeT: 0, grp, leaves, mat, locked: !!d.fixedOpen, hiss: 0, fy };
    mat.userData.uOpen.value = st.open;
    if (!d.fixedOpen) registerDoor(st);
    doors.push(st);
    // коллизия решётки у цистерны (проход перекрыт; видно воду сквозь прутья)
    if (d.id === 'cistern') addBlock({ x0: d.x - 3, x1: d.x + 3, z0: d.z - 0.12, z1: d.z + 0.12 }, 0);
  }
  const burst = (d, n = 10) => {
    if (!ctx.lighting?.steam) return;
    const nx = d.axis === 'x' ? 1 : 0, nz = d.axis === 'x' ? 0 : 1;
    for (const sg of [-1, 1]) ctx.lighting.steam(d.x + nz * sg * 1.1, d.fy + 0.35, d.z + nx * sg * 1.1, n, 1.4, 0.35);
    ctx.lighting.steam(d.x, d.fy + 2.2, d.z, Math.round(n * 0.6), 1.0, 0.1);
  };
  ctx.steamSpots = doors.filter((d) => !d.locked).flatMap((d) => [{ x: d.x + 0.1, y: d.fy + 0.2, z: d.z - 1.5 }, { x: d.x + 0.1, y: d.fy + 0.2, z: d.z + 1.5 }, { x: d.x, y: d.fy + 2.4, z: d.z }]);
  const out = { doors };
  out.update = (dt, plL) => {
    for (const d of doors) {
      if (d.locked) continue;
      const along = d.axis === 'x' ? plL.x - d.x : plL.z - d.z, across = d.axis === 'x' ? plL.z - d.z : plL.x - d.x;
      const near = Math.abs(along) < 3.6 && Math.abs(across) < 2.6 && plL.y < 3;
      const allowed = d.id !== 'inner' || crowd?.guardReleased || along > 0.3;
      if (near && allowed && d.target === 0) {
        d.target = 1; d.closeT = 0;
        game.bus.emit('interact', { tag: 'Rakis.SealDoor', id: d.id });
        game.audio?.event?.('Door.SealHiss', new THREE.Vector3(d.x + O.x, 1.6, d.z + O.z));
        burst(d, 10);
      }
      if (d.target === 1) {
        if (Math.abs(along) > 5.5) { d.closeT += dt; if (d.closeT > 2.0) { d.target = 0; burst(d, 6); game.audio?.event?.('Door.SealHiss', new THREE.Vector3(d.x + O.x, 1.6, d.z + O.z)); } } else d.closeT = 0;
      }
      const rate = 1 / 1.9;
      d.open = clamp(d.open + Math.sign(d.target - d.open) * rate * dt, 0, 1);
      d.mat.userData.uOpen.value = smoothstep(0, 1, d.open);
      // сигнальные лампы: янтарь — закрыто, бирюза — открыто
      for (const L of d.leaves) if (L.material?.isMeshBasicMaterial) L.material.color.setHex(d.open > 0.5 ? 0x5fe0c0 : 0xffa23c);
    }
  };
  return out;
}
