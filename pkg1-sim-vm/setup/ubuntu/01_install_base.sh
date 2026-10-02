#!/usr/bin/env bash
# Базовые пакеты: сборка, Python, медиа, OpenGL/Vulkan-утилиты, poppler (КД), Node.js (gltf-transform), Docker.
set -euo pipefail
sudo apt-get update
sudo apt-get install -y \
  build-essential cmake git git-lfs curl wget unzip pkg-config ca-certificates \
  python3 python3-venv python3-dev python3-pip \
  ffmpeg v4l-utils libgl1 libglib2.0-0 libegl1 libxkbcommon0 \
  mesa-utils vulkan-tools libvulkan1 \
  poppler-utils \
  portaudio19-dev libasound2-dev pulseaudio-utils \
  xvfb
# Node.js 24 LTS (для gltf-transform и веб-демо на Vite 8; Node 20 снят с поддержки в апреле 2026)
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
sudo npm install -g @gltf-transform/cli
# Docker (для PostgreSQL и сервера); если уже стоит — пропускается
if ! command -v docker >/dev/null; then
  sudo apt-get install -y docker.io docker-compose-v2
  sudo usermod -aG docker "$USER"
  echo "Docker установлен. Перелогиньтесь, чтобы работать без sudo."
fi
git lfs install
echo "OK: базовые пакеты установлены"
