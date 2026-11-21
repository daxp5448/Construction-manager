import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { all, get, run, scalar, tx } from '../db/core';
import { audit, newId, nowIso } from '../db/util';
import { notFound, validation } from '../errors';
import {
  DOC_SUBFOLDER,
  ensureDirSync,
  ensureProjectFolders,
  ensureSupplierFolders,
  ensureSupplierMaterialFolders,
  findExistingChild,
  uniqueFilePath,
} from '../folderManager';
import { getSettings } from './settings';
import { assertInsideAny, folderSegment, sanitizeWindowsName } from '../paths';
import { indexEntity, unindexEntity } from './search';
import { log } from '../logger';

export const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp', '.heic', '.xlsx', '.xls', '.csv', '.doc', '.docx', '.txt', '.dwg', '.zip']);
export const MAX_BYTES = 250 * 1024 * 1024;

export const DOC_TYPES = [
  { value: 'invoice', label: 'Supplier invoice' },
  { value: 'purchase_order', label: 'Purchase order' },
  { value: 'delivery_challan', label: 'Delivery challan' },
  { value: 'weighbridge_slip', label: 'Weighbridge slip' },
  { value: 'royalty_pass', label: 'Royalty / transit pass (original)' },
  { value: 'test_report', label: 'Test report' },
  { value: 'measurement', label: 'Measurement / level book' },
  { value: 'progress', label: 'Progress / site photo' },
  { value: 'payment_proof', label: 'Payment proof' },
  { value: 'agreement', label: 'Agreement / contract' },
  { value: 'boq', label: 'BOQ' },
  { value: 'consumption_support', label: 'Consumption support' },
  { value: 'other', label: 'Other' },
];

interface Context {
  companyId: string | null;
  projectId: string | null;
  supplierId: string | null;
  specId: string | null;
  label: string;
}

/** Work out which company / project / supplier / material a record belongs to, so its files land in the right folder. */
function contextOf(entityType: string, entityId: string, fallbackCompanyId?: string | null): Context {
  const ctx: Context = { companyId: fallbackCompanyId ?? null, projectId: null, supplierId: null, specId: null, label: entityType };
  const pick = (table: string, cols: string) => get<any>(`SELECT ${cols} FROM ${table} WHERE id = ?`, [entityId]);
  let r: any;
  switch (entityType) {
    case 'company':
      ctx.companyId = entityId;
      ctx.label = 'Company';
      break;
    case 'project':
      r = pick('projects', 'company_id, name');
      if (r) Object.assign(ctx, { companyId: r.company_id, projectId: entityId, label: r.name });
      break;
    case 'supplier':
      ctx.supplierId = entityId;
      break;
    case 'purchase': {
      r = pick('purchase_orders', 'company_id, project_id, supplier_id, po_no');
      if (r) {
        Object.assign(ctx, { companyId: r.company_id, projectId: r.project_id, supplierId: r.supplier_id, label: r.po_no });
        const specs = all<any>('SELECT DISTINCT spec_id FROM purchase_order_items WHERE po_id = ?', [entityId]);
        if (specs.length === 1) ctx.specId = specs[0].spec_id;
      }
      break;
    }
    case 'receipt':
      r = pick('material_receipts', 'company_id, project_id, supplier_id, spec_id, receipt_no');
      if (r) Object.assign(ctx, { companyId: r.company_id, projectId: r.project_id, supplierId: r.supplier_id, specId: r.spec_id, label: r.receipt_no });
      break;
    case 'invoice':
      r = pick('invoices', 'company_id, project_id, supplier_id, invoice_no');
      if (r) Object.assign(ctx, { companyId: r.company_id, projectId: r.project_id, supplierId: r.supplier_id, label: r.invoice_no });
      break;
    case 'payment':
      r = pick('supplier_payments', 'company_id, project_id, supplier_id, reference_no');
      if (r) Object.assign(ctx, { companyId: r.company_id, projectId: r.project_id, supplierId: r.supplier_id, label: r.reference_no || 'payment' });
      break;
    case 'royalty':
      r = pick('royalty_passes', 'company_id, project_id, supplier_id, pass_no');
      if (r) Object.assign(ctx, { companyId: r.company_id ?? ctx.companyId, projectId: r.project_id, supplierId: r.supplier_id, label: r.pass_no });
      break;
    case 'quality':
      r = pick('quality_tests', 'company_id, project_id, supplier_id, spec_id, test_no');
      if (r) Object.assign(ctx, { companyId: r.company_id, projectId: r.project_id, supplierId: r.supplier_id, specId: r.spec_id, label: r.test_no || 'test' });
      break;
    case 'measurement':
      r = pick('measurement_entries', 'company_id, project_id, mb_no');
      if (r) Object.assign(ctx, { companyId: r.company_id, projectId: r.project_id, label: r.mb_no });
      break;
    case 'progress':
      r = pick('daily_progress', 'company_id, project_id, entry_date');
      if (r) Object.assign(ctx, { companyId: r.company_id, projectId: r.project_id, label: r.entry_date });
      break;
    case 'consumption':
      r = pick('material_consumption', 'company_id, project_id, spec_id, usage_date');
      if (r) Object.assign(ctx, { companyId: r.company_id, projectId: r.project_id, specId: r.spec_id, label: r.usage_date });
      break;
    default:
      throw validation(`Documents cannot be attached to "${entityType}".`);
  }
  return ctx;
}

