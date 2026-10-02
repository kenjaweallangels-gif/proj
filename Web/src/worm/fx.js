// Эффекты червя: пул частиц (инстансные билборды, вся баллистика в вершинном шейдере), волна песка (холм над головой),
// прыгающие камни, тень-лента на песке. Всё масштабируется по game.settings.quality.
import * as THREE from 'three';
import { rng } from '../core/util.js';
import { N_PTS, SEG_LEN, RADIUS } from './spine.js';

export const QUALITY_FX = {
  low: { sand: 2200, dust: 420, rocks: 26, k: 0.25, grid: 21 },
  med: { sand: 14000, dust: 1500, rocks: 60, k: 0.7, grid: 31 },
  high: { sand: 18000, dust: 3000, rocks: 100, k: 1.0, grid: 41 },
};

const PARTICLE_VS = /* glsl */`
attribute vec3 aP0; attribute vec3 aV; attribute vec4 aT; attribute vec4 aK;
uniform float uTime; uniform vec3 uWind; uniform float uGrav;
varying vec2 vC; varying float vAlpha; varying float vType; varying float vSeed; varying vec3 vWorld; varying float vHeight;
void main(){
  float age = uTime - aT.x; float life = aT.y;
  float type = aK.x;
  if (age < 0.0 || age > life) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
  float u = age/life; float size = aT.z; float alpha = 1.0; vec3 pos;
  float k = max(aK.z, 0.001);
  if (type > 0.5 && type < 1.5) {
    pos = aP0 + aV*(1.0-exp(-k*age))/k;
    pos += uWind * (age*age/(age+3.0));
    pos.y += aK.w * age * (1.0 - exp(-age*0.35));
    size *= 0.35 + 1.5*sqrt(u);
    alpha = smoothstep(0.0,0.07,u) * pow(1.0-u, 1.4);
    pos.y = max(pos.y, aK.y + 0.4);
  } else {
    pos = aP0 + aV*(1.0-exp(-k*age))/k + vec3(0.0,-0.5*uGrav*age*age,0.0) + uWind*0.15*age;
    if (pos.y < aK.y) { gl_Position = vec4(2.0,2.0,2.0,1.0); return; }
    size *= 1.0 - 0.3*u;
    alpha = smoothstep(0.0,0.04,u) * (1.0 - smoothstep(0.85,1.0,u));
  }
  vec4 mv = viewMatrix * vec4(pos,1.0);
  size = min(size, max(-mv.z, 1.0) * 0.6);
  vec2 c = position.xy;
  if (type < 1.5) {
    float ang = aT.w*6.2831 + age*(aT.w-0.5)*0.6;
    float cs = cos(ang), sn = sin(ang);
    mv.xy += mat2(cs,sn,-sn,cs) * c * size;
  } else {
    vec3 vv = (viewMatrix * vec4(aV + vec3(0.0,-uGrav*age,0.0), 0.0)).xyz;
    vec2 dir = length(vv.xy) > 1e-3 ? normalize(vv.xy) : vec2(0.0,-1.0);
    vec2 perp = vec2(dir.y, -dir.x);
    mv.xy += perp*c.x*size + dir*c.y*size*aK.w;
  }
  vC = c; vAlpha = alpha; vType = type; vSeed = aT.w; vWorld = pos; vHeight = pos.y - aK.y;
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FS = /* glsl */`
uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform vec3 uSandCol; uniform vec3 uDustCol; uniform float uScatter;
uniform vec3 uFogCol; uniform float uFogDen; uniform float uOpacity;
varying vec2 vC; varying float vAlpha; varying float vType; varying float vSeed; varying vec3 vWorld; varying float vHeight;
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
void main(){
  float r = length(vC)*2.0;
  vec3 V = normalize(cameraPosition - vWorld);
  float fwd = pow(max(dot(-V, uSunDir), 0.0), 4.0);
  vec3 col; float a;
  if (vType > 0.5 && vType < 1.5) {
    float n = vn(vC*3.5 + vSeed*31.0)*0.6 + vn(vC*8.0 + vSeed*11.0)*0.4;
    float sh = smoothstep(1.0, 0.05, r*(0.75+0.55*n));
    a = sh*sh*vAlpha*0.36*uOpacity;
    float lit = 0.6 + 0.4*vSeed;
    col = uDustCol*(uAmb + uSunCol*lit*0.55) + uSunCol*uDustCol*fwd*uScatter;
    col *= 1.0 - 0.25*smoothstep(0.0, 1.0, 1.0 - vC.y*1.6 - 0.5);
  } else {
    float sh = 1.0 - smoothstep(0.35, 1.0, r);
    a = sh*vAlpha*0.9;
    float lit = 0.55 + 0.6*vSeed + 0.5*max(dot(normalize(vec3(vC, 0.6)), vec3(0.4,0.7,0.5)), 0.0);
    col = uSandCol*(uAmb*0.8 + uSunCol*lit*0.6);
    col += uSunCol*uSandCol*fwd*uScatter*0.5;
  }
  float d = length(vWorld - cameraPosition);
  float fog = uFogDen > 0.0 ? 1.0 - exp(-uFogDen*uFogDen*d*d) : 0.0;
  col = mix(col, uFogCol, fog);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Pool {
  constructor(count, shared) {
    this.count = count;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position);
    g.instanceCount = count;
    this.aP0 = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.aV = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.aT = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    this.aK = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
    for (const a of [this.aP0, this.aV, this.aT, this.aK]) a.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) { this.aT.array[i * 4] = -1e6; this.aT.array[i * 4 + 1] = 1; this.aK.array[i * 4 + 2] = 0.1; }
    g.setAttribute('aP0', this.aP0); g.setAttribute('aV', this.aV); g.setAttribute('aT', this.aT); g.setAttribute('aK', this.aK);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      uniforms: shared, vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
      transparent: true, depthWrite: false, depthTest: true,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.cursor = 0; this.dirtyLo = Infinity; this.dirtyHi = -1; this.wrapped = false;
  }
  emit(px, py, pz, vx, vy, vz, birth, life, size, seed, type, groundY, drag, extra) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    if (this.cursor === 0) this.wrapped = true;
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
    let o = i * 3;
    const p = this.aP0.array, v = this.aV.array, t = this.aT.array, k = this.aK.array;
    p[o] = px; p[o + 1] = py; p[o + 2] = pz; v[o] = vx; v[o + 1] = vy; v[o + 2] = vz;
    o = i * 4;
    t[o] = birth; t[o + 1] = life; t[o + 2] = size; t[o + 3] = seed;
    k[o] = type; k[o + 1] = groundY; k[o + 2] = drag; k[o + 3] = extra;
  }
  flush() {
    if (this.dirtyHi < 0) return;
    let lo = this.dirtyLo, hi = this.dirtyHi;
    if (this.wrapped) { lo = 0; hi = this.count - 1; }
    for (const a of [this.aP0, this.aV, this.aT, this.aK]) {
      a.clearUpdateRanges();
      a.addUpdateRange(lo * a.itemSize, (hi - lo + 1) * a.itemSize);
      a.needsUpdate = true;
    }
    this.dirtyLo = Infinity; this.dirtyHi = -1; this.wrapped = false;
  }
}

