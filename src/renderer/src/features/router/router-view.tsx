import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { RefreshCw } from 'lucide-react';
import type { PoolSnapshot } from '@shared/free-pool';
import type { Req } from '@shared/ipc-contract';
import { IconButton } from '../../components/ui/button';
import { PageBody, PageHeader } from '../../components/ui/page';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';
import { SaveBar } from '../settings/save-bar';
import { AbilitiesTab } from './abilities-tab';
import type { RouterTab } from './ai-map-model';
import { BrainTab, KeysTab } from './brain-tabs';
import { AnalyticsTab } from './analytics-tab';
import { DelegationTab } from './delegation-tab';
import { ModelsTab } from './models-tab';
import { OverviewTab } from './overview-tab';
import { PreviewBanner, Toggle } from './parts';
import { TiersTab } from './tiers-tab';

/** Who answers you, then your keys, then the free pool's own pages. */
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'brain', label: 'Main brain' },
  { id: 'keys', label: 'API keys' },
  { id: 'models', label: 'Free models' },
  { id: 'tiers', label: 'Tiers & privacy' },
  { id: 'delegation', label: 'Delegation' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'analytics', label: 'Analytics' },
] as const satisfies ReadonlyArray<{ id: RouterTab; label: string }>;

type Tab = RouterTab;
const isTab = (t: string | null): t is Tab => TABS.some((x) => x.id === t);

/** What every tab can change: each call returns the new snapshot. */
export interface PoolActions {
  settings(patch: Req<'pool:settings'>): void;
  provider(patch: Req<'pool:setProvider'>): void;
  model(patch: Req<'pool:setModel'>): void;
  /** Phase 4 named chains: the whole list. */
  chains(chains: Req<'pool:setChains'>['chains']): void;
  checkKeys(): Promise<void>;
  /** Sir's own tier-3 provider; true once saved (main checked it). */
  addCustom(input: Req<'pool:addCustom'>): Promise<boolean>;
  removeCustom(id: string): void;
  reload(): void;
}

/** Sidebar → AI Router: the free-AI pool as one module (FreeLLMAPI-style dashboard). */
export function RouterView(): React.JSX.Element {
  const wanted = useUiStore((s) => s.routerTab);
  const [tab, setTab] = useState<Tab>(isTab(wanted) ? wanted : 'overview');
  // go('router', 'keys') from elsewhere (Settings, a toast) opens that tab.
  useEffect(() => {
    if (!isTab(wanted)) return;
    setTab(wanted);
    useUiStore.setState({ routerTab: null });
  }, [wanted]);
  const [snap, setSnap] = useState<PoolSnapshot | null>(null);
  const toast = useUiStore((s) => s.toast);

  const run = useCallback(
    (p: Promise<PoolSnapshot>): Promise<void> =>
      p.then(setSnap).catch((e: unknown) => toast({ level: 'error', message: cleanError(e) })),
    [toast],
  );
  const reload = useCallback(() => void run(call('pool:snapshot', {})), [run]);
  // Fresh numbers on every tab: a key saved on API keys shows up on Free models and the map.
  useEffect(reload, [reload, tab]);

  const actions: PoolActions = {
    settings: (patch) => void run(call('pool:settings', patch)),
    provider: (patch) => void run(call('pool:setProvider', patch)),
    model: (patch) => void run(call('pool:setModel', patch)),
    chains: (chains) => void run(call('pool:setChains', { chains })),
    checkKeys: () => run(call('pool:checkKeys', {})),
    addCustom: (input) =>
      call('pool:addCustom', input)
        .then((next) => {
          setSnap(next);
          return true;
        })
        .catch((e: unknown) => {
          toast({ level: 'error', message: cleanError(e) });
          return false;
        }),
    removeCustom: (id) => void run(call('pool:removeCustom', { id })),
    reload,
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="AI Router" help="router">
        <IconButton label="Refresh" tipSide="bottom" onClick={reload}>
          <RefreshCw size={16} />
        </IconButton>
        <label className="flex items-center gap-2 text-sm text-ink-300">
          Free pool
          <Toggle
            label="Free pool on"
            checked={snap?.enabled ?? false}
            {...(snap ? { onChange: (on: boolean) => actions.settings({ enabled: on }) } : {})}
          />
        </label>
      </PageHeader>
      <PageBody className="flex max-w-6xl flex-col gap-4">
        {snap?.preview && (
          <PreviewBanner>
            <span className="font-medium">Preview.</span> Numbers are samples and nothing is saved
            or sent.
          </PreviewBanner>
        )}
        <div
          role="tablist"
          aria-label="AI Router"
          className="flex flex-wrap gap-x-5 border-b border-line"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`router-tab-${t.id}`}
              role="tab"
              type="button"
              aria-selected={tab === t.id}
              aria-controls="router-panel"
              onClick={() => setTab(t.id)}
              className={clsx(
                '-mb-px flex items-center gap-1.5 border-b-2 pb-2.5 text-ui font-medium transition-colors duration-[120ms]',
                tab === t.id
                  ? 'border-ink-100 text-ink-100'
                  : 'border-transparent text-ink-500 hover:text-ink-100',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div id="router-panel" role="tabpanel" aria-labelledby={`router-tab-${tab}`}>
          {!snap ? (
            <span className="skeleton block h-40 w-full" aria-hidden />
          ) : (
            <>
              {tab === 'overview' && <OverviewTab snap={snap} onOpen={setTab} />}
              {tab === 'brain' && <BrainTab />}
              {tab === 'keys' && <KeysTab snap={snap} actions={actions} />}
              {tab === 'models' && <ModelsTab snap={snap} actions={actions} />}
              {tab === 'tiers' && <TiersTab snap={snap} onChange={actions.settings} />}
              {tab === 'delegation' && (
                <DelegationTab
                  delegation={snap.delegation}
                  onChange={(patch) => actions.settings({ delegation: patch })}
                />
              )}
              {tab === 'abilities' && (
                <AbilitiesTab snap={snap} actions={actions} onKeys={() => setTab('keys')} />
              )}
              {tab === 'analytics' && <AnalyticsTab />}
            </>
          )}
        </div>
      </PageBody>
      {/* Main brain and API keys edit settings: the same save bar as Settings. */}
      <SaveBar />
    </div>
  );
}
