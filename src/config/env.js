// admin-service/src/config/env.js
export function loadEnv() {
  const required = [
    'PORT',
    'DATA_ROOT'
  ];

  const missing = required.filter(k => !process.env[k]);

  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(', ')}`);
  }

  const LOCK_TTL_MS = process.env.LOCK_TTL_MS ? Number(process.env.LOCK_TTL_MS) : 300000; // 5 min
  const MAX_BACKUPS = process.env.MAX_BACKUPS ? Number(process.env.MAX_BACKUPS) : 10;

  if (!Number.isFinite(LOCK_TTL_MS) || LOCK_TTL_MS <= 0) {
    throw new Error('LOCK_TTL_MS must be a positive number');
  }
  if (!Number.isFinite(MAX_BACKUPS) || MAX_BACKUPS < 0) {
    throw new Error('MAX_BACKUPS must be a number >= 0');
  }

  return {
    PORT: Number(process.env.PORT),
    DATA_ROOT: process.env.DATA_ROOT,
    LOCK_TTL_MS,
    MAX_BACKUPS
  };
}
