import React, { useState } from 'react';
import { History } from 'lucide-react';
import { api, useAsync } from '../lib/api';
import { NavTarget } from '../lib/ctx';
import { Button, Chip, EmptyState, Note, Page, PageHeader, Skeleton, Tabs } from '../ui/base';
import { Modal } from '../ui/overlay';
import { formatDateTime, formatQty } from '../shared/num';
import { ModuleScreen } from './ModuleScreen';

type Tab = 'mb' | 'progress' | 'formulas';

function RevisionHistory({ group }: { group: string }) {
  const h = useAsync(() => api<any[]>('measurement.history', { group }), [group]);
  if (!h.data) return <Skeleton h={60} />;
  if (!h.data.length) return <EmptyState title="No revisions" />;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {h.data.map((m) => (
        <div key={m.id} className="card" style={{ padding: 12 }} data-selectable>
          <div className="flex items-center gap-2">
            <Chip tone={m.superseded_at ? 'neutral' : 'good'}>Revision {m.revision}{m.superseded_at ? ' (superseded)' : ' (current)'}</Chip>
            <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{formatDateTime(String(m.created_at).slice(0, 16).replace('T', 'T'))}</span>
          </div>
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {[['Length', formatQty(m.length_milli)], ['Width', formatQty(m.width_milli)], ['Depth', formatQty(m.depth_milli)], ['Nos', formatQty(m.nos_milli)], ['Quantity', formatQty(m.qty_milli, m.unit_code)]].map(([k, v]) => (
              <div key={k}>
                <div className="eyebrow">{k}</div>
                <div className="num" style={{ fontWeight: k === 'Quantity' ? 600 : 400 }}>{v || '—'}</div>
              </div>
            ))}
          </div>
          {m.formula_expr && <div style={{ marginTop: 6, color: 'var(--ink-3)', fontSize: 12 }}>Formula: <span className="mono">{m.formula_expr}</span></div>}
          {m.supersede_reason && <div style={{ marginTop: 6, fontStyle: 'italic', color: 'var(--ink-2)' }}>Revised because: {m.supersede_reason}</div>}
        </div>
      ))}
    </div>
  );
}

export function MeasurementScreen({ focus }: { focus: NavTarget }) {
  const [tab, setTab] = useState<Tab>((focus.tab as Tab) || 'mb');
  const [hist, setHist] = useState<any | null>(null);
  return (
    <div>
      <PageHeader title="Measurement Book" subtitle="Measurements, daily progress and the site diary. Original measurements are never overwritten — a revision keeps the earlier entry in history." />
      <div style={{ padding: '12px 28px 0' }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'mb', label: 'Measurement book' }, { id: 'progress', label: 'Site diary & progress' }, { id: 'formulas', label: 'Quantity formulas' }]} />
      </div>
      <Page>
        {tab === 'mb' && (
          <ModuleScreen
            moduleId="measurement"
            openId={focus.tab === 'mb' ? focus.openId : null}
            startNew={!!focus.params?.create}
            rowActions={(r) => (
              <Button size="sm" variant="ghost" iconOnly aria-label="Revision history" title="Revision history" icon={<History size={13} />} onClick={() => setHist(r)} />
            )}
          />
        )}
        {tab === 'progress' && (
          <>
            <div style={{ marginBottom: 12 }}>
              <Note tone="info">Use <b>Daily Progress</b>, <b>Site Diary</b> or <b>Road Work Register</b> as the register type. Attach level-book scans and site photos to each entry from its Documents tab.</Note>
            </div>
            <ModuleScreen moduleId="progress" openId={focus.tab === 'progress' ? focus.openId : null} startNew={!!focus.params?.create} />
          </>
        )}
        {tab === 'formulas' && <ModuleScreen moduleId="formulas" />}
      </Page>
      {hist && (
        <Modal title={`Revision history · MB ${hist.mb_no}`} width={720} onClose={() => setHist(null)}>
          <RevisionHistory group={hist.entry_group} />
        </Modal>
      )}
    </div>
  );
}
