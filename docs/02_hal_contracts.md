# 02. Контракты HAL и обмена

Эти интерфейсы одинаковы для симулятора, записей и реальных очков. Не меняй их без согласования.
Реализация: `pkg1-sim-vm/core/arcore/hal.py`.

## Типы

```python
@dataclass(frozen=True)
class CameraIntrinsics:
    width: int; height: int
    fx: float; fy: float; cx: float; cy: float
    dist: tuple[float, ...] = (0, 0, 0, 0, 0)   # k1 k2 p1 p2 k3 (OpenCV)

@dataclass(frozen=True)
class Frame:
    t_ns: int                 # время кадра, наносекунды, монотонное
    image: np.ndarray         # BGR uint8, HxWx3
    K: CameraIntrinsics

@dataclass(frozen=True)
class Pose6D:
    t_ns: int
    position_m: np.ndarray    # (3,) метры, мировая СК устройства
    rotation_xyzw: np.ndarray # (4,) кватернион

@dataclass(frozen=True)
class ImuSample:
    t_ns: int; gyro: np.ndarray; accel: np.ndarray  # рад/с, м/с²
```

## Интерфейсы

```python
class FrameSource(Protocol):
    def next_frame(self) -> Frame | None: ...        # None — поток закончился

class PoseSource(Protocol):
    def pose_at(self, t_ns: int) -> Pose6D | None: ...  # поза головы (камеры очков) в момент t

class ImuSource(Protocol):
    def samples(self, t0_ns: int, t1_ns: int) -> list[ImuSample]: ...

class AudioSource(Protocol):
    def chunks(self) -> Iterator[bytes]: ...         # PCM16 mono 16 кГц, блоки по 20 мс

class DisplaySink(Protocol):
    fov_diag_deg: float                              # 52 для Luma Ultra
    def publish(self, msg: dict) -> None: ...        # в клиент отображения (UDP JSON)
```

Фабрика: `make_rig(name: str, **cfg) -> Rig`, где `Rig` содержит `frames`, `poses`, `imu`, `audio`, `display`.
Имена: `sim`, `replay`, `viture`. Выбор — переменная окружения `AR_RIG`.

## Протокол ядро → клиент (UDP JSON, порт 47100)

Каждое сообщение — одна строка JSON, поле `type` обязательно.

```json
{"type":"anchor","t_ns":123,"frame":"fixture_top_center","position_m":[0.1,-0.4,0.7],"rotation_xyzw":[0.7,0,0,0.7],"quality":0.93,"reproj_px":0.4,"markers":[7,12,23]}
{"type":"step","op":"040","index":2,"total":6,"id":"S3","title":"Кронштейн К-205 (правый)","state":"showing","speed":1.0,"need":null}
{"type":"scale_check","ok":true,"scale":1.004}
{"type":"chat","author":"Технолог","role":"technologist","text":"Тяги на зазор 3±1 мм","step_id":"S4"}
```
- `anchor` — поза СК операции **в СК камеры OpenCV** (X вправо, Y вниз, Z вперёд), метры, кватернион [x,y,z,w].
  В Godot: `T_godot_cam_op = diag(1,−1,−1) · T_cv` (см. `godot/scripts/main.gd: _cv_to_godot`).
- `anchor.frame` — имя системы координат из пакета операции (`anchors.reference_frame`).
- Клиент ставит корень сцены изделия в `anchor` и дальше рисует всё в координатах операции.
- `step.state` — состояние движка (`aligning`, `manual_align`, `showing`, `waiting_value`, `waiting_photo`, `done`),
  `need` — чего ждёт шаг (`value` | `photo` | null). Реализация: `core/arcore/steps/engine.py: StepEngine.message()`.

## Протокол клиент → ядро (UDP JSON, порт 47101)
```json
{"type":"input","command":"next"}                       // кнопка/клавиша/жест вместо голоса
{"type":"input","command":"value","value":1.2}          // введённое значение (момент, зазор)
{"type":"voice","text":"сборка дальше"}                 // распознанная фраза (Vosk на клиенте или ввод текстом в симуляторе)
{"type":"head","position_m":[...],"rotation_xyzw":[...],"t_ns":...}   // только в режиме sim из Godot (поза головы, Y вверх)
```
Разбор — `core/arcore/app.py` (цикл) и `core/arcore/voice/commands.py` (фразы).

## Запись сеансов (ReplayRig)
Формат EuRoC MAV: `cam0/data/<t_ns>.png`, `cam0/data.csv`, `imu0/data.csv`, `pose_gt.csv` (если есть), `intrinsics.yaml`.
Тот же формат понимает Monado (драйвер euroc) — можно гонять сторонние SLAM.

## Реальные очки (VitureRig) — что известно
- VITURE XR Glasses SDK (C): Linux x86_64/aarch64, Windows, Android, macOS; 3DoF/6DoF; для Luma Ultra 6DoF через VIO «Carina»
  и RGB-камера 1080p (MJPEG, UVC). SDK закрытый, выдаётся через программу разработчиков: https://www.viture.com/developer
- Пример стороннего использования на Linux: https://github.com/brianhasquestions/Viture_AR_Playground
- До получения SDK `VitureRig` — заглушка, которая падает с понятным сообщением. Камеру UVC можно брать через `cv2.VideoCapture`.
