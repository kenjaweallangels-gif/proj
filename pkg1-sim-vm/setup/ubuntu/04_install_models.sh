#!/usr/bin/env bash
# Офлайн-модель русской речи Vosk (Apache-2.0).
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p models/vosk
cd models/vosk
if [ ! -d vosk-model-small-ru-0.22 ]; then
  curl -fL -o small-ru.zip https://alphacephei.com/vosk/models/vosk-model-small-ru-0.22.zip   # 45 МБ
  unzip -q small-ru.zip && rm small-ru.zip
fi
# Большая серверная модель (1,8 ГБ) — для диктовки в чат на сервере, по желанию:
# curl -fL -o ru-0.42.zip https://alphacephei.com/vosk/models/vosk-model-ru-0.42.zip && unzip -q ru-0.42.zip
echo "OK: модель в pkg1-sim-vm/models/vosk/vosk-model-small-ru-0.22"
