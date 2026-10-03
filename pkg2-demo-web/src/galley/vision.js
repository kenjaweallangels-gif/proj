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
//  • очки: оправа и корпус (вблизи — не в фокусе), нос, затемнение линз, окно дисплея с виньетированием и
//    хроматизмом по краю, двоение при неверном межзрачковом расстоянии, задержка отрисовки голограмм при
//    поворотах головы, смаз при быстрых поворотах; моргание, усталость (слёзная плёнка), вспышка фото;
//  • два глаза (binocular.js): поле каждого глаза (≈ 60° к носу, ≈ 100° к виску), зона перекрытия ≈ 120°,
//    монокулярные серпы по краям; рамка, переносица, дужки и нос у каждого глаза свои — в зоне перекрытия
//    они полупрозрачны (их видит только один глаз); вне зоны слияния Panum предметы ближе или дальше точки
//    фиксации двоятся — и окно дисплея на 4 м, когда смотришь на деталь в руках; ведущий глаз весомее;
//  • апертура очков по размерам рамки конкретной модели: сквозь линзу — затемнение и окно дисплея, вокруг —
//    открытая периферия без затемнения; режим «полное поле ≈ 200°» — равнопромежуточная проекция развёртки
//    пяти граней куба (то, что видит человек целиком), режим «центр 72°» — как на мониторе.
// Параметры дисплея и линз берутся из профиля устройства (glasses.js): VITURE Luma/Beast, XREAL Air 2/One/Aura.
import * as THREE from 'three';
import { LAYER_HOLO, LAYER_LABEL, LAYER_REAL } from '../engine/holo.js';
import { fbm, normalize } from '../scene/textures.js';
import { CUBE_FACES, FIELD, IPD_MM, eyeAperture } from './binocular.js';
import { DESIGN } from './glasses_model.js';

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
  domL: { label: 'Ведущий левый глаз', age: 30, refraction: 0, inserts: false, dial: 0, dirt: 0.1, fatigue: 0, ipdErr: 0, dim: 0, domEye: 'L' },
  monoR: { label: 'Один глаз (левый закрыт)', age: 30, refraction: 0, inserts: false, dial: 0, dirt: 0.1, fatigue: 0, ipdErr: 0, dim: 0, eyes: 'R' },
};

