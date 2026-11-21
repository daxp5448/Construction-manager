import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { api, ApiFailure, errMsg } from './api';
import { AppSettings, CompanyRecord } from '../types';
import { Button } from '../ui/base';
import { Modal } from '../ui/overlay';
import { TextArea } from '../ui/inputs';

export type ScreenId =
  | 'dashboard'
  | 'companies'
  | 'projects'
  | 'materials'
  | 'suppliers'
  | 'purchases'
  | 'inward'
  | 'royalty'
  | 'inventory'
  | 'consumption'
  | 'billing'
  | 'quality'
  | 'measurement'
  | 'reports'
  | 'documents'
  | 'settings';

export interface NavTarget {
  screen: ScreenId;
  /** record to open when the screen mounts */
  openId?: string;
  tab?: string;
  params?: Record<string, any>;
}

/** Where each searchable entity lives in the UI */
export function entityTarget(entityType: string, id: string): NavTarget {
  switch (entityType) {
    case 'company':
      return { screen: 'companies', openId: id };
    case 'project':
      return { screen: 'projects', openId: id };
    case 'category':
      return { screen: 'materials', tab: 'categories', openId: id };
    case 'material':
      return { screen: 'materials', tab: 'materials', openId: id };
    case 'spec':
      return { screen: 'materials', tab: 'specs', openId: id };
    case 'supplier':
      return { screen: 'suppliers', openId: id };
    case 'purchase':
      return { screen: 'purchases', openId: id };
    case 'invoice':
      return { screen: 'billing', tab: 'invoices', openId: id };
    case 'payment':
      return { screen: 'billing', tab: 'payments', openId: id };
    case 'receipt':
      return { screen: 'inward', openId: id };
    case 'royalty':
      return { screen: 'royalty', tab: 'register', openId: id };
    case 'quality':
      return { screen: 'quality', openId: id };
    case 'measurement':
      return { screen: 'measurement', tab: 'mb', openId: id };
    case 'progress':
      return { screen: 'measurement', tab: 'progress', openId: id };
    case 'consumption':
      return { screen: 'consumption', tab: 'entries', openId: id };
    case 'document':
      return { screen: 'documents', openId: id };
    case 'report':
      return { screen: 'reports', tab: 'history', openId: id };
    default:
      return { screen: 'dashboard' };
  }
}

type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string };

interface ConfirmOpts {
  title: string;
  body?: React.ReactNode;
  lines?: string[];
  confirmLabel?: string;
  tone?: 'default' | 'danger';
}
interface PromptOpts {
  title: string;
  label: string;
  confirmLabel?: string;
  required?: boolean;
  placeholder?: string;
  body?: React.ReactNode;
}

interface Ctx {
  settings: AppSettings | null;
  reloadSettings: () => Promise<void>;
  companies: CompanyRecord[];
  reloadCompanies: () => Promise<void>;
  scope: { companyId: string | null; projectId: string | null };
  setScope: (s: { companyId?: string | null; projectId?: string | null }) => void;
  go: (t: NavTarget) => void;
  focus: NavTarget | null;
  toast: (kind: Toast['kind'], text: string) => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  prompt: (o: PromptOpts) => Promise<string | null>;
  /** Run a save; on NEEDS_CONFIRM ask the user and retry with allowDuplicate. Returns undefined if cancelled. */
  saveConfirmed: <T>(call: (allowDuplicate: boolean) => Promise<T>) => Promise<T | undefined>;
  /** bumps whenever data changes anywhere, so list screens can refresh */
  dataVersion: number;
  bump: () => void;
}

const C = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(C);
  if (!c) throw new Error('useApp outside provider');
  return c;
};

