import { all, get } from '../db/core';
import { ReportSpec, SheetSpec } from './kit';
import { stockRegister } from '../services/stock';
import { outstandingInvoices, supplierBalance, supplierLedger } from '../services/billing';
import { royaltyDocumentGaps } from '../services/documents';
import { royaltyReconciliation } from '../services/royalty';
import { financialYearRange, formatDate, monthRange } from '../../src/shared/num';
import { validation } from '../errors';

export interface ReportFilters {
  companyId?: string | null;
  projectId?: string | null;
  supplierId?: string | null;
  specId?: string | null;
  from?: string | null;
  to?: string | null;
  /** YYYY-MM */
  month?: string | null;
  /** 2026-27 */
  fy?: string | null;
  /** single day (daily report) */
  date?: string | null;
}

interface Resolved extends ReportFilters {
  from: string | null;
  to: string | null;
  companyName: string;
  projectName: string | null;
  supplierName: string | null;
}

export interface ReportDef {
  id: string;
  title: string;
  group: 'Registers' | 'Daily & monthly' | 'Finance' | 'Stock & materials' | 'Compliance';
  description: string;
  /** which filter controls are relevant */
  filters: Array<'company' | 'project' | 'supplier' | 'spec' | 'period' | 'month' | 'date'>;
  requires?: Array<'supplier' | 'month' | 'date'>;
  /** template number from the product brief (1–18) */
  template?: number;
  build: (f: Resolved) => SheetSpec[];
  folder: string;
}

// ---------------------------------------------------------------- helpers
function resolve(raw: ReportFilters): Resolved {
  let from = raw.from || null;
  let to = raw.to || null;
  if (raw.date) (from = raw.date), (to = raw.date);
  else if (raw.month) ({ from, to } = monthRange(raw.month));
  else if (raw.fy && !from && !to) ({ from, to } = financialYearRange(raw.fy));
  const company = raw.companyId ? get<any>('SELECT name FROM companies WHERE id = ?', [raw.companyId]) : null;
  const project = raw.projectId ? get<any>('SELECT name FROM projects WHERE id = ?', [raw.projectId]) : null;
  const supplier = raw.supplierId ? get<any>('SELECT name FROM suppliers WHERE id = ?', [raw.supplierId]) : null;
  return { ...raw, from, to, companyName: company?.name ?? '', projectName: project?.name ?? null, supplierName: supplier?.name ?? null };
}

interface W {
  sql: string;
  params: any[];
}
/** Build an AND-chain of filters. `cols` maps filter -> SQL expression. */
function where(f: Resolved, cols: { company?: string; project?: string; supplier?: string; spec?: string; date?: string }, base: string[] = []): W {
  const parts = [...base];
  const params: any[] = [];
  if (f.companyId && cols.company) (parts.push(`${cols.company} = ?`), params.push(f.companyId));
  if (f.projectId && cols.project) (parts.push(`${cols.project} = ?`), params.push(f.projectId));
  if (f.supplierId && cols.supplier) (parts.push(`${cols.supplier} = ?`), params.push(f.supplierId));
  if (f.specId && cols.spec) (parts.push(`${cols.spec} = ?`), params.push(f.specId));
  if (cols.date) {
    if (f.from) (parts.push(`substr(${cols.date},1,10) >= ?`), params.push(f.from));
    if (f.to) (parts.push(`substr(${cols.date},1,10) <= ?`), params.push(f.to));
  }
  return { sql: parts.length ? 'WHERE ' + parts.join(' AND ') : '', params };
}

const periodLabel = (f: Resolved) => (f.from || f.to ? `${f.from ? formatDate(f.from) : 'start'} to ${f.to ? formatDate(f.to) : 'today'}` : 'All dates');

const status = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '');

// ---------------------------------------------------------------- sheets
const sheetCompanies = (): SheetSpec => ({
  name: 'Company Directory',
  columns: [
    { header: 'Company', key: 'name', width: 28 },
    { header: 'Owner / contact person', key: 'owner_name', width: 24 },
    { header: 'Contact number', key: 'contact_number', width: 16 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'GST number', key: 'gst_number', width: 20 },
    { header: 'Address', key: 'address', width: 36, wrap: true },
    { header: 'Projects', key: 'projects', type: 'int', width: 10, total: true },
    { header: 'Record created', key: 'created_at', type: 'date', width: 14 },
    { header: 'Folder', key: 'folder_path', width: 50, wrap: true },
  ],
  rows: all<any>(
    `SELECT c.*, (SELECT COUNT(*) FROM projects p WHERE p.company_id = c.id AND p.deleted_at IS NULL) AS projects FROM companies c WHERE c.deleted_at IS NULL ORDER BY c.name`
  ),
});

const sheetProjects = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'p.company_id' }, ['p.deleted_at IS NULL']);
  return {
    name: 'Project Register',
    columns: [
      { header: 'Company', key: 'company_name', width: 24 },
      { header: 'Code', key: 'code', width: 12 },
      { header: 'Project', key: 'name', width: 40, wrap: true },
      { header: 'Client / authority', key: 'client_name', width: 24 },
      { header: 'Location', key: 'location', width: 26, wrap: true },
      { header: 'Agreement no.', key: 'agreement_no', width: 18 },
      { header: 'Agreement date', key: 'agreement_date', type: 'date' },
      { header: 'Contract value', key: 'contract_value_paise', type: 'money', total: true, width: 18 },
      { header: 'Start', key: 'start_date', type: 'date' },
      { header: 'Scheduled end', key: 'end_date', type: 'date' },
      { header: 'Status', key: 'status_label', width: 12 },
    ],
    rows: all<any>(`SELECT p.*, c.name AS company_name FROM projects p JOIN companies c ON c.id = p.company_id ${w.sql} ORDER BY c.name, p.name`, w.params).map((r) => ({ ...r, status_label: status(r.status) })),
  };
};

const sheetMaterials = (): SheetSpec => ({
  name: 'Material Master',
  columns: [
    { header: 'Category', key: 'category_name', width: 18 },
    { header: 'Material', key: 'material_name', width: 22 },
    { header: 'Size / grade', key: 'size_grade', width: 16 },
    { header: 'Unit', key: 'unit_code', width: 9 },
    { header: 'Standard rate', key: 'standard_rate_paise', type: 'money' },
    { header: 'Minimum stock', key: 'min_stock_milli', type: 'qty', unitKey: 'unit_code' },
    { header: 'Royalty pass needed', key: 'royalty', width: 14 },
    { header: 'Active', key: 'active_label', width: 9 },
  ],
  rows: all<any>(
    `SELECT v.category_name, v.material_name, v.size_grade, v.unit_code, v.standard_rate_paise, v.min_stock_milli, m.requires_royalty, v.active
     FROM v_specs v JOIN materials m ON m.id = v.material_id WHERE v.deleted_at IS NULL ORDER BY v.category_name, v.material_name, v.size_grade`
  ).map((r) => ({ ...r, royalty: r.requires_royalty ? 'Yes' : 'No', active_label: r.active ? 'Active' : 'Inactive' })),
  noTotals: true,
});

const sheetSuppliers = (): SheetSpec => ({
  name: 'Supplier Master',
  columns: [
    { header: 'ID', key: 'code', width: 11 },
    { header: 'Supplier', key: 'name', width: 26 },
    { header: 'Business name', key: 'business_name', width: 24 },
    { header: 'Contact person', key: 'contact_person', width: 20 },
    { header: 'Mobile', key: 'mobile', width: 14 },
    { header: 'Alternate', key: 'alt_contact', width: 14 },
    { header: 'GST', key: 'gst_no', width: 19 },
    { header: 'PAN', key: 'pan_no', width: 13 },
    { header: 'Email', key: 'email', width: 24 },
    { header: 'Address', key: 'address', width: 34, wrap: true },
    { header: 'Contract start', key: 'contract_start', type: 'date' },
    { header: 'Contract end', key: 'contract_end', type: 'date' },
    { header: 'Payment terms', key: 'payment_terms', width: 24, wrap: true },
    { header: 'Status', key: 'status_label', width: 10 },
  ],
  rows: all<any>(`SELECT * FROM suppliers WHERE deleted_at IS NULL ORDER BY name`).map((r) => ({ ...r, status_label: status(r.status) })),
  noTotals: true,
});

