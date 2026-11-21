import React, { useEffect, useState } from 'react';
import { Archive, DatabaseBackup, FileSpreadsheet, FolderOpen, HardDrive, RotateCcw, ScrollText, Upload } from 'lucide-react';
import { api, errMsg, useAsync } from '../lib/api';
import { NavTarget, useAction, useApp } from '../lib/ctx';
import { AppSettings } from '../types';
import { Button, Card, CardHead, Chip, EmptyState, KeyValue, Note, Page, PageHeader, Segmented, Tabs } from '../ui/base';
import { Checkbox, Field, Input, NumberInput, RefSelect, TextArea } from '../ui/inputs';
import { Modal } from '../ui/overlay';
import { DataTable } from '../ui/table';
import { formatDateTime } from '../shared/num';
import { ModuleScreen } from './ModuleScreen';

type Tab = 'general' | 'folders' | 'backup' | 'lists' | 'system';

const DEFAULT_COMPANY = ['01_Company_Information', '02_Projects', '03_Bills_and_Invoices', '04_Contracts_and_Documents', '05_Site_Photos', '06_Exports', '07_Materials', '08_Suppliers', '09_Royalty_Records', '10_Reports', '11_Backups'];
const DEFAULT_PROJECT = ['01_Agreements', '02_BOQ', '03_Measurement_Books', '04_Daily_Progress', '05_Site_Photos'];
const DEFAULT_SUPPLIER = ['Invoices', 'Purchase_Orders', 'Delivery_Challans', 'Weighbridge_Slips', 'Royalty_Passes', 'Stock_Records', 'Reports', 'Documents'];

function General({ s, save }: { s: AppSettings; save: (p: Partial<AppSettings>) => Promise<void> }) {
  const act = useAction();
  const [title, setTitle] = useState(s.excelHeaderTitle);
  const [loc, setLoc] = useState(s.defaultStockLocation);
  const [tol, setTol] = useState<number | null>(s.shortToleranceBp);
  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 820 }}>
      <Card>
        <CardHead title="Storage location" subtitle="Where company folders, workbooks, reports and backups are kept." />
        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          <div className="flex items-center gap-2">
            <Input readOnly value={s.storageRoot} className="mono" aria-label="Storage folder" />
            <Button icon={<FolderOpen size={14} />} onClick={async () => { const r = await act(() => api<{ path: string | null }>('settings.chooseFolder', { title: 'Select the Construction Records storage folder' })); if (r?.path) await save({ storageRoot: r.path }); }}>Change…</Button>
            <Button onClick={() => api('system.openPath', { path: s.storageRoot }).catch(() => {})}>Open</Button>
          </div>
          <Note tone="info">Changing the folder affects <b>new</b> companies and reports. Existing company folders stay where they are and keep working — nothing is moved or deleted.</Note>
        </div>
      </Card>
      <Card>
        <CardHead title="Excel workbooks" />
        <div style={{ padding: 16, display: 'grid', gap: 12 }}>
          <Field label="Banner title on company workbooks" help="Shown in the orange banner at the top of each company’s Excel file.">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== s.excelHeaderTitle && save({ excelHeaderTitle: title })} />
          </Field>
          <Checkbox checked={s.backupBeforeUpdate} onChange={(c) => save({ backupBeforeUpdate: c })} label="Always keep a time-stamped backup of the previous workbook before re-exporting" disabled />
          <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>This safety is always on: the application never overwrites a workbook without first copying it.</div>
        </div>
      </Card>
      <Card>
        <CardHead title="Operations" />
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label="Default stock location"><Input value={loc} onChange={(e) => setLoc(e.target.value)} onBlur={() => loc.trim() && loc !== s.defaultStockLocation && save({ defaultStockLocation: loc.trim() })} /></Field>
          <Field label="Quantity tolerance" help="Deliveries short by more than this % of the ordered quantity, and royalty-pass differences beyond it, are flagged. 0 = flag any difference.">
            <NumberInput kind="pct" suffix="%" value={tol} onChange={setTol} align="left" />
            <div style={{ marginTop: 6 }}><Button size="sm" onClick={() => save({ shortToleranceBp: tol ?? 0 })} disabled={(tol ?? 0) === s.shortToleranceBp}>Save tolerance</Button></div>
          </Field>
          <div style={{ gridColumn: 'span 2' }}><Checkbox checked={s.lowStockAlerts} onChange={(c) => save({ lowStockAlerts: c })} label="Show low-stock alerts on the dashboard" /></div>
        </div>
      </Card>
    </div>
  );
}

