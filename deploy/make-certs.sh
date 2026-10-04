#!/usr/bin/env sh
# Самоподписанный сертификат для первого запуска / тестового стенда.
# В проде замените certs/plm.crt и certs/plm.key сертификатом от корпоративного CA.
set -e
cd "$(dirname "$0")"
HOST="${1:-plm.corp.local}"
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout certs/plm.key -out certs/plm.crt \
  -subj "/CN=$HOST/O=PLM" \
  -addext "subjectAltName=DNS:$HOST,DNS:localhost,IP:127.0.0.1"
echo "Сертификат создан: certs/plm.crt (CN=$HOST). Браузер покажет предупреждение — это ожидаемо для самоподписанного."
