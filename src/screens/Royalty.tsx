import React, { useState } from 'react';
import { Calculator, ShieldAlert } from 'lucide-react';
import { api, useAsync } from '../lib/api';
import { NavTarget, entityTarget, useAction, useApp } from '../lib/ctx';
import { Button, Card, CardHead, Chip, EmptyState, ErrorState, Kpi, Note, Page, PageHeader, StatusChip, Tabs } from '../ui/base';
import { DataTable } from '../ui/table';
import { formatDate, formatDateTime, formatINR, formatQty } from '../shared/num';
import { ModuleScreen } from './ModuleScreen';
import { ReportView } from './ReportView';

type Tab = 'register' | 'reconcile' | 'missing' | 'rates' | 'reports';

function SuggestRoyalty({ values, set }: { values: Record<string, any>; set: (k: string, v: any) => void }) {
  const act = useAction();
  const [res, setRes] = useState<any | null | undefined>(undefined);
  const ready = values.mineral_name && values.net_milli && values.dispatch_at;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="flex items-center gap-3">
        <Button icon={<Calculator size={14} />} disabled={!ready} onClick={async () => setRes(await act(() => api('royalty.suggest', { mineral: values.mineral_name, grade: values.grade, date: values.dispatch_at, netMilli: values.net_milli, weightUnit: values.weight_unit || 'MT' })) ?? null)}>
          Suggest royalty from my rate table
        </Button>
        <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>Uses the effective-dated rates you maintain on the Rates tab. The official notification always prevails.</span>
      </div>
      {res === null && <div style={{ marginTop: 8 }}><Note tone="warn">No rate of yours applies to this mineral on that date. Add one on the Rates tab, or enter the royalty amount from the pass.</Note></div>}
      {res && (
        <div style={{ marginTop: 8 }}>
          <Note tone="info">
            {res.note}. {res.amount_paise !== null && (
              <>
                Suggested amount <b>{formatINR(res.amount_paise)}</b>{' '}
                <Button size="sm" onClick={() => set('royalty_amount_paise', res.amount_paise)}>
                  Use this amount
                </Button>
              </>
            )}
          </Note>
        </div>
      )}
    </div>
  );
}

const RESULT: Record<string, { label: string; tone: 'good' | 'bad' | 'warn' | 'neutral' }> = {
  matched: { label: 'Matched', tone: 'good' },
  received_more: { label: 'Received more than passes', tone: 'bad' },
  received_less: { label: 'Received less than passes', tone: 'warn' },
  not_comparable: { label: 'Not comparable', tone: 'neutral' },
};

