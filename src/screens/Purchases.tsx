import React, { useEffect, useMemo, useState } from 'react';
import { Ban, FileSpreadsheet, PackagePlus, Plus, RefreshCw, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import { api, ApiFailure, errMsg, useAsync, useDebounced } from '../lib/api';
import { NavTarget, useAction, useApp } from '../lib/ctx';
import { Button, Card, CardHead, Chip, EmptyState, Note, Page, PageHeader, StatusChip, Tabs } from '../ui/base';
import { Checkbox, Field, Input, NumberInput, RefSelect, Select, TextArea } from '../ui/inputs';
import { Drawer } from '../ui/overlay';
import { DataTable } from '../ui/table';
import { computeTotals, TaxTreatment } from '../shared/purchase';
import { computeLine } from '../shared/purchase';
import { PAYMENT_STATUS, TAX_TREATMENT } from '../shared/modules';
import { formatDate, formatINR, formatQty, todayISO } from '../shared/num';
import { DocsPanel, HistoryPanel } from './Panels';
import { FilterControl } from './ModuleScreen';

interface Line {
  key: string;
  id?: string | null;
  spec_id: string | null;
  unit: string;
  qty: number | null;
  rate: number | null;
  tax: number | null;
  notes?: string | null;
  agreed?: boolean;
  received_milli?: number;
}

const newLine = (): Line => ({ key: Math.random().toString(36).slice(2), spec_id: null, unit: '', qty: null, rate: null, tax: null });

export function PurchaseForm({ id, preset, onSaved, onCancel }: { id: string | null; preset?: { companyId?: string | null; projectId?: string | null; supplierId?: string | null }; onSaved: (p: any) => void; onCancel: () => void }) {
  const { saveConfirmed, scope, toast, bump } = useApp();
  const existing = useAsync(() => (id ? api<any>('purchase.get', { id }) : Promise.resolve(null)), [id]);
  const [loaded, setLoaded] = useState(!id);
  const [date, setDate] = useState(todayISO());
  const [companyId, setCompanyId] = useState<string | null>(preset?.companyId ?? scope.companyId);
  const [projectId, setProjectId] = useState<string | null>(preset?.projectId ?? scope.projectId);
  const [supplierId, setSupplierId] = useState<string | null>(preset?.supplierId ?? null);
  const [poNo, setPoNo] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [treatment, setTreatment] = useState<TaxTreatment>('exclusive');
  const [status, setStatus] = useState('ordered');
  const [paymentStatus, setPaymentStatus] = useState('unpaid');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [freight, setFreight] = useState<number | null>(null);
  const [other, setOther] = useState<number | null>(null);
  const [adj, setAdj] = useState<number | null>(null);
  const [adjNote, setAdjNote] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const p = existing.data;
    if (!p || loaded) return;
    setDate(p.purchase_date);
    setCompanyId(p.company_id);
    setProjectId(p.project_id);
    setSupplierId(p.supplier_id);
    setPoNo(p.po_no);
    setSupplierRef(p.supplier_ref ?? '');
    setInvoiceNo(p.invoice_no ?? '');
    setTreatment(p.tax_treatment);
    setStatus(p.status === 'cancelled' ? 'ordered' : p.status);
    setPaymentStatus(p.payment_status);
    setLines(p.items.map((i: any) => ({ key: i.id, id: i.id, spec_id: i.spec_id, unit: i.unit_code, qty: i.qty_milli, rate: i.rate_paise, tax: i.tax_bp, notes: i.notes, received_milli: i.received_milli })));
    setFreight(p.freight_paise || null);
    setOther(p.other_charges_paise || null);
    setAdj(p.adjustment_paise || null);
    setAdjNote(p.adjustment_note ?? '');
    setRemarks(p.remarks ?? '');
    setLoaded(true);
  }, [existing.data, loaded]);

  const calc = useMemo(
    () => computeTotals(treatment, lines.map((l) => ({ qty_milli: l.qty ?? 0, rate_paise: l.rate ?? 0, tax_bp: l.tax ?? 0 })), { freight_paise: freight ?? 0, other_charges_paise: other ?? 0, adjustment_paise: adj ?? 0 }),
    [lines, treatment, freight, other, adj]
  );
  const cancelled = existing.data?.status === 'cancelled';
  const upd = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    setError(null);
    if (!companyId || !projectId || !supplierId) return setError('Company, project and supplier are required.');
    const used = lines.filter((l) => l.spec_id || l.qty || l.rate);
    if (!used.length) return setError('Add at least one material line.');
    for (const [i, l] of used.entries()) {
      if (!l.spec_id) return setError(`Line ${i + 1}: choose a material.`);
      if (!l.qty || l.qty <= 0) return setError(`Line ${i + 1}: enter the quantity.`);
      if (l.rate === null) return setError(`Line ${i + 1}: enter the rate.`);
    }
    setSaving(true);
    try {
      const res = await saveConfirmed((allow) =>
        api<{ purchase: any; warnings: string[] }>('purchase.save', {
          id: id ?? null,
          po_no: poNo || null,
          purchase_date: date,
          company_id: companyId,
          project_id: projectId,
          supplier_id: supplierId,
          supplier_ref: supplierRef || null,
          invoice_no: invoiceNo || null,
          status,
          payment_status: paymentStatus,
          tax_treatment: treatment,
          freight_paise: freight ?? 0,
          other_charges_paise: other ?? 0,
          adjustment_paise: adj ?? 0,
          adjustment_note: adjNote || null,
          remarks: remarks || null,
          items: used.map((l) => ({ id: l.id ?? null, spec_id: l.spec_id!, qty_milli: l.qty!, rate_paise: l.rate!, tax_bp: l.tax ?? 0, notes: l.notes ?? null })),
          allowDuplicate: allow,
        })
      );
      if (res) {
        toast('success', `Purchase ${res.purchase.po_no} saved — total ${formatINR(res.purchase.total_paise)}`);
        bump();
        onSaved(res.purchase);
      }
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  if (id && !loaded) return <div style={{ color: 'var(--ink-3)' }}>Loading…</div>;
  const locked = !!cancelled;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {cancelled && <Note tone="bad" title="This purchase is cancelled">Reason: {existing.data.cancel_reason}. Cancelled purchases are kept for audit but cannot be edited or received against.</Note>}
      {error && <Note tone="bad">{error}</Note>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }}>
        <Field label="Purchase date" required><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} readOnly={locked} /></Field>
        <Field label="Company" required><RefSelect refKind="company" value={companyId} onChange={(v) => (setCompanyId(v), setProjectId(null))} disabled={locked || (!!existing.data && existing.data.receipts?.length > 0)} /></Field>
        <Field label="Project / site" required><RefSelect refKind="project" value={projectId} onChange={setProjectId} parentColumn="company_id" parentValue={companyId} disabled={locked || (!!existing.data && existing.data.receipts?.length > 0)} /></Field>
        <Field label="Supplier" required><RefSelect refKind="supplier" value={supplierId} onChange={setSupplierId} disabled={locked || (!!existing.data && existing.data.receipts?.length > 0)} /></Field>
        <Field label="Purchase order no." help="Leave blank to auto-number"><Input value={poNo} onChange={(e) => setPoNo(e.target.value)} placeholder="PO/26-27/0001" readOnly={locked} className="mono" /></Field>
        <Field label="Supplier’s reference / quotation"><Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} readOnly={locked} /></Field>
        <Field label="Invoice number"><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} readOnly={locked} style={{ textTransform: 'uppercase' }} /></Field>
        <Field label="Tax treatment"><Select value={treatment} onChange={(v) => setTreatment(v as TaxTreatment)} options={TAX_TREATMENT} disabled={locked} /></Field>
      </div>

      <Card>
        <CardHead title="Materials" subtitle={supplierId ? 'Materials this supplier is set up for are listed first, with their agreed rate.' : 'Choose a supplier first to see their agreed rates.'} actions={!locked && <Button size="sm" icon={<Plus size={13} />} onClick={() => setLines((ls) => [...ls, newLine()])}>Add line</Button>} />
        <div style={{ overflow: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th style={{ minWidth: 230 }}>Material / specification</th>
                <th className="r" style={{ minWidth: 150 }}>Quantity</th>
                <th className="r" style={{ minWidth: 140 }}>Rate per unit</th>
                <th className="r" style={{ minWidth: 100 }}>Tax %</th>
                <th className="r">Taxable value</th>
                <th className="r">Tax</th>
                <th className="r">Line total</th>
                <th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const c = computeLine(treatment, { qty_milli: l.qty ?? 0, rate_paise: l.rate ?? 0, tax_bp: l.tax ?? 0 });
                return (
                  <tr key={l.key}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <RefSelect
                        refKind="spec"
                        value={l.spec_id}
                        supplierId={supplierId}
                        disabled={locked || (l.received_milli ?? 0) > 0}
                        clearable={false}
                        onChange={(sid, o) => {
                          const m = o?.meta ?? {};
                          upd(l.key, { spec_id: sid, unit: m.unit_code ?? l.unit, rate: m.rate_paise ?? m.standard_rate_paise ?? l.rate, tax: m.tax_bp ?? l.tax, agreed: m.rate_paise !== undefined && m.rate_paise !== null });
                        }}
                      />
                      {l.agreed && <div style={{ fontSize: 11, color: 'var(--good)', marginTop: 2 }}>Agreed supplier rate applied</div>}
                      {(l.received_milli ?? 0) > 0 && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>Received so far: {formatQty(l.received_milli!, l.unit)}</div>}
                    </td>
                    <td><NumberInput kind="qty" value={l.qty} onChange={(v) => upd(l.key, { qty: v })} suffix={l.unit || undefined} readOnly={locked} /></td>
                    <td><NumberInput kind="money" prefix="₹" value={l.rate} onChange={(v) => upd(l.key, { rate: v })} readOnly={locked} /></td>
                    <td><NumberInput kind="pct" suffix="%" value={l.tax} onChange={(v) => upd(l.key, { tax: v })} readOnly={locked || treatment === 'exempt'} /></td>
                    <td className="r num">{formatINR(c.subtotal_paise)}</td>
                    <td className="r num">{formatINR(c.tax_paise)}</td>
                    <td className="r num"><b>{formatINR(c.total_paise)}</b></td>
                    <td>{!locked && lines.length > 1 && (l.received_milli ?? 0) === 0 && <Button size="sm" variant="ghost" iconOnly aria-label="Remove line" icon={<X size={14} />} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <Field label="Freight"><NumberInput kind="money" prefix="₹" value={freight} onChange={setFreight} readOnly={locked} /></Field>
            <Field label="Other charges"><NumberInput kind="money" prefix="₹" value={other} onChange={setOther} readOnly={locked} /></Field>
            <Field label="Manual adjustment (+/−)"><NumberInput kind="money" prefix="₹" value={adj} onChange={setAdj} readOnly={locked} /></Field>
          </div>
          {!!adj && <Field label="Adjustment note" required><Input value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="Why is this adjustment needed?" readOnly={locked} /></Field>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Order status"><Select value={status} onChange={setStatus} options={[{ value: 'draft', label: 'Draft' }, { value: 'ordered', label: 'Ordered' }]} disabled={locked} /></Field>
            <Field label="Payment status" help="Updates automatically once invoices are paid"><Select value={paymentStatus} onChange={setPaymentStatus} options={PAYMENT_STATUS} disabled={locked} /></Field>
          </div>
          <Field label="Remarks"><TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} readOnly={locked} /></Field>
        </div>
        <Card style={{ padding: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Order value</div>
          {([
            ['Taxable value (Qty × Rate)', calc.subtotal_paise],
            ['Tax', calc.tax_paise],
            ['Freight', freight ?? 0],
            ['Other charges', other ?? 0],
            ['Manual adjustment', adj ?? 0],
          ] as Array<[string, number]>).map(([k, v]) => (
            <div key={k} className="flex justify-between" style={{ padding: '4px 0', color: 'var(--ink-2)' }}>
              <span>{k}</span>
              <span className="num">{formatINR(v)}</span>
            </div>
          ))}
          <div className="flex justify-between" style={{ marginTop: 8, paddingTop: 10, borderTop: '2px solid var(--brand)', fontSize: 16, fontWeight: 700 }}>
            <span>Grand total</span>
            <span className="num">{formatINR(calc.total_paise)}</span>
          </div>
          <div style={{ color: 'var(--ink-3)', fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>
            Subtotal = Qty × Rate · Tax = Subtotal × Tax % ÷ 100 · Grand total = Subtotal + Tax + Freight + Other charges ± Adjustment
          </div>
        </Card>
      </div>

      <div style={{ position: 'sticky', bottom: -20, margin: '4px -20px -20px', padding: '12px 20px', background: 'var(--surface)', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onCancel}>{locked ? 'Close' : 'Cancel'}</Button>
        {!locked && <Button variant="primary" loading={saving} onClick={save}>{id ? 'Save changes' : 'Save purchase'}</Button>}
      </div>
    </div>
  );
}

const DELIVERY_TONE: Record<string, 'good' | 'warn' | 'neutral' | 'bad'> = { received: 'good', partial: 'warn', pending: 'neutral', cancelled: 'bad' };
const DELIVERY_LABEL: Record<string, string> = { received: 'Fully received', partial: 'Part received', pending: 'Not received', cancelled: 'Cancelled' };

export function PurchasesScreen({ focus }: { focus: NavTarget }) {
  const { scope, dataVersion, bump, prompt, go } = useApp();
  const act = useAction();
  const [search, setSearch] = useState('');
  const dq = useDebounced(search, 250);
  const [supplier, setSupplier] = useState('');
  const [pay, setPay] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [archived, setArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null | 'new'>(focus.openId ?? (focus.params?.create ? 'new' : null));
  const [tab, setTab] = useState('details');
  const [exporting, setExporting] = useState(false);
  const { toast } = useApp();

  const q = { search: dq || undefined, company_id: scope.companyId, project_id: scope.projectId, supplier_id: supplier || null, payment_status: pay || null, status: status || null, from: from || null, to: to || null, archived };
  const list = useAsync(() => api<{ rows: any[]; total: number }>('purchase.list', { ...q, pageSize: 500 }), [JSON.stringify(q), dataVersion]);

  const doCancel = async (p: any) => {
    const reason = await prompt({ title: `Cancel purchase ${p.po_no}?`, label: 'Reason for cancelling', required: true, confirmLabel: 'Cancel purchase', body: <span>The purchase stays on record as cancelled. Cancelling is blocked while deliveries are posted against it.</span> });
    if (reason) {
      const r = await act(() => api('purchase.cancel', { id: p.id, reason }), 'Purchase cancelled');
      if (r) bump();
    }
  };
  const doExport = async () => {
    setExporting(true);
    try {
      const r = await act(() => api<any[]>('report.generate', { id: 'purchase_register', filters: { companyId: scope.companyId, projectId: scope.projectId, supplierId: supplier || null, from: from || null, to: to || null }, formats: ['xlsx'] }));
      if (r?.[0]) (toast('success', 'Purchase register created. Opening…'), api('report.open', { id: r[0].id }).catch(() => {}));
    } finally {
      setExporting(false);
    }
  };

  const total = list.data?.rows.reduce((a, r) => a + (r.status === 'cancelled' ? 0 : r.total_paise), 0) ?? 0;

  return (
    <div>
      <PageHeader title="Purchases" subtitle="Purchase orders with materials, rates, tax, freight and adjustments. Deliveries are recorded separately under Material Inward and never change the order." actions={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setOpenId('new')}>New purchase</Button>} />
      <Page>
        <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 12 }}>
          <div style={{ position: 'relative', width: 270 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--ink-4)' }} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="PO no., invoice, supplier, material…" style={{ paddingLeft: 30 }} aria-label="Search purchases" />
          </div>
          <FilterControl fd={{ key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'supplier' }} value={supplier} onChange={setSupplier} />
          <div style={{ width: 140 }}><Select value={pay} onChange={setPay} options={PAYMENT_STATUS} placeholder="Payment" /></div>
          <div style={{ width: 130 }}><Select value={status} onChange={setStatus} options={[{ value: 'draft', label: 'Draft' }, { value: 'ordered', label: 'Ordered' }, { value: 'cancelled', label: 'Cancelled' }]} placeholder="Status" /></div>
          <div className="flex items-center gap-1">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 138 }} aria-label="From date" />
            <span style={{ color: 'var(--ink-4)' }}>to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 138 }} aria-label="To date" />
          </div>
          <div style={{ flex: 1 }} />
          <Checkbox checked={archived} onChange={setArchived} label={<span style={{ color: 'var(--ink-2)' }}>Show archived</span>} />
          <Button iconOnly aria-label="Refresh" icon={<RefreshCw size={14} className={list.loading ? 'spin' : undefined} />} onClick={list.reload} />
          <Button icon={<FileSpreadsheet size={14} />} loading={exporting} onClick={doExport}>Export Excel</Button>
        </div>
        <DataTable
          rows={list.data?.rows ?? null}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(r) => (setOpenId(r.id), setTab('details'))}
          empty={<EmptyState icon={<ShoppingCart size={22} />} title={dq || supplier ? 'No matching purchases' : 'No purchases yet'} action={!dq && !supplier ? <Button variant="primary" icon={<Plus size={14} />} onClick={() => setOpenId('new')}>Create purchase</Button> : undefined}>Record a purchase order with its materials and rates; then record each delivery under Material Inward.</EmptyState>}
          columns={[
            { key: 'po_no', header: 'Purchase no.', mono: true, render: (r) => <b>{r.po_no}</b> },
            { key: 'purchase_date', header: 'Date', render: (r) => formatDate(r.purchase_date) },
            { key: 'supplier_name', header: 'Supplier' },
            { key: 'project_name', header: 'Project', muted: true },
            { key: 'items', header: 'Materials', render: (r) => <span>{r.items.slice(0, 2).map((i: any) => `${i.label} × ${formatQty(i.qty_milli, i.unit_code)}`).join(', ')}{r.items.length > 2 ? ` +${r.items.length - 2}` : ''}</span> },
            { key: 'delivery', header: 'Delivery', render: (r) => <Chip tone={DELIVERY_TONE[r.delivery_status]}>{DELIVERY_LABEL[r.delivery_status]}</Chip> },
            { key: 'invoice_no', header: 'Invoice', mono: true, render: (r) => r.invoice_no ?? '—' },
            { key: 'total_paise', header: 'Total', align: 'r', total: () => formatINR(total), render: (r) => <span style={{ textDecoration: r.status === 'cancelled' ? 'line-through' : undefined, color: r.status === 'cancelled' ? 'var(--ink-4)' : undefined }}>{formatINR(r.total_paise)}</span> },
            { key: 'payment_status', header: 'Payment', render: (r) => <StatusChip value={r.payment_status} /> },
            {
              key: 'act',
              header: '',
              render: (r) => (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  {r.status !== 'cancelled' && !archived && <Button size="sm" icon={<PackagePlus size={12} />} onClick={() => go({ screen: 'inward', params: { fromPurchase: r.id } })}>Receive</Button>}
                  {r.status !== 'cancelled' && !archived && <Button size="sm" variant="ghost" iconOnly aria-label="Cancel purchase" title="Cancel purchase" icon={<Ban size={13} />} onClick={() => doCancel(r)} />}
                </div>
              ),
            },
          ]}
        />
        {list.data && <div style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 12 }} className="num">{list.data.total} purchase{list.data.total === 1 ? '' : 's'}</div>}
      </Page>

      {openId && (
        <PurchaseDrawer
          id={openId === 'new' ? null : openId}
          tab={tab}
          setTab={setTab}
          onClose={() => setOpenId(null)}
          preset={{ companyId: scope.companyId, projectId: scope.projectId }}
        />
      )}
    </div>
  );
}

