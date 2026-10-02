"""
char_crowd_variants.py — сидовый генератор вариаций толпы (T-012).

Читает Content/Rakis/Data/CrowdArchetypes.csv, для каждого архетипа строит N вариантов
(N пропорционально SpawnWeight): цвета слоёв из ClothPalette, набор модулей из Accessories,
износ/выцветание, рост/телосложение. Результат — Export/crowd_variants.json (детерминирован по сиду).
Правила сочетаний — docs/art/characters/modular_clothing.md.

Вне редактора:  python3 Tools/unreal_python/char_crowd_variants.py [--seed 1517] [--total 64]
В редакторе:    то же + создаются MI_Cloth_Crowd_<Archetype>_<NN> (родитель M_Cloth_Worn,
                параметры ClothTint / AccentTint / Wear / SunBleach) — идемпотентно.
"""
from __future__ import annotations

import argparse
import colorsys
import csv
import json
import os
import random
import sys

try:
    import unreal
    IN_UE = True
except ImportError:
    unreal = None
    IN_UE = False

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.abspath(os.path.join(HERE, "..", ".."))
if IN_UE:
    PROJ = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
CSV_PATH = os.path.join(PROJ, "Content", "Rakis", "Data", "CrowdArchetypes.csv")
OUT_JSON = os.path.join(PROJ, "Export", "crowd_variants.json")

PARENT_MAT = "/Game/Rakis/Materials/Master/M_Cloth_Worn"
MI_DIR = "/Game/Rakis/Materials/Instances"
DEFAULT_SEED = 1517  # «год» по счёту Рассеяния — просто стабильный сид

# Слоты модулей: из одного слота — не больше одного модуля (modular_clothing.md §3).
SLOTS = {
    "Head": ["Mod_Hood_Wrap", "Mod_Hood_Mask", "Mod_Headband_Child", "Mod_Loupe_Brow"],
    "Outer": ["Mod_Cloak_Long", "Mod_Shawl_Pilgrim", "Mod_Apron_Leather", "Mod_Apron_Cloth"],
    "Belt": ["Mod_Belt_Pouches", "Mod_Belt_Tools"],
    "Carry": ["Mod_Satchel_Cross", "Mod_Jar_Shoulder", "Mod_Yoke_Carry", "Mod_Tool_Roll", "Mod_Thread_Spools"],
    "Hand": ["Mod_Staff_Walking", "Mod_Toy_Worm", "Mod_Toy_Thumper"],
    "Arm": ["Mod_Bracer_Leather", "Mod_Bracer_Weaver"],
    "Neck": ["Mod_Beads_Prayer", "Mod_Beads_Coins", "Mod_Water_Rings", "Mod_Scarf_Blue"],
    "Wear": ["Mod_Patches_Heavy"],
    "Weapon": ["Mod_Kris_Sheath"],
}
SLOT_OF = {m: s for s, ms in SLOTS.items() for m in ms}
# Обязательные модули архетипа (силуэт читается издали).
REQUIRED = {"WaterCarrier": ["Mod_Jar_Shoulder"], "Guard": ["Mod_Kris_Sheath", "Mod_Hood_Mask"],
            "Weaver": ["Mod_Bracer_Weaver"], "Pilgrim": ["Mod_Shawl_Pilgrim"], "Elder": ["Mod_Staff_Walking"],
            "Artisan": ["Mod_Apron_Leather"]}
# Взаимоисключения поверх слотов.
EXCLUSIVE = [("Mod_Jar_Shoulder", "Mod_Yoke_Carry"), ("Mod_Cloak_Long", "Mod_Apron_Leather")]
BLUE_ACCENT = "#2C3E57"  # синий — только как акцент (≤ 1 слой), кроме Weaver


def hex_to_rgb(h: str) -> tuple[float, float, float]:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def rgb_to_hex(c) -> str:
    return "#" + "".join(f"{max(0, min(255, round(v * 255))):02X}" for v in c)


def jitter(hex_col: str, rng: random.Random, sun_bleach: float) -> str:
    """Лёгкий разброс оттенка + выгорание на солнце (к светлой охре, ниже насыщенность)."""
    h, l, s = colorsys.rgb_to_hls(*hex_to_rgb(hex_col))
    h = (h + rng.uniform(-0.015, 0.015)) % 1.0
    l = min(0.92, l * rng.uniform(0.92, 1.08) + sun_bleach * 0.12)
    s = max(0.0, s * rng.uniform(0.85, 1.05) * (1.0 - sun_bleach * 0.45))
    return rgb_to_hex(colorsys.hls_to_rgb(h, l, s))


