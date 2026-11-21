import { all, get, run, scalar } from '../db/core';
import { nowIso } from '../db/util';
import { notFound } from '../errors';

/**
 * Supplier money model — three separate numbers, never mixed:
 *   BILLED   = sum of live, non-rejected invoices (what the supplier says we owe)
 *   SETTLED  = payments + advances + credit notes recorded against the supplier
 *   OUTSTANDING = BILLED − SETTLED   (negative => we are in advance to the supplier)
 * Everything is calculated from recorded transactions; nothing is stored as a running balance.
 */
const LIVE_INVOICE = `i.deleted_at IS NULL AND i.status = 'active' AND i.approval_status <> 'rejected'`;
const LIVE_PAYMENT = `p.deleted_at IS NULL AND p.status = 'active'`;

export interface SupplierBalance {
  billed_paise: number;
  paid_paise: number;
  advance_paise: number;
  credit_note_paise: number;
  settled_paise: number;
  outstanding_paise: number;
  unapplied_advance_paise: number;
}

export function supplierBalance(supplierId: string, filters: { companyId?: string | null; projectId?: string | null; asOf?: string | null } = {}): SupplierBalance {
  const ip: any[] = [supplierId];
  let iw = '';
  const pp: any[] = [supplierId];
  let pw = '';
  if (filters.companyId) (iw += ' AND i.company_id = ?', ip.push(filters.companyId), pw += ' AND p.company_id = ?', pp.push(filters.companyId));
  if (filters.projectId) (iw += ' AND i.project_id = ?', ip.push(filters.projectId), pw += ' AND p.project_id = ?', pp.push(filters.projectId));
  if (filters.asOf) (iw += ' AND i.invoice_date <= ?', ip.push(filters.asOf), pw += ' AND p.payment_date <= ?', pp.push(filters.asOf));
  const billed = scalar<number>(`SELECT COALESCE(SUM(i.total_paise),0) FROM invoices i WHERE i.supplier_id = ? AND ${LIVE_INVOICE}${iw}`, ip) ?? 0;
  const byKind = all<{ kind: string; s: number }>(`SELECT p.kind, COALESCE(SUM(p.amount_paise),0) AS s FROM supplier_payments p WHERE p.supplier_id = ? AND ${LIVE_PAYMENT}${pw} GROUP BY p.kind`, pp);
  const k = (n: string) => byKind.find((r) => r.kind === n)?.s ?? 0;
  const paid = k('payment');
  const adv = k('advance');
  const cn = k('credit_note');
  const settled = paid + adv + cn;
  const outstanding = billed - settled;
  return {
    billed_paise: billed,
    paid_paise: paid,
    advance_paise: adv,
    credit_note_paise: cn,
    settled_paise: settled,
    outstanding_paise: outstanding,
    unapplied_advance_paise: outstanding < 0 ? -outstanding : 0,
  };
}

/** Recompute an invoice's payment status from payments linked to it. */
export function refreshInvoicePayment(invoiceId: string | null | undefined) {
  if (!invoiceId) return;
  const inv = get<any>('SELECT id, total_paise, purchase_id FROM invoices WHERE id = ?', [invoiceId]);
  if (!inv) return;
  const paid = scalar<number>(`SELECT COALESCE(SUM(p.amount_paise),0) FROM supplier_payments p WHERE p.invoice_id = ? AND ${LIVE_PAYMENT}`, [invoiceId]) ?? 0;
  const status = paid <= 0 ? 'unpaid' : paid >= inv.total_paise ? 'paid' : 'partial';
  run('UPDATE invoices SET payment_status = ?, updated_at = ? WHERE id = ?', [status, nowIso(), invoiceId]);
  if (inv.purchase_id) {
    // purchase payment status follows its invoices (when there are any)
    const invs = all<any>(`SELECT payment_status FROM invoices i WHERE i.purchase_id = ? AND ${LIVE_INVOICE}`, [inv.purchase_id]);
    if (invs.length) {
      const ps = invs.every((x) => x.payment_status === 'paid') ? 'paid' : invs.some((x) => x.payment_status !== 'unpaid') ? 'partial' : 'unpaid';
      run('UPDATE purchase_orders SET payment_status = ?, updated_at = ? WHERE id = ?', [ps, nowIso(), inv.purchase_id]);
    }
  }
}

