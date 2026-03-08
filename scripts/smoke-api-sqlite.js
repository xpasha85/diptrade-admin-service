import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import sharp from 'sharp';
import { initSqliteIfNeeded } from '../src/db/sqlite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const out = { dataRoot: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--data-root=')) out.dataRoot = a.slice('--data-root='.length);
    if (a === '--data-root') {
      out.dataRoot = argv[i + 1] || null;
      i += 1;
    }
  }
  return out;
}

function defaultDataRoot() {
  return path.resolve(__dirname, '..', '.tmp-smoke-data');
}

async function ensureDirs(dataRoot) {
  await fs.mkdir(path.resolve(dataRoot, 'assets', 'cars'), { recursive: true });
  await fs.mkdir(path.resolve(dataRoot, 'data'), { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataRoot = path.resolve(args.dataRoot || defaultDataRoot());
  const adminToken = process.env.ADMIN_TOKEN || 'smoke-admin-token';

  await ensureDirs(dataRoot);

  const env = {
    DATA_ROOT: dataRoot,
    STORAGE_DRIVER: 'sqlite',
    SQLITE_PATH: '',
    LOCK_TTL_MS: 300000,
    MAX_BACKUPS: 0
  };

  initSqliteIfNeeded(env);

  process.env.PORT = process.env.PORT || '3010';
  process.env.DATA_ROOT = dataRoot;
  process.env.STORAGE_DRIVER = 'sqlite';
  process.env.ADMIN_TOKEN = adminToken;

  const { createApp } = await import('../src/app.js');
  const app = createApp({ dataRoot });
  const server = app.listen(0);

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  let createdId = null;

  try {
    const healthRes = await fetch(`${base}/health`);
    const beforeRes = await fetch(`${base}/cars`);
    const before = await beforeRes.json();

    const createRes = await fetch(`${base}/cars`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        brand: 'Smoke',
        model: 'API',
        year: 2024,
        price: 1111000,
        country: 'KR'
      })
    });
    const created = await createRes.json();
    createdId = created?.car?.id;

    const patchRes = await fetch(`${base}/cars/${createdId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ price: 2222000, featured: true })
    });
    const patched = await patchRes.json();

    const oneRes = await fetch(`${base}/cars/${createdId}`);
    const one = await oneRes.json();

    const png = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 220, g: 30, b: 30 }
      }
    }).png().toBuffer();

    const form = new FormData();
    form.append('files', new Blob([png], { type: 'image/png' }), 'smoke.png');

    const uploadRes = await fetch(`${base}/cars/${createdId}/photos`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${adminToken}`
      },
      body: form
    });
    const uploaded = await uploadRes.json();

    const photos = Array.isArray(uploaded?.car?.photos) ? uploaded.car.photos : [];

    const reorderRes = await fetch(`${base}/cars/${createdId}/photos/reorder`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ photos: [...photos] })
    });

    let deletePhotoStatus = 'skip';
    if (photos.length > 0) {
      const dpRes = await fetch(`${base}/cars/${createdId}/photos/${encodeURIComponent(photos[0])}`, {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${adminToken}`
        }
      });
      deletePhotoStatus = String(dpRes.status);
      await dpRes.json();
    }

    const bulkRes = await fetch(`${base}/cars/bulk-delete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ ids: [createdId] })
    });
    const bulk = await bulkRes.json();

    createdId = null;

    const afterRes = await fetch(`${base}/cars`);
    const after = await afterRes.json();

    console.log(`health_status=${healthRes.status}`);
    console.log(`before_count=${(before?.cars || []).length}`);
    console.log(`create_status=${createRes.status}`);
    console.log(`patch_status=${patchRes.status}`);
    console.log(`get_one_status=${oneRes.status}`);
    console.log(`updated_price=${patched?.car?.price}`);
    console.log(`upload_status=${uploadRes.status}`);
    console.log(`upload_photo_count=${photos.length}`);
    console.log(`reorder_status=${reorderRes.status}`);
    console.log(`delete_photo_status=${deletePhotoStatus}`);
    console.log(`bulk_delete_status=${bulkRes.status}`);
    console.log(`bulk_deleted=${bulk?.deleted}`);
    console.log(`after_count=${(after?.cars || []).length}`);
  } finally {
    if (createdId != null) {
      try {
        await fetch(`${base}/cars/${createdId}`, {
          method: 'DELETE',
          headers: {
            authorization: `Bearer ${adminToken}`
          }
        });
      } catch {}
    }
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(err => {
  console.error('smoke failed:', err?.message || String(err));
  process.exit(1);
});


