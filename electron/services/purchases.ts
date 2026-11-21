import fs from 'fs';
import { all, get, run, scalar, tx } from '../db/core';
import { audit, newId, nextNumber, nowIso } from '../db/util';
import { ApiError, needsConfirm, notFound, validation } from '../errors';
import { computeTotals, TaxTreatment } from '../../src/shared/purchase';
import { PAYMENT_STATUS, PO_STATUS, TAX_TREATMENT } from '../../src/shared/modules';
import { indexEntity } from './search';
import { ensureSupplierMaterialFolders } from '../folderManager';
import { getSettings } from './settings';
import { log } from '../logger';

export interface PurchaseItemInput {
  id?: string | null;
  spec_id: string;
  qty_milli: number;
  rate_paise: number;
  tax_bp?: number | null;
  notes?: string | null;
}

export interface PurchaseInput {
  id?: string | null;
  po_no?: string | null;
  purchase_date: string;
  company_id: string;
  project_id: string;
  supplier_id: string;
  supplier_ref?: string | null;
  invoice_no?: string | null;
  status?: string;
  payment_status?: string;
  tax_treatment?: string;
  freight_paise?: number | null;
  other_charges_paise?: number | null;
  adjustment_paise?: number | null;
  adjustment_note?: string | null;
  remarks?: string | null;
  items: PurchaseItemInput[];
}

const isInt = (n: any) => typeof n === 'number' && Number.isInteger(n);

function receivedByItem(poId: string): Record<string, { received: number; accepted: number; rejected: number; count: number }> {
  const out: Record<string, { received: number; accepted: number; rejected: number; count: number }> = {};
  for (const r of all<any>(
    `SELECT purchase_item_id AS id, SUM(received_qty_milli) AS rec, SUM(accepted_qty_milli) AS acc, SUM(rejected_qty_milli) AS rej, COUNT(*) AS n
     FROM material_receipts WHERE purchase_id = ? AND deleted_at IS NULL AND status = 'posted' AND purchase_item_id IS NOT NULL GROUP BY purchase_item_id`,
    [poId]
  )) {
    out[r.id] = { received: r.rec || 0, accepted: r.acc || 0, rejected: r.rej || 0, count: r.n };
  }
  return out;
}

export function getPurchase(id: string) {
  const po = get<any>(
    `SELECT po.*, c.name AS company_name, p.name AS project_name, s.name AS supplier_name
     FROM purchase_orders po JOIN companies c ON c.id = po.company_id JOIN projects p ON p.id = po.project_id JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.id = ?`,
    [id]
  );
  if (!po) return null;
  const rec = receivedByItem(id);
  const items = all<any>(
    `SELECT i.*, v.label AS spec_label, v.category_name FROM purchase_order_items i JOIN v_specs v ON v.id = i.spec_id WHERE i.po_id = ? ORDER BY i.line_no`,
    [id]
  ).map((i) => {
    const r = rec[i.id] || { received: 0, accepted: 0, rejected: 0, count: 0 };
    return {
      ...i,
      received_milli: r.received,
      accepted_milli: r.accepted,
      rejected_milli: r.rejected,
      deliveries: r.count,
      pending_milli: Math.max(i.qty_milli - r.received, 0),
      excess_milli: Math.max(r.received - i.qty_milli, 0),
    };
  });
  const orderedByUnit: Record<string, number> = {};
  const receivedByUnit: Record<string, number> = {};
  for (const i of items) {
    orderedByUnit[i.unit_code] = (orderedByUnit[i.unit_code] || 0) + i.qty_milli;
    receivedByUnit[i.unit_code] = (receivedByUnit[i.unit_code] || 0) + i.received_milli;
  }
  const allReceived = items.length > 0 && items.every((i) => i.received_milli >= i.qty_milli);
  const anyReceived = items.some((i) => i.received_milli > 0);
  const delivery_status = po.status === 'cancelled' ? 'cancelled' : allReceived ? 'received' : anyReceived ? 'partial' : 'pending';
  const receipts = all<any>(
    `SELECT id, receipt_no, received_at, vehicle_no, received_qty_milli, accepted_qty_milli, unit_code, status FROM material_receipts
     WHERE purchase_id = ? AND deleted_at IS NULL ORDER BY received_at DESC`,
    [id]
  );
  return { ...po, items, delivery_status, ordered_by_unit: orderedByUnit, received_by_unit: receivedByUnit, receipts };
}

