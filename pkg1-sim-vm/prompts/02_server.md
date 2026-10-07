# 02. Сервер участка: миграции, файлы, пульт мастера, очередь клиента

Контекст: `server/app.py`, `server/db.py`, `tests/test_server.py`, `docs/01_architecture.md`, `docs/03_data_model.md`.

Задача:
1. Alembic: начальная миграция из текущих моделей, `make db-migrate`. `create_all` оставить только для SQLite в тестах.
2. Загрузка файлов пакета: `POST /api/operations/{id}/files` (GLB, PNG листов КД) в `AR_DATA_DIR/files/<op>/<rev>/`;
   `GET /api/operations/{id}/bundle` — zip «пакет + файлы» для кэша на очках. Проверка: имя узла не меняется, размер ≤ 200 МБ.
3. Ревизии: хранить все ревизии пакета, `GET /api/operations/{id}?revision=Б`. Выполнение ссылается на ревизию.
4. Пульт мастера: `server/static/master.html` (без сборщиков, чистый JS): список идущих выполнений, текущий шаг, превышение
   нормы (событие `over_norm`), чат. Обновление по WebSocket `/ws/runs`.
5. Клиентская очередь `core/arcore/io/sync.py`: события копятся в SQLite на устройстве, досылаются пачками, идемпотентно
   (поле `client_event_id`, сервер игнорирует повтор).

Ограничения: только локальная сеть, токен устройства как сейчас; ни кадров, ни аудио на сервер.

Критерии приёмки: тесты на ревизии, bundle, повторную досылку (0 дублей), обрыв сети (события не теряются);
`docker compose up` поднимает PostgreSQL + сервер, `curl :8080/api/health` → ok.
Проверка: `make test`, `make db-up && docker compose up -d server && curl localhost:8080/api/health`.
