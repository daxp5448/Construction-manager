import React from 'react';
import { AlertTriangle, ArrowRight, Banknote, BarChart3, Boxes, Building2, Check, CircleAlert, FileSpreadsheet, FileWarning, Factory, FolderKanban, HardHat, Layers, PackageCheck, Plus, ScrollText, ShoppingCart, Truck, Wallet, Warehouse } from 'lucide-react';
import { api, useAsync } from '../lib/api';
import { NavTarget, entityTarget, useApp } from '../lib/ctx';
import { Button, Card, CardHead, Chip, EmptyState, ErrorState, Kpi, Page, PageHeader, Skeleton } from '../ui/base';
import { formatDate, formatINR, formatQty } from '../shared/num';

const KIND: Record<string, { label: string; icon: React.ComponentType<any>; tone: 'info' | 'good' | 'warn' | 'neutral' | 'brand' }> = {
  purchase: { label: 'Purchase', icon: ShoppingCart, tone: 'info' },
  receipt: { label: 'Inward', icon: PackageCheck, tone: 'good' },
  payment: { label: 'Payment', icon: Wallet, tone: 'neutral' },
  invoice: { label: 'Invoice', icon: Banknote, tone: 'warn' },
  consumption: { label: 'Consumed', icon: HardHat, tone: 'brand' },
};

