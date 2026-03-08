PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cars (
  id INTEGER PRIMARY KEY,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NOT NULL,
  price INTEGER NOT NULL,
  country_code TEXT,
  assets_folder TEXT,
  added_at TEXT,
  in_stock INTEGER NOT NULL DEFAULT 0,
  is_sold INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  is_auction INTEGER NOT NULL DEFAULT 0,
  auction_benefit INTEGER,
  month INTEGER,
  sold_on TEXT,
  specs_json TEXT,
  costs_json TEXT,
  accidents_json TEXT,
  extra_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS car_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(car_id, sort_order),
  UNIQUE(car_id, file_name),
  FOREIGN KEY(car_id) REFERENCES cars(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cars_country_code ON cars(country_code);
CREATE INDEX IF NOT EXISTS idx_cars_visibility ON cars(is_visible, is_sold);
CREATE INDEX IF NOT EXISTS idx_cars_price ON cars(price);
CREATE INDEX IF NOT EXISTS idx_cars_year ON cars(year);
CREATE INDEX IF NOT EXISTS idx_cars_added_at ON cars(added_at);
CREATE INDEX IF NOT EXISTS idx_car_photos_order ON car_photos(car_id, sort_order);
