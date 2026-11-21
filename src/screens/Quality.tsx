import React, { useState } from 'react';
import { NavTarget } from '../lib/ctx';
import { Note, Page, PageHeader, Tabs } from '../ui/base';
import { ModuleScreen } from './ModuleScreen';

export function QualityScreen({ focus }: { focus: NavTarget }) {
  const [tab, setTab] = useState<'tests' | 'types'>('tests');
  return (
    <div>
      <PageHeader title="Quality Control" subtitle="Laboratory and field test records for aggregates, bitumen, soil, GSB/WMM, density, compaction and concrete — with the report attached to each record." />
      <div style={{ padding: '12px 28px 0' }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'tests', label: 'Test records' }, { id: 'types', label: 'Test types' }]} />
      </div>
      <Page>
        {tab === 'tests' ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <Note tone="info">
                Acceptance limits are <b>yours</b>: name the governing specification and edition on each record and enter its minimum / maximum. The application compares the result with those limits only — it never applies built-in limits.
              </Note>
            </div>
            <ModuleScreen moduleId="quality" openId={focus.openId} startNew={!!focus.params?.create} />
          </>
        ) : (
          <ModuleScreen moduleId="testTypes" />
        )}
      </Page>
    </div>
  );
}
