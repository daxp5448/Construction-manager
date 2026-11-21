import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { sandbox } from './helpers';

const sb = sandbox('db');
import { initDatabase, reopenDatabase } from '../electron/db';
import { all, get, getDb, scalar, tx, run, dbIntegrityCheck } from '../electron/db/core';
import { LATEST_VERSION } from '../electron/db/migrations';
import { getDbFile, getInternalBackupDir } from '../electron/paths';
import { searchQuery } from '../electron/services/search';
import { getAllCompanies, getCompanyById } from '../electron/services/companies';
import { getSettings } from '../electron/services/settings';

test.after(() => sb.cleanup());

test('upgrading a v1 database keeps every company, field and path; takes a backup first', () => {
  // Build exactly what the first release created.
  const file = getDbFile();
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, sanitized_name TEXT NOT NULL, folder_path TEXT NOT NULL, excel_path TEXT NOT NULL,
      owner_name TEXT, contact_number TEXT, email TEXT, gst_number TEXT, address TEXT, project_name TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE company_fields (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, field_name TEXT NOT NULL, field_value TEXT NOT NULL, field_order INTEGER NOT NULL,
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  old.prepare('INSERT INTO companies VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('c1', 'Daksh Construction', 'Daksh Construction', 'C:\\Records\\Daksh Construction', 'C:\\Records\\Daksh Construction\\01_Company_Information\\x.xlsx', 'Daksh', '9876543210', null, '24ABCDE1234F1Z5', 'Ahmedabad', 'Road', 'old note', '2026-11-18T04:14:03.946Z', '2026-11-18T04:14:03.946Z');
  old.prepare('INSERT INTO company_fields VALUES (?,?,?,?,?)').run('f1', 'c1', 'GST Number', '24ABCDE1234F1Z5', 0);
  old.prepare('INSERT INTO company_fields VALUES (?,?,?,?,?)').run('f2', 'c1', 'Office Address', 'Ahmedabad', 1);
  old.prepare('INSERT INTO app_settings VALUES (?,?)').run('settings', JSON.stringify({ storageRoot: 'D:\\Custom Root', excelHeaderTitle: 'MY TITLE' }));
  old.close();

  const mig = initDatabase();
  assert.equal(mig.fromVersion, 0);
  assert.equal(mig.toVersion, LATEST_VERSION);
  assert.ok(mig.backupFile && fs.existsSync(mig.backupFile), 'pre-migration backup must exist');
  assert.ok(mig.backupFile!.startsWith(getInternalBackupDir()));

  // backup is a faithful copy of the OLD data
  const b = new DatabaseSync(mig.backupFile!, { readOnly: true });
  assert.equal((b.prepare('SELECT COUNT(*) n FROM companies').get() as any).n, 1);
  b.close();

  const c = getCompanyById('c1')!;
  assert.equal(c.name, 'Daksh Construction');
  assert.equal(c.folderPath, 'C:\\Records\\Daksh Construction');
  assert.equal(c.fields.length, 2);
  assert.equal(c.fields[1].value, 'Ahmedabad');
  assert.equal(getAllCompanies().length, 1);
  // existing user settings survive and new settings get defaults
  const s = getSettings();
  assert.equal(s.storageRoot, 'D:\\Custom Root');
  assert.equal(s.excelHeaderTitle, 'MY TITLE');
  assert.equal(s.folderTemplate.length, 11);
  assert.equal(s.autoBackup, true);
});

test('schema: foreign keys on, WAL, integrity ok, defaults seeded once', () => {
  assert.equal(scalar('PRAGMA foreign_keys'), 1);
  assert.equal(String(scalar('PRAGMA journal_mode')).toLowerCase(), 'wal');
  assert.equal(dbIntegrityCheck(), 'ok');
  assert.ok((scalar<number>('SELECT COUNT(*) FROM units') ?? 0) >= 10);
  assert.ok((scalar<number>('SELECT COUNT(*) FROM material_specifications') ?? 0) >= 19);
  const again = reopenDatabase(); // idempotent: nothing left to apply
  assert.equal(again.applied.length, 0);
  // company with children cannot be orphaned: inserting a project for a missing company fails
  assert.throws(() => run(`INSERT INTO projects (id, company_id, name) VALUES ('p','nope','x')`));
});

test('seeded material hierarchy is editable data, not hard-coded', () => {
  const cats = all<any>('SELECT name FROM material_categories ORDER BY sort_order').map((c) => c.name);
  assert.deepEqual(cats.slice(0, 3), ['Aggregate', 'Dust', 'Bitumen']);
  const specs = all<any>(`SELECT size_grade FROM v_specs WHERE category_name = 'Aggregate' ORDER BY size_grade`).map((s) => s.size_grade);
  assert.deepEqual(specs, ['10 MM', '20 MM', '40 MM', '6 MM']);
});

test('transactions roll back atomically', () => {
  const before = scalar<number>('SELECT COUNT(*) FROM work_activities') ?? 0;
  assert.throws(() =>
    tx(() => {
      run(`INSERT INTO work_activities (id, name) VALUES ('t1', 'Temp A')`);
      run(`INSERT INTO work_activities (id, name) VALUES ('t2', 'Temp A')`); // unique(lower(name)) violation
    })
  );
  assert.equal(scalar<number>('SELECT COUNT(*) FROM work_activities'), before);
  // nested savepoints
  tx(() => {
    run(`INSERT INTO work_activities (id, name) VALUES ('t3', 'Outer')`);
    assert.throws(() => tx(() => (run(`INSERT INTO work_activities (id, name) VALUES ('t4', 'Inner')`), run(`INSERT INTO work_activities (id, name) VALUES ('t5', 'inner')`))));
  });
  assert.ok(get(`SELECT 1 x FROM work_activities WHERE id = 't3'`));
  assert.equal(get(`SELECT 1 x FROM work_activities WHERE id = 't4'`), undefined);
});

test('FTS5 trigram search: substring, case-insensitive, partial', () => {
  run(`INSERT INTO search_docs (entity_type, entity_id, title, subtitle, parent, body) VALUES ('supplier','s1','Patel Crusher','SUP-0001','Supplier','GJ01AB1234 20 MM aggregate')`);
  run(`INSERT INTO search_docs (entity_type, entity_id, title, subtitle, parent, body) VALUES ('supplier','s2','Shree Bitumen Depot','SUP-0002','Supplier','VG-30')`);
  const names = (q: string) => searchQuery(q).map((h) => h.title);
  assert.deepEqual(names('patel'), ['Patel Crusher']);
  assert.deepEqual(names('ATEL cru'), ['Patel Crusher']);
  assert.deepEqual(names('gj01ab'), ['Patel Crusher']);
  assert.ok(names('vg-30').includes('Shree Bitumen Depot'));
  assert.ok(names('vg').includes('Shree Bitumen Depot')); // < 3 chars falls back to LIKE
  assert.deepEqual(names('zzzz'), []);
  assert.deepEqual(names('"; DROP TABLE companies; --'), []); // injection-safe
  assert.ok(scalar<number>('SELECT COUNT(*) FROM companies')! >= 1);
  // existing v1 company was indexed on first open
  assert.ok(searchQuery('daksh').some((h) => h.entityType === 'company'));
  void getDb;
  void path;
});
