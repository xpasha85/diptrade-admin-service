import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import {
  readCarsSnapshot,
  readCarById as readCarByIdSqlite,
  readCarsByIds as readCarsByIdsSqlite,
  getNextCarId as getNextCarIdSqlite,
  createCar as createCarSqlite,
  replaceCar as replaceCarSqlite,
  deleteCarById as deleteCarByIdSqlite,
  bulkDeleteCarsByIds as bulkDeleteCarsByIdsSqlite
} from '../db/carsSqliteRepo.js';

function carsDataDir(dataRoot) {
  // cars.json lives under DATA_ROOT/data/
  return path.resolve(dataRoot, 'data');
}

function carsJsonPath(dataRoot) {
  return path.resolve(carsDataDir(dataRoot), 'cars.json');
}
function carsTmpPath(dataRoot) {
  return path.resolve(carsDataDir(dataRoot), 'cars.json.tmp');
}
function carsSwapPath(dataRoot) {
  return path.resolve(carsDataDir(dataRoot), 'cars.json.swap');
}
function carsLockPath(dataRoot) {
  return path.resolve(carsDataDir(dataRoot), 'cars.lock');
}
function assetsCarsDir(dataRoot) {
  return path.resolve(dataRoot, 'assets', 'cars');
}

function backupFileName() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `cars.json.bak.${ts}`;
}

function makeErr(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

let sqliteWriteQueue = Promise.resolve();

function isSqliteDriver(env) {
  return env?.STORAGE_DRIVER === 'sqlite';
}

function withSqliteWriteQueue(fn) {
  const run = async () => await fn();
  const op = sqliteWriteQueue.then(run, run);
  sqliteWriteQueue = op.catch(() => {});
  return op;
}

async function fileExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}
async function readTextIfExists(p) {
  try {
    return await fs.readFile(p, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function parseCarsJson(raw) {
  if (raw == null) return null;
  if (raw.trim().length === 0) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw makeErr(500, 'CARS_JSON_INVALID', `cars.json is not valid JSON: ${err?.message || String(err)}`);
  }
  if (!Array.isArray(data)) throw makeErr(500, 'CARS_JSON_WRONG_SHAPE', 'cars.json must be an array of cars');
  return data;
}

async function listBackups(dataRoot) {
  const dir = carsDataDir(dataRoot);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }

  const items = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.startsWith('cars.json.bak.')) continue;
    const full = path.resolve(dir, e.name);
    try {
      const st = await fs.stat(full);
      items.push({ path: full, mtimeMs: st.mtimeMs });
    } catch {}
  }
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items;
}

async function pruneBackups(env) {
  if (env.MAX_BACKUPS <= 0) return;
  const backups = await listBackups(env.DATA_ROOT);
  const toDelete = backups.slice(env.MAX_BACKUPS);
  await Promise.allSettled(toDelete.map(b => fs.unlink(b.path)));
}

async function acquireWriteLock(env) {
  // Ensure DATA_ROOT/data exists because lock lives next to cars.json
  await fs.mkdir(carsDataDir(env.DATA_ROOT), { recursive: true });

  const lockPath = carsLockPath(env.DATA_ROOT);

  const tryCreate = async () => {
    const handle = await fs.open(lockPath, 'wx');
    try {
      const payload = JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() });
      await handle.writeFile(payload, 'utf-8');
    } finally {
      await handle.close();
    }
  };

  try {
    await tryCreate();
  } catch (err) {
    if (!(err && err.code === 'EEXIST')) {
      throw makeErr(500, 'STORE_LOCK_IO_ERROR', `Failed to create lock: ${err?.message || String(err)}`);
    }

    try {
      const st = await fs.stat(lockPath);
      const ageMs = Date.now() - st.mtimeMs;
      if (ageMs > env.LOCK_TTL_MS) {
        await fs.unlink(lockPath);
        await tryCreate();
      } else {
        throw makeErr(409, 'STORE_LOCKED', 'Store is locked by another operation');
      }
    } catch (e) {
      if (e?.code === 'STORE_LOCKED' || e?.code === 'STORE_LOCK_IO_ERROR') throw e;
      throw makeErr(500, 'STORE_LOCK_CHECK_FAILED', `Failed to check lock: ${e?.message || String(e)}`);
    }
  }

  return async () => {
    try {
      await fs.unlink(lockPath);
    } catch {}
  };
}

async function safeReplaceFile(dataRoot, tmpPath, finalPath) {
  const swapPath = carsSwapPath(dataRoot);

  const finalExists = await fileExists(finalPath);
  const swapExists = await fileExists(swapPath);

  if (swapExists && finalExists) {
    await fs.unlink(swapPath).catch(() => {});
  }

  if (finalExists) {
    await fs.rename(finalPath, swapPath);
  }

  await fs.rename(tmpPath, finalPath);
  await fs.unlink(swapPath).catch(() => {});
}

