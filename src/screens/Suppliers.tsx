import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { MODULES } from '../shared/modules';
import { api, useAsync } from '../lib/api';
import { NavTarget, entityTarget, useApp } from '../lib/ctx';
import { Button, Card, CardHead, Chip, EmptyState, KeyValue, Kpi, Note, Page, PageHeader, StatusChip, Tabs } from '../ui/base';
import { Drawer } from '../ui/overlay';
import { DataTable } from '../ui/table';
import { formatDate, formatDateTime, formatINR, formatQty } from '../shared/num';
import { ModuleScreen, RecordForm } from './ModuleScreen';
import { DocsPanel, HistoryPanel } from './Panels';
import { ReportView } from './ReportView';

type PTab = 'overview' | 'materials' | 'supply' | 'purchases' | 'invoices' | 'payments' | 'royalty' | 'ledger' | 'documents' | 'history';

function Profile({ id, onClose }: { id: string; onClose: () => void }) {
  const { go, scope, dataVersion } = useApp();
  const p = useAsync(() => api<any>('supplier.profile', { id }), [id, dataVersion]);
  const [tab, setTab] = useState<PTab>('overview');
  const [editing, setEditing] = useState(false);
  const d = p.data;
  const s = d?.supplier;
  const b = d?.balance;

  return (
    <Drawer wide title={s?.name ?? 'Supplier'} subtitle={s ? `${s.code}${s.business_name ? ' · ' + s.business_name : ''}` : undefined} onClose={onClose} headerExtra={s && <><StatusChip value={s.status} /><Button icon={<Pencil size={13} />} onClick={() => setEditing(true)}>Edit</Button></>}>
      {p.error && <Note tone="bad">{p.error}</Note>}
      {d && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            <Kpi label="Purchased" value={formatINR(d.totals.purchased_paise, { decimals: 0 })} hint={`${d.totals.purchase_count} orders · ${d.totals.delivery_count} deliveries`} />
            <Kpi label="Billed (invoices)" value={formatINR(b.billed_paise, { decimals: 0 })} hint="Excludes cancelled / rejected bills" />
            <Kpi label="Paid & settled" value={formatINR(b.settled_paise, { decimals: 0 })} hint={`Payments ${formatINR(b.paid_paise, { decimals: 0 })} · Advances ${formatINR(b.advance_paise, { decimals: 0 })} · Credit notes ${formatINR(b.credit_note_paise, { decimals: 0 })}`} />
            <Kpi label={b.outstanding_paise < 0 ? 'Advance with supplier' : 'Outstanding balance'} value={formatINR(Math.abs(b.outstanding_paise), { decimals: 0 })} tone={b.outstanding_paise > 0 ? 'warn' : b.outstanding_paise < 0 ? 'good' : 'neutral'} hint="Billed − settled" />
          </div>
          <div style={{ margin: '0 -20px 18px', padding: '0 20px', background: 'var(--surface)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'materials', label: 'Materials & rates', count: d.materials.length },
                { id: 'supply', label: 'Supply history' },
                { id: 'purchases', label: 'Purchases', count: d.purchases.length },
                { id: 'invoices', label: 'Invoices', count: d.invoices.length },
                { id: 'payments', label: 'Payments', count: d.payments.length },
                { id: 'royalty', label: 'Royalty', count: d.royalty.length },
                { id: 'ledger', label: 'Ledger' },
                { id: 'documents', label: 'Documents' },
                { id: 'history', label: 'History' },
              ]}
            />
          </div>

          {tab === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Card><CardHead title="Contact" /><div style={{ padding: 16 }}><KeyValue items={[['Contact person', s.contact_person], ['Mobile', s.mobile], ['Alternate', s.alt_contact], ['Email', s.email], ['Address', s.address]]} /></div></Card>
              <Card><CardHead title="Tax & terms" /><div style={{ padding: 16 }}><KeyValue items={[['GST', s.gst_no], ['PAN', s.pan_no], ['Payment terms', s.payment_terms], ['Contract', s.contract_start || s.contract_end ? `${formatDate(s.contract_start)} → ${formatDate(s.contract_end)}` : null]]} /></div></Card>
              <Card><CardHead title="Bank details" /><div style={{ padding: 16 }}><KeyValue items={[['Bank', s.bank_name], ['Account', s.bank_account], ['IFSC', s.bank_ifsc]]} /></div></Card>
              <Card><CardHead title="Projects supplied" /><div style={{ padding: 16 }}>{d.by_project.length ? d.by_project.map((x: any) => <div key={x.project_id} className="flex justify-between" style={{ padding: '3px 0' }}><span>{x.project_name}</span><span className="num" style={{ color: 'var(--ink-3)' }}>{x.deliveries} deliveries</span></div>) : <span style={{ color: 'var(--ink-3)' }}>No purchases yet.</span>}</div></Card>
              {s.notes && <Card style={{ gridColumn: 'span 2' }}><CardHead title="Notes" /><div style={{ padding: 16, whiteSpace: 'pre-wrap' }}>{s.notes}</div></Card>}
            </div>
          )}

          {tab === 'materials' && (
            <>
              <div style={{ marginBottom: 12 }}><Note tone="info">One supplier can supply many materials and sizes, each with its own rate. These rates are suggested automatically when you create a purchase.</Note></div>
              <ModuleScreen moduleId="supplierMaterials" fixed={{ supplier_id: id }} embedded addLabel="Add material & rate" />
            </>
          )}

          {tab === 'supply' && (
            <div style={{ display: 'grid', gap: 14 }}>
              <Card>
                <CardHead title="By material" subtitle="Ordered vs received vs pending" />
                <DataTable rows={d.supply} rowKey={(r) => r.spec_label + r.unit_code} empty={<EmptyState title="No supply recorded yet" />} columns={[
                  { key: 'spec_label', header: 'Material', render: (r) => <b>{r.spec_label}</b> },
                  { key: 'orders', header: 'Orders', align: 'r' },
                  { key: 'ordered_milli', header: 'Ordered', align: 'r', render: (r) => formatQty(r.ordered_milli, r.unit_code) },
                  { key: 'received_milli', header: 'Received', align: 'r', render: (r) => formatQty(r.received_milli, r.unit_code) },
                  { key: 'rejected_milli', header: 'Rejected', align: 'r', render: (r) => (r.rejected_milli ? formatQty(r.rejected_milli, r.unit_code) : '—') },
                  { key: 'pending_milli', header: 'Pending', align: 'r', render: (r) => formatQty(r.pending_milli, r.unit_code) },
                  { key: 'amount_paise', header: 'Purchase value', align: 'r', render: (r) => formatINR(r.amount_paise) },
                ]} />
              </Card>
              <Card>
                <CardHead title="By project" />
                <DataTable rows={d.by_project} rowKey={(r) => r.project_id} empty={<EmptyState title="No projects yet" />} columns={[
                  { key: 'project_name', header: 'Project', render: (r) => <b>{r.project_name}</b> },
                  { key: 'company_name', header: 'Company', muted: true },
                  { key: 'purchased_paise', header: 'Purchased', align: 'r', render: (r) => formatINR(r.purchased_paise) },
                  { key: 'billed_paise', header: 'Billed', align: 'r', render: (r) => formatINR(r.billed_paise) },
                  { key: 'deliveries', header: 'Deliveries', align: 'r' },
                ]} />
              </Card>
            </div>
          )}

          {tab === 'purchases' && <DataTable rows={d.purchases} onRowClick={(r) => go(entityTarget('purchase', r.id))} empty={<EmptyState title="No purchases" />} columns={[
            { key: 'po_no', header: 'Purchase', mono: true, render: (r) => <b>{r.po_no}</b> },
            { key: 'purchase_date', header: 'Date', render: (r) => formatDate(r.purchase_date) },
            { key: 'project_name', header: 'Project' },
            { key: 'total_paise', header: 'Total', align: 'r', render: (r) => formatINR(r.total_paise) },
            { key: 'payment_status', header: 'Payment', render: (r) => <StatusChip value={r.payment_status} /> },
            { key: 'status', header: 'Status', render: (r) => <StatusChip value={r.status} /> },
          ]} />}
          {tab === 'invoices' && <DataTable rows={d.invoices} onRowClick={(r) => go(entityTarget('invoice', r.id))} empty={<EmptyState title="No invoices" />} columns={[
            { key: 'invoice_no', header: 'Invoice', mono: true, render: (r) => <b>{r.invoice_no}</b> },
            { key: 'invoice_date', header: 'Date', render: (r) => formatDate(r.invoice_date) },
            { key: 'total_paise', header: 'Total', align: 'r', render: (r) => formatINR(r.total_paise) },
            { key: 'verification_status', header: 'Verification', render: (r) => <StatusChip value={r.verification_status} /> },
            { key: 'approval_status', header: 'Approval', render: (r) => <StatusChip value={r.approval_status} /> },
            { key: 'payment_status', header: 'Payment', render: (r) => <StatusChip value={r.payment_status} /> },
          ]} />}
          {tab === 'payments' && <DataTable rows={d.payments} onRowClick={(r) => go(entityTarget('payment', r.id))} empty={<EmptyState title="No payments" />} columns={[
            { key: 'payment_date', header: 'Date', render: (r) => formatDate(r.payment_date) },
            { key: 'kind', header: 'Type', render: (r) => <StatusChip value={r.kind} /> },
            { key: 'mode', header: 'Mode', render: (r) => (r.mode ?? '').toUpperCase() },
            { key: 'reference_no', header: 'Reference', mono: true },
            { key: 'amount_paise', header: 'Amount', align: 'r', render: (r) => formatINR(r.amount_paise) },
            { key: 'status', header: 'Status', render: (r) => <StatusChip value={r.status} /> },
          ]} />}
          {tab === 'royalty' && <DataTable rows={d.royalty} onRowClick={(r) => go(entityTarget('royalty', r.id))} empty={<EmptyState title="No royalty passes" />} columns={[
            { key: 'pass_no', header: 'Pass no.', mono: true, render: (r) => <b>{r.pass_no}</b> },
            { key: 'dispatch_at', header: 'Dispatch', render: (r) => formatDateTime(r.dispatch_at) },
            { key: 'vehicle_no', header: 'Vehicle', mono: true },
            { key: 'net_milli', header: 'Net quantity', align: 'r', render: (r) => formatQty(r.net_milli, r.weight_unit) },
            { key: 'verification_status', header: 'Verification', render: (r) => <StatusChip value={r.verification_status} /> },
          ]} />}
          {tab === 'ledger' && <ReportView reportId="supplier_ledger" filters={{ supplierId: id, companyId: scope.companyId, projectId: scope.projectId }} />}
          {tab === 'documents' && (scope.companyId ? <DocsPanel entityType="supplier" entityId={id} defaultDocType="other" companyId={scope.companyId} /> : <Note tone="info">Choose a company in “Working on” (top bar) — supplier documents are filed inside that company’s 08_Suppliers folder.</Note>)}
          {tab === 'history' && <HistoryPanel entityType="supplier" entityId={id} />}
        </>
      )}
      {editing && s && (
        <Drawer title={`Edit ${s.name}`} onClose={() => setEditing(false)}>
          <RecordForm def={MODULES.suppliers} row={s} onCancel={() => setEditing(false)} onSaved={() => (setEditing(false), p.reload())} />
        </Drawer>
      )}
    </Drawer>
  );
}

export function SuppliersScreen({ focus }: { focus: NavTarget }) {
  const [profile, setProfile] = useState<string | null>(focus.openId ?? null);
  const [adding, setAdding] = useState(!!focus.params?.create);
  return (
    <div>
      <PageHeader title="Suppliers" subtitle="Crushers, quarries, bitumen depots and transporters. Each supplier can supply many materials and sizes at their own rates, and has its own folder structure." />
      <Page>
        <ModuleScreen moduleId="suppliers" onRowOpen={(r) => (setProfile(r.id), true)} startNew={adding} />
      </Page>
      {profile && <Profile id={profile} onClose={() => (setProfile(null), setAdding(false))} />}
    </div>
  );
}
void Chip;
