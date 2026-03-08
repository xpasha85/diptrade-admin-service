import Database from 'better-sqlite3';
import { resolveSqlitePath } from './sqlite.js';

const RESERVED_FIELDS = new Set([
  'id',
  'brand',
  'model',
  'year',
  'price',
  'country_code',
  'country',
  'assets_folder',
  'added_at',
  'in_stock',
  'is_sold',
  'is_visible',
  'featured',
  'is_auction',
  'auction_benefit',
  'month',
  'sold_on',
  'specs',
  'costs',
  'accidents',
  'photos'
]);

function parseJsonSafe(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function toIntBool(v) {
  return v ? 1 : 0;
}

function fromIntBool(v) {
  return Number(v) === 1;
}

function toJsonText(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

function toExtraJson(car) {
  const extra = {};
  for (const [k, v] of Object.entries(car || {})) {
    if (RESERVED_FIELDS.has(k)) continue;
    extra[k] = v;
  }

  if (Object.keys(extra).length === 0) return null;
  return JSON.stringify(extra);
}

function mapCarToRow(car) {
  const id = Number(car?.id);
  if (!Number.isFinite(id)) {
    throw new Error('Car id must be a finite number');
  }

  return {
    id,
    brand: String(car?.brand || ''),
    model: String(car?.model || ''),
    year: Number(car?.year || 0),
    price: Number(car?.price || 0),
    country_code: car?.country_code || car?.country || null,
    assets_folder: car?.assets_folder || null,
    added_at: car?.added_at || null,
    in_stock: toIntBool(!!car?.in_stock),
    is_sold: toIntBool(!!car?.is_sold),
    is_visible: toIntBool(car?.is_visible !== false),
    featured: toIntBool(!!car?.featured),
    is_auction: toIntBool(!!car?.is_auction),
    auction_benefit: car?.auction_benefit == null ? null : Number(car.auction_benefit),
    month: car?.month == null ? null : Number(car.month),
    sold_on: car?.sold_on || null,
    specs_json: toJsonText(car?.specs || {}),
    costs_json: toJsonText(car?.costs || {}),
    accidents_json: toJsonText(car?.accidents || {}),
    extra_json: toExtraJson(car)
  };
}

function mapRowsToCars(rows, photoRows) {
  const photosByCarId = new Map();

  for (const p of photoRows) {
    const list = photosByCarId.get(p.car_id) || [];
    list.push(p.file_name);
    photosByCarId.set(p.car_id, list);
  }

  return rows.map(r => {
    const extra = parseJsonSafe(r.extra_json, {});
    const specs = parseJsonSafe(r.specs_json, {});
    const costs = parseJsonSafe(r.costs_json, {});
    const accidents = parseJsonSafe(r.accidents_json, {});

    const countryCode = r.country_code || extra.country_code || extra.country || null;

    return {
      ...extra,
      id: Number(r.id),
      brand: r.brand,
      model: r.model,
      year: Number(r.year),
      price: Number(r.price),
      country_code: countryCode,
      country: countryCode,
      assets_folder: r.assets_folder || '',
      added_at: r.added_at,
      in_stock: fromIntBool(r.in_stock),
      is_sold: fromIntBool(r.is_sold),
      is_visible: fromIntBool(r.is_visible),
      featured: fromIntBool(r.featured),
      is_auction: fromIntBool(r.is_auction),
      auction_benefit: r.auction_benefit,
      month: r.month,
      sold_on: r.sold_on,
      specs,
      costs,
      accidents,
      photos: photosByCarId.get(r.id) || []
    };
  });
}

function openDb(env) {
  const dbPath = resolveSqlitePath(env);
  return new Database(dbPath);
}

export async function readCarsSnapshot(env) {
  const db = openDb(env);
  try {
    const rows = db.prepare(`
      SELECT
        id, brand, model, year, price, country_code, assets_folder, added_at,
        in_stock, is_sold, is_visible, featured, is_auction, auction_benefit,
        month, sold_on, specs_json, costs_json, accidents_json, extra_json
      FROM cars
      ORDER BY id
    `).all();

    const photoRows = db.prepare(`
      SELECT car_id, sort_order, file_name
      FROM car_photos
      ORDER BY car_id, sort_order
    `).all();

    return mapRowsToCars(rows, photoRows);
  } finally {
    db.close();
  }
}

export async function writeCarsSnapshot(env, cars) {
  if (!Array.isArray(cars)) {
    throw new Error('cars must be an array');
  }

  const db = openDb(env);
  try {
    const insertCar = db.prepare(`
      INSERT INTO cars (
        id, brand, model, year, price, country_code, assets_folder, added_at,
        in_stock, is_sold, is_visible, featured, is_auction, auction_benefit,
        month, sold_on, specs_json, costs_json, accidents_json, extra_json
      ) VALUES (
        @id, @brand, @model, @year, @price, @country_code, @assets_folder, @added_at,
        @in_stock, @is_sold, @is_visible, @featured, @is_auction, @auction_benefit,
        @month, @sold_on, @specs_json, @costs_json, @accidents_json, @extra_json
      )
    `);

    const insertPhoto = db.prepare(`
      INSERT INTO car_photos (car_id, sort_order, file_name)
      VALUES (?, ?, ?)
    `);

    const wipePhotos = db.prepare('DELETE FROM car_photos');
    const wipeCars = db.prepare('DELETE FROM cars');

    const tx = db.transaction(items => {
      wipePhotos.run();
      wipeCars.run();

      for (const car of items) {
        const row = mapCarToRow(car);
        insertCar.run(row);

        const photos = Array.isArray(car?.photos) ? car.photos : [];
        for (let i = 0; i < photos.length; i++) {
          const name = photos[i];
          if (typeof name !== 'string' || name.trim().length === 0) continue;
          insertPhoto.run(row.id, i + 1, name);
        }
      }
    });

    tx(cars);
  } finally {
    db.close();
  }
}
