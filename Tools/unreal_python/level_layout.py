"""
level_layout.py — единый источник координат уровня «Rakis: Heretics» (T-003/T-004).

ЧИСТЫЙ Python, без `import unreal` и без `bpy`: модуль импортируют и редакторные скрипты
Unreal (level_*.py, env_*.py), и Blender-генераторы (Tools/blender/env_*.py добавляют
Tools/unreal_python в sys.path). Запуск как скрипта ничего не меняет — только печатает сводку.

Система координат — оси UE: X вперёд/восток, Y вправо/юг, Z вверх. Единицы — сантиметры.
Документация и таблицы — docs/level/layout.md (числа там обязаны совпадать с этим файлом).
"""
from __future__ import annotations

import math

# ---------------------------------------------------------------- общие параметры
WALK_SPEED_CMS = 220.0          # прогулочный темп «золотого пути»
WIND_YAW_DEG = 60.0             # куда дует преобладающий ветер (вектор по ветру), yaw UE
WIND_DIR = (math.cos(math.radians(WIND_YAW_DEG)), math.sin(math.radians(WIND_YAW_DEG)))

# Играбельное ядро 2×2 км и ландшафт 4×4 км (heightmap 4033², 100 см/пиксель)
CORE_MIN = (-30000.0, -50000.0)
CORE_MAX = (170000.0, 150000.0)
CORE_CENTER = ((CORE_MIN[0] + CORE_MAX[0]) * 0.5, (CORE_MIN[1] + CORE_MAX[1]) * 0.5)  # (70000, 50000)
HEIGHTMAP_RES = 4033
HEIGHTMAP_CM_PER_PX = 100.0
LANDSCAPE_SIZE_CM = (HEIGHTMAP_RES - 1) * HEIGHTMAP_CM_PER_PX  # 403200
LANDSCAPE_ORIGIN = (CORE_CENTER[0] - LANDSCAPE_SIZE_CM * 0.5,
                    CORE_CENTER[1] - LANDSCAPE_SIZE_CM * 0.5, 0.0)  # угол (вершина 0,0) = (-131600, -151600, 0)
LANDSCAPE_Z_SCALE = 100.0       # ±256 м, шаг 0.78 см; Z_мир = (v-32768)/128 * ZScale
UNDER_ROCK_Z = -8000.0          # высота ландшафта глубоко под скалой (чтобы не пересекать сиетч)

# ---------------------------------------------------------------- «Коготь Шайтана»
ROCK_PIVOT = (150000.0, 60000.0, 0.0)  # pivot меша SM_Rock_ShaitanClaw (центр основания)
ROCK_HALF_LEN = 50000.0                # 1 км вдоль Y (параметр t ∈ [-1, 1], t=-1 — север, «коготь»)


def claw_center(t: float) -> tuple[float, float]:
    """Осевая линия скалы (мир, см). Дуга вогнутостью на запад (к игроку); северный кончик загнут."""
    x = 144000.0 + 12000.0 * (1.0 - t * t)
    hook = max(0.0, (-t - 0.6) / 0.4)          # 0..1 на северном кончике
    x -= 9000.0 * hook * hook                  # «коготь» загибается к западу
    y = ROCK_PIVOT[1] + ROCK_HALF_LEN * t
    return x, y


def claw_half_width(t: float) -> float:
    """Полуширина основания (см): 30 м у кончика-когтя → 200 м у южного «кулака»."""
    u = max(0.0, min(1.0, (t + 1.0) * 0.5))
    return (3000.0 + 17000.0 * (u ** 0.8)) * claw_end_round(t)


def claw_end_round(t: float) -> float:
    """Скругление торцов: юг (t>0.8) — эллиптический «кулак», север (t<-0.9) — остриё когтя."""
    t0 = 0.8 if t > 0.0 else 0.9
    a = abs(t)
    if a <= t0:
        return 1.0
    k = (a - t0) / (1.0 - t0)
    return math.sqrt(max(0.0, 1.0 - k * k))


def claw_height(t: float) -> float:
    """Высота плато (см): седло 200 м, коготь до 290 м, кулак ~250 м."""
    h = 20000.0
    h += 9000.0 * math.exp(-((t + 0.65) / 0.25) ** 2)
    h += 5000.0 * math.exp(-((t - 0.6) / 0.35) ** 2)
    # к самому кончику когтя высота падает (остриё)
    if t < -0.85:
        h *= max(0.35, 1.0 - (-0.85 - t) / 0.15 * 0.65)
    return h


