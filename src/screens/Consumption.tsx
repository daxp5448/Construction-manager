import React, { useState } from 'react';
import { NavTarget, useApp } from '../lib/ctx';
import { Field, RefSelect } from '../ui/inputs';
import { Note, Page, PageHeader, Tabs } from '../ui/base';
import { ModuleScreen } from './ModuleScreen';
import { ReportView } from './ReportView';

type Tab = 'entries' | 'plans' | 'actual' | 'summary';

export function ConsumptionScreen({ focus }: { focus: NavTarget }) {
  const { scope } = useApp();
  const [tab, setTab] = useState<Tab>((focus.tab as Tab) || 'entries');
  const [spec, setSpec] = useState<string | null>(null);
  return (
    <div>
      <PageHeader title="Material Consumption" subtitle="Record what was used, where (chainage) and for which activity. Posting an entry reduces project stock automatically." />
      <div style={{ padding: '12px 28px 0' }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'entries', label: 'Daily consumption' }, { id: 'plans', label: 'Planned quantities' }, { id: 'actual', label: 'Planned vs actual' }, { id: 'summary', label: 'Summary' }]} />
      </div>
      <Page>
        {tab === 'entries' && <ModuleScreen moduleId="consumption" openId={focus.tab === 'entries' || !focus.tab ? focus.openId : null} startNew={!!focus.params?.create} />}
        {tab === 'plans' && (
          <>
            <div style={{ marginBottom: 12 }}>
              <Note tone="info">Enter planned quantities and the basis you used (estimate, BOQ, mix design…). The application does not invent engineering formulas — it only compares your plan with recorded consumption.</Note>
            </div>
            <ModuleScreen moduleId="consumptionPlans" />
          </>
        )}
        {(tab === 'actual' || tab === 'summary') && (
          <>
            <div className="flex items-end gap-3" style={{ marginBottom: 12 }}>
              <Field label="Material" style={{ width: 260 }}>
                <RefSelect refKind="spec" value={spec} onChange={setSpec} placeholder="All materials" />
              </Field>
              <div style={{ color: 'var(--ink-3)', paddingBottom: 8 }}>Company and project follow the “Working on” selection in the top bar.</div>
            </div>
            <ReportView reportId={tab === 'actual' ? 'planned_vs_actual' : 'consumption_summary'} filters={{ companyId: scope.companyId, projectId: scope.projectId, specId: spec }} />
          </>
        )}
      </Page>
    </div>
  );
}
