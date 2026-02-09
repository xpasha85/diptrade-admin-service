import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import healthRouter from './routes/health.js';
import carsRouter from './routes/cars.js';

function resolveDefaultDataRoot() {
  // src/app.js -> .../diptrade-tmp/admin-service/src
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // По LOCAL_DEV.md: DATA_ROOT = ../diptrade-tmp-data (рядом с repo root diptrade-tmp)
  // Значит от src: ../../.. -> папка, где лежат diptrade-tmp и diptrade-tmp-data
  return path.resolve(__dirname, '..', '..', '..', 'diptrade-tmp-data');
}

export function createApp(opts = {}) {
  const app = express();

  const dataRoot = (opts.dataRoot || process.env.DATA_ROOT || resolveDefaultDataRoot()).trim();
  const assetsDir = path.join(dataRoot, 'assets');

  app.use(express.json());

  // --- CORS для локальной разработки (UI на 3002, API на 3001) ---
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // если нужно будет — добавим Authorization
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // --- Static assets из DATA_ROOT/assets -> /assets ---
  // Пример: http://localhost:3001/assets/cars/<assets_folder>/<photo>
  app.use('/assets', express.static(assetsDir));

  // --- Routes ---
  app.use('/health', healthRouter);
  app.use('/cars', carsRouter);

  return app;
}
