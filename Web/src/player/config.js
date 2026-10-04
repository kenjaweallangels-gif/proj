// Все числа игрока и спутников — здесь (аналог DataAsset: DA_NoiseTuning, DA_HydrationTuning и т. д.).
// Источник значений: docs/design/mechanics.md, docs/06_demo_contract.md §2.6.
export const CFG = {
  radius: 0.35,
  stepUp: 0.5,     // максимальный уступ, на который можно шагнуть (м)
  height: 1.76,
  eye: 1.62,
  speed: { walk: 3.0, run: 6.0, sandWalk: 1.8, sandWalkBase: 2.45, sandEnvFloor: 0.5 }, // sandWalkBase × огибающая ритма (ср. ≈0.7) ≈ 1.8 м/с
  accelLambda: 7, decelLambda: 9, turnLambda: 10, groundLambda: 18,
  // Физика: фиксированный шаг + интерполяция отрисовки. Прыжок/падение: свободное движение, урона нет.
  phys: { step: 1 / 60, maxSteps: 8 },
  jump: { speed: 5.6, gravity: 19, maxFall: 45, coyote: 0.12, buffer: 0.12, airLambda: 1.6, snapDown: 0.42, stepRate: 2.6 },
  slope: { probe: 0.6, slowDeg: 25, slowFactor: 0.7, slideDeg: 42, slideMax: 5, slideLambda: 3 },
  // Шаги: таблица [скорость м/с, интервал с] — ходьба 0.5 с, бег 0.32 с (таймер-фоллбек из mechanics §1.5).
  step: { table: [[0.4, 0.9], [2, 0.7], [3, 0.5], [6, 0.32]], jitter: 0.07, firstDelay: 0.2, minSpeed: 0.4, idleReset: 1.2 },
  noise: {
    walk: 0.35, run: 0.8, sandWalk: 0.12, rhythmPenalty: 0.6,
    surface: { sand: 1.0, packed: 1.4, rock: 0.0 },
    decay: 0.15, rockDecay: 1.0, window: 6, goodCV: 0.35,
    stutterCooldown: 0.35, stutterLow: [0.4, 0.65], stutterHigh: [1.45, 1.8], stutterAnim: 0.7,
    companionScale: 0.3, land: 0.55,
  },
  hydration: {
    start: 0.85, min: 0.15, sunDrain: 0.06, runMul: 2.0, maskFactor: 0.35,
    shadeRecover: 0.02, interiorRecover: 0.05, shadeInterval: 0.25, shadeThreshold: 0.5,
    lowThreshold: 0.25, lowSprintFactor: 0.88, heatTau: 4,
  },
  thumper: { charges: 2, interval: 1.6, duration: 30, loudness: 1.0, ahead: 1.8, pickRadius: 1.8, shakeRange: 30, shake: 0.25 },
  // Камера от первого лица (третьего лица больше нет). headRadius — сфера головы для столкновений (больше угла near-плоскости ≈0.19 м при FOV до 72°).
  camera: {
    fov: 62, fovRun: 7, fpPitchLimit: 1.45, headRadius: 0.25,
    groundClearance: 0.3, followLambdaY: 14, armOutLambda: 8, // armOutLambda — скорость возврата головы после упора в стену/потолок
    dipK: 150, dipC: 15, resyncSec: 1.3,
    turnLambda: 30, turnRoll: 0.004,                           // инерция поворота (1/с) и крен от скорости поворота
    bobAmp: 0.026, bobSway: 0.011, bobRoll: 0.006, bobPitch: 0.004, // покачивание от шагов (м/рад), настройка «Покачивание головы»
    sandSurge: 0.07, sandLurch: 0.02,                          // песок: подача вперёд/наклон вслед за огибающей рваного шага
    shakePos: 0.08, shakeRot: 0.025, shakeRoll: 0.03, shakeDecay: 2.0, rumbleScale: 0.4,
  },
  interact: { radius: 2.2, viewCos: 0.3 },
  companions: {
    spacing: 3.5, minSep: 1.1, snapDist: 25, maxSpeed: 7.5, idleDelay: 0.6, trailStep: 0.45, trailKeep: 40,
    // Строй (вид от первого лица): позади-сбоку, не в кадре; в узких местах (тропа, расщелина, проход) — гуськом по следу
    openBack: 2.4, openBackStep: 1.0, openSide: 1.35,      // м: позади игрока / шаг на каждого следующего / вбок
    fileSpacing: 2.2,                                       // м между идущими гуськом
    narrowProbe: 1.5, narrowEvery: 0.2, narrowLambda: 3,    // проверка ширины вбок (м), период (с), плавность перехода строй↔гуськом
    restMin: 1.5, restMax: 4.2,                             // м: естественная дистанция, когда игрок стоит
    frontCone: 0.62, frontRange: 5, frontPush: 1.6,         // cos угла «в кадре», дальность (м), боковой толчок м/с
    accelLambda: 5.5, catchSpeed: 1.6, runBoost: 0.9,       // догоняют бегом: множитель к скорости игрока; запас скорости м/с
    warpDist: 14, warpMinHidden: 5, warpCosHidden: 0.15,    // телепорт только вне кадра: дальше (м), не ближе (м), cos угла «за спиной/боком»
    ghostRange: 1.25,                                       // м: в узком месте спутник на пути игрока становится «призраком» (проходит насквозь)
    idleLook: [3.5, 8], idleDrink: [16, 34], drinkDur: 4.5, chatDur: [6, 10], lookDur: [2.5, 5],
  },
};

/** Интервал между шагами (с) при скорости v: кусочно-линейная интерполяция по таблице. */
export function stepInterval(v) {
  const t = CFG.step.table;
  if (v <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (v <= t[i][0]) { const k = (v - t[i - 1][0]) / (t[i][0] - t[i - 1][0]); return t[i - 1][1] + (t[i][1] - t[i - 1][1]) * k; }
  }
  return t[t.length - 1][1];
}
