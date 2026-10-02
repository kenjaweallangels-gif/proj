// Все числа игрока и спутников — здесь (аналог DataAsset: DA_NoiseTuning, DA_HydrationTuning и т. д.).
// Источник значений: docs/design/mechanics.md, docs/06_demo_contract.md §2.6.
export const CFG = {
  radius: 0.35,
  height: 1.76,
  eye: 1.62,
  speed: { walk: 3.0, run: 6.0, sandWalk: 2.0 },
  accelLambda: 7, decelLambda: 9, turnLambda: 10, groundLambda: 18,
  slope: { probe: 0.6, slowDeg: 25, slowFactor: 0.7, slideDeg: 38, slideMax: 5, slideLambda: 3 },
  // Шаги: таблица [скорость м/с, интервал с] — ходьба 0.5 с, бег 0.32 с (таймер-фоллбек из mechanics §1.5).
  step: { table: [[0.4, 0.9], [2, 0.7], [3, 0.5], [6, 0.32]], jitter: 0.07, firstDelay: 0.2, minSpeed: 0.4, idleReset: 1.2 },
  noise: {
    walk: 0.35, run: 0.8, sandWalk: 0.12, rhythmPenalty: 0.6,
    surface: { sand: 1.0, packed: 1.4, rock: 0.0 },
    decay: 0.15, rockDecay: 1.0, window: 6, goodCV: 0.35,
    stutterCooldown: 0.35, stutterLow: [0.4, 0.65], stutterHigh: [1.45, 1.8], stutterAnim: 0.7,
    companionScale: 0.3,
  },
  hydration: {
    start: 0.85, min: 0.15, sunDrain: 0.06, runMul: 2.0, maskFactor: 0.35,
    shadeRecover: 0.02, interiorRecover: 0.05, shadeInterval: 0.25, shadeThreshold: 0.5,
    lowThreshold: 0.25, lowSprintFactor: 0.88, heatTau: 4,
  },
  thumper: { charges: 2, interval: 1.6, duration: 30, loudness: 1.0, ahead: 1.8, pickRadius: 1.8, shakeRange: 30, shake: 0.25 },
  camera: {
    fov: 62, fovRun: 10, fovFP: 4,
    tpDist: 3.2, tpDistRun: 3.7, shoulder: 0.45, tpHeight: 1.55, tpPitch0: 0.12,
    tpPitchMin: -1.1, tpPitchMax: 0.9, fpPitchLimit: 1.45,
    groundClearance: 0.5, followLambda: 16, armOutLambda: 3, blendLambda: 6,
    bobAmp: 0.05, bobSway: 0.025, resyncSec: 1.3,
    shakePos: 0.08, shakeRot: 0.025, shakeRoll: 0.03, shakeDecay: 2.0, rumbleScale: 0.4,
  },
  interact: { radius: 2.2, viewCos: 0.3 },
  companions: { spacing: 3.5, minSep: 1.1, snapDist: 25, maxSpeed: 7.5, idleDelay: 0.6, trailStep: 0.45, trailKeep: 40 },
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
