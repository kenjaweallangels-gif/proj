#!/usr/bin/env bash
# Проверка системы перед установкой. Ubuntu 24.04 LTS (22.04 тоже работает).
set -u
echo "== ОС"; lsb_release -ds 2>/dev/null || cat /etc/os-release | head -2
echo "== Процессор и память"; nproc; free -h | awk '/Mem/{print "RAM:", $2}'
echo "== Диск в домашней папке"; df -h "$HOME" | tail -1
echo "== Виртуализация"; systemd-detect-virt 2>/dev/null || echo "не определено"
echo "== Видеокарта"; lspci 2>/dev/null | grep -Ei 'vga|3d|display' || echo "lspci недоступен"
if command -v nvidia-smi >/dev/null; then nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv; fi
echo "== OpenGL"; (command -v glxinfo >/dev/null && glxinfo -B | grep -E 'OpenGL renderer|OpenGL version') || echo "glxinfo нет (установит 01_install_base.sh)"
echo "== Vulkan"; (command -v vulkaninfo >/dev/null && vulkaninfo --summary 2>/dev/null | grep -E 'deviceName|apiVersion' | head -4) || echo "vulkaninfo нет"
echo
echo "Требования:"
echo "  минимум  4 ядра, 16 ГБ RAM, 40 ГБ диска, GPU с OpenGL 3.3 / Vulkan 1.2"
echo "  комфорт  8 ядер, 32 ГБ RAM, NVIDIA RTX 3060 и выше (драйвер 550+)"
echo "Если renderer = llvmpipe — 3D идёт программно: годится для тестов, но не для работы с Godot. См. vm_gpu_notes.md"
