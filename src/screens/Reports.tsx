import React, { useMemo, useState } from 'react';
import { BarChart3, ExternalLink, FileSpreadsheet, FileText, FolderOpen } from 'lucide-react';
import { api, useAsync } from '../lib/api';
import { NavTarget, useAction, useApp } from '../lib/ctx';
import { Button, Card, CardHead, Chip, EmptyState, Note, Page, PageHeader, Tabs } from '../ui/base';
import { Field, Input, RefSelect, Select } from '../ui/inputs';
import { DataTable } from '../ui/table';
import { financialYear, formatDateTime, todayISO } from '../shared/num';
import { ReportView } from './ReportView';

interface Def {
  id: string;
  title: string;
  group: string;
  description: string;
  filters: string[];
  requires?: string[];
  template?: number;
}

function fyOptions() {
  const cur = Number(financialYear(todayISO()).slice(0, 4));
  return Array.from({ length: 6 }, (_, i) => {
    const y = cur - i;
    return { value: `${y}-${String((y + 1) % 100).padStart(2, '0')}`, label: `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}` };
  });
}

function History({ focusId }: { focusId?: string }) {
  const { scope, dataVersion } = useApp();
  const act = useAction();
  const h = useAsync(() => api<any[]>('report.history', { companyId: scope.companyId }), [scope.companyId, dataVersion]);
  return (
    <DataTable
      rows={h.data}
      loading={h.loading}
      error={h.error}
      selectedId={focusId}
      empty={<EmptyState icon={<BarChart3 size={22} />} title="No reports generated yet">Reports you export are filed in each company’s 10_Reports folder and listed here.</EmptyState>}
      columns={[
        { key: 'title', header: 'Report', render: (r) => <b>{r.title}</b> },
        { key: 'format', header: 'Format', render: (r) => <Chip tone={r.format === 'pdf' ? 'info' : 'good'} dot={false}>{r.format.toUpperCase()}</Chip> },
        { key: 'company_name', header: 'Company', muted: true, render: (r) => r.company_name ?? 'All' },
        { key: 'period', header: 'Period', render: (r) => (r.period_from || r.period_to ? `${r.period_from ?? '…'} → ${r.period_to ?? '…'}` : '—') },
        { key: 'created_at', header: 'Generated', muted: true, render: (r) => formatDateTime(String(r.created_at).slice(0, 16)) },
        { key: 'size', header: 'Size', align: 'r', render: (r) => `${Math.max(1, Math.round((r.size_bytes ?? 0) / 1024))} KB` },
        {
          key: 'act',
          header: '',
          render: (r) =>
            r.is_missing ? (
              <Chip tone="bad">File missing</Chip>
            ) : (
              <div className="flex gap-1">
                <Button size="sm" icon={<ExternalLink size={12} />} onClick={() => act(() => api('report.open', { id: r.id }))}>Open</Button>
                <Button size="sm" iconOnly aria-label="Show folder" icon={<FolderOpen size={13} />} onClick={() => act(() => api('system.showInFolder', { path: r.file_path }))} />
              </div>
            ),
        },
      ]}
    />
  );
}