const sheetSupplierRates = (f: Resolved): SheetSpec => {
  const w = where(f, { supplier: 'sm.supplier_id', spec: 'sm.spec_id' }, ['sm.deleted_at IS NULL']);
  return {
    name: 'Supplier Rates',
    columns: [
      { header: 'Supplier', key: 'supplier_name', width: 26 },
      { header: 'Category', key: 'category_name', width: 16 },
      { header: 'Material', key: 'spec_label', width: 24 },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Rate per unit', key: 'rate_paise', type: 'money', width: 16 },
      { header: 'Default tax', key: 'tax_bp', type: 'pct' },
      { header: 'Active', key: 'active_label', width: 9 },
      { header: 'Notes', key: 'notes', width: 30, wrap: true },
    ],
    rows: all<any>(
      `SELECT s.name AS supplier_name, v.category_name, v.label AS spec_label, v.unit_code, sm.rate_paise, sm.tax_bp, sm.active, sm.notes
       FROM supplier_materials sm JOIN suppliers s ON s.id = sm.supplier_id JOIN v_specs v ON v.id = sm.spec_id ${w.sql} ORDER BY s.name, v.category_name, v.label`,
      w.params
    ).map((r) => ({ ...r, active_label: r.active ? 'Active' : 'Inactive' })),
    noTotals: true,
  };
};

const sheetPurchaseLines = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'po.company_id', project: 'po.project_id', supplier: 'po.supplier_id', spec: 'i.spec_id', date: 'po.purchase_date' }, ['po.deleted_at IS NULL']);
  return {
    name: 'Purchase Register',
    columns: [
      { header: 'Purchase no.', key: 'po_no', width: 16 },
      { header: 'Date', key: 'purchase_date', type: 'date' },
      { header: 'Project', key: 'project_name', width: 24, wrap: true },
      { header: 'Supplier', key: 'supplier_name', width: 24 },
      { header: 'Invoice no.', key: 'invoice_no', width: 14 },
      { header: 'Material', key: 'spec_label', width: 22 },
      { header: 'Quantity', key: 'qty_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Rate', key: 'rate_paise', type: 'money' },
      { header: 'Tax %', key: 'tax_bp', type: 'pct' },
      { header: 'Taxable value', key: 'subtotal_paise', type: 'money', total: true, width: 17 },
      { header: 'Tax', key: 'tax_paise', type: 'money', total: true },
      { header: 'Line total', key: 'total_paise', type: 'money', total: true, width: 17 },
      { header: 'Payment', key: 'payment_label', width: 12 },
      { header: 'Status', key: 'status_label', width: 11 },
    ],
    rows: all<any>(
      `SELECT po.po_no, po.purchase_date, p.name AS project_name, s.name AS supplier_name, po.invoice_no, v.label AS spec_label, i.qty_milli, i.unit_code, i.rate_paise, i.tax_bp,
              i.subtotal_paise, i.tax_paise, i.total_paise, po.payment_status, po.status
       FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id JOIN projects p ON p.id = po.project_id JOIN suppliers s ON s.id = po.supplier_id JOIN v_specs v ON v.id = i.spec_id
       ${w.sql.replace('WHERE', "WHERE po.status <> 'cancelled' AND")} ORDER BY po.purchase_date, po.po_no, i.line_no`,
      w.params
    ).map((r) => ({ ...r, payment_label: status(r.payment_status), status_label: status(r.status) })),
    notes: ['Cancelled purchases are excluded. Freight, other charges and manual adjustments are on the "Order Totals" sheet.'],
  };
};

const sheetPurchaseOrders = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'po.company_id', project: 'po.project_id', supplier: 'po.supplier_id', date: 'po.purchase_date' }, ['po.deleted_at IS NULL']);
  const spec = f.specId ? ` AND EXISTS (SELECT 1 FROM purchase_order_items i WHERE i.po_id = po.id AND i.spec_id = '${f.specId.replace(/'/g, "''")}')` : '';
  return {
    name: 'Order Totals',
    columns: [
      { header: 'Purchase no.', key: 'po_no', width: 16 },
      { header: 'Date', key: 'purchase_date', type: 'date' },
      { header: 'Supplier', key: 'supplier_name', width: 24 },
      { header: 'Project', key: 'project_name', width: 24, wrap: true },
      { header: 'Taxable value', key: 'subtotal_paise', type: 'money', total: true, width: 17 },
      { header: 'Tax', key: 'tax_paise', type: 'money', total: true },
      { header: 'Freight', key: 'freight_paise', type: 'money', total: true },
      { header: 'Other charges', key: 'other_charges_paise', type: 'money', total: true },
      { header: 'Adjustment', key: 'adjustment_paise', type: 'money_signed', total: true },
      { header: 'Grand total', key: 'total_paise', type: 'money', total: true, width: 18 },
      { header: 'Payment', key: 'payment_label', width: 12 },
      { header: 'Status', key: 'status_label', width: 11 },
      { header: 'Remarks', key: 'remarks', width: 30, wrap: true },
    ],
    rows: all<any>(
      `SELECT po.*, p.name AS project_name, s.name AS supplier_name FROM purchase_orders po JOIN projects p ON p.id = po.project_id JOIN suppliers s ON s.id = po.supplier_id
       ${w.sql.replace('WHERE', "WHERE po.status <> 'cancelled' AND")}${spec} ORDER BY po.purchase_date, po.po_no`,
      w.params
    ).map((r) => ({ ...r, payment_label: status(r.payment_status), status_label: status(r.status) })),
  };
};

const sheetInward = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'r.company_id', project: 'r.project_id', supplier: 'r.supplier_id', spec: 'r.spec_id', date: 'r.received_at' }, ['r.deleted_at IS NULL']);
  return {
    name: 'Material Inward Register',
    columns: [
      { header: 'Receipt no.', key: 'receipt_no', width: 15 },
      { header: 'Date & time', key: 'received_at', type: 'datetime' },
      { header: 'Project', key: 'project_name', width: 22, wrap: true },
      { header: 'Supplier', key: 'supplier_name', width: 22 },
      { header: 'Material', key: 'spec_label', width: 20 },
      { header: 'Vehicle', key: 'vehicle_no', width: 14 },
      { header: 'Driver', key: 'driver_name', width: 16 },
      { header: 'Purchase', key: 'po_no', width: 15 },
      { header: 'Invoice', key: 'invoice_no', width: 13 },
      { header: 'Challan', key: 'challan_no', width: 13 },
      { header: 'Royalty pass', key: 'royalty_pass_no', width: 14 },
      { header: 'Ordered', key: 'ordered_qty_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Received', key: 'received_qty_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Rejected', key: 'rejected_qty_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Accepted', key: 'accepted_qty_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Short (+) / excess (−)', key: 'difference_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Status', key: 'status_label', width: 10 },
    ],
    rows: all<any>(
      `SELECT r.*, p.name AS project_name, s.name AS supplier_name, v.label AS spec_label, po.po_no
       FROM material_receipts r JOIN projects p ON p.id = r.project_id JOIN suppliers s ON s.id = r.supplier_id JOIN v_specs v ON v.id = r.spec_id LEFT JOIN purchase_orders po ON po.id = r.purchase_id
       ${w.sql} ORDER BY r.received_at, r.receipt_no`,
      w.params
    ).map((r) => ({ ...r, difference_milli: r.ordered_qty_milli === null ? null : r.ordered_qty_milli - r.received_qty_milli, status_label: status(r.status) })),
    notes: ['Ordered quantity is the quantity expected for that delivery. Cancelled receipts are listed but do not count toward stock. Stock uses the Accepted quantity only.'],
  };
};

const sheetWeighbridge = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'r.company_id', project: 'r.project_id', supplier: 'r.supplier_id', spec: 'r.spec_id', date: 'COALESCE(w.slip_at, r.received_at)' }, ['r.deleted_at IS NULL', "r.status = 'posted'"]);
  return {
    name: 'Weighbridge Register',
    columns: [
      { header: 'Slip no.', key: 'slip_no', width: 14 },
      { header: 'Weighbridge', key: 'weighbridge_name', width: 22 },
      { header: 'Date & time', key: 'slip_at', type: 'datetime' },
      { header: 'Receipt', key: 'receipt_no', width: 15 },
      { header: 'Vehicle', key: 'vehicle_no', width: 14 },
      { header: 'Supplier', key: 'supplier_name', width: 22 },
      { header: 'Material', key: 'spec_label', width: 20 },
      { header: 'Project', key: 'project_name', width: 22, wrap: true },
      { header: 'Gross', key: 'gross_milli', type: 'qty', unitKey: 'weight_unit', total: true },
      { header: 'Tare', key: 'tare_milli', type: 'qty', unitKey: 'weight_unit', total: true },
      { header: 'Net', key: 'net_milli', type: 'qty', unitKey: 'weight_unit', total: true },
      { header: 'Unit', key: 'weight_unit', width: 8 },
    ],
    rows: all<any>(
      `SELECT w.slip_no, w.weighbridge_name, COALESCE(w.slip_at, r.received_at) AS slip_at, r.receipt_no, COALESCE(w.vehicle_no, r.vehicle_no) AS vehicle_no, s.name AS supplier_name,
              v.label AS spec_label, p.name AS project_name, w.gross_milli, w.tare_milli, w.net_milli, w.weight_unit
       FROM weighbridge_records w JOIN material_receipts r ON r.id = w.receipt_id JOIN suppliers s ON s.id = r.supplier_id JOIN v_specs v ON v.id = r.spec_id JOIN projects p ON p.id = r.project_id
       ${w.sql} ORDER BY COALESCE(w.slip_at, r.received_at), w.slip_no`,
      w.params
    ),
    notes: ['Net weight = Gross weight − Tare weight for every slip.'],
  };
};

