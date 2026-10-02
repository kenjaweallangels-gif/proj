"""
audio_setup.py — звуковая инфраструктура Rakis (T-014). Идемпотентен.

1. Импортирует черновую озвучку Export/vo/*.wav → /Game/Rakis/Audio/VO/<DialogueID>
   (имя файла = DialogueID = имя ассета, совпадает с VO_File в Dialogue_S1.csv);
   Export/vo/barks/*.wav → /Game/Rakis/Audio/VO/Barks/<BarkID>.
2. Создаёт SoundClass-иерархию (SC_Master → Music/Ambience/SFX/VO/UI), SoundMix-ы
   (SM_Base, SM_Duck_VO, SM_Duck_Worm, SM_Cinematic), Submix-ы (SMX_Reverb_*),
   SoundAttenuation (ATT_*) — пути совпадают с колонкой Attenuation в AudioEvents.csv.
3. Назначает SC_VO импортированным SoundWave.
Всё, что Python не умеет в данной версии UE, пропускается с предупреждением (docs/audio/soundmap.md §8).

Вне редактора: `python3 audio_setup.py` — печатает план.
"""
from __future__ import annotations

import glob
import os
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

VO_SRC = os.path.join(PROJ, "Export", "vo")
AUDIO = "/Game/Rakis/Audio"
VO_DIR = f"{AUDIO}/VO"
MIX_DIR = f"{AUDIO}/Mix"
ATT_DIR = f"{AUDIO}/Attenuation"

# SoundClass: имя → (родитель, громкость)
SOUND_CLASSES = {
    "SC_Master": (None, 1.0),
    "SC_Music": ("SC_Master", 0.8),
    "SC_Ambience": ("SC_Master", 0.9),
    "SC_SFX": ("SC_Master", 1.0),
    "SC_VO": ("SC_Master", 1.0),
    "SC_UI": ("SC_Master", 0.5),
}
# SoundMix: имя → {класс: (volume, fade_in, fade_out)}  — см. soundmap.md §6 «Микс и дакинг»
SOUND_MIXES = {
    "SM_Base": {},
    "SM_Duck_VO": {"SC_Music": (0.55, 0.25, 0.8), "SC_Ambience": (0.7, 0.25, 0.8)},
    "SM_Duck_Worm": {"SC_Music": (0.4, 1.5, 3.0), "SC_Ambience": (0.25, 1.5, 3.0), "SC_UI": (0.0, 0.5, 1.0)},
    "SM_Cinematic": {"SC_Ambience": (0.6, 1.0, 2.0), "SC_UI": (0.0, 0.2, 0.5)},
}
SUBMIXES = ["SMX_Reverb_Desert", "SMX_Reverb_Crevice", "SMX_Reverb_Sietch", "SMX_Reverb_Passage",
            "SMX_Reverb_Cistern", "SMX_Reverb_Hall"]
# Attenuation: имя → (inner radius см, falloff см)
ATTENUATIONS = {
    "ATT_Footstep": (150, 2500),
    "ATT_Worm_Huge": (20000, 180000),
    "ATT_Thumper": (500, 60000),
    "ATT_Prop_Small": (100, 1500),
    "ATT_Prop_Medium": (300, 4000),
    "ATT_Prop_Large": (800, 9000),
    "ATT_Glowglobe": (50, 600),
    "ATT_Crowd": (1500, 5000),
    "ATT_VO": (300, 2500),
}


def log(msg: str) -> None:
    (unreal.log if IN_UE else print)(f"[Rakis] audio_setup: {msg}")


def warn(msg: str) -> None:
    (unreal.log_warning if IN_UE else print)(f"[Rakis] audio_setup: {msg}")


def _ensure_dir(p: str) -> None:
    if not unreal.EditorAssetLibrary.does_directory_exist(p):
        unreal.EditorAssetLibrary.make_directory(p)


def _create(path: str, cls_name: str, factory_name: str):
    """Создаёт ассет, если его нет. Возвращает (asset|None, created)."""
    eal = unreal.EditorAssetLibrary
    if eal.does_asset_exist(path):
        return eal.load_asset(path), False
    cls = getattr(unreal, cls_name, None)
    fac_cls = getattr(unreal, factory_name, None)
    if cls is None or fac_cls is None:
        warn(f"{cls_name}/{factory_name} недоступны в Python — {path} пропущен")
        return None, False
    pkg, name = path.rsplit("/", 1)
    _ensure_dir(pkg)
    return unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, pkg, cls, fac_cls()), True


def _try(obj, prop: str, value) -> bool:
    try:
        obj.set_editor_property(prop, value)
        return True
    except Exception as e:  # noqa: BLE001
        warn(f"{obj.get_name()}.{prop}: {e}")
        return False


