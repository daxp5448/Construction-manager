const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

async function buildElectron() {
  if (!fs.existsSync('dist-electron')) {
    fs.mkdirSync('dist-electron', { recursive: true });
  }

  await esbuild.build({
    entryPoints: ['electron/main.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    outfile: 'dist-electron/main.js',
    external: ['electron'],
    sourcemap: true,
  });

  await esbuild.build({
    entryPoints: ['electron/preload.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    outfile: 'dist-electron/preload.js',
    external: ['electron'],
    sourcemap: true,
  });

  console.log('✓ Electron main and preload built successfully');
}

buildElectron().catch((err) => {
  console.error(err);
  process.exit(1);
});
