extends Node3D
## Клиент отображения + симулятор вида из очков (Godot 4.7).
##
## Что моделируется:
##   * «реальность» (слой 1): верстак/оснастка, метки ArUco, детали в таре и уже установленные детали;
##   * голограммы (слой 2): детали и крепёж текущего шага с анимацией «из тары → на место»;
##   * дисплей очков: голограммы видны ТОЛЬКО в окне 52° по диагонали (16:10, ≈45×29°) — SubViewport,
##     наложенный по центру глаза-камеры с полем ~75° по вертикали. Клавиша F — сравнить с «полным полем».
##   * HUD внутри окна дисплея: шаг, состояние, угловая панель (Tab) — шаги и чат.
## Связь с ядром: UDP JSON (docs/02_hal_contracts.md). Без ядра клиент работает автономно (клавиши N/B).
##
## Аргументы (после «--»):  --package=/путь/op.json   --use-anchor   --selftest   --screenshot=/путь.png   --step=N
## Клавиши: N — дальше, B — назад, P — фото, K — КД, Tab — панель, F — полное поле/окно очков, H — справка.

const PORT_IN: int = 47100
const PORT_OUT: int = 47101
const LAYER_REAL: int = 1
const LAYER_HOLO: int = 2
const GLASSES_DIAG_DEG: float = 52.0
const GLASSES_ASPECT: float = 1.6
const EYE_VFOV_DEG: float = 75.0
const HOLO_COLOR: Color = Color(0.35, 0.9, 1.0, 0.55)
const FASTENER_COLOR: Color = Color(1.0, 0.8, 0.25, 0.9)
const MARKER_TEX_RATIO: float = 320.0 / 240.0      # текстура метки = 240 px + белое поле 2×40 px

var pkg: Dictionary = {}
var pkg_dir: String = ""
var step_index: int = 0
var core_state: String = "offline"
var core_seen: float = -100.0
var use_anchor: bool = false
var anchor_T: Transform3D = Transform3D.IDENTITY
var anchor_time: float = -100.0
var anchor_quality: float = 0.0
var full_field: bool = false
var anim_t: float = 0.0
var speed: float = 1.0
var frames: int = 0
var screenshot_path: String = ""
var chat_lines: PackedStringArray = PackedStringArray()

var udp_in: PacketPeerUDP = PacketPeerUDP.new()
var udp_out: PacketPeerUDP = PacketPeerUDP.new()

var head: Camera3D
var holo_cam: Camera3D
var holo_vp: SubViewport
var holo_rect: TextureRect
var holo_frame: ReferenceRect
var holo_root: Node3D
var real_root: Node3D
var gltf_scenes: Dictionary = {}       # model id → Node3D (вне дерева; освобождаются после построения деталей)
var models_loaded: int = 0
var parts: Dictionary = {}             # part id → {real, holo, T, src}
var fasteners: Dictionary = {}         # fastener id → MeshInstance3D (holo)
var step_label: Label
var info_label: Label
var status_label: Label
var panel: PanelContainer
var panel_label: Label
var help_label: Label
var holo_mat: StandardMaterial3D
var fast_mat: StandardMaterial3D
var glasses_vfov: float
var glasses_hfov: float


func _ready() -> void:
	var args: PackedStringArray = OS.get_cmdline_user_args()
	use_anchor = args.has("--use-anchor")
	for a in args:
		if a.begins_with("--screenshot="):
			screenshot_path = a.substr(13)
		if a.begins_with("--step="):
			step_index = int(a.substr(7)) - 1
	_compute_glasses_fov()
	if not _load_package(_package_path(args)):
		get_tree().quit(1)
		return
	_make_materials()
	_build_world()
	_build_parts()
	_build_cameras()
	_build_hud()
	udp_in.bind(PORT_IN, "127.0.0.1")
	udp_out.set_dest_address("127.0.0.1", PORT_OUT)
	get_viewport().size_changed.connect(_layout)
	_layout()
	_apply_step()
	if args.has("--selftest"):
		print("SELFTEST op=%s parts=%d fasteners=%d steps=%d models=%d glasses=%.1fx%.1f deg" % [
			pkg["operation"]["id"], parts.size(), fasteners.size(), pkg["steps"].size(), models_loaded,
			glasses_hfov, glasses_vfov])
		get_tree().quit(0)


