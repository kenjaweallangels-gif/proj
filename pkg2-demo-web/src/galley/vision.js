// Модель зрения человека в AR-очках (VITURE Luma Ultra по открытым характеристикам: поле 52° по диагонали,
// виртуальный экран ≈ 4 м, яркость до 1250 нит, электрохромное затемнение 0,5–40 %, коррекция близорукости
// до −4 D колесом диоптрий). Что моделируется:
//  • аккомодация глаза: фокус «догоняет» точку взгляда с задержкой; диапазон зависит от возраста (Хофстеттер)
//    и рефракции; всё, что ближе/дальше фокуса, размыто по глубине кадра (диаметр зрачка × расфокусировка);
//  • конфликт вергенции и аккомодации: изображение дисплея всегда на ≈ 4 м — при работе вблизи голограммы
//    расплываются, при взгляде на голограмму вблизи реальные предметы за ней — тоже;
//  • зрачок по яркости (Мун — Спенсер) и возрасту, световая адаптация с разной скоростью к свету и к темноте;
//  • периферия: падение остроты и цветового зрения, сумеречный сдвиг (Пуркинье) при слабом свете;
//  • рассеяние в глазу и на линзах (ореолы ламп растут с возрастом и грязью на линзах), блик-«призрак» от линзы;
//  • очки: оправа и корпус (вблизи — не в фокусе), нос, затемнение линз, окно дисплея 52° с виньетированием и
//    хроматизмом по краю, двоение при неверном межзрачковом расстоянии, задержка отрисовки голограмм при
//    поворотах головы, смаз при быстрых поворотах; моргание, усталость (слёзная плёнка), вспышка фото.
import * as THREE from 'three';
import { LAYER_HOLO, LAYER_LABEL, LAYER_REAL } from '../engine/holo.js';
import { fbm, normalize } from '../scene/textures.js';

export const PRESETS = {
  norm: { label: 'Норма, 30 лет', age: 30, refraction: 0, inserts: false, dial: 0, dirt: 0.1, fatigue: 0, ipdErr: 0, dim: 0 },
  presby: { label: '52 года (пресбиопия)', age: 52, refraction: 0, inserts: false, dial: 0, dirt: 0.15, fatigue: 0.2, ipdErr: 0, dim: 0 },
  myopia: { label: 'Близорукость −2,5 D без коррекции', age: 30, refraction: -2.5, inserts: false, dial: 0, dirt: 0.1, fatigue: 0, ipdErr: 0, dim: 0 },
  myopiaDial: { label: '−2,5 D: колесо диоптрий −2,5 (дисплей резкий, цех — нет)', age: 30, refraction: -2.5, inserts: false, dial: -2.5, dirt: 0.1, fatigue: 0, ipdErr: 0, dim: 0 },
  myopiaFull: { label: '−2,5 D: вставки + колесо (всё резко)', age: 30, refraction: -2.5, inserts: true, dial: 0, dirt: 0.1, fatigue: 0, ipdErr: 0, dim: 0 },
  bright: { label: 'Яркий свет, затемнение выкл.', age: 30, refraction: 0, inserts: false, dial: 0, dirt: 0.1, fatigue: 0, ipdErr: 0, dim: 0, light: 2.2 },
  dimmed: { label: 'Затемнение линз 70 %', age: 30, refraction: 0, inserts: false, dial: 0, dirt: 0.1, fatigue: 0, ipdErr: 0, dim: 0.7 },
  dirty: { label: 'Захватанные линзы', age: 35, refraction: 0, inserts: false, dial: 0, dirt: 1, fatigue: 0.1, ipdErr: 0, dim: 0 },
  tired: { label: 'Конец смены (усталость)', age: 40, refraction: 0, inserts: false, dial: 0, dirt: 0.3, fatigue: 0.9, ipdErr: 0, dim: 0 },
  ipd: { label: 'Межзрачковое не настроено (+6 мм)', age: 30, refraction: 0, inserts: false, dial: 0, dirt: 0.1, fatigue: 0, ipdErr: 6, dim: 0 },
};

export const DISPLAY = { diagDeg: 52, aspect: 16 / 9, centerDeg: [0, -2], distM: 4, nits: 1250, latencyMs: 22 };

