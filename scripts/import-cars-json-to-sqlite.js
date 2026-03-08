import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { initSqliteIfNeeded, resolveSqlitePath } from '../src/db/sqlite.js';
import { writeCarsSnapshot, readCarsSnapshot } from '../src/db/carsSqliteRepo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const out = {
    source: null,
    dataRoot: null,
    sqlitePath: null,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a === '--dry-run') {
      out.dryRun = true;
      continue;
    }

    if (a.startsWith('--source=')) {
      out.source = a.slice('--source='.length);
      continue;
    }
    if (a === '--source') {
      out.source = argv[i + 1] || null;
      i++;
      continue;
    }

    if (a.startsWith('--data-root=')) {
      out.dataRoot = a.slice('--data-root='.length);
      continue;
    }
    if (a === '--data-root') {
      out.dataRoot = argv[i + 1] || null;
      i++;
      continue;
    }

    if (a.startsWith('--sqlite-path=')) {
      out.sqlitePath = a.slice('--sqlite-path='.length);
      continue;
    }
    if (a === '--sqlite-path') {
      out.sqlitePath = argv[i + 1] || null;
      i++;
      continue;
    }
  }

  return out;
}

function resolveDefaultDataRoot() {
  return path.resolve(__dirname, '..', '..', '..', 'diptrade-tmp-data');
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

function makeAssetsFolder(car) {
  return `${car.id}_${sanitizeSlugPart(car.brand)}_${sanitizeSlugPart(car.model)}_${String(car.year || '')}`;
}

function asObject(v, fallback = {}) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
}

function asBool(v, fallback = false) {
  if (typeof v === 'boolean') return v;
  if (v === 1 || v === '1' || v === 'true') return true;
  if (v === 0 || v === '0' || v === 'false') return false;
  return fallback;
}

function asNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCars(inputCars) {
  const warnings = [];

  const maxExisting = inputCars.reduce((m, c) => {
    const id = asNum(c?.id, null);
    return id != null && id > m ? id : m;
  }, 0);

  let nextId = maxExisting;
  const used = new Set();

  const cars = inputCars.map((src, idx) => {
    const car = { ...(src || {}) };

    let id = asNum(car.id, null);
    if (id == null || used.has(id)) {
      nextId += 1;
      id = nextId;
      warnings.push(`car[${idx}]: invalid or duplicate id -> assigned ${id}`);
    }
    used.add(id);

    car.id = id;
    car.brand = String(car.brand || '').trim();
    car.model = String(car.model || '').trim();
    car.year = asNum(car.year, 0);
    car.price = asNum(car.price, 0);

    const cc = String(car.country_code || car.country || '').trim().toUpperCase();
    if (cc) {
      car.country_code = cc;
      car.country = cc;
    }

    if (!car.assets_folder) {
      car.assets_folder = makeAssetsFolder(car);
      warnings.push(`car[${idx}]: assets_folder was missing -> generated ${car.assets_folder}`);
    }

    const legacySpec = asObject(car.spec, null);
    const specs = asObject(car.specs, {});
    if (!car.specs && legacySpec) {
      car.specs = {
        ...legacySpec,
        ...specs
      };
      warnings.push(`car[${idx}]: migrated legacy 'spec' into 'specs'`);
    } else {
      car.specs = specs;
    }

    car.costs = asObject(car.costs, {});
    car.accidents = asObject(car.accidents, {});

    car.photos = Array.isArray(car.photos)
      ? car.photos.filter(x => typeof x === 'string' && x.trim().length > 0)
      : [];

    car.in_stock = asBool(car.in_stock, false);
    car.is_sold = asBool(car.is_sold, false);
    car.is_visible = asBool(car.is_visible, true);
    car.featured = asBool(car.featured, false);
    car.is_auction = asBool(car.is_auction, false);

    if (car.month != null) {
      const month = asNum(car.month, null);
      car.month = month != null ? month : null;
    }

    if (car.auction_benefit != null) {
      const ab = asNum(car.auction_benefit, null);
      car.auction_benefit = ab;
    }

    return car;
  });

  return { cars, warnings };
}

async function readCarsFromJson(sourcePath) {
  const raw = await fs.readFile(sourcePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('cars.json must contain array at root');
  }
  return parsed;
}

function buildEnv({ dataRoot, sqlitePath }) {
  return {
    DATA_ROOT: dataRoot,
    STORAGE_DRIVER: 'sqlite',
    SQLITE_PATH: sqlitePath || '',
    LOCK_TTL_MS: 300000,
    MAX_BACKUPS: 0
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const dataRoot = path.resolve(args.dataRoot || process.env.DATA_ROOT || resolveDefaultDataRoot());
  const sourcePath = path.resolve(args.source || path.resolve(dataRoot, 'data', 'cars.json'));
  const sqlitePath = args.sqlitePath ? path.resolve(args.sqlitePath) : '';

  const env = buildEnv({ dataRoot, sqlitePath });

  await fs.access(sourcePath);

  const sourceCars = await readCarsFromJson(sourcePath);
  const { cars, warnings } = normalizeCars(sourceCars);

  const totalPhotos = cars.reduce((s, c) => s + (Array.isArray(c.photos) ? c.photos.length : 0), 0);

  console.log(`[import] source: ${sourcePath}`);
  console.log(`[import] data_root: ${dataRoot}`);
  console.log(`[import] sqlite: ${resolveSqlitePath(env)}`);
  console.log(`[import] records: ${cars.length}`);
  console.log(`[import] photos: ${totalPhotos}`);

  if (warnings.length) {
    console.log(`[import] warnings: ${warnings.length}`);
    for (const line of warnings.slice(0, 20)) {
      console.log(`  - ${line}`);
    }
    if (warnings.length > 20) {
      console.log(`  ... and ${warnings.length - 20} more`);
    }
  }

  if (args.dryRun) {
    console.log('[import] dry-run: no data written');
    return;
  }

  initSqliteIfNeeded(env);
  await writeCarsSnapshot(env, cars);
  const check = await readCarsSnapshot(env);

  console.log(`[import] done: written=${cars.length}, readback=${check.length}`);
}

main().catch(err => {
  console.error('[import] failed:', err?.message || String(err));
  process.exit(1);
});