# ---------------------------------------------------------------- пакет операции
func _package_path(args: PackedStringArray) -> String:
	for a in args:
		if a.begins_with("--package="):
			return a.substr(10)
	return ProjectSettings.globalize_path("res://").path_join("../../data/examples/op040_shelf_bench.json").simplify_path()


func _load_package(path: String) -> bool:
	if not FileAccess.file_exists(path):
		push_error("Нет пакета операции: " + path)
		return false
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (data is Dictionary):
		push_error("Пакет не JSON: " + path)
		return false
	pkg = data
	pkg_dir = path.get_base_dir()
	for m in pkg.get("models", []):
		var p: String = pkg_dir.path_join(m["uri"])
		if FileAccess.file_exists(p):
			var doc: GLTFDocument = GLTFDocument.new()
			var st: GLTFState = GLTFState.new()
			if doc.append_from_file(p, st) == OK:
				gltf_scenes[m["id"]] = doc.generate_scene(st)
				models_loaded += 1
		else:
			print("[client] модели нет (%s) — детали будут показаны заглушками fallback; make godot-assets" % p)
	return true


static func mm(a: Array) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2])) * 0.001


static func quat(a: Variant) -> Quaternion:
	if a is Array and a.size() == 4:
		return Quaternion(float(a[0]), float(a[1]), float(a[2]), float(a[3])).normalized()
	return Quaternion.IDENTITY


static func pose(p: Dictionary) -> Transform3D:
	return Transform3D(Basis(quat(p.get("rotation"))), mm(p["position"]))


# ---------------------------------------------------------------- сцена
func _make_materials() -> void:
	holo_mat = StandardMaterial3D.new()
	holo_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	holo_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	holo_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD          # оптический дисплей только добавляет свет
	holo_mat.no_depth_test = false
	holo_mat.albedo_color = HOLO_COLOR
	holo_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	fast_mat = holo_mat.duplicate()
	fast_mat.albedo_color = FASTENER_COLOR


func _bounds() -> AABB:
	var box: AABB = AABB(mm(pkg["parts"][0]["target"]["position"]), Vector3.ZERO)
	for p in pkg["parts"]:
		box = box.expand(mm(p["target"]["position"]))
	for m in pkg["anchors"]["markers"]:
		box = box.expand(mm(m["pose"]["position"]))
	return box


## Верстак (СК «fixture…»): пол на 0,9 м ниже оснастки. Иначе (СК фюзеляжа и т. п.) — пол под самой низкой точкой
## меток/деталей/тары: в примере 070 метки 3 и 5 лежат на полу кабины.
func _is_fixture() -> bool:
	return String(pkg["anchors"]["reference_frame"]).begins_with("fixture")


func _floor_y() -> float:
	var b: AABB = _bounds()
	if _is_fixture():
		return b.position.y - 0.9
	var y: float = b.position.y
	for p in pkg["parts"]:
		if p.has("source") and p["source"].has("position"):
			y = minf(y, mm(p["source"]["position"]).y)
	return y - 0.02


func _targets_bounds() -> AABB:
	var box: AABB = AABB(mm(pkg["parts"][0]["target"]["position"]), Vector3.ZERO)
	for p in pkg["parts"]:
		box = box.expand(mm(p["target"]["position"]))
	return box


