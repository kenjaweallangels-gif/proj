# Виртуальная машина и видеокарта

3D-симулятор (Godot) и рендер синтетических кадров требуют GPU. Варианты от лучшего к простому:

| Вариант | Скорость 3D | Как |
|---|---|---|
| **Ubuntu прямо на ПК/сервере с GPU** | полная | Установить драйвер NVIDIA: `sudo ubuntu-drivers install`, перезагрузка, `nvidia-smi` |
| **ВМ с пробросом GPU (VFIO)** | почти полная | Proxmox или KVM/libvirt: включить IOMMU (`intel_iommu=on` или `amd_iommu=on`), отдать видеокарту ВМ целиком (PCI passthrough). В ВМ — драйвер NVIDIA как на железе |
| **ВМ VMware Workstation / VirtualBox с 3D** | низкая–средняя | Включить 3D-ускорение; OpenGL 3.3/4.x через SVGA. Godot запускать с `--rendering-driver opengl3`. Для разработки ядра хватает |
| **ВМ без GPU / CI** | программно | Mesa llvmpipe: `xvfb-run -a -s "-screen 0 1600x900x24" godot --path godot --audio-driver Dummy -- --screenshot=out.png` (`make sim-shot`). Проверено: Godot 4.7 + Mesa 25 llvmpipe, рендер gl_compatibility. `--headless` не рисует вообще — годится только для `--selftest` |
| **WSL2 на Windows** | средняя | Ubuntu 24.04 в WSL2 с WSLg и драйвером GPU Windows; v4l2loopback недоступен — камеру отдавать по UDP |

Проверка: `glxinfo -B` → `OpenGL renderer` должен быть вашей видеокартой, а не `llvmpipe`.

## Рекомендуемая конфигурация стенда
- Ubuntu 24.04 на сервере с RTX 3060 12 ГБ: симулятор, автотесты, сервер приложения, PostgreSQL.
- Рабочее место разработчика — любой ПК с Cursor/VS Code, подключение к стенду по Remote-SSH.
- ВМ для сервера цеха (без GPU): только Docker с `server` и `postgres`.

## Ресурсы ВМ
4–8 vCPU, 16–32 ГБ RAM, 60 ГБ диска (модели, записи сеансов, образы Docker).
