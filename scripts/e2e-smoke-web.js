import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { initSqliteIfNeeded } from '../src/db/sqlite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const out = {
    dataRoot: null,
    adminUiDir: null,
    siteDir: null
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    if (a.startsWith('--data-root=')) out.dataRoot = a.slice('--data-root='.length);
    if (a === '--data-root') {
      out.dataRoot = argv[i + 1] || null;
      i += 1;
    }

    if (a.startsWith('--admin-ui-dir=')) out.adminUiDir = a.slice('--admin-ui-dir='.length);
    if (a === '--admin-ui-dir') {
      out.adminUiDir = argv[i + 1] || null;
      i += 1;
    }

    if (a.startsWith('--site-dir=')) out.siteDir = a.slice('--site-dir='.length);
    if (a === '--site-dir') {
      out.siteDir = argv[i + 1] || null;
      i += 1;
    }
  }

  return out;
}

function defaultDataRoot() {
  return path.resolve(__dirname, '..', '.tmp-e2e-web-data');
}

function defaultAdminUiDir() {
  return path.resolve(__dirname, '..', '..', 'admin-ui');
}

function defaultSiteDir() {
  return path.resolve(__dirname, '..', '..', 'site');
}

function must(ok, message) {
  if (!ok) throw new Error(message);
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.ico') return 'image/x-icon';
  return 'application/octet-stream';
}

async function startStaticServer(rootDir) {
  const absoluteRoot = path.resolve(rootDir);
  await fs.access(absoluteRoot);

  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(urlObj.pathname || '/');
      if (pathname === '/') pathname = '/index.html';

      const filePath = path.resolve(absoluteRoot, `.${pathname}`);
      if (!filePath.startsWith(absoluteRoot)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }

      const data = await fs.readFile(filePath);
      res.statusCode = 200;
      res.setHeader('content-type', mimeType(filePath));
      res.end(data);
    } catch (err) {
      if (err?.code === 'ENOENT') {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    close: async () => await new Promise(resolve => server.close(resolve))
  };
}

async function ensureDirs(dataRoot) {
  await fs.mkdir(path.resolve(dataRoot, 'assets', 'cars'), { recursive: true });
  await fs.mkdir(path.resolve(dataRoot, 'data'), { recursive: true });
}

function authHeader(token) {
  return { authorization: `Bearer ${token}` };
}