func _build_world() -> void:
	var env: Environment = Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.16, 0.17, 0.19)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.55, 0.57, 0.6)
	env.ambient_light_energy = 0.6
	var we: WorldEnvironment = WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun: DirectionalLight3D = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, -30, 0)
	sun.light_energy = 1.1
	add_child(sun)

	real_root = Node3D.new()
	real_root.name = "Reality"
	add_child(real_root)
	var b: AABB = _bounds()
	var floor_y: float = _floor_y()
	_box(real_root, Vector3(8, 0.02, 8), Vector3(b.get_center().x, floor_y - 0.01, b.get_center().z), Color(0.33, 0.34, 0.36))
	if _is_fixture():
		var top: Vector3 = Vector3(b.size.x + 0.5, 0.04, b.size.z + 0.4)
		_box(real_root, top, Vector3(b.get_center().x, b.position.y - 0.022, b.get_center().z), Color(0.42, 0.4, 0.36))
		for sx in [-1, 1]:
			for sz in [-1, 1]:
				var leg: Vector3 = Vector3(b.get_center().x + sx * (top.x / 2 - 0.05), (floor_y + b.position.y) / 2, b.get_center().z + sz * (top.z / 2 - 0.05))
				_box(real_root, Vector3(0.05, b.position.y - floor_y, 0.05), leg, Color(0.25, 0.26, 0.28))
	if String(pkg["anchors"]["reference_frame"]).begins_with("fuselage"):
		_fuselage_shell(b, floor_y)
	for m in pkg["anchors"]["markers"]:
		_marker(m)


## Условная обшивка фюзеляжа (вид изнутри): цилиндр вдоль Z, пол кабины = floor_y. Замените на GLB секции из CAD.
func _fuselage_shell(b: AABB, floor_y: float) -> void:
	var r: float = 1.95
	var mi: MeshInstance3D = MeshInstance3D.new()
	var cm: CylinderMesh = CylinderMesh.new()
	cm.top_radius = r
	cm.bottom_radius = r
	cm.height = 7.0
	cm.radial_segments = 48
	cm.cap_top = false
	cm.cap_bottom = false
	mi.mesh = cm
	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.albedo_color = Color(0.62, 0.66, 0.68)
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	mat.roughness = 0.9
	mi.material_override = mat
	mi.transform = Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(b.get_center().x, floor_y + 0.55, b.get_center().z))
	mi.layers = LAYER_REAL
	real_root.add_child(mi)
	for i in range(-3, 4):      # шпангоуты
		var fr: MeshInstance3D = MeshInstance3D.new()
		var tm: TorusMesh = TorusMesh.new()
		tm.inner_radius = r - 0.07
		tm.outer_radius = r - 0.01
		tm.rings = 48
		fr.mesh = tm
		var fm: StandardMaterial3D = StandardMaterial3D.new()
		fm.albedo_color = Color(0.5, 0.55, 0.5)
		fr.material_override = fm
		fr.transform = Transform3D(Basis(Vector3.RIGHT, PI / 2), Vector3(b.get_center().x, floor_y + 0.55, b.get_center().z + i * 0.53))
		fr.layers = LAYER_REAL
		real_root.add_child(fr)


func _box(parent: Node3D, size: Vector3, pos: Vector3, color: Color, layer: int = LAYER_REAL) -> MeshInstance3D:
	var mi: MeshInstance3D = MeshInstance3D.new()
	var bm: BoxMesh = BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 0.8
	mi.material_override = mat
	mi.position = pos
	mi.layers = layer
	parent.add_child(mi)
	return mi


func _marker(m: Dictionary) -> void:
	# СК метки в пакете: нормаль +Y, «верх» картинки к −Z. PlaneMesh лежит в XZ, нормаль +Y, v растёт к +Z.
	var side: float = float(m["size_mm"]) * 0.001 * MARKER_TEX_RATIO
	var mi: MeshInstance3D = MeshInstance3D.new()
	var pm: PlaneMesh = PlaneMesh.new()
	pm.size = Vector2(side, side)
	mi.mesh = pm
	var mat: StandardMaterial3D = StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var tex_path: String = "res://textures/markers/marker_%d.png" % int(m["id"])
	var img: Image = Image.load_from_file(ProjectSettings.globalize_path(tex_path)) if FileAccess.file_exists(tex_path) else null
	if img != null:
		mat.albedo_texture = ImageTexture.create_from_image(img)
		mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	else:
		mat.albedo_color = Color(0.9, 0.9, 0.9)
	mi.material_override = mat
	mi.transform = pose(m["pose"])
	mi.layers = LAYER_REAL
	real_root.add_child(mi)


