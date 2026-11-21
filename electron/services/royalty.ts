import { all, get } from '../db/core';
import { convertMilli, UnitDef } from '../../src/shared/units';
import { getSettings } from './settings';

const unitMap = (): Map<string, UnitDef> => new Map(all<UnitDef>('SELECT * FROM units').map((u) => [u.code, u]));

export interface RoyaltyFilters {
  companyId?: string | null;
  projectId?: string | null;
  supplierId?: string | null;
  from?: string | null;
  to?: string | null;
}

/**
 * Compare the quantity on royalty / transit passes with what was actually received.
 *  - receipt-level: Σ pass net (converted to the receipt's unit) vs received quantity
 *  - passes not linked to any receipt
 * Status is purely arithmetic against your configured tolerance; it is NOT a government verification.
 */
export function royaltyReconciliation(f: RoyaltyFilters = {}) {
  const units = unitMap();
  const tol = getSettings().shortToleranceBp;
  const where = ['rp.deleted_at IS NULL'];
  const params: any[] = [];
  if (f.companyId) (where.push('(rp.company_id = ? OR r.company_id = ?)'), params.push(f.companyId, f.companyId));
  if (f.projectId) (where.push('(rp.project_id = ? OR r.project_id = ?)'), params.push(f.projectId, f.projectId));
  if (f.supplierId) (where.push('(rp.supplier_id = ? OR r.supplier_id = ?)'), params.push(f.supplierId, f.supplierId));
  if (f.from) (where.push('substr(COALESCE(rp.dispatch_at, r.received_at),1,10) >= ?'), params.push(f.from));
  if (f.to) (where.push('substr(COALESCE(rp.dispatch_at, r.received_at),1,10) <= ?'), params.push(f.to));

  const passes = all<any>(
    `SELECT rp.*, r.receipt_no, r.received_qty_milli, r.accepted_qty_milli, r.unit_code AS receipt_unit, r.vehicle_no AS receipt_vehicle,
            s.name AS supplier_name, pr.name AS project_name
     FROM royalty_passes rp LEFT JOIN material_receipts r ON r.id = rp.receipt_id AND r.deleted_at IS NULL AND r.status = 'posted'
     LEFT JOIN suppliers s ON s.id = rp.supplier_id LEFT JOIN projects pr ON pr.id = COALESCE(rp.project_id, r.project_id)
     WHERE ${where.join(' AND ')} ORDER BY COALESCE(rp.dispatch_at, r.received_at) DESC`,
    params
  );

  const byReceipt = new Map<string, any>();
  const unlinked: any[] = [];
  for (const p of passes) {
    if (!p.receipt_id || !p.receipt_no) {
      unlinked.push({ ...p, status: 'no_receipt' });
      continue;
    }
    let g = byReceipt.get(p.receipt_id);
    if (!g) {
      g = {
        receipt_id: p.receipt_id,
        receipt_no: p.receipt_no,
        supplier_name: p.supplier_name,
        project_name: p.project_name,
        vehicle_no: p.receipt_vehicle,
        unit_code: p.receipt_unit,
        received_milli: p.received_qty_milli,
        pass_total_milli: 0,
        comparable: true,
        passes: [] as any[],
      };
      byReceipt.set(p.receipt_id, g);
    }
    g.passes.push({ id: p.id, pass_no: p.pass_no, net_milli: p.net_milli, weight_unit: p.weight_unit, verification_status: p.verification_status });
    if (p.net_milli === null || p.net_milli === undefined) {
      g.comparable = false;
    } else {
      const c = convertMilli(p.net_milli, units.get(p.weight_unit), units.get(p.receipt_unit));
      if (c === null) g.comparable = false;
      else g.pass_total_milli += c;
    }
  }
  const receipts = [...byReceipt.values()].map((g) => {
    if (!g.comparable) return { ...g, difference_milli: null, status: 'not_comparable' };
    const diff = g.received_milli - g.pass_total_milli; // + => received more than the pass allows
    const allowed = Math.round((g.pass_total_milli * tol) / 10000);
    const status = Math.abs(diff) <= allowed ? 'matched' : diff > 0 ? 'received_more' : 'received_less';
    return { ...g, difference_milli: diff, status };
  });
  const summary = {
    receipts_compared: receipts.length,
    matched: receipts.filter((r) => r.status === 'matched').length,
    mismatched: receipts.filter((r) => r.status === 'received_more' || r.status === 'received_less').length,
    not_comparable: receipts.filter((r) => r.status === 'not_comparable').length,
    unlinked_passes: unlinked.length,
  };
  return { summary, receipts, unlinked };
}

/** Suggest a royalty amount from YOUR effective-dated rate table. Returns null when no rate applies. */
export function suggestRoyalty(mineral: string, grade: string | null, dateISO: string, netMilli: number, weightUnit: string) {
  const rate = get<any>(
    `SELECT * FROM royalty_rates WHERE deleted_at IS NULL AND lower(mineral_name) = lower(?) AND (grade IS NULL OR grade = '' OR lower(grade) = lower(?))
       AND effective_from <= ? AND (effective_to IS NULL OR effective_to = '' OR effective_to >= ?)
     ORDER BY (CASE WHEN grade IS NULL OR grade = '' THEN 1 ELSE 0 END), effective_from DESC LIMIT 1`,
    [mineral, grade ?? '', dateISO.slice(0, 10), dateISO.slice(0, 10)]
  );
  if (!rate) return null;
  const units = unitMap();
  const q = convertMilli(netMilli, units.get(weightUnit), units.get(rate.unit_code));
  if (q === null) return { rate, amount_paise: null, note: `Cannot convert ${weightUnit} to ${rate.unit_code}.` };
  // paise = qty(milli) * rate(paise)/1000
  const amount = Math.round((q * rate.rate_paise) / 1000);
  return { rate, amount_paise: amount, note: `Rate ${(rate.rate_paise / 100).toFixed(2)} per ${rate.unit_code} effective ${rate.effective_from}${rate.reference_note ? ' (' + rate.reference_note + ')' : ''}` };
}
