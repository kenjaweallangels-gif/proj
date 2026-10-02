"""
env_sietch_kit.py — модульный кит сиетча «Табр-ан-Нур» на сетке 50 см (T-011).

Запуск:
    blender -b -P Tools/blender/env_sietch_kit.py -- --out Export/sietch [--only Wall_4m,Arch_4m] [--bevel 0.04]

Результат: Export/sietch/SM_Sietch_<Name>.fbx (по одному на модуль) + Export/sietch/kit_manifest.json
(имя, габарит, pivot, слоты материалов, треугольники) — его читает env_import.py и проверяет docs.

Соглашения (подробно — docs/art/environment/sietch_kit.md):
  * единицы — метры, все габариты кратны 0.5 м; pivot — низ модуля на линии сетки;
  * стены: длина по +X от pivot, толщина 0.5 м центрирована на Y=0, высота по +Z (4 м);
  * углы/Т-стыки: pivot в узле сетки (пересечение осей стен);
  * лестницы/пандусы: подъём по +X, pivot — низ первой ступени, центр ширины;
  * пропы: pivot — центр основания;
  * слоты материалов (имена = MI в UE): MI_Sietch_Stone, MI_Sietch_StonePolished, MI_Metal_Old,
    MI_Cloth_Worn, MI_Glowglobe, MI_Sietch_Clay, MI_Sietch_Fiber, MI_Water_Still.
Это «заготовки» (blockout+): силуэт, габарит, слоты, фаски износа. Финальный скульпт — человек-художник.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "Tools", "blender"))
import env_common  # noqa: E402

MATS = ["MI_Sietch_Stone", "MI_Sietch_StonePolished", "MI_Metal_Old", "MI_Cloth_Worn",
        "MI_Glowglobe", "MI_Sietch_Clay", "MI_Sietch_Fiber", "MI_Water_Still"]
STONE, POLISHED, METAL, CLOTH, GLOW, CLAY, FIBER, WATER = range(len(MATS))
WALL_T = 0.5
WALL_H = 4.0


# ================================================================== геометрические примитивы (bmesh)
class Kit:
    def __init__(self):
        import bmesh
        self.bm = bmesh.new()
        self.used = set()

    def _faces_of(self, verts):
        fs = set()
        for v in verts:
            fs.update(v.link_faces)
        return fs

    def _mat(self, faces, mat):
        self.used.add(mat)
        for f in faces:
            f.material_index = mat

    def box(self, x0, x1, y0, y1, z0, z1, mat=STONE):
        import bmesh
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        for v in r["verts"]:
            v.co.x = x0 if v.co.x < 0 else x1
            v.co.y = y0 if v.co.y < 0 else y1
            v.co.z = z0 if v.co.z < 0 else z1
        self._mat(self._faces_of(r["verts"]), mat)
        return r["verts"]

    def obox(self, center, size, yaw=0.0, pitch=0.0, roll=0.0, mat=STONE):
        """Ориентированный ящик (градусы)."""
        import bmesh
        from mathutils import Euler, Vector
        r = bmesh.ops.create_cube(self.bm, size=1.0)
        rot = Euler((math.radians(roll), math.radians(pitch), math.radians(yaw)), "XYZ").to_matrix()
        for v in r["verts"]:
            p = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
            v.co = rot @ p + Vector(center)
        self._mat(self._faces_of(r["verts"]), mat)
        return r["verts"]

    def cyl(self, center, radius, depth, axis="Z", segs=24, mat=STONE, r2=None):
        import bmesh
        from mathutils import Matrix, Vector
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, segments=segs, radius1=radius,
                                  radius2=radius if r2 is None else r2, depth=depth)
        m = Matrix.Identity(3)
        if axis == "X":
            m = Matrix.Rotation(math.radians(90), 3, "Y")
        elif axis == "Y":
            m = Matrix.Rotation(math.radians(-90), 3, "X")
        for v in r["verts"]:
            v.co = m @ v.co + Vector(center)
        self._mat(self._faces_of(r["verts"]), mat)
        return r["verts"]

    def sphere(self, center, radius, mat=GLOW, subdiv=3):
        import bmesh
        from mathutils import Vector
        r = bmesh.ops.create_icosphere(self.bm, subdivisions=subdiv, radius=radius)
        for v in r["verts"]:
            v.co += Vector(center)
        self._mat(self._faces_of(r["verts"]), mat)
        return r["verts"]

    def prism_xz(self, poly, y0, y1, mat=STONE):
        """Выдавливание простого многоугольника в плоскости XZ вдоль Y (вогнутые — ок, n-гоны триангулируются)."""
        bm = self.bm
        a = [bm.verts.new((x, y0, z)) for x, z in poly]
        b = [bm.verts.new((x, y1, z)) for x, z in poly]
        faces = [bm.faces.new(a), bm.faces.new(list(reversed(b)))]
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new((a[j], a[i], b[i], b[j])))
        self._mat(faces, mat)
        return faces

    def prism_xy(self, poly, z0, z1, mat=STONE):
        """Выдавливание многоугольника в плоскости XY вдоль Z."""
        bm = self.bm
        a = [bm.verts.new((x, y, z0)) for x, y in poly]
        b = [bm.verts.new((x, y, z1)) for x, y in poly]
        faces = [bm.faces.new(list(reversed(a))), bm.faces.new(b)]
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
        self._mat(faces, mat)
        return faces

    def arc_solid(self, cx, cz, r_in, r_out, a0, a1, y0, y1, segs=16, mat=STONE):
        """Кольцевой сектор в плоскости XZ (углы в радианах от +X), выдавленный по Y."""
        pts_out = [(cx + r_out * math.cos(a0 + (a1 - a0) * i / segs), cz + r_out * math.sin(a0 + (a1 - a0) * i / segs)) for i in range(segs + 1)]
        pts_in = [(cx + r_in * math.cos(a0 + (a1 - a0) * i / segs), cz + r_in * math.sin(a0 + (a1 - a0) * i / segs)) for i in reversed(range(segs + 1))]
        return self.prism_xz(pts_out + pts_in, y0, y1, mat)

    def revolve(self, profile, segs=32, mat=STONE, center=(0, 0, 0), cap=True):
        """Тело вращения вокруг Z: profile = [(r, z)] снизу вверх."""
        bm = self.bm
        cx, cy, cz = center
        rings = []
        for r, z in profile:
            rings.append([bm.verts.new((cx + r * math.cos(math.tau * k / segs), cy + r * math.sin(math.tau * k / segs), cz + z)) for k in range(segs)])
        faces = []
        for a, b in zip(rings, rings[1:]):
            for k in range(segs):
                k2 = (k + 1) % segs
                faces.append(bm.faces.new((a[k], a[k2], b[k2], b[k])))
        if cap:
            if profile[0][0] > 1e-4:
                faces.append(bm.faces.new(list(reversed(rings[0]))))
            if profile[-1][0] > 1e-4:
                faces.append(bm.faces.new(rings[-1]))
        self._mat(faces, mat)
        return faces

    def heightfield(self, x0, x1, z0, z1, y, fn, nu, nv, mat=STONE, back=0.15):
        """Рельефная панель в плоскости XZ: смещение по −Y = fn(u, v) (м); задняя грань плоская."""
        bm = self.bm
        front = [[bm.verts.new((x0 + (x1 - x0) * i / nu, y - fn(i / nu, j / nv), z0 + (z1 - z0) * j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
        faces = []
        for i in range(nu):
            for j in range(nv):
                faces.append(bm.faces.new((front[i][j], front[i + 1][j], front[i + 1][j + 1], front[i][j + 1])))
        # задняя стенка и бока (коробка)
        bl = [bm.verts.new((x0, y + back, z0)), bm.verts.new((x1, y + back, z0)), bm.verts.new((x1, y + back, z1)), bm.verts.new((x0, y + back, z1))]
        faces.append(bm.faces.new(list(reversed(bl))))
        edge_b = [front[i][0] for i in range(nu + 1)]
        edge_t = [front[i][nv] for i in range(nu + 1)]
        edge_l = [front[0][j] for j in range(nv + 1)]
        edge_r = [front[nu][j] for j in range(nv + 1)]
        faces.append(bm.faces.new(edge_b[::-1] + [bl[0], bl[1]]))
        faces.append(bm.faces.new(edge_t + [bl[2], bl[3]]))
        faces.append(bm.faces.new(edge_l + [bl[3], bl[0]]))
        faces.append(bm.faces.new(edge_r[::-1] + [bl[1], bl[2]]))
        self._mat(faces, mat)
        return faces

    def finish(self, name, bevel=0.04, center=False):
        import bmesh
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-4)
        if center:   # пропы: pivot — центр основания по XY
            xs = [v.co.x for v in bm.verts]
            ys = [v.co.y for v in bm.verts]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            for v in bm.verts:
                v.co.x -= cx
                v.co.y -= cy
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        ngons = [f for f in bm.faces if len(f.verts) > 4]
        if ngons:
            bmesh.ops.triangulate(bm, faces=ngons, quad_method="BEAUTY", ngon_method="BEAUTY")
        ob = env_common.new_mesh_object(f"SM_Sietch_{name}", bm=bm)
        for m in MATS:
            env_common.add_material_slot(ob, m)
        if bevel > 0:
            mod = ob.modifiers.new("Wear", "BEVEL")
            mod.width = bevel
            mod.segments = 2
            mod.limit_method = "ANGLE"
            mod.angle_limit = math.radians(40)
            try:
                mod.harden_normals = True
            except Exception:  # noqa: BLE001
                pass
            env_common.apply_modifiers(ob)
        _strip_unused_slots(ob)
        env_common.box_uv(ob, 2.0)
        env_common.shade_smooth(ob, 35.0)
        return ob


def _strip_unused_slots(ob):
    """Удаляет неиспользуемые слоты материалов, сохраняя индексы граней."""
    me = ob.data
    used = sorted({p.material_index for p in me.polygons})
    remap = {old: new for new, old in enumerate(used)}
    mats = [me.materials[i] for i in used]
    idx = [remap[p.material_index] for p in me.polygons]
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", idx)


# ================================================================== модули
def arch_poly(x_l, x_r, spring, top, length, segs=16, rise=None):
    """U-образный контур стены с арочным проёмом от пола: [(x, z)]."""
    span = x_r - x_l
    r = span / 2.0
    cx = (x_l + x_r) / 2.0
    rise = r if rise is None else rise
    pts = [(0.0, 0.0), (x_l, 0.0), (x_l, spring)]
    for i in range(1, segs):
        a = math.pi - math.pi * i / segs
        pts.append((cx + r * math.cos(a), spring + rise * math.sin(a)))
    pts += [(x_r, spring), (x_r, 0.0), (length, 0.0), (length, top), (0.0, top)]
    return pts


def m_wall(k, length, h=WALL_H):
    k.box(0, length, -WALL_T / 2, WALL_T / 2, 0, h)
    k.box(0, length, -WALL_T / 2 - 0.05, -WALL_T / 2, 0, 0.3, POLISHED)         # стёртый руками цоколь
    return (length, WALL_T, h)


def m_corner(k):
    k.box(-WALL_T / 2, 4, -WALL_T / 2, WALL_T / 2, 0, WALL_H)
    k.box(-WALL_T / 2, WALL_T / 2, WALL_T / 2, 4, 0, WALL_H)
    return (4.25, 4.25, WALL_H)


def m_tee(k):
    k.box(-2, 2, -WALL_T / 2, WALL_T / 2, 0, WALL_H)
    k.box(-WALL_T / 2, WALL_T / 2, WALL_T / 2, 4, 0, WALL_H)
    return (4, 4.25, WALL_H)


def m_doorway(k):
    k.prism_xz(arch_poly(1.0, 3.0, 2.2, WALL_H, 4.0), -WALL_T / 2, WALL_T / 2)
    k.box(1.0, 3.0, -WALL_T / 2, WALL_T / 2, -0.02, 0.02, POLISHED)            # порог
    return (4, WALL_T, WALL_H)


def m_arch(k, span, height, depth):
    pier = 0.5 if span < 5 else 1.0
    k.prism_xz(arch_poly(pier, pier + span, height - span / 2 - 0.5, height, span + 2 * pier), -depth / 2, depth / 2)
    # замковый камень
    k.box(pier + span / 2 - 0.25, pier + span / 2 + 0.25, -depth / 2 - 0.05, depth / 2 + 0.05, height - 0.6, height - 0.05)
    return (span + 2 * pier, depth, height)


def m_niche_wall(k):
    d = 1.0
    k.box(0, 2, 0.1, d / 2, 0, WALL_H)                                          # задняя часть
    k.box(0, 2, -d / 2, 0.1, 0, 0.5)                                            # подоконник
    front = [(x, z + 0.5) for x, z in arch_poly(0.25, 1.75, 1.1, WALL_H - 0.5, 2.0)]
    k.prism_xz(front, -d / 2, 0.1)                                              # фронт с арочной нишей над подоконником
    k.box(0.25, 1.75, -0.2, 0.1, 0.48, 0.52, POLISHED)                          # стёртая полка ниши
    return (2, d, WALL_H)


def m_sleeping_niche(k):
    w, d, h = 4.0, 2.5, 2.5
    k.box(0, w, d - 0.25, d, 0, h + 0.5)                                         # задняя стена
    k.box(-0.25, 0, 0, d, 0, h + 0.5)
    k.box(w, w + 0.25, 0, d, 0, h + 0.5)
    k.box(-0.25, w + 0.25, 0, d, h, h + 0.5)                                    # потолок
    k.box(0, w, 0.6, d - 0.25, 0, 0.45, POLISHED)                               # каменное ложе
    k.box(0.2, w - 0.2, 0.7, d - 0.35, 0.45, 0.55, CLOTH)                       # подстилка
    k.cyl((w / 2, 0.15, h - 0.15), 0.03, w + 0.2, "X", 8, METAL)                 # штанга занавеси
    return (w + 0.5, d, h + 0.5)


def m_stairs(k, run, rise, width, steps):
    for i in range(steps):
        k.box(run * i / steps, run, -width / 2, width / 2, 0, rise * (i + 1) / steps,
              POLISHED if i % 2 else STONE)
    # боковые щёки
    poly = [(0, 0), (run, 0), (run, rise + 0.3), (run * 0.0, 0.3)]
    k.prism_xz(poly, -width / 2 - 0.25, -width / 2)
    k.prism_xz(poly, width / 2, width / 2 + 0.25)
    return (run, width + 0.5, rise + 0.3)


def m_ramp(k):
    k.prism_xz([(0, 0), (4, 0), (4, 1.0)], -1.0, 1.0, POLISHED)
    k.prism_xz([(0, 0), (4, 0), (4, 1.3), (0, 0.3)], -1.25, -1.0)              # щёки
    k.prism_xz([(0, 0), (4, 0), (4, 1.3), (0, 0.3)], 1.0, 1.25)
    return (4, 2.5, 1.3)


def m_floor(k, size):
    k.box(0, size, 0, size, -0.5, 0.0)
    k.box(0.05, size - 0.05, 0.05, size - 0.05, -0.01, 0.0, POLISHED)
    return (size, size, 0.5)


def m_barrel_ceiling(k):
    """Свод прохода: пролёт 3 м, длина 4 м, полуцилиндрическая оболочка 0.5 м на стенах 0.5 м."""
    k.arc_solid(0, 0, 1.5, 2.0, 0, math.pi, 0, 4, 18)
    return (4, 4, 2)


def m_balcony_rail(k):
    k.box(0, 4, -0.15, 0.15, 0.9, 1.05)                                        # поручень
    k.box(0, 4, -0.2, 0.2, 0.0, 0.15)
    for i in range(9):
        x = 0.25 + i * 0.4375
        k.revolve([(0.07, 0.15), (0.1, 0.3), (0.06, 0.55), (0.09, 0.8), (0.06, 0.9)], 10, STONE, (x, 0, 0))
    k.box(1.6, 2.4, -0.18, 0.18, 0.95, 1.12, POLISHED)                        # отполированное ладонями место
    return (4, 0.4, 1.12)


def m_balcony_slab(k):
    k.box(0, 4, 0, 3, -0.4, 0)
    for x in (0.5, 2.0, 3.5):
        k.prism_xz([(x - 0.25, 0), (x + 0.25, 0), (x + 0.25, -0.4), (x - 0.25, -0.4)], 0, 0.5)
        k.prism_xy([(x - 0.2, 0), (x + 0.2, 0), (x + 0.2, 1.2), (x - 0.2, 0.0)], -1.6, -0.4)  # консоль
    return (4, 3, 2)


def m_column(k, h, carved=False):
    k.box(-0.5, 0.5, -0.5, 0.5, 0, 0.3)
    prof = [(0.42, 0.3), (0.38, 0.5)]
    n = 6 if carved else 2
    for i in range(1, n + 1):
        z = 0.5 + (h - 1.1) * i / n
        prof += [(0.36, z - 0.08), (0.40 if carved else 0.36, z - 0.04), (0.36, z)]
    prof += [(0.45, h - 0.5), (0.55, h - 0.3)]
    k.revolve(prof, 24, STONE)
    k.box(-0.6, 0.6, -0.6, 0.6, h - 0.3, h)
    return (1.2, 1.2, h)


def m_seal_door_frame(k):
    """Рама двери-уплотнителя: проём 2.5 × 3 м, «овальный» верх, две гасящие кромки."""
    k.prism_xz(arch_poly(0.75, 3.25, 2.0, 4.5, 4.0, 18, rise=1.0), -0.5, 0.5, METAL)
    # каменные «губы» по обе стороны рамы (тот же контур, проём чуть шире)
    lips = arch_poly(0.6, 3.4, 2.0, 4.5, 4.0, 18, rise=1.1)
    k.prism_xz(lips, -0.65, -0.5, STONE)
    k.prism_xz(lips, 0.5, 0.65, STONE)
    k.box(0.75, 3.25, -0.5, 0.5, -0.05, 0.05, METAL)                            # порог-уплотнитель
    k.box(0.6, 0.75, -0.6, 0.6, 0, 3.0, METAL)                                  # направляющие панелей
    k.box(3.25, 3.4, -0.6, 0.6, 0, 3.0, METAL)
    return (4, 1.2, 4.5)


def m_seal_door_panel(k):
    """Панель двери-уплотнителя: ЦЕНТРИРОВАНА (так её масштабирует ARakisSealDoor под PanelSize),
    толщина по X (проход по X), ширина по Y, высота по Z; мягкий уплотнитель — на кромке +Y (к центру проёма)."""
    k.box(-0.08, 0.08, -0.625, 0.625, -1.5, 1.5, METAL)
    for z in (-1.1, -0.3, 0.5, 1.2):
        k.box(-0.12, 0.12, -0.575, 0.575, z, z + 0.08, METAL)                    # рёбра
    k.box(-0.1, 0.1, 0.555, 0.625, -1.5, 1.5, CLOTH)                            # уплотнитель
    return (0.24, 1.25, 3.0)


def m_cistern_grate(k):
    k.box(0, 3, -0.1, 0.1, 0, 0.15, METAL)
    k.box(0, 3, -0.1, 0.1, 2.35, 2.5, METAL)
    k.box(0, 0.15, -0.1, 0.1, 0, 2.5, METAL)
    k.box(2.85, 3, -0.1, 0.1, 0, 2.5, METAL)
    for i in range(1, 10):
        x = 3.0 * i / 10
        k.box(x - 0.025, x + 0.025, -0.04, 0.04, 0.15, 2.35, METAL)
    for z in (0.8, 1.6):
        k.box(0.15, 2.85, -0.05, 0.05, z - 0.025, z + 0.025, METAL)
    # мотив «кольца воды» по центру
    k.arc_solid(1.5, 1.25, 0.45, 0.52, 0, math.tau * 0.999, -0.06, 0.06, 32, METAL)
    k.arc_solid(1.5, 1.25, 0.2, 0.26, 0, math.tau * 0.999, -0.06, 0.06, 24, METAL)
    return (3, 0.2, 2.5)


def m_glow_bracket(k):
    k.box(-0.15, 0.15, 0, 0.05, -0.2, 0.2, METAL)                               # пластина на стене (стена — +Y)
    k.obox((0, -0.25, 0.05), (0.04, 0.5, 0.04), pitch=0, roll=-15, mat=METAL)
    k.arc_solid(0, 0.12, 0.15, 0.19, 0, math.tau * 0.999, -0.52, -0.48, 20, METAL)
    k.revolve([(0.18, 0.0), (0.2, 0.03)], 20, METAL, (0, -0.5, 0.1))
    return (0.4, 0.6, 0.5)


def m_glowglobe(k):
    k.sphere((0, 0, 0), 0.175, GLOW, 3)
    return (0.35, 0.35, 0.35)


def m_stall_counter(k):
    k.box(0, 2.5, 0, 0.8, 0, 0.95, STONE)
    k.box(-0.05, 2.55, -0.1, 0.85, 0.95, 1.05, POLISHED)
    for x, y in ((0.05, 0.05), (2.45, 0.05), (0.05, 0.75), (2.45, 0.75)):
        k.cyl((x, y, 1.6), 0.035, 1.1, "Z", 8, FIBER)
    k.box(0, 2.5, -0.3, 1.0, 2.15, 2.18, CLOTH)                                 # навес
    k.box(0.1, 2.4, 0.82, 0.88, 0.1, 0.85, FIBER)                               # передняя циновка
    return (2.5, 1.0, 2.2)


def m_loom(k):
    for x in (0.0, 2.0):
        k.box(x - 0.06, x + 0.06, -0.06, 0.06, 0, 2.2, FIBER)
        k.box(x - 0.06, x + 0.06, -0.5, 0.5, 0, 0.1, FIBER)
    k.cyl((1.0, 0, 2.05), 0.06, 2.1, "X", 12, FIBER)
    k.cyl((1.0, 0, 0.35), 0.07, 2.1, "X", 12, FIBER)
    k.cyl((1.0, -0.1, 1.2), 0.03, 2.0, "X", 8, FIBER)                           # ремизка
    for i in range(36):
        x = 0.15 + 1.7 * i / 35
        k.box(x - 0.004, x + 0.004, -0.004, 0.004, 0.42, 2.0, CLOTH)            # основа
    k.box(0.15, 1.85, -0.02, 0.02, 0.42, 0.9, CLOTH)                            # уже сотканное полотно
    return (2.12, 1.0, 2.2)


def m_water_jar(k, tall=False):
    s = 1.5 if tall else 1.0
    prof = [(0.12, 0), (0.2, 0.05 * s), (0.28, 0.3 * s), (0.27, 0.5 * s), (0.18, 0.68 * s),
            (0.1, 0.74 * s), (0.11, 0.8 * s), (0.09, 0.8 * s), (0.08, 0.7 * s)]
    k.revolve(prof, 28, CLAY)
    k.revolve([(0.085, 0.7 * s), (0.0, 0.7 * s)], 20, WATER, cap=False)
    return (0.56, 0.56, 0.8 * s)


def m_prayer_mat(k):
    k.box(-0.4, 0.4, -0.8, 0.8, 0, 0.015, CLOTH)
    k.box(-0.4, 0.4, 0.8, 0.85, 0, 0.01, CLOTH)                                 # бахрома
    return (0.8, 1.7, 0.02)


def m_curtain_rod(k):
    k.cyl((1.0, 0, 0), 0.025, 2.0, "X", 10, METAL)
    for x in (0.05, 1.95):
        k.box(x - 0.03, x + 0.03, 0, 0.15, -0.05, 0.05, METAL)
    for i in range(10):
        k.arc_solid(0.1 + i * 0.2, 0, 0.035, 0.05, 0.0, math.tau * 0.999, -0.01, 0.01, 10, METAL)  # кольца
    return (2.0, 0.15, 0.1)


def m_carved_panel(k):
    """Резная панель 2×2 м: фрименский мотив колец червя + спираль; декали слоёв — в UE."""
    def relief(u, v):
        x, z = (u - 0.5) * 2, (v - 0.5) * 2
        r = math.hypot(x, z)
        rings = 0.02 * max(0.0, math.cos(r * 18.0)) * (1.0 if r < 0.85 else 0.0)
        spiral = 0.015 * max(0.0, math.cos(r * 10.0 - math.atan2(z, x) * 3)) * (1.0 if r < 0.4 else 0.0)
        border = 0.03 if (u < 0.06 or u > 0.94 or v < 0.06 or v > 0.94) else 0.0
        return rings + spiral + border
    k.heightfield(0, 2, 0, 2, 0, relief, 80, 80, STONE)
    return (2, 0.2, 2)


def m_vault_rib(k):
    """Ребро свода «глотки червя»: сектор 45° арки R=17.5 м, сечение 0.6×0.9 с валиками."""
    r = 17.5
    k.arc_solid(0, 0, r - 0.9, r, 0, math.pi / 4, -0.3, 0.3, 24, STONE)
    k.arc_solid(0, 0, r - 1.05, r - 0.9, 0, math.pi / 4, -0.12, 0.12, 24, POLISHED)  # внутренний валик
    for i in range(1, 6):                                                        # «хрящевые» кольца
        a = math.pi / 4 * i / 6
        k.obox((math.cos(a) * (r - 0.5), 0, math.sin(a) * (r - 0.5)), (0.2, 0.75, 1.1), pitch=-math.degrees(a), mat=STONE)
    return (r, 0.75, r * math.sin(math.pi / 4))


def m_vault_spine(k):
    k.box(0, 2.5, -0.35, 0.35, -0.5, 0)
    k.revolve([(0.0, -0.75), (0.25, -0.7), (0.3, -0.5)], 12, POLISHED, (1.25, 0, 0), cap=False)
    return (2.5, 0.7, 0.75)


def m_light_shaft_ring(k):
    k.revolve([(2.0, 0), (3.0, 0), (3.0, 0.4), (2.6, 0.6), (2.6, 1.0), (2.0, 1.0)][::1], 48, STONE, cap=False)
    k.revolve([(2.0, 1.0), (2.0, 0.0)], 48, POLISHED, cap=False)
    return (6, 6, 1)


def m_sand_bowl_rim(k):
    """Сегмент 45° бортика песчаной чаши: внутренний R 7 м, внешний 8 м, высота 0.5 м."""
    segs = 12
    pts_o = [(8.0 * math.cos(math.pi / 4 * i / segs), 8.0 * math.sin(math.pi / 4 * i / segs)) for i in range(segs + 1)]
    pts_i = [(7.0 * math.cos(math.pi / 4 * i / segs), 7.0 * math.sin(math.pi / 4 * i / segs)) for i in reversed(range(segs + 1))]
    k.prism_xy(pts_o + pts_i, 0, 0.5, STONE)
    pts_o2 = [(7.6 * math.cos(math.pi / 4 * i / segs), 7.6 * math.sin(math.pi / 4 * i / segs)) for i in range(segs + 1)]
    k.prism_xy(pts_o2 + pts_i, 0.5, 0.55, POLISHED)
    return (8.0, 5.7, 0.55)


def m_cistern_edge(k):
    k.box(0, 4, -0.4, 0.4, 0, 0.6)
    k.cyl((2.0, 0, 0.6), 0.4, 4.0, "X", 16, POLISHED)
    return (4, 0.8, 1.0)


def m_light_well(k):
    k.revolve([(0.75, 0), (1.0, 0), (1.0, 4.0), (0.75, 4.0), (0.75, 0)], 32, STONE, cap=False)
    return (2, 2, 4)


def m_curtain(k):
    """Занавесь 2 × 2.4 м со складками (полотно 2 см)."""
    def fold(u, v):
        return 0.08 * math.sin(u * math.pi * 11) * (0.6 + 0.4 * v) + 0.02 * math.sin(v * 7)
    k.heightfield(0, 2, -2.4, 0, 0, fold, 44, 16, CLOTH, back=0.02)
    return (2, 0.2, 2.4)


def m_carpet(k):
    k.box(0, 2, 0, 3, 0, 0.02, CLOTH)
    k.box(0, 2, -0.05, 0, 0, 0.01, CLOTH)
    k.box(0, 2, 3, 3.05, 0, 0.01, CLOTH)
    return (2, 3.1, 0.02)


def m_bench(k):
    k.box(0, 2, -0.25, 0.25, 0.35, 0.45, POLISHED)
    for x in (0.2, 1.8):
        k.box(x - 0.15, x + 0.15, -0.2, 0.2, 0, 0.35)
    return (2, 0.5, 0.45)


def m_maker_hooks(k):
    k.cyl((0, 0, 1.2), 0.035, 2.4, "Z", 10, FIBER)
    k.arc_solid(0.18, 2.35, 0.14, 0.2, math.pi * 0.0, math.pi * 1.2, -0.03, 0.03, 12, METAL)
    k.cyl((0, 0, 2.3), 0.05, 0.25, "Z", 10, METAL)
    for z in (0.9, 1.0, 1.1):
        k.cyl((0, 0, z), 0.045, 0.05, "Z", 10, CLOTH)                           # обмотка
    return (0.45, 0.1, 2.55)


def m_hook_rack(k):
    k.box(0, 3, -0.1, 0.1, 0, 0.15, FIBER)
    k.box(0, 3, -0.1, 0.1, 1.6, 1.75, FIBER)
    for x in (0.1, 2.9):
        k.box(x - 0.08, x + 0.08, -0.25, 0.25, 0, 1.8, FIBER)
    return (3, 0.5, 1.8)


def m_thumper(k):
    k.cyl((0, 0, 0.6), 0.06, 1.2, "Z", 12, METAL, r2=0.02)                      # штырь (низ в песок)
    k.cyl((0, 0, 1.35), 0.11, 0.35, "Z", 16, METAL)                             # корпус
    k.cyl((0, 0, 1.6), 0.13, 0.12, "Z", 16, METAL)                              # боёк
    k.box(-0.02, 0.02, -0.25, 0.25, 1.48, 1.52, METAL)                          # рукоять взвода
    return (0.5, 0.5, 1.66)


def m_stillsuit_bench(k):
    k.box(0, 2, 0, 0.9, 0, 0.85, STONE)
    k.box(-0.05, 2.05, -0.05, 0.95, 0.85, 0.92, POLISHED)
    k.box(0.1, 1.9, 0.85, 0.9, 0.92, 1.6, FIBER)                                # задняя доска с инструментом
    for i in range(6):
        k.cyl((0.3 + i * 0.28, 0.8, 1.35), 0.012, 0.2, "Y", 6, METAL)           # крючки
    k.revolve([(0.15, 0), (0.18, 0.15), (0.12, 0.2)], 16, CLAY, (1.7, 0.4, 0.92))  # чаша с конденсатом
    return (2.1, 1.0, 1.6)


def m_water_rings(k):
    """Связка водяных колец (меры воды) на шнуре."""
    for i in range(5):
        r = 0.04 + 0.012 * i
        k.arc_solid(0, -0.1 * i - 0.1, r - 0.008, r, 0, math.tau * 0.999, -0.006, 0.006, 16, METAL)
    k.box(-0.005, 0.005, -0.006, 0.006, -0.6, 0.0, FIBER)
    return (0.2, 0.02, 0.6)


# пропы с pivot в центре основания (остальные — по правилу стен/лестниц: от края на сетке)
CENTERED = {"Stall_Counter", "Loom_Frame", "Bench_2m", "MakerHooks_Rack", "StillsuitBench", "Carpet_2x3",
            }

MODULES = {
    # name: (builder, описание)
    "Wall_2m": (lambda k: m_wall(k, 2.0), "стена 2 м"),
    "Wall_4m": (lambda k: m_wall(k, 4.0), "стена 4 м"),
    "Wall_8m": (lambda k: m_wall(k, 8.0), "стена 8 м"),
    "Wall_Corner_4m": (m_corner, "угол L 4+4 м"),
    "Wall_T_4m": (m_tee, "Т-стык"),
    "Wall_Doorway_4m": (m_doorway, "стена 4 м с арочным проходом 2×2.2 м"),
    "Arch_4m": (lambda k: m_arch(k, 3.0, 4.0, 1.0), "арка пролёт 3 м"),
    "Arch_8m": (lambda k: m_arch(k, 6.0, 6.0, 1.5), "большая арка пролёт 6 м"),
    "Niche_Wall_2m": (m_niche_wall, "стена с нишей-полкой"),
    "SleepingNiche_4m": (m_sleeping_niche, "жилая ниша за занавесью"),
    "Stairs_4m": (lambda k: m_stairs(k, 4.0, 2.0, 2.0, 10), "лестница 4 м, подъём 2 м"),
    "Stairs_Wide_8m": (lambda k: m_stairs(k, 8.0, 4.0, 4.0, 20), "парадная лестница 8 м, подъём 4 м"),
    "Ramp_4m": (m_ramp, "пандус 4 м, подъём 1 м"),
    "Floor_2m": (lambda k: m_floor(k, 2.0), "плита пола 2×2"),
    "Floor_4m": (lambda k: m_floor(k, 4.0), "плита пола 4×4"),
    "Ceiling_Barrel_4m": (m_barrel_ceiling, "цилиндрический свод прохода"),
    "Balcony_Rail_4m": (m_balcony_rail, "балюстрада балкона"),
    "Balcony_Slab_4m": (m_balcony_slab, "плита балкона на консолях"),
    "Column_4m": (lambda k: m_column(k, 4.0), "колонна 4 м"),
    "Column_Carved_6m": (lambda k: m_column(k, 6.0, True), "резная колонна 6 м"),
    "SealDoor_Frame": (m_seal_door_frame, "рама двери-уплотнителя"),
    "SealDoor_Panel": (m_seal_door_panel, "панель двери-уплотнителя (×2)"),
    "Cistern_Grate": (m_cistern_grate, "решётка цистерны"),
    "Cistern_Edge_4m": (m_cistern_edge, "бортик бассейна цистерны"),
    "Glowglobe_Bracket": (m_glow_bracket, "кронштейн светошара"),
    "Glowglobe": (m_glowglobe, "светошар Ø35 см"),
    "Stall_Counter": (m_stall_counter, "прилавок с навесом"),
    "Loom_Frame": (m_loom, "ткацкий станок"),
    "WaterJar_A": (lambda k: m_water_jar(k, False), "кувшин 0.8 м"),
    "WaterJar_B": (lambda k: m_water_jar(k, True), "кувшин 1.2 м"),
    "PrayerMat": (m_prayer_mat, "молитвенный коврик"),
    "Carpet_2x3": (m_carpet, "ковёр 2×3"),
    "Curtain_2m": (m_curtain, "занавесь 2×2.4"),
    "CurtainRod_2m": (m_curtain_rod, "штанга занавеси"),
    "Carved_Panel_2m": (m_carved_panel, "резная панель (3 слоя истории — декали)"),
    "VaultRib_45": (m_vault_rib, "ребро свода зала, сектор 45°"),
    "VaultRib_Spine": (m_vault_spine, "коньковый «хребет» свода"),
    "LightShaft_Ring": (m_light_shaft_ring, "кольцо световой шахты"),
    "LightWell_Tube": (m_light_well, "световой колодец галереи"),
    "SandBowl_Rim_45": (m_sand_bowl_rim, "бортик песчаной чаши, сектор 45°"),
    "Bench_2m": (m_bench, "каменная скамья"),
    "MakerHooks": (m_maker_hooks, "крючья творца"),
    "MakerHooks_Rack": (m_hook_rack, "стойка для крючьев/тамперов"),
    "Thumper_Prop": (m_thumper, "тампер (декор)"),
    "StillsuitBench": (m_stillsuit_bench, "верстак починки дистикомбов"),
    "WaterRings": (m_water_rings, "водяные кольца"),
}


def main():
    import bpy
    ap = argparse.ArgumentParser(description="Sietch modular kit")
    ap.add_argument("--out", default="Export/sietch")
    ap.add_argument("--only", default="", help="через запятую: имена модулей")
    ap.add_argument("--bevel", type=float, default=0.04, help="фаска износа, м (0 — без)")
    env_common.fbx_axis_args(ap)
    args = env_common.parse_args(ap)
    env_common.reset_scene()
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    manifest = []
    for name, (builder, desc) in MODULES.items():
        if only and name not in only:
            continue
        k = Kit()
        try:
            size = builder(k)
            no_bevel = ("Glowglobe", "Curtain_2m", "Carved_Panel_2m", "WaterRings", "PrayerMat", "Carpet_2x3")
            bev = 0.0 if name in no_bevel else args.bevel                 # тонкие пропы — без фаски
            ob = k.finish(name, bev, center=name in CENTERED)
        except Exception as e:  # noqa: BLE001
            print(f"[Rakis] WARN модуль {name}: {e}")
            continue
        path = os.path.join(args.out, f"SM_Sietch_{name}.fbx")
        env_common.export_fbx(path, [ob], args.axis_forward, args.axis_up)
        manifest.append({"name": f"SM_Sietch_{name}", "desc": desc, "size_m": [round(s, 3) for s in size],
                         "tris": env_common.triangle_count(ob),
                         "slots": [m.name for m in ob.data.materials]})
        bpy.data.objects.remove(ob, do_unlink=True)
    with open(env_common.out_path(os.path.join(args.out, "kit_manifest.json")), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"[Rakis] кит: {len(manifest)} модулей → {args.out}")


if __name__ == "__main__":
    main()