export interface LedgerLine {
  date: string;
  kind: 'invoice' | 'payment' | 'advance' | 'credit_note';
  ref: string;
  entity_type: string;
  entity_id: string;
  description: string;
  project_name: string | null;
  debit_paise: number; // reduces what we owe
  credit_paise: number; // increases what we owe
  balance_paise: number;
  status: string | null;
}

/** Chronological supplier ledger with running balance (positive balance = payable). */
export function supplierLedger(supplierId: string, f: { companyId?: string | null; projectId?: string | null; from?: string | null; to?: string | null } = {}) {
  const sup = get<any>('SELECT id, name, code, gst_no, mobile FROM suppliers WHERE id = ?', [supplierId]);
  if (!sup) throw notFound('Supplier');
  const ip: any[] = [supplierId];
  let iw = '';
  const pp: any[] = [supplierId];
  let pw = '';
  if (f.companyId) (iw += ' AND i.company_id = ?', ip.push(f.companyId), pw += ' AND p.company_id = ?', pp.push(f.companyId));
  if (f.projectId) (iw += ' AND i.project_id = ?', ip.push(f.projectId), pw += ' AND p.project_id = ?', pp.push(f.projectId));
  const invs = all<any>(
    `SELECT i.*, pr.name AS project_name FROM invoices i LEFT JOIN projects pr ON pr.id = i.project_id WHERE i.supplier_id = ? AND ${LIVE_INVOICE}${iw}`,
    ip
  );
  const pays = all<any>(
    `SELECT p.*, pr.name AS project_name, inv.invoice_no AS invoice_no FROM supplier_payments p LEFT JOIN projects pr ON pr.id = p.project_id
     LEFT JOIN invoices inv ON inv.id = p.invoice_id WHERE p.supplier_id = ? AND ${LIVE_PAYMENT}${pw}`,
    pp
  );
  type Raw = Omit<LedgerLine, 'balance_paise'> & { sortKey: string };
  const raw: Raw[] = [
    ...invs.map<Raw>((i) => ({
      date: i.invoice_date,
      kind: 'invoice',
      ref: i.invoice_no,
      entity_type: 'invoice',
      entity_id: i.id,
      description: `Invoice ${i.invoice_no}${i.approval_status !== 'approved' ? ` (${i.approval_status})` : ''}`,
      project_name: i.project_name,
      debit_paise: 0,
      credit_paise: i.total_paise,
      status: i.payment_status,
      sortKey: `${i.invoice_date}|0|${i.created_at}`,
    })),
    ...pays.map<Raw>((p) => ({
      date: p.payment_date,
      kind: p.kind,
      ref: p.reference_no || '',
      entity_type: 'payment',
      entity_id: p.id,
      description: `${p.kind === 'advance' ? 'Advance' : p.kind === 'credit_note' ? 'Credit note' : 'Payment'}${p.mode ? ' · ' + p.mode.toUpperCase() : ''}${p.invoice_no ? ' · against ' + p.invoice_no : ''}`,
      project_name: p.project_name,
      debit_paise: p.amount_paise,
      credit_paise: 0,
      status: null,
      sortKey: `${p.payment_date}|1|${p.created_at}`,
    })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  let bal = 0;
  const lines: LedgerLine[] = [];
  let opening = 0;
  for (const r of raw) {
    bal += r.credit_paise - r.debit_paise;
    if (f.from && r.date < f.from) {
      opening = bal;
      continue;
    }
    if (f.to && r.date > f.to) continue;
    const { sortKey, ...rest } = r;
    void sortKey;
    lines.push({ ...rest, balance_paise: bal });
  }
  const totalBilled = lines.reduce((a, l) => a + l.credit_paise, 0);
  const totalSettled = lines.reduce((a, l) => a + l.debit_paise, 0);
  return { supplier: sup, opening_paise: opening, lines, total_billed_paise: totalBilled, total_settled_paise: totalSettled, closing_paise: opening + totalBilled - totalSettled };
}

/** Everything the supplier profile screen needs. */
export function supplierProfile(supplierId: string) {
  const supplier = get<any>('SELECT * FROM suppliers WHERE id = ?', [supplierId]);
  if (!supplier) throw notFound('Supplier');
  const balance = supplierBalance(supplierId);
  const materials = all<any>(
    `SELECT sm.id, sm.spec_id, sm.rate_paise, sm.tax_bp, sm.active, sm.notes, v.label AS spec_label, v.unit_code, v.category_name
     FROM supplier_materials sm JOIN v_specs v ON v.id = sm.spec_id WHERE sm.supplier_id = ? AND sm.deleted_at IS NULL ORDER BY v.category_name, v.label`,
    [supplierId]
  );
  const purchasedByMaterial = all<any>(
    `SELECT v.label AS spec_label, i.unit_code, SUM(i.qty_milli) AS ordered_milli, SUM(i.total_paise) AS amount_paise, COUNT(DISTINCT po.id) AS orders
     FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id JOIN v_specs v ON v.id = i.spec_id
     WHERE po.supplier_id = ? AND po.deleted_at IS NULL AND po.status <> 'cancelled' GROUP BY i.spec_id, i.unit_code ORDER BY v.label`,
    [supplierId]
  );
  const receivedByMaterial = all<any>(
    `SELECT v.label AS spec_label, r.unit_code, SUM(r.received_qty_milli) AS received_milli, SUM(r.accepted_qty_milli) AS accepted_milli, SUM(r.rejected_qty_milli) AS rejected_milli, COUNT(*) AS deliveries
     FROM material_receipts r JOIN v_specs v ON v.id = r.spec_id WHERE r.supplier_id = ? AND r.deleted_at IS NULL AND r.status = 'posted' GROUP BY r.spec_id, r.unit_code ORDER BY v.label`,
    [supplierId]
  );
  const byMaterial = new Map<string, any>();
  for (const p of purchasedByMaterial) byMaterial.set(`${p.spec_label}|${p.unit_code}`, { ...p, received_milli: 0, accepted_milli: 0, rejected_milli: 0, deliveries: 0 });
  for (const r of receivedByMaterial) {
    const k = `${r.spec_label}|${r.unit_code}`;
    byMaterial.set(k, { spec_label: r.spec_label, unit_code: r.unit_code, ordered_milli: 0, amount_paise: 0, orders: 0, ...(byMaterial.get(k) ?? {}), ...r });
  }
  const supply = [...byMaterial.values()].map((m) => ({ ...m, pending_milli: Math.max((m.ordered_milli || 0) - (m.received_milli || 0), 0) }));
  const byProject = all<any>(
    `SELECT pr.id AS project_id, pr.name AS project_name, c.name AS company_name,
            (SELECT COALESCE(SUM(po.total_paise),0) FROM purchase_orders po WHERE po.supplier_id = ? AND po.project_id = pr.id AND po.deleted_at IS NULL AND po.status <> 'cancelled') AS purchased_paise,
            (SELECT COUNT(*) FROM material_receipts r WHERE r.supplier_id = ? AND r.project_id = pr.id AND r.deleted_at IS NULL AND r.status = 'posted') AS deliveries,
            (SELECT COALESCE(SUM(i.total_paise),0) FROM invoices i WHERE i.supplier_id = ? AND i.project_id = pr.id AND ${LIVE_INVOICE}) AS billed_paise
     FROM projects pr JOIN companies c ON c.id = pr.company_id
     WHERE pr.id IN (SELECT project_id FROM supplier_projects WHERE supplier_id = ?) ORDER BY pr.name`,
    [supplierId, supplierId, supplierId, supplierId]
  );
  const purchases = all<any>(
    `SELECT po.id, po.po_no, po.purchase_date, po.total_paise, po.payment_status, po.status, pr.name AS project_name FROM purchase_orders po JOIN projects pr ON pr.id = po.project_id
     WHERE po.supplier_id = ? AND po.deleted_at IS NULL ORDER BY po.purchase_date DESC LIMIT 100`,
    [supplierId]
  );
  const invoices = all<any>(
    `SELECT i.id, i.invoice_no, i.invoice_date, i.total_paise, i.payment_status, i.approval_status, i.verification_status FROM invoices i
     WHERE i.supplier_id = ? AND i.deleted_at IS NULL ORDER BY i.invoice_date DESC LIMIT 100`,
    [supplierId]
  );
  const royalty = all<any>(
    `SELECT id, pass_no, vehicle_no, dispatch_at, net_milli, weight_unit, verification_status FROM royalty_passes WHERE supplier_id = ? AND deleted_at IS NULL ORDER BY dispatch_at DESC LIMIT 100`,
    [supplierId]
  );
  const payments = all<any>(
    `SELECT id, payment_date, kind, amount_paise, mode, reference_no, status FROM supplier_payments WHERE supplier_id = ? AND deleted_at IS NULL ORDER BY payment_date DESC LIMIT 100`,
    [supplierId]
  );
  const totals = {
    purchased_paise: scalar<number>(`SELECT COALESCE(SUM(total_paise),0) FROM purchase_orders WHERE supplier_id = ? AND deleted_at IS NULL AND status <> 'cancelled'`, [supplierId]) ?? 0,
    purchase_count: scalar<number>(`SELECT COUNT(*) FROM purchase_orders WHERE supplier_id = ? AND deleted_at IS NULL AND status <> 'cancelled'`, [supplierId]) ?? 0,
    delivery_count: scalar<number>(`SELECT COUNT(*) FROM material_receipts WHERE supplier_id = ? AND deleted_at IS NULL AND status = 'posted'`, [supplierId]) ?? 0,
  };
  return { supplier, balance, totals, materials, supply, by_project: byProject, purchases, invoices, payments, royalty };
}

/** Invoices that are billed but not fully paid, oldest first (feeds the outstanding bills report + dashboard). */
export function outstandingInvoices(filters: { companyId?: string | null; projectId?: string | null; supplierId?: string | null } = {}) {
  const where = [`${LIVE_INVOICE}`, `i.payment_status <> 'paid'`];
  const params: any[] = [];
  if (filters.companyId) (where.push('i.company_id = ?'), params.push(filters.companyId));
  if (filters.projectId) (where.push('i.project_id = ?'), params.push(filters.projectId));
  if (filters.supplierId) (where.push('i.supplier_id = ?'), params.push(filters.supplierId));
  return all<any>(
    `SELECT i.id, i.invoice_no, i.invoice_date, i.due_date, i.total_paise, i.payment_status, i.approval_status, i.verification_status, s.name AS supplier_name, s.id AS supplier_id,
            c.name AS company_name, pr.name AS project_name,
            COALESCE((SELECT SUM(p.amount_paise) FROM supplier_payments p WHERE p.invoice_id = i.id AND ${LIVE_PAYMENT}),0) AS paid_paise
     FROM invoices i JOIN suppliers s ON s.id = i.supplier_id JOIN companies c ON c.id = i.company_id LEFT JOIN projects pr ON pr.id = i.project_id
     WHERE ${where.join(' AND ')} ORDER BY i.invoice_date ASC`,
    params
  ).map((r) => ({ ...r, balance_paise: r.total_paise - r.paid_paise }));
}

/** Total outstanding across all suppliers (sum of per-supplier balances; advances reduce the total correctly). */
export function totalOutstanding(filters: { companyId?: string | null } = {}): number {
  const ids = all<{ id: string }>(`SELECT id FROM suppliers WHERE deleted_at IS NULL`);
  let sum = 0;
  for (const s of ids) {
    const b = supplierBalance(s.id, { companyId: filters.companyId });
    sum += Math.max(b.outstanding_paise, 0);
  }
  return sum;
}