export function listPurchases(q: {
  search?: string;
  company_id?: string;
  project_id?: string;
  supplier_id?: string;
  spec_id?: string;
  payment_status?: string;
  status?: string;
  from?: string;
  to?: string;
  archived?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const where: string[] = [q.archived ? 'po.deleted_at IS NOT NULL' : 'po.deleted_at IS NULL'];
  const params: any[] = [];
  const eq = (col: string, v?: string) => {
    if (v) (where.push(`${col} = ?`), params.push(v));
  };
  eq('po.company_id', q.company_id);
  eq('po.project_id', q.project_id);
  eq('po.supplier_id', q.supplier_id);
  eq('po.payment_status', q.payment_status);
  eq('po.status', q.status);
  if (q.spec_id) (where.push('EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.po_id = po.id AND i.spec_id = ?)'), params.push(q.spec_id));
  if (q.from) (where.push('po.purchase_date >= ?'), params.push(q.from));
  if (q.to) (where.push('po.purchase_date <= ?'), params.push(q.to));
  if (q.search && q.search.trim()) {
    const like = `%${q.search.trim().toLowerCase()}%`;
    where.push(`(LOWER(po.po_no) LIKE ? OR LOWER(IFNULL(po.invoice_no,'')) LIKE ? OR LOWER(IFNULL(po.supplier_ref,'')) LIKE ? OR LOWER(IFNULL(po.remarks,'')) LIKE ?
      OR LOWER(s.name) LIKE ? OR LOWER(p.name) LIKE ?
      OR EXISTS (SELECT 1 FROM purchase_order_items i JOIN v_specs v ON v.id = i.spec_id WHERE i.po_id = po.id AND LOWER(v.label) LIKE ?))`);
    for (let i = 0; i < 7; i++) params.push(like);
  }
  const w = where.join(' AND ');
  const base = `FROM purchase_orders po JOIN companies c ON c.id = po.company_id JOIN projects p ON p.id = po.project_id JOIN suppliers s ON s.id = po.supplier_id WHERE ${w}`;
  const total = scalar<number>(`SELECT COUNT(*) ${base}`, params) ?? 0;
  const pageSize = Math.min(Math.max(q.pageSize ?? 100, 1), 5000);
  const page = Math.max(q.page ?? 1, 1);
  const rows = all<any>(
    `SELECT po.*, c.name AS company_name, p.name AS project_name, s.name AS supplier_name ${base}
     ORDER BY po.purchase_date DESC, po.created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params
  ).map((po) => {
    const items = all<any>(
      `SELECT v.label, i.qty_milli, i.unit_code, i.id FROM purchase_order_items i JOIN v_specs v ON v.id = i.spec_id WHERE i.po_id = ? ORDER BY i.line_no`,
      [po.id]
    );
    const rec = receivedByItem(po.id);
    const ordered = items.reduce((a, i) => a + i.qty_milli, 0);
    const received = items.reduce((a, i) => a + (rec[i.id]?.received || 0), 0);
    const done = items.length > 0 && items.every((i) => (rec[i.id]?.received || 0) >= i.qty_milli);
    const delivery_status = po.status === 'cancelled' ? 'cancelled' : done ? 'received' : received > 0 ? 'partial' : 'pending';
    return { ...po, items, ordered_milli: ordered, received_milli: received, delivery_status };
  });
  return { rows, total };
}

function validateInput(input: PurchaseInput) {
  const errs: Record<string, string> = {};
  if (!input.purchase_date || !/^\d{4}-\d{2}-\d{2}$/.test(input.purchase_date)) errs.purchase_date = 'Required';
  if (!input.company_id) errs.company_id = 'Required';
  if (!input.project_id) errs.project_id = 'Required';
  if (!input.supplier_id) errs.supplier_id = 'Required';
  if (Object.keys(errs).length) throw validation('Date, company, project and supplier are required.', errs);
  if (!Array.isArray(input.items) || input.items.length === 0) throw validation('Add at least one material line.');
  input.items.forEach((it, i) => {
    if (!it.spec_id) throw validation(`Line ${i + 1}: choose a material specification.`);
    if (!isInt(it.qty_milli) || it.qty_milli <= 0) throw validation(`Line ${i + 1}: quantity must be greater than zero.`);
    if (!isInt(it.rate_paise) || it.rate_paise < 0) throw validation(`Line ${i + 1}: rate must be zero or more.`);
    if (it.tax_bp !== null && it.tax_bp !== undefined && (!isInt(it.tax_bp) || it.tax_bp < 0)) throw validation(`Line ${i + 1}: tax % is invalid.`);
  });
  for (const k of ['freight_paise', 'other_charges_paise'] as const) {
    const v = input[k];
    if (v !== null && v !== undefined && (!isInt(v) || v < 0)) throw validation(`${k === 'freight_paise' ? 'Freight' : 'Other charges'} must be zero or more.`);
  }
  if (input.adjustment_paise !== null && input.adjustment_paise !== undefined && !isInt(input.adjustment_paise)) throw validation('Adjustment is invalid.');
  if (input.adjustment_paise && !(input.adjustment_note && input.adjustment_note.trim())) throw validation('Add a note explaining the manual adjustment.', { adjustment_note: 'Required' });
  const tt = input.tax_treatment || 'exclusive';
  if (!TAX_TREATMENT.some((t) => t.value === tt)) throw validation('Invalid tax treatment.');
  if (input.status && !PO_STATUS.some((s) => s.value === input.status && s.value !== 'cancelled')) throw validation('Use Cancel to cancel a purchase.');
  if (input.payment_status && !PAYMENT_STATUS.some((s) => s.value === input.payment_status)) throw validation('Invalid payment status.');
}

export function savePurchase(input: PurchaseInput, opts: { allowDuplicate?: boolean; reason?: string } = {}) {
  validateInput(input);
  const existing = input.id ? get<any>('SELECT * FROM purchase_orders WHERE id = ?', [input.id]) : null;
  if (input.id && !existing) throw notFound('Purchase');
  if (existing?.status === 'cancelled') throw validation('A cancelled purchase cannot be edited.');
  if (existing?.deleted_at) throw validation('This purchase is archived.');

  const project = get<any>('SELECT id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL', [input.project_id]);
  if (!project) throw validation('Selected project does not exist.', { project_id: 'Invalid' });
  if (project.company_id !== input.company_id) throw validation('The project does not belong to the selected company.', { project_id: 'Invalid' });
  const supplier = get<any>('SELECT id, name, status FROM suppliers WHERE id = ? AND deleted_at IS NULL', [input.supplier_id]);
  if (!supplier) throw validation('Selected supplier does not exist.', { supplier_id: 'Invalid' });

  const treatment = (input.tax_treatment || 'exclusive') as TaxTreatment;
  const warnings: string[] = [];
  if (supplier.status !== 'active') warnings.push(`Supplier "${supplier.name}" is marked ${supplier.status}.`);

  // Resolve spec/unit for every line + compare with existing receipts.
  const specs = new Map<string, any>();
  for (const it of input.items) {
    const s = get<any>('SELECT * FROM v_specs WHERE id = ? AND deleted_at IS NULL', [it.spec_id]);
    if (!s) throw validation('A selected material specification no longer exists.');
    specs.set(it.spec_id, s);
    const link = get('SELECT 1 AS x FROM supplier_materials WHERE supplier_id = ? AND spec_id = ? AND deleted_at IS NULL', [input.supplier_id, it.spec_id]);
    if (!link) warnings.push(`${supplier.name} is not set up as a supplier of ${s.label}. (Add it under Suppliers → Materials & rates.)`);
  }

  const existingItems = existing ? all<any>('SELECT * FROM purchase_order_items WHERE po_id = ?', [existing.id]) : [];
  if (existing) {
    const rec = receivedByItem(existing.id);
    const hasReceipts = Object.keys(rec).length > 0 || (scalar<number>(`SELECT COUNT(*) FROM material_receipts WHERE purchase_id = ? AND deleted_at IS NULL AND status='posted'`, [existing.id]) ?? 0) > 0;
    if (hasReceipts) {
      if (existing.supplier_id !== input.supplier_id || existing.project_id !== input.project_id || existing.company_id !== input.company_id) {
        throw validation('Material has already been received against this order, so its company, project and supplier cannot be changed.');
      }
      const keepIds = new Set(input.items.map((i) => i.id).filter(Boolean));
      for (const old of existingItems) {
        const r = rec[old.id];
        if (!r) continue;
        const kept = input.items.find((i) => i.id === old.id);
        if (!kept || !keepIds.has(old.id)) throw validation(`Line "${specs.get(old.spec_id)?.label ?? 'item'}" already has deliveries and cannot be removed.`);
        if (kept.spec_id !== old.spec_id) throw validation('The material of a line with deliveries cannot be changed.');
        if (kept.qty_milli < r.received) warnings.push(`Ordered quantity for ${specs.get(old.spec_id)?.label} is now below what was already received.`);
      }
    }
  }

  // duplicate checks
  if (input.po_no && input.po_no.trim()) {
    const dup = get('SELECT id FROM purchase_orders WHERE po_no = ? AND deleted_at IS NULL AND id <> ?', [input.po_no.trim(), existing?.id ?? '']);
    if (dup) throw validation(`Purchase order number ${input.po_no.trim()} already exists.`, { po_no: 'Duplicate' });
  }
  if (input.invoice_no && input.invoice_no.trim()) {
    const dup = get<any>(
      'SELECT po_no FROM purchase_orders WHERE supplier_id = ? AND lower(invoice_no) = lower(?) AND deleted_at IS NULL AND status <> \'cancelled\' AND id <> ?',
      [input.supplier_id, input.invoice_no.trim(), existing?.id ?? '']
    );
    if (dup) warnings.push(`Invoice ${input.invoice_no.trim()} is already recorded on purchase ${dup.po_no} for this supplier.`);
  }
  if (warnings.length && !opts.allowDuplicate) needsConfirm(warnings);

  const calc = computeTotals(
    treatment,
    input.items.map((i) => ({ qty_milli: i.qty_milli, rate_paise: i.rate_paise, tax_bp: i.tax_bp || 0 })),
    { freight_paise: input.freight_paise || 0, other_charges_paise: input.other_charges_paise || 0, adjustment_paise: input.adjustment_paise || 0 }
  );
  if (calc.total_paise < 0) throw validation('The adjustment makes the total negative.');

  const now = nowIso();
  const id = existing?.id ?? newId();
  const before = existing ? getPurchase(existing.id) : null;
  tx(() => {
    const poNo = (input.po_no && input.po_no.trim()) || existing?.po_no || nextNumber('PO', { date: input.purchase_date });
    const header = [
      poNo,
      input.purchase_date,
      input.company_id,
      input.project_id,
      input.supplier_id,
      input.supplier_ref?.trim() || null,
      input.invoice_no?.trim().toUpperCase() || null,
      input.status || existing?.status || 'ordered',
      input.payment_status || existing?.payment_status || 'unpaid',
      treatment,
      calc.subtotal_paise,
      calc.tax_paise,
      input.freight_paise || 0,
      input.other_charges_paise || 0,
      input.adjustment_paise || 0,
      input.adjustment_note?.trim() || null,
      calc.total_paise,
      input.remarks?.trim() || null,
    ];
    if (!existing) {
      run(
        `INSERT INTO purchase_orders (po_no, purchase_date, company_id, project_id, supplier_id, supplier_ref, invoice_no, status, payment_status, tax_treatment,
           subtotal_paise, tax_paise, freight_paise, other_charges_paise, adjustment_paise, adjustment_note, total_paise, remarks, id, created_at, updated_at)
         VALUES (${Array(21).fill('?').join(',')})`,
        [...header, id, now, now]
      );
    } else {
      run(
        `UPDATE purchase_orders SET po_no=?, purchase_date=?, company_id=?, project_id=?, supplier_id=?, supplier_ref=?, invoice_no=?, status=?, payment_status=?, tax_treatment=?,
           subtotal_paise=?, tax_paise=?, freight_paise=?, other_charges_paise=?, adjustment_paise=?, adjustment_note=?, total_paise=?, remarks=?, updated_at=? WHERE id=?`,
        [...header, now, id]
      );
    }
    // items: update kept, insert new, delete removed (only possible when they have no deliveries)
    const keep = new Set<string>();
    input.items.forEach((it, idx) => {
      const spec = specs.get(it.spec_id);
      const c = calc.lines[idx];
      const row = [idx + 1, it.spec_id, it.qty_milli, spec.unit_code, it.rate_paise, it.tax_bp || 0, c.subtotal_paise, c.tax_paise, c.total_paise, it.notes?.trim() || null];
      const prior = it.id ? existingItems.find((e) => e.id === it.id) : null;
      if (prior) {
        keep.add(prior.id);
        run(`UPDATE purchase_order_items SET line_no=?, spec_id=?, qty_milli=?, unit_code=?, rate_paise=?, tax_bp=?, subtotal_paise=?, tax_paise=?, total_paise=?, notes=? WHERE id=?`, [...row, prior.id]);
      } else {
        const iid = newId();
        keep.add(iid);
        run(`INSERT INTO purchase_order_items (line_no, spec_id, qty_milli, unit_code, rate_paise, tax_bp, subtotal_paise, tax_paise, total_paise, notes, id, po_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [...row, iid, id]);
      }
    });
    for (const old of existingItems) {
      if (!keep.has(old.id)) run('DELETE FROM purchase_order_items WHERE id = ?', [old.id]);
    }
    run(`INSERT OR IGNORE INTO supplier_projects (supplier_id, project_id) VALUES (?,?)`, [input.supplier_id, input.project_id]);
    const after = getPurchase(id);
    audit('purchase', id, existing ? 'update' : 'create', {
      summary: existing ? `Updated purchase ${after.po_no} (total ${after.total_paise / 100})` : `Created purchase ${after.po_no}`,
      before,
      after,
      reason: opts.reason ?? null,
    });
  });
  indexEntity('purchase', id);
  ensureFoldersForPurchase(id);
  return { purchase: getPurchase(id), warnings, created: !existing };
}

