"""
env_worm.py — меши червя Шай-Хулуда (T-010, по контракту §2.5: 40 м в диаметре, 90 колец × 4 м = 360 м).

Запуск:
    blender -b -P Tools/blender/env_worm.py -- --out Export [--detail 1.0]

Результат (все — Z вверх, X вперёд, метры → см при импорте):
    Export/SM_Worm_Segment.fbx    — кольцо 4 м × Ø40 м; pivot в начале сегмента (x=0, задняя кромка), X вперёд.
                                    Кольцо = «мягкая» трубка с поперечными валиками + 36 перекрывающихся
                                    хитиновых пластин (черепица, задний «козырёк» 0.4 м налегает на соседнее кольцо),
                                    продольные борозды между пластинами, тонкие гребни на пластинах.
    Export/SM_Worm_Head.fbx       — голова 10 м: переход к краю пасти (Ø36 м), губа, глотка внутрь (Ø28→20 м).
                                    pivot — x=0 (стык с первым кольцом).
    Export/SM_Worm_MouthPetal.fbx — ОДИН лепесток (треть «конуса» пасти, 120°). pivot — на шарнире у края пасти,
                                    локальная ось Y — ось вращения (раскрытие = pitch вокруг Y).
                                    Размещение 3 копий: в системе головы позиция (10 м, 0, 18 м) повёрнутая
                                    roll = 0°/120°/240° вокруг X; раскрытие ≈ −100° (наружу).
    Export/SM_Worm_Teeth.fbx      — 5 колец кристаллических зубов в глотке (кромки назад, «в горло»),
                                    pivot совпадает с головой (ставится с тем же трансформом).
Слоты: MI_Worm_Chitin (пластины, лепестки снаружи), MI_Worm_Flesh (трубка, складки, внутренняя сторона лепестков),
MI_Worm_Throat (глотка), MI_Worm_Teeth (зубы) — env_import.py назначает MI с фолбэком на MI_Worm_Chitin.
Бюджет (detail 1.0): сегмент ≈ 35–40 тыс. тр., голова ≈ 60 тыс., лепесток ≈ 10 тыс., зубы ≈ 15 тыс.
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "Tools", "blender"))
import env_common  # noqa: E402

RADIUS = 20.0            # м (Ø40 по контракту)
SEG_LEN = 4.0
PLATES = 36
HEAD_LEN = 10.0
RIM_R = 18.0
THROAT_R0 = 14.0         # у края
THROAT_R1 = 10.0         # в глубине
PETAL_LEN = 15.0         # от шарнира до острия (в закрытом виде)


def grid(bm, fn, nu, nv, closed_u=False, closed_v=False, mat=0, flip=False):
    """Поверхность из функции fn(u, v) → (x, y, z); u,v ∈ [0,1]. Возвращает матрицу вершин."""
    cols = nu if closed_u else nu + 1
    rows = nv if closed_v else nv + 1
    vs = [[bm.verts.new(fn(i / nu, j / nv)) for j in range(rows)] for i in range(cols)]
    for i in range(nu):
        i2 = (i + 1) % cols
        for j in range(nv):
            j2 = (j + 1) % rows
            q = (vs[i][j], vs[i2][j], vs[i2][j2], vs[i][j2])
            f = bm.faces.new(tuple(reversed(q)) if flip else q)
            f.material_index = mat
    return vs


def bridge(bm, row_a, row_b, mat=0, flip=False):
    for k in range(len(row_a) - 1):
        q = (row_a[k], row_a[k + 1], row_b[k + 1], row_b[k])
        f = bm.faces.new(tuple(reversed(q)) if flip else q)
        f.material_index = mat


def polar(x, r, th):
    """Точка на окружности вокруг оси X: θ от +Y к +Z."""
    return (x, r * math.cos(th), r * math.sin(th))


# ------------------------------------------------------------------ сегмент
def build_segment(detail, seed):
    import bmesh
    from mathutils import Vector, noise
    rnd = random.Random(seed)
    bm = bmesh.new()
    nth = int(288 * detail)
    nx = max(8, int(28 * detail))

    # 1) мягкая трубка (между пластинами видна в бороздах): валики и складки
    def tube(u, v):
        th = u * math.tau
        x = v * SEG_LEN
        r = RADIUS - 0.35
        r -= 0.45 * math.exp(-((x - 3.8) / 0.25) ** 2)                 # поджатие под козырёк переднего кольца
        r += 0.05 * math.sin(x / SEG_LEN * math.tau * 9.0)             # тонкие поперечные валики
        r += 0.08 * noise.noise(Vector((math.cos(th) * 6, math.sin(th) * 6, x * 1.3)))
        return polar(x, r, th)
    grid(bm, tube, nth, nx, closed_u=True, mat=1)

    # 2) пластины-черепица
    span = math.tau / PLATES
    pu = max(6, int(14 * detail))
    pv = max(6, int(12 * detail))
    for p in range(PLATES):
        th0 = p * span - span * 0.14
        th1 = (p + 1) * span + span * 0.14              # перекрытие ~28%
        lift = 0.05 * (p % 2)                           # чередование высоты — без z-fighting
        jitter = rnd.uniform(-0.06, 0.06)
        x0, x1 = -0.4, SEG_LEN - 0.25                   # задний козырёк налегает на соседнее кольцо

        def outer(u, v, th0=th0, th1=th1, lift=lift, jitter=jitter):
            th = th0 + (th1 - th0) * u
            x = x0 + (x1 - x0) * v
            edge_u = math.sin(math.pi * u) ** 0.35          # скругление боковых кромок
            r = RADIUS + 0.10 + lift + jitter
            r += 0.28 * edge_u
            r += 0.22 * (1.0 - v) ** 2                      # задний край приподнят (черепица)
            r += 0.025 * math.sin(u * math.pi * 22.0)       # тонкие продольные гребни
            r -= 0.12 * math.exp(-((u - 0.5) / 0.05) ** 2)  # центральный желобок пластины
            r += 0.10 * noise.noise(Vector((th * 9.0 + p, x * 0.9, 1.7)))  # износ
            return polar(x, r, th)

        def inner(u, v, th0=th0, th1=th1, lift=lift, jitter=jitter):
            th = th0 + (th1 - th0) * u
            x = x0 + (x1 - x0) * v
            return polar(x, RADIUS - 0.05 + lift + jitter + 0.2 * (1.0 - v) ** 2, th)

        o = grid(bm, outer, pu, pv, mat=0)
        i = grid(bm, inner, pu, pv, mat=0, flip=True)
        # кромки (толщина пластины)
        bridge(bm, [o[k][0] for k in range(pu + 1)], [i[k][0] for k in range(pu + 1)], 0, flip=True)
        bridge(bm, [o[k][pv] for k in range(pu + 1)], [i[k][pv] for k in range(pu + 1)], 0)
        bridge(bm, [o[0][k] for k in range(pv + 1)], [i[0][k] for k in range(pv + 1)], 0)
        bridge(bm, [o[pu][k] for k in range(pv + 1)], [i[pu][k] for k in range(pv + 1)], 0, flip=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = env_common.new_mesh_object("SM_Worm_Segment", bm=bm)
    env_common.add_material_slot(ob, "MI_Worm_Chitin")
    env_common.add_material_slot(ob, "MI_Worm_Flesh")
    return ob


# ------------------------------------------------------------------ голова
def head_outer_r(x):
    """Внешний радиус головы: 20 м у стыка → 18 м у губы, с лёгким «воротником»."""
    k = x / HEAD_LEN
    return RADIUS + (RIM_R - RADIUS) * k ** 1.5 + 0.6 * math.sin(math.pi * k)


def throat_r(x):
    k = x / HEAD_LEN
    return THROAT_R1 + (THROAT_R0 - THROAT_R1) * k ** 0.7


def build_head(detail, seed):
    import bmesh
    from mathutils import Vector, noise
    bm = bmesh.new()
    nth = int(320 * detail)
    nx = max(12, int(40 * detail))

    def fade_end(v, a=0.9):
        k = min(1.0, max(0.0, (1.0 - v) / (1.0 - a)))
        return k * k * (3 - 2 * k)                                       # 1 → 0 к стыку с губой

    def outer(u, v):
        th = u * math.tau
        x = v * HEAD_LEN
        r = head_outer_r(x)
        fe = fade_end(v)
        r += 0.18 * math.cos(x * 1.9) * fe                              # кольцевые складки
        r += 0.12 * noise.noise(Vector((math.cos(th) * 5, math.sin(th) * 5, x * 0.6))) * fe
        # три «шва» между лепестками (выраженные борозды на 90°, 210°, 330° — между шарнирами)
        for k in range(3):
            d = math.atan2(math.sin(th - (math.pi / 2 + math.pi / 3 + k * math.tau / 3)),
                           math.cos(th - (math.pi / 2 + math.pi / 3 + k * math.tau / 3)))
            r -= 0.6 * math.exp(-(d / 0.05) ** 2) * (x / HEAD_LEN) * fe
        return polar(x, r, th)

    def lip(u, v):
        th = u * math.tau
        a = v * math.pi                                                  # полукруг губы
        rr = head_outer_r(HEAD_LEN)
        r = (rr + THROAT_R0) * 0.5 + (rr - THROAT_R0) * 0.5 * math.cos(a)
        x = HEAD_LEN + 1.2 * math.sin(a)
        r += 0.15 * noise.noise(Vector((math.cos(th) * 8, math.sin(th) * 8, 3.3))) * math.sin(a)
        return polar(x, r, th)

    def throat(u, v):
        th = u * math.tau
        x = HEAD_LEN * (1.0 - v)
        fs = min(1.0, v / 0.08)                                          # у губы — без складок (шов)
        r = throat_r(x) - 0.25 * abs(math.sin(x * 2.2)) * fs             # мышечные кольца
        r -= 0.2 * (0.5 + 0.5 * math.sin(th * 24)) * fs                  # продольные складки
        return polar(x, r, th)

    o = grid(bm, outer, nth, nx, closed_u=True, mat=0)
    li = grid(bm, lip, nth, max(6, int(10 * detail)), closed_u=True, mat=1)
    t = grid(bm, throat, nth, nx, closed_u=True, mat=2)
    # глухое дно глотки (вогнутый «зев») и задний торец
    c_in = bm.verts.new((0.8, 0.0, 0.0))
    last = [t[i][nx] for i in range(nth)]
    for i in range(nth):
        f = bm.faces.new((last[i], last[(i + 1) % nth], c_in))
        f.material_index = 2
    for i in range(nth):                                                  # кольцо-торец снаружи→внутрь (стык)
        q = (o[i][0], o[(i + 1) % nth][0], last[(i + 1) % nth], last[i])
        f = bm.faces.new(tuple(reversed(q)))
        f.material_index = 1
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.01)          # сварка швов корпус/губа/глотка
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = env_common.new_mesh_object("SM_Worm_Head", bm=bm)
    for n in ("MI_Worm_Chitin", "MI_Worm_Flesh", "MI_Worm_Throat"):
        env_common.add_material_slot(ob, n)
    return ob


# ------------------------------------------------------------------ лепесток пасти
def build_petal(detail, seed):
    """Треть конуса: θ ∈ [30°, 150°] (центр — +Z), от губы (r=RIM_R) к острию. Pivot — шарнир (x=0, z=RIM_R)."""
    import bmesh
    from mathutils import Vector, noise
    bm = bmesh.new()
    nu = max(10, int(36 * detail))
    nv = max(10, int(30 * detail))
    th0, th1 = math.radians(30.0), math.radians(150.0)
    thick = 0.7
    rim = head_outer_r(HEAD_LEN) - 0.4

    def surf(u, v, inner=False):
        th = th0 + (th1 - th0) * u
        s = v
        # закрытая форма — выпуклый «бутон»: радиус спадает к острию по дуге
        r = rim * (1.0 - s ** 1.25) * (1.0 + 0.10 * math.sin(math.pi * s))
        x = PETAL_LEN * s
        edge = math.sin(math.pi * u) ** 0.5
        r *= 0.985 + 0.015 * edge
        if inner:
            r -= thick * (1.0 - 0.7 * s)
        else:
            r += 0.06 * math.sin(u * math.pi * 30.0) * (1.0 - s)                 # продольные гребни
            r += 0.15 * noise.noise(Vector((u * 6.0, s * 6.0, seed * 0.37)))
        # зубчатая кромка (сходящиеся рёбра)
        if u < 0.04 or u > 0.96:
            r -= 0.25 * (0.5 + 0.5 * math.sin(s * 40.0))
        px, py, pz = polar(x, r, th)
        return (px, py, pz - rim)            # pivot — точка шарнира на губе (θ=90°)

    o = grid(bm, lambda u, v: surf(u, v), nu, nv, mat=0)
    i = grid(bm, lambda u, v: surf(u, v, True), nu, nv, mat=1, flip=True)
    bridge(bm, [o[k][0] for k in range(nu + 1)], [i[k][0] for k in range(nu + 1)], 1, flip=True)
    bridge(bm, [o[0][k] for k in range(nv + 1)], [i[0][k] for k in range(nv + 1)], 1)
    bridge(bm, [o[nu][k] for k in range(nv + 1)], [i[nu][k] for k in range(nv + 1)], 1, flip=True)
    # кончик (v=1) сходится в точку — грани вырождены, сварим вершины
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.02)
    # ряды мелких зубов на внутренней стороне лепестка
    rnd = random.Random(seed)
    for row in range(3):
        s = 0.18 + row * 0.2
        for k in range(14):
            u = (k + 0.5) / 14
            base = Vector(surf(u, s, True))
            inward = Vector((0.0, -base.y, -(base.z + rim))).normalized()
            _crystal(bm, base, (inward + Vector((-0.4, 0, 0))).normalized(), rnd.uniform(0.5, 0.9), 0.12, mat=2)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = env_common.new_mesh_object("SM_Worm_MouthPetal", bm=bm)
    for n in ("MI_Worm_Chitin", "MI_Worm_Flesh", "MI_Worm_Teeth"):
        env_common.add_material_slot(ob, n)
    return ob


# ------------------------------------------------------------------ зубы
def _crystal(bm, base, direction, length, radius, mat=0, sides=6):
    """Кристалл: шестигранная призма + пирамида; основание в `base`, ось — `direction`."""
    from mathutils import Vector
    d = Vector(direction).normalized()
    a = d.orthogonal().normalized()
    b = d.cross(a)
    ring0, ring1 = [], []
    for k in range(sides):
        ang = math.tau * k / sides
        off = a * math.cos(ang) + b * math.sin(ang)
        ring0.append(bm.verts.new(base + off * radius * 1.15 - d * 0.2))
        ring1.append(bm.verts.new(base + off * radius + d * length * 0.6))
    tip = bm.verts.new(base + d * length)
    faces = []
    for k in range(sides):
        k2 = (k + 1) % sides
        faces.append(bm.faces.new((ring0[k], ring0[k2], ring1[k2], ring1[k])))
        faces.append(bm.faces.new((ring1[k], ring1[k2], tip)))
    faces.append(bm.faces.new(tuple(reversed(ring0))))
    for f in faces:
        f.material_index = mat
    return faces


def build_teeth(detail, seed):
    import bmesh
    from mathutils import Vector
    rnd = random.Random(seed)
    bm = bmesh.new()
    rings = [(HEAD_LEN - 0.8, 64, 2.6), (HEAD_LEN - 2.6, 60, 2.2), (HEAD_LEN - 4.4, 56, 1.8),
             (HEAD_LEN - 6.2, 52, 1.5), (HEAD_LEN - 8.0, 48, 1.2)]
    for x, count, ln in rings:
        count = max(12, int(count * min(1.5, detail)))
        r = throat_r(x) - 0.35
        phase = rnd.uniform(0, math.tau)
        for k in range(count):
            th = phase + math.tau * k / count + rnd.uniform(-0.02, 0.02)
            base = Vector(polar(x, r, th))
            inward = Vector((0.0, -math.cos(th), -math.sin(th)))
            direction = (inward + Vector((-0.75, 0.0, 0.0))).normalized()     # кромкой назад, «в горло»
            L = ln * rnd.uniform(0.75, 1.25)
            _crystal(bm, base, direction, L, L * 0.14)
            if rnd.random() < 0.35:                                          # дочерний кристалл
                _crystal(bm, base + Vector((0.2, 0, 0)), (direction + Vector((0, rnd.uniform(-.3, .3), rnd.uniform(-.3, .3)))).normalized(), L * 0.5, L * 0.08)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = env_common.new_mesh_object("SM_Worm_Teeth", bm=bm)
    env_common.add_material_slot(ob, "MI_Worm_Teeth")
    return ob


def main():
    ap = argparse.ArgumentParser(description="Worm meshes")
    ap.add_argument("--out", default="Export", help="папка экспорта")
    ap.add_argument("--detail", type=float, default=1.0, help="множитель плотности (0.5 превью … 2.0 герой)")
    ap.add_argument("--seed", type=int, default=7)
    env_common.fbx_axis_args(ap)
    args = env_common.parse_args(ap)
    env_common.reset_scene()
    out = args.out
    seg = build_segment(args.detail, args.seed)
    env_common.shade_smooth(seg, 35.0)
    env_common.export_fbx(os.path.join(out, "SM_Worm_Segment.fbx"), [seg], args.axis_forward, args.axis_up)
    head = build_head(args.detail, args.seed)
    env_common.shade_smooth(head, 35.0)
    env_common.export_fbx(os.path.join(out, "SM_Worm_Head.fbx"), [head], args.axis_forward, args.axis_up)
    petal = build_petal(args.detail, args.seed)
    env_common.shade_smooth(petal, 35.0)
    env_common.export_fbx(os.path.join(out, "SM_Worm_MouthPetal.fbx"), [petal], args.axis_forward, args.axis_up)
    teeth = build_teeth(args.detail, args.seed)
    env_common.export_fbx(os.path.join(out, "SM_Worm_Teeth.fbx"), [teeth], args.axis_forward, args.axis_up)


if __name__ == "__main__":
    main()
