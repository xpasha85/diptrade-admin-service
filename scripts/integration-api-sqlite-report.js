import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const integrationScriptPath = path.resolve(__dirname, 'integration-api-sqlite.js');

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
    values[match[1]] = match[2].trim();
  }
  return values;
}

function toIntOrNull(value) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function createChecks(values, integrationExitCode) {
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

  statusEquals('health_status', 200);
  statusEquals('openapi_status', 200);
  statusEquals('openapi_has_cars_path', 1);
  statusEquals('unauthorized_status', 401);
  statusEquals('unauthorized_error', 'UNAUTHORIZED');
  statusEquals('forbidden_status', 403);
  statusEquals('forbidden_error', 'FORBIDDEN');
  statusEquals('invalid_payload_status', 400);
  statusEquals('invalid_payload_error', 'VALIDATION_FAILED');
  statusEquals('create_status', 201);
  statusEquals('create_bulk_status', 201);
  statusEquals('get_one_status', 200);
  statusEquals('patch_status', 200);
  statusEquals('patched_price', 2299000);
  statusEquals('patched_featured', 0);
  statusEquals('list_page_status', 200);
  statusEquals('list_page_count', 1);
  statusEquals('list_page_has_pagination', 1);
  statusEquals('bulk_status', 200);
  statusEquals('bulk_deleted', 1);
  statusEquals('delete_status', 200);
  statusEquals('delete_ok', 1);
  statusEquals('get_deleted_status', 404);
  statusEquals('final_status', 200);

  const beforeCount = toIntOrNull(values.before_count);
  const finalCount = toIntOrNull(values.final_count);
  checks.push({
    id: 'roundtrip_count',
    title: 'final_count == before_count',
    expected: beforeCount,
    actual: finalCount,
    pass: beforeCount != null && finalCount != null && beforeCount === finalCount
  });

  const createdId = toIntOrNull(values.created_id);
  checks.push({
    id: 'created_id',
    title: 'created_id is numeric',
    expected: 'number',
    actual: createdId,
    pass: createdId != null
  });

  checks.push({
    id: 'integration_exit_code',
    title: 'integration process exit code == 0',
    expected: 0,
    actual: integrationExitCode,
    pass: integrationExitCode === 0
  });

  return checks;
}

function createMarkdown(report) {
  const lines = [];
  lines.push('# API SQLite Integration Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Status: ${report.status}`);
  lines.push(`- Integration exit code: ${report.integrationExitCode}`);
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

async function runIntegration(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [integrationScriptPath, ...args], {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('close', code => {
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
  const reportDir = path.resolve(projectRoot, 'reports', 'integration-api-sqlite', dirStamp);
  const reportDirRelative = path.relative(projectRoot, reportDir).replace(/\\/g, '/');

  await fs.mkdir(reportDir, { recursive: true });

  const run = await runIntegration(args);
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
    integrationExitCode: run.exitCode,
    command: ['node', 'scripts/integration-api-sqlite.js', ...args],
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

main().catch(err => {
  console.error('integration report generation failed:', err?.message || String(err));
  process.exit(1);
});
