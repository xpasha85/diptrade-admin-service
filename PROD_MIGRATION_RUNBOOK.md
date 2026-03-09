# PROD Migration Runbook

Документ фиксирует текущее состояние продакшена на 9 марта 2026 года и задает безопасный план переезда с `cars.json` на `admin-service` c `sqlite`.

## 1. Что сейчас в проде

- Сайт: `https://diptrade.xpasha85.ru`
- Админка: `https://admin.diptrade.xpasha85.ru`
- API: `https://api.diptrade.ru`
- Сервер: `root@45.128.204.169`

Проверено по SSH 9 марта 2026 года:

- код сайта лежит в `/var/www/diptrade/site`
- runtime-данные лежат в `/var/www/diptrade/runtime`
- боевой JSON лежит в `/var/www/diptrade/runtime/data/cars.json`
- фото лежат в `/var/www/diptrade/runtime/assets/cars`
- `site/data` это symlink на `/var/www/diptrade/runtime/data`
- `site/assets/cars` это symlink на `/var/www/diptrade/runtime/assets/cars`
- backend запущен как `systemd`-сервис `diptrade-admin.service`
- nginx проксирует `api.diptrade.ru` на `127.0.0.1:3001`

## 2. Как сейчас деплоится проект

### Site

- серверная команда: `diptrade-deploy`
- фактический скрипт: `/usr/local/bin/diptrade-deploy`
- источник: `/var/www/diptrade/repo`
- выкладка: `/var/www/diptrade/site`
- механизм: `git pull` + `rsync`
- runtime-данные и фото не трогаются

### Admin UI

- серверная команда: `diptrade-admin-ui-deploy`
- источник: `/var/www/diptrade-admin-ui/repo`
- выкладка: `/var/www/diptrade-admin-ui/site`
- механизм: `git fetch` + `git pull --ff-only` + `rsync`

### Admin Service

- серверная команда: `diptrade-admin-service-deploy`
- источник: `/var/www/diptrade-admin-service/repo`
- запуск: `systemd`
- unit: `diptrade-admin.service`
- текущий `WorkingDirectory`: `/var/www/diptrade-admin-service/repo`
- текущие env в unit: только `PORT=3001` и `DATA_ROOT=/var/www/diptrade/runtime`

## 3. Главный разрыв перед релизом

Локальный код в этом репозитории уже новее, чем код в боевом `/var/www/diptrade-admin-service/repo`.

Критично:

- локальный `src/config/env.js` требует `ADMIN_TOKEN`
- локальный код умеет `STORAGE_DRIVER=json|sqlite`
- локальный код умеет импорт из JSON в SQLite, backup/restore/rollback и smoke/integration
- боевой unit пока не задает `ADMIN_TOKEN`
- боевой unit пока не задает `STORAGE_DRIVER=sqlite`
- значит прямой деплой текущего репозитория на сервер без подготовки unit/env сломает сервис

Сначала готовим окружение, потом переключаем код.

## 4. Цель переезда

- сайт и админка продолжают работать через `https://api.diptrade.ru`
- боевой источник данных становится `cars.sqlite`
- `cars.json` остается только как исходник для первичного импорта и аварийного отката
- дальнейшие изменения машин и фото идут через `admin-service`
- деплой backend становится воспроизводимым через versioned файлы из этого репозитория

## 5. Пошаговый план

### Этап 0. Зафиксировать базовую точку

Сделать перед любыми изменениями на сервере:

1. Проверить текущее здоровье:
   - `https://api.diptrade.ru/health`
   - `https://api.diptrade.ru/cars`
2. Снять резервную копию runtime:
   - `/var/www/diptrade/runtime/data/cars.json`
   - `/var/www/diptrade/runtime/assets/cars`
3. Зафиксировать текущий unit:
   - `systemctl cat diptrade-admin.service`
4. Зафиксировать текущий nginx:
   - `nginx -T`

### Этап 1. Подготовить сервер под новый backend

Нужно сделать один раз:

1. Установить versioned deploy-скрипт из этого репозитория.
2. Поставить новый systemd unit из `deploy/systemd/diptrade-admin.service`.
3. Создать env-файл `/etc/diptrade/admin-service.env` по образцу `deploy/env/admin-service.env.example`.
4. Проверить, что в env заданы:
   - `PORT=3001`
   - `DATA_ROOT=/var/www/diptrade/runtime`
   - `STORAGE_DRIVER=sqlite`
   - `ADMIN_TOKEN=<секрет>`
5. Выполнить `systemctl daemon-reload`, но сервис пока можно не переключать на новый код.