export function ReportsScreen({ focus }: { focus: NavTarget }) {
  const { scope } = useApp();
  const cat = useAsync(() => api<Def[]>('report.catalog'), []);
  const [tab, setTab] = useState<'build' | 'history'>(focus.tab === 'history' ? 'history' : 'build');
  const [reportId, setReportId] = useState('monthly_report');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [specId, setSpecId] = useState<string | null>(null);
  const [period, setPeriod] = useState<'range' | 'month' | 'fy' | 'day'>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [fy, setFy] = useState(financialYear(todayISO()));
  const [day, setDay] = useState(todayISO());

  const def = cat.data?.find((d) => d.id === reportId);
  const groups = useMemo(() => {
    const g = new Map<string, Def[]>();
    for (const d of cat.data ?? []) g.set(d.group, [...(g.get(d.group) ?? []), d]);
    return [...g.entries()];
  }, [cat.data]);

  const effCompany = companyId ?? scope.companyId;
  const effProject = projectId ?? scope.projectId;
  const has = (f: string) => def?.filters.includes(f);
  const needsMonth = def?.requires?.includes('month');
  const needsDate = def?.requires?.includes('date');
  const filters = {
    companyId: effCompany,
    projectId: has('project') ? effProject : null,
    supplierId: has('supplier') ? supplierId : null,
    specId: has('spec') ? specId : null,
    from: period === 'range' && has('period') ? from || null : null,
    to: period === 'range' && has('period') ? to || null : null,
    month: needsMonth ? month : period === 'month' && has('period') ? month : null,
    fy: period === 'fy' && has('period') ? fy : null,
    date: needsDate ? day : period === 'day' && has('period') ? day : null,
  };
  const missingSupplier = def?.requires?.includes('supplier') && !supplierId;

  return (
    <div>
      <PageHeader title="Reports & Analytics" subtitle="Preview any register or report, then export a formatted Excel workbook or PDF. Files are saved in each company’s 10_Reports folder, never overwriting an earlier export." />
      <div style={{ padding: '12px 28px 0' }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'build', label: 'Build a report' }, { id: 'history', label: 'Generated reports' }]} />
      </div>
      <Page>
        {tab === 'history' ? (
          <History focusId={focus.openId} />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0,1fr)', gap: 18, alignItems: 'start' }}>
            <Card style={{ position: 'sticky', top: 0, maxHeight: 'calc(100vh - 190px)', overflow: 'auto' }}>
              {groups.map(([g, defs]) => (
                <div key={g}>
                  <div className="eyebrow" style={{ padding: '12px 14px 6px', background: '#faf8f3', borderBottom: '1px solid var(--line-soft)' }}>{g}</div>
                  {defs.map((d) => (
                    <button key={d.id} onClick={() => setReportId(d.id)} className="flex items-center gap-2" style={{ width: '100%', padding: '8px 14px', textAlign: 'left', border: 0, borderBottom: '1px solid var(--line-soft)', background: reportId === d.id ? 'var(--brand-soft)' : 'transparent', cursor: 'pointer', boxShadow: reportId === d.id ? 'inset 3px 0 0 var(--brand)' : 'none' }}>
                      <FileSpreadsheet size={14} color={reportId === d.id ? 'var(--brand)' : 'var(--ink-4)'} />
                      <span style={{ fontWeight: reportId === d.id ? 600 : 500, flex: 1 }}>{d.title}</span>
                    </button>
                  ))}
                </div>
              ))}
            </Card>

            <div>
              {def && (
                <Card style={{ marginBottom: 14 }}>
                  <CardHead title={def.title} subtitle={def.description} />
                  <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
                    {has('company') && <Field label="Company"><RefSelect refKind="company" value={effCompany} onChange={(v) => (setCompanyId(v), setProjectId(null))} placeholder="All companies" /></Field>}
                    {has('project') && <Field label="Project"><RefSelect refKind="project" value={effProject} onChange={setProjectId} parentColumn="company_id" parentValue={effCompany} placeholder="All projects" includeInactive /></Field>}
                    {has('supplier') && <Field label="Supplier" required={def.requires?.includes('supplier')}><RefSelect refKind="supplier" value={supplierId} onChange={setSupplierId} placeholder="All suppliers" includeInactive /></Field>}
                    {has('spec') && <Field label="Material"><RefSelect refKind="spec" value={specId} onChange={setSpecId} placeholder="All materials" /></Field>}
                    {has('period') && (
                      <>
                        <Field label="Period"><Select value={period} onChange={(v) => setPeriod(v as any)} options={[{ value: 'month', label: 'Month' }, { value: 'fy', label: 'Financial year' }, { value: 'range', label: 'Date range' }, { value: 'day', label: 'Single day' }]} /></Field>
                        {period === 'month' && <Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>}
                        {period === 'fy' && <Field label="Financial year (Apr–Mar)"><Select value={fy} onChange={setFy} options={fyOptions()} /></Field>}
                        {period === 'day' && <Field label="Date"><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>}
                        {period === 'range' && (
                          <>
                            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                          </>
                        )}
                      </>
                    )}
                    {has('month') && !has('period') && <Field label="Month" required><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>}
                    {has('date') && !has('period') && <Field label="Date" required><Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>}
                  </div>
                </Card>
              )}
              {missingSupplier ? (
                <Note tone="info">Choose a supplier above to preview this report.</Note>
              ) : def ? (
                <ReportView key={reportId + JSON.stringify(filters)} reportId={reportId} filters={filters} />
              ) : null}
            </div>
          </div>
        )}
      </Page>
    </div>
  );
}
void FileText;