/** Best-effort: create the 07_Materials/<Category>/<Spec>/<Supplier>/… folders for every line. Never fails the save. */
function ensureFoldersForPurchase(id: string) {
  try {
    const po = get<any>(
      `SELECT po.supplier_id, c.folder_path, s.name AS sname, s.folder_name FROM purchase_orders po
       JOIN companies c ON c.id = po.company_id JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?`,
      [id]
    );
    if (!po || !po.folder_path) return;
    const tpl = getSettings().supplierFolderTemplate;
    for (const i of all<any>(
      `SELECT v.category_name, v.material_name, v.size_grade FROM purchase_order_items i JOIN v_specs v ON v.id = i.spec_id WHERE i.po_id = ?`,
      [id]
    )) {
      if (!fs.existsSync(po.folder_path)) fs.mkdirSync(po.folder_path, { recursive: true });
      ensureSupplierMaterialFolders(po.folder_path, i.category_name, i.material_name, i.size_grade, po.folder_name || po.sname, tpl);
    }
  } catch (e) {
    log.warn('Could not create purchase folders', e);
  }
}

export function cancelPurchase(id: string, reason: string) {
  if (!reason || !reason.trim()) throw validation('A reason is required to cancel a purchase.', { reason: 'Required' });
  const po = get<any>('SELECT * FROM purchase_orders WHERE id = ?', [id]);
  if (!po) throw notFound('Purchase');
  if (po.status === 'cancelled') throw validation('Purchase is already cancelled.');
  const n = scalar<number>(`SELECT COUNT(*) FROM material_receipts WHERE purchase_id = ? AND deleted_at IS NULL AND status = 'posted'`, [id]) ?? 0;
  if (n > 0) throw validation(`${n} material receipt(s) are posted against this order. Cancel those receipts first, or leave the order open.`);
  const linkedInv = scalar<number>(`SELECT COUNT(*) FROM invoices WHERE purchase_id = ? AND deleted_at IS NULL AND status = 'active'`, [id]) ?? 0;
  tx(() => {
    run(`UPDATE purchase_orders SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ?`, [reason.trim(), nowIso(), id]);
    audit('purchase', id, 'cancel', { summary: `Cancelled purchase ${po.po_no}${linkedInv ? ` (${linkedInv} linked invoice(s) unchanged)` : ''}`, reason, before: po });
  });
  indexEntity('purchase', id);
  return getPurchase(id);
}

