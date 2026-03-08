export function loadEnv() {
  const required = [
    'PORT',
    'DATA_ROOT',
    'ADMIN_TOKEN'
  ];

  const missing = required.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`);
  }

  const LOCK_TTL_MS = process.env.LOCK_TTL_MS ? Number(process.env.LOCK_TTL_MS) : 300000;
  const MAX_BACKUPS = process.env.MAX_BACKUPS ? Number(process.env.MAX_BACKUPS) : 10;

  if (!Number.isFinite(LOCK_TTL_MS) || LOCK_TTL_MS <= 0) {
    throw new Error('LOCK_TTL_MS must be a positive number');
  }
  if (!Number.isFinite(MAX_BACKUPS) || MAX_BACKUPS < 0) {
    throw new Error('MAX_BACKUPS must be a number >= 0');
  }

  const STORAGE_DRIVER = (process.env.STORAGE_DRIVER || 'json').trim().toLowerCase();
  if (!['json', 'sqlite'].includes(STORAGE_DRIVER)) {
    throw new Error("STORAGE_DRIVER must be either 'json' or 'sqlite'");
  }

  const SQLITE_PATH = (process.env.SQLITE_PATH || '').trim();
  const ADMIN_TOKEN = (process.env.ADMIN_TOKEN || '').trim();

  if (!ADMIN_TOKEN) {
    throw new Error('ADMIN_TOKEN must not be empty');
  }

  return {
    PORT: Number(process.env.PORT),
    DATA_ROOT: process.env.DATA_ROOT,
    ADMIN_TOKEN,
    LOCK_TTL_MS,
    MAX_BACKUPS,
    STORAGE_DRIVER,
    SQLITE_PATH
  };
}
