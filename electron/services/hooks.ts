import fs from 'fs';
import { all, get, run, scalar } from '../db/core';
import { audit, diffSummary, newId, nowIso } from '../db/util';
import { validation } from '../errors';
import { HOOKS, Hooks, Row } from './crud';
import { postStock, stockBalance, voidStockBySource } from './stock';
import { refreshInvoicePayment } from './billing';
import { ensureDirSync, ensureProjectFolders } from '../folderManager';
import { getSettings } from './settings';
import { folderSegment } from '../paths';
import { validateFormula } from '../../src/shared/formula';
import { formatQty, normalizeVehicle } from '../../src/shared/num';
import { measureQty } from '../../src/shared/modules';
import { indexEntity } from './search';
import { log } from '../logger';

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

function scopeCheck(merged: Row) {
  if (merged.company_id && merged.project_id) {
    const p = get<any>('SELECT company_id FROM projects WHERE id = ?', [merged.project_id]);
    if (p && p.company_id !== merged.company_id) throw validation('The selected project does not belong to the selected company.', { project_id: 'Wrong company' });
  }
}

function specUnit(specId: string): string {
  const s = get<any>('SELECT unit_code FROM v_specs WHERE id = ?', [specId]);
  if (!s) throw validation('Selected material no longer exists.');
  return s.unit_code;
}