def claw_lean(t: float) -> float:
    """Наклон к западу на вершине (см) — нависающий коготь."""
    hook = max(0.0, (-t - 0.5) / 0.5)
    return 6000.0 * hook


def claw_t_for_y(y: float) -> float:
    return max(-1.0, min(1.0, (y - ROCK_PIVOT[1]) / ROCK_HALF_LEN))


def claw_faces_at_y(y: float) -> tuple[float, float]:
    """X западной и восточной граней основания на широте y (приближение — ось почти вдоль Y)."""
    t = claw_t_for_y(y)
    cx, _ = claw_center(t)
    hw = claw_half_width(t)
    return cx - hw, cx + hw


def claw_polyline(n: int = 96) -> list[tuple[float, float, float, float]]:
    """[(x, y, half_width, height)] вдоль оси, t от -1 до 1."""
    out = []
    for i in range(n + 1):
        t = -1.0 + 2.0 * i / n
        x, y = claw_center(t)
        out.append((x, y, claw_half_width(t), claw_height(t)))
    return out


def rock_signed_distance(x: float, y: float) -> float:
    """Приближённая знаковая дистанция до контура основания (см): <0 — внутри скалы."""
    if y < ROCK_PIVOT[1] - ROCK_HALF_LEN - 30000 or y > ROCK_PIVOT[1] + ROCK_HALF_LEN + 30000:
        return 1e9
    t = claw_t_for_y(y)
    cx, cy = claw_center(t)
    hw = claw_half_width(t)
    dx = abs(x - cx) - hw
    dy = max(0.0, abs(y - ROCK_PIVOT[1]) - ROCK_HALF_LEN)
    if dy > 0.0:
        return math.hypot(max(dx, 0.0), dy)
    return dx


# ---------------------------------------------------------------- золотой путь (мир, см; Z — высота земли)
START = (0.0, 0.0, 3500.0)                 # A1, гребень 35 м
A1_RIDGE_A = (-15000.0, -6000.0)           # линия гребня A1 (направлена на скалу, yaw ≈ 21.8°)
A1_RIDGE_B = (24000.0, 9600.0)
A1_RIDGE_CREST_CM = 3500.0

GOLDEN_PATH = [
    # (имя, x, y, z_земли, зона)
    ("P0_Start", 0.0, 0.0, 3500.0, "A1"),
    ("P1_RidgeMid", 12000.0, 4800.0, 2400.0, "A1"),
    ("P2_RidgeFoot", 24000.0, 9600.0, 500.0, "A1"),
    ("P3_ErgWest", 45000.0, 16000.0, 300.0, "A2"),
    ("P4_WormStop", 62000.0, 21000.0, 200.0, "A2"),
    ("P5_ErgEast", 85000.0, 32000.0, 300.0, "A2"),
    ("P6_ErgEdge", 100000.0, 42000.0, 400.0, "A2"),
    ("P7_Plates", 118000.0, 56000.0, 600.0, "A3"),
    ("P7b_FinBypass", 134000.0, 76500.0, 300.0, "A3"),
    ("P8_CreviceMouth", 140500.0, 72500.0, 0.0, "A4"),
    ("P9_FalseRock", 144300.0, 72500.0, 0.0, "A4"),
    ("P10_LockChamber", 145000.0, 72500.0, 0.0, "B1"),
    ("P11_GalleryBalcony", 148800.0, 72500.0, -1400.0, "B1"),
    ("P12_GalleryFloor", 151000.0, 72500.0, -2000.0, "B2"),
    ("P13_GalleryEast", 154500.0, 72500.0, -2000.0, "B2"),
    ("P14_GrateLanding", 157250.0, 72500.0, -2850.0, "B3"),
    ("P15_HallBalcony", 159700.0, 72500.0, -3700.0, "B5"),
    ("P16_HallTiers", 161000.0, 72500.0, -4200.0, "B5"),
]

# Эллипсисы «золотого пути» (титр главы + затемнение + перенос группы); в свободной игре не используются
ELLIPSIS_A2 = (53400.0, 18450.0, 250.0)    # ~90 м до точки остановки P4
ELLIPSIS_A3 = (138800.0, 73550.0, 200.0)   # 20 м до устья расщелины (обход «плавника» с юга)

