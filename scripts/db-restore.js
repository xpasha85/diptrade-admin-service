import {
  parseCliArgs,
  resolveDataRoot,
  resolveBackupsRoot,
  createBackupSnapshot,
  resolveBackupByRef,
  restoreBackupSnapshot
} from './lib/backup-utils.js';

function printHelp() {
  console.log('Usage: node scripts/db-restore.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --data-root <path>        DATA_ROOT (default: env DATA_ROOT or project default)');
  console.log('  --backups-root <path>     Backups directory (default: <DATA_ROOT>/backups/admin-service)');
  console.log('  --backup <name-or-path>   Backup directory name or absolute/relative path');
  console.log('  --no-safety-backup        Skip automatic backup before restore');
  console.log('  --help                    Show help');
}

function flagToBool(v) {
  if (v === true) return true;
  if (v == null) return false;
  const raw = String(v).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const dataRoot = resolveDataRoot(args['data-root']);
  const backupsRoot = resolveBackupsRoot(dataRoot, args['backups-root']);
  const backupRef = args.backup || '';
  const skipSafetyBackup = flagToBool(args['no-safety-backup']);

  console.log(`[restore] data_root: ${dataRoot}`);
  console.log(`[restore] backups_root: ${backupsRoot}`);

  const backupDir = await resolveBackupByRef(backupsRoot, backupRef);
  console.log(`[restore] source_backup: ${backupDir}`);

  if (!skipSafetyBackup) {
    const safety = await createBackupSnapshot({
      dataRoot,
      backupsRoot,
      label: 'before-restore'
    });
    console.log(`[restore] safety_backup: ${safety.backupDir}`);
  } else {
    console.log('[restore] safety_backup: skipped');
  }

  const result = await restoreBackupSnapshot({ dataRoot, backupDir });

  console.log(`[restore] restored.data: ${result.data.restored}`);
  console.log(`[restore] restored.assets_cars: ${result.assetsCars.restored}`);
  console.log(`[restore] done`);
}

main().catch(err => {
  console.error(`[restore] failed: ${err?.message || String(err)}`);
  if (err?.stack) {
    const stack = String(err.stack).split('\n').slice(0, 5).join('\n');
    console.error(stack);
  }
  process.exit(1);
});
