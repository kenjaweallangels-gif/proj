extends Camera3D
## Голова сборщика в симуляторе: WASD — шаг, Q/E — вниз/вверх, ПКМ + мышь — поворот головы, Shift — быстрее.
## Лёгкое «дыхание» головы (как у живого человека) включено по умолчанию — проверяет устойчивость голограмм.
## Поза головы отправляется ядру (UDP :47101, {"type":"head"}) 30 раз в секунду — docs/02_hal_contracts.md.

const SEND_HZ: float = 30.0

@export var move_speed: float = 0.8          # м/с
@export var look_sens: float = 0.0035        # рад/пиксель
@export var breathing: bool = true

var yaw: float = 0.0
var pitch: float = 0.0
var base_pos: Vector3
var t: float = 0.0
var send_acc: float = 0.0
var udp: PacketPeerUDP = PacketPeerUDP.new()


func _ready() -> void:
	udp.set_dest_address("127.0.0.1", 47101)


## Поставить голову в точку eye и смотреть на target.
func place(eye: Vector3, target: Vector3) -> void:
	base_pos = eye
	var d: Vector3 = (target - eye).normalized()
	yaw = atan2(-d.x, -d.z)
	pitch = asin(clampf(d.y, -1.0, 1.0))
	_apply(0.0)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		var mm: InputEventMouseMotion = event
		yaw -= mm.relative.x * look_sens
		pitch = clampf(pitch - mm.relative.y * look_sens, deg_to_rad(-85.0), deg_to_rad(85.0))


func _process(delta: float) -> void:
	t += delta
	var dir: Vector3 = Vector3.ZERO
	if Input.is_physical_key_pressed(KEY_W): dir.z -= 1.0
	if Input.is_physical_key_pressed(KEY_S): dir.z += 1.0
	if Input.is_physical_key_pressed(KEY_A): dir.x -= 1.0
	if Input.is_physical_key_pressed(KEY_D): dir.x += 1.0
	if Input.is_physical_key_pressed(KEY_E): dir.y += 1.0
	if Input.is_physical_key_pressed(KEY_Q): dir.y -= 1.0
	if dir != Vector3.ZERO:
		var spd: float = move_speed * (3.0 if Input.is_physical_key_pressed(KEY_SHIFT) else 1.0)
		var flat: Basis = Basis(Vector3.UP, yaw)
		var h: Vector3 = Vector3(dir.x, 0.0, dir.z)
		if h != Vector3.ZERO:
			base_pos += (flat * h).normalized() * spd * delta
		base_pos.y += dir.y * spd * delta
	_apply(t)
	send_acc += delta
	if send_acc >= 1.0 / SEND_HZ:
		send_acc = 0.0
		var q: Quaternion = global_transform.basis.get_rotation_quaternion()
		var p: Vector3 = global_position
		var msg: Dictionary = {"type": "head", "t_ns": Time.get_ticks_usec() * 1000,
			"position_m": [p.x, p.y, p.z], "rotation_xyzw": [q.x, q.y, q.z, q.w]}
		udp.put_packet(JSON.stringify(msg).to_utf8_buffer())


func _apply(time_s: float) -> void:
	var bob: Vector3 = Vector3.ZERO
	var sway: float = 0.0
	if breathing:
		bob = Vector3(0.002 * sin(time_s * 0.9), 0.004 * sin(time_s * 1.6), 0.0)
		sway = deg_to_rad(0.3) * sin(time_s * 0.7)
	transform = Transform3D(Basis.from_euler(Vector3(pitch, yaw + sway, 0.0), EULER_ORDER_YXZ), base_pos + bob)
