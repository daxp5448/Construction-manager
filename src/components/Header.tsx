import React from 'react';
import { Folder, Search } from 'lucide-react';
import { useApp } from '../lib/ctx';
import { RefSelect } from '../ui/inputs';
import { formatDate, todayISO } from '../shared/num';

/** Workspace bar: global search + the active company / project that every register defaults to. */
export const Header: React.FC<{ onOpenSearch: () => void; onOpenStorage: () => void }> = ({ onOpenSearch, onOpenStorage }) => {
  const { scope, setScope, settings } = useApp();
  return (
    <header className="flex items-center gap-3" style={{ height: 52, padding: '0 20px 0 24px', background: 'var(--surface)', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
      <button onClick={onOpenSearch} aria-label="Search everything (Ctrl+K)" className="flex items-center gap-2" style={{ width: 340, height: 33, padding: '0 10px', border: '1px solid var(--line-strong)', borderRadius: 8, background: '#faf8f3', color: 'var(--ink-3)', cursor: 'pointer', textAlign: 'left' }}>
        <Search size={15} />
        <span style={{ flex: 1 }}>Search everything…</span>
        <span className="kbd">Ctrl K</span>
      </button>
      <div style={{ flex: 1 }} />
      <div className="flex items-center gap-2" role="group" aria-label="Working scope">
        <span className="eyebrow">Working on</span>
        <div style={{ width: 200 }}>
          <RefSelect refKind="company" value={scope.companyId} placeholder="All companies" onChange={(id) => setScope({ companyId: id })} />
        </div>
        <div style={{ width: 220 }}>
          <RefSelect refKind="project" value={scope.projectId} placeholder="All projects" parentColumn="company_id" parentValue={scope.companyId} onChange={(id) => setScope({ projectId: id })} includeInactive />
        </div>
      </div>
      <div style={{ width: 1, height: 22, background: 'var(--line)' }} />
      {settings?.storageRoot && (
        <button onClick={onOpenStorage} title={settings.storageRoot} className="btn btn-ghost btn-sm" style={{ maxWidth: 190 }}>
          <Folder size={14} color="var(--brand)" />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{settings.storageRoot.split(/[\\/]/).filter(Boolean).pop()}</span>
        </button>
      )}
      <span className="num" style={{ color: 'var(--ink-3)', fontSize: 12 }}>
        {formatDate(todayISO())}
      </span>
    </header>
  );
};
