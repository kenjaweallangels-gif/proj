import * as THREE from 'three';

/**
 * Interior materials and shader patches.
 *
 * GPU presets: MeshStandardMaterial with vertex colours (baked AO / light falloff) lit by
 *  - an interior environment map (PMREM of a small procedural "module" room: white panels, LED strips),
 *  - up to two interior point lights (moved to the camera's compartment by StationInterior),
 *  - the Sun only where the ray from the fragment towards the Sun leaves through one of the compartment's
 *    windows (analytic test against window discs / strips / the ring's window bands, see interiorSun()).
 *  Earthshine (hemisphere), ambient and spot lights (exterior floodlights, helmet lamp) are removed, and the
 *  sun shadow map is not sampled (the hull would shadow everything inside).
 * 'lite' preset: unlit MeshBasicMaterial with the full lighting baked into the vertex colours.
 *
 * Exterior carving: every exterior near-scene material discards fragments inside the active interior
 * volumes (truncated cones / boxes in world space), so the parts of the hull model that poke into the
 * cabins (cone caps, closed hatch discs, node stubs, window glow discs, the truss through the ring hub)
 * disappear while the hull around them stays. Volumes are set per frame by StationInterior.
 */

export const MAX_WINDOWS = 6;
export const MAX_CARVE = 12;
export const INTERIOR_LAYER = 4;

const SUN_GLSL = /* glsl */`
uniform vec3 uSunW;
uniform vec4 uWinA[${MAX_WINDOWS}];
uniform vec4 uWinB[${MAX_WINDOWS}];
uniform vec4 uWinN[${MAX_WINDOWS}];
uniform int uWinCount;
varying vec3 vIntW;
float interiorSun() {
  float m = 0.0;
  for (int i = 0; i < ${MAX_WINDOWS}; i++) {
    if (i >= uWinCount) break;
    vec3 n = uWinN[i].xyz;
    float dn = dot(uSunW, n);
    if (dn <= 0.02) continue;
    vec3 a = uWinA[i].xyz;
    float t = dot(a - vIntW, n) / dn;
    if (t < 0.0) continue;
    vec3 h = vIntW + t * uSunW;
    if (uWinN[i].w > 0.5) {
      // ring window band: plane x = a.x, radial band [uWinA.w, uWinB.x] around the ring axis (y = z = 0 world)
      float rho = length(h.yz);
      float s = uWinB[i].w;
      m = max(m, smoothstep(uWinA[i].w - s, uWinA[i].w + s, rho) * (1.0 - smoothstep(uWinB[i].x - s, uWinB[i].x + s, rho)));
    } else {
      vec3 ab = uWinB[i].xyz - a;
      float sp = clamp(dot(h - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      float d = length(h - (a + ab * sp));
      m = max(m, 1.0 - smoothstep(uWinA[i].w - uWinB[i].w, uWinA[i].w + uWinB[i].w, d));
    }
  }
  return m;
}
`;

let _patchedLights = null;
function patchedLightsBegin() {
  if (_patchedLights) return _patchedLights;
  let s = THREE.ShaderChunk.lights_fragment_begin;
  const rep = (a, b) => { if (!s.includes(a)) console.warn('[interior] shader chunk changed, patch skipped:', a); s = s.replace(a, b); };
  rep('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= interiorSun();');
  rep('getSpotLightInfo( spotLight, geometryPosition, directLight );', 'getSpotLightInfo( spotLight, geometryPosition, directLight );\n\t\tdirectLight.color *= 0.0;');
  rep('vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );', 'vec3 irradiance = vec3( 0.0 );');
  rep('irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );', 'irradiance += vec3( 0.0 );');
  _patchedLights = s;
  return s;
}

const WORLD_VARYING = '\n{ vec4 iw = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\n  iw = instanceMatrix * iw;\n#endif\n  vIntW = ( modelMatrix * iw ).xyz; }\n';

/** Uniform block for one compartment's windows. */
export function windowUniforms(sunW) {
  return {
    uSunW: { value: sunW },
    uWinA: { value: Array.from({ length: MAX_WINDOWS }, () => new THREE.Vector4()) },
    uWinB: { value: Array.from({ length: MAX_WINDOWS }, () => new THREE.Vector4()) },
    uWinN: { value: Array.from({ length: MAX_WINDOWS }, () => new THREE.Vector4()) },
    uWinCount: { value: 0 },
  };
}

/**
 * Fill window uniforms. windows: [{type:'disc', c, n, r} | {type:'strip', a, b, n, r} | {type:'band', x, n, r0, r1}]
 * (world frame; outward normal n).
 */