/** Холм песка над головой (волна под землёй) — геометрия следует рельефу, края растворяются. */
class Mound {
  constructor(n, size, color) {
    this.n = n; this.size = size;
    const nv = n * n;
    this.pos = new Float32Array(nv * 3);
    this.col = new Float32Array(nv * 4);
    const idx = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), roughness: 1, metalness: 0, vertexColors: true, transparent: true,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
  }
  update(x, z, yaw, amp, width, trail, heightFn, intensity) {
    const n = this.n, half = this.size / 2;
    const cx = Math.cos(yaw), sz = Math.sin(yaw);
    for (let j = 0; j < n; j++) {
      const w = (j / (n - 1) * 2 - 1) * half;
      for (let i = 0; i < n; i++) {
        const u = (i / (n - 1) * 2 - 1) * half;
        const wx = x + u * cx - w * sz, wz = z + u * sz + w * cx;
        const lat = Math.exp(-((w / width) ** 2));
        const lon = u > 0 ? Math.exp(-((u / (width * 0.55)) ** 2)) : 0.4 * Math.exp(-((u / (trail * 1.2)) ** 2)) + 0.6 * Math.exp(-((u / (width * 0.9)) ** 2));
        const lonT = u > 0 ? Math.exp(-((u / (width * 0.5)) ** 2)) : Math.exp(-((u / (trail * 1.6)) ** 2));
        const berm = 0.18 * Math.exp(-(((Math.abs(w) - width * 1.3) / (width * 0.3)) ** 2)) * lonT;
        const ripple = 0.12 * Math.sin(u * 0.45 + w * 0.2) * lat;
        const h = amp * (lat * lon * (u > 0 ? 1 : 0.85) + berm + ripple) * intensity;
        const gy = heightFn(wx, wz);
        const k = j * n + i;
        this.pos[k * 3] = wx; this.pos[k * 3 + 1] = gy + h + 0.12; this.pos[k * 3 + 2] = wz;
        const rn = Math.max(Math.abs(u), Math.abs(w)) / half;
        const a = (1 - smoothstep(0.62, 1.0, rn)) * Math.min(1, intensity * 3);
        const shade = 0.82 + 0.28 * Math.min(1, h / (amp + 1e-3));
        this.col[k * 4] = shade; this.col[k * 4 + 1] = shade; this.col[k * 4 + 2] = shade * 0.98; this.col[k * 4 + 3] = a;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

export class WormFX {
  constructor(game, quality) {
    this.game = game;
    const cfg = QUALITY_FX[quality] || QUALITY_FX.med;
    this.cfg = cfg; this.k = cfg.k;
    this.rand = rng(4242);
    this.group = new THREE.Group();
    this.group.name = 'WormFX';

    this.shared = {
      uTime: { value: 0 }, uWind: { value: new THREE.Vector3(3, 0, 5) }, uGrav: { value: 9.8 },
      uSunDir: { value: new THREE.Vector3(0.8, 0.47, 0.3) }, uSunCol: { value: new THREE.Color('#ffe2b8') },
      uAmb: { value: new THREE.Color('#9fa8b8').multiplyScalar(0.75) },
      uSandCol: { value: new THREE.Color('#c4a577') }, uDustCol: { value: new THREE.Color('#c2ae92') },
      uScatter: { value: 2.2 }, uFogCol: { value: new THREE.Color('#b8c4cf') }, uFogDen: { value: 0 }, uOpacity: { value: 1 },
    };
    this.sand = new Pool(cfg.sand, this.shared);
    this.dust = new Pool(cfg.dust, this.shared);
    this.group.add(this.sand.mesh, this.dust.mesh);

    this.mound = new Mound(cfg.grid, 110, '#c8a672');
    this.ripple = new Mound(cfg.grid, 130, '#c8a672');
    this.group.add(this.mound.mesh, this.ripple.mesh);

    // Тень-лента на песке
    this.shadowN = N_PTS;
    this.shPos = new Float32Array(this.shadowN * 3 * 3);
    this.shCol = new Float32Array(this.shadowN * 3 * 4);
    const idx = [];
    for (let i = 0; i < this.shadowN - 1; i++) for (let c = 0; c < 2; c++) {
      const a = i * 3 + c, b = a + 1, d = a + 3, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.shPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('color', new THREE.BufferAttribute(this.shCol, 4).setUsage(THREE.DynamicDrawUsage));
    sg.setIndex(idx);
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({
      color: '#05060c', vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false,
    }));
    this.shadow.frustumCulled = false; this.shadow.visible = false; this.shadow.renderOrder = 3;
    this.group.add(this.shadow);

    // Камни-«прыгуны»
    const rg = new THREE.IcosahedronGeometry(1, 2);
    const pa = rg.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const f = 1 + 0.2 * Math.sin(3.1 * x + 1.7) + 0.15 * Math.sin(4.3 * y + 0.3) + 0.13 * Math.sin(5.1 * z + 2.2) + 0.07 * Math.sin(9.7 * (x + z));
      pa.setXYZ(i, x * f, y * f * 0.62, z * f);
    }
    rg.computeVertexNormals();
    this.rocks = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: '#9a8062', roughness: 0.95 }), cfg.rocks);
    this.rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rocks.frustumCulled = false; this.rocks.castShadow = false;
    this.rocks.count = cfg.rocks;
    this.rockData = Array.from({ length: cfg.rocks }, (_, i) => ({
      x: 0, z: 0, ph: this.rand() * 6.28, amp: 0.4 + this.rand() * 1.4, per: 0.35 + this.rand() * 0.3, sc: 0.12 + this.rand() * this.rand() * 0.75,
      grp: i % 2, rot: this.rand() * 6.28, vis: 0, alive: false,
    }));
    this.group.add(this.rocks);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3();
    this.jobs = [];
    this.acc = { spray: 0, trail: 0, fall: 0, cross: 0, base: 0 };
    this.sandAmtTarget = 0;
  }

  setEnv(sunDir, windVec, fog) {
    this.shared.uSunDir.value.copy(sunDir);
    this.shared.uWind.value.copy(windVec);
    if (fog) {
      this.shared.uFogCol.value.copy(fog.color);
      this.shared.uFogDen.value = fog.isFogExp2 ? fog.density : (fog.far ? 2.2 / fog.far : 0);
    } else this.shared.uFogDen.value = 0;
  }

  /** Взрыв выхода: тысячи песчинок, ударная волна пыли, столб, поднимающийся к 150 м. Эмиссия растягивается на несколько кадров. */
  breach(x, y, z, yaw, power = 1) {
    const k = this.k * power;
    this.jobs.push({
      x, y, z, t: this.game.time,
      sand: Math.floor(8000 * k), shock: Math.floor(240 * k), plume: Math.floor(240 * k), puff: Math.floor(200 * k),
    });
  }

  _runJobs(budget = 2600) {
    const r = this.rand, S = this.sand, D = this.dust;
    for (const j of this.jobs) {
      const { x, y, z } = j, t = j.t;
      while (budget > 0 && j.shock > 0) {
        const i = j.shock--;
        const a = (i / 240) * 6.2832 * 7 + r() * 0.1, sp = 35 + r() * 30;
        D.emit(x + Math.cos(a) * 22, y + 1.5 + r() * 3, z + Math.sin(a) * 22, Math.cos(a) * sp, 2 + r() * 4, Math.sin(a) * sp, t + r() * 0.2, 3.5 + r() * 3, 9 + r() * 16, r(), 1, y, 0.55, 1.5);
        budget--;
      }
      while (budget > 0 && j.plume > 0) {
        j.plume--;
        const a = r() * 6.2832, rad = Math.sqrt(r()) * 16;
        D.emit(x + Math.cos(a) * rad, y + 2, z + Math.sin(a) * rad, Math.cos(a) * (2 + r() * 8), 35 + r() * 38, Math.sin(a) * (2 + r() * 8), t + r() * 1.2, 12 + r() * 12, 18 + r() * 38, r(), 1, y, 0.4, 2 + r() * 4);
        budget--;
      }
      while (budget > 0 && j.puff > 0) {
        j.puff--;
        const a = r() * 6.2832, rad = 8 + r() * 30, sp = 8 + r() * 18;
        D.emit(x + Math.cos(a) * rad, y + 1 + r() * 6, z + Math.sin(a) * rad, Math.cos(a) * sp, 4 + r() * 16, Math.sin(a) * sp, t + r() * 0.6, 8 + r() * 8, 14 + r() * 28, r(), 1, y, 0.5, 2 + r() * 5);
        budget--;
      }
      while (budget > 0 && j.sand > 0) {
        j.sand--;
        const a = r() * 6.2832, rad = Math.sqrt(r()) * 20;
        const sp = 8 + r() * 36, up = 25 + r() * Math.sqrt(r()) * 85;
        S.emit(x + Math.cos(a) * rad, y + 0.5, z + Math.sin(a) * rad, Math.cos(a) * sp, up, Math.sin(a) * sp, t + r() * 0.35, 2.5 + r() * 4.5, 0.35 + r() * r() * 1.4, r(), 2, y - 1, 0.1, 1.2 + r() * 2.6);
        budget--;
      }
    }
    this.jobs = this.jobs.filter((j) => j.sand + j.shock + j.plume + j.puff > 0);
  }

  /** Небольшой всплеск (повторный вход в песок, удар хвоста). */
  splash(x, y, z, power = 0.5) { this.breach(x, y, z, 0, power * 0.5); }

  /** Покадровая эмиссия. ctx: {dt, head, yaw, speed, state, underground, depth, exposed, spine, groundFn, threat, live} */
  update(dt, ctx) {
    const t = this.game.time, r = this.rand, k = this.k;
    this.shared.uTime.value = t;
    const g = ctx.groundFn;
    const a = this.acc;

    // --- Холм над головой ---
    this.frame = (this.frame || 0) + 1;
    if (this.jobs.length) this._runJobs(2600);
    const mw = ctx.mound;
    if (mw && mw.on) {
      if (!this.mound.mesh.visible || (this.frame & 1) === 0) this.mound.update(ctx.head.x, ctx.head.z, ctx.yaw, mw.amp, mw.width, mw.trail, g, mw.intensity);
      this.mound.mesh.visible = true;
      // брызги с гребня
      a.spray += dt * mw.spray * 60 * k;
      while (a.spray >= 1) {
        a.spray -= 1;
        const ang = r() * 6.2832, rad = r() * mw.width * 0.8;
        const px = ctx.head.x + Math.cos(ctx.yaw) * (r() * 18 - 4) + Math.cos(ctx.yaw + 1.57) * (r() - 0.5) * mw.width;
        const pz = ctx.head.z + Math.sin(ctx.yaw) * (r() * 18 - 4) + Math.sin(ctx.yaw + 1.57) * (r() - 0.5) * mw.width;
        const gy = g(px, pz);
        this.sand.emit(px, gy + mw.amp * 0.6, pz, Math.cos(ang) * 4, 5 + r() * 14 * mw.intensity, Math.sin(ang) * 4, t, 1.2 + r() * 1.8, 0.3 + r() * 0.6, r(), 2, gy - 0.5, 0.15, 2 + r() * 3);
      }
      a.trail += dt * (ctx.speed > 3 ? 6 : 1) * k * (mw.spray + 0.3);
      while (a.trail >= 1) {
        a.trail -= 1;
        const back = r() * 40;
        const px = ctx.head.x - Math.cos(ctx.yaw) * back + (r() - 0.5) * mw.width * 1.2;
        const pz = ctx.head.z - Math.sin(ctx.yaw) * back + (r() - 0.5) * mw.width * 1.2;
        const gy = g(px, pz);
        this.dust.emit(px, gy + 1, pz, (r() - 0.5) * 3, 1 + r() * 2, (r() - 0.5) * 3, t, 4 + r() * 4, 7 + r() * 8, r(), 1, gy, 0.8, 0.8 + r() * 1.2);
      }
    } else this.mound.mesh.visible = false;

    // --- Далёкая рябь (предвестие) ---
    const rp = ctx.ripple;
    if (rp && rp.on) {
      if (!this.ripple.mesh.visible || (this.frame & 1) === 1) this.ripple.update(rp.x, rp.z, rp.yaw, rp.amp, rp.width, rp.trail, g, rp.intensity);
      this.ripple.mesh.visible = true;
      a.fall += dt * 3 * k;
      while (a.fall >= 1 && !ctx.exposed) {
        a.fall -= 1;
        const px = rp.x + (r() - 0.5) * rp.width, pz = rp.z + (r() - 0.5) * rp.width, gy = g(px, pz);
        this.dust.emit(px, gy + 1, pz, (r() - 0.5) * 2, 1 + r(), (r() - 0.5) * 2, t, 5 + r() * 4, 8 + r() * 10, r(), 1, gy, 0.8, 0.6);
      }
    } else this.ripple.mesh.visible = false;

    // --- Над землёй: песок с колец, брызги на входе/выходе, тень ---
    if (ctx.exposed && ctx.spine) {
      const sp = ctx.spine;
      // индексы, где центр выше песка
      const P = sp.P;
      const ex = ctx._ex || (ctx._ex = []);
      ex.length = 0;
      for (let i = 0; i < N_PTS; i++) {
        const px = P[i * 3], pz = P[i * 3 + 2], gy = g(px, pz);
        const h = P[i * 3 + 1] - gy;
        if (h > 6) ex.push(i);
      }
      // песок с колец (водопады): стекает по бокам и из-под пластин
      const rate = (100 + 520 * ctx.live) * k;
      a.fall += dt * rate;
      const pP = this._v, pN = this._s;
      let guard = 0;
      while (a.fall >= 1 && ex.length && guard++ < 400) {
        a.fall -= 1;
        const i = ex[(r() * ex.length) | 0];
        const s = i * SEG_LEN + (r() < 0.6 ? 3.6 : r() * SEG_LEN);
        const ang = r() * 6.2832;
        if (ctx.riderA != null && s < 100) { let da = (ang - ctx.riderA) % 6.2832; if (da > 3.1416) da -= 6.2832; if (da < -3.1416) da += 6.2832; if (Math.abs(da) < 0.7) continue; }
        sp.surfacePoint(s, ang, pP, pN, 0.1);
        if (pN.y > 0.5) continue;
        const gy = g(pP.x, pP.z);
        const h = pP.y - gy;
        if (h < 3) continue;
        const out = 0.4 + r() * 2.2;
        this.sand.emit(pP.x, pP.y, pP.z, pN.x * out, -r() * 2 + pN.y * out, pN.z * out, t, Math.min(7, Math.sqrt(2 * h / 9.8) + 0.4), 0.45 + r() * 0.8, r(), 2, gy, 0.04, 4 + r() * 5);
        if (r() < 0.04) this.dust.emit(pP.x + pN.x * 2, pP.y, pP.z + pN.z * 2, pN.x * 2, -2, pN.z * 2, t, 4 + r() * 3, 6 + r() * 8, r(), 1, gy, 0.7, 0);
      }
      // пересечения с песком: центр пересекает уровень земли
      a.cross += dt * (60 + 700 * Math.min(1, ctx.speed / 30)) * k;
      let prevH = null; const crossIdx = [];
      for (let i = 0; i < N_PTS; i++) {
        const gy = g(P[i * 3], P[i * 3 + 2]);
        const h = P[i * 3 + 1] - gy;
        if (prevH !== null && ((prevH <= 0 && h > 0) || (prevH > 0 && h <= 0))) crossIdx.push(i);
        prevH = h;
      }
      let guard2 = 0;
      while (a.cross >= 1 && crossIdx.length && guard2++ < 200) {
        a.cross -= 1;
        const i = crossIdx[(r() * crossIdx.length) | 0];
        const ang = r() * 6.2832, rad = RADIUS * (0.9 + r() * 0.5);
        const px = P[i * 3] + Math.cos(ang) * rad, pz = P[i * 3 + 2] + Math.sin(ang) * rad, gy = g(px, pz);
        const sp2 = 3 + r() * 12;
        this.sand.emit(px, gy + 0.5, pz, Math.cos(ang) * sp2, 6 + r() * 26, Math.sin(ang) * sp2, t, 1.5 + r() * 3, 0.3 + r() * 0.8, r(), 2, gy - 1, 0.12, 2 + r() * 4);
        if (r() < 0.22) this.dust.emit(px, gy + 1, pz, Math.cos(ang) * 3, 2 + r() * 5, Math.sin(ang) * 3, t, 6 + r() * 6, 14 + r() * 22, r(), 1, gy, 0.5, 2 + r() * 3);
      }

      // тень-лента
      if (!this.shadow.visible || (this.frame & 1) === 0) this._shadow(ctx);
    } else this.shadow.visible = false;

    // --- Камни ---
    this._rocks(dt, ctx);

    this.sand.flush(); this.dust.flush();
  }

  _shadow(ctx) {
    const sp = ctx.spine, g = ctx.groundFn, L = ctx.sunDir;
    if (L.y < 0.08) { this.shadow.visible = false; return; }
    const P = sp.P, pos = this.shPos, col = this.shCol;
    const cen = this._cen || (this._cen = new Float32Array(N_PTS * 3));
    let any = false;
    for (let i = 0; i < N_PTS; i++) {
      const gy0 = g(P[i * 3], P[i * 3 + 2]);
      const h = P[i * 3 + 1] - gy0;
      const hh = Math.max(h, 0);
      // проецируем вдоль солнца на песок
      let x = P[i * 3] - (L.x / L.y) * hh, z = P[i * 3 + 2] - (L.z / L.y) * hh;
      const gy = g(x, z);
      cen[i * 3] = x; cen[i * 3 + 1] = gy + 0.3; cen[i * 3 + 2] = z;
    }
    for (let i = 0; i < N_PTS; i++) {
      const a = Math.max(i - 1, 0), b = Math.min(i + 1, N_PTS - 1);
      let dx = cen[b * 3] - cen[a * 3], dz = cen[b * 3 + 2] - cen[a * 3 + 2];
      let l = Math.hypot(dx, dz);
      if (l < 0.5) { dx = -L.x; dz = -L.z; l = Math.hypot(dx, dz) || 1; }
      dx /= l; dz /= l;
      const h = P[i * 3 + 1] - g(P[i * 3], P[i * 3 + 2]);
      const vis = smoothstep(RADIUS * 0.1, RADIUS * 0.9, h);
      if (vis > 0.01) any = true;
      const w = RADIUS * 1.05;
      const al = 0.55 * vis;
      for (let c = 0; c < 3; c++) {
        const o = (i * 3 + c);
        const side = (c - 1) * w;
        const px = cen[i * 3] - dz * side, pz = cen[i * 3 + 2] + dx * side;
        pos[o * 3] = px; pos[o * 3 + 1] = g(px, pz) + 0.3; pos[o * 3 + 2] = pz;
        col[o * 4] = 1; col[o * 4 + 1] = 1; col[o * 4 + 2] = 1; col[o * 4 + 3] = c === 1 ? al : 0;
      }
    }
    this.shadow.visible = any;
    this.shadow.geometry.attributes.position.needsUpdate = true;
    this.shadow.geometry.attributes.color.needsUpdate = true;
  }

  _rocks(dt, ctx) {
    const cfg = this.cfg, g = ctx.groundFn, t = this.game.time;
    const rk = ctx.rocks;           // {playerI, headI, player:Vector3, head:Vector3, rPlayer, rHead}
    const arr = this.rockData;
    let any = false;
    const m = this._m, q = this._q, e = this._e, v = this._v, s = this._s;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i];
      const focus = d.grp === 0 ? rk?.player : rk?.head;
      const inten = d.grp === 0 ? (rk?.playerI || 0) : (rk?.headI || 0);
      const R = d.grp === 0 ? (rk?.rPlayer || 30) : (rk?.rHead || 55);
      d.vis += ((inten > 0.02 ? 1 : 0) - d.vis) * Math.min(1, dt * 3);
      if (!focus || (d.vis < 0.01 && inten <= 0.02)) {
        d.alive = false; s.set(0, 0, 0); m.compose(v.set(0, -1000, 0), q.identity(), s); this.rocks.setMatrixAt(i, m); continue;
      }
      any = true;
      if (!d.alive || Math.hypot(d.x - focus.x, d.z - focus.z) > R * 1.15) {
        const cp = this.game.camera.position;
        for (let tries = 0; tries < 5; tries++) {
          const a = this.rand() * 6.2832, rr = (d.grp === 0 ? 5 : 8) + Math.sqrt(this.rand()) * R;
          d.x = focus.x + Math.cos(a) * rr; d.z = focus.z + Math.sin(a) * rr;
          if (Math.hypot(d.x - cp.x, d.z - cp.z) > 14) break;   // не прямо перед объективом
        }
        d.alive = true; d.vis = 0;
      }
      const ph = (t / d.per + d.ph);
      const hop = Math.max(0, Math.sin(ph * 3.1416)) ** 1.5;
      const near = inten;
      const y = g(d.x, d.z) + d.sc * 0.4 + hop * d.amp * (0.25 + 1.6 * near) * (d.grp === 0 ? 0.5 : 1);
      const sc = d.sc * d.vis;
      e.set(ph * 0.7 * near, d.rot + ph * 0.3, ph * 0.5 * near);
      q.setFromEuler(e);
      m.compose(v.set(d.x, y, d.z), q, s.set(sc, sc, sc));
      this.rocks.setMatrixAt(i, m);
    }
    this.rocks.visible = any;
    this.rocks.instanceMatrix.needsUpdate = any;
  }
}
