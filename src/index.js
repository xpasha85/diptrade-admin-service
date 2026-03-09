import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { initSqliteIfNeeded } from './db/sqlite.js';

const env = loadEnv();

const sqlitePath = initSqliteIfNeeded(env);
if (sqlitePath) {
  console.log(`SQLite initialized at: ${sqlitePath}`);
}

// DATA_ROOT берём из env, но если его нет — createApp сам возьмёт дефолт по LOCAL_DEV.md
const app = createApp({ dataRoot: env.DATA_ROOT });

app.listen(env.PORT, () => {
  console.log(`Admin service listening on port ${env.PORT}`);
  console.log(`DATA_ROOT: ${env.DATA_ROOT || '(default from LOCAL_DEV.md)'}`);
  if (env.ENV_FILE) {
    console.log(`ENV_FILE: ${env.ENV_FILE}`);
  }
  console.log(`STORAGE_DRIVER: ${env.STORAGE_DRIVER}`);
  if (env.STORAGE_DRIVER === 'sqlite') {
    console.log(`SQLITE_PATH: ${env.SQLITE_PATH || '(default: DATA_ROOT/data/cars.sqlite)'}`);
  }
  console.log(`Assets URL example: http://localhost:${env.PORT}/assets/cars/<assets_folder>/<file>`);
});
