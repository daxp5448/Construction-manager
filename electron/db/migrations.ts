import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { SEED_UNITS } from '../../src/shared/units';
import { log } from '../logger';

interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

const TS = `created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  deleted_at TEXT`;

/** v1 = the schema shipped in the first release (idempotent, so existing databases are adopted untouched). */
const V1 = `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sanitized_name TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  excel_path TEXT NOT NULL,
  owner_name TEXT,
  contact_number TEXT,
  email TEXT,
  gst_number TEXT,
  address TEXT,
  project_name TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS company_fields (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_value TEXT NOT NULL,
  field_order INTEGER NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name);
CREATE INDEX IF NOT EXISTS idx_fields_company ON company_fields(company_id);
`;

const V2 = `
ALTER TABLE companies ADD COLUMN deleted_at TEXT;

CREATE TABLE units (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('weight','volume','liquid','count','length','area')),
  to_base REAL NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  ${TS}
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT,
  name TEXT NOT NULL,
  client_name TEXT,
  location TEXT,
  agreement_no TEXT,
  agreement_date TEXT,
  contract_value_paise INTEGER,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  folder_path TEXT,
  notes TEXT,
  ${TS}
);
CREATE UNIQUE INDEX ux_projects_company_name ON projects(company_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX ix_projects_company ON projects(company_id);

CREATE TABLE material_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_unit TEXT REFERENCES units(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  ${TS}
);
CREATE UNIQUE INDEX ux_categories_name ON material_categories(lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE materials (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES material_categories(id),
  name TEXT NOT NULL,
  default_unit TEXT REFERENCES units(id),
  description TEXT,
  requires_royalty INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  ${TS}
);
CREATE UNIQUE INDEX ux_materials_name ON materials(category_id, lower(name)) WHERE deleted_at IS NULL;

CREATE VIEW v_materials AS
SELECT m.id, m.category_id, c.name AS category_name, m.name, m.default_unit, m.requires_royalty, m.active, m.deleted_at, c.name || ' › ' || m.name AS label
FROM materials m JOIN material_categories c ON c.id = m.category_id;

CREATE TABLE material_specifications (
  id TEXT PRIMARY KEY,
  material_id TEXT NOT NULL REFERENCES materials(id),
  size_grade TEXT NOT NULL,
  unit_code TEXT NOT NULL REFERENCES units(id),
  description TEXT,
  standard_rate_paise INTEGER,
  min_stock_milli INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  ${TS}
);
CREATE UNIQUE INDEX ux_specs_name ON material_specifications(material_id, lower(size_grade)) WHERE deleted_at IS NULL;

CREATE VIEW v_specs AS
SELECT s.id, s.material_id, m.category_id, c.name AS category_name, m.name AS material_name,
       s.size_grade, s.unit_code, s.active, s.deleted_at, s.min_stock_milli, s.standard_rate_paise,
       CASE WHEN lower(trim(s.size_grade)) IN ('standard','') THEN m.name ELSE m.name || ' ' || s.size_grade END AS label
FROM material_specifications s
JOIN materials m ON m.id = s.material_id
JOIN material_categories c ON c.id = m.category_id;

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  code TEXT,
  folder_name TEXT,
  name TEXT NOT NULL,
  business_name TEXT,
  contact_person TEXT,
  mobile TEXT,
  alt_contact TEXT,
  email TEXT,
  address TEXT,
  gst_no TEXT,
  pan_no TEXT,
  bank_name TEXT,
  bank_account TEXT,
  bank_ifsc TEXT,
  contract_start TEXT,
  contract_end TEXT,
  payment_terms TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  ${TS}
);
CREATE UNIQUE INDEX ux_suppliers_code ON suppliers(code) WHERE deleted_at IS NULL AND code IS NOT NULL;
CREATE UNIQUE INDEX ux_suppliers_name ON suppliers(lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE supplier_materials (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  spec_id TEXT NOT NULL REFERENCES material_specifications(id),
  rate_paise INTEGER NOT NULL DEFAULT 0,
  tax_bp INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  ${TS}
);
CREATE UNIQUE INDEX ux_supmat ON supplier_materials(supplier_id, spec_id) WHERE deleted_at IS NULL;

CREATE TABLE supplier_projects (
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  PRIMARY KEY (supplier_id, project_id)
);

CREATE TABLE work_activities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  ${TS}
);
CREATE UNIQUE INDEX ux_activities ON work_activities(lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE test_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  group_name TEXT,
  default_unit TEXT,
  default_standard TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  ${TS}
);

CREATE TABLE quantity_formulas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  expression TEXT NOT NULL,
  unit_code TEXT REFERENCES units(id),
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  ${TS}
);

CREATE TABLE sequences (
  key TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  po_no TEXT NOT NULL,
  purchase_date TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  supplier_ref TEXT,
  invoice_no TEXT,
  status TEXT NOT NULL DEFAULT 'ordered',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  tax_treatment TEXT NOT NULL DEFAULT 'exclusive',
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  freight_paise INTEGER NOT NULL DEFAULT 0,
  other_charges_paise INTEGER NOT NULL DEFAULT 0,
  adjustment_paise INTEGER NOT NULL DEFAULT 0,
  adjustment_note TEXT,
  total_paise INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  remarks TEXT,
  ${TS}
);
CREATE UNIQUE INDEX ux_po_no ON purchase_orders(po_no) WHERE deleted_at IS NULL;
CREATE INDEX ix_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX ix_po_project ON purchase_orders(project_id, purchase_date);

CREATE TABLE purchase_order_items (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  spec_id TEXT NOT NULL REFERENCES material_specifications(id),
  qty_milli INTEGER NOT NULL,
  unit_code TEXT NOT NULL REFERENCES units(id),
  rate_paise INTEGER NOT NULL,
  tax_bp INTEGER NOT NULL DEFAULT 0,
  subtotal_paise INTEGER NOT NULL,
  tax_paise INTEGER NOT NULL,
  total_paise INTEGER NOT NULL,
  notes TEXT
);
CREATE INDEX ix_poi_po ON purchase_order_items(po_id);
CREATE INDEX ix_poi_spec ON purchase_order_items(spec_id);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  project_id TEXT REFERENCES projects(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  purchase_id TEXT REFERENCES purchase_orders(id),
  invoice_no TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  subtotal_paise INTEGER NOT NULL DEFAULT 0,
  tax_paise INTEGER NOT NULL DEFAULT 0,
  other_paise INTEGER NOT NULL DEFAULT 0,
  total_paise INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  approval_status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  ${TS}
);
CREATE INDEX ix_inv_supplier ON invoices(supplier_id, invoice_date);
CREATE INDEX ix_inv_no ON invoices(invoice_no);

CREATE TABLE supplier_payments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  project_id TEXT REFERENCES projects(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  invoice_id TEXT REFERENCES invoices(id),
  payment_date TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'payment',
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  mode TEXT,
  reference_no TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  ${TS}
);
CREATE INDEX ix_pay_supplier ON supplier_payments(supplier_id, payment_date);

CREATE TABLE material_receipts (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL,
  received_at TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  purchase_id TEXT REFERENCES purchase_orders(id),
  purchase_item_id TEXT REFERENCES purchase_order_items(id),
  spec_id TEXT NOT NULL REFERENCES material_specifications(id),
  unit_code TEXT NOT NULL REFERENCES units(id),
  vehicle_no TEXT,
  driver_name TEXT,
  driver_mobile TEXT,
  invoice_no TEXT,
  challan_no TEXT,
  royalty_pass_no TEXT,
  ordered_qty_milli INTEGER,
  received_qty_milli INTEGER NOT NULL DEFAULT 0,
  accepted_qty_milli INTEGER NOT NULL DEFAULT 0,
  rejected_qty_milli INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  location TEXT NOT NULL DEFAULT 'Main Store',
  status TEXT NOT NULL DEFAULT 'posted',
  cancel_reason TEXT,
  remarks TEXT,
  ${TS}
);
CREATE UNIQUE INDEX ux_receipt_no ON material_receipts(receipt_no) WHERE deleted_at IS NULL;
CREATE INDEX ix_rcpt_project ON material_receipts(project_id, received_at);
CREATE INDEX ix_rcpt_supplier ON material_receipts(supplier_id, received_at);
CREATE INDEX ix_rcpt_po ON material_receipts(purchase_id);
CREATE INDEX ix_rcpt_vehicle ON material_receipts(vehicle_no);

CREATE TABLE weighbridge_records (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES material_receipts(id) ON DELETE CASCADE,
  slip_no TEXT,
  weighbridge_name TEXT,
  slip_at TEXT,
  vehicle_no TEXT,
  weight_unit TEXT NOT NULL DEFAULT 'MT' REFERENCES units(id),
  gross_milli INTEGER NOT NULL,
  tare_milli INTEGER NOT NULL,
  net_milli INTEGER NOT NULL,
  notes TEXT
);
CREATE INDEX ix_wb_receipt ON weighbridge_records(receipt_id);
CREATE INDEX ix_wb_slip ON weighbridge_records(slip_no);

CREATE TABLE royalty_passes (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  project_id TEXT REFERENCES projects(id),
  supplier_id TEXT REFERENCES suppliers(id),
  receipt_id TEXT REFERENCES material_receipts(id),
  invoice_id TEXT REFERENCES invoices(id),
  pass_no TEXT NOT NULL,
  e_permit_no TEXT,
  mineral_name TEXT,
  grade TEXT,
  lease_holder TEXT,
  source_location TEXT,
  vehicle_no TEXT,
  driver_name TEXT,
  driver_mobile TEXT,
  weight_unit TEXT NOT NULL DEFAULT 'MT',
  gross_milli INTEGER,
  tare_milli INTEGER,
  net_milli INTEGER,
  dispatch_at TEXT,
  destination TEXT,
  valid_from TEXT,
  valid_to TEXT,
  royalty_amount_paise INTEGER,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  verified_by TEXT,
  verified_on TEXT,
  verification_notes TEXT,
  notes TEXT,
  ${TS}
);
CREATE INDEX ix_roy_pass ON royalty_passes(pass_no);
CREATE INDEX ix_roy_vehicle ON royalty_passes(vehicle_no);
CREATE INDEX ix_roy_receipt ON royalty_passes(receipt_id);
CREATE INDEX ix_roy_date ON royalty_passes(dispatch_at);

CREATE TABLE royalty_rates (
  id TEXT PRIMARY KEY,
  mineral_name TEXT NOT NULL,
  grade TEXT,
  unit_code TEXT NOT NULL REFERENCES units(id),
  rate_paise INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  reference_note TEXT,
  notes TEXT,
  ${TS}
);

CREATE TABLE stock_transactions (
  id TEXT PRIMARY KEY,
  txn_date TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  spec_id TEXT NOT NULL REFERENCES material_specifications(id),
  location TEXT NOT NULL DEFAULT 'Main Store',
  txn_type TEXT NOT NULL CHECK (txn_type IN ('opening','inward','return','outward','consumption','adjustment','rejected')),
  qty_milli INTEGER NOT NULL,
  signed_qty_milli INTEGER NOT NULL,
  unit_code TEXT NOT NULL REFERENCES units(id),
  source_type TEXT,
  source_id TEXT,
  reason TEXT,
  notes TEXT,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_stock_source ON stock_transactions(source_type, source_id, txn_type)
  WHERE voided_at IS NULL AND source_type IS NOT NULL;
CREATE INDEX ix_stock_key ON stock_transactions(company_id, project_id, spec_id, location);
CREATE INDEX ix_stock_date ON stock_transactions(txn_date);

CREATE TABLE material_consumption (
  id TEXT PRIMARY KEY,
  usage_date TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  site_location TEXT,
  chainage_from TEXT,
  chainage_to TEXT,
  activity_id TEXT REFERENCES work_activities(id),
  spec_id TEXT NOT NULL REFERENCES material_specifications(id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_code TEXT NOT NULL REFERENCES units(id),
  stock_location TEXT NOT NULL DEFAULT 'Main Store',
  equipment TEXT,
  assumption_note TEXT,
  remarks TEXT,
  ${TS}
);
CREATE INDEX ix_cons_project ON material_consumption(project_id, usage_date);
CREATE INDEX ix_cons_spec ON material_consumption(spec_id);

CREATE TABLE consumption_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  spec_id TEXT NOT NULL REFERENCES material_specifications(id),
  activity_id TEXT REFERENCES work_activities(id),
  planned_qty_milli INTEGER NOT NULL,
  unit_code TEXT NOT NULL REFERENCES units(id),
  basis_note TEXT,
  ${TS}
);

CREATE TABLE quality_tests (
  id TEXT PRIMARY KEY,
  test_no TEXT,
  test_date TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  spec_id TEXT REFERENCES material_specifications(id),
  supplier_id TEXT REFERENCES suppliers(id),
  sample_id TEXT,
  test_type_id TEXT NOT NULL REFERENCES test_types(id),
  result_value TEXT,
  unit TEXT,
  standard_ref TEXT,
  limit_min REAL,
  limit_max REAL,
  limit_text TEXT,
  result_status TEXT NOT NULL DEFAULT 'pending',
  laboratory TEXT,
  remarks TEXT,
  ${TS}
);
CREATE UNIQUE INDEX ux_qt_no ON quality_tests(test_no) WHERE deleted_at IS NULL AND test_no IS NOT NULL;
CREATE INDEX ix_qt_project ON quality_tests(project_id, test_date);

CREATE TABLE measurement_entries (
  id TEXT PRIMARY KEY,
  entry_group TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  mb_no TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  work_description TEXT NOT NULL,
  measured_on TEXT NOT NULL,
  chainage_from TEXT,
  chainage_to TEXT,
  length_milli INTEGER,
  width_milli INTEGER,
  depth_milli INTEGER,
  nos_milli INTEGER DEFAULT 1000,
  formula_id TEXT REFERENCES quantity_formulas(id),
  formula_expr TEXT,
  qty_milli INTEGER,
  unit_code TEXT REFERENCES units(id),
  boq_ref TEXT,
  remarks TEXT,
  superseded_at TEXT,
  supersede_reason TEXT,
  ${TS}
);
CREATE INDEX ix_mb_project ON measurement_entries(project_id, measured_on);
CREATE INDEX ix_mb_group ON measurement_entries(entry_group);

CREATE TABLE daily_progress (
  id TEXT PRIMARY KEY,
  register TEXT NOT NULL DEFAULT 'progress',
  entry_date TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  weather TEXT,
  activity_id TEXT REFERENCES work_activities(id),
  chainage_from TEXT,
  chainage_to TEXT,
  boq_ref TEXT,
  work_done TEXT NOT NULL,
  qty_done_milli INTEGER,
  unit_code TEXT REFERENCES units(id),
  labour_count INTEGER,
  equipment TEXT,
  material_note TEXT,
  issues TEXT,
  next_plan TEXT,
  prepared_by TEXT,
  ${TS}
);
CREATE INDEX ix_dp_project ON daily_progress(project_id, entry_date);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id),
  project_id TEXT REFERENCES projects(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  title TEXT,
  file_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  rel_path TEXT,
  sha256 TEXT,
  size_bytes INTEGER,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  verified_on TEXT,
  verification_notes TEXT,
  is_missing INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  ${TS}
);
CREATE INDEX ix_docs_entity ON documents(entity_type, entity_id);
CREATE INDEX ix_docs_company ON documents(company_id);
CREATE INDEX ix_docs_hash ON documents(sha256);

CREATE TABLE generated_reports (
  id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL,
  title TEXT NOT NULL,
  company_id TEXT,
  project_id TEXT,
  params_json TEXT,
  period_from TEXT,
  period_to TEXT,
  format TEXT NOT NULL,
  file_path TEXT NOT NULL,
  size_bytes INTEGER,
  is_missing INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_reports_created ON generated_reports(created_at);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor TEXT NOT NULL DEFAULT 'local user',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT,
  before_json TEXT,
  after_json TEXT,
  reason TEXT
);
CREATE INDEX ix_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX ix_audit_at ON audit_logs(at);

CREATE TABLE search_docs (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  company_id TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  parent TEXT,
  body TEXT,
  UNIQUE (entity_type, entity_id)
);
CREATE VIRTUAL TABLE search_fts USING fts5(title, subtitle, parent, body, content='search_docs', content_rowid='id', tokenize='trigram');
CREATE TRIGGER search_docs_ai AFTER INSERT ON search_docs BEGIN
  INSERT INTO search_fts(rowid, title, subtitle, parent, body) VALUES (new.id, new.title, new.subtitle, new.parent, new.body);
END;
CREATE TRIGGER search_docs_ad AFTER DELETE ON search_docs BEGIN
  INSERT INTO search_fts(search_fts, rowid, title, subtitle, parent, body) VALUES ('delete', old.id, old.title, old.subtitle, old.parent, old.body);
END;
CREATE TRIGGER search_docs_au AFTER UPDATE ON search_docs BEGIN
  INSERT INTO search_fts(search_fts, rowid, title, subtitle, parent, body) VALUES ('delete', old.id, old.title, old.subtitle, old.parent, old.body);
  INSERT INTO search_fts(rowid, title, subtitle, parent, body) VALUES (new.id, new.title, new.subtitle, new.parent, new.body);
END;
`;

