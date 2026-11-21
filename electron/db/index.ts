import { closeDb, getDb, isOpen, openDb, scalar } from './core';
import { runMigrations, MigrationResult } from './migrations';
import { getDbFile, getInternalBackupDir } from '../paths';
import { rebuildSearchIndex } from '../services/search';
import { invalidateSettingsCache } from '../services/settings';
import { log } from '../logger';

let lastMigration: MigrationResult | null = null;

/** Open the database (creating or upgrading it as needed). Safe to call repeatedly. */
export function initDatabase(file = getDbFile()): MigrationResult {
  if (isOpen()) return lastMigration ?? { fromVersion: 0, toVersion: 0, applied: [] };
  const db = openDb(file);
  try {
    lastMigration = runMigrations(db, { backupDir: getInternalBackupDir(), dbFile: file });
  } catch (e) {
    closeDb();
    throw e;
  }
  invalidateSettingsCache();
  const n = scalar<number>('SELECT COUNT(*) FROM search_docs') ?? 0;
  if (n === 0) {
    const indexed = rebuildSearchIndex();
    log.info(`Search index built (${indexed} records)`);
  }
  return lastMigration;
}

/** Close and reopen (used after a restore). */
export function reopenDatabase(file = getDbFile()): MigrationResult {
  closeDb();
  lastMigration = null;
  const r = initDatabase(file);
  rebuildSearchIndex();
  return r;
}

export { closeDb, getDb, isOpen };
export const getLastMigration = () => lastMigration;
