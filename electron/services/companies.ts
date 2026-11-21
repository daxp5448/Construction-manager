import fs from 'fs';
import { all, get, run, scalar, tx } from '../db/core';
import { audit } from '../db/util';
import { CompanyField, CompanyRecord, AppStats } from '../../src/types';
import { indexEntity, unindexEntity } from './search';

const DEPENDENT_TABLES = [
  'projects',
  'purchase_orders',
  'material_receipts',
  'invoices',
  'supplier_payments',
  'royalty_passes',
  'stock_transactions',
  'material_consumption',
  'quality_tests',
  'measurement_entries',
  'daily_progress',
  'documents',
];

function extractFieldValue(fields: CompanyField[], keywords: string[]): string | undefined {
  if (!Array.isArray(fields)) return undefined;
  for (const f of fields) {
    const fn = (f.name || '').toLowerCase();
    for (const kw of keywords) if (fn.includes(kw)) return f.value;
  }
  return undefined;
}

function mapRow(row: any, fields: CompanyField[]): CompanyRecord {
  return {
    id: row.id,
    name: row.name,
    sanitizedName: row.sanitized_name,
    folderPath: row.folder_path,
    excelPath: row.excel_path,
    ownerName: row.owner_name || undefined,
    contactNumber: row.contact_number || undefined,
    email: row.email || undefined,
    gstNumber: row.gst_number || undefined,
    address: row.address || undefined,
    projectName: row.project_name || undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    fields,
  };
}

function fieldsOf(id: string): CompanyField[] {
  return all<CompanyField>(
    `SELECT id, field_name AS name, field_value AS value FROM company_fields WHERE company_id = ? ORDER BY field_order ASC`,
    [id]
  );
}

export function saveCompany(record: CompanyRecord): void {
  const ownerName = record.ownerName || extractFieldValue(record.fields, ['owner', 'proprietor', 'client', 'name']);
  const contactNumber = record.contactNumber || extractFieldValue(record.fields, ['contact', 'phone', 'mobile', 'tel']);
  const email = record.email || extractFieldValue(record.fields, ['email', 'mail']);
  const gstNumber = record.gstNumber || extractFieldValue(record.fields, ['gst', 'gstin', 'tax']);
  const address = record.address || extractFieldValue(record.fields, ['address', 'office', 'location', 'city']);
  const projectName = record.projectName || extractFieldValue(record.fields, ['project', 'work', 'site']);

  const existed = !!get(`SELECT 1 AS x FROM companies WHERE id = ?`, [record.id]);
  tx(() => {
    run(
      `INSERT INTO companies (id, name, sanitized_name, folder_path, excel_path, owner_name, contact_number, email, gst_number, address, project_name, notes, created_at, updated_at, deleted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name, sanitized_name = excluded.sanitized_name, folder_path = excluded.folder_path,
         excel_path = excluded.excel_path, owner_name = excluded.owner_name, contact_number = excluded.contact_number,
         email = excluded.email, gst_number = excluded.gst_number, address = excluded.address,
         project_name = excluded.project_name, notes = excluded.notes, updated_at = excluded.updated_at, deleted_at = NULL`,
      [
        record.id,
        record.name,
        record.sanitizedName,
        record.folderPath,
        record.excelPath,
        ownerName || null,
        contactNumber || null,
        email || null,
        gstNumber || null,
        address || null,
        projectName || null,
        record.notes || null,
        record.createdAt,
        record.updatedAt,
      ]
    );
    run(`DELETE FROM company_fields WHERE company_id = ?`, [record.id]);
    (record.fields || []).forEach((f, i) => {
      run(`INSERT INTO company_fields (id, company_id, field_name, field_value, field_order) VALUES (?,?,?,?,?)`, [
        // ids are generated here (never trusted from the UI) so two companies can never collide on a field id
        `f_${record.id}_${i}`,
        record.id,
        f.name,
        f.value ?? '',
        i,
      ]);
    });
    audit('company', record.id, existed ? 'update' : 'create', { summary: `${existed ? 'Updated' : 'Created'} company "${record.name}"` });
  });
  indexEntity('company', record.id);
}

