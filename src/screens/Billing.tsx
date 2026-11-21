import React, { useState } from 'react';
import { BadgeCheck, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { api, useAsync } from '../lib/api';
import { NavTarget, useAction, useApp } from '../lib/ctx';
import { Button, Kpi, Note, Page, PageHeader, Segmented, Tabs } from '../ui/base';
import { Field, Input, RefSelect } from '../ui/inputs';
import { formatINR } from '../shared/num';
import { ModuleScreen } from './ModuleScreen';
import { ReportView } from './ReportView';

type Tab = 'invoices' | 'payments' | 'outstanding' | 'ledger';

function Summary() {
  const { scope, dataVersion } = useApp();
  const d = useAsync(() => api<any>('dashboard.get', { companyId: scope.companyId }), [scope.companyId, dataVersion]);
  if (!d.data) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
      <Kpi label="Outstanding to suppliers" value={formatINR(d.data.outstanding_paise, { decimals: 0 })} tone={d.data.outstanding_paise ? 'warn' : 'neutral'} hint="Billed − paid − advances − credit notes" />
      <Kpi label="Unpaid / part-paid invoices" value={d.data.pending_invoices.count} hint={`${d.data.pending_invoices.awaiting_action} awaiting verification or approval`} />
      <Kpi label="Total purchases" value={formatINR(d.data.totals.purchases_paise, { decimals: 0 })} hint="Orders (excl. cancelled) — separate from billed & paid" />
    </div>
  );
}

function Ledger() {
  const { scope } = useApp();
  const [supplier, setSupplier] = useState<string | null>(null);
  const [mode, setMode] = useState<'ledger' | 'statement'>('ledger');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  return (
    <div>
      <div className="flex items-end gap-3 flex-wrap" style={{ marginBottom: 14 }}>
        <Field label="Supplier" style={{ width: 280 }}>
          <RefSelect refKind="supplier" value={supplier} onChange={setSupplier} placeholder="Choose a supplier…" includeInactive />
        </Field>
        <Segmented value={mode} onChange={setMode} options={[{ id: 'ledger', label: 'Ledger' }, { id: 'statement', label: 'Monthly statement' }]} />
        {mode === 'ledger' ? (
          <>
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} /></Field>
          </>
        ) : (
          <Field label="Month"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 160 }} /></Field>
        )}
      </div>
      {!supplier ? (
        <Note tone="info">Choose a supplier to see the ledger: every invoice and payment in date order with a running balance. A negative balance means advance paid.</Note>
      ) : (
        <ReportView
          key={mode}
          reportId={mode === 'ledger' ? 'supplier_ledger' : 'supplier_statement'}
          filters={{ companyId: scope.companyId, projectId: scope.projectId, supplierId: supplier, from: mode === 'ledger' ? from || null : null, to: mode === 'ledger' ? to || null : null, month: mode === 'statement' ? month : null }}
        />
      )}
    </div>
  );
}

export function BillingScreen({ focus }: { focus: NavTarget }) {
  const { scope, bump } = useApp();
  const act = useAction();
  const [tab, setTab] = useState<Tab>((focus.tab as Tab) || 'invoices');
  const setStatus = async (id: string, patch: Record<string, string>, ok: string) => {
    const r = await act(() => api('crud.save', { module: 'invoices', id, values: patch }), ok);
    if (r) bump();
  };
  return (
    <div>
      <PageHeader title="Bills & Payments" subtitle="Supplier invoices, payments, advances and credit notes. Invoice total, payments and outstanding balance are always shown separately and calculated from recorded transactions." />
      <div style={{ padding: '12px 28px 0' }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'invoices', label: 'Invoices' }, { id: 'payments', label: 'Payments' }, { id: 'outstanding', label: 'Outstanding bills' }, { id: 'ledger', label: 'Supplier ledger & statements' }]} />
      </div>
      <Page>
        {tab !== 'ledger' && tab !== 'payments' && <Summary />}
        {tab === 'invoices' && (
          <ModuleScreen
            moduleId="invoices"
            openId={focus.tab === 'invoices' ? focus.openId : null}
            startNew={!!focus.params?.create}
            rowActions={(r) =>
              r.status === 'active' ? (
                <>
                  {r.verification_status === 'pending' && <Button size="sm" icon={<BadgeCheck size={12} />} onClick={() => setStatus(r.id, { verification_status: 'verified' }, 'Marked verified')}>Verify</Button>}
                  {r.approval_status === 'pending' && <Button size="sm" icon={<CheckCircle2 size={12} />} onClick={() => setStatus(r.id, { approval_status: 'approved' }, 'Invoice approved')}>Approve</Button>}
                </>
              ) : null
            }
          />
        )}
        {tab === 'payments' && <ModuleScreen moduleId="payments" openId={focus.tab === 'payments' ? focus.openId : null} startNew={!!focus.params?.create} />}
        {tab === 'outstanding' && <ReportView reportId="outstanding_bills" filters={{ companyId: scope.companyId, projectId: scope.projectId }} />}
        {tab === 'ledger' && <Ledger />}
      </Page>
    </div>
  );
}
void FileSpreadsheet;