const id = () => crypto.randomUUID();

/** Editable starting data (units, material hierarchy, activities, test names, generic formulas). Seeded once. */
function seedDefaults(db: DatabaseSync) {
  const insUnit = db.prepare('INSERT INTO units (id, code, name, kind, to_base, sort_order) VALUES (?,?,?,?,?,?)');
  for (const u of SEED_UNITS) insUnit.run(u.code, u.code, u.name, u.kind, u.to_base, u.sort_order ?? 0);

  const insCat = db.prepare('INSERT INTO material_categories (id, name, default_unit, sort_order) VALUES (?,?,?,?)');
  const insMat = db.prepare('INSERT INTO materials (id, category_id, name, default_unit, requires_royalty) VALUES (?,?,?,?,?)');
  const insSpec = db.prepare('INSERT INTO material_specifications (id, material_id, size_grade, unit_code) VALUES (?,?,?,?)');

  const tree: Array<{ cat: string; unit: string; materials: Array<{ name: string; specs: string[] }> }> = [
    { cat: 'Aggregate', unit: 'MT', materials: [{ name: 'Aggregate', specs: ['6 MM', '10 MM', '20 MM', '40 MM'] }] },
    {
      cat: 'Dust',
      unit: 'MT',
      materials: [
        { name: 'Stone Dust', specs: ['Standard'] },
        { name: 'Crusher Dust', specs: ['Standard'] },
        { name: 'Grit Dust', specs: ['Standard'] },
      ],
    },
    { cat: 'Bitumen', unit: 'MT', materials: [{ name: 'Bitumen', specs: ['VG-10', 'VG-30', 'VG-40', 'PMB', 'CRMB'] }] },
    {
      cat: 'Other Materials',
      unit: 'MT',
      materials: [
        { name: 'Cement', specs: ['Standard'] },
        { name: 'Sand', specs: ['Standard'] },
        { name: 'Emulsion', specs: ['Standard'] },
        { name: 'Lime', specs: ['Standard'] },
        { name: 'Soil', specs: ['Standard'] },
        { name: 'GSB', specs: ['Standard'] },
        { name: 'WMM', specs: ['Standard'] },
      ],
    },
  ];
  const ROYALTY_DEFAULT = new Set(['Aggregate', 'Stone Dust', 'Crusher Dust', 'Grit Dust', 'Sand', 'Soil']);
  const unitOverride: Record<string, string> = { Cement: 'Bags', Sand: 'Brass', Emulsion: 'MT', Soil: 'Cum', GSB: 'Cum', WMM: 'Cum' };
  tree.forEach((c, ci) => {
    const cid = id();
    insCat.run(cid, c.cat, c.unit, ci);
    for (const m of c.materials) {
      const mid = id();
      const unit = unitOverride[m.name] ?? c.unit;
      insMat.run(mid, cid, m.name, unit, ROYALTY_DEFAULT.has(m.name) ? 1 : 0);
      for (const s of m.specs) insSpec.run(id(), mid, s, unit);
    }
  });

  const insAct = db.prepare('INSERT INTO work_activities (id, name, sort_order) VALUES (?,?,?)');
  ['Earthwork', 'GSB', 'WMM', 'WBM', 'DBM', 'BC', 'Asphalt laying', 'Surface dressing', 'Concrete work', 'Other'].forEach((n, i) =>
    insAct.run(id(), n, i)
  );

  const insTest = db.prepare('INSERT INTO test_types (id, name, group_name, default_unit) VALUES (?,?,?,?)');
  const tests: Array<[string, string, string]> = [
    ['Sieve analysis', 'Aggregate', '% passing'],
    ['Gradation', 'Aggregate', '% passing'],
    ['Aggregate impact value', 'Aggregate', '%'],
    ['Aggregate crushing value', 'Aggregate', '%'],
    ['Water absorption', 'Aggregate', '%'],
    ['Specific gravity', 'Aggregate', ''],
    ['Penetration', 'Bitumen', '0.1 mm'],
    ['Ductility', 'Bitumen', 'cm'],
    ['Softening point', 'Bitumen', '°C'],
    ['Viscosity', 'Bitumen', ''],
    ['Soil test', 'Soil', ''],
    ['GSB test', 'GSB / WMM', ''],
    ['WMM test', 'GSB / WMM', ''],
    ['Density test', 'Field', ''],
    ['Field compaction', 'Field', '%'],
    ['Concrete cube test', 'Concrete', 'N/mm²'],
  ];
  for (const [n, g, u] of tests) insTest.run(id(), n, g, u);

  const insF = db.prepare('INSERT INTO quantity_formulas (id, name, expression, unit_code, description) VALUES (?,?,?,?,?)');
  insF.run(id(), 'Length × Width × Depth × Nos', 'N*L*W*D', 'Cum', 'Volume of N identical sections');
  insF.run(id(), 'Length × Width × Nos', 'N*L*W', 'Sqm', 'Area of N identical sections');
  insF.run(id(), 'Length × Nos', 'N*L', 'Rm', 'Running length');
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'baseline v1 schema', up: (db) => db.exec(V1) },
  {
    version: 2,
    name: 'road construction modules',
    up: (db) => {
      db.exec(V2);
    },
  },
  { version: 3, name: 'seed editable defaults', up: (db) => seedDefaults(db) },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: string[];
  backupFile?: string;
}