export function setWindows(U, windows) {
  let i = 0;
  for (const w of windows) {
    if (i >= MAX_WINDOWS) break;
    if (w.type === 'band') {
      U.uWinA.value[i].set(w.x, 0, 0, w.r0); U.uWinB.value[i].set(w.r1, 0, 0, 0.04); U.uWinN.value[i].set(w.n.x, w.n.y, w.n.z, 1);
    } else {
      const a = w.a || w.c, b = w.b || w.c;
      U.uWinA.value[i].set(a.x, a.y, a.z, w.r * 0.92); U.uWinB.value[i].set(b.x, b.y, b.z, w.r * 0.1); U.uWinN.value[i].set(w.n.x, w.n.y, w.n.z, 0);
    }
    i++;
  }
  U.uWinCount.value = i;
}

function patchInterior(mat, U) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vIntW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>' + WORLD_VARYING);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + SUN_GLSL).replace('#include <lights_fragment_begin>', patchedLightsBegin());
  };
  mat.customProgramCacheKey = () => 'interiorLit2';
  mat.userData.interior = true;
  return mat;
}

/** Interior environment map: PMREM of a tiny procedural module (white walls, bright LED strips, darker deck). */
export function makeInteriorEnv(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.32, 0.31), side: THREE.BackSide }));
  scene.add(room);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(4, 12).rotateX(-Math.PI / 2).translate(0, -1.99, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.16, 0.17) }));
  scene.add(deck);
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.5, 5.3, 5.0) });
  for (const sx of [-1, 1]) for (let z = -5; z <= 5; z += 2.5) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.7), stripMat);
    s.position.set(sx * 1.6, 1.6, z); s.rotation.set(Math.PI / 2, sx * 0.6, 0);
    scene.add(s);
  }
  // equipment clutter: a few darker and coloured blocks so reflections are not uniform
  const blockMat = [new THREE.MeshBasicMaterial({ color: 0x2a2c30 }), new THREE.MeshBasicMaterial({ color: 0x4a5a70 }), new THREE.MeshBasicMaterial({ color: 0x6a6860 })];
  for (let i = 0; i < 10; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), blockMat[i % 3]);
    const side = i % 4;
    b.position.set(side === 0 ? 1.9 : side === 1 ? -1.9 : (i % 3 - 1) * 1.2, side === 2 ? 1.9 : side === 3 ? -1.9 : (i % 3 - 1) * 1.1, -5 + i * 1.1);
    scene.add(b);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.035);
  pm.dispose();
  scene.traverse((o) => { o.geometry?.dispose?.(); });
  return rt.texture;
}

/**
 * Material set for one compartment (GPU) or the shared unlit set ('lite').
 * Kinds: equip (atlas), paint, metal, glow (unlit emissive colour), glass, plant (double-sided), screen.
 */
export class InteriorMaterials {
  constructor(ctx, atlas, lite) {
    this.ctx = ctx;
    this.lite = lite;
    this.atlas = atlas;
    this.sunW = new THREE.Vector3(0, 1, 0);
    this.env = lite ? null : makeInteriorEnv(ctx.renderer);
    this.glow = new THREE.MeshBasicMaterial({ vertexColors: true, name: 'int:glow' });
    this.glow.userData.interior = true;
    this.glassLite = null;
    this._liteSet = null;
    this.sets = [];
  }

  /** New material set with its own window uniforms (GPU) — or the shared unlit set ('lite'). */
  makeSet(windows = []) {
    if (this.lite) return this._lite();
    const U = windowUniforms(this.sunW);
    setWindows(U, windows);
    const env = this.env, A = this.atlas;
    const std = (name, o) => patchInterior(new THREE.MeshStandardMaterial({ name: `int:${name}`, vertexColors: true, envMap: env, envMapIntensity: 1.0, ...o }), U);
    const set = {
      U,
      equip: std('equip', { map: A.map, emissiveMap: A.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.6, roughness: 0.72, metalness: 0.04 }),
      paint: std('paint', { roughness: 0.62, metalness: 0.05 }),
      metal: std('metal', { roughness: 0.34, metalness: 0.85, envMapIntensity: 1.3 }),
      plant: std('plant', { roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide }),
      glass: new THREE.MeshStandardMaterial({ name: 'int:glass', color: 0x9db6c8, roughness: 0.04, metalness: 0.0, transparent: true, opacity: 0.18, depthWrite: false, envMap: env, envMapIntensity: 1.6, side: THREE.DoubleSide }),
      glow: this.glow,
    };
    set.glass.forceSinglePass = true;
    set.glass.userData.interior = true;
    this.sets.push(set);
    return set;
  }

  _lite() {
    if (this._liteSet) return this._liteSet;
    const A = this.atlas;
    const basic = (name, o) => { const m = new THREE.MeshBasicMaterial({ name: `int:${name}`, vertexColors: true, ...o }); m.userData.interior = true; return m; };
    this._liteSet = {
      U: null,
      equip: basic('equip', { map: A.map }),
      paint: basic('paint', {}),
      metal: basic('metal', {}),
      plant: basic('plant', { side: THREE.DoubleSide }),
      glass: basic('glass', { color: 0x9db6c8, transparent: true, opacity: 0.12, depthWrite: false }),
      glow: this.glow,
    };
    this._liteSet.glass.forceSinglePass = true;
    return this._liteSet;
  }

