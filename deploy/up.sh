#!/usr/bin/env sh
# Первый запуск одной командой: .env → сертификат → сборка → старт → загрузка локальной LLM.
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  SECRET=$(python3 -c "import secrets;print(secrets.token_urlsafe(48))" 2>/dev/null || openssl rand -base64 48 | tr -d '\n=/+')
  PGPASS=$(openssl rand -hex 16)
  sed -i.bak "s|^PLM_SECRET_KEY=.*|PLM_SECRET_KEY=$SECRET|; s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PGPASS|" .env && rm -f .env.bak
  echo "Создан .env со случайными паролями."
fi
[ -f certs/plm.crt ] || sh ./make-certs.sh "${1:-plm.corp.local}"

if [ "${WITH_LLM:-0}" = "1" ]; then
  sed -i.bak "s|^PLM_LOCAL_LLM_ENABLED=.*|PLM_LOCAL_LLM_ENABLED=true|; s|^PLM_LOCAL_LLM_URL=.*|PLM_LOCAL_LLM_URL=http://ollama:11434/v1|" .env && rm -f .env.bak
  docker compose --profile llm up -d --build
else
  docker compose up -d --build
fi
echo
echo "Ожидание готовности приложения..."
for i in $(seq 1 60); do
  if docker compose exec -T app python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/api/health')" >/dev/null 2>&1; then
    echo "Приложение запущено: https://localhost  (или https://${1:-plm.corp.local})"; break
  fi
  sleep 2
done

if [ "${WITH_LLM:-0}" = "1" ]; then
  MODEL=$(grep '^PLM_LOCAL_LLM_MODEL=' .env | cut -d= -f2)
  echo "Загрузка локальной LLM ${MODEL:-qwen2.5:14b-instruct} (~9 ГБ)..."
  docker compose exec -T ollama ollama pull "${MODEL:-qwen2.5:14b-instruct}" || echo "Не удалось загрузить модель — ассистент будет работать в режиме команд."
else
  echo "Контейнер с LLM не разворачивался. Свои модели на этом ПК: задайте PLM_LOCAL_LLM_ENABLED=true, PLM_LOCAL_LLM_URL и PLM_LOCAL_LLM_MODEL в .env,"
  echo "затем: docker compose up -d app. Проверка — в интерфейсе: Ещё → Пользователи, роли → ИИ-ассистент → «Проверить подключение»."
fi
echo
echo "Вход: admin / admin12345   Логи: docker compose logs -f app"
