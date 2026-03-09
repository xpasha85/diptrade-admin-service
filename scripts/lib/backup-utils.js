import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const BACKUP_NAME_PREFIX = 'backup-';
const MANIFEST_FILE = 'manifest.json';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveDefaultDataRoot() {
  return path.resolve(__dirname, '..', '..', '..', '..', 'diptrade-tmp-data');
}

export function resolveDataRoot(dataRootArg) {
  return path.resolve(dataRootArg || process.env.DATA_ROOT || resolveDefaultDataRoot());
}

export function resolveBackupsRoot(dataRoot, backupsRootArg) {
  if (backupsRootArg && String(backupsRootArg).trim().length > 0) {
    return path.resolve(backupsRootArg);
  }
  return path.resolve(dataRoot, 'backups', 'admin-service');
}

export function parseCliArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    if (token.includes('=')) {
      const idx = token.indexOf('=');
      const key = token.slice(2, idx);
      const value = token.slice(idx + 1);
      args[key] = value;
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return args;
}

export async function pathExists(targetPath) {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

async function isDirectory(targetPath) {
  try {
    const st = await fs.stat(targetPath);
    return st.isDirectory();
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function copyDirIfExists(sourceDir, targetDir) {
  const exists = await pathExists(sourceDir);
  if (!exists) return false;

  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
  return true;
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function inferStorageDriverHint(includes) {
  if (includes.data_cars_sqlite) return 'sqlite';
  if (includes.data_cars_json) return 'json';
  return 'unknown';
}

export async function createBackupSnapshot(opts) {
  const dataRoot = path.resolve(opts.dataRoot);
  const backupsRoot = path.resolve(opts.backupsRoot);
  const label = String(opts.label || 'manual').trim() || 'manual';

  await fs.mkdir(backupsRoot, { recursive: true });

  let backupName = '';
  let backupDir = '';
  for (;;) {
    backupName = `${BACKUP_NAME_PREFIX}${backupTimestamp()}`;
    backupDir = path.resolve(backupsRoot, backupName);
    if (!(await pathExists(backupDir))) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await fs.mkdir(backupDir, { recursive: false });

  const sourceDataDir = path.resolve(dataRoot, 'data');
  const sourceAssetsCarsDir = path.resolve(dataRoot, 'assets', 'cars');

  const snapshotDataDir = path.resolve(backupDir, 'data');
  const snapshotAssetsCarsDir = path.resolve(backupDir, 'assets', 'cars');

  const includedData = await copyDirIfExists(sourceDataDir, snapshotDataDir);
  const includedCarsAssets = await copyDirIfExists(sourceAssetsCarsDir, snapshotAssetsCarsDir);

  const includes = {
    data: includedData,
    assets_cars: includedCarsAssets,
    data_cars_json: includedData && await pathExists(path.resolve(snapshotDataDir, 'cars.json')),
    data_cars_sqlite: includedData && await pathExists(path.resolve(snapshotDataDir, 'cars.sqlite'))
  };

  const manifest = {
    version: 1,
    created_at: new Date().toISOString(),
    label,
    data_root: dataRoot,
    includes,
    storage_driver_hint: inferStorageDriverHint(includes)
  };

  await fs.writeFile(
    path.resolve(backupDir, MANIFEST_FILE),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8'
  );

  return { backupName, backupDir, manifest };
}

export async function listBackups(backupsRoot) {
  let entries;
  try {
    entries = await fs.readdir(backupsRoot, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }

  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(BACKUP_NAME_PREFIX)) continue;

    const backupDir = path.resolve(backupsRoot, entry.name);
    const manifestPath = path.resolve(backupDir, MANIFEST_FILE);
    const manifest = await readJsonIfExists(manifestPath);
    let createdAtMs = 0;

    if (manifest?.created_at) {
      const t = Date.parse(manifest.created_at);
      if (Number.isFinite(t)) createdAtMs = t;
    }
    if (createdAtMs === 0) {
      const st = await fs.stat(backupDir);
      createdAtMs = st.mtimeMs;
    }

    items.push({
      name: entry.name,
      backupDir,
      manifest,
      createdAtMs
    });
  }

  items.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return items;
}

export async function resolveBackupByRef(backupsRoot, backupRef) {
  if (backupRef && String(backupRef).trim().length > 0) {
    const ref = String(backupRef).trim();
    const candidates = [
      path.resolve(backupsRoot, ref),
      path.resolve(ref)
    ];

    for (const candidate of candidates) {
      if (await isDirectory(candidate)) {
        return candidate;
      }
    }

    throw new Error(`Backup not found: ${backupRef}`);
  }

  const backups = await listBackups(backupsRoot);
  if (!backups.length) {
    throw new Error(`No backups found in ${backupsRoot}`);
  }
  return backups[0].backupDir;
}

function tmpSuffix() {
  return `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
}

async function replaceDirectoryFromSnapshot(sourceDir, targetDir) {
  const sourceExists = await pathExists(sourceDir);
  if (!sourceExists) {
    await fs.rm(targetDir, { recursive: true, force: true });
    return { restored: false, removed: true };
  }

  const parentDir = path.dirname(targetDir);
  await fs.mkdir(parentDir, { recursive: true });

  const suffix = tmpSuffix();
  const stageDir = path.resolve(parentDir, `.restore-stage-${path.basename(targetDir)}-${suffix}`);
  const previousDir = path.resolve(parentDir, `.restore-prev-${path.basename(targetDir)}-${suffix}`);

  await fs.rm(stageDir, { recursive: true, force: true });
  await fs.rm(previousDir, { recursive: true, force: true });

  await fs.cp(sourceDir, stageDir, { recursive: true, force: true });

  const targetExists = await pathExists(targetDir);

  try {
    if (targetExists) {
      await fs.rename(targetDir, previousDir);
    }

    await fs.rename(stageDir, targetDir);

    if (targetExists) {
      await fs.rm(previousDir, { recursive: true, force: true });
    }

    return { restored: true, removed: false };
  } catch (err) {
    await fs.rm(stageDir, { recursive: true, force: true }).catch(() => {});

    if (targetExists) {
      const targetStillExists = await pathExists(targetDir);
      if (!targetStillExists && await pathExists(previousDir)) {
        await fs.rename(previousDir, targetDir).catch(() => {});
      }
      await fs.rm(previousDir, { recursive: true, force: true }).catch(() => {});
    }

    throw err;
  }
}

export async function restoreBackupSnapshot(opts) {
  const dataRoot = path.resolve(opts.dataRoot);
  const backupDir = path.resolve(opts.backupDir);

  if (!(await isDirectory(backupDir))) {
    throw new Error(`Backup directory does not exist: ${backupDir}`);
  }

  const sourceDataDir = path.resolve(backupDir, 'data');
  const sourceAssetsCarsDir = path.resolve(backupDir, 'assets', 'cars');

  const targetDataDir = path.resolve(dataRoot, 'data');
  const targetAssetsCarsDir = path.resolve(dataRoot, 'assets', 'cars');

  const dataResult = await replaceDirectoryFromSnapshot(sourceDataDir, targetDataDir);
  const assetsResult = await replaceDirectoryFromSnapshot(sourceAssetsCarsDir, targetAssetsCarsDir);

  return {
    data: dataResult,
    assetsCars: assetsResult
  };
}