# ---------------------------------------------------------------- червь и солнце
SUN_AZIMUTH_YAW = 20.0          # направление НА солнце в Morning_Erg (yaw UE)
SUN_ELEVATION = 28.0            # градусы; DirectionalLight rotator = (pitch -28, yaw 200)
WORM_REVEAL_DIST = 8000.0       # 80 м от тропы
WORM_REVEAL = (62000.0 + WORM_REVEAL_DIST * math.cos(math.radians(SUN_AZIMUTH_YAW)),
               21000.0 + WORM_REVEAL_DIST * math.sin(math.radians(SUN_AZIMUTH_YAW)),
               0.0)                                   # ≈ (69518, 23736, 0)
WORM_REVEAL_YAW = SUN_AZIMUTH_YAW + 180.0             # голова смотрит на игрока
WORM_SPAWN = (110000.0, -30000.0, -6000.0)            # точка покоя (BurrowDepth 60 м), ~700 м к СВ от P4

# ---------------------------------------------------------------- A2: острова-камни, тень
SAFE_ISLANDS = [
    # (имя, x, y, длина, ширина, высота, yaw)
    ("R1", 34000.0, 9000.0, 1400.0, 900.0, 220.0, 15.0),
    ("R2", 47000.0, 20500.0, 1800.0, 1100.0, 300.0, 70.0),
    ("R3", 63500.0, 24000.0, 1500.0, 1000.0, 260.0, 40.0),
    ("R4", 76000.0, 24000.0, 2000.0, 1200.0, 340.0, 110.0),
    ("R5", 88000.0, 38000.0, 1300.0, 900.0, 200.0, 5.0),
    ("R6", 97000.0, 36000.0, 1700.0, 1000.0, 280.0, 60.0),
]

# ---------------------------------------------------------------- A3/A4
A3_PLATES = [
    # (x, y, длина, ширина, высота верха, yaw) — каменные плиты подхода, ступени к основанию
    (104000.0, 45000.0, 2600.0, 1600.0, 150.0, 30.0),
    (110000.0, 50500.0, 3000.0, 1800.0, 250.0, 35.0),
    (116000.0, 55000.0, 2800.0, 2000.0, 330.0, 40.0),
    (121500.0, 60500.0, 3200.0, 2200.0, 420.0, 50.0),
    (126000.0, 66000.0, 3000.0, 2000.0, 380.0, 55.0),
    (130500.0, 71500.0, 2600.0, 1800.0, 300.0, 50.0),
    (134500.0, 75500.0, 2200.0, 1500.0, 200.0, 20.0),
    (120000.0, 68000.0, 1800.0, 1200.0, 500.0, 80.0),
    (128000.0, 56000.0, 2000.0, 1300.0, 450.0, 10.0),
]
PLATE_ARCH = (120500.0, 58000.0)        # тень S3 (плита-навес)
CREVICE_MOUTH = (140500.0, 72500.0, 0.0)
CREVICE_END_X = 144500.0
CREVICE_WIDTH = 600.0                   # 6 м по низу
CREVICE_FIN = (138700.0, 71600.0, 2500.0, 900.0, 6000.0, 117.0)  # «плавник» на линии взгляда старт→устье (yaw 27°)
CREVICE_OPEN_H = 5000.0                 # до 50 м расщелина 6→3 м; выше — волосяная трещина 0.8 м (свет сверху)
FALSE_ROCK = (144300.0, 72500.0, 0.0)
THUMPER_RACK = (137500.0, 70000.0)

# ---------------------------------------------------------------- сиетч (мир, см). Прямоугольники: (x0, x1, y0, y1)
SIETCH_AXIS_Y = 72500.0
B1 = dict(x0=144500.0, x1=148500.0, y0=72300.0, y1=72700.0,
          chamber_x1=145700.0, stair_x1=148100.0, floor_top=0.0, floor_bottom=-1400.0, height=450.0,
          door1_x=144700.0, door2_x=145300.0)
B2 = dict(x0=148500.0, x1=154500.0, y0=71750.0, y1=73250.0,
          floor=-2000.0, balcony=-1400.0, balcony_depth=300.0, ceiling=-600.0,
          landing_x1=149500.0, stair_x1=150500.0)
