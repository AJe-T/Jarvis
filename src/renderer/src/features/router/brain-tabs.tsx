import { Brain, KeyRound } from 'lucide-react';
import type { PoolSnapshot } from '@shared/free-pool';
import {
  ApiKeysSection,
  BrainConnection,
  BudgetSection,
  ClaudeModels,
  FastCommands,
  OtherAis,
} from '../settings/brain-section';
import { ProvidersTab } from './providers-tab';
import type { PoolActions } from './router-view';

/**
 * AI Router → Main brain: who answers Sir and with which models, what else Jarvis may use, and
 * the budget. The same settings as Settings → Models & AI (one store, one Save bar).
 */
export function BrainTab(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <Intro icon={<Brain size={18} aria-hidden />} title="The brain that answers you">
        Claude (by API key or your Claude plan) is Jarvis&apos;s main brain: it reads your memory,
        uses your tools and decides what to hand to helpers. Pick it here, choose which Claude model
        does each job, and set the budget. Changes wait in the bar at the bottom until you save.
      </Intro>
      <BrainConnection />
      <ClaudeModels />
      <OtherAis />
      <BudgetSection />
      <FastCommands />
    </div>
  );
}

/**
 * AI Router → API keys: every key in one place. Paid providers' keys first (with each key's model
 * list), then the free pool's providers by tier, free search keys, .env import and custom relays.
 */
export function KeysTab({
  snap,
  actions,
}: {
  snap: PoolSnapshot;
  actions: PoolActions;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <Intro icon={<KeyRound size={18} aria-hidden />} title="All your API keys">
        <span className="block">
          <b className="font-medium text-ink-100">Add a key</b> below: pick the provider, paste the
          key, press Save. Keys are encrypted on this PC; only their last four characters are shown.
        </span>
        <span className="block">
          <b className="font-medium text-ink-100">Free providers</b> (Groq, Gemini, Cerebras,
          OpenRouter, NVIDIA, Mistral, Cloudflare) join the free pool by themselves: every free chat
          model the key can use appears on Free models.{' '}
          <b className="font-medium text-ink-100">Paid providers</b> (OpenAI, DeepSeek…) are used
          only when you choose one as the main brain or Claude hands it a task.
        </span>
      </Intro>
      <ApiKeysSection />
      <ProvidersTab snap={snap} actions={actions} />
    </div>
  );
}

function Intro({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      aria-label={title}
      className="flex gap-3 rounded-lg border border-accent-edge bg-accent-tint px-4 py-3"
    >
      <span className="mt-0.5 text-accent-500">{icon}</span>
      <div className="flex flex-col gap-1 text-sm text-ink-300">
        <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
        {children}
      </div>
    </section>
  );
}
