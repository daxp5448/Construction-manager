import fs from 'fs';
import path from 'path';
import { z, ZodError, ZodType } from 'zod';
import { CHANNELS, Channel } from '../src/shared/channels';
import { ApiError } from './errors';
import { log } from './logger';
import { all, get } from './db/core';
import { getLastMigration } from './db';
import { getDataDir, getDbFile, getInternalBackupDir, assertInsideAny } from './paths';
import { MODULES } from '../src/shared/modules';
import { getSettings, saveSettings, backupDirectory } from './services/settings';
import { archiveCompany, getAllCompanies, getCompanyById, purgeCompany, restoreCompany } from './services/companies';
import { createCompanyFlow, regenerateCompanyExcel, repairCompanyFolders, updateCompanyFlow } from './services/companyFlow';
import { getRecord, history, listRecords, removeRecord, restoreRecord, saveRecord } from './services/crud';
import './services/hooks';
import { measurementHistory } from './services/hooks';
import { lookup } from './services/refs';
import { cancelPurchase, getPurchase, listPurchases, openPurchaseLines, removePurchase, restorePurchase, savePurchase } from './services/purchases';
import { cancelReceipt, getReceipt, listReceipts, saveReceipt, vehicleHistory } from './services/receipts';
import { postManualStock, stockLedger, stockRegister, voidManualStock } from './services/stock';
import { supplierLedger, supplierProfile } from './services/billing';
import { royaltyReconciliation, suggestRoyalty } from './services/royalty';
import {
  ALLOWED_EXT,
  attachFiles,
  checkFileIntegrity,
  documentPath,
  DOC_TYPES,
  getDocument,
  listDocuments,
  relocateDocument,
  removeDocument,
  royaltyDocumentGaps,
  setVerification,
} from './services/documents';
import { generateReport, previewReport, reportCatalog, reportFile, reportFolderFor, reportHistory } from './services/reports';
import { searchQuery } from './services/search';
import { getDashboard } from './services/dashboard';
import { autoBackupIfDue, createBackup, exportArchive, backupExcelFiles, listBackups, restoreBackup } from './services/backup';
import { reopenDatabase } from './db';
import { getLegacyStats } from './services/companies';
import { ensureDirSync } from './folderManager';

/** Late-bound Electron pieces so this module also loads under plain Node (tests). */
export interface Platform {
  openPath: (p: string) => Promise<string>;
  showItemInFolder: (p: string) => void;
  pickFiles: (opts: { title: string; filters?: Array<{ name: string; extensions: string[] }>; multi?: boolean }) => Promise<string[]>;
  pickFolder: (title: string) => Promise<string | null>;
  appVersion: string;
  versions: Record<string, string>;
}

let platform: Platform | null = null;
export const setPlatform = (p: Platform) => (platform = p);
const plat = (): Platform => {
  if (!platform) throw new ApiError('This action needs the desktop application.', 'INTERNAL');
  return platform;
};

// ---------------------------------------------------------------- path safety
export function allowedRoots(): string[] {
  const s = getSettings();
  const roots = [s.storageRoot, backupDirectory(), getInternalBackupDir(), getDataDir()];
  try {
    for (const c of all<{ folder_path: string }>('SELECT folder_path FROM companies')) if (c.folder_path) roots.push(c.folder_path);
  } catch {
    /* db not ready */
  }
  return roots;
}

const OPENABLE = new Set([...ALLOWED_EXT, '.log', '.html', '.json']);
const BLOCKED = new Set(['.exe', '.bat', '.cmd', '.com', '.msi', '.ps1', '.vbs', '.js', '.jse', '.wsf', '.lnk', '.scr', '.hta', '.jar', '.reg', '.dll']);

function safeTarget(p: string): string {
  const resolved = assertInsideAny(p, allowedRoots(), 'path');
  if (!fs.existsSync(resolved)) throw new ApiError(`Path does not exist: ${resolved}`, 'NOT_FOUND');
  const st = fs.statSync(resolved);
  if (st.isFile()) {
    const ext = path.extname(resolved).toLowerCase();
    if (BLOCKED.has(ext) || !OPENABLE.has(ext)) throw new ApiError(`Files of type "${ext || 'unknown'}" cannot be opened from here.`, 'FORBIDDEN');
  }
  return resolved;
}

