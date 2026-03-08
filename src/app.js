import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import healthRouter from './routes/health.js';
import carsRouter from './routes/cars.js';

function resolveDefaultDataRoot() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', '..', '..', 'diptrade-tmp-data');
}

export function createApp(opts = {}) {
  const app = express();

  const dataRoot = (opts.dataRoot || process.env.DATA_ROOT || resolveDefaultDataRoot()).trim();
  const assetsDir = path.join(dataRoot, 'assets');

  app.use(express.json());

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use('/assets', express.static(assetsDir));
  app.use('/health', healthRouter);
  app.use('/cars', carsRouter);

  return app;
}
