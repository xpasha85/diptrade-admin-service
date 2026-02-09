import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

function carsJsonPath(dataRoot) {
  return path.resolve(dataRoot, 'cars.json');
}
function carsTmpPath(dataRoot) {
  return path.resolve(dataRoot, 'cars.json.tmp');
}
function carsSwapPath(dataRoot) {
  return path.resolve(dataRoot, 'cars.json.swap');
}
function carsLockPath(dataRoot) {
  return path.resolve(dataRoot, 'cars.lock');
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
  const entries = await fs.readdir(dataRoot, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!e.name.startsWith('cars.json.bak.')) continue;
    const full = path.resolve(dataRoot, e.name);
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

  const backupPath = path.resolve(env.DATA_ROOT, backupFileName());
  await fs.copyFile(finalPath, backupPath);
  await pruneBackups(env);
}

async function writeCarsAtomically(env, carsArray) {
  if (!Array.isArray(carsArray)) throw makeErr(500, 'CARS_JSON_WRONG_SHAPE', 'cars.json must be an array of cars');

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
  const filePath = carsJsonPath(env.DATA_ROOT);
  await ensureConsistency(env);

  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw makeErr(500, 'CARS_JSON_READ_FAILED', `Failed to read cars.json: ${err?.message || String(err)}`);
  }

  return parseCarsJson(raw) ?? [];
}

export async function readCars(env) {
  const filePath = carsJsonPath(env.DATA_ROOT);

  try {
    await ensureConsistency(env);
  } catch (err) {
    throw makeErr(500, 'CARS_STORE_CONSISTENCY_FAILED', `Failed to ensure consistency: ${err?.message || String(err)}`);
  }

  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      await withWriteLock(env, async () => {
        await initIfMissingOrEmpty(env);
      });
      return [];
    }
    throw makeErr(500, 'CARS_JSON_READ_FAILED', `Failed to read cars.json: ${err?.message || String(err)}`);
  }

  try {
    const data = parseCarsJson(raw);
    if (Array.isArray(data) && raw.trim().length === 0) {
      await withWriteLock(env, async () => {
        await initIfMissingOrEmpty(env);
      });
    }
    return data ?? [];
  } catch (err) {
    if (err?.code === 'CARS_JSON_INVALID') {
      await withWriteLock(env, async () => {
        const restored = await restoreFromLatestBackup(env);
        if (!restored) await writeCarsAtomically(env, []);
      });

      const fixedRaw = await fs.readFile(filePath, 'utf-8');
      const fixedData = parseCarsJson(fixedRaw);
      return fixedData ?? [];
    }

    if (err?.status && err?.code) throw err;
    throw makeErr(500, 'CARS_STORE_READ_FAILED', `Failed to parse/read store: ${err?.message || String(err)}`);
  }
}

export async function readCarById(env, id) {
  const cars = await readCars(env);
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) throw makeErr(400, 'INVALID_ID', 'Invalid id');
  return cars.find(c => Number(c?.id) === numericId) || null;
}

/* ===========================
   Stage D: CRUD (no photos)
   =========================== */

function slugPart(value) {
  const s = String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s.length ? s : 'x';
}

function validateRequiredCreate(payload) {
  const errors = [];

  const brand = payload?.brand;
  const model = payload?.model;
  const year = payload?.year;
  const price = payload?.price;
  const country_code = payload?.country_code;

  if (typeof brand !== 'string' || brand.trim().length === 0) errors.push('brand is required');
  if (typeof model !== 'string' || model.trim().length === 0) errors.push('model is required');

  const y = Number(year);
  const currentYear = new Date().getFullYear();
  if (!Number.isFinite(y) || y < 1900 || y > currentYear + 1) errors.push('year is required and must be a valid year');

  const p = Number(price);
  if (!Number.isFinite(p) || p < 0) errors.push('price is required and must be >= 0');

  const allowedCountries = new Set(['KR', 'CN', 'RU']);
  if (typeof country_code !== 'string' || !allowedCountries.has(country_code)) errors.push('country_code must be one of KR|CN|RU');

  if (errors.length) throw makeErr(400, 'VALIDATION_ERROR', errors.join('; '));

  return { brand: brand.trim(), model: model.trim(), year: y, price: p, country_code };
}

function validatePatch(patch) {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw makeErr(400, 'VALIDATION_ERROR', 'patch must be an object');
  }
  if ('id' in patch) throw makeErr(400, 'READONLY_FIELD', 'id is readonly');
  if ('assets_folder' in patch) throw makeErr(400, 'READONLY_FIELD', 'assets_folder is readonly');
  if ('photos' in patch) throw makeErr(400, 'READONLY_FIELD', 'photos is readonly (managed by stage E)');
}

