import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

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
  return path.resolve(__dirname, '..', '.tmp-integration-data');
}

async function ensureDirs(dataRoot) {
  await fs.mkdir(path.resolve(dataRoot, 'assets', 'cars'), { recursive: true });
  await fs.mkdir(path.resolve(dataRoot, 'data'), { recursive: true });
}

function must(ok, message) {
  if (!ok) {
    throw new Error(message);
  }
}

function authHeader(token) {
  return { authorization: `Bearer ${token}` };
}

async function readJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataRoot = path.resolve(args.dataRoot || defaultDataRoot());
  const adminToken = process.env.ADMIN_TOKEN || 'integration-admin-token';

  await ensureDirs(dataRoot);

  const env = {
    DATA_ROOT: dataRoot,
    STORAGE_DRIVER: 'sqlite',
    SQLITE_PATH: '',
    LOCK_TTL_MS: 300000,
    MAX_BACKUPS: 2
  };

  initSqliteIfNeeded(env);

  process.env.PORT = process.env.PORT || '3020';
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
  let createdBulkId = null;

  try {
    const healthRes = await fetch(`${base}/health`);
    console.log(`health_status=${healthRes.status}`);
    must(healthRes.status === 200, `health expected 200, got ${healthRes.status}`);

    const openapiRes = await fetch(`${base}/openapi.json`);
    const openapi = await readJsonSafe(openapiRes);
    console.log(`openapi_status=${openapiRes.status}`);
    console.log(`openapi_has_cars_path=${openapi?.paths?.['/cars'] ? 1 : 0}`);
    must(openapiRes.status === 200, `openapi expected 200, got ${openapiRes.status}`);
    must(!!openapi?.paths?.['/cars'], 'openapi must include /cars path');

    const unauthRes = await fetch(`${base}/cars`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brand: 'X' })
    });
    const unauthBody = await readJsonSafe(unauthRes);
    console.log(`unauthorized_status=${unauthRes.status}`);
    console.log(`unauthorized_error=${unauthBody?.error || ''}`);
    must(unauthRes.status === 401, `unauthorized expected 401, got ${unauthRes.status}`);

    const forbiddenRes = await fetch(`${base}/cars`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeader('wrong-token')
      },
      body: JSON.stringify({ brand: 'X' })
    });
    const forbiddenBody = await readJsonSafe(forbiddenRes);
    console.log(`forbidden_status=${forbiddenRes.status}`);
    console.log(`forbidden_error=${forbiddenBody?.error || ''}`);
    must(forbiddenRes.status === 403, `forbidden expected 403, got ${forbiddenRes.status}`);

    const invalidRes = await fetch(`${base}/cars`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeader(adminToken)
      },
      body: JSON.stringify({ brand: 'OnlyBrand' })
    });
    const invalidBody = await readJsonSafe(invalidRes);
    console.log(`invalid_payload_status=${invalidRes.status}`);
    console.log(`invalid_payload_error=${invalidBody?.error || ''}`);
    must(invalidRes.status === 400, `invalid payload expected 400, got ${invalidRes.status}`);
    must(invalidBody?.error === 'VALIDATION_FAILED', 'invalid payload error must be VALIDATION_FAILED');

    const beforeRes = await fetch(`${base}/cars`);
    const before = await readJsonSafe(beforeRes);
    const beforeCount = Array.isArray(before?.cars) ? before.cars.length : 0;
    console.log(`before_count=${beforeCount}`);
    must(beforeRes.status === 200, `before list expected 200, got ${beforeRes.status}`);

    const createRes = await fetch(`${base}/cars`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeader(adminToken)
      },
      body: JSON.stringify({
        brand: 'Integration',
        model: 'Primary',
        year: 2024,
        price: 2150000,
        country: 'KR',
        featured: true
      })
    });
    const created = await readJsonSafe(createRes);
    createdId = Number(created?.car?.id);
    console.log(`create_status=${createRes.status}`);
    console.log(`created_id=${Number.isFinite(createdId) ? createdId : ''}`);
    must(createRes.status === 201, `create expected 201, got ${createRes.status}`);
    must(Number.isFinite(createdId), 'created id must be numeric');

    const createBulkRes = await fetch(`${base}/cars`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeader(adminToken)
      },
      body: JSON.stringify({
        brand: 'Integration',
        model: 'Bulk',
        year: 2023,
        price: 1800000,
        country: 'CN',
        in_stock: true
      })
    });
    const createdBulk = await readJsonSafe(createBulkRes);
    createdBulkId = Number(createdBulk?.car?.id);
    console.log(`create_bulk_status=${createBulkRes.status}`);
    console.log(`created_bulk_id=${Number.isFinite(createdBulkId) ? createdBulkId : ''}`);
    must(createBulkRes.status === 201, `bulk create expected 201, got ${createBulkRes.status}`);
    must(Number.isFinite(createdBulkId), 'bulk created id must be numeric');

    const getOneRes = await fetch(`${base}/cars/${createdId}`);
    const one = await readJsonSafe(getOneRes);
    console.log(`get_one_status=${getOneRes.status}`);
    console.log(`get_one_brand=${one?.car?.brand || ''}`);
    must(getOneRes.status === 200, `get one expected 200, got ${getOneRes.status}`);
    must(one?.car?.id === createdId, `get one expected id ${createdId}`);

    const patchRes = await fetch(`${base}/cars/${createdId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        ...authHeader(adminToken)
      },
      body: JSON.stringify({ price: 2299000, featured: false })
    });
    const patched = await readJsonSafe(patchRes);
    console.log(`patch_status=${patchRes.status}`);
    console.log(`patched_price=${patched?.car?.price ?? ''}`);
    console.log(`patched_featured=${patched?.car?.featured ? 1 : 0}`);
    must(patchRes.status === 200, `patch expected 200, got ${patchRes.status}`);
    must(Number(patched?.car?.price) === 2299000, 'patched price mismatch');

    const pageRes = await fetch(`${base}/cars?q=integration&page=1&per_page=1&sort=id_desc`);
    const pageData = await readJsonSafe(pageRes);
    console.log(`list_page_status=${pageRes.status}`);
    console.log(`list_page_count=${Array.isArray(pageData?.cars) ? pageData.cars.length : 0}`);
    console.log(`list_page_has_pagination=${pageData?.pagination ? 1 : 0}`);
    must(pageRes.status === 200, `list with pagination expected 200, got ${pageRes.status}`);
    must(!!pageData?.pagination, 'list response must contain pagination when page/per_page passed');

    const bulkRes = await fetch(`${base}/cars/bulk-delete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeader(adminToken)
      },
      body: JSON.stringify({ ids: [createdBulkId] })
    });
    const bulkBody = await readJsonSafe(bulkRes);
    console.log(`bulk_status=${bulkRes.status}`);
    console.log(`bulk_deleted=${bulkBody?.deleted ?? ''}`);
    must(bulkRes.status === 200, `bulk delete expected 200, got ${bulkRes.status}`);
    must(Number(bulkBody?.deleted) === 1, `bulk delete expected 1, got ${bulkBody?.deleted}`);
    createdBulkId = null;

    const deleteRes = await fetch(`${base}/cars/${createdId}`, {
      method: 'DELETE',
      headers: authHeader(adminToken)
    });
    const deletedBody = await readJsonSafe(deleteRes);
    console.log(`delete_status=${deleteRes.status}`);
    console.log(`delete_ok=${deletedBody?.ok ? 1 : 0}`);
    must(deleteRes.status === 200, `delete expected 200, got ${deleteRes.status}`);
    must(deletedBody?.ok === true, 'delete response must contain ok=true');
    createdId = null;

    const afterDeleteRes = await fetch(`${base}/cars/${Number(created?.car?.id)}`);
    console.log(`get_deleted_status=${afterDeleteRes.status}`);
    must(afterDeleteRes.status === 404, `deleted car must return 404, got ${afterDeleteRes.status}`);

    const finalRes = await fetch(`${base}/cars`);
    const finalBody = await readJsonSafe(finalRes);
    const finalCount = Array.isArray(finalBody?.cars) ? finalBody.cars.length : 0;
    console.log(`final_status=${finalRes.status}`);
    console.log(`final_count=${finalCount}`);
    must(finalRes.status === 200, `final list expected 200, got ${finalRes.status}`);
    must(finalCount === beforeCount, `final count must equal before count (${beforeCount}), got ${finalCount}`);
  } finally {
    if (createdBulkId != null) {
      try {
        await fetch(`${base}/cars/${createdBulkId}`, {
          method: 'DELETE',
          headers: authHeader(adminToken)
        });
      } catch {}
    }
    if (createdId != null) {
      try {
        await fetch(`${base}/cars/${createdId}`, {
          method: 'DELETE',
          headers: authHeader(adminToken)
        });
      } catch {}
    }
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(err => {
  console.error('integration failed:', err?.message || String(err));
  process.exit(1);
});
