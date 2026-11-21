import { all, get, run, tx } from '../db/core';
import { formatDate } from '../../src/shared/num';

/**
 * Global search: every searchable entity is mirrored into `search_docs`, indexed by an FTS5
 * table using the trigram tokenizer, which gives fast case-insensitive SUBSTRING matching
 * (so "patel", "ATEL" and "20 mm" all work). Terms shorter than 3 characters fall back to LIKE.
 */
export interface SearchDoc {
  title: string;
  subtitle?: string | null;
  parent?: string | null;
  body?: string | null;
  companyId?: string | null;
}

const j = (...xs: Array<string | number | null | undefined>) => xs.filter((x) => x !== null && x !== undefined && x !== '').join(' · ');

const INDEXERS: Record<string, (id: string) => SearchDoc | null> = {
  company: (id) => {
    const r = get(`SELECT * FROM companies WHERE id = ? AND deleted_at IS NULL`, [id]);
    if (!r) return null;
    const fields = all<{ field_name: string; field_value: string }>(`SELECT field_name, field_value FROM company_fields WHERE company_id = ?`, [id]);
    return {
      title: r.name,
      subtitle: j(r.owner_name, r.contact_number),
      parent: 'Company',
      body: [r.gst_number, r.address, r.email, r.project_name, r.notes, ...fields.map((f) => `${f.field_name} ${f.field_value}`)].filter(Boolean).join(' '),
      companyId: id,
    };
  },
  project: (id) => {
    const r = get(
      `SELECT p.*, c.name AS company_name FROM projects p JOIN companies c ON c.id = p.company_id WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id]
    );
    if (!r) return null;
    return {
      title: r.name,
      subtitle: j(r.code, r.client_name, r.location),
      parent: r.company_name,
      body: [r.agreement_no, r.notes].filter(Boolean).join(' '),
      companyId: r.company_id,
    };
  },
  category: (id) => {
    const r = get(`SELECT * FROM material_categories WHERE id = ? AND deleted_at IS NULL`, [id]);
    return r ? { title: r.name, parent: 'Material category', body: r.notes } : null;
  },
  material: (id) => {
    const r = get(
      `SELECT m.*, c.name AS cat FROM materials m JOIN material_categories c ON c.id = m.category_id WHERE m.id = ? AND m.deleted_at IS NULL`,
      [id]
    );
    return r ? { title: r.name, subtitle: r.description, parent: r.cat, body: r.notes } : null;
  },
  spec: (id) => {
    const r = get(`SELECT * FROM v_specs WHERE id = ? AND deleted_at IS NULL`, [id]);
    return r
      ? { title: r.label, subtitle: j(r.size_grade, r.unit_code), parent: `${r.category_name} › ${r.material_name}`, body: r.size_grade }
      : null;
  },
  supplier: (id) => {
    const r = get(`SELECT * FROM suppliers WHERE id = ? AND deleted_at IS NULL`, [id]);
    return r
      ? {
          title: r.name,
          subtitle: j(r.code, r.business_name, r.contact_person, r.mobile),
          parent: 'Supplier',
          body: [r.gst_no, r.pan_no, r.address, r.email, r.alt_contact, r.notes].filter(Boolean).join(' '),
        }
      : null;
  },
  purchase: (id) => {
    const r = get(
      `SELECT po.*, c.name AS company_name, p.name AS project_name, s.name AS supplier_name
       FROM purchase_orders po JOIN companies c ON c.id = po.company_id JOIN projects p ON p.id = po.project_id JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = ? AND po.deleted_at IS NULL`,
      [id]
    );
    if (!r) return null;
    const items = all<{ label: string }>(
      `SELECT v.label FROM purchase_order_items i JOIN v_specs v ON v.id = i.spec_id WHERE i.po_id = ?`,
      [id]
    );
    return {
      title: `Purchase ${r.po_no}`,
      subtitle: j(r.supplier_name, formatDate(r.purchase_date), r.invoice_no ? `Inv ${r.invoice_no}` : null),
      parent: `${r.company_name} › ${r.project_name}`,
      body: [r.po_no, r.invoice_no, r.supplier_ref, r.remarks, ...items.map((i) => i.label)].filter(Boolean).join(' '),
      companyId: r.company_id,
    };
  },
  invoice: (id) => {
    const r = get(
      `SELECT i.*, c.name AS company_name, s.name AS supplier_name FROM invoices i
       JOIN companies c ON c.id = i.company_id JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ? AND i.deleted_at IS NULL`,
      [id]
    );
    return r
      ? {
          title: `Invoice ${r.invoice_no}`,
          subtitle: j(r.supplier_name, formatDate(r.invoice_date)),
          parent: r.company_name,
          body: [r.invoice_no, r.notes].filter(Boolean).join(' '),
          companyId: r.company_id,
        }
      : null;
  },
  payment: (id) => {
    const r = get(
      `SELECT p.*, c.name AS company_name, s.name AS supplier_name FROM supplier_payments p
       JOIN companies c ON c.id = p.company_id JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ? AND p.deleted_at IS NULL`,
      [id]
    );
    return r
      ? {
          title: `${r.kind === 'credit_note' ? 'Credit note' : 'Payment'} ${r.reference_no || ''}`.trim(),
          subtitle: j(r.supplier_name, formatDate(r.payment_date)),
          parent: r.company_name,
          body: [r.reference_no, r.notes].filter(Boolean).join(' '),
          companyId: r.company_id,
        }
      : null;
  },
  receipt: (id) => {
    const r = get(
      `SELECT r.*, c.name AS company_name, p.name AS project_name, s.name AS supplier_name, v.label AS spec_label
       FROM material_receipts r JOIN companies c ON c.id = r.company_id JOIN projects p ON p.id = r.project_id
       JOIN suppliers s ON s.id = r.supplier_id JOIN v_specs v ON v.id = r.spec_id WHERE r.id = ? AND r.deleted_at IS NULL`,
      [id]
    );
    if (!r) return null;
    const slips = all<{ slip_no: string; weighbridge_name: string }>(`SELECT slip_no, weighbridge_name FROM weighbridge_records WHERE receipt_id = ?`, [id]);
    return {
      title: `Inward ${r.receipt_no}`,
      subtitle: j(r.vehicle_no, r.spec_label, r.supplier_name, formatDate(r.received_at)),
      parent: `${r.company_name} › ${r.project_name}`,
      body: [r.receipt_no, r.vehicle_no, r.driver_name, r.invoice_no, r.challan_no, r.royalty_pass_no, r.remarks, ...slips.map((s) => `${s.slip_no || ''} ${s.weighbridge_name || ''}`)]
        .filter(Boolean)
        .join(' '),
      companyId: r.company_id,
    };
  },
  royalty: (id) => {
    const r = get(
      `SELECT r.*, c.name AS company_name, s.name AS supplier_name FROM royalty_passes r
       LEFT JOIN companies c ON c.id = r.company_id LEFT JOIN suppliers s ON s.id = r.supplier_id WHERE r.id = ? AND r.deleted_at IS NULL`,
      [id]
    );
    return r
      ? {
          title: `Royalty pass ${r.pass_no}`,
          subtitle: j(r.vehicle_no, r.mineral_name, r.supplier_name, formatDate(r.dispatch_at)),
          parent: r.company_name || 'Royalty',
          body: [r.pass_no, r.e_permit_no, r.vehicle_no, r.lease_holder, r.destination, r.source_location, r.driver_name].filter(Boolean).join(' '),
          companyId: r.company_id,
        }
      : null;
  },
  quality: (id) => {
    const r = get(
      `SELECT q.*, c.name AS company_name, p.name AS project_name, t.name AS test_name FROM quality_tests q
       JOIN companies c ON c.id = q.company_id JOIN projects p ON p.id = q.project_id JOIN test_types t ON t.id = q.test_type_id
       WHERE q.id = ? AND q.deleted_at IS NULL`,
      [id]
    );
    return r
      ? {
          title: `Test ${r.test_no || ''} ${r.test_name}`.trim(),
          subtitle: j(r.sample_id, r.result_status, formatDate(r.test_date)),
          parent: `${r.company_name} › ${r.project_name}`,
          body: [r.test_no, r.sample_id, r.laboratory, r.standard_ref, r.remarks].filter(Boolean).join(' '),
          companyId: r.company_id,
        }
      : null;
  },
  measurement: (id) => {
    const r = get(
      `SELECT m.*, c.name AS company_name, p.name AS project_name FROM measurement_entries m
       JOIN companies c ON c.id = m.company_id JOIN projects p ON p.id = m.project_id WHERE m.id = ? AND m.deleted_at IS NULL AND m.superseded_at IS NULL`,
      [id]
    );
    return r
      ? {
          title: `MB ${r.mb_no} — ${r.work_description}`,
          subtitle: j(r.chainage_from, r.chainage_to, formatDate(r.measured_on)),
          parent: `${r.company_name} › ${r.project_name}`,
          body: [r.mb_no, r.boq_ref, r.remarks].filter(Boolean).join(' '),
          companyId: r.company_id,
        }
      : null;
  },
  consumption: (id) => {
    const r = get(
      `SELECT m.*, c.name AS company_name, p.name AS project_name, v.label AS spec_label FROM material_consumption m
       JOIN companies c ON c.id = m.company_id JOIN projects p ON p.id = m.project_id JOIN v_specs v ON v.id = m.spec_id
       WHERE m.id = ? AND m.deleted_at IS NULL`,
      [id]
    );
    return r
      ? {
          title: `Consumption ${r.spec_label} ${formatDate(r.usage_date)}`,
          subtitle: j(r.site_location, r.chainage_from, r.chainage_to),
          parent: `${r.company_name} › ${r.project_name}`,
          body: [r.equipment, r.remarks, r.site_location].filter(Boolean).join(' '),
          companyId: r.company_id,
        }
      : null;
  },
  progress: (id) => {
    const r = get(
      `SELECT d.*, c.name AS company_name, p.name AS project_name FROM daily_progress d
       JOIN companies c ON c.id = d.company_id JOIN projects p ON p.id = d.project_id WHERE d.id = ? AND d.deleted_at IS NULL`,
      [id]
    );
    return r
      ? {
          title: `Daily entry ${formatDate(r.entry_date)}`,
          subtitle: (r.work_done || '').slice(0, 80),
          parent: `${r.company_name} › ${r.project_name}`,
          body: [r.work_done, r.issues, r.boq_ref, r.equipment].filter(Boolean).join(' '),
          companyId: r.company_id,
        }
      : null;
  },
  document: (id) => {
    const r = get(
      `SELECT d.*, c.name AS company_name FROM documents d LEFT JOIN companies c ON c.id = d.company_id WHERE d.id = ? AND d.deleted_at IS NULL`,
      [id]
    );
    return r
      ? {
          title: r.title || r.file_name,
          subtitle: j(r.doc_type, r.file_name),
          parent: r.company_name || 'Documents',
          body: [r.file_name, r.verification_notes].filter(Boolean).join(' '),
          companyId: r.company_id,
        }
      : null;
  },
  report: (id) => {
    const r = get(`SELECT * FROM generated_reports WHERE id = ?`, [id]);
    return r
      ? { title: r.title, subtitle: j(r.format.toUpperCase(), r.period_from ? `${formatDate(r.period_from)} to ${formatDate(r.period_to)}` : null), parent: 'Generated report', body: r.report_type, companyId: r.company_id }
      : null;
  },
};

export function indexEntity(entityType: string, id: string) {
  const fn = INDEXERS[entityType];
  if (!fn) return;
  const doc = fn(id);
  if (!doc) {
    run(`DELETE FROM search_docs WHERE entity_type = ? AND entity_id = ?`, [entityType, id]);
    return;
  }
  run(
    `INSERT INTO search_docs (entity_type, entity_id, company_id, title, subtitle, parent, body)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET
       company_id = excluded.company_id, title = excluded.title, subtitle = excluded.subtitle,
       parent = excluded.parent, body = excluded.body`,
    [entityType, id, doc.companyId ?? null, doc.title, doc.subtitle ?? null, doc.parent ?? null, doc.body ?? null]
  );
}

export function unindexEntity(entityType: string, id: string) {
  run(`DELETE FROM search_docs WHERE entity_type = ? AND entity_id = ?`, [entityType, id]);
}

const TABLES: Record<string, string> = {
  company: 'companies',
  project: 'projects',
  category: 'material_categories',
  material: 'materials',
  spec: 'material_specifications',
  supplier: 'suppliers',
  purchase: 'purchase_orders',
  invoice: 'invoices',
  payment: 'supplier_payments',
  receipt: 'material_receipts',
  royalty: 'royalty_passes',
  quality: 'quality_tests',
  measurement: 'measurement_entries',
  consumption: 'material_consumption',
  progress: 'daily_progress',
  document: 'documents',
  report: 'generated_reports',
};

/** Rebuild the whole index (used after migrations / restore). Cheap at this data size. */
export function rebuildSearchIndex(): number {
  let n = 0;
  tx(() => {
    run(`DELETE FROM search_docs`);
    for (const [type, table] of Object.entries(TABLES)) {
      for (const r of all<{ id: string }>(`SELECT id FROM ${table}`)) {
        indexEntity(type, r.id);
        n++;
      }
    }
  });
  return n;
}

export interface SearchHit {
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string | null;
  parent: string | null;
  companyId: string | null;
}

export function searchQuery(q: string, opts: { types?: string[]; companyId?: string | null; limit?: number } = {}): SearchHit[] {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  const tokens = q
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["]/g, ''))
    .filter(Boolean)
    .slice(0, 8);
  if (!tokens.length) return [];

  const long = tokens.filter((t) => [...t].length >= 3);
  const short = tokens.filter((t) => [...t].length < 3);
  const where: string[] = [];
  const params: any[] = [];

  let sql: string;
  if (long.length) {
    sql = `SELECT d.entity_type, d.entity_id, d.title, d.subtitle, d.parent, d.company_id
           FROM search_fts f JOIN search_docs d ON d.id = f.rowid WHERE search_fts MATCH ?`;
    params.push(long.map((t) => `"${t}"`).join(' AND '));
  } else {
    sql = `SELECT d.entity_type, d.entity_id, d.title, d.subtitle, d.parent, d.company_id FROM search_docs d WHERE 1=1`;
  }
  for (const t of short) {
    where.push(`(d.title || ' ' || ifnull(d.subtitle,'') || ' ' || ifnull(d.body,'')) LIKE ? ESCAPE '\\'`);
    params.push(`%${t.replace(/[%_\\]/g, '\\$&')}%`);
  }
  if (opts.types?.length) {
    where.push(`d.entity_type IN (${opts.types.map(() => '?').join(',')})`);
    params.push(...opts.types);
  }
  if (opts.companyId) {
    where.push(`(d.company_id = ? OR d.company_id IS NULL)`);
    params.push(opts.companyId);
  }
  if (where.length) sql += ' AND ' + where.join(' AND ');
  sql += long.length ? ` ORDER BY bm25(search_fts, 10.0, 4.0, 1.0, 2.0) LIMIT ?` : ` ORDER BY d.title LIMIT ?`;
  params.push(limit);

  return all<any>(sql, params).map((r) => ({
    entityType: r.entity_type,
    entityId: r.entity_id,
    title: r.title,
    subtitle: r.subtitle,
    parent: r.parent,
    companyId: r.company_id,
  }));
}