/** Окно дисплея: 52° по диагонали, 16:9 → градусы по горизонтали и вертикали. */
export function displayWindow(diag = DISPLAY.diagDeg, aspect = DISPLAY.aspect) {
  const td = Math.tan(THREE.MathUtils.degToRad(diag / 2));
  const tv = td / Math.sqrt(1 + aspect * aspect);
  return { h: THREE.MathUtils.radToDeg(2 * Math.atan(tv * aspect)), v: THREE.MathUtils.radToDeg(2 * Math.atan(tv)) };
}

/** Амплитуда аккомодации, дптр (средняя по Хофстеттеру), с поправкой на усталость. */
export function accommodationAmplitude(age, fatigue = 0) { return Math.max(0.3, 18.5 - 0.3 * age) - fatigue * 0.8; }

/** Диаметр зрачка, мм (Мун — Спенсер) по яркости поля, кд/м², с возрастным сужением. */
export function pupilDiameter(lumCd, age = 30) {
  const d = 4.9 - 3 * Math.tanh(0.4 * Math.log10(Math.max(lumCd, 1e-4)));
  return THREE.MathUtils.clamp(d * (1 - 0.008 * Math.max(0, age - 30)), 1.8, 8);
}

/** Физиология глаза: аккомодация, зрачок, моргание. Всё в объектных диоптриях (1 / расстояние, м). */
export class Eye {
  constructor(params) {
    this.p = params;
    this.acc = 0.5;                  // текущая аккомодация (дптр усилия хрусталика)
    this.pupil = 4;
    this.blinkT = 3; this.lid = 0; this.sinceBlink = 0;
    this.focusDist = 2;
  }

  get rEff() { return this.p.inserts ? 0 : this.p.refraction; }
  get amp() { return accommodationAmplitude(this.p.age, this.p.fatigue); }
  /** Объект в фокусе, дптр. */
  get focusD() { return this.acc - this.rEff; }
  /** Где для глаза находится изображение дисплея, дптр (колесо диоптрий сдвигает его ближе для близоруких). */
  get displayD() { return 1 / DISPLAY.distM - this.p.dial; }

  update(dt, { gazeDist, gazeHolo, lumCd }) {
    const objD = 1 / Math.max(0.12, gazeDist);
    // при взгляде на голограмму аккомодацию тянут и вергенция (расстояние до окна), и резкость (плоскость дисплея)
    const wantD = gazeHolo ? THREE.MathUtils.lerp(objD, this.displayD, 0.6) : objD;
    const target = THREE.MathUtils.clamp(wantD + this.rEff, 0, this.amp);
    const tau = 0.28 + this.p.age * 0.004 + this.p.fatigue * 0.25;
    this.acc += (target - this.acc) * (1 - Math.exp(-dt / tau));
    const pd = pupilDiameter(lumCd, this.p.age);
    this.pupil += (pd - this.pupil) * (1 - Math.exp(-dt / (pd < this.pupil ? 0.35 : 1.4)));
    this.focusDist = 1 / Math.max(0.01, this.focusD);
    // моргание: 15–20 раз в минуту, чаще при усталости; длительность ≈ 150 мс
    this.blinkT -= dt;
    this.sinceBlink += dt;
    if (this.blinkT < 0) {
      const t = -this.blinkT;
      this.lid = Math.max(0, 1 - Math.abs(t - 0.075) / 0.075);
      if (t > 0.15) { this.blinkT = THREE.MathUtils.lerp(4.5, 2.0, this.p.fatigue) * (0.6 + Math.random() * 0.8); this.lid = 0; this.sinceBlink = 0; }
    }
  }
}

function dirtTexture() {
  const S = 512;
  const a = normalize(fbm(S, { sx: 3, octaves: 6, seed: 501 }));
  const b = normalize(fbm(S, { sx: 2, sy: 12, octaves: 4, seed: 502 }));
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    // пятна-отпечатки и вытертые полосы
    const v = Math.max(0, a[i] - 0.55) * 2.2 + Math.max(0, b[i] - 0.7) * 1.6;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.min(255, v * 255); data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S);
  t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  return t;
}

