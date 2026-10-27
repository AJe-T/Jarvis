import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Lock, ShieldAlert } from 'lucide-react';
import { PRIVATE_SOURCES, type PoolSnapshot, type PoolTier } from '@shared/free-pool';
import { Button } from '../../components/ui/button';
import { Panel, ProviderDot, SettingRow, TIER_NAME, TierTag } from './parts';

const TIER_RULE: Record<PoolTier, string> = {
  1: 'Gets everything, including private data. First choice for anything important.',
  2: 'Gets only non-private work. Normal home of free work.',
  3: 'Last resort. Only after you say yes, and never private data, even then.',
};

/** Tiers & privacy: who sits in which tier, the locked private-data rule, the tier-3 question. */
export function TiersTab({
  snap,
  onChange,
}: {
  snap: PoolSnapshot;
  onChange: (patch: { tier3: 'ask' | 'never' }) => void;
}): React.JSX.Element {
  const [preview, setPreview] = useState(false);
  const members: Record<PoolTier, Array<{ id: string; label: string }>> = {
    1: [
      { id: 'claude', label: 'Claude (main brain)' },
      { id: 'local', label: 'Local model on this PC' },
    ],
    2: snap.providers.filter((p) => p.tier === 2).map((p) => ({ id: p.id, label: p.label })),
    3: snap.providers.filter((p) => p.tier === 3).map((p) => ({ id: p.id, label: p.label })),
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-3">
        {([1, 2, 3] as const).map((t) => (
          <section key={t} aria-label={`Tier ${t}`} className="card flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2">
              <TierTag tier={t} short />
              <h2 className="font-semibold text-ink-100">{TIER_NAME[t]}</h2>
            </div>
            <p className="text-sm text-ink-300">{TIER_RULE[t]}</p>
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
          </section>
        ))}
      </div>
      <p className="text-xs text-ink-500">
        Move a provider between tier 2 and tier 3 on the Providers &amp; keys tab. The tier follows
        the provider, not the model: Gemini through Google is tier 2, Gemini through an unknown
        relay is tier 3.
      </p>

      <Panel
        title="Private data stays in tier 1"
        aside={
          <span className="inline-flex items-center gap-1.5 text-ok-400">
            <Lock size={14} aria-hidden /> Always on
          </span>
        }
      >
        <p className="text-sm text-ink-300">
          If a task used any of these, no free AI gets it: Claude or your local model answers. This
          is checked in code on every request, not left to an AI&apos;s judgement, and it has no off
          switch.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {PRIVATE_SOURCES.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-sm text-ink-100">
              <Check size={14} aria-hidden className="text-ok-400" />
              {s.label}
            </li>
          ))}
        </ul>
      </Panel>

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
        <div>
          <Button onClick={() => setPreview(true)}>
            <ShieldAlert size={14} aria-hidden /> Preview the question
          </Button>
        </div>
      </Panel>

      <Tier3Question open={preview} soonestMin={12} preview onAnswer={() => setPreview(false)} />
    </div>
  );
}

/** Asked before the first tier-3 request (main sends pool:ask; tier3-host.tsx shows it). */
export function Tier3Question({
  open,
  soonestMin,
  preview,
  onAnswer,
}: {
  open: boolean;
  soonestMin: number | null;
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
            run by small, unknown companies that can read what is sent to them.
          </Dialog.Description>
          <p className="mt-3 flex items-start gap-2 rounded-sm bg-surface-2 p-3 text-sm text-ink-100">
            <Lock size={14} aria-hidden className="mt-0.5 shrink-0 text-ok-400" />
            Private work never goes to them, even if you say yes: only tasks without your memory,
            files, screen or messages ever reach the free pool.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button onClick={() => onAnswer('no')}>No, wait</Button>
            <Button onClick={() => onAnswer('session')}>Until Jarvis restarts</Button>
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