B3A = dict(x=153500.0, y0=67750.0, y1=71750.0, width=300.0, floor=-2000.0, height=350.0)   # север, 40 м
B3C = dict(x=153500.0, y0=73250.0, y1=76250.0, width=300.0, floor=-2000.0, height=350.0)   # юг, 30 м
B3B = dict(x0=154500.0, x1=159500.0, y0=72350.0, y1=72650.0, width=300.0, height=380.0,     # восток, 50 м
           segs=[(154500.0, 155500.0, -2000.0, -2000.0),   # (x0, x1, z0, z1) пол
                 (155500.0, 157000.0, -2000.0, -2850.0),   # лестница
                 (157000.0, 157500.0, -2850.0, -2850.0),   # площадка у решётки цистерны
                 (157500.0, 159000.0, -2850.0, -3700.0),   # лестница
                 (159000.0, 159500.0, -3700.0, -3700.0)],
           grate_x=157250.0)
B4 = dict(x0=156000.0, x1=159000.0, y0=73000.0, y1=75000.0, floor=-3600.0, basin=-4000.0,
          water=-3800.0, ceiling=-2300.0)
B5 = dict(x0=159500.0, x1=164500.0, y0=70750.0, y1=74250.0, floor=-4800.0, bowl=-4860.0,
          apex=-2300.0, springing=-3800.0, balcony=-3700.0, balcony_x1=159900.0, stair_x1=161000.0,
          balcony_y0=72100.0, balcony_y1=72900.0, terrace=-4200.0,
          bowl_center=(162500.0, 72500.0), bowl_half=700.0, tier_count=5, tier_width=160.0, tier_rise=120.0,
          shaft_radius=200.0, dais_x0=164000.0, rib_step=250.0)


def b5_tier_top(k: int) -> float:
    """Высота верха яруса k (0 — внутренний, у чаши)."""
    return B5["floor"] + (k + 1) * B5["tier_rise"]


def b5_tier_half(k: int) -> float:
    """Внешняя полуширина яруса k от центра чаши."""
    return B5["bowl_half"] + (k + 1) * B5["tier_width"]


def b3b_floor_z(x: float) -> float:
    for x0, x1, z0, z1 in B3B["segs"]:
        if x0 <= x <= x1:
            return z0 + (z1 - z0) * (x - x0) / (x1 - x0)
    return B3B["segs"][-1][3]


# ---------------------------------------------------------------- зоны (AABB для ARakisZoneVolume)
# (zone_id, enum_name, weather, music_enum, interior, load[], unload[], [(xmin,xmax,ymin,ymax,zmin,zmax), ...])
DESERT = "Desert"
SIETCH = "Sietch"
ZONES = [
    ("A1", "A1_Ridge", "Dawn_Ridge", "DesertCalm", False, [DESERT], [SIETCH],
     [(-60000, 24000, -70000, 90000, -10000, 30000)]),
    ("A2", "A2_Erg", "Morning_Erg", "DesertDrone", False, [DESERT], [SIETCH],
     [(24000, 100000, -70000, 140000, -10000, 30000)]),
    ("A3w", "A3_Approach", "Noon_Approach", "DesertCalm", False, [DESERT, SIETCH], [],
     [(100000, 122000, -70000, 170000, -10000, 40000)]),
    ("A3e", "A3_Approach", "Storm_Horizon", "DesertCalm", False, [DESERT, SIETCH], [],
     [(122000, 138500, -70000, 170000, -10000, 40000),
      (138500, 190000, -70000, 66000, -1000, 40000),
      (138500, 190000, 79000, 170000, -1000, 40000),
      (144500, 190000, 66000, 79000, 800, 40000)]),
    ("A4", "A4_Crevice", "Crevice_Shade", "Silence", False, [DESERT, SIETCH], [],
     [(138500, 144500, 66000, 79000, -1000, 40000)]),
    ("B1", "B1_Airlock", "Sietch_Interior", "SietchNarrow", True, [DESERT, SIETCH], [],
     [(144500, 148500, 72000, 73000, -1700, 700)]),
    ("B2", "B2_Gallery", "Sietch_Interior", "SietchLife", True, [SIETCH], [DESERT],
     [(148500, 154500, 71500, 73500, -2300, -400)]),
    ("B3", "B3_Passages", "Sietch_Interior", "SietchNarrow", True, [SIETCH], [DESERT],
     [(152800, 154200, 67500, 71500, -2300, -1400),
      (152800, 154200, 73500, 76500, -2300, -1400),
      (154500, 159500, 72000, 73000, -4000, -1400)]),
    ("B4", "B4_Cistern", "Sietch_Interior", "SietchNarrow", True, [SIETCH], [DESERT],
     [(156000, 159000, 73000, 75000, -4200, -2200)]),
    ("B5", "B5_Hall", "Hall_Ritual", "HallChorale", True, [SIETCH], [DESERT],
     [(159500, 164500, 70750, 74250, -5200, -2100)]),
]

