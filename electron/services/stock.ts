import { all, get, run, scalar, tx } from '../db/core';
import { audit, newId, nowIso } from '../db/util';
import { ApiError, needsConfirm, validation } from '../errors';
import { stockSign } from '../../src/shared/modules';
import { mulQtyRate } from '../../src/shared/num';

/**
 * Transaction-based inventory.
 *   Closing = Opening + Accepted inward + Returns − Consumption − Outward ± Adjustments
 * Ordered quantity never enters stock; rejected quantity is recorded (type "rejected") but has zero effect on balance.
 * Stock is keyed by Company + Project + Specification + Location.
 */
export interface StockPost {
  txnDate: string;
  companyId: string;
  projectId: string;
  specId: string;
  location: string;
  type: 'opening' | 'inward' | 'return' | 'outward' | 'consumption' | 'adjustment' | 'rejected';
  /** magnitude (positive); for adjustments a signed number: + adds, − removes */
  qtyMilli: number;
  unitCode: string;
  sourceType?: string | null;
  sourceId?: string | null;
  reason?: string | null;
  notes?: string | null;
}

export function postStock(p: StockPost): string {
  if (!Number.isInteger(p.qtyMilli)) throw validation('Stock quantity must be a whole number of milli-units.');
  if (p.type !== 'adjustment' && p.qtyMilli < 0) throw validation('Quantity cannot be negative.');
  if (p.qtyMilli === 0) throw validation('Quantity must be greater than zero.');
  const signed = p.type === 'adjustment' ? p.qtyMilli : stockSign(p.type) * p.qtyMilli;
  const id = newId();
  run(
    `INSERT INTO stock_transactions (id, txn_date, company_id, project_id, spec_id, location, txn_type, qty_milli, signed_qty_milli, unit_code, source_type, source_id, reason, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, p.txnDate.slice(0, 10), p.companyId, p.projectId, p.specId, p.location || 'Main Store', p.type, Math.abs(p.qtyMilli), signed, p.unitCode, p.sourceType ?? null, p.sourceId ?? null, p.reason ?? null, p.notes ?? null]
  );
  return id;
}

/** Void (not delete) every live transaction posted by a source record. History is preserved. */
export function voidStockBySource(sourceType: string, sourceId: string, reason: string) {
  run(`UPDATE stock_transactions SET voided_at = ?, void_reason = ?, updated_at = ? WHERE source_type = ? AND source_id = ? AND voided_at IS NULL`, [
    nowIso(),
    reason,
    nowIso(),
    sourceType,
    sourceId,
  ]);
}

export function stockBalance(companyId: string, projectId: string, specId: string, location?: string, excludeSource?: { type: string; id: string }): number {
  const params: any[] = [companyId, projectId, specId];
  let sql = `SELECT COALESCE(SUM(signed_qty_milli),0) AS b FROM stock_transactions WHERE voided_at IS NULL AND company_id = ? AND project_id = ? AND spec_id = ?`;
  if (location) {
    sql += ' AND location = ?';
    params.push(location);
  }
  if (excludeSource) {
    sql += ' AND NOT (source_type = ? AND source_id = ?)';
    params.push(excludeSource.type, excludeSource.id);
  }
  return scalar<number>(sql, params) ?? 0;
}

export interface StockFilters {
  companyId?: string | null;
  projectId?: string | null;
  specId?: string | null;
  supplierId?: string | null;
  location?: string | null;
  from?: string | null;
  to?: string | null;
}

export interface StockRow {
  company_id: string;
  company_name: string;
  project_id: string;
  project_name: string;
  spec_id: string;
  spec_label: string;
  category_name: string;
  location: string;
  unit_code: string;
  opening_milli: number;
  inward_milli: number;
  return_milli: number;
  outward_milli: number;
  consumption_milli: number;
  adjustment_milli: number;
  rejected_milli: number;
  closing_milli: number;
  min_stock_milli: number | null;
  avg_rate_paise: number | null;
  value_paise: number | null;
  low: boolean;
}

/**
 * Stock register. With from/to: opening = balance before `from`, movements inside the period, closing as of `to`.
 * Without dates: all-time movements, opening = recorded opening-stock entries.
 */
export function stockRegister(f: StockFilters = {}): StockRow[] {
  const where: string[] = ['st.voided_at IS NULL'];
  const params: any[] = [];
  if (f.companyId) (where.push('st.company_id = ?'), params.push(f.companyId));
  if (f.projectId) (where.push('st.project_id = ?'), params.push(f.projectId));
  if (f.specId) (where.push('st.spec_id = ?'), params.push(f.specId));
  if (f.location) (where.push('st.location = ?'), params.push(f.location));
  if (f.to) (where.push('st.txn_date <= ?'), params.push(f.to));

  const from = f.from || null;
  const openingExpr = from
    ? `SUM(CASE WHEN st.txn_date < ? THEN st.signed_qty_milli ELSE 0 END)`
    : `SUM(CASE WHEN st.txn_type = 'opening' THEN st.signed_qty_milli ELSE 0 END)`;
  const inPeriod = from ? `st.txn_date >= ?` : `1=1`;
  const selParams: any[] = [];
  const pushFrom = () => from && selParams.push(from);

  // order of placeholders follows order in the SELECT text
  const parts: string[] = [];
  parts.push(openingExpr + ' AS opening_milli');
  pushFrom();
  const movement = (type: string, alias: string, col = 'st.signed_qty_milli') => {
    parts.push(`SUM(CASE WHEN st.txn_type = '${type}' AND ${inPeriod} THEN ${col} ELSE 0 END) AS ${alias}`);
    pushFrom();
  };
  movement('inward', 'inward_milli');
  movement('return', 'return_milli');
  movement('outward', 'outward_milli', 'st.qty_milli');
  movement('consumption', 'consumption_milli', 'st.qty_milli');
  movement('adjustment', 'adjustment_milli');
  movement('rejected', 'rejected_milli', 'st.qty_milli');
  // In "all-time" mode opening entries are the opening column; in period mode, opening entries that fall inside the period count as movements of the opening balance
  parts.push('SUM(st.signed_qty_milli) AS closing_milli');
  if (from) {
    parts.push(`SUM(CASE WHEN st.txn_type = 'opening' AND st.txn_date >= ? THEN st.signed_qty_milli ELSE 0 END) AS opening_in_period_milli`);
    selParams.push(from);
  }

  const sql = `
    SELECT st.company_id, c.name AS company_name, st.project_id, p.name AS project_name, st.spec_id, v.label AS spec_label,
           v.category_name, st.location, v.unit_code, v.min_stock_milli, ${parts.join(', ')}
    FROM stock_transactions st
    JOIN companies c ON c.id = st.company_id
    JOIN projects p ON p.id = st.project_id
    JOIN v_specs v ON v.id = st.spec_id
    WHERE ${where.join(' AND ')}
    GROUP BY st.company_id, st.project_id, st.spec_id, st.location
    ORDER BY c.name, p.name, v.category_name, v.label, st.location`;
  const rows = all<any>(sql, [...selParams, ...params]);

  return rows.map((r) => {
    const openingInPeriod = r.opening_in_period_milli || 0;
    const row: StockRow = {
      company_id: r.company_id,
      company_name: r.company_name,
      project_id: r.project_id,
      project_name: r.project_name,
      spec_id: r.spec_id,
      spec_label: r.spec_label,
      category_name: r.category_name,
      location: r.location,
      unit_code: r.unit_code,
      opening_milli: (r.opening_milli || 0) + openingInPeriod,
      inward_milli: r.inward_milli || 0,
      return_milli: r.return_milli || 0,
      outward_milli: r.outward_milli || 0,
      consumption_milli: r.consumption_milli || 0,
      adjustment_milli: r.adjustment_milli || 0,
      rejected_milli: r.rejected_milli || 0,
      closing_milli: r.closing_milli || 0,
      min_stock_milli: r.min_stock_milli ?? null,
      avg_rate_paise: null,
      value_paise: null,
      low: false,
    };
    const rate = averagePurchaseRate(row.company_id, row.project_id, row.spec_id);
    row.avg_rate_paise = rate;
    row.value_paise = rate !== null ? mulQtyRate(Math.max(row.closing_milli, 0), rate) : null;
    return row;
  });
}

/** Weighted-average purchase rate (before tax) over live purchase orders for the key. null when never purchased. */
export function averagePurchaseRate(companyId: string, projectId: string, specId: string): number | null {
  const r = get<{ amt: number | null; qty: number | null }>(
    `SELECT SUM(i.subtotal_paise) AS amt, SUM(i.qty_milli) AS qty
     FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id
     WHERE po.deleted_at IS NULL AND po.status <> 'cancelled' AND po.company_id = ? AND po.project_id = ? AND i.spec_id = ?`,
    [companyId, projectId, specId]
  );
  if (!r || !r.qty || r.amt === null) return null;
  return Math.round((r.amt * 1000) / r.qty);
}

export interface LedgerRow {
  id: string;
  txn_date: string;
  txn_type: string;
  qty_milli: number;
  signed_qty_milli: number;
  balance_milli: number;
  unit_code: string;
  location: string;
  source_type: string | null;
  source_id: string | null;
  reason: string | null;
  notes: string | null;
  voided_at: string | null;
  created_at: string;
  source_label: string | null;
}

/** Transaction history for one stock key with a running balance (voided entries shown but not counted). */
export function stockLedger(companyId: string, projectId: string, specId: string, location?: string | null): LedgerRow[] {
  const params: any[] = [companyId, projectId, specId];
  let sql = `SELECT * FROM stock_transactions WHERE company_id = ? AND project_id = ? AND spec_id = ?`;
  if (location) {
    sql += ' AND location = ?';
    params.push(location);
  }
  sql += ' ORDER BY txn_date ASC, created_at ASC';
  let bal = 0;
  return all<any>(sql, params).map((t) => {
    if (!t.voided_at) bal += t.signed_qty_milli;
    let label: string | null = null;
    if (t.source_type === 'receipt') label = (get<any>('SELECT receipt_no FROM material_receipts WHERE id = ?', [t.source_id]) || {}).receipt_no ?? null;
    else if (t.source_type === 'consumption') label = 'Consumption entry';
    return { ...t, balance_milli: bal, source_label: label } as LedgerRow;
  });
}

export function lowStockAlerts(): Array<{ project_id: string; project_name: string; company_name: string; spec_id: string; spec_label: string; closing_milli: number; min_stock_milli: number; unit_code: string }> {
  return all<any>(
    `SELECT st.project_id, p.name AS project_name, c.name AS company_name, st.spec_id, v.label AS spec_label,
            SUM(st.signed_qty_milli) AS closing_milli, v.min_stock_milli, v.unit_code
     FROM stock_transactions st
     JOIN projects p ON p.id = st.project_id AND p.deleted_at IS NULL AND p.status IN ('active','planned')
     JOIN companies c ON c.id = st.company_id
     JOIN v_specs v ON v.id = st.spec_id AND v.deleted_at IS NULL AND v.active = 1
     WHERE st.voided_at IS NULL AND v.min_stock_milli IS NOT NULL AND v.min_stock_milli > 0
     GROUP BY st.project_id, st.spec_id
     HAVING SUM(st.signed_qty_milli) < v.min_stock_milli
     ORDER BY p.name, v.label`
  );
}

export interface ManualStockInput {
  txnDate: string;
  companyId: string;
  projectId: string;
  specId: string;
  location?: string;
  type: 'opening' | 'return' | 'outward' | 'adjustment';
  qtyMilli: number;
  reason?: string;
  notes?: string;
  allowDuplicate?: boolean;
}

/** Manual stock entries (opening, return, outward/transfer, adjustment). Adjustments and outwards need a reason. */
export function postManualStock(input: ManualStockInput): string {
  if (!['opening', 'return', 'outward', 'adjustment'].includes(input.type)) throw validation('Unsupported stock entry type.');
  if (!input.txnDate) throw validation('Date is required.');
  if (!input.companyId || !input.projectId || !input.specId) throw validation('Company, project and material are required.');
  if (!Number.isInteger(input.qtyMilli) || input.qtyMilli === 0) throw validation('Enter a non-zero quantity.');
  if (input.type === 'adjustment' && !(input.reason && input.reason.trim())) throw validation('A reason is required for stock adjustments.', { reason: 'Required' });
  if (input.type === 'outward' && !(input.reason && input.reason.trim())) throw validation('A reason (e.g. transferred to another site) is required for outward entries.', { reason: 'Required' });
  if (input.type !== 'adjustment' && input.qtyMilli < 0) throw validation('Quantity must be positive.');

  const spec = get<any>('SELECT unit_code, label FROM v_specs WHERE id = ?', [input.specId]);
  if (!spec) throw validation('Selected material no longer exists.');
  const location = (input.location || 'Main Store').trim();

  const warnings: string[] = [];
  if (input.type === 'opening') {
    const n = scalar<number>(
      `SELECT COUNT(*) FROM stock_transactions WHERE txn_type='opening' AND voided_at IS NULL AND company_id=? AND project_id=? AND spec_id=? AND location=?`,
      [input.companyId, input.projectId, input.specId, location]
    );
    if (n) warnings.push(`An opening-stock entry already exists for ${spec.label} at ${location}. Add another only if this is a different opening quantity.`);
  }
  const signed = input.type === 'adjustment' ? input.qtyMilli : stockSign(input.type) * input.qtyMilli;
  if (signed < 0) {
    const bal = stockBalance(input.companyId, input.projectId, input.specId, location);
    if (bal + signed < 0) warnings.push(`This would make ${spec.label} stock at ${location} negative (available ${(bal / 1000).toFixed(3)} ${spec.unit_code}).`);
  }
  if (warnings.length && !input.allowDuplicate) needsConfirm(warnings);

  return tx(() => {
    const id = postStock({
      txnDate: input.txnDate,
      companyId: input.companyId,
      projectId: input.projectId,
      specId: input.specId,
      location,
      type: input.type,
      qtyMilli: input.qtyMilli,
      unitCode: spec.unit_code,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
    });
    audit('stock', id, 'create', { summary: `${input.type} ${input.qtyMilli / 1000} ${spec.unit_code} of ${spec.label}`, reason: input.reason });
    return id;
  });
}

/** Void a manual stock entry (system-posted entries are voided by editing/cancelling their source record). */
export function voidManualStock(id: string, reason: string) {
  if (!reason || !reason.trim()) throw validation('A reason is required to void a stock entry.', { reason: 'Required' });
  const t = get<any>('SELECT * FROM stock_transactions WHERE id = ?', [id]);
  if (!t) throw new ApiError('Stock entry not found.', 'NOT_FOUND');
  if (t.source_type) throw validation('This entry was posted by a purchase receipt or consumption record. Edit or cancel that record instead.');
  if (t.voided_at) throw validation('Entry is already voided.');
  tx(() => {
    run(`UPDATE stock_transactions SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?`, [nowIso(), reason.trim(), nowIso(), id]);
    audit('stock', id, 'void', { summary: `Voided ${t.txn_type} entry`, reason, before: t });
  });
}