function Reconcile() {
  const { scope, dataVersion, go } = useApp();
  const r = useAsync(() => api<any>('royalty.reconcile', { companyId: scope.companyId, projectId: scope.projectId }), [scope.companyId, scope.projectId, dataVersion]);
  if (r.error) return <ErrorState message={r.error} onRetry={r.reload} />;
  const d = r.data;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Note tone="info">Compares the quantity written on each pass with the quantity actually received at site (within your tolerance setting). It is an arithmetic check only — not a government verification.</Note>
      {d && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <Kpi label="Receipts compared" value={d.summary.receipts_compared} />
          <Kpi label="Matched" value={d.summary.matched} tone="good" />
          <Kpi label="Mismatched" value={d.summary.mismatched} tone={d.summary.mismatched ? 'bad' : 'neutral'} />
          <Kpi label="Passes not linked" value={d.summary.unlinked_passes} tone={d.summary.unlinked_passes ? 'warn' : 'neutral'} />
        </div>
      )}
      <DataTable
        rows={d?.receipts ?? null}
        loading={r.loading}
        rowKey={(x) => x.receipt_id}
        onRowClick={(x) => go(entityTarget('receipt', x.receipt_id))}
        empty={<EmptyState title="No linked passes to compare">Link royalty passes to material inward records (by pass number) to see the comparison.</EmptyState>}
        columns={[
          { key: 'receipt_no', header: 'Inward', mono: true },
          { key: 'supplier_name', header: 'Supplier' },
          { key: 'vehicle_no', header: 'Vehicle', mono: true },
          { key: 'passes', header: 'Pass no.', render: (x) => x.passes.map((p: any) => p.pass_no).join(', ') },
          { key: 'pass_total_milli', header: 'Pass quantity', align: 'r', render: (x) => formatQty(x.pass_total_milli, x.unit_code) },
          { key: 'received_milli', header: 'Received', align: 'r', render: (x) => formatQty(x.received_milli, x.unit_code) },
          { key: 'difference_milli', header: 'Difference', align: 'r', render: (x) => (x.difference_milli === null ? '—' : formatQty(x.difference_milli, x.unit_code)) },
          { key: 'status', header: 'Result', render: (x) => <Chip tone={RESULT[x.status].tone}>{RESULT[x.status].label}</Chip> },
        ]}
      />
      {d?.unlinked.length > 0 && (
        <Card>
          <CardHead title="Passes not linked to an inward record" />
          <DataTable
            rows={d.unlinked}
            onRowClick={(x) => go(entityTarget('royalty', x.id))}
            columns={[
              { key: 'pass_no', header: 'Pass no.', mono: true },
              { key: 'dispatch_at', header: 'Dispatch', render: (x) => formatDateTime(x.dispatch_at) },
              { key: 'vehicle_no', header: 'Vehicle', mono: true },
              { key: 'supplier_name', header: 'Supplier' },
              { key: 'net_milli', header: 'Net quantity', align: 'r', render: (x) => formatQty(x.net_milli, x.weight_unit) },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

function Missing() {
  const { scope, dataVersion, go } = useApp();
  const g = useAsync(() => api<any>('royalty.gaps', { companyId: scope.companyId, projectId: scope.projectId }), [scope.companyId, scope.projectId, dataVersion]);
  if (g.error) return <ErrorState message={g.error} onRetry={g.reload} />;
  const d = g.data;
  const none = d && !d.receipts_without_pass.length && !d.passes_without_document.length && !d.unverified_passes.length;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Note tone="info">Materials marked “needs royalty / transit pass” (Materials → Materials) are flagged here when a delivery has no pass recorded. Verification is always done manually by you.</Note>
      {none && <Card><EmptyState icon={<ShieldAlert size={22} />} title="Nothing missing">Every royalty-bearing delivery has a pass, every pass has a scan, and all passes are verified.</EmptyState></Card>}
      {d?.receipts_without_pass.length > 0 && (
        <Card>
          <CardHead title={`Inward without a royalty pass (${d.receipts_without_pass.length})`} subtitle="Open the inward, then enter the pass number — or record the pass and link it." />
          <DataTable rows={d.receipts_without_pass} onRowClick={(x) => go(entityTarget('receipt', x.id))} columns={[
            { key: 'receipt_no', header: 'Inward', mono: true },
            { key: 'received_at', header: 'Received', render: (x) => formatDateTime(x.received_at) },
            { key: 'vehicle_no', header: 'Vehicle', mono: true },
            { key: 'supplier_name', header: 'Supplier' },
            { key: 'spec_label', header: 'Material' },
            { key: 'project_name', header: 'Project' },
          ]} />
        </Card>
      )}
      {d?.passes_without_document.length > 0 && (
        <Card>
          <CardHead title={`Passes with no scanned document (${d.passes_without_document.length})`} subtitle="Open the pass → Documents → attach the original PDF or photo." />
          <DataTable rows={d.passes_without_document} onRowClick={(x) => go(entityTarget('royalty', x.id))} columns={[
            { key: 'pass_no', header: 'Pass no.', mono: true },
            { key: 'dispatch_at', header: 'Dispatch', render: (x) => formatDateTime(x.dispatch_at) },
            { key: 'vehicle_no', header: 'Vehicle', mono: true },
            { key: 'supplier_name', header: 'Supplier' },
            { key: 'verification_status', header: 'Verification', render: (x) => <StatusChip value={x.verification_status} /> },
          ]} />
        </Card>
      )}
      {d?.unverified_passes.length > 0 && (
        <Card>
          <CardHead title={`Passes not yet verified (${d.unverified_passes.length})`} />
          <DataTable rows={d.unverified_passes} onRowClick={(x) => go(entityTarget('royalty', x.id))} columns={[
            { key: 'pass_no', header: 'Pass no.', mono: true },
            { key: 'dispatch_at', header: 'Dispatch', render: (x) => formatDateTime(x.dispatch_at) },
            { key: 'vehicle_no', header: 'Vehicle', mono: true },
            { key: 'supplier_name', header: 'Supplier' },
          ]} />
        </Card>
      )}
    </div>
  );
}

export function RoyaltyScreen({ focus }: { focus: NavTarget }) {
  const { scope } = useApp();
  const [tab, setTab] = useState<Tab>((focus.tab as Tab) || 'register');
  return (
    <div>
      <PageHeader title="Royalty & Transit Passes" subtitle="Register of royalty / e-permit / transit pass details, kept with the original documents. Nothing here imitates a government document or claims automatic verification." />
      <div style={{ padding: '12px 28px 0' }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'register', label: 'Pass register' }, { id: 'reconcile', label: 'Pass vs received' }, { id: 'missing', label: 'Missing documents' }, { id: 'rates', label: 'Royalty rates' }, { id: 'reports', label: 'Monthly summary' }]} />
      </div>
      <Page>
        {tab === 'register' && <ModuleScreen moduleId="royalty" openId={focus.openId} startNew={!!focus.params?.create} formExtra={(v, set) => <SuggestRoyalty values={v} set={set} />} />}
        {tab === 'reconcile' && <Reconcile />}
        {tab === 'missing' && <Missing />}
        {tab === 'rates' && (
          <>
            <div style={{ marginBottom: 12 }}>
              <Note tone="warn" title="Official rates are authoritative">
                Enter rates from the official notification with their effective dates and reference. They are used only to <i>suggest</i> an amount; the rate printed on the pass or notified by the department always governs.
              </Note>
            </div>
            <ModuleScreen moduleId="royaltyRates" />
          </>
        )}
        {tab === 'reports' && <ReportView reportId="royalty_monthly" filters={{ companyId: scope.companyId, projectId: scope.projectId }} />}
      </Page>
    </div>
  );
}