async function openSafe(p: string) {
  const target = safeTarget(p);
  const err = await plat().openPath(target);
  if (err) throw new ApiError(err, 'INTERNAL');
  return { opened: target };
}

// ---------------------------------------------------------------- schemas
const id = z.string().min(1).max(120);
const optId = z.string().max(120).nullish();
const iso = z.string().max(40).nullish();
const anyRecord = z.record(z.string(), z.any());
const filters = z.record(z.string(), z.string().max(200).nullish());
const reportFilters = z.object({
  companyId: optId,
  projectId: optId,
  supplierId: optId,
  specId: optId,
  from: iso,
  to: iso,
  month: z.string().regex(/^\d{4}-\d{2}$/).nullish(),
  fy: z.string().regex(/^\d{4}-\d{2}$/).nullish(),
  date: iso,
});
const moduleId = z.string().refine((m) => m in MODULES, 'Unknown module');
const allowDup = z.object({ allowDuplicate: z.boolean().optional(), reason: z.string().max(500).optional() });
const slip = z.object({
  id: optId,
  slip_no: z.string().max(60).nullish(),
  weighbridge_name: z.string().max(100).nullish(),
  slip_at: iso,
  vehicle_no: z.string().max(30).nullish(),
  weight_unit: z.string().max(20),
  gross_milli: z.number().int(),
  tare_milli: z.number().int(),
  notes: z.string().max(500).nullish(),
});

const handlers: Record<string, { schema: ZodType<any>; fn: (p: any) => any | Promise<any> }> = {};
function on<S extends ZodType<any>>(channel: Channel, schema: S, fn: (p: z.infer<S>) => any | Promise<any>) {
  handlers[channel] = { schema, fn };
}
const none = z.object({}).passthrough();

export function registeredChannels(): string[] {
  return Object.keys(handlers);
}

