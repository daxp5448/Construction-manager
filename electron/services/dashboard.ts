import { all, scalar } from '../db/core';
import { stockRegister, lowStockAlerts } from './stock';
import { totalOutstanding, outstandingInvoices } from './billing';
import { royaltyDocumentGaps } from './documents';
import { sum } from '../../src/shared/num';
import { getSettings } from './settings';

/** Every figure is computed live from the database; nothing is hard-coded. */
export function getDashboard(companyId?: string | null) {
  const c = companyId || null;
  const cw = (alias: string) => (c ? ` AND ${alias}.company_id = ?` : '');
  const cp = c ? [c] : [];

  const totals = {
    companies: scalar<number>('SELECT COUNT(*) FROM companies WHERE deleted_at IS NULL') ?? 0,
    active_projects: scalar<number>(`SELECT COUNT(*) FROM projects p WHERE p.deleted_at IS NULL AND p.status = 'active'${cw('p')}`, cp) ?? 0,
    suppliers: scalar<number>(`SELECT COUNT(*) FROM suppliers WHERE deleted_at IS NULL`) ?? 0,
    material_categories: scalar<number>('SELECT COUNT(*) FROM material_categories WHERE deleted_at IS NULL AND active = 1') ?? 0,
    purchases_count: scalar<number>(`SELECT COUNT(*) FROM purchase_orders p WHERE p.deleted_at IS NULL AND p.status <> 'cancelled'${cw('p')}`, cp) ?? 0,
    purchases_paise: scalar<number>(`SELECT COALESCE(SUM(total_paise),0) FROM purchase_orders p WHERE p.deleted_at IS NULL AND p.status <> 'cancelled'${cw('p')}`, cp) ?? 0,
  };

  const received = all<any>(
    `SELECT r.unit_code, SUM(r.received_qty_milli) AS received_milli, SUM(r.accepted_qty_milli) AS accepted_milli, COUNT(*) AS deliveries
     FROM material_receipts r WHERE r.deleted_at IS NULL AND r.status = 'posted'${cw('r')} GROUP BY r.unit_code ORDER BY deliveries DESC`,
    cp
  );

  const stock = stockRegister({ companyId: c });
  const stockValue = sum(stock.map((s) => s.value_paise));
  const unvalued = stock.filter((s) => s.closing_milli > 0 && s.value_paise === null).length;

  const outstanding = totalOutstanding({ companyId: c });
  const pendingInvoices = outstandingInvoices({ companyId: c });
  const awaiting = pendingInvoices.filter((i) => i.approval_status === 'pending' || i.verification_status === 'pending');

  const recent = all<any>(
    `SELECT * FROM (
       SELECT 'purchase' AS kind, po.id AS id, po.po_no AS ref, po.purchase_date AS date, s.name AS party, po.total_paise AS amount_paise, NULL AS qty_milli, NULL AS unit_code, po.created_at AS created_at, po.company_id AS company_id
         FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.deleted_at IS NULL
       UNION ALL
       SELECT 'receipt', r.id, r.receipt_no, substr(r.received_at,1,10), s.name, NULL, r.received_qty_milli, r.unit_code, r.created_at, r.company_id
         FROM material_receipts r JOIN suppliers s ON s.id = r.supplier_id WHERE r.deleted_at IS NULL AND r.status = 'posted'
       UNION ALL
       SELECT 'payment', p.id, COALESCE(p.reference_no, p.kind), p.payment_date, s.name, p.amount_paise, NULL, NULL, p.created_at, p.company_id
         FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id WHERE p.deleted_at IS NULL AND p.status = 'active'
       UNION ALL
       SELECT 'invoice', i.id, i.invoice_no, i.invoice_date, s.name, i.total_paise, NULL, NULL, i.created_at, i.company_id
         FROM invoices i JOIN suppliers s ON s.id = i.supplier_id WHERE i.deleted_at IS NULL AND i.status = 'active'
       UNION ALL
       SELECT 'consumption', m.id, v.label, m.usage_date, COALESCE(m.site_location, ''), NULL, m.qty_milli, m.unit_code, m.created_at, m.company_id
         FROM material_consumption m JOIN v_specs v ON v.id = m.spec_id WHERE m.deleted_at IS NULL
     ) ${c ? 'WHERE company_id = ?' : ''} ORDER BY created_at DESC LIMIT 12`,
    cp
  );

  const gaps = royaltyDocumentGaps({ companyId: c });
  const recentReports = all<any>(`SELECT id, title, format, file_path, period_from, period_to, created_at, is_missing FROM generated_reports ORDER BY created_at DESC LIMIT 5`);
  const shortCount = scalar<number>(
    `SELECT COUNT(*) FROM material_receipts r WHERE r.deleted_at IS NULL AND r.status = 'posted' AND r.ordered_qty_milli IS NOT NULL AND r.ordered_qty_milli - r.received_qty_milli > (r.ordered_qty_milli * ? / 10000)
       AND r.received_at >= date('now','-30 day')${cw('r')}`,
    [getSettings().shortToleranceBp, ...cp]
  ) ?? 0;
  const missingFiles = (scalar<number>('SELECT COUNT(*) FROM documents WHERE deleted_at IS NULL AND is_missing = 1') ?? 0) + (scalar<number>('SELECT COUNT(*) FROM generated_reports WHERE is_missing = 1') ?? 0);

  return {
    totals,
    received_by_unit: received,
    stock_value_paise: stockValue,
    stock_unvalued_lines: unvalued,
    outstanding_paise: outstanding,
    pending_invoices: { count: pendingInvoices.length, awaiting_action: awaiting.length, items: pendingInvoices.slice(0, 8) },
    missing_royalty: {
      receipts_without_pass: gaps.receipts_without_pass.length,
      passes_without_document: gaps.passes_without_document.length,
      unverified: gaps.unverified_passes.length,
      sample: gaps.receipts_without_pass.slice(0, 5),
    },
    recent_transactions: recent,
    recent_reports: recentReports,
    low_stock: getSettings().lowStockAlerts ? lowStockAlerts() : [],
    short_deliveries_30d: shortCount,
    missing_files: missingFiles,
  };
}
