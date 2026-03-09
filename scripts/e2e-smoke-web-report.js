import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const e2eScriptPath = path.resolve(__dirname, 'e2e-smoke-web.js');

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

function createChecks(values, e2eExitCode) {
  const checks = [];

  const equals = (key, expected) => {
    const actual = values[key];
    checks.push({
      id: key,
      title: `${key} == ${expected}`,
      expected: String(expected),
      actual: actual ?? null,
      pass: actual === String(expected)
    });
  };

  equals('api_health_status', 200);
  equals('api_create_status', 201);
  equals('api_cars_status', 200);
  equals('api_cars_has_pagination', 1);
  equals('api_car_status', 200);
  equals('api_cors_origin', '*');
  equals('admin_index_status', 200);
  equals('admin_index_has_app_js', 1);
  equals('admin_api_js_status', 200);
  equals('admin_bulk_delete_ref', 1);
  equals('site_index_status', 200);
  equals('site_catalog_status', 200);
  equals('site_history_status', 200);
  equals('site_card_status', 200);
  equals('site_index_has_main_js', 1);
  equals('site_catalog_has_catalog_js', 1);
  equals('site_history_has_history_js', 1);
  equals('site_card_has_card_js', 1);
  equals('site_no_cars_json_refs', 1);
  equals('site_has_cars_api_refs', 1);

  checks.push({
    id: 'e2e_exit_code',
    title: 'e2e process exit code == 0',
    expected: 0,
    actual: e2eExitCode,
    pass: e2eExitCode === 0
  });

  return checks;
}

function createMarkdown(report) {
  const lines = [];
  lines.push('# Web E2E Smoke Report');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Status: ${report.status}`);
  lines.push(`- E2E exit code: ${report.e2eExitCode}`);
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

async function runE2E(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [e2eScriptPath, ...args], {
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
  const reportDir = path.resolve(projectRoot, 'reports', 'e2e-smoke-web', dirStamp);
  const reportDirRelative = path.relative(projectRoot, reportDir).replace(/\\/g, '/');

  await fs.mkdir(reportDir, { recursive: true });

  const run = await runE2E(args);
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
    e2eExitCode: run.exitCode,
    command: ['node', 'scripts/e2e-smoke-web.js', ...args],
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
  console.error('e2e report generation failed:', err?.message || String(err));
  process.exit(1);
});
