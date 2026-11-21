import React, { useEffect, useMemo, useState } from 'react';
import { Ban, FileSpreadsheet, PackageCheck, Plus, RefreshCw, Scale, Search, Truck, X } from 'lucide-react';
import { api, ApiFailure, errMsg, useAsync, useDebounced } from '../lib/api';
import { NavTarget, useAction, useApp } from '../lib/ctx';
import { Button, Card, CardHead, Chip, EmptyState, Note, Page, PageHeader, StatusChip, Tabs } from '../ui/base';
import { Checkbox, Field, Input, NumberInput, RefSelect, Select, TextArea } from '../ui/inputs';
import { Drawer } from '../ui/overlay';
import { DataTable } from '../ui/table';
import { convertMilli, UnitDef } from '../shared/units';
import { WEIGHT_UNIT_OPTS } from '../shared/modules';
import { formatDate, formatDateTime, formatQty, nowLocalISO, normalizeVehicle } from '../shared/num';
import { DocsPanel, HistoryPanel } from './Panels';
import { FilterControl } from './ModuleScreen';

interface Slip {
  key: string;
  slip_no: string;
  weighbridge_name: string;
  slip_at: string;
  weight_unit: string;
  gross: number | null;
  tare: number | null;
}
const newSlip = (unit = 'MT', wb = ''): Slip => ({ key: Math.random().toString(36).slice(2), slip_no: '', weighbridge_name: wb, slip_at: '', weight_unit: unit, gross: null, tare: null });

function useUnits() {
  const u = useAsync(() => api<{ rows: UnitDef[] }>('crud.list', { module: 'units', pageSize: 200 }), []);
  return useMemo(() => new Map((u.data?.rows ?? []).map((x) => [x.code, x])), [u.data]);
}