export function removePurchase(id: string, reason?: string) {
  const po = get<any>('SELECT * FROM purchase_orders WHERE id = ?', [id]);
  if (!po) throw notFound('Purchase');
  const n = scalar<number>(`SELECT COUNT(*) FROM material_receipts WHERE purchase_id = ? AND deleted_at IS NULL`, [id]) ?? 0;
  if (n > 0) throw validation('This purchase has material receipts. Cancel it instead of archiving.');
  tx(() => {
    run(`UPDATE purchase_orders SET deleted_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), id]);
    audit('purchase', id, 'delete', { summary: `Archived purchase ${po.po_no}`, before: po, reason: reason ?? null });
  });
  indexEntity('purchase', id);
}

export function restorePurchase(id: string) {
  tx(() => {
    run(`UPDATE purchase_orders SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [nowIso(), id]);
    audit('purchase', id, 'restore', { summary: 'Restored purchase' });
  });
  indexEntity('purchase', id);
  return getPurchase(id);
}

/** Pending quantity per open purchase line, for the inward form. */
export function openPurchaseLines(supplierId: string, projectId?: string | null) {
  const pos = all<any>(
    `SELECT id FROM purchase_orders WHERE supplier_id = ? AND deleted_at IS NULL AND status <> 'cancelled' ${projectId ? 'AND project_id = ?' : ''} ORDER BY purchase_date DESC`,
    projectId ? [supplierId, projectId] : [supplierId]
  );
  const out: any[] = [];
  for (const p of pos) {
    const po = getPurchase(p.id);
    for (const i of po.items) {
      out.push({
        purchase_id: po.id,
        po_no: po.po_no,
        purchase_date: po.purchase_date,
        project_id: po.project_id,
        company_id: po.company_id,
        item_id: i.id,
        spec_id: i.spec_id,
        spec_label: i.spec_label,
        unit_code: i.unit_code,
        ordered_milli: i.qty_milli,
        received_milli: i.received_milli,
        pending_milli: i.pending_milli,
      });
    }
  }
  return out;
}

export { ApiError };
