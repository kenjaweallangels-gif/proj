"""
ai_smart_objects.py — ассеты Smart Object Definition толпы сиетча (T-015 S2, docs/tech/crowd.md §2).

Создаёт /Game/Rakis/AI/SmartObjects/SOD_<Type> для типов Loom, Stall, WaterJar, PrayerMat, Bench, Niche,
StillsuitRepair:
  * слоты по ёмкости типа (Bench 3, Stall/WaterJar 2, прочие 1) в ряд поперёк «лица» точки (локальная Y, шаг 70 см);
  * activity-тег Rakis.SO.<Type> на определении и на каждом слоте (теги нативные — объявлены в C++ модуля Rakis,
    поэтому модуль должен быть собран);
  * на каждом слоте — поведение RakisSmartObjectBehaviorDefinition (SpotType, длительность, охота поговорить).

Ассеты не обязательны: без них URakisCrowdSubsystem собирает те же определения в рантайме. Ассеты нужны, чтобы
дизайнер мог править слоты/длительности в редакторе и видеть превью.
Маркеры уровня НЕ трогает: компоненты USmartObjectComponent вешаются на маркеры Rakis.SmartObject.<Type> в рантайме.

Идемпотентно: существующий ассет перезаписывается (слоты/теги/поведения пересобираются), дубликатов нет.
Запуск: в редакторе — Tools → Execute Python Script, или `py ai_smart_objects.py` в консоли Output Log.
"""
from __future__ import annotations

import unreal

from rakis_common import create_or_load, ensure_dir, log, rakis_class, save_dir, warn

SO_DIR = "/Game/Rakis/AI/SmartObjects"

# тип: (ёмкость, длительность min, max (сек, -1 — значения горожанина), множитель разговора)
SPOT_TYPES = {
    "Loom":            (1, 20.0, 45.0, 0.6),
    "Stall":           (2, 15.0, 40.0, 1.4),
    "WaterJar":        (2, 8.0, 20.0, 1.3),
    "PrayerMat":       (1, 25.0, 60.0, 0.2),
    "Bench":           (3, 15.0, 45.0, 1.5),
    "Niche":           (1, 10.0, 30.0, 0.8),
    "StillsuitRepair": (1, 20.0, 50.0, 0.7),
}
SLOT_SPACING = 70.0


def _tag_container(tag: str):
    """GameplayTagContainer с одним тегом через import_text (в Python нет прямого конструктора тега)."""
    cont = unreal.GameplayTagContainer()
    try:
        cont.import_text(f'(GameplayTags=((TagName="{tag}")))')
    except Exception as e:  # noqa: BLE001
        warn(f"тег {tag}: import_text — {e}")
        return None
    if tag not in cont.export_text():
        warn(f"тег {tag} не применился (C++ модуль Rakis не собран? нативные теги объявлены в RakisSmartObjects.cpp)")
        return None
    return cont


def _definition_factory():
    for name in ("SmartObjectDefinitionFactory",):
        cls = getattr(unreal, name, None)
        if cls is not None:
            return cls()
    return None  # create_asset подберёт фабрику по классу


def build_definition(spot_type: str, capacity: int, dur_min: float, dur_max: float, talk: float, behavior_cls) -> bool:
    path = f"{SO_DIR}/SOD_{spot_type}"
    asset = create_or_load(path, unreal.SmartObjectDefinition, _definition_factory())
    if asset is None:
        warn(f"{path}: не удалось создать SmartObjectDefinition")
        return False

    tags = _tag_container(f"Rakis.SO.{spot_type}")
    if tags is not None:
        asset.set_editor_property("activity_tags", tags)

    slots = []
    for i in range(capacity):
        slot = unreal.SmartObjectSlotDefinition()
        lateral = (i - 0.5 * (capacity - 1)) * SLOT_SPACING
        slot.set_editor_property("offset", unreal.Vector3f(0.0, lateral, 0.0))
        slot.set_editor_property("enabled", True)
        try:
            slot.set_editor_property("id", unreal.GuidLibrary.new_guid())
        except Exception as e:  # noqa: BLE001
            warn(f"{path}: slot id — {e}")
        try:
            slot.set_editor_property("name", unreal.Name(f"{spot_type}_{i}"))
        except Exception:  # noqa: BLE001
            pass
        if tags is not None:
            slot.set_editor_property("activity_tags", tags)
        if behavior_cls is not None:
            beh = unreal.new_object(behavior_cls, outer=asset)
            beh.set_editor_property("spot_type", unreal.Name(spot_type))
            beh.set_editor_property("use_duration_min", dur_min)
            beh.set_editor_property("use_duration_max", dur_max)
            beh.set_editor_property("talk_chance_scale", talk)
            slot.set_editor_property("behavior_definitions", [beh])
        slots.append(slot)
    asset.set_editor_property("slots", slots)

    eal = unreal.EditorAssetLibrary
    eal.save_loaded_asset(asset, only_if_is_dirty=False)
    log(f"{path}: слотов {capacity}, тег Rakis.SO.{spot_type}, поведение "
        f"{'есть' if behavior_cls else 'НЕТ (модуль Rakis не собран)'}")
    return tags is not None and behavior_cls is not None


def main():
    ensure_dir(SO_DIR)
    behavior_cls = rakis_class("RakisSmartObjectBehaviorDefinition")
    ok = 0
    for spot_type, (cap, dmin, dmax, talk) in SPOT_TYPES.items():
        try:
            if build_definition(spot_type, cap, dmin, dmax, talk, behavior_cls):
                ok += 1
        except Exception as e:  # noqa: BLE001
            warn(f"SOD_{spot_type}: {e}")
    save_dir(SO_DIR)
    log(f"ai_smart_objects: готово, полных определений {ok}/{len(SPOT_TYPES)}"
        + ("" if ok == len(SPOT_TYPES) else " — неполные ассеты C++ отбракует и соберёт определение в рантайме"))


if __name__ == "__main__":
    main()