export function getAllCompanies(search?: string, includeArchived = false): CompanyRecord[] {
  const where: string[] = [includeArchived ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
  const params: any[] = [];
  if (search && search.trim()) {
    const q = `%${search.trim().toLowerCase()}%`;
    where.push(`(LOWER(name) LIKE ? OR LOWER(IFNULL(owner_name,'')) LIKE ? OR LOWER(IFNULL(contact_number,'')) LIKE ? OR LOWER(IFNULL(project_name,'')) LIKE ? OR LOWER(IFNULL(gst_number,'')) LIKE ?)`);
    params.push(q, q, q, q, q);
  }
  const rows = all(`SELECT * FROM companies WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`, params);
  return rows.map((r) => mapRow(r, fieldsOf(r.id)));
}

export function getCompanyById(id: string): CompanyRecord | null {
  const row = get(`SELECT * FROM companies WHERE id = ?`, [id]);
  return row ? mapRow(row, fieldsOf(id)) : null;
}

/** Finds by name including archived companies (so re-creating an archived company revives it instead of colliding). */
export function findCompanyByName(name: string): CompanyRecord | null {
  const row = get(`SELECT * FROM companies WHERE LOWER(name) = ? ORDER BY deleted_at IS NOT NULL ASC LIMIT 1`, [name.trim().toLowerCase()]);
  return row ? mapRow(row, fieldsOf(row.id)) : null;
}

export function companyDependentCount(id: string): number {
  let n = 0;
  for (const t of DEPENDENT_TABLES) n += scalar<number>(`SELECT COUNT(*) FROM ${t} WHERE company_id = ?`, [id]) ?? 0;
  return n;
}

export function archiveCompany(id: string): boolean {
  const c = getCompanyById(id);
  if (!c) return false;
  run(`UPDATE companies SET deleted_at = ?, updated_at = ? WHERE id = ?`, [new Date().toISOString(), new Date().toISOString(), id]);
  audit('company', id, 'archive', { summary: `Archived company "${c.name}" (files untouched)` });
  unindexEntity('company', id);
  return true;
}

export function restoreCompany(id: string): boolean {
  const c = getCompanyById(id);
  if (!c) return false;
  run(`UPDATE companies SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
  audit('company', id, 'restore', { summary: `Restored company "${c.name}"` });
  indexEntity('company', id);
  return true;
}

/**
 * Permanent purge. Refused when the company still owns business records, so history can never be orphaned.
 * Deleting the folder on disk is a separate, explicit flag.
 */
export async function purgeCompany(id: string, deleteFiles: boolean): Promise<{ success: boolean; error?: string }> {
  const c = getCompanyById(id);
  if (!c) return { success: false, error: 'Company not found' };
  const deps = companyDependentCount(id);
  if (deps > 0) {
    return {
      success: false,
      error: `This company has ${deps} linked record(s) (projects, purchases, documents…). It can be archived but not permanently deleted.`,
    };
  }
  tx(() => {
    run(`DELETE FROM company_fields WHERE company_id = ?`, [id]);
    run(`DELETE FROM companies WHERE id = ?`, [id]);
    audit('company', id, 'purge', { summary: `Permanently deleted company "${c.name}"`, before: c });
  });
  unindexEntity('company', id);
  if (deleteFiles && c.folderPath && fs.existsSync(c.folderPath)) {
    try {
      await fs.promises.rm(c.folderPath, { recursive: true, force: true });
    } catch (e: any) {
      return { success: true, error: `Record deleted but the folder could not be removed: ${e?.message}` };
    }
  }
  return { success: true };
}

export function getLegacyStats(): AppStats {
  const all_ = getAllCompanies();
  let totalExcelFiles = 0;
  for (const c of all_) if (c.excelPath && fs.existsSync(c.excelPath)) totalExcelFiles++;
  const byCreated = [...all_].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 5);
  const byUpdated = [...all_].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 5);
  return { totalCompanies: all_.length, totalExcelFiles, recentlyCreated: byCreated, recentlyUpdated: byUpdated };
}
