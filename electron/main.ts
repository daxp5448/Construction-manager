import { app, BrowserWindow, ipcMain, shell, dialog, session, IpcMainInvokeEvent } from 'electron';
import path from 'path';
import fs from 'fs';
import { CHANNELS } from '../src/shared/channels';
import { initDatabase } from './db';
import { log } from './logger';
import { assertAllChannelsHandled, defineHandlers, dispatch, runStartupTasks, setPlatform } from './ipc';
import { getDefaultStorageRoot } from './paths';
import { getSettings } from './services/settings';

let mainWindow: BrowserWindow | null = null;
let dbReady = false;

// CRM_FORCE_PROD lets an unpackaged build load the built UI from disk (used by the smoke test) instead of the Vite dev server
const isDev = process.env.CRM_FORCE_PROD !== '1' && (process.env.NODE_ENV === 'development' || (app ? !app.isPackaged : true));
const isSmoke = process.env.CRM_SMOKE === '1';
const DEV_URL = 'http://localhost:5173';

process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason as any);
});

function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? e.sender.getURL();
  if (isDev && url.startsWith(DEV_URL)) return true;
  return url.startsWith('file://') && url.replace(/\\/g, '/').includes('/dist/index.html');
}

function registerIpc() {
  defineHandlers();
  assertAllChannelsHandled();
  for (const channel of CHANNELS) {
    ipcMain.handle(channel, async (event, payload) => {
      if (!isTrustedSender(event)) {
        log.warn(`Blocked IPC call from untrusted origin: ${event.senderFrame?.url}`);
        return { ok: false, error: { message: 'Blocked request.', code: 'FORBIDDEN' } };
      }
      return dispatch(channel, payload);
    });
  }
  setPlatform({
    openPath: (p) => shell.openPath(p),
    showItemInFolder: (p) => shell.showItemInFolder(p),
    appVersion: app.getVersion(),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    pickFiles: async ({ title, filters, multi }) => {
      if (!mainWindow) return [];
      const r = await dialog.showOpenDialog(mainWindow, { title, filters, properties: multi ? ['openFile', 'multiSelections'] : ['openFile'] });
      return r.canceled ? [] : r.filePaths;
    },
    pickFolder: async (title) => {
      if (!mainWindow) return null;
      const r = await dialog.showOpenDialog(mainWindow, { title, properties: ['openDirectory', 'createDirectory'] });
      return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
    },
  });
}

function hardenSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  if (!isDev) {
    ses.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'"],
        },
      });
    });
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 680,
    title: 'Construction Record Manager',
    backgroundColor: '#F7F5F0',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // The renderer may never open windows or navigate away from the app.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!(isDev && url.startsWith(DEV_URL)) && !url.startsWith('file://')) e.preventDefault();
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error('Renderer process gone', details);
    if (isSmoke) return;
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Construction Record Manager',
      message: 'The window stopped unexpectedly.',
      detail: 'Your data is safe. The window will be reloaded.',
      buttons: ['Reload', 'Quit'],
    });
    if (choice === 0) mainWindow?.reload();
    else app.quit();
  });
  mainWindow.on('unresponsive', () => log.warn('Window unresponsive'));
  mainWindow.on('closed', () => (mainWindow = null));

  if (isDev) await mainWindow.loadURL(DEV_URL);
  else await mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
}

async function smokeTest() {
  const out: Record<string, unknown> = {};
  try {
    const { dispatch: d } = await import('./ipc');
    out.dbReady = dbReady;
    const dash = await d('dashboard.get', {});
    out.dashboardOk = dash.ok;
    const info = await d('system.info', {});
    out.schemaVersion = info.data?.migration?.toVersion ?? null;
    // renderer actually rendered something
    const text = await mainWindow!.webContents.executeJavaScript(`new Promise(r => setTimeout(() => r({ title: document.title, rootChildren: document.getElementById('root')?.children.length ?? 0, api: typeof window.electronAPI?.invoke }), 1500))`);
    out.renderer = text;
    // PDF export through Chromium
    const co = await d('company.create', { name: 'Smoke Test Company', fields: [{ id: 'f1', name: 'City', value: 'Ahmedabad' }] });
    out.companyCreated = co.ok && co.data.success;
    const rep = await d('report.generate', { id: 'company_directory', filters: {}, formats: ['xlsx', 'pdf'] });
    out.reports = rep.ok ? rep.data.map((r: any) => ({ format: r.format, bytes: r.size_bytes })) : rep.error;
    out.ok = true;
  } catch (e: any) {
    out.ok = false;
    out.error = String(e?.stack || e);
  }
  const target = process.env.CRM_SMOKE_OUT;
  const line = JSON.stringify(out);
  if (target) fs.writeFileSync(target, line);
  console.log('SMOKE_RESULT ' + line);
  app.exit(out.ok ? 0 : 1);
}

if (app && typeof app.whenReady === 'function') {
  if (!app.requestSingleInstanceLock() && !isSmoke) {
    // a second copy would fight over the same database
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });

    app.whenReady().then(async () => {
      try {
        const mig = initDatabase();
        dbReady = true;
        log.info(`Database ready (schema v${mig.toVersion}${mig.applied.length ? ', applied: ' + mig.applied.join('; ') : ''})`);
        // make sure the records root exists
        fs.mkdirSync(getSettings().storageRoot || getDefaultStorageRoot(), { recursive: true });
      } catch (err: any) {
        log.error('Database initialisation failed', err);
        dialog.showErrorBox('Construction Record Manager cannot start', `${err?.message ?? err}\n\nYour data was not modified. See the log file for details:\n${log.file()}`);
        app.exit(1);
        return;
      }

      registerIpc();
      hardenSession();
      await createWindow();
      if (isSmoke) {
        await smokeTest();
        return;
      }
      setTimeout(runStartupTasks, 2500);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }
}
