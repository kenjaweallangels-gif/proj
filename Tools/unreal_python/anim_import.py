"""
anim_import.py — пакетный импорт FBX-анимаций и подключение IK Retargeter (T-013). Идемпотентен.

Источник:  Export/anim/<Set>/*.fbx      (Set = Locomotion, SandWalk, Crafts, Ritual, Rider, Companion, Crowd)
Назначение: /Game/Rakis/Animation/<Set>/A_<имя файла>   (префикс A_ добавляется, если его нет)
Скелет:     /Game/MetaHumans/Common/Female/Medium/NormalWeight/Body/metahuman_base_skel (по умолчанию)
            переопределяется файлом Export/anim/<Set>/skeleton.txt (одна строка — путь к Skeleton).

Ретаргет (если есть исходный скелет мокапа):
  IKRig  /Game/Rakis/Animation/Retarget/IK_Mocap, IK_MetaHuman (создаются пустыми — цепочки настраивает аниматор,
         цепочки — стандартные MetaHuman: Spine, Neck, Head, Arm_L/R, Leg_L/R, Fingers);
  RTG    /Game/Rakis/Animation/Retarget/RTG_Mocap_to_MetaHuman — источник/цель подключаются автоматически.
  С флагом --retarget анимации из /Game/Rakis/Animation/_Mocap/<Set> копируются ретаргетом в <Set>.

Вне редактора: `python3 anim_import.py` — печатает план.
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
if HERE not in sys.path:
    sys.path.insert(0, HERE)
PROJ = os.path.abspath(os.path.join(HERE, "..", ".."))
if IN_UE:
    PROJ = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())

SRC = os.path.join(PROJ, "Export", "anim")
DEST = "/Game/Rakis/Animation"
RTG_DIR = f"{DEST}/Retarget"
DEFAULT_SKELETON = "/Game/MetaHumans/Common/Female/Medium/NormalWeight/Body/metahuman_base_skel"
MOCAP_SKELETON = "/Game/Rakis/Animation/_Mocap/SK_Mocap_Skeleton"
SETS = ["Locomotion", "SandWalk", "Crafts", "Ritual", "Rider", "Companion", "Crowd", "Worm"]


def log(m):
    (unreal.log if IN_UE else print)(f"[Rakis] anim_import: {m}")


def warn(m):
    (unreal.log_warning if IN_UE else print)(f"[Rakis] anim_import: {m}")


def asset_name(fbx: str) -> str:
    n = os.path.splitext(os.path.basename(fbx))[0]
    return n if n.startswith("A_") else f"A_{n}"


def skeleton_for(set_dir: str) -> str:
    p = os.path.join(set_dir, "skeleton.txt")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            line = f.readline().strip()
            if line:
                return line
    return DEFAULT_SKELETON


def plan() -> list[tuple[str, str, str, str]]:
    """[(fbx, dest_dir, asset_name, skeleton)]"""
    out = []
    for s in SETS:
        d = os.path.join(SRC, s)
        for fbx in sorted(glob.glob(os.path.join(d, "*.fbx"))):
            out.append((fbx, f"{DEST}/{s}", asset_name(fbx), skeleton_for(d)))
    return out


# ---------------------------------------------------------------- импорт
def _fbx_options(skeleton):
    ui = unreal.FbxImportUI()
    ui.set_editor_property("import_mesh", False)
    ui.set_editor_property("import_animations", True)
    ui.set_editor_property("import_materials", False)
    ui.set_editor_property("import_textures", False)
    ui.set_editor_property("import_as_skeletal", True)
    ui.set_editor_property("automated_import_should_detect_type", False)
    ui.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_ANIMATION)
    ui.set_editor_property("skeleton", skeleton)
    ad = ui.get_editor_property("anim_sequence_import_data")
    for prop, val in (("import_bone_tracks", True), ("remove_redundant_keys", True),
                      ("use_default_sample_rate", False), ("custom_sample_rate", 30),
                      ("import_custom_attribute", True), ("convert_scene", True),
                      ("animation_length", unreal.FBXAnimationLengthImportType.FBXALIT_EXPORTED_TIME)):
        try:
            ad.set_editor_property(prop, val)
        except Exception:  # noqa: BLE001
            pass
    ui.set_editor_property("anim_sequence_import_data", ad)
    return ui


def import_all(items) -> int:
    eal = unreal.EditorAssetLibrary
    tasks = []
    skel_cache = {}
    for fbx, dest, name, skel_path in items:
        if skel_path not in skel_cache:
            skel_cache[skel_path] = eal.load_asset(skel_path) if eal.does_asset_exist(skel_path) else None
        skel = skel_cache[skel_path]
        if skel is None:
            warn(f"нет скелета {skel_path} — {os.path.basename(fbx)} пропущен")
            continue
        if not eal.does_directory_exist(dest):
            eal.make_directory(dest)
        t = unreal.AssetImportTask()
        t.set_editor_property("filename", fbx)
        t.set_editor_property("destination_path", dest)
        t.set_editor_property("destination_name", name)
        t.set_editor_property("replace_existing", True)  # повторный запуск = реимпорт
        t.set_editor_property("automated", True)
        t.set_editor_property("save", True)
        t.set_editor_property("options", _fbx_options(skel))
        tasks.append(t)
    if tasks:
        # UE 5.5+: FBX по умолчанию через Interchange — он игнорирует destination_name (префикс A_) и не обязан
        # учитывать FbxImportUI.skeleton → на время импорта включаем классический FbxFactory.
        try:
            from rakis_common import legacy_fbx_import
        except Exception:  # noqa: BLE001
            import contextlib
            legacy_fbx_import = contextlib.nullcontext
        with legacy_fbx_import():
            unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks(tasks)
    return len(tasks)


# ---------------------------------------------------------------- ретаргет
def _create(path, cls_name, fac_name):
    eal = unreal.EditorAssetLibrary
    if eal.does_asset_exist(path):
        return eal.load_asset(path)
    cls, fac = getattr(unreal, cls_name, None), getattr(unreal, fac_name, None)
    if cls is None or fac is None:
        warn(f"{cls_name} недоступен (плагин IKRig выключен?) — {path} пропущен")
        return None
    pkg, name = path.rsplit("/", 1)
    if not eal.does_directory_exist(pkg):
        eal.make_directory(pkg)
    return unreal.AssetToolsHelpers.get_asset_tools().create_asset(name, pkg, cls, fac())


def setup_retargeter():
    eal = unreal.EditorAssetLibrary
    ik_src = _create(f"{RTG_DIR}/IK_Mocap", "IKRigDefinition", "IKRigDefinitionFactory")
    ik_tgt = _create(f"{RTG_DIR}/IK_MetaHuman", "IKRigDefinition", "IKRigDefinitionFactory")
    rtg = _create(f"{RTG_DIR}/RTG_Mocap_to_MetaHuman", "IKRetargeter", "IKRetargetFactory")
    if not (ik_src and ik_tgt and rtg):
        return None
    ctrl_cls = getattr(unreal, "IKRigController", None)
    for rig, mesh_path in ((ik_src, f"{MOCAP_SKELETON}_Mesh"),
                           (ik_tgt, "/Game/MetaHumans/Common/Female/Medium/NormalWeight/Body/f_med_nrw_body")):
        if ctrl_cls and eal.does_asset_exist(mesh_path):
            try:
                c = ctrl_cls.get_controller(rig)
                if not c.get_skeletal_mesh():
                    c.set_skeletal_mesh(eal.load_asset(mesh_path))
            except Exception as e:  # noqa: BLE001
                warn(f"IKRig {rig.get_name()}: {e}")
    rc = getattr(unreal, "IKRetargeterController", None)
    if rc:
        try:
            c = rc.get_controller(rtg)
            side = getattr(unreal, "RetargetSourceOrTarget", None)
            if side is not None:
                c.set_ik_rig(side.SOURCE, ik_src)
                c.set_ik_rig(side.TARGET, ik_tgt)
            else:  # API ≤ 5.1
                c.set_source_ik_rig(ik_src)
                c.set_target_ik_rig(ik_tgt)
            if hasattr(c, "auto_map_chains"):
                c.auto_map_chains(unreal.AutoMapChainType.FUZZY, True)
        except Exception as e:  # noqa: BLE001
            warn(f"RTG: {e}")
    eal.save_directory(RTG_DIR, only_if_is_dirty=True, recursive=True)
    return rtg


def batch_retarget(rtg) -> int:
    op = getattr(unreal, "IKRetargetBatchOperation", None)
    if op is None or rtg is None:
        warn("IKRetargetBatchOperation недоступен — ретаргет пропущен")
        return 0
    eal = unreal.EditorAssetLibrary
    src_mesh = f"{MOCAP_SKELETON}_Mesh"
    tgt_mesh = "/Game/MetaHumans/Common/Female/Medium/NormalWeight/Body/f_med_nrw_body"
    if not (eal.does_asset_exist(src_mesh) and eal.does_asset_exist(tgt_mesh)):
        warn("нет мешей источника/цели для ретаргета")
        return 0
    n = 0
    for s in SETS:
        src_dir = f"{DEST}/_Mocap/{s}"
        if not eal.does_directory_exist(src_dir):
            continue
        assets = [eal.find_asset_data(p) for p in eal.list_assets(src_dir, recursive=False)]
        # идемпотентность: пропускаем уже ретаргетнутые
        todo = [a for a in assets if not eal.does_asset_exist(f"{DEST}/{s}/{a.asset_name}")]
        if not todo:
            continue
        # UE 5.6: duplicate_and_retarget(assets_to_retarget, source_mesh, target_mesh, ik_retarget_asset,
        #         search='', replace='', prefix='', suffix='', include_referenced_assets=True) — 9 параметров
        op.duplicate_and_retarget(todo, eal.load_asset(src_mesh), eal.load_asset(tgt_mesh), rtg,
                                  "", "", "", "", True)
        n += len(todo)
    return n


def main(argv=None) -> None:
    argv = argv or []
    items = plan()
    if not IN_UE:
        if not items:
            log(f"нет FBX в {SRC}/<{'|'.join(SETS)}>/")
        for fbx, dest, name, skel in items:
            log(f"{fbx} → {dest}/{name}  [{skel}]")
        return
    with unreal.ScopedEditorTransaction("Rakis: anim_import"):
        n = import_all(items)
        rtg = setup_retargeter()
        r = batch_retarget(rtg) if "--retarget" in argv else 0
    log(f"импорт задач: {n}, ретаргет: {r}, RTG: {'ok' if rtg else 'нет'}")


if __name__ == "__main__":
    main(sys.argv[1:])
