import { all } from '../db/core';
import { RefKind } from '../../src/shared/modules';

interface RefSpec {
  table: string;
  label: string;
  sub?: string;
  /** SQL condition limiting to "active" choices */
  activeWhere?: string;
  softDelete: boolean;
  order: string;
  meta?: string[];
}

export const REFS: Record<RefKind, RefSpec> = {
  company: { table: 'companies', label: 'name', sub: 'owner_name', softDelete: true, order: 'name' },
  project: { table: 'projects', label: 'name', sub: 'code', softDelete: true, order: 'name', activeWhere: `t.status NOT IN ('closed')`, meta: ['company_id'] },
  supplier: { table: 'suppliers', label: 'name', sub: 'code', softDelete: true, order: 'name', activeWhere: `t.status = 'active'` },
  category: { table: 'material_categories', label: 'name', softDelete: true, order: 'sort_order, name', activeWhere: 't.active = 1' },
  material: { table: 'v_materials', label: 'label', softDelete: true, order: 'category_name, name', activeWhere: 't.active = 1', meta: ['category_id', 'default_unit'] },
  spec: { table: 'v_specs', label: 'label', sub: 'category_name', softDelete: true, order: 'category_name, label', activeWhere: 't.active = 1', meta: ['unit_code', 'standard_rate_paise', 'material_id', 'category_id'] },
  unit: { table: 'units', label: 'code', sub: 'name', softDelete: false, order: 'sort_order, code', activeWhere: 't.active = 1', meta: ['kind'] },
  activity: { table: 'work_activities', label: 'name', softDelete: true, order: 'sort_order, name', activeWhere: 't.active = 1' },
  formula: { table: 'quantity_formulas', label: 'name', sub: 'expression', softDelete: true, order: 'name', activeWhere: 't.active = 1', meta: ['expression', 'unit_code'] },
  testType: { table: 'test_types', label: 'name', sub: 'group_name', softDelete: true, order: 'group_name, name', activeWhere: 't.active = 1', meta: ['default_unit', 'default_standard'] },
  receipt: { table: 'material_receipts', label: 'receipt_no', sub: 'vehicle_no', softDelete: true, order: 'received_at DESC', meta: ['project_id', 'supplier_id'] },
  invoice: { table: 'invoices', label: 'invoice_no', sub: 'invoice_date', softDelete: true, order: 'invoice_date DESC', meta: ['supplier_id', 'total_paise'] },
  purchase: { table: 'purchase_orders', label: 'po_no', sub: 'purchase_date', softDelete: true, order: 'purchase_date DESC', meta: ['supplier_id', 'project_id', 'total_paise'] },
};

export interface LookupOption {
  id: string;
  label: string;
  sub?: string | null;
  meta?: Record<string, any>;
}

export interface LookupQuery {
  ref: RefKind;
  q?: string;
  parentColumn?: string;
  parentValue?: string | null;
  includeInactive?: boolean;
  /** for ref=spec: surface this supplier's agreed rates first */
  supplierId?: string | null;
  ids?: string[];
  limit?: number;
}

const SAFE_COL = /^[a-z_]+$/;

export function lookup(q: LookupQuery): LookupOption[] {
  const spec = REFS[q.ref];
  if (!spec) throw new Error('Unknown reference type');
  const limit = Math.min(q.limit ?? 100, 500);
  const where: string[] = [];
  const params: any[] = [];
  if (spec.softDelete) where.push('t.deleted_at IS NULL');
  if (!q.includeInactive && spec.activeWhere) where.push(spec.activeWhere);
  if (q.parentColumn && SAFE_COL.test(q.parentColumn) && q.parentValue) {
    where.push(`t.${q.parentColumn} = ?`);
    params.push(q.parentValue);
  }
  if (q.ids?.length) {
    where.push(`t.id IN (${q.ids.map(() => '?').join(',')})`);
    params.push(...q.ids);
  }
  if (q.q && q.q.trim()) {
    where.push(`(LOWER(t.${spec.label}) LIKE ? ${spec.sub ? `OR LOWER(IFNULL(t.${spec.sub},'')) LIKE ?` : ''})`);
    const like = `%${q.q.trim().toLowerCase()}%`;
    params.push(like);
    if (spec.sub) params.push(like);
  }
  const metaCols = (spec.meta ?? []).map((m) => `t.${m} AS m_${m}`);
  let select = `t.id AS id, t.${spec.label} AS label, ${spec.sub ? `t.${spec.sub}` : 'NULL'} AS sub${metaCols.length ? ', ' + metaCols.join(', ') : ''}`;
  let from = `${spec.table} t`;
  let order = spec.order.split(',').map((o) => `t.${o.trim()}`).join(', ');
  const pre: any[] = [];
  if (q.ref === 'spec' && q.supplierId) {
    from += ` LEFT JOIN supplier_materials sm ON sm.spec_id = t.id AND sm.supplier_id = ? AND sm.deleted_at IS NULL AND sm.active = 1`;
    pre.push(q.supplierId);
    select += `, sm.rate_paise AS m_rate_paise, sm.tax_bp AS m_tax_bp`;
    order = `(sm.id IS NULL), ${order}`;
  }
  const sql = `SELECT ${select} FROM ${from} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT ${limit}`;
  return all<any>(sql, [...pre, ...params]).map((r) => {
    const meta: Record<string, any> = {};
    for (const k of Object.keys(r)) if (k.startsWith('m_')) meta[k.slice(2)] = r[k];
    return { id: String(r.id), label: String(r.label ?? ''), sub: r.sub ?? null, meta };
  });
}

/** SQL fragment resolving the display label of a reference column on alias `t`. Column names come from code, not users. */
export function labelSubquery(ref: RefKind, column: string): string {
  const s = REFS[ref];
  if (ref === 'unit') return `t.${column}`;
  return `(SELECT x.${s.label} FROM ${s.table} x WHERE x.id = t.${column})`;
}
