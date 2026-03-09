# FINAL RELEASE DOC (Stage 9)

Документ фиксирует финальный регресс для `admin-service`:
- интеграционные API-тесты,
- e2e smoke для `admin-ui` + `site`,
- отчеты для архива и CI.

## 1) Автотесты и smoke

1. Интеграционные API-тесты (SQLite):
```bash
npm run test:integration:api:sqlite
```

2. Интеграционные API-тесты с отчетом:
```bash
npm run report:integration:api:sqlite
```

3. Web e2e smoke (API + admin-ui + site):
```bash
npm run smoke:e2e:web
```

4. Web e2e smoke с отчетом:
```bash
npm run report:smoke:e2e:web
```

5. API smoke с отчетом:
```bash
npm run report:smoke:api:sqlite
```

6. Финальный агрегированный прогон:
```bash
npm run verify:final
```

## 2) Артефакты отчетов

- `reports/integration-api-sqlite/<timestamp>/`
- `reports/e2e-smoke-web/<timestamp>/`
- `reports/smoke-api-sqlite/<timestamp>/`

В каждом каталоге:
- `report.md`
- `report.json`
- `raw.log`

## 3) Ручной smoke перед релизом

1. `admin-ui`:
- открыть `index.html`,
- проверить online/health,
- создать/изменить/удалить авто,
- загрузить/переставить/удалить фото,
- проверить bulk delete.

2. `site`:
- `index.html`, `catalog.html`, `history.html`, `car.html?id=<id>`,
- проверить карточку по `GET /cars/:id`,
- убедиться, что фронт не обращается к `data/cars.json`.

3. Backup/restore:
- `npm run db:backup`
- `npm run db:restore`
- `npm run db:rollback`

## 4) Готовность релиза

Релиз готов, если одновременно выполняется:
- `verify:final` завершился `PASS`,
- ручной smoke без блокирующих дефектов,
- API-контракт (`/openapi.json`) без ломающих изменений.