export function ReceiptForm({ id, preset, onSaved, onCancel }: { id: string | null; preset?: { purchaseId?: string | null; companyId?: string | null; projectId?: string | null }; onSaved: (r: any) => void; onCancel: () => void }) {
  const { saveConfirmed, scope, toast, bump, settings } = useApp();
  const units = useUnits();
  const existing = useAsync(() => (id ? api<any>('receipt.get', { id }) : Promise.resolve(null)), [id]);
  const [loaded, setLoaded] = useState(!id);
  const [at, setAt] = useState(nowLocalISO());
  const [companyId, setCompanyId] = useState<string | null>(preset?.companyId ?? scope.companyId);
  const [projectId, setProjectId] = useState<string | null>(preset?.projectId ?? scope.projectId);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [lineId, setLineId] = useState<string>(''); // purchase item id, '' = none
  const [specId, setSpecId] = useState<string | null>(null);
  const [unit, setUnit] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [mobile, setMobile] = useState('');
  const [invoice, setInvoice] = useState('');
  const [challan, setChallan] = useState('');
  const [pass, setPass] = useState('');
  const [ordered, setOrdered] = useState<number | null>(null);
  const [manual, setManual] = useState(false);
  const [manualQty, setManualQty] = useState<number | null>(null);
  const [rejected, setRejected] = useState<number | null>(null);
  const [rejReason, setRejReason] = useState('');
  const [location, setLocation] = useState(settings?.defaultStockLocation ?? 'Main Store');
  const [remarks, setRemarks] = useState('');
  const [slips, setSlips] = useState<Slip[]>([newSlip()]);
  const [receiptNo, setReceiptNo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [vh, setVh] = useState<any[] | null>(null);
  const [orderedTouched, setOrderedTouched] = useState(false);

  // pre-fill from a purchase ("Receive" button)
  useEffect(() => {
    if (!preset?.purchaseId) return;
    api<any>('purchase.get', { id: preset.purchaseId }).then((p) => {
      if (!p) return;
      setCompanyId(p.company_id);
      setProjectId(p.project_id);
      setSupplierId(p.supplier_id);
      const first = p.items.find((i: any) => i.pending_milli > 0) ?? p.items[0];
      if (first) {
        setLineId(first.id);
        setSpecId(first.spec_id);
        setUnit(first.unit_code);
      }
    });
  }, [preset?.purchaseId]);

  useEffect(() => {
    const r = existing.data;
    if (!r || loaded) return;
    setAt(r.received_at);
    setCompanyId(r.company_id);
    setProjectId(r.project_id);
    setSupplierId(r.supplier_id);
    setLineId(r.purchase_item_id ?? '');
    setSpecId(r.spec_id);
    setUnit(r.unit_code);
    setVehicle(r.vehicle_no ?? '');
    setDriver(r.driver_name ?? '');
    setMobile(r.driver_mobile ?? '');
    setInvoice(r.invoice_no ?? '');
    setChallan(r.challan_no ?? '');
    setPass(r.royalty_pass_no ?? '');
    setOrdered(r.ordered_qty_milli);
    setOrderedTouched(true);
    setRejected(r.rejected_qty_milli || null);
    setRejReason(r.rejection_reason ?? '');
    setLocation(r.location);
    setRemarks(r.remarks ?? '');
    setReceiptNo(r.receipt_no);
    const sl = r.slips.map((s: any) => ({ key: s.id, slip_no: s.slip_no ?? '', weighbridge_name: s.weighbridge_name ?? '', slip_at: s.slip_at ?? '', weight_unit: s.weight_unit, gross: s.gross_milli, tare: s.tare_milli }));
    setSlips(sl.length ? sl : [newSlip(r.unit_code)]);
    const wbTotal = r.slips.reduce((a: number, s: any) => a + (convertMilli(s.net_milli, units.get(s.weight_unit), units.get(r.unit_code)) ?? NaN), 0);
    if (!r.slips.length || wbTotal !== r.received_qty_milli) {
      setManual(true);
      setManualQty(r.received_qty_milli);
    }
    setLoaded(true);
  }, [existing.data, loaded, units]);

  const lines = useAsync(() => (supplierId && projectId ? api<any[]>('purchase.openLines', { supplierId, projectId }) : Promise.resolve([])), [supplierId, projectId]);

  useEffect(() => {
    if (vehicle.replace(/\s/g, '').length < 6) return setVh(null);
    const t = setTimeout(() => api<any[]>('receipt.vehicleHistory', { vehicle }).then((r) => setVh(r.filter((x) => x.id !== id))).catch(() => setVh(null)), 400);
    return () => clearTimeout(t);
  }, [vehicle, id]);

  const specUnit = units.get(unit);
  const slipCalc = slips.map((s) => {
    const net = s.gross !== null && s.tare !== null ? s.gross - s.tare : null;
    const conv = net !== null ? convertMilli(net, units.get(s.weight_unit), specUnit) : null;
    return { net, conv, bad: s.gross !== null && s.tare !== null && s.tare > s.gross };
  });
  const usedSlips = slips.filter((s) => s.gross !== null || s.tare !== null);
  const anyNotConvertible = usedSlips.some((_, i) => slipCalc[slips.indexOf(usedSlips[i])].conv === null && slipCalc[slips.indexOf(usedSlips[i])].net !== null);
  const slipTotal = specUnit && usedSlips.length && !anyNotConvertible ? usedSlips.reduce((a, s) => a + (slipCalc[slips.indexOf(s)].conv ?? 0), 0) : null;
  const received = manual ? manualQty : slipTotal;
  const acceptedQty = received !== null ? received - (rejected ?? 0) : null;
  const diff = ordered !== null && received !== null ? ordered - received : null;
  const short = diff !== null && diff > Math.round(((ordered ?? 0) * (settings?.shortToleranceBp ?? 0)) / 10000);
  const cancelled = existing.data?.status === 'cancelled';

  const pickLine = (item: string) => {
    setLineId(item);
    if (!item) return;
    const l = (lines.data ?? []).find((x) => x.item_id === item);
    if (l) {
      setSpecId(l.spec_id);
      setUnit(l.unit_code);
    }
  };

  const save = async () => {
    setError(null);
    if (!companyId || !projectId || !supplierId) return setError('Company, project and supplier are required.');
    if (!specId) return setError('Choose the purchase line or the material received.');
    if (received === null || received <= 0) return setError(manual ? 'Enter the received quantity.' : slipTotal === null && usedSlips.length ? `Weighbridge units cannot be converted to ${unit}. Tick “Enter received quantity manually”.` : 'Enter a weighbridge slip or tick “Enter received quantity manually”.');
    setSaving(true);
    try {
      const res = await saveConfirmed((allow) =>
        api<{ receipt: any; warnings: string[] }>('receipt.save', {
          id: id ?? null,
          receipt_no: receiptNo || null,
          received_at: at,
          company_id: companyId,
          project_id: projectId,
          supplier_id: supplierId,
          purchase_id: lineId ? (lines.data ?? []).find((x) => x.item_id === lineId)?.purchase_id : null,
          purchase_item_id: lineId || null,
          spec_id: specId,
          vehicle_no: vehicle || null,
          driver_name: driver || null,
          driver_mobile: mobile || null,
          invoice_no: invoice || null,
          challan_no: challan || null,
          royalty_pass_no: pass || null,
          ordered_qty_milli: ordered,
          received_qty_milli: manual ? manualQty : null,
          rejected_qty_milli: rejected ?? 0,
          rejection_reason: rejReason || null,
          location,
          remarks: remarks || null,
          slips: usedSlips.map((s) => ({ slip_no: s.slip_no || null, weighbridge_name: s.weighbridge_name || null, slip_at: s.slip_at || null, weight_unit: s.weight_unit, gross_milli: s.gross ?? 0, tare_milli: s.tare ?? 0 })),
          allowDuplicate: allow,
        })
      );
      if (res) {
        toast('success', `${res.receipt.receipt_no} posted — ${formatQty(res.receipt.accepted_qty_milli, res.receipt.unit_code)} added to stock`);
        bump();
        onSaved(res.receipt);
      }
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  if (id && !loaded) return <div style={{ color: 'var(--ink-3)' }}>Loading…</div>;
  const lock = cancelled;
  const selectedLine = (lines.data ?? []).find((x) => x.item_id === lineId);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {cancelled && <Note tone="bad" title="This receipt is cancelled">Reason: {existing.data.cancel_reason}. Its stock effect has been reversed; the record is kept for audit.</Note>}
      {error && <Note tone="bad">{error}</Note>}

      <Card style={{ padding: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Delivery</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }}>
          <Field label="Date & time" required><Input type="datetime-local" value={at.slice(0, 16)} onChange={(e) => setAt(e.target.value)} readOnly={lock} /></Field>
          <Field label="Company" required><RefSelect refKind="company" value={companyId} onChange={(v) => (setCompanyId(v), setProjectId(null))} disabled={lock} /></Field>
          <Field label="Project / site" required><RefSelect refKind="project" value={projectId} onChange={(v) => (setProjectId(v), setLineId(''))} parentColumn="company_id" parentValue={companyId} disabled={lock} /></Field>
          <Field label="Supplier" required><RefSelect refKind="supplier" value={supplierId} onChange={(v) => (setSupplierId(v), setLineId(''))} disabled={lock} /></Field>
          <Field label="Against purchase order" style={{ gridColumn: 'span 2' }} help={supplierId && projectId && !lines.loading && (lines.data ?? []).length === 0 ? 'No open purchase orders for this supplier and project. You can still receive a direct delivery.' : undefined}>
            <Select value={lineId} onChange={pickLine} disabled={lock || !supplierId || !projectId} placeholder="— Direct delivery (no purchase order) —" options={(lines.data ?? []).map((l) => ({ value: l.item_id, label: `${l.po_no} · ${l.spec_label} · ${l.pending_milli > 0 ? 'pending ' + formatQty(l.pending_milli, l.unit_code) : 'fully received'}` }))} />
          </Field>
          <Field label="Material received" required style={{ gridColumn: 'span 2' }}>
            <RefSelect refKind="spec" value={specId} supplierId={supplierId} disabled={lock || !!lineId} onChange={(v, o) => (setSpecId(v), setUnit(o?.meta?.unit_code ?? ''))} />
          </Field>
          <Field label="Vehicle number" help={vh && vh.length ? undefined : undefined}>
            <Input className="mono" value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} placeholder="GJ 01 AB 1234" readOnly={lock} />
            {vh && vh.length > 0 && <div className="field-help"><Truck size={11} style={{ verticalAlign: -1 }} /> {vh.length} earlier delivery{vh.length === 1 ? '' : 'ies'} · last {formatDate(vh[0].received_at)} ({vh[0].supplier_name})</div>}
            {vehicle && normalizeVehicle(vehicle).length > 0 && normalizeVehicle(vehicle).length < 8 && <div className="field-help">Check the registration number — it looks short.</div>}
          </Field>
          <Field label="Driver name"><Input value={driver} onChange={(e) => setDriver(e.target.value)} readOnly={lock} /></Field>
          <Field label="Driver mobile"><Input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="tel" readOnly={lock} /></Field>
          <Field label="Receipt no." help="Auto if blank"><Input className="mono" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} placeholder="GRN/26-27/0001" readOnly={lock || !!id} /></Field>
          <Field label="Invoice number"><Input value={invoice} onChange={(e) => setInvoice(e.target.value)} style={{ textTransform: 'uppercase' }} readOnly={lock} /></Field>
          <Field label="Delivery challan no."><Input value={challan} onChange={(e) => setChallan(e.target.value)} readOnly={lock} /></Field>
          <Field label="Royalty / transit pass no."><Input value={pass} onChange={(e) => setPass(e.target.value)} style={{ textTransform: 'uppercase' }} readOnly={lock} /></Field>
          <Field label="Stock location"><Input value={location} onChange={(e) => setLocation(e.target.value)} readOnly={lock} /></Field>
        </div>
      </Card>

      <Card>
        <CardHead title={<span className="flex items-center gap-2"><Scale size={15} color="var(--brand)" /> Weighbridge slips</span>} subtitle="Net weight = Gross weight − Tare weight. Add one row per slip (multiple slips per delivery are supported)." actions={!lock && <Button size="sm" icon={<Plus size={13} />} onClick={() => setSlips((s) => [...s, newSlip(s[s.length - 1]?.weight_unit ?? 'MT', s[s.length - 1]?.weighbridge_name ?? '')])}>Add slip</Button>} />
        <div style={{ overflow: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Slip no.</th><th>Weighbridge</th><th>Slip date & time</th><th style={{ width: 100 }}>Unit</th>
                <th className="r">Gross weight</th><th className="r">Tare weight</th><th className="r">Net weight</th><th style={{ width: 34 }} />
              </tr>
            </thead>
            <tbody>
              {slips.map((s, i) => {
                const c = slipCalc[i];
                const up = (patch: Partial<Slip>) => setSlips((arr) => arr.map((x) => (x.key === s.key ? { ...x, ...patch } : x)));
                return (
                  <tr key={s.key}>
                    <td><Input value={s.slip_no} onChange={(e) => up({ slip_no: e.target.value })} className="mono" readOnly={lock} /></td>
                    <td><Input value={s.weighbridge_name} onChange={(e) => up({ weighbridge_name: e.target.value })} readOnly={lock} /></td>
                    <td><Input type="datetime-local" value={s.slip_at.slice(0, 16)} onChange={(e) => up({ slip_at: e.target.value })} readOnly={lock} /></td>
                    <td><Select value={s.weight_unit} onChange={(v) => up({ weight_unit: v })} options={WEIGHT_UNIT_OPTS} disabled={lock} /></td>
                    <td><NumberInput kind="qty" value={s.gross} onChange={(v) => up({ gross: v })} readOnly={lock} /></td>
                    <td><NumberInput kind="qty" value={s.tare} onChange={(v) => up({ tare: v })} invalid={c.bad} readOnly={lock} /></td>
                    <td className="r num">{c.bad ? <span style={{ color: 'var(--bad)' }}>Tare &gt; gross</span> : c.net !== null ? <b>{formatQty(c.net, s.weight_unit)}</b> : '—'}</td>
                    <td>{!lock && slips.length > 1 && <Button size="sm" variant="ghost" iconOnly aria-label="Remove slip" icon={<X size={14} />} onClick={() => setSlips((arr) => arr.filter((x) => x.key !== s.key))} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {anyNotConvertible && <div style={{ padding: '0 16px 14px' }}><Note tone="warn">Weighbridge unit cannot be converted into {unit || 'the material unit'} (e.g. weight → volume needs a density, which is never assumed). Tick “Enter received quantity manually” below.</Note></div>}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: 16, alignItems: 'start' }}>
        <Card style={{ padding: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Quantities {unit && <span style={{ textTransform: 'none', letterSpacing: 0 }}>· in {unit}</span>}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
            <Field label="Ordered / invoiced for this delivery" help={selectedLine ? `Quantity on challan or invoice, if known. Pending on ${selectedLine.po_no}: ${formatQty(selectedLine.pending_milli, selectedLine.unit_code)}` : 'Quantity on the challan or invoice (optional) — used for short-delivery alerts'}>
              <NumberInput kind="qty" value={ordered} onChange={(v) => (setOrdered(v), setOrderedTouched(true))} suffix={unit || undefined} readOnly={lock} />
            </Field>
            <Field label="Received quantity" help={manual ? undefined : 'Calculated from the weighbridge slips'}>
              {manual ? <NumberInput kind="qty" value={manualQty} onChange={setManualQty} suffix={unit || undefined} readOnly={lock} /> : <Input readOnly value={slipTotal !== null ? formatQty(slipTotal, unit) : ''} placeholder="Add a weighbridge slip" style={{ textAlign: 'right' }} />}
            </Field>
            <div style={{ gridColumn: 'span 2' }}><Checkbox checked={manual} onChange={(c) => (setManual(c), c && setManualQty(slipTotal))} disabled={lock} label="Enter received quantity manually (e.g. measured in Brass / Cum, or no weighbridge slip)" /></div>
            <Field label="Rejected quantity"><NumberInput kind="qty" value={rejected} onChange={setRejected} suffix={unit || undefined} readOnly={lock} /></Field>
            {!!rejected && <Field label="Reason for rejection" required><Input value={rejReason} onChange={(e) => setRejReason(e.target.value)} readOnly={lock} /></Field>}
          </div>
          <Field label="Remarks" style={{ marginTop: 14 }}><TextArea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} readOnly={lock} /></Field>
        </Card>
        <Card style={{ padding: 16 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Result</div>
          {([['Ordered', ordered], ['Received', received], ['Rejected', rejected ?? 0]] as Array<[string, number | null]>).map(([k, v]) => (
            <div key={k} className="flex justify-between" style={{ padding: '4px 0', color: 'var(--ink-2)' }}><span>{k}</span><span className="num">{v === null ? '—' : formatQty(v, unit)}</span></div>
          ))}
          <div className="flex justify-between" style={{ marginTop: 6, paddingTop: 10, borderTop: '2px solid var(--brand)', fontWeight: 700, fontSize: 15 }}>
            <span>Accepted into stock</span><span className="num">{acceptedQty === null ? '—' : formatQty(acceptedQty, unit)}</span>
          </div>
          <div className="flex justify-between" style={{ padding: '8px 0 0' }}>
            <span style={{ color: 'var(--ink-2)' }}>Difference (ordered − received)</span>
            <span className="num" style={{ fontWeight: 600, color: short ? 'var(--bad)' : diff !== null && diff < 0 ? 'var(--info)' : 'var(--ink)' }}>{diff === null ? '—' : formatQty(diff, unit)}</span>
          </div>
          {short && <div style={{ marginTop: 8 }}><Chip tone="bad">Short delivery</Chip></div>}
          {diff !== null && diff < 0 && <div style={{ marginTop: 8 }}><Chip tone="info">Excess over order</Chip></div>}
          <div style={{ color: 'var(--ink-3)', fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>Only the accepted quantity enters stock. The purchase order itself is never modified by a delivery.</div>
        </Card>
      </div>

      <div style={{ position: 'sticky', bottom: -20, margin: '4px -20px -20px', padding: '12px 20px', background: 'var(--surface)', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onCancel}>{lock ? 'Close' : 'Cancel'}</Button>
        {!lock && <Button variant="primary" loading={saving} icon={<PackageCheck size={14} />} onClick={save}>{id ? 'Save changes' : 'Post receipt'}</Button>}
      </div>
    </div>
  );
}

function VehicleHistory({ vehicle }: { vehicle: string }) {
  const h = useAsync(() => api<any[]>('receipt.vehicleHistory', { vehicle }), [vehicle]);
  return (
    <DataTable
      rows={h.data}
      loading={h.loading}
      empty={<EmptyState title="No deliveries for this vehicle" />}
      columns={[
        { key: 'receipt_no', header: 'Receipt', mono: true },
        { key: 'received_at', header: 'Date', render: (r) => formatDateTime(r.received_at) },
        { key: 'supplier_name', header: 'Supplier' },
        { key: 'spec_label', header: 'Material' },
        { key: 'received_qty_milli', header: 'Received', align: 'r', render: (r) => formatQty(r.received_qty_milli, r.unit_code) },
        { key: 'status', header: 'Status', render: (r) => <StatusChip value={r.status} /> },
      ]}
    />
  );
}

export function InwardScreen({ focus }: { focus: NavTarget }) {
  const { scope, dataVersion, bump, prompt } = useApp();
  const act = useAction();
  const { toast } = useApp();
  const [search, setSearch] = useState('');
  const dq = useDebounced(search, 250);
  const [supplier, setSupplier] = useState('');
  const [spec, setSpec] = useState('');
  const [vehicleF, setVehicleF] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [shortOnly, setShortOnly] = useState(!!focus.params?.shortOnly);
  const [open, setOpen] = useState<string | null | 'new'>(focus.openId ?? (focus.params?.create || focus.params?.fromPurchase ? 'new' : null));
  const [tab, setTab] = useState('details');
  const [exporting, setExporting] = useState('');

  const q = { search: dq || undefined, company_id: scope.companyId, project_id: scope.projectId, supplier_id: supplier || null, spec_id: spec || null, vehicle_no: vehicleF || null, from: from || null, to: to || null, short_only: shortOnly || undefined };
  const list = useAsync(() => api<{ rows: any[]; total: number }>('receipt.list', { ...q, pageSize: 500 }), [JSON.stringify(q), dataVersion]);

  const cancel = async (r: any) => {
    const reason = await prompt({ title: `Cancel ${r.receipt_no}?`, label: 'Reason', required: true, confirmLabel: 'Cancel receipt', body: <span>The stock added by this delivery is reversed. The record is kept for audit.</span> });
    if (reason) {
      const ok = await act(() => api('receipt.cancel', { id: r.id, reason }), 'Receipt cancelled and stock reversed');
      if (ok) bump();
    }
  };
  const exportReport = async (id: string, label: string) => {
    setExporting(id);
    try {
      const r = await act(() => api<any[]>('report.generate', { id, filters: { companyId: scope.companyId, projectId: scope.projectId, supplierId: supplier || null, specId: spec || null, from: from || null, to: to || null }, formats: ['xlsx'] }));
      if (r?.[0]) (toast('success', `${label} created. Opening…`), api('report.open', { id: r[0].id }).catch(() => {}));
    } finally {
      setExporting('');
    }
  };

  return (
    <div>
      <PageHeader title="Material Inward" subtitle="Every delivery received at site: vehicle, weighbridge slips, challan, invoice and royalty pass. Accepted quantity goes into stock; the purchase order is never changed." actions={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setOpen('new')}>Record delivery</Button>} />
      <Page>
        <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 12 }}>
          <div style={{ position: 'relative', width: 270 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--ink-4)' }} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Vehicle, challan, invoice, pass, slip…" style={{ paddingLeft: 30 }} aria-label="Search deliveries" />
          </div>
          <Input value={vehicleF} onChange={(e) => setVehicleF(e.target.value.toUpperCase())} placeholder="Vehicle no." className="mono" style={{ width: 130 }} aria-label="Vehicle filter" />
          <FilterControl fd={{ key: 'supplier_id', label: 'Supplier', type: 'ref', ref: 'supplier' }} value={supplier} onChange={setSupplier} />
          <FilterControl fd={{ key: 'spec_id', label: 'Material', type: 'ref', ref: 'spec' }} value={spec} onChange={setSpec} />
          <div className="flex items-center gap-1">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 138 }} aria-label="From date" />
            <span style={{ color: 'var(--ink-4)' }}>to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 138 }} aria-label="To date" />
          </div>
          <Checkbox checked={shortOnly} onChange={setShortOnly} label={<span style={{ color: 'var(--ink-2)' }}>Short deliveries only</span>} />
          <div style={{ flex: 1 }} />
          <Button iconOnly aria-label="Refresh" icon={<RefreshCw size={14} className={list.loading ? 'spin' : undefined} />} onClick={list.reload} />
          <Button icon={<FileSpreadsheet size={14} />} loading={exporting === 'inward_register'} onClick={() => exportReport('inward_register', 'Inward register')}>Inward register</Button>
          <Button icon={<Scale size={14} />} loading={exporting === 'weighbridge_register'} onClick={() => exportReport('weighbridge_register', 'Weighbridge register')}>Weighbridge register</Button>
        </div>
        <DataTable
          rows={list.data?.rows ?? null}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          onRowClick={(r) => (setOpen(r.id), setTab('details'))}
          empty={<EmptyState icon={<Truck size={22} />} title={dq || supplier || spec || vehicleF || shortOnly ? 'No matching deliveries' : 'No deliveries recorded yet'} action={<Button variant="primary" icon={<Plus size={14} />} onClick={() => setOpen('new')}>Record delivery</Button>}>Record each truck or load as it arrives, with its weighbridge slip, challan and royalty pass.</EmptyState>}
          columns={[
            { key: 'receipt_no', header: 'Receipt', mono: true, render: (r) => <b>{r.receipt_no}</b> },
            { key: 'received_at', header: 'Date & time', render: (r) => formatDateTime(r.received_at) },
            { key: 'vehicle_no', header: 'Vehicle', mono: true },
            { key: 'supplier_name', header: 'Supplier' },
            { key: 'spec_label', header: 'Material' },
            { key: 'project_name', header: 'Project', muted: true },
            { key: 'challan_no', header: 'Challan', mono: true, render: (r) => r.challan_no ?? '—' },
            { key: 'royalty_pass_no', header: 'Pass', mono: true, render: (r) => r.royalty_pass_no ?? '—' },
            { key: 'received_qty_milli', header: 'Received', align: 'r', render: (r) => formatQty(r.received_qty_milli, r.unit_code) },
            { key: 'accepted_qty_milli', header: 'Accepted', align: 'r', render: (r) => formatQty(r.accepted_qty_milli) },
            { key: 'rejected_qty_milli', header: 'Rejected', align: 'r', render: (r) => (r.rejected_qty_milli ? <span style={{ color: 'var(--bad)' }}>{formatQty(r.rejected_qty_milli)}</span> : '—') },
            { key: 'flags', header: 'Flags', render: (r) => (
              <div className="flex gap-1 flex-wrap">
                {r.status === 'cancelled' && <Chip tone="bad">Cancelled</Chip>}
                {r.short && <Chip tone="bad" title={`Short by ${formatQty(r.difference_milli, r.unit_code)}`}>Short</Chip>}
                {r.royalty_missing && <Chip tone="warn">No pass</Chip>}
              </div>
            ) },
            { key: 'act', header: '', render: (r) => (r.status === 'posted' ? <div onClick={(e) => e.stopPropagation()}><Button size="sm" variant="ghost" iconOnly aria-label="Cancel receipt" title="Cancel receipt" icon={<Ban size={13} />} onClick={() => cancel(r)} /></div> : null) },
          ]}
        />
        {list.data && <div style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 12 }} className="num">{list.data.total} deliver{list.data.total === 1 ? 'y' : 'ies'}</div>}
      </Page>
      {open && (
        <ReceiptDrawer id={open === 'new' ? null : open} tab={tab} setTab={setTab} onClose={() => setOpen(null)} preset={{ purchaseId: focus.params?.fromPurchase }} />
      )}
    </div>
  );
}

function ReceiptDrawer({ id, tab, setTab, onClose, preset }: { id: string | null; tab: string; setTab: (t: string) => void; onClose: () => void; preset: any }) {
  const r = useAsync(() => (id ? api<any>('receipt.get', { id }) : Promise.resolve(null)), [id]);
  return (
    <Drawer wide title={id ? `Delivery ${r.data?.receipt_no ?? ''}` : 'Record delivery'} subtitle={r.data ? `${r.data.supplier_name} · ${r.data.spec_label} · ${r.data.vehicle_no ?? ''}` : undefined} onClose={onClose}>
      {id && (
        <div style={{ margin: '-20px -20px 18px', padding: '0 20px', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
          <Tabs tabs={[{ id: 'details', label: 'Delivery' }, { id: 'documents', label: 'Slips & documents', count: r.data?.doc_count ?? null }, { id: 'vehicle', label: 'Vehicle history' }, { id: 'history', label: 'History' }]} value={tab} onChange={setTab} />
        </div>
      )}
      {tab === 'details' && <ReceiptForm id={id} preset={preset} onCancel={onClose} onSaved={onClose} />}
      {id && tab === 'documents' && r.data && <DocsPanel entityType="receipt" entityId={id} defaultDocType="weighbridge_slip" companyId={r.data.company_id} allowedTypes={['weighbridge_slip', 'delivery_challan', 'royalty_pass', 'invoice', 'other']} />}
      {id && tab === 'vehicle' && r.data && (r.data.vehicle_no ? <VehicleHistory vehicle={r.data.vehicle_no} /> : <EmptyState title="No vehicle number recorded" />)}
      {id && tab === 'history' && <HistoryPanel entityType="receipt" entityId={id} />}
    </Drawer>
  );
}
