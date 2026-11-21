/**
 * Declarative definitions for every simple register in the application.
 * The SAME definitions drive: SQL column whitelists + validation (main process),
 * forms, tables and filters (renderer). Bespoke modules (purchases, inward,
 * inventory, documents, reports) have their own screens but reuse these types.
 *
 * Storage conventions (see num.ts):  *_paise = money, *_milli = qty, *_bp = percent x100.
 */
import { evaluateFormula } from './formula';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'int'
  | 'number'
  | 'money'
  | 'qty'
  | 'pct'
  | 'date'
  | 'datetime'
  | 'select'
  | 'ref'
  | 'bool';

export type RefKind =
  | 'company'
  | 'project'
  | 'supplier'
  | 'category'
  | 'material'
  | 'spec'
  | 'unit'
  | 'activity'
  | 'formula'
  | 'testType'
  | 'receipt'
  | 'invoice'
  | 'purchase';

export interface Opt {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** shown but computed by the system */
  readOnly?: boolean;
  options?: Opt[];
  ref?: RefKind;
  /** another form field whose value narrows this reference list (e.g. project <- company_id) */
  refParent?: string;
  /** DB column on the referenced table used with refParent (defaults to the parent key) */
  refParentColumn?: string;
  /** on pick, copy meta keys of the chosen option into other fields: { targetField: metaKey } */
  fills?: Record<string, string>;
  /** for qty fields: name of the field that holds the unit code */
  unitField?: string;
  help?: string;
  placeholder?: string;
  /** grid span out of 6 columns (default 3) */
  span?: 1 | 2 | 3 | 4 | 6;
  /** show as a column in the register table */
  table?: boolean;
  default?: any;
  section?: string;
  uppercase?: boolean;
}

export interface FilterDef {
  key: string;
  label: string;
  type: 'ref' | 'select';
  ref?: RefKind;
  options?: Opt[];
  /** column on the module table (defaults to key) */
  column?: string;
}

export interface ModuleDef {
  id: string;
  title: string;
  singular: string;
  table: string;
  description: string;
  fields: FieldDef[];
  derive?: (v: Record<string, any>) => Record<string, any>;
  filters?: FilterDef[];
  /** date column used by the period filter */
  dateKey?: string;
  searchKeys: string[];
  sortBy: string;
  /** table has deleted_at */
  softDelete: boolean;
  /** column holding status text (for chips + archive filter) */
  statusKey?: string;
  /** auto-generated reference number */
  numberKey?: { key: string; prefix: string; dateKey?: string };
  /** attach documents of this doc_type to records */
  attach?: { docType: string; entityType: string };
  /** table has company_id */
  hasCompany?: boolean;
  /** table has project_id */
  hasProject?: boolean;
  /** primary label for record (ref labels, history) */
  labelKeys: string[];
  addLabel?: string;
  emptyHint?: string;
}

const yesNo: Opt[] = [
  { value: '1', label: 'Yes' },
  { value: '0', label: 'No' },
];
void yesNo;

export const PROJECT_STATUS: Opt[] = [
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'closed', label: 'Closed' },
];
export const SUPPLIER_STATUS: Opt[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'blocked', label: 'Blocked' },
];
export const VERIFY_STATUS: Opt[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'verified', label: 'Verified' },
  { value: 'disputed', label: 'Disputed' },
];
export const APPROVAL_STATUS: Opt[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];
export const RECORD_STATUS: Opt[] = [
  { value: 'active', label: 'Active' },
  { value: 'cancelled', label: 'Cancelled' },
];
export const PAYMENT_KIND: Opt[] = [
  { value: 'payment', label: 'Payment' },
  { value: 'advance', label: 'Advance' },
  { value: 'credit_note', label: 'Credit note' },
];
export const PAYMENT_MODE: Opt[] = [
  { value: 'neft', label: 'NEFT' },
  { value: 'rtgs', label: 'RTGS' },
  { value: 'imps', label: 'IMPS' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
];
export const PAYMENT_STATUS: Opt[] = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partly paid' },
  { value: 'paid', label: 'Paid' },
];
export const PO_STATUS: Opt[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'cancelled', label: 'Cancelled' },
];
export const TAX_TREATMENT: Opt[] = [
  { value: 'exclusive', label: 'Tax extra (rate excludes tax)' },
  { value: 'inclusive', label: 'Tax included in rate' },
  { value: 'exempt', label: 'No tax' },
];
export const ROYALTY_VERIFY: Opt[] = [
  { value: 'unverified', label: 'Not verified' },
  { value: 'verified', label: 'Verified by user' },
  { value: 'discrepancy', label: 'Discrepancy' },
  { value: 'rejected', label: 'Rejected' },
];
export const TEST_RESULT: Opt[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'na', label: 'Not applicable' },
];
export const PROGRESS_REGISTER: Opt[] = [
  { value: 'progress', label: 'Daily Progress' },
  { value: 'site_diary', label: 'Site Diary' },
  { value: 'road_work', label: 'Road Work Register' },
];
export const WEIGHT_UNIT_OPTS: Opt[] = [
  { value: 'MT', label: 'MT' },
  { value: 'Ton', label: 'Ton' },
  { value: 'Kg', label: 'Kg' },
  { value: 'Quintal', label: 'Quintal' },
];
export const STOCK_TXN_TYPES: Opt[] = [
  { value: 'opening', label: 'Opening stock' },
  { value: 'inward', label: 'Material inward' },
  { value: 'return', label: 'Return to stock' },
  { value: 'outward', label: 'Material outward / transfer' },
  { value: 'consumption', label: 'Consumption' },
  { value: 'adjustment', label: 'Stock adjustment' },
  { value: 'rejected', label: 'Rejected material' },
];

