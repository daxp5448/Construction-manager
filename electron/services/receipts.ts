import fs from 'fs';
import { all, get, run, scalar, tx } from '../db/core';
import { audit, newId, nextNumber, nowIso } from '../db/util';
import { needsConfirm, notFound, validation } from '../errors';
import { convertMilli, UnitDef } from '../../src/shared/units';
import { normalizeVehicle } from '../../src/shared/num';
import { WEIGHT_UNIT_OPTS } from '../../src/shared/modules';
import { postStock, voidStockBySource } from './stock';
import { indexEntity } from './search';
import { getSettings } from './settings';
import { ensureSupplierMaterialFolders } from '../folderManager';
import { log } from '../logger';

export interface SlipInput {
  id?: string | null;
  slip_no?: string | null;
  weighbridge_name?: string | null;
  slip_at?: string | null;
  vehicle_no?: string | null;
  weight_unit: string;
  gross_milli: number;
  tare_milli: number;
  notes?: string | null;
}

export interface ReceiptInput {
  id?: string | null;
  receipt_no?: string | null;
  received_at: string;
  company_id: string;
  project_id: string;
  supplier_id: string;
  purchase_id?: string | null;
  purchase_item_id?: string | null;
  spec_id?: string | null;
  vehicle_no?: string | null;
  driver_name?: string | null;
  driver_mobile?: string | null;
  invoice_no?: string | null;
  challan_no?: string | null;
  royalty_pass_no?: string | null;
  ordered_qty_milli?: number | null;
  /** when omitted, calculated from the weighbridge slips */
  received_qty_milli?: number | null;
  rejected_qty_milli?: number | null;
  rejection_reason?: string | null;
  location?: string | null;
  remarks?: string | null;
  slips?: SlipInput[];
}

const isInt = (n: any) => typeof n === 'number' && Number.isInteger(n);
const unit = (code: string): UnitDef | undefined => get<UnitDef>('SELECT * FROM units WHERE code = ?', [code]);

export function getReceipt(id: string) {
  const r = get<any>(
    `SELECT r.*, c.name AS company_name, p.name AS project_name, s.name AS supplier_name, v.label AS spec_label, v.category_name,
            po.po_no AS po_no
     FROM material_receipts r JOIN companies c ON c.id = r.company_id JOIN projects p ON p.id = r.project_id
     JOIN suppliers s ON s.id = r.supplier_id JOIN v_specs v ON v.id = r.spec_id
     LEFT JOIN purchase_orders po ON po.id = r.purchase_id
     WHERE r.id = ?`,
    [id]
  );
  if (!r) return null;
  const slips = all<any>('SELECT * FROM weighbridge_records WHERE receipt_id = ? ORDER BY slip_at, slip_no', [id]);
  const passes = all<any>('SELECT id, pass_no, net_milli, weight_unit, verification_status FROM royalty_passes WHERE receipt_id = ? AND deleted_at IS NULL', [id]);
  const docCount = scalar<number>(`SELECT COUNT(*) FROM documents WHERE entity_type = 'receipt' AND entity_id = ? AND deleted_at IS NULL`, [id]) ?? 0;
  const difference = r.ordered_qty_milli === null ? null : r.ordered_qty_milli - r.received_qty_milli;
  return { ...r, slips, passes, doc_count: docCount, difference_milli: difference, short: isShort(r) };
}

function isShort(r: { ordered_qty_milli: number | null; received_qty_milli: number }): boolean {
  if (r.ordered_qty_milli === null || r.ordered_qty_milli === undefined) return false;
  const tol = Math.round((r.ordered_qty_milli * getSettings().shortToleranceBp) / 10000);
  return r.ordered_qty_milli - r.received_qty_milli > tol;
}