// ---------------------------------------------------------------- handlers
export function defineHandlers() {
  // ---- companies
  on('company.create', z.object({ name: z.string().max(200), fields: z.array(z.object({ id: z.string().max(100), name: z.string().max(200), value: z.string().max(5000) })).max(300), notes: z.string().max(10000).optional() }), (p) =>
    createCompanyFlow(p as any)
  );
  on('company.update', z.object({ id, name: z.string().max(200), fields: z.array(z.object({ id: z.string().max(100), name: z.string().max(200), value: z.string().max(5000) })).max(300), notes: z.string().max(10000).optional() }), (p) =>
    updateCompanyFlow(p as any)
  );
  on('company.list', z.object({ search: z.string().max(200).optional(), archived: z.boolean().optional() }), (p) => getAllCompanies(p.search, !!p.archived));
  on('company.get', z.object({ id }), (p) => getCompanyById(p.id));
  on('company.delete', z.object({ id, deleteFiles: z.boolean() }), async (p) => {
    // keep files => archive (recoverable). deleteFiles => explicit permanent purge, refused when records depend on it.
    if (!p.deleteFiles) {
      if (!archiveCompany(p.id)) return { success: false, error: 'Company not found' };
      return { success: true, archived: true };
    }
    return purgeCompany(p.id, true);
  });
  on('company.restore', z.object({ id }), (p) => ({ success: restoreCompany(p.id) }));
  on('company.regenerateExcel', z.object({ id }), (p) => regenerateCompanyExcel(p.id));
  on('company.repairFolders', z.object({ id }), (p) => repairCompanyFolders(p.id));

  // ---- generic registers
  on('crud.list', z.object({ module: moduleId, search: z.string().max(200).optional(), filters: filters.optional(), from: iso, to: iso, archived: z.boolean().optional(), page: z.number().int().min(1).optional(), pageSize: z.number().int().min(1).max(5000).optional() }), (p) =>
    listRecords(p.module, { search: p.search, filters: p.filters, from: p.from, to: p.to, archived: p.archived, page: p.page, pageSize: p.pageSize })
  );
  on('crud.get', z.object({ module: moduleId, id }), (p) => getRecord(p.module, p.id));
  on('crud.save', z.object({ module: moduleId, id: optId, values: anyRecord }).merge(allowDup), (p) => saveRecord(p.module, { id: p.id, values: p.values }, { allowDuplicate: p.allowDuplicate, reason: p.reason }));
  on('crud.remove', z.object({ module: moduleId, id, reason: z.string().max(500).optional() }), (p) => (removeRecord(p.module, p.id, p.reason), { removed: true }));
  on('crud.restore', z.object({ module: moduleId, id }), (p) => restoreRecord(p.module, p.id));
  on('crud.history', z.object({ entityType: z.string().max(40), entityId: id }), (p) => history(p.entityType, p.entityId));
  on('measurement.history', z.object({ group: id }), (p) => measurementHistory(p.group));
  on('lookup.list', z.object({ ref: z.enum(['company', 'project', 'supplier', 'category', 'material', 'spec', 'unit', 'activity', 'formula', 'testType', 'receipt', 'invoice', 'purchase']), q: z.string().max(100).optional(), parentColumn: z.string().max(40).optional(), parentValue: optId, includeInactive: z.boolean().optional(), supplierId: optId, ids: z.array(id).max(200).optional(), limit: z.number().int().max(500).optional() }), (p) =>
    lookup(p as any)
  );

  // ---- purchases
  const poItem = z.object({ id: optId, spec_id: id, qty_milli: z.number().int(), rate_paise: z.number().int(), tax_bp: z.number().int().nullish(), notes: z.string().max(500).nullish() });
  on('purchase.list', z.object({ search: z.string().max(200).optional(), company_id: optId, project_id: optId, supplier_id: optId, spec_id: optId, payment_status: z.string().max(20).nullish(), status: z.string().max(20).nullish(), from: iso, to: iso, archived: z.boolean().optional(), page: z.number().int().optional(), pageSize: z.number().int().optional() }), (p) =>
    listPurchases(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && v !== undefined && v !== '')) as any)
  );
  on('purchase.get', z.object({ id }), (p) => getPurchase(p.id));
  on(
    'purchase.save',
    z.object({
      id: optId,
      po_no: z.string().max(60).nullish(),
      purchase_date: z.string().max(20),
      company_id: id,
      project_id: id,
      supplier_id: id,
      supplier_ref: z.string().max(100).nullish(),
      invoice_no: z.string().max(60).nullish(),
      status: z.string().max(20).optional(),
      payment_status: z.string().max(20).optional(),
      tax_treatment: z.string().max(20).optional(),
      freight_paise: z.number().int().nullish(),
      other_charges_paise: z.number().int().nullish(),
      adjustment_paise: z.number().int().nullish(),
      adjustment_note: z.string().max(500).nullish(),
      remarks: z.string().max(2000).nullish(),
      items: z.array(poItem).min(1).max(100),
      allowDuplicate: z.boolean().optional(),
      reason: z.string().max(500).optional(),
    }),
    (p) => {
      const { allowDuplicate, reason, ...input } = p;
      return savePurchase(input as any, { allowDuplicate, reason });
    }
  );
  on('purchase.cancel', z.object({ id, reason: z.string().max(500) }), (p) => cancelPurchase(p.id, p.reason));
  on('purchase.remove', z.object({ id, reason: z.string().max(500).optional() }), (p) => (removePurchase(p.id, p.reason), { removed: true }));
  on('purchase.restore', z.object({ id }), (p) => restorePurchase(p.id));
  on('purchase.openLines', z.object({ supplierId: id, projectId: optId }), (p) => openPurchaseLines(p.supplierId, p.projectId));

  // ---- receipts
  on('receipt.list', z.object({ search: z.string().max(200).optional(), company_id: optId, project_id: optId, supplier_id: optId, spec_id: optId, purchase_id: optId, vehicle_no: z.string().max(30).nullish(), status: z.string().max(20).nullish(), short_only: z.boolean().optional(), from: iso, to: iso, page: z.number().int().optional(), pageSize: z.number().int().optional() }), (p) =>
    listReceipts(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && v !== undefined && v !== '')) as any)
  );
  on('receipt.get', z.object({ id }), (p) => getReceipt(p.id));
  on(
    'receipt.save',
    z.object({
      id: optId,
      receipt_no: z.string().max(60).nullish(),
      received_at: z.string().max(20),
      company_id: id,
      project_id: id,
      supplier_id: id,
      purchase_id: optId,
      purchase_item_id: optId,
      spec_id: optId,
      vehicle_no: z.string().max(30).nullish(),
      driver_name: z.string().max(100).nullish(),
      driver_mobile: z.string().max(20).nullish(),
      invoice_no: z.string().max(60).nullish(),
      challan_no: z.string().max(60).nullish(),
      royalty_pass_no: z.string().max(60).nullish(),
      ordered_qty_milli: z.number().int().nullish(),
      received_qty_milli: z.number().int().nullish(),
      rejected_qty_milli: z.number().int().nullish(),
      rejection_reason: z.string().max(500).nullish(),
      location: z.string().max(80).nullish(),
      remarks: z.string().max(2000).nullish(),
      slips: z.array(slip).max(30).optional(),
      allowDuplicate: z.boolean().optional(),
      reason: z.string().max(500).optional(),
    }),
    (p) => {
      const { allowDuplicate, reason, ...input } = p;
      return saveReceipt(input as any, { allowDuplicate, reason });
    }
  );
  on('receipt.cancel', z.object({ id, reason: z.string().max(500) }), (p) => cancelReceipt(p.id, p.reason));
  on('receipt.vehicleHistory', z.object({ vehicle: z.string().max(30) }), (p) => vehicleHistory(p.vehicle));

  // ---- stock
  const stockFilters = z.object({ companyId: optId, projectId: optId, specId: optId, location: z.string().max(80).nullish(), from: iso, to: iso });
  on('stock.register', stockFilters, (p) => stockRegister(p as any));
  on('stock.ledger', z.object({ companyId: id, projectId: id, specId: id, location: z.string().max(80).nullish() }), (p) => stockLedger(p.companyId, p.projectId, p.specId, p.location));
  on('stock.post', z.object({ txnDate: z.string().max(20), companyId: id, projectId: id, specId: id, location: z.string().max(80).optional(), type: z.enum(['opening', 'return', 'outward', 'adjustment']), qtyMilli: z.number().int(), reason: z.string().max(500).optional(), notes: z.string().max(500).optional(), allowDuplicate: z.boolean().optional() }), (p) => ({ id: postManualStock(p as any) }));
  on('stock.void', z.object({ id, reason: z.string().max(500) }), (p) => (voidManualStock(p.id, p.reason), { voided: true }));

  // ---- suppliers
  on('supplier.profile', z.object({ id }), (p) => supplierProfile(p.id));
  on('supplier.ledger', z.object({ id, companyId: optId, projectId: optId, from: iso, to: iso }), (p) => supplierLedger(p.id, p));

  // ---- royalty
  on('royalty.reconcile', z.object({ companyId: optId, projectId: optId, supplierId: optId, from: iso, to: iso }), (p) => royaltyReconciliation(p));
  on('royalty.suggest', z.object({ mineral: z.string().max(100), grade: z.string().max(100).nullish(), date: z.string().max(20), netMilli: z.number().int(), weightUnit: z.string().max(20) }), (p) => suggestRoyalty(p.mineral, p.grade ?? null, p.date, p.netMilli, p.weightUnit));
  on('royalty.gaps', z.object({ companyId: optId, projectId: optId }), (p) => royaltyDocumentGaps(p));

  // ---- documents
  on('doc.types', none, () => DOC_TYPES);
  on('doc.list', z.object({ entityType: z.string().max(40).optional(), entityId: z.string().max(120).optional(), companyId: z.string().max(120).optional(), projectId: z.string().max(120).optional(), docType: z.string().max(40).optional(), verification: z.string().max(20).optional(), missingOnly: z.boolean().optional(), search: z.string().max(200).optional(), page: z.number().int().optional(), pageSize: z.number().int().optional() }), (p) => listDocuments(p));
  on('doc.attach', z.object({ entityType: z.string().max(40), entityId: id, docType: z.string().max(40), companyId: optId, title: z.string().max(200).nullish() }), async (p) => {
    const files = await plat().pickFiles({
      title: 'Select documents to attach',
      multi: true,
      filters: [{ name: 'Documents & images', extensions: [...ALLOWED_EXT].map((e) => e.slice(1)) }],
    });
    if (!files.length) return { attached: [], skipped: [], cancelled: true };
    return attachFiles({ ...p, sourcePaths: files });
  });
  on('doc.open', z.object({ id }), async (p) => openSafe(documentPath(p.id, allowedRoots())));
  on('doc.reveal', z.object({ id }), (p) => (plat().showItemInFolder(documentPath(p.id, allowedRoots())), { ok: true }));
  on('doc.verify', z.object({ id, status: z.enum(['unverified', 'verified', 'rejected']), notes: z.string().max(1000).nullish() }), (p) => setVerification(p.id, p.status, p.notes));
  on('doc.remove', z.object({ id, deleteFile: z.boolean().optional() }), (p) => (removeDocument(p.id, { deleteFile: p.deleteFile, allowedRoots: allowedRoots() }), { removed: true }));
  on('doc.relocate', z.object({ id }), async (p) => {
    const files = await plat().pickFiles({ title: 'Select the replacement file', multi: false });
    if (!files.length) return { cancelled: true };
    return relocateDocument(p.id, files[0]);
  });
  on('doc.checkIntegrity', none, () => checkFileIntegrity());

  // ---- reports
  on('report.catalog', none, () => reportCatalog());
  on('report.preview', z.object({ id, filters: reportFilters }), (p) => previewReport(p.id, p.filters));
  on('report.generate', z.object({ id, filters: reportFilters, formats: z.array(z.enum(['xlsx', 'pdf'])).min(1) }), (p) => generateReport(p.id, p.filters, p.formats));
  on('report.history', z.object({ companyId: optId, reportType: optId, limit: z.number().int().optional() }), (p) => reportHistory(p));
  on('report.open', z.object({ id }), async (p) => openSafe(reportFile(p.id).file));
  on('report.openFolder', z.object({ companyId: optId }), async (p) => openSafe(reportFolderFor(p.companyId)));

  // ---- search / dashboard / audit
  on('search.query', z.object({ q: z.string().max(200), types: z.array(z.string().max(30)).max(20).optional(), companyId: optId, limit: z.number().int().max(200).optional() }), (p) => {
    const hits = searchQuery(p.q, { types: p.types, companyId: p.companyId, limit: p.limit });
    // quick-action hints: which hits can open a folder / Excel
    return hits.map((h) => {
      let folderPath: string | null = null;
      let excelPath: string | null = null;
      if (h.entityType === 'company') {
        const c = get<any>('SELECT folder_path, excel_path FROM companies WHERE id = ?', [h.entityId]);
        folderPath = c?.folder_path ?? null;
        excelPath = c?.excel_path ?? null;
      } else if (h.entityType === 'project') {
        folderPath = get<any>('SELECT folder_path FROM projects WHERE id = ?', [h.entityId])?.folder_path ?? null;
      } else if (h.entityType === 'report') {
        const r = get<any>('SELECT file_path FROM generated_reports WHERE id = ?', [h.entityId]);
        if (r) {
          excelPath = /\.xlsx$/i.test(r.file_path) ? r.file_path : null;
          folderPath = path.dirname(r.file_path);
        }
      } else if (h.entityType === 'document') {
        const d = get<any>('SELECT stored_path FROM documents WHERE id = ?', [h.entityId]);
        folderPath = d ? path.dirname(d.stored_path) : null;
      }
      return { ...h, folderPath, excelPath };
    });
  });
  on('dashboard.get', z.object({ companyId: optId }), (p) => getDashboard(p.companyId));
  on('audit.list', z.object({ entityType: z.string().max(40).optional(), entityId: z.string().max(120).optional(), limit: z.number().int().max(1000).optional() }), (p) => {
    const where: string[] = [];
    const params: any[] = [];
    if (p.entityType) (where.push('entity_type = ?'), params.push(p.entityType));
    if (p.entityId) (where.push('entity_id = ?'), params.push(p.entityId));
    return all(`SELECT id, at, actor, entity_type, entity_id, action, summary, reason FROM audit_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${p.limit ?? 200}`, params);
  });

  // ---- settings / backup / system
  on('settings.get', none, () => getSettings());
  on(
    'settings.save',
    z.object({
      storageRoot: z.string().max(500).optional(),
      excelHeaderTitle: z.string().max(120).optional(),
      companyNameInTitle: z.boolean().optional(),
      backupBeforeUpdate: z.boolean().optional(),
      folderTemplate: z.array(z.string().max(100)).max(40).optional(),
      projectFolderTemplate: z.array(z.string().max(100)).max(40).optional(),
      supplierFolderTemplate: z.array(z.string().max(100)).max(40).optional(),
      autoBackup: z.boolean().optional(),
      backupRetention: z.number().int().min(1).max(200).optional(),
      backupDir: z.string().max(500).optional(),
      defaultStockLocation: z.string().max(80).optional(),
      shortToleranceBp: z.number().int().min(0).max(10000).optional(),
      lowStockAlerts: z.boolean().optional(),
    }),
    (p) => {
      const saved = saveSettings(p);
      ensureDirSync(saved.storageRoot);
      return saved;
    }
  );
  on('settings.chooseFolder', z.object({ title: z.string().max(100).optional() }), async (p) => ({ path: await plat().pickFolder(p.title || 'Select folder') }));
  on('backup.list', none, () => listBackups());
  on('backup.create', none, () => createBackup('manual'));
  on('backup.chooseFile', none, async () => {
    const f = await plat().pickFiles({ title: 'Select a database backup', multi: false, filters: [{ name: 'SQLite backups', extensions: ['sqlite', 'db'] }] });
    return { path: f[0] ?? null };
  });
  on('backup.restore', z.object({ file: z.string().max(600), confirmed: z.boolean() }), (p) => restoreBackup(p.file, p.confirmed));
  on('backup.exportArchive', z.object({ companyId: optId }), (p) => exportArchive({ companyId: p.companyId }));
  on('backup.excelBackup', none, () => backupExcelFiles());
  on('system.info', none, () => ({
    appVersion: platform?.appVersion ?? 'dev',
    versions: platform?.versions ?? {},
    dbFile: getDbFile(),
    migration: getLastMigration(),
    logFile: log.file(),
    dataDir: getDataDir(),
    stats: getLegacyStats().totalCompanies,
  }));
  on('system.openPath', z.object({ path: z.string().max(600) }), (p) => openSafe(p.path));
  on('system.showInFolder', z.object({ path: z.string().max(600) }), (p) => (plat().showItemInFolder(safeTarget(p.path)), { ok: true }));
  on('system.openLog', none, () => openSafe(log.file()));
}

