"""
env_rock.py — процедурная скала-доминанта «Коготь Шайтана» (T-010).

Запуск:
    blender -b -P Tools/blender/env_rock.py -- --out Export/SM_Rock_ShaitanClaw.fbx [--preset default|preview|hero]

Результат:
    Export/SM_Rock_ShaitanClaw.fbx  — один меш, pivot = центр основания (UE (150000, 60000, 0)), Nanite-источник
    Export/SM_Rock_FalseRock.fbx    — плита «фальшивого камня» входа A4 (pivot — центр низа, X — от сиетча наружу)

Форма (единые числа — Tools/unreal_python/level_layout.py, см. docs/level/layout.md):
  * изогнутая меса 1 км (ось почти по Y UE), вогнутостью к игроку; северный «коготь» до 290 м,
    наклонён на запад (нависает), южный «кулак» 250 м, седло 200 м;
  * профиль сечения: осыпь → ветровой подрез (навес 3–8 м на высоте 10–30 м) → стена с «завалом» →
    скруглённая бровка → почти плоская шапка;
  * страты (слои 3–9 м, твёрдые выступают), горизонтальные ветровые желобки, вертикальные трещины (voronoi);
  * расщелина A4 (6 м по низу, 3 м по верху, зигзаг) до фальшивого камня; вырез под шлюз B1; световая
    шахта над залом B5 (Ø 4 м);
  * валуны осыпи (часть того же меша).
Бюджет: preview ≈ 0.2 млн, default ≈ 2.2 млн, hero ≈ 12–16 млн треугольников (Nanite: 5–20 млн).
Слоты материалов: MI_Rock_Claw (стены/шапка), MI_Rock_Talus (осыпь, валуны) → env_import.py.
"""
from __future__ import annotations

import argparse
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.path.join(os.getcwd(), "Tools", "blender"))
import env_common  # noqa: E402

L = env_common.layout()

PRESETS = {
    #           nt, nring_side, subdiv, boulders
    "preview": (220, 28, 1, 60),
    "default": (480, 44, 2, 160),
    "hero": (640, 60, 3, 320),
}
SKIRT_M = -12.0          # юбка под землю (ландшафт у основания ±6 м)


# ------------------------------------------------------------------ координаты
def ue_to_local(x_cm, y_cm, z_cm=0.0):
    """Мир UE (см) → локальные метры Blender (pivot скалы, Y перевёрнут)."""
    return ((x_cm - L.ROCK_PIVOT[0]) / 100.0, -(y_cm - L.ROCK_PIVOT[1]) / 100.0, z_cm / 100.0)


def local_to_ue(x, y, z):
    return (x * 100.0 + L.ROCK_PIVOT[0], -y * 100.0 + L.ROCK_PIVOT[1], z * 100.0)


def frame(t):
    """Центр (локально, м), касательная и «западная» нормаль в плоскости XY Blender."""
    eps = 1e-3
    ax, ay = L.claw_center(max(-1.0, t - eps))
    bx, by = L.claw_center(min(1.0, t + eps))
    cx, cy = L.claw_center(t)
    tx, ty = bx - ax, by - ay
    ln = math.hypot(tx, ty) or 1.0
    tx, ty = tx / ln, ty / ln
    nx, ny = -ty, tx                      # UE: запад для оси, идущей на юг
    c = ue_to_local(cx, cy)
    return (c[0], c[1]), (tx, -ty), (nx, -ny)   # в Blender Y перевёрнут


# ------------------------------------------------------------------ профиль сечения
def side_profile(t, side, rng_seed, n):
    """[(r, z)] для одной стороны (side=+1 запад, −1 восток) снизу вверх; r — отступ от оси, м."""
    from mathutils import noise, Vector
    W = L.claw_half_width(t) / 100.0
    H = L.claw_height(t) / 100.0
    end = L.claw_end_round(t)
    W = max(W, 1.5)
    talus_len = (8.0 + 10.0 * (0.5 + 0.5 * noise.noise(Vector((t * 9.0, side * 3.1, 0.3))))) * (0.4 + 0.6 * end)
    talus_h = 10.0 + 10.0 * (0.5 + 0.5 * noise.noise(Vector((t * 6.0, side * 1.7, 2.1))))
    under_d = (3.0 + 5.0 * max(0.0, noise.noise(Vector((t * 14.0, side * 5.3, 4.2))))) * min(1.0, W / 25.0)
    under_h = 14.0 + 12.0 * (0.5 + 0.5 * noise.noise(Vector((t * 4.0, side * 2.9, 7.7))))
    batter = 0.08 + 0.06 * (0.5 + 0.5 * noise.noise(Vector((t * 3.0, side, 9.9))))
    cap = min(10.0, H * 0.06)
    pts = []
    for i in range(n + 1):
        f = i / n
        z = SKIRT_M + (H - SKIRT_M) * (f ** 1.15)       # гуще у основания (осыпь, подрез)
        if z <= 0.0:
            r = W + talus_len + (-z) * 0.6
        elif z <= talus_h:
            k = 1.0 - z / talus_h
            r = W + talus_len * k ** 1.6
        elif z <= talus_h + under_h:
            k = (z - talus_h) / under_h
            r = W - under_d * math.sin(math.pi * k) ** 0.8   # нависающий подрез
        else:
            k = (z - talus_h - under_h) / max(1.0, H - talus_h - under_h)
            r = W * (1.0 - batter * k)
            if z > H - cap:                                    # скругление бровки
                q = (z - (H - cap)) / cap
                r -= cap * (1.0 - math.sqrt(max(0.0, 1.0 - q * q)))
        pts.append((max(0.5, r), z))
    return pts


