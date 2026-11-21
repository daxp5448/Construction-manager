import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiFail } from '../types';

export class ApiFailure extends Error {
  code: ApiFail['error']['code'];
  fieldErrors?: Record<string, string>;
  warnings?: string[];
  constructor(e: ApiFail['error']) {
    super(e.message);
    this.code = e.code;
    this.fieldErrors = e.fieldErrors;
    this.warnings = e.warnings;
  }
}

/** Call the main process. Throws ApiFailure on any error so screens can use try/catch uniformly. */
export async function api<T = any>(channel: string, payload: unknown = {}): Promise<T> {
  if (!window.electronAPI?.invoke) throw new Error('The desktop bridge is not available. Please run the application through Electron.');
  const res = await window.electronAPI.invoke<T>(channel, payload);
  if (!res.ok) throw new ApiFailure(res.error);
  return res.data;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface Async<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (d: T | null) => void;
}

/** Load data whenever `deps` change; keeps the previous data visible while reloading. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    setLoading(true);
    fn()
      .then((d) => {
        if (my === seq.current) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (my === seq.current) setError(errMsg(e));
      })
      .finally(() => {
        if (my === seq.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload, setData };
}

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
