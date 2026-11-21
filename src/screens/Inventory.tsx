import React, { useState } from 'react';
import { Plus, Undo2 } from 'lucide-react';
import { api, ApiFailure, errMsg, useAsync } from '../lib/api';
import { NavTarget, useAction, useApp } from '../lib/ctx';
import { Button, Card, CardHead, Chip, EmptyState, Note, Page, PageHeader, Segmented, StatusChip, Tabs } from '../ui/base';
import { Field, Input, NumberInput, RefSelect, Select, TextArea } from '../ui/inputs';
import { Drawer, Modal } from '../ui/overlay';
import { Column, DataTable } from '../ui/table';
import { formatDate, formatINR, formatQty, todayISO } from '../shared/num';
import { ReportView } from './ReportView';

type Tab = 'register' | 'low' | 'reports';

export interface StockRowT {
  company_id: string; project_id: string; spec_id: string; project_name: string; spec_label: string; location: string; unit_code: string;
  opening_milli: number; inward_milli: number; return_milli: number; outward_milli: number; consumption_milli: number; adjustment_milli: number; rejected_milli: number; closing_milli: number;
  min_stock_milli: number | null; value_paise: number | null; avg_rate_paise: number | null; category_name: string;
}

function Ledger({ row, onClose }: { row: StockRowT; onClose: () => void }) {
  const { prompt, bump } = useApp();
  const act = useAction();
  const l = useAsync(() => api<any[]>('stock.ledger', { companyId: row.company_id, projectId: row.project_id, specId: row.spec_id, location: row.location }), [row.spec_id, row.location]);
  const TYPE: Record<string, string> = { opening: 'Opening stock', inward: 'Inward', return: 'Return', outward: 'Outward', consumption: 'Consumption', adjustment: 'Adjustment', rejected: 'Rejected (not stocked)' };
  return (
    <Drawer title={`${row.spec_label} · ${row.location}`} subtitle={`${row.project_name} — stock transactions with running balance`} onClose={onClose} wide>
      <Note tone="info">Every movement is kept. Corrections are made by voiding a manual entry (with a reason) or by editing / cancelling the delivery or consumption that posted it — history is never deleted.</Note>
      <div style={{ marginTop: 14 }}>
        <DataTable
          rows={l.data}
          loading={l.loading}
          error={l.error}
          rowClass={(r) => (r.voided_at ? 'voided' : undefined)}
          columns={[
            { key: 'txn_date', header: 'Date', render: (r) => <span style={{ textDecoration: r.voided_at ? 'line-through' : undefined, color: r.voided_at ? 'var(--ink-4)' : undefined }}>{formatDate(r.txn_date)}</span> },
            { key: 'txn_type', header: 'Type', render: (r) => <span style={{ color: r.voided_at ? 'var(--ink-4)' : undefined }}>{TYPE[r.txn_type]}</span> },
            { key: 'source', header: 'Source', render: (r) => r.source_label ?? (r.source_type ? r.source_type : 'Manual entry') },
            { key: 'qty', header: 'Quantity', align: 'r', render: (r) => (r.txn_type === 'rejected' ? <span style={{ color: 'var(--ink-3)' }}>{formatQty(r.qty_milli, r.unit_code)}</span> : <span style={{ color: r.signed_qty_milli < 0 ? 'var(--bad)' : 'var(--good)', textDecoration: r.voided_at ? 'line-through' : undefined }}>{r.signed_qty_milli > 0 ? '+' : ''}{formatQty(r.signed_qty_milli, r.unit_code)}</span>) },
            { key: 'bal', header: 'Balance', align: 'r', render: (r) => (r.voided_at ? '' : <b>{formatQty(r.balance_milli, r.unit_code)}</b>) },
            { key: 'reason', header: 'Reason / note', render: (r) => (r.voided_at ? <span style={{ color: 'var(--bad)' }}>Voided: {r.void_reason}</span> : r.reason || r.notes || '') },
            {
              key: 'act',
              header: '',
              render: (r) =>
                !r.source_type && !r.voided_at ? (
                  <Button size="sm" variant="ghost" icon={<Undo2 size={12} />} onClick={async () => {
                    const reason = await prompt({ title: 'Void this stock entry?', label: 'Reason', required: true, confirmLabel: 'Void entry' });
                    if (reason) {
                      const ok = await act(() => api('stock.void', { id: r.id, reason }), 'Entry voided');
                      if (ok) (l.reload(), bump());
                    }
                  }}>Void</Button>
                ) : null,
            },
          ]}
        />
      </div>
    </Drawer>
  );
}