# ---------------------------------------------------------------- детали и крепёж
func _build_parts() -> void:
	holo_root = Node3D.new()
	holo_root.name = "Holo"
	add_child(holo_root)
	for p in pkg["parts"]:
		var T: Transform3D = pose(p["target"])
		var real: Node3D = _part_visual(p, false)
		var holo: Node3D = _part_visual(p, true)
		real_root.add_child(real)
		holo_root.add_child(holo)
		var src: Vector3 = T.origin + Vector3(0, 0.25, 0)
		if p.has("source") and p["source"].has("position"):
			src = mm(p["source"]["position"])
		parts[p["id"]] = {"real": real, "holo": holo, "T": T, "src": src}
		if p.has("source") and String(p["source"].get("kind", "")) == "bin" and p["source"].has("position"):
			_box(real_root, Vector3(0.16, 0.012, 0.16), src - Vector3(0, 0.04, 0), Color(0.15, 0.32, 0.55))   # тара
	for f in pkg.get("fasteners", []):
		var mi: MeshInstance3D = MeshInstance3D.new()
		var cm: CylinderMesh = CylinderMesh.new()
		cm.top_radius = 0.004
		cm.bottom_radius = 0.004
		cm.height = 0.03
		mi.mesh = cm
		mi.material_override = fast_mat
		var axis: Vector3 = Vector3(float(f["axis"][0]), float(f["axis"][1]), float(f["axis"][2])).normalized() if f.has("axis") else Vector3.UP
		var b: Basis = Basis.IDENTITY if axis.is_equal_approx(Vector3.UP) else Basis(Quaternion(Vector3.UP, axis))
		mi.transform = Transform3D(b, mm(f["position"]) + axis * 0.012)
		mi.layers = LAYER_HOLO
		holo_root.add_child(mi)
		fasteners[f["id"]] = mi
	for k in gltf_scenes:
		(gltf_scenes[k] as Node).free()
	gltf_scenes.clear()


func _part_visual(p: Dictionary, holo: bool) -> Node3D:
	var node: Node3D = null
	var model: Variant = gltf_scenes.get(p.get("model", ""))
	if model != null and p.has("node"):
		var found: Node = (model as Node3D).find_child(String(p["node"]), true, false)
		if found is Node3D:
			node = (found as Node3D).duplicate()
			node.transform = (found as Node3D).global_transform if found.is_inside_tree() else _accumulated(found as Node3D, model as Node3D)
	if node == null:
		var fb: Dictionary = p.get("fallback", {"type": "box", "size_mm": [50, 50, 50]})
		var s: Vector3 = mm(fb["size_mm"])
		var mi: MeshInstance3D = MeshInstance3D.new()
		if fb["type"] == "cylinder":
			var cm: CylinderMesh = CylinderMesh.new()
			cm.top_radius = s.x / 2
			cm.bottom_radius = s.x / 2
			cm.height = s.y
			mi.mesh = cm
		else:
			var bm: BoxMesh = BoxMesh.new()
			bm.size = s
			mi.mesh = bm
		var mat: StandardMaterial3D = StandardMaterial3D.new()
		mat.albedo_color = Color.html(String(fb.get("color", "#9aa3ad")))
		mi.material_override = mat
		mi.transform = pose(p["target"])
		node = mi
	node.name = ("H_" if holo else "R_") + String(p["id"])
	_set_visual(node, LAYER_HOLO if holo else LAYER_REAL, holo_mat if holo else null)
	return node


func _accumulated(n: Node3D, root: Node3D) -> Transform3D:
	var T: Transform3D = n.transform
	var cur: Node = n.get_parent()
	while cur != null and cur != root:
		if cur is Node3D:
			T = (cur as Node3D).transform * T
		cur = cur.get_parent()
	return T


func _set_visual(n: Node, layer: int, mat: Material) -> void:
	if n is VisualInstance3D:
		(n as VisualInstance3D).layers = layer
	if n is GeometryInstance3D and mat != null:
		(n as GeometryInstance3D).material_override = mat
	for c in n.get_children():
		_set_visual(c, layer, mat)


