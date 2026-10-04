"""Сборка по заказу: пошаговый сценарий для цеха (факт) и 3D-модели для виртуальной сборки.

Последовательность шагов строится из дерева заказа «снизу вверх»: сначала составляющие узла
(в порядке позиций спецификации), затем сам узел — так, как реально собирают.
Один и тот же список используется и для реальной сборки (отметки факта), и для 3D-плеера.
"""
from __future__ import annotations

import os
import re
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import audit
from ..config import get_settings
from ..db import get_db
from ..models import Item, ItemModel, Kit, KitLine, User
from ..security import check_clearance, require

router = APIRouter(prefix="/api/assembly", tags=["assembly"])


# ------------------------------------------------------------------ шаги --
def _ordered_steps(kit: Kit) -> list[KitLine]:
    by_parent: dict[int | None, list[KitLine]] = {}
    for l in sorted(kit.lines, key=lambda x: x.path):
        by_parent.setdefault(l.parent_line_id, []).append(l)
    out: list[KitLine] = []

    def walk(parent: int | None):
        for l in by_parent.get(parent, []):
            walk(l.id)  # сначала всё, что внутри
            out.append(l)  # потом сам узел / деталь

    walk(None)
    return out


def _step_state(l: KitLine) -> str:
    if l.skipped:
        return "skipped"
    if l.done or l.issued_qty >= l.required_qty:
        return "done"
    return "pending"


def _model_for(db: Session, item_id: int) -> ItemModel | None:
    return db.query(ItemModel).filter(ItemModel.item_id == item_id).first()


@router.get("/orders/{kit_id}/steps")
def steps(kit_id: int, db: Session = Depends(get_db), me: User = Depends(require("kits:read"))):
    k = db.get(Kit, kit_id)
    if not k:
        raise HTTPException(404, "Заказ не найден")
    check_clearance(me, k.item.confidentiality)
    models = {m.item_id: m for m in db.query(ItemModel).all()}
    ordered = _ordered_steps(k)
    by_id = {l.id: l for l in k.lines}
    out = []
    for i, l in enumerate(ordered):
        kids = [x for x in k.lines if x.parent_line_id == l.id]
        out.append({
            "index": i, "line_id": l.id, "parent_line_id": l.parent_line_id, "level": l.level,
            "item": {"id": l.item.id, "code": l.item.code, "name": l.item.name, "item_type": l.item.item_type.value, "unit": l.item.unit},
            "required": l.required_qty, "is_assembly": bool(kids),
            "into": (by_id[l.parent_line_id].item.name if l.parent_line_id and l.parent_line_id in by_id else k.item.name),
            "state": _step_state(l), "done_at": l.done_at, "done_by": l.done_by.full_name if l.done_by else None,
            "note": l.note, "model_url": f"/api/assembly/models/{l.item.id}.glb" if l.item.id in models else None,
        })
    done = sum(1 for s in out if s["state"] != "pending")
    current = next((s["index"] for s in out if s["state"] == "pending"), len(out))
    root_model = models.get(k.item_id)
    return {"order": {"id": k.id, "number": k.number, "item": {"id": k.item.id, "code": k.item.code, "name": k.item.name}, "qty": k.qty,
                      "status": k.status},
            "steps": out, "total": len(out), "done": done, "current": current,
            "assembly_model_url": f"/api/assembly/models/{k.item_id}.glb" if root_model else None,
            "assembly_model_nodes": root_model.node_count if root_model else 0}


class StepAction(BaseModel):
    action: str  # done | undo | skip


@router.post("/orders/{kit_id}/steps/{line_id}")
def step_action(kit_id: int, line_id: int, data: StepAction, db: Session = Depends(get_db), me: User = Depends(require("kits:write"))):
    k, l = db.get(Kit, kit_id), db.get(KitLine, line_id)
    if not k or not l or l.kit_id != k.id:
        raise HTTPException(404)
    if data.action == "done":
        l.done, l.skipped, l.issued_qty, l.done_at, l.done_by_id = True, False, l.required_qty, datetime.utcnow(), me.id
    elif data.action == "skip":
        l.done, l.skipped, l.done_at, l.done_by_id = False, True, datetime.utcnow(), me.id
    elif data.action == "undo":
        l.done, l.skipped, l.issued_qty, l.done_at, l.done_by_id = False, False, 0, None, None
    else:
        raise HTTPException(400, "action: done | undo | skip")
    if k.status == "open":
        k.status = "in_work"
    ordered = _ordered_steps(k)
    if all(_step_state(x) != "pending" for x in ordered):
        k.status = "assembled"
    elif k.status == "assembled":
        k.status = "in_work"
    audit.log(db, me.id, f"step_{data.action}", "kit", k.number, {"item": l.item.code})
    db.commit()
    done = sum(1 for x in ordered if _step_state(x) != "pending")
    current = next((i for i, x in enumerate(ordered) if _step_state(x) == "pending"), len(ordered))
    return {"state": _step_state(l), "done": done, "total": len(ordered), "current": current, "kit_status": k.status}