async function ensureConsistency(env) {
  const finalPath = carsJsonPath(env.DATA_ROOT);
  const swapPath = carsSwapPath(env.DATA_ROOT);

  const finalExists = await fileExists(finalPath);
  const swapExists = await fileExists(swapPath);

  if (!finalExists && swapExists) {
    await fs.rename(swapPath, finalPath);
  }
}

async function backupCurrent(env) {
  const finalPath = carsJsonPath(env.DATA_ROOT);
  const exists = await fileExists(finalPath);
  if (!exists) return;

  const st = await fs.stat(finalPath);
  if (st.size === 0) return;

  const backupPath = path.resolve(carsDataDir(env.DATA_ROOT), backupFileName());
  await fs.copyFile(finalPath, backupPath);
  await pruneBackups(env);
}

async function writeCarsAtomically(env, carsArray) {
  if (!Array.isArray(carsArray)) throw makeErr(500, 'CARS_JSON_WRONG_SHAPE', 'cars.json must be an array of cars');

  if (isSqliteDriver(env)) {
    throw makeErr(500, 'CARS_SQLITE_WRITE_PATH_INVALID', 'SQLite writes must use SQL CRUD methods');
  }

  // Ensure DATA_ROOT/data exists before writing tmp/final files
  await fs.mkdir(carsDataDir(env.DATA_ROOT), { recursive: true });

  const finalPath = carsJsonPath(env.DATA_ROOT);
  const tmpPath = carsTmpPath(env.DATA_ROOT);

  const payload = JSON.stringify(carsArray, null, 2) + '\n';
  await fs.writeFile(tmpPath, payload, 'utf-8');

  if (env.MAX_BACKUPS > 0) {
    await backupCurrent(env);
  }

  await safeReplaceFile(env.DATA_ROOT, tmpPath, finalPath);
}

async function restoreFromLatestBackup(env) {
  if (env.MAX_BACKUPS <= 0) return false;

  const backups = await listBackups(env.DATA_ROOT);
  if (!backups.length) return false;

  const finalPath = carsJsonPath(env.DATA_ROOT);

  for (const b of backups) {
    await fs.copyFile(b.path, finalPath);
    const raw = await fs.readFile(finalPath, 'utf-8');
    if (raw.trim().length === 0) continue;
    try {
      const parsed = parseCarsJson(raw);
      if (Array.isArray(parsed)) return true;
    } catch {}
  }
  return false;
}

async function initIfMissingOrEmpty(env) {
  const filePath = carsJsonPath(env.DATA_ROOT);
  const exists = await fileExists(filePath);

  if (!exists) {
    await writeCarsAtomically(env, []);
    return;
  }

  const raw = await readTextIfExists(filePath);
  if (raw != null && raw.trim().length === 0) {
    await writeCarsAtomically(env, []);
  }
}

export async function withWriteLock(env, fn) {
  if (isSqliteDriver(env)) {
    return withSqliteWriteQueue(fn);
  }
  const release = await acquireWriteLock(env);
  try {
    await ensureConsistency(env);
    await initIfMissingOrEmpty(env);
    return await fn();
  } finally {
    await release();
  }
}

async function readCarsNoLock(env) {
  if (isSqliteDriver(env)) {
    try {
      return await readCarsSnapshot(env);
    } catch (err) {
      throw makeErr(500, 'CARS_SQLITE_READ_FAILED', 'Failed to read cars from sqlite: ' + (err?.message || String(err)));
    }
  }
  const filePath = carsJsonPath(env.DATA_ROOT);
  await ensureConsistency(env);

  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw makeErr(500, 'CARS_JSON_READ_FAILED', `Failed to read cars.json: ${err?.message || String(err)}`);
  }

  const cars = parseCarsJson(raw);
  return cars || [];
}

function validateRequiredCreate(payload) {
  const errors = [];

  const brand = payload?.brand;
  const model = payload?.model;
  const year = payload?.year;
  const price = payload?.price;
  const country = payload?.country;

  if (typeof brand !== 'string' || brand.trim().length === 0) errors.push('brand is required');
  if (typeof model !== 'string' || model.trim().length === 0) errors.push('model is required');

  const y = Number(year);
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(y) || y < 1900 || y > currentYear + 1) errors.push('year is invalid');

  const p = Number(price);
  if (!Number.isFinite(p) || p < 0) errors.push('price is invalid');

  if (typeof country !== 'string' || !['KR', 'CN', 'RU'].includes(country)) errors.push('country is invalid');

  return errors;
}

