import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { api } from '../lib/api';
import { RefKind } from '../shared/modules';
import { moneyToInput, parseMoney, parsePct, parseQty, parseScaled, pctToInput, qtyToInput } from '../shared/num';
import { cx } from './base';

export function Field({
  label,
  required,
  error,
  help,
  children,
  htmlFor,
  className,
  style,
}: {
  label?: React.ReactNode;
  required?: boolean;
  error?: string | null;
  help?: React.ReactNode;
  children: React.ReactNode;
  htmlFor?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={className} style={style}>
      {label && (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required && <span style={{ color: 'var(--brand)', marginLeft: 2 }}>*</span>}
        </label>
      )}
      {children}
      {error ? <div className="field-error">{error}</div> : help ? <div className="field-help">{help}</div> : null}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className, ...rest }, ref) {
  return <input ref={ref} className={cx('input', invalid && 'input-error', className)} {...rest} />;
});

export function TextArea({ invalid, className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={cx('textarea', invalid && 'input-error', className)} {...rest} />;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  invalid,
  disabled,
  className,
  id,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <select id={id} className={cx('select', invalid && 'input-error', className)} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2" style={{ cursor: disabled ? 'default' : 'pointer', minHeight: 32 }}>
      <input id={id} type="checkbox" className="check" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label && <span style={{ fontSize: 13 }}>{label}</span>}
    </label>
  );
}

// ------------------------------------------------------------------ numbers
export type NumKind = 'money' | 'qty' | 'pct' | 'int' | 'number';
const PARSE: Record<NumKind, (s: string) => number | null> = {
  money: parseMoney,
  qty: parseQty,
  pct: parsePct,
  int: (s) => parseScaled(s, 0),
  number: (s) => {
    const n = Number(s.replace(/,/g, ''));
    return s.trim() === '' || !Number.isFinite(n) ? null : n;
  },
};
const SHOW: Record<NumKind, (n: number | null) => string> = {
  money: moneyToInput,
  qty: qtyToInput,
  pct: pctToInput,
  int: (n) => (n === null ? '' : String(n)),
  number: (n) => (n === null ? '' : String(n)),
};

/** Text box that stores an exact integer (paise / milli-units / basis points) while the user types decimals. */
export function NumberInput({
  kind,
  value,
  onChange,
  prefix,
  suffix,
  invalid,
  disabled,
  readOnly,
  placeholder,
  id,
  autoFocus,
  align = 'right',
}: {
  kind: NumKind;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  id?: string;
  autoFocus?: boolean;
  align?: 'left' | 'right';
}) {
  const v = value ?? null;
  const [text, setText] = useState(SHOW[kind](v));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current || PARSE[kind](text) !== v) setText(SHOW[kind](v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, kind]);
  const bad = text.trim() !== '' && PARSE[kind](text) === null;
  const input = (
    <input
      id={id}
      inputMode="decimal"
      autoFocus={autoFocus}
      className={cx('input', 'input-num', (invalid || bad) && 'input-error')}
      style={align === 'left' ? { textAlign: 'left' } : undefined}
      value={text}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        const p = PARSE[kind](text);
        setText(SHOW[kind](p));
      }}
      onChange={(e) => {
        const t = e.target.value;
        if (!/^[-\d.,\s]*$/.test(t)) return;
        setText(t);
        onChange(t.trim() === '' ? null : PARSE[kind](t));
      }}
    />
  );
  if (!prefix && !suffix) return input;
  return (
    <div className="adorn">
      {prefix && <span className="adorn-prefix">{prefix}</span>}
      {input}
      {suffix && <span className="adorn-suffix">{suffix}</span>}
    </div>
  );
}

export const MoneyInput = (p: Omit<React.ComponentProps<typeof NumberInput>, 'kind' | 'prefix'>) => <NumberInput kind="money" prefix="₹" {...p} />;
export const QtyInput = (p: Omit<React.ComponentProps<typeof NumberInput>, 'kind'>) => <NumberInput kind="qty" {...p} />;
export const PctInput = (p: Omit<React.ComponentProps<typeof NumberInput>, 'kind' | 'suffix'>) => <NumberInput kind="pct" suffix="%" {...p} />;

// ------------------------------------------------------------------ reference picker
export interface RefOption {
  id: string;
  label: string;
  sub?: string | null;
  meta?: Record<string, any>;
}