export function DashboardScreen({ focus }: { focus: NavTarget }) {
  void focus;
  const { scope, go, dataVersion, companies } = useApp();
  const d = useAsync(() => api<any>('dashboard.get', { companyId: scope.companyId }), [scope.companyId, dataVersion]);
  const t = d.data?.totals;
  const empty = d.data && companies.length === 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={scope.companyId ? `Figures for ${companies.find((c) => c.id === scope.companyId)?.name ?? 'the selected company'}` : 'Live figures across all companies, calculated from your recorded transactions.'}
        actions={
          <>
            <Button icon={<PackageCheck size={14} />} onClick={() => go({ screen: 'inward', params: { create: true } })}>
              Record inward
            </Button>
            <Button icon={<HardHat size={14} />} onClick={() => go({ screen: 'consumption', tab: 'entries', params: { create: true } })}>
              Record consumption
            </Button>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => go({ screen: 'purchases', params: { create: true } })}>
              New purchase
            </Button>
          </>
        }
      />
      <Page>
        {d.error && <ErrorState message={d.error} onRetry={d.reload} />}
        {!d.data && d.loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} style={{ padding: 16 }}>
                <Skeleton w="50%" h={10} />
                <Skeleton w="70%" h={24} style={{ marginTop: 12 }} />
              </Card>
            ))}
          </div>
        )}

        {empty && (
          <Card style={{ marginBottom: 18 }}>
            <EmptyState icon={<Building2 size={22} />} title="Welcome — let’s set up your first company" action={<Button variant="primary" icon={<Plus size={14} />} onClick={() => go({ screen: 'companies', params: { create: true } })}>Create company</Button>}>
              Enter the company details once and the application creates its folder structure and Excel workbook. Then add a project, your suppliers and start recording purchases and deliveries.
            </EmptyState>
          </Card>
        )}

        {d.data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 14 }}>
              <Kpi label="Companies" value={t.companies} icon={<Building2 size={16} />} onClick={() => go({ screen: 'companies' })} hint="Records on file" />
              <Kpi label="Active projects" value={t.active_projects} icon={<FolderKanban size={16} />} onClick={() => go({ screen: 'projects' })} hint="Currently running" />
              <Kpi label="Suppliers" value={t.suppliers} icon={<Factory size={16} />} onClick={() => go({ screen: 'suppliers' })} hint="Crushers, depots, transporters" />
              <Kpi label="Material categories" value={t.material_categories} icon={<Layers size={16} />} onClick={() => go({ screen: 'materials' })} hint="Aggregate, dust, bitumen…" />
              <Kpi label="Total purchases" value={formatINR(t.purchases_paise, { decimals: 0 })} icon={<ShoppingCart size={16} />} onClick={() => go({ screen: 'purchases' })} hint={`${t.purchases_count} order${t.purchases_count === 1 ? '' : 's'} (excl. cancelled)`} />
              <Kpi
                label="Material received"
                icon={<Truck size={16} />}
                onClick={() => go({ screen: 'inward' })}
                value={d.data.received_by_unit.length ? d.data.received_by_unit.slice(0, 2).map((r: any) => formatQty(r.received_milli, r.unit_code)).join(' · ') : '—'}
                hint={d.data.received_by_unit.length ? `${d.data.received_by_unit.reduce((a: number, r: any) => a + r.deliveries, 0)} deliveries` : 'No deliveries yet'}
              />
              <Kpi label="Current stock value" value={formatINR(d.data.stock_value_paise, { decimals: 0 })} icon={<Warehouse size={16} />} onClick={() => go({ screen: 'inventory' })} hint={d.data.stock_unvalued_lines ? `${d.data.stock_unvalued_lines} line(s) have no purchase rate yet` : 'At average purchase rate'} />
              <Kpi label="Outstanding to suppliers" value={formatINR(d.data.outstanding_paise, { decimals: 0 })} tone={d.data.outstanding_paise > 0 ? 'warn' : 'neutral'} icon={<Wallet size={16} />} onClick={() => go({ screen: 'billing', tab: 'outstanding' })} hint="Billed − paid − advances − credit notes" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.7fr) minmax(0, 1fr)', gap: 14, marginTop: 14 }}>
              <Card>
                <CardHead title="Recent transactions" subtitle="Latest purchases, deliveries, bills, payments and consumption" />
                {d.data.recent_transactions.length === 0 ? (
                  <EmptyState title="No transactions yet">Transactions appear here as soon as you record a purchase, delivery, bill or payment.</EmptyState>
                ) : (
                  <div>
                    {d.data.recent_transactions.map((r: any) => {
                      const k = KIND[r.kind];
                      const Icon = k.icon;
                      return (
                        <button key={r.kind + r.id} onClick={() => go(entityTarget(r.kind, r.id))} className="flex items-center gap-3" style={{ width: '100%', padding: '9px 16px', border: 0, borderTop: '1px solid var(--line-soft)', background: 'transparent', textAlign: 'left', cursor: 'pointer' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#fffaf5')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--sunk)', display: 'grid', placeItems: 'center', color: 'var(--ink-2)' }}>
                            <Icon size={14} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {r.ref} <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>· {r.party}</span>
                            </div>
                            <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>
                              <Chip tone={k.tone} dot={false}>{k.label}</Chip> <span style={{ marginLeft: 4 }}>{formatDate(r.date)}</span>
                            </div>
                          </div>
                          <div className="num" style={{ fontWeight: 600 }}>
                            {r.amount_paise !== null ? formatINR(r.amount_paise) : r.qty_milli !== null ? formatQty(r.qty_milli, r.unit_code) : ''}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>

              <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
                <Card>
                  <CardHead title="Needs attention" />
                  <div style={{ padding: '4px 0' }}>
                    <Alert ok={d.data.low_stock.length === 0} icon={<Boxes size={15} />} title="Low stock" detail={d.data.low_stock.length ? `${d.data.low_stock.length} material(s) below minimum: ${d.data.low_stock.slice(0, 2).map((l: any) => l.spec_label).join(', ')}${d.data.low_stock.length > 2 ? '…' : ''}` : 'All materials above minimum level'} onClick={() => go({ screen: 'inventory', tab: 'low' })} />
                    <Alert ok={d.data.pending_invoices.count === 0} icon={<Banknote size={15} />} title="Pending invoices" detail={d.data.pending_invoices.count ? `${d.data.pending_invoices.count} unpaid / part-paid · ${d.data.pending_invoices.awaiting_action} awaiting verification or approval` : 'No unpaid invoices'} onClick={() => go({ screen: 'billing', tab: 'outstanding' })} />
                    <Alert ok={d.data.missing_royalty.receipts_without_pass + d.data.missing_royalty.passes_without_document === 0} icon={<ScrollText size={15} />} title="Missing royalty documents" detail={d.data.missing_royalty.receipts_without_pass + d.data.missing_royalty.passes_without_document ? `${d.data.missing_royalty.receipts_without_pass} inward without a pass · ${d.data.missing_royalty.passes_without_document} pass(es) with no scan` : 'All royalty documents on file'} onClick={() => go({ screen: 'royalty', tab: 'missing' })} />
                    <Alert ok={d.data.short_deliveries_30d === 0} icon={<Truck size={15} />} title="Short deliveries (30 days)" detail={d.data.short_deliveries_30d ? `${d.data.short_deliveries_30d} delivery(ies) received less than ordered` : 'No short deliveries'} onClick={() => go({ screen: 'inward', params: { shortOnly: true } })} />
                    <Alert ok={d.data.missing_files === 0} icon={<FileWarning size={15} />} title="Missing files" detail={d.data.missing_files ? `${d.data.missing_files} file(s) moved or deleted outside the app` : 'All attached files found'} onClick={() => go({ screen: 'documents', params: { missingOnly: true } })} />
                  </div>
                </Card>
                <Card>
                  <CardHead title="Recent reports" actions={<Button size="sm" variant="ghost" onClick={() => go({ screen: 'reports' })} icon={<ArrowRight size={13} />}>All</Button>} />
                  {d.data.recent_reports.length === 0 ? (
                    <div className="flex items-center gap-3" style={{ padding: '16px', color: 'var(--ink-3)' }}>No reports generated yet. <Button size="sm" onClick={() => go({ screen: 'reports' })}>Open reports</Button></div>
                  ) : (
                    d.data.recent_reports.map((r: any) => (
                      <div key={r.id} className="flex items-center gap-3" style={{ padding: '8px 16px', borderTop: '1px solid var(--line-soft)' }}>
                        <FileSpreadsheet size={15} color={r.is_missing ? 'var(--bad)' : 'var(--good)'} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                          <div style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>{r.format.toUpperCase()} · {formatDate(String(r.created_at).slice(0, 10))}</div>
                        </div>
                        <Button size="sm" disabled={!!r.is_missing} onClick={() => api('report.open', { id: r.id })}>Open</Button>
                      </div>
                    ))
                  )}
                </Card>
              </div>
            </div>
          </>
        )}
      </Page>
    </div>
  );
}

function Alert({ ok, icon, title, detail, onClick }: { ok: boolean; icon: React.ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-start gap-3" style={{ width: '100%', padding: '10px 16px', border: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#fffaf5')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
      <div style={{ width: 26, height: 26, borderRadius: 7, display: 'grid', placeItems: 'center', background: ok ? 'var(--good-soft)' : 'var(--warn-soft)', color: ok ? 'var(--good)' : 'var(--warn)', flexShrink: 0 }}>{ok ? <Check size={14} /> : icon}</div>
      <div>
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div style={{ color: ok ? 'var(--ink-3)' : 'var(--ink-2)', fontSize: 12, lineHeight: 1.4 }}>{detail}</div>
      </div>
    </button>
  );
}
void AlertTriangle; void BarChart3; void CircleAlert;