export function listReceipts(q: {
  search?: string;
  company_id?: string;
  project_id?: string;
  supplier_id?: string;
  spec_id?: string;
  purchase_id?: string;
  vehicle_no?: string;
  status?: string;
  short_only?: boolean;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}) {
  const where: string[] = ['r.deleted_at IS NULL'];
  const params: any[] = [];
  const eq = (col: string, v?: string) => {
    if (v) (where.push(`${col} = ?`), params.push(v));
  };
  eq('r.company_id', q.company_id);
  eq('r.project_id', q.project_id);
  eq('r.supplier_id', q.supplier_id);
  eq('r.spec_id', q.spec_id);
  eq('r.purchase_id', q.purchase_id);
  eq('r.status', q.status);
  if (q.vehicle_no) (where.push('r.vehicle_no = ?'), params.push(normalizeVehicle(q.vehicle_no)));
  if (q.from) (where.push('substr(r.received_at,1,10) >= ?'), params.push(q.from));
  if (q.to) (where.push('substr(r.received_at,1,10) <= ?'), params.push(q.to));
  if (q.search && q.search.trim()) {
    const like = `%${q.search.trim().toLowerCase()}%`;
    where.push(`(LOWER(r.receipt_no) LIKE ? OR LOWER(IFNULL(r.vehicle_no,'')) LIKE ? OR LOWER(IFNULL(r.driver_name,'')) LIKE ? OR LOWER(IFNULL(r.invoice_no,'')) LIKE ?
      OR LOWER(IFNULL(r.challan_no,'')) LIKE ? OR LOWER(IFNULL(r.royalty_pass_no,'')) LIKE ? OR LOWER(s.name) LIKE ? OR LOWER(v.label) LIKE ?
      OR EXISTS (SELECT 1 FROM weighbridge_records w WHERE w.receipt_id = r.id AND LOWER(IFNULL(w.slip_no,'')) LIKE ?))`);
    for (let i = 0; i < 9; i++) params.push(like);
  }
  const base = `FROM material_receipts r JOIN companies c ON c.id = r.company_id JOIN projects p ON p.id = r.project_id
     JOIN suppliers s ON s.id = r.supplier_id JOIN v_specs v ON v.id = r.spec_id LEFT JOIN purchase_orders po ON po.id = r.purchase_id
     WHERE ${where.join(' AND ')}`;
  const pageSize = Math.min(Math.max(q.pageSize ?? 100, 1), 5000);
  const page = Math.max(q.page ?? 1, 1);
  let rows = all<any>(
    `SELECT r.*, c.name AS company_name, p.name AS project_name, s.name AS supplier_name, v.label AS spec_label, po.po_no AS po_no,
       (SELECT COUNT(*) FROM weighbridge_records w WHERE w.receipt_id = r.id) AS slip_count,
       (SELECT COUNT(*) FROM royalty_passes rp WHERE rp.receipt_id = r.id AND rp.deleted_at IS NULL) AS pass_count,
       (SELECT COUNT(*) FROM documents d WHERE d.entity_type = 'receipt' AND d.entity_id = r.id AND d.deleted_at IS NULL) AS doc_count,
       (SELECT requires_royalty FROM materials m JOIN material_specifications ms ON ms.material_id = m.id WHERE ms.id = r.spec_id) AS requires_royalty
     ${base} ORDER BY r.received_at DESC, r.created_at DESC`,
    params
  ).map((r) => ({
    ...r,
    difference_milli: r.ordered_qty_milli === null ? null : r.ordered_qty_milli - r.received_qty_milli,
    short: r.status === 'posted' && isShort(r),
    royalty_missing: r.status === 'posted' && !!r.requires_royalty && r.pass_count === 0,
  }));
  if (q.short_only) rows = rows.filter((r) => r.short);
  const total = rows.length;
  rows = rows.slice((page - 1) * pageSize, page * pageSize);
  return { rows, total };
}

export function vehicleHistory(vehicleNo: string) {
  const v = normalizeVehicle(vehicleNo);
  if (!v) return [];
  return all<any>(
    `SELECT r.id, r.receipt_no, r.received_at, r.received_qty_milli, r.accepted_qty_milli, r.unit_code, r.status, s.name AS supplier_name, vs.label AS spec_label,
            p.name AS project_name, r.challan_no, r.royalty_pass_no
     FROM material_receipts r JOIN suppliers s ON s.id = r.supplier_id JOIN v_specs vs ON vs.id = r.spec_id JOIN projects p ON p.id = r.project_id
     WHERE r.vehicle_no = ? AND r.deleted_at IS NULL ORDER BY r.received_at DESC`,
    [v]
  );
}