/** Searchable, async picker for records (companies, projects, suppliers, materials…). */
export function RefSelect({
  refKind,
  value,
  onChange,
  parentColumn,
  parentValue,
  supplierId,
  placeholder = 'Select…',
  disabled,
  invalid,
  clearable = true,
  id,
  includeInactive,
  initialLabel,
}: {
  refKind: RefKind;
  value: string | null | undefined;
  onChange: (id: string | null, opt: RefOption | null) => void;
  parentColumn?: string;
  parentValue?: string | null;
  supplierId?: string | null;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  clearable?: boolean;
  id?: string;
  includeInactive?: boolean;
  initialLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<RefOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [label, setLabel] = useState<string>(initialLabel ?? '');
  const root = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqSeq = useRef(0);

  const fetchOpts = useCallback(
    async (query: string) => {
      const my = ++reqSeq.current;
      setLoading(true);
      try {
        const r = await api<RefOption[]>('lookup.list', { ref: refKind, q: query || undefined, parentColumn, parentValue: parentValue ?? undefined, supplierId: supplierId ?? undefined, includeInactive });
        if (my === reqSeq.current) {
          setOpts(r);
          setActive(0);
        }
      } catch {
        if (my === reqSeq.current) setOpts([]);
      } finally {
        if (my === reqSeq.current) setLoading(false);
      }
    },
    [refKind, parentColumn, parentValue, supplierId, includeInactive]
  );

  // resolve the display label of the current value
  useEffect(() => {
    let dead = false;
    if (!value) {
      setLabel('');
      return;
    }
    const known = opts.find((o) => o.id === value);
    if (known) {
      setLabel(known.label);
      return;
    }
    api<RefOption[]>('lookup.list', { ref: refKind, ids: [value], includeInactive: true })
      .then((r) => !dead && setLabel(r[0]?.label ?? ''))
      .catch(() => {});
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, refKind]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => fetchOpts(q), q ? 180 : 0);
    return () => clearTimeout(t);
  }, [open, q, fetchOpts]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setQ('');
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const pick = (o: RefOption | null) => {
    onChange(o?.id ?? null, o);
    setLabel(o?.label ?? '');
    setOpen(false);
    setQ('');
  };

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          id={id}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          className={cx('input', invalid && 'input-error')}
          style={{ paddingRight: value && clearable && !disabled ? 52 : 28, cursor: disabled ? 'default' : 'pointer' }}
          placeholder={open ? 'Type to search…' : placeholder}
          value={open ? q : label}
          onFocus={() => !disabled && setOpen(true)}
          onClick={() => !disabled && setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, opts.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && open) {
              e.preventDefault();
              e.stopPropagation();
              if (opts[active]) pick(opts[active]);
            } else if (e.key === 'Escape' && open) {
              e.stopPropagation();
              setOpen(false);
              setQ('');
            }
          }}
        />
        <span style={{ position: 'absolute', right: 8, top: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'none', color: 'var(--ink-3)' }}>
          {loading ? <Loader2 size={13} className="spin" /> : null}
          {value && clearable && !disabled && (
            <button type="button" aria-label="Clear" tabIndex={-1} style={{ pointerEvents: 'auto', border: 0, background: 'none', cursor: 'pointer', display: 'flex', color: 'var(--ink-4)' }} onMouseDown={(e) => (e.preventDefault(), pick(null))}>
              <X size={13} />
            </button>
          )}
          <ChevronDown size={14} />
        </span>
      </div>
      {open && (
        <div className="menu" role="listbox">
          {!loading && opts.length === 0 && <div style={{ padding: '8px 10px', color: 'var(--ink-3)' }}>No matches</div>}
          {opts.map((o, i) => (
            <button key={o.id} type="button" role="option" aria-selected={o.id === value} data-active={i === active} className="menu-item" onMouseEnter={() => setActive(i)} onMouseDown={(e) => (e.preventDefault(), pick(o))}>
              <div style={{ fontWeight: o.id === value ? 600 : 500 }}>{o.label}</div>
              {(o.sub || o.meta?.rate_paise !== undefined) && (
                <div style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>
                  {o.sub}
                  {o.meta?.rate_paise !== undefined && o.meta.rate_paise !== null ? `${o.sub ? ' · ' : ''}agreed rate on file` : ''}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