export function currentVersion(db: DatabaseSync): number {
  const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (!t) return 0;
  const r = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
  return r?.v ?? 0;
}

/**
 * Apply pending migrations inside one transaction each. Before touching an existing,
 * populated database a consistent snapshot is written to `backupDir` so nothing can be lost.
 */
export function runMigrations(db: DatabaseSync, opts: { backupDir: string; dbFile: string }): MigrationResult {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const from = currentVersion(db);
  const pending = MIGRATIONS.filter((m) => m.version > from);
  const result: MigrationResult = { fromVersion: from, toVersion: from, applied: [] };
  if (!pending.length) return result;

  const hasData = !!db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name='companies'").get();
  if (hasData) {
    fs.mkdirSync(opts.backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(opts.backupDir, `pre-migration_v${from}_to_v${LATEST_VERSION}_${stamp}.sqlite`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    result.backupFile = target;
    log.info(`Pre-migration backup written: ${target}`);
  }

  for (const m of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)').run(
        m.version,
        m.name,
        new Date().toISOString()
      );
      db.exec('COMMIT');
      result.applied.push(`v${m.version} ${m.name}`);
      result.toVersion = m.version;
      log.info(`Migration applied: v${m.version} ${m.name}`);
    } catch (e: any) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      const msg = `Migration v${m.version} (${m.name}) failed and was rolled back: ${e?.message}`;
      log.error(msg);
      const err = new Error(msg + (result.backupFile ? ` A backup of your data was saved at ${result.backupFile}.` : ''));
      (err as any).backupFile = result.backupFile;
      throw err;
    }
  }
  return result;
}
