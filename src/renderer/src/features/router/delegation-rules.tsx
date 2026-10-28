import type { PoolDelegation } from '@shared/free-pool';
import { Panel, SettingRow, Toggle } from './parts';

const RULES: Array<{ key: keyof PoolDelegation; label: string; title: string; detail: string }> = [
  {
    key: 'delegate',
    label: 'Claude delegates to free AIs',
    title: 'Let Claude hand heavy, non-private work to free AIs',
    detail:
      'Summaries, drafts, translations, reading many pages. Claude reads only the short report.',
  },
  {
    key: 'frontDoor',
    label: 'Front door',
    title: 'Front door for simple chats',
    detail: 'Short, plain, non-private questions go straight to a free AI and skip Claude.',
  },
  {
    key: 'sticky',
    label: 'Sticky conversations',
    title: 'Keep a conversation on one model',
    detail: 'For 30 minutes a chat stays on the free model that answered it.',
  },
  {
    key: 'handover',
    label: 'Hand-over note',
    title: 'Hand-over note when the model has to change',
    detail: 'The next model gets a short note of what the free AIs answered so far.',
  },
  {
    key: 'fallback',
    label: 'Fall back both ways',
    title: 'Fall back both ways',
    detail:
      'Free AIs busy: Claude takes it. Claude out of budget: a free AI answers non-private chats.',
  },
  {
    key: 'budgetAware',
    label: 'Budget-aware',
    title: 'Prefer free AIs when the budget is nearly used',
    detail: 'From 80% of today’s Claude budget, the front door opens and Claude delegates more.',
  },
];

/** Rules → Delegation (Phase 2): Claude stays the boss and decides what free AIs may do. */
export function DelegationRules({
  delegation,
  onChange,
}: {
  delegation: PoolDelegation;
  onChange: (patch: Partial<PoolDelegation>) => void;
}): React.JSX.Element {
  return (
    <Panel title="Sharing work with free AIs">
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
    </Panel>
  );
}