const hooks: Record<string, Hooks> = {
  projects: {
    afterSave: (saved) => {
      try {
        const c = get<any>('SELECT folder_path FROM companies WHERE id = ?', [saved.company_id]);
        if (!c?.folder_path) return;
        ensureDirSync(c.folder_path);
        const dir = ensureProjectFolders(c.folder_path, saved.name, getSettings().projectFolderTemplate);
        run('UPDATE projects SET folder_path = ? WHERE id = ?', [dir, saved.id]);
      } catch (e) {
        log.warn('Project folder creation failed', e);
      }
    },
  },

  suppliers: {
    beforeSave: (clean, ctx) => {
      const m = ctx.merged;
      if (!ctx.existing) clean.folder_name = folderSegment(String(m.name || 'Supplier'), 'Supplier');
      if (m.gst_no && !GSTIN_RE.test(String(m.gst_no))) ctx.warnings.push(`GST number "${m.gst_no}" does not look like a valid 15-character GSTIN.`);
      if (m.pan_no && !PAN_RE.test(String(m.pan_no))) ctx.warnings.push(`PAN "${m.pan_no}" does not look like a valid PAN (AAAAA9999A).`);
      if (m.mobile && !/^[6-9]\d{9}$/.test(String(m.mobile).replace(/[\s+-]|^91/g, ''))) ctx.warnings.push(`Mobile "${m.mobile}" is not a 10-digit Indian mobile number.`);
      if (m.gst_no) {
        const d = get<any>('SELECT name FROM suppliers WHERE gst_no = ? AND deleted_at IS NULL AND id <> ?', [m.gst_no, ctx.existing?.id ?? '']);
        if (d) ctx.warnings.push(`GST number ${m.gst_no} is already used by supplier "${d.name}".`);
      }
      if (m.contract_start && m.contract_end && m.contract_end < m.contract_start) throw validation('Contract end date is before the start date.', { contract_end: 'Before start' });
    },
  },

  specs: {
    beforeSave: (clean, ctx) => {
      if (ctx.existing && clean.unit_code && clean.unit_code !== ctx.existing.unit_code) {
        const used =
          (scalar<number>('SELECT COUNT(*) FROM stock_transactions WHERE spec_id = ?', [ctx.existing.id]) ?? 0) +
          (scalar<number>('SELECT COUNT(*) FROM purchase_order_items WHERE spec_id = ?', [ctx.existing.id]) ?? 0) +
          (scalar<number>('SELECT COUNT(*) FROM material_receipts WHERE spec_id = ?', [ctx.existing.id]) ?? 0);
        if (used) throw validation('This specification already has purchases or stock in its current unit, so the unit cannot be changed. Create a new specification instead.', { unit_code: 'In use' });
      }
    },
    afterSave: (saved) => {
      // spec label feeds many search documents
      for (const r of all<{ id: string }>('SELECT id FROM purchase_orders po WHERE EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.po_id = po.id AND i.spec_id = ?)', [saved.id])) indexEntity('purchase', r.id);
    },
  },

  formulas: {
    beforeSave: (clean, ctx) => {
      const expr = String(ctx.merged.expression || '').trim();
      const err = validateFormula(expr);
      if (err) throw validation(`Formula is not valid: ${err}. Use L, W, D, N with + - * / ( ).`, { expression: err });
      clean.expression = expr.toUpperCase();
    },
  },

  invoices: {
    beforeSave: (clean, ctx) => {
      const m = ctx.merged;
      scopeCheck(m);
      // a blank amount means zero
      for (const k of ['subtotal_paise', 'tax_paise', 'other_paise']) if (m[k] === null || m[k] === undefined) (clean[k] = 0), (m[k] = 0);
      if (m.purchase_id) {
        const po = get<any>('SELECT supplier_id, po_no FROM purchase_orders WHERE id = ?', [m.purchase_id]);
        if (po && po.supplier_id !== m.supplier_id) throw validation('The selected purchase belongs to a different supplier.', { purchase_id: 'Wrong supplier' });
      }
      const dup = get<any>(
        `SELECT id FROM invoices WHERE supplier_id = ? AND lower(invoice_no) = lower(?) AND deleted_at IS NULL AND status = 'active' AND id <> ?`,
        [m.supplier_id, m.invoice_no, ctx.existing?.id ?? '']
      );
      if (dup) ctx.warnings.push(`Invoice ${m.invoice_no} is already recorded for this supplier. Saving again will create a duplicate.`);
      if (ctx.existing) {
        const paid = scalar<number>(`SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payments WHERE invoice_id = ? AND deleted_at IS NULL AND status = 'active'`, [ctx.existing.id]) ?? 0;
        const total = (m.subtotal_paise || 0) + (m.tax_paise || 0) + (m.other_paise || 0);
        if (paid > total) ctx.warnings.push('Payments already recorded against this invoice exceed the new invoice total.');
      }
    },
    afterSave: (saved) => {
      refreshInvoicePayment(saved.id);
      if (saved.purchase_id) run(`UPDATE purchase_orders SET invoice_no = COALESCE(NULLIF(invoice_no,''), ?) WHERE id = ?`, [saved.invoice_no, saved.purchase_id]);
    },
    beforeRemove: (row) => {
      const n = scalar<number>(`SELECT COUNT(*) FROM supplier_payments WHERE invoice_id = ? AND deleted_at IS NULL AND status = 'active'`, [row.id]) ?? 0;
      if (n) throw validation(`${n} payment(s) are recorded against this invoice. Cancel or move them first.`);
    },
  },

  payments: {
    beforeSave: (clean, ctx) => {
      const m = ctx.merged;
      scopeCheck(m);
      if (!(m.amount_paise > 0)) throw validation('Amount must be greater than zero.', { amount_paise: 'Required' });
      if (m.invoice_id) {
        const inv = get<any>('SELECT supplier_id, total_paise, invoice_no FROM invoices WHERE id = ?', [m.invoice_id]);
        if (!inv) throw validation('Selected invoice not found.');
        if (inv.supplier_id !== m.supplier_id) throw validation('The selected invoice belongs to a different supplier.', { invoice_id: 'Wrong supplier' });
        if (m.status !== 'cancelled') {
          const paid = scalar<number>(
            `SELECT COALESCE(SUM(amount_paise),0) FROM supplier_payments WHERE invoice_id = ? AND deleted_at IS NULL AND status = 'active' AND id <> ?`,
            [m.invoice_id, ctx.existing?.id ?? '']
          ) ?? 0;
          if (paid + m.amount_paise > inv.total_paise) ctx.warnings.push(`This takes total settlement of invoice ${inv.invoice_no} above its amount.`);
        }
      }
    },
    afterSave: (saved, ctx) => {
      refreshInvoicePayment(saved.invoice_id);
      if (ctx.existing?.invoice_id && ctx.existing.invoice_id !== saved.invoice_id) refreshInvoicePayment(ctx.existing.invoice_id);
    },
    afterRemove: (row) => refreshInvoicePayment(row.invoice_id),
    afterRestore: (row) => refreshInvoicePayment(row.invoice_id),
  },

  royalty: {
    beforeSave: (clean, ctx) => {
      const m = ctx.merged;
      scopeCheck(m);
      if (m.vehicle_no) clean.vehicle_no = normalizeVehicle(m.vehicle_no);
      if (m.gross_milli !== null && m.gross_milli !== undefined && m.tare_milli !== null && m.tare_milli !== undefined && m.tare_milli > m.gross_milli) {
        throw validation('Tare weight is more than gross weight.', { tare_milli: 'More than gross' });
      }
      const dup = get<any>(`SELECT id FROM royalty_passes WHERE upper(pass_no) = upper(?) AND deleted_at IS NULL AND id <> ?`, [m.pass_no, ctx.existing?.id ?? '']);
      if (dup) ctx.warnings.push(`Royalty pass number ${m.pass_no} is already recorded. A pass number should normally be used once.`);
      if (m.e_permit_no) {
        const d2 = get<any>(`SELECT pass_no FROM royalty_passes WHERE upper(e_permit_no) = upper(?) AND deleted_at IS NULL AND id <> ?`, [m.e_permit_no, ctx.existing?.id ?? '']);
        if (d2) ctx.warnings.push(`E-permit ${m.e_permit_no} is already recorded on pass ${d2.pass_no}.`);
      }
      if (m.dispatch_at && m.valid_from && String(m.dispatch_at) < String(m.valid_from)) ctx.warnings.push('Dispatch time is before the pass validity start.');
      if (m.dispatch_at && m.valid_to && String(m.dispatch_at) > String(m.valid_to)) ctx.warnings.push('Dispatch time is after the pass validity end.');
      if (m.receipt_id) {
        const r = get<any>('SELECT vehicle_no, supplier_id, receipt_no FROM material_receipts WHERE id = ?', [m.receipt_id]);
        if (r?.vehicle_no && m.vehicle_no && r.vehicle_no !== normalizeVehicle(m.vehicle_no)) ctx.warnings.push(`Vehicle ${normalizeVehicle(m.vehicle_no)} differs from vehicle ${r.vehicle_no} on ${r.receipt_no}.`);
      }
      if ((clean.verification_status ?? m.verification_status) === 'verified') {
        if (!m.verified_on) clean.verified_on = new Date().toISOString().slice(0, 10);
      }
    },
    afterSave: (saved) => {
      // Auto-link to the inward that already carries this pass number (the user can still change the link by hand).
      if (!saved.receipt_id && saved.pass_no) {
        const r = get<any>(
          `SELECT id FROM material_receipts WHERE upper(royalty_pass_no) = upper(?) AND deleted_at IS NULL AND status = 'posted' ORDER BY received_at DESC LIMIT 1`,
          [saved.pass_no]
        );
        if (r) run('UPDATE royalty_passes SET receipt_id = ? WHERE id = ?', [r.id, saved.id]);
      }
    },
  },

  consumption: {
    beforeSave: (clean, ctx) => {
      const m = ctx.merged;
      scopeCheck(m);
      clean.unit_code = specUnit(m.spec_id);
      const loc = m.stock_location || 'Main Store';
      clean.stock_location = loc;
      if (!(m.qty_milli > 0)) throw validation('Quantity must be greater than zero.', { qty_milli: 'Required' });
      const bal = stockBalance(m.company_id, m.project_id, m.spec_id, loc, ctx.existing ? { type: 'consumption', id: ctx.existing.id } : undefined);
      if (bal < m.qty_milli) {
        const s = get<any>('SELECT label FROM v_specs WHERE id = ?', [m.spec_id]);
        ctx.warnings.push(`Stock of ${s?.label} at ${loc} is only ${formatQty(Math.max(bal, 0), clean.unit_code)}; this entry uses ${formatQty(m.qty_milli, clean.unit_code)}. Stock would go negative.`);
      }
    },
    afterSave: (saved) => {
      voidStockBySource('consumption', saved.id, 'Consumption edited');
      postStock({
        txnDate: saved.usage_date,
        companyId: saved.company_id,
        projectId: saved.project_id,
        specId: saved.spec_id,
        location: saved.stock_location || 'Main Store',
        type: 'consumption',
        qtyMilli: saved.qty_milli,
        unitCode: saved.unit_code,
        sourceType: 'consumption',
        sourceId: saved.id,
        notes: saved.site_location || null,
      });
    },
    afterRemove: (row) => voidStockBySource('consumption', row.id, 'Consumption entry archived'),
    afterRestore: (row) => {
      voidStockBySource('consumption', row.id, 'reposted');
      postStock({
        txnDate: row.usage_date,
        companyId: row.company_id,
        projectId: row.project_id,
        specId: row.spec_id,
        location: row.stock_location || 'Main Store',
        type: 'consumption',
        qtyMilli: row.qty_milli,
        unitCode: row.unit_code,
        sourceType: 'consumption',
        sourceId: row.id,
      });
    },
  },

  consumptionPlans: {
    beforeSave: (clean, ctx) => {
      clean.unit_code = specUnit(ctx.merged.spec_id);
    },
  },

  progress: {
    beforeSave: (_clean, ctx) => scopeCheck(ctx.merged),
  },

  quality: {
    beforeSave: (_clean, ctx) => {
      scopeCheck(ctx.merged);
      const m = ctx.merged;
      if (m.limit_min !== null && m.limit_min !== undefined && m.limit_max !== null && m.limit_max !== undefined && m.limit_min > m.limit_max) {
        throw validation('Minimum limit is greater than the maximum limit.', { limit_min: 'Above maximum' });
      }
    },
  },

  measurement: {
    baseWhere: 't.superseded_at IS NULL',
    beforeSave: (clean, ctx) => {
      const m = ctx.merged;
      scopeCheck(m);
      let expr: string | null = null;
      if (m.formula_id) {
        const f = get<any>('SELECT expression, unit_code FROM quantity_formulas WHERE id = ?', [m.formula_id]);
        if (f) {
          expr = f.expression;
          if (!m.unit_code && f.unit_code) clean.unit_code = f.unit_code;
        }
      }
      clean.formula_expr = expr;
      const q = measureQty({ ...m, __formula: expr });
      if (q === null) throw validation('Enter at least one dimension (length, width, depth) so a quantity can be calculated.');
      clean.qty_milli = q;
      if (!ctx.existing) {
        clean.entry_group = newId();
        clean.revision = 1;
      }
    },
    update: (existing, clean, ctx, reason) => {
      if (!reason || !reason.trim()) throw validation('Give a reason for revising this measurement. The original entry is kept in history.', { reason: 'Required' });
      const now = nowIso();
      const id = newId();
      const next: Row = { ...existing, ...clean, id, revision: existing.revision + 1, superseded_at: null, supersede_reason: null, created_at: now, updated_at: now, deleted_at: null };
      const cols = Object.keys(next);
      run(`UPDATE measurement_entries SET superseded_at = ?, supersede_reason = ?, updated_at = ? WHERE id = ?`, [now, reason.trim(), now, existing.id]);
      run(`INSERT INTO measurement_entries (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => next[c]));
      const saved = get<Row>('SELECT * FROM measurement_entries WHERE id = ?', [id])!;
      audit('measurement', id, 'revise', {
        summary: `Revision ${saved.revision} (supersedes rev ${existing.revision}): ${diffSummary(existing, saved, ['id', 'created_at', 'updated_at', 'revision', 'superseded_at', 'supersede_reason'])}`,
        before: existing,
        after: saved,
        reason,
      });
      indexEntity('measurement', id);
      return saved;
    },
  },
};

for (const [k, v] of Object.entries(hooks)) HOOKS[k] = v;

export function measurementHistory(entryGroup: string) {
  return all('SELECT * FROM measurement_entries WHERE entry_group = ? AND deleted_at IS NULL ORDER BY revision DESC', [entryGroup]);
}

export function ensureLoaded() {
  /* importing this module registers the hooks */
}
void fs;
