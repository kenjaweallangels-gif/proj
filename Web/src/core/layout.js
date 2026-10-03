// Раскладка браузерной версии (метры). Оси three.js: X — восток, Z — юг, Y — вверх.
// Пропорции взяты из Tools/unreal_python/level_layout.py с масштабом путей ~0.45
// (UE: 1.87 км маршрута → здесь ~0.8 км). Вертикали (скала 290 м, червь 360 м) — без масштаба.

export const WORLD_SIZE = 3000;          // сторона карты высот, м (центр — CORE_CENTER)
export const CORE_CENTER = [330, 160];
export const WIND_YAW_DEG = 60;          // направление ветра (по ветру), от +X к +Z
export const WIND_DIR = [Math.cos(WIND_YAW_DEG * Math.PI / 180), Math.sin(WIND_YAW_DEG * Math.PI / 180)];

// Старт A1: гребень ~35 м, взгляд на скалу.
export const START = { x: 0, z: 0, yaw: Math.atan2(270, 680) };
export const A1_RIDGE = [[-70, -28], [110, 44]];

// Скала «Коготь Шайтана»: дуга вдоль Z, вогнутостью к игроку (на запад).
export const ROCK = {
  center: [700, 270],
  halfLen: 230,          // ~460 м вдоль Z (t=-1 — север, «коготь»)
  heightClaw: 290,       // остриё когтя
  heightSaddle: 200,
  heightFist: 250,
};
/** Осевая линия скалы: t ∈ [-1, 1] → [x, z]. */
export function clawCenter(t) {
  const [cx, cz] = ROCK.center;
  return [cx + 60 * (t * t) - 20 * Math.max(0, -t - 0.7) * 3, cz + t * ROCK.halfLen];
}
/** Полуширина основания (м): 14 м у когтя → 90 м у южного «кулака». */
export function clawHalfWidth(t) {
  const u = (t + 1) / 2;
  return 14 + 76 * Math.pow(u, 0.8);
}
export function clawHeight(t) {
  if (t < -0.75) return ROCK.heightSaddle + (ROCK.heightClaw - ROCK.heightSaddle) * ((-t - 0.75) / 0.25);
  if (t > 0.6) return ROCK.heightSaddle + (ROCK.heightFist - ROCK.heightSaddle) * ((t - 0.6) / 0.4);
  return ROCK.heightSaddle;
}

// Золотой путь (A1 → A2 → A3 → A4).
export const GOLDEN_PATH = [
  { id: 'P1', x: 0, z: 0 },
  { id: 'P2', x: 108, z: 43 },
  { id: 'P3', x: 190, z: 66 },
  { id: 'P4', x: 279, z: 95 },        // точка остановки при черве
  { id: 'P5', x: 360, z: 140 },
  { id: 'P6', x: 450, z: 189 },
  { id: 'P7', x: 531, z: 252 },
  { id: 'P7b', x: 603, z: 344 },
  { id: 'MOUTH', x: 632, z: 326 },    // устье расщелины
  { id: 'FALSE_ROCK', x: 652, z: 326 },
];

// Червь: точка покоя и точка выхода (80 м от P4, против солнца).
export const SUN_AZIMUTH_DEG = 20;     // направление НА солнце в Morning_Erg
export const WORM_REVEAL = { x: 279 + 80 * Math.cos(20 * Math.PI / 180), z: 95 + 80 * Math.sin(20 * Math.PI / 180) };
export const WORM_SPAWN = { x: 500, z: -140, depth: 60 };

// Безопасные каменные «острова» в эрге (центр, радиус).
export const SAFE_ISLANDS = [
  { x: 153, z: 40, r: 9 }, { x: 222, z: 88, r: 7 }, { x: 300, z: 70, r: 11 },
  { x: 342, z: 128, r: 8 }, { x: 395, z: 150, r: 10 }, { x: 437, z: 162, r: 9 },
];
// Каменистый подход A3 — плиты (центр, полуразмеры, поворот).
export const A3_PLATES = [
  { x: 470, z: 205, w: 22, d: 14, rot: 0.4 }, { x: 505, z: 230, w: 18, d: 12, rot: -0.2 },
  { x: 540, z: 262, w: 26, d: 16, rot: 0.9 }, { x: 572, z: 300, w: 20, d: 14, rot: 0.1 },
  { x: 600, z: 330, w: 24, d: 18, rot: 0.6 },
];