function EntryModal({ onClose, onSaved, preset }: { onClose: () => void; onSaved: () => void; preset: { companyId?: string | null; projectId?: string | null } }) {
  const { saveConfirmed, scope, toast } = useApp();
  const [type, setType] = useState<'opening' | 'return' | 'outward' | 'adjustment'>('opening');
  const [date, setDate] = useState(todayISO());
  const [companyId, setCompanyId] = useState<string | null>(preset.companyId ?? scope.companyId);
  const [projectId, setProjectId] = useState<string | null>(preset.projectId ?? scope.projectId);
  const [spec, setSpec] = useState<string | null>(null);
  const [unit, setUnit] = useState('');
  const [location, setLocation] = useState('Main Store');
  const [qty, setQty] = useState<number | null>(null);
  const [sign, setSign] = useState<'plus' | 'minus'>('plus');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const needsReason = type === 'adjustment' || type === 'outward';

  const save = async () => {
    setErr(null);
    if (!companyId || !projectId || !spec) return setErr('Choose company, project and material.');
    if (!qty) return setErr('Enter a quantity.');
    if (needsReason && !reason.trim()) return setErr('A reason is required for this type of entry.');
    setBusy(true);
    try {
      const r = await saveConfirmed((allow) => api('stock.post', { txnDate: date, companyId, projectId, specId: spec, location, type, qtyMilli: type === 'adjustment' && sign === 'minus' ? -qty : qty, reason: reason || undefined, allowDuplicate: allow }));
      if (r) {
        toast('success', 'Stock entry recorded');
        onSaved();
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add stock entry" width={620} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Record entry</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        {err && <Note tone="bad">{err}</Note>}
        <Field label="Entry type">
          <Select value={type} onChange={(v) => setType(v as any)} options={[{ value: 'opening', label: 'Opening stock — quantity already on site' }, { value: 'return', label: 'Return to stock' }, { value: 'outward', label: 'Outward / transfer out' }, { value: 'adjustment', label: 'Stock adjustment (physical count correction)' }]} />
        </Field>
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Company" required><RefSelect refKind="company" value={companyId} onChange={(v) => (setCompanyId(v), setProjectId(null))} /></Field>
          <Field label="Project" required><RefSelect refKind="project" value={projectId} onChange={setProjectId} parentColumn="company_id" parentValue={companyId} /></Field>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Material" required><RefSelect refKind="spec" value={spec} onChange={(id, o) => (setSpec(id), setUnit(o?.meta?.unit_code ?? ''))} /></Field>
          <Field label="Stock location"><Input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <Field label="Date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          {type === 'adjustment' && <Field label="Direction"><Select value={sign} onChange={(v) => setSign(v as any)} options={[{ value: 'plus', label: 'Increase stock (+)' }, { value: 'minus', label: 'Decrease stock (−)' }]} /></Field>}
          <Field label="Quantity" required><NumberInput kind="qty" value={qty} onChange={setQty} suffix={unit || undefined} /></Field>
        </div>
        <Field label={needsReason ? 'Reason' : 'Notes (optional)'} required={needsReason} help={type === 'adjustment' ? 'Every adjustment is audited with this reason.' : undefined}>
          <TextArea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === 'adjustment' ? 'e.g. Physical count on 20-Nov showed 1.5 MT less' : type === 'outward' ? 'e.g. Transferred to Km 12 site' : ''} />
        </Field>
      </div>
    </Modal>
  );
}


const sumValue = (rows: StockRowT[]) => rows.reduce((a, r) => a + (r.value_paise ?? 0), 0);
const stockColumns: Column<StockRowT>[] = [
  { key: 'spec_label', header: 'Material', render: (r) => <span style={{ fontWeight: 600 }}>{r.spec_label}</span> },
  { key: 'location', header: 'Location', muted: true },
  { key: 'opening', header: 'Opening', align: 'r', render: (r) => formatQty(r.opening_milli, r.unit_code) },
  { key: 'inward', header: 'Inward', align: 'r', render: (r) => formatQty(r.inward_milli, r.unit_code) },
  { key: 'ret', header: 'Returns', align: 'r', render: (r) => (r.return_milli ? formatQty(r.return_milli) : '—') },
  { key: 'cons', header: 'Consumed', align: 'r', render: (r) => formatQty(r.consumption_milli) },
  { key: 'out', header: 'Outward', align: 'r', render: (r) => (r.outward_milli ? formatQty(r.outward_milli) : '—') },
  { key: 'adj', header: 'Adjust.', align: 'r', render: (r) => (r.adjustment_milli ? formatQty(r.adjustment_milli) : '—') },
  { key: 'closing', header: 'Closing stock', align: 'r', render: (r) => <b style={{ color: r.closing_milli < 0 ? 'var(--bad)' : undefined }}>{formatQty(r.closing_milli, r.unit_code)}</b> },
  { key: 'low', header: '', render: (r) => (r.min_stock_milli && r.closing_milli < r.min_stock_milli ? <Chip tone="warn">Low</Chip> : null) },
  {
    key: 'value',
    header: 'Value',
    align: 'r',
    total: (rows) => formatINR(sumValue(rows), { decimals: 0 }),
    render: (r) => (r.value_paise === null ? <span style={{ color: 'var(--ink-4)' }} title="No purchase rate recorded for this material">unvalued</span> : formatINR(r.value_paise, { decimals: 0 })),
  },
];

export function InventoryScreen({ focus }: { focus: NavTarget }) {
  const { scope, dataVersion, bump } = useApp();
  const [tab, setTab] = useState<Tab>((focus.tab as Tab) || 'register');
  const [mode, setMode] = useState<'asof' | 'period'>('asof');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [spec, setSpec] = useState<string | null>(null);
  const [ledger, setLedger] = useState<StockRowT | null>(null);
  const [adding, setAdding] = useState(false);

  const filters = { companyId: scope.companyId, projectId: scope.projectId, specId: spec, from: mode === 'period' ? from || null : null, to: to || null };
  const reg = useAsync(() => api<StockRowT[]>('stock.register', filters), [JSON.stringify(filters), dataVersion]);
  const dash = useAsync(() => api<any>('dashboard.get', { companyId: scope.companyId }), [scope.companyId, dataVersion]);
  const low = (dash.data?.low_stock ?? []) as any[];

  return (
    <div>
      <PageHeader
        title="Inventory"
        subtitle="Stock is calculated from transactions — never typed in. Closing = Opening + accepted inward + returns − consumption − outward ± adjustments. Ordered and rejected quantities are never counted as stock."
        actions={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>Add stock entry</Button>}
      />
      <div style={{ padding: '12px 28px 0' }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'register', label: 'Stock register' }, { id: 'low', label: 'Low stock', count: low.length || null }, { id: 'reports', label: 'Balance & reconciliation' }]} />
      </div>
      <Page>
        {tab === 'register' && (
          <>
            <div className="flex items-end gap-3 flex-wrap" style={{ marginBottom: 12 }}>
              <Field label="Material" style={{ width: 240 }}><RefSelect refKind="spec" value={spec} onChange={setSpec} placeholder="All materials" /></Field>
              <Segmented value={mode} onChange={setMode} options={[{ id: 'asof', label: 'Balance as on' }, { id: 'period', label: 'Period register' }]} />
              {mode === 'period' && <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} /></Field>}
              <Field label={mode === 'period' ? 'To' : 'As on date'}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} /></Field>
              <div style={{ color: 'var(--ink-3)', paddingBottom: 8 }}>Company and project follow the top bar.</div>
            </div>
            <DataTable
              rows={reg.data}
              loading={reg.loading}
              error={reg.error}
              onRetry={reg.reload}
              rowKey={(r) => `${r.project_id}|${r.spec_id}|${r.location}`}
              onRowClick={setLedger}
              groupBy={(r) => r.project_name}
              empty={<EmptyState title="No stock movements yet">Stock appears when material is received (Material Inward), an opening balance is entered, or consumption is recorded.</EmptyState>}
              columns={stockColumns}
            />
            <div style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 12 }}>
              Value = closing stock × weighted-average purchase rate (before tax). Click a row for its full transaction history.
            </div>
          </>
        )}
        {tab === 'low' && (
          <Card>
            <CardHead title="Below minimum stock level" subtitle="Minimum levels are set per specification (Materials → Sizes & grades)." />
            {low.length === 0 ? (
              <EmptyState title="No low-stock alerts">Materials with a minimum level set and stock below it will be listed here.</EmptyState>
            ) : (
              <DataTable rows={low} rowKey={(r) => `${r.project_id}${r.spec_id}`} columns={[
                { key: 'project_name', header: 'Project' },
                { key: 'spec_label', header: 'Material', render: (r) => <b>{r.spec_label}</b> },
                { key: 'closing_milli', header: 'In stock', align: 'r', render: (r) => formatQty(r.closing_milli, r.unit_code) },
                { key: 'min_stock_milli', header: 'Minimum', align: 'r', render: (r) => formatQty(r.min_stock_milli, r.unit_code) },
                { key: 'short', header: 'Shortfall', align: 'r', render: (r) => <span style={{ color: 'var(--bad)', fontWeight: 600 }}>{formatQty(r.min_stock_milli - r.closing_milli, r.unit_code)}</span> },
              ]} />
            )}
          </Card>
        )}
        {tab === 'reports' && (
          <div style={{ display: 'grid', gap: 22 }}>
            <div><h3 style={{ fontSize: 14, marginBottom: 8 }}>Material-wise balance</h3><ReportView reportId="material_balance" filters={{ companyId: scope.companyId, projectId: scope.projectId, specId: spec }} /></div>
            <div><h3 style={{ fontSize: 14, marginBottom: 8 }}>Material reconciliation (ordered → received → consumed → balance)</h3><ReportView reportId="material_reconciliation" filters={{ companyId: scope.companyId, projectId: scope.projectId, specId: spec }} /></div>
            <div><h3 style={{ fontSize: 14, marginBottom: 8 }}>Supplier-wise received quantity</h3><ReportView reportId="supplier_received" filters={{ companyId: scope.companyId, projectId: scope.projectId, specId: spec }} /></div>
          </div>
        )}
      </Page>
      {ledger && <Ledger row={ledger} onClose={() => setLedger(null)} />}
      {adding && <EntryModal preset={{ companyId: scope.companyId, projectId: scope.projectId }} onClose={() => setAdding(false)} onSaved={() => (setAdding(false), bump())} />}
    </div>
  );
}
void StatusChip; void ApiFailure;