function nextId(cars) {
  let max = 0;
  for (const c of cars) {
    const n = Number(c?.id);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

async function ensureAssetsFolder(env, folder) {
  const base = assetsCarsDir(env.DATA_ROOT);
  await fs.mkdir(base, { recursive: true });
  const full = path.resolve(base, folder);
  await fs.mkdir(full, { recursive: true });
}

export async function createCar(env, payload) {
  const req = validateRequiredCreate(payload);

  return withWriteLock(env, async () => {
    const cars = await readCarsNoLock(env);

    const id = nextId(cars);
    const folder = `${id}_${slugPart(req.brand)}_${slugPart(req.model)}_${req.year}`;

    const car = { ...payload };

    delete car.id;
    delete car.assets_folder;
    delete car.photos;

    car.id = id;
    car.assets_folder = folder;
    car.photos = [];

    car.brand = req.brand;
    car.model = req.model;
    car.year = req.year;
    car.price = req.price;
    car.country_code = req.country_code;

    await ensureAssetsFolder(env, folder);

    const updated = [...cars, car];
    await writeCarsAtomically(env, updated);

    return car;
  });
}

export async function updateCar(env, id, patch) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) throw makeErr(400, 'INVALID_ID', 'Invalid id');

  validatePatch(patch);

  return withWriteLock(env, async () => {
    const cars = await readCarsNoLock(env);
    const idx = cars.findIndex(c => Number(c?.id) === numericId);
    if (idx === -1) throw makeErr(404, 'NOT_FOUND', 'Car not found');

    const existing = cars[idx];
    const updatedCar = { ...existing, ...patch };

    updatedCar.id = existing.id;
    updatedCar.assets_folder = existing.assets_folder;
    updatedCar.photos = existing.photos;

    const nextCars = cars.slice();
    nextCars[idx] = updatedCar;

    await writeCarsAtomically(env, nextCars);
    return updatedCar;
  });
}

export async function deleteCar(env, id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) throw makeErr(400, 'INVALID_ID', 'Invalid id');

  return withWriteLock(env, async () => {
    const cars = await readCarsNoLock(env);
    const before = cars.length;
    const remaining = cars.filter(c => Number(c?.id) !== numericId);
    if (remaining.length === before) throw makeErr(404, 'NOT_FOUND', 'Car not found');

    await writeCarsAtomically(env, remaining);
    return { deleted: 1 };
  });
}

export async function bulkDeleteCars(env, ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw makeErr(400, 'VALIDATION_ERROR', 'ids must be a non-empty array');

  const parsed = ids.map(Number);
  if (parsed.some(n => !Number.isFinite(n))) throw makeErr(400, 'VALIDATION_ERROR', 'ids must be numbers');

  const set = new Set(parsed);

  return withWriteLock(env, async () => {
    const cars = await readCarsNoLock(env);
    const before = cars.length;
    const remaining = cars.filter(c => !set.has(Number(c?.id)));
    const deleted = before - remaining.length;

    await writeCarsAtomically(env, remaining);
    return { deleted };
  });
}

/* ===========================
   Stage E: Photos
   =========================== */

function isAllowedImageMime(mime) {
  const allowed = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
  return allowed.has(String(mime || '').toLowerCase());
}

function safePhotoName(name) {
  // разрешаем только img_###.webp
  if (!/^img_\d{3}\.webp$/.test(name)) return null;
  return name;
}