function validateRequiredUpdate(payload) {
  const errors = [];
  if (payload == null || typeof payload !== 'object') return ['payload must be an object'];

  if ('brand' in payload) {
    if (typeof payload.brand !== 'string' || payload.brand.trim().length === 0) errors.push('brand is invalid');
  }
  if ('model' in payload) {
    if (typeof payload.model !== 'string' || payload.model.trim().length === 0) errors.push('model is invalid');
  }
  if ('year' in payload) {
    const y = Number(payload.year);
    const currentYear = new Date().getFullYear();
    if (!Number.isFinite(y) || y < 1900 || y > currentYear + 1) errors.push('year is invalid');
  }
  if ('price' in payload) {
    const p = Number(payload.price);
    if (!Number.isFinite(p) || p < 0) errors.push('price is invalid');
  }
  if ('country' in payload) {
    if (typeof payload.country !== 'string' || !['KR', 'CN', 'RU'].includes(payload.country)) errors.push('country is invalid');
  }

  return errors;
}

function sanitizeSlugPart(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function generateAssetsFolder(car) {
  const id = car.id;
  const brand = sanitizeSlugPart(car.brand);
  const model = sanitizeSlugPart(car.model);
  const year = String(car.year);
  return `${id}_${brand}_${model}_${year}`;
}

function nextId(cars) {
  let maxId = 0;
  for (const c of cars) {
    const id = Number(c?.id);
    if (Number.isFinite(id) && id > maxId) maxId = id;
  }
  return maxId + 1;
}

function stripReadonly(patch) {
  if (!patch || typeof patch !== 'object') return patch;
  const out = { ...patch };
  delete out.id;
  delete out.assets_folder;
  delete out.photos;
  return out;
}

function ensureMainPhotoExistsOrThrow(env, car) {
  const photos = Array.isArray(car?.photos) ? car.photos : [];
  if (photos.length === 0) return;

  const main = photos[0];
  const assetsDir = assetsCarsDir(env.DATA_ROOT);
  const full = path.resolve(assetsDir, car.assets_folder, main);

  // path traversal guard
  const base = path.resolve(assetsDir, car.assets_folder) + path.sep;
  if (!full.startsWith(base)) {
    throw makeErr(400, 'PHOTO_INVALID_NAME', 'Invalid photo name');
  }

  return fileExists(full).then(exists => {
    if (!exists) throw makeErr(400, 'PHOTO_MAIN_MISSING', 'Main photo file does not exist');
  });
}

const SUPPORTED_COUNTRIES = new Set(['KR', 'CN', 'RU']);
const SUPPORTED_STATUS_FILTERS = new Set(['active', 'featured', 'auction', 'stock', 'sold', 'hidden']);
const SORT_ALIASES = new Map([
  ['newest', 'added_at_desc'],
  ['cheap', 'price_asc'],
  ['expensive', 'price_desc'],
  ['year_new', 'year_desc']
]);
const SUPPORTED_SORTS = new Set([
  'id_asc',
  'id_desc',
  'price_asc',
  'price_desc',
  'year_asc',
  'year_desc',
  'added_at_asc',
  'added_at_desc'
]);
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;

function firstQueryValue(v) {
  if (Array.isArray(v)) {
    if (v.length === 0) return '';
    return String(v[0] ?? '').trim();
  }
  if (v == null) return '';
  return String(v).trim();
}

function queryValueExists(v) {
  if (Array.isArray(v)) return v.length > 0 && String(v[0] ?? '').trim() !== '';
  return v != null && String(v).trim() !== '';
}

function parseOptionalNumberQuery(name, raw) {
  const value = firstQueryValue(raw);
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw makeErr(400, 'VALIDATION_FAILED', `${name} must be a number`);
  }
  return num;
}

function parsePositiveIntQuery(name, raw) {
  const value = firstQueryValue(raw);
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw makeErr(400, 'VALIDATION_FAILED', `${name} must be a positive integer`);
  }
  return num;
}

function parseOptionalBooleanQuery(name, raw) {
  const value = firstQueryValue(raw).toLowerCase();
  if (!value) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw makeErr(400, 'VALIDATION_FAILED', `${name} must be boolean`);
}

function parseQueryList(raw) {
  const source = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of source) {
    if (item == null) continue;
    const parts = String(item).split(',');
    for (const p of parts) {
      const clean = p.trim();
      if (clean) out.push(clean);
    }
  }
  return out;
}

function normalizeCountryCode(car) {
  return String(car?.country_code || car?.country || '')
    .trim()
    .toUpperCase();
}

function resolveSpecs(car) {
  const specs = car?.specs && typeof car.specs === 'object' ? car.specs : {};
  return specs;
}

function numericOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeSort(rawSort) {
  if (!rawSort) return '';
  const sort = rawSort.trim().toLowerCase();
  const alias = SORT_ALIASES.get(sort);
  const resolved = alias || sort;
  if (!SUPPORTED_SORTS.has(resolved)) {
    throw makeErr(
      400,
      'VALIDATION_FAILED',
      `sort is invalid (allowed: ${Array.from(SUPPORTED_SORTS).join(', ')})`
    );
  }
  return resolved;
}

