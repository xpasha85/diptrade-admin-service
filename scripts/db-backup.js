import {
  parseCliArgs,
  resolveDataRoot,
  resolveBackupsRoot,
  createBackupSnapshot
} from './lib/backup-utils.js';

function printHelp() {
  console.log('Usage: node scripts/db-backup.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --data-root <path>      DATA_ROOT (default: env DATA_ROOT or project default)');
  console.log('  --backups-root <path>   Backups directory (default: <DATA_ROOT>/backups/admin-service)');
  console.log('  --label <text>          Optional label in manifest (default: manual)');
  console.log('  --help                  Show help');
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const dataRoot = resolveDataRoot(args['data-root']);
  const backupsRoot = resolveBackupsRoot(dataRoot, args['backups-root']);
  const label = args.label || 'manual';

  console.log(`[backup] data_root: ${dataRoot}`);
  console.log(`[backup] backups_root: ${backupsRoot}`);

  const created = await createBackupSnapshot({
    dataRoot,
    backupsRoot,
    label
  });

  console.log(`[backup] created: ${created.backupName}`);
  console.log(`[backup] path: ${created.backupDir}`);
  console.log(`[backup] includes.data: ${created.manifest.includes.data}`);
  console.log(`[backup] includes.assets_cars: ${created.manifest.includes.assets_cars}`);
  console.log(`[backup] storage_driver_hint: ${created.manifest.storage_driver_hint}`);
  console.log(`[backup] done`);
}

main().catch(err => {
  console.error(`[backup] failed: ${err?.message || String(err)}`);
  if (err?.stack) {
    const stack = String(err.stack).split('\n').slice(0, 5).join('\n');
    console.error(stack);
  }
  process.exit(1);
});