# Триггеры кат-сцен: (имя, sequence, центр, размер бокса)
CINEMATICS = [
    ("CT_WormReveal", "/Game/Rakis/Cinematics/LS_WormReveal", (60500.0, 20500.0, 400.0), (3000.0, 6000.0, 1500.0)),
    ("CT_HallFinale", "/Game/Rakis/Cinematics/LS_HallFinale", (159800.0, 72500.0, -3450.0), (500.0, 800.0, 500.0)),
]

# ---------------------------------------------------------------- точки интереса (LoreID → позиция)
POIS = [
    # (LoreID, x, y, z, yaw, описание)
    ("LORE_Harvester_Wreck", 70000.0, -15000.0, 400.0, 0.0, "A2: полузанесённый спайс-комбайн"),
    ("LORE_Dead_Maker", 40000.0, 35000.0, 200.0, 0.0, "A2: выбеленные рёбра мёртвого червя-подростка"),
    ("LORE_Thumper_Rack", 137500.0, 70000.0, 150.0, 300.0, "A3: стойка тамперов наездников"),
    ("LORE_Carving_Fremen", 145500.0, 72320.0, 160.0, 90.0, "B1: фрименская резьба за внутренней дверью (слой 1)"),
    ("LORE_Quizarate_Sigil", 149200.0, 71770.0, -1250.0, 90.0, "B2: имперский знак Квизарата (слой 2)"),
    ("LORE_Revivalist_Mural", 152000.0, 73230.0, -1850.0, 270.0, "B2: наивная роспись возрожденцев (слой 3)"),
    ("LORE_Water_Rings", 150800.0, 72900.0, -1900.0, 270.0, "B2: водяные кольца у торговки"),
    ("LORE_Maker_Hooks", 153900.0, 71800.0, -1900.0, 90.0, "B2: стойка крючьев творца"),
    ("LORE_Cistern_Grate", 157250.0, 72930.0, -2700.0, 270.0, "B3: решётка цистерны (в нише-алькове площадки)"),
    ("LORE_Shiana_Shrine", 153080.0, 68300.0, -1850.0, 0.0, "B3a: домашний алтарь Шианы в западной нише"),
    ("LORE_Worm_Throat", 164400.0, 72500.0, -4000.0, 180.0, "B5: рельеф «глотка Бога» за помостом наиба"),
]

# Smart Object-слоты и архетипы толпы задаются в level_markup.py (генерируются от геометрии зон).
CROWD_ARCHETYPES = ["Trader", "Artisan", "WaterCarrier", "Child", "Guard", "Pilgrim", "Elder", "Weaver"]


def path_length(points) -> float:
    total = 0.0
    for a, b in zip(points, points[1:]):
        total += math.dist(a, b)
    return total


def summary() -> str:
    lines = []
    pts = [(p[1], p[2], p[3]) for p in GOLDEN_PATH]
    by_zone: dict[str, float] = {}
    for a, b in zip(GOLDEN_PATH, GOLDEN_PATH[1:]):
        d = math.dist((a[1], a[2], a[3]), (b[1], b[2], b[3]))
        by_zone[b[4]] = by_zone.get(b[4], 0.0) + d
    for z, d in by_zone.items():
        lines.append(f"{z}: {d / 100:.0f} м, {d / WALK_SPEED_CMS:.0f} с")
    total = path_length(pts)
    lines.append(f"Полный путь: {total / 100:.0f} м, {total / WALK_SPEED_CMS / 60:.1f} мин")
    lines.append(f"Червь: reveal {tuple(round(v) for v in WORM_REVEAL)}")
    return "\n".join(lines)


if __name__ == "__main__":
    print(summary())