function FolderLists({ s, save }: { s: AppSettings; save: (p: Partial<AppSettings>) => Promise<void> }) {
  const [company, setCompany] = useState(s.folderTemplate.join('\n'));
  const [project, setProject] = useState(s.projectFolderTemplate.join('\n'));
  const [supplier, setSupplier] = useState(s.supplierFolderTemplate.join('\n'));
  const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);
  const dirty = company !== s.folderTemplate.join('\n') || project !== s.projectFolderTemplate.join('\n') || supplier !== s.supplierFolderTemplate.join('\n');
  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 980 }}>
      <Note tone="info">These lists decide which sub-folders are created automatically. Folders are only ever <b>added</b> — existing folders and files are never renamed, moved or deleted. The first six company folders are required by the application and are always created.</Note>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <Card><CardHead title="Inside each company" subtitle="Construction Company Records / <Company> /" /><div style={{ padding: 14 }}><TextArea rows={13} className="mono" value={company} onChange={(e) => setCompany(e.target.value)} /></div></Card>
        <Card><CardHead title="Inside each project" subtitle="<Company> / 02_Projects / <Project> /" /><div style={{ padding: 14 }}><TextArea rows={13} className="mono" value={project} onChange={(e) => setProject(e.target.value)} /></div></Card>
        <Card><CardHead title="Inside each supplier folder" subtitle="07_Materials / <Category> / <Size> / <Supplier> /" /><div style={{ padding: 14 }}><TextArea rows={13} className="mono" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div></Card>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" disabled={!dirty} onClick={() => save({ folderTemplate: lines(company), projectFolderTemplate: lines(project), supplierFolderTemplate: lines(supplier) })}>Save folder structure</Button>
        <Button icon={<RotateCcw size={13} />} onClick={() => (setCompany(DEFAULT_COMPANY.join('\n')), setProject(DEFAULT_PROJECT.join('\n')), setSupplier(DEFAULT_SUPPLIER.join('\n')))}>Reset to defaults</Button>
      </div>
      <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>To re-create missing folders for a company, open the company and choose “Check folders”.</div>
    </div>
  );
}