def read_archetypes(path: str) -> list[dict]:
    with open(path, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def build_variant(arch: dict, idx: int, rng: random.Random) -> dict:
    name = arch["Archetype"]
    palette = [c for c in arch["ClothPalette"].split(";") if c]
    pool = [m for m in arch["Accessories"].split(";") if m]
    age = arch["AgeGroup"]
    wear = round(rng.uniform(0.35, 0.65) if age == "Child" else rng.uniform(0.45, 0.95), 2)
    if age == "Elder":
        wear = round(min(1.0, wear + 0.1), 2)
    sun = round(rng.uniform(0.1, 0.6), 2)

    chosen: list[str] = list(REQUIRED.get(name, []))
    want = rng.randint(2, min(4, len(pool)))
    for m in rng.sample(pool, len(pool)):
        if len(chosen) >= want:
            break
        if m in chosen:
            continue
        if any(SLOT_OF.get(m) == SLOT_OF.get(c) for c in chosen):
            continue
        if any((m == a and b in chosen) or (m == b and a in chosen) for a, b in EXCLUSIVE):
            continue
        chosen.append(m)
    if wear > 0.8 and "Mod_Patches_Heavy" in pool and "Mod_Patches_Heavy" not in chosen:
        chosen.append("Mod_Patches_Heavy")

    base = palette[0] if palette else "#8A7A66"
    others = palette[1:] or [base]
    outer = rng.choice(others)
    accent = rng.choice(palette)
    # синий — максимум в одном слое у всех, кроме ткачей (у них синий — ремесло)
    if name != "Weaver" and outer == BLUE_ACCENT and accent == BLUE_ACCENT:
        accent = base
    layers = {
        "Stillsuit": jitter("#4A4038", rng, sun * 0.3),  # база дистикомба одна для всех, тёмная
        "Robe": jitter(base, rng, sun),
        "Outer": jitter(outer, rng, sun),
        "Accent": jitter(accent, rng, sun * 0.5),
    }
    return {
        "id": f"{name}_{idx:02d}",
        "archetype": name,
        "age_group": age,
        "walk_speed": round(float(arch["WalkSpeed"]) * rng.uniform(0.9, 1.1), 1),
        "height_scale": round(rng.uniform(0.82, 0.92) if age == "Child" else rng.uniform(0.95, 1.05), 3),
        "build": rng.choice(["lean", "lean", "average", "stocky"]),
        "ibad_eyes": rng.random() < (0.85 if name != "Pilgrim" else 0.4),  # паломники из Кина — реже
        "modules": chosen,
        "colors": layers,
        "wear": wear,
        "sun_bleach": sun,
        "material_instance": f"MI_Cloth_Crowd_{name}_{idx:02d}",
    }


def generate(seed: int, total: int) -> dict:
    archs = read_archetypes(CSV_PATH)
    wsum = sum(float(a["SpawnWeight"]) for a in archs) or 1.0
    rng = random.Random(seed)
    variants = []
    for a in archs:
        n = max(3, round(total * float(a["SpawnWeight"]) / wsum))
        sub = random.Random(f"{seed}:{a['Archetype']}")  # стабильность при правке других архетипов
        for i in range(1, n + 1):
            variants.append(build_variant(a, i, sub))
    rng.shuffle(variants)
    variants.sort(key=lambda v: v["id"])
    return {"seed": seed, "source": os.path.relpath(CSV_PATH, PROJ), "count": len(variants), "variants": variants}


def write_json(data: dict) -> None:
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------- UE: material instances
def _lin(hex_col: str):
    r, g, b = hex_to_rgb(hex_col)
    # sRGB → linear
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4  # noqa: E731
    return unreal.LinearColor(f(r), f(g), f(b), 1.0)


def make_material_instances(data: dict) -> int:
    eal = unreal.EditorAssetLibrary
    if not eal.does_asset_exist(PARENT_MAT):
        unreal.log_warning(f"[Rakis] char_crowd_variants: нет {PARENT_MAT} — MI не созданы (только JSON)")
        return 0
    parent = eal.load_asset(PARENT_MAT)
    if not eal.does_directory_exist(MI_DIR):
        eal.make_directory(MI_DIR)
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    mel = unreal.MaterialEditingLibrary
    n = 0
    with unreal.ScopedEditorTransaction("Rakis: crowd cloth variants"):
        for v in data["variants"]:
            path = f"{MI_DIR}/{v['material_instance']}"
            mi = eal.load_asset(path) if eal.does_asset_exist(path) else None
            if mi is None:
                mi = tools.create_asset(v["material_instance"], MI_DIR, unreal.MaterialInstanceConstant,
                                        unreal.MaterialInstanceConstantFactoryNew())
            if mi is None:
                continue
            mel.set_material_instance_parent(mi, parent)
            mel.set_material_instance_vector_parameter_value(mi, "ClothTint", _lin(v["colors"]["Robe"]))
            mel.set_material_instance_vector_parameter_value(mi, "AccentTint", _lin(v["colors"]["Accent"]))
            mel.set_material_instance_scalar_parameter_value(mi, "Wear", v["wear"])
            mel.set_material_instance_scalar_parameter_value(mi, "SunBleach", v["sun_bleach"])
            eal.save_loaded_asset(mi)
            n += 1
    return n


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="char_crowd_variants")
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--total", type=int, default=64, help="целевое число вариантов (толпа 40–80)")
    args = ap.parse_args(argv if argv is not None else [])
    data = generate(args.seed, args.total)
    write_json(data)
    msg = f"crowd_variants: {data['count']} вариантов → {OUT_JSON}"
    if IN_UE:
        unreal.log(f"[Rakis] {msg}")
        made = make_material_instances(data)
        unreal.log(f"[Rakis] crowd_variants: MI_Cloth_Crowd_* обновлено: {made}")
    else:
        print(msg)


if __name__ == "__main__":
    main(sys.argv[1:])