const sheetRoyalty = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'rp.company_id', project: 'rp.project_id', supplier: 'rp.supplier_id', date: 'rp.dispatch_at' }, ['rp.deleted_at IS NULL']);
  return {
    name: 'Royalty Register',
    columns: [
      { header: 'Pass no.', key: 'pass_no', width: 16 },
      { header: 'E-permit no.', key: 'e_permit_no', width: 16 },
      { header: 'Dispatch', key: 'dispatch_at', type: 'datetime' },
      { header: 'Mineral', key: 'mineral_name', width: 16 },
      { header: 'Grade', key: 'grade', width: 12 },
      { header: 'Lease holder', key: 'lease_holder', width: 20 },
      { header: 'Supplier', key: 'supplier_name', width: 22 },
      { header: 'Vehicle', key: 'vehicle_no', width: 14 },
      { header: 'Source', key: 'source_location', width: 20 },
      { header: 'Destination / project', key: 'destination', width: 24, wrap: true },
      { header: 'Gross', key: 'gross_milli', type: 'qty', unitKey: 'weight_unit' },
      { header: 'Tare', key: 'tare_milli', type: 'qty', unitKey: 'weight_unit' },
      { header: 'Net quantity', key: 'net_milli', type: 'qty', unitKey: 'weight_unit', total: true },
      { header: 'Unit', key: 'weight_unit', width: 8 },
      { header: 'Royalty amount', key: 'royalty_amount_paise', type: 'money', total: true },
      { header: 'Linked receipt', key: 'receipt_no', width: 15 },
      { header: 'Verification', key: 'verification_label', width: 16 },
      { header: 'Documents', key: 'docs', type: 'int' },
    ],
    rows: all<any>(
      `SELECT rp.*, s.name AS supplier_name, r.receipt_no, pr.name AS project_name,
         (SELECT COUNT(*) FROM documents d WHERE d.entity_type = 'royalty' AND d.entity_id = rp.id AND d.deleted_at IS NULL) AS docs
       FROM royalty_passes rp LEFT JOIN suppliers s ON s.id = rp.supplier_id LEFT JOIN material_receipts r ON r.id = rp.receipt_id LEFT JOIN projects pr ON pr.id = rp.project_id
       ${w.sql} ORDER BY rp.dispatch_at, rp.pass_no`,
      w.params
    ).map((r) => ({
      ...r,
      destination: [r.destination, r.project_name].filter(Boolean).join(' / '),
      verification_label: r.verification_status === 'verified' ? `Verified${r.verified_on ? ' ' + formatDate(r.verified_on) : ''}` : status(r.verification_status),
    })),
    notes: ['Records are entered from the original documents. Verification status is set manually by the user; this register does not verify passes against any government system.'],
  };
};

const sheetRoyaltyReconcile = (f: Resolved): SheetSpec => {
  const rec = royaltyReconciliation({ companyId: f.companyId, projectId: f.projectId, supplierId: f.supplierId, from: f.from, to: f.to });
  const label: Record<string, string> = { matched: 'Matched', received_more: 'Received MORE than passes', received_less: 'Received LESS than passes', not_comparable: 'Not comparable' };
  return {
    name: 'Pass vs Received',
    columns: [
      { header: 'Receipt', key: 'receipt_no', width: 15 },
      { header: 'Supplier', key: 'supplier_name', width: 22 },
      { header: 'Vehicle', key: 'vehicle_no', width: 14 },
      { header: 'Pass numbers', key: 'pass_nos', width: 26, wrap: true },
      { header: 'Pass quantity', key: 'pass_total_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Received', key: 'received_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Difference', key: 'difference_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Result', key: 'result', width: 26 },
    ],
    rows: [
      ...rec.receipts.map((r: any) => ({ ...r, pass_nos: r.passes.map((p: any) => p.pass_no).join(', '), result: label[r.status] })),
      ...rec.unlinked.map((p: any) => ({ receipt_no: '—', supplier_name: p.supplier_name, vehicle_no: p.vehicle_no, pass_nos: p.pass_no, pass_total_milli: p.net_milli, received_milli: null, difference_milli: null, unit_code: p.weight_unit, result: 'Pass not linked to a receipt' })),
    ],
    noTotals: true,
    notes: ['Arithmetic comparison only (within your configured quantity tolerance). It is not a government verification.'],
  };
};

const sheetRoyaltyGaps = (f: Resolved): SheetSpec => {
  const gaps = royaltyDocumentGaps({ companyId: f.companyId, projectId: f.projectId });
  return {
    name: 'Missing Documents',
    columns: [
      { header: 'Issue', key: 'issue', width: 34 },
      { header: 'Reference', key: 'ref', width: 18 },
      { header: 'Date', key: 'date', type: 'datetime' },
      { header: 'Vehicle', key: 'vehicle', width: 14 },
      { header: 'Supplier', key: 'supplier', width: 24 },
      { header: 'Detail', key: 'detail', width: 30 },
    ],
    rows: [
      ...gaps.receipts_without_pass.map((r: any) => ({ issue: 'Inward without a linked royalty pass', ref: r.receipt_no, date: r.received_at, vehicle: r.vehicle_no, supplier: r.supplier_name, detail: r.spec_label })),
      ...gaps.passes_without_document.map((p: any) => ({ issue: 'Pass has no scanned document attached', ref: p.pass_no, date: p.dispatch_at, vehicle: p.vehicle_no, supplier: p.supplier_name, detail: status(p.verification_status) })),
      ...gaps.unverified_passes.map((p: any) => ({ issue: 'Pass not yet verified by user', ref: p.pass_no, date: p.dispatch_at, vehicle: p.vehicle_no, supplier: p.supplier_name, detail: '' })),
    ],
    noTotals: true,
    emptyMessage: 'No missing royalty documents.',
  };
};

const sheetRoyaltyMonthly = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'rp.company_id', project: 'rp.project_id', supplier: 'rp.supplier_id', date: 'rp.dispatch_at' }, ['rp.deleted_at IS NULL']);
  return {
    name: 'Royalty Summary',
    columns: [
      { header: 'Month', key: 'month', width: 12 },
      { header: 'Supplier', key: 'supplier_name', width: 26 },
      { header: 'Mineral', key: 'mineral_name', width: 18 },
      { header: 'Passes', key: 'passes', type: 'int', total: true },
      { header: 'Net quantity', key: 'net_milli', type: 'qty', unitKey: 'weight_unit', total: true },
      { header: 'Unit', key: 'weight_unit', width: 8 },
      { header: 'Royalty amount', key: 'royalty_amount_paise', type: 'money', total: true },
      { header: 'Verified', key: 'verified', type: 'int', total: true },
    ],
    rows: all<any>(
      `SELECT substr(rp.dispatch_at,1,7) AS month, COALESCE(s.name,'—') AS supplier_name, COALESCE(rp.mineral_name,'—') AS mineral_name, COUNT(*) AS passes, SUM(COALESCE(rp.net_milli,0)) AS net_milli,
              rp.weight_unit, SUM(COALESCE(rp.royalty_amount_paise,0)) AS royalty_amount_paise, SUM(CASE WHEN rp.verification_status = 'verified' THEN 1 ELSE 0 END) AS verified
       FROM royalty_passes rp LEFT JOIN suppliers s ON s.id = rp.supplier_id ${w.sql} GROUP BY month, rp.supplier_id, rp.mineral_name, rp.weight_unit ORDER BY month, supplier_name`,
      w.params
    ),
  };
};

const sheetStock = (f: Resolved, title = 'Stock Register'): SheetSpec => {
  const rows = stockRegister({ companyId: f.companyId, projectId: f.projectId, specId: f.specId, from: f.from, to: f.to });
  return {
    name: title,
    columns: [
      { header: 'Project', key: 'project_name', width: 24, wrap: true },
      { header: 'Material', key: 'spec_label', width: 22 },
      { header: 'Location', key: 'location', width: 14 },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Opening', key: 'opening_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Inward (accepted)', key: 'inward_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Returns', key: 'return_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Consumption', key: 'consumption_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Outward', key: 'outward_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Adjustments (±)', key: 'adjustment_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Closing stock', key: 'closing_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Rejected (not stocked)', key: 'rejected_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Avg purchase rate', key: 'avg_rate_paise', type: 'money' },
      { header: 'Stock value', key: 'value_paise', type: 'money', total: true },
    ],
    rows,
    notes: [
      'Closing = Opening + Accepted inward + Returns − Consumption − Outward ± Adjustments. Ordered quantity and rejected material are never counted as stock.',
      'Stock value = closing stock × weighted-average purchase rate (before tax) from purchase orders; lines never purchased are unvalued.',
    ],
  };
};

