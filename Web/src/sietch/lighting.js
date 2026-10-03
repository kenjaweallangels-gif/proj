// Свет и атмосфера сиетча: светошары (инстансы + ореолы + пул реальных PointLight), световые колодцы,
// луч зала, пылинки и пар, вода цистерны с «отражениями» шаров и каплями.
import * as THREE from 'three';
import { clamp, smoothstep, rng } from '../core/util.js';
import { HALL, zoneAtLocal } from './plan.js';
import { U } from './mats.js';
const SHAFT_R = HALL.shaftR, VAULT_TOP = HALL.shaftTop - 0.6;

const FOGMIX = (extra = '') => /* glsl */`
#ifdef USE_FOG
  float ffd = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  gl_FragColor.rgb *= ${extra}(1.0 - ffd);
#endif`;

function addMat(o) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, ...o,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, o.uniforms]),
  });
}

const regionOfZone = (z) => ({ B1_Airlock: 'B1', B2_Gallery: 'B2', B3_Passages: 'B3', B4_Cistern: 'B4', B5_Hall: 'B5' }[z] || 'B2');

export function createLighting(ctx) {
  const { root, globes, wells, game } = ctx;
  const CIS = { x0: 112.4, x1: 137.6, z0: 10.4, z1: 25.6, y: -1.2 };
  const q = ctx.quality;
  const O = ctx.origin;
  const out = {};
  const N = globes.length;
  const R = rng(77);
  globes.forEach((g, i) => { g.phase = R() * 6.28; g.bx = g.x; g.by = g.y; g.bz = g.z; g.i = i; });

  // ---- Светошары: инстансы-сферы.
  const gGeo = new THREE.SphereGeometry(0.15, 14, 10);
  const gMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1), fog: true });
  const gMesh = new THREE.InstancedMesh(gGeo, gMat, N);
  gMesh.frustumCulled = false;
  gMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  root.add(gMesh);
  const _m = new THREE.Matrix4(), _c = new THREE.Color();

  // ---- Ореолы (Points).
  const hGeo = new THREE.BufferGeometry();
  const hPos = new Float32Array(N * 3), hSize = new Float32Array(N), hPh = new Float32Array(N);
  globes.forEach((g, i) => { hSize[i] = 1.0 + 0.7 * g.k; hPh[i] = g.phase; });
  hGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3));
  hGeo.setAttribute('aSize', new THREE.BufferAttribute(hSize, 1));
  hGeo.setAttribute('aPh', new THREE.BufferAttribute(hPh, 1));
  const hMat = addMat({
    uniforms: { uTime: U.uTime, uScale: { value: 800 } },
    vertexShader: /* glsl */`
      attribute float aSize; attribute float aPh; uniform float uScale; uniform float uTime; varying float vA;
      #include <fog_pars_vertex>
      void main(){ vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
        float fl = 0.88 + 0.12*sin(uTime*(3.0+aPh*0.3)+aPh*5.0) * sin(uTime*1.7+aPh);
        vA = fl; gl_PointSize = clamp(aSize * uScale / max(0.5, -mvPosition.z), 2.0, 380.0);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
#include <fog_pars_fragment>
      void main(){ vec2 p = gl_PointCoord*2.0-1.0; float d = length(p); float a = pow(max(0.0,1.0-d),2.4)*0.55 + pow(max(0.0,1.0-d*2.2),2.0)*0.6;
        gl_FragColor = vec4(vec3(1.0,0.62,0.28) * a * vA * 0.9, 1.0);
        ${FOGMIX()}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const halos = new THREE.Points(hGeo, hMat);
  halos.frustumCulled = false; halos.renderOrder = 5;
  root.add(halos);

  // ---- Пул реальных источников.
  const K = q === 'low' ? 6 : q === 'high' ? 14 : 10;
  const lights = [];
  for (let i = 0; i < K; i++) {
    const L = new THREE.PointLight(0xffa850, 0, 16, 2);
    L.castShadow = false; L.userData = { gi: -1, cur: 0, target: 0 };
    root.add(L); lights.push(L);
  }
  let poolT = 0;
  const camL = new THREE.Vector3();
  function repool() {
    const reg = regionOfZone(zoneAtLocal(camL.x, camL.z));
    const cand = [];
    for (const g of globes) {
      if (g.region !== reg) continue;
      const dx = g.x - camL.x, dy = g.y - camL.y, dz = g.z - camL.z;
      cand.push([dx * dx + dy * dy * 0.6 + dz * dz, g]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    const want = cand.slice(0, K).map((c) => c[1]);
    const used = new Set(lights.map((l) => l.userData.gi));
    const wantSet = new Set(want.map((g) => g.i));
    for (const L of lights) if (!wantSet.has(L.userData.gi)) { L.userData.target = 0; L.userData.free = true; }
    for (const g of want) {
      if (used.has(g.i) && lights.some((l) => l.userData.gi === g.i && !l.userData.free)) continue;
      const L = lights.find((l) => l.userData.free || l.userData.gi < 0) ;
      if (!L) break;
      if (L.userData.cur > 0.02) { L.userData.target = 0; continue; } // дождаться затухания
      L.userData.gi = g.i; L.userData.free = false; L.userData.target = 1;
    }
  }

  // ---- Лучи: колодцы и зал.
  const shaftMat = (col, strength) => addMat({
    side: THREE.DoubleSide,
    uniforms: { uTime: U.uTime, uCol: { value: new THREE.Color(col) }, uK: { value: strength }, uY0: { value: 0 }, uY1: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vW; varying vec3 vLocal;
      #include <fog_pars_vertex>
      void main(){ vLocal = position; vN = normalize(normalMatrix*normal); vec4 mvPosition = modelViewMatrix*vec4(position,1.0); vW = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uCol; uniform float uK; uniform float uY0; uniform float uY1;
      varying vec3 vN; varying vec3 vW; varying vec3 vLocal;
      #include <fog_pars_fragment>
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        float ndv = abs(dot(normalize(vN), V));
        float edge = pow(ndv, 2.4);
        float t = clamp((vLocal.y - uY0) / (uY1 - uY0), 0.0, 1.0);   // 0 снизу .. 1 сверху
        float ang = atan(vLocal.z, vLocal.x);
        float streak = 0.55 + 0.45 * vn(vec2(ang*3.0 + uTime*0.05, vLocal.y*0.22 - uTime*0.12));
        streak *= 0.7 + 0.5 * vn(vec2(ang*9.0 - uTime*0.07, vLocal.y*0.5 + uTime*0.2));
        float fade = smoothstep(0.0, 0.18, 1.0 - t) * (0.55 + 0.45 * t) * smoothstep(0.0, 0.07, t);
        float a = edge * streak * fade * uK * smoothstep(0.4, 5.0, length(vW - cameraPosition));
        gl_FragColor = vec4(uCol * a, 1.0);
        ${FOGMIX()}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // луч зала
  const rayLen = VAULT_TOP - (HALL.bowlY + 0.1);
  const rayGeo = new THREE.CylinderGeometry(SHAFT_R * 0.98, 3.3, rayLen, 40, 8, true);
  const rayMat = shaftMat('#fff0d0', 0.32);
  rayMat.uniforms.uY0.value = -rayLen / 2; rayMat.uniforms.uY1.value = rayLen / 2;
  const ray = new THREE.Mesh(rayGeo, rayMat);
  ray.position.set(HALL.cx, HALL.bowlY + 0.1 + rayLen / 2, HALL.cz); ray.renderOrder = 6;
  root.add(ray);
  out.ray = ray;
  const rayLight = new THREE.PointLight(0xffe4b8, 0, 16, 2);
  rayLight.position.set(HALL.cx, 3.2, HALL.cz); root.add(rayLight);
  out.rayLight = rayLight;
  const heroLight = new THREE.PointLight(0xffd7a0, 0, 12, 2);
  root.add(heroLight); out.heroLight = heroLight;
  // небо над шахтой
  const skyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.5, 6.2, 7.4), fog: false });
  const sky = new THREE.Mesh(new THREE.CircleGeometry(SHAFT_R + 0.2, 32), skyMat);
  sky.rotation.x = Math.PI / 2; sky.position.set(HALL.cx, HALL.shaftTop - 0.15, HALL.cz);
  root.add(sky);
  // колодцы B2 (шахты прорезаны в самой скале — здесь только луч и «небо» над ними)
  const wellMeshes = [];
  for (const w of wells) {
    const top = w.y1 - 0.5, len = top - 0.1;
    const m = shaftMat('#9bbcff', 0.32);
    m.uniforms.uY0.value = -len / 2; m.uniforms.uY1.value = len / 2;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(w.r, w.rBottom, len, 28, 6, true), m);
    mesh.position.set(w.x, len / 2 + 0.1, w.z); mesh.renderOrder = 6;
    root.add(mesh); wellMeshes.push(mesh);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(w.r + 0.25, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 5, 6.5), fog: false }));
    disc.rotation.x = Math.PI / 2; disc.position.set(w.x, w.y1 - 0.35, w.z);
    root.add(disc);
  }

  // ---- Пылинки (вся сцена, камерой-центрированные) + пылинки луча.
  const NM = q === 'low' ? 500 : q === 'high' ? 2200 : 1400;
  const mGeo = new THREE.BufferGeometry();
  const mp = new Float32Array(NM * 3), ms = new Float32Array(NM), mph = new Float32Array(NM);
  for (let i = 0; i < NM; i++) { mp[i * 3] = R() * 40; mp[i * 3 + 1] = R() * 14; mp[i * 3 + 2] = R() * 40; ms[i] = 0.5 + R(); mph[i] = R() * 6.28; }
  mGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3)); mGeo.setAttribute('aS', new THREE.BufferAttribute(ms, 1)); mGeo.setAttribute('aPh', new THREE.BufferAttribute(mph, 1));
  const cones = [
    { x: HALL.cx, z: HALL.cz, r: 3.0, y0: HALL.bowlY, y1: VAULT_TOP, col: [1.0, 0.85, 0.55], k: 2.2 },
    ...wells.map((w) => ({ x: w.x, z: w.z, r: 1.7, y0: 0, y1: 12, col: [0.6, 0.75, 1.0], k: 1.4 })),
  ];
  const coneArr = cones.map((c) => new THREE.Vector4(c.x, c.z, c.r, c.k));
  while (coneArr.length < 4) coneArr.push(new THREE.Vector4(0, 0, 0, 0));
  const mMat = addMat({
    uniforms: { uTime: U.uTime, uCam: { value: new THREE.Vector3() }, uScale: { value: 800 }, uCones: { value: coneArr }, uBox: { value: new THREE.Vector3(44, 30, 44) } },
    vertexShader: /* glsl */`
      attribute float aS; attribute float aPh; uniform float uTime; uniform vec3 uCam; uniform float uScale; uniform vec3 uBox; uniform vec4 uCones[4];
      varying float vA; varying vec3 vC;
      #include <fog_pars_vertex>
      void main(){
        vec3 p = position + vec3(sin(uTime*0.13+aPh)*1.2, uTime*0.05*aS, cos(uTime*0.11+aPh*1.3)*1.2);
        p = mod(p - uCam + uBox*0.5, uBox) + uCam - uBox*0.5;
        p.y = mod(position.y*2.1 + uTime*0.05*aS, uBox.y) - 3.0;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition;
        float boost = 0.0;
        for (int i=0;i<4;i++){ float d = length(p.xz - uCones[i].xy); boost += uCones[i].w * (1.0 - smoothstep(uCones[i].z*0.4, uCones[i].z, d)) * step(0.01, uCones[i].z); }
        float tw = 0.6 + 0.4 * sin(uTime*(1.0+aS)+aPh*3.0);
        vA = (0.16 + boost) * tw * (0.5 + aS*0.5);
        vC = mix(vec3(1.0,0.72,0.42), vec3(1.0,0.92,0.75), clamp(boost,0.0,1.0));
        gl_PointSize = clamp((1.4 + aS*1.2 + boost*2.0) * uScale / max(1.0, -mvPosition.z) * 0.05, 1.0, 14.0);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying vec3 vC;
#include <fog_pars_fragment>
      void main(){ vec2 p = gl_PointCoord*2.0-1.0; float d = length(p); float a = smoothstep(1.0, 0.0, d); a*=a;
        gl_FragColor = vec4(vC * a * vA, 1.0);
        ${FOGMIX()}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const motes = new THREE.Points(mGeo, mMat);
  motes.frustumCulled = false; motes.renderOrder = 7;
  root.add(motes);


  // ---- Пылинки внутри лучей (яркие, медленно кружат).
  function coneMotes(cx, cz, yBot, yTop, rTop, rBot, n, col, size) {
    const g = new THREE.BufferGeometry();
    const a = new Float32Array(n * 4), pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 4] = R() * 6.283; a[i * 4 + 1] = Math.sqrt(R()); a[i * 4 + 2] = R(); a[i * 4 + 3] = 0.15 + R() * 0.5; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aP', new THREE.BufferAttribute(a, 4));
    const m = addMat({
      uniforms: { uTime: U.uTime, uScale: { value: 800 }, uC: { value: new THREE.Vector4(cx, cz, yBot, yTop) }, uR: { value: new THREE.Vector2(rTop, rBot) }, uCol: { value: new THREE.Color(...col) }, uSize: { value: size } },
      vertexShader: /* glsl */`
        attribute vec4 aP; uniform float uTime; uniform float uScale; uniform vec4 uC; uniform vec2 uR; uniform float uSize; varying float vA;
        #include <fog_pars_vertex>
        void main(){
          float H = uC.w - uC.z;
          float y = uC.w - mod(aP.z*H + uTime*aP.w*0.6, H);
          float f = (y - uC.z) / H;                      // 0 снизу .. 1 сверху
          float r = mix(uR.y, uR.x, f) * aP.y * 0.95;
          float ang = aP.x + uTime*0.1*(aP.w-0.4) + y*0.3;
          vec3 p = vec3(uC.x + cos(ang)*r, y, uC.y + sin(ang)*r);
          vec4 mvPosition = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mvPosition;
          float tw = 0.5 + 0.5*sin(uTime*(2.0+aP.w*3.0) + aP.x*7.0);
          vA = (0.35 + 0.65*tw) * smoothstep(0.0,0.1,f) * (1.0 - 0.5*f) * (1.0 - aP.y*0.4);
          gl_PointSize = clamp(uSize * (0.6+aP.w) * uScale / max(0.5,-mvPosition.z), 1.2, 12.0);
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCol; varying float vA;
#include <fog_pars_fragment>
        void main(){ vec2 p = gl_PointCoord*2.0-1.0; float d = length(p); float a = smoothstep(1.0,0.0,d); a*=a;
          gl_FragColor = vec4(uCol * a * vA, 1.0);
          ${FOGMIX()}
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 7; root.add(pts);
    return m;
  }
  const NC = q === 'low' ? 200 : q === 'high' ? 700 : 420;
  const coneMats = [coneMotes(HALL.cx, HALL.cz, HALL.bowlY, VAULT_TOP, SHAFT_R, 3.3, NC, [2.2, 1.7, 1.1], 0.06)];
  for (const w of wells) coneMats.push(coneMotes(w.x, w.z, 0.1, w.y1 - 0.5, w.r, w.rBottom, Math.round(NC * 0.35), [1.0, 1.3, 1.9], 0.05));

  // ---- Пар/конденсат у шлюзов.
  const NS = 90;
  const sGeo = new THREE.BufferGeometry();
  const sp = new Float32Array(NS * 3), sa = new Float32Array(NS), ss = new Float32Array(NS), sc = new Float32Array(NS * 3);
  sGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sGeo.setAttribute('aA', new THREE.BufferAttribute(sa, 1)); sGeo.setAttribute('aS', new THREE.BufferAttribute(ss, 1)); sGeo.setAttribute('aC', new THREE.BufferAttribute(sc, 3));
  const sMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 800 } }]),
    vertexShader: /* glsl */`
      attribute float aA; attribute float aS; attribute vec3 aC; uniform float uScale; varying float vA; varying vec3 vC;
      #include <fog_pars_vertex>
      void main(){ vec4 mvPosition = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mvPosition; vA = aA; vC = aC; gl_PointSize = clamp(aS*uScale/max(0.5,-mvPosition.z), 0.0, 420.0);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      varying float vA; varying vec3 vC;
#include <fog_pars_fragment>
      void main(){ vec2 p = gl_PointCoord*2.0-1.0; float d = length(p); float a = smoothstep(1.0,0.0,d); a = a*a*vA;
        gl_FragColor = vec4(vC, a);
        #ifdef USE_FOG
          float ffd = 1.0 - exp(-fogDensity*fogDensity*vFogDepth*vFogDepth); gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ffd);
        #endif
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const steam = new THREE.Points(sGeo, sMat);
  steam.frustumCulled = false; steam.renderOrder = 8;
  root.add(steam);
  const puffs = Array.from({ length: NS }, () => ({ col: [0.82, 0.7, 0.58], amp: 0.16, life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 0.5 }));
  let puffI = 0;
  out.steam = (x, y, z, n = 8, spread = 1.0, up = 0.5, col = [0.82, 0.7, 0.58], life = 1, amp = 0.16) => {
    for (let i = 0; i < n; i++) {
      const p = puffs[puffI++ % NS];
      p.life = 0; p.col = col; p.amp = amp; p.max = (2.5 + R() * 2.5) * life; p.x = x + (R() - 0.5) * 0.4; p.y = y + R() * 0.8; p.z = z + (R() - 0.5) * 1.8;
      p.vx = (R() - 0.5) * spread * 0.5; p.vy = up * (0.3 + R() * 0.7); p.vz = (R() - 0.5) * spread; p.s0 = 0.5 + R() * 0.6;
    }
  };
  out.sand = (x, y, z, n = 4) => out.steam(x, y, z, n, 1.6, 0.9, [0.72, 0.56, 0.36], 0.28, 0.5);
  let steamT = 0;

  // ---- Вода цистерны.
  const B4 = CIS;
  const wg = globes.filter((g) => g.region === 'B4').slice(0, 8);
  const gArr = []; for (let i = 0; i < 8; i++) gArr.push(wg[i] ? new THREE.Vector3(wg[i].x, wg[i].y, wg[i].z) : new THREE.Vector3(0, -99, 0));
  const drips = [new THREE.Vector4(118, 13, -10, 0), new THREE.Vector4(129, 22, -10, 0), new THREE.Vector4(124, 17, -10, 0)];
  const wMat = new THREE.ShaderMaterial({
    transparent: true, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: U.uTime, uG: { value: gArr }, uDrips: { value: drips }, uCamL: { value: new THREE.Vector3() } }]),
    vertexShader: /* glsl */`
      varying vec3 vW; varying vec3 vWP; varying vec3 vRootP;
#include <fog_pars_vertex>
      void main(){ vW = position; vWP = (modelMatrix * vec4(position,1.0)).xyz; vRootP = (modelMatrix * vec4(0.0,0.0,0.0,1.0)).xyz; vec4 mvPosition = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uG[8]; uniform vec4 uDrips[3]; uniform vec3 uCamL; varying vec3 vW; varying vec3 vWP; varying vec3 vRootP;
      #include <fog_pars_fragment>
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec3 wp = vW;
        vec2 q = vW.xz;
        vec2 rip = vec2(vn(q*3.0+uTime*0.15)-0.5, vn(q*3.0+7.3-uTime*0.12)-0.5) * 0.02;
        for (int i=0;i<3;i++){
          float age = uTime - uDrips[i].w; vec2 d = q - uDrips[i].xy; float r = length(d);
          if (age > 0.0 && age < 4.5) { float ring = sin((r - age*0.45)*38.0) * exp(-abs(r - age*0.45)*9.0) * exp(-age*0.9); rip += normalize(d+1e-4) * ring * 0.045; }
        }
        vec3 N = normalize(vec3(rip.x*8.0, 1.0, rip.y*8.0));
        vec3 V = normalize(wp - uCamL);
        vec3 Rf = reflect(V, N);
        float fres = 0.04 + 0.96*pow(1.0 - clamp(dot(-V, N),0.0,1.0), 4.0);
        vec3 col = vec3(0.005,0.011,0.017);
        // «отражения» светошаров: близость отражённого луча к точке
        for (int i=0;i<8;i++){
          vec3 toG = uG[i] - wp;
          float t = dot(toG, Rf); if (t > 0.0) { float dist = length(toG - Rf*t); col += vec3(1.0,0.62,0.3) * (6.0 / (1.0 + dist*dist*9.0)) * (0.35+0.65*fres) / (1.0 + 0.004*t*t); }
        }
        // тёплый отсвет свода (общий)
        col += vec3(0.05,0.03,0.015) * 0.25 * (0.3 + 0.7*fres) * (0.5 + 0.5*Rf.y);
        float edge = smoothstep(0.0, 0.5, min(min(vW.x - ${B4.x0.toFixed(2)}, ${B4.x1.toFixed(2)} - vW.x), min(vW.z - ${B4.z0.toFixed(2)}, ${B4.z1.toFixed(2)} - vW.z)));
        gl_FragColor = vec4(col, 0.93);
        #ifdef USE_FOG
          float ffd = 1.0 - exp(-fogDensity*fogDensity*vFogDepth*vFogDepth); gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ffd);
        #endif
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // в шейдере глобальные позиции шаров заданы в координатах root; vW — локальные координаты меша (root-локальные).
  const water = new THREE.Mesh(new THREE.PlaneGeometry(B4.x1 - B4.x0, B4.z1 - B4.z0, 1, 1), wMat);
  water.geometry.rotateX(-Math.PI / 2); water.geometry.translate((B4.x0 + B4.x1) / 2, B4.y, (B4.z0 + B4.z1) / 2);
  water.renderOrder = 2;
  root.add(water);
  // капли: маленькие светящиеся точки
  const dropGeo = new THREE.BufferGeometry(); dropGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const dropMat = new THREE.PointsMaterial({ size: 0.05, color: 0xd8e8ff, transparent: true, opacity: 0.8, depthWrite: false, fog: true });
  const dropPts = new THREE.Points(dropGeo, dropMat); dropPts.frustumCulled = false; root.add(dropPts);
  const dripT = [1.5, 4, 6.5], dripPeriod = [7.3, 8.9, 6.1];
  out.drips = [];

  // ---- Обновление.
  const tmpV = new THREE.Vector3();
  out.update = (dt, t) => {
    root.worldToLocal(camL.copy(game.camera.position));
    wMat.uniforms.uCamL.value.copy(camL);
    // шары: покачивание, мерцание
    for (let i = 0; i < N; i++) {
      const g = globes[i];
      const bob = Math.sin(t * 0.9 + g.phase) * 0.055 + Math.sin(t * 0.37 + g.phase * 2) * 0.03;
      g.x = g.bx + Math.sin(t * 0.31 + g.phase) * 0.07 + Math.sin(t * 0.17 + g.phase * 3) * 0.05; g.y = g.by + bob; g.z = g.bz + Math.cos(t * 0.27 + g.phase * 1.7) * 0.07;
      _m.makeTranslation(g.x, g.y, g.z); gMesh.setMatrixAt(i, _m);
      const fl = 0.85 + 0.15 * Math.sin(t * (2.2 + g.phase * 0.2) + g.phase * 4) * Math.sin(t * 1.3 + g.phase);
      _c.setRGB(2.5 * fl, 1.45 * fl, 0.55 * fl); gMesh.setColorAt(i, _c);
      hPos[i * 3] = g.x; hPos[i * 3 + 1] = g.y; hPos[i * 3 + 2] = g.z;
    }
    gMesh.instanceMatrix.needsUpdate = true; gMesh.instanceColor.needsUpdate = true;
    hGeo.attributes.position.needsUpdate = true;
    // пул источников
    poolT -= dt;
    if (poolT <= 0) { poolT = 0.2; repool(); }
    for (const L of lights) {
      const u = L.userData;
      u.cur += (u.target - u.cur) * Math.min(1, dt * 5);
      const g = u.gi >= 0 ? globes[u.gi] : null;
      if (g) {
        L.position.set(g.x, g.y - 0.05, g.z);
        const fl = 0.9 + 0.1 * Math.sin(t * (2.2 + g.phase * 0.2) + g.phase * 4);
        L.intensity = u.cur * 38 * g.k * fl;
        L.distance = 14 + 4 * g.k;
      } else L.intensity = 0;
      if (u.cur < 0.01 && u.target === 0) { u.gi = -1; u.free = true; }
    }
    // масштабы точечных спрайтов
    const scale = game.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(game.camera.fov) / 2));
    hMat.uniforms.uScale.value = scale; mMat.uniforms.uScale.value = scale; sMat.uniforms.uScale.value = scale; for (const cm of coneMats) cm.uniforms.uScale.value = scale;
    mMat.uniforms.uCam.value.copy(camL);
    // пар
    steamT -= dt;
    if (steamT <= 0 && ctx.steamSpots) { steamT = 0.35; for (const s of ctx.steamSpots) if (Math.abs(s.x - camL.x) < 40) out.steam(s.x, s.y, s.z, 1, 0.4, 0.25); }
    for (let i = 0; i < NS; i++) {
      const p = puffs[i];
      if (p.life >= p.max) { sa[i] = 0; ss[i] = 0; continue; }
      p.life += dt; const k = p.life / p.max;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy *= 0.995;
      sp[i * 3] = p.x; sp[i * 3 + 1] = p.y; sp[i * 3 + 2] = p.z;
      sa[i] = Math.sin(Math.min(1, k) * Math.PI) * p.amp; ss[i] = p.s0 * (0.8 + k * 2.2); sc[i * 3] = p.col[0]; sc[i * 3 + 1] = p.col[1]; sc[i * 3 + 2] = p.col[2];
    }
    sGeo.attributes.position.needsUpdate = true; sGeo.attributes.aA.needsUpdate = true; sGeo.attributes.aS.needsUpdate = true; sGeo.attributes.aC.needsUpdate = true;
    // капли цистерны
    const pos = dropGeo.attributes.position.array;
    for (let i = 0; i < 3; i++) {
      const ph = (t - dripT[i]) % dripPeriod[i];
      const fall = ph < 0 ? 99 : ph;
      const d = drips[i];
      if (ph >= 0 && ph < 0.6) { const f = ph / 0.6; pos[i * 3] = d.x; pos[i * 3 + 1] = 6.0 - 7.2 * f * f; pos[i * 3 + 2] = d.y; }
      else { pos[i * 3] = 0; pos[i * 3 + 1] = -99; pos[i * 3 + 2] = 0; }
      if (ph >= 0.58 && ph < 0.6 + dt * 2 && (drips[i].w < t - 3)) { drips[i].w = t; out.onDrip?.(i, d.x, d.y); }
    }
    dropGeo.attributes.position.needsUpdate = true;
    rayLight.intensity = regionOfZone(zoneAtLocal(camL.x, camL.z)) === 'B5' ? 90 + 8 * Math.sin(t * 0.7) : 0;
    // луч зала: лёгкая «дыхание» интенсивности
    rayMat.uniforms.uK.value = 0.32 + 0.04 * Math.sin(t * 0.6);
  };
  // капли: хранится по (x, z) в vec4 (x, z, -, tStart); в шейдере xy = (x,z)
  drips.forEach((d) => { d.w = -100; });
  out.globeMesh = gMesh; out.lights = lights; out.halos = halos; out.motes = motes; out.ctxSteamRef = puffs;
  return out;
}