export function AppProvider({ children, onNavigate, focus }: { children: React.ReactNode; onNavigate: (t: NavTarget) => void; focus: NavTarget | null }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [scope, setScopeState] = useState<{ companyId: string | null; projectId: string | null }>(() => {
    try {
      const raw = localStorage.getItem('crm.scope');
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    return { companyId: null, projectId: null };
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const toastId = useRef(0);
  const [confirmState, setConfirmState] = useState<{ opts: ConfirmOpts; resolve: (v: boolean) => void } | null>(null);
  const [promptState, setPromptState] = useState<{ opts: PromptOpts; resolve: (v: string | null) => void } | null>(null);

  const reloadSettings = useCallback(async () => {
    try {
      setSettings(await api<AppSettings>('settings.get'));
    } catch (e) {
      console.error(e);
    }
  }, []);
  const reloadCompanies = useCallback(async () => {
    try {
      setCompanies(await api<CompanyRecord[]>('company.list', {}));
    } catch (e) {
      console.error(e);
    }
  }, []);
  useEffect(() => {
    reloadSettings();
    reloadCompanies();
  }, [reloadSettings, reloadCompanies]);

  // drop a remembered scope whose company no longer exists
  useEffect(() => {
    if (companies.length && scope.companyId && !companies.some((c) => c.id === scope.companyId)) setScopeState({ companyId: null, projectId: null });
  }, [companies, scope.companyId]);

  const setScope = useCallback((s: { companyId?: string | null; projectId?: string | null }) => {
    setScopeState((prev) => {
      const next = { companyId: s.companyId !== undefined ? s.companyId : prev.companyId, projectId: s.projectId !== undefined ? s.projectId : prev.projectId };
      if (s.companyId !== undefined && s.companyId !== prev.companyId && s.projectId === undefined) next.projectId = null;
      try {
        localStorage.setItem('crm.scope', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4200);
  }, []);

  const confirm = useCallback((opts: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirmState({ opts, resolve })), []);
  const prompt = useCallback((opts: PromptOpts) => new Promise<string | null>((resolve) => setPromptState({ opts, resolve })), []);
  const bump = useCallback(() => setDataVersion((v) => v + 1), []);

  const saveConfirmed = useCallback(
    async <T,>(call: (allow: boolean) => Promise<T>): Promise<T | undefined> => {
      try {
        return await call(false);
      } catch (e) {
        if (e instanceof ApiFailure && e.code === 'NEEDS_CONFIRM') {
          const ok = await confirm({ title: 'Please check before saving', lines: e.warnings ?? [e.message], confirmLabel: 'Save anyway' });
          if (!ok) return undefined;
          return call(true);
        }
        throw e;
      }
    },
    [confirm]
  );

  const value = useMemo<Ctx>(
    () => ({ settings, reloadSettings, companies, reloadCompanies, scope, setScope, go: onNavigate, focus, toast, confirm, prompt, saveConfirmed, dataVersion, bump }),
    [settings, reloadSettings, companies, reloadCompanies, scope, setScope, onNavigate, focus, toast, confirm, prompt, saveConfirmed, dataVersion, bump]
  );

  return (
    <C.Provider value={value}>
      {children}
      <div aria-live="polite" style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 80, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
        {toasts.map((t) => (
          <div key={t.id} role="status" className="card" style={{ display: 'flex', gap: 10, padding: '10px 14px', boxShadow: 'var(--shadow-2)', animation: 'toast-in .18s ease-out', borderLeft: `3px solid ${t.kind === 'error' ? 'var(--bad)' : t.kind === 'success' ? 'var(--good)' : 'var(--info)'}` }}>
            {t.kind === 'success' ? <CheckCircle2 size={16} color="var(--good)" /> : t.kind === 'error' ? <XCircle size={16} color="var(--bad)" /> : <Info size={16} color="var(--info)" />}
            <span style={{ lineHeight: 1.4 }}>{t.text}</span>
          </div>
        ))}
      </div>
      {confirmState && (
        <Modal
          title={confirmState.opts.title}
          onClose={() => (confirmState.resolve(false), setConfirmState(null))}
          footer={
            <>
              <Button onClick={() => (confirmState.resolve(false), setConfirmState(null))}>Cancel</Button>
              <Button variant={confirmState.opts.tone === 'danger' ? 'danger' : 'primary'} data-autofocus onClick={() => (confirmState.resolve(true), setConfirmState(null))}>
                {confirmState.opts.confirmLabel ?? 'Confirm'}
              </Button>
            </>
          }
        >
          {confirmState.opts.lines && (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
              {confirmState.opts.lines.map((l, i) => (
                <li key={i} className="note note-warn">
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          )}
          {confirmState.opts.body}
        </Modal>
      )}
      {promptState && <PromptModal state={promptState} close={() => setPromptState(null)} />}
    </C.Provider>
  );
}

function PromptModal({ state, close }: { state: { opts: PromptOpts; resolve: (v: string | null) => void }; close: () => void }) {
  const [text, setText] = useState('');
  const { opts, resolve } = state;
  const ok = !opts.required || text.trim().length > 0;
  const done = (v: string | null) => (resolve(v), close());
  return (
    <Modal
      title={opts.title}
      onClose={() => done(null)}
      footer={
        <>
          <Button onClick={() => done(null)}>Cancel</Button>
          <Button variant="primary" disabled={!ok} onClick={() => done(text.trim())}>
            {opts.confirmLabel ?? 'Continue'}
          </Button>
        </>
      }
    >
      {opts.body && <div style={{ marginBottom: 12 }}>{opts.body}</div>}
      <label className="field-label">{opts.label}</label>
      <TextArea
        data-autofocus
        value={text}
        placeholder={opts.placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ok) done(text.trim());
        }}
        rows={3}
      />
    </Modal>
  );
}

/** Wrap an async handler: shows an error toast on failure. */
export function useAction() {
  const { toast } = useApp();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (success) toast('success', success);
        return r;
      } catch (e) {
        toast('error', errMsg(e));
        return undefined;
      }
    },
    [toast]
  );
}
