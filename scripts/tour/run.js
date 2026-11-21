/* Developer tool: bundle and run the screenshot tour in an isolated temp profile. Usage: node scripts/tour/run.js <outDir> */
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const out = path.resolve(process.argv[2] || path.join(root, '.tour-shots'));
const build = path.join(root, '.tour-build');

(async () => {
  fs.rmSync(build, { recursive: true, force: true });
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'tour-main.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(build, 'tour-main.js'),
    external: ['electron'],
    logLevel: 'error',
  });
  const electron = require(path.join(root, 'node_modules', 'electron'));
  const r = spawnSync(electron, [path.join(build, 'tour-main.js')], { stdio: 'inherit', env: (() => { const e = { ...process.env, TOUR_OUT: out, ELECTRON_ENABLE_LOGGING: '0' }; delete e.ELECTRON_RUN_AS_NODE; return e; })() });
  fs.rmSync(build, { recursive: true, force: true });
  process.exit(r.status ?? 1);
})();
