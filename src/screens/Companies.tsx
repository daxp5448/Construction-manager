import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  FolderPlus,
  FolderTree,
  ListPlus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Wrench,
  FileText,
  Building2,
} from 'lucide-react';
import { api, errMsg, useAsync, useDebounced } from '../lib/api';
import { NavTarget, useApp, useAction } from '../lib/ctx';
import { CompanyField, CompanyRecord, GenerateResult } from '../types';
import { Button, Card, CardHead, Chip, EmptyState, KeyValue, Note, Page, PageHeader, Segmented, Tabs } from '../ui/base';
import { Field, Input, TextArea } from '../ui/inputs';
import { Drawer, Modal } from '../ui/overlay';
import { DataTable } from '../ui/table';
import { formatDateTime } from '../shared/num';
import { DocsPanel, HistoryPanel } from './Panels';

/** "Field: Value" lines -> fields. The FIRST colon separates the name; later colons stay in the value. Lines without a colon are kept as notes. */
export function parseFieldLines(text: string): { fields: CompanyField[]; leftovers: string[] } {
  const fields: CompanyField[] = [];
  const leftovers: string[] = [];
  text.split('\n').forEach((line, index) => {
    const t = line.trim();
    if (!t) return;
    const c = t.indexOf(':');
    if (c > 0) fields.push({ id: `field_${index}_${Date.now()}`, name: t.slice(0, c).trim(), value: t.slice(c + 1).trim() });
    else leftovers.push(t);
  });
  return { fields, leftovers };
}

const SAMPLES: Record<string, { name: string; text: string; notes: string }> = {
  contractor: {
    name: 'Sample Road Contractors',
    text: 'Owner Name: \nContact Number: \nEmail: \nGST Number: \nOffice Address: \nProject Name: \nWork Type: Road construction\nPayment Terms: ',
    notes: '',
  },
  minimal: { name: '', text: 'Owner Name: \nContact Number: \nGST Number: ', notes: '' },
};

