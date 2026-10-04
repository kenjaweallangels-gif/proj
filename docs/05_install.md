# Установка окружения

## 0. Схема рабочего места

| Компонент | Где работает | Зачем |
|---|---|---|
| Unreal Engine 5.x | Windows (рекомендуется) или Linux | движок, редактор |
| Visual Studio 2022 / clang | там же, где UE | сборка C++ модуля |
| Cursor | Windows или Linux | IDE, правила, MCP |
| Claude Code, Codex CLI, Kimi Code | Ubuntu или WSL2 | агенты |
| Оркестратор (Python + PyYAML) | там же, где агенты | маршрутизация задач |
| Blender 4.5 LTS | где удобно | процедурная геометрия, скрипты |
| Unreal MCP, Blender MCP | рядом с агентами | управление редакторами из агентов |
| Houdini, Substance, Marvelous Designer | вручную | инструменты художника (лицензии) |

**Железо.** Минимум для прототипа: RTX 3060 12 ГБ, 32 ГБ ОЗУ, NVMe 1 ТБ. Комфортно: 16 ГБ видеопамяти и больше, 64 ГБ ОЗУ, 2 ТБ NVMe. Сборка UE из исходников: +250–350 ГБ.

**Аккаунты.** Epic Games (UE, Fab/Megascans), Anthropic (Claude Code — подписка Pro/Max или API-ключ), OpenAI (ChatGPT-подписка или API-ключ для Codex), Moonshot (Kimi Code OAuth или API-ключ платформы), Cursor.

## 1. Быстрая установка (Ubuntu 22.04/24.04 или WSL2)

```bash
cd ~/projects/Rakis                         # корень проекта с этим пакетом
chmod +x scripts/*.sh
bash scripts/install_ubuntu.sh --all        # база, Node, агенты, Cursor CLI, Blender, MCP, venv
exec $SHELL -l                              # перечитать PATH
bash scripts/bootstrap_project.sh           # git, LFS, папки, проверка
```

Дополнительные флаги:

```bash
bash scripts/install_ubuntu.sh --nvidia      # драйвер NVIDIA (нативный Linux)
bash scripts/install_ubuntu.sh --ue-source   # Unreal Engine из исходников (Linux)
bash scripts/install_ubuntu.sh --comfy       # ComfyUI для концептов (Flux/SD)
```

## 2. Те же шаги вручную (bash)

### 2.1 База
```bash
sudo apt-get update
sudo apt-get install -y git git-lfs curl wget build-essential cmake unzip p7zip-full \
  python3 python3-venv python3-pip pipx jq ripgrep fd-find ffmpeg imagemagick sox \
  vulkan-tools mesa-utils libvulkan1
git lfs install
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 2.2 Node.js (для Codex и запасного способа установки Claude Code)
```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.nvm/nvm.sh
nvm install 22 && nvm alias default 22
node -v
```

### 2.3 Агенты
```bash
# Claude Code (нативный установщик; запасной вариант — npm)
curl -fsSL https://claude.ai/install.sh | bash
# npm install -g @anthropic-ai/claude-code

# OpenAI Codex CLI
npm install -g @openai/codex

# Kimi Code CLI
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash

# Cursor CLI (необязательный 4-й движок)
curl https://cursor.com/install -fsS | bash

claude --version; codex --version; kimi --version
```

### 2.4 Вход в аккаунты
```bash
claude          # внутри: /login
codex login     # ChatGPT-аккаунт; или export OPENAI_API_KEY=...
kimi            # внутри: /login → Kimi Code OAuth или ключ Moonshot
cursor-agent login
```

### 2.5 Проверка неинтерактивного режима (важно для оркестратора)
```bash
claude -p "Ответь одним словом: готов" --output-format text
codex exec "Ответь одним словом: готов"
kimi --help | less        # найдите флаг неинтерактивного запуска и при необходимости
                          # поправьте engines.kimi.cmd в orchestrator/engines.yaml