function resolveSlips(slips: SlipInput[] | undefined, vehicle: string) {
  const out: Array<SlipInput & { net_milli: number; vehicle_no: string }> = [];
  (slips || []).forEach((s, i) => {
    if (!WEIGHT_UNIT_OPTS.some((u) => u.value === s.weight_unit) && !unit(s.weight_unit)) throw validation(`Weighbridge slip ${i + 1}: unknown unit.`);
    if (!isInt(s.gross_milli) || !isInt(s.tare_milli)) throw validation(`Weighbridge slip ${i + 1}: enter gross and tare weights.`);
    if (s.gross_milli < 0 || s.tare_milli < 0) throw validation(`Weighbridge slip ${i + 1}: weights cannot be negative.`);
    if (s.tare_milli > s.gross_milli) throw validation(`Weighbridge slip ${i + 1}: tare weight is more than gross weight.`);
    out.push({ ...s, net_milli: s.gross_milli - s.tare_milli, vehicle_no: normalizeVehicle(s.vehicle_no) || vehicle });
  });
  return out;
}

export function saveReceipt(input: ReceiptInput, opts: { allowDuplicate?: boolean; reason?: string } = {}) {
  const existing = input.id ? get<any>('SELECT * FROM material_receipts WHERE id = ?', [input.id]) : null;
  if (input.id && !existing) throw notFound('Receipt');
  if (existing?.status === 'cancelled') throw validation('A cancelled receipt cannot be edited.');
  if (!input.received_at || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(input.received_at)) throw validation('Date and time of receipt is required.', { received_at: 'Required' });

  // Resolve context from the purchase line when linked
  let purchaseItem: any = null;
  let po: any = null;
  if (input.purchase_item_id) {
    purchaseItem = get<any>('SELECT * FROM purchase_order_items WHERE id = ?', [input.purchase_item_id]);
    if (!purchaseItem) throw validation('The linked purchase line no longer exists.');
    po = get<any>('SELECT * FROM purchase_orders WHERE id = ?', [purchaseItem.po_id]);
    if (po.status === 'cancelled' || po.deleted_at) throw validation(`Purchase ${po.po_no} is cancelled; receive against another order.`);
    if (po.supplier_id !== input.supplier_id) throw validation('The selected purchase belongs to a different supplier.');
    if (po.project_id !== input.project_id) throw validation('The selected purchase belongs to a different project.');
    input.purchase_id = po.id;
    input.spec_id = purchaseItem.spec_id;
  } else if (input.purchase_id) {
    po = get<any>('SELECT * FROM purchase_orders WHERE id = ?', [input.purchase_id]);
    if (!po) throw validation('The linked purchase no longer exists.');
  }
  if (!input.spec_id) throw validation('Choose the material received.', { spec_id: 'Required' });
  const spec = get<any>('SELECT * FROM v_specs WHERE id = ? AND deleted_at IS NULL', [input.spec_id]);
  if (!spec) throw validation('The selected material no longer exists.', { spec_id: 'Invalid' });
  const project = get<any>('SELECT id, company_id FROM projects WHERE id = ? AND deleted_at IS NULL', [input.project_id]);
  if (!project || project.company_id !== input.company_id) throw validation('Project does not belong to the selected company.', { project_id: 'Invalid' });
  const supplier = get<any>('SELECT id, name, folder_name FROM suppliers WHERE id = ? AND deleted_at IS NULL', [input.supplier_id]);
  if (!supplier) throw validation('Selected supplier does not exist.', { supplier_id: 'Invalid' });

  const vehicle = normalizeVehicle(input.vehicle_no);
  const slips = resolveSlips(input.slips, vehicle);
  const specUnit = unit(spec.unit_code)!;

  // Received quantity: weighbridge net (converted to the material's unit) unless the user states the received quantity.
  let slipTotal: number | null = null;
  if (slips.length) {
    let t = 0;
    let ok = true;
    for (const s of slips) {
      const c = convertMilli(s.net_milli, unit(s.weight_unit), specUnit);
      if (c === null) ok = false;
      else t += c;
    }
    slipTotal = ok ? t : null;
  }
  const warnings: string[] = [];
  let received: number;
  if (input.received_qty_milli !== null && input.received_qty_milli !== undefined) {
    if (!isInt(input.received_qty_milli) || input.received_qty_milli < 0) throw validation('Received quantity is invalid.', { received_qty_milli: 'Invalid' });
    received = input.received_qty_milli;
    if (slipTotal !== null && slipTotal !== received) {
      warnings.push(`Received quantity (${received / 1000} ${spec.unit_code}) differs from the weighbridge net total (${slipTotal / 1000} ${spec.unit_code}).`);
    }
  } else if (slipTotal !== null) {
    received = slipTotal;
  } else if (slips.length) {
    throw validation(`The weighbridge unit cannot be converted to ${spec.unit_code}. Enter the received quantity in ${spec.unit_code} yourself.`, { received_qty_milli: 'Required' });
  } else {
    throw validation('Enter the received quantity or at least one weighbridge slip.', { received_qty_milli: 'Required' });
  }
  if (received <= 0) throw validation('Received quantity must be greater than zero.', { received_qty_milli: 'Invalid' });

  const rejected = input.rejected_qty_milli ?? 0;
  if (!isInt(rejected) || rejected < 0) throw validation('Rejected quantity is invalid.', { rejected_qty_milli: 'Invalid' });
  if (rejected > received) throw validation('Rejected quantity cannot exceed the received quantity.', { rejected_qty_milli: 'Invalid' });
  if (rejected > 0 && !(input.rejection_reason && input.rejection_reason.trim())) throw validation('Give a reason for the rejected material.', { rejection_reason: 'Required' });
  const accepted = received - rejected;

  // Expected quantity for THIS delivery (challan / invoice quantity), entered by the user. It is never inferred from the
  // purchase balance, so a partial truckload against a large order is not mistaken for a short delivery.
  let ordered: number | null = input.ordered_qty_milli ?? null;
  if (ordered !== null && (!isInt(ordered) || ordered < 0)) throw validation('Ordered quantity is invalid.');
  if (purchaseItem) {
    const other = scalar<number>(
      `SELECT COALESCE(SUM(received_qty_milli),0) FROM material_receipts WHERE purchase_item_id = ? AND deleted_at IS NULL AND status='posted' AND id <> ?`,
      [purchaseItem.id, existing?.id ?? '']
    ) ?? 0;
    if (other + received > purchaseItem.qty_milli) {
      warnings.push(`Total received against ${po.po_no} (${(other + received) / 1000} ${spec.unit_code}) exceeds the ordered quantity (${purchaseItem.qty_milli / 1000}).`);
    }
  }

  // duplicate warnings
  const excl = existing?.id ?? '';
  const challan = input.challan_no?.trim() || null;
  const invoiceNo = input.invoice_no?.trim().toUpperCase() || null;
  const pass = input.royalty_pass_no?.trim().toUpperCase() || null;
  if (challan) {
    const d = get<any>(`SELECT receipt_no FROM material_receipts WHERE supplier_id = ? AND lower(challan_no) = lower(?) AND deleted_at IS NULL AND status='posted' AND id <> ?`, [input.supplier_id, challan, excl]);
    if (d) warnings.push(`Delivery challan ${challan} was already received on ${d.receipt_no}. Possible duplicate inward.`);
  }
  if (invoiceNo) {
    const d = get<any>(
      `SELECT receipt_no FROM material_receipts WHERE supplier_id = ? AND lower(invoice_no) = lower(?) AND lower(IFNULL(challan_no,'')) = lower(IFNULL(?, '')) AND deleted_at IS NULL AND status='posted' AND id <> ?`,
      [input.supplier_id, invoiceNo, challan, excl]
    );
    if (d) warnings.push(`Invoice ${invoiceNo} with the same challan was already received on ${d.receipt_no}.`);
  }
  if (pass) {
    const d = get<any>(`SELECT receipt_no FROM material_receipts WHERE lower(royalty_pass_no) = lower(?) AND deleted_at IS NULL AND status='posted' AND id <> ?`, [pass, excl]);
    if (d) warnings.push(`Royalty pass ${pass} is already used on ${d.receipt_no}.`);
  }
  for (const s of slips) {
    if (!s.slip_no?.trim()) continue;
    const d = get<any>(
      `SELECT r.receipt_no FROM weighbridge_records w JOIN material_receipts r ON r.id = w.receipt_id
       WHERE lower(w.slip_no) = lower(?) AND lower(IFNULL(w.weighbridge_name,'')) = lower(IFNULL(?, '')) AND r.deleted_at IS NULL AND r.status='posted' AND r.id <> ?`,
      [s.slip_no.trim(), s.weighbridge_name?.trim() || null, excl]
    );
    if (d) warnings.push(`Weighbridge slip ${s.slip_no.trim()} already appears on ${d.receipt_no}.`);
  }
  if (!vehicle) warnings.push('No vehicle number entered.');
  const uniq = Array.from(new Set(warnings));
  if (uniq.length && !opts.allowDuplicate) needsConfirm(uniq);

  const id = existing?.id ?? newId();
  const now = nowIso();
  const location = (input.location || getSettings().defaultStockLocation || 'Main Store').trim();
  const before = existing ? getReceipt(existing.id) : null;

  tx(() => {
    const receiptNo = (input.receipt_no && input.receipt_no.trim()) || existing?.receipt_no || nextNumber('GRN', { date: input.received_at.slice(0, 10) });
    const dupNo = get('SELECT 1 AS x FROM material_receipts WHERE receipt_no = ? AND deleted_at IS NULL AND id <> ?', [receiptNo, excl]);
    if (dupNo) throw validation(`Receipt number ${receiptNo} already exists.`, { receipt_no: 'Duplicate' });
    const cols = [
      receiptNo, input.received_at, input.company_id, input.project_id, input.supplier_id, input.purchase_id || null, input.purchase_item_id || null,
      input.spec_id, spec.unit_code, vehicle || null, input.driver_name?.trim() || null, input.driver_mobile?.trim() || null, invoiceNo, challan, pass,
      ordered, received, accepted, rejected, input.rejection_reason?.trim() || null, location, input.remarks?.trim() || null,
    ];
    if (!existing) {
      run(
        `INSERT INTO material_receipts (receipt_no, received_at, company_id, project_id, supplier_id, purchase_id, purchase_item_id, spec_id, unit_code, vehicle_no, driver_name, driver_mobile,
           invoice_no, challan_no, royalty_pass_no, ordered_qty_milli, received_qty_milli, accepted_qty_milli, rejected_qty_milli, rejection_reason, location, remarks, id, status, created_at, updated_at)
         VALUES (${Array(26).fill('?').join(',')})`,
        [...cols, id, 'posted', now, now]
      );
    } else {
      run(
        `UPDATE material_receipts SET receipt_no=?, received_at=?, company_id=?, project_id=?, supplier_id=?, purchase_id=?, purchase_item_id=?, spec_id=?, unit_code=?, vehicle_no=?, driver_name=?, driver_mobile=?,
           invoice_no=?, challan_no=?, royalty_pass_no=?, ordered_qty_milli=?, received_qty_milli=?, accepted_qty_milli=?, rejected_qty_milli=?, rejection_reason=?, location=?, remarks=?, updated_at=? WHERE id=?`,
        [...cols, now, id]
      );
    }
    // weighbridge slips: replace set
    run('DELETE FROM weighbridge_records WHERE receipt_id = ?', [id]);
    for (const s of slips) {
      run(
        `INSERT INTO weighbridge_records (id, receipt_id, slip_no, weighbridge_name, slip_at, vehicle_no, weight_unit, gross_milli, tare_milli, net_milli, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [newId(), id, s.slip_no?.trim() || null, s.weighbridge_name?.trim() || null, s.slip_at || null, s.vehicle_no || null, s.weight_unit, s.gross_milli, s.tare_milli, s.net_milli, s.notes?.trim() || null]
      );
    }
    // stock: void whatever this receipt posted before, then post the current accepted/rejected quantities
    voidStockBySource('receipt', id, existing ? 'Receipt edited' : 'Receipt re-posted');
    const common = {
      txnDate: input.received_at.slice(0, 10),
      companyId: input.company_id,
      projectId: input.project_id,
      specId: input.spec_id!,
      location,
      unitCode: spec.unit_code,
      sourceType: 'receipt',
      sourceId: id,
    };
    if (accepted > 0) postStock({ ...common, type: 'inward', qtyMilli: accepted, notes: receiptNo });
    if (rejected > 0) postStock({ ...common, type: 'rejected', qtyMilli: rejected, reason: input.rejection_reason?.trim() || null, notes: receiptNo });
    // royalty pass linking by number
    run(`UPDATE royalty_passes SET receipt_id = NULL WHERE receipt_id = ? AND (? IS NULL OR upper(pass_no) <> upper(?))`, [id, pass, pass]);
    if (pass) run(`UPDATE royalty_passes SET receipt_id = ? WHERE upper(pass_no) = upper(?) AND deleted_at IS NULL AND (receipt_id IS NULL OR receipt_id = ?)`, [id, pass, id]);
    run(`INSERT OR IGNORE INTO supplier_projects (supplier_id, project_id) VALUES (?,?)`, [input.supplier_id, input.project_id]);
    const after = getReceipt(id);
    audit('receipt', id, existing ? 'update' : 'create', {
      summary: `${existing ? 'Updated' : 'Posted'} ${after.receipt_no}: ${received / 1000} ${spec.unit_code} received, ${accepted / 1000} accepted`,
      before,
      after,
      reason: opts.reason ?? null,
    });
  });
  indexEntity('receipt', id);
  ensureReceiptFolders(id);
  return { receipt: getReceipt(id), warnings: uniq, created: !existing };
}

function ensureReceiptFolders(id: string) {
  try {
    const r = get<any>(
      `SELECT c.folder_path, s.name AS sname, s.folder_name, v.category_name, v.material_name, v.size_grade FROM material_receipts r
       JOIN companies c ON c.id = r.company_id JOIN suppliers s ON s.id = r.supplier_id JOIN v_specs v ON v.id = r.spec_id WHERE r.id = ?`,
      [id]
    );
    if (!r?.folder_path) return;
    if (!fs.existsSync(r.folder_path)) fs.mkdirSync(r.folder_path, { recursive: true });
    ensureSupplierMaterialFolders(r.folder_path, r.category_name, r.material_name, r.size_grade, r.folder_name || r.sname, getSettings().supplierFolderTemplate);
  } catch (e) {
    log.warn('Could not create receipt folders', e);
  }
}

export function cancelReceipt(id: string, reason: string) {
  if (!reason || !reason.trim()) throw validation('A reason is required to cancel a receipt.', { reason: 'Required' });
  const r = get<any>('SELECT * FROM material_receipts WHERE id = ?', [id]);
  if (!r) throw notFound('Receipt');
  if (r.status === 'cancelled') throw validation('Receipt is already cancelled.');
  tx(() => {
    run(`UPDATE material_receipts SET status='cancelled', cancel_reason=?, updated_at=? WHERE id=?`, [reason.trim(), nowIso(), id]);
    voidStockBySource('receipt', id, `Receipt cancelled: ${reason.trim()}`);
    run(`UPDATE royalty_passes SET receipt_id = NULL WHERE receipt_id = ?`, [id]);
    audit('receipt', id, 'cancel', { summary: `Cancelled ${r.receipt_no}; stock reversed`, reason, before: r });
  });
  indexEntity('receipt', id);
  return getReceipt(id);
}
