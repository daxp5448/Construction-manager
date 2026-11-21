import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { MODULES } from '../shared/modules';
import { NavTarget } from '../lib/ctx';
import { Button, Note, Page, PageHeader, Tabs } from '../ui/base';
import { Drawer } from '../ui/overlay';
import { ModuleScreen, RecordForm } from './ModuleScreen';

type Tab = 'specs' | 'materials' | 'categories' | 'units';

/** Category → Material → Specification (size / grade). Everything is editable; nothing is hard-coded. */
export function MaterialsScreen({ focus }: { focus: NavTarget }) {
  const [tab, setTab] = useState<Tab>((focus.tab as Tab) || 'specs');
  const [specFor, setSpecFor] = useState<any | null>(null);
  const [version, setVersion] = useState(0);

  return (
    <div>
      <PageHeader title="Materials & Specifications" subtitle="Organise materials as Category → Material → Size / grade (e.g. Aggregate → Aggregate → 20 MM, Bitumen → Bitumen → VG-30). Add any custom category, size or grade; archive what you no longer use." />
      <div style={{ padding: '12px 28px 0' }}>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'specs', label: 'Sizes & grades' },
            { id: 'materials', label: 'Materials' },
            { id: 'categories', label: 'Categories' },
            { id: 'units', label: 'Units' },
          ]}
        />
      </div>
      <Page>
        {tab === 'specs' && (
          <ModuleScreen
            key={`s${version}`}
            moduleId="specs"
            openId={focus.tab === 'specs' ? focus.openId : null}
            title="sizes & grades"
            groupBy={(r) => r.material_id__label}
            emptyHint="Add a material first (Materials tab), then add its sizes or grades here."
          />
        )}
        {tab === 'materials' && (
          <ModuleScreen
            key={`m${version}`}
            moduleId="materials"
            openId={focus.tab === 'materials' ? focus.openId : null}
            groupBy={(r) => r.category_id__label}
            rowActions={(r) => (
              <Button size="sm" icon={<Plus size={12} />} onClick={() => setSpecFor(r)}>
                Size / grade
              </Button>
            )}
          />
        )}
        {tab === 'categories' && <ModuleScreen moduleId="categories" openId={focus.tab === 'categories' ? focus.openId : null} />}
        {tab === 'units' && (
          <>
            <div style={{ marginBottom: 12 }}>
              <Note tone="info">
                Each material specification has one unit (MT, Brass, Cum, Bags, Litre…). Units of the same kind convert automatically (e.g. Kg → MT for weighbridge slips). Weight → volume (MT → Brass) is never guessed, because it depends on the material’s density.
              </Note>
            </div>
            <ModuleScreen moduleId="units" />
          </>
        )}
      </Page>
      {specFor && (
        <Drawer title={`New size / grade · ${specFor.name}`} subtitle={specFor.category_id__label} onClose={() => setSpecFor(null)}>
          <RecordForm
            def={MODULES.specs}
            row={null}
            preset={{ material_id: specFor.id, unit_code: specFor.default_unit }}
            locked={['material_id']}
            onCancel={() => setSpecFor(null)}
            onSaved={() => {
              setSpecFor(null);
              setTab('specs');
              setVersion((v) => v + 1);
            }}
          />
        </Drawer>
      )}
    </div>
  );
}
