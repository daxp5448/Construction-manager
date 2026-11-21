/**
 * Test runner: bundles tests/*.test.ts with esbuild (so they exercise the REAL production modules)
 * and runs them with Node's built-in test runner. Each file runs in its own process with its own temp data dir.
 *
 *   node scripts/run-tests.js            # all tests
 *   node scripts/run-tests.js workflow   # only files matching "workflow"
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const testsDir = path.join(root, 'tests');
const outDir = path.join(root, '.test-build');
const filter = process.argv[2];

(async () => {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const entries = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith('.test.ts') && (!filter || f.includes(filter)))
    .map((f) => path.join(testsDir, f));
  if (!entries.length) {
    console.error('No tests found');
    process.exit(1);
  }
  await esbuild.build({
    entryPoints: entries,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outdir: outDir,
    external: ['electron'],
    sourcemap: 'inline',
    logLevel: 'error',
  });
  const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.js')).map((f) => path.join(outDir, f));
  const r = spawnSync(process.execPath, ['--no-warnings', '--test', '--test-concurrency=1', ...files], { stdio: 'inherit', cwd: root, env: { ...process.env, CRM_QUIET_LOG: '1' } });
  fs.rmSync(outDir, { recursive: true, force: true });
  process.exit(r.status ?? 1);
})();
