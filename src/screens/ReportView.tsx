import React, { useState } from 'react';
import { FileDown, FileSpreadsheet, FolderOpen } from 'lucide-react';
import { api, useAsync } from '../lib/api';
import { useAction, useApp } from '../lib/ctx';
import { formatDate, formatDateTime, formatINR, formatPct, formatQty } from '../shared/num';
import { Button, Card, EmptyState, ErrorState, Note, Tabs, TableSkeleton } from '../ui/base';

export interface ReportFiltersState {
  companyId?: string | null;
  projectId?: string | null;
  supplierId?: string | null;
  specId?: string | null;
  from?: string | null;
  to?: string | null;
  month?: string | null;
  date?: string | null;
}

const isNum = (t: string) => ['money', 'money_signed', 'qty', 'int', 'pct', 'number'].includes(t);

function fmt(type: string, v: any, unit?: string): string {
  if (v === null || v === undefined || v === '') return '';
  switch (type) {
    case 'money':
    case 'money_signed':
      return formatINR(Number(v));
    case 'qty':
      return formatQty(Number(v), unit);
    case 'pct':
      return formatPct(Number(v));
    case 'date':
      return formatDate(String(v));
    case 'datetime':
      return formatDateTime(String(v));
    case 'int':
      return String(Math.round(Number(v)));
    case 'number':
      return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 });
    default:
      return String(v);
  }
}

/** Live preview of any report definition: same data, columns and totals as the Excel / PDF output. */
export function ReportView({ reportId, filters, exportable = true, maxHeight }: { reportId: string; filters: ReportFiltersState; exportable?: boolean; maxHeight?: number | string }) {
  const { dataVersion, toast } = useApp();
  const act = useAction();
  const prev = useAsync(() => api<any>('report.preview', { id: reportId, filters }), [reportId, JSON.stringify(filters), dataVersion]);
  const [sheet, setSheet] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const d = prev.data;
  const sh = d?.sheets?.[Math.min(sheet, (d?.sheets?.length ?? 1) - 1)];

  const generate = async (formats: Array<'xlsx' | 'pdf'>) => {
    setBusy(formats.join());
    try {
      const r = await act(() => api<any[]>('report.generate', { id: reportId, filters, formats }));
      if (r?.length) {
        toast('success', `${r.map((x) => x.format.toUpperCase()).join(' + ')} saved in the reports folder. Opening…`);
        await api('report.open', { id: r[0].id }).catch(() => {});
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {d && d.sheets.length > 1 && <Tabs tabs={d.sheets.map((s: any, i: number) => ({ id: String(i), label: s.name, count: s.rows.length }))} value={String(sheet)} onChange={(v) => setSheet(Number(v))} />}
        </div>
        {exportable && (
          <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
            <Button icon={<FileSpreadsheet size={14} />} loading={busy === 'xlsx'} onClick={() => generate(['xlsx'])} disabled={!!prev.error}>
              Export Excel
            </Button>
            <Button icon={<FileDown size={14} />} loading={busy === 'pdf'} onClick={() => generate(['pdf'])} disabled={!!prev.error}>
              Export PDF
            </Button>
            <Button iconOnly aria-label="Open reports folder" title="Open reports folder" icon={<FolderOpen size={14} />} onClick={() => api('report.openFolder', { companyId: filters.companyId ?? null }).catch(() => {})} />
          </div>
        )}
      </div>
      {prev.error && <ErrorState message={prev.error} onRetry={prev.reload} />}
      {!d && prev.loading && <TableSkeleton />}
      {sh && (
        <Card style={{ overflow: 'hidden', opacity: prev.loading ? 0.6 : 1 }}>
          <div style={{ overflow: 'auto', maxHeight }}>
            <table className="tbl" data-selectable>
              <thead>
                <tr>
                  {sh.columns.map((c: any) => (
                    <th key={c.key} className={isNum(c.type) ? 'r' : undefined}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sh.rows.length === 0 && (
                  <tr>
                    <td colSpan={sh.columns.length}>
                      <EmptyState title={sh.emptyMessage ?? 'No records for the selected filters'} />
                    </td>
                  </tr>
                )}
                {sh.rows.map((r: any, i: number) => (
                  <tr key={i}>
                    {sh.columns.map((c: any) => (
                      <td key={c.key} className={isNum(c.type) ? 'r num' : undefined} style={isNum(c.type) ? { whiteSpace: 'nowrap' } : undefined}>
                        {fmt(c.type, r[c.key], c.unitKey ? r[c.unitKey] : undefined)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {sh.totals && (
                <tfoot>
                  <tr>
                    {sh.columns.map((c: any, i: number) => (
                      <td key={c.key} className={isNum(c.type) ? 'r num' : undefined}>
                        {i === 0 ? 'Total' : c.total ? (sh.totals.main[c.key] === 'mixed' ? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>see below</span> : fmt(c.type, sh.totals.main[c.key])) : ''}
                      </td>
                    ))}
                  </tr>
                  {sh.totals.byUnit.map((u: any) => (
                    <tr key={u.label}>
                      {sh.columns.map((c: any, i: number) => (
                        <td key={c.key} className={isNum(c.type) ? 'r num' : undefined} style={{ position: 'static', background: 'var(--surface)', borderTop: 0, fontWeight: 400, color: 'var(--ink-3)', fontStyle: 'italic' }}>
                          {i === 0 ? u.label : u.values[c.key] != null && c.type === 'qty' ? fmt('qty', u.values[c.key]) : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}
      {sh?.notes?.length > 0 && (
        <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
          {sh.notes.map((n: string, i: number) => (
            <Note key={i} tone="info">
              {n}
            </Note>
          ))}
        </div>
      )}
    </div>
  );
}
