import React from 'react';
import {
  BarChart3,
  Boxes,
  Building2,
  Factory,
  FlaskConical,
  FolderKanban,
  Files,
  HardHat,
  LayoutDashboard,
  PackageCheck,
  Receipt,
  Ruler,
  ScrollText,
  Settings,
  ShoppingCart,
  Warehouse,
  Layers,
} from 'lucide-react';
import { ScreenId } from '../lib/ctx';

export const NAV: Array<{ group: string; items: Array<{ id: ScreenId; label: string; icon: React.ComponentType<any> }> }> = [
  {
    group: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'companies', label: 'Companies', icon: Building2 },
      { id: 'projects', label: 'Projects', icon: FolderKanban },
    ],
  },
  {
    group: 'Materials & supply',
    items: [
      { id: 'materials', label: 'Materials & Specs', icon: Layers },
      { id: 'suppliers', label: 'Suppliers', icon: Factory },
      { id: 'purchases', label: 'Purchases', icon: ShoppingCart },
      { id: 'inward', label: 'Material Inward', icon: PackageCheck },
      { id: 'royalty', label: 'Royalty & Passes', icon: ScrollText },
    ],
  },
  {
    group: 'Site operations',
    items: [
      { id: 'inventory', label: 'Inventory', icon: Warehouse },
      { id: 'consumption', label: 'Consumption', icon: HardHat },
      { id: 'quality', label: 'Quality Control', icon: FlaskConical },
      { id: 'measurement', label: 'Measurement Book', icon: Ruler },
    ],
  },
  {
    group: 'Accounts & records',
    items: [
      { id: 'billing', label: 'Bills & Payments', icon: Receipt },
      { id: 'reports', label: 'Reports & Analytics', icon: BarChart3 },
      { id: 'documents', label: 'Document Center', icon: Files },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export const SCREEN_TITLES: Record<ScreenId, string> = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.id, i.label]))) as Record<ScreenId, string>;

export const Sidebar: React.FC<{ current: ScreenId; onSelect: (id: ScreenId) => void; badges?: Partial<Record<ScreenId, number>> }> = ({ current, onSelect, badges }) => (
  <aside style={{ width: 232, background: 'var(--nav)', color: 'var(--nav-ink)', display: 'flex', flexDirection: 'column', flexShrink: 0, borderRight: '1px solid #0e141d' }}>
    <div className="flex items-center gap-3" style={{ padding: '16px 16px 14px', borderBottom: '1px solid var(--nav-line)' }}>
      <div style={{ width: 34, height: 34, borderRadius: 8, background: 'linear-gradient(145deg,#f97316,#c2410c)', display: 'grid', placeItems: 'center', color: '#fff', boxShadow: '0 2px 8px rgba(234,88,12,.35)' }}>
        <HardHat size={19} strokeWidth={2.2} />
      </div>
      <div style={{ lineHeight: 1.15 }}>
        <div style={{ color: '#fff', fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em' }}>Record Manager</div>
        <div style={{ color: 'var(--nav-dim)', fontSize: 11.5 }}>Road construction</div>
      </div>
    </div>
    <nav style={{ flex: 1, overflow: 'auto', padding: '0 10px 12px' }} aria-label="Main">
      {NAV.map((g) => (
        <div key={g.group}>
          <div className="nav-group">{g.group}</div>
          <div style={{ display: 'grid', gap: 1 }}>
            {g.items.map((it) => {
              const Icon = it.icon;
              const b = badges?.[it.id];
              return (
                <button key={it.id} className="nav-item" aria-current={current === it.id ? 'page' : undefined} onClick={() => onSelect(it.id)}>
                  <Icon size={16} strokeWidth={1.9} />
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
                  {b ? (
                    <span className="num" style={{ background: '#3a2a22', color: '#ffb184', borderRadius: 999, fontSize: 11, padding: '0 7px', height: 18, display: 'inline-flex', alignItems: 'center', fontWeight: 600 }}>
                      {b}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
    <div style={{ padding: '10px 16px 12px', borderTop: '1px solid var(--nav-line)', fontSize: 11.5, color: 'var(--nav-dim)', lineHeight: 1.5 }}>
      <div className="flex items-center gap-2">
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399' }} />
        Offline · local database
      </div>
    </div>
  </aside>
);
