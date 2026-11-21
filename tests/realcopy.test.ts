/**
 * Optional: run the upgrade against a COPY of a real v1 database.
 *   CRM_REAL_DB_COPY=path\to\copy.sqlite node scripts/run-tests.js realcopy
 * Skipped when the variable is not set. Never point this at the live file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { sandbox } from './helpers';

const src = process.env.CRM_REAL_DB_COPY;
const sb = sandbox('realcopy');
import { initDatabase } from '../electron/db';
import { getDbFile } from '../electron/paths';
import { getAllCompanies } from '../electron/services/companies';
import { dbIntegrityCheck } from '../electron/db/core';
import { DatabaseSync } from 'node:sqlite';

test.after(() => sb.cleanup());

test('real v1 database upgrades without losing data', { skip: !src }, () => {
  fs.copyFileSync(src!, getDbFile());
  const before = new DatabaseSync(src!, { readOnly: true });
  const n = (before.prepare('SELECT COUNT(*) n FROM companies').get() as any).n;
  const f = (before.prepare('SELECT COUNT(*) n FROM company_fields').get() as any).n;
  before.close();
  const mig = initDatabase();
  assert.ok(mig.applied.length >= 1);
  assert.equal(getAllCompanies().length, n);
  const db = new DatabaseSync(getDbFile(), { readOnly: true });
  assert.equal((db.prepare('SELECT COUNT(*) n FROM company_fields').get() as any).n, f);
  db.close();
  assert.equal(dbIntegrityCheck(), 'ok');
  console.log(`upgraded real copy: ${n} companies, ${f} fields preserved; applied ${mig.applied.join(', ')}`);
});