// ================================================================== screen
export function CompaniesScreen({ focus }: { focus: NavTarget }) {
  const { go, reloadCompanies, toast } = useApp();
  const [tab, setTab] = useState<'list' | 'create'>(focus.params?.create ? 'create' : 'list');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [openId, setOpenId] = useState<string | null>(focus.openId ?? null);

  return (
    <div>
      <PageHeader
        title="Companies"
        subtitle="Each company has its own folder and Excel workbook. Enter the information once — folders, workbook and database record are created together."
        actions={
          tab === 'list' ? (
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setTab('create')}>
              New company
            </Button>
          ) : (
            <Button onClick={() => setTab('list')}>Back to list</Button>
          )
        }
      />
      <Page>
        {tab === 'create' ? (
          <CreateCompany
            onDone={(r) => {
              setResult(r);
              reloadCompanies();
            }}
          />
        ) : (
          <CompanyList onOpen={setOpenId} onCreate={() => setTab('create')} />
        )}
      </Page>

      {result?.company && (
        <Modal
          title="Company created"
          width={580}
          onClose={() => setResult(null)}
          footer={
            <>
              <Button
                onClick={() => {
                  setResult(null);
                  setTab('create');
                }}
              >
                Create another
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const id = result.company!.id;
                  setResult(null);
                  setTab('list');
                  setOpenId(id);
                }}
              >
                View company
              </Button>
            </>
          }
        >
          <div className="note note-good" style={{ alignItems: 'center' }}>
            <Check size={18} />
            <div>
              <b>{result.company.name}</b> is ready — {result.fieldCount} field{result.fieldCount === 1 ? '' : 's'} saved, folders created and the Excel workbook generated.
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            <PathRow icon={<FileSpreadsheet size={16} color="var(--good)" />} label="Excel workbook" path={result.excelPath!} actionLabel="Open Excel" onOpen={() => api('system.openPath', { path: result.excelPath }).catch((e) => toast('error', errMsg(e)))} />
            <PathRow icon={<FolderOpen size={16} color="var(--brand)" />} label="Company folder" path={result.folderPath!} actionLabel="Open folder" onOpen={() => api('system.openPath', { path: result.folderPath }).catch((e) => toast('error', errMsg(e)))} />
          </div>
          <div style={{ marginTop: 14, color: 'var(--ink-3)', fontSize: 12.5 }}>
            Next: add a <button className="btn btn-sm" onClick={() => (setResult(null), go({ screen: 'projects', params: { create: true } }))}>project</button> for this company.
          </div>
        </Modal>
      )}

      {openId && <CompanyDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function PathRow({ icon, label, path, actionLabel, onOpen }: { icon: React.ReactNode; label: string; path: string; actionLabel: string; onOpen: () => void }) {
  return (
    <div className="flex items-center gap-3 card" style={{ padding: '10px 12px' }}>
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow">{label}</div>
        <div className="mono" data-selectable style={{ wordBreak: 'break-all' }}>
          {path}
        </div>
      </div>
      <Button size="sm" icon={<ExternalLink size={12} />} onClick={onOpen}>
        {actionLabel}
      </Button>
    </div>
  );
}

// ================================================================== list
function CompanyList({ onOpen, onCreate }: { onOpen: (id: string) => void; onCreate: () => void }) {
  const { reloadCompanies, confirm, dataVersion, bump, toast } = useApp();
  const act = useAction();
  const [search, setSearch] = useState('');
  const dq = useDebounced(search, 220);
  const [archived, setArchived] = useState(false);
  const list = useAsync(() => api<CompanyRecord[]>('company.list', { search: dq || undefined, archived }), [dq, archived, dataVersion]);

  const remove = async (c: CompanyRecord) => {
    const purge = await confirm({
      title: `Archive “${c.name}”?`,
      body: (
        <div style={{ display: 'grid', gap: 10 }}>
          <div>The company is hidden from lists and pickers but its folder, Excel file and all history are kept. You can restore it at any time.</div>
          <div style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>Permanent deletion (only possible for a company with no projects or transactions) is available from the company’s page.</div>
        </div>
      ),
      confirmLabel: 'Archive company',
    });
    if (!purge) return;
    const r = await act(() => api<any>('company.delete', { id: c.id, deleteFiles: false }), 'Company archived');
    if (r) (reloadCompanies(), bump());
  };

  return (
    <>
      <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
        <div style={{ position: 'relative', width: 320 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--ink-4)' }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, owner, contact, GST, project…" style={{ paddingLeft: 30 }} aria-label="Search companies" />
        </div>
        <Segmented value={archived ? 'archived' : 'active'} onChange={(v) => setArchived(v === 'archived')} options={[{ id: 'active', label: 'Active' }, { id: 'archived', label: 'Archived' }]} />
        <div style={{ flex: 1 }} />
        <Button iconOnly aria-label="Refresh" icon={<RefreshCw size={14} className={list.loading ? 'spin' : undefined} />} onClick={list.reload} />
      </div>
      <DataTable
        rows={list.data}
        loading={list.loading}
        error={list.error}
        onRetry={list.reload}
        onRowClick={(c) => onOpen(c.id)}
        empty={
          <EmptyState icon={<Building2 size={22} />} title={dq ? 'No matching companies' : archived ? 'No archived companies' : 'No companies yet'} action={!dq && !archived ? <Button variant="primary" icon={<Plus size={14} />} onClick={onCreate}>Create your first company</Button> : undefined}>
            {dq ? 'Try a different search term.' : archived ? 'Archived companies appear here and can be restored.' : 'Create a company to generate its folder structure and Excel workbook.'}
          </EmptyState>
        }
        columns={[
          { key: 'name', header: 'Company', render: (c) => <span style={{ fontWeight: 600 }}>{c.name}</span> },
          { key: 'ownerName', header: 'Owner / contact', render: (c) => c.ownerName ?? <span style={{ color: 'var(--ink-4)' }}>—</span> },
          { key: 'contactNumber', header: 'Phone', mono: true, render: (c) => c.contactNumber ?? '—' },
          { key: 'gstNumber', header: 'GST', mono: true, render: (c) => c.gstNumber ?? '—' },
          { key: 'fields', header: 'Fields', align: 'r', render: (c) => c.fields.length },
          { key: 'updatedAt', header: 'Updated', muted: true, render: (c) => formatDateTime(c.updatedAt.slice(0, 16)) },
          {
            key: 'act',
            header: '',
            render: (c) => (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" icon={<FileSpreadsheet size={12} />} onClick={() => api('system.openPath', { path: c.excelPath }).catch((e) => toast('error', errMsg(e)))}>Excel</Button>
                <Button size="sm" icon={<FolderOpen size={12} />} onClick={() => api('system.openPath', { path: c.folderPath }).catch((e) => toast('error', errMsg(e)))}>Folder</Button>
                {archived ? (
                  <Button size="sm" icon={<RotateCcw size={12} />} onClick={async () => (await act(() => api('company.restore', { id: c.id }), 'Company restored'), reloadCompanies(), bump())}>Restore</Button>
                ) : (
                  <Button size="sm" variant="ghost" iconOnly aria-label="Archive" title="Archive" icon={<Archive size={13} />} onClick={() => remove(c)} />
                )}
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

// ================================================================== create
function CreateCompany({ onDone }: { onDone: (r: GenerateResult) => void }) {
  const { settings } = useApp();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'text' | 'fields'>('text');
  const [raw, setRaw] = useState('');
  const [rows, setRows] = useState<CompanyField[]>([{ id: '1', name: '', value: '' }]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const toText = () => {
    const filled = rows.filter((f) => f.name.trim() || f.value.trim());
    if (filled.length) setRaw(filled.map((f) => `${f.name}: ${f.value}`).join('\n'));
    setMode('text');
  };
  const toFields = () => {
    const { fields, leftovers } = parseFieldLines(raw);
    if (leftovers.length) setNotes((n) => (n ? `${n}\n${leftovers.join('\n')}` : leftovers.join('\n')));
    setRows(fields.length ? fields : [{ id: '1', name: '', value: '' }]);
    setMode('fields');
  };
  const load = (k: keyof typeof SAMPLES | 'blank') => {
    setError(null);
    if (k === 'blank') {
      setName('');
      setRaw('');
      setRows([{ id: '1', name: '', value: '' }]);
      setNotes('');
      nameRef.current?.focus();
      return;
    }
    const s = SAMPLES[k];
    setName(s.name);
    setRaw(s.text);
    setRows(parseFieldLines(s.text).fields);
    setNotes(s.notes);
  };

  const generate = async () => {
    if (busy) return;
    const n = name.trim();
    if (!n) {
      setError('Please enter a Company Name to continue.');
      nameRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      let fields: CompanyField[];
      let extraNotes = notes.trim();
      if (mode === 'text') {
        const p = parseFieldLines(raw);
        fields = p.fields.filter((f) => f.name);
        if (p.leftovers.length) extraNotes = [extraNotes, ...p.leftovers].filter(Boolean).join('\n');
      } else fields = rows.filter((f) => f.name.trim());
      const res = await api<GenerateResult>('company.create', { name: n, fields, notes: extraNotes });
      if (!res.success) {
        setError(res.error || 'Failed to generate company records.');
        return;
      }
      onDone(res);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const count = mode === 'text' ? parseFieldLines(raw).fields.length : rows.filter((f) => f.name.trim()).length;
  const safeName = name.trim().replace(/[\\/:*?"<>|]/g, '_') || 'Company_Name';

  return (
    <div onKeyDown={(e) => e.ctrlKey && e.key === 'Enter' && (e.preventDefault(), generate())} style={{ maxWidth: 920 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <span className="chip chip-brand">
          <Sparkles size={12} /> Enter information → press Enter → get Excel + folders
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => load('contractor')}>Fill sample fields</Button>
          <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={() => load('blank')}>Clear</Button>
        </div>
      </div>
      {error && (
        <div style={{ marginBottom: 12 }}>
          <Note tone="bad">{error}</Note>
        </div>
      )}
      <Card style={{ padding: 18, marginBottom: 14 }}>
        <Field label="Company name" required help="The folder and the Excel workbook are named after this.">
          <input
            ref={nameRef}
            className="input"
            style={{ height: 42, fontSize: 17, fontWeight: 600 }}
            value={name}
            placeholder="e.g. Shree Road Constructions"
            onChange={(e) => (setName(e.target.value), error && setError(null))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!name.trim()) return setError('Please enter a Company Name.');
                if (mode === 'text' && raw.trim()) generate();
                else textRef.current?.focus();
              }
            }}
          />
        </Field>
      </Card>

      <Card style={{ marginBottom: 14 }}>
        <CardHead
          title={
            <span className="flex items-center gap-2">
              Company information <Chip tone="neutral" dot={false}>{count} fields</Chip>
            </span>
          }
          subtitle={<span>Paste lines as <span className="mono" style={{ background: 'var(--sunk)', padding: '1px 5px', borderRadius: 4 }}>Field: Value</span>, or fill one row per field.</span>}
          actions={
            <Segmented
              value={mode}
              onChange={(m) => (m === 'text' ? toText() : toFields())}
              options={[
                { id: 'text', label: 'Smart text' },
                { id: 'fields', label: 'Field by field' },
              ]}
            />
          }
        />
        <div style={{ padding: 16 }}>
          {mode === 'text' ? (
            <>
              <textarea ref={textRef} className="textarea mono" style={{ fontSize: 13, minHeight: 190, lineHeight: 1.6 }} rows={9} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={'Owner Name: \nContact Number: \nEmail: \nGST Number: \nOffice Address: \nProject Name: '} />
              <div className="flex items-center gap-4" style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 12 }}>
                <span><span className="kbd">Shift</span>+<span className="kbd">Enter</span> new line</span>
                <span><span className="kbd">Ctrl</span>+<span className="kbd">Enter</span> generate now</span>
                <span style={{ marginLeft: 'auto' }}>The first colon splits the name from the value; blank lines are ignored.</span>
              </div>
            </>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {rows.map((r, i) => (
                <div key={r.id} className="flex items-center gap-2">
                  <span className="mono" style={{ width: 22, color: 'var(--ink-4)', textAlign: 'center' }}>{i + 1}</span>
                  <Input style={{ width: '32%', fontWeight: 500 }} value={r.name} placeholder="Field name (e.g. Owner Name)" onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))} />
                  <Input value={r.value} placeholder="Value" onChange={(e) => setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, value: e.target.value } : x)))} />
                  <Button variant="ghost" size="sm" iconOnly aria-label="Remove field" icon={<Trash2 size={14} />} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.id !== r.id) : rs))} />
                </div>
              ))}
              <div>
                <Button size="sm" icon={<ListPlus size={13} />} onClick={() => setRows((rs) => [...rs, { id: `c_${Date.now()}_${Math.random()}`, name: '', value: '' }])}>
                  Add field
                </Button>
              </div>
            </div>
          )}
          <Field label="Additional notes (optional)" style={{ marginTop: 14 }}>
            <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Remarks, compliance details, references…" />
          </Field>
        </div>
      </Card>

      <Card style={{ padding: 14, marginBottom: 16, background: '#fbf9f4' }}>
        <div className="flex items-start gap-3">
          <FolderTree size={18} color="var(--brand)" style={{ marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>What will be created</div>
            <div className="mono" data-selectable style={{ color: 'var(--ink-2)', wordBreak: 'break-all', margin: '3px 0' }}>
              {settings?.storageRoot ?? 'Documents\\Construction Company Records'}\<b style={{ color: 'var(--brand-strong)' }}>{name.trim() || 'Company Name'}</b>\01_Company_Information\<b style={{ color: 'var(--good)' }}>{safeName}_Details.xlsx</b>
            </div>
            <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              {(settings?.folderTemplate ?? []).join('  ·  ')}
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
          <span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> anytime
        </span>
        <Button variant="primary" size="lg" loading={busy} icon={<FileSpreadsheet size={16} />} onClick={generate}>
          Generate Excel & create folders
        </Button>
      </div>
    </div>
  );
}