# ---------------------------------------------------------------- шаги
def setup_classes() -> dict:
    out = {}
    for name, (parent, vol) in SOUND_CLASSES.items():
        sc, created = _create(f"{MIX_DIR}/{name}", "SoundClass", "SoundClassFactory")
        if sc is None:
            continue
        out[name] = sc
        if created:
            props = sc.get_editor_property("properties")
            _try(props, "volume", vol)
            _try(sc, "properties", props)
    for name, (parent, _) in SOUND_CLASSES.items():
        if parent and name in out and parent in out:
            _try(out[name], "parent_class", out[parent])
    for sc in out.values():
        unreal.EditorAssetLibrary.save_loaded_asset(sc)
    return out


def setup_mixes(classes: dict) -> None:
    for name, adj in SOUND_MIXES.items():
        mix, created = _create(f"{MIX_DIR}/{name}", "SoundMix", "SoundMixFactory")
        if mix is None or not created:
            continue
        items = []
        for cname, (vol, fin, fout) in adj.items():
            if cname not in classes or not hasattr(unreal, "SoundClassAdjuster"):
                continue
            a = unreal.SoundClassAdjuster()
            _try(a, "sound_class_object", classes[cname])
            _try(a, "volume_adjuster", vol)
            _try(a, "apply_to_children", True)
            items.append(a)
            _try(mix, "fade_in_time", fin)
            _try(mix, "fade_out_time", fout)
        if items:
            _try(mix, "sound_class_effects", items)
        unreal.EditorAssetLibrary.save_loaded_asset(mix)


def setup_submixes() -> None:
    for name in SUBMIXES:
        smx, _ = _create(f"{MIX_DIR}/{name}", "SoundSubmix", "SoundSubmixFactory")
        if smx is not None:
            unreal.EditorAssetLibrary.save_loaded_asset(smx)
    # Пресеты реверба (SubmixEffectReverbPreset) настраиваются руками по таблице soundmap.md §7:
    # Python-API для эффектов сабмикса нестабилен между версиями — не трогаем.


def setup_attenuation() -> None:
    for name, (inner, falloff) in ATTENUATIONS.items():
        att, created = _create(f"{ATT_DIR}/{name}", "SoundAttenuation", "SoundAttenuationFactory")
        if att is None or not created:
            continue
        s = att.get_editor_property("attenuation")
        _try(s, "attenuation_shape_extents", unreal.Vector(inner, 0, 0))
        _try(s, "falloff_distance", float(falloff))
        _try(s, "spatialize", True)
        if name == "ATT_Worm_Huge":
            _try(s, "enable_listener_focus", False)
            _try(s, "attenuate_with_lpf", True)  # «Enable Air Absorption» = bAttenuateWithLPF: высокие гаснут, остаётся гул
        _try(att, "attenuation", s)
        unreal.EditorAssetLibrary.save_loaded_asset(att)


def import_vo(classes: dict) -> int:
    files = sorted(glob.glob(os.path.join(VO_SRC, "*.wav")))
    barks = sorted(glob.glob(os.path.join(VO_SRC, "barks", "*.wav")))
    if not files and not barks:
        warn(f"нет WAV в {VO_SRC} — сначала Tools/tts/tts_batch.py")
        return 0
    eal = unreal.EditorAssetLibrary
    tasks = []
    for src, dest in [(f, VO_DIR) for f in files] + [(f, f"{VO_DIR}/Barks") for f in barks]:
        name = os.path.splitext(os.path.basename(src))[0]
        t = unreal.AssetImportTask()
        t.set_editor_property("filename", src)
        t.set_editor_property("destination_path", dest)
        t.set_editor_property("destination_name", name)
        t.set_editor_property("replace_existing", True)  # повторный запуск обновляет, не дублирует
        t.set_editor_property("automated", True)
        t.set_editor_property("save", True)
        tasks.append(t)
    _ensure_dir(VO_DIR)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks(tasks)
    vo_class = classes.get("SC_VO")
    n = 0
    for t in tasks:
        for p in t.get_editor_property("imported_object_paths") or []:
            w = eal.load_asset(p)
            if w and vo_class:
                _try(w, "sound_class_object", vo_class)
                eal.save_loaded_asset(w)
            n += 1
    return n


def main() -> None:
    if not IN_UE:
        log(f"план: VO из {VO_SRC} → {VO_DIR}; классы {list(SOUND_CLASSES)}; миксы {list(SOUND_MIXES)}; "
            f"сабмиксы {SUBMIXES}; attenuation {list(ATTENUATIONS)}")
        return
    with unreal.ScopedEditorTransaction("Rakis: audio_setup"):
        classes = setup_classes()
        setup_mixes(classes)
        setup_submixes()
        setup_attenuation()
        n = import_vo(classes)
    log(f"готово: классов {len(classes)}, VO импортировано/обновлено {n}")


if __name__ == "__main__":
    main()