// ---------------------------------------------------------------- dispatcher
export interface Envelope {
  ok: boolean;
  data?: any;
  error?: { message: string; code: string; fieldErrors?: Record<string, string>; warnings?: string[] };
}

export async function dispatch(channel: string, payload: unknown): Promise<Envelope> {
  const h = handlers[channel];
  if (!h) return { ok: false, error: { message: `Unknown action "${channel}".`, code: 'FORBIDDEN' } };
  try {
    const parsed = h.schema.parse(payload ?? {});
    const data = await h.fn(parsed);
    return { ok: true, data };
  } catch (e: any) {
    if (e instanceof ApiError) return { ok: false, error: { message: e.message, code: e.code, fieldErrors: e.fieldErrors, warnings: e.warnings } };
    if (e instanceof ZodError) {
      const first = e.issues[0];
      const where = first?.path?.join('.') || 'input';
      log.warn(`IPC validation failed on ${channel}`, e.issues);
      return { ok: false, error: { message: `Invalid value for "${where}".`, code: 'VALIDATION' } };
    }
    log.error(`IPC handler ${channel} failed`, e);
    const msg = String(e?.message || e);
    if (/database is locked/i.test(msg)) return { ok: false, error: { message: 'The database is busy. Please try again in a moment.', code: 'INTERNAL' } };
    return { ok: false, error: { message: msg, code: 'INTERNAL' } };
  }
}

export function assertAllChannelsHandled() {
  const missing = CHANNELS.filter((c) => !(c in handlers));
  const extra = Object.keys(handlers).filter((c) => !(CHANNELS as readonly string[]).includes(c));
  if (missing.length || extra.length) throw new Error(`IPC channel mismatch. Missing: ${missing.join(', ')} Extra: ${extra.join(', ')}`);
}

export function runStartupTasks() {
  try {
    autoBackupIfDue();
  } catch (e) {
    log.warn('Automatic backup failed', e);
  }
  try {
    checkFileIntegrity();
  } catch (e) {
    log.warn('File integrity check failed', e);
  }
}

void reopenDatabase;
