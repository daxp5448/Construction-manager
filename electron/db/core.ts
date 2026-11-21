import fs from 'fs';
import path from 'path';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { log } from '../logger';

/**
 * Thin synchronous wrapper over Node's built-in SQLite (node:sqlite, ships inside Electron 45).
 * Native, file-backed, WAL journal, real transactions, FTS5 available.
 */
let db: DatabaseSync | null = null;
let dbPath = '';
let depth = 0;
const cache = new Map<string, StatementSync>();

export type Row = Record<string, any>;
export type Param = string | number | bigint | null | undefined | boolean | Uint8Array;

function norm(params: Param[]): any[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export function openDb(file: string): DatabaseSync {
  if (db) closeDb();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  dbPath = file;
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database is not open.');
  return db;
}
export const isOpen = () => !!db;
export const getDbPath = () => dbPath;

export function closeDb() {
  cache.clear();
  if (db) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* ignore */
    }
    try {
      db.close();
    } catch (e) {
      log.warn('close db', e);
    }
  }
  db = null;
  depth = 0;
}

function stmt(sql: string): StatementSync {
  let s = cache.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

export function run(sql: string, params: Param[] = []): { changes: number; lastId: number } {
  const r = stmt(sql).run(...norm(params));
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}
export function get<T = Row>(sql: string, params: Param[] = []): T | undefined {
  return stmt(sql).get(...norm(params)) as T | undefined;
}
export function all<T = Row>(sql: string, params: Param[] = []): T[] {
  return stmt(sql).all(...norm(params)) as T[];
}
export function scalar<T = number>(sql: string, params: Param[] = []): T | null {
  const r = stmt(sql).get(...norm(params)) as Row | undefined;
  if (!r) return null;
  const k = Object.keys(r)[0];
  return (r[k] as T) ?? null;
}
export function exec(sql: string) {
  getDb().exec(sql);
}

/** Run `fn` atomically. Nested calls become savepoints. `fn` MUST be synchronous. */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  const outer = depth === 0;
  const sp = `sp_${depth}`;
  d.exec(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const r = fn();
    if (r && typeof (r as any).then === 'function') {
      throw new Error('tx() callback must be synchronous');
    }
    depth--;
    d.exec(outer ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth--;
    try {
      if (outer) d.exec('ROLLBACK');
      else {
        d.exec(`ROLLBACK TO ${sp}`);
        d.exec(`RELEASE ${sp}`);
      }
    } catch (re) {
      log.error('rollback failed', re);
    }
    throw e;
  }
}

/** Consistent online snapshot of the live database (safe while the app is running). */
export function snapshotTo(target: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) throw new Error(`Backup target already exists: ${target}`);
  getDb().exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
}

export function dbIntegrityCheck(): string {
  const r = get<{ integrity_check: string }>('PRAGMA integrity_check');
  return r ? String(r.integrity_check) : 'unknown';
}
