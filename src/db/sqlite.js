import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveSqlitePath(env) {
  if (env.SQLITE_PATH && env.SQLITE_PATH.length > 0) {
    return path.resolve(env.SQLITE_PATH);
  }
  return path.resolve(env.DATA_ROOT, 'data', 'cars.sqlite');
}

function resolveMigrationPath() {
  return path.resolve(__dirname, 'migrations', '001_init.sql');
}

export function initSqliteIfNeeded(env) {
  if (env.STORAGE_DRIVER !== 'sqlite') {
    return null;
  }

  const dbPath = resolveSqlitePath(env);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  const migrationSql = fs.readFileSync(resolveMigrationPath(), 'utf-8');

  db.exec(migrationSql);
  db.close();

  return dbPath;
}