  update(sunDir) { this.sunW.copy(sunDir); }
}

// ------------------------------------------------------------------------------------------ carving

const CARVE_GLSL = /* glsl */`
uniform vec4 uCarveA[${MAX_CARVE}];
uniform vec4 uCarveB[${MAX_CARVE}];
uniform vec4 uCarveC[${MAX_CARVE}];
uniform int uCarveCount;
varying vec3 vCarveW;
bool carved(vec3 p) {
  for (int i = 0; i < ${MAX_CARVE}; i++) {
    if (i >= uCarveCount) break;
    vec4 A = uCarveA[i], B = uCarveB[i], C = uCarveC[i];
    if (C.w > 5.0) {
      // oriented box: centre A.xyz, half x = A.w, axis x = B.xyz, half y = B.w, axis y = C.xyz, half z = C.w - 10
      vec3 d = p - A.xyz;
      vec3 ax = B.xyz, ay = C.xyz, az = cross(ax, ay);
      if (abs(dot(d, ax)) < A.w && abs(dot(d, ay)) < B.w && abs(dot(d, az)) < C.w - 10.0) return true;
    } else if (C.w > 1.5) {
      // torus about the world X axis through A.xyz: major radius A.w, minor radius B.x, x range +-B.y
      vec3 d = p - A.xyz;
      float q = length(d.yz) - A.w;
      if (q * q + d.x * d.x < B.x * B.x) return true;
    } else {
      vec3 ab = B.xyz - A.xyz;
      float L2 = dot(ab, ab);
      float t = dot(p - A.xyz, ab) / L2;
      if (t > 0.0 && t < 1.0) {
        float r = mix(A.w, B.w, t);
        vec3 q = p - (A.xyz + ab * t);
        if (dot(q, q) < r * r) return true;
      }
    }
  }
  return false;
}
`;

/** Shared carve uniforms (all exterior materials point at the same objects). */
export function carveUniforms() {
  return {
    uCarveA: { value: Array.from({ length: MAX_CARVE }, () => new THREE.Vector4()) },
    uCarveB: { value: Array.from({ length: MAX_CARVE }, () => new THREE.Vector4()) },
    uCarveC: { value: Array.from({ length: MAX_CARVE }, () => new THREE.Vector4()) },
    uCarveCount: { value: 0 },
  };
}

/**
 * Patch one exterior material (built-in mesh materials only) to discard carved fragments. Chains an existing
 * onBeforeCompile / customProgramCacheKey.
 */
export function patchCarve(mat, U) {
  if (!mat || mat.userData.interior || mat.userData.carved) return false;
  if (!(mat.isMeshStandardMaterial || mat.isMeshLambertMaterial || mat.isMeshBasicMaterial || mat.isMeshPhongMaterial)) return false;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  const hasPrev = prev !== THREE.Material.prototype.onBeforeCompile;
  mat.onBeforeCompile = function (sh, r) {
    if (hasPrev) prev.call(this, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCarveW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 cw = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\n  cw = instanceMatrix * cw;\n#endif\n  vCarveW = ( modelMatrix * cw ).xyz; }\n');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + CARVE_GLSL)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n\tif ( uCarveCount > 0 && carved( vCarveW ) ) discard;');
  };
  const prevKeyFn = prevKey !== THREE.Material.prototype.customProgramCacheKey ? prevKey : null;
  mat.customProgramCacheKey = function () { return (prevKeyFn ? prevKeyFn.call(this) : '') + '|carve1'; };
  mat.userData.carved = true;
  mat.needsUpdate = true;
  return true;
}

/** Write volume i: truncated cone a -> b with radii ra, rb. */
export function packCone(U, i, a, b, ra, rb) {
  U.uCarveA.value[i].set(a.x, a.y, a.z, ra);
  U.uCarveB.value[i].set(b.x, b.y, b.z, rb);
  U.uCarveC.value[i].set(0, 0, 0, 0);
}

/** Write volume i: oriented box (centre, half sizes hx/hy/hz along unit axes ax/ay; az = ax x ay). */
export function packBox(U, i, c, ax, ay, hx, hy, hz) {
  U.uCarveA.value[i].set(c.x, c.y, c.z, hx);
  U.uCarveB.value[i].set(ax.x, ax.y, ax.z, hy);
  U.uCarveC.value[i].set(ay.x, ay.y, ay.z, hz + 10.0);   // w > 5 marks a box; the shader subtracts 10
}

/** Write volume i: torus about the world X axis through c (major radius R, minor radius r). */
export function packTorus(U, i, c, R, r) {
  U.uCarveA.value[i].set(c.x, c.y, c.z, R);
  U.uCarveB.value[i].set(r, 0, 0, 0);
  U.uCarveC.value[i].set(0, 0, 0, 2.0);
}