function parseCarsQuery(rawQuery = {}) {
  const countryRaw = firstQueryValue(rawQuery.country_code || rawQuery.country).toUpperCase();
  if (countryRaw && !SUPPORTED_COUNTRIES.has(countryRaw)) {
    throw makeErr(400, 'VALIDATION_FAILED', 'country_code is invalid');
  }

  const status = firstQueryValue(rawQuery.status).toLowerCase();
  if (status && status !== 'all' && !SUPPORTED_STATUS_FILTERS.has(status)) {
    throw makeErr(400, 'VALIDATION_FAILED', 'status is invalid');
  }

  const priceFrom = parseOptionalNumberQuery('price_from', rawQuery.price_from);
  const priceTo = parseOptionalNumberQuery('price_to', rawQuery.price_to);
  if (priceFrom != null && priceTo != null && priceFrom > priceTo) {
    throw makeErr(400, 'VALIDATION_FAILED', 'price_from must be <= price_to');
  }

  const yearFrom = parseOptionalNumberQuery('year_from', rawQuery.year_from);
  const yearTo = parseOptionalNumberQuery('year_to', rawQuery.year_to);
  if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
    throw makeErr(400, 'VALIDATION_FAILED', 'year_from must be <= year_to');
  }

  const volumeFrom = parseOptionalNumberQuery('volume_from', rawQuery.volume_from);
  const volumeTo = parseOptionalNumberQuery('volume_to', rawQuery.volume_to);
  if (volumeFrom != null && volumeTo != null && volumeFrom > volumeTo) {
    throw makeErr(400, 'VALIDATION_FAILED', 'volume_from must be <= volume_to');
  }

  const hpFrom = parseOptionalNumberQuery('hp_from', rawQuery.hp_from);
  const hpTo = parseOptionalNumberQuery('hp_to', rawQuery.hp_to);
  if (hpFrom != null && hpTo != null && hpFrom > hpTo) {
    throw makeErr(400, 'VALIDATION_FAILED', 'hp_from must be <= hp_to');
  }

  const fuelList = parseQueryList(rawQuery.fuel).map(x => x.toLowerCase());
  const fuels = new Set(fuelList);

  const hasPage = queryValueExists(rawQuery.page);
  const hasPerPage = queryValueExists(rawQuery.per_page);
  const hasPageSize = queryValueExists(rawQuery.page_size);
  const hasLimit = queryValueExists(rawQuery.limit);
  const paginationEnabled = hasPage || hasPerPage || hasPageSize || hasLimit;

  let page = null;
  let perPage = null;
  if (paginationEnabled) {
    page = hasPage ? parsePositiveIntQuery('page', rawQuery.page) : 1;
    if (hasPerPage) {
      perPage = parsePositiveIntQuery('per_page', rawQuery.per_page);
    } else if (hasPageSize) {
      perPage = parsePositiveIntQuery('page_size', rawQuery.page_size);
    } else if (hasLimit) {
      perPage = parsePositiveIntQuery('limit', rawQuery.limit);
    } else {
      perPage = DEFAULT_PAGE_SIZE;
    }

    if (perPage > MAX_PAGE_SIZE) {
      throw makeErr(400, 'VALIDATION_FAILED', `per_page must be <= ${MAX_PAGE_SIZE}`);
    }
  }

  return {
    q: firstQueryValue(rawQuery.q).toLowerCase(),
    brand: firstQueryValue(rawQuery.brand).toLowerCase(),
    model: firstQueryValue(rawQuery.model).toLowerCase(),
    countryCode: countryRaw || '',
    status: status && status !== 'all' ? status : '',
    priceFrom,
    priceTo,
    yearFrom,
    yearTo,
    volumeFrom,
    volumeTo,
    hpFrom,
    hpTo,
    fuels,
    inStock: parseOptionalBooleanQuery('in_stock', rawQuery.in_stock),
    isAuction: parseOptionalBooleanQuery('is_auction', rawQuery.is_auction),
    fullTime: parseOptionalBooleanQuery('full_time', rawQuery.full_time),
    featured: parseOptionalBooleanQuery('featured', rawQuery.featured),
    isVisible: parseOptionalBooleanQuery('is_visible', rawQuery.is_visible),
    isSold: parseOptionalBooleanQuery('is_sold', rawQuery.is_sold),
    sort: normalizeSort(firstQueryValue(rawQuery.sort)),
    pagination: paginationEnabled ? { page, perPage } : null
  };
}

