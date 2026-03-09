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
  const cleanupIds = new Set();

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
    if (createdId != null) cleanupIds.add(Number(createdId));

    const createSoldRes = await fetch(`${base}/cars`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        brand: 'Smoke',
        model: 'Sold',
        year: 2023,
        price: 1333000,
        country: 'KR',
        is_sold: true
      })
    });
    const createdSold = await createSoldRes.json();
    const soldId = createdSold?.car?.id;
    if (soldId != null) cleanupIds.add(Number(soldId));

    const createCnRes = await fetch(`${base}/cars`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        brand: 'Paged',
        model: 'CnStock',
        year: 2022,
        price: 999000,
        country: 'CN',
        in_stock: true
      })
    });
    const createdCn = await createCnRes.json();
    const cnId = createdCn?.car?.id;
    if (cnId != null) cleanupIds.add(Number(cnId));

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

    const filteredRes = await fetch(`${base}/cars?country_code=KR&status=active&q=smoke&page=1&per_page=1&sort=id_desc`);
    const filtered = await filteredRes.json();

    const secondPageRes = await fetch(`${base}/cars?country_code=KR&q=smoke&page=2&per_page=1&sort=id_desc`);
    const secondPage = await secondPageRes.json();

    const cnFilterRes = await fetch(`${base}/cars?country=CN&in_stock=true&price_to=1000000`);
    const cnFiltered = await cnFilterRes.json();

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
      body: JSON.stringify({ ids: Array.from(cleanupIds.values()) })
    });
    const bulk = await bulkRes.json();

    cleanupIds.clear();
    createdId = null;

    const afterRes = await fetch(`${base}/cars`);
    const after = await afterRes.json();

    console.log(`health_status=${healthRes.status}`);
    console.log(`before_count=${(before?.cars || []).length}`);
    console.log(`create_status=${createRes.status}`);
    console.log(`create_sold_status=${createSoldRes.status}`);
    console.log(`create_cn_status=${createCnRes.status}`);
    console.log(`patch_status=${patchRes.status}`);
    console.log(`get_one_status=${oneRes.status}`);
    console.log(`updated_price=${patched?.car?.price}`);
    console.log(`filtered_status=${filteredRes.status}`);
    console.log(`filtered_count=${(filtered?.cars || []).length}`);
    console.log(`filtered_total=${filtered?.pagination?.total ?? 'none'}`);
    console.log(`filtered_page=${filtered?.pagination?.page ?? 'none'}`);
    console.log(`filtered_per_page=${filtered?.pagination?.per_page ?? 'none'}`);
    console.log(`second_page_status=${secondPageRes.status}`);
    console.log(`second_page_count=${(secondPage?.cars || []).length}`);
    console.log(`cn_filter_status=${cnFilterRes.status}`);
    console.log(`cn_filter_count=${(cnFiltered?.cars || []).length}`);
    console.log(`upload_status=${uploadRes.status}`);
    console.log(`upload_photo_count=${photos.length}`);
    console.log(`reorder_status=${reorderRes.status}`);
    console.log(`delete_photo_status=${deletePhotoStatus}`);
    console.log(`bulk_delete_status=${bulkRes.status}`);
    console.log(`bulk_deleted=${bulk?.deleted}`);
    console.log(`after_count=${(after?.cars || []).length}`);
  } finally {
    if (cleanupIds.size > 0) {
      for (const id of cleanupIds) {
        try {
          await fetch(`${base}/cars/${id}`, {
            method: 'DELETE',
            headers: {
              authorization: `Bearer ${adminToken}`
            }
          });
        } catch {}
      }
    } else if (createdId != null) {
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


