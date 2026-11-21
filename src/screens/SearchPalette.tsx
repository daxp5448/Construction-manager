import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Building2,
  CornerDownLeft,
  FileSpreadsheet,
  FileText,
  FolderKanban,
  FolderOpen,
  History,
  Layers,
  Loader2,
  Package,
  PackageCheck,
  Paperclip,
  Receipt,
  Ruler,
  ScrollText,
  Search,
  ShoppingCart,
  Factory,
  FlaskConical,
  Wallet,
  HardHat,
  Boxes,
} from 'lucide-react';
import { api, errMsg, useDebounced } from '../lib/api';
import { entityTarget, useApp } from '../lib/ctx';
import { Button, Chip } from '../ui/base';
import { Modal } from '../ui/overlay';
import { DocsPanel, HistoryPanel } from './Panels';

interface Hit {
  entityType: string;
  entityId: string;
  title: string;
  subtitle: string | null;
  parent: string | null;
  companyId: string | null;
  folderPath: string | null;
  excelPath: string | null;
}

const META: Record<string, { label: string; icon: React.ComponentType<any>; docType?: string; attach?: boolean }> = {
  company: { label: 'Company', icon: Building2, docType: 'agreement', attach: true },
  project: { label: 'Project', icon: FolderKanban, docType: 'agreement', attach: true },
  category: { label: 'Category', icon: Layers },
  material: { label: 'Material', icon: Package },
  spec: { label: 'Specification', icon: Boxes },
  supplier: { label: 'Supplier', icon: Factory, docType: 'other', attach: true },
  purchase: { label: 'Purchase', icon: ShoppingCart, docType: 'purchase_order', attach: true },
  invoice: { label: 'Invoice', icon: Receipt, docType: 'invoice', attach: true },
  payment: { label: 'Payment', icon: Wallet, docType: 'payment_proof', attach: true },
  receipt: { label: 'Inward', icon: PackageCheck, docType: 'delivery_challan', attach: true },
  royalty: { label: 'Royalty pass', icon: ScrollText, docType: 'royalty_pass', attach: true },
  quality: { label: 'Test', icon: FlaskConical, docType: 'test_report', attach: true },
  measurement: { label: 'Measurement', icon: Ruler, docType: 'measurement', attach: true },
  consumption: { label: 'Consumption', icon: HardHat, docType: 'consumption_support', attach: true },
  progress: { label: 'Progress', icon: HardHat, docType: 'progress', attach: true },
  document: { label: 'Document', icon: FileText },
  report: { label: 'Report', icon: FileSpreadsheet },
};

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const { go, scope, toast } = useApp();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [panel, setPanel] = useState<{ kind: 'docs' | 'history'; hit: Hit } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!dq.trim()) {
      setHits([]);
      setError(null);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    api<Hit[]>('search.query', { q: dq, companyId: undefined, limit: 40 })
      .then((r) => {
        if (my !== seq.current) return;
        // results in the active company first
        const sorted = scope.companyId ? [...r].sort((a, b) => Number(b.companyId === scope.companyId) - Number(a.companyId === scope.companyId)) : r;
        setHits(sorted);
        setActive(0);
        setError(null);
      })
      .catch((e) => my === seq.current && setError(errMsg(e)))
      .finally(() => my === seq.current && setLoading(false));
  }, [dq, scope.companyId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && !panel && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, panel]);

  const openHit = (h: Hit) => {
    go(entityTarget(h.entityType, h.entityId));
    onClose();
  };

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const grouped = useMemo(() => hits, [hits]);

  return (
    <>
      {createPortal(
        <>
          <div className="scrim" onMouseDown={onClose} style={{ zIndex: 70 }} />
          <div role="dialog" aria-modal="true" aria-label="Global search" style={{ position: 'fixed', zIndex: 71, left: '50%', top: '9vh', transform: 'translateX(-50%)', width: 'min(760px, calc(100vw - 48px))', background: 'var(--surface)', borderRadius: 14, boxShadow: 'var(--shadow-3)', overflow: 'hidden', animation: 'fade .12s' }}>
            <div className="flex items-center gap-3" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              {loading ? <Loader2 size={18} className="spin" color="var(--brand)" /> : <Search size={18} color="var(--ink-3)" />}
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search companies, projects, suppliers, vehicle numbers, invoices, passes, documents…"
                aria-label="Search everything"
                style={{ flex: 1, border: 0, outline: 'none', fontSize: 15, background: 'transparent', color: 'var(--ink)' }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onClose();
                  else if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, grouped.length - 1)));
                  else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
                  else if (e.key === 'Enter' && grouped[active]) openHit(grouped[active]);
                }}
              />
              <span className="kbd">Esc</span>
            </div>
            <div ref={listRef} style={{ maxHeight: '58vh', overflow: 'auto', padding: 6 }}>
              {error && <div className="note note-bad" style={{ margin: 8 }}>{error}</div>}
              {!q.trim() && (
                <div style={{ padding: '26px 20px', color: 'var(--ink-3)', textAlign: 'center', lineHeight: 1.6 }}>
                  Type at least one character. Search is instant and matches <b>part of any word</b>, in any case, e.g.
                  <div style={{ marginTop: 8 }} className="flex gap-2 justify-center flex-wrap">
                    {['patel', 'gj01', 'VG-30', 'inv-77', 'rp-000'].map((s) => (
                      <button key={s} className="chip chip-neutral nodot" style={{ cursor: 'pointer' }} onClick={() => setQ(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {q.trim() && !loading && !error && grouped.length === 0 && dq === q && <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--ink-3)' }}>No results for “{q}”.</div>}
              {grouped.map((h, i) => {
                const m = META[h.entityType] ?? { label: h.entityType, icon: FileText };
                const Icon = m.icon;
                const isActive = i === active;
                return (
                  <div key={`${h.entityType}:${h.entityId}`} data-i={i} onMouseEnter={() => setActive(i)} className="flex items-center gap-3" style={{ padding: '8px 10px', borderRadius: 8, background: isActive ? 'var(--brand-soft)' : 'transparent', cursor: 'pointer' }} onClick={() => openHit(h)}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--sunk)', display: 'grid', placeItems: 'center', color: 'var(--ink-2)', flexShrink: 0 }}>
                      <Icon size={15} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-2">
                        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</span>
                        <Chip tone="neutral" dot={false}>
                          {m.label}
                        </Chip>
                      </div>
                      <div style={{ color: 'var(--ink-3)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {h.parent && <span>{h.parent}</span>}
                        {h.parent && h.subtitle && ' · '}
                        {h.subtitle}
                      </div>
                    </div>
                    {isActive && (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" icon={<CornerDownLeft size={12} />} onClick={() => openHit(h)}>
                          Open
                        </Button>
                        {h.folderPath && (
                          <Button size="sm" iconOnly aria-label="Open folder" title="Open folder" icon={<FolderOpen size={13} />} onClick={() => api('system.openPath', { path: h.folderPath }).catch((e) => toast('error', errMsg(e)))} />
                        )}
                        {h.excelPath && (
                          <Button size="sm" iconOnly aria-label="Open Excel" title="Open Excel" icon={<FileSpreadsheet size={13} />} onClick={() => api('system.openPath', { path: h.excelPath }).catch((e) => toast('error', errMsg(e)))} />
                        )}
                        {m.attach && <Button size="sm" iconOnly aria-label="Add document" title="Add document" icon={<Paperclip size={13} />} onClick={() => setPanel({ kind: 'docs', hit: h })} />}
                        <Button size="sm" iconOnly aria-label="View history" title="View history" icon={<History size={13} />} onClick={() => setPanel({ kind: 'history', hit: h })} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4" style={{ padding: '8px 16px', borderTop: '1px solid var(--line)', background: '#faf8f3', color: 'var(--ink-3)', fontSize: 11.5 }}>
              <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span>
              <span><span className="kbd">Enter</span> open</span>
              <span style={{ marginLeft: 'auto' }}>Searches everything offline</span>
            </div>
          </div>
        </>,
        document.body
      )}
      {panel && (
        <Modal title={`${panel.kind === 'docs' ? 'Documents' : 'History'} · ${panel.hit.title}`} width={720} onClose={() => setPanel(null)}>
          {panel.kind === 'docs' ? (
            <DocsPanel entityType={panel.hit.entityType} entityId={panel.hit.entityId} defaultDocType={META[panel.hit.entityType]?.docType ?? 'other'} companyId={panel.hit.companyId ?? scope.companyId} />
          ) : (
            <HistoryPanel entityType={panel.hit.entityType} entityId={panel.hit.entityId} />
          )}
        </Modal>
      )}
    </>
  );
}