function filterCarsByQuery(cars, query) {
  const terms = query.q ? query.q.split(/\s+/).filter(Boolean) : [];

  return cars.filter(car => {
    const specs = resolveSpecs(car);
    const countryCode = normalizeCountryCode(car);

    if (query.brand && !String(car?.brand || '').toLowerCase().includes(query.brand)) return false;
    if (query.model && !String(car?.model || '').toLowerCase().includes(query.model)) return false;
    if (query.countryCode && countryCode !== query.countryCode) return false;

    const price = numericOrNull(car?.price);
    if (query.priceFrom != null && (price == null || price < query.priceFrom)) return false;
    if (query.priceTo != null && (price == null || price > query.priceTo)) return false;

    const year = numericOrNull(car?.year);
    if (query.yearFrom != null && (year == null || year < query.yearFrom)) return false;
    if (query.yearTo != null && (year == null || year > query.yearTo)) return false;

    const volume = numericOrNull(specs?.volume);
    if (query.volumeFrom != null && (volume == null || volume < query.volumeFrom)) return false;
    if (query.volumeTo != null && (volume == null || volume > query.volumeTo)) return false;

    const hp = numericOrNull(specs?.hp);
    if (query.hpFrom != null && (hp == null || hp < query.hpFrom)) return false;
    if (query.hpTo != null && (hp == null || hp > query.hpTo)) return false;

    if (query.fuels.size > 0) {
      const fuel = String(specs?.fuel || car?.fuel || '').toLowerCase();
      if (!query.fuels.has(fuel)) return false;
    }

    if (query.inStock !== undefined && Boolean(car?.in_stock) !== query.inStock) return false;
    if (query.isAuction !== undefined && Boolean(car?.is_auction) !== query.isAuction) return false;
    if (query.featured !== undefined && Boolean(car?.featured) !== query.featured) return false;
    if (query.isVisible !== undefined && (car?.is_visible !== false) !== query.isVisible) return false;
    if (query.isSold !== undefined && Boolean(car?.is_sold) !== query.isSold) return false;

    if (query.fullTime !== undefined) {
      const isFullTime = Boolean(car?.full_time || specs?.is_4wd);
      if (isFullTime !== query.fullTime) return false;
    }

    if (query.status) {
      if (query.status === 'active' && (car?.is_visible === false || car?.is_sold === true)) return false;
      if (query.status === 'featured' && !car?.featured) return false;
      if (query.status === 'auction' && !car?.is_auction) return false;
      if (query.status === 'stock' && !car?.in_stock) return false;
      if (query.status === 'sold' && !car?.is_sold) return false;
      if (query.status === 'hidden' && car?.is_visible !== false) return false;
    }

    if (terms.length > 0) {
      const searchStr = [
        car?.id,
        car?.brand,
        car?.model,
        car?.year,
        car?.web_title,
        car?.price,
        countryCode,
        specs?.fuel,
        specs?.hp,
        specs?.volume
      ]
        .map(x => String(x ?? '').toLowerCase())
        .join(' ');

      const matchesAllTerms = terms.every(term => searchStr.includes(term));
      if (!matchesAllTerms) return false;
    }

    return true;
  });
}

function compareNullableNumbers(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return a - b;
}

function compareAddedAtAsc(a, b) {
  const aMs = Date.parse(String(a?.added_at || '')) || 0;
  const bMs = Date.parse(String(b?.added_at || '')) || 0;
  return aMs - bMs;
}

function compareInStockFirst(a, b) {
  return Number(Boolean(b?.in_stock)) - Number(Boolean(a?.in_stock));
}

function sortCarsByQuery(cars, sort) {
  if (!sort) return cars;

  cars.sort((a, b) => {
    const stockDiff = compareInStockFirst(a, b);
    if (stockDiff !== 0) return stockDiff;

    if (sort === 'id_asc') return compareNullableNumbers(numericOrNull(a?.id), numericOrNull(b?.id));
    if (sort === 'id_desc') return compareNullableNumbers(numericOrNull(b?.id), numericOrNull(a?.id));
    if (sort === 'price_asc') return compareNullableNumbers(numericOrNull(a?.price), numericOrNull(b?.price));
    if (sort === 'price_desc') return compareNullableNumbers(numericOrNull(b?.price), numericOrNull(a?.price));
    if (sort === 'year_asc') return compareNullableNumbers(numericOrNull(a?.year), numericOrNull(b?.year));
    if (sort === 'year_desc') return compareNullableNumbers(numericOrNull(b?.year), numericOrNull(a?.year));
    if (sort === 'added_at_asc') return compareAddedAtAsc(a, b);
    if (sort === 'added_at_desc') return compareAddedAtAsc(b, a);
    return 0;
  });

  return cars;
}

/* ===========================
   Public API used by routes
   =========================== */

export async function readCars(env) {
  const cars = await readCarsNoLock(env);
  return cars;
}