Базовая установка файлов на сервер:

```bash
install -d /etc/diptrade
cp deploy/env/admin-service.env.example /etc/diptrade/admin-service.env
cp deploy/systemd/diptrade-admin.service /etc/systemd/system/diptrade-admin.service
cp deploy/scripts/diptrade-admin-service-deploy.sh /usr/local/bin/diptrade-admin-service-deploy
chmod 600 /etc/diptrade/admin-service.env
chmod 755 /usr/local/bin/diptrade-admin-service-deploy
systemctl daemon-reload
```

### Этап 2. Подготовить SQLite без переключения трафика

1. Залить текущий код `admin-service` в `/var/www/diptrade-admin-service/repo`.
2. В каталоге репозитория выполнить dry-run импорта:

```bash
npm ci --omit=dev
npm run db:import:dry -- --data-root /var/www/diptrade/runtime
```

3. Если dry-run чистый, выполнить реальный импорт:

```bash
npm run db:import -- --data-root /var/www/diptrade/runtime
```

4. Убедиться, что появился файл:
   - `/var/www/diptrade/runtime/data/cars.sqlite`

### Этап 3. Прогнать проверки перед переключением

На сервере или локально в идентичной копии данных:

```bash
npm run report:integration:api:sqlite
npm run report:smoke:api:sqlite
```

Ручная проверка:

- `GET /health`
- `GET /cars`
- `GET /cars/:id`
- загрузка фото
- reorder фото
- удаление фото
- создание и редактирование авто

### Этап 4. Боевой cutover

Последовательность:

1. Сделать финальный backup:

```bash
npm run db:backup -- --data-root /var/www/diptrade/runtime
```

2. Повторно прогнать импорт из самого свежего `cars.json`, если JSON еще менялся после этапа 2:

```bash
npm run db:import -- --data-root /var/www/diptrade/runtime
```

3. Перезапустить backend:

```bash
systemctl restart diptrade-admin.service
systemctl status diptrade-admin.service --no-pager
journalctl -u diptrade-admin.service -n 100 --no-pager
```

4. Проверить:
   - `https://api.diptrade.ru/health`
   - `https://api.diptrade.ru/openapi.json`
   - `https://api.diptrade.ru/cars`
5. Открыть `admin-ui` и выполнить ручной smoke.
6. Открыть `site` и убедиться, что карточка, каталог и главная читают API, а не `data/cars.json`.

### Этап 5. Режим работы после переезда

После cutover:

- правки каталога делаем через `admin-ui` и `admin-service`
- `cars.json` больше не редактируем как основной источник правды
- перед рискованными изменениями делаем:

```bash
npm run db:backup -- --data-root /var/www/diptrade/runtime
```

- для отката используем:

```bash
npm run db:restore -- --data-root /var/www/diptrade/runtime
```

или

```bash
npm run db:rollback -- --data-root /var/www/diptrade/runtime --steps 1
```

## 6. Команды для регулярного деплоя после переезда

### Backend

После коммита в этот репозиторий:

```bash
ssh root@45.128.204.169 diptrade-admin-service-deploy
```

### Admin UI

```bash
ssh root@45.128.204.169 diptrade-admin-ui-deploy
```

### Site

```bash
ssh root@45.128.204.169 diptrade-deploy
```

## 7. Чеклист перед каждым изменением backend

- понять, затрагивается ли контракт `/cars`
- если меняется контракт, проверить `admin-ui` и `site`
- сделать `db:backup`
- прогнать `report:smoke:api:sqlite`
- после деплоя проверить `health`, `cars`, одну карточку и одну admin-операцию

## 8. Чеклист аварийного отката

Если после релиза API не поднялся или ломает CRUD:

1. Посмотреть:
   - `systemctl status diptrade-admin.service --no-pager`
   - `journalctl -u diptrade-admin.service -n 200 --no-pager`
2. Если проблема в данных, выполнить `db:restore`.
3. Если проблема в коде, откатить репозиторий сервиса на сервере до предыдущего коммита и перезапустить unit.
4. Если нужно быстро вернуть старый режим, временно вернуть старый код сервиса, который работает от JSON.

## 9. Что делаем дальше по шагам

Рекомендованный порядок совместной работы:

1. Вынести deploy-файлы в репозиторий и привести сервер к ним.
2. Подготовить production env.
3. Выполнить импорт JSON в SQLite на сервере.
4. Прогнать smoke.
5. Сделать первый controlled cutover.
6. После стабилизации убрать ручной процесс заливки `cars.json` из рабочего регламента.
