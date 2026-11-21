import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Sidebar, SCREEN_TITLES } from './components/Sidebar';
import { Header } from './components/Header';
import { AppProvider, NavTarget, ScreenId, useApp } from './lib/ctx';
import { api } from './lib/api';
import { Button, Spinner } from './ui/base';
import { SearchPalette } from './screens/SearchPalette';
import { DashboardScreen } from './screens/Dashboard';
import { CompaniesScreen } from './screens/Companies';
import { ProjectsScreen } from './screens/Projects';
import { MaterialsScreen } from './screens/Materials';
import { SuppliersScreen } from './screens/Suppliers';
import { PurchasesScreen } from './screens/Purchases';
import { InwardScreen } from './screens/Inward';
import { RoyaltyScreen } from './screens/Royalty';
import { InventoryScreen } from './screens/Inventory';
import { ConsumptionScreen } from './screens/Consumption';
import { BillingScreen } from './screens/Billing';
import { QualityScreen } from './screens/Quality';
import { MeasurementScreen } from './screens/Measurement';
import { ReportsScreen } from './screens/Reports';
import { DocumentsScreen } from './screens/Documents';
import { SettingsScreen } from './screens/Settings';

class ErrorBoundary extends React.Component<{ children: React.ReactNode; onReset: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('Screen crashed', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 40, maxWidth: 560 }}>
        <div className="note note-bad" role="alert">
          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>This screen hit a problem</div>
            <div style={{ marginBottom: 10 }}>Your data is safe. {this.state.error.message}</div>
            <Button icon={<RotateCcw size={13} />} onClick={() => (this.setState({ error: null }), this.props.onReset())}>
              Reload screen
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

const SCREENS: Record<ScreenId, React.ComponentType<{ focus: NavTarget }>> = {
  dashboard: DashboardScreen,
  companies: CompaniesScreen,
  projects: ProjectsScreen,
  materials: MaterialsScreen,
  suppliers: SuppliersScreen,
  purchases: PurchasesScreen,
  inward: InwardScreen,
  royalty: RoyaltyScreen,
  inventory: InventoryScreen,
  consumption: ConsumptionScreen,
  billing: BillingScreen,
  quality: QualityScreen,
  measurement: MeasurementScreen,
  reports: ReportsScreen,
  documents: DocumentsScreen,
  settings: SettingsScreen,
};

function Shell({ nav, setNav }: { nav: NavTarget; setNav: (t: NavTarget) => void }) {
  const { settings, dataVersion } = useApp();
  const [search, setSearch] = useState(false);
  const [reset, setReset] = useState(0);
  const [badges, setBadges] = useState<Partial<Record<ScreenId, number>>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // small live badges: things that need attention
  useEffect(() => {
    api<any>('dashboard.get', {})
      .then((d) => setBadges({ billing: d.pending_invoices?.awaiting_action || 0, royalty: (d.missing_royalty?.receipts_without_pass || 0) + (d.missing_royalty?.passes_without_document || 0), inventory: d.low_stock?.length || 0 }))
      .catch(() => {});
  }, [dataVersion]);

  const Screen = SCREENS[nav.screen];
  useEffect(() => {
    document.title = `${SCREEN_TITLES[nav.screen]} · Construction Record Manager`;
  }, [nav.screen]);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <Sidebar current={nav.screen} onSelect={(id) => setNav({ screen: id })} badges={badges} />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header onOpenSearch={() => setSearch(true)} onOpenStorage={() => settings?.storageRoot && api('system.openPath', { path: settings.storageRoot }).catch(() => {})} />
        <div style={{ flex: 1, overflow: 'auto' }}>
          <ErrorBoundary key={`${nav.screen}-${reset}`} onReset={() => setReset((r) => r + 1)}>
            <Suspense fallback={<div style={{ padding: 40 }}><Spinner label="Loading…" /></div>}>
              <Screen key={`${nav.screen}:${nav.openId ?? ''}:${nav.tab ?? ''}`} focus={nav} />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      {search && <SearchPalette onClose={() => setSearch(false)} />}
    </div>
  );
}

export const App: React.FC = () => {
  const [nav, setNav] = useState<NavTarget>({ screen: 'dashboard' });
  const go = useCallback((t: NavTarget) => setNav({ ...t }), []);
  return (
    <AppProvider onNavigate={go} focus={nav}>
      <Shell nav={nav} setNav={go} />
    </AppProvider>
  );
};