export async function readCarsWithQuery(env, rawQuery = {}) {
  const query = parseCarsQuery(rawQuery);
  const cars = await readCarsNoLock(env);
  const filtered = filterCarsByQuery(cars, query);
  const sorted = sortCarsByQuery(filtered, query.sort);

  if (!query.pagination) {
    return { cars: sorted, pagination: null };
  }

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / query.pagination.perPage));
  const page = query.pagination.page;
  const start = (page - 1) * query.pagination.perPage;
  const pagedCars = sorted.slice(start, start + query.pagination.perPage);

  return {
    cars: pagedCars,
    pagination: {
      page,
      per_page: query.pagination.perPage,
      total,
      total_pages: totalPages,
      has_prev: page > 1,
      has_next: page < totalPages
    }
  };
}

export async function readCarById(env, id) {
  if (isSqliteDriver(env)) {
    try {
      return await readCarByIdSqlite(env, id);
    } catch (err) {
      throw makeErr(500, 'CARS_SQLITE_READ_FAILED', 'Failed to read car from sqlite: ' + (err?.message || String(err)));
    }
  }

  const cars = await readCarsNoLock(env);
  const numId = Number(id);
  return cars.find(c => Number(c?.id) === numId) || null;
}

export async function createCar(env, payload) {
  const errors = validateRequiredCreate(payload);
  if (errors.length) throw makeErr(400, 'VALIDATION_FAILED', errors.join('; '));

  return await withWriteLock(env, async () => {
    if (isSqliteDriver(env)) {
      try {
        const car = {
          ...payload,
          id: await getNextCarIdSqlite(env),
          photos: []
        };

        car.assets_folder = generateAssetsFolder(car);
        await createCarSqlite(env, car);
        return car;
      } catch (err) {
        throw makeErr(500, 'CARS_SQLITE_WRITE_FAILED', 'Failed to create car in sqlite: ' + (err?.message || String(err)));
      }
    }

    const cars = await readCarsNoLock(env);

    const car = {
      ...payload,
      id: nextId(cars),
      photos: []
    };

    car.assets_folder = generateAssetsFolder(car);

    cars.push(car);

    await writeCarsAtomically(env, cars);
    return car;
  });
}

export async function updateCar(env, id, patch) {
  const errors = validateRequiredUpdate(patch);
  if (errors.length) throw makeErr(400, 'VALIDATION_FAILED', errors.join('; '));

  return await withWriteLock(env, async () => {
    if (isSqliteDriver(env)) {
      const numId = Number(id);
      try {
        const current = await readCarByIdSqlite(env, numId);
        if (!current) throw makeErr(404, 'NOT_FOUND', 'Car not found');

        const cleanPatch = stripReadonly(patch);
        const updated = { ...current, ...cleanPatch };

        await ensureMainPhotoExistsOrThrow(env, updated);
        await replaceCarSqlite(env, updated);
        return updated;
      } catch (err) {
        if (err?.code === 'NOT_FOUND' || err?.status === 404) throw err;
        throw makeErr(500, 'CARS_SQLITE_WRITE_FAILED', 'Failed to update car in sqlite: ' + (err?.message || String(err)));
      }
    }

    const cars = await readCarsNoLock(env);
    const numId = Number(id);
    const idx = cars.findIndex(c => Number(c?.id) === numId);
    if (idx < 0) throw makeErr(404, 'NOT_FOUND', 'Car not found');

    const current = cars[idx];
    const cleanPatch = stripReadonly(patch);

    const updated = { ...current, ...cleanPatch };
    cars[idx] = updated;

    await ensureMainPhotoExistsOrThrow(env, updated);
    await writeCarsAtomically(env, cars);
    return updated;
  });
}

export async function deleteCar(env, id) {
  return await withWriteLock(env, async () => {
    if (isSqliteDriver(env)) {
      const numId = Number(id);
      let deleted;

      try {
        deleted = await readCarByIdSqlite(env, numId);
        if (!deleted) throw makeErr(404, 'NOT_FOUND', 'Car not found');

        const changes = await deleteCarByIdSqlite(env, numId);
        if (changes === 0) throw makeErr(404, 'NOT_FOUND', 'Car not found');
      } catch (err) {
        if (err?.code === 'NOT_FOUND' || err?.status === 404) throw err;
        throw makeErr(500, 'CARS_SQLITE_WRITE_FAILED', 'Failed to delete car in sqlite: ' + (err?.message || String(err)));
      }

      const folder = deleted?.assets_folder;
      if (folder) {
        const dir = path.resolve(assetsCarsDir(env.DATA_ROOT), folder);
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }

      return { ok: true };
    }

    const cars = await readCarsNoLock(env);
    const numId = Number(id);
    const idx = cars.findIndex(c => Number(c?.id) === numId);
    if (idx < 0) throw makeErr(404, 'NOT_FOUND', 'Car not found');

    const [deleted] = cars.splice(idx, 1);
    await writeCarsAtomically(env, cars);

    // best-effort: delete folder
    const folder = deleted?.assets_folder;
    if (folder) {
      const dir = path.resolve(assetsCarsDir(env.DATA_ROOT), folder);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }

    return { ok: true };
  });
}