const QUAD_VS = 'out vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const LUM_FS = /* glsl */`
precision highp float;
uniform sampler2D tReal; uniform sampler2D tPrev; uniform float dt; uniform float lod; uniform float first;
in vec2 vUv;
void main(){
  float s = 0.0;
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
    vec2 uv = vec2((float(i) + 0.5) / 4.0, (float(j) + 0.5) / 4.0) * 0.8 + 0.1;
    vec3 c = textureLod(tReal, uv, lod).rgb;
    float w = 1.0 - 0.5 * length(uv - 0.5);                         // центр кадра весомее
    s += w * log(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
  }
  float cur = exp(s / 13.3);
  float prev = texture(tPrev, vec2(0.5)).r;
  float tau = cur > prev ? 0.7 : 3.5;                                // к свету быстрее, к темноте медленнее
  float a = first > 0.5 ? 1.0 : 1.0 - exp(-dt / tau);
  gl_FragColor = vec4(mix(prev, cur, a), cur, 0.0, 1.0);
}`;

const FINAL_FS = /* glsl */`
precision highp float;
uniform sampler2D tReal; uniform sampler2D tDepth; uniform sampler2D tHolo; uniform sampler2D tLum; uniform sampler2D tDirt;
uniform vec2 res; uniform float tanV; uniform float aspect; uniform float cNear; uniform float cFar; uniform float time;
uniform float focusD; uniform float pupilMM; uniform float dispD; uniform float glassesOn; uniform float dispOn;
uniform float transmit; uniform float dispBright; uniform float blink; uniform float flash; uniform vec2 angVel;
uniform float fatigueBlur; uniform float age; uniform float dirt; uniform float ipdPx; uniform vec4 disp; uniform float maxLod;
uniform float exposureBias; uniform float bootFade; uniform float dbg;
in vec2 vUv;

const vec2 P[12] = vec2[12](vec2(-0.326,-0.406),vec2(-0.840,-0.074),vec2(-0.696,0.457),vec2(-0.203,0.621),vec2(0.962,-0.195),vec2(0.473,-0.480),vec2(0.519,0.767),vec2(0.185,-0.893),vec2(0.507,0.064),vec2(0.896,0.412),vec2(-0.322,-0.933),vec2(-0.792,-0.598));
float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float linDepth(float z){ float n = cNear, f = cFar; return (2.0 * n * f) / (f + n - (z * 2.0 - 1.0) * (f - n)); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }

vec3 blurReal(vec2 uv, float r){
  if (r < 0.6) return texture(tReal, uv).rgb;
  float lod = clamp(log2(r) - 0.6, 0.0, maxLod);
  vec3 acc = textureLod(tReal, uv, lod).rgb;
  for (int i = 0; i < 12; i++) acc += textureLod(tReal, uv + P[i] * r / res, lod).rgb;
  return acc / 13.0;
}
vec3 blurHolo(vec2 uv, float r){
  if (r < 0.6) return texture(tHolo, uv).rgb;
  float lod = clamp(log2(r) - 0.6, 0.0, maxLod);
  vec3 acc = textureLod(tHolo, uv, lod).rgb;
  for (int i = 0; i < 12; i++) acc += textureLod(tHolo, uv + P[i] * r / res, lod).rgb;
  return acc / 13.0;
}

