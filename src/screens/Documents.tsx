import React, { useEffect, useState } from 'react';
import { ExternalLink, FileSearch, FileText, FolderOpen, Paperclip, RefreshCw, Search, ShieldCheck, Upload } from 'lucide-react';
import { api, errMsg, useAsync, useDebounced } from '../lib/api';
import { NavTarget, entityTarget, useAction, useApp } from '../lib/ctx';
import { Button, Card, Chip, EmptyState, Note, Page, PageHeader, StatusChip } from '../ui/base';
import { Checkbox, Field, Input, Select } from '../ui/inputs';
import { Modal } from '../ui/overlay';
import { DataTable } from '../ui/table';
import { formatDate } from '../shared/num';
import { DocType, VerifyModal } from './Panels';

const ENTITY_LABEL: Record<string, string> = { company: 'Company', project: 'Project', supplier: 'Supplier', purchase: 'Purchase', receipt: 'Inward', invoice: 'Invoice', payment: 'Payment', royalty: 'Royalty pass', quality: 'Test', measurement: 'Measurement', progress: 'Daily entry', consumption: 'Consumption' };

function AttachModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { scope, toast } = useApp();
  const act = useAction();
  const types = useAsync(() => api<DocType[]>('doc.types'), []).data ?? [];
  const [entityType, setEntityType] = useState('company');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [hits, setHits] = useState<any[]>([]);
  const [target, setTarget] = useState<any | null>(null);
  const [docType, setDocType] = useState('other');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!dq.trim()) return setHits([]);
    api<any[]>('search.query', { q: dq, types: [entityType], limit: 12 }).then(setHits).catch(() => setHits([]));
  }, [dq, entityType]);

  const attach = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const r = await act(() => api<any>('doc.attach', { entityType, entityId: target.entityId, docType, companyId: target.companyId ?? scope.companyId ?? undefined }));
      if (r && !r.cancelled) {
        if (r.attached.length) toast('success', `${r.attached.length} document(s) attached.`);
        if (r.skipped.length) toast('info', r.skipped.join('\n'));
        onDone();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Add document" width={620} onClose={onClose} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon={<Upload size={14} />} disabled={!target} loading={busy} onClick={attach}>Choose file(s)…</Button></>}>
      <div style={{ display: 'grid', gap: 14 }}>
        <Note tone="info">Documents are attached to a record (company, project, supplier, purchase, delivery, invoice, royalty pass…). A copy is filed in that record’s folder.</Note>
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Attach to"><Select value={entityType} onChange={(v) => (setEntityType(v), setTarget(null), setQ(''))} options={Object.entries(ENTITY_LABEL).map(([value, label]) => ({ value, label }))} /></Field>
          <Field label="Document type"><Select value={docType} onChange={setDocType} options={types.map((t) => ({ value: t.value, label: t.label }))} /></Field>
        </div>
        <Field label={`Find the ${ENTITY_LABEL[entityType].toLowerCase()}`}>
          <Input value={q} onChange={(e) => (setQ(e.target.value), setTarget(null))} placeholder="Type part of its name or number…" />
        </Field>
        {target ? (
          <div className="note note-good"><ShieldCheck size={16} /> <div><b>{target.title}</b><div style={{ fontSize: 12 }}>{target.parent}</div></div></div>
        ) : (
          hits.length > 0 && (
            <div className="card" style={{ maxHeight: 200, overflow: 'auto' }}>
              {hits.map((h) => (
                <button key={h.entityId} className="menu-item" style={{ borderRadius: 0, padding: '8px 12px' }} onClick={() => setTarget(h)}>
                  <div style={{ fontWeight: 500 }}>{h.title}</div>
                  <div style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>{h.parent} {h.subtitle ? '· ' + h.subtitle : ''}</div>
                </button>
              ))}
            </div>
          )
        )}
      </div>
    </Modal>
  );
}

