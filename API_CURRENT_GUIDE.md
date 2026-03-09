# Текущая Работа API: Что Для Админки, Что Для Фронта

## 1) Базовая схема
- Сервис: `admin-service` (Express).
- Базовый URL локально: `http://localhost:3001`.
- Роуты:
- `GET /health`
- `GET /openapi.json`
- `GET /cars`
- `GET /cars/:id`
- `POST /cars`
- `PATCH /cars/:id`
- `DELETE /cars/:id`
- `POST /cars/bulk-delete`
- `POST /cars/:id/photos`
- `PATCH /cars/:id/photos/reorder`
- `DELETE /cars/:id/photos/:name`
- Статика фото: `GET /assets/...` (из `DATA_ROOT/assets`).
- OpenAPI runtime-спека: `GET /openapi.json`.

## 2) Переменные окружения
- Обязательные:
- `PORT`
- `DATA_ROOT`
- `ADMIN_TOKEN` (bearer token for all `POST/PATCH/DELETE /cars*`)
- Необязательные:
- `STORAGE_DRIVER` (`json` или `sqlite`, по умолчанию `json`)
- `SQLITE_PATH` (если не задан, берется `DATA_ROOT/data/cars.sqlite`)
- `LOCK_TTL_MS` (по умолчанию `300000`)
- `MAX_BACKUPS` (по умолчанию `10`)

## Auth for admin operations
- Public:
- `GET /health`
- `GET /cars`
- `GET /cars/:id`
- Protected by `Authorization: Bearer <ADMIN_TOKEN>`:
- all `POST/PATCH/DELETE /cars*` endpoints
- Error format for auth failures:
```json
{ "error": "UNAUTHORIZED", "message": "..." }   // 401
{ "error": "FORBIDDEN", "message": "..." }      // 403
```

## 3) Где реально лежат данные
- Машины:
- в режиме `json`: `DATA_ROOT/data/cars.json`
- в режиме `sqlite`: `cars` + `car_photos` в SQLite
- Фото:
- всегда на диске: `DATA_ROOT/assets/cars/<assets_folder>/<file>`

## 4) Формат ошибок API
- Единый формат:
```json
{
  "error": "ERROR_CODE",
  "message": "Human readable message"
}
```
- Типовые коды:
- `VALIDATION_FAILED`
- `NOT_FOUND`
- `PHOTO_INVALID_NAME`
- `PHOTO_MAIN_MISSING`
- `STORE_LOCKED`

## 5) Формат успешных ответов
- `GET /cars`:
```json
{ "cars": [ ... ] }
```
- `GET /cars` c пагинацией (`page`, `per_page`/`page_size`/`limit`):
```json
{
  "cars": [ ... ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 148,
    "total_pages": 8,
    "has_prev": false,
    "has_next": true
  }
}
```
- `GET /cars/:id`:
```json
{ "car": { ... } }
```
- `POST /cars`, `PATCH /cars/:id`:
```json
{ "car": { ... } }
```
- `DELETE /cars/:id`:
```json
{ "ok": true }
```
- `POST /cars/bulk-delete`:
```json
{ "ok": true, "deleted": 3 }
```

## 6) Какие эндпоинты для админки
- Используются напрямую админкой (`../admin-ui/js`):
- `GET /health` (индикатор Online/Offline)
- `GET /cars` (таблица)
- `POST /cars` (создание)
- `PATCH /cars/:id` (редактирование)
- `DELETE /cars/:id` (удаление одной машины)
- `POST /cars/bulk-delete` (массовое удаление выбранных машин)
- `POST /cars/:id/photos` (upload фото)
- `PATCH /cars/:id/photos/reorder` (порядок фото)
- `DELETE /cars/:id/photos/:name` (удаление фото)

## 6.1) `GET /cars`: query-параметры фильтров/пагинации (Stage 3)
- Совместимость: поле `cars` сохраняется всегда.
- Поиск/фильтры:
- `q` (поиск по `id/brand/model/year/web_title/price/country/fuel/hp/volume`)
- `country` или `country_code` (`KR|CN|RU`)
- `status` (`active|featured|auction|stock|sold|hidden|all`)
- `brand`, `model` (substring, case-insensitive)
- `price_from`, `price_to`
- `year_from`, `year_to`
- `volume_from`, `volume_to`
- `hp_from`, `hp_to`
- `fuel` (можно повторять, либо CSV: `fuel=Бензин,Гибрид`)
- `in_stock`, `is_auction`, `full_time`, `featured`, `is_visible`, `is_sold` (`true|false|1|0`)
- Сортировка:
- `sort`: `id_asc|id_desc|price_asc|price_desc|year_asc|year_desc|added_at_asc|added_at_desc`
- алиасы для сайта: `newest|cheap|expensive|year_new`
- Пагинация (включается только если передан хотя бы один параметр):
- `page` (>=1)
- `per_page` (>=1, <=200)
- алиасы: `page_size`, `limit`

