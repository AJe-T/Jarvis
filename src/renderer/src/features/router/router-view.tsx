import { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { PoolPhase } from '@shared/free-pool';
import { PageBody, PageHeader } from '../../components/ui/page';
import { AbilitiesTab } from './abilities-tab';
import { AnalyticsTab } from './analytics-tab';
import { DelegationTab } from './delegation-tab';
import { ModelsTab } from './models-tab';
import { OverviewTab } from './overview-tab';
import { PreviewBanner, Toggle } from './parts';
import { previewSnapshot } from './preview';
import { ProvidersTab } from './providers-tab';
import { TiersTab } from './tiers-tab';

const TABS = [
  { id: 'overview', label: 'Overview', phase: 1 },
  { id: 'models', label: 'Models', phase: 1 },
  { id: 'providers', label: 'Providers & keys', phase: 1 },
  { id: 'tiers', label: 'Tiers & privacy', phase: 1 },
  { id: 'delegation', label: 'Delegation', phase: 2 },
  { id: 'abilities', label: 'Abilities', phase: 3 },
  { id: 'analytics', label: 'Analytics', phase: 4 },
] as const satisfies ReadonlyArray<{ id: string; label: string; phase: PoolPhase }>;

type Tab = (typeof TABS)[number]['id'];

/** Sidebar → AI Router: the free-AI pool as one module (FreeLLMAPI-style dashboard). */
export function RouterView(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  // Step 0: sample data. Phase 1 swaps this for call('pool:snapshot').
  const snap = useMemo(() => previewSnapshot(), []);
  const [enabled, setEnabled] = useState(snap.enabled);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="AI Router" help="router">
        <label className="flex items-center gap-2 text-sm text-ink-300">
          Free pool
          <Toggle label="Free pool on" checked={enabled} onChange={setEnabled} />
        </label>
      </PageHeader>
      <PageBody className="flex max-w-6xl flex-col gap-4">
        {snap.preview && (
          <PreviewBanner>
            <span className="font-medium">Preview.</span> This is the layout of every AI Router
            feature. Numbers are samples and nothing is saved or sent yet. Parts marked{' '}
            <span className="font-code">Phase N</span> start working in that phase.
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
              {t.phase > 1 && (
                <span className="font-code text-3xs text-ink-500" aria-label={`Phase ${t.phase}`}>
                  P{t.phase}
                </span>
              )}
            </button>
          ))}
        </div>
        <div id="router-panel" role="tabpanel" aria-labelledby={`router-tab-${tab}`}>
          {tab === 'overview' && <OverviewTab snap={snap} />}
          {tab === 'models' && <ModelsTab snap={snap} />}
          {tab === 'providers' && <ProvidersTab snap={snap} />}
          {tab === 'tiers' && <TiersTab snap={snap} />}
          {tab === 'delegation' && <DelegationTab />}
          {tab === 'abilities' && <AbilitiesTab />}
          {tab === 'analytics' && <AnalyticsTab snap={snap} />}
        </div>
      </PageBody>
    </div>
  );
}