async function readTextSafe(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
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
  const adminUiDir = path.resolve(args.adminUiDir || defaultAdminUiDir());
  const siteDir = path.resolve(args.siteDir || defaultSiteDir());
  const adminToken = process.env.ADMIN_TOKEN || 'e2e-smoke-admin-token';

  await ensureDirs(dataRoot);
  await fs.access(adminUiDir);
  await fs.access(siteDir);

  const env = {
    DATA_ROOT: dataRoot,
    STORAGE_DRIVER: 'sqlite',
    SQLITE_PATH: '',
    LOCK_TTL_MS: 300000,
    MAX_BACKUPS: 2
  };

  initSqliteIfNeeded(env);

  process.env.PORT = process.env.PORT || '3030';
  process.env.DATA_ROOT = dataRoot;
  process.env.STORAGE_DRIVER = 'sqlite';
  process.env.ADMIN_TOKEN = adminToken;

  const { createApp } = await import('../src/app.js');
  const app = createApp({ dataRoot });
  const apiServer = app.listen(0);

  await new Promise((resolve, reject) => {
    apiServer.once('listening', resolve);
    apiServer.once('error', reject);
  });

  const apiAddress = apiServer.address();
  const apiPort = typeof apiAddress === 'object' && apiAddress ? apiAddress.port : 0;
  const apiBase = `http://127.0.0.1:${apiPort}`;

  const adminStatic = await startStaticServer(adminUiDir);
  const siteStatic = await startStaticServer(siteDir);

  console.log(`api_base=${apiBase}`);
  console.log(`admin_ui_base=${adminStatic.base}`);
  console.log(`site_base=${siteStatic.base}`);

  let createdId = null;

  try {
    const healthRes = await fetch(`${apiBase}/health`);
    console.log(`api_health_status=${healthRes.status}`);
    must(healthRes.status === 200, `api health expected 200, got ${healthRes.status}`);

    const createRes = await fetch(`${apiBase}/cars`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...authHeader(adminToken)
      },
      body: JSON.stringify({
        brand: 'E2E',
        model: 'Smoke',
        year: 2022,
        price: 1790000,
        country: 'KR',
        in_stock: true
      })
    });
    const created = await readJsonSafe(createRes);
    createdId = Number(created?.car?.id);
    console.log(`api_create_status=${createRes.status}`);
    console.log(`api_created_id=${Number.isFinite(createdId) ? createdId : ''}`);
    must(createRes.status === 201, `api create expected 201, got ${createRes.status}`);
    must(Number.isFinite(createdId), 'api created_id must be numeric');

    const carsRes = await fetch(`${apiBase}/cars?page=1&per_page=10&sort=id_desc`);
    const carsBody = await readJsonSafe(carsRes);
    console.log(`api_cars_status=${carsRes.status}`);
    console.log(`api_cars_has_pagination=${carsBody?.pagination ? 1 : 0}`);
    console.log(`api_cors_origin=${carsRes.headers.get('access-control-allow-origin') || ''}`);
    must(carsRes.status === 200, `api /cars expected 200, got ${carsRes.status}`);
    must(!!carsBody?.pagination, 'api /cars must return pagination for page/per_page');
    must(carsRes.headers.get('access-control-allow-origin') === '*', 'api CORS header must be "*"');

    const carRes = await fetch(`${apiBase}/cars/${createdId}`);
    const carBody = await readJsonSafe(carRes);
    console.log(`api_car_status=${carRes.status}`);
    console.log(`api_car_id=${carBody?.car?.id ?? ''}`);
    must(carRes.status === 200, `api /cars/:id expected 200, got ${carRes.status}`);
    must(Number(carBody?.car?.id) === createdId, 'api /cars/:id id mismatch');

    const adminIndexRes = await fetch(`${adminStatic.base}/index.html`);
    const adminIndexHtml = await readTextSafe(adminIndexRes);
    console.log(`admin_index_status=${adminIndexRes.status}`);
    console.log(`admin_index_has_app_js=${adminIndexHtml.includes('js/app.js') ? 1 : 0}`);
    must(adminIndexRes.status === 200, `admin index expected 200, got ${adminIndexRes.status}`);
    must(adminIndexHtml.includes('js/app.js'), 'admin index must include js/app.js');

    const adminApiJsRes = await fetch(`${adminStatic.base}/js/api.js`);
    const adminApiJs = await readTextSafe(adminApiJsRes);
    console.log(`admin_api_js_status=${adminApiJsRes.status}`);
    console.log(`admin_bulk_delete_ref=${adminApiJs.includes('/cars/bulk-delete') ? 1 : 0}`);
    must(adminApiJsRes.status === 200, `admin js/api.js expected 200, got ${adminApiJsRes.status}`);
    must(adminApiJs.includes('/cars/bulk-delete'), 'admin js/api.js must reference /cars/bulk-delete');

    const siteIndexRes = await fetch(`${siteStatic.base}/index.html`);
    const siteCatalogRes = await fetch(`${siteStatic.base}/catalog.html`);
    const siteHistoryRes = await fetch(`${siteStatic.base}/history.html`);
    const siteCardRes = await fetch(`${siteStatic.base}/car.html?id=${createdId}`);
    const siteIndexHtml = await readTextSafe(siteIndexRes);
    const siteCatalogHtml = await readTextSafe(siteCatalogRes);
    const siteHistoryHtml = await readTextSafe(siteHistoryRes);
    const siteCardHtml = await readTextSafe(siteCardRes);

    console.log(`site_index_status=${siteIndexRes.status}`);
    console.log(`site_catalog_status=${siteCatalogRes.status}`);
    console.log(`site_history_status=${siteHistoryRes.status}`);
    console.log(`site_card_status=${siteCardRes.status}`);

    must(siteIndexRes.status === 200, `site index expected 200, got ${siteIndexRes.status}`);
    must(siteCatalogRes.status === 200, `site catalog expected 200, got ${siteCatalogRes.status}`);
    must(siteHistoryRes.status === 200, `site history expected 200, got ${siteHistoryRes.status}`);
    must(siteCardRes.status === 200, `site card expected 200, got ${siteCardRes.status}`);

    const siteMainRef = siteIndexHtml.includes('assets/js/main.js');
    const siteCatalogRef = siteCatalogHtml.includes('assets/js/catalog.js');
    const siteHistoryRef = siteHistoryHtml.includes('assets/js/history.js');
    const siteCardRef = siteCardHtml.includes('assets/js/card.js');
    console.log(`site_index_has_main_js=${siteMainRef ? 1 : 0}`);
    console.log(`site_catalog_has_catalog_js=${siteCatalogRef ? 1 : 0}`);
    console.log(`site_history_has_history_js=${siteHistoryRef ? 1 : 0}`);
    console.log(`site_card_has_card_js=${siteCardRef ? 1 : 0}`);
    must(siteMainRef, 'site index must include assets/js/main.js');
    must(siteCatalogRef, 'site catalog must include assets/js/catalog.js');
    must(siteHistoryRef, 'site history must include assets/js/history.js');
    must(siteCardRef, 'site card must include assets/js/card.js');

    const [siteMainJs, siteCatalogJs, siteHistoryJs, siteCardJs] = await Promise.all([
      fetch(`${siteStatic.base}/assets/js/main.js`).then(readTextSafe),
      fetch(`${siteStatic.base}/assets/js/catalog.js`).then(readTextSafe),
      fetch(`${siteStatic.base}/assets/js/history.js`).then(readTextSafe),
      fetch(`${siteStatic.base}/assets/js/card.js`).then(readTextSafe)
    ]);

    const joinedSiteJs = `${siteMainJs}\n${siteCatalogJs}\n${siteHistoryJs}\n${siteCardJs}`;
    const hasCarsJsonRef = joinedSiteJs.includes('data/cars.json');
    const hasCarsApiRef = joinedSiteJs.includes('/cars');
    console.log(`site_no_cars_json_refs=${hasCarsJsonRef ? 0 : 1}`);
    console.log(`site_has_cars_api_refs=${hasCarsApiRef ? 1 : 0}`);
    must(!hasCarsJsonRef, 'site JS must not reference data/cars.json');
    must(hasCarsApiRef, 'site JS must reference /cars API');
  } finally {
    if (createdId != null) {
      try {
        await fetch(`${apiBase}/cars/${createdId}`, {
          method: 'DELETE',
          headers: authHeader(adminToken)
        });
      } catch {}
    }

    await Promise.allSettled([
      adminStatic.close(),
      siteStatic.close(),
      new Promise(resolve => apiServer.close(resolve))
    ]);
  }
}

main().catch(err => {
  console.error('e2e smoke failed:', err?.message || String(err));
  process.exit(1);
});