# ---------------------------------------------------------------- камеры: глаз и дисплей очков
func _compute_glasses_fov() -> void:
	var td: float = tan(deg_to_rad(GLASSES_DIAG_DEG / 2.0))
	var tv: float = td / sqrt(1.0 + GLASSES_ASPECT * GLASSES_ASPECT)
	glasses_vfov = rad_to_deg(2.0 * atan(tv))
	glasses_hfov = rad_to_deg(2.0 * atan(tv * GLASSES_ASPECT))


func _build_cameras() -> void:
	head = preload("res://scripts/sim_rig.gd").new()
	head.name = "Head"
	head.fov = EYE_VFOV_DEG
	head.near = 0.02
	head.cull_mask = LAYER_REAL
	add_child(head)
	var b: AABB = _bounds()
	if _is_fixture():
		head.call("place", b.get_center() + Vector3(0, 0.55, 0.75 + b.size.z * 0.3), b.get_center())
	else:      # работа над головой (полки, панели): глаза на 1,65 м от пола, перед зоной монтажа
		var t: AABB = _targets_bounds()
		head.call("place", Vector3(t.get_center().x, _floor_y() + 1.65, t.end.z + 0.9), t.get_center())
	head.make_current()

	holo_vp = SubViewport.new()
	holo_vp.transparent_bg = true
	holo_vp.size = Vector2i(1280, 800)
	holo_vp.msaa_3d = Viewport.MSAA_2X
	add_child(holo_vp)
	holo_cam = Camera3D.new()
	holo_cam.fov = glasses_vfov
	holo_cam.near = 0.02
	holo_cam.cull_mask = LAYER_HOLO
	holo_vp.add_child(holo_cam)


# ---------------------------------------------------------------- HUD
func _build_hud() -> void:
	var layer: CanvasLayer = CanvasLayer.new()
	add_child(layer)
	holo_rect = TextureRect.new()
	holo_rect.texture = holo_vp.get_texture()
	holo_rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	holo_rect.stretch_mode = TextureRect.STRETCH_SCALE
	holo_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var add_mat: CanvasItemMaterial = CanvasItemMaterial.new()
	add_mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	holo_rect.material = add_mat
	layer.add_child(holo_rect)
	holo_frame = ReferenceRect.new()
	holo_frame.editor_only = false
	holo_frame.border_color = Color(0.4, 0.9, 1.0, 0.35)
	holo_frame.border_width = 1.5
	holo_frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(holo_frame)

	step_label = _label(holo_frame, 22, Color(0.75, 0.97, 1.0))
	info_label = _label(holo_frame, 16, Color(0.7, 0.9, 0.95))
	status_label = _label(holo_frame, 14, Color(0.6, 0.85, 0.9))
	panel = PanelContainer.new()
	var sb: StyleBoxFlat = StyleBoxFlat.new()
	sb.bg_color = Color(0.1, 0.35, 0.45, 0.35)
	sb.border_color = Color(0.4, 0.9, 1.0, 0.5)
	sb.set_border_width_all(1)
	sb.set_content_margin_all(8)
	panel.add_theme_stylebox_override("panel", sb)
	panel_label = _label(panel, 13, Color(0.8, 0.97, 1.0))
	holo_frame.add_child(panel)
	panel.visible = false
	help_label = _label(layer, 13, Color(0.85, 0.85, 0.85))
	help_label.text = "WASD/QE — шаг головы, ПКМ+мышь — поворот · N дальше · B назад · P фото · K КД · Tab панель · F окно/полное поле"
	chat_lines.append("Мастер: Нормы времени по ТП, без спешки.")


func _label(parent: Node, size: int, color: Color) -> Label:
	var l: Label = Label.new()
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(l)
	return l