const sheetConsumption = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'm.company_id', project: 'm.project_id', spec: 'm.spec_id', date: 'm.usage_date' }, ['m.deleted_at IS NULL']);
  return {
    name: 'Material Consumption',
    columns: [
      { header: 'Date', key: 'usage_date', type: 'date' },
      { header: 'Project', key: 'project_name', width: 24, wrap: true },
      { header: 'Site location', key: 'site_location', width: 22 },
      { header: 'Chainage from', key: 'chainage_from', width: 12 },
      { header: 'Chainage to', key: 'chainage_to', width: 12 },
      { header: 'Activity', key: 'activity_name', width: 18 },
      { header: 'Material', key: 'spec_label', width: 22 },
      { header: 'Quantity', key: 'qty_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Equipment / plant', key: 'equipment', width: 20 },
      { header: 'Assumptions', key: 'assumption_note', width: 24, wrap: true },
      { header: 'Remarks', key: 'remarks', width: 26, wrap: true },
    ],
    rows: all<any>(
      `SELECT m.*, p.name AS project_name, a.name AS activity_name, v.label AS spec_label FROM material_consumption m JOIN projects p ON p.id = m.project_id
       JOIN v_specs v ON v.id = m.spec_id LEFT JOIN work_activities a ON a.id = m.activity_id ${w.sql} ORDER BY m.usage_date, m.created_at`,
      w.params
    ),
  };
};

const sheetLedger = (f: Resolved): SheetSpec => {
  if (!f.supplierId) throw validation('Choose a supplier for the supplier ledger.');
  const l = supplierLedger(f.supplierId, { companyId: f.companyId, projectId: f.projectId, from: f.from, to: f.to });
  const rows: any[] = [];
  if (f.from) rows.push({ date: f.from, kind_label: 'Opening balance', ref: '', description: 'Balance brought forward', project_name: '', debit_paise: 0, credit_paise: 0, balance_paise: l.opening_paise });
  for (const x of l.lines) rows.push({ ...x, kind_label: x.kind === 'invoice' ? 'Invoice' : x.kind === 'advance' ? 'Advance' : x.kind === 'credit_note' ? 'Credit note' : 'Payment' });
  return {
    name: 'Supplier Ledger',
    title: `${l.supplier.name}${l.supplier.gst_no ? ' • GST ' + l.supplier.gst_no : ''}`,
    columns: [
      { header: 'Date', key: 'date', type: 'date' },
      { header: 'Type', key: 'kind_label', width: 14 },
      { header: 'Reference', key: 'ref', width: 16 },
      { header: 'Particulars', key: 'description', width: 36, wrap: true },
      { header: 'Project', key: 'project_name', width: 22, wrap: true },
      { header: 'Billed (Cr)', key: 'credit_paise', type: 'money', total: true },
      { header: 'Paid / credited (Dr)', key: 'debit_paise', type: 'money', total: true, width: 18 },
      { header: 'Balance payable', key: 'balance_paise', type: 'money_signed', width: 18 },
    ],
    rows,
    notes: [
      `Closing balance payable: ${(l.closing_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}. A negative balance means advance paid to the supplier.`,
      'Balance = Billed (invoices) − Paid − Advances − Credit notes. All amounts come from recorded invoices and payments.',
    ],
  };
};

const sheetPayments = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'p.company_id', project: 'p.project_id', supplier: 'p.supplier_id', date: 'p.payment_date' }, ['p.deleted_at IS NULL']);
  return {
    name: 'Payment Register',
    columns: [
      { header: 'Date', key: 'payment_date', type: 'date' },
      { header: 'Supplier', key: 'supplier_name', width: 26 },
      { header: 'Type', key: 'kind_label', width: 13 },
      { header: 'Mode', key: 'mode_label', width: 10 },
      { header: 'Reference', key: 'reference_no', width: 20 },
      { header: 'Against invoice', key: 'invoice_no', width: 16 },
      { header: 'Project', key: 'project_name', width: 24, wrap: true },
      { header: 'Amount', key: 'amount_paise', type: 'money', total: true, width: 17 },
      { header: 'Status', key: 'status_label', width: 11 },
      { header: 'Notes', key: 'notes', width: 28, wrap: true },
    ],
    rows: all<any>(
      `SELECT p.*, s.name AS supplier_name, inv.invoice_no, pr.name AS project_name FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN invoices inv ON inv.id = p.invoice_id LEFT JOIN projects pr ON pr.id = p.project_id ${w.sql.replace('WHERE', "WHERE p.status = 'active' AND")} ORDER BY p.payment_date, p.created_at`,
      w.params
    ).map((r) => ({ ...r, kind_label: status(r.kind), mode_label: (r.mode || '').toUpperCase(), status_label: status(r.status) })),
  };
};

const sheetInvoices = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'i.company_id', project: 'i.project_id', supplier: 'i.supplier_id', date: 'i.invoice_date' }, ['i.deleted_at IS NULL']);
  return {
    name: 'Supplier Invoices',
    columns: [
      { header: 'Invoice no.', key: 'invoice_no', width: 16 },
      { header: 'Date', key: 'invoice_date', type: 'date' },
      { header: 'Supplier', key: 'supplier_name', width: 26 },
      { header: 'Project', key: 'project_name', width: 22, wrap: true },
      { header: 'Against purchase', key: 'po_no', width: 16 },
      { header: 'Taxable', key: 'subtotal_paise', type: 'money', total: true },
      { header: 'Tax', key: 'tax_paise', type: 'money', total: true },
      { header: 'Other', key: 'other_paise', type: 'money', total: true },
      { header: 'Invoice total', key: 'total_paise', type: 'money', total: true, width: 17 },
      { header: 'Verification', key: 'verify_label', width: 12 },
      { header: 'Approval', key: 'approval_label', width: 11 },
      { header: 'Payment', key: 'payment_label', width: 11 },
      { header: 'Due', key: 'due_date', type: 'date' },
    ],
    rows: all<any>(
      `SELECT i.*, s.name AS supplier_name, pr.name AS project_name, po.po_no FROM invoices i JOIN suppliers s ON s.id = i.supplier_id
       LEFT JOIN projects pr ON pr.id = i.project_id LEFT JOIN purchase_orders po ON po.id = i.purchase_id ${w.sql.replace('WHERE', "WHERE i.status = 'active' AND")} ORDER BY i.invoice_date, i.invoice_no`,
      w.params
    ).map((r) => ({ ...r, verify_label: status(r.verification_status), approval_label: status(r.approval_status), payment_label: status(r.payment_status) })),
  };
};

const sheetOutstanding = (f: Resolved): SheetSpec => ({
  name: 'Outstanding Bills',
  columns: [
    { header: 'Supplier', key: 'supplier_name', width: 26 },
    { header: 'Invoice no.', key: 'invoice_no', width: 16 },
    { header: 'Invoice date', key: 'invoice_date', type: 'date' },
    { header: 'Due date', key: 'due_date', type: 'date' },
    { header: 'Project', key: 'project_name', width: 22, wrap: true },
    { header: 'Invoice total', key: 'total_paise', type: 'money', total: true, width: 17 },
    { header: 'Paid against invoice', key: 'paid_paise', type: 'money', total: true, width: 18 },
    { header: 'Balance', key: 'balance_paise', type: 'money', total: true, width: 17 },
    { header: 'Approval', key: 'approval_label', width: 11 },
    { header: 'Verification', key: 'verify_label', width: 12 },
    { header: 'Age (days)', key: 'age', type: 'int' },
  ],
  rows: outstandingInvoices({ companyId: f.companyId, projectId: f.projectId, supplierId: f.supplierId }).map((r) => ({
    ...r,
    approval_label: status(r.approval_status),
    verify_label: status(r.verification_status),
    age: Math.max(0, Math.floor((Date.now() - new Date(r.invoice_date).getTime()) / 86400000)),
  })),
  notes: ['Per-invoice balance counts only payments recorded against that invoice. On-account payments and advances are reflected in each supplier ledger.'],
});

