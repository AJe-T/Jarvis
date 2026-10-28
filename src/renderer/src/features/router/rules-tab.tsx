import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Lock, Plus, ShieldAlert } from 'lucide-react';
import { PRIVATE_SOURCES, type PoolSnapshot, type PoolTier } from '@shared/free-pool';
import { Button } from '../../components/ui/button';
import type { RouterTab } from './ai-map-model';
import { DelegationRules } from './delegation-rules';
import { Panel, ProviderDot, SettingRow, TIER_NAME, TabIntro, TierTag, Toggle } from './parts';
import type { PoolActions } from './router-view';

const TIER_RULE: Record<PoolTier, string> = {
  1: 'Gets everything, including private data.',
  2: 'Gets only non-private work.',
  3: 'Only after you say yes; never private data.',
};

/**
 * Rules: who sits in which tier (only AIs you have set up), the locked private-data rule,
 * how Claude shares work, and the tier-3 question. Explanations live behind "Learn more".
 */
export function RulesTab({
  snap,
  actions,
  onOpen,
}: {
  snap: PoolSnapshot;
  actions: PoolActions;
  onOpen: (tab: RouterTab) => void;
}): React.JSX.Element {
  const [preview, setPreview] = useState(false);
  const keyed = snap.providers.filter((p) => p.keys.length > 0);
  const members: Record<PoolTier, Array<{ id: string; label: string }>> = {
    1: [
      { id: 'claude', label: 'Claude (main brain)' },
      { id: 'local', label: 'Local model on this PC' },
    ],
    2: keyed.filter((p) => p.tier === 2).map((p) => ({ id: p.id, label: p.label })),
    3: keyed.filter((p) => p.tier === 3).map((p) => ({ id: p.id, label: p.label })),
  };
  const onChange = actions.settings;
  return (
    <div className="flex flex-col gap-4">
      <TabIntro help="router:rules">
        Who may receive which work. Private data always stays with Claude.
      </TabIntro>
      <div className="grid gap-3 lg:grid-cols-3">
        {([1, 2, 3] as const).map((t) => (
          <section key={t} aria-label={`Tier ${t}`} className="card flex flex-col gap-2 p-4">
            <div className="flex items-center gap-2">
              <TierTag tier={t} short />
              <h2 className="font-semibold text-ink-100">{TIER_NAME[t]}</h2>
            </div>
            <p className="text-xs text-ink-500">{TIER_RULE[t]}</p>
            <ul className="flex flex-col gap-1.5">
              {members[t].map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-sm bg-surface-2 px-3 py-1.5 text-sm text-ink-100"
                >
                  <ProviderDot id={m.id} />
                  {m.label}
                </li>
              ))}
            </ul>
            {members[t].length === 0 && (
              <button
                type="button"
                onClick={() => onOpen('keys')}
                className="inline-flex items-center gap-1.5 self-start text-sm text-accent-300 hover:underline"
              >
                <Plus size={14} aria-hidden />
                {t === 2 ? 'Add a free key' : 'None set up'}
              </button>
            )}
          </section>
        ))}
      </div>

      <Panel
        title="Private data never leaves tier 1"
        aside={
          <span className="inline-flex items-center gap-1.5 text-ok-400">
            <Lock size={14} aria-hidden /> Always on
          </span>
        }
      >
        <ul className="flex flex-wrap gap-1.5">
          {PRIVATE_SOURCES.map((s) => (
            <li key={s.id} className="tag bg-neutral-tint text-ink-300">
              {s.label}
            </li>
          ))}
        </ul>
      </Panel>

      <DelegationRules
        delegation={snap.delegation}
        onChange={(patch) => actions.settings({ delegation: patch })}
      />

      <Panel title="When tiers 1 and 2 are out of limits">
        <SettingRow
          title="Third-party AIs"
          detail="Claude's limit is used up and every trusted free AI is busy. Jarvis can ask whether to use tier 3 for non-private work."
        >
          <select
            aria-label="Third-party AIs"
            value={snap.tier3}
            onChange={(e) => onChange({ tier3: e.target.value as 'ask' | 'never' })}
            className="min-h-9 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100"
          >
            <option value="ask">Ask me each time</option>
            <option value="never">Never use them</option>
          </select>
        </SettingRow>
        <SettingRow
          title="Ask every time for third-party AIs"
          detail="Off: one yes lasts until Jarvis restarts if you choose so. On: Jarvis asks before every third-party answer."
        >
          <Toggle
            label="Ask every time for third-party AIs"
            checked={snap.tier3EveryTime}
            onChange={(on) => onChange({ tier3EveryTime: on })}
          />
        </SettingRow>
        <div>
          <Button onClick={() => setPreview(true)}>
            <ShieldAlert size={14} aria-hidden /> Preview the question
          </Button>
        </div>
      </Panel>

      <Tier3Question
        open={preview}
        soonestMin={12}
        everyTime={snap.tier3EveryTime}
        preview
        onAnswer={() => setPreview(false)}
      />
    </div>
  );
}

/** Asked before the first tier-3 request (main sends pool:ask; tier3-host.tsx shows it). */
export function Tier3Question({
  open,
  soonestMin,
  everyTime,
  preview,
  onAnswer,
}: {
  open: boolean;
  soonestMin: number | null;
  /** pool.tier3EveryTime: no "Until Jarvis restarts". */
  everyTime: boolean;
  preview?: boolean;
  onAnswer: (a: 'once' | 'session' | 'no') => void;
}): React.JSX.Element {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onAnswer('no')}>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim fade-in fixed inset-0 z-40" />
        <Dialog.Content
          role="alertdialog"
          className="dialog modal-in fixed top-1/2 left-1/2 z-50 w-[min(32rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 p-6"
        >
          <Dialog.Title className="flex items-center gap-2 text-lg font-semibold text-ink-100">
            <ShieldAlert size={18} aria-hidden className="text-lamp-400" />
            Use third-party AIs?
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-ink-300">
            Every trusted free AI is busy or out of today&apos;s limit
            {soonestMin ? ` (soonest back in about ${soonestMin} min)` : ''}. Third-party AIs are
            run by small, unknown companies (or added by you) that can read what is sent to them.
            They get only the question itself, and Jarvis treats their answer like a web page.
          </Dialog.Description>
          <p className="mt-3 flex items-start gap-2 rounded-sm bg-surface-2 p-3 text-sm text-ink-100">
            <Lock size={14} aria-hidden className="mt-0.5 shrink-0 text-ok-400" />
            Private work never goes to them, even if you say yes: only tasks without your memory,
            files, screen or messages ever reach the free pool.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button onClick={() => onAnswer('no')}>No, wait</Button>
            {!everyTime && (
              <Button onClick={() => onAnswer('session')}>Until Jarvis restarts</Button>
            )}
            <Button variant="primary" onClick={() => onAnswer('once')}>
              Just this once
            </Button>
          </div>
          {preview && <p className="mt-3 text-xs text-ink-500">Preview: no request is sent.</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
