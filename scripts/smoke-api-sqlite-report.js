import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const smokeScriptPath = path.resolve(__dirname, 'smoke-api-sqlite.js');

function pad(n) {
  return String(n).padStart(2, '0');
}

function timestampForDir(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function parseKeyValueLines(stdoutText) {
  const values = {};
  for (const rawLine of stdoutText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([a-zA-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].trim();
    values[key] = value;
  }
  return values;
}

function toIntOrNull(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function createChecks(values, smokeExitCode) {
  const checks = [];

  const statusEquals = (key, expected) => {
    const actual = values[key];
    checks.push({
      id: key,
      title: `${key} == ${expected}`,
      expected: String(expected),
      actual: actual ?? null,
      pass: actual === String(expected)
    });
  };

  const statusIn = (key, expectedList) => {
    const actual = values[key];
    checks.push({
      id: key,
      title: `${key} in [${expectedList.join(', ')}]`,
      expected: expectedList.join(', '),
      actual: actual ?? null,
      pass: actual != null && expectedList.includes(actual)
    });
  };

  statusEquals('health_status', 200);
  statusEquals('create_status', 201);
  statusEquals('patch_status', 200);
  statusEquals('get_one_status', 200);
  statusIn('upload_status', ['200', '201']);
  statusEquals('reorder_status', 200);
  statusIn('delete_photo_status', ['200', '204']);
  statusEquals('bulk_delete_status', 200);
  statusEquals('bulk_deleted', 1);
  statusEquals('updated_price', 2222000);

  const photoCount = toIntOrNull(values.upload_photo_count);
  checks.push({
    id: 'upload_photo_count',
    title: 'upload_photo_count >= 1',
    expected: '>= 1',
    actual: photoCount,
    pass: photoCount != null && photoCount >= 1
  });

  const beforeCount = toIntOrNull(values.before_count);
  const afterCount = toIntOrNull(values.after_count);
  checks.push({
    id: 'count_roundtrip',
    title: 'after_count == before_count',
    expected: beforeCount,
    actual: afterCount,
    pass: beforeCount != null && afterCount != null && beforeCount === afterCount
  });

  checks.push({
    id: 'smoke_exit_code',
    title: 'smoke process exit code == 0',
    expected: 0,
    actual: smokeExitCode,
    pass: smokeExitCode === 0
  });

  return checks;
}

function createMarkdown(report) {
  const lines = [];
  lines.push('# API SQLite Smoke Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Status: ${report.status}`);
  lines.push(`- Smoke exit code: ${report.smokeExitCode}`);
  lines.push(`- Command: \`${report.command.join(' ')}\``);
  lines.push(`- Report dir: \`${report.reportDirRelative}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Passed: ${report.summary.passed}/${report.summary.total}`);
  lines.push(`- Failed: ${report.summary.failed}`);
  lines.push('');
  lines.push('## Checks');
  lines.push('');
  lines.push('| Check | Result | Expected | Actual |');
  lines.push('|---|---|---|---|');
  for (const c of report.checks) {
    lines.push(`| ${c.title} | ${c.pass ? 'PASS' : 'FAIL'} | ${c.expected} | ${c.actual ?? ''} |`);
  }
  lines.push('');
  lines.push('## Parsed Values');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.values, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Files');
  lines.push('');
  lines.push(`- JSON: \`${report.files.json}\``);
  lines.push(`- Raw log: \`${report.files.rawLog}\``);
  return `${lines.join('\n')}\n`;
}

async function runSmoke(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [smokeScriptPath, ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const generatedAt = new Date().toISOString();
  const dirStamp = timestampForDir();
  const reportDir = path.resolve(projectRoot, 'reports', 'smoke-api-sqlite', dirStamp);
  const reportDirRelative = path.relative(projectRoot, reportDir).replace(/\\/g, '/');

  await fs.mkdir(reportDir, { recursive: true });

  const run = await runSmoke(args);
  const values = parseKeyValueLines(run.stdout);
  const checks = createChecks(values, run.exitCode);
  const passed = checks.filter(c => c.pass).length;
  const failed = checks.length - passed;
  const status = failed === 0 ? 'PASS' : 'FAIL';

  const reportJsonPath = path.resolve(reportDir, 'report.json');
  const rawLogPath = path.resolve(reportDir, 'raw.log');
  const reportMdPath = path.resolve(reportDir, 'report.md');

  const report = {
    generatedAt,
    status,
    smokeExitCode: run.exitCode,
    command: ['node', 'scripts/smoke-api-sqlite.js', ...args],
    reportDirRelative,
    values,
    checks,
    summary: {
      total: checks.length,
      passed,
      failed
    },
    files: {
      json: path.relative(projectRoot, reportJsonPath).replace(/\\/g, '/'),
      markdown: path.relative(projectRoot, reportMdPath).replace(/\\/g, '/'),
      rawLog: path.relative(projectRoot, rawLogPath).replace(/\\/g, '/')
    }
  };

  const rawLog = `# stdout\n${run.stdout}\n# stderr\n${run.stderr}\n`;
  const markdown = createMarkdown(report);

  await Promise.all([
    fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    fs.writeFile(rawLogPath, rawLog, 'utf8'),
    fs.writeFile(reportMdPath, markdown, 'utf8')
  ]);

  console.log(`report_status=${status}`);
  console.log(`report_dir=${reportDirRelative}`);
  console.log(`report_json=${report.files.json}`);
  console.log(`report_md=${report.files.markdown}`);
  console.log(`report_raw_log=${report.files.rawLog}`);

  if (status !== 'PASS') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('report generation failed:', err?.message || String(err));
  process.exit(1);
});