const sheetQuality = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'q.company_id', project: 'q.project_id', supplier: 'q.supplier_id', spec: 'q.spec_id', date: 'q.test_date' }, ['q.deleted_at IS NULL']);
  return {
    name: 'Quality Control Register',
    columns: [
      { header: 'Test ID', key: 'test_no', width: 15 },
      { header: 'Date', key: 'test_date', type: 'date' },
      { header: 'Project', key: 'project_name', width: 22, wrap: true },
      { header: 'Material', key: 'spec_label', width: 20 },
      { header: 'Supplier', key: 'supplier_name', width: 20 },
      { header: 'Sample ID', key: 'sample_id', width: 14 },
      { header: 'Test', key: 'test_name', width: 24 },
      { header: 'Result', key: 'result_value', width: 12 },
      { header: 'Unit', key: 'unit', width: 9 },
      { header: 'Min', key: 'limit_min', type: 'number' },
      { header: 'Max', key: 'limit_max', type: 'number' },
      { header: 'Limit note', key: 'limit_text', width: 18 },
      { header: 'Reference standard', key: 'standard_ref', width: 26, wrap: true },
      { header: 'Pass / fail', key: 'result_label', width: 10 },
      { header: 'Laboratory', key: 'laboratory', width: 20 },
    ],
    rows: all<any>(
      `SELECT q.*, p.name AS project_name, v.label AS spec_label, s.name AS supplier_name, t.name AS test_name FROM quality_tests q JOIN projects p ON p.id = q.project_id
       JOIN test_types t ON t.id = q.test_type_id LEFT JOIN v_specs v ON v.id = q.spec_id LEFT JOIN suppliers s ON s.id = q.supplier_id ${w.sql} ORDER BY q.test_date, q.test_no`,
      w.params
    ).map((r) => ({ ...r, result_label: r.result_status === 'na' ? 'N/A' : status(r.result_status) })),
    notes: ['Acceptance limits and reference standards are those entered by the user on each record; the application does not apply built-in limits.'],
    noTotals: true,
  };
};

const sheetMeasurement = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'm.company_id', project: 'm.project_id', date: 'm.measured_on' }, ['m.deleted_at IS NULL', 'm.superseded_at IS NULL']);
  return {
    name: 'Measurement Book',
    columns: [
      { header: 'MB no.', key: 'mb_no', width: 12 },
      { header: 'Date', key: 'measured_on', type: 'date' },
      { header: 'Project', key: 'project_name', width: 22, wrap: true },
      { header: 'Work description', key: 'work_description', width: 34, wrap: true },
      { header: 'Chainage from', key: 'chainage_from', width: 12 },
      { header: 'Chainage to', key: 'chainage_to', width: 12 },
      { header: 'Length (m)', key: 'length_milli', type: 'qty' },
      { header: 'Width (m)', key: 'width_milli', type: 'qty' },
      { header: 'Depth (m)', key: 'depth_milli', type: 'qty' },
      { header: 'Nos', key: 'nos_milli', type: 'qty' },
      { header: 'Quantity', key: 'qty_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Formula used', key: 'formula_expr', width: 16 },
      { header: 'BOQ ref.', key: 'boq_ref', width: 12 },
      { header: 'Revision', key: 'revision', type: 'int' },
      { header: 'Remarks', key: 'remarks', width: 24, wrap: true },
    ],
    rows: all<any>(`SELECT m.*, p.name AS project_name FROM measurement_entries m JOIN projects p ON p.id = m.project_id ${w.sql} ORDER BY m.measured_on, m.mb_no`, w.params),
  };
};

const sheetMeasurementHistory = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'm.company_id', project: 'm.project_id', date: 'm.measured_on' }, ['m.deleted_at IS NULL', 'm.superseded_at IS NOT NULL']);
  return {
    name: 'Revision History',
    columns: [
      { header: 'MB no.', key: 'mb_no', width: 12 },
      { header: 'Revision', key: 'revision', type: 'int' },
      { header: 'Work description', key: 'work_description', width: 34, wrap: true },
      { header: 'Quantity (superseded)', key: 'qty_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Superseded on', key: 'superseded_at', type: 'datetime' },
      { header: 'Reason', key: 'supersede_reason', width: 34, wrap: true },
    ],
    rows: all<any>(`SELECT m.* FROM measurement_entries m ${w.sql} ORDER BY m.mb_no, m.revision`, w.params),
    noTotals: true,
    emptyMessage: 'No measurements have been revised.',
  };
};

const sheetProgress = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'd.company_id', project: 'd.project_id', date: 'd.entry_date' }, ['d.deleted_at IS NULL']);
  return {
    name: 'Daily Progress Register',
    columns: [
      { header: 'Date', key: 'entry_date', type: 'date' },
      { header: 'Register', key: 'register_label', width: 14 },
      { header: 'Project', key: 'project_name', width: 22, wrap: true },
      { header: 'Activity', key: 'activity_name', width: 16 },
      { header: 'Chainage', key: 'chainage', width: 18 },
      { header: 'Work done', key: 'work_done', width: 44, wrap: true },
      { header: 'Quantity', key: 'qty_done_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Labour', key: 'labour_count', type: 'int' },
      { header: 'Equipment', key: 'equipment', width: 20, wrap: true },
      { header: 'Weather', key: 'weather', width: 12 },
      { header: 'Issues', key: 'issues', width: 26, wrap: true },
    ],
    rows: all<any>(
      `SELECT d.*, p.name AS project_name, a.name AS activity_name FROM daily_progress d JOIN projects p ON p.id = d.project_id LEFT JOIN work_activities a ON a.id = d.activity_id
       ${w.sql} ORDER BY d.entry_date, d.created_at`,
      w.params
    ).map((r) => ({ ...r, register_label: r.register === 'site_diary' ? 'Site diary' : r.register === 'road_work' ? 'Road work' : 'Progress', chainage: [r.chainage_from, r.chainage_to].filter(Boolean).join(' → ') })),
  };
};

// -------- analytical sheets
const sheetSupplierSummary = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'po.company_id', project: 'po.project_id', supplier: 'po.supplier_id', spec: 'i.spec_id', date: 'po.purchase_date' }, ['po.deleted_at IS NULL', "po.status <> 'cancelled'"]);
  return {
    name: 'Supplier Purchase Summary',
    columns: [
      { header: 'Supplier', key: 'supplier_name', width: 28 },
      { header: 'Orders', key: 'orders', type: 'int', total: true },
      { header: 'Taxable value', key: 'subtotal_paise', type: 'money', total: true, width: 18 },
      { header: 'Tax', key: 'tax_paise', type: 'money', total: true },
      { header: 'Line total', key: 'total_paise', type: 'money', total: true, width: 18 },
    ],
    rows: all<any>(
      `SELECT s.name AS supplier_name, COUNT(DISTINCT po.id) AS orders, SUM(i.subtotal_paise) AS subtotal_paise, SUM(i.tax_paise) AS tax_paise, SUM(i.total_paise) AS total_paise
       FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id JOIN suppliers s ON s.id = po.supplier_id ${w.sql} GROUP BY s.id ORDER BY total_paise DESC`,
      w.params
    ),
    notes: ['Line totals exclude freight, other charges and adjustments (see Order Totals in the purchase register).'],
  };
};

const sheetMaterialQty = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'po.company_id', project: 'po.project_id', supplier: 'po.supplier_id', spec: 'i.spec_id', date: 'po.purchase_date' }, ['po.deleted_at IS NULL', "po.status <> 'cancelled'"]);
  const w2 = where(f, { company: 'r.company_id', project: 'r.project_id', supplier: 'r.supplier_id', spec: 'r.spec_id', date: 'r.received_at' }, ['r.deleted_at IS NULL', "r.status = 'posted'"]);
  const ordered = all<any>(
    `SELECT v.id AS spec_id, v.category_name, v.label AS spec_label, i.unit_code, SUM(i.qty_milli) AS ordered_milli, SUM(i.total_paise) AS amount_paise
     FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id JOIN v_specs v ON v.id = i.spec_id ${w.sql} GROUP BY v.id, i.unit_code`,
    w.params
  );
  const rec = all<any>(
    `SELECT r.spec_id, r.unit_code, SUM(r.received_qty_milli) AS received_milli, SUM(r.accepted_qty_milli) AS accepted_milli, SUM(r.rejected_qty_milli) AS rejected_milli
     FROM material_receipts r ${w2.sql} GROUP BY r.spec_id, r.unit_code`,
    w2.params
  );
  const map = new Map<string, any>();
  for (const o of ordered) map.set(`${o.spec_id}|${o.unit_code}`, { ...o, received_milli: 0, accepted_milli: 0, rejected_milli: 0 });
  for (const r of rec) {
    const k = `${r.spec_id}|${r.unit_code}`;
    const ex = map.get(k);
    if (ex) Object.assign(ex, r);
    else {
      const v = get<any>('SELECT category_name, label AS spec_label FROM v_specs WHERE id = ?', [r.spec_id]);
      map.set(k, { ...v, ordered_milli: 0, amount_paise: 0, ...r });
    }
  }
  return {
    name: 'Material-wise Quantity',
    columns: [
      { header: 'Category', key: 'category_name', width: 16 },
      { header: 'Material', key: 'spec_label', width: 24 },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Ordered', key: 'ordered_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Received', key: 'received_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Rejected', key: 'rejected_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Accepted', key: 'accepted_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Pending', key: 'pending_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Purchase value (excl. charges)', key: 'amount_paise', type: 'money', total: true, width: 20 },
    ],
    rows: [...map.values()].map((m) => ({ ...m, pending_milli: Math.max((m.ordered_milli || 0) - (m.received_milli || 0), 0) })).sort((a, b) => (a.category_name + a.spec_label).localeCompare(b.category_name + b.spec_label)),
  };
};

