import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { readCarsSnapshot, writeCarsSnapshot } from '../db/carsSqliteRepo.js';

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
    try {
      await writeCarsSnapshot(env, carsArray);
      return;
    } catch (err) {
      throw makeErr(500, 'CARS_SQLITE_WRITE_FAILED', 'Failed to write cars to sqlite: ' + (err?.message || String(err)));
    }
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

/* ===========================
   Public API used by routes
   =========================== */

export async function readCars(env) {
  const cars = await readCarsNoLock(env);
  return cars;
}

export async function readCarById(env, id) {
  const cars = await readCarsNoLock(env);
  const numId = Number(id);
  return cars.find(c => Number(c?.id) === numId) || null;
}

export async function createCar(env, payload) {
  const errors = validateRequiredCreate(payload);
  if (errors.length) throw makeErr(400, 'VALIDATION_FAILED', errors.join('; '));

  return await withWriteLock(env, async () => {
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



