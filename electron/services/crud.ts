import { all, get, run, scalar, tx } from '../db/core';
import { audit, diffSummary, newId, nextNumber, nowIso } from '../db/util';
import { ApiError, needsConfirm, notFound, validation } from '../errors';
import { FieldDef, MODULES, ModuleDef } from '../../src/shared/modules';
import { REFS, labelSubquery } from './refs';
import { indexEntity, unindexEntity } from './search';
import { nowLocalISO, todayISO } from '../../src/shared/num';

export type Row = Record<string, any>;

export interface HookCtx {
  def: ModuleDef;
  existing: Row | null;
  /** existing row overlaid with the new values */
  merged: Row;
  warnings: string[];
  confirmed: boolean;
}

export interface Hooks {
  /** mutate `clean` (columns to write) and push to ctx.warnings for confirmable problems; throw for hard errors */
  beforeSave?: (clean: Row, ctx: HookCtx) => void;
  afterSave?: (saved: Row, ctx: HookCtx) => void;
  beforeRemove?: (row: Row) => void;
  afterRemove?: (row: Row) => void;
  afterRestore?: (row: Row) => void;
  /** extra static WHERE for list (e.g. hide superseded revisions) */
  baseWhere?: string;
  /** replace default update behaviour (used by revisioned records) */
  update?: (existing: Row, clean: Row, ctx: HookCtx, reason?: string) => Row;
}

export const HOOKS: Record<string, Hooks> = {};

export const ENTITY_TYPE: Record<string, string> = {
  projects: 'project',
  categories: 'category',
  materials: 'material',
  specs: 'spec',
  suppliers: 'supplier',
  supplierMaterials: 'supplier_material',
  activities: 'activity',
  testTypes: 'test_type',
  formulas: 'formula',
  units: 'unit',
  invoices: 'invoice',
  payments: 'payment',
  royalty: 'royalty',
  royaltyRates: 'royalty_rate',
  consumption: 'consumption',
  consumptionPlans: 'consumption_plan',
  quality: 'quality',
  measurement: 'measurement',
  progress: 'progress',
};

export function getDef(id: string): ModuleDef {
  const def = MODULES[id];
  if (!def) throw validation(`Unknown module "${id}".`);
  return def;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

function coerce(f: FieldDef, raw: any): { v: any; err?: string } {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return { v: null };
  switch (f.type) {
    case 'text':
    case 'textarea': {
      let s = String(raw).trim();
      if (f.uppercase) s = s.toUpperCase();
      if (s.length > 4000) return { v: null, err: 'Too long' };
      return { v: s };
    }
    case 'int':
    case 'money':
    case 'qty':
    case 'pct': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n) || !Number.isInteger(n)) return { v: null, err: 'Enter a valid number' };
      if (f.type !== 'int' && f.type !== 'qty' && n < 0 && f.key !== 'adjustment_paise') return { v: null, err: 'Cannot be negative' };
      if (f.type === 'qty' && n < 0) return { v: null, err: 'Cannot be negative' };
      if (f.type === 'int' && n < 0) return { v: null, err: 'Cannot be negative' };
      return { v: n };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
      return Number.isFinite(n) ? { v: n } : { v: null, err: 'Enter a valid number' };
    }
    case 'date':
      return DATE_RE.test(String(raw)) ? { v: String(raw) } : { v: null, err: 'Invalid date' };
    case 'datetime':
      return DATETIME_RE.test(String(raw)) ? { v: String(raw) } : { v: null, err: 'Invalid date/time' };
    case 'bool':
      return { v: raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0 };
    case 'select': {
      const s = String(raw);
      if (f.options && !f.options.some((o) => o.value === s)) return { v: null, err: 'Invalid choice' };
      return { v: s };
    }
    case 'ref':
      return { v: String(raw) };
  }
  return { v: raw };
}

function defaultFor(f: FieldDef): any {
  if (f.default === 'today') return todayISO();
  if (f.default === 'now') return nowLocalISO();
  return f.default ?? null;
}

function refExists(f: FieldDef, id: string): boolean {
  if (!f.ref) return true;
  const spec = REFS[f.ref];
  return !!get(`SELECT 1 AS x FROM ${spec.table} WHERE id = ?`, [id]);
}