def top_profile(t, n):
    """Шапка: точки поперёк вершины (r от +W до −W) с лёгким куполом."""
    W = max(1.5, L.claw_half_width(t) / 100.0)
    H = L.claw_height(t) / 100.0
    cap = min(10.0, H * 0.06)
    rw = W * (1.0 - 0.11) - cap
    out = []
    for i in range(1, n):
        f = i / n
        r = rw * (1.0 - 2.0 * f)
        out.append((r, H + 2.5 * (1.0 - (r / max(rw, 1.0)) ** 2)))
    return out


# ------------------------------------------------------------------ построение тела
def build_body(nt, nside, seed):
    import bmesh
    bm = bmesh.new()
    rings = []
    ntop = max(6, nside // 3)
    for i in range(nt + 1):
        t = -0.995 + 1.99 * i / nt
        (cx, cy), _, (nx, ny) = frame(t)
        lean = L.claw_lean(t) / 100.0
        H = L.claw_height(t) / 100.0
        west = side_profile(t, +1, seed, nside)
        east = side_profile(t, -1, seed, nside)
        ring = []
        # обход: восток снизу вверх → шапка с востока на запад → запад сверху вниз
        prof = [(-r, z) for r, z in east]
        prof += [(r, z) for r, z in reversed(top_profile(t, ntop))]
        prof += [(r, z) for r, z in reversed(west)]
        for r, z in prof:
            lr = r + lean * max(0.0, z / max(H, 1.0)) ** 2     # нависающий коготь
            ring.append(bm.verts.new((cx + nx * lr, cy + ny * lr, z)))
        rings.append(ring)
    m = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for j in range(m):
            k = (j + 1) % m          # последний→первый замыкает дно (юбка)
            bm.faces.new((a[j], a[k], b[k], b[j]))
    # торцы: веер к центральной точке
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        cxs = sum(v.co.x for v in ring) / m
        cys = sum(v.co.y for v in ring) / m
        czs = sum(v.co.z for v in ring) / m
        c = bm.verts.new((cxs, cys, czs))
        for j in range(m):
            k = (j + 1) % m
            f = (ring[k], ring[j], c) if flip else (ring[j], ring[k], c)
            bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return env_common.new_mesh_object("SM_Rock_ShaitanClaw", bm=bm)


def build_cutters(scale_h):
    """Резаки: расщелина A4 (зигзаг, сужается кверху), вырез шлюза B1, световая шахта B5."""
    import bmesh
    import bpy
    coll = bpy.data.collections.new("Cutters")
    bpy.context.scene.collection.children.link(coll)
    cutters = []

    # --- расщелина: призма, локально по X от «снаружи» до фальшивого камня
    bm = bmesh.new()
    x0 = L.CREVICE_MOUTH[0] - 3000.0
    x1 = L.FALSE_ROCK[0] + 40.0
    nx, nz = 24, 10
    ztop = scale_h + 30.0
    grid_l, grid_r = [], []
    for i in range(nx + 1):
        xu = x0 + (x1 - x0) * i / nx
        col_l, col_r = [], []
        for k in range(nz + 1):
            z = SKIRT_M - 2.0 + (ztop - SKIRT_M + 2.0) * k / nz
            hw = (L.CREVICE_WIDTH / 200.0) * (1.0 - 0.5 * min(1.0, max(0.0, z) / 120.0))   # 3 м → 1.5 м полуширина
            zig = 1.4 * math.sin(xu / 900.0) + 0.8 * math.sin(z / 17.0 + xu / 1300.0)
            yc = L.CREVICE_MOUTH[1] + zig * 100.0
            a = ue_to_local(xu, yc - hw * 100.0, 0)
            b = ue_to_local(xu, yc + hw * 100.0, 0)
            col_l.append(bm.verts.new((a[0], a[1], z)))
            col_r.append(bm.verts.new((b[0], b[1], z)))
        grid_l.append(col_l)
        grid_r.append(col_r)
    for i in range(nx):
        for k in range(nz):
            bm.faces.new((grid_l[i][k], grid_l[i + 1][k], grid_l[i + 1][k + 1], grid_l[i][k + 1]))
            bm.faces.new((grid_r[i][k], grid_r[i][k + 1], grid_r[i + 1][k + 1], grid_r[i + 1][k]))
    for i in range(nx):   # дно и верх
        bm.faces.new((grid_l[i][0], grid_r[i][0], grid_r[i + 1][0], grid_l[i + 1][0]))
        bm.faces.new((grid_l[i][nz], grid_l[i + 1][nz], grid_r[i + 1][nz], grid_r[i][nz]))
    for i in (0, nx):     # торцы
        for k in range(nz):
            f = (grid_l[i][k], grid_l[i][k + 1], grid_r[i][k + 1], grid_r[i][k])
            bm.faces.new(f if i == 0 else tuple(reversed(f)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    cutters.append(env_common.new_mesh_object("CUT_Crevice", bm=bm, collection=coll))

    # --- шлюз B1 (наземная камера + начало лестницы), с запасом: интерьер задаёт кит сиетча
    b1 = L.B1
    bm = bmesh.new()
    lo = ue_to_local(L.FALSE_ROCK[0] - 300.0, b1["y0"] - 60.0)
    hi = ue_to_local(b1["chamber_x1"] + 1900.0, b1["y1"] + 60.0)
    bmesh.ops.create_cube(bm, size=1.0)
    xs = (min(lo[0], hi[0]), max(lo[0], hi[0]))      # Y перевёрнут → берём min/max, иначе нормали внутрь
    ys = (min(lo[1], hi[1]), max(lo[1], hi[1]))
    for v in bm.verts:
        v.co.x = xs[0] if v.co.x < 0 else xs[1]
        v.co.y = ys[0] if v.co.y < 0 else ys[1]
        v.co.z = SKIRT_M - 2.0 if v.co.z < 0 else (b1["height"] + 80.0) / 100.0
    cutters.append(env_common.new_mesh_object("CUT_Airlock", bm=bm, collection=coll))

    # --- световая шахта над чашей зала B5
    bm = bmesh.new()
    cx, cy, _ = ue_to_local(*L.B5["bowl_center"])
    r = L.B5["shaft_radius"] / 100.0
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=r, radius2=r * 1.6, depth=scale_h + 60.0)
    for v in bm.verts:
        v.co.x += cx
        v.co.y += cy
        v.co.z += (scale_h + 60.0) * 0.5 + SKIRT_M - 5.0
    cutters.append(env_common.new_mesh_object("CUT_LightShaft", bm=bm, collection=coll))
    for c in cutters:
        c.display_type = "WIRE"
        c.hide_render = True
    return coll, cutters


def boolean_cut(ob, coll):
    mod = ob.modifiers.new("Cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    try:
        mod.operand_type = "COLLECTION"
        mod.collection = coll
    except Exception:  # noqa: BLE001
        pass
    mod.solver = "EXACT"
    try:
        env_common.apply_modifiers(ob)
    except Exception as e:  # noqa: BLE001
        print(f"[Rakis] WARN boolean: {e} — расщелина не вырезана, вырежьте вручную")
        ob.modifiers.clear()


# ------------------------------------------------------------------ валуны осыпи
def add_boulders(count, seed):
    import bmesh
    from mathutils import Vector, noise
    rnd = random.Random(seed)
    bm = bmesh.new()
    placed = 0
    tries = 0
    mouth = L.CREVICE_MOUTH
    while placed < count and tries < count * 20:
        tries += 1
        t = rnd.uniform(-0.95, 0.95)
        side = rnd.choice((1, -1))
        cx, cy = L.claw_center(t)
        hw = L.claw_half_width(t)
        x_ue = cx - side * (hw + rnd.uniform(-300.0, 2800.0))    # side=+1 → запад
        y_ue = cy + rnd.uniform(-1500.0, 1500.0)
        if math.hypot(x_ue - mouth[0], y_ue - mouth[1]) < 3500.0:
            continue                                              # устье расщелины свободно
        if abs(y_ue - mouth[1]) < 1500.0 and x_ue > mouth[0] - 4000.0 and side > 0:
            continue
        size = rnd.uniform(0.8, 5.5) * (1.0 if rnd.random() > 0.15 else 1.8)
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        lx, ly, _ = ue_to_local(x_ue, y_ue)
        sd_m = L.rock_signed_distance(x_ue, y_ue) / 100.0
        gz = 6.0 * (1.0 - min(1.0, max(0.0, sd_m / 45.0))) - 0.3   # осыпь ландшафта (env_dunes: talus 6 м / 45 м)
        sx, sy, sz = size * rnd.uniform(0.8, 1.4), size * rnd.uniform(0.7, 1.2), size * rnd.uniform(0.45, 0.8)
        rot = rnd.uniform(0, math.tau)
        for v in res["verts"]:
            p = v.co.copy()
            d = 1.0 + 0.25 * noise.noise(p * 1.7 + Vector((placed * 3.1, 0, 0)))
            p = p * d
            p.z = max(p.z, -0.6)                       # плоское основание
            x = p.x * sx
            y = p.y * sy
            v.co = Vector((lx + x * math.cos(rot) - y * math.sin(rot),
                           ly + x * math.sin(rot) + y * math.cos(rot),
                           gz + p.z * sz + sz * 0.25))
        placed += 1
    ob = env_common.new_mesh_object("Talus", bm=bm)
    print(f"[Rakis] валунов: {placed}")
    return ob


# ------------------------------------------------------------------ смещение (страты, трещины, желобки)
def displace(ob, seed, amp=1.0):
    from mathutils import Vector, noise
    me = ob.data
    mouth = L.CREVICE_MOUTH
    hall = L.B5["bowl_center"]
    off = Vector((seed * 13.7, seed * 7.1, 0.0))
    n_v = len(me.vertices)
    for idx, v in enumerate(me.vertices):
        p = v.co
        n = v.normal
        horiz = math.sqrt(n.x * n.x + n.y * n.y)            # 1 — отвесная стена, 0 — шапка
        q = p + off
        # крупные формы: контрфорсы и ниши (60 м) + средние (12 м)
        big = noise.fractal(Vector((q.x / 60.0, q.y / 60.0, q.z / 90.0)), 0.8, 2.0, 4, noise_basis="PERLIN_NEW")
        mid = noise.fractal(Vector((q.x / 12.0, q.y / 12.0, q.z / 14.0)), 0.7, 2.1, 3, noise_basis="PERLIN_NEW")
        # страты: слои 3–9 м, твёрдые слои выступают
        f = q.z / 6.0 + 0.8 * noise.noise(Vector((q.x / 220.0, q.y / 220.0, q.z / 40.0)))
        band = f - math.floor(f)
        strata = (min(1.0, band / 0.15) - max(0.0, min(1.0, (band - 0.55) / 0.15))) * 0.9
        # ветровые желобки — вытянутый по горизонтали шум
        flutes = noise.noise(Vector((q.x / 40.0, q.y / 40.0, q.z / 2.4))) * 0.55
        # вертикальные трещины (voronoi F2−F1)
        dists, _ = noise.voronoi(Vector((q.x / 26.0, q.y / 26.0, q.z / 400.0)), distance_metric="DISTANCE")
        crack = -1.6 * max(0.0, 1.0 - (dists[1] - dists[0]) / 0.09)
        d = big * 4.0 + mid * 1.2
        d += horiz * (strata + flutes + crack)
        d *= amp
        # аккуратнее у расщелины, шлюза и шахты
        x_ue, y_ue, z_ue = local_to_ue(p.x, p.y, p.z)
        near = 1.0
        if abs(y_ue - mouth[1]) < 1200.0 and mouth[0] - 2500.0 < x_ue < L.B1["x1"]:
            near = 0.25
        if math.hypot(x_ue - hall[0], y_ue - hall[1]) < 900.0:
            near = 0.2
        if p.z < SKIRT_M + 1.0:
            near = 0.0                                       # дно юбки не трогаем
        v.co = p + n * (d * near)
        if idx % 200000 == 0:
            print(f"  смещение {idx}/{n_v}")


def fine_displace(ob, strength=0.35):
    """Мелкая фактура модификатором Displace (VORONOI-трещины + CLOUDS) и применение."""
    import bpy
    tex = bpy.data.textures.new("T_RockCracks", type="VORONOI")
    tex.noise_scale = 1.6
    tex.distance_metric = "DISTANCE"
    tex2 = bpy.data.textures.new("T_RockClouds", type="CLOUDS")
    tex2.noise_scale = 0.8
    tex2.noise_depth = 3
    m1 = ob.modifiers.new("FineCracks", "DISPLACE")
    m1.texture = tex
    m1.texture_coords = "LOCAL"
    m1.strength = strength
    m1.mid_level = 0.6
    m2 = ob.modifiers.new("FineClouds", "DISPLACE")
    m2.texture = tex2
    m2.texture_coords = "LOCAL"
    m2.strength = strength * 0.6
    env_common.apply_modifiers(ob)


def subdivide(ob, levels):
    if levels <= 0:
        return
    m = ob.modifiers.new("Subdiv", "SUBSURF")
    m.subdivision_type = "SIMPLE"
    m.levels = levels
    m.render_levels = levels
    env_common.apply_modifiers(ob)


def triplanar_uv(ob, tile_m=4.0):
    """UV — блочная проекция (материал скалы всё равно мировой/трипланарный)."""
    env_common.box_uv(ob, tile_m)


def build_false_rock(seed):
    """Плита 4.4 × 1.6 × 5 м; pivot — центр низа; грубая лицевая сторона −X (смотрит в расщелину при yaw 0)."""
    import bmesh
    from mathutils import Vector, noise
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=8, use_grid_fill=True)
    for v in bm.verts:
        p = v.co.copy()
        x, y, z = p.x * 1.6, p.y * 4.4, (p.z + 0.5) * 5.0
        bulge = 0.0 if p.x > 0.45 else (0.25 * noise.noise(Vector((p.y * 3 + seed, p.z * 3, 0))) - 0.15 * abs(p.y))
        v.co = Vector((x + bulge * (1 if p.x < 0 else 0), y, z))
    ob = env_common.new_mesh_object("SM_Rock_FalseRock", bm=bm)
    env_common.add_material_slot(ob, "MI_Rock_Claw")
    fine_displace(ob, 0.08)
    triplanar_uv(ob, 2.0)
    return ob


# ------------------------------------------------------------------ main
def main():
    import bpy
    ap = argparse.ArgumentParser(description="Shaitan's Claw generator")
    ap.add_argument("--out", default="Export/SM_Rock_ShaitanClaw.fbx")
    ap.add_argument("--false-rock-out", default="Export/SM_Rock_FalseRock.fbx")
    ap.add_argument("--preset", choices=sorted(PRESETS), default="default")
    ap.add_argument("--nt", type=int, default=None, help="сечений вдоль длины")
    ap.add_argument("--nside", type=int, default=None, help="точек на сторону сечения")
    ap.add_argument("--subdiv", type=int, default=None, help="уровней SIMPLE-подразбиения")
    ap.add_argument("--boulders", type=int, default=None)
    ap.add_argument("--seed", type=int, default=4)
    ap.add_argument("--no-boolean", action="store_true")
    ap.add_argument("--save-blend", default="", help="опционально: путь .blend в Export/ для ручной доводки")
    env_common.fbx_axis_args(ap)
    args = env_common.parse_args(ap)
    nt, nside, subdiv, boulders = PRESETS[args.preset]
    nt = args.nt or nt
    nside = args.nside or nside
    subdiv = subdiv if args.subdiv is None else args.subdiv
    boulders = boulders if args.boulders is None else args.boulders

    env_common.reset_scene()
    body = build_body(nt, nside, args.seed)
    print(f"[Rakis] тело: {len(body.data.polygons)} граней")
    if not args.no_boolean:
        coll, _ = build_cutters(max(L.claw_height(t / 10.0) for t in range(-10, 11)) / 100.0)
        boolean_cut(body, coll)
        for o in list(coll.objects):
            bpy.data.objects.remove(o, do_unlink=True)
    subdivide(body, subdiv)
    displace(body, args.seed)
    fine_displace(body, 0.35)
    env_common.add_material_slot(body, "MI_Rock_Claw")
    talus = add_boulders(boulders, args.seed)
    subdivide(talus, max(0, subdiv - 1))
    displace(talus, args.seed + 1, amp=0.15)
    env_common.add_material_slot(talus, "MI_Rock_Talus")
    # объединение: тело + осыпь (слоты материалов сохраняются)
    env_common.select_only([body, talus])
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = "SM_Rock_ShaitanClaw"
    triplanar_uv(body, 4.0)
    env_common.shade_smooth(body, 50.0)
    env_common.export_fbx(args.out, [body], args.axis_forward, args.axis_up)

    fr = build_false_rock(args.seed)
    env_common.export_fbx(args.false_rock_out, [fr], args.axis_forward, args.axis_up)
    if args.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=env_common.out_path(args.save_blend))


if __name__ == "__main__":
    main()