// Склейки золотого пути (Ellipsis): куда переносится группа.
/** УСТАРЕЛО: склейки времени убраны (всё в реальном времени). Оставлено для совместимости импорта. */
export const ELLIPSIS = {
  A2: { x: 240, z: 83, yaw: Math.atan2(12, 39) },
  A3: { x: 624, z: 331, yaw: 0 },
};

// Сиетч — ВНУТРИ скалы «Коготь» (бесшовно, без телепорта). Пол основных залов ≈ 30 м над пустыней.
// Вход: тропа по уступам и валунам западной грани → скрытая расщелина ENTRY.cleft → шлюз B1.
// Выход: туннель к восточной грани → защищённая котловина GARDEN (растения и животные).
// SIETCH_ORIGIN — локальное начало сиетча (вход шлюза B1); локальная +X = yaw (по умолчанию на восток, вглубь скалы).
// Внутренние помещения могут изгибаться, но обязаны лежать внутри скалы: clawInside(x, z, margin) > 0.
export const SIETCH_ORIGIN = { x: 656, y: 30, z: 250, yaw: 0 };
export const SIETCH = {
  B1: { x0: 0, x1: 40, w: 4, h: 5 },                    // шлюз-коридор (локально)
  B2: { x0: 40, x1: 100, w: 15, h: 12, balcony: 6 },     // рынок/мастерские, 2 уровня
  B3: { x0: 100, x1: 150, w: 3, h: 3.8 },               // проходы с нишами-комнатами за тканью
  B4: { cx: 125, cz: 18, w: 30, d: 20, h: 8 },          // цистерна за печатью
  B5: { x0: 150, x1: 200, w: 35, h: 25, bowlR: 6 },      // зал собраний (уступ говорящего, чаша, луч)
};
export const ENTRY = {
  trailStart: { x: 606, z: 300 },               // от A3/A4 у подножия
  cleft: { x: 652, y: 30, z: 251 },              // скрытая щель между скал (вход), лицом на запад
};
export const GARDEN = {
  center: { x: 840, z: 395 }, radius: 58, floorY: 4,   // котловина за скалой, закрытая от песка гребнями
  portal: { x: 801.2, y: 5, z: 395 },                  // устье: выход из туннеля сиетча на восточной грани (= garden/layout.js MOUTH; туннель идёт на восток 14 м)
};
/** >0 внутри основания скалы на глубину больше margin (м). Приближение по осевой линии. */
export function clawInside(x, z, margin = 0) {
  const t = Math.max(-1, Math.min(1, (z - ROCK.center[1]) / ROCK.halfLen));
  const [cx] = clawCenter(t);
  const hw = clawHalfWidth(t);
  const endFade = Math.min(1, (1 - Math.abs(t)) * 6);
  return Math.min(hw * endFade - Math.abs(x - cx), (ROCK.halfLen - Math.abs(z - ROCK.center[1]))) - margin;
}

// Зоны (как ERakisZone в C++).
export const ZONES = {
  A1_Ridge: 'A1_Ridge', A2_Erg: 'A2_Erg', A3_Approach: 'A3_Approach', A4_Crevice: 'A4_Crevice',
  B1_Airlock: 'B1_Airlock', B2_Gallery: 'B2_Gallery', B3_Passages: 'B3_Passages',
  B4_Cistern: 'B4_Cistern', B5_Hall: 'B5_Hall',
};

/** Пустынная зона по позиции (сиетч определяет свои зоны сам: game.sietch.zoneAt). */
export function desertZoneAt(x, z) {
  const dm = Math.hypot(x - 632, z - 326);
  if (dm < 45) return ZONES.A4_Crevice;
  if (x < 140 && Math.hypot(x, z) < 150) return ZONES.A1_Ridge;
  if (x > 455) return ZONES.A3_Approach;
  return ZONES.A2_Erg;
}