func _layout() -> void:
	var vs: Vector2 = get_viewport().get_visible_rect().size
	var frac_v: float = tan(deg_to_rad(glasses_vfov / 2.0)) / tan(deg_to_rad(EYE_VFOV_DEG / 2.0))
	var h: float = vs.y * frac_v
	var w: float = h * GLASSES_ASPECT
	var r: Rect2 = Rect2((vs - Vector2(w, h)) / 2.0, Vector2(w, h))
	if full_field:
		r = Rect2(Vector2.ZERO, vs)
	holo_rect.position = r.position
	holo_rect.size = r.size
	holo_frame.position = r.position
	holo_frame.size = r.size
	holo_vp.size = Vector2i(int(r.size.x), int(r.size.y))
	holo_cam.fov = glasses_vfov if not full_field else EYE_VFOV_DEG
	var s: float = r.size.y / 600.0
	step_label.position = Vector2(14, 10)
	step_label.add_theme_font_size_override("font_size", int(clampf(22 * s, 14, 34)))
	info_label.position = Vector2(14, 10 + 34 * s)
	info_label.add_theme_font_size_override("font_size", int(clampf(16 * s, 11, 24)))
	status_label.position = Vector2(14, r.size.y - 28 * s)
	status_label.add_theme_font_size_override("font_size", int(clampf(14 * s, 10, 20)))
	panel.position = Vector2(r.size.x * 0.68, r.size.y * 0.18)
	panel.size = Vector2(r.size.x * 0.3, r.size.y * 0.62)
	panel_label.add_theme_font_size_override("font_size", int(clampf(13 * s, 10, 18)))
	help_label.position = Vector2(12, vs.y - 26)


# ---------------------------------------------------------------- шаги
func _apply_step() -> void:
	var steps: Array = pkg["steps"]
	step_index = clampi(step_index, 0, steps.size() - 1)
	var s: Dictionary = steps[step_index]
	var done: Dictionary = {}
	for j in range(step_index):
		for pid in steps[j].get("parts", []):
			done[pid] = true
	var cur_parts: Array = s.get("parts", [])
	for pid in parts:
		var e: Dictionary = parts[pid]
		var real: Node3D = e["real"]
		real.transform = e["T"] if done.has(pid) else Transform3D(e["T"].basis, e["src"])
		real.visible = not cur_parts.has(pid) or done.has(pid)
		(e["holo"] as Node3D).visible = cur_parts.has(pid)
	var cur_f: Array = s.get("fasteners", [])
	for fid in fasteners:
		(fasteners[fid] as Node3D).visible = cur_f.has(fid)
	anim_t = 0.0
	step_label.text = "Шаг %d/%d · %s" % [step_index + 1, steps.size(), s["title"]]
	var info: PackedStringArray = PackedStringArray()
	if s.has("tool"):
		info.append(String(s["tool"]))
	var prm: Dictionary = s.get("params", {})
	if prm.has("torque_nm"):
		info.append("момент %s Н·м" % str(prm["torque_nm"]))
	if s.has("check"):
		info.append(String(s["check"].get("text", "контроль")))
	if cur_f.size() > 0:
		info.append("крепёж: %d шт." % cur_f.size())
	info_label.text = " · ".join(info)
	_update_panel()


func _update_panel() -> void:
	var steps: Array = pkg["steps"]
	var lines: PackedStringArray = PackedStringArray(["ОП %s · шаги" % pkg["operation"]["id"]])
	for i in range(steps.size()):
		var mark: String = "✓" if i < step_index else ("▶" if i == step_index else "·")
		lines.append("%s %d. %s" % [mark, i + 1, steps[i]["title"]])
	lines.append("")
	lines.append("Чат")
	for c in chat_lines.slice(-4):
		lines.append(c)
	panel_label.text = "\n".join(lines)


