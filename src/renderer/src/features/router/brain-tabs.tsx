import type { PoolSnapshot } from '@shared/free-pool';
import {
  ApiKeysSection,
  BrainConnection,
  BudgetSection,
  ClaudeModels,
  FastCommands,
  OtherAis,
} from '../settings/brain-section';
import { TabIntro } from './parts';
import { ProvidersTab } from './providers-tab';
import type { PoolActions } from './router-view';

/**
 * AI Router → Main brain: who answers Sir and with which models, what else Jarvis may use, and
 * the budget. Since 2.35 this is the only place these settings live (Settings links here).
 */
export function BrainTab(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <TabIntro help="router:brain">
        Who answers you, which Claude model does each job, and your budget. Save with the bar at the
        bottom.
      </TabIntro>
      <BrainConnection />
      <ClaudeModels />
      <BudgetSection />
      <OtherAis />
      <FastCommands />
    </div>
  );
}

/** AI Router → API keys: add a key in one step, then each provider you have keys for. */
export function KeysTab({
  snap,
  actions,
}: {
  snap: PoolSnapshot;
  actions: PoolActions;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <TabIntro help="router:keys">
        Add a key: pick the provider, paste the key, save. Free providers join the free pool by
        themselves.
      </TabIntro>
      <ApiKeysSection />
      <ProvidersTab snap={snap} actions={actions} />
    </div>
  );
}
