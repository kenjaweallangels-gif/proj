#!/usr/bin/env bash
# Установка окружения «Rakis: Heretics» на Ubuntu 22.04 / 24.04 (в т.ч. WSL2).
# Использование:
#   bash scripts/install_ubuntu.sh --all            # всё, кроме сборки UE из исходников и ComfyUI
#   bash scripts/install_ubuntu.sh --base --agents  # выборочно
# Флаги: --base --node --agents --cursor-cli --blender --mcp --venv --nvidia --ue-source --comfy --all
set -euo pipefail

TOOLS="${TOOLS:-$HOME/tools}"
NODE_MAJOR="${NODE_MAJOR:-22}"
BLENDER_SERIES="${BLENDER_SERIES:-4.5}"          # LTS-ветка Blender
UE_BRANCH="${UE_BRANCH:-release}"                # ветка EpicGames/UnrealEngine
UE_DIR="${UE_DIR:-$HOME/UnrealEngine}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

c_ok()   { printf '\e[32m✔ %s\e[0m\n' "$*"; }
c_info() { printf '\e[36m➜ %s\e[0m\n' "$*"; }
c_warn() { printf '\e[33m⚠ %s\e[0m\n' "$*"; }
have()   { command -v "$1" >/dev/null 2>&1; }
is_wsl() { grep -qi microsoft /proc/version 2>/dev/null; }

usage() { sed -n '2,8p' "$0"; exit 0; }
[[ $# -eq 0 ]] && usage

DO_BASE=0 DO_NODE=0 DO_AGENTS=0 DO_CURSOR=0 DO_BLENDER=0 DO_MCP=0 DO_VENV=0 DO_NVIDIA=0 DO_UE=0 DO_COMFY=0
for a in "$@"; do
  case "$a" in
    --base) DO_BASE=1;; --node) DO_NODE=1;; --agents) DO_AGENTS=1;; --cursor-cli) DO_CURSOR=1;;
    --blender) DO_BLENDER=1;; --mcp) DO_MCP=1;; --venv) DO_VENV=1;; --nvidia) DO_NVIDIA=1;;
    --ue-source) DO_UE=1;; --comfy) DO_COMFY=1;;
    --all) DO_BASE=1 DO_NODE=1 DO_AGENTS=1 DO_CURSOR=1 DO_BLENDER=1 DO_MCP=1 DO_VENV=1;;
    -h|--help) usage;;
    *) c_warn "Неизвестный флаг $a"; usage;;
  esac
done
mkdir -p "$TOOLS"

# ---------- 1. Базовые пакеты ----------
if (( DO_BASE )); then
  c_info "Базовые пакеты"
  sudo apt-get update
  sudo apt-get install -y \
    git git-lfs curl wget ca-certificates gnupg build-essential cmake unzip zip p7zip-full \
    python3 python3-venv python3-pip pipx jq ripgrep fd-find tree htop \
    ffmpeg imagemagick sox \
    vulkan-tools mesa-utils libvulkan1 libxkbcommon0 libxi6 libxrender1 libsm6 libgl1 \
    xz-utils xdg-utils
  git lfs install
  if ! have uv; then curl -LsSf https://astral.sh/uv/install.sh | sh; fi
  export PATH="$HOME/.local/bin:$PATH"
  c_ok "База, git-lfs, uv"
fi

# ---------- 2. Node.js через nvm ----------
if (( DO_NODE || DO_AGENTS )); then
  if ! have node || [[ "$(node -v | tr -d v | cut -d. -f1)" -lt 20 ]]; then
    c_info "Node.js $NODE_MAJOR через nvm"
    export NVM_DIR="$HOME/.nvm"
    [[ -s "$NVM_DIR/nvm.sh" ]] || curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm install "$NODE_MAJOR" && nvm alias default "$NODE_MAJOR"
  fi
  c_ok "Node $(node -v)"
fi

