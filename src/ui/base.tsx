import React from 'react';
import { AlertTriangle, CircleAlert, CircleCheck, Info, Loader2 } from 'lucide-react';
import { STATUS_TONE, Tone } from '../shared/modules';

export function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(' ');
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  loading?: boolean;
  iconOnly?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'default', size = 'md', icon, loading, iconOnly, className, children, disabled, type = 'button', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx('btn', variant === 'primary' && 'btn-primary', variant === 'ghost' && 'btn-ghost', variant === 'danger' && 'btn-danger', size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', iconOnly && 'btn-icon', className)}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="spin" /> : icon}
      {children}
    </button>
  );
});

export function Chip({ tone = 'neutral', children, dot = true, title }: { tone?: Tone | 'brand'; children: React.ReactNode; dot?: boolean; title?: string }) {
  return (
    <span title={title} className={cx('chip', `chip-${tone}`, !dot && 'nodot')}>
      {children}
    </span>
  );
}

const LABELS: Record<string, string> = { na: 'N/A', neft: 'NEFT', rtgs: 'RTGS', upi: 'UPI', imps: 'IMPS', on_hold: 'On hold', credit_note: 'Credit note', unverified: 'Not verified' };
/** Status text -> coloured chip */
export function StatusChip({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return null;
  const tone: Tone = STATUS_TONE[value] ?? 'neutral';
  const text = label ?? LABELS[value] ?? value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return <Chip tone={tone}>{text}</Chip>;
}

export function Card({ children, className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('card', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHead({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="card-head">
      <div>
        <div className="card-title">{title}</div>
        {subtitle && <div style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 1 }}>{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" style={{ color: 'var(--ink-3)' }}>
      <Loader2 size={size} className="spin" />
      {label}
    </span>
  );
}

export function Skeleton({ w = '100%', h = 14, style }: { w?: number | string; h?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width: w, height: h, ...style }} />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="card" style={{ padding: 14 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4" style={{ padding: '9px 0', borderBottom: i < rows - 1 ? '1px solid var(--line-soft)' : 0 }}>
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} w={j === 0 ? '22%' : `${12 + ((i * 7 + j * 11) % 14)}%`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center" style={{ padding: '44px 24px' }}>
      {icon && (
        <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', marginBottom: 12, border: '1px solid var(--brand-line)' }}>
          {icon}
        </div>
      )}
      <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
      {children && <div style={{ color: 'var(--ink-3)', maxWidth: 420, marginTop: 4, lineHeight: 1.5 }}>{children}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="note note-bad" role="alert" style={{ alignItems: 'center' }}>
      <AlertTriangle size={16} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>{message}</div>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Note({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'bad' | 'good'; children: React.ReactNode; title?: string }) {
  const Icon = tone === 'good' ? CircleCheck : tone === 'info' ? Info : tone === 'warn' ? AlertTriangle : CircleAlert;
  return (
    <div className={cx('note', `note-${tone}`)}>
      <Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
      <div>
        {title && <div style={{ fontWeight: 600, marginBottom: 1 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Kpi({ label, value, hint, tone, icon, onClick }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone; icon?: React.ReactNode; onClick?: () => void }) {
  const color = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? 'var(--warn)' : tone === 'good' ? 'var(--good)' : 'var(--ink)';
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      className="card kpi"
      onClick={onClick}
      style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default', width: '100%', font: 'inherit', color: 'inherit', transition: 'border-color .12s, box-shadow .12s' }}
      onMouseEnter={(e: any) => onClick && (e.currentTarget.style.borderColor = 'var(--brand-line)')}
      onMouseLeave={(e: any) => onClick && (e.currentTarget.style.borderColor = 'var(--line)')}
    >
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {icon && <span style={{ color: 'var(--ink-4)' }}>{icon}</span>}
      </div>
      <div className="kpi-value" style={{ color, marginTop: 6 }}>
        {value}
      </div>
      {hint && <div style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 3 }}>{hint}</div>}
    </Tag>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string; count?: number | null }>; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className="tab" onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && t.count !== null && <span className="count num">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o.id} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, children }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div style={{ padding: '18px 28px 0' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 style={{ fontSize: 20, lineHeight: 1.2 }}>{title}</h1>
          {subtitle && <p style={{ margin: '4px 0 0', color: 'var(--ink-3)', maxWidth: 760, lineHeight: 1.5 }}>{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Page({ children, pad = true }: { children: React.ReactNode; pad?: boolean }) {
  return <div style={{ padding: pad ? '16px 28px 32px' : 0 }}>{children}</div>;
}

export function KeyValue({ items, cols = 2 }: { items: Array<[string, React.ReactNode]>; cols?: number }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: '10px 24px', margin: 0 }} data-selectable>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="eyebrow" style={{ marginBottom: 2 }}>
            {k}
          </dt>
          <dd style={{ margin: 0, minHeight: 18, wordBreak: 'break-word' }}>{v === null || v === undefined || v === '' ? <span style={{ color: 'var(--ink-4)' }}>—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}