function nextPhotoIndex(photos) {
  let max = 0;
  for (const p of photos || []) {
    const m = /^img_(\d{3})\.webp$/.exec(p);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

async function saveWebp(buffer, outPath) {
  // max 1280 по длинной стороне, без кропа
  await sharp(buffer)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outPath);
}

export async function uploadCarPhotos(env, id, files) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) throw makeErr(400, 'INVALID_ID', 'Invalid id');

  if (!Array.isArray(files) || files.length === 0) {
    throw makeErr(400, 'VALIDATION_ERROR', 'No files uploaded. Use multipart field "files"');
  }

  return withWriteLock(env, async () => {
    const cars = await readCarsNoLock(env);
    const idx = cars.findIndex(c => Number(c?.id) === numericId);
    if (idx === -1) throw makeErr(404, 'NOT_FOUND', 'Car not found');

    const car = cars[idx];
    const folder = car.assets_folder;

    await ensureAssetsFolder(env, folder);

    const dir = path.resolve(assetsCarsDir(env.DATA_ROOT), folder);
    const photos = Array.isArray(car.photos) ? [...car.photos] : [];
    let counter = nextPhotoIndex(photos);

    const created = [];

    // сначала пишем файлы на диск, потом обновляем JSON
    for (const f of files) {
      if (!isAllowedImageMime(f.mimetype)) {
        throw makeErr(400, 'VALIDATION_ERROR', `Unsupported file type: ${f.mimetype}`);
      }
      if (!f.buffer || f.buffer.length === 0) {
        throw makeErr(400, 'VALIDATION_ERROR', 'Empty file buffer');
      }

      const name = `img_${String(counter).padStart(3, '0')}.webp`;
      counter += 1;

      const outPath = path.resolve(dir, name);

      try {
        await saveWebp(f.buffer, outPath);
      } catch (e) {
        // откатить созданные ранее файлы (best-effort)
        await Promise.allSettled(created.map(n => fs.unlink(path.resolve(dir, n))));
        throw makeErr(500, 'PHOTO_PROCESSING_FAILED', `Failed to process image: ${e?.message || String(e)}`);
      }

      created.push(name);
      photos.push(name);
    }

    const updatedCar = { ...car, photos };
    cars[idx] = updatedCar;

    await writeCarsAtomically(env, cars);
    return updatedCar;
  });
}

export async function reorderCarPhotos(env, id, photos) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) throw makeErr(400, 'INVALID_ID', 'Invalid id');

  if (!Array.isArray(photos)) throw makeErr(400, 'VALIDATION_ERROR', 'photos must be an array');
  if (photos.length === 0) throw makeErr(400, 'VALIDATION_ERROR', 'photos must be non-empty');

  // валидация имён
  const normalized = photos.map(p => safePhotoName(String(p || ''))).filter(Boolean);
  if (normalized.length !== photos.length) throw makeErr(400, 'VALIDATION_ERROR', 'Invalid photo name in array');

  // без дублей
  const set = new Set(normalized);
  if (set.size !== normalized.length) throw makeErr(400, 'VALIDATION_ERROR', 'photos contains duplicates');

  return withWriteLock(env, async () => {
    const cars = await readCarsNoLock(env);
    const idx = cars.findIndex(c => Number(c?.id) === numericId);
    if (idx === -1) throw makeErr(404, 'NOT_FOUND', 'Car not found');

    const car = cars[idx];
    const current = Array.isArray(car.photos) ? car.photos : [];

    // проверяем, что reorder не пытается “придумать” новые фото
    const currentSet = new Set(current);
    for (const p of normalized) {
      if (!currentSet.has(p)) {
        throw makeErr(400, 'VALIDATION_ERROR', `Photo does not exist in car.photos: ${p}`);
      }
    }

    // можно требовать полного соответствия (same length), чтобы не “терять” фото
    if (normalized.length !== current.length) {
      throw makeErr(400, 'VALIDATION_ERROR', 'photos must contain all existing photos exactly (same length)');
    }

    const updatedCar = { ...car, photos: normalized };
    cars[idx] = updatedCar;

    await writeCarsAtomically(env, cars);
    return updatedCar;
  });
}

export async function deleteCarPhoto(env, id, name) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) throw makeErr(400, 'INVALID_ID', 'Invalid id');

  const safeName = safePhotoName(String(name || ''));
  if (!safeName) throw makeErr(400, 'VALIDATION_ERROR', 'Invalid photo name');

  return withWriteLock(env, async () => {
    const cars = await readCarsNoLock(env);
    const idx = cars.findIndex(c => Number(c?.id) === numericId);
    if (idx === -1) throw makeErr(404, 'NOT_FOUND', 'Car not found');

    const car = cars[idx];
    const folder = car.assets_folder;

    const photos = Array.isArray(car.photos) ? [...car.photos] : [];
    const pos = photos.indexOf(safeName);
    if (pos === -1) throw makeErr(404, 'NOT_FOUND', 'Photo not found in car.photos');

    // удаляем файл best-effort
    const filePath = path.resolve(assetsCarsDir(env.DATA_ROOT), folder, safeName);
    await fs.unlink(filePath).catch(() => {});

    photos.splice(pos, 1);

    const updatedCar = { ...car, photos };
    cars[idx] = updatedCar;

    await writeCarsAtomically(env, cars);
    return updatedCar;
  });
}