void main(){
  if (dbg > 0.5) {
    float dd = linDepth(texture(tDepth, vUv).r);
    gl_FragColor = dbg < 1.5 ? vec4(toSRGB(aces(texture(tReal, vUv).rgb)), 1.0) : dbg < 2.5 ? vec4(vec3(dd / 10.0), 1.0) : vec4(toSRGB(aces(textureLod(tReal, vUv, 4.0).rgb)), 1.0);
    return;
  }
  vec2 ndc = vUv * 2.0 - 1.0;
  vec2 tn = vec2(ndc.x * tanV * aspect, ndc.y * tanV);
  vec2 a = degrees(vec2(atan(tn.x), atan(tn.y / sqrt(1.0 + tn.x * tn.x))));
  float ecc = length(a);
  float pxPerRad = res.y / (2.0 * atan(tanV));

  // ---- реальность: расфокусировка по глубине + периферия + смаз при повороте ----
  float d = linDepth(texture(tDepth, vUv).r) * sqrt(1.0 + dot(tn, tn));
  float dD = abs(1.0 / max(d, 0.05) - focusD);
  float rDef = pupilMM * 1e-3 * dD * pxPerRad;
  float rPer = smoothstep(24.0, 75.0, ecc) * 2.2 * (res.y / 900.0);
  float r = sqrt(rDef * rDef + rPer * rPer) + fatigueBlur;
  vec3 col = blurReal(vUv, r);
  vec2 sm = angVel * pxPerRad * 0.012;                          // смаз ≈ 12 мс «выдержки» сетчатки при повороте
  float smL = length(sm);
  if (smL > 1.5) {
    vec3 m = col; for (int i = 1; i <= 6; i++) m += blurReal(vUv + sm * (float(i) / 6.0 - 0.5) / res * vec2(-1.0, 1.0), r);
    col = m / 7.0;
  }
  // ---- адаптация ----
  float adapted = texture(tLum, vec2(0.5)).r;
  float expo = clamp(0.18 / max(adapted, 1e-4), 0.08, 12.0) * exposureBias;
  vec3 lin = col * expo;
  // ---- рассеяние в глазу и на линзах: ореолы ярких источников ----
  vec3 g = (textureLod(tReal, vUv, 4.0).rgb * 0.5 + textureLod(tReal, vUv, 6.0).rgb * 0.35 + textureLod(tReal, vUv, 8.0).rgb * 0.15) * expo;
  float dirtM = texture(tDirt, vUv * vec2(aspect, 1.0) * 0.7).r * dirt * glassesOn;
  float scatter = 0.035 + max(age - 30.0, 0.0) * 0.0025 + dirtM * 0.35;
  lin += max(g - 0.9, 0.0) * scatter * 3.0;
  // блик-«призрак» от задней поверхности линзы (зеркально к центру)
  vec3 ghost = textureLod(tReal, vec2(1.0) - vUv * 0.9 - 0.05, 5.0).rgb * expo;
  lin += max(ghost - 1.5, 0.0) * 0.012 * glassesOn;
  // ---- сумеречное зрение и периферия ----
  float L = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  float mesopic = 1.0 - smoothstep(0.003, 0.05, adapted);
  lin = mix(lin, vec3(L) * vec3(0.85, 0.95, 1.15), clamp(mesopic * 0.7 + smoothstep(32.0, 75.0, ecc) * 0.35, 0.0, 1.0));
  // ---- линзы очков: пропускание (затемнение), лёгкий тон ----
  float lensSD = sdBox(a - vec2(0.0, -6.0), vec2(56.0, 26.0), 16.0);
  float inLens = glassesOn * (1.0 - smoothstep(-3.5, 3.5, lensSD));
  lin *= mix(vec3(1.0), transmit * vec3(0.94, 0.98, 1.0), inLens);
  vec3 c = toSRGB(aces(lin));

  // ---- голограммы: окно дисплея, фокус дисплея, двоение (МЗР), хроматизм у края, задержка (в позе камеры) ----
  vec2 ac = a - disp.xy;
  float wsd = sdBox(ac, disp.zw, 1.2);
  float wm = dispOn * glassesOn * (1.0 - smoothstep(-0.4, 0.4, wsd));
  if (wm > 0.0) {
    float rH = pupilMM * 1e-3 * abs(dispD - focusD) * pxPerRad + fatigueBlur;
    float edge = smoothstep(0.55, 1.0, length(ac / disp.zw));
    vec2 ca = (vUv - 0.5) * edge * 0.004;
    vec3 h;
    h.r = blurHolo(vUv + ca, rH).r; h.g = blurHolo(vUv, rH).g; h.b = blurHolo(vUv - ca, rH).b;
    h += blurHolo(vUv + vec2(ipdPx, 0.0) / res, rH) * (ipdPx > 0.5 ? 0.45 : 0.0);
    h += blurHolo(vUv + vec2(0.0, 3.0) / res, rH + 1.0) * 0.05;                    // вторичное отражение призмы
    h *= dispBright * (1.0 - 0.25 * edge) * bootFade;
    vec3 hd = 1.0 - exp(-h * 2.6);
    hd = pow(hd, vec3(1.0 / 1.15));
    c = 1.0 - (1.0 - c) * (1.0 - hd * wm);
    c += glassesOn * vec3(0.25, 0.85, 0.75) * (1.0 - smoothstep(0.0, 0.3, abs(wsd))) * 0.04 * dispOn;
  }
  // ---- оправа и корпус очков (в 2–3 см от глаза — всегда не в фокусе), нос, щёки ----
  float housing = glassesOn * smoothstep(15.0, 24.0, a.y) * (1.0 - smoothstep(55.0, 70.0, abs(a.x)));
  c = mix(c, vec3(0.012, 0.013, 0.016) + vec3(0.03) * (1.0 - smoothstep(19.0, 32.0, a.y)), housing * 0.97);
  float rim = glassesOn * (1.0 - smoothstep(0.5, 8.0, abs(lensSD)));
  c = mix(c, vec3(0.015, 0.016, 0.02), rim * 0.8 * (1.0 - housing));
  float w = max(0.0, -20.0 - a.y) * 0.7 + 1.0;
  float nose = (1.0 - smoothstep(0.0, 11.0, abs(a.x) - w)) * smoothstep(-16.0, -36.0, a.y);
  c = mix(c, vec3(0.24, 0.17, 0.14) * (0.75 + 0.25 * smoothstep(-42.0, -20.0, a.y)), nose * 0.35);
  float cheek = smoothstep(-28.0, -46.0, a.y) * smoothstep(10.0, 36.0, abs(a.x));
  c = mix(c, vec3(0.13, 0.095, 0.085), cheek * 0.5);
  // виньетирование поля зрения
  vec2 qv = vUv - 0.5; qv.x *= aspect;
  c *= 1.0 - 0.5 * smoothstep(0.62, 1.15, length(qv * vec2(0.82, 1.28)));
  c = mix(c, vec3(1.0), flash * 0.5);
  // веки при моргании
  float lt = mix(64.0, -3.0, blink), lb = mix(-64.0, -3.0, blink);
  float lid = max(smoothstep(lt - 6.0, lt + 1.0, a.y), smoothstep(lb + 6.0, lb - 1.0, a.y));
  c = mix(c, vec3(0.03, 0.012, 0.01), lid);
  c += (hash(vUv * res + fract(time) * 100.0) - 0.5) * 0.006;
  gl_FragColor = vec4(c, 1.0);
}`;

export class VisionRenderer {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.holoCam = camera.clone();
    this.win = displayWindow();
    const mk = (opts = {}) => new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType, samples: 4, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, ...opts,
    });
    this.rtReal = mk({ samples: 0 });
    this.rtReal.depthTexture = new THREE.DepthTexture(4, 4);
    this.rtReal.depthTexture.type = THREE.UnsignedIntType;
    this.rtHolo = mk();
    const lumRT = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
    this.lum = [lumRT(), lumRT()];
    this.lumIdx = 0; this.first = 1;
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qScene = new THREE.Scene(); this.qScene.add(this.quad);
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.lumMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: LUM_FS,
      uniforms: { tReal: { value: null }, tPrev: { value: null }, dt: { value: 0 }, lod: { value: 6 }, first: { value: 1 } } });
    this.finalMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: FINAL_FS, depthTest: false, depthWrite: false,
      uniforms: Object.fromEntries(Object.entries({
        tReal: null, tDepth: null, tHolo: null, tLum: null, tDirt: dirtTexture(), res: new THREE.Vector2(1, 1), tanV: 1, aspect: 1, cNear: 0.05, cFar: 80,
        time: 0, focusD: 0.5, pupilMM: 4, dispD: 0.25, glassesOn: 0, dispOn: 0, transmit: 0.9, dispBright: 1, blink: 0, flash: 0,
        angVel: new THREE.Vector2(), fatigueBlur: 0, age: 30, dirt: 0.1, ipdPx: 0, disp: new THREE.Vector4(0, -2, 22, 12), maxLod: 7,
        exposureBias: 1, bootFade: 1, dbg: 0,
      }).map(([k, v]) => [k, { value: v }])) });
    this.u = this.finalMat.uniforms;
    this.u.disp.value.set(DISPLAY.centerDeg[0], DISPLAY.centerDeg[1], this.win.h / 2, this.win.v / 2);
    this.history = [];                 // поза камеры для задержки голограмм
    this.occluder = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.occlusion = false;
    this.latencyMs = DISPLAY.latencyMs;
  }

  setSize(w, h, pr) {
    const W = Math.floor(w * pr), H = Math.floor(h * pr);
    this.rtReal.setSize(W, H); this.rtHolo.setSize(W, H);
    this.u.res.value.set(W, H);
    this.u.aspect.value = w / h;
    this.u.maxLod.value = Math.floor(Math.log2(Math.max(W, H))) - 1;
    this.lumMat.uniforms.lod.value = Math.max(0, Math.floor(Math.log2(Math.max(W, H))) - 4);
  }

  /** Поза камеры с задержкой latency (интерполяция по истории). */
  delayedPose(now) {
    const t = now - this.latencyMs / 1000;
    const H = this.history;
    for (let i = H.length - 1; i > 0; i--) {
      if (H[i - 1].t <= t) {
        const a = H[i - 1], b = H[i], k = (t - a.t) / Math.max(1e-6, b.t - a.t);
        this.holoCam.position.lerpVectors(a.p, b.p, k);
        this.holoCam.quaternion.slerpQuaternions(a.q, b.q, k);
        return;
      }
    }
    this.holoCam.position.copy(this.camera.position); this.holoCam.quaternion.copy(this.camera.quaternion);
  }

  render(dt, now, st) {
    const { renderer, scene, camera, u } = this;
    camera.updateMatrixWorld();
    this.history.push({ t: now, p: camera.position.clone(), q: camera.quaternion.clone() });
    while (this.history.length > 30) this.history.shift();
    // 1) реальность
    camera.layers.set(LAYER_REAL); camera.layers.enable(LAYER_LABEL);
    renderer.setRenderTarget(this.rtReal);
    renderer.render(scene, camera);
    // 2) голограммы — с позой «из прошлого» (задержка дисплея), на прозрачном фоне
    this.holoCam.copy(camera);
    this.delayedPose(now);
    this.holoCam.updateMatrixWorld();
    this.beforeHolo?.(this.holoCam);
    const bg = scene.background, env = scene.environment;
    scene.background = null;
    renderer.setRenderTarget(this.rtHolo);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    if (this.occlusion) {                  // окклюзия по датчику глубины: реальные предметы закрывают голограммы
      scene.overrideMaterial = this.occluder;
      this.holoCam.layers.set(LAYER_REAL);
      renderer.render(scene, this.holoCam);
      scene.overrideMaterial = null;
      renderer.autoClear = false;
    }
    this.holoCam.layers.set(LAYER_HOLO);
    renderer.render(scene, this.holoCam);
    renderer.autoClear = true;
    scene.background = bg; scene.environment = env;
    // 3) адаптация к яркости
    const prev = this.lum[this.lumIdx], next = this.lum[1 - this.lumIdx];
    this.lumMat.uniforms.tReal.value = this.rtReal.texture;
    this.lumMat.uniforms.tPrev.value = prev.texture;
    this.lumMat.uniforms.dt.value = dt;
    this.lumMat.uniforms.first.value = this.first;
    this.first = 0;
    this.quad.material = this.lumMat;
    renderer.setRenderTarget(next);
    renderer.render(this.qScene, this.qCam);
    this.lumIdx = 1 - this.lumIdx;
    // 4) итог: глаз + очки
    Object.assign(u.tReal, { value: this.rtReal.texture });
    u.tDepth.value = this.rtReal.depthTexture;
    u.tHolo.value = this.rtHolo.texture;
    u.tLum.value = next.texture;
    u.tanV.value = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    u.cNear.value = camera.near; u.cFar.value = camera.far;
    u.time.value = now;
    for (const [k, v] of Object.entries(st)) if (u[k]) { if (v?.isVector2) u[k].value.copy(v); else u[k].value = v; }
    this.quad.material = this.finalMat;
    renderer.setRenderTarget(null);
    renderer.render(this.qScene, this.qCam);
  }

  /** Средняя адаптированная яркость (для зрачка), отн. ед. → кд/м² — по калибровке «цех ≈ 150 кд/м²». */
  readLum() {
    const buf = new Float32Array(4);
    try { this.renderer.readRenderTargetPixels(this.lum[this.lumIdx], 0, 0, 1, 1, buf); } catch { return 150; }
    return buf[0] * 600;
  }
}