# ---------- 3. Агенты: Claude Code, Codex, Kimi Code ----------
if (( DO_AGENTS )); then
  export NVM_DIR="$HOME/.nvm"; [[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
  export PATH="$HOME/.local/bin:$PATH"

  c_info "Claude Code"
  if ! have claude; then
    curl -fsSL https://claude.ai/install.sh | bash || npm install -g @anthropic-ai/claude-code
  fi
  c_ok "claude: $(claude --version 2>/dev/null || echo 'перезапустите shell')"

  c_info "OpenAI Codex CLI"
  have codex || npm install -g @openai/codex
  c_ok "codex: $(codex --version 2>/dev/null || echo 'перезапустите shell')"

  c_info "Kimi Code CLI"
  have kimi || curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
  c_ok "kimi: $(kimi --version 2>/dev/null || echo 'перезапустите shell')"
fi

# ---------- 4. Cursor CLI (редактор ставится отдельно) ----------
if (( DO_CURSOR )); then
  c_info "Cursor CLI (cursor-agent)"
  have cursor-agent || curl https://cursor.com/install -fsS | bash
  c_warn "Редактор Cursor: скачайте AppImage/.deb с https://cursor.com/downloads (на Windows — install_windows.ps1)"
fi

# ---------- 5. Blender ----------
if (( DO_BLENDER )); then
  c_info "Blender $BLENDER_SERIES LTS"
  if ! have blender; then
    DIR_URL="https://download.blender.org/release/Blender${BLENDER_SERIES}/"
    FILE=$(curl -fsSL "$DIR_URL" | grep -oE "blender-${BLENDER_SERIES}\.[0-9]+-linux-x64\.tar\.xz" | sort -uV | tail -1 || true)
    if [[ -n "$FILE" ]]; then
      wget -q --show-progress -O "/tmp/$FILE" "$DIR_URL$FILE"
      tar -xf "/tmp/$FILE" -C "$TOOLS"
      ln -sf "$TOOLS/${FILE%.tar.xz}/blender" "$HOME/.local/bin/blender"
    elif ! is_wsl && have snap; then
      sudo snap install blender --classic
    else
      c_warn "Не удалось определить сборку Blender — установите вручную с blender.org"
    fi
  fi
  have blender && c_ok "$(blender --version 2>/dev/null | head -1)"
fi

# ---------- 6. MCP: Blender и Unreal ----------
if (( DO_MCP )); then
  export PATH="$HOME/.local/bin:$PATH"
  c_info "Blender MCP (сервер запускается через uvx, аддон — вручную в Blender)"
  mkdir -p "$TOOLS/blender-mcp"
  curl -fsSL -o "$TOOLS/blender-mcp/addon.py" \
    https://raw.githubusercontent.com/ahujasid/blender-mcp/main/addon.py || c_warn "addon.py не скачан"
  uvx blender-mcp --help >/dev/null 2>&1 || true
  c_ok "Аддон: Blender → Edit → Preferences → Add-ons → Install from Disk → $TOOLS/blender-mcp/addon.py"

  c_info "Unreal MCP (сервер + плагин для проекта)"
  [[ -d "$TOOLS/unreal-mcp" ]] || git clone --depth 1 https://github.com/chongdashu/unreal-mcp "$TOOLS/unreal-mcp"
  (cd "$TOOLS/unreal-mcp/Python" && uv sync) || c_warn "uv sync не прошёл — зависимости подтянутся при первом 'uv run'"
  PLUGIN_SRC=$(find "$TOOLS/unreal-mcp" -type d -name UnrealMCP -path '*Plugins*' | head -1 || true)
  if [[ -n "$PLUGIN_SRC" && -f "$PROJECT_DIR/Rakis.uproject" ]]; then
    mkdir -p "$PROJECT_DIR/Plugins" && cp -r "$PLUGIN_SRC" "$PROJECT_DIR/Plugins/"
    c_ok "Плагин UnrealMCP скопирован в $PROJECT_DIR/Plugins"
  else
    c_warn "Плагин UnrealMCP: скопируйте $PLUGIN_SRC в <проект>/Plugins/ после создания Rakis.uproject"
  fi
  sed -i "s#/home/USER#$HOME#g" "$PROJECT_DIR/.codex/config.toml" 2>/dev/null || true
fi

# ---------- 7. Python-окружение оркестратора ----------
if (( DO_VENV )); then
  export PATH="$HOME/.local/bin:$PATH"
  c_info "venv оркестратора"
  cd "$PROJECT_DIR"
  uv venv .venv
  uv pip install --python .venv/bin/python pyyaml rich
  c_ok "Активация: source .venv/bin/activate"
fi

# ---------- 8. Драйвер NVIDIA (не для WSL) ----------
if (( DO_NVIDIA )); then
  if is_wsl; then
    c_warn "WSL: драйвер ставится в Windows, внутри WSL ничего не нужно"
  elif ! have nvidia-smi; then
    sudo apt-get install -y ubuntu-drivers-common
    sudo ubuntu-drivers install
    c_warn "Перезагрузите систему после установки драйвера"
  fi
  have nvidia-smi && nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
fi

# ---------- 9. Unreal Engine из исходников (Linux) ----------
if (( DO_UE )); then
  if is_wsl; then c_warn "Под WSL ставьте UE в Windows (Epic Games Launcher)"; else
  c_info "Unreal Engine ($UE_BRANCH) — нужен доступ к github.com/EpicGames (привяжите GitHub к Epic-аккаунту)"
  df -h "$HOME" | tail -1
  c_warn "Нужно ~250–350 ГБ свободного места и 32+ ГБ ОЗУ; сборка 1–4 часа"
  [[ -d "$UE_DIR" ]] || git clone --depth 1 -b "$UE_BRANCH" https://github.com/EpicGames/UnrealEngine.git "$UE_DIR"
  cd "$UE_DIR"
  ./Setup.sh
  ./GenerateProjectFiles.sh
  make UnrealEditor ShaderCompileWorker UnrealPak CrashReportClient
  ln -sf "$UE_DIR/Engine/Binaries/Linux/UnrealEditor" "$HOME/.local/bin/UnrealEditor"
  c_ok "UnrealEditor собран"
  fi
fi

# ---------- 10. ComfyUI для концептов (опционально) ----------
if (( DO_COMFY )); then
  export PATH="$HOME/.local/bin:$PATH"
  c_info "ComfyUI"
  [[ -d "$TOOLS/ComfyUI" ]] || git clone --depth 1 https://github.com/comfyanonymous/ComfyUI "$TOOLS/ComfyUI"
  cd "$TOOLS/ComfyUI"
  uv venv --python 3.12 .venv
  uv pip install --python .venv/bin/python torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
  uv pip install --python .venv/bin/python -r requirements.txt
  c_ok "Запуск: $TOOLS/ComfyUI/.venv/bin/python $TOOLS/ComfyUI/main.py --listen 127.0.0.1"
fi

echo
c_ok "Готово. Дальше:"
cat <<'EOF'
  exec $SHELL -l                 # перечитать PATH
  claude        → /login
  codex login
  kimi          → /login
  cursor-agent login   (если ставили)
  bash scripts/bootstrap_project.sh
EOF
