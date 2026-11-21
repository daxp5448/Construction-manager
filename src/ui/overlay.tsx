import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, cx } from './base';

function useEscape(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose, active]);
}

/** Moves focus into the overlay on open and restores it on close. */
function useFocusTrap(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus], input:not([readonly]):not([disabled]), textarea, select, button:not([data-close])');
    (first ?? el)?.focus?.();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !el) return;
      const f = Array.from(el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const a = f[0];
      const z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    el?.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
  closeOnScrim = true,
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  closeOnScrim?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useFocusTrap(ref);
  return createPortal(
    <>
      <div className="scrim" onMouseDown={closeOnScrim ? onClose : undefined} />
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1} style={width ? { width: `min(${width}px, calc(100vw - 48px))` } : undefined}>
        <div className="overlay-head" style={{ borderRadius: '12px 12px 0 0' }}>
          <h2 style={{ fontSize: 15 }}>{title}</h2>
          <Button variant="ghost" size="sm" iconOnly aria-label="Close" data-close onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div style={{ padding: 20, overflow: 'auto' }}>{children}</div>
        {footer && (
          <div className="overlay-foot" style={{ borderRadius: '0 0 12px 12px' }}>
            {footer}
          </div>
        )}
      </div>
    </>,
    document.body
  );
}

export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
  headerExtra,
  closeOnScrim = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  headerExtra?: React.ReactNode;
  closeOnScrim?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useFocusTrap(ref);
  return createPortal(
    <>
      <div className="scrim" onMouseDown={closeOnScrim ? onClose : undefined} />
      <aside ref={ref} className={cx('drawer', wide && 'wide')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1}>
        <div className="overlay-head">
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h2>
            {subtitle && <div style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 1 }}>{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2">
            {headerExtra}
            <Button variant="ghost" size="sm" iconOnly aria-label="Close" data-close onClick={onClose}>
              <X size={16} />
            </Button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>{children}</div>
        {footer && <div className="overlay-foot">{footer}</div>}
      </aside>
    </>,
    document.body
  );
}
