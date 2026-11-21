import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { DatabaseSync } from 'node:sqlite';
import { all, closeDb, get, snapshotTo } from '../db/core';
import { reopenDatabase } from '../db';
import { backupDirectory, getSettings } from './settings';
import { getDbFile, getInternalBackupDir, isInside } from '../paths';
import { ensureDirSync } from '../folderManager';
import { validation } from '../errors';
import { audit } from '../db/util';
import { log } from '../logger';

export interface BackupInfo {
  file: string;
  name: string;
  kind: string;
  size: number;
  modified: string;
  location: 'backup-folder' | 'internal';
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

function kindOf(name: string): string {
  if (name.startsWith('crm_auto_')) return 'automatic';
  if (name.startsWith('crm_manual_')) return 'manual';
  if (name.startsWith('crm_pre-restore_')) return 'before restore';
  if (name.startsWith('pre-migration_')) return 'before upgrade';
  return 'other';
}

export function listBackups(): BackupInfo[] {
  const out: BackupInfo[] = [];
  const scan = (dir: string, location: BackupInfo['location']) => {
    if (!fs.existsSync(dir)) return;
    for (const n of fs.readdirSync(dir)) {
      if (!n.endsWith('.sqlite')) continue;
      const f = path.join(dir, n);
      try {
        const st = fs.statSync(f);
        out.push({ file: f, name: n, kind: kindOf(n), size: st.size, modified: st.mtime.toISOString(), location });
      } catch {
        /* ignore */
      }
    }
  };
  scan(backupDirectory(), 'backup-folder');
  scan(getInternalBackupDir(), 'internal');
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

export function createBackup(kind: 'manual' | 'auto' | 'pre-restore' = 'manual'): BackupInfo {
  const dir = ensureDirSync(backupDirectory());
  const file = path.join(dir, `crm_${kind}_${stamp()}.sqlite`);
  snapshotTo(file);
  const st = fs.statSync(file);
  log.info(`Database backup written: ${file}`);
  if (kind !== 'auto') audit('system', 'database', 'backup', { summary: `Created ${kind} backup ${path.basename(file)}` });
  return { file, name: path.basename(file), kind: kindOf(path.basename(file)), size: st.size, modified: st.mtime.toISOString(), location: 'backup-folder' };
}

/** Keep the newest N *automatic* backups. Manual, pre-restore and pre-upgrade backups are never touched. */
export function pruneAutoBackups(): number {
  const keep = getSettings().backupRetention;
  const autos = listBackups().filter((b) => b.kind === 'automatic' && b.location === 'backup-folder');
  let removed = 0;
  for (const b of autos.slice(keep)) {
    try {
      fs.unlinkSync(b.file);
      removed++;
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/** Called at startup: takes an automatic backup when none exists from the last ~20 hours. */
export function autoBackupIfDue(): BackupInfo | null {
  const s = getSettings();
  if (!s.autoBackup) return null;
  const last = listBackups().find((b) => b.kind === 'automatic');
  if (last && Date.now() - new Date(last.modified).getTime() < 20 * 3600 * 1000) return null;
  const n = (get<any>('SELECT COUNT(*) AS n FROM companies') ?? { n: 0 }).n;
  if (!n) return null; // nothing worth backing up yet
  const b = createBackup('auto');
  pruneAutoBackups();
  return b;
}

/** Verify a file is a healthy copy of this application's database. Returns its schema info. */
export function inspectBackup(file: string): { companies: number; schemaVersion: number } {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const ic = db.prepare('PRAGMA integrity_check').get() as any;
    if (String(Object.values(ic)[0]) !== 'ok') throw validation('The backup file failed its integrity check and cannot be restored.');
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='companies'").get();
    if (!t) throw validation('This file is not a Construction Record Manager database.');
    const companies = (db.prepare('SELECT COUNT(*) AS n FROM companies').get() as any).n as number;
    const hasMig = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
    const schemaVersion = hasMig ? ((db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as any).v as number) || 0 : 1;
    return { companies, schemaVersion };
  } catch (e: any) {
    if (e?.code === 'VALIDATION') throw e;
    throw validation('This file could not be opened as a database backup.');
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Restore the database from a backup. The caller (UI) must have obtained explicit confirmation (`confirmed`).
 * Safety: a pre-restore backup of the current data is taken first and automatically put back if anything fails.
 */
export function restoreBackup(file: string, confirmed: boolean): { restoredFrom: string; preRestoreBackup: string } {
  if (!confirmed) throw validation('Restoring replaces all current data. Confirmation is required.');
  if (!fs.existsSync(file)) throw validation('Backup file not found.');
  inspectBackup(file);
  const pre = createBackup('pre-restore');
  const dbFile = getDbFile();
  // stage the backup next to the live DB so the swap is a rename on the same volume
  const staged = dbFile + '.restore.tmp';
  fs.copyFileSync(file, staged);
  closeDb();
  try {
    for (const ext of ['-wal', '-shm']) if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
    fs.renameSync(staged, dbFile);
    reopenDatabase(dbFile);
    audit('system', 'database', 'restore', { summary: `Restored database from ${path.basename(file)} (previous data saved as ${pre.name})` });
    return { restoredFrom: file, preRestoreBackup: pre.file };
  } catch (e: any) {
    log.error('Restore failed, rolling back', e);
    try {
      closeDb();
      for (const ext of ['-wal', '-shm']) if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
      fs.copyFileSync(pre.file, dbFile);
      reopenDatabase(dbFile);
    } catch (e2) {
      log.error('Rollback after failed restore also failed', e2);
    }
    if (fs.existsSync(staged)) fs.unlinkSync(staged);
    throw new Error(`Restore failed and your previous data was put back. (${e?.message})`);
  }
}

/** Zip a company folder (or all) plus a consistent database snapshot. Never modifies the source folders. */
export async function exportArchive(opts: { companyId?: string | null; targetDir?: string }): Promise<{ file: string; size: number; companies: number }> {
  const s = getSettings();
  const dir = ensureDirSync(opts.targetDir || path.join(s.storageRoot, '_Archives'));
  const rows = opts.companyId
    ? all<any>('SELECT name, folder_path FROM companies WHERE id = ?', [opts.companyId])
    : all<any>('SELECT name, folder_path FROM companies WHERE deleted_at IS NULL');
  if (!rows.length) throw validation('No company to archive.');
  const file = path.join(dir, `Archive_${opts.companyId ? rows[0].name.replace(/[^\w.-]+/g, '_') : 'All_Companies'}_${stamp()}.zip`);
  const snap = path.join(getInternalBackupDir(), `archive_snapshot_${stamp()}.sqlite`);
  snapshotTo(snap);
  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(file);
      const zip = archiver('zip', { zlib: { level: 6 } });
      out.on('close', () => resolve());
      out.on('error', reject);
      zip.on('error', reject);
      zip.pipe(out);
      zip.append(JSON.stringify({ app: 'Construction Record Manager', created: new Date().toISOString(), companies: rows.map((r) => r.name) }, null, 2), { name: 'MANIFEST.json' });
      zip.file(snap, { name: 'database/company_records.sqlite' });
      for (const r of rows) {
        if (r.folder_path && fs.existsSync(r.folder_path)) zip.directory(r.folder_path, `companies/${path.basename(r.folder_path)}`);
      }
      zip.finalize().catch(reject);
    });
  } finally {
    try {
      fs.unlinkSync(snap);
    } catch {
      /* ignore */
    }
  }
  audit('system', 'archive', 'export', { summary: `Exported archive ${path.basename(file)}` });
  return { file, size: fs.statSync(file).size, companies: rows.length };
}

/** Copies every company workbook into <company>/11_Backups/Excel_<timestamp>/ (originals untouched). */
export function backupExcelFiles(): { copied: number; folders: string[] } {
  let copied = 0;
  const folders: string[] = [];
  for (const c of all<any>('SELECT folder_path FROM companies WHERE deleted_at IS NULL')) {
    if (!c.folder_path || !fs.existsSync(c.folder_path)) continue;
    const info = path.join(c.folder_path, '01_Company_Information');
    if (!fs.existsSync(info)) continue;
    const files = fs.readdirSync(info).filter((n) => n.toLowerCase().endsWith('.xlsx') && !n.includes('_backup_') && !n.startsWith('.'));
    if (!files.length) continue;
    const dest = ensureDirSync(path.join(c.folder_path, '11_Backups', `Excel_${stamp()}`));
    for (const f of files) {
      fs.copyFileSync(path.join(info, f), path.join(dest, f), fs.constants.COPYFILE_EXCL);
      copied++;
    }
    folders.push(dest);
  }
  return { copied, folders };
}

export function isBackupFile(file: string): boolean {
  return isInside(file, backupDirectory()) || isInside(file, getInternalBackupDir());
}
