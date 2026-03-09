import {
  parseCliArgs,
  resolveDataRoot,
  resolveBackupsRoot,
  createBackupSnapshot,
  listBackups,
  restoreBackupSnapshot
} from './lib/backup-utils.js';

function printHelp() {
  console.log('Usage: node scripts/db-rollback.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --data-root <path>        DATA_ROOT (default: env DATA_ROOT or project default)');
  console.log('  --backups-root <path>     Backups directory (default: <DATA_ROOT>/backups/admin-service)');
  console.log('  --steps <n>               Roll back N checkpoints from latest, default 1');
  console.log('                            Example: 1 -> latest backup, 2 -> previous backup');
  console.log('  --no-safety-backup        Skip automatic backup before rollback');
  console.log('  --help                    Show help');
}

function flagToBool(v) {
  if (v === true) return true;
  if (v == null) return false;
  const raw = String(v).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function parsePositiveInt(v, fallback) {
  const n = Number(v);
  if (Number.isInteger(n) && n > 0) return n;
  return fallback;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const dataRoot = resolveDataRoot(args['data-root']);
  const backupsRoot = resolveBackupsRoot(dataRoot, args['backups-root']);
  const steps = parsePositiveInt(args.steps, 1);
  const skipSafetyBackup = flagToBool(args['no-safety-backup']);

  console.log(`[rollback] data_root: ${dataRoot}`);
  console.log(`[rollback] backups_root: ${backupsRoot}`);
  console.log(`[rollback] steps: ${steps}`);

  const backups = await listBackups(backupsRoot);
  if (backups.length < steps) {
    throw new Error(`Not enough backups for --steps=${steps}. Found: ${backups.length}`);
  }

  const target = backups[steps - 1];
  console.log(`[rollback] target_backup: ${target.backupDir}`);

  if (!skipSafetyBackup) {
    const safety = await createBackupSnapshot({
      dataRoot,
      backupsRoot,
      label: 'before-rollback'
    });
    console.log(`[rollback] safety_backup: ${safety.backupDir}`);
  } else {
    console.log('[rollback] safety_backup: skipped');
  }

  const result = await restoreBackupSnapshot({
    dataRoot,
    backupDir: target.backupDir
  });

  console.log(`[rollback] restored.data: ${result.data.restored}`);
  console.log(`[rollback] restored.assets_cars: ${result.assetsCars.restored}`);
  console.log('[rollback] done');
}

main().catch(err => {
  console.error(`[rollback] failed: ${err?.message || String(err)}`);
  if (err?.stack) {
    const stack = String(err.stack).split('\n').slice(0, 5).join('\n');
    console.error(stack);
  }
  process.exit(1);
});