/** Decide (and create) the destination folder for a document. */
export function resolveDocFolder(entityType: string, entityId: string, docType: string, companyIdHint?: string | null): { dir: string; companyId: string; projectId: string | null } {
  const ctx = contextOf(entityType, entityId, companyIdHint);
  if (!ctx.companyId) throw validation('Choose a company first so the file can be filed in its folder.');
  const company = get<any>('SELECT id, folder_path, name FROM companies WHERE id = ?', [ctx.companyId]);
  if (!company?.folder_path) throw validation('Company folder is not set up.');
  const root = ensureDirSync(company.folder_path);
  const s = getSettings();
  const supplier = ctx.supplierId ? get<any>('SELECT name, folder_name FROM suppliers WHERE id = ?', [ctx.supplierId]) : null;
  const supplierSeg = supplier ? supplier.folder_name || folderSegment(supplier.name, 'Supplier') : null;
  const project = ctx.projectId ? get<any>('SELECT name FROM projects WHERE id = ?', [ctx.projectId]) : null;
  const sub = DOC_SUBFOLDER[docType];

  let dir: string;
  if (docType === 'royalty_pass') {
    dir = path.join(ensureDirSync(path.join(root, '09_Royalty_Records')), supplierSeg ?? '_General');
  } else if (docType === 'agreement' && project) {
    dir = path.join(ensureProjectFolders(root, project.name, s.projectFolderTemplate), '01_Agreements');
  } else if (docType === 'boq' && project) {
    dir = path.join(ensureProjectFolders(root, project.name, s.projectFolderTemplate), '02_BOQ');
  } else if (docType === 'measurement' && project) {
    dir = path.join(ensureProjectFolders(root, project.name, s.projectFolderTemplate), '03_Measurement_Books');
  } else if ((docType === 'progress' || docType === 'consumption_support') && project) {
    dir = path.join(ensureProjectFolders(root, project.name, s.projectFolderTemplate), docType === 'progress' ? '04_Daily_Progress' : path.join('04_Daily_Progress', 'Consumption'));
  } else if (docType === 'test_report') {
    dir = path.join(ensureDirSync(path.join(root, '04_Contracts_and_Documents')), 'Quality_Reports');
  } else if ((docType === 'invoice' || docType === 'payment_proof') && supplierSeg) {
    dir = path.join(ensureDirSync(path.join(root, '03_Bills_and_Invoices')), supplierSeg);
  } else if (ctx.specId && supplierSeg && sub) {
    const spec = get<any>('SELECT category_name, material_name, size_grade FROM v_specs WHERE id = ?', [ctx.specId]);
    const base = ensureSupplierMaterialFolders(root, spec.category_name, spec.material_name, spec.size_grade, supplierSeg, s.supplierFolderTemplate);
    dir = path.join(base, sub);
  } else if (supplierSeg) {
    dir = path.join(ensureSupplierFolders(root, supplierSeg, s.supplierFolderTemplate), sub ?? 'Documents');
  } else {
    dir = path.join(ensureDirSync(path.join(root, '04_Contracts_and_Documents')), sanitizeWindowsName(entityType));
  }
  const existing = findExistingChild(path.dirname(dir), path.basename(dir));
  if (existing) dir = existing;
  ensureDirSync(dir);
  return { dir, companyId: company.id, projectId: ctx.projectId };
}