# --------------------------------------------------------------- модели --
ALLOWED = {".glb": "glb", ".gltf": "gltf", ".step": "step", ".stp": "step", ".stl": "stl", ".obj": "obj"}


def _models_dir() -> Path:
    d = Path(get_settings().models_dir)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _count_nodes(glb_path: Path) -> int:
    try:
        import trimesh

        sc = trimesh.load(str(glb_path), force="scene")
        return len(sc.graph.nodes_geometry)
    except Exception:  # noqa: BLE001
        return 0


def _convert(src: Path, fmt: str, dst: Path) -> None:
    """Любой поддерживаемый формат → GLB. STEP через cascadio (OpenCASCADE), остальное через trimesh."""
    if fmt == "glb":
        shutil.copyfile(src, dst)
        return
    if fmt == "step":
        try:
            import cascadio
        except ImportError:
            raise HTTPException(400, "На сервере нет конвертера STEP (пакет cascadio). Экспортируйте модель в GLB/glTF из CAD.")
        cascadio.step_to_glb(str(src), str(dst), tol_linear=0.05, tol_angular=0.3)
        return
    import trimesh

    sc = trimesh.load(str(src), force="scene")
    sc.export(str(dst), file_type="glb")


@router.post("/models/{item_id}")
def upload_model(item_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), me: User = Depends(require("items:write"))):
    """Загрузить 3D-модель изделия: STEP/STP (конвертируется), GLB/glTF, STL, OBJ.
    Для анимации сборки имена узлов/деталей в модели должны содержать обозначения из спецификации."""
    it = db.get(Item, item_id)
    if not it:
        raise HTTPException(404)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED:
        raise HTTPException(400, f"Формат {ext or '?'} не поддерживается. Нужен STEP, GLB, glTF, STL или OBJ")
    fmt = ALLOWED[ext]
    s = get_settings()
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / f"src{ext}"
        size = 0
        with open(src, "wb") as f:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > s.max_model_mb * 1024 * 1024:
                    raise HTTPException(413, f"Файл больше {s.max_model_mb} МБ")
                f.write(chunk)
        dst = _models_dir() / f"{item_id}.glb"
        try:
            _convert(src, fmt, dst)
        except HTTPException:
            raise
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f"Не удалось обработать модель: {e}")
    m = _model_for(db, item_id)
    if not m:
        m = ItemModel(item_id=item_id)
        db.add(m)
    m.filename, m.source_format, m.size, m.path = file.filename or f"model{ext}", fmt, dst.stat().st_size, str(dst)
    m.node_count, m.uploaded_by_id, m.uploaded_at = _count_nodes(dst), me.id, datetime.utcnow()
    audit.log(db, me.id, "model_upload", "item", it.code, {"format": fmt, "size": m.size, "nodes": m.node_count})
    db.commit()
    return {"ok": True, "format": fmt, "size": m.size, "nodes": m.node_count, "url": f"/api/assembly/models/{item_id}.glb"}


@router.get("/models/{item_id}.glb")
def get_model(item_id: int, db: Session = Depends(get_db), me: User = Depends(require("items:read"))):
    m = _model_for(db, item_id)
    if not m or not os.path.isfile(m.path):
        raise HTTPException(404, "Модель не загружена")
    check_clearance(me, m.item.confidentiality)
    return FileResponse(m.path, media_type="model/gltf-binary", filename=f"{item_id}.glb")


@router.get("/models/{item_id}")
def model_info(item_id: int, db: Session = Depends(get_db), _: User = Depends(require("items:read"))):
    m = _model_for(db, item_id)
    if not m:
        return {"exists": False}
    return {"exists": True, "filename": m.filename, "format": m.source_format, "size": m.size, "nodes": m.node_count,
            "uploaded_at": m.uploaded_at, "url": f"/api/assembly/models/{item_id}.glb"}


@router.get("/models/{item_id}/nodes")
def model_nodes(item_id: int, db: Session = Depends(get_db), _: User = Depends(require("items:read"))):
    """Имена узлов модели — чтобы понять, как они соотносятся с обозначениями спецификации."""
    m = _model_for(db, item_id)
    if not m:
        raise HTTPException(404)
    try:
        import trimesh

        sc = trimesh.load(m.path, force="scene")
        names = sorted({str(n) for n in sc.graph.nodes_geometry})
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"Не удалось прочитать модель: {e}")
    return {"nodes": names[:2000], "total": len(names)}


@router.delete("/models/{item_id}")
def delete_model(item_id: int, db: Session = Depends(get_db), me: User = Depends(require("items:write"))):
    m = _model_for(db, item_id)
    if not m:
        raise HTTPException(404)
    try:
        os.remove(m.path)
    except OSError:
        pass
    db.delete(m)
    audit.log(db, me.id, "model_delete", "item", item_id)
    db.commit()
    return {"ok": True}


def normalize_code(s: str) -> str:
    """Для сопоставления имён узлов 3D-модели с обозначениями: убираем всё, кроме букв и цифр."""
    return re.sub(r"[^0-9A-ZА-ЯЁ]", "", s.upper())