const TXN_SIGN: Record<string, 1 | -1 | 0> = {
  opening: 1,
  inward: 1,
  return: 1,
  outward: -1,
  consumption: -1,
  adjustment: 1, // adjustment carries its own sign
  rejected: 0,
};
export const stockSign = (t: string) => TXN_SIGN[t] ?? 0;

/** Pure compute helpers shared by client preview and server authority */
export function netWeight(gross?: number | null, tare?: number | null): number | null {
  if (gross === null || gross === undefined || tare === null || tare === undefined) return null;
  return gross - tare;
}

export function judgeTest(v: Record<string, any>): string | null {
  const num = parseFloat(String(v.result_value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(num)) return null;
  const hasMin = v.limit_min !== null && v.limit_min !== undefined && v.limit_min !== '';
  const hasMax = v.limit_max !== null && v.limit_max !== undefined && v.limit_max !== '';
  if (!hasMin && !hasMax) return null;
  if (hasMin && num < Number(v.limit_min)) return 'fail';
  if (hasMax && num > Number(v.limit_max)) return 'fail';
  return 'pass';
}

export function measureQty(v: Record<string, any>): number | null {
  const dims: Record<string, number> = {
    L: (v.length_milli ?? 0) / 1000,
    W: (v.width_milli ?? 0) / 1000,
    D: (v.depth_milli ?? 0) / 1000,
    N: (v.nos_milli ?? 1000) / 1000,
  };
  try {
    if (v.__formula && String(v.__formula).trim()) {
      return Math.round(evaluateFormula(String(v.__formula), dims) * 1000);
    }
    // default: product of the dimensions that were entered
    let p = 1;
    let any = false;
    for (const k of ['length_milli', 'width_milli', 'depth_milli'] as const) {
      if (v[k] !== null && v[k] !== undefined) {
        p *= v[k] / 1000;
        any = true;
      }
    }
    if (!any) return null;
    p *= dims.N;
    return Math.round(p * 1000);
  } catch {
    return null;
  }
}

// Company is a column only where it adds information (the Projects list); elsewhere the top-bar scope already narrows it.
const COMPANY: FieldDef = { key: 'company_id', label: 'Company', type: 'ref', ref: 'company', required: true, table: false, span: 3 };
const PROJECT: FieldDef = {
  key: 'project_id',
  label: 'Project / site',
  type: 'ref',
  ref: 'project',
  refParent: 'company_id',
  refParentColumn: 'company_id',
  required: true,
  table: true,
  span: 3,
};
const COMPANY_PROJECT_FILTERS: FilterDef[] = [
  { key: 'company_id', label: 'Company', type: 'ref', ref: 'company' },
  { key: 'project_id', label: 'Project', type: 'ref', ref: 'project' },
];

export const MODULES: Record<string, ModuleDef> = {
  projects: {
    id: 'projects',
    title: 'Projects',
    singular: 'Project',
    table: 'projects',
    description: 'Road construction projects and work orders, grouped under each company.',
    searchKeys: ['name', 'code', 'client_name', 'location', 'agreement_no'],
    sortBy: 'updated_at DESC',
    softDelete: true,
    statusKey: 'status',
    hasCompany: true,
    labelKeys: ['name'],
    addLabel: 'New project',
    filters: [
      { key: 'company_id', label: 'Company', type: 'ref', ref: 'company' },
      { key: 'status', label: 'Status', type: 'select', options: PROJECT_STATUS },
    ],
    fields: [
      { ...COMPANY, table: true },
      { key: 'name', label: 'Project name', type: 'text', required: true, table: true, span: 3, placeholder: 'e.g. Widening of Dholka–Bagodara road, km 2/0 to 9/500' },
      { key: 'code', label: 'Project code', type: 'text', table: true, span: 2 },
      { key: 'client_name', label: 'Client / authority', type: 'text', table: true, span: 2, placeholder: 'R&B Dept., NHAI, Municipal Corporation…' },
      { key: 'status', label: 'Status', type: 'select', options: PROJECT_STATUS, default: 'active', table: true, span: 2 },
      { key: 'location', label: 'Location / road', type: 'text', table: true, span: 3 },
      { key: 'agreement_no', label: 'Agreement / work order no.', type: 'text', span: 3 },
      { key: 'agreement_date', label: 'Agreement date', type: 'date', span: 2 },
      { key: 'start_date', label: 'Start date', type: 'date', span: 2 },
      { key: 'end_date', label: 'Scheduled completion', type: 'date', span: 2 },
      { key: 'contract_value_paise', label: 'Contract value', type: 'money', table: true, span: 3 },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 6 },
    ],
  },

  categories: {
    id: 'categories',
    title: 'Material categories',
    singular: 'Category',
    table: 'material_categories',
    description: 'Top level of the material hierarchy: Aggregate, Dust, Bitumen, Cement…',
    searchKeys: ['name'],
    sortBy: 'sort_order ASC, name ASC',
    softDelete: true,
    labelKeys: ['name'],
    addLabel: 'New category',
    fields: [
      { key: 'name', label: 'Category name', type: 'text', required: true, table: true, span: 3 },
      { key: 'default_unit', label: 'Default unit', type: 'ref', ref: 'unit', table: true, span: 2 },
      { key: 'sort_order', label: 'Sort order', type: 'int', default: 0, span: 2 },
      { key: 'active', label: 'Active', type: 'bool', default: 1, table: true, span: 2 },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 6 },
    ],
  },

  materials: {
    id: 'materials',
    title: 'Materials',
    singular: 'Material',
    table: 'materials',
    description: 'Materials inside a category. Each material can hold many sizes / grades.',
    searchKeys: ['name', 'description'],
    sortBy: 'category_id__label ASC, name ASC',
    softDelete: true,
    labelKeys: ['name'],
    addLabel: 'New material',
    filters: [{ key: 'category_id', label: 'Category', type: 'ref', ref: 'category' }],
    fields: [
      { key: 'category_id', label: 'Category', type: 'ref', ref: 'category', required: true, table: true, span: 3 },
      { key: 'name', label: 'Material name', type: 'text', required: true, table: true, span: 3 },
      { key: 'default_unit', label: 'Default unit', type: 'ref', ref: 'unit', table: true, span: 2 },
      { key: 'requires_royalty', label: 'Needs royalty / transit pass', type: 'bool', default: 0, table: true, span: 2, help: 'Inward receipts of this material are flagged when no royalty pass is linked.' },
      { key: 'active', label: 'Active', type: 'bool', default: 1, table: true, span: 2 },
      { key: 'description', label: 'Description', type: 'text', span: 6 },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 6 },
    ],
  },

  specs: {
    id: 'specs',
    title: 'Specifications (sizes / grades)',
    singular: 'Specification',
    table: 'material_specifications',
    description: 'Sizes and grades such as 20 MM, VG-30, Stone Dust. Stock, rates and purchases are tracked per specification.',
    searchKeys: ['size_grade', 'description'],
    sortBy: 'material_id__label ASC, size_grade ASC',
    softDelete: true,
    labelKeys: ['size_grade'],
    addLabel: 'New specification',
    filters: [
      { key: 'material_id', label: 'Material', type: 'ref', ref: 'material' },
    ],
    fields: [
      { key: 'material_id', label: 'Material', type: 'ref', ref: 'material', required: true, table: true, span: 3 },
      { key: 'size_grade', label: 'Size / grade', type: 'text', required: true, table: true, span: 3, placeholder: '20 MM, VG-30, Standard…' },
      { key: 'unit_code', label: 'Unit', type: 'ref', ref: 'unit', required: true, table: true, span: 2 },
      { key: 'standard_rate_paise', label: 'Standard rate (per unit)', type: 'money', table: true, span: 2, help: 'Reference only. Actual rates are recorded per supplier and per purchase.' },
      { key: 'min_stock_milli', label: 'Minimum stock level', type: 'qty', unitField: 'unit_code', table: true, span: 2, help: 'Low-stock alerts use this value.' },
      { key: 'active', label: 'Active', type: 'bool', default: 1, table: true, span: 2 },
      { key: 'description', label: 'Description', type: 'text', span: 6 },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 6 },
    ],
  },

  suppliers: {
    id: 'suppliers',
    title: 'Suppliers',
    singular: 'Supplier',
    table: 'suppliers',
    description: 'Crushers, bitumen depots, quarries, transporters and other suppliers.',
    searchKeys: ['name', 'business_name', 'contact_person', 'mobile', 'gst_no', 'pan_no', 'code'],
    sortBy: 'name ASC',
    softDelete: true,
    statusKey: 'status',
    numberKey: { key: 'code', prefix: 'SUP' },
    labelKeys: ['name'],
    addLabel: 'New supplier',
    filters: [{ key: 'status', label: 'Status', type: 'select', options: SUPPLIER_STATUS }],
    fields: [
      { key: 'code', label: 'Supplier ID', type: 'text', readOnly: true, table: true, span: 2, help: 'Generated automatically' },
      { key: 'name', label: 'Supplier name', type: 'text', required: true, table: true, span: 4 },
      { key: 'business_name', label: 'Business / firm name', type: 'text', span: 3 },
      { key: 'contact_person', label: 'Contact person', type: 'text', table: true, span: 3 },
      { key: 'mobile', label: 'Mobile', type: 'text', table: true, span: 2 },
      { key: 'alt_contact', label: 'Alternate contact', type: 'text', span: 2 },
      { key: 'email', label: 'Email', type: 'text', span: 2 },
      { key: 'address', label: 'Address', type: 'textarea', span: 6 },
      { key: 'gst_no', label: 'GST number', type: 'text', uppercase: true, table: true, span: 3 },
      { key: 'pan_no', label: 'PAN number', type: 'text', uppercase: true, span: 3 },
      { key: 'bank_name', label: 'Bank name', type: 'text', span: 2, section: 'Bank details (optional)' },
      { key: 'bank_account', label: 'Account number', type: 'text', span: 2 },
      { key: 'bank_ifsc', label: 'IFSC', type: 'text', uppercase: true, span: 2 },
      { key: 'contract_start', label: 'Contract start', type: 'date', span: 2, section: 'Terms' },
      { key: 'contract_end', label: 'Contract end', type: 'date', span: 2 },
      { key: 'status', label: 'Status', type: 'select', options: SUPPLIER_STATUS, default: 'active', table: true, span: 2 },
      { key: 'payment_terms', label: 'Payment terms', type: 'text', span: 6, placeholder: 'e.g. 30 days from invoice, 50% advance' },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 6 },
    ],
  },

  supplierMaterials: {
    id: 'supplierMaterials',
    title: 'Supplier material rates',
    singular: 'Supplier rate',
    table: 'supplier_materials',
    description: 'Which specifications each supplier can supply, and at what rate.',
    searchKeys: [],
    sortBy: 'supplier_id ASC',
    softDelete: true,
    labelKeys: ['spec_id'],
    filters: [{ key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'supplier' }],
    fields: [
      { key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'supplier', required: true, table: true, span: 3 },
      { key: 'spec_id', label: 'Material specification', type: 'ref', ref: 'spec', required: true, table: true, span: 3, fills: { unit_code: 'unit_code' } },
      { key: 'rate_paise', label: 'Rate (per unit)', type: 'money', required: true, table: true, span: 2 },
      { key: 'tax_bp', label: 'Default tax %', type: 'pct', table: true, span: 2 },
      { key: 'active', label: 'Active', type: 'bool', default: 1, table: true, span: 2 },
      { key: 'notes', label: 'Notes', type: 'text', span: 6 },
    ],
  },

  activities: {
    id: 'activities',
    title: 'Work activities',
    singular: 'Activity',
    table: 'work_activities',
    description: 'Configurable list of road-work activities used by consumption and progress registers.',
    searchKeys: ['name'],
    sortBy: 'sort_order ASC, name ASC',
    softDelete: true,
    labelKeys: ['name'],
    addLabel: 'New activity',
    fields: [
      { key: 'name', label: 'Activity', type: 'text', required: true, table: true, span: 4 },
      { key: 'sort_order', label: 'Sort order', type: 'int', default: 0, span: 1 },
      { key: 'active', label: 'Active', type: 'bool', default: 1, table: true, span: 1 },
    ],
  },

  testTypes: {
    id: 'testTypes',
    title: 'Test types',
    singular: 'Test type',
    table: 'test_types',
    description: 'Configurable list of laboratory and field tests. Acceptance limits are always entered by you per record, citing the governing specification.',
    searchKeys: ['name', 'group_name', 'default_standard'],
    sortBy: 'group_name ASC, name ASC',
    softDelete: true,
    labelKeys: ['name'],
    addLabel: 'New test type',
    fields: [
      { key: 'name', label: 'Test name', type: 'text', required: true, table: true, span: 3 },
      { key: 'group_name', label: 'Group', type: 'text', table: true, span: 3, placeholder: 'Aggregate, Bitumen, Soil, Concrete…' },
      { key: 'default_unit', label: 'Usual unit', type: 'text', table: true, span: 2 },
      { key: 'default_standard', label: 'Reference standard (your choice)', type: 'text', table: true, span: 4, help: 'Optional default, e.g. a code and edition you follow. Not applied automatically as a limit.' },
      { key: 'active', label: 'Active', type: 'bool', default: 1, span: 2 },
    ],
  },

  formulas: {
    id: 'formulas',
    title: 'Quantity formulas',
    singular: 'Formula',
    table: 'quantity_formulas',
    description: 'Your own measurement formulas. Variables: L (length), W (width), D (depth/height), N (number). Nothing is assumed by the system.',
    searchKeys: ['name', 'expression'],
    sortBy: 'name ASC',
    softDelete: true,
    labelKeys: ['name'],
    addLabel: 'New formula',
    fields: [
      { key: 'name', label: 'Formula name', type: 'text', required: true, table: true, span: 3 },
      { key: 'expression', label: 'Expression', type: 'text', required: true, table: true, span: 3, placeholder: 'N*L*W*D', uppercase: true },
      { key: 'unit_code', label: 'Result unit', type: 'ref', ref: 'unit', table: true, span: 2 },
      { key: 'description', label: 'Description / assumption', type: 'text', span: 4 },
      { key: 'active', label: 'Active', type: 'bool', default: 1, span: 2 },
    ],
  },

  units: {
    id: 'units',
    title: 'Units',
    singular: 'Unit',
    table: 'units',
    description: 'Measurement units and their conversion factor to the base unit of their kind (weight: kg, volume: m³, liquid: litre).',
    searchKeys: ['code', 'name'],
    sortBy: 'sort_order ASC, code ASC',
    softDelete: false,
    labelKeys: ['code'],
    addLabel: 'New unit',
    fields: [
      { key: 'code', label: 'Unit code', type: 'text', required: true, table: true, span: 2 },
      { key: 'name', label: 'Name', type: 'text', required: true, table: true, span: 2 },
      {
        key: 'kind',
        label: 'Kind',
        type: 'select',
        required: true,
        table: true,
        span: 2,
        options: [
          { value: 'weight', label: 'Weight' },
          { value: 'volume', label: 'Volume' },
          { value: 'liquid', label: 'Liquid' },
          { value: 'count', label: 'Count' },
          { value: 'length', label: 'Length' },
          { value: 'area', label: 'Area' },
        ],
      },
      { key: 'to_base', label: 'Factor to base unit', type: 'number', required: true, table: true, default: 1, span: 3, help: 'Weight base = kg, volume base = m³, liquid base = litre.' },
      { key: 'active', label: 'Active', type: 'bool', default: 1, table: true, span: 3 },
    ],
  },

  invoices: {
    id: 'invoices',
    title: 'Supplier invoices',
    singular: 'Invoice',
    table: 'invoices',
    description: 'Bills received from suppliers: verify, approve and track payment.',
    searchKeys: ['invoice_no', 'notes'],
    sortBy: 'invoice_date DESC, created_at DESC',
    softDelete: true,
    statusKey: 'approval_status',
    dateKey: 'invoice_date',
    hasCompany: true,
    hasProject: true,
    attach: { docType: 'invoice', entityType: 'invoice' },
    labelKeys: ['invoice_no'],
    addLabel: 'New invoice',
    filters: [
      ...COMPANY_PROJECT_FILTERS,
      { key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'supplier' },
      { key: 'payment_status', label: 'Payment', type: 'select', options: PAYMENT_STATUS },
      { key: 'approval_status', label: 'Approval', type: 'select', options: APPROVAL_STATUS },
    ],
    derive: (v) => ({ total_paise: (v.subtotal_paise || 0) + (v.tax_paise || 0) + (v.other_paise || 0) }),
    fields: [
      { key: 'invoice_no', label: 'Invoice number', type: 'text', required: true, table: true, span: 2, uppercase: true },
      { key: 'invoice_date', label: 'Invoice date', type: 'date', required: true, table: true, default: 'today', span: 2 },
      { key: 'due_date', label: 'Due date', type: 'date', span: 2 },
      { ...COMPANY },
      { ...PROJECT, required: false, table: false },
      { key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'supplier', required: true, table: true, span: 3 },
      { key: 'purchase_id', label: 'Against purchase order', type: 'ref', ref: 'purchase', refParent: 'supplier_id', refParentColumn: 'supplier_id', span: 3 },
      { key: 'subtotal_paise', label: 'Taxable amount', type: 'money', required: true, span: 2 },
      { key: 'tax_paise', label: 'Tax amount', type: 'money', span: 2 },
      { key: 'other_paise', label: 'Freight / other', type: 'money', span: 2 },
      { key: 'total_paise', label: 'Invoice total', type: 'money', readOnly: true, table: true, span: 2 },
      { key: 'verification_status', label: 'Verification', type: 'select', options: VERIFY_STATUS, default: 'pending', table: true, span: 2 },
      { key: 'approval_status', label: 'Approval', type: 'select', options: APPROVAL_STATUS, default: 'pending', table: true, span: 2 },
      { key: 'payment_status', label: 'Payment', type: 'select', options: PAYMENT_STATUS, readOnly: true, table: true, span: 2 },
      { key: 'status', label: 'Record status', type: 'select', options: RECORD_STATUS, default: 'active', span: 2 },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 6 },
    ],
  },

  payments: {
    id: 'payments',
    title: 'Supplier payments',
    singular: 'Payment',
    table: 'supplier_payments',
    description: 'Payments, advances and credit notes. Supplier balances are always calculated from these entries.',
    searchKeys: ['reference_no', 'notes'],
    sortBy: 'payment_date DESC, created_at DESC',
    softDelete: true,
    statusKey: 'kind',
    dateKey: 'payment_date',
    hasCompany: true,
    hasProject: true,
    attach: { docType: 'payment_proof', entityType: 'payment' },
    labelKeys: ['reference_no'],
    addLabel: 'Record payment',
    filters: [
      ...COMPANY_PROJECT_FILTERS,
      { key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'supplier' },
      { key: 'kind', label: 'Type', type: 'select', options: PAYMENT_KIND },
    ],
    fields: [
      { key: 'payment_date', label: 'Date', type: 'date', required: true, table: true, default: 'today', span: 2 },
      { key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'supplier', required: true, table: true, span: 4 },
      { key: 'kind', label: 'Type', type: 'select', options: PAYMENT_KIND, default: 'payment', required: true, table: true, span: 2 },
      { key: 'amount_paise', label: 'Amount', type: 'money', required: true, table: true, span: 2 },
      { key: 'mode', label: 'Mode', type: 'select', options: PAYMENT_MODE, table: true, span: 2 },
      { key: 'reference_no', label: 'Cheque / UTR / reference', type: 'text', table: true, span: 3 },
      { ...COMPANY },
      { ...PROJECT, required: false, table: false },
      { key: 'invoice_id', label: 'Against invoice (optional)', type: 'ref', ref: 'invoice', refParent: 'supplier_id', refParentColumn: 'supplier_id', span: 6, help: 'Leave blank for an on-account payment or advance.' },
      { key: 'status', label: 'Record status', type: 'select', options: RECORD_STATUS, default: 'active', span: 2 },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 6 },
    ],
  },

  royalty: {
    id: 'royalty',
    title: 'Royalty & Transit Passes',
    singular: 'Royalty pass',
    table: 'royalty_passes',
    description:
      'Register of royalty / e-permit / transit pass details copied from the original documents. Nothing here is verified against any government system — verification is recorded manually by you.',
    searchKeys: ['pass_no', 'e_permit_no', 'vehicle_no', 'lease_holder', 'mineral_name', 'destination'],
    sortBy: 'dispatch_at DESC, created_at DESC',
    softDelete: true,
    statusKey: 'verification_status',
    dateKey: 'dispatch_at',
    hasCompany: true,
    hasProject: true,
    attach: { docType: 'royalty_pass', entityType: 'royalty' },
    labelKeys: ['pass_no'],
    addLabel: 'Add royalty pass',
    filters: [
      ...COMPANY_PROJECT_FILTERS,
      { key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'supplier' },
      { key: 'verification_status', label: 'Verification', type: 'select', options: ROYALTY_VERIFY },
    ],
    derive: (v) => {
      const n = netWeight(v.gross_milli, v.tare_milli);
      return n === null ? {} : { net_milli: n };
    },
    fields: [
      { key: 'pass_no', label: 'Royalty / transit pass no.', type: 'text', required: true, table: true, uppercase: true, span: 2 },
      { key: 'e_permit_no', label: 'E-permit no.', type: 'text', table: true, uppercase: true, span: 2 },
      { key: 'dispatch_at', label: 'Dispatch date & time', type: 'datetime', required: true, table: true, default: 'now', span: 2 },
      { key: 'mineral_name', label: 'Mineral', type: 'text', table: true, span: 2, placeholder: 'e.g. Ordinary stone / Bajri / Sand' },
      { key: 'grade', label: 'Material grade / size', type: 'text', span: 2 },
      { key: 'lease_holder', label: 'Lease holder', type: 'text', span: 2 },
      { key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'supplier', table: true, span: 3 },
      { key: 'source_location', label: 'Source location (mine / lease)', type: 'text', span: 3 },
      { key: 'vehicle_no', label: 'Vehicle number', type: 'text', required: true, uppercase: true, table: true, span: 2 },
      { key: 'driver_name', label: 'Driver name', type: 'text', span: 2 },
      { key: 'driver_mobile', label: 'Driver mobile', type: 'text', span: 2 },
      { key: 'weight_unit', label: 'Weight unit', type: 'select', options: WEIGHT_UNIT_OPTS, default: 'MT', span: 2, section: 'Weights' },
      { key: 'gross_milli', label: 'Gross weight', type: 'qty', unitField: 'weight_unit', span: 2 },
      { key: 'tare_milli', label: 'Tare weight', type: 'qty', unitField: 'weight_unit', span: 2 },
      { key: 'net_milli', label: 'Net mineral quantity', type: 'qty', unitField: 'weight_unit', table: true, span: 3, help: 'Net = Gross − Tare. If you only have the net figure from the pass, enter it directly.' },
      { key: 'royalty_amount_paise', label: 'Royalty amount (if known)', type: 'money', span: 3 },
      { ...COMPANY, section: 'Destination' },
      { ...PROJECT, required: false },
      { key: 'destination', label: 'Destination', type: 'text', span: 6 },
      { key: 'valid_from', label: 'Valid from', type: 'datetime', span: 3, section: 'Validity' },
      { key: 'valid_to', label: 'Valid until', type: 'datetime', span: 3 },
      { key: 'receipt_id', label: 'Linked material inward', type: 'ref', ref: 'receipt', span: 3, section: 'Links & verification' },
      { key: 'invoice_id', label: 'Linked supplier invoice', type: 'ref', ref: 'invoice', refParent: 'supplier_id', refParentColumn: 'supplier_id', span: 3 },
      { key: 'verification_status', label: 'Verification status', type: 'select', options: ROYALTY_VERIFY, default: 'unverified', table: true, span: 2 },
      { key: 'verified_by', label: 'Verified by', type: 'text', span: 2 },
      { key: 'verified_on', label: 'Verified on', type: 'date', span: 2 },
      { key: 'verification_notes', label: 'Verification notes', type: 'textarea', span: 6, help: 'How you verified it (e.g. checked on the official portal on <date>, called mine office…).' },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 6 },
    ],
  },

  royaltyRates: {
    id: 'royaltyRates',
    title: 'Royalty rates',
    singular: 'Royalty rate',
    table: 'royalty_rates',
    description:
      'Effective-dated royalty rates that YOU maintain from official notifications. They are used only to suggest an amount; the official rate is always the authority.',
    searchKeys: ['mineral_name', 'grade', 'reference_note'],
    sortBy: 'mineral_name ASC, effective_from DESC',
    softDelete: true,
    labelKeys: ['mineral_name'],
    addLabel: 'Add rate',
    fields: [
      { key: 'mineral_name', label: 'Mineral', type: 'text', required: true, table: true, span: 3 },
      { key: 'grade', label: 'Grade / size (optional)', type: 'text', table: true, span: 3 },
      { key: 'unit_code', label: 'Unit', type: 'ref', ref: 'unit', required: true, table: true, span: 2 },
      { key: 'rate_paise', label: 'Rate per unit', type: 'money', required: true, table: true, span: 2 },
      { key: 'effective_from', label: 'Effective from', type: 'date', required: true, table: true, span: 2 },
      { key: 'effective_to', label: 'Effective until', type: 'date', table: true, span: 3 },
      { key: 'reference_note', label: 'Notification / reference', type: 'text', table: true, span: 3, placeholder: 'Notification no. & date' },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 6 },
    ],
  },

  consumption: {
    id: 'consumption',
    title: 'Material Consumption',
    singular: 'Consumption entry',
    table: 'material_consumption',
    description: 'Daily material usage against road sections and work activities. Posting reduces stock automatically.',
    searchKeys: ['site_location', 'chainage_from', 'chainage_to', 'equipment', 'remarks'],
    sortBy: 'usage_date DESC, created_at DESC',
    softDelete: true,
    dateKey: 'usage_date',
    hasCompany: true,
    hasProject: true,
    attach: { docType: 'consumption_support', entityType: 'consumption' },
    labelKeys: ['usage_date'],
    addLabel: 'Record consumption',
    filters: [
      ...COMPANY_PROJECT_FILTERS,
      { key: 'activity_id', label: 'Activity', type: 'ref', ref: 'activity' },
      { key: 'spec_id', label: 'Material', type: 'ref', ref: 'spec' },
    ],
    fields: [
      { key: 'usage_date', label: 'Date', type: 'date', required: true, table: true, default: 'today', span: 2 },
      { ...COMPANY, span: 2, table: false },
      { ...PROJECT, span: 2 },
      { key: 'site_location', label: 'Site location', type: 'text', table: true, span: 3 },
      { key: 'chainage_from', label: 'Chainage from', type: 'text', table: true, span: 1, placeholder: '2+500' },
      { key: 'chainage_to', label: 'Chainage to', type: 'text', table: true, span: 2, placeholder: '2+800' },
      { key: 'activity_id', label: 'Work activity', type: 'ref', ref: 'activity', table: true, span: 3 },
      { key: 'spec_id', label: 'Material & specification', type: 'ref', ref: 'spec', required: true, table: true, span: 3, fills: { unit_code: 'unit_code' } },
      { key: 'qty_milli', label: 'Quantity used', type: 'qty', required: true, unitField: 'unit_code', table: true, span: 2 },
      { key: 'unit_code', label: 'Unit', type: 'ref', ref: 'unit', readOnly: true, span: 2 },
      { key: 'stock_location', label: 'Taken from stock location', type: 'text', default: 'Main Store', span: 2 },
      { key: 'equipment', label: 'Equipment / plant', type: 'text', table: true, span: 3 },
      { key: 'assumption_note', label: 'Assumptions (user-entered)', type: 'text', span: 3, help: 'Any basis or assumption behind this quantity, e.g. "estimated from truck count".' },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 6 },
    ],
  },

  consumptionPlans: {
    id: 'consumptionPlans',
    title: 'Planned consumption',
    singular: 'Planned quantity',
    table: 'consumption_plans',
    description: 'Planned quantities you enter per project / material / activity, compared against actual consumption in reports. The basis is yours, not the system’s.',
    searchKeys: ['basis_note'],
    sortBy: 'created_at DESC',
    softDelete: true,
    hasProject: true,
    labelKeys: ['basis_note'],
    addLabel: 'Add planned quantity',
    filters: [{ key: 'project_id', label: 'Project', type: 'ref', ref: 'project' }],
    fields: [
      { key: 'project_id', label: 'Project', type: 'ref', ref: 'project', required: true, table: true, span: 3 },
      { key: 'spec_id', label: 'Material & specification', type: 'ref', ref: 'spec', required: true, table: true, span: 3, fills: { unit_code: 'unit_code' } },
      { key: 'activity_id', label: 'Work activity (optional)', type: 'ref', ref: 'activity', table: true, span: 3 },
      { key: 'planned_qty_milli', label: 'Planned quantity', type: 'qty', required: true, unitField: 'unit_code', table: true, span: 2 },
      { key: 'unit_code', label: 'Unit', type: 'ref', ref: 'unit', readOnly: true, span: 1 },
      { key: 'basis_note', label: 'Basis / assumption', type: 'text', table: true, span: 6 },
    ],
  },

  quality: {
    id: 'quality',
    title: 'Quality Control',
    singular: 'Test record',
    table: 'quality_tests',
    description:
      'Laboratory and field test records. Acceptance limits and the governing standard (with edition) are always entered by you; the system only compares the result with the limits you record.',
    searchKeys: ['test_no', 'sample_id', 'laboratory', 'standard_ref', 'result_value', 'remarks'],
    sortBy: 'test_date DESC, created_at DESC',
    softDelete: true,
    statusKey: 'result_status',
    dateKey: 'test_date',
    numberKey: { key: 'test_no', prefix: 'QT', dateKey: 'test_date' },
    hasCompany: true,
    hasProject: true,
    attach: { docType: 'test_report', entityType: 'quality' },
    labelKeys: ['test_no'],
    addLabel: 'Add test record',
    filters: [
      ...COMPANY_PROJECT_FILTERS,
      { key: 'test_type_id', label: 'Test', type: 'ref', ref: 'testType' },
      { key: 'result_status', label: 'Result', type: 'select', options: TEST_RESULT },
      { key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'supplier' },
    ],
    derive: (v) => {
      const j = judgeTest(v);
      return j ? { result_status: j } : {};
    },
    fields: [
      { key: 'test_no', label: 'Test ID', type: 'text', readOnly: true, table: true, span: 2, help: 'Generated automatically' },
      { key: 'test_date', label: 'Test date', type: 'date', required: true, default: 'today', table: true, span: 2 },
      { key: 'sample_id', label: 'Sample ID', type: 'text', table: true, span: 2 },
      { ...COMPANY, table: false },
      { ...PROJECT, table: true },
      { key: 'spec_id', label: 'Material & specification', type: 'ref', ref: 'spec', table: true, span: 3 },
      { key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'supplier', span: 3 },
      { key: 'test_type_id', label: 'Test type', type: 'ref', ref: 'testType', required: true, table: true, span: 3, fills: { unit: 'unit', standard_ref: 'standard' } },
      { key: 'result_value', label: 'Test result', type: 'text', required: true, table: true, span: 2 },
      { key: 'unit', label: 'Unit', type: 'text', table: true, span: 1 },
      { key: 'standard_ref', label: 'Reference standard & edition', type: 'text', span: 6, section: 'Acceptance criteria (yours)', help: 'Name the governing specification and edition you are testing against.' },
      { key: 'limit_min', label: 'Minimum limit', type: 'number', span: 2 },
      { key: 'limit_max', label: 'Maximum limit', type: 'number', span: 2 },
      { key: 'limit_text', label: 'Limit description', type: 'text', span: 2, placeholder: 'e.g. 20–35 % passing' },
      { key: 'result_status', label: 'Pass / fail', type: 'select', options: TEST_RESULT, default: 'pending', table: true, span: 2, help: 'Set automatically when a numeric result and numeric limits are entered; otherwise choose manually.' },
      { key: 'laboratory', label: 'Laboratory', type: 'text', table: true, span: 4 },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 6 },
    ],
  },

  measurement: {
    id: 'measurement',
    title: 'Measurement Book',
    singular: 'Measurement',
    table: 'measurement_entries',
    description:
      'Measurements are never overwritten: editing an entry creates a new revision and keeps the original in history.',
    searchKeys: ['mb_no', 'work_description', 'chainage_from', 'chainage_to', 'boq_ref'],
    sortBy: 'measured_on DESC, created_at DESC',
    softDelete: true,
    dateKey: 'measured_on',
    hasCompany: true,
    hasProject: true,
    attach: { docType: 'measurement', entityType: 'measurement' },
    labelKeys: ['mb_no', 'work_description'],
    addLabel: 'New measurement',
    filters: [...COMPANY_PROJECT_FILTERS],
    derive: (v) => {
      const q = measureQty(v);
      return q === null ? {} : { qty_milli: q };
    },
    fields: [
      { key: 'mb_no', label: 'MB no. / page', type: 'text', required: true, table: true, span: 2 },
      { key: 'measured_on', label: 'Date', type: 'date', required: true, default: 'today', table: true, span: 2 },
      { key: 'revision', label: 'Revision', type: 'int', readOnly: true, table: true, span: 2 },
      { ...COMPANY, table: false },
      { ...PROJECT },
      { key: 'work_description', label: 'Work description', type: 'text', required: true, table: true, span: 6 },
      { key: 'chainage_from', label: 'Chainage from', type: 'text', table: true, span: 2, placeholder: '12+000' },
      { key: 'chainage_to', label: 'Chainage to', type: 'text', table: true, span: 2 },
      { key: 'boq_ref', label: 'BOQ item reference', type: 'text', table: true, span: 2 },
      { key: 'length_milli', label: 'Length (m)', type: 'qty', span: 2, section: 'Dimensions' },
      { key: 'width_milli', label: 'Width (m)', type: 'qty', span: 2 },
      { key: 'depth_milli', label: 'Depth / height (m)', type: 'qty', span: 2 },
      { key: 'nos_milli', label: 'Number of units', type: 'qty', default: 1000, span: 2 },
      { key: 'formula_id', label: 'Quantity formula', type: 'ref', ref: 'formula', span: 4, help: 'Blank = product of the dimensions you entered. Create custom formulas under Settings.' },
      { key: 'unit_code', label: 'Unit', type: 'ref', ref: 'unit', span: 2, table: false },
      { key: 'qty_milli', label: 'Calculated quantity', type: 'qty', readOnly: true, unitField: 'unit_code', table: true, span: 3 },
      { key: 'remarks', label: 'Remarks', type: 'textarea', span: 6 },
    ],
  },

  progress: {
    id: 'progress',
    title: 'Daily Progress & Site Diary',
    singular: 'Daily entry',
    table: 'daily_progress',
    description: 'Daily progress register, site diary and road-work register. Level book scans attach to each entry.',
    searchKeys: ['work_done', 'issues', 'chainage_from', 'chainage_to', 'boq_ref', 'equipment'],
    sortBy: 'entry_date DESC, created_at DESC',
    softDelete: true,
    dateKey: 'entry_date',
    hasCompany: true,
    hasProject: true,
    attach: { docType: 'progress', entityType: 'progress' },
    labelKeys: ['entry_date'],
    addLabel: 'New daily entry',
    filters: [
      ...COMPANY_PROJECT_FILTERS,
      { key: 'register', label: 'Register', type: 'select', options: PROGRESS_REGISTER },
      { key: 'activity_id', label: 'Activity', type: 'ref', ref: 'activity' },
    ],
    fields: [
      { key: 'entry_date', label: 'Date', type: 'date', required: true, default: 'today', table: true, span: 2 },
      { key: 'register', label: 'Register', type: 'select', options: PROGRESS_REGISTER, default: 'progress', required: true, table: true, span: 2 },
      { key: 'weather', label: 'Weather', type: 'text', span: 2 },
      { ...COMPANY, table: false },
      { ...PROJECT },
      { key: 'activity_id', label: 'Work activity', type: 'ref', ref: 'activity', table: true, span: 3 },
      { key: 'chainage_from', label: 'Chainage from', type: 'text', table: true, span: 2 },
      { key: 'chainage_to', label: 'Chainage to', type: 'text', table: true, span: 2 },
      { key: 'boq_ref', label: 'BOQ reference', type: 'text', span: 2 },
      { key: 'work_done', label: 'Work done', type: 'textarea', required: true, table: true, span: 6 },
      { key: 'qty_done_milli', label: 'Quantity done', type: 'qty', unitField: 'unit_code', table: true, span: 2 },
      { key: 'unit_code', label: 'Unit', type: 'ref', ref: 'unit', span: 2 },
      { key: 'labour_count', label: 'Labour (nos.)', type: 'int', span: 2 },
      { key: 'equipment', label: 'Equipment deployed', type: 'text', span: 3 },
      { key: 'material_note', label: 'Materials received / used (note)', type: 'text', span: 3 },
      { key: 'issues', label: 'Issues / hindrances', type: 'textarea', span: 3 },
      { key: 'next_plan', label: 'Plan for next day', type: 'textarea', span: 3 },
      { key: 'prepared_by', label: 'Prepared by', type: 'text', span: 3 },
    ],
  },
};

export const MODULE_IDS = Object.keys(MODULES);

/** Status → visual tone for chips */
export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';
export const STATUS_TONE: Record<string, Tone> = {
  active: 'good',
  verified: 'good',
  approved: 'good',
  paid: 'good',
  pass: 'good',
  posted: 'good',
  completed: 'good',
  received: 'good',
  payment: 'info',
  advance: 'info',
  credit_note: 'warn',
  pending: 'warn',
  partial: 'warn',
  unpaid: 'warn',
  unverified: 'warn',
  draft: 'neutral',
  planned: 'neutral',
  ordered: 'info',
  on_hold: 'warn',
  inactive: 'neutral',
  closed: 'neutral',
  na: 'neutral',
  disputed: 'bad',
  discrepancy: 'bad',
  rejected: 'bad',
  fail: 'bad',
  cancelled: 'bad',
  blocked: 'bad',
};
