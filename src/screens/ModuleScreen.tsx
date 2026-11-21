import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, FileSpreadsheet, History as HistoryIcon, Inbox, Plus, RefreshCw, RotateCcw, Search, X } from 'lucide-react';
import { FieldDef, FilterDef, MODULES, ModuleDef, STATUS_TONE } from '../shared/modules';
import { formatDate, formatDateTime, formatINR, formatPct, formatQty, nowLocalISO, todayISO } from '../shared/num';
import { api, ApiFailure, errMsg, useAsync, useDebounced } from '../lib/api';
import { useAction, useApp } from '../lib/ctx';
import { Button, Chip, EmptyState, Note, StatusChip, Tabs } from '../ui/base';
import { Checkbox, Field, Input, NumberInput, RefSelect, Select, TextArea } from '../ui/inputs';
import { Drawer } from '../ui/overlay';
import { Column, DataTable } from '../ui/table';
import { DocsPanel, HistoryPanel } from './Panels';

// ------------------------------------------------------------------ cell rendering
export function renderValue(f: FieldDef, row: Record<string, any>): React.ReactNode {
  const v = row[f.key];
  if (v === null || v === undefined || v === '') return <span style={{ color: 'var(--ink-4)' }}>—</span>;
  switch (f.type) {
    case 'money':
      return formatINR(v);
    case 'qty':
      return formatQty(v, f.unitField ? row[f.unitField] : undefined);
    case 'pct':
      return formatPct(v);
    case 'date':
      return formatDate(v);
    case 'datetime':
      return formatDateTime(v);
    case 'bool':
      return f.key === 'active' ? <Chip tone={v ? 'good' : 'neutral'}>{v ? 'Active' : 'Inactive'}</Chip> : v ? 'Yes' : 'No';
    case 'ref':
      return row[`${f.key}__label`] ?? (f.ref === 'unit' ? String(v) : '—');
    case 'select': {
      const opt = f.options?.find((o) => o.value === v);
      if (STATUS_TONE[v]) return <StatusChip value={v} label={opt?.label} />;
      return opt?.label ?? String(v);
    }
    case 'textarea':
      return <span style={{ display: 'inline-block', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>{String(v)}</span>;
    default:
      return String(v);
  }
}
const isNum = (f: FieldDef) => ['money', 'qty', 'pct', 'int', 'number'].includes(f.type);

export function columnsFor(def: ModuleDef): Column<any>[] {
  return def.fields
    .filter((f) => f.table)
    .map((f) => ({
      key: f.key,
      header: f.label,
      align: isNum(f) ? ('r' as const) : ('l' as const),
      mono: f.key === 'code' || f.key.endsWith('_no'),
      render: (r: any) => renderValue(f, r),
    }));
}

// ------------------------------------------------------------------ form
type Values = Record<string, any>;

function initialValues(def: ModuleDef, row: Values | null, preset: Values): Values {
  const v: Values = {};
  for (const f of def.fields) {
    if (row) v[f.key] = row[f.key] ?? null;
    else if (preset[f.key] !== undefined) v[f.key] = preset[f.key];
    else v[f.key] = f.default === 'today' ? todayISO() : f.default === 'now' ? nowLocalISO() : f.default ?? null;
  }
  if (row?.formula_expr) v.__formula = row.formula_expr;
  return v;
}

export function RecordForm({
  def,
  row,
  preset = {},
  locked = [],
  onSaved,
  onCancel,
  saveLabel,
  extra,
}: {
  def: ModuleDef;
  row: Values | null;
  preset?: Values;
  locked?: string[];
  onSaved: (saved: Values) => void;
  onCancel: () => void;
  saveLabel?: string;
  extra?: (values: Values, set: (k: string, v: any) => void) => React.ReactNode;
}) {
  const { saveConfirmed, prompt, toast, bump } = useApp();
  const [values, setValues] = useState<Values>(() => initialValues(def, row, preset));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useMemo(() => `form-${def.id}-${Math.random().toString(36).slice(2, 7)}`, [def.id]);

  const set = useCallback(
    (key: string, val: any, opt?: { meta?: Record<string, any> | null }) => {
      setValues((prev) => {
        let next: Values = { ...prev, [key]: val };
        const f = def.fields.find((x) => x.key === key);
        // dependent pickers reset when their parent changes
        if (f) for (const c of def.fields) if (c.refParent === key && prev[key] !== val && c.key !== key) next[c.key] = null;
        if (f?.fills && opt?.meta) {
          for (const [target, metaKey] of Object.entries(f.fills)) if (opt.meta[metaKey] !== undefined) next[target] = opt.meta[metaKey];
        }
        if (f?.type === 'ref' && f.ref === 'formula') next.__formula = opt?.meta?.expression ?? null;
        if (def.derive) next = { ...next, ...def.derive(next) };
        return next;
      });
      setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
    },
    [def]
  );

  // derived fields should be right on first paint of an existing record
  useEffect(() => {
    if (def.derive) setValues((v) => ({ ...v, ...def.derive!(v) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (saving) return;
    setFormError(null);
    const local: Record<string, string> = {};
    for (const f of def.fields) {
      if (f.required && !f.readOnly && (values[f.key] === null || values[f.key] === undefined || values[f.key] === '')) local[f.key] = 'Required';
    }
    if (Object.keys(local).length) {
      setErrors(local);
      const first = def.fields.find((f) => local[f.key]);
      setFormError(`${first?.label ?? 'A field'} is required.`);
      return;
    }
    let reason: string | undefined;
    if (row && def.id === 'measurement') {
      const r = await prompt({ title: 'Revise measurement', label: 'Reason for the revision', required: true, confirmLabel: 'Save revision', body: <span>The original entry is kept in history; this creates revision {Number(row.revision ?? 1) + 1}.</span>, placeholder: 'e.g. Re-measured after joint inspection' });
      if (r === null) return;
      reason = r;
    }
    const payload: Values = {};
    for (const f of def.fields) if (!f.readOnly) payload[f.key] = values[f.key] ?? null;
    setSaving(true);
    try {
      const res = await saveConfirmed((allow) => api<{ row: Values; warnings: string[] }>('crud.save', { module: def.id, id: row?.id ?? null, values: payload, allowDuplicate: allow, reason }));
      if (res) {
        toast('success', `${def.singular} ${row ? 'updated' : 'saved'}`);
        bump();
        onSaved(res.row);
      }
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors ?? {});
        setFormError(err.message);
      } else setFormError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  let lastSection: string | undefined;
  return (
    <form id={formId} onSubmit={submit} noValidate>
      {def.description && !row && (
        <div style={{ marginBottom: 14, color: 'var(--ink-3)', lineHeight: 1.5 }}>{def.description}</div>
      )}
      {formError && (
        <div style={{ marginBottom: 14 }}>
          <Note tone="bad">{formError}</Note>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '14px 14px' }}>
        {def.fields.map((f) => {
          const sec = f.section && f.section !== lastSection ? f.section : null;
          if (f.section) lastSection = f.section;
          return (
            <React.Fragment key={f.key}>
              {sec && (
                <div style={{ gridColumn: 'span 6', marginTop: 6 }}>
                  <div className="eyebrow" style={{ paddingBottom: 6, borderBottom: '1px solid var(--line)' }}>
                    {sec}
                  </div>
                </div>
              )}
              <Field label={f.type === 'bool' ? undefined : f.label} required={f.required && !f.readOnly} error={errors[f.key]} help={f.help} htmlFor={`${formId}-${f.key}`} style={{ gridColumn: `span ${f.span ?? 3}` }}>
                <FieldInput id={`${formId}-${f.key}`} f={f} def={def} values={values} set={set} invalid={!!errors[f.key]} locked={locked.includes(f.key)} />
              </Field>
            </React.Fragment>
          );
        })}
      </div>
      {extra?.(values, (k, v) => set(k, v))}
      <div style={{ position: 'sticky', bottom: -20, margin: '24px -20px -20px', padding: '12px 20px', background: 'var(--surface)', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" loading={saving}>
          {saveLabel ?? (row ? 'Save changes' : `Save ${def.singular.toLowerCase()}`)}
        </Button>
      </div>
    </form>
  );
}

function FieldInput({ id, f, def, values, set, invalid, locked }: { id: string; f: FieldDef; def: ModuleDef; values: Values; set: (k: string, v: any, o?: { meta?: Record<string, any> | null }) => void; invalid: boolean; locked: boolean }) {
  const v = values[f.key];
  const readOnly = !!f.readOnly || locked;
  const unit = f.unitField ? values[f.unitField] : undefined;
  void def;
  if (f.readOnly) {
    let shown = '';
    if (v !== null && v !== undefined) {
      if (f.type === 'money') shown = formatINR(v);
      else if (f.type === 'qty') shown = formatQty(v, unit);
      else if (f.type === 'pct') shown = formatPct(v);
      else if (f.type === 'select') shown = f.options?.find((o) => o.value === v)?.label ?? String(v);
      else shown = String(v);
    }
    return <Input id={id} readOnly value={shown} placeholder={f.help?.includes('automatically') ? 'Generated automatically' : 'Calculated'} style={isNum(f) ? { textAlign: 'right' } : undefined} tabIndex={-1} />;
  }
  switch (f.type) {
    case 'text':
      return <Input id={id} value={v ?? ''} invalid={invalid} readOnly={readOnly} placeholder={f.placeholder} style={f.uppercase ? { textTransform: 'uppercase' } : undefined} onChange={(e) => set(f.key, e.target.value)} />;
    case 'textarea':
      return <TextArea id={id} value={v ?? ''} invalid={invalid} readOnly={readOnly} placeholder={f.placeholder} rows={3} onChange={(e) => set(f.key, e.target.value)} />;
    case 'int':
    case 'number':
      return <NumberInput id={id} kind={f.type === 'int' ? 'int' : 'number'} value={v} invalid={invalid} readOnly={readOnly} onChange={(n) => set(f.key, n)} placeholder={f.placeholder} />;
    case 'money':
      return <NumberInput id={id} kind="money" prefix="₹" value={v} invalid={invalid} readOnly={readOnly} onChange={(n) => set(f.key, n)} placeholder="0.00" />;
    case 'qty':
      return <NumberInput id={id} kind="qty" suffix={unit || undefined} value={v} invalid={invalid} readOnly={readOnly} onChange={(n) => set(f.key, n)} placeholder="0.000" />;
    case 'pct':
      return <NumberInput id={id} kind="pct" suffix="%" value={v} invalid={invalid} readOnly={readOnly} onChange={(n) => set(f.key, n)} placeholder="0" />;
    case 'date':
      return <Input id={id} type="date" value={v ?? ''} invalid={invalid} readOnly={readOnly} onChange={(e) => set(f.key, e.target.value || null)} />;
    case 'datetime':
      return <Input id={id} type="datetime-local" value={v ? String(v).slice(0, 16) : ''} invalid={invalid} readOnly={readOnly} onChange={(e) => set(f.key, e.target.value || null)} />;
    case 'select':
      return <Select id={id} value={v} invalid={invalid} disabled={readOnly} options={f.options ?? []} placeholder={f.required ? 'Select…' : '—'} onChange={(x) => set(f.key, x || null)} />;
    case 'bool':
      return <Checkbox checked={!!v} disabled={readOnly} label={f.label} onChange={(c) => set(f.key, c ? 1 : 0)} />;
    case 'ref':
      return (
        <RefSelect
          id={id}
          refKind={f.ref!}
          value={v}
          invalid={invalid}
          disabled={readOnly}
          clearable={!f.required}
          parentColumn={f.refParent ? f.refParentColumn ?? f.refParent : undefined}
          parentValue={f.refParent ? values[f.refParent] : undefined}
          onChange={(idv, opt) => set(f.key, idv, { meta: opt?.meta ?? null })}
          initialLabel={undefined}
        />
      );
  }
  return null;
}

// ------------------------------------------------------------------ screen
const EXPORT_REPORT: Record<string, string> = {
  projects: 'project_register',
  suppliers: 'supplier_master',
  specs: 'material_master',
  supplierMaterials: 'supplier_rates',
  consumption: 'consumption_register',
  payments: 'payment_register',
  invoices: 'invoice_register',
  royalty: 'royalty_register',
  quality: 'quality_register',
  measurement: 'measurement_book',
  progress: 'daily_progress',
};
const TOTAL_KEYS: Record<string, string[]> = { payments: ['amount_paise'], invoices: ['total_paise'], projects: ['contract_value_paise'] };

export interface ModuleScreenProps {
  moduleId: string;
  /** locked filter values (e.g. supplier_id) — also pre-filled on new records */
  fixed?: Record<string, string>;
  presetValues?: Values;
  openId?: string | null;
  embedded?: boolean;
  title?: string;
  rowActions?: (row: any, reload: () => void) => React.ReactNode;
  toolbarExtra?: React.ReactNode;
  /** extra drawer tabs for an existing record */
  recordTabs?: Array<{ id: string; label: string; render: (row: any) => React.ReactNode }>;
  addLabel?: string;
  hideAdd?: boolean;
  onRowOpen?: (row: any) => boolean | void;
  maxHeight?: number | string;
  drawerWide?: boolean;
  formExtra?: (values: Values, set: (k: string, v: any) => void) => React.ReactNode;
  emptyHint?: React.ReactNode;
  /** open the "new record" form immediately (deep links from the dashboard) */
  startNew?: boolean;
  groupBy?: (row: any) => string | null;
}

export function ModuleScreen(props: ModuleScreenProps) {
  const def = MODULES[props.moduleId];
  const { scope, bump, dataVersion, confirm, prompt, toast } = useApp();
  const act = useAction();
  const [search, setSearch] = useState('');
  const dSearch = useDebounced(search, 250);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<{ row: any | null } | null>(null);
  const [tab, setTab] = useState('details');
  const [exporting, setExporting] = useState(false);

  // apply workspace scope as the default company/project filter
  useEffect(() => {
    setFilters((f) => {
      const n = { ...f };
      if (def.hasCompany || def.filters?.some((x) => x.key === 'company_id')) n.company_id = scope.companyId ?? '';
      if (def.hasProject || def.filters?.some((x) => x.key === 'project_id')) n.project_id = scope.projectId ?? '';
      return n;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.companyId, scope.projectId, props.moduleId]);

  const effFilters = useMemo(() => {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...filters, ...(props.fixed ?? {}) })) if (v) o[k] = v;
    return o;
  }, [filters, props.fixed]);

  const list = useAsync(
    () => api<{ rows: any[]; total: number }>('crud.list', { module: def.id, search: dSearch || undefined, filters: effFilters, from: from || null, to: to || null, archived, pageSize: 500 }),
    [def.id, dSearch, JSON.stringify(effFilters), from, to, archived, dataVersion]
  );

  useEffect(() => {
    if (props.startNew) setEditing({ row: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // open a record requested by navigation (search results, links)
  useEffect(() => {
    if (!props.openId) return;
    let dead = false;
    api<any>('crud.get', { module: def.id, id: props.openId })
      .then((r) => !dead && r && (setEditing({ row: r }), setTab('details')))
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [props.openId, def.id]);

  const columns = useMemo(() => {
    const cols = columnsFor(def);
    const totalKeys = TOTAL_KEYS[def.id];
    if (totalKeys && list.data && list.data.total <= list.data.rows.length) {
      for (const c of cols) if (totalKeys.includes(c.key)) c.total = (rows) => formatINR(rows.reduce((a, r) => a + (r[c.key] || 0), 0));
    }
    if (def.statusKey === undefined) return cols;
    return cols;
  }, [def, list.data]);

  const rows = list.data?.rows ?? null;
  const reload = list.reload;

  const open = (row: any) => {
    if (props.onRowOpen && props.onRowOpen(row) === true) return;
    setEditing({ row });
    setTab('details');
  };

  const doArchive = async (row: any) => {
    const reason = await prompt({ title: `Archive ${def.singular.toLowerCase()}?`, label: 'Reason (optional)', confirmLabel: 'Archive', body: <span>It will be hidden from lists and pickers but stays in your records and can be restored.</span> });
    if (reason === null) return;
    const r = await act(() => api('crud.remove', { module: def.id, id: row.id, reason: reason || undefined }), `${def.singular} archived`);
    if (r) {
      bump();
      setEditing(null);
    }
  };
  const doRestore = async (row: any) => {
    const r = await act(() => api('crud.restore', { module: def.id, id: row.id }), `${def.singular} restored`);
    if (r) bump();
  };

  const exportReport = EXPORT_REPORT[def.id];
  const doExport = async () => {
    if (!exportReport) return;
    setExporting(true);
    try {
      const res = await act(() => api<any[]>('report.generate', { id: exportReport, filters: { companyId: effFilters.company_id || null, projectId: effFilters.project_id || null, supplierId: effFilters.supplier_id || null, specId: effFilters.spec_id || null, from: from || null, to: to || null }, formats: ['xlsx'] }));
      if (res?.[0]) {
        toast('success', 'Excel report created. Opening…');
        await api('report.open', { id: res[0].id }).catch(() => {});
      }
    } finally {
      setExporting(false);
    }
  };

  const visibleFilters = (def.filters ?? []).filter((f) => !(props.fixed && props.fixed[f.key]));
  const hasFilters = !!(dSearch || from || to || Object.entries(effFilters).some(([k, v]) => v && !(props.fixed && props.fixed[k]) && k !== 'company_id' && k !== 'project_id'));
  const preset = { ...(def.hasCompany || def.filters?.some((f) => f.key === 'company_id') ? { company_id: effFilters.company_id ?? scope.companyId } : {}), ...(def.hasProject || def.filters?.some((f) => f.key === 'project_id') ? { project_id: effFilters.project_id ?? scope.projectId } : {}), ...(props.fixed ?? {}), ...(props.presetValues ?? {}) };

  const tabs = editing?.row
    ? [
        { id: 'details', label: 'Details' },
        ...(props.recordTabs ?? []).map((t) => ({ id: t.id, label: t.label })),
        ...(def.attach ? [{ id: 'documents', label: 'Documents' }] : []),
        { id: 'history', label: 'History' },
      ]
    : [];

  return (
    <div>
      {!props.embedded && (
        <div style={{ padding: '0' }} />
      )}
      <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 12 }}>
        <div style={{ position: 'relative', width: 260 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--ink-4)' }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${props.title?.toLowerCase() ?? def.title.toLowerCase()}…`} style={{ paddingLeft: 30 }} aria-label="Search" />
        </div>
        {visibleFilters.map((fd) => (
          <FilterControl key={fd.key} fd={fd} value={filters[fd.key] ?? ''} onChange={(v) => setFilters((f) => ({ ...f, [fd.key]: v }))} />
        ))}
        {def.dateKey && (
          <div className="flex items-center gap-1">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 138 }} aria-label="From date" />
            <span style={{ color: 'var(--ink-4)' }}>to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 138 }} aria-label="To date" />
          </div>
        )}
        {(from || to || search) && (
          <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={() => (setSearch(''), setFrom(''), setTo(''))}>
            Clear
          </Button>
        )}
        <div style={{ flex: 1 }} />
        {def.softDelete && (
          <Checkbox checked={archived} onChange={setArchived} label={<span style={{ color: 'var(--ink-2)' }}>Show archived</span>} />
        )}
        {props.toolbarExtra}
        <Button iconOnly aria-label="Refresh" title="Refresh" icon={<RefreshCw size={14} className={list.loading ? 'spin' : undefined} />} onClick={reload} />
        {exportReport && (
          <Button icon={<FileSpreadsheet size={14} />} loading={exporting} onClick={doExport}>
            Export Excel
          </Button>
        )}
        {!props.hideAdd && !archived && (
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => (setEditing({ row: null }), setTab('details'))}>
            {props.addLabel ?? def.addLabel ?? `New ${def.singular.toLowerCase()}`}
          </Button>
        )}
      </div>

      <DataTable
        rows={rows}
        columns={[
          ...columns,
          {
            key: '__actions',
            header: '',
            width: 1,
            render: (r) => (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                {props.rowActions?.(r, reload)}
                {archived ? (
                  <Button size="sm" icon={<RotateCcw size={12} />} onClick={() => doRestore(r)}>
                    Restore
                  </Button>
                ) : (
                  def.softDelete && <Button size="sm" variant="ghost" iconOnly aria-label="Archive" title="Archive" icon={<Archive size={13} />} onClick={() => doArchive(r)} />
                )}
              </div>
            ),
          },
        ]}
        loading={list.loading}
        error={list.error}
        onRetry={reload}
        onRowClick={open}
        maxHeight={props.maxHeight}
        groupBy={props.groupBy}
        empty={
          hasFilters ? (
            <EmptyState icon={<Search size={22} />} title="No matching records">
              Nothing matches the current search or filters.
            </EmptyState>
          ) : (
            <EmptyState
              icon={<Inbox size={22} />}
              title={archived ? 'No archived records' : `No ${def.title.toLowerCase()} yet`}
              action={
                !props.hideAdd && !archived ? (
                  <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing({ row: null })}>
                    {props.addLabel ?? def.addLabel ?? `New ${def.singular.toLowerCase()}`}
                  </Button>
                ) : undefined
              }
            >
              {props.emptyHint ?? def.emptyHint ?? def.description}
            </EmptyState>
          )
        }
      />
      {list.data && list.data.total > 0 && (
        <div style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 12 }} className="num">
          {list.data.total} record{list.data.total === 1 ? '' : 's'}
          {list.data.total > list.data.rows.length ? ` (showing first ${list.data.rows.length} — narrow the filters)` : ''}
        </div>
      )}

      {editing && (
        <Drawer
          wide={props.drawerWide}
          title={editing.row ? `${def.singular}${def.labelKeys[0] && editing.row[def.labelKeys[0]] ? ` · ${renderPlain(def, editing.row)}` : ''}` : props.addLabel ?? def.addLabel ?? `New ${def.singular.toLowerCase()}`}
          subtitle={editing.row ? (editing.row.deleted_at ? 'Archived record' : undefined) : undefined}
          onClose={() => setEditing(null)}
        >
          {editing.row && tabs.length > 1 && (
            <div style={{ margin: '-20px -20px 18px', padding: '0 20px', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
              <Tabs tabs={tabs} value={tab} onChange={setTab} />
            </div>
          )}
          {tab === 'details' && (
            <>
              {editing.row?.deleted_at ? (
                <div className="flex items-center gap-3">
                  <Note tone="warn">This record is archived and cannot be edited.</Note>
                  <Button icon={<RotateCcw size={13} />} onClick={() => doRestore(editing.row).then(() => setEditing(null))}>
                    Restore
                  </Button>
                </div>
              ) : (
                <RecordForm
                  def={def}
                  row={editing.row}
                  preset={preset}
                  locked={Object.keys(props.fixed ?? {})}
                  extra={props.formExtra}
                  onCancel={() => setEditing(null)}
                  onSaved={(saved) => {
                    setEditing(null);
                    void saved;
                  }}
                />
              )}
            </>
          )}
          {editing.row && tab === 'documents' && def.attach && (
            <DocsPanel entityType={def.attach.entityType} entityId={editing.row.id} defaultDocType={def.attach.docType} companyId={editing.row.company_id} />
          )}
          {editing.row && tab === 'history' && <HistoryPanel entityType={ENTITY_FOR[def.id] ?? def.attach?.entityType ?? def.id} entityId={editing.row.id} />}
          {editing.row && (props.recordTabs ?? []).filter((t) => t.id === tab).map((t) => <React.Fragment key={t.id}>{t.render(editing.row)}</React.Fragment>)}
        </Drawer>
      )}
    </div>
  );
}

const ENTITY_FOR: Record<string, string> = {
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

function renderPlain(def: ModuleDef, row: any): string {
  const parts = def.labelKeys.map((k) => row[k]).filter(Boolean);
  const f = def.fields.find((x) => x.key === def.labelKeys[0]);
  if (f?.type === 'date' && parts[0]) return formatDate(String(parts[0]));
  return parts.join(' — ');
}

export function FilterControl({ fd, value, onChange }: { fd: FilterDef; value: string; onChange: (v: string) => void }) {
  if (fd.type === 'select') {
    return (
      <div style={{ width: 150 }}>
        <Select value={value} onChange={onChange} options={fd.options ?? []} placeholder={fd.label} />
      </div>
    );
  }
  return (
    <div style={{ width: 190 }}>
      <RefSelect refKind={fd.ref!} value={value || null} placeholder={fd.label} onChange={(id) => onChange(id ?? '')} includeInactive />
    </div>
  );
}