function sha256(file: string): string {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n: number;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

export interface AttachResult {
  attached: any[];
  skipped: string[];
}

/**
 * Copy files (chosen by the user in a native dialog) into the record's folder and register them.
 * The original is never moved or modified; an existing file with the same name is never overwritten.
 */
export function attachFiles(input: { entityType: string; entityId: string; docType: string; sourcePaths: string[]; companyId?: string | null; title?: string | null }): AttachResult {
  if (!DOC_TYPES.some((d) => d.value === input.docType)) throw validation('Unknown document type.');
  const { dir, companyId, projectId } = resolveDocFolder(input.entityType, input.entityId, input.docType, input.companyId);
  const result: AttachResult = { attached: [], skipped: [] };
  for (const src of input.sourcePaths) {
    try {
      const resolved = path.resolve(src);
      const st = fs.statSync(resolved);
      if (!st.isFile()) throw new Error('not a file');
      const ext = path.extname(resolved).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) {
        result.skipped.push(`${path.basename(resolved)}: file type ${ext || '(none)'} is not allowed`);
        continue;
      }
      if (st.size > MAX_BYTES) {
        result.skipped.push(`${path.basename(resolved)}: larger than 250 MB`);
        continue;
      }
      const hash = sha256(resolved);
      const dup = get<any>(`SELECT id, file_name FROM documents WHERE entity_type = ? AND entity_id = ? AND sha256 = ? AND deleted_at IS NULL`, [input.entityType, input.entityId, hash]);
      if (dup) {
        result.skipped.push(`${path.basename(resolved)}: identical file already attached (${dup.file_name})`);
        continue;
      }
      const target = uniqueFilePath(dir, sanitizeWindowsName(path.basename(resolved), 'document' + ext));
      fs.copyFileSync(resolved, target, fs.constants.COPYFILE_EXCL);
      const id = newId();
      const company = get<any>('SELECT folder_path FROM companies WHERE id = ?', [companyId]);
      const rel = company?.folder_path ? path.relative(company.folder_path, target) : null;
      tx(() => {
        run(
          `INSERT INTO documents (id, company_id, project_id, entity_type, entity_id, doc_type, title, file_name, stored_path, rel_path, sha256, size_bytes, last_checked_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, companyId, projectId, input.entityType, input.entityId, input.docType, input.title ?? null, path.basename(target), target, rel, hash, st.size, nowIso()]
        );
        audit('document', id, 'create', { summary: `Attached ${path.basename(target)} to ${input.entityType}` });
      });
      indexEntity('document', id);
      result.attached.push(getDocument(id));
    } catch (e: any) {
      result.skipped.push(`${path.basename(src)}: ${e?.message ?? e}`);
    }
  }
  return result;
}

export function getDocument(id: string) {
  return get<any>(
    `SELECT d.*, c.name AS company_name, p.name AS project_name, sd.title AS entity_label
     FROM documents d LEFT JOIN companies c ON c.id = d.company_id LEFT JOIN projects p ON p.id = d.project_id
     LEFT JOIN search_docs sd ON sd.entity_type = d.entity_type AND sd.entity_id = d.entity_id WHERE d.id = ?`,
    [id]
  );
}

export function listDocuments(q: {
  entityType?: string;
  entityId?: string;
  companyId?: string;
  projectId?: string;
  docType?: string;
  verification?: string;
  missingOnly?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const where: string[] = ['d.deleted_at IS NULL'];
  const params: any[] = [];
  const eq = (col: string, v?: string) => {
    if (v) (where.push(`${col} = ?`), params.push(v));
  };
  eq('d.entity_type', q.entityType);
  eq('d.entity_id', q.entityId);
  eq('d.company_id', q.companyId);
  eq('d.project_id', q.projectId);
  eq('d.doc_type', q.docType);
  eq('d.verification_status', q.verification);
  if (q.missingOnly) where.push('d.is_missing = 1');
  if (q.search && q.search.trim()) {
    const like = `%${q.search.trim().toLowerCase()}%`;
    where.push(`(LOWER(d.file_name) LIKE ? OR LOWER(IFNULL(d.title,'')) LIKE ? OR LOWER(IFNULL(d.verification_notes,'')) LIKE ? OR LOWER(IFNULL(sd.title,'')) LIKE ?)`);
    params.push(like, like, like, like);
  }
  const base = `FROM documents d LEFT JOIN companies c ON c.id = d.company_id LEFT JOIN projects p ON p.id = d.project_id
    LEFT JOIN search_docs sd ON sd.entity_type = d.entity_type AND sd.entity_id = d.entity_id WHERE ${where.join(' AND ')}`;
  const total = scalar<number>(`SELECT COUNT(*) ${base}`, params) ?? 0;
  const pageSize = Math.min(Math.max(q.pageSize ?? 100, 1), 2000);
  const page = Math.max(q.page ?? 1, 1);
  const rows = all<any>(
    `SELECT d.*, c.name AS company_name, p.name AS project_name, sd.title AS entity_label ${base} ORDER BY d.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params
  );
  return { rows, total };
}

/** Absolute path of a document, resolving relocated company folders; verified to be inside an allowed root. */
export function documentPath(id: string, allowedRoots: string[]): string {
  const d = get<any>('SELECT stored_path, rel_path, company_id FROM documents WHERE id = ?', [id]);
  if (!d) throw notFound('Document');
  let p = d.stored_path as string;
  if (!fs.existsSync(p) && d.rel_path && d.company_id) {
    const c = get<any>('SELECT folder_path FROM companies WHERE id = ?', [d.company_id]);
    if (c?.folder_path) {
      const alt = path.join(c.folder_path, d.rel_path);
      if (fs.existsSync(alt)) p = alt;
    }
  }
  return assertInsideAny(p, allowedRoots, 'document path');
}

export function setVerification(id: string, status: 'unverified' | 'verified' | 'rejected', notes?: string | null) {
  const d = get<any>('SELECT * FROM documents WHERE id = ?', [id]);
  if (!d) throw notFound('Document');
  if (!['unverified', 'verified', 'rejected'].includes(status)) throw validation('Invalid verification status.');
  run(`UPDATE documents SET verification_status = ?, verified_on = ?, verification_notes = ?, updated_at = ? WHERE id = ?`, [
    status,
    status === 'unverified' ? null : new Date().toISOString().slice(0, 10),
    notes?.trim() || null,
    nowIso(),
    id,
  ]);
  audit('document', id, 'verify', { summary: `Document marked ${status}`, reason: notes ?? null, before: { verification_status: d.verification_status } });
  indexEntity('document', id);
  return getDocument(id);
}

/** Removes the record; the file stays on disk unless `deleteFile` is explicitly confirmed by the user. */
export function removeDocument(id: string, opts: { deleteFile?: boolean; allowedRoots: string[] }) {
  const d = get<any>('SELECT * FROM documents WHERE id = ?', [id]);
  if (!d) throw notFound('Document');
  tx(() => {
    run(`UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), id]);
    audit('document', id, 'delete', { summary: `Removed ${d.file_name}${opts.deleteFile ? ' and deleted the file' : ' (file kept on disk)'}`, before: d });
  });
  unindexEntity('document', id);
  if (opts.deleteFile) {
    try {
      const p = assertInsideAny(d.stored_path, opts.allowedRoots, 'document path');
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) {
      log.warn('Could not delete document file', e);
      throw validation('The record was removed but the file could not be deleted.');
    }
  }
}

/** Re-point a missing document at a replacement file (copied into the record folder). */
export function relocateDocument(id: string, sourcePath: string) {
  const d = get<any>('SELECT * FROM documents WHERE id = ?', [id]);
  if (!d) throw notFound('Document');
  const { dir } = resolveDocFolder(d.entity_type, d.entity_id, d.doc_type, d.company_id);
  const st = fs.statSync(sourcePath);
  if (!st.isFile()) throw validation('Choose a file.');
  const target = uniqueFilePath(dir, sanitizeWindowsName(path.basename(sourcePath), 'document'));
  fs.copyFileSync(sourcePath, target, fs.constants.COPYFILE_EXCL);
  const company = d.company_id ? get<any>('SELECT folder_path FROM companies WHERE id = ?', [d.company_id]) : null;
  run(`UPDATE documents SET stored_path = ?, rel_path = ?, file_name = ?, sha256 = ?, size_bytes = ?, is_missing = 0, last_checked_at = ?, updated_at = ? WHERE id = ?`, [
    target,
    company?.folder_path ? path.relative(company.folder_path, target) : null,
    path.basename(target),
    sha256(target),
    st.size,
    nowIso(),
    nowIso(),
    id,
  ]);
  audit('document', id, 'relocate', { summary: `Replaced missing file with ${path.basename(target)}` });
  return getDocument(id);
}

export interface IntegrityReport {
  checked: number;
  missingDocuments: any[];
  missingReports: any[];
  missingCompanyFolders: any[];
  missingExcel: any[];
  recovered: number;
}

/** Flags (never deletes) records whose files were moved or removed outside the app. */
export function checkFileIntegrity(): IntegrityReport {
  const rep: IntegrityReport = { checked: 0, missingDocuments: [], missingReports: [], missingCompanyFolders: [], missingExcel: [], recovered: 0 };
  const now = nowIso();
  tx(() => {
    for (const d of all<any>('SELECT id, stored_path, rel_path, company_id, is_missing, file_name FROM documents WHERE deleted_at IS NULL')) {
      rep.checked++;
      let exists = fs.existsSync(d.stored_path);
      if (!exists && d.rel_path && d.company_id) {
        const c = get<any>('SELECT folder_path FROM companies WHERE id = ?', [d.company_id]);
        const alt = c?.folder_path ? path.join(c.folder_path, d.rel_path) : null;
        if (alt && fs.existsSync(alt)) {
          run('UPDATE documents SET stored_path = ? WHERE id = ?', [alt, d.id]);
          exists = true;
        }
      }
      if (!exists) rep.missingDocuments.push({ id: d.id, file_name: d.file_name, stored_path: d.stored_path });
      if (!!d.is_missing !== !exists) {
        run('UPDATE documents SET is_missing = ?, last_checked_at = ? WHERE id = ?', [exists ? 0 : 1, now, d.id]);
        if (exists) rep.recovered++;
      }
    }
    for (const r of all<any>('SELECT id, title, file_path, is_missing FROM generated_reports')) {
      rep.checked++;
      const exists = fs.existsSync(r.file_path);
      if (!exists) rep.missingReports.push({ id: r.id, title: r.title, file_path: r.file_path });
      if (!!r.is_missing !== !exists) run('UPDATE generated_reports SET is_missing = ? WHERE id = ?', [exists ? 0 : 1, r.id]);
    }
    for (const c of all<any>('SELECT id, name, folder_path, excel_path FROM companies WHERE deleted_at IS NULL')) {
      rep.checked++;
      if (!fs.existsSync(c.folder_path)) rep.missingCompanyFolders.push({ id: c.id, name: c.name, folder_path: c.folder_path });
      else if (c.excel_path && !fs.existsSync(c.excel_path)) rep.missingExcel.push({ id: c.id, name: c.name, excel_path: c.excel_path });
    }
  });
  return rep;
}

/** Documents lacking for royalty compliance: receipts needing a pass, and passes with no scan. */
export function royaltyDocumentGaps(filters: { companyId?: string | null; projectId?: string | null } = {}) {
  const rp: any[] = [];
  let rw = '';
  if (filters.companyId) (rw += ' AND r.company_id = ?', rp.push(filters.companyId));
  if (filters.projectId) (rw += ' AND r.project_id = ?', rp.push(filters.projectId));
  const receiptsNoPass = all<any>(
    `SELECT r.id, r.receipt_no, r.received_at, r.vehicle_no, r.royalty_pass_no, s.name AS supplier_name, v.label AS spec_label, p.name AS project_name
     FROM material_receipts r JOIN suppliers s ON s.id = r.supplier_id JOIN v_specs v ON v.id = r.spec_id JOIN projects p ON p.id = r.project_id
     JOIN materials m ON m.id = v.material_id
     WHERE r.deleted_at IS NULL AND r.status = 'posted' AND m.requires_royalty = 1
       AND NOT EXISTS (SELECT 1 FROM royalty_passes rp WHERE rp.receipt_id = r.id AND rp.deleted_at IS NULL)${rw}
     ORDER BY r.received_at DESC`,
    rp
  );
  const pp: any[] = [];
  let pw = '';
  if (filters.companyId) (pw += ' AND rp.company_id = ?', pp.push(filters.companyId));
  if (filters.projectId) (pw += ' AND rp.project_id = ?', pp.push(filters.projectId));
  const passesNoScan = all<any>(
    `SELECT rp.id, rp.pass_no, rp.dispatch_at, rp.vehicle_no, rp.verification_status, s.name AS supplier_name
     FROM royalty_passes rp LEFT JOIN suppliers s ON s.id = rp.supplier_id
     WHERE rp.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.entity_type = 'royalty' AND d.entity_id = rp.id AND d.deleted_at IS NULL)${pw}
     ORDER BY rp.dispatch_at DESC`,
    pp
  );
  const unverified = all<any>(
    `SELECT rp.id, rp.pass_no, rp.dispatch_at, rp.vehicle_no, s.name AS supplier_name FROM royalty_passes rp LEFT JOIN suppliers s ON s.id = rp.supplier_id
     WHERE rp.deleted_at IS NULL AND rp.verification_status = 'unverified'${pw} ORDER BY rp.dispatch_at DESC`,
    pp
  );
  return { receipts_without_pass: receiptsNoPass, passes_without_document: passesNoScan, unverified_passes: unverified };
}