/** Compose SQL selecting all columns plus `<ref>__label` for every reference field. */
function selectSql(def: ModuleDef): string {
  const labels = def.fields.filter((f) => f.type === 'ref' && f.ref).map((f) => `${labelSubquery(f.ref!, f.key)} AS ${f.key}__label`);
  return `SELECT t.*${labels.length ? ', ' + labels.join(', ') : ''} FROM ${def.table} t`;
}

export interface ListQuery {
  search?: string;
  filters?: Record<string, string | null | undefined>;
  from?: string | null;
  to?: string | null;
  archived?: boolean;
  page?: number;
  pageSize?: number;
}

export function listRecords(moduleId: string, q: ListQuery = {}): { rows: Row[]; total: number } {
  const def = getDef(moduleId);
  const hooks = HOOKS[moduleId] || {};
  const where: string[] = [];
  const params: any[] = [];
  if (def.softDelete) where.push(q.archived ? 't.deleted_at IS NOT NULL' : 't.deleted_at IS NULL');
  if (hooks.baseWhere) where.push(hooks.baseWhere);
  for (const fd of def.filters ?? []) {
    const val = q.filters?.[fd.key];
    if (val === undefined || val === null || val === '') continue;
    const col = fd.column ?? fd.key;
    if (!/^[a-z_]+$/.test(col)) continue;
    where.push(`t.${col} = ?`);
    params.push(val);
  }
  // company / project scope always applies when the table has these columns, even if not a visible filter
  for (const k of ['company_id', 'project_id'] as const) {
    const val = q.filters?.[k];
    if (val && !(def.filters ?? []).some((f) => f.key === k) && ((k === 'company_id' && def.hasCompany) || (k === 'project_id' && def.hasProject))) {
      where.push(`t.${k} = ?`);
      params.push(val);
    }
  }
  if (def.dateKey) {
    if (q.from) (where.push(`substr(t.${def.dateKey},1,10) >= ?`), params.push(q.from));
    if (q.to) (where.push(`substr(t.${def.dateKey},1,10) <= ?`), params.push(q.to));
  }
  if (q.search && q.search.trim() && def.searchKeys.length) {
    const like = `%${q.search.trim().toLowerCase()}%`;
    const refLabels = def.fields.filter((f) => f.type === 'ref' && f.ref && f.table).map((f) => `LOWER(IFNULL(${labelSubquery(f.ref!, f.key)},''))`);
    const cols = [...def.searchKeys.map((k) => `LOWER(IFNULL(t.${k},''))`), ...refLabels];
    where.push(`(${cols.map((c) => `${c} LIKE ?`).join(' OR ')})`);
    for (let i = 0; i < cols.length; i++) params.push(like);
  }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = scalar<number>(`SELECT COUNT(*) FROM ${def.table} t${w}`, params) ?? 0;
  const pageSize = Math.min(Math.max(q.pageSize ?? 100, 1), 5000);
  const page = Math.max(q.page ?? 1, 1);
  const rows = all<Row>(`${selectSql(def)}${w} ORDER BY ${orderBy(def)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
  return { rows, total };
}

function orderBy(def: ModuleDef): string {
  // sortBy strings come from code. Columns are prefixed with t.; "<refkey>__label" sorts by the referenced record's display label.
  return def.sortBy
    .split(',')
    .map((part) => {
      const m = /^\s*([a-z_]+?)(__label)?(\s+(ASC|DESC))?\s*$/i.exec(part);
      if (!m) return part;
      const dir = m[3] ?? '';
      if (m[2]) {
        const f = def.fields.find((x) => x.key === m[1] && x.type === 'ref' && x.ref);
        if (f) return `${labelSubquery(f.ref!, f.key)}${dir}`;
      }
      return `t.${m[1]}${dir}`;
    })
    .join(', ');
}

export function getRecord(moduleId: string, id: string): Row | null {
  const def = getDef(moduleId);
  return get<Row>(`${selectSql(def)} WHERE t.id = ?`, [id]) ?? null;
}

function rawRow(def: ModuleDef, id: string): Row | null {
  return get<Row>(`SELECT * FROM ${def.table} WHERE id = ?`, [id]) ?? null;
}

export interface SaveOptions {
  allowDuplicate?: boolean;
  reason?: string;
}

export function saveRecord(moduleId: string, input: { id?: string | null; values: Row }, opts: SaveOptions = {}): { row: Row; warnings: string[]; created: boolean } {
  const def = getDef(moduleId);
  const hooks = HOOKS[moduleId] || {};
  const existing = input.id ? rawRow(def, input.id) : null;
  if (input.id && !existing) throw notFound(def.singular);
  if (existing && def.softDelete && existing.deleted_at) throw validation('This record is archived. Restore it before editing.');

  const clean: Row = {};
  const fieldErrors: Record<string, string> = {};
  for (const f of def.fields) {
    if (f.readOnly) continue;
    if (!(f.key in input.values)) {
      if (!existing) clean[f.key] = defaultFor(f);
      continue;
    }
    const { v, err } = coerce(f, input.values[f.key]);
    if (err) fieldErrors[f.key] = err;
    else clean[f.key] = v;
  }
  const merged: Row = { ...(existing ?? {}), ...clean };
  for (const f of def.fields) {
    if (f.required && !f.readOnly && (merged[f.key] === null || merged[f.key] === undefined || merged[f.key] === '')) {
      fieldErrors[f.key] = 'Required';
    }
    if (f.type === 'ref' && f.ref && !f.readOnly && clean[f.key] && !refExists(f, clean[f.key])) fieldErrors[f.key] = 'Selected value no longer exists';
  }
  if (Object.keys(fieldErrors).length) {
    const first = Object.entries(fieldErrors)[0];
    const label = def.fields.find((f) => f.key === first[0])?.label ?? first[0];
    throw validation(`${label}: ${first[1]}`, fieldErrors);
  }

  // derived (computed) fields
  if (def.derive) {
    const hint: Row = { ...merged };
    const d = def.derive(hint);
    Object.assign(clean, d);
    Object.assign(merged, d);
  }

  const ctx: HookCtx = { def, existing, merged, warnings: [], confirmed: !!opts.allowDuplicate };
  hooks.beforeSave?.(clean, ctx);
  Object.assign(merged, clean);
  if (ctx.warnings.length && !opts.allowDuplicate) needsConfirm(ctx.warnings);

  const now = nowIso();
  let saved: Row = {};
  tx(() => {
    if (!existing) {
      const id = newId();
      if (def.numberKey && !clean[def.numberKey.key]) {
        const dateVal = def.numberKey.dateKey ? merged[def.numberKey.dateKey] : undefined;
        clean[def.numberKey.key] = nextNumber(def.numberKey.prefix, { date: dateVal, fy: !!def.numberKey.dateKey });
      }
      if (moduleId === 'units') clean.id = clean.code;
      // blank optional fields are omitted so column defaults (e.g. amount = 0, status = 'active') apply
      const cols = ['id', ...Object.keys(clean).filter((k) => k !== 'id' && clean[k] !== null && clean[k] !== undefined)];
      const vals = cols.map((c) => (c === 'id' ? clean.id ?? id : clean[c]));
      const hasTs = def.softDelete || moduleId === 'units';
      const colSql = hasTs ? [...cols, 'created_at', 'updated_at'] : cols;
      const valSql = hasTs ? [...vals, now, now] : vals;
      try {
        run(`INSERT INTO ${def.table} (${colSql.join(',')}) VALUES (${colSql.map(() => '?').join(',')})`, valSql);
      } catch (e: any) {
        throw friendlyDbError(e, def);
      }
      saved = rawRow(def, clean.id ?? id)!;
      audit(ENTITY_TYPE[moduleId] ?? moduleId, saved.id, 'create', { summary: `Created ${def.singular}`, after: saved });
    } else if (hooks.update) {
      saved = hooks.update(existing, clean, ctx, opts.reason);
    } else {
      const keys = Object.keys(clean).filter((k) => k !== 'id');
      if (moduleId === 'units' && clean.code && clean.code !== existing.code) throw validation('A unit code cannot be changed once created. Add a new unit instead.');
      try {
        run(`UPDATE ${def.table} SET ${keys.map((k) => `${k} = ?`).join(', ')}${def.softDelete ? ', updated_at = ?' : ''} WHERE id = ?`, [
          ...keys.map((k) => clean[k]),
          ...(def.softDelete ? [now] : []),
          existing.id,
        ]);
      } catch (e: any) {
        throw friendlyDbError(e, def);
      }
      saved = rawRow(def, existing.id)!;
      audit(ENTITY_TYPE[moduleId] ?? moduleId, saved.id, 'update', {
        summary: diffSummary(existing, saved),
        before: existing,
        after: saved,
        reason: opts.reason ?? null,
      });
    }
    hooks.afterSave?.(saved, { ...ctx, merged: { ...merged, ...saved } });
  });
  const et = ENTITY_TYPE[moduleId];
  if (et) {
    try {
      indexEntity(et, saved.id);
    } catch {
      /* index is best-effort */
    }
  }
  return { row: getRecord(moduleId, saved.id)!, warnings: ctx.warnings, created: !existing };
}

export function friendlyDbError(e: any, def: ModuleDef): Error {
  const msg = String(e?.message || e);
  if (/UNIQUE constraint failed/i.test(msg)) {
    if (/code/.test(msg) && def.id === 'units') return validation('A unit with this code already exists.');
    return validation(`${def.singular} already exists (a record with the same name/number is already saved).`);
  }
  if (/FOREIGN KEY constraint failed/i.test(msg)) return validation('A linked record is missing or still in use.');
  const nn = /NOT NULL constraint failed: [a-z_]+.([a-z_]+)/i.exec(msg);
  if (nn) {
    const f = def.fields.find((x) => x.key === nn[1]);
    return validation(`${f?.label ?? nn[1]} cannot be left blank.`, { [nn[1]]: 'Required' });
  }
  if (/CHECK constraint failed/i.test(msg)) return validation('A value is out of the allowed range (quantities and amounts must be positive).');
  return e instanceof Error ? e : new Error(msg);
}

export function removeRecord(moduleId: string, id: string, reason?: string): void {
  const def = getDef(moduleId);
  const hooks = HOOKS[moduleId] || {};
  const row = rawRow(def, id);
  if (!row) throw notFound(def.singular);
  hooks.beforeRemove?.(row);
  tx(() => {
    if (def.softDelete) {
      run(`UPDATE ${def.table} SET deleted_at = ?, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), id]);
      audit(ENTITY_TYPE[moduleId] ?? moduleId, id, 'delete', { summary: `Archived ${def.singular}`, before: row, reason: reason ?? null });
    } else {
      try {
        run(`DELETE FROM ${def.table} WHERE id = ?`, [id]);
      } catch (e: any) {
        if (/FOREIGN KEY/i.test(String(e?.message))) throw validation(`This ${def.singular.toLowerCase()} is in use and cannot be deleted. Mark it inactive instead.`);
        throw e;
      }
      audit(ENTITY_TYPE[moduleId] ?? moduleId, id, 'delete', { summary: `Deleted ${def.singular}`, before: row, reason: reason ?? null });
    }
    hooks.afterRemove?.(row);
  });
  const et = ENTITY_TYPE[moduleId];
  if (et) unindexEntity(et, id);
}

export function restoreRecord(moduleId: string, id: string): Row {
  const def = getDef(moduleId);
  if (!def.softDelete) throw validation('This record type cannot be restored.');
  const row = rawRow(def, id);
  if (!row) throw notFound(def.singular);
  try {
    tx(() => {
      run(`UPDATE ${def.table} SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [nowIso(), id]);
      audit(ENTITY_TYPE[moduleId] ?? moduleId, id, 'restore', { summary: `Restored ${def.singular}` });
      HOOKS[moduleId]?.afterRestore?.(rawRow(def, id)!);
    });
  } catch (e: any) {
    throw friendlyDbError(e, def);
  }
  const et = ENTITY_TYPE[moduleId];
  if (et) indexEntity(et, id);
  return getRecord(moduleId, id)!;
}

export function history(entityType: string, entityId: string, limit = 200) {
  return all(`SELECT id, at, actor, action, summary, reason, before_json, after_json FROM audit_logs WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT ?`, [
    entityType,
    entityId,
    limit,
  ]);
}

export { ApiError };