```

### 2.6 Blender
```bash
S=4.5
F=$(curl -fsSL https://download.blender.org/release/Blender$S/ | grep -oE "blender-$S\.[0-9]+-linux-x64\.tar\.xz" | sort -uV | tail -1)
wget -O /tmp/$F https://download.blender.org/release/Blender$S/$F
mkdir -p ~/tools && tar -xf /tmp/$F -C ~/tools
ln -sf ~/tools/${F%.tar.xz}/blender ~/.local/bin/blender
blender --version
```

### 2.7 MCP-серверы
```bash
# Blender MCP: сервер через uvx, аддон — в Blender
mkdir -p ~/tools/blender-mcp
curl -fsSL -o ~/tools/blender-mcp/addon.py https://raw.githubusercontent.com/ahujasid/blender-mcp/main/addon.py
# Blender → Edit → Preferences → Add-ons → Install from Disk → addon.py → включить
# В сайдбаре 3D-вида (N) → вкладка BlenderMCP → Connect

# Unreal MCP (сообщество): Python-сервер + плагин в проект
git clone --depth 1 https://github.com/chongdashu/unreal-mcp ~/tools/unreal-mcp
(cd ~/tools/unreal-mcp/Python && uv sync)
cp -r "$(find ~/tools/unreal-mcp -type d -name UnrealMCP -path '*Plugins*' | head -1)" ./Plugins/
# Откройте проект в UE → включите плагин UnrealMCP → перезапуск редактора
```

Подключение MCP к агентам:
```bash
# Cursor — уже в .cursor/mcp.json (проверьте путь к unreal-mcp)
# Claude Code
claude mcp add blender -- uvx blender-mcp
claude mcp add unreal -- uv --directory ~/tools/unreal-mcp/Python run unreal_mcp_server.py
claude mcp list
# Codex — секции [mcp_servers.*] из .codex/config.toml перенести в ~/.codex/config.toml
cat .codex/config.toml >> ~/.codex/config.toml   # затем удалите дубли, если были
# Kimi — внутри kimi: /mcp-config (добавить те же две команды)
```

Если Unreal работает в Windows, а агенты в WSL2: включите в `%UserProfile%\.wslconfig` режим `networkingMode=mirrored` (Windows 11), чтобы MCP-сервер из WSL видел порт плагина UE на `127.0.0.1`.

### 2.8 Оркестратор
```bash
uv venv .venv
uv pip install --python .venv/bin/python pyyaml rich
source .venv/bin/activate
python3 orchestrator/orchestrator.py status
python3 orchestrator/orchestrator.py run --dry-run --max 3
```

## 3. Unreal Engine

### Вариант А — Windows (рекомендуется)
```powershell
# PowerShell от администратора
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install_windows.ps1
```
Далее: Epic Games Launcher → Unreal Engine → установить актуальную 5.x → создать проект **Games → Third Person → C++**, имя `Rakis` → скопировать пакет в корень проекта.

### Вариант Б — Linux из исходников
```bash
# Предварительно: привяжите GitHub к Epic-аккаунту и примите приглашение в организацию EpicGames
git clone --depth 1 -b release https://github.com/EpicGames/UnrealEngine.git ~/UnrealEngine
cd ~/UnrealEngine
./Setup.sh
./GenerateProjectFiles.sh
make UnrealEditor ShaderCompileWorker UnrealPak CrashReportClient
~/UnrealEngine/Engine/Binaries/Linux/UnrealEditor
```
Альтернатива без сборки: готовые Linux-бинарники с unrealengine.com/linux (нужен вход в Epic-аккаунт).

## 4. Сборка и скрипты из CLI (нужно агентам для самопроверки)

Linux:
```bash
UE=~/UnrealEngine
$UE/Engine/Build/BatchFiles/Linux/Build.sh RakisEditor Linux Development -Project="$PWD/Rakis.uproject" -WaitMutex
# Python-скрипт в редакторе без GUI
$UE/Engine/Binaries/Linux/UnrealEditor-Cmd "$PWD/Rakis.uproject" -run=pythonscript -script="$PWD/Tools/unreal_python/level_blockout_desert.py" -unattended -nosplash
# Автотесты
$UE/Engine/Binaries/Linux/UnrealEditor-Cmd "$PWD/Rakis.uproject" -ExecCmds="Automation RunTests Rakis;Quit" -unattended -nullrhi -log
```

Windows (из WSL через `cmd.exe` или в PowerShell):
```powershell
$UE="C:\Program Files\Epic Games\UE_5.6"   # подставьте свою версию
& "$UE\Engine\Build\BatchFiles\Build.bat" RakisEditor Win64 Development -Project="$PWD\Rakis.uproject" -WaitMutex
& "$UE\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "$PWD\Rakis.uproject" -run=pythonscript -script="$PWD\Tools\unreal_python\level_blockout_desert.py" -unattended
```

Включите в проекте плагины: **Python Editor Script Plugin**, **Editor Scripting Utilities**, **PCG**, **StateTree**, **Smart Objects**, **MassEntity / MassGameplay / MassAI**, **Motion Matching / Pose Search**, **Niagara**, **MetaSounds**, **Control Rig**, **UnrealMCP**.

## 5. Инструменты художника (вручную)
| Инструмент | Где взять | Зачем |
|---|---|---|
| Houdini Indie / Apprentice | sidefx.com | процедурная скала, дюны, песок червя |
| Substance 3D Painter / Designer | adobe.com | текстурирование |
| Marvelous Designer | marvelousdesigner.com | дистикомбы, накидки |
| Cascadeur | cascadeur.com | анимация без мокапа |
| Rokoko / Move.ai | rokoko.com / move.ai | недорогой мокап |
| MetaHuman Creator | внутри UE 5.6+ / metahuman.com | лица и тела |
| Quixel Megascans | fab.com | пески, скалы, мусор |

## 6. Проверка готовности
```bash
bash scripts/bootstrap_project.sh      # список ✔/✘ по всем инструментам
python3 orchestrator/orchestrator.py run --task T-001 --no-worktree --dry-run
```
Когда все ✔ и dry-run показывает команды — запускайте первый спринт: `python3 orchestrator/orchestrator.py run --max 3 --parallel 2`.
