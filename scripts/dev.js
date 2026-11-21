const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    ...options,
  });
  return child;
}

function waitForServer(url, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http.get(url, (res) => {
        resolve();
      }).on('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Timeout waiting for ${url}`));
        } else {
          setTimeout(check, 300);
        }
      });
    };
    check();
  });
}

async function dev() {
  console.log('Starting Vite dev server...');
  const viteProcess = runCommand('npx', ['vite']);

  try {
    await waitForServer('http://localhost:5173');
    console.log('✓ Vite dev server ready at http://localhost:5173');

    console.log('Building Electron main & preload...');
    require('../esbuild.config.js');

    // Wait a brief moment for files to finish writing
    await new Promise(r => setTimeout(r, 600));

    console.log('Launching Electron...');
    const electronProcess = runCommand('npx', ['electron', '.'], {
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
    });

    electronProcess.on('close', (code) => {
      viteProcess.kill();
      process.exit(code || 0);
    });

  } catch (err) {
    console.error('Error starting dev:', err);
    viteProcess.kill();
    process.exit(1);
  }
}

dev();