export async function bulkDeleteCars(env, ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw makeErr(400, 'VALIDATION_FAILED', 'ids must be a non-empty array');

  return await withWriteLock(env, async () => {
    if (isSqliteDriver(env)) {
      const set = new Set(ids.map(x => Number(x)).filter(Number.isFinite));
      if (set.size === 0) throw makeErr(400, 'VALIDATION_FAILED', 'ids must contain valid numbers');

      const normalizedIds = Array.from(set.values());
      let toDelete = [];
      let deleted = 0;

      try {
        toDelete = await readCarsByIdsSqlite(env, normalizedIds);
        deleted = await bulkDeleteCarsByIdsSqlite(env, normalizedIds);
      } catch (err) {
        throw makeErr(500, 'CARS_SQLITE_WRITE_FAILED', 'Failed to bulk delete cars in sqlite: ' + (err?.message || String(err)));
      }

      for (const c of toDelete) {
        const folder = c?.assets_folder;
        if (!folder) continue;
        const dir = path.resolve(assetsCarsDir(env.DATA_ROOT), folder);
        await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      }

      return { ok: true, deleted };
    }

    const cars = await readCarsNoLock(env);

    const set = new Set(ids.map(x => Number(x)).filter(Number.isFinite));
    if (set.size === 0) throw makeErr(400, 'VALIDATION_FAILED', 'ids must contain valid numbers');

    const toDelete = cars.filter(c => set.has(Number(c?.id)));
    const remain = cars.filter(c => !set.has(Number(c?.id)));

    await writeCarsAtomically(env, remain);

    // best-effort: delete folders
    for (const c of toDelete) {
      const folder = c?.assets_folder;
      if (!folder) continue;
      const dir = path.resolve(assetsCarsDir(env.DATA_ROOT), folder);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }

    return { ok: true, deleted: toDelete.length };
  });
}

/* ===========================
   Stage E: Photos
   =========================== */

function ensureInsideDir(baseDir, filePath) {
  const base = path.resolve(baseDir) + path.sep;
  const full = path.resolve(filePath);
  return full.startsWith(base);
}

async function ensureCarAssetsDir(env, car) {
  const dir = path.resolve(assetsCarsDir(env.DATA_ROOT), car.assets_folder);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function toWebp(buffer) {
  // 1280px РїРѕ РґР»РёРЅРЅРѕР№ СЃС‚РѕСЂРѕРЅРµ, webp, Р±РµР· EXIF
  return sharp(buffer)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}

function makePhotoName(index) {
  const n = String(index).padStart(3, '0');
  return `img_${n}.webp`;
}

export async function uploadCarPhotos(env, id, files) {
  if (!Array.isArray(files) || files.length === 0) throw makeErr(400, 'VALIDATION_FAILED', 'files must be a non-empty array');

  return await withWriteLock(env, async () => {
    if (isSqliteDriver(env)) {
      const numId = Number(id);
      try {
        const car = await readCarByIdSqlite(env, numId);
        if (!car) throw makeErr(404, 'NOT_FOUND', 'Car not found');

        const photos = Array.isArray(car.photos) ? [...car.photos] : [];
        const dir = await ensureCarAssetsDir(env, car);

        for (const f of files) {
          const buf = await toWebp(f.buffer);
          const name = makePhotoName(photos.length + 1);
          const target = path.resolve(dir, name);

          if (!ensureInsideDir(dir, target)) throw makeErr(400, 'PHOTO_INVALID_NAME', 'Invalid photo name');

          await fs.writeFile(target, buf);
          photos.push(name);
        }

        const updated = { ...car, photos };
        await ensureMainPhotoExistsOrThrow(env, updated);
        await replaceCarSqlite(env, updated);
        return updated;
      } catch (err) {
        if (err?.status === 400 || err?.status === 404) throw err;
        throw makeErr(500, 'CARS_SQLITE_WRITE_FAILED', 'Failed to upload photos in sqlite mode: ' + (err?.message || String(err)));
      }
    }

    const cars = await readCarsNoLock(env);
    const numId = Number(id);
    const idx = cars.findIndex(c => Number(c?.id) === numId);
    if (idx < 0) throw makeErr(404, 'NOT_FOUND', 'Car not found');

    const car = cars[idx];
    const photos = Array.isArray(car.photos) ? [...car.photos] : [];

    const dir = await ensureCarAssetsDir(env, car);

    for (const f of files) {
      const buf = await toWebp(f.buffer);
      const name = makePhotoName(photos.length + 1);
      const target = path.resolve(dir, name);

      if (!ensureInsideDir(dir, target)) throw makeErr(400, 'PHOTO_INVALID_NAME', 'Invalid photo name');

      await fs.writeFile(target, buf);
      photos.push(name);
    }

    car.photos = photos;
    cars[idx] = car;

    await ensureMainPhotoExistsOrThrow(env, car);
    await writeCarsAtomically(env, cars);
    return car;
  });
}

export async function reorderCarPhotos(env, id, photos) {
  if (!Array.isArray(photos)) throw makeErr(400, 'VALIDATION_FAILED', 'photos must be an array');

  return await withWriteLock(env, async () => {
    if (isSqliteDriver(env)) {
      const numId = Number(id);
      try {
        const car = await readCarByIdSqlite(env, numId);
        if (!car) throw makeErr(404, 'NOT_FOUND', 'Car not found');

        const current = Array.isArray(car.photos) ? car.photos : [];

        const a = [...current].sort();
        const b = [...photos].sort();
        if (a.length !== b.length) throw makeErr(400, 'VALIDATION_FAILED', 'photos must include all current photos');
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) throw makeErr(400, 'VALIDATION_FAILED', 'photos must include all current photos');
        }

        const updated = { ...car, photos };
        await ensureMainPhotoExistsOrThrow(env, updated);
        await replaceCarSqlite(env, updated);
        return updated;
      } catch (err) {
        if (err?.status === 400 || err?.status === 404) throw err;
        throw makeErr(500, 'CARS_SQLITE_WRITE_FAILED', 'Failed to reorder photos in sqlite mode: ' + (err?.message || String(err)));
      }
    }

    const cars = await readCarsNoLock(env);
    const numId = Number(id);
    const idx = cars.findIndex(c => Number(c?.id) === numId);
    if (idx < 0) throw makeErr(404, 'NOT_FOUND', 'Car not found');

    const car = cars[idx];
    const current = Array.isArray(car.photos) ? car.photos : [];

    // must be permutation of current
    const a = [...current].sort();
    const b = [...photos].sort();
    if (a.length !== b.length) throw makeErr(400, 'VALIDATION_FAILED', 'photos must include all current photos');
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) throw makeErr(400, 'VALIDATION_FAILED', 'photos must include all current photos');
    }

    car.photos = photos;
    cars[idx] = car;

    await ensureMainPhotoExistsOrThrow(env, car);
    await writeCarsAtomically(env, cars);
    return car;
  });
}

