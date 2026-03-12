import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveProjectRoot() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', '..');
}

function stripWrappingQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function stripInlineComment(value) {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (ch === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(value[i - 1])) {
        return value.slice(0, i).trimEnd();
      }
    }
  }

  return value;
}

function parseEnvFile(content) {
  const parsed = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const normalized = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trim()
      : trimmed;

    const eqIdx = normalized.indexOf('=');
    if (eqIdx <= 0) continue;

    const key = normalized.slice(0, eqIdx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    const rawValue = normalized.slice(eqIdx + 1).trim();
    parsed[key] = stripWrappingQuotes(stripInlineComment(rawValue));
  }

  return parsed;
}

function loadEnvFileIntoProcess(filePath) {
  if (!filePath) return null;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }

  const parsed = parseEnvFile(content);
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return filePath;
}

function loadLocalEnvFile() {
  const configured = (process.env.ENV_FILE || '').trim();
  const candidates = configured
    ? [path.resolve(configured)]
    : [
        path.resolve(resolveProjectRoot(), '.env.local'),
        path.resolve(resolveProjectRoot(), '.env')
      ];

  for (const candidate of candidates) {
    const loaded = loadEnvFileIntoProcess(candidate);
    if (loaded) return loaded;
  }

  return null;
}

export function loadEnv() {
  const loadedEnvFile = loadLocalEnvFile();

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
  const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();
  const TELEGRAM_MESSAGE_THREAD_ID_RAW = (process.env.TELEGRAM_MESSAGE_THREAD_ID || '').trim();
  const TELEGRAM_MESSAGE_THREAD_ID = TELEGRAM_MESSAGE_THREAD_ID_RAW
    ? Number(TELEGRAM_MESSAGE_THREAD_ID_RAW)
    : null;

  if (!ADMIN_TOKEN) {
    throw new Error('ADMIN_TOKEN must not be empty');
  }

  if (
    TELEGRAM_MESSAGE_THREAD_ID_RAW &&
    (!Number.isInteger(TELEGRAM_MESSAGE_THREAD_ID) || TELEGRAM_MESSAGE_THREAD_ID <= 0)
  ) {
    throw new Error('TELEGRAM_MESSAGE_THREAD_ID must be a positive integer');
  }

  return {
    PORT: Number(process.env.PORT),
    DATA_ROOT: process.env.DATA_ROOT,
    ADMIN_TOKEN,
    LOCK_TTL_MS,
    MAX_BACKUPS,
    STORAGE_DRIVER,
    SQLITE_PATH,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    TELEGRAM_MESSAGE_THREAD_ID,
    ENV_FILE: loadedEnvFile
  };
}