export function DocumentsScreen({ focus }: { focus: NavTarget }) {
  const { scope, dataVersion, go, confirm, bump, toast } = useApp();
  const act = useAction();
  const types = useAsync(() => api<DocType[]>('doc.types'), []).data ?? [];
  const [search, setSearch] = useState('');
  const dq = useDebounced(search, 250);
  const [docType, setDocType] = useState('');
  const [verification, setVerification] = useState('');
  const [missingOnly, setMissingOnly] = useState(!!focus.params?.missingOnly);
  const [adding, setAdding] = useState(false);
  const [verifying, setVerifying] = useState<any | null>(null);
  const [checking, setChecking] = useState(false);

  const q = { search: dq || undefined, companyId: scope.companyId ?? undefined, projectId: scope.projectId ?? undefined, docType: docType || undefined, verification: verification || undefined, missingOnly: missingOnly || undefined };
  const list = useAsync(() => api<{ rows: any[]; total: number }>('doc.list', { ...q, pageSize: 500 }), [JSON.stringify(q), dataVersion]);

  const check = async () => {
    setChecking(true);
    try {
      const r = await act(() => api<any>('doc.checkIntegrity'));
      if (r) {
        const n = r.missingDocuments.length + r.missingReports.length + r.missingCompanyFolders.length + r.missingExcel.length;
        toast(n ? 'error' : 'success', n ? `${n} item(s) could not be found on disk (records are kept). ${r.recovered ? r.recovered + ' recovered.' : ''}` : `All ${r.checked} files and folders were found.${r.recovered ? ' ' + r.recovered + ' previously-missing file(s) recovered.' : ''}`);
        list.reload();
        bump();
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Document Center"
        subtitle="Every scan, PDF and photo attached to your records, in one place. Files are filed in the structured folders; if one is moved or deleted outside the app the record stays and is flagged as missing."
        actions={<><Button icon={<FileSearch size={14} />} loading={checking} onClick={check}>Check files on disk</Button><Button variant="primary" icon={<Paperclip size={14} />} onClick={() => setAdding(true)}>Add document</Button></>}
      />
      <Page>
        <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 12 }}>
          <div style={{ position: 'relative', width: 280 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: 'var(--ink-4)' }} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="File name, record, notes…" style={{ paddingLeft: 30 }} aria-label="Search documents" />
          </div>
          <div style={{ width: 220 }}><Select value={docType} onChange={setDocType} options={types.map((t) => ({ value: t.value, label: t.label }))} placeholder="All document types" /></div>
          <div style={{ width: 160 }}><Select value={verification} onChange={setVerification} options={[{ value: 'unverified', label: 'Not verified' }, { value: 'verified', label: 'Verified' }, { value: 'rejected', label: 'Rejected' }]} placeholder="Any verification" /></div>
          <Checkbox checked={missingOnly} onChange={setMissingOnly} label={<span style={{ color: 'var(--ink-2)' }}>Missing files only</span>} />
          <div style={{ flex: 1 }} />
          <Button iconOnly aria-label="Refresh" icon={<RefreshCw size={14} className={list.loading ? 'spin' : undefined} />} onClick={list.reload} />
        </div>
        <DataTable
          rows={list.data?.rows ?? null}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          selectedId={focus.openId}
          empty={<EmptyState icon={<FileText size={22} />} title={missingOnly ? 'No missing files' : 'No documents yet'}>Attach documents from a record’s Documents tab, or use “Add document”.</EmptyState>}
          columns={[
            { key: 'file_name', header: 'File', render: (r) => <span className="flex items-center gap-2"><FileText size={14} color="var(--ink-3)" /><b>{r.title || r.file_name}</b></span> },
            { key: 'doc_type', header: 'Type', render: (r) => types.find((t) => t.value === r.doc_type)?.label ?? r.doc_type },
            { key: 'entity', header: 'Attached to', render: (r) => <button className="btn btn-ghost btn-sm" style={{ height: 'auto', padding: '2px 4px', textAlign: 'left' }} onClick={() => go(entityTarget(r.entity_type, r.entity_id))}>{r.entity_label ?? ENTITY_LABEL[r.entity_type] ?? r.entity_type}</button> },
            { key: 'company_name', header: 'Company', muted: true },
            { key: 'created_at', header: 'Added', muted: true, render: (r) => formatDate(String(r.created_at).slice(0, 10)) },
            { key: 'status', header: 'Status', render: (r) => (r.is_missing ? <Chip tone="bad">File missing</Chip> : <StatusChip value={r.verification_status} />) },
            {
              key: 'act',
              header: '',
              render: (r) => (
                <div className="flex gap-1">
                  <Button size="sm" iconOnly aria-label="Open" title="Open" icon={<ExternalLink size={13} />} disabled={!!r.is_missing} onClick={() => act(() => api('doc.open', { id: r.id }))} />
                  <Button size="sm" iconOnly aria-label="Show in folder" title="Show in folder" icon={<FolderOpen size={13} />} onClick={() => act(() => api('doc.reveal', { id: r.id }))} />
                  <Button size="sm" iconOnly aria-label="Verification" title="Record verification" icon={<ShieldCheck size={13} />} onClick={() => setVerifying(r)} />
                  {!!r.is_missing && (
                    <Button size="sm" onClick={async () => {
                      const ok = await confirm({ title: 'Replace the missing file?', body: <span>Choose the file to use in place of “{r.file_name}”. A copy is filed in the record’s folder.</span>, confirmLabel: 'Choose file…' });
                      if (ok) {
                        const res = await act(() => api<any>('doc.relocate', { id: r.id }));
                        if (res && !res.cancelled) (toast('success', 'File restored'), list.reload(), bump());
                      }
                    }}>Relink</Button>
                  )}
                </div>
              ),
            },
          ]}
        />
        {list.data && <div style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 12 }} className="num">{list.data.total} document{list.data.total === 1 ? '' : 's'}</div>}
      </Page>
      {adding && <AttachModal onClose={() => setAdding(false)} onDone={() => (setAdding(false), list.reload(), bump())} />}
      {verifying && <VerifyModal doc={verifying} onClose={() => setVerifying(null)} onDone={() => (setVerifying(null), list.reload())} />}
    </div>
  );
}
void errMsg; void Card;
