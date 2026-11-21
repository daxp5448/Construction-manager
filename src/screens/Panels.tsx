import React, { useState } from 'react';
import { AlertTriangle, ExternalLink, FileText, FolderOpen, Paperclip, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { api, useAsync } from '../lib/api';
import { useAction, useApp } from '../lib/ctx';
import { Button, Chip, EmptyState, ErrorState, Note, Skeleton, StatusChip } from '../ui/base';
import { Select } from '../ui/inputs';
import { Modal } from '../ui/overlay';
import { TextArea } from '../ui/inputs';
import { formatDate, formatDateTime } from '../shared/num';

export interface DocType {
  value: string;
  label: string;
}

export function useDocTypes() {
  return useAsync(() => api<DocType[]>('doc.types'), []).data ?? [];
}

const bytes = (n: number | null) => (n === null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Documents attached to one record, with attach / open / verify / remove. */
export function DocsPanel({ entityType, entityId, defaultDocType, companyId, allowedTypes }: { entityType: string; entityId: string; defaultDocType: string; companyId?: string | null; allowedTypes?: string[] }) {
  const { toast, confirm, bump } = useApp();
  const act = useAction();
  const types = useDocTypes();
  const [docType, setDocType] = useState(defaultDocType);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState<any | null>(null);
  const list = useAsync(() => api<{ rows: any[]; total: number }>('doc.list', { entityType, entityId }), [entityType, entityId]);
  const typeOptions = types.filter((t) => !allowedTypes || allowedTypes.includes(t.value) || t.value === defaultDocType);

  const attach = async () => {
    setBusy(true);
    try {
      const r = await act(() => api<any>('doc.attach', { entityType, entityId, docType, companyId: companyId ?? undefined }));
      if (r && !r.cancelled) {
        if (r.attached.length) toast('success', `${r.attached.length} document${r.attached.length > 1 ? 's' : ''} attached and filed in the record folder.`);
        if (r.skipped.length) toast('info', r.skipped.join('\n'));
        list.reload();
        bump();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-end gap-2" style={{ marginBottom: 12 }}>
        <div style={{ width: 280 }}>
          <label className="field-label">Document type</label>
          <Select value={docType} onChange={setDocType} options={typeOptions.map((t) => ({ value: t.value, label: t.label }))} />
        </div>
        <Button variant="primary" icon={<Upload size={14} />} loading={busy} onClick={attach}>
          Attach file(s)…
        </Button>
        <div style={{ color: 'var(--ink-3)', fontSize: 12, paddingBottom: 8 }}>A copy is filed into the record’s folder; your original stays where it is.</div>
      </div>
      {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
      {!list.data && list.loading && <Skeleton h={48} />}
      {list.data && list.data.rows.length === 0 && (
        <div className="card">
          <EmptyState icon={<Paperclip size={20} />} title="No documents attached">
            Attach scans, PDFs or photos (invoices, slips, passes, reports) so they stay with this record.
          </EmptyState>
        </div>
      )}
      {list.data && list.data.rows.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {list.data.rows.map((d, i) => (
            <div key={d.id} className="flex items-center gap-3" style={{ padding: '10px 14px', borderTop: i ? '1px solid var(--line-soft)' : 0 }}>
              <FileText size={18} color="var(--ink-3)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || d.file_name}</div>
                <div style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>
                  {types.find((t) => t.value === d.doc_type)?.label ?? d.doc_type} · {bytes(d.size_bytes)} · added {formatDate(d.created_at)}
                </div>
              </div>
              {d.is_missing ? (
                <Chip tone="bad">File missing</Chip>
              ) : (
                <StatusChip value={d.verification_status} />
              )}
              <Button size="sm" iconOnly aria-label="Open" title="Open" icon={<ExternalLink size={13} />} disabled={!!d.is_missing} onClick={() => act(() => api('doc.open', { id: d.id }))} />
              <Button size="sm" iconOnly aria-label="Show in folder" title="Show in folder" icon={<FolderOpen size={13} />} onClick={() => act(() => api('doc.reveal', { id: d.id }))} />
              <Button size="sm" iconOnly aria-label="Verification" title="Record verification" icon={<ShieldCheck size={13} />} onClick={() => setVerifying(d)} />
              <Button
                size="sm"
                iconOnly
                aria-label="Remove"
                title="Remove from this record"
                variant="danger"
                icon={<Trash2 size={13} />}
                onClick={async () => {
                  if (await confirm({ title: 'Remove this document?', body: <span>“{d.file_name}” will be detached from this record. The file itself stays in your folder.</span>, confirmLabel: 'Remove', tone: 'danger' })) {
                    await act(() => api('doc.remove', { id: d.id }), 'Document removed');
                    list.reload();
                  }
                }}
              />
            </div>
          ))}
        </div>
      )}
      {verifying && <VerifyModal doc={verifying} onClose={() => setVerifying(null)} onDone={() => (setVerifying(null), list.reload())} />}
    </div>
  );
}

export function VerifyModal({ doc, onClose, onDone }: { doc: any; onClose: () => void; onDone: () => void }) {
  const act = useAction();
  const [status, setStatus] = useState<'unverified' | 'verified' | 'rejected'>(doc.verification_status);
  const [notes, setNotes] = useState(doc.verification_notes ?? '');
  return (
    <Modal
      title="Document verification"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              const r = await act(() => api('doc.verify', { id: doc.id, status, notes }), 'Verification recorded');
              if (r) onDone();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <Note tone="info">Verification is a manual record of your own check. The application does not contact any government system.</Note>
      <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
        <div>
          <label className="field-label">Status</label>
          <Select
            value={status}
            onChange={(v) => setStatus(v as any)}
            options={[
              { value: 'unverified', label: 'Not verified' },
              { value: 'verified', label: 'Verified by me' },
              { value: 'rejected', label: 'Rejected / not valid' },
            ]}
          />
        </div>
        <div>
          <label className="field-label">How it was verified (optional)</label>
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Compared with the original pass, checked on the official portal on 12-Nov…" />
        </div>
      </div>
    </Modal>
  );
}

const ACTION_LABEL: Record<string, string> = { create: 'Created', update: 'Edited', delete: 'Archived', restore: 'Restored', cancel: 'Cancelled', revise: 'Revised', void: 'Voided', verify: 'Verified', archive: 'Archived', purge: 'Deleted', relocate: 'Relocated' };

export function HistoryPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const h = useAsync(() => api<any[]>('crud.history', { entityType, entityId }), [entityType, entityId]);
  if (h.error) return <ErrorState message={h.error} onRetry={h.reload} />;
  if (!h.data) return <Skeleton h={60} />;
  if (!h.data.length) return <div className="card"><EmptyState title="No history yet" /></div>;
  return (
    <div className="card" data-selectable>
      {h.data.map((e, i) => (
        <div key={e.id} style={{ padding: '10px 14px', borderTop: i ? '1px solid var(--line-soft)' : 0 }}>
          <div className="flex items-center gap-2">
            <Chip tone={e.action === 'create' ? 'good' : e.action === 'delete' || e.action === 'cancel' || e.action === 'void' ? 'bad' : 'info'}>{ACTION_LABEL[e.action] ?? e.action}</Chip>
            <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{formatDateTime(String(e.at).replace('Z', '').slice(0, 16))} · {e.actor}</span>
          </div>
          {e.summary && <div style={{ marginTop: 4, color: 'var(--ink-2)', wordBreak: 'break-word' }}>{e.summary}</div>}
          {e.reason && <div style={{ marginTop: 2, fontStyle: 'italic', color: 'var(--ink-3)' }}>Reason: {e.reason}</div>}
        </div>
      ))}
    </div>
  );
}

export function WarnList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((w, i) => (
        <div key={i} className="note note-warn">
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          {w}
        </div>
      ))}
    </div>
  );
}