function Backups({ s, save }: { s: AppSettings; save: (p: Partial<AppSettings>) => Promise<void> }) {
  const { confirm, toast, companies, scope } = useApp();
  const act = useAction();
  const list = useAsync(() => api<any[]>('backup.list'), []);
  const [busy, setBusy] = useState('');
  const [retention, setRetention] = useState<number | null>(s.backupRetention);
  const [restoreTarget, setRestoreTarget] = useState<any | null>(null);
  const [archiveCo, setArchiveCo] = useState<string | null>(scope.companyId);

  const run = async (key: string, fn: () => Promise<any>, ok: (r: any) => string) => {
    setBusy(key);
    try {
      const r = await act(fn);
      if (r) {
        toast('success', ok(r));
        list.reload();
      }
    } finally {
      setBusy('');
    }
  };
  const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Card>
          <CardHead title="Database backup" subtitle="A consistent snapshot of all your records." />
          <div style={{ padding: 16, display: 'grid', gap: 12 }}>
            <Checkbox checked={s.autoBackup} onChange={(c) => save({ autoBackup: c })} label="Back up automatically (at most once a day, when the app starts)" />
            <div className="flex items-end gap-2">
              <Field label="Keep newest automatic backups" style={{ width: 200 }}><NumberInput kind="int" value={retention} onChange={setRetention} align="left" /></Field>
              <Button size="sm" disabled={retention === s.backupRetention || !retention} onClick={() => retention && save({ backupRetention: retention })}>Save</Button>
            </div>
            <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>Only automatic backups beyond this number are pruned. Manual, before-restore and before-upgrade backups are never deleted by the app.</div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="primary" icon={<DatabaseBackup size={14} />} loading={busy === 'create'} onClick={() => run('create', () => api('backup.create'), (r) => `Backup saved: ${r.name}`)}>Back up now</Button>
              <Button icon={<Upload size={14} />} onClick={async () => { const f = await act(() => api<{ path: string | null }>('backup.chooseFile')); if (f?.path) setRestoreTarget({ file: f.path, name: f.path.split(/[\\/]/).pop(), kind: 'chosen file' }); }}>Restore from file…</Button>
              <Button icon={<FolderOpen size={14} />} onClick={() => api('system.openPath', { path: s.backupDir || `${s.storageRoot}\\_Database_Backups` }).catch((e) => toast('info', errMsg(e)))}>Open folder</Button>
            </div>
          </div>
        </Card>
        <Card>
          <CardHead title="Archives & Excel copies" subtitle="Take records off the computer or keep extra copies of workbooks." />
          <div style={{ padding: 16, display: 'grid', gap: 12 }}>
            <div className="flex items-end gap-2">
              <Field label="Export archive (zip of folders + database)" style={{ flex: 1 }}><RefSelect refKind="company" value={archiveCo} onChange={setArchiveCo} placeholder="All companies" /></Field>
              <Button icon={<Archive size={14} />} loading={busy === 'zip'} onClick={() => run('zip', () => api('backup.exportArchive', { companyId: archiveCo }), (r) => `Archive created (${size(r.size)}) in ${r.file}`)}>Export</Button>
            </div>
            <div className="flex items-center gap-2">
              <div style={{ flex: 1, color: 'var(--ink-2)' }}>Copy every company workbook into its <span className="mono">11_Backups</span> folder.</div>
              <Button icon={<FileSpreadsheet size={14} />} loading={busy === 'xl'} onClick={() => run('xl', () => api('backup.excelBackup'), (r) => `${r.copied} workbook(s) copied`)}>Back up Excel files</Button>
            </div>
            {companies.length === 0 && <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>No companies yet.</div>}
          </div>
        </Card>
      </div>
      <Card>
        <CardHead title="Available backups" actions={<Button size="sm" onClick={list.reload}>Refresh</Button>} />
        <DataTable
          rows={list.data}
          loading={list.loading}
          error={list.error}
          rowKey={(r) => r.file}
          empty={<EmptyState icon={<HardDrive size={22} />} title="No backups yet">Click “Back up now” to create the first one.</EmptyState>}
          columns={[
            { key: 'name', header: 'File', mono: true },
            { key: 'kind', header: 'Kind', render: (r) => <Chip tone={r.kind === 'manual' ? 'info' : r.kind === 'automatic' ? 'neutral' : 'warn'} dot={false}>{r.kind}</Chip> },
            { key: 'modified', header: 'Created', render: (r) => formatDateTime(r.modified.slice(0, 16)) },
            { key: 'size', header: 'Size', align: 'r', render: (r) => size(r.size) },
            { key: 'act', header: '', render: (r) => <Button size="sm" icon={<RotateCcw size={12} />} onClick={() => setRestoreTarget(r)}>Restore…</Button> },
          ]}
        />
      </Card>
      {restoreTarget && (
        <Modal
          title="Restore database from backup?"
          onClose={() => setRestoreTarget(null)}
          footer={
            <>
              <Button onClick={() => setRestoreTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                loading={busy === 'restore'}
                onClick={async () => {
                  setBusy('restore');
                  try {
                    const r = await act(() => api<any>('backup.restore', { file: restoreTarget.file, confirmed: true }));
                    if (r) {
                      toast('success', 'Database restored. Your previous data was saved as a “before restore” backup.');
                      setRestoreTarget(null);
                      window.location.reload();
                    }
                  } finally {
                    setBusy('');
                  }
                }}
              >
                Restore and replace current data
              </Button>
            </>
          }
        >
          <div style={{ display: 'grid', gap: 12 }}>
            <Note tone="warn" title="This replaces everything currently in the database">
              Records entered after this backup was made will no longer appear. Before restoring, the application saves your <b>current</b> data as a separate backup so you can undo this. Files and folders on disk are not touched.
            </Note>
            <KeyValue cols={1} items={[['Backup', <span className="mono">{restoreTarget.name}</span>], ['Type', restoreTarget.kind], ['Created', restoreTarget.modified ? formatDateTime(restoreTarget.modified.slice(0, 16)) : '—']]} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function SystemInfo() {
  const act = useAction();
  const { toast } = useApp();
  const info = useAsync(() => api<any>('system.info'), []);
  const [checking, setChecking] = useState(false);
  const d = info.data;
  return (
    <div style={{ display: 'grid', gap: 14, maxWidth: 820 }}>
      <Card>
        <CardHead title="About" />
        <div style={{ padding: 16 }}>
          {d && (
            <KeyValue
              cols={2}
              items={[
                ['Application version', d.appVersion],
                ['Database schema', d.migration ? `v${d.migration.toVersion}` : '—'],
                ['Electron / Chromium', `${d.versions.electron ?? '—'} / ${d.versions.chrome ?? '—'}`],
                ['Node.js', d.versions.node],
                ['Database file', <span className="mono" style={{ wordBreak: 'break-all' }}>{d.dbFile}</span>],
                ['Log file', <span className="mono" style={{ wordBreak: 'break-all' }}>{d.logFile}</span>],
              ]}
            />
          )}
        </div>
      </Card>
      <Card>
        <CardHead title="Data integrity" subtitle="Looks for attached documents, reports, workbooks and folders that were moved or deleted outside the app. Records are never removed." />
        <div style={{ padding: 16 }} className="flex gap-2">
          <Button loading={checking} onClick={async () => { setChecking(true); try { const r = await act(() => api<any>('doc.checkIntegrity')); if (r) toast(r.missingDocuments.length + r.missingReports.length + r.missingExcel.length + r.missingCompanyFolders.length ? 'error' : 'success', `${r.checked} items checked · ${r.missingDocuments.length} document(s), ${r.missingReports.length} report(s), ${r.missingExcel.length} workbook(s), ${r.missingCompanyFolders.length} folder(s) missing`); } finally { setChecking(false); } }}>Check files now</Button>
          <Button icon={<ScrollText size={14} />} onClick={() => act(() => api('system.openLog'))}>Open log file</Button>
        </div>
      </Card>
    </div>
  );
}

export function SettingsScreen({ focus }: { focus: NavTarget }) {
  const { settings, reloadSettings, toast } = useApp();
  const [tab, setTab] = useState<Tab>((focus.tab as Tab) || 'general');
  const [list, setList] = useState<'activities' | 'testTypes' | 'formulas'>('activities');
  const save = async (p: Partial<AppSettings>) => {
    try {
      await api('settings.save', p);
      await reloadSettings();
      toast('success', 'Settings saved');
    } catch (e) {
      toast('error', errMsg(e));
    }
  };
  useEffect(() => void reloadSettings(), [reloadSettings]);
  return (
    <div>
      <PageHeader title="Settings" subtitle="Storage, folder structure, backups and configurable lists." />
      <div style={{ padding: '12px 28px 0' }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'general', label: 'General' }, { id: 'folders', label: 'Folder structure' }, { id: 'backup', label: 'Backup & restore' }, { id: 'lists', label: 'Lists & formulas' }, { id: 'system', label: 'System' }]} />
      </div>
      <Page>
        {!settings ? null : tab === 'general' ? (
          <General key={JSON.stringify([settings.storageRoot, settings.excelHeaderTitle])} s={settings} save={save} />
        ) : tab === 'folders' ? (
          <FolderLists s={settings} save={save} />
        ) : tab === 'backup' ? (
          <Backups s={settings} save={save} />
        ) : tab === 'lists' ? (
          <>
            <div style={{ marginBottom: 12 }}>
              <Segmented value={list} onChange={setList} options={[{ id: 'activities', label: 'Work activities' }, { id: 'testTypes', label: 'Test types' }, { id: 'formulas', label: 'Quantity formulas' }]} />
            </div>
            <ModuleScreen key={list} moduleId={list} />
          </>
        ) : (
          <SystemInfo />
        )}
      </Page>
    </div>
  );
}
void Upload;
