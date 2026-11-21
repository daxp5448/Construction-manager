import fs from 'fs';
import os from 'os';
import path from 'path';

let electronApp: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const e = require('electron');
  if (e && typeof e === 'object' && e.app) electronApp = e.app;
} catch {
  /* running under plain Node (tests) */
}

export function getElectronApp(): any {
  return electronApp;
}

function ensureDir(p: string): string {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

/** Root of app-private data (database, logs, backups). Overridable for tests. */
export function getDataDir(): string {
  if (process.env.CRM_DATA_DIR) return ensureDir(process.env.CRM_DATA_DIR);
  try {
    if (electronApp && typeof electronApp.getPath === 'function') return ensureDir(electronApp.getPath('userData'));
  } catch {
    /* fall through */
  }
  return ensureDir(path.join(os.homedir(), '.construction-records'));
}

/** Same location the first version of the app used, so existing data is picked up. */
export function getDbDir(): string {
  return ensureDir(path.join(getDataDir(), 'Database'));
}
export function getDbFile(): string {
  return path.join(getDbDir(), 'company_records.sqlite');
}
export function getLogDir(): string {
  return ensureDir(path.join(getDataDir(), 'logs'));
}
export function getInternalBackupDir(): string {
  return ensureDir(path.join(getDataDir(), 'Backups'));
}

export function getDefaultStorageRoot(): string {
  if (process.env.CRM_STORAGE_ROOT) return process.env.CRM_STORAGE_ROOT;
  try {
    if (electronApp && typeof electronApp.getPath === 'function') {
      return path.join(electronApp.getPath('documents'), 'Construction Company Records');
    }
  } catch {
    /* fall through */
  }
  return path.join(os.homedir(), 'Documents', 'Construction Company Records');
}

const isWin = process.platform === 'win32';
const norm = (p: string) => {
  const r = path.resolve(p);
  return isWin ? r.toLowerCase() : r;
};

/** true when `child` is `parent` or lives inside it (after resolving ".." etc.) */
export function isInside(child: string, parent: string): boolean {
  if (!child || !parent) return false;
  const c = norm(child);
  const p = norm(parent);
  if (c === p) return true;
  const rel = path.relative(p, c);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Throws unless `target` is inside one of the allowed roots. Prevents path traversal. */
export function assertInsideAny(target: string, roots: string[], what = 'path'): string {
  if (typeof target !== 'string' || !target.trim()) throw new Error(`Invalid ${what}.`);
  if (target.includes('\0')) throw new Error(`Invalid ${what}.`);
  const resolved = path.resolve(target);
  for (const r of roots) {
    if (r && isInside(resolved, r)) return resolved;
  }
  throw new Error(`Access denied: ${what} is outside the configured record folders.`);
}

const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Sanitize a string for use as a Windows file or folder name segment.
 * (Behaviour kept compatible with v1 so existing company folders resolve identically.)
 */
export function sanitizeWindowsName(name: string, fallback = 'Company_Record'): string {
  if (!name) return fallback;
  let s = String(name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/[. ]+$/, '');
  if (RESERVED.test(s)) s = `${s}_Record`;
  return s || fallback;
}

/** Folder-segment form used for the materials/supplier hierarchy: "20 MM" -> "20_MM" */
export function folderSegment(name: string, fallback = 'Item'): string {
  const s = sanitizeWindowsName(name, fallback)
    .replace(/[\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || fallback;
}
