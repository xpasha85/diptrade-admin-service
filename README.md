# admin-service docs

Основной документ для реализации и контроля этапов:

- [IMPLEMENTATION_ROADMAP.md](/c:/Working_files/Сайт новый по авто/Архитектура сайта_мое/diptrade-tmp/admin-service/IMPLEMENTATION_ROADMAP.md)
- [PROD_MIGRATION_RUNBOOK.md](/c:/Working_files/Сайт новый по авто/Архитектура сайта_мое/diptrade-tmp/admin-service/PROD_MIGRATION_RUNBOOK.md)

Дополнительно (текущий контракт API):

- [API_CURRENT_GUIDE.md](/c:/Working_files/Сайт новый по авто/Архитектура сайта_мое/diptrade-tmp/admin-service/API_CURRENT_GUIDE.md)
- [FINAL_RELEASE_DOC.md](/c:/Working_files/Сайт новый по авто/Архитектура сайта_мое/diptrade-tmp/admin-service/FINAL_RELEASE_DOC.md)

OpenAPI спецификация (runtime):

- `GET /openapi.json`

Скрипты этапа 8 (backup/restore/rollback):

- `npm run db:backup -- --data-root <DATA_ROOT>`
- `npm run db:restore -- --data-root <DATA_ROOT> [--backup <name-or-path>]`
- `npm run db:rollback -- --data-root <DATA_ROOT> [--steps <n>]`

Скрипты этапа 9 (integration + e2e + final verify):

- `npm run report:integration:api:sqlite`
- `npm run report:smoke:e2e:web`
- `npm run verify:final`

Локальный env:

- создать `.env.local` по образцу `.env.local.example`
- `dev-admin-service.cmd` запускает сервис через `ENV_FILE=.env.local`
- формат локального файла такой же, как у production env-файла

Versioned deploy-артефакты:

- `deploy/env/admin-service.env.example`
- `deploy/systemd/diptrade-admin.service`
- `deploy/scripts/diptrade-admin-service-deploy.sh`
- `deploy/nginx/diptrade-api.conf`