export async function deleteCarPhoto(env, id, name) {
  if (typeof name !== 'string' || name.trim().length === 0) throw makeErr(400, 'VALIDATION_FAILED', 'name is required');

  return await withWriteLock(env, async () => {
    if (isSqliteDriver(env)) {
      const numId = Number(id);
      try {
        const car = await readCarByIdSqlite(env, numId);
        if (!car) throw makeErr(404, 'NOT_FOUND', 'Car not found');

        const current = Array.isArray(car.photos) ? [...car.photos] : [];
        const pos = current.indexOf(name);
        if (pos < 0) throw makeErr(404, 'NOT_FOUND', 'Photo not found');

        const dir = path.resolve(assetsCarsDir(env.DATA_ROOT), car.assets_folder);
        const full = path.resolve(dir, name);

        if (!ensureInsideDir(dir, full)) throw makeErr(400, 'PHOTO_INVALID_NAME', 'Invalid photo name');

        await fs.unlink(full).catch(() => {});
        current.splice(pos, 1);

        const updated = { ...car, photos: current };
        await ensureMainPhotoExistsOrThrow(env, updated);
        await replaceCarSqlite(env, updated);
        return updated;
      } catch (err) {
        if (err?.status === 400 || err?.status === 404) throw err;
        throw makeErr(500, 'CARS_SQLITE_WRITE_FAILED', 'Failed to delete photo in sqlite mode: ' + (err?.message || String(err)));
      }
    }

    const cars = await readCarsNoLock(env);
    const numId = Number(id);
    const idx = cars.findIndex(c => Number(c?.id) === numId);
    if (idx < 0) throw makeErr(404, 'NOT_FOUND', 'Car not found');

    const car = cars[idx];
    const current = Array.isArray(car.photos) ? [...car.photos] : [];
    const pos = current.indexOf(name);
    if (pos < 0) throw makeErr(404, 'NOT_FOUND', 'Photo not found');

    const dir = path.resolve(assetsCarsDir(env.DATA_ROOT), car.assets_folder);
    const full = path.resolve(dir, name);

    if (!ensureInsideDir(dir, full)) throw makeErr(400, 'PHOTO_INVALID_NAME', 'Invalid photo name');

    await fs.unlink(full).catch(() => {});
    current.splice(pos, 1);

    car.photos = current;
    cars[idx] = car;

    await ensureMainPhotoExistsOrThrow(env, car);
    await writeCarsAtomically(env, cars);
    return car;
  });
}