const sheetProjectExpense = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'po.company_id', project: 'po.project_id', supplier: 'po.supplier_id', date: 'po.purchase_date' }, ['po.deleted_at IS NULL', "po.status <> 'cancelled'"]);
  return {
    name: 'Project-wise Material Expense',
    columns: [
      { header: 'Company', key: 'company_name', width: 22 },
      { header: 'Project', key: 'project_name', width: 30, wrap: true },
      { header: 'Purchase orders', key: 'orders', type: 'int', total: true },
      { header: 'Taxable value', key: 'subtotal_paise', type: 'money', total: true, width: 18 },
      { header: 'Tax', key: 'tax_paise', type: 'money', total: true },
      { header: 'Freight', key: 'freight_paise', type: 'money', total: true },
      { header: 'Other + adjustments', key: 'other_paise', type: 'money_signed', total: true, width: 18 },
      { header: 'Total expense', key: 'total_paise', type: 'money', total: true, width: 18 },
    ],
    rows: all<any>(
      `SELECT c.name AS company_name, p.name AS project_name, COUNT(*) AS orders, SUM(po.subtotal_paise) AS subtotal_paise, SUM(po.tax_paise) AS tax_paise, SUM(po.freight_paise) AS freight_paise,
              SUM(po.other_charges_paise + po.adjustment_paise) AS other_paise, SUM(po.total_paise) AS total_paise
       FROM purchase_orders po JOIN projects p ON p.id = po.project_id JOIN companies c ON c.id = po.company_id ${w.sql} GROUP BY po.project_id ORDER BY c.name, p.name`,
      w.params
    ),
    notes: ['Expense is based on purchase orders (committed cost), not on payments made.'],
  };
};

const sheetProjectInvoiceExpense = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'i.company_id', project: 'i.project_id', supplier: 'i.supplier_id', date: 'i.invoice_date' }, ['i.deleted_at IS NULL', "i.status = 'active'", "i.approval_status <> 'rejected'"]);
  return {
    name: 'Billed vs Paid by Project',
    columns: [
      { header: 'Project', key: 'project_name', width: 32, wrap: true },
      { header: 'Billed (invoices)', key: 'billed_paise', type: 'money', total: true, width: 18 },
      { header: 'Paid against invoices', key: 'paid_paise', type: 'money', total: true, width: 20 },
      { header: 'Unpaid on invoices', key: 'unpaid_paise', type: 'money', total: true, width: 18 },
    ],
    rows: all<any>(
      `SELECT COALESCE(p.name,'(No project)') AS project_name, SUM(i.total_paise) AS billed_paise,
              SUM(COALESCE((SELECT SUM(sp.amount_paise) FROM supplier_payments sp WHERE sp.invoice_id = i.id AND sp.deleted_at IS NULL AND sp.status = 'active'),0)) AS paid_paise
       FROM invoices i LEFT JOIN projects p ON p.id = i.project_id ${w.sql} GROUP BY i.project_id ORDER BY project_name`,
      w.params
    ).map((r) => ({ ...r, unpaid_paise: r.billed_paise - r.paid_paise })),
  };
};

const sheetConsumptionSummary = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'm.company_id', project: 'm.project_id', spec: 'm.spec_id', date: 'm.usage_date' }, ['m.deleted_at IS NULL']);
  return {
    name: 'Consumption Summary',
    columns: [
      { header: 'Project', key: 'project_name', width: 28, wrap: true },
      { header: 'Activity', key: 'activity_name', width: 18 },
      { header: 'Material', key: 'spec_label', width: 24 },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Entries', key: 'entries', type: 'int', total: true },
      { header: 'Quantity used', key: 'qty_milli', type: 'qty', unitKey: 'unit_code', total: true },
    ],
    rows: all<any>(
      `SELECT p.name AS project_name, COALESCE(a.name,'(unspecified)') AS activity_name, v.label AS spec_label, m.unit_code, COUNT(*) AS entries, SUM(m.qty_milli) AS qty_milli
       FROM material_consumption m JOIN projects p ON p.id = m.project_id JOIN v_specs v ON v.id = m.spec_id LEFT JOIN work_activities a ON a.id = m.activity_id
       ${w.sql} GROUP BY m.project_id, m.activity_id, m.spec_id, m.unit_code ORDER BY p.name, activity_name, v.label`,
      w.params
    ),
  };
};

const sheetPlannedVsActual = (f: Resolved): SheetSpec => {
  const w = where(f, { project: 'pl.project_id', spec: 'pl.spec_id' }, ['pl.deleted_at IS NULL']);
  const planned = all<any>(
    `SELECT pl.project_id, pl.spec_id, pl.activity_id, pl.planned_qty_milli, pl.unit_code, pl.basis_note, p.name AS project_name, v.label AS spec_label, a.name AS activity_name
     FROM consumption_plans pl JOIN projects p ON p.id = pl.project_id JOIN v_specs v ON v.id = pl.spec_id LEFT JOIN work_activities a ON a.id = pl.activity_id ${w.sql} ${f.companyId ? (w.sql ? 'AND' : 'WHERE') + ' p.company_id = ?' : ''} ORDER BY p.name, v.label`,
    f.companyId ? [...w.params, f.companyId] : w.params
  );
  const rows = planned.map((pl) => {
    const actual =
      get<any>(
        `SELECT COALESCE(SUM(qty_milli),0) AS q FROM material_consumption WHERE deleted_at IS NULL AND project_id = ? AND spec_id = ? ${pl.activity_id ? 'AND activity_id = ?' : ''}${f.from ? ' AND usage_date >= ?' : ''}${f.to ? ' AND usage_date <= ?' : ''}`,
        [pl.project_id, pl.spec_id, ...(pl.activity_id ? [pl.activity_id] : []), ...(f.from ? [f.from] : []), ...(f.to ? [f.to] : [])]
      )?.q ?? 0;
    return { ...pl, actual_milli: actual, variance_milli: actual - pl.planned_qty_milli, pct: pl.planned_qty_milli ? Math.round((actual * 10000) / pl.planned_qty_milli) : null };
  });
  return {
    name: 'Planned vs Actual',
    columns: [
      { header: 'Project', key: 'project_name', width: 26, wrap: true },
      { header: 'Material', key: 'spec_label', width: 22 },
      { header: 'Activity', key: 'activity_name', width: 18 },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Planned', key: 'planned_qty_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Actual', key: 'actual_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Variance (actual − planned)', key: 'variance_milli', type: 'qty', unitKey: 'unit_code', width: 18 },
      { header: 'Actual / planned', key: 'pct', type: 'pct' },
      { header: 'Basis (user-entered)', key: 'basis_note', width: 34, wrap: true },
    ],
    rows,
    notes: ['Planned quantities and their basis are entered by the user under Consumption → Planned quantities; the application does not derive them from engineering formulas.'],
    emptyMessage: 'No planned quantities entered yet.',
  };
};