// ================================================================== details
function CompanyDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { confirm, reloadCompanies, bump, toast, saveConfirmed } = useApp();
  void saveConfirmed;
  const act = useAction();
  const co = useAsync(() => api<CompanyRecord | null>('company.get', { id }), [id]);
  const stats = useAsync(() => api<any>('dashboard.get', { companyId: id }), [id]);
  const [tab, setTab] = useState<'overview' | 'documents' | 'history'>('overview');
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState('');
  const [rows, setRows] = useState<CompanyField[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = co.data;

  const begin = () => {
    if (!c) return;
    setName(c.name);
    setRows(c.fields.map((f) => ({ ...f })));
    setNotes(c.notes ?? '');
    setError(null);
    setEdit(true);
  };

  const save = async () => {
    if (!c) return;
    if (!name.trim()) return setError('Company name is required.');
    setBusy(true);
    setError(null);
    try {
      const r = await api<GenerateResult>('company.update', { id: c.id, name: name.trim(), fields: rows.filter((f) => f.name.trim()), notes });
      if (!r.success) return setError(r.error ?? 'Could not save');
      toast('success', 'Saved. The previous Excel version was backed up automatically.');
      setEdit(false);
      co.reload();
      reloadCompanies();
      bump();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    if (!c) return;
    const ok = await confirm({
      title: 'Permanently delete this company?',
      tone: 'danger',
      confirmLabel: 'Delete permanently',
      lines: ['This removes the database record AND its entire folder on disk, including every file inside it. This cannot be undone.'],
      body: <div style={{ marginTop: 10, color: 'var(--ink-3)' }}>Companies that own projects, purchases or other records cannot be deleted — archive them instead.</div>,
    });
    if (!ok) return;
    const r = await act(() => api<any>('company.delete', { id: c.id, deleteFiles: true }));
    if (r?.success) {
      toast('success', 'Company deleted');
      reloadCompanies();
      bump();
      onClose();
    } else if (r) toast('error', r.error ?? 'Could not delete');
  };

  return (
    <Drawer
      title={c?.name ?? 'Company'}
      subtitle={c ? `Created ${formatDateTime(c.createdAt.slice(0, 16))}` : undefined}
      onClose={onClose}
      headerExtra={
        c && !edit ? (
          <Button icon={<Pencil size={13} />} onClick={begin}>
            Edit
          </Button>
        ) : undefined
      }
    >
      {co.error && <Note tone="bad">{co.error}</Note>}
      {c && (
        <>
          <div style={{ margin: '-20px -20px 18px', padding: '0 20px', background: 'var(--surface)', borderBottom: '1px solid var(--line)' }}>
            <Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'documents', label: 'Documents' }, { id: 'history', label: 'History' }]} value={tab} onChange={setTab} />
          </div>
          {tab === 'documents' && <DocsPanel entityType="company" entityId={c.id} defaultDocType="agreement" companyId={c.id} />}
          {tab === 'history' && <HistoryPanel entityType="company" entityId={c.id} />}
          {tab === 'overview' && !edit && (
            <div style={{ display: 'grid', gap: 14 }}>
              <div className="flex items-center gap-2 flex-wrap">
                <Button icon={<FileSpreadsheet size={14} />} onClick={() => api('system.openPath', { path: c.excelPath }).catch((e) => toast('error', errMsg(e)))}>Open Excel</Button>
                <Button icon={<FolderOpen size={14} />} onClick={() => api('system.openPath', { path: c.folderPath }).catch((e) => toast('error', errMsg(e)))}>Open folder</Button>
                <Button icon={<RefreshCw size={14} />} onClick={() => act(() => api('company.regenerateExcel', { id: c.id }), 'Excel regenerated (previous version backed up)')}>Re-export Excel</Button>
                <Button icon={<Wrench size={14} />} onClick={async () => { const r = await act(() => api<any>('company.repairFolders', { id: c.id })); if (r) toast('success', r.created.length ? `Re-created ${r.created.length} missing folder(s).` : 'All folders are present.'); }}>Check folders</Button>
              </div>
              {stats.data && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                  {[
                    ['Active projects', stats.data.totals.active_projects],
                    ['Purchases', stats.data.totals.purchases_count],
                    ['Stock value', `₹ ${(stats.data.stock_value_paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`],
                    ['Outstanding', `₹ ${(stats.data.outstanding_paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`],
                  ].map(([k, v]) => (
                    <div key={String(k)} className="card" style={{ padding: '10px 12px' }}>
                      <div className="eyebrow">{k}</div>
                      <div className="num" style={{ fontSize: 17, fontWeight: 600, marginTop: 2 }}>{v}</div>
                    </div>
                  ))}
                </div>
              )}
              <Card>
                <CardHead title="Recorded information" />
                <div style={{ padding: 16 }}>
                  <KeyValue cols={2} items={[['Company name', c.name], ...c.fields.map((f) => [f.name, f.value] as [string, string]), ...(c.notes ? ([['Notes', <span style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</span>]] as Array<[string, React.ReactNode]>) : [])]} />
                </div>
              </Card>
              <Card>
                <CardHead title="Location on disk" />
                <div style={{ padding: 16 }}>
                  <KeyValue cols={1} items={[['Company folder', <span className="mono" style={{ wordBreak: 'break-all' }}>{c.folderPath}</span>], ['Excel workbook', <span className="mono" style={{ wordBreak: 'break-all' }}>{c.excelPath}</span>], ['Last updated', formatDateTime(c.updatedAt.slice(0, 16))]]} />
                </div>
              </Card>
              <div>
                <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={purge}>
                  Delete permanently…
                </Button>
              </div>
            </div>
          )}
          {tab === 'overview' && edit && (
            <div style={{ display: 'grid', gap: 14 }}>
              {error && <Note tone="bad">{error}</Note>}
              <Note tone="info">Saving re-generates the Excel workbook. The previous workbook is copied to a time-stamped backup first, so nothing is lost.</Note>
              <Field label="Company name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <div>
                <div className="field-label">Fields</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {rows.map((r, i) => (
                    <div key={r.id} className="flex items-center gap-2">
                      <Input style={{ width: '32%', fontWeight: 500 }} value={r.name} placeholder="Field name" onChange={(e) => setRows((rs) => rs.map((x, j) => (i === j ? { ...x, name: e.target.value } : x)))} />
                      <Input value={r.value} placeholder="Value" onChange={(e) => setRows((rs) => rs.map((x, j) => (i === j ? { ...x, value: e.target.value } : x)))} />
                      <Button variant="ghost" size="sm" iconOnly aria-label="Remove field" icon={<Trash2 size={14} />} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
                    </div>
                  ))}
                  <div>
                    <Button size="sm" icon={<Plus size={13} />} onClick={() => setRows((rs) => [...rs, { id: `n_${Date.now()}`, name: '', value: '' }])}>Add field</Button>
                  </div>
                </div>
              </div>
              <Field label="Notes">
                <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setEdit(false)}>Cancel</Button>
                <Button variant="primary" loading={busy} onClick={save}>Save & re-export</Button>
              </div>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
void FolderPlus; void FileText; void useMemo;
