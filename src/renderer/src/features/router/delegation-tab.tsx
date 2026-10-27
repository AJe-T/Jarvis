import { ArrowDown, Brain, Cloud, DoorOpen, User } from 'lucide-react';
import type { PoolDelegation, PoolTier } from '@shared/free-pool';
import { Panel, SettingRow, TierTag, Toggle } from './parts';

const EXAMPLES: Array<{ task: string; tier: PoolTier; why: string }> = [
  {
    task: '“What’s 15% of 2,400?”',
    tier: 2,
    why: 'Simple and harmless: the front door sends it straight to a free AI.',
  },
  {
    task: '“Summarise these three articles”',
    tier: 2,
    why: 'Heavy reading, nothing private: Claude hands it off and reads the short report.',
  },
  { task: '“Translate this product page to Hindi”', tier: 2, why: 'Long output, public text.' },
  {
    task: '“What did I note about my loan?”',
    tier: 1,
    why: 'Reads your vault: private, so Claude only.',
  },
  {
    task: '“Reply to Priya on WhatsApp”',
    tier: 1,
    why: 'Reads your messages: private, so Claude only.',
  },
  {
    task: '“Plan my week and move meetings”',
    tier: 1,
    why: 'Important and uses your calendar: Claude.',
  },
];

const RULES: Array<{ key: keyof PoolDelegation; label: string; title: string; detail: string }> = [
  {
    key: 'delegate',
    label: 'Claude delegates to free AIs',
    title: 'Let Claude hand heavy, non-private work to free AIs',
    detail:
      'Summaries, drafts, translations, reading many web pages. Claude reads only the short report, which is where the saving is.',
  },
  {
    key: 'frontDoor',
    label: 'Front door',
    title: 'Front door for simple chats',
    detail:
      'Short, plain, non-private questions go straight to a free AI (tier 2 only) and skip Claude. Rules decide, Laya can send a question back; anything unclear goes to Claude, and the chat says when the front door was used.',
  },
  {
    key: 'sticky',
    label: 'Sticky conversations',
    title: 'Keep a conversation on one model',
    detail:
      'For 30 minutes a chat stays on the free model that answered it, so the style and facts don’t change mid-way.',
  },
  {
    key: 'handover',
    label: 'Hand-over note',
    title: 'Hand-over note when the model has to change',
    detail:
      'If that model runs out, the next one gets a short note of what the free AIs answered so far (off: just the question). Claude’s answers are never in it.',
  },
  {
    key: 'fallback',
    label: 'Fall back both ways',
    title: 'Fall back both ways',
    detail:
      'Every free AI busy: Claude takes the task. Claude out of budget or limits: a free AI answers non-private chats. The reply always says so.',
  },
  {
    key: 'budgetAware',
    label: 'Budget-aware',
    title: 'Prefer free AIs when the budget is nearly used',
    detail:
      'Once 80% of today’s Claude budget is spent (API key only), the front door opens and Claude is told to delegate more.',
  },
];

/** Delegation (Phase 2): Claude stays the boss and decides what free AIs may do. */
export function DelegationTab({
  delegation,
  onChange,
}: {
  delegation: PoolDelegation;
  onChange: (patch: Partial<PoolDelegation>) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="How a request is shared out">
        <ol className="flex flex-col items-center gap-2 text-sm">
          <Step icon={<User size={16} aria-hidden />} text="You ask" />
          <ArrowDown size={16} aria-hidden className="text-ink-500" />
          <Step
            icon={<DoorOpen size={16} aria-hidden />}
            text="Front door: simple and not private? → free AI answers, Claude is never called"
          />
          <ArrowDown size={16} aria-hidden className="text-ink-500" />
          <Step
            icon={<Brain size={16} aria-hidden />}
            text="Claude thinks: private or important → does it itself"
          />
          <ArrowDown size={16} aria-hidden className="text-ink-500" />
          <Step
            icon={<Cloud size={16} aria-hidden />}
            text="Heavy but harmless parts → handed to the free pool → short report back to Claude"
          />
        </ol>
      </Panel>

      <Panel title="Rules">
        <div>
          {RULES.map((r) => (
            <SettingRow key={r.key} title={r.title} detail={r.detail}>
              <Toggle
                label={r.label}
                checked={delegation[r.key]}
                onChange={(on) => onChange({ [r.key]: on })}
              />
            </SettingRow>
          ))}
        </div>
        <p className="text-xs text-ink-500">
          Private data never goes to a free AI, whatever these say: checked in code on every path.
        </p>
      </Panel>

      <Panel title="Examples">
        <ul className="flex flex-col divide-y divide-line-subtle">
          {EXAMPLES.map((e) => (
            <li
              key={e.task}
              className="flex flex-wrap items-center gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="min-w-56 flex-1 text-sm font-medium text-ink-100">{e.task}</span>
              <TierTag tier={e.tier} />
              <span className="basis-full text-sm text-ink-300 md:basis-auto md:flex-[2]">
                {e.why}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Step({ icon, text }: { icon: React.ReactNode; text: string }): React.JSX.Element {
  return (
    <li className="flex w-full max-w-xl items-center gap-3 rounded-md border border-line bg-surface-2 px-4 py-2.5 text-ink-100">
      <span className="text-accent-500">{icon}</span>
      {text}
    </li>
  );
}