const sheetReconciliation = (f: Resolved): SheetSpec => {
  const rows = stockRegister({ companyId: f.companyId, projectId: f.projectId, specId: f.specId, to: f.to });
  const ordered = (project: string, spec: string) =>
    get<any>(
      `SELECT COALESCE(SUM(i.qty_milli),0) AS q FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id WHERE po.deleted_at IS NULL AND po.status <> 'cancelled' AND po.project_id = ? AND i.spec_id = ?`,
      [project, spec]
    )?.q ?? 0;
  const received = (project: string, spec: string) =>
    get<any>(
      `SELECT COALESCE(SUM(received_qty_milli),0) AS r, COALESCE(SUM(rejected_qty_milli),0) AS j FROM material_receipts WHERE deleted_at IS NULL AND status = 'posted' AND project_id = ? AND spec_id = ?`,
      [project, spec]
    ) ?? { r: 0, j: 0 };
  // aggregate locations
  const agg = new Map<string, any>();
  for (const r of rows) {
    const k = `${r.project_id}|${r.spec_id}`;
    const a = agg.get(k) ?? { project_name: r.project_name, spec_label: r.spec_label, unit_code: r.unit_code, project_id: r.project_id, spec_id: r.spec_id, opening_milli: 0, consumption_milli: 0, outward_milli: 0, adjustment_milli: 0, closing_milli: 0 };
    a.opening_milli += r.opening_milli;
    a.consumption_milli += r.consumption_milli;
    a.outward_milli += r.outward_milli;
    a.adjustment_milli += r.adjustment_milli;
    a.closing_milli += r.closing_milli;
    agg.set(k, a);
  }
  const out = [...agg.values()].map((a) => {
    const rc = received(a.project_id, a.spec_id);
    return { ...a, ordered_milli: ordered(a.project_id, a.spec_id), received_milli: rc.r, rejected_milli: rc.j, accepted_milli: rc.r - rc.j, pending_milli: Math.max(ordered(a.project_id, a.spec_id) - rc.r, 0) };
  });
  return {
    name: 'Material Reconciliation',
    columns: [
      { header: 'Project', key: 'project_name', width: 26, wrap: true },
      { header: 'Material', key: 'spec_label', width: 22 },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Ordered', key: 'ordered_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Received', key: 'received_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Rejected', key: 'rejected_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Accepted', key: 'accepted_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Pending delivery', key: 'pending_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Opening stock', key: 'opening_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Consumed', key: 'consumption_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Outward', key: 'outward_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Adjustments (±)', key: 'adjustment_milli', type: 'qty', unitKey: 'unit_code' },
      { header: 'Closing stock', key: 'closing_milli', type: 'qty', unitKey: 'unit_code' },
    ],
    rows: out,
    noTotals: true,
    notes: ['Check: Opening + Accepted + Returns − Consumed − Outward ± Adjustments = Closing stock. Returns are included in the Closing figure.'],
  };
};

const sheetSupplierReceived = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'r.company_id', project: 'r.project_id', supplier: 'r.supplier_id', spec: 'r.spec_id', date: 'r.received_at' }, ['r.deleted_at IS NULL', "r.status = 'posted'"]);
  return {
    name: 'Supplier-wise Received Qty',
    columns: [
      { header: 'Supplier', key: 'supplier_name', width: 28 },
      { header: 'Material', key: 'spec_label', width: 24 },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Deliveries', key: 'deliveries', type: 'int', total: true },
      { header: 'Received', key: 'received_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Rejected', key: 'rejected_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Accepted', key: 'accepted_milli', type: 'qty', unitKey: 'unit_code', total: true },
    ],
    rows: all<any>(
      `SELECT s.name AS supplier_name, v.label AS spec_label, r.unit_code, COUNT(*) AS deliveries, SUM(r.received_qty_milli) AS received_milli, SUM(r.rejected_qty_milli) AS rejected_milli, SUM(r.accepted_qty_milli) AS accepted_milli
       FROM material_receipts r JOIN suppliers s ON s.id = r.supplier_id JOIN v_specs v ON v.id = r.spec_id ${w.sql} GROUP BY r.supplier_id, r.spec_id, r.unit_code ORDER BY s.name, v.label`,
      w.params
    ),
  };
};

const sheetBalanceByMaterial = (f: Resolved): SheetSpec => {
  const rows = stockRegister({ companyId: f.companyId, projectId: f.projectId, specId: f.specId, to: f.to });
  const m = new Map<string, any>();
  for (const r of rows) {
    const a = m.get(r.spec_id) ?? { category_name: r.category_name, spec_label: r.spec_label, unit_code: r.unit_code, closing_milli: 0, value_paise: 0, projects: new Set<string>() };
    a.closing_milli += r.closing_milli;
    a.value_paise += r.value_paise ?? 0;
    a.projects.add(r.project_name);
    m.set(r.spec_id, a);
  }
  return {
    name: 'Material-wise Balance',
    columns: [
      { header: 'Category', key: 'category_name', width: 16 },
      { header: 'Material', key: 'spec_label', width: 24 },
      { header: 'Unit', key: 'unit_code', width: 8 },
      { header: 'Balance', key: 'closing_milli', type: 'qty', unitKey: 'unit_code', total: true },
      { header: 'Stock value', key: 'value_paise', type: 'money', total: true, width: 17 },
      { header: 'Projects holding stock', key: 'projects_label', width: 36, wrap: true },
    ],
    rows: [...m.values()].map((a) => ({ ...a, projects_label: [...a.projects].join(', ') })).sort((a, b) => (a.category_name + a.spec_label).localeCompare(b.category_name + b.spec_label)),
  };
};

const sheetCompanyDetails = (f: Resolved): SheetSpec => {
  const w = where(f, { company: 'c.id' }, ['c.deleted_at IS NULL']);
  const rows: any[] = [];
  for (const c of all<any>(`SELECT c.* FROM companies c ${w.sql} ORDER BY c.name`, w.params)) {
    rows.push({ company: c.name, field: 'Company Name', value: c.name });
    for (const x of all<any>('SELECT field_name, field_value FROM company_fields WHERE company_id = ? ORDER BY field_order', [c.id])) rows.push({ company: c.name, field: x.field_name, value: x.field_value });
    if (c.notes) rows.push({ company: c.name, field: 'Notes', value: c.notes });
  }
  return {
    name: 'Company Details',
    columns: [
      { header: 'Company', key: 'company', width: 26 },
      { header: 'Field', key: 'field', width: 28 },
      { header: 'Value', key: 'value', width: 60, wrap: true },
    ],
    rows,
    noTotals: true,
  };
};

// ---------------------------------------------------------------- composite
const dailyReport = (f: Resolved): SheetSpec[] => {
  const mk = (s: SheetSpec, name: string): SheetSpec => ({ ...s, name });
  return [
    mk(sheetPurchaseLines(f), '1 Purchased'),
    mk(sheetInward(f), '2 Received'),
    mk(sheetRoyalty(f), '3 Royalty'),
    mk(sheetConsumption(f), '4 Consumed'),
    mk(sheetStock({ ...f, from: null }, 'x'), '5 Stock Balance'),
    mk(sheetInvoices(f), '6 Invoices'),
    mk(sheetPayments(f), '7 Payments'),
  ];
};

const monthlyReport = (f: Resolved): SheetSpec[] => {
  const mk = (s: SheetSpec, name: string): SheetSpec => ({ ...s, name });
  const stock = sheetStock(f, 'x');
  stock.notes = ['Opening = balance before the first day of the month; movements are for the month; closing is at month end.', ...(stock.notes ?? [])];
  return [
    mk(sheetSupplierSummary(f), '1 Supplier Purchases'),
    mk(sheetMaterialQty(f), '2 Material Qty'),
    mk(sheetProjectExpense(f), '3 Project Expense'),
    mk(stock, '4 Stock Reconciliation'),
    mk(sheetOutstanding(f), '5 Outstanding Bills'),
    mk(sheetRoyaltyMonthly(f), '6 Royalty Summary'),
    mk(sheetConsumptionSummary(f), '7 Consumption'),
  ];
};

const supplierStatement = (f: Resolved): SheetSpec[] => {
  const ledger = sheetLedger(f);
  const bal = supplierBalance(f.supplierId!, { companyId: f.companyId, projectId: f.projectId, asOf: f.to });
  const summary: SheetSpec = {
    name: 'Summary',
    columns: [
      { header: 'Item', key: 'item', width: 34 },
      { header: 'Amount', key: 'amount', type: 'money_signed', width: 20 },
    ],
    rows: [
      { item: 'Total billed (invoices) to date', amount: bal.billed_paise },
      { item: 'Payments', amount: bal.paid_paise },
      { item: 'Advances', amount: bal.advance_paise },
      { item: 'Credit notes', amount: bal.credit_note_paise },
      { item: 'Outstanding balance (payable)', amount: bal.outstanding_paise },
    ],
    noTotals: true,
  };
  return [summary, ledger];
};

