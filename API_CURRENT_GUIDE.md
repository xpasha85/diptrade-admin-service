# Текущая Работа API: Что Для Админки, Что Для Фронта

## 1) Базовая схема
- Сервис: `admin-service` (Express).
- Базовый URL локально: `http://localhost:3001`.
- Роуты:
- `GET /health`
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
- `POST /cars/:id/photos` (upload фото)
- `PATCH /cars/:id/photos/reorder` (порядок фото)
- `DELETE /cars/:id/photos/:name` (удаление фото)
- Важный момент:
- `POST /cars/bulk-delete` в API есть, но в текущем `admin-ui` не подключен.

## 7) Какие эндпоинты для фронта сайта
- Сайт (`../site/assets/js`) сейчас использует:
- `GET /cars` (во всех страницах)
- `GET /assets/cars/...` (картинки)
- Не используется фронтом сейчас:
- `GET /cars/:id` (хотя эндпоинт есть)
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
- Сейчас сайт для карточки авто делает `GET /cars` и сам ищет `id` на клиенте.
- Для оптимизации можно перевести карточку на `GET /cars/:id`.
- Контракт ответа сейчас обертками (`{ cars }`, `{ car }`), и админка это ожидает.
- Любые изменения контракта лучше делать через совместимость (или версионирование).

## 11) Быстрый smoke уже есть
- Скрипт: `npm run smoke:api:sqlite`
- Покрывает:
- health
- create/read/update/delete
- upload/reorder/delete фото
- bulk-delete
