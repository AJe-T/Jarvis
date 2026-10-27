import { ArrowDown, Brain, Cloud, DoorOpen, User } from 'lucide-react';
import type { PoolTier } from '@shared/free-pool';
import { Panel, PhaseTag, SettingRow, TierTag, Toggle } from './parts';

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

/** Delegation (Phase 2): Claude stays the boss and decides what free AIs may do. */
export function DelegationTab(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Panel title="How a request is shared out" phase={2}>
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

      <Panel title="Rules" phase={2}>
        <div>
          <SettingRow
            title="Let Claude hand heavy, non-private work to free AIs"
            detail="Summaries, drafts, translations, reading many web pages. Claude reads only the short report, which is where the saving is."
            phase={2}
          >
            <Toggle label="Claude delegates to free AIs" checked disabled />
          </SettingRow>
          <SettingRow
            title="Front door for simple chats"
            detail="Short, non-private questions go straight to a free AI and skip Claude. Rules and Laya decide; anything unclear goes to Claude."
            phase={2}
          >
            <Toggle label="Front door" checked={false} disabled />
          </SettingRow>
          <SettingRow
            title="Keep a conversation on one model"
            detail="For 30 minutes a chat stays on the model that started it, so the style and facts don't change mid-way."
            phase={2}
          >
            <Toggle label="Sticky conversations" checked disabled />
          </SettingRow>
          <SettingRow
            title="Hand-over note when the model has to change"
            detail="If that model runs out, the next one gets a short summary of the chat so far."
            phase={2}
          >
            <Toggle label="Hand-over note" checked disabled />
          </SettingRow>
          <SettingRow
            title="If the free pool fails, Claude answers"
            detail="Every free AI busy or erroring: Claude takes the task and the reply says so."
            phase={2}
          >
            <Toggle label="Fall back to Claude" checked disabled />
          </SettingRow>
          <SettingRow
            title="Prefer free AIs when the budget is nearly used"
            detail="Once 80% of today's Claude budget is spent, non-private work goes to the free pool first."
            phase={2}
          >
            <Toggle label="Budget-aware" checked disabled />
          </SettingRow>
        </div>
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
        <p className="flex items-center gap-2 text-xs text-ink-500">
          <PhaseTag phase={2} /> Until Phase 2, Claude answers everything as today.
        </p>
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