export const REPORTS: ReportDef[] = [
  { id: 'company_details', title: 'Company Details', group: 'Registers', template: 1, description: 'Every field recorded for each company.', filters: ['company'], folder: 'Registers', build: (f) => [sheetCompanyDetails(f)] },
  { id: 'company_directory', title: 'Company Directory', group: 'Registers', description: 'All companies with contacts and project counts.', filters: [], folder: 'Registers', build: () => [sheetCompanies()] },
  { id: 'project_register', title: 'Project Register', group: 'Registers', template: 2, description: 'Projects with agreement, contract value and status.', filters: ['company'], folder: 'Registers', build: (f) => [sheetProjects(f)] },
  { id: 'material_master', title: 'Material Master', group: 'Registers', template: 3, description: 'Categories, materials, sizes/grades, units and stock levels.', filters: [], folder: 'Registers', build: () => [sheetMaterials()] },
  { id: 'supplier_master', title: 'Supplier Master', group: 'Registers', template: 4, description: 'Supplier details, GST/PAN and terms.', filters: [], folder: 'Registers', build: () => [sheetSuppliers()] },
  { id: 'supplier_rates', title: 'Supplier Material Rate Register', group: 'Registers', template: 5, description: 'Rates agreed with each supplier for each material.', filters: ['supplier', 'spec'], folder: 'Registers', build: (f) => [sheetSupplierRates(f)] },
  { id: 'purchase_register', title: 'Purchase Register', group: 'Registers', template: 6, description: 'Purchase lines with tax, plus order totals with freight and adjustments.', filters: ['company', 'project', 'supplier', 'spec', 'period'], folder: 'Purchases', build: (f) => [sheetPurchaseLines(f), sheetPurchaseOrders(f)] },
  { id: 'inward_register', title: 'Material Inward Register', group: 'Registers', template: 7, description: 'Deliveries received with ordered / received / accepted / rejected quantities.', filters: ['company', 'project', 'supplier', 'spec', 'period'], folder: 'Inward', build: (f) => [sheetInward(f)] },
  { id: 'weighbridge_register', title: 'Weighbridge Register', group: 'Registers', template: 8, description: 'Every weighbridge slip with gross, tare and net weight.', filters: ['company', 'project', 'supplier', 'spec', 'period'], folder: 'Inward', build: (f) => [sheetWeighbridge(f)] },
  { id: 'royalty_register', title: 'Royalty Register', group: 'Compliance', template: 9, description: 'Date-wise royalty / transit passes with verification status.', filters: ['company', 'project', 'supplier', 'period'], folder: 'Royalty', build: (f) => [sheetRoyalty(f)] },
  { id: 'royalty_reconciliation', title: 'Royalty Reconciliation & Missing Documents', group: 'Compliance', description: 'Pass quantity vs received quantity, and missing royalty documents.', filters: ['company', 'project', 'supplier', 'period'], folder: 'Royalty', build: (f) => [sheetRoyaltyReconcile(f), sheetRoyaltyGaps(f)] },
  { id: 'royalty_monthly', title: 'Monthly Royalty Summary', group: 'Compliance', description: 'Passes, net quantity and royalty amount by month and supplier.', filters: ['company', 'project', 'supplier', 'period'], folder: 'Royalty', build: (f) => [sheetRoyaltyMonthly(f)] },
  { id: 'stock_register', title: 'Stock Register', group: 'Stock & materials', template: 10, description: 'Opening, inward, consumption and closing stock by project and material.', filters: ['company', 'project', 'spec', 'period'], folder: 'Stock', build: (f) => [sheetStock(f)] },
  { id: 'material_balance', title: 'Material-wise Balance Report', group: 'Stock & materials', description: 'Current balance of each material across projects.', filters: ['company', 'project', 'spec', 'period'], folder: 'Stock', build: (f) => [sheetBalanceByMaterial(f)] },
  { id: 'supplier_received', title: 'Supplier-wise Received Quantity', group: 'Stock & materials', description: 'Quantity received, rejected and accepted by supplier and material.', filters: ['company', 'project', 'supplier', 'spec', 'period'], folder: 'Stock', build: (f) => [sheetSupplierReceived(f)] },
  { id: 'material_reconciliation', title: 'Material Reconciliation', group: 'Stock & materials', description: 'Ordered → received → accepted → consumed → balance for each material.', filters: ['company', 'project', 'spec', 'date'], folder: 'Stock', build: (f) => [sheetReconciliation(f)] },
  { id: 'consumption_register', title: 'Material Consumption Register', group: 'Registers', template: 11, description: 'Daily usage by road section and activity.', filters: ['company', 'project', 'spec', 'period'], folder: 'Consumption', build: (f) => [sheetConsumption(f)] },
  { id: 'consumption_summary', title: 'Consumption Summary', group: 'Stock & materials', description: 'Consumption totals by project, activity and material.', filters: ['company', 'project', 'spec', 'period'], folder: 'Consumption', build: (f) => [sheetConsumptionSummary(f)] },
  { id: 'planned_vs_actual', title: 'Planned vs Actual Consumption', group: 'Stock & materials', description: 'Your planned quantities against recorded consumption.', filters: ['company', 'project', 'spec', 'period'], folder: 'Consumption', build: (f) => [sheetPlannedVsActual(f)] },
  { id: 'supplier_ledger', title: 'Supplier Ledger', group: 'Finance', template: 12, description: 'Invoices, payments and running balance for one supplier.', filters: ['company', 'project', 'supplier', 'period'], requires: ['supplier'], folder: 'Finance', build: (f) => [sheetLedger(f)] },
  { id: 'payment_register', title: 'Payment Register', group: 'Finance', template: 13, description: 'All payments, advances and credit notes.', filters: ['company', 'project', 'supplier', 'period'], folder: 'Finance', build: (f) => [sheetPayments(f)] },
  { id: 'invoice_register', title: 'Supplier Invoice Register', group: 'Finance', description: 'Invoices with verification, approval and payment status.', filters: ['company', 'project', 'supplier', 'period'], folder: 'Finance', build: (f) => [sheetInvoices(f)] },
  { id: 'outstanding_bills', title: 'Outstanding Supplier Bills', group: 'Finance', description: 'Unpaid and part-paid invoices with ageing.', filters: ['company', 'project', 'supplier'], folder: 'Finance', build: (f) => [sheetOutstanding(f)] },
  { id: 'supplier_statement', title: 'Monthly Supplier Statement', group: 'Finance', description: 'Statement of account for one supplier for a month.', filters: ['company', 'project', 'supplier', 'month'], requires: ['supplier', 'month'], folder: 'Finance', build: supplierStatement },
  { id: 'project_expense', title: 'Project-wise Expense Report', group: 'Finance', description: 'Material expense by project, with billed vs paid.', filters: ['company', 'project', 'supplier', 'period'], folder: 'Finance', build: (f) => [sheetProjectExpense(f), sheetProjectInvoiceExpense(f)] },
  { id: 'quality_register', title: 'Quality Control Register', group: 'Registers', template: 14, description: 'Test records with the limits and standards you entered.', filters: ['company', 'project', 'supplier', 'spec', 'period'], folder: 'Quality', build: (f) => [sheetQuality(f)] },
  { id: 'measurement_book', title: 'Measurement Book', group: 'Registers', template: 15, description: 'Current measurements, with full revision history on a second sheet.', filters: ['company', 'project', 'period'], folder: 'Measurement', build: (f) => [sheetMeasurement(f), sheetMeasurementHistory(f)] },
  { id: 'daily_progress', title: 'Daily Progress Register', group: 'Registers', template: 16, description: 'Daily progress, site diary and road-work entries.', filters: ['company', 'project', 'period'], folder: 'Progress', build: (f) => [sheetProgress(f)] },
  { id: 'daily_report', title: 'Daily Report', group: 'Daily & monthly', template: 17, description: 'One day: purchases, receipts, royalty, consumption, stock balance, invoices and payments.', filters: ['company', 'project', 'supplier', 'spec', 'date'], requires: ['date'], folder: 'Daily', build: dailyReport },
  { id: 'monthly_report', title: 'Monthly Report', group: 'Daily & monthly', template: 18, description: 'One month: supplier purchases, material quantities, project expense, stock reconciliation, outstanding bills, royalty and consumption.', filters: ['company', 'project', 'supplier', 'spec', 'month'], requires: ['month'], folder: 'Monthly', build: monthlyReport },
];

export function getReportDef(id: string): ReportDef {
  const d = REPORTS.find((r) => r.id === id);
  if (!d) throw validation('Unknown report.');
  return d;
}

export function buildReport(id: string, raw: ReportFilters): { def: ReportDef; spec: ReportSpec; resolved: Resolved } {
  const def = getReportDef(id);
  for (const need of def.requires ?? []) {
    if (need === 'supplier' && !raw.supplierId) throw validation('Choose a supplier for this report.');
    if (need === 'month' && !raw.month) throw validation('Choose a month for this report.');
    if (need === 'date' && !raw.date) throw validation('Choose a date for this report.');
  }
  const resolved = resolve(raw);
  const sheets = def.build(resolved);
  const spec: ReportSpec = {
    title: def.title,
    companyName: resolved.companyName || 'All companies',
    projectName: resolved.projectName,
    period: def.filters.some((x) => x === 'period' || x === 'month' || x === 'date') ? periodLabel(resolved) : null,
    filtersNote: [resolved.supplierName ? `Supplier: ${resolved.supplierName}` : null].filter(Boolean).join('  •  ') || null,
    orientation: 'landscape',
    sheets,
  };
  return { def, spec, resolved };
}
