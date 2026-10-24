#!/usr/bin/env bash
# «Орбитальная станция Аврора» — launcher for Ubuntu / Linux.
# Finds the app (installed .deb, AppImage, unpacked build or the development checkout) and starts it.
#
#   ./start-desktop.sh [app flags]             e.g. --quality=ultra --fullscreen --vsync=off
#   ./start-desktop.sh --gpu-info              print the GPU / WebGL / WebGPU diagnostics and exit
#   ./start-desktop.sh --install-shortcut      add a menu entry + icon for the AppImage / unpacked build (~/.local)
#   ORBITAL_APP=/path/to/app ./start-desktop.sh   use a specific executable or AppImage
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

find_app() {
  if [ -n "${ORBITAL_APP:-}" ] && [ -x "$ORBITAL_APP" ]; then echo "$ORBITAL_APP"; return; fi
  local c
  for c in "$HERE"/*.AppImage "$ROOT"/release/*.AppImage "$HERE"/linux-unpacked/orbital-station-aurora "$ROOT"/release/linux-unpacked/orbital-station-aurora; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
  command -v orbital-station-aurora 2>/dev/null && return   # installed .deb (/usr/bin -> /opt/…)
  if [ -x "$ROOT/node_modules/.bin/electron" ] && [ -f "$ROOT/package.json" ]; then echo "DEV"; return; fi
  echo ""
}

APP="$(find_app)"
if [ -z "$APP" ]; then
  echo "Приложение не найдено. Соберите его: npm ci && npm run dist:linux  (или установите .deb). См. desktop/README-RU.md" >&2
  exit 1
fi

if [ "${1:-}" = "--install-shortcut" ]; then
  [ "$APP" = "DEV" ] && { echo "Сначала соберите приложение: npm run dist:linux" >&2; exit 1; }
  ICON_SRC="$HERE/build/icons/512x512.png"; [ -f "$ICON_SRC" ] || ICON_SRC="$ROOT/desktop/build/icons/512x512.png"
  mkdir -p "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps"
  [ -f "$ICON_SRC" ] && cp "$ICON_SRC" "$HOME/.local/share/icons/hicolor/512x512/apps/orbital-station-aurora.png"
  cat > "$HOME/.local/share/applications/orbital-station-aurora.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Орбитальная станция Аврора
GenericName=Космический симулятор
Comment=3D-сцена орбитальной станции с выходом в открытый космос
Exec="$HERE/start-desktop.sh" %U
Icon=orbital-station-aurora
Terminal=false
Categories=Game;Simulation;
StartupWMClass=orbital-station-aurora
PrefersNonDefaultGPU=true
X-KDE-RunOnDiscreteGpu=true
Actions=Fullscreen;GpuInfo;

[Desktop Action Fullscreen]
Name=Полный экран
Exec="$HERE/start-desktop.sh" --fullscreen

[Desktop Action GpuInfo]
Name=Сведения о GPU (в терминале)
Terminal=true
Exec="$HERE/start-desktop.sh" --gpu-info-wait
EOF
  command -v update-desktop-database >/dev/null && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1
  echo "Ярлык добавлен в меню приложений: «Орбитальная станция Аврора» ($APP)"
  exit 0
fi

# AppImage without libfuse2 (Ubuntu 22.04+: sudo apt install libfuse2 / 24.04: libfuse2t64): run extracted
if [[ "$APP" == *.AppImage ]] && ! ldconfig -p 2>/dev/null | grep -q 'libfuse.so.2'; then
  echo "libfuse2 не установлена — AppImage запускается с распаковкой (медленнее старт). Установите: sudo apt install libfuse2t64 (24.04) или libfuse2 (22.04)" >&2
  export APPIMAGE_EXTRACT_AND_RUN=1
fi

if [ "${1:-}" = "--gpu-info-wait" ]; then   # menu action: keep the terminal open
  shift; "$0" --gpu-info "$@"; read -r -p "Enter — закрыть" _; exit 0
fi

if [ "$APP" = "DEV" ]; then
  cd "$ROOT" || exit 1
  [ -f dist/index.html ] || npx vite build || exit 1
  exec "$ROOT/node_modules/.bin/electron" "$ROOT" "$@"
fi
exec "$APP" "$@"
