#!/usr/bin/env bash
# Godot 4 (MIT). Версия по умолчанию — 4.7-stable (июнь 2026). Проверьте актуальную: https://godotengine.org/download/archive/
set -euo pipefail
GODOT_VERSION="${GODOT_VERSION:-4.7}"
DEST="${GODOT_DEST:-$HOME/.local/opt/godot}"
mkdir -p "$DEST" "$HOME/.local/bin"
ZIP="Godot_v${GODOT_VERSION}-stable_linux.x86_64.zip"
URL="https://github.com/godotengine/godot-builds/releases/download/${GODOT_VERSION}-stable/${ZIP}"
echo "Скачиваю $URL"
cd "$DEST"
curl -fL -o "$ZIP" "$URL" || { echo "Не скачалось. Скачайте вручную с godotengine.org в $DEST и запустите скрипт снова."; exit 1; }
unzip -o "$ZIP"
BIN="$DEST/Godot_v${GODOT_VERSION}-stable_linux.x86_64"
chmod +x "$BIN"
ln -sf "$BIN" "$HOME/.local/bin/godot"
echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
"$BIN" --version || true
echo "OK: godot установлен, команда: godot"
echo "Шаблоны экспорта (Android/Linux) ставятся из редактора: Editor → Manage Export Templates."
