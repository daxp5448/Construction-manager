/**
 * End-to-end smoke test of the REAL Electron app (dev build or the packaged exe) in an isolated temp profile:
 * starts the app, initialises the database, loads the UI, calls the IPC layer, creates a company and exports an
 * Excel + PDF report through Chromium. Exits non-zero on failure.
 *
 *   node scripts/smoke.js                              # uses node_modules/electron + dist-electron/main.js
 *   node scripts/smoke.js "release/win-unpacked/Construction Record Manager.exe"
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const exe = process.argv[2] ? path.resolve(process.argv[2]) : null;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-smoke-'));
const outFile = path.join(base, 'result.json');
const env = { ...process.env, CRM_SMOKE: '1', CRM_SMOKE_OUT: outFile, CRM_DATA_DIR: path.join(base, 'data'), CRM_STORAGE_ROOT: path.join(base, 'Records'), CRM_QUIET_LOG: '1', CRM_FORCE_PROD: '1' };
delete env.ELECTRON_RUN_AS_NODE; // some host apps (VS Code) set this and would make Electron behave like plain Node

let cmd;
let args;
if (exe) {
  cmd = exe;
  args = [];
} else {
  cmd = require(path.join(root, 'node_modules', 'electron'));
  args = [root];
}
const r = spawnSync(cmd, args, { env, stdio: 'inherit', timeout: 120000 });
let result = null;
try {
  result = JSON.parse(fs.readFileSync(outFile, 'utf8'));
} catch {
  /* no result */
}
console.log('SMOKE exit code:', r.status, '\n' + JSON.stringify(result, null, 2));
const pdfOk = result?.reports?.some((x) => x.format === 'pdf' && x.bytes > 1000);
const xlsxOk = result?.reports?.some((x) => x.format === 'xlsx' && x.bytes > 1000);
const good = r.status === 0 && result?.ok && result.dbReady && result.dashboardOk && result.companyCreated && pdfOk && xlsxOk && result.renderer?.rootChildren > 0 && result.renderer?.api === 'function';
try {
  fs.rmSync(base, { recursive: true, force: true });
} catch {
  /* ignore */
}
if (!good) {
  console.error('SMOKE TEST FAILED');
  process.exit(1);
}
console.log('SMOKE TEST PASSED');