/** Калибровка: 1 ед. яркости рендера ≈ 120 кд/м² (белая поверхность при ≈ 500 лк — около 1 ед.). */
export const CD_PER_UNIT = 120;

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
  get amp() { return accommodationAmplitude(this.p.age, this.fat); }
  /** Объект в фокусе, дптр. */
  get focusD() { return this.acc - this.rEff; }
  /** Где для глаза находится изображение дисплея, дптр (колесо диоптрий сдвигает его ближе для близоруких). */
  get displayD() { return 1 / (this.distM || DISPLAY.distM) - this.p.dial; }
  /** Усталость: из параметров + накопленная за смену (вес очков на переносице, сухость глаз). */
  get fat() { return Math.min(1, this.p.fatigue + (this.wear || 0)); }

  update(dt, { gazeDist, gazeHolo, lumCd }) {
    const objD = 1 / Math.max(0.12, gazeDist);
    // при взгляде на голограмму аккомодацию тянут и вергенция (расстояние до окна), и резкость (плоскость дисплея)
    const wantD = gazeHolo ? THREE.MathUtils.lerp(objD, this.displayD, 0.6) : objD;
    const target = THREE.MathUtils.clamp(wantD + this.rEff, 0, this.amp);
    const tau = 0.28 + this.p.age * 0.004 + this.fat * 0.25;
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
      if (t > 0.15) { this.blinkT = THREE.MathUtils.lerp(4.5, 2.0, this.fat) * (0.6 + Math.random() * 0.8); this.lid = 0; this.sinceBlink = 0; }
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
uniform sampler2D tReal; uniform sampler2D tPrev; uniform float dt; uniform float lod; uniform float first; uniform vec2 uvScale;
in vec2 vUv;
void main(){
  float s = 0.0;
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
    vec2 uv = vec2((float(i) + 0.5) / 4.0, (float(j) + 0.5) / 4.0) * 0.8 + 0.1;
    vec3 c = textureLod(tReal, uv * uvScale, lod).rgb;            // в режиме полного поля — грань «вперёд» развёртки
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
uniform sampler2D tAtlas; uniform sampler2D tAtlasDepth;
uniform vec2 res; uniform float tanV; uniform float aspect; uniform float cNear; uniform float cFar; uniform float time;
uniform float fieldMode; uniform vec2 fieldSpan; uniform float atlasFace; uniform float aNear; uniform float aFar;
uniform float focusD; uniform float pupilMM; uniform float dispD; uniform float glassesOn; uniform float dispOn;
uniform float transmit; uniform float dispBright; uniform float blink; uniform float flash; uniform vec2 angVel;
uniform float fatigueBlur; uniform float age; uniform float dirt; uniform float ipdErr; uniform vec4 disp; uniform float maxLod;
uniform float exposureBias; uniform float bootFade; uniform float dbg; uniform float dispNits; uniform float sharpen; uniform float cdPerUnit;
uniform float ghostK; uniform float edgeSoft;
uniform float vergD; uniform float ipdM; uniform float domR; uniform vec2 eyeOn; uniform float diplo; uniform float overlay;
uniform vec4 lensA; uniform vec4 frameA; uniform vec4 fieldA; uniform float lensFrac; uniform float dispDistD;
in vec2 vUv;

const float D2R = 0.0174532925;
const vec2 P[12] = vec2[12](vec2(-0.326,-0.406),vec2(-0.840,-0.074),vec2(-0.696,0.457),vec2(-0.203,0.621),vec2(0.962,-0.195),vec2(0.473,-0.480),vec2(0.519,0.767),vec2(0.185,-0.893),vec2(0.507,0.064),vec2(0.896,0.412),vec2(-0.322,-0.933),vec2(-0.792,-0.598));
float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
float linZ(float z, float n, float f){ return (2.0 * n * f) / (f + n - (z * 2.0 - 1.0) * (f - n)); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }

// ---- направления: углы (азимут, возвышение) ↔ вектор головы (x вправо, y вверх, z вперёд) ----
vec3 dirOf(vec2 a){ float ce = cos(a.y * D2R); return vec3(ce * sin(a.x * D2R), sin(a.y * D2R), ce * cos(a.x * D2R)); }
vec2 angOf(vec3 d){ return degrees(vec2(atan(d.x, d.z), atan(d.y, length(d.xz)))); }
vec2 uvPersp(vec2 a){ float tx = tan(a.x * D2R); return vec2(tx / (tanV * aspect), tan(a.y * D2R) * sqrt(1.0 + tx * tx) / tanV) * 0.5 + 0.5; }
vec2 angOfScreen(vec2 uv){
  if (fieldMode < 0.5) { vec2 tn = (uv * 2.0 - 1.0) * vec2(tanV * aspect, tanV); return degrees(vec2(atan(tn.x), atan(tn.y / sqrt(1.0 + tn.x * tn.x)))); }
  vec2 t = (uv - 0.5) * fieldSpan; float r = length(t);                // равнопромежуточная проекция: угол от центра сохраняется
  if (r < 1e-4) return vec2(0.0);
  return angOf(vec3(t / r * sin(r * D2R), cos(r * D2R)));
}
// развёртка 5 граней куба (3×2): вперёд, вправо, влево, вверх, вниз
vec2 atlasUV(vec3 d, float lod, out float cosF){
  vec3 ad = abs(d); vec3 F; vec3 R; vec3 U; float i;
  if (ad.z >= ad.x && ad.z >= ad.y) { i = 0.0; F = vec3(0,0,1); R = vec3(1,0,0); U = vec3(0,1,0); }
  else if (ad.x >= ad.y) { if (d.x > 0.0) { i = 1.0; F = vec3(1,0,0); R = vec3(0,0,-1); U = vec3(0,1,0); } else { i = 2.0; F = vec3(-1,0,0); R = vec3(0,0,1); U = vec3(0,1,0); } }
  else { if (d.y > 0.0) { i = 3.0; F = vec3(0,1,0); R = vec3(1,0,0); U = vec3(0,0,-1); } else { i = 4.0; F = vec3(0,-1,0); R = vec3(1,0,0); U = vec3(0,0,1); } }
  float k = max(dot(d, F), 1e-3); cosF = k;
  vec2 uv = vec2(dot(d, R), dot(d, U)) / k * 0.5 + 0.5;
  float m = (0.5 * exp2(lod) + 0.5) / atlasFace; uv = clamp(uv, m, 1.0 - m);   // не «залезать» в соседнюю грань на размытых уровнях
  float col = mod(i, 3.0), row = floor(i / 3.0);
  return vec2((col + uv.x) / 3.0, (row + uv.y) / 2.0);
}
float outPPD(){ return fieldMode < 0.5 ? res.y / degrees(2.0 * atan(tanV)) : res.x / fieldSpan.x; }
float texPPD(){ return fieldMode < 0.5 ? outPPD() : atlasFace / 90.0; }
vec3 sceneAt(vec2 a, float lod){
  if (fieldMode < 0.5) return textureLod(tReal, uvPersp(a), lod).rgb;
  float c; return textureLod(tAtlas, atlasUV(dirOf(a), lod, c), lod).rgb;
}
float distAt(vec2 a){
  if (fieldMode < 0.5) { vec2 uv = uvPersp(a); vec2 tn = (uv * 2.0 - 1.0) * vec2(tanV * aspect, tanV); return linZ(texture(tDepth, uv).r, cNear, cFar) * sqrt(1.0 + dot(tn, tn)); }
  float c; vec2 uv = atlasUV(dirOf(a), 0.0, c); return linZ(texture(tAtlasDepth, uv).r, aNear, aFar) / c;
}
vec3 blurScene(vec2 a, float rDeg){
  float rpx = rDeg * texPPD();
  if (rpx < 0.6) return sceneAt(a, 0.0);
  float lod = clamp(log2(rpx) - 0.6, 0.0, maxLod);
  vec3 acc = sceneAt(a, lod);
  for (int i = 0; i < 12; i++) acc += sceneAt(a + P[i] * rDeg, lod);
  return acc / 13.0;
}
float holoPPD(){ return 2.0 * res.y / degrees(2.0 * atan(tanV)); }
vec3 holoAt(vec2 a, float rDeg){                                       // текстура голограмм — перспектива камеры, ×2
  vec2 uv = uvPersp(a);
  float base = max(0.0, log2(holoPPD() / outPPD()) - 0.5);
  float rpx = rDeg * holoPPD();
  if (rpx < 0.6) return textureLod(tHolo, uv, base).rgb;
  float lod = max(base, clamp(log2(rpx) - 0.6, 0.0, maxLod + 1.0));
  vec3 acc = textureLod(tHolo, uv, lod).rgb;
  for (int i = 0; i < 12; i++) acc += textureLod(tHolo, uvPersp(a + P[i] * rDeg), lod).rgb;
  return acc / 13.0;
}
// поле глаза (x — к виску): эллипс по квадрантам, мягкая граница
float eyeField(vec2 e){
  vec2 q = vec2(e.x >= 0.0 ? e.x / fieldA.x : -e.x / fieldA.y, e.y >= 0.0 ? e.y / fieldA.z : -e.y / fieldA.w);
  return 1.0 - smoothstep(0.97, 1.03, length(q));
}
float sdLens(vec2 e){                                                   // линза: [−nasal, temporal] × [−down, up]
  vec2 c = vec2((lensA.y - lensA.x) * 0.5, (lensA.z - lensA.w) * 0.5);
  vec2 h = vec2((lensA.x + lensA.y) * 0.5, (lensA.z + lensA.w) * 0.5);
  return sdBox(e - c, h, 9.0);
}

// общие для обоих глаз величины (вычисляются в main)
vec2 gA; float gEcc; float gR; vec2 gSm; float gH; float gHH; float gExpo; vec3 gScat; vec3 gGhost; float gDesat; float gMeso; float gRH; float gOcc;

vec4 eyeView(float s){
  vec2 e = vec2(s * gA.x, gA.y);                                        // для этого глаза: x — к виску
  float field = eyeField(e);
  if (field <= 0.0) return vec4(0.0);
  // мир: диспаратность (вне зоны слияния — двоение), расфокусировка, острота периферии, смаз при повороте
  vec2 aS = gA + vec2(s * gH, 0.0);
  vec3 col = blurScene(aS, gR);
  if (length(gSm) > 0.15) {
    float lod = clamp(log2(max(1.0, gR * texPPD())), 0.0, maxLod);
    vec3 m = col; for (int i = 1; i <= 6; i++) m += sceneAt(aS + gSm * (float(i) / 6.0 - 0.5), lod);
    col = m / 7.0;
  }
  vec3 lin = col * gExpo + gScat;
  // сумеречный сдвиг и потеря цвета на периферии
  float L = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  lin = mix(lin, vec3(L) * vec3(0.85, 0.95, 1.15), clamp(gMeso * 0.7 + gDesat, 0.0, 1.0));
  // линза очков: свет мира через затемнение; блик от задней поверхности
  float lsd = sdLens(e);
  float inLens = glassesOn * (1.0 - smoothstep(-2.0, 2.0, lsd));
  lin *= mix(vec3(1.0), transmit * vec3(0.94, 0.98, 1.0), inLens);
  lin += gGhost * inLens;
  // окно дисплея: у каждого глаза своё изображение; виртуальный экран на distM — при фиксации вблизи двоится
  vec2 aH = gA + vec2(s * (gHH + ipdErr * 0.06), 0.0);
  vec2 ac = aH - disp.xy;
  float wsd = sdBox(ac, disp.zw, 1.2);
  float wm = dispOn * glassesOn * inLens * (1.0 - smoothstep(-0.2 - edgeSoft, 0.2 + edgeSoft, wsd));
  if (wm > 0.0) {
    float edge = smoothstep(0.55, 1.0, length(ac / disp.zw));
    vec2 ca = ac * edge * 0.012 * edgeSoft;                              // хроматизм у края окна
    vec3 h;
    h.r = holoAt(aH + ca, gRH).r; h.g = holoAt(aH, gRH).g; h.b = holoAt(aH - ca, gRH).b;
    h += holoAt(aH + vec2(0.0, -0.22), gRH + 0.08) * ghostK;                       // вторичное отражение призмы
    h += holoAt(vec2(aH.x, 2.0 * disp.y - aH.y), gRH + 0.3) * ghostK * 0.35;     // зеркальный «призрак» окна
    vec3 hb = holoAt(aH, gRH + 0.11);
    h = max(h + sharpen * (h - hb), 0.0);
    // нит дисплея — в единицах мира: свет дисплея не проходит через затемнение и складывается со светом цеха
    h *= dispNits / cdPerUnit * dispBright * (1.0 - 0.55 * edgeSoft * edge) * bootFade;
    lin += h * gExpo * wm;
  }
  vec3 c = toSRGB(aces(lin));
  c += glassesOn * dispOn * inLens * vec3(0.25, 0.85, 0.75) * (1.0 - smoothstep(0.0, 0.3, abs(wsd))) * 0.03;
  // ---- то, что у самого глаза (2–4 см) — всегда не в фокусе: рамка, модуль, дужка, нос ----
  float g = glassesOn;
  float inFrameX = 1.0 - smoothstep(frameA.y - 4.0, frameA.y + 4.0, e.x);
  float openBelow = smoothstep(-(lensA.w + frameA.x) + 4.0, -(lensA.w + frameA.x) - 4.0, e.y);
  float frame = g * inFrameX * (1.0 - smoothstep(-2.0, 2.0, -lsd)) * (1.0 - openBelow);
  float housing = g * inFrameX * smoothstep(lensA.z - 1.0, lensA.z + 6.0, e.y);
  c = mix(c, vec3(0.012, 0.013, 0.016) + vec3(0.035) * (1.0 - smoothstep(lensA.z, lensA.z + 14.0, e.y)), max(frame * 0.9, housing * 0.97));
  float temple = g * smoothstep(frameA.y - 2.0, frameA.y + 6.0, e.x) * (1.0 - smoothstep(frameA.w - 3.0, frameA.w + 4.0, abs(e.y - frameA.z)));
  c = mix(c, vec3(0.02, 0.021, 0.024), temple * 0.92);
  float xn = -e.x;                                                      // к носу
  float edgeN = 51.0 + 0.45 * min(0.0, e.y + 12.0);
  float nose = smoothstep(edgeN - 5.0, edgeN + 5.0, xn) * smoothstep(28.0, 6.0, e.y);
  c = mix(c, vec3(0.26, 0.18, 0.15) * (0.6 + 0.4 * smoothstep(-45.0, 0.0, e.y)), nose * 0.9);
  float cheek = smoothstep(-46.0, -62.0, e.y) * smoothstep(-25.0, 10.0, e.x);
  c = mix(c, vec3(0.14, 0.10, 0.09), cheek * 0.85);
  gOcc = clamp(max(max(frame * 0.9, housing), max(temple, max(nose, cheek))), 0.0, 1.0);
  return vec4(c, field);
}

void main(){
  if (dbg > 0.5) {
    gl_FragColor = vec4(toSRGB(aces(fieldMode < 0.5 ? texture(tReal, vUv).rgb : texture(tAtlas, vUv).rgb)), 1.0);
    return;
  }
  gA = angOfScreen(vUv);
  vec3 dir = dirOf(gA);
  gEcc = degrees(acos(clamp(dir.z, -1.0, 1.0)));
  // ---- общее: расстояние, расфокусировка, острота периферии (MAR растёт линейно), смаз, диспаратность ----
  float d = max(distAt(gA), 0.05);
  float dD = max(0.0, abs(1.0 / d - focusD) - 0.25);                   // глубина резкости глаза ≈ ±0,25 дптр
  float rDef = degrees(pupilMM * 1e-3 * dD);
  float rPer = 0.8 * (1.0 + gEcc / 2.5) / 60.0;                         // ≈ минимальный угол разрешения, град
  float fat = fatigueBlur * 0.08;
  gR = sqrt(rDef * rDef + rPer * rPer) + fat;
  gSm = vec2(-angVel.x, angVel.y) * degrees(0.012);                     // ≈ 12 мс «выдержки» сетчатки
  float panum = 0.12 + 0.065 * gEcc;                                    // зона слияния Panum, град
  float h = 0.5 * degrees(ipdM * (1.0 / d - vergD));
  gH = h * smoothstep(0.5 * panum, panum, abs(2.0 * h)) * diplo;
  float hh = 0.5 * degrees(ipdM * (dispDistD - vergD));
  gHH = hh * smoothstep(0.5 * panum, panum, abs(2.0 * hh)) * diplo;
  gRH = degrees(pupilMM * 1e-3 * max(0.0, abs(dispD - focusD) - 0.25)) + fat;
  // ---- адаптация: глаз видит мир через линзы (в режиме полного поля часть поля — мимо линз) ----
  float adapted = texture(tLum, vec2(0.5)).r * mix(1.0, transmit, glassesOn * lensFrac);
  gExpo = clamp(0.18 / max(adapted, 1e-4), 0.08, 12.0) * exposureBias;
  // ---- рассеяние в глазу и на линзах (ореолы ярких источников) ----
  vec3 sg = (sceneAt(gA, 4.0) * 0.5 + sceneAt(gA, 6.0) * 0.35 + sceneAt(gA, 8.0) * 0.15) * gExpo;
  float dirtM = texture(tDirt, vUv * vec2(aspect, 1.0) * 0.7).r * dirt * glassesOn;
  float scatter = 0.035 + max(age - 30.0, 0.0) * 0.0025 + dirtM * 0.35;
  gScat = max(sg - 0.9, 0.0) * scatter * 3.0;
  gGhost = max(sceneAt(-gA * 0.9 + vec2(0.0, 2.0 * disp.y), 5.0) * gExpo - 1.5, 0.0) * 0.012;
  gMeso = 1.0 - smoothstep(0.003, 0.05, adapted);
  gDesat = smoothstep(25.0, 90.0, gEcc) * 0.6;
  // ---- два глаза: в зоне перекрытия — смесь (ведущий глаз весомее), по краям — монокулярные серпы ----
  // подавление: размытое близкое препятствие у одного глаза (рамка, нос) проигрывает чёткой сцене другого —
  // переносица и нос видны лишь «призраком»
  gOcc = 0.0; vec4 cl = eyeOn.x > 0.0 ? eyeView(-1.0) : vec4(0.0); float ol = gOcc;
  gOcc = 0.0; vec4 cr = eyeOn.y > 0.0 ? eyeView(1.0) : vec4(0.0); float orr = gOcc;
  float wl = cl.a * eyeOn.x * (1.0 - domR) * (1.0 - 0.8 * ol), wr = cr.a * eyeOn.y * domR * (1.0 - 0.8 * orr);
  vec3 c = (cl.rgb * wl + cr.rgb * wr) / max(wl + wr, 1e-4);
  float vis = max(cl.a * eyeOn.x, cr.a * eyeOn.y);
  c *= vis;
  // падение освещённости сетчатки на дальней периферии (наклонный зрачок)
  c *= 1.0 - 0.35 * smoothstep(50.0, 100.0, gEcc);
  if (fieldMode < 0.5) { vec2 qv = vUv - 0.5; qv.x *= aspect; c *= 1.0 - 0.35 * smoothstep(0.75, 1.2, length(qv * vec2(0.82, 1.28))); }
  c = mix(c, vec3(1.0), flash * 0.5 * vis);
  // веки при моргании
  float lt = mix(64.0, -3.0, blink), lb = mix(-75.0, -3.0, blink);
  float lid = max(smoothstep(lt - 6.0, lt + 1.0, gA.y), smoothstep(lb + 6.0, lb - 1.0, gA.y)) * step(0.001, blink);
  c = mix(c, vec3(0.03, 0.012, 0.01), lid * vis);
  // ---- схема зон поля зрения ----
  if (overlay > 0.5) {
    float px = 1.0 / outPPD();
    float ring = 0.0;
    for (int k = 0; k < 6; k++) { float R = k == 0 ? 1.0 : k == 1 ? 2.5 : k == 2 ? 5.0 : k == 3 ? 15.0 : k == 4 ? 30.0 : 60.0; ring = max(ring, 1.0 - smoothstep(0.6 * px, 1.6 * px, abs(gEcc - R))); }
    c = mix(c, gEcc < 2.5 ? vec3(1.0, 0.85, 0.2) : vec3(0.45, 0.95, 1.0), ring * 0.8);
    c = mix(c, vec3(1.0, 0.9, 0.3), (1.0 - smoothstep(0.0, 1.0, gEcc)) * 0.25);                 // фовеа (≈ 2°)
    float fl = eyeField(vec2(-gA.x, gA.y)), fr = eyeField(vec2(gA.x, gA.y));
    c = mix(c, vec3(1.0, 0.45, 0.35), fr * (1.0 - fl) * 0.18);                                 // видит только правый глаз
    c = mix(c, vec3(0.35, 0.55, 1.0), fl * (1.0 - fr) * 0.18);                                 // только левый
    float edgeB = (1.0 - smoothstep(0.0, 0.12, abs(fl - 0.5))) + (1.0 - smoothstep(0.0, 0.12, abs(fr - 0.5)));
    c = mix(c, vec3(0.4, 1.0, 0.55), clamp(edgeB, 0.0, 1.0) * 0.8);
    if (glassesOn > 0.5) for (int k = 0; k < 2; k++) { float sx = k == 0 ? -1.0 : 1.0; float l = abs(sdLens(vec2(sx * gA.x, gA.y))); c = mix(c, vec3(1.0), (1.0 - smoothstep(0.6 * px, 1.6 * px, l)) * 0.55); }
  }
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
      uniforms: { tReal: { value: null }, tPrev: { value: null }, dt: { value: 0 }, lod: { value: 6 }, first: { value: 1 }, uvScale: { value: new THREE.Vector2(1, 1) } } });
    this.finalMat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: FINAL_FS, depthTest: false, depthWrite: false,
      uniforms: Object.fromEntries(Object.entries({
        tReal: null, tDepth: null, tHolo: null, tLum: null, tDirt: dirtTexture(), res: new THREE.Vector2(1, 1), tanV: 1, aspect: 1, cNear: 0.05, cFar: 80,
        time: 0, focusD: 0.5, pupilMM: 4, dispD: 0.25, glassesOn: 0, dispOn: 0, transmit: 0.9, dispBright: 1, blink: 0, flash: 0,
        angVel: new THREE.Vector2(), fatigueBlur: 0, age: 30, dirt: 0.1, ipdErr: 0, disp: new THREE.Vector4(0, -2, 22, 12), maxLod: 7,
        exposureBias: 1, bootFade: 1, dbg: 0, dispNits: DISPLAY.nits, sharpen: 0.45, cdPerUnit: CD_PER_UNIT, ghostK: 0.05, edgeSoft: 0.45,
        tAtlas: null, tAtlasDepth: null, fieldMode: 0, fieldSpan: new THREE.Vector2(220, 140), atlasFace: 512, aNear: 0.03, aFar: 80,
        vergD: 0.5, ipdM: IPD_MM / 1000, domR: 0.55, eyeOn: new THREE.Vector2(1, 1), diplo: 1, overlay: 0,
        lensA: new THREE.Vector4(48, 58, 20, 55), frameA: new THREE.Vector4(12, 64, -6, 10), fieldA: new THREE.Vector4(FIELD.temporal, FIELD.nasal, FIELD.up, FIELD.down),
        lensFrac: 1, dispDistD: 1 / DISPLAY.distM,
      }).map(([k, v]) => [k, { value: v }])) });
    this.u = this.finalMat.uniforms;
    this.u.disp.value.set(DISPLAY.centerDeg[0], DISPLAY.centerDeg[1], this.win.h / 2, this.win.v / 2);
    this.history = [];                 // поза камеры для задержки голограмм
    this.occluder = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.occlusion = false;
    this.latencyMs = DISPLAY.latencyMs;
    this.fieldMode = false;
    this.atlas = null;
    this.faceCam = new THREE.PerspectiveCamera(90, 1, camera.near, camera.far);
    // поворот каждой грани относительно головы (лицевая сторона камеры three — −Z)
    this.faceQ = CUBE_FACES.map(({ F, U }) => {
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(F[0], F[1], -F[2]), new THREE.Vector3(U[0], U[1], -U[2]));
      return new THREE.Quaternion().setFromRotationMatrix(m);
    });
  }

  /** Режим «полное поле ≈ 200°» (развёртка куба, равнопромежуточная проекция) или «центр 72°» (перспектива). */
  setFieldMode(on) {
    this.fieldMode = !!on;
    this.u.fieldMode.value = on ? 1 : 0;
    this.u.lensFrac.value = on ? 0.75 : 1;
    this.lumMat.uniforms.uvScale.value.set(on ? 1 / 3 : 1, on ? 1 / 2 : 1);
    if (on) this.ensureAtlas();
  }

  ensureAtlas() {
    const H = this.size?.H || 900;
    // пикселей на грань 90°: как у экрана в равнопромежуточной проекции (с запасом 15 %)
    const face = Math.min(1280, Math.max(320, Math.round(((H / this.u.fieldSpan.value.y) * 90 * 1.15) / 16) * 16));
    if (this.atlas && this.atlasFace === face) return;
    this.atlas?.dispose();
    this.atlas = new THREE.WebGLRenderTarget(face * 3, face * 2, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.atlas.depthTexture = new THREE.DepthTexture(face * 3, face * 2);
    this.atlas.depthTexture.type = THREE.UnsignedIntType;
    this.atlasFace = face;
    this.u.atlasFace.value = face;
  }

  /** Отрисовать мир в 5 граней куба вокруг головы (вперёд, вправо, влево, вверх, вниз). */
  renderAtlas() {
    const { renderer, scene, camera, atlas } = this;
    const fc = this.faceCam, F = this.atlasFace;
    fc.near = camera.near; fc.far = camera.far; fc.updateProjectionMatrix();
    fc.position.copy(camera.position);
    fc.layers.set(LAYER_REAL); fc.layers.enable(LAYER_LABEL);
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.setRenderTarget(atlas);
    atlas.scissorTest = true;
    this.faceQ.forEach((q, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      atlas.viewport.set(col * F, row * F, F, F); atlas.scissor.set(col * F, row * F, F, F);
      fc.quaternion.copy(camera.quaternion).multiply(q);
      fc.updateMatrixWorld();
      renderer.setRenderTarget(atlas);
      if (i === 1) renderer.shadowMap.autoUpdate = false;            // тени считаем один раз за кадр
      renderer.render(scene, fc);
    });
    renderer.shadowMap.autoUpdate = shadowAuto;
    atlas.scissorTest = false;
    atlas.viewport.set(0, 0, F * 3, F * 2); atlas.scissor.set(0, 0, F * 3, F * 2);
    this.u.aNear.value = fc.near; this.u.aFar.value = fc.far;
  }

  /**
   * Курсор экрана (NDC) → NDC перспективной камеры (для выбора окон и деталей). В режиме полного поля экран —
   * равнопромежуточная проекция; возвращает null, если направление вне перспективы камеры.
   */
  screenToCamNdc(ndc) {
    if (!this.fieldMode) return ndc;
    const span = this.u.fieldSpan.value;
    const tx = ndc.x * 0.5 * span.x, ty = ndc.y * 0.5 * span.y, r = Math.hypot(tx, ty);
    if (r < 1e-6) return new THREE.Vector2(0, 0);
    const k = Math.PI / 180, sr = Math.sin(r * k) / r;
    const v = new THREE.Vector3(tx * sr, ty * sr, -Math.cos(r * k));     // СК камеры three: вперёд — −Z
    if (v.z >= -0.05) return null;
    v.applyMatrix4(this.camera.projectionMatrix);
    return new THREE.Vector2(v.x, v.y);
  }

  /** Профиль очков: окно дисплея, яркость, оптика (блики, мягкость края), корпус, задержка. */
  setDevice(d) {
    this.device = d;
    this.win = displayWindow(d.fovDiag, d.aspect);
    this.u.disp.value.set(0, d.centerDeg, this.win.h / 2, this.win.v / 2);
    Object.assign(this, { latencyMs: d.latencyMs });
    this.u.dispNits.value = d.nits;
    this.u.ghostK.value = d.ghost;
    this.u.edgeSoft.value = d.edgeSoft;
    // апертура очков для глаза — по размерам рамки этой модели (binocular.eyeAperture)
    const ap = eyeAperture(DESIGN[d.id], d, this.ipdMM || IPD_MM);
    this.aperture = ap;
    this.u.lensA.value.set(ap.nasal, ap.temporal, ap.up, ap.down);
    this.u.frameA.value.set(ap.rim, ap.frameT, ap.templeY, ap.templeH);
    this.u.dispDistD.value = 1 / d.distM;
    // одинаковые 1920 пикс на более широкое поле — мельче детали: меньше подъём резкости
    this.u.sharpen.value = 0.45 * Math.min(1.2, (d.res[0] / this.win.h) / 42);
  }

  setSize(w, h, pr) {
    const W = Math.floor(w * pr), H = Math.floor(h * pr);
    this.size = { W, H };
    // полное поле: по вертикали ±70°, по горизонтали — сколько поместится (не меньше 220°)
    const dpp = Math.max(220 / W, 140 / H);
    this.u.fieldSpan.value.set(W * dpp, H * dpp);
    if (this.fieldMode) this.ensureAtlas();
    this.rtReal.setSize(W, H);
    this.rtHolo.setSize(Math.min(4096, W * 2), Math.min(4096, H * 2));      // голограммы — с суперсэмплингом ×2: чётче текст окон
    this.u.res.value.set(W, H);
    this.u.aspect.value = w / h;
    this.maxLodReal = Math.floor(Math.log2(Math.max(W, H))) - 1;
    this.u.maxLod.value = this.maxLodReal;
    this.lodReal = Math.max(0, Math.floor(Math.log2(Math.max(W, H))) - 4);
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
    // 1) реальность: перспектива (центр 72°) или развёртка куба вокруг головы (полное поле)
    if (this.fieldMode) this.renderAtlas();
    else {
      camera.layers.set(LAYER_REAL); camera.layers.enable(LAYER_LABEL);
      renderer.setRenderTarget(this.rtReal);
      renderer.render(scene, camera);
    }
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
    this.lumMat.uniforms.tReal.value = this.fieldMode ? this.atlas.texture : this.rtReal.texture;
    this.lumMat.uniforms.lod.value = this.fieldMode ? Math.max(0, Math.floor(Math.log2(this.atlasFace * 3)) - 4) : this.lodReal;
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
    if (this.fieldMode) { u.tAtlas.value = this.atlas.texture; u.tAtlasDepth.value = this.atlas.depthTexture; }
    u.maxLod.value = this.fieldMode ? Math.floor(Math.log2(this.atlasFace * 3)) - 1 : this.maxLodReal;
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

  /** Средняя адаптированная яркость поля зрения, кд/м² (по калибровке CD_PER_UNIT). */
  readLum() {
    const buf = new Float32Array(4);
    try { this.renderer.readRenderTargetPixels(this.lum[this.lumIdx], 0, 0, 1, 1, buf); } catch { return 150; }
    return buf[0] * CD_PER_UNIT;
  }
}