## 6.2) Статус интеграции фронтов (Stage 4-5 в roadmap)
- Серверная поддержка фильтров/пагинации в `GET /cars` уже реализована.
- `admin-ui` использует серверные query-параметры (`q/country/status/sort/page/per_page`) и серверную пагинацию `pagination`.
- `site` каталог использует серверные query-параметры фильтров/сортировки и серверную пагинацию (`page/per_page`, `pagination.has_next`, `pagination.total`).
- `site` карточка использует `GET /cars/:id` (без загрузки полного списка `GET /cars`).
- Этап 6 roadmap выполнен: в `sqlite` режиме mutation-эндпоинты используют SQL CRUD + transaction без full snapshot rewrite таблиц.
- Этап 7 roadmap выполнен: добавлен `GET /openapi.json` и `Ajv`-валидация входных JSON payload в:
- `POST /cars`
- `PATCH /cars/:id`
- `POST /cars/bulk-delete`
- `PATCH /cars/:id/photos/reorder`
- Этап 8 roadmap выполнен: добавлены CLI-скрипты backup/restore/rollback для `DATA_ROOT`:
- `npm run db:backup -- --data-root <DATA_ROOT>`
- `npm run db:restore -- --data-root <DATA_ROOT> [--backup <name-or-path>]`
- `npm run db:rollback -- --data-root <DATA_ROOT> [--steps <n>]`
- Этап 9 roadmap выполнен: добавлены интеграционные API-тесты, web e2e smoke и финальный агрегированный прогон:
- `npm run report:integration:api:sqlite`
- `npm run report:smoke:e2e:web`
- `npm run verify:final`

## 7) Какие эндпоинты для фронта сайта
- Сайт (`../site/assets/js`) сейчас использует:
- `GET /cars` (главная, каталог, история)
- `GET /cars/:id` (карточка)
- `GET /assets/cars/...` (картинки)
- Не используется фронтом сейчас:
- Все mutation-методы (`POST/PATCH/DELETE`)

## 8) Что именно требуется API от админки при создании/обновлении
- Минимум для `POST /cars`:
- `brand` (string, не пусто)
- `model` (string, не пусто)
- `year` (number, 1900..current+1)
- `price` (number >= 0)
- `country` (`KR|CN|RU`)
- Для `PATCH /cars/:id`:
- можно отправлять частичный объект
- `id`, `assets_folder`, `photos` игнорируются сервером из patch

## 9) Фото: текущие правила
- Upload:
- поле multipart: `files`
- до 20 файлов за запрос
- лимит ~15MB на файл
- сервер конвертирует в `webp`, ресайз до 1280, имена `img_001.webp`, `img_002.webp`, ...
- Reorder:
- `photos` должен быть полной перестановкой текущего массива
- Delete:
- удаляет файл с диска + имя из `car.photos`
- При любом сохранении проверяется главная фото (`photos[0]`) на существование.

## 10) Что важно знать перед изменениями
- Карточка сайта загружает авто напрямую через `GET /cars/:id`.
- Каталог сайта и таблица админки уже переведены на server-side фильтры/пагинацию `GET /cars`.
- Контракт ответа сейчас обертками (`{ cars }`, `{ car }`), и админка это ожидает.
- Любые изменения контракта лучше делать через совместимость (или версионирование).

## 11) Быстрый smoke уже есть
- Скрипт: `npm run smoke:api:sqlite`
- Покрывает:
- health
- create/read/update/delete
- server filters + pagination (`GET /cars`)
- upload/reorder/delete фото
- bulk-delete

## 12) Backup/restore/rollback (Stage 8)
- По умолчанию backup хранится в: `DATA_ROOT/backups/admin-service/backup-<timestamp>/`
- В backup входит snapshot:
- `DATA_ROOT/data`
- `DATA_ROOT/assets/cars`
- Внутри backup сохраняется `manifest.json` (timestamp, label, состав snapshot).
- `restore` и `rollback` по умолчанию делают safety backup текущего состояния перед восстановлением.
- Полезные флаги:
- `--backups-root <path>`: переопределить директорию бэкапов
- `--no-safety-backup`: отключить safety backup

## 13) Integration + E2E (Stage 9)
- Интеграционный прогон API (SQLite):
- `npm run test:integration:api:sqlite`
- Отчет интеграции:
- `npm run report:integration:api:sqlite`
- Web e2e smoke (поднимает `admin-service` + статические `admin-ui`/`site`):
- `npm run smoke:e2e:web`
- Отчет web e2e:
- `npm run report:smoke:e2e:web`
- Финальный агрегированный прогон:
- `npm run verify:final`
- Артефакты:
- `reports/integration-api-sqlite/<timestamp>/`
- `reports/e2e-smoke-web/<timestamp>/`