func _process(delta: float) -> void:
	_poll_udp()
	holo_cam.global_transform = head.global_transform
	anim_t += delta * speed
	var now: float = Time.get_ticks_msec() / 1000.0
	if use_anchor and now - anchor_time < 0.5:
		holo_root.global_transform = head.global_transform * anchor_T
	else:
		holo_root.global_transform = Transform3D.IDENTITY      # истина сцены: СК операции = мировая СК
	var phase: float = fmod(anim_t, 3.0) / 3.0
	var k: float = smoothstep(0.0, 0.7, phase)
	for pid in pkg["steps"][step_index].get("parts", []):
		if parts.has(pid):
			var e: Dictionary = parts[pid]
			var T: Transform3D = e["T"]
			(e["holo"] as Node3D).transform = Transform3D(T.basis, T.origin.lerp(e["src"], 1.0 - k))
	var pulse: float = 1.0 + 0.25 * sin(anim_t * 6.0)
	for fid in fasteners:
		var fm: Node3D = fasteners[fid]
		if fm.visible:
			fm.scale = Vector3(pulse, 1.0, pulse)
	var src_txt: String = "ядро: %s" % core_state if now - core_seen < 2.0 else "ядро: нет связи (автономно)"
	var anc_txt: String = "привязка: ядро q=%.2f" % anchor_quality if use_anchor and now - anchor_time < 0.5 else "привязка: истина сцены"
	status_label.text = "%s · %s · окно %.0f×%.0f° %s" % [src_txt, anc_txt, glasses_hfov, glasses_vfov, "(полное поле)" if full_field else ""]
	frames += 1
	if screenshot_path != "" and frames == 30:
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(screenshot_path)
		print("SCREENSHOT ", screenshot_path)
		get_tree().quit(0)


# ---------------------------------------------------------------- UDP
func _poll_udp() -> void:
	while udp_in.get_available_packet_count() > 0:
		var msg: Variant = JSON.parse_string(udp_in.get_packet().get_string_from_utf8())
		if not (msg is Dictionary):
			continue
		core_seen = Time.get_ticks_msec() / 1000.0
		match String(msg.get("type", "")):
			"anchor":
				anchor_T = _cv_to_godot(msg["position_m"], msg["rotation_xyzw"])
				anchor_quality = float(msg.get("quality", 0.0))
				anchor_time = core_seen
			"step":
				core_state = String(msg.get("state", ""))
				speed = float(msg.get("speed", 1.0))
				if int(msg.get("index", step_index)) != step_index:
					step_index = int(msg["index"])
					_apply_step()
			"chat":
				chat_lines.append("%s: %s" % [msg.get("author", "?"), msg.get("text", "")])
				_update_panel()
				panel.visible = true
			"scale_check":
				if not bool(msg.get("ok", true)):
					chat_lines.append("Система: масштаб меток %.3f — проверьте печать!" % float(msg.get("scale", 0.0)))
					_update_panel()


## Поза из СК камеры OpenCV (X вправо, Y вниз, Z вперёд) в СК камеры Godot (Y вверх, −Z вперёд).
static func _cv_to_godot(p: Array, q: Array) -> Transform3D:
	var F: Basis = Basis(Vector3(1, 0, 0), Vector3(0, -1, 0), Vector3(0, 0, -1))
	var T_cv: Transform3D = Transform3D(Basis(quat(q)), Vector3(float(p[0]), float(p[1]), float(p[2])))
	return Transform3D(F, Vector3.ZERO) * T_cv


func _send(cmd: String) -> void:
	udp_out.put_packet(JSON.stringify({"type": "input", "command": cmd}).to_utf8_buffer())
	if Time.get_ticks_msec() / 1000.0 - core_seen > 2.0:       # автономный режим без ядра
		if cmd == "next" or cmd == "photo":
			step_index = mini(step_index + 1, pkg["steps"].size() - 1)
			_apply_step()
		elif cmd == "prev":
			step_index = maxi(step_index - 1, 0)
			_apply_step()


func _unhandled_input(event: InputEvent) -> void:
	if not (event is InputEventKey):
		return
	var ke: InputEventKey = event
	if not ke.pressed or ke.echo:
		return
	match ke.physical_keycode:
		KEY_N: _send("next")
		KEY_B: _send("prev")
		KEY_P: _send("photo")
		KEY_K:
			_send("kd")
			var kd: Array = pkg["steps"][step_index].get("kd", [])
			chat_lines.append("КД: " + (", ".join(kd) if kd.size() > 0 else "нет листа для шага"))
			_update_panel()
			panel.visible = true
		KEY_TAB:
			panel.visible = not panel.visible
		KEY_F:
			full_field = not full_field
			_layout()
		KEY_H:
			help_label.visible = not help_label.visible
