# IMPLEMENTATION ROADMAP

Этот документ фиксирует план реализации и контроль качества для проекта `admin-service`.
Используется как единая ссылка для новых чатов и выполнения этапов.

## Статус этапов

- [x] Этап 1. Безопасность API (`ADMIN_TOKEN`, auth middleware, CORS)  
  Примечание: выполнен в соседней ветке (по вашему подтверждению).
- [x] Этап 2. Подключить bulk delete в `admin-ui`.  
  Примечание: выполнено (чекбоксы выбора, массовое удаление через `POST /cars/bulk-delete`).
- [x] Этап 3. Добавить серверные фильтры и пагинацию в `GET /cars`.  
  Примечание: выполнено (`q/country/status/диапазоны/boolean-флаги/sort` + `page/per_page` с `pagination` в ответе).
- [x] Этап 4. Перевести `site` каталог и таблицу `admin-ui` на серверные фильтры/пагинацию `GET /cars`.  
  Примечание: выполнено (`admin-ui` использует query + server pagination; `site` каталог использует query + server pagination через `page/per_page` и `pagination.has_next`).
- [x] Этап 5. Перевести карточку сайта на `GET /cars/:id`.  
  Примечание: выполнено (`site` карточка загружает автомобиль через `GET /cars/:id`).
- [x] Этап 6. Убрать full snapshot rewrite в SQLite (чистый SQL CRUD + transaction).  
  Примечание: выполнено (`sqlite` mutation-поток переведен на SQL CRUD-операции с транзакциями; runtime больше не делает full rewrite всех `cars`/`car_photos`).
- [x] Этап 7. Добавить OpenAPI + валидацию входных payload.  
  Примечание: выполнено (`GET /openapi.json` + `Ajv`-валидация JSON payload для `POST /cars`, `PATCH /cars/:id`, `POST /cars/bulk-delete`, `PATCH /cars/:id/photos/reorder`).
- [x] Этап 8. Добавить backup/restore/rollback скрипты.  
  Примечание: выполнено (`db:backup`, `db:restore`, `db:rollback`; snapshot `DATA_ROOT/data` + `DATA_ROOT/assets/cars`; safety backup перед restore/rollback).
- [x] Этап 9. Финал: интеграционные тесты + e2e smoke + финальная дока.  
  Примечание: выполнено (`integration-api-sqlite` + `e2e-smoke-web` + `verify:final`; добавлена `FINAL_RELEASE_DOC.md`).

## Порядок работ

1. Безопасность API (auth + CORS).
2. Bulk delete в admin-ui.
3. Серверные фильтры/пагинация в `GET /cars`.
4. Перевод `site` каталога и таблицы `admin-ui` на серверные фильтры/пагинацию.
5. Карточка сайта через `GET /cars/:id`.
6. SQLite-репозиторий без полного rewrite таблицы.
7. OpenAPI и валидация.
8. Backup/restore/rollback.
9. Тесты и финальный регресс.

## Критерии готовности этапа

- Каждый этап сохраняет обратную совместимость API.
- Нет ломающих изменений формата ответов без флага/версии.
- После этапа выполнен автотест + сохранен отчет.
- После этапа выполнен ручной smoke ключевых сценариев.

## Обязательные проверки после каждого этапа

1. Быстрый smoke API:
```bash
npm run smoke:api:sqlite
```

2. Smoke API с генерацией отчета:
```bash
npm run report:smoke:api:sqlite
```

3. Ручной smoke:
- `admin-ui`: создание/редактирование/удаление, фото, bulk (если этап затрагивает).
- `site`: главная, каталог, карточка, история, отсутствие запросов к `data/cars.json`.

## Отчеты по тестам

Команда:
```bash
npm run report:smoke:api:sqlite
```

Артефакты сохраняются в:
`reports/smoke-api-sqlite/<timestamp>/`

Состав отчета:
- `report.md` — читаемый итог (PASS/FAIL, таблица проверок).
- `report.json` — машинный формат (для CI/архива).
- `raw.log` — полный stdout/stderr smoke-прогона.

Если хотя бы одна проверка не прошла, команда завершится с кодом ошибки.

## Playwright MCP

Для ручного e2e/smoke при необходимости можно использовать Playwright MCP:
- проверка сценариев в `admin-ui` и `site`;
- фиксация фактического поведения интерфейса;
- дополнительная проверка перед релизом (особенно для этапа 8).