function PurchaseDrawer({ id, tab, setTab, onClose, preset }: { id: string | null; tab: string; setTab: (t: string) => void; onClose: () => void; preset: any }) {
  const { go } = useApp();
  const [saved, setSaved] = useState<any | null>(null);
  const cur = saved?.id ?? id;
  const po = useAsync(() => (cur ? api<any>('purchase.get', { id: cur }) : Promise.resolve(null)), [cur, saved]);
  const tabs = cur ? [{ id: 'details', label: 'Order' }, { id: 'deliveries', label: 'Deliveries', count: po.data?.receipts?.length ?? null }, { id: 'documents', label: 'Documents' }, { id: 'history', label: 'History' }] : [];
  return (
    <Drawer wide title={cur ? `Purchase ${po.data?.po_no ?? ''}` : 'New purchase'} subtitle={po.data ? `${po.data.supplier_name} · ${po.data.project_name}` : undefined} onClose={onClose}>
      {cur && (
        <div style={{ margin: '-20px -20px 18px', padding: '0 20px', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
          <Tabs tabs={tabs} value={tab} onChange={setTab} />
        </div>
      )}
      {tab === 'details' && <PurchaseForm id={cur} preset={preset} onCancel={onClose} onSaved={(p) => (setSaved(p), onClose())} />}
      {cur && tab === 'deliveries' && po.data && (
        <div style={{ display: 'grid', gap: 14 }}>
          <Card>
            <CardHead title="Ordered vs received" actions={po.data.status !== 'cancelled' && <Button variant="primary" size="sm" icon={<PackagePlus size={13} />} onClick={() => go({ screen: 'inward', params: { fromPurchase: po.data.id } })}>Record delivery</Button>} />
            <DataTable
              rows={po.data.items}
              columns={[
                { key: 'spec_label', header: 'Material', render: (i) => <b>{i.spec_label}</b> },
                { key: 'qty_milli', header: 'Ordered', align: 'r', render: (i) => formatQty(i.qty_milli, i.unit_code) },
                { key: 'received_milli', header: 'Received', align: 'r', render: (i) => formatQty(i.received_milli, i.unit_code) },
                { key: 'accepted_milli', header: 'Accepted', align: 'r', render: (i) => formatQty(i.accepted_milli, i.unit_code) },
                { key: 'rejected_milli', header: 'Rejected', align: 'r', render: (i) => (i.rejected_milli ? formatQty(i.rejected_milli, i.unit_code) : '—') },
                { key: 'pending_milli', header: 'Pending', align: 'r', render: (i) => <b style={{ color: i.pending_milli ? 'var(--warn)' : 'var(--good)' }}>{formatQty(i.pending_milli, i.unit_code)}</b> },
                { key: 'deliveries', header: 'Deliveries', align: 'r' },
              ]}
            />
          </Card>
          <Card>
            <CardHead title="Delivery records" />
            <DataTable
              rows={po.data.receipts}
              onRowClick={(r) => go({ screen: 'inward', openId: r.id })}
              empty={<EmptyState title="No deliveries yet">Record each truck / load under Material Inward against this order.</EmptyState>}
              columns={[
                { key: 'receipt_no', header: 'Receipt', mono: true },
                { key: 'received_at', header: 'Received', render: (r) => formatDate(r.received_at) },
                { key: 'vehicle_no', header: 'Vehicle', mono: true },
                { key: 'received_qty_milli', header: 'Received', align: 'r', render: (r) => formatQty(r.received_qty_milli, r.unit_code) },
                { key: 'accepted_qty_milli', header: 'Accepted', align: 'r', render: (r) => formatQty(r.accepted_qty_milli, r.unit_code) },
                { key: 'status', header: 'Status', render: (r) => <StatusChip value={r.status} /> },
              ]}
            />
          </Card>
        </div>
      )}
      {cur && tab === 'documents' && po.data && <DocsPanel entityType="purchase" entityId={cur} defaultDocType="purchase_order" companyId={po.data.company_id} allowedTypes={['purchase_order', 'invoice', 'other']} />}
      {cur && tab === 'history' && <HistoryPanel entityType="purchase" entityId={cur} />}
    </Drawer>
  );
}
void Trash2;
